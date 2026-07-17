// ============================================================
// graph/state.ts · LOOP StateGraph 状态定义
// v1.1.3 新增：LangGraph StateGraph 的状态 schema
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

/** StateGraph 节点名 */
export type LoopNodeName = 'engineer' | 'audit' | 'reviewer' | 'human_confirm';

/** LOOP 终态：running=流转中 / completed=人工确认通过 / blocked=重试超限 / aborted=人工中断 */
export type LoopFinalStatus = 'running' | 'completed' | 'blocked' | 'aborted';

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
});
