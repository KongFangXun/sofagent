// ============================================================
// workflow-import.ts · MCP tool：workflow 模板导入（v1.5.3 G1 · T5）
// ============================================================
//
// 导入三闸（fail-closed，验收 ②③④）：
//   1. 结构闸——bundle 必须是对象且含 manifest + workflow.yml 两个
//      必要件（五件套的文件名与 manifest.files 摘要逐项核对——
//      sha256 不符 = 包被篡改，拒绝）
//   2. schema 校验门——workflow.yml 解析后过 workflowDocSchema
//      （zod 结构 + 可见性枚举 + cron 语法——与 CRUD 同一校验门，
//      非法模板拒绝，fail-closed）
//   3. 落地闸——importedAs 与本地 trunk 冲突时拒绝（防静默覆盖），
//      经 workflowCreate 语义落地（version=1，owner=导入者）
//
// 血缘回流（验收 ③）：导入落地后 appendLineageEvent（type=import，
// ancestors=chainFromBundle——bundle 携带的祖先链接到本地谱系）。
// traceLineage(importedAs) 即可回溯到源企业 / 源版本。
//
// 合并策略（本体数据）：bundle 的 ontology-entities.json 与本地
// entities 同名时不覆盖（本地优先——导入是补缺不是替换）；新增的
// 落 {dataDir}/ontology/entities/。合并计数进返回体与审计。
//
// 可见性加固（验收 ④ 双保险）：即使包是手工构造的（绕过了 export
// 剥离），import 侧再扫一遍——跨企业源（enterprise ≠ 本地标记）的包
// 里出现 private / result-only 节点 → 拒绝整包（源企业私域节点不该
// 离开源企业，出现即包构造异常或恶意）。
// ============================================================

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';
import {
  appendLineageEvent,
  chainFromBundle,
  type BundleLineage,
} from '@sofagent/orchestrator/workflow';
import {
  gateOrThrow,
  validateWorkflowCrons,
  workflowCreateSchema,
  SchemaGateError,
} from '@sofagent/orchestrator';

/** dataDir 解析（显式入参优先——与 tools/ 既有 tool 同款纪律） */
async function resolveDataDir(explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const { getDataDir } = await import('@sofagent/core');
  return getDataDir();
}

/** 导入结果（MCP 面） */
export interface WorkflowImportResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  data: {
    isError: boolean;
    action: 'import';
    /** 导入落地的新 workflow id（成功时有值） */
    importedAs?: string;
    /** 落地版本（恒 1——新对象从 v1 起，fork 关系在血缘不在版本号） */
    version?: number;
    /** 本体合并统计 */
    entitiesMerged?: { added: number; keptLocal: number };
    /** 回溯锚（验收 ③——导入后即可查谱系） */
    lineageTrace?: Array<{ workflowId: string; enterprise: string; version: number; forkedAt: string }>;
    /** 机器可读错误码 */
    code?: 'invalid-input' | 'bundle-corrupt' | 'integrity-mismatch' | 'schema-gate' | 'private-leak' | 'duplicate-id';
    issues?: string[];
    message: string;
    auditLogged: boolean;
  };
}

/** manifest 形态（与 workflow-export 的 manifest 段同构——跨文件契约） */
interface BundleManifest {
  kind?: string;
  version?: number;
  files?: Record<string, string>;
  crossTenant?: boolean;
  strippedPrivate?: number;
  strippedResultOnly?: number;
  lineage?: {
    sourceEnterprise?: string;
    sourceWorkflowId?: string;
    sourceVersion?: number;
    forkDepth?: number;
    ancestors?: Array<{ workflowId: string; enterprise: string; version: number; forkedAt: string }>;
  };
}

/** sha256 摘要（与 workflow-export 同式——完整性锚两端一致） */
function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/** workflow id 合法性（与 workflow-store WF_ID_PATTERN 同词法——文件名主键） */
const WF_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * 本体合并（伴生 entities——本地优先策略）。
 * 同名 entity 不覆盖（导入补缺不替换）；新增落 ontology/entities/。
 */
