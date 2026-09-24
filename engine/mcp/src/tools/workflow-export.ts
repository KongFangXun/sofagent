// ============================================================
// workflow-export.ts · MCP tool：workflow 模板导出（v1.5.2 G1 · T5）
// ============================================================
//
// 五件套导出（changelog 十二章验收 ①）：
//   1. workflow.yml   —— 本体文档（StoredWorkflow.workflow 的 YAML 形态）
//   2. 本体数据        —— ontology entities 伴生清单（模板引用的实体回显）
//   3. MD 家族        —— think.md 反思 + lessons-missteps.md 教训（运行
//                        知识随模板流转——fork 方拿到「怎么跑好」的沉淀）
//   4. manifest       —— 结构化清单（文件名 → 内容 + sha256 完整性）
//   5. 血缘元数据      —— BundleLineage（源企业 / 源版本 / fork 层级 /
//                        祖先链——导入方据此续链回溯）
//
// 跨租户可见性剥离（验收 ④，联动 G6）：private / result-only 节点
// 不出企业——exportBundle 的 crossTenant 开关（缺省 true）在组装时
// 剥离这两类节点，manifest 只记剥离计数（strippedPrivate /
// strippedResultOnly——不记节点名，防枚举探测）。同租户导出
// （crossTenant=false）保留全部节点。
//
// 包边界：读 trunk 走 workflow-store 既有存储原语语义（同目录同命名
// 约定）；血缘走 @sofagent/orchestrator/workflow lineage 面。本文件
// 不直接 import orchestrator 内部路径——只经深 barrel 导出面。
//
// 审计：export 动作 appendLineageEvent（type=export——fork 谱系的
// 法定记录段）+ emitDecision（decision-log HMAC 链）。
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';
import {
  appendLineageEvent,
  buildBundleLineage,
  type BundleLineage,
} from '@sofagent/orchestrator/workflow';

/** dataDir 解析（显式入参优先——与 tools/ 既有 tool 同款纪律） */
async function resolveDataDir(explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const { getDataDir } = await import('@sofagent/core');
  return getDataDir();
}

/** 导出结果（MCP 面） */
export interface WorkflowExportResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  data: {
    isError: boolean;
    action: 'export';
    workflowId: string;
    /** 源版本（导出时刻 trunk version） */
    sourceVersion?: number;
    /** 五件套文件名清单（验收 ① 完整性对账） */
    bundleFiles?: string[];
    /** 血缘元数据（随包携带——导入方续链用） */
    lineage?: {
      sourceEnterprise: string;
      sourceWorkflowId: string;
      sourceVersion: number;
      forkDepth: number;
      ancestors: Array<{ workflowId: string; enterprise: string; version: number; forkedAt: string }>;
    };
    /** 跨租户剥离统计（G6 联动——验收 ④） */
    strippedPrivate?: number;
    strippedResultOnly?: number;
    /** 导出包整体（单对象 JSON 形态——分发的原子单元） */
    bundle?: Record<string, unknown>;
    /** 机器可读错误码 */
    code?: 'invalid-input' | 'workflow-missing' | 'empty-after-strip';
    issues?: string[];
    auditLogged: boolean;
  };
}

/** 单节点形态（剥离判定用——与 workflowDocSchema 节点段同构） */
interface NodeLike {
  id: string;
  visibility?: 'open' | 'private' | 'result-only';
  [key: string]: unknown;
}

/** 文档形态（StoredWorkflow.workflow 同构读取面） */
interface StoredDoc {
  name: string;
  description?: string;
  nodes: NodeLike[];
  [key: string]: unknown;
}

/** 读 trunk（与 workflow-store 同目录同命名——trunkPath 语义副本，注释互指） */
function readTrunk(dataDir: string, workflowId: string): { doc: StoredDoc; version: number; owner: string } | null {
  const p = join(dataDir, 'workflow-store', `${workflowId}.json`);
  if (!existsSync(p)) return null;
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf-8')) as {
      workflow?: StoredDoc;
      version?: number;
      owner?: string;
    };
    if (!parsed || typeof parsed !== 'object' || !parsed.workflow || !Array.isArray(parsed.workflow.nodes)) {
      return null;
    }
    return { doc: parsed.workflow, version: typeof parsed.version === 'number' ? parsed.version : 1, owner: parsed.owner ?? '' };
  } catch {
    return null; // 损坏按不存在处理（导出面只读——修复归 CRUD 面）
  }
}

/** sha256 摘要（manifest 完整性锚——导入方校验包未篡改） */
function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * 跨租户剥离（G6 联动核心——验收 ④）。
 *
 * private / result-only 节点不出企业：跨租户导出时从 nodes 中剔除，
 * 返回剥离计数。depends_on 引用被剥离节点的下游边同步清理（悬空
 * 引用会让导入方 schema 校验失败——剥离要剥干净）。
 */
