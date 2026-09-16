// ============================================================
// workflow/index.ts · workflow 域深 barrel（v1.4.9 深模块条目 9 下半场）
// ============================================================
// 覆盖 mcp 侧两个消费者（原经根 barrel 取符号）：
//   tools/route-workflow.ts → routeRequest / RouteResult / ParsedWorkflow
//   tools/workflow-crud.ts  → CrudResult / workflow{Create,Update,NodeAdd,DiffPreview}
// v1.4.9 G1（T5）新增消费者：
//   tools/workflow-export.ts / workflow-import.ts → lineage 面
//   （appendLineageEvent / traceLineage / buildBundleLineage / chainFromBundle）
// 符号集 = 多源单文件 re-export（解析 + 路由 + 存储 + 血缘）——单源不复制。
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

// workflow 血缘（v1.4.9 G1 · T5——workflow-export / workflow-import tools 消费）
export {
  lineagePath,
  appendLineageEvent,
  readLineageEvents,
  traceLineage,
  buildBundleLineage,
  chainFromBundle,
} from './lineage';
export type {
  LineageEventType,
  LineageAncestor,
  WorkflowLineageEvent,
  BundleLineage,
} from './lineage';