function mergeOntologyEntities(
  dataDir: string,
  entities: Array<Record<string, unknown>>,
): { added: number; keptLocal: number } {
  let added = 0;
  let keptLocal = 0;
  const dir = join(dataDir, 'ontology', 'entities');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  for (const e of entities) {
    const name = typeof e.name === 'string' ? e.name : '';
    if (!name || !WF_ID_PATTERN.test(name)) continue; // 非法名跳过（伴生面不阻断导入）
    const target = join(dir, `${name}.yml`);
    if (existsSync(target)) {
      keptLocal++;
      continue; // 本地优先——不覆盖
    }
    writeFileSync(target, yamlDump(e), 'utf-8');
    added++;
  }
  return { added, keptLocal };
}

/**
 * workflow_import——模板导入 + 血缘回流（G1 验收 ②③）。
 *
 * @param args.bundle 导出包整体（workflow_export 返回的 bundle 对象——
 *   manifest + workflow.yml + 伴生件；跨企业传输后的原样入参）
 * @param args.imported_as 落地 workflow id（缺省 = 源 id + '-imported' 后缀）
 * @param args.owner 落地 owner（trunk 直改权持有人——缺省 actor）
 * @param args.actor 执行者（审计留痕）
 * @param args.data_dir 数据目录（测试隔离）
 */