function stripForCrossTenant(doc: StoredDoc): {
  doc: StoredDoc;
  strippedPrivate: number;
  strippedResultOnly: number;
} {
  const keep: NodeLike[] = [];
  let strippedPrivate = 0;
  let strippedResultOnly = 0;
  for (const n of doc.nodes) {
    if (n.visibility === 'private') { strippedPrivate++; continue; }
    if (n.visibility === 'result-only') { strippedResultOnly++; continue; }
    keep.push(n);
  }
  const keptIds = new Set(keep.map((n) => n.id));
  // 下游边清理（depends_on 指向被剥离节点 → 删该边）
  for (const n of keep) {
    if (Array.isArray(n.depends_on)) {
      n.depends_on = (n.depends_on as string[]).filter((d) => keptIds.has(d));
    }
  }
  return { doc: { ...doc, nodes: keep }, strippedPrivate, strippedResultOnly };
}

/** 伴生本体清单（五件套之二——模板引用的 ontology entities 回显） */
function collectOntologyEntities(dataDir: string, doc: StoredDoc): Array<Record<string, unknown>> {
  const entities: Array<Record<string, unknown>> = [];
  const dir = join(dataDir, 'ontology', 'entities');
  if (!existsSync(dir)) return entities;
  // 引用扫描：节点 agent/task 文本中出现的 entity 名（简式文本匹配——
  // 深层语义引用图归 ontology 域，导出面只做伴生回显）
  const corpus = JSON.stringify(doc);
  const { readdirSync } = require('fs') as typeof import('fs');
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.yml')) continue;
    const name = f.slice(0, -4);
    if (corpus.includes(name)) {
      try {
        entities.push(yamlLoad(readFileSync(join(dir, f), 'utf-8')) as Record<string, unknown>);
      } catch {
        /* 为何可静默：单个伴生 entity YAML 损坏跳过——导出主面不受阻，损坏项由导入侧完整性核对兜底 */
      }
    }
  }
  return entities;
}

/** MD 家族采集（五件套之三——存在才进包，manifest 按实收录） */
function collectMdFamily(dataDir: string): { thinkMd: string | null; lessonsMd: string | null } {
  const think = join(dataDir, 'think.md');
  const lessons = join(dataDir, 'knowledge', 'lessons-missteps.md');
  return {
    thinkMd: existsSync(think) ? readFileSync(think, 'utf-8') : null,
    lessonsMd: existsSync(lessons) ? readFileSync(lessons, 'utf-8') : null,
  };
}

/**
 * workflow_export——五件套导出（G1 验收 ①）。
 *
 * @param args.workflow_id 源 workflow 标识
 * @param args.enterprise 源企业标识（血缘元数据段——导入方回溯锚）
 * @param args.cross_tenant 跨租户分发（缺省 true——private / result-only
 *   节点剥离；同租户传递 false 保留全量）
 * @param args.actor 执行者（审计留痕）
 * @param args.data_dir 数据目录（测试隔离）
 */
