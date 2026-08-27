// ============================================================
// worklog/index.ts · barrel export
// v1.4.1（三）：AI 工作明细数据层——三源聚合 + worklog.json 落盘
// ============================================================

export { WorklogAggregator, isoWeekKey } from './aggregator';
export type {
  WorklogOptions,
  AgentWorklog,
  TaskWorklogEntry,
  WorkflowWorklog,
  WeekTrend,
  EvolutionTrends,
} from './aggregator';
