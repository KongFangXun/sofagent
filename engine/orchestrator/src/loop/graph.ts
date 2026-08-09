// ============================================================
// graph/loop-graph.ts · LOOP StateGraph 组装与运行入口
// v1.3.0 新增：编排控制从 compose（一次性生成 YAML）
// 上提为 sofagent 直接掌握的 LangGraph StateGraph 节点级流转
//
// 流转图（v1.3.0 P4：新增 plan 节点 + 降级路由链）：
//   START → plan(AI) → engineer(AI) → audit(CLI) → reviewer(AI) → human_confirm(HITL) → END
//                                      ↓ FAIL
//                        降级链：第1次 retry engineer → 第2次 降级范围(L1) →
//                                第3次 低可信(L2) 继续 reviewer → 超限 人工确认
//
// Checkpoint：每个节点执行前后自动 snapshot 到 .sofagent/checkpoint/
// （FileCheckpointer，与 daemon 共享路径）。中断后 resumeLoopGraph()
// 从 latest checkpoint 恢复续跑。
//
// v1.1.3 范围注（daemon 集成顺延）：daemon 侧的"重启后自动加载
// checkpoint 续跑 + HITL 事件推送 y/n 回传"需要新增跨进程事件通道，
// 经评估超出 v1.1.3 daemon 最小改动边界，顺延 v1.1.4。本版本以
// 单进程/常驻方式（CLI `loop` 前台命令 + `loop --resume`）验证
// checkpoint + HITL 状态机闭环。
// ============================================================

import { StateGraph, START, END } from '@langchain/langgraph';
import { join } from 'path';
import { loadEnvConfig } from '@sofagent/core';
import {
  LoopStateAnnotation,
  emptyArtifacts,
  type LoopGraphState,
  type LoopNodeName,
  type SessionGoalState,
} from './state';
import { FileCheckpointer, type CheckpointRecord } from '../graph/checkpoint';
import { readHITLResponse, type HITLDecision } from '../hitl';
import {
  defaultDeps,
  makeEngineerNode,
  makeAuditNode,
  makeReviewerNode,
  makeHumanConfirmNode,
  makeGoalEvalNode,
  DEFAULT_MAX_RETRIES,
  type LoopGraphDeps,
} from './nodes';
import { makePlanNode, defaultRunPlannerDecide, writeGraphState } from './plan-node';
import {
  makeFormatCheckerNode,
  makeFactCheckerNode,
  makeSourceValidatorNode,
  makeCheckerNode,
  resolveLoopMode,
  recordCheckerFailures,
  type CheckerResult,
  type ControlledLoopMode,
} from './checker-nodes';

/**
 * v1.2.9 运行时守卫——从 CheckpointRecord.state（Record<string, unknown>）安全恢复为 LoopGraphState。
 *
 * 此前 14 处 `as unknown as` 双重断言使 checkpoint 恢复全链路零类型保护。
 * 现统一通过此函数恢复：做基础结构校验后断言，而非裸断言。
 * 未来演进为 zod schema 校验时只需改这一处。
 */
function restoreState(record: CheckpointRecord): LoopGraphState {
  const s = record.state as Record<string, unknown>;
  // 基础结构守卫：关键字段存在性检查
  if (!s || typeof s !== 'object') {
    throw new Error('checkpoint state 不是有效对象');
  }
  // artifacts 是必需字段（emptyArtifacts 初始化）
  if (!('artifacts' in s) || !s.artifacts || typeof s.artifacts !== 'object') {
    (s as Record<string, unknown>)['artifacts'] = emptyArtifacts('restored');
  }
  return s as unknown as LoopGraphState;
}

/**
 * v1.2.9 中心化 checkpoint 写入——替代 6 处裸 `as unknown as CheckpointState` 断言。
 * LoopGraphState → CheckpointState 的结构映射在此一处完成。
 */
