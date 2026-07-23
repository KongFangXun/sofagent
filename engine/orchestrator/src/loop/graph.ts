// ============================================================
// graph/loop-graph.ts · LOOP StateGraph 组装与运行入口
// v1.1.9 新增：编排控制从 DeepAgents compose（一次性生成 YAML）
// 上提为 sofagent 直接掌握的 LangGraph StateGraph 节点级流转
//
// 流转图：
//   START → engineer(AI) → audit(CLI) → reviewer(AI) → human_confirm(HITL) → END
//                         ↓ FAIL（retryCount < 3）
//                        engineer(AI)
//   audit FAIL / HITL 驳回 且 retryCount 已达上限 → blocked 终态 → END
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
} from './state';
import { FileCheckpointer, type CheckpointRecord } from '../graph/checkpoint';
import {
  defaultDeps,
  makeEngineerNode,
  makeAuditNode,
  makeReviewerNode,
  makeHumanConfirmNode,
  type LoopGraphDeps,
} from './nodes';

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
 * audit 之后的条件路由：
 * blocked → END；FAIL（上限内，retryCount 已在节点内递增）→ engineer；PASS/WARN → reviewer
 */
export function routeAfterAudit(state: LoopGraphState): 'engineer' | 'reviewer' | typeof END {
  if (state.finalStatus === 'blocked') return END;
  if (state.auditResult === 'FAIL') return 'engineer';
  return 'reviewer';
}

/**
 * human_confirm 之后的条件路由：
 * completed/blocked/aborted → END；驳回（running）→ engineer
 */
export function routeAfterHuman(state: LoopGraphState): 'engineer' | typeof END {
  if (state.finalStatus !== 'running') return END;
  return 'engineer';
}

/**
 * START 的条件路由：正常启动进 engineer；resume 时进 resumeFrom 指定节点
 */
function routeFromStart(state: LoopGraphState): LoopNodeName {
  return state.resumeFrom ?? 'engineer';
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
    checkpointer.save(state as any as unknown as import('../graph/checkpoint').CheckpointState, node, 'before');
    const update = await fn(state);
    const merged: LoopGraphState = {
      ...state,
      ...update,
      artifacts: { ...state.artifacts, ...(update.artifacts ?? {}) },
    } as LoopGraphState;
    checkpointer.save(merged as any as unknown as import('../graph/checkpoint').CheckpointState, node, 'after');
    return update;
  };
}

/**
 * 组装 LOOP StateGraph（编译后的可执行图）
 */
export function buildLoopGraph(deps: LoopGraphDeps) {
  const graph = new StateGraph(LoopStateAnnotation)
    .addNode('engineer', withCheckpoint('engineer', deps.checkpointer, makeEngineerNode(deps)))
    .addNode('audit', withCheckpoint('audit', deps.checkpointer, makeAuditNode(deps)))
    .addNode('reviewer', withCheckpoint('reviewer', deps.checkpointer, makeReviewerNode(deps)))
    .addNode('human_confirm', withCheckpoint('human_confirm', deps.checkpointer, makeHumanConfirmNode(deps)))
    .addConditionalEdges(START, routeFromStart, {
      engineer: 'engineer',
      audit: 'audit',
      reviewer: 'reviewer',
      human_confirm: 'human_confirm',
    })
    .addEdge('engineer', 'audit')
    .addConditionalEdges('audit', routeAfterAudit, {
      engineer: 'engineer',
      reviewer: 'reviewer',
      [END]: END,
    })
    .addEdge('reviewer', 'human_confirm')
    .addConditionalEdges('human_confirm', routeAfterHuman, {
      engineer: 'engineer',
      [END]: END,
    });

  return graph.compile();
}

/** 合并默认依赖与注入覆盖 */
function buildDeps(options: LoopGraphOptions): LoopGraphDeps {
  const checkpointer =
    options.deps?.checkpointer ?? new FileCheckpointer(resolveCheckpointDir(options.checkpointDir));
  return { ...defaultDeps(checkpointer, options.silent ?? false), ...options.deps, checkpointer };
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
 * 每个节点执行完自动触发下一个，不依赖 DeepAgents compose、
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
    case 'engineer':
      return 'audit';
    case 'audit': {
      const next = routeAfterAudit(record.state as any);
      return next === END ? null : next;
    }
    case 'reviewer':
      return 'human_confirm';
    case 'human_confirm': {
      const next = routeAfterHuman(record.state as any);
      return next === END ? null : next;
    }
    default:
      return null;
  }
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

  if (record.state.finalStatus !== 'running') {
    deps.log(`ℹ️ 最近 checkpoint 已是终态（${record.state.finalStatus}），无需恢复`);
    return toResult(record.state as any);
  }

  const entry = resolveResumeNode(record);
  if (!entry) {
    deps.log('ℹ️ 最近 checkpoint 已到达流程末尾，无需恢复');
    return toResult(record.state as any);
  }

  deps.log(
    `♻️ 从 checkpoint 恢复 · checkpointId=${record.checkpointId} · 入口节点=${entry}（${record.phase}@${record.node}）`
  );

  const app = buildLoopGraph(deps);
  const resumedInitial: LoopGraphState = { ...record.state as any, resumeFrom: entry };
  const finalState = (await app.invoke(resumedInitial, {
    recursionLimit: RECURSION_LIMIT,
  })) as LoopGraphState;

  deps.log(`🏁 LOOP 恢复运行结束 · 终态: ${finalState.finalStatus}`);
  return toResult(finalState);
}