export async function workflowExport(args: {
  workflow_id: string;
  enterprise?: string;
  cross_tenant?: boolean;
  actor?: string;
  data_dir?: string;
}): Promise<WorkflowExportResult> {
  if (!args.workflow_id || typeof args.workflow_id !== 'string') {
    return {
      text: '[sofagent] workflow_export 失败：缺必填参数 workflow_id',
      data: { isError: true, action: 'export', workflowId: '', code: 'invalid-input', issues: ['缺 workflow_id'], auditLogged: false },
    };
  }
  const dataDir = await resolveDataDir(args.data_dir);
  const trunk = readTrunk(dataDir, args.workflow_id);
  if (trunk === null) {
    return {
      text: `[sofagent] workflow_export 失败：workflow「${args.workflow_id}」不存在`,
      data: { isError: true, action: 'export', workflowId: args.workflow_id, code: 'workflow-missing', issues: [`workflow「${args.workflow_id}」不存在`], auditLogged: false },
    };
  }

  const crossTenant = args.cross_tenant !== false; // 缺省跨租户（保守——分发场景是主路径）
  const stripped = crossTenant ? stripForCrossTenant(trunk.doc) : { doc: trunk.doc, strippedPrivate: 0, strippedResultOnly: 0 };

  // 剥离后空文档拒绝（fail-closed——空模板分发没有意义且掩盖「全私」事实）
  if (stripped.doc.nodes.length === 0) {
    return {
      text: `[sofagent] workflow_export 拒绝：workflow「${args.workflow_id}」跨租户剥离后 0 节点（全部 private / result-only——无可分发内容）`,
      data: {
        isError: true,
        action: 'export',
        workflowId: args.workflow_id,
        code: 'empty-after-strip',
        strippedPrivate: stripped.strippedPrivate,
        strippedResultOnly: stripped.strippedResultOnly,
        issues: [`剥离后 0 节点（private ${stripped.strippedPrivate} / result-only ${stripped.strippedResultOnly}）`],
        auditLogged: false,
      },
    };
  }

  const enterprise = typeof args.enterprise === 'string' && args.enterprise ? args.enterprise : '(local)';
  const actor = typeof args.actor === 'string' && args.actor ? args.actor : 'workflow-export';

  // ── 五件套组装 ──
  // 1. workflow.yml（本体文档——YAML 形态，schema-gate 校验的规范入参形态）
  const workflowYml = yamlDump(stripped.doc);
  // 2. 本体数据（伴生 entities）
  const entities = collectOntologyEntities(dataDir, stripped.doc);
  // 3. MD 家族
  const md = collectMdFamily(dataDir);
  // 5. 血缘元数据（先建——manifest 引用其摘要）
  const lineage: BundleLineage = buildBundleLineage(args.workflow_id, trunk.version, enterprise, dataDir);

  // 4. manifest（文件名 → sha256 完整性锚 + 剥离计数）
  const fileDigests: Record<string, string> = {
    'workflow.yml': sha256(workflowYml),
    'ontology-entities.json': sha256(JSON.stringify(entities, null, 2)),
    ...(md.thinkMd !== null ? { 'think.md': sha256(md.thinkMd) } : {}),
    ...(md.lessonsMd !== null ? { 'lessons-missteps.md': sha256(md.lessonsMd) } : {}),
  };
  const manifest = {
    kind: 'sofagent-workflow-template',
    version: 1,
    exportedAt: new Date().toISOString(),
    files: fileDigests,
    crossTenant,
    strippedPrivate: stripped.strippedPrivate,
    strippedResultOnly: stripped.strippedResultOnly,
    lineage: {
      sourceEnterprise: lineage.sourceEnterprise,
      sourceWorkflowId: lineage.sourceWorkflowId,
      sourceVersion: lineage.sourceVersion,
      forkDepth: lineage.forkDepth,
      ancestors: lineage.ancestors,
    },
  };

  const bundle = {
    manifest,
    'workflow.yml': workflowYml,
    'ontology-entities.json': JSON.stringify(entities, null, 2),
    ...(md.thinkMd !== null ? { 'think.md': md.thinkMd } : {}),
    ...(md.lessonsMd !== null ? { 'lessons-missteps.md': md.lessonsMd } : {}),
  };
  const bundleFiles = Object.keys(bundle);

  // ── 血缘留痕（export 事件——fork 谱系法定记录段）──
  appendLineageEvent(
    {
      type: 'export',
      workflowId: args.workflow_id,
      actor,
      enterprise,
      version: trunk.version,
      ...(crossTenant ? { strippedPrivate: stripped.strippedPrivate, strippedResultOnly: stripped.strippedResultOnly } : {}),
    },
    dataDir,
  );

  // ── 审计挂链（decision-log——HMAC 链）──
  let auditLogged = false;
  try {
    const { emitDecision } = await import('@sofagent/audit');
    emitDecision({
      agentId: `workflow-export-${actor}`,
      sessionId: `workflow-export-${args.workflow_id}-${Date.now()}`,
      kind: 'ARTIFACT_EDIT',
      moment: 'ACT',
      category: 'select',
      why: `workflow_export 导出「${args.workflow_id}」v${trunk.version}（${bundleFiles.length} 件套，跨租户=${crossTenant}，剥离 private ${stripped.strippedPrivate} / result-only ${stripped.strippedResultOnly}）`,
      artifactRef: `workflow-store/${args.workflow_id}`,
      evidence: [
        `sourceVersion=${trunk.version}`,
        `enterprise=${enterprise}`,
        `files=${bundleFiles.join(',')}`,
        `crossTenant=${crossTenant}`,
        `strippedPrivate=${stripped.strippedPrivate}`,
        `strippedResultOnly=${stripped.strippedResultOnly}`,
        `forkDepth=${lineage.forkDepth}`,
      ],
    });
    auditLogged = true;
  } catch {
    auditLogged = false; // best-effort 显式标注
  }

  return {
    text: [
      `[sofagent] ✅ workflow「${args.workflow_id}」导出完成（v${trunk.version} · 五件套 ${bundleFiles.length} 件 · fork 层级 ${lineage.forkDepth}）`,
      `  分发形态: ${crossTenant ? '跨租户（private/result-only 节点已剥离 ' + stripped.strippedPrivate + '/' + stripped.strippedResultOnly + '）' : '同租户全量'}`,
      `  文件清单: ${bundleFiles.join(' / ')}`,
      `  血缘: 源企业 ${enterprise} · 源版本 v${lineage.sourceVersion} · 祖先 ${lineage.ancestors.length} 层`,
    ].join('\n'),
    data: {
      isError: false,
      action: 'export',
      workflowId: args.workflow_id,
      sourceVersion: trunk.version,
      bundleFiles,
      lineage: {
        sourceEnterprise: lineage.sourceEnterprise,
        sourceWorkflowId: lineage.sourceWorkflowId,
        sourceVersion: lineage.sourceVersion,
        forkDepth: lineage.forkDepth,
        ancestors: lineage.ancestors,
      },
      strippedPrivate: stripped.strippedPrivate,
      strippedResultOnly: stripped.strippedResultOnly,
      bundle,
      auditLogged,
    },
  };
}