function saveCheckpoint(
  checkpointer: FileCheckpointer,
  state: LoopGraphState,
  node: string,
  phase: 'before' | 'after',
): void {
  checkpointer.save(state as unknown as import('../graph/checkpoint').CheckpointState, node, phase);
}

/** 图执行步数上限：4 节点 × (1 + 3 重试) 轮 = 16 步，留足余量 */
const RECURSION_LIMIT = 64;

/** LOOP StateGraph 运行结果 */
export interface LoopGraphResult {
  /** 终态：completed / blocked / aborted */
  finalStatus: LoopGraphState['finalStatus'];
  /** 完整最终状态 */
  state: LoopGraphState;
  /** checkpoint 标识（可用于追溯 .sofagent/checkpoint/ 下的快照） */
  checkpointId: string;
  /** 实际发生的重试次数 */
  retryCount: number;
}

/** 运行选项 */
export interface LoopGraphOptions {
  /** 静默模式（不输出日志） */
  silent?: boolean;
  /** checkpoint 目录（默认 {SOFAGENT_DATA}/checkpoint，与 daemon 共享） */
  checkpointDir?: string;
  /** 数据目录（v1.2.2 P3b）——HITL pending/resolved 根路径，默认 {SOFAGENT_DATA} */
  dataDir?: string;
  /** 依赖注入覆盖（测试用） */
  deps?: Partial<LoopGraphDeps>;
}

/**
 * 解析 checkpoint 目录：默认 {SOFAGENT_DATA}/checkpoint
 */
export function resolveCheckpointDir(override?: string): string {
  if (override) return override;
  return join(loadEnvConfig().dataDir, 'checkpoint');
}

/**
 * audit 之后的条件路由（v1.2.2 P4 降级路由链·五分支）：
 *
 *   1. finalStatus='blocked'        → END（重试超限收尾）
 *   2. FAIL & retryCount>=maxRetries & degradationLevel>=2
 *                                   → 'human_confirm'（超限人工确认）
 *   3. FAIL & degradationLevel>=2   → 'reviewer'（L2 低可信：不 blocked，继续流转）
 *   4. FAIL（其余，含 degradationLevel 0→1→2 推进）→ 'engineer'
 *   5. PASS / WARN                  → 'checker'（v1.2.4 P2b：先过 checker 再进 reviewer）
 *
 * 注：degradationLevel 的推进（0→1→2）与提示词注入在 audit 节点内完成；
 * 本函数只做纯路由判定（degradationLevel>=2 只在降级链开启时由节点写入），
 * 保证 resume 路径可复用同一规则。
 */
export function routeAfterAudit(
  state: LoopGraphState
): 'engineer' | 'checker' | 'reviewer' | 'human_confirm' | typeof END {
  if (state.finalStatus === 'blocked') return END;
  if (state.auditResult === 'FAIL') {
    // 超限人工确认：重试与降级通道都已耗尽
    if (state.retryCount >= DEFAULT_MAX_RETRIES && state.degradationLevel >= 2) {
      return 'human_confirm';
    }
    // L2 低可信：标记后继续流转 checker→reviewer，不再回 engineer 烧重试
    if (state.degradationLevel >= 2) {
      return 'checker';
    }
    return 'engineer';
  }
  // PASS / WARN → checker（v1.2.4 P2b：先过 checker 质量门再进 reviewer）
  return 'checker';
}

/**
 * human_confirm 之后的条件路由（异步/同步两条路径共享同一个函数）：
 * completed/blocked/aborted/awaiting_human → END（挂起或收尾，都不推进）；
 * 驳回（finalStatus 仍为 running）→ engineer
 *
 * v1.2.2 P3b 注：awaiting_human 走 END 分支——图 invoke 自然返回，
 * 不路由到任何节点，等待外部信号触发 resumeLoopGraph() 续跑。
 */
