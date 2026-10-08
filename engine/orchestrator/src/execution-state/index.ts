// ============================================================
// execution-state/index.ts · v1.5.7 章一 · 执行状态机模块 barrel
// ============================================================
// 五类节点形态 schema 注册表 + 协议核心（ΔΣt 代码合并校验）+ 度量 + 审计摘要。
// 章五的 lazy-langgraph.ts 也在本目录（编排依赖守卫——与状态机同属执行地基）。
// ============================================================

export {
  type NodeKind,
  type FieldSpec,
  type NodeStateSchema,
  getSchema,
  listNodeKinds,
  initialState,
} from './schema';

export {
  type StatePatch,
  type StepOutput,
  type PatchResult,
  type AuditDigest,
  type MergeOptions,
  applyPatch,
  step,
  resolveExecutionMode,
  shouldAutoDegrade,
} from './protocol';

export {
  type StatefulMetricRecord,
  type MetricsSink,
  fileSink,
  estimateTokens,
} from './metrics';

export {
  type AuditLine,
  digestToAuditLine,
  setAuditSink,
  emitAuditDigest,
} from './audit-digest';

export {
  LANGGRAPH_MISSING_GUIDE,
  isModuleMissing,
  dynamicLangGraph,
} from './lazy-langgraph';
