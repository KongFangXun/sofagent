// ============================================================
// crud/workflow-store.ts · workflow 对象存储 + version/lifecycle 联动
// ============================================================
//
// G14 workflow CRUD 的存储层——LUI Agent（商业平台）经 MCP 四 tool
// 对 workflow 做「对象化」读写：
//
//   存储形态：
//     {dataDir}/workflow-store/{workflowId}.json            ← trunk（权威版本）
//     {dataDir}/workflow-store/{workflowId}.branch-{actor}.json ← branch（非 owner 改动）
//
//   version/lifecycle 联动（对齐 ontology v1.3.7 trunk/branch 语义）：
//     - owner（创建者）直改 trunk，每次写 version+1
//     - 非 owner 不动 trunk——写到 branch-{actor}，等审阅合并回 trunk
//     - branch 合并（workflowMergeBranch，PR merge 写回联动）= trunk 内容
//       替换 + version+1 + 删 branch 文件 + audit
//
//   审计：每次落库动作挂 decision-log（kind=ARTIFACT_EDIT——workflow
//   对象属制品；emitDecision 是 @sofagent/audit 受控写唯一入口，HMAC 链）
// ============================================================

import { existsSync, readFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { atomicWriteSync } from '@sofagent/core';
import {
  gateOrThrow,
  validateWorkflowCrons,
  workflowCreateSchema,
  workflowUpdateSchema,
  workflowNodeAddSchema,
  workflowDiffPreviewSchema,
  SchemaGateError,
  type WorkflowCreateInput,
  type WorkflowUpdateInput,
  type WorkflowNodeAddInput,
  type WorkflowDiffPreviewInput,
} from './schema-gate';

// ────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────

/** 存储的 workflow 对象（文档 + 版本/归属元数据） */
export interface StoredWorkflow {
  /** workflow 标识（文件名主键） */
  id: string;
  /** workflow 文档（schema-gate 校验通过的 nodes 形态） */
  workflow: WorkflowCreateInput['workflow'];
  /** 版本号（每次落库 +1，起始 1） */
  version: number;
  /** 创建者（trunk 直改权持有人） */
  owner: string;
  /** 描述（可选——创建时可带） */
  description?: string;
  /** 最近修改时间（ISO 8601） */
  updatedAt: string;
  /** 创建时间（ISO 8601） */
  createdAt: string;
}

/** CRUD 操作结果 */
export interface CrudResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  data: {
    isError: boolean;
    /** 操作名（create/update/node_add/diff_preview） */
    action: string;
    /** workflow 标识 */
    workflowId: string;
    /** 落库后的版本号（写操作成功时） */
    version?: number;
    /** 是否走了 branch 路径（非 owner 改动） */
    branched?: boolean;
    /** diff 预览行（diff_preview 成功时） */
    diff?: string[];
    /** 变更行数统计（diff_preview 成功时） */
    added?: number;
    removed?: number;
    /** 结构化错误清单（isError=true 时机器可读） */
    issues?: string[];
    /** 审计留痕是否成功 */
    auditLogged: boolean;
  };
}

// ────────────────────────────────────────────────────────────
// 存储原语
// ────────────────────────────────────────────────────────────

/** workflow id 合法性（文件名主键——拒路径穿越/空串/点开头，对齐 G7 TENANT_PATTERN 纪律） */
const WF_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function assertWorkflowId(id: string): void {
  if (!WF_ID_PATTERN.test(id)) {
    throw new SchemaGateError(
      `workflow_id「${id}」非法（字母/数字开头，仅含字母数字点横线下划线，≤128 字符）`,
    );
  }
}

function storeDir(dataDir: string): string {
  return join(dataDir, 'workflow-store');
}

function trunkPath(dataDir: string, id: string): string {
  return join(storeDir(dataDir), `${id}.json`);
}

function branchPath(dataDir: string, id: string, actor: string): string {
  return join(storeDir(dataDir), `${id}.branch-${actor}.json`);
}

/** 读单个存储对象（不存在返回 null；损坏 fail-loud 抛错不静默重建） */
function readStored(path: string, id: string): StoredWorkflow | null {
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (err) {
    throw new SchemaGateError(
      `workflow-store 文件损坏（${id}）: ${err instanceof Error ? err.message : String(err)}——请人工检查 ${path}`,
    );
  }
  return parsed as StoredWorkflow;
}

