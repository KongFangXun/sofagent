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

import type { CrudResult } from '@sofagent/orchestrator';

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
  const { workflowCreate } = await import('@sofagent/orchestrator');
  return workflowCreate(args, await resolveDataDir(args.data_dir as string | undefined));
}

export async function workflowUpdate(args: Record<string, unknown>): Promise<CrudResult> {
  const { workflowUpdate } = await import('@sofagent/orchestrator');
  return workflowUpdate(args, await resolveDataDir(args.data_dir as string | undefined));
}

export async function workflowNodeAdd(args: Record<string, unknown>): Promise<CrudResult> {
  const { workflowNodeAdd } = await import('@sofagent/orchestrator');
  return workflowNodeAdd(args, await resolveDataDir(args.data_dir as string | undefined));
}

export async function workflowDiffPreview(args: Record<string, unknown>): Promise<CrudResult> {
  const { workflowDiffPreview } = await import('@sofagent/orchestrator');
  return workflowDiffPreview(args, await resolveDataDir(args.data_dir as string | undefined));
}
