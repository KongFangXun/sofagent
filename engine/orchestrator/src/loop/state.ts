// ============================================================
// graph/state.ts · LOOP StateGraph 状态定义
// v1.3.5 新增：LangGraph StateGraph 的状态 schema
//
// 说明：
// - LoopGraphState 是对外契约（TypeScript interface）
// - LoopStateAnnotation 是 LangGraph 运行时的状态通道定义，
//   字段与 LoopGraphState 一一对应
// - artifacts 是跨节点传递的工作上下文——节点间数据只通过
//   此字段流转，不依赖外部全局变量
// ============================================================

import { Annotation } from '@langchain/langgraph';

/** 审计判定结果 */
export type AuditVerdict = 'PASS' | 'FAIL' | 'WARN';

/**
 * v1.2.7: Session Goal 状态——循环收敛从"启发式"升级为"目标驱动"。
 * 未配置 goal（condition=null）时 fallback 到现有"连续 2 轮无 P0/P1"逻辑。
 */
export interface SessionGoalState {
  /** 自然语言完成条件（null = 未设置 goal，fallback 启发式） */
  condition: string | null;
  /** 安全上限：最多续接次数（默认 10） */
  maxContinuations: number;
  /** 当前已续接次数 */
  currentContinuations: number;
  /** 最近一次评估结果 */
  lastEvalResult: 'PASS' | 'CONTINUE' | 'FAIL' | null;
}

/**
 * StateGraph 节点名
 * v1.2.2 P4：新增 'plan'（Planner 节点，START → plan → engineer）
 * v1.2.4 P2b：新增 'checker'（多类型 Checker 节点，audit → checker → reviewer）
 * v1.3.1 交付 3：新增 'parallel_wave'（并行波次节点——并行模式可选路径，
 *   默认串行不经过；plan 条件路由 parallel_wave / engineer）
 */
export type LoopNodeName =
  | 'plan'
  | 'engineer'
  | 'audit'
  | 'checker'
  | 'reviewer'
  | 'human_confirm'
  | 'goal_eval'
  | 'parallel_wave';

/**
 * Planner 产出的子任务（v1.2.2 P4）
 * engineer 节点逐条执行 pending 子任务
 */
export interface Subtask {
  /** 子任务标识（如 subtask-1） */
  id: string;
  /** 子任务描述 */
  description: string;
  /** 执行状态 */
  status: 'pending' | 'done' | 'skipped';
}

/**
 * LOOP 终态：running=流转中 / completed=人工确认通过 / blocked=重试超限 /
 * aborted=人工中断 / awaiting_human=图已挂起等待外部人工信号（v1.2.2 P3b）
 *
 * awaiting_human 语义：human_confirm 节点已写 checkpoint + HITL 请求文件，
 * invoke 返回但不阻塞——外部信号（Dashboard POST / CLI --resolve / daemon
 * 轮询）写入 resolved 响应后，由 resumeLoopGraph() 恢复续跑。
 */
export type LoopFinalStatus = 'running' | 'completed' | 'blocked' | 'aborted' | 'awaiting_human';

/**
 * 跨节点传递的工作上下文（节点 I/O 汇集处）
 *
 * engineer 产出 → engineerOutput（audit/reviewer 的输入）
 * audit 产出 → auditReport（reviewer/engineer 修复的输入）
 * reviewer 产出 → reviewReport（human_confirm 展示 + engineer 修复的输入）
 */
export interface LoopArtifacts {
  /** 原始任务描述 */
  task: string;
  /** 最近一轮 engineer 产出（diff/代码摘要） */
  engineerOutput: string;
  /** 每轮 engineer 产出（含历史轮次） */
  engineerOutputs: string[];
  /** 最近一次 audit 报告 */
  auditReport: string;
  /** 每轮 audit 报告 */
  auditReports: string[];
  /** 最近一次 reviewer 意见 */
  reviewReport: string;
  /** 每轮 reviewer 意见 */
  reviewReports: string[];
  /** HITL 确认反馈：approved / rejected / aborted */
  humanFeedback: string;
  /**
   * Planner 分解的子任务列表（v1.2.2 P4）
   * plan 节点写入，engineer 节点逐条消费（pending → done/skipped）
   */
  subtasks: Subtask[];
}

/**
 * LOOP StateGraph 状态（对外契约）
 */
export interface LoopGraphState {
  /** 当前节点 */
  currentNode: LoopNodeName | 'start' | 'end';
  /** 最近一次审计结果 */
  auditResult: AuditVerdict | null;
  /** 重试次数（audit FAIL 或 HITL 驳回后回 engineer 均递增，上限默认 3） */
  retryCount: number;
  /** checkpoint 标识（一次 LOOP 运行对应一个 checkpointId） */
  checkpointId: string;
  /** 跨节点传递的工作上下文 */
  artifacts: LoopArtifacts;
  /** 终态标记 */
  finalStatus: LoopFinalStatus;
  /** 恢复入口节点（从 checkpoint 续跑时由 resume 逻辑写入，正常启动为 null） */
  resumeFrom: LoopNodeName | null;
  /**
   * 降级等级（v1.2.2 P4 降级路由链）
   * 0=正常 / 1=已降级任务范围（最小可行版本）/ 2=低可信（继续流转但标注）
   * audit FAIL 第 2/3 次时由 routeAfterAudit 分别推进到 1/2
   */
  degradationLevel: number;
  /**
   * v1.2.7: Session Goal 状态（目标驱动收敛）。
   * null = 未设置 goal，fallback 到现有启发式停止条件。
   */
  goal: SessionGoalState | null;
}

/** artifacts 初始值 */
export function emptyArtifacts(task: string): LoopArtifacts {
  return {
    task,
    engineerOutput: '',
    engineerOutputs: [],
    auditReport: '',
    auditReports: [],
    reviewReport: '',
    reviewReports: [],
    humanFeedback: '',
    // v1.2.2 P4：Planner 产出（plan 节点运行前为空数组）
    subtasks: [],
  };
}

/**
 * LangGraph 状态通道定义——与 LoopGraphState 字段一一对应。
 * artifacts 用浅合并 reducer，节点可以只返回增量字段。
 */
export const LoopStateAnnotation = Annotation.Root({
  currentNode: Annotation<LoopGraphState['currentNode']>({
    reducer: (_prev, next) => next,
    default: () => 'start' as const,
  }),
  auditResult: Annotation<AuditVerdict | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  retryCount: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  checkpointId: Annotation<string>({
    reducer: (_prev, next) => next,
    default: () => '',
  }),
  artifacts: Annotation<LoopArtifacts, Partial<LoopArtifacts>>({
    reducer: (prev, next) => ({ ...prev, ...next }),
    default: () => emptyArtifacts(''),
  }),
  finalStatus: Annotation<LoopFinalStatus>({
    reducer: (_prev, next) => next,
    default: () => 'running' as const,
  }),
  resumeFrom: Annotation<LoopNodeName | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  // v1.2.2 P4：降级等级通道（0=正常 / 1=已降级范围 / 2=低可信）
  degradationLevel: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  // v1.2.7: Session Goal 通道（目标驱动收敛）
  goal: Annotation<SessionGoalState | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
});