/**
 * human_confirm 之后的条件路由（异步/同步两条路径共享同一个函数）：
 * completed/blocked/aborted/awaiting_human → END（挂起或收尾，都不推进）；
 * 驳回（finalStatus 仍为 running）→ goal_eval（v1.2.7: 先评估 goal 再决定是否继续）
 *
 * v1.2.7: 新增 goal_eval 节点——驳回后先过 goal 评估：
 *   - goal PASS → completed（goal-met）
 *   - goal CONTINUE + 未超限 → engineer（继续下一轮）
 *   - goal 未设置 → engineer（fallback 启发式）
 *
 * v1.2.2 P3b 注：awaiting_human 走 END 分支——图 invoke 自然返回，
 * 不路由到任何节点，等待外部信号触发 resumeLoopGraph() 续跑。
 */
export function routeAfterHuman(state: LoopGraphState): 'engineer' | 'goal_eval' | typeof END {
  if (state.finalStatus !== 'running') return END;
  return 'goal_eval';
}

/**
 * START 的条件路由：正常启动进 plan（v1.2.2 P4）；resume 时进 resumeFrom 指定节点
 */
function routeFromStart(state: LoopGraphState): LoopNodeName {
  return state.resumeFrom ?? 'plan';
}

/**
 * v1.2.7: goal_eval 之后的条件路由：
 *   completed/blocked → END（goal 已满足/无法满足）
 *   running + goal CONTINUE → engineer（继续下一轮）
 *   running + goal 未设置 → engineer（fallback 启发式）
 */
function routeAfterGoalEval(state: LoopGraphState): 'engineer' | typeof END {
  if (state.finalStatus !== 'running') return END;
  return 'engineer';
}

/**
 * 节点包装：执行前后各 snapshot 一次 checkpoint（交付二核心）。
 * phase='before' 记录进入节点时的状态，phase='after' 记录节点产出
 * 合并后的状态——恢复时 before 重跑本节点、after 跳到下一节点。
 */
function withCheckpoint<S extends LoopGraphState>(
  node: LoopNodeName,
  checkpointer: FileCheckpointer,
  fn: (state: S) => Promise<Partial<LoopGraphState>>
) {
  return async (state: S) => {
    saveCheckpoint(checkpointer, state, node, 'before');
    const update = await fn(state);
    const merged: LoopGraphState = {
      ...state,
      ...update,
      artifacts: { ...state.artifacts, ...(update.artifacts ?? {}) },
    } as LoopGraphState;
    saveCheckpoint(checkpointer, merged, node, 'after');
    return update;
  };
}

/**
 * 组装 LOOP StateGraph（编译后的可执行图）
 * v1.2.2 P4：新增 plan 节点（START → plan → engineer）+ audit 降级链五分支
 * v1.2.4 P2b：新增 checker 节点（audit PASS/WARN → checker → reviewer）
 */
