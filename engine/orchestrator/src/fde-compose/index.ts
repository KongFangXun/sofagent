// ============================================================
// fde-compose/index.ts · FDE compose 域深 barrel（v1.4.9 深模块条目 9 下半场）
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
// v1.4.8 第 7 批（train 拆包）：train-analyze 复用 FDE 梳理产出（拍板：不重复采集），
// 需要 workbench 路径规范定位 interview.json。此前经相对路径 '../fde/fde-workbench'
// 直取（同包内）——拆包后 train 在 @sofagent/train，须经本窄入口消费。
// 非破坏新增（root barrel 符号集不变——public-api.mjs 只读 src/index.ts 入口）。
export { fdeWorkbenchPaths } from '../fde/fde-workbench';
