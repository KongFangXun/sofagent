// ============================================================
// workflow-crud.ts · MCP tools：workflow CRUD 四 tool（G14）
// ============================================================
//
// LUI Agent（商业平台）的 workflow 对象化读写入口——四 tool 全部
// 委托 @sofagent/orchestrator 的 crud/workflow-store：
//
//   workflow_create       新建（owner 持有 trunk 直改权）
//   workflow_update       全量替换（owner 直改 trunk / 非 owner 开 branch）
//   workflow_node_add     追加单节点（上岗 prompt 产物落点——与 onboard_prompt 闭环）
//   workflow_diff_preview 变更预览（只读零副作用）
//
// 行为契约：
//   - 每次写落库 version+1 + decision-log 审计可查（store 内挂链）
//   - 校验拒绝返回结构化错误清单（issues），绝不 crash
//   - dataDir 解析链：显式入参 > SOFAGENT_DATA > SOFAGENT_HOME/data > ~/.sofagent/data
// ============================================================

import type { CrudResult } from '@sofagent/orchestrator/workflow';

/** dataDir 解析（显式入参优先——与 tools/ 既有 tool 同款纪律） */
async function resolveDataDir(explicit?: string): Promise<string> {
  if (explicit) return explicit;
  const { getDataDir } = await import('@sofagent/core');
  return getDataDir();
}
// ────────────────────────────────────────────────────────────
// 四 tool 入口（薄委托——校验/存储/审计全在 orchestrator store）
// ────────────────────────────────────────────────────────────

export async function workflowCreate(args: Record<string, unknown>): Promise<CrudResult> {
  const { workflowCreate } = await import('@sofagent/orchestrator/workflow');
  return workflowCreate(args, await resolveDataDir(args.data_dir as string | undefined));
}

export async function workflowUpdate(args: Record<string, unknown>): Promise<CrudResult> {
  const { workflowUpdate } = await import('@sofagent/orchestrator/workflow');
  return workflowUpdate(args, await resolveDataDir(args.data_dir as string | undefined));
}

export async function workflowNodeAdd(args: Record<string, unknown>): Promise<CrudResult> {
  const { workflowNodeAdd, buildAiNodeGovernanceProbe } = await import('@sofagent/orchestrator/workflow');
  // v1.5.4 第五章 · A-4 真接线：注入**生产 AI 节点治理面探针**——节点 agent 引用
  // `ai-node:<id>` 时经默认注册表做治理状态前置检查（未注册可引用但不入治理面，
  // 引用告警留痕）。使 crud/workflow-store.ts 的 aiNodeProbe 分支在生产链路可达。
  return workflowNodeAdd(args, await resolveDataDir(args.data_dir as string | undefined), {
    aiNodeProbe: buildAiNodeGovernanceProbe(),
  });
}

export async function workflowDiffPreview(args: Record<string, unknown>): Promise<CrudResult> {
  const { workflowDiffPreview } = await import('@sofagent/orchestrator/workflow');
  return workflowDiffPreview(args, await resolveDataDir(args.data_dir as string | undefined));
}