export function buildLoopGraph(deps: LoopGraphDeps) {
  const graph = new StateGraph(LoopStateAnnotation)
    .addNode('plan', withCheckpoint('plan', deps.checkpointer, makePlanNode({
      runPlannerDecide: deps.runPlannerDecide ?? defaultRunPlannerDecide,
      log: deps.log,
      dataDir: deps.dataDir,
      // v1.2.3 AD-2：Dashboard 数据目录注点透传（$SOFAGENT_HOME/data）
      dashboardDir: deps.dashboardDir,
    })))
    .addNode('engineer', withCheckpoint('engineer', deps.checkpointer, makeEngineerNode(deps)))
    .addNode('audit', withCheckpoint('audit', deps.checkpointer, makeAuditNode(deps)))
    .addNode('reviewer', withCheckpoint('reviewer', deps.checkpointer, makeReviewerNode(deps)))
    .addNode('human_confirm', withCheckpoint('human_confirm', deps.checkpointer, makeHumanConfirmNode(deps)))
    // v1.2.4 P2b：checker 节点（format/fact/source 三合一）
    .addNode('checker', withCheckpoint('checker', deps.checkpointer, makeCheckerNode(deps)))
    // v1.2.7: goal_eval 节点（每轮后评估 SessionGoal 是否满足）
    .addNode('goal_eval', withCheckpoint('goal_eval' as LoopNodeName, deps.checkpointer, makeGoalEvalNode(deps)))
    .addConditionalEdges(START, routeFromStart, {
      plan: 'plan',
      engineer: 'engineer',
      audit: 'audit',
      checker: 'checker',
      reviewer: 'reviewer',
      human_confirm: 'human_confirm',
    })
    .addEdge('plan', 'engineer')
    .addEdge('engineer', 'audit')
    .addConditionalEdges('audit', routeAfterAudit, {
      engineer: 'engineer',
      checker: 'checker',
      reviewer: 'reviewer',
      human_confirm: 'human_confirm',
      [END]: END,
    })
    // checker → reviewer（checker 通过后进 reviewer）
    .addEdge('checker', 'reviewer')
    .addEdge('reviewer', 'human_confirm')
    .addConditionalEdges('human_confirm', routeAfterHuman, {
      goal_eval: 'goal_eval',
      [END]: END,
    })
    // v1.2.7: goal_eval → engineer（继续）或 END（停止）
    .addConditionalEdges('goal_eval', routeAfterGoalEval, {
      engineer: 'engineer',
      [END]: END,
    });

  return graph.compile();
}

/** 合并默认依赖与注入覆盖 */
function buildDeps(options: LoopGraphOptions): LoopGraphDeps {
  const checkpointer =
    options.deps?.checkpointer ?? new FileCheckpointer(resolveCheckpointDir(options.checkpointDir));
  const merged: LoopGraphDeps = {
    ...defaultDeps(checkpointer, options.silent ?? false),
    ...options.deps,
    checkpointer,
  };

  // v1.2.7: Agent Mailbox 注入器初始化（dataDir 存在时自动启用）
  if (!merged.mailboxInjector && merged.dataDir) {
    try {
      const { createMailbox } = require('../mailbox');
      const { injector } = createMailbox(merged.dataDir);
      merged.mailboxInjector = injector;
    } catch {
      // mailbox 模块不可用时静默跳过（降级到无邮箱模式）
    }
  }
  // v1.2.2 P3b：CLI --data-dir 显式覆盖优先于 env 解析（defaultDeps 注入的值）
  if (options.dataDir) merged.dataDir = options.dataDir;
  // v1.2.2 P4：runLoopGraph 默认开启降级链（测试可显式传 false 关闭）
  merged.degradationChainEnabled = options.deps?.degradationChainEnabled ?? true;
  return merged;
}

/** 把图输出收敛为 LoopGraphResult */
function toResult(finalState: LoopGraphState): LoopGraphResult {
  return {
    finalStatus: finalState.finalStatus === 'running' ? 'completed' : finalState.finalStatus,
    state: finalState,
    checkpointId: finalState.checkpointId,
    retryCount: finalState.retryCount,
  };
}

/**
 * 运行 LOOP StateGraph（v1.1.3 主入口）
 *
 * engineer → audit → reviewer → human_confirm 自动流转：
 * 每个节点执行完自动触发下一个，不依赖 compose、
 * 不依赖人手动调 CLI。
 *
 * @param task 任务描述
 * @param options 运行选项（silent / checkpointDir / deps 注入）
 */
export async function runLoopGraph(
  task: string,
  options: LoopGraphOptions = {}
): Promise<LoopGraphResult> {
  const deps = buildDeps(options);
  const app = buildLoopGraph(deps);

  const checkpointId = FileCheckpointer.newCheckpointId();
  deps.log(`🔁 LOOP StateGraph 启动 · checkpointId=${checkpointId}`);
  deps.log(`📋 任务: ${task}`);

  const initial: LoopGraphState = {
    currentNode: 'start',
    auditResult: null,
    retryCount: 0,
    checkpointId,
    artifacts: emptyArtifacts(task),
    finalStatus: 'running',
    resumeFrom: null,
    degradationLevel: 0,
    goal: null,
  };

  const finalState = (await app.invoke(initial, {
    recursionLimit: RECURSION_LIMIT,
  })) as LoopGraphState;

  deps.log(`🏁 LOOP 结束 · 终态: ${finalState.finalStatus}`);
  return toResult(finalState);
}

