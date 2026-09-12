// ============================================================
// workflow/index.ts · workflow 域深 barrel（v1.4.8 深模块条目 9 下半场）
// ============================================================
// 覆盖 mcp 侧两个消费者（原经根 barrel 取符号）：
//   tools/route-workflow.ts → routeRequest / RouteResult / ParsedWorkflow
//   tools/workflow-crud.ts  → CrudResult / workflow{Create,Update,NodeAdd,DiffPreview}
// 符号集 = 三源单文件 re-export（解析 + 路由 + 存储）——单源不复制。
// 根 barrel 符号集不受影响（本文件只在 exports 增加窄入口）。
// ============================================================

// workflow 解析（类型面）
export type { ParsedWorkflow } from '../workflow-parser';

// 工作流路由（route-workflow tool 消费）
export { routeRequest } from '../route/route-request';
export type { RouteResult } from '../route/route-request';

// workflow CRUD（workflow-crud tool 消费）
export {
  workflowCreate,
  workflowUpdate,
  workflowNodeAdd,
  workflowDiffPreview,
} from '../crud/workflow-store';
export type { CrudResult } from '../crud/workflow-store';