/** 落库（原子写 + version+1） */
function writeStored(
  dataDir: string,
  stored: StoredWorkflow,
  branchActor: string | null,
): StoredWorkflow {
  const dir = storeDir(dataDir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path =
    branchActor !== null ? branchPath(dataDir, stored.id, branchActor) : trunkPath(dataDir, stored.id);
  atomicWriteSync(path, JSON.stringify(stored, null, 2));
  return stored;
}

/** 审计留痕（decision-log——best-effort，失败不阻断写路径但结果可见） */
async function auditLog(
  action: string,
  workflowId: string,
  detail: string,
  actor: string,
  evidence: string[],
): Promise<boolean> {
  try {
    const audit = (await import('@sofagent/audit')) as unknown as {
      emitDecision: (input: {
        agentId: string;
        sessionId: string;
        kind: string;
        moment: string;
        why: string;
        specRef?: string;
        artifactRef?: string;
        evidence?: string[];
        category?: string;
      }) => unknown;
    };
    audit.emitDecision({
      agentId: `sofagent-workflow-crud-${action}`,
      sessionId: `workflow-${workflowId}-${Date.now()}`,
      kind: 'ARTIFACT_EDIT',
      moment: 'ACT',
      category: 'select',
      why: `workflow CRUD ${action}: ${detail}（actor=${actor}）`,
      artifactRef: `workflow-store/${workflowId}`,
      evidence,
    });
    return true;
  } catch {
    return false; // best-effort——写已成功，审计失败显式标注不回滚
  }
}


/** gate 校验失败 → 结构化 isError 结果（MCP 面不 crash——错误机器可读） */
function gateFail(action: string, err: SchemaGateError): CrudResult {
  return {
    text: `[sofagent] workflow_${action === 'diff_preview' ? 'diff_preview' : action} 参数校验未通过（${err.issues.length} 项）：${err.issues[0]}`,
    data: { isError: true, action, workflowId: '', issues: err.issues, auditLogged: false },
  };
}

// ────────────────────────────────────────────────────────────
// 四操作实现
// ────────────────────────────────────────────────────────────

/**
 * workflow_create——新建 workflow 对象（owner 持有 trunk 直改权）。
 *
 * @param input 原始入参（schema-gate 校验）
 * @param dataDir 数据目录
 */
export async function workflowCreate(
  input: unknown,
  dataDir: string,
): Promise<CrudResult> {
  let args: WorkflowCreateInput;
  try {
    args = gateOrThrow(workflowCreateSchema, input, 'workflow_create');
  } catch (err) {
    if (err instanceof SchemaGateError) return gateFail('create', err);
    throw err;
  }

  // workflow id 取 name（文件名主键）——非法字符在 assertWorkflowId 收口
  const id = args.workflow.name;
  assertWorkflowId(id);

  // 重复创建拒绝（不动既有对象——create 覆盖等于静默篡改）
  if (readStored(trunkPath(dataDir, id), id) !== null) {
    return {
      text: `[sofagent] workflow_create 失败：workflow「${id}」已存在（用 workflow_update 更新）`,
      data: { isError: true, action: 'create', workflowId: id, issues: [`workflow「${id}」已存在`], auditLogged: false },
    };
  }

  // cron 语法校验（结构门之后的语义门）
  const cronIssues = validateWorkflowCrons(args.workflow);
  if (cronIssues.length > 0) {
    return {
      text: `[sofagent] workflow_create 失败：trigger.schedule 非法（${cronIssues.length} 项）：${cronIssues[0]}`,
      data: { isError: true, action: 'create', workflowId: id, issues: cronIssues, auditLogged: false },
    };
  }

  const now = new Date().toISOString();
  const stored: StoredWorkflow = {
    id,
    workflow: args.workflow,
    version: 1,
    owner: args.owner,
    ...(args.description !== undefined ? { description: args.description } : {}),
    updatedAt: now,
    createdAt: now,
  };
  writeStored(dataDir, stored, null);

  const auditLogged = await auditLog(
    'create',
    id,
    `新建 workflow（${stored.workflow.nodes.length} 节点，owner=${args.owner}）`,
    args.owner,
    [`version=1 nodes=${stored.workflow.nodes.length}`],
  );

  return {
    text: `[sofagent] ✅ workflow「${id}」已创建（v1 · ${stored.workflow.nodes.length} 节点 · owner=${args.owner}）`,
    data: { isError: false, action: 'create', workflowId: id, version: 1, auditLogged },
  };
}

/**
 * workflow_update——全量替换 workflow 文档。
 * owner 直改 trunk（version+1）；非 owner 写 branch-{actor}（trunk 不动）。
 */
export async function workflowUpdate(
  input: unknown,
  dataDir: string,
): Promise<CrudResult> {
  let args: WorkflowUpdateInput;
  try {
    args = gateOrThrow(workflowUpdateSchema, input, 'workflow_update');
  } catch (err) {
    if (err instanceof SchemaGateError) return gateFail('update', err);
    throw err;
  }
  assertWorkflowId(args.workflow_id);

  const existing = readStored(trunkPath(dataDir, args.workflow_id), args.workflow_id);
  if (existing === null) {
    return notFound(args.workflow_id, 'update');
  }

  const cronIssues = validateWorkflowCrons(args.workflow);
  if (cronIssues.length > 0) {
    return {
      text: `[sofagent] workflow_update 失败：trigger.schedule 非法（${cronIssues.length} 项）：${cronIssues[0]}`,
      data: { isError: true, action: 'update', workflowId: args.workflow_id, issues: cronIssues, auditLogged: false },
    };
  }

  const isOwner = args.actor === existing.owner;
  const now = new Date().toISOString();
  const stored: StoredWorkflow = {
    ...existing,
    workflow: args.workflow,
    // owner 直改 trunk：version+1；非 owner 写 branch：branch 自身版本从 trunk 当前值起算
    version: isOwner ? existing.version + 1 : existing.version,
    updatedAt: now,
  };
  writeStored(dataDir, stored, isOwner ? null : args.actor);

  const auditLogged = await auditLog(
    'update',
    args.workflow_id,
    isOwner
      ? `owner 直改 trunk（v${existing.version}→v${stored.version}，${args.workflow.nodes.length} 节点）`
      : `非 owner 写 branch-${args.actor}（基于 trunk v${existing.version}，待审阅合并）`,
    args.actor,
    [
      `trunk version=${existing.version} → ${isOwner ? `trunk v${stored.version}` : `branch-${args.actor} v${stored.version}`}`,
      `nodes=${args.workflow.nodes.length}`,
    ],
  );

  return {
    text: isOwner
      ? `[sofagent] ✅ workflow「${args.workflow_id}」已更新（v${existing.version}→v${stored.version} · owner 直改 trunk）`
      : `[sofagent] ✅ workflow「${args.workflow_id}」改动已写入 branch-${args.actor}（基于 trunk v${existing.version}，等 owner 审阅合并）`,
    data: {
      isError: false,
      action: 'update',
      workflowId: args.workflow_id,
      version: stored.version,
      branched: !isOwner,
      auditLogged,
    },
  };
}

/**
 * workflow_node_add——向既有 workflow 追加单节点（增量改——商业平台
 * 上岗 prompt 产物的落点，见 onboard_prompt 闭环）。
 */
export async function workflowNodeAdd(
  input: unknown,
  dataDir: string,
): Promise<CrudResult> {
  let args: WorkflowNodeAddInput;
  try {
    args = gateOrThrow(workflowNodeAddSchema, input, 'workflow_node_add');
  } catch (err) {
    if (err instanceof SchemaGateError) return gateFail('node_add', err);
    throw err;
  }
  assertWorkflowId(args.workflow_id);

  const existing = readStored(trunkPath(dataDir, args.workflow_id), args.workflow_id);
  if (existing === null) {
    return notFound(args.workflow_id, 'node_add');
  }

  // 节点 id 重复拒绝
  if (existing.workflow.nodes.some((n) => n.id === args.node.id)) {
    return {
      text: `[sofagent] workflow_node_add 失败：节点「${args.node.id}」已存在`,
      data: {
        isError: true,
        action: 'node_add',
        workflowId: args.workflow_id,
        issues: [`节点 id「${args.node.id}」重复`],
        auditLogged: false,
      },
    };
  }

  // depends_on 悬空引用拒绝
  const known = new Set(existing.workflow.nodes.map((n) => n.id));
  for (const dep of args.node.depends_on ?? []) {
    if (!known.has(dep)) {
      return {
        text: `[sofagent] workflow_node_add 失败：节点「${args.node.id}」依赖悬空节点「${dep}」`,
        data: {
          isError: true,
          action: 'node_add',
          workflowId: args.workflow_id,
          issues: [`depends_on 悬空：${dep}`],
          auditLogged: false,
        },
      };
    }
  }

  // cron 语法校验（单节点）
  if (args.node.trigger?.schedule) {
    const { validateCronSchedule } = await import('./schema-gate');
    const err = validateCronSchedule(args.node.trigger.schedule);
    if (err) {
      return {
        text: `[sofagent] workflow_node_add 失败：trigger.schedule ${err}`,
        data: {
          isError: true,
          action: 'node_add',
          workflowId: args.workflow_id,
          issues: [`节点 ${args.node.id} trigger.schedule: ${err}`],
          auditLogged: false,
        },
      };
    }
  }

  const isOwner = args.actor === existing.owner;
  const now = new Date().toISOString();
  const stored: StoredWorkflow = {
    ...existing,
    workflow: { ...existing.workflow, nodes: [...existing.workflow.nodes, args.node] },
    version: isOwner ? existing.version + 1 : existing.version,
    updatedAt: now,
  };
  writeStored(dataDir, stored, isOwner ? null : args.actor);

  const auditLogged = await auditLog(
    'node_add',
    args.workflow_id,
    isOwner
      ? `owner 直改 trunk：追加节点 ${args.node.id}（agent=${args.node.agent}，v${existing.version}→v${stored.version}）`
      : `非 owner 写 branch-${args.actor}：追加节点 ${args.node.id}（基于 trunk v${existing.version}）`,
    args.actor,
    [
      `node=${args.node.id} agent=${args.node.agent}`,
      `trunk version=${existing.version} → ${isOwner ? `trunk v${stored.version}` : `branch-${args.actor}`}`,
    ],
  );

  return {
    text: isOwner
      ? `[sofagent] ✅ 节点「${args.node.id}」已追加进 workflow「${args.workflow_id}」（v${existing.version}→v${stored.version}）`
      : `[sofagent] ✅ 节点「${args.node.id}」追加已写入 branch-${args.actor}（基于 trunk v${existing.version}，等 owner 审阅合并）`,
    data: {
      isError: false,
      action: 'node_add',
      workflowId: args.workflow_id,
      version: stored.version,
      branched: !isOwner,
      auditLogged,
    },
  };
}

/**
 * workflow_diff_preview——对比传入文档与 trunk 当前的差异（只读零副作用）。
 * 行级 diff（YAML 序列化后 LCS 对比——自实现零新依赖）。
 */
export async function workflowDiffPreview(
  input: unknown,
  dataDir: string,
): Promise<CrudResult> {
  let args: WorkflowDiffPreviewInput;
  try {
    args = gateOrThrow(workflowDiffPreviewSchema, input, 'workflow_diff_preview');
  } catch (err) {
    if (err instanceof SchemaGateError) return gateFail('diff_preview', err);
    throw err;
  }
  assertWorkflowId(args.workflow_id);

  const existing = readStored(trunkPath(dataDir, args.workflow_id), args.workflow_id);
  if (existing === null) {
    return notFound(args.workflow_id, 'diff_preview');
  }

  const diff = diffLines(
    serializeDoc(existing.workflow),
    serializeDoc(args.workflow),
  );

  return {
    text: [
      `[sofagent] workflow「${args.workflow_id}」diff 预览（trunk v${existing.version} → 传入文档，零副作用）:`,
      ...(diff.length > 0
        ? diff
        : ['  （无差异——传入文档与 trunk 当前版本一致）']),
    ].join('\n'),
    data: {
      isError: false,
      action: 'diff_preview',
      workflowId: args.workflow_id,
      diff,
      added: diff.filter((l) => l.startsWith('+')).length,
      removed: diff.filter((l) => l.startsWith('-')).length,
      auditLogged: false, // 只读操作不产审计事件（挂链在写路径）
    },
  };
}

// ────────────────────────────────────────────────────────────
// branch→trunk 合并（PR 域写回联动——MCP pr_merge 编排消费面）
// ────────────────────────────────────────────────────────────

export interface WorkflowMergeBranchInput {
  workflow_id: string;
  /** branch 持有者（branch-{actor} 文件名成分） */
  branch_actor: string;
  /** 执行合并的操作者（审计留痕） */
  merge_actor: string;
}

/**
 * workflow_merge_branch——branch 内容替换 trunk + version+1 + 删 branch。
 *
 * PR merge 写回联动的编排原语：读 branch-{branch_actor} → 内容替换 trunk
 * （version = trunk.version + 1，owner 不变，updatedAt 刷新）→ 删 branch 文件。
 * branch 不存在 → notFound 结构化错误（MCP 层据此判定「无 branch 改动」场景）。
 */
export async function workflowMergeBranch(
  input: WorkflowMergeBranchInput,
  dataDir: string,
): Promise<CrudResult> {
  if (!input.workflow_id || !input.branch_actor || !input.merge_actor) {
    return {
      text: '[sofagent] workflow merge_branch 失败：缺必填参数（workflow_id/branch_actor/merge_actor）',
      data: {
        isError: true,
        action: 'merge_branch',
        workflowId: input.workflow_id ?? '',
        issues: ['缺必填参数（workflow_id/branch_actor/merge_actor）'],
        auditLogged: false,
      },
    };
  }
  assertWorkflowId(input.workflow_id);

  // trunk 必须存在（合并不创建对象）
  const trunk = readStored(trunkPath(dataDir, input.workflow_id), input.workflow_id);
  if (trunk === null) {
    return notFound(input.workflow_id, 'merge_branch');
  }

  // 读 branch（损坏 JSON 会在 readStored 抛 SchemaGateError——fail-loud）
  const branch = readStored(
    branchPath(dataDir, input.workflow_id, input.branch_actor),
    `${input.workflow_id}.branch-${input.branch_actor}`,
  );
  if (branch === null) {
    return {
      text: `[sofagent] workflow merge_branch 失败：workflow「${input.workflow_id}」无 branch-${input.branch_actor}（PR 不带 branch 改动或已合并）`,
      data: {
        isError: true,
        action: 'merge_branch',
        workflowId: input.workflow_id,
        issues: [`branch-${input.branch_actor} 不存在`],
        auditLogged: false,
      },
    };
  }

  // 内容替换 trunk：version = trunk.version + 1，owner 不变
  const now = new Date().toISOString();
  const merged: StoredWorkflow = {
    ...branch,
    id: trunk.id,
    owner: trunk.owner,
    version: trunk.version + 1,
    createdAt: trunk.createdAt,
    updatedAt: now,
  };
  writeStored(dataDir, merged, null);

  // 删 branch 文件（trunk 已原子落盘后才删——中途失败可重跑合并）
  rmSync(branchPath(dataDir, input.workflow_id, input.branch_actor));

  const auditLogged = await auditLog(
    'merge_branch',
    input.workflow_id,
    `branch-${input.branch_actor} → trunk（v${trunk.version}→v${merged.version}，branch actor=${input.branch_actor}，merge actor=${input.merge_actor}）`,
    input.merge_actor,
    [
      `trunk version ${trunk.version} → ${merged.version}`,
      `branch=${input.branch_actor} merged by ${input.merge_actor}`,
      `nodes=${merged.workflow.nodes.length}`,
    ],
  );

  return {
    text: `[sofagent] ✅ workflow「${input.workflow_id}」branch-${input.branch_actor} 已合并回 trunk（v${trunk.version}→v${merged.version} · merge actor=${input.merge_actor}）`,
    data: {
      isError: false,
      action: 'merge_branch',
      workflowId: input.workflow_id,
      version: merged.version,
      auditLogged,
    },
  };
}

// ────────────────────────────────────────────────────────────
// 辅助
// ────────────────────────────────────────────────────────────

function notFound(workflowId: string, action: string): CrudResult {
  return {
    text: `[sofagent] workflow_${action} 失败：workflow「${workflowId}」不存在（用 workflow_create 创建）`,
    data: {
      isError: true,
      action,
      workflowId,
      issues: [`workflow「${workflowId}」不存在`],
      auditLogged: false,
    },
  };
}

/** workflow 文档 → 稳定 YAML 文本（diff 基底——js-yaml 既有依赖） */
function serializeDoc(doc: WorkflowCreateInput['workflow']): string[] {
  // 简单稳定序列化：JSON key 序列化后逐行（确定性——同构文档必产同文本）
  return JSON.stringify(doc, null, 2).split('\n');
}

/**
 * 行级 diff（LCS 最长公共子序列——经典 DP，零依赖）。
 * 输出 unified 风格：`+ 新行` / `- 旧行` / `  上下文行`。
 */
export function diffLines(oldLines: string[], newLines: string[]): string[] {
  const n = oldLines.length;
  const m = newLines.length;
  // LCS 表（行列各 +1——防大文档爆内存，超 4000 行直接按全量增删处理）
  if (n * m > 4_000_000) {
    return [...oldLines.map((l) => `- ${l}`), ...newLines.map((l) => `+ ${l}`)];
  }
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        oldLines[i] === newLines[j]
          ? dp[i + 1]![j + 1]! + 1
          : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  // 回溯输出
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      out.push(`  ${oldLines[i]}`);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push(`- ${oldLines[i]}`);
      i++;
    } else {
      out.push(`+ ${newLines[j]}`);
      j++;
    }
  }
  while (i < n) {
    out.push(`- ${oldLines[i]}`);
    i++;
  }
  while (j < m) {
    out.push(`+ ${newLines[j]}`);
    j++;
  }
  return out;
}