/**
 * 根据 checkpoint 计算恢复入口节点。
 *
 * - phase='before'：节点未执行完 → 从该节点重跑
 * - phase='after'：节点已执行完 → 按与图一致的路由规则算下一节点；
 *   路由到 END 说明流程已收尾 → 返回 null（无需恢复）
 */
export function resolveResumeNode(record: CheckpointRecord): LoopNodeName | null {
  const node = record.node as LoopNodeName;
  if (record.phase === 'before') return node;

  switch (node) {
    case 'plan':
      return 'engineer';
    case 'engineer':
      return 'audit';
    case 'audit': {
      const next = routeAfterAudit(restoreState(record));
      return next === END ? null : next;
    }
    case 'checker':
      return 'reviewer';
    case 'reviewer':
      return 'human_confirm';
    case 'human_confirm': {
      const next = routeAfterHuman(restoreState(record));
      return next === END ? null : next;
    }
    case 'goal_eval': {
      const next = routeAfterGoalEval(restoreState(record));
      return next === END ? null : next;
    }
    default:
      return null;
  }
}

/**
 * v1.2.2 P3b：awaiting_human + 已有外部响应时的恢复路径。
 *
 * 与 CLI 同步模式 makeHumanConfirmNode 的决策分支严格一一对应：
 *   approve → completed 终态（humanFeedback='approved'）
 *   aborted → aborted 终态（humanFeedback='aborted'）
 *   reject  → 上限内 retryCount+1 回 engineer（humanFeedback='rejected'）；
 *             超限 blocked + recordBlocked
 *
 * 两条路径共享同一个 routeAfterHuman 路由函数——此处只负责把 decision
 * 翻译成状态增量，路由判定（END / engineer）仍由 routeAfterHuman 承担。
 */
async function resumeAfterHumanDecision(
  record: CheckpointRecord,
  decision: HITLDecision,
  comment: string | undefined,
  deps: LoopGraphDeps,
): Promise<LoopGraphResult> {
  const state = restoreState(record);
  const feedback = comment ? `${decision}: ${comment}` : decision;

  // approve → 直接 completed 终态，不重进图
  if (decision === 'approve') {
    deps.log(`✅ 人工确认通过（checkpointId=${record.checkpointId}）`);
    const approved: LoopGraphState = {
      ...state,
      currentNode: 'human_confirm',
      finalStatus: 'completed',
      artifacts: { ...state.artifacts, humanFeedback: feedback === 'approve' ? 'approved' : feedback },
      resumeFrom: null,
    };
    saveCheckpoint(deps.checkpointer, approved, 'human_confirm', 'after');
    return toResult(approved);
  }

  // aborted → aborted 终态，checkpoint 保留可再次续跑
  if (decision === 'aborted') {
    deps.log(`⏸️ 人工中断（checkpointId=${record.checkpointId}）——checkpoint 已保存，可再次 resume`);
    const aborted: LoopGraphState = {
      ...state,
      currentNode: 'human_confirm',
      finalStatus: 'aborted',
      artifacts: { ...state.artifacts, humanFeedback: feedback === 'aborted' ? 'aborted' : feedback },
      resumeFrom: null,
    };
    saveCheckpoint(deps.checkpointer, aborted, 'human_confirm', 'after');
    return toResult(aborted);
  }

  // reject → 与 CLI 同步模式一致：上限内回 engineer，超限 blocked
  if (state.retryCount >= deps.maxRetries) {
    deps.log(`⛔ 人工驳回且重试已达上限（${deps.maxRetries}）→ blocked`);
    const blocked: LoopGraphState = {
      ...state,
      currentNode: 'human_confirm',
      finalStatus: 'blocked',
      artifacts: { ...state.artifacts, humanFeedback: 'rejected' },
      resumeFrom: null,
    };
    await deps.recordBlocked(blocked);
    saveCheckpoint(deps.checkpointer, blocked, 'human_confirm', 'after');
    return toResult(blocked);
  }

  // reject 且未超限 → retryCount+1 回 engineer 重进图
  deps.log(`🔄 人工驳回 · 回 engineer 修复（${state.retryCount + 1}/${deps.maxRetries}）`);
  const resumedInitial: LoopGraphState = {
    ...state,
    currentNode: 'human_confirm',
    retryCount: state.retryCount + 1,
    artifacts: {
      ...state.artifacts,
      humanFeedback: feedback === 'reject' ? 'rejected' : feedback,
    },
    finalStatus: 'running',
    resumeFrom: 'engineer',
  };
  saveCheckpoint(deps.checkpointer, resumedInitial, 'human_confirm', 'after');

  const app = buildLoopGraph(deps);
  const finalState = (await app.invoke(resumedInitial, {
    recursionLimit: RECURSION_LIMIT,
  })) as LoopGraphState;
  deps.log(`🏁 LOOP 恢复运行结束 · 终态: ${finalState.finalStatus}`);
  return toResult(finalState);
}