export async function workflowImport(args: {
  bundle: Record<string, unknown>;
  imported_as?: string;
  owner?: string;
  actor?: string;
  data_dir?: string;
}): Promise<WorkflowImportResult> {
  // ── 闸 1：结构闸 ──
  if (!args.bundle || typeof args.bundle !== 'object') {
    return {
      text: '[sofagent] workflow_import 拒绝：bundle 参数缺失或非对象（fail-closed）',
      data: { isError: true, action: 'import', code: 'invalid-input', message: 'bundle 缺失或非对象', auditLogged: false },
    };
  }
  const manifest = args.bundle['manifest'] as BundleManifest | undefined;
  const workflowYml = args.bundle['workflow.yml'];
  if (!manifest || typeof manifest !== 'object' || typeof workflowYml !== 'string') {
    return {
      text: '[sofagent] workflow_import 拒绝：包缺必备件（manifest / workflow.yml——fail-closed）',
      data: { isError: true, action: 'import', code: 'bundle-corrupt', message: '包缺 manifest 或 workflow.yml', auditLogged: false },
    };
  }
  // kind 口径核对（防拿无关 JSON 冒充模板包）
  if (manifest.kind !== 'sofagent-workflow-template') {
    return {
      text: `[sofagent] workflow_import 拒绝：manifest.kind 非 sofagent-workflow-template（实际 ${String(manifest.kind)}）`,
      data: { isError: true, action: 'import', code: 'bundle-corrupt', message: `manifest.kind 非法：${String(manifest.kind)}`, auditLogged: false },
    };
  }

  // ── 完整性核对（manifest.files 摘要逐项——篡改检测）──
  const integrityIssues: string[] = [];
  for (const [fname, digest] of Object.entries(manifest.files ?? {})) {
    const content = args.bundle[fname];
    if (typeof content !== 'string') {
      integrityIssues.push(`manifest 声明的文件「${fname}」不在包内`);
      continue;
    }
    if (sha256(content) !== digest) {
      integrityIssues.push(`「${fname}」sha256 不符（包被篡改或传输损坏）`);
    }
  }
  if (integrityIssues.length > 0) {
    return {
      text: `[sofagent] workflow_import 拒绝：完整性核对未通过（${integrityIssues.length} 项）：${integrityIssues[0]}`,
      data: { isError: true, action: 'import', code: 'integrity-mismatch', issues: integrityIssues, message: '完整性核对未通过', auditLogged: false },
    };
  }

  // 血缘元数据口径（缺 lineage 段 = 无谱系回溯锚——跨企业主路径必须有）
  const lineageMeta = manifest.lineage;
  if (!lineageMeta || typeof lineageMeta.sourceEnterprise !== 'string' || typeof lineageMeta.sourceWorkflowId !== 'string') {
    return {
      text: '[sofagent] workflow_import 拒绝：manifest 缺血缘元数据（sourceEnterprise / sourceWorkflowId——谱系回溯锚，fail-closed）',
      data: { isError: true, action: 'import', code: 'bundle-corrupt', message: 'manifest 缺血缘元数据', auditLogged: false },
    };
  }

  // ── 闸 2：schema 校验门（workflow.yml → 文档 → zod + cron）──
  let doc: Record<string, unknown>;
  try {
    doc = yamlLoad(workflowYml) as Record<string, unknown>;
  } catch (err) {
    return {
      text: `[sofagent] workflow_import 拒绝：workflow.yml YAML 解析失败（${err instanceof Error ? err.message : String(err)}）`,
      data: { isError: true, action: 'import', code: 'schema-gate', message: 'workflow.yml 解析失败', auditLogged: false },
    };
  }
  const actor = typeof args.actor === 'string' && args.actor ? args.actor : 'workflow-import';
  const owner = typeof args.owner === 'string' && args.owner ? args.owner : actor;
  const importedAs =
    typeof args.imported_as === 'string' && args.imported_as
      ? args.imported_as
      : `${lineageMeta.sourceWorkflowId}-imported`;
  if (!WF_ID_PATTERN.test(importedAs)) {
    return {
      text: `[sofagent] workflow_import 拒绝：imported_as「${importedAs}」非法（文件名主键词法）`,
      data: { isError: true, action: 'import', code: 'invalid-input', message: `imported_as 词法非法：${importedAs}`, auditLogged: false },
    };
  }

  // 可见性加固（闸 2.5——验收 ④ 双保险）：跨企业源包内出现 private /
  // result-only 节点 → 拒绝整包（export 剥离被绕过 = 包构造异常）
  const nodes = Array.isArray((doc as { nodes?: unknown[] }).nodes) ? ((doc as { nodes: Array<{ id?: string; visibility?: string }> }).nodes) : [];
  const privateLeak = nodes.filter((n) => n?.visibility === 'private' || n?.visibility === 'result-only');
  if (privateLeak.length > 0) {
    return {
      text: `[sofagent] workflow_import 拒绝：包内检出 ${privateLeak.length} 个 private / result-only 节点（源企业私域节点不得离开源企业——G6 联动加固）`,
      data: {
        isError: true,
        action: 'import',
        code: 'private-leak',
        message: `检出私域可见性节点 ${privateLeak.length} 个（export 剥离被绕过——包构造异常）`,
        auditLogged: false,
      },
    };
  }

  // zod 结构门（与 CRUD 同一 schema——单一校验入口）
  try {
    gateOrThrow(workflowCreateSchema, { workflow: doc, owner }, 'workflow_import');
  } catch (err) {
    if (err instanceof SchemaGateError) {
      return {
        text: `[sofagent] workflow_import 拒绝：schema 校验门未通过（${err.issues.length} 项）：${err.issues[0]}`,
        data: { isError: true, action: 'import', code: 'schema-gate', issues: err.issues, message: 'schema 校验未通过', auditLogged: false },
      };
    }
    throw err;
  }
  // cron 语法门（同 CRUD 语义门）
  const cronIssues = validateWorkflowCrons({ nodes } as Parameters<typeof validateWorkflowCrons>[0]);
  if (cronIssues.length > 0) {
    return {
      text: `[sofagent] workflow_import 拒绝：trigger.schedule 非法（${cronIssues.length} 项）：${cronIssues[0]}`,
      data: { isError: true, action: 'import', code: 'schema-gate', issues: cronIssues, message: 'cron 语法校验未通过', auditLogged: false },
    };
  }

  // ── 闸 3：落地闸（冲突拒绝 + workflowCreate 语义落地）──
  const dataDir = await resolveDataDir(args.data_dir);
  const trunkPath = join(dataDir, 'workflow-store', `${importedAs}.json`);
  if (existsSync(trunkPath)) {
    return {
      text: `[sofagent] workflow_import 拒绝：workflow「${importedAs}」已存在（防静默覆盖——换 imported_as 或先删本地）`,
      data: { isError: true, action: 'import', importedAs, code: 'duplicate-id', message: `「${importedAs}」已存在`, auditLogged: false },
    };
  }
  // 直接写 trunk（workflowCreate 语义：version=1 / owner / createdAt——
  // 不经 MCP 委托层重复解析，存储形态与 workflow-store 同构）
  const now = new Date().toISOString();
  const stored = {
    id: importedAs,
    workflow: doc,
    version: 1,
    owner,
    ...(typeof (doc as { description?: unknown }).description === 'string'
      ? { description: (doc as { description: string }).description }
      : {}),
    updatedAt: now,
    createdAt: now,
  };
  const storeDir = join(dataDir, 'workflow-store');
  if (!existsSync(storeDir)) mkdirSync(storeDir, { recursive: true });
  const { atomicWriteSync } = await import('@sofagent/core');
  atomicWriteSync(trunkPath, JSON.stringify(stored, null, 2));

  // ── 本体合并（本地优先）──
  const bundleEntities = args.bundle['ontology-entities.json'];
  let entitiesMerged = { added: 0, keptLocal: 0 };
  if (typeof bundleEntities === 'string' && bundleEntities.trim() !== '') {
    try {
      const entities = JSON.parse(bundleEntities) as Array<Record<string, unknown>>;
      if (Array.isArray(entities)) {
        entitiesMerged = mergeOntologyEntities(dataDir, entities);
      }
    } catch {
      /* 为何可静默：伴生件解析失败不阻断导入——主件已过完整性核对，此处仅防御性解析 */
    }
  }

  // ── 血缘回流（验收 ③——import 事件 + 祖先链接入本地谱系）──
  const bundleLineage: BundleLineage = {
    exportedAt: new Date().toISOString(),
    sourceEnterprise: lineageMeta.sourceEnterprise,
    sourceWorkflowId: lineageMeta.sourceWorkflowId,
    sourceVersion: typeof lineageMeta.sourceVersion === 'number' ? lineageMeta.sourceVersion : 1,
    forkDepth: typeof lineageMeta.forkDepth === 'number' ? lineageMeta.forkDepth : 0,
    ancestors: Array.isArray(lineageMeta.ancestors) ? lineageMeta.ancestors : [],
  };
  appendLineageEvent(
    {
      type: 'import',
      workflowId: lineageMeta.sourceWorkflowId,
      importedAs,
      actor,
      enterprise: lineageMeta.sourceEnterprise,
      version: bundleLineage.sourceVersion,
      ancestors: chainFromBundle(bundleLineage, importedAs),
    },
    dataDir,
  );

  // 谱系回读（验收 ③ 对账——导入后立即可回溯源企业 / 源版本）
  const { traceLineage } = await import('@sofagent/orchestrator/workflow');
  const lineageTrace = traceLineage(importedAs, dataDir);

  // ── 审计挂链 ──
  let auditLogged = false;
  try {
    const { emitDecision } = await import('@sofagent/audit');
    emitDecision({
      agentId: `workflow-import-${actor}`,
      sessionId: `workflow-import-${importedAs}-${Date.now()}`,
      kind: 'ARTIFACT_EDIT',
      moment: 'ACT',
      category: 'select',
      why: `workflow_import 导入「${importedAs}」（源 ${lineageMeta.sourceEnterprise}/${lineageMeta.sourceWorkflowId} v${bundleLineage.sourceVersion}，${nodes.length} 节点，本体合并 +${entitiesMerged.added}/保留 ${entitiesMerged.keptLocal}）`,
      artifactRef: `workflow-store/${importedAs}`,
      evidence: [
        `source=${lineageMeta.sourceEnterprise}/${lineageMeta.sourceWorkflowId}@v${bundleLineage.sourceVersion}`,
        `importedAs=${importedAs}`,
        `nodes=${nodes.length}`,
        `entitiesAdded=${entitiesMerged.added}`,
        `entitiesKeptLocal=${entitiesMerged.keptLocal}`,
        `forkDepth=${bundleLineage.forkDepth}`,
      ],
    });
    auditLogged = true;
  } catch {
    auditLogged = false; // best-effort 显式标注
  }

  return {
    text: [
      `[sofagent] ✅ 模板导入完成：「${importedAs}」（v1 · ${nodes.length} 节点 · owner=${owner}）`,
      `  源: ${lineageMeta.sourceEnterprise} / ${lineageMeta.sourceWorkflowId} v${bundleLineage.sourceVersion}（fork 层级 ${bundleLineage.forkDepth}）`,
      `  本体合并: 新增 ${entitiesMerged.added} / 本地保留 ${entitiesMerged.keptLocal}`,
      `  血缘谱系: ${lineageTrace.length} 层祖先（traceLineage 可查）`,
    ].join('\n'),
    data: {
      isError: false,
      action: 'import',
      importedAs,
      version: 1,
      entitiesMerged,
      lineageTrace,
      message: '导入成功',
      auditLogged,
    },
  };
}
