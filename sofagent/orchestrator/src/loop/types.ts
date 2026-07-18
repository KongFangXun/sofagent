// ============================================================
// LOOP/types.ts · Workflow 类型定义
// v1.1.4：消费外部编排平台（WorkBuddy 等）产出的任务列表
// ============================================================

import type { LoopFinalStatus } from '../graph/state';

/** workflow.yml 中的单个子任务 */
export interface WorkflowNode {
  id: string;
  task: string;
  agent?: string;
  depends_on?: string[];
  acceptance_criteria?: string;
}

/** workflow.yml 的完整结构 */
export interface Workflow {
  name: string;
  description?: string;
  nodes: WorkflowNode[];
}

/** workflow 执行策略 */
export type WorkflowStrategy = 'sequential' | 'parallel-safe';

/** workflow 运行选项 */
export interface WorkflowOptions {
  /** 沉默模式 */
  silent?: boolean;
  /** 执行策略（默认 sequential） */
  strategy?: WorkflowStrategy;
  /** 遇到 blocked 是否立即终止（默认 true） */
  stopOnBlocked?: boolean;
  /** 单子任务重试上限（覆盖 DEFAULT_MAX_RETRIES） */
  maxRetriesPerNode?: number;
  /** checkpoint 目录（透传给 runLoopGraph） */
  checkpointDir?: string;
  /** 依赖注入（透传给 runLoopGraph，测试用） */
  deps?: Record<string, unknown>;
}

/** workflow 执行结果摘要 */
export interface WorkflowResult {
  workflowName: string;
  strategy: WorkflowOptions['strategy'];
  nodesTotal: number;
  nodesCompleted: number;
  nodesBlocked: number;
  finalStatus: LoopFinalStatus;
  nodeResults: Array<{
    nodeId: string;
    task: string;
    status: LoopFinalStatus;
    retryCount: number;
    checkpointId: string;
  }>;
}
