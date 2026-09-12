// ============================================================
// fde-compose/index.ts · FDE compose 域深 barrel（v1.4.8 深模块条目 9 下半场）
// ============================================================
// 覆盖 mcp 侧消费者 tools/fde-compose.ts：
//   会话梳理 → ComposeSession / NodeInterview / classifyAutomation
//   草稿生成 → generateWorkflowDraft / validateDraftDag
// 符号集 = fde/ 两源 re-export——单源不复制。
// 根 barrel 符号集不受影响（本文件只在 exports 增加窄入口）。
// ============================================================

export { classifyAutomation } from '../fde/compose-interview';
export type { ComposeSession, NodeInterview } from '../fde/compose-interview';
export { generateWorkflowDraft, validateDraftDag } from '../fde/workflow-draft';