/**
 * 从最近一次 checkpoint 恢复续跑（交付二：中断恢复）。
 *
 * daemon 重启后的自动续跑同样复用本函数（v1.1.4 接入）——
 * 当前通过 CLI `loop --resume` 手动触发验证。
 *
 * @returns 恢复运行的结果；无可恢复 checkpoint 时返回 null
 */
export async function resumeLoopGraph(
  options: LoopGraphOptions = {}
): Promise<LoopGraphResult | null> {
  const deps = buildDeps(options);
  const record = deps.checkpointer.loadLatest();
  if (!record) {
    deps.log('ℹ️ 未找到可恢复的 checkpoint');
    return null;
  }

  if (record.state.finalStatus !== 'running' && record.state.finalStatus !== 'awaiting_human') {
    deps.log(`ℹ️ 最近 checkpoint 已是终态（${record.state.finalStatus}），无需恢复`);
    return toResult(restoreState(record));
  }

  // v1.2.2 P3b：awaiting_human 挂起态——先检查 resolved/ 是否已有外部信号
  if (record.state.finalStatus === 'awaiting_human') {
    const dataDir = deps.dataDir;
    const response = dataDir ? readHITLResponse(dataDir, record.checkpointId) : null;
    if (!response) {
      deps.log(
        `⏸️ HITL 仍在等待人工信号（checkpointId=${record.checkpointId}）——\n` +
          `   Dashboard POST / daemon 轮询 / CLI: sofagent-orchestrator loop --resolve ${record.checkpointId} --decision approve|reject`
      );
      return toResult(restoreState(record));
    }
    // 有响应：按 decision 映射终态/重试，复用 routeAfterHuman 单一路由判定
    return resumeAfterHumanDecision(record, response.decision, response.comment, deps);
  }

  const entry = resolveResumeNode(record);
  if (!entry) {
    deps.log('ℹ️ 最近 checkpoint 已到达流程末尾，无需恢复');
    return toResult(restoreState(record));
  }

  deps.log(
    `♻️ 从 checkpoint 恢复 · checkpointId=${record.checkpointId} · 入口节点=${entry}（${record.phase}@${record.node}）`
  );

  const app = buildLoopGraph(deps);
  const resumedInitial: LoopGraphState = { ...restoreState(record), resumeFrom: entry };
  const finalState = (await app.invoke(resumedInitial, {
    recursionLimit: RECURSION_LIMIT,
  })) as LoopGraphState;

  deps.log(`🏁 LOOP 恢复运行结束 · 终态: ${finalState.finalStatus}`);
  return toResult(finalState);
}
