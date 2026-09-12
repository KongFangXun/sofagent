// ============================================================
// loop/nodes.ts · LOOP StateGraph 节点实现
// v1.3.7 新增：engineer / audit / reviewer / human_confirm 四节点
// v1.3.7 升级：工具注入路径 + maxTurns + WARN 写入 history + 三态全记录
//
// 设计：
// - 节点通过 LoopGraphDeps 依赖注入——默认实现走 launcher.ts 的
//   Sub Agent 启动机制（engineer/reviewer）+ @sofagent/audit 程序化
//   调用（audit）+ stdin readline（human_confirm）；测试注入 mock
// - 节点间数据只通过 state.artifacts 流转，不依赖外部全局变量
// - 重试语义（统一计数）：audit FAIL 或 HITL 驳回都递增 retryCount；
//   retryCount < maxRetries(3) → 回 engineer 重试；
//   已达上限仍未过 → finalStatus='blocked' 终态 + 写入 audit history
//
// v1.4.8 深模块条目 4：本文件只保留节点工厂（状态流转）+ LLM provider 解析，
// 内聚单元已抽出——
//   共享中间件注册表 → ./middleware-registry.ts
//   默认依赖实现 → ./deps-defaults.ts
//   依赖注入契约 → ./deps-types.ts
// 既有导出名经 re-export 原样保留（loop/index.ts 与测试导入面不变）。
// 注：LLM 环境解析按 §一勘误落在 ./llm-env.ts（角色覆写层）——四级回退解析
// （resolveLLMModel）经 A2「函数调用 RHS」误报修复后已迁 ./llm-model-resolver.ts
// （条目 4 范围裁剪回收；导出面由下方 re-export 原样保留）。
// ============================================================

import { writeGraphState } from './plan-node';
import type { LoopGraphState, LoopNodeName, SessionGoalState } from './state';
import type { LoopGraphDeps } from './deps-types';
import { HITL_OPTIONS, shouldUseAsyncHITL, writeHITLRequest } from '../hitl';

// ── 内部收编后保留的对外导出（import 面不变：仅换实现文件）──
export {
  gateToolsForRole,
  getLoopRouter,
  getLoopSovereigntyMw,
  getLoopProgressMw,
  setLoopProgressMwForTest,
} from './middleware-registry';
export {
  DEFAULT_MAX_RETRIES,
  DEFAULT_ENGINEER_MAX_TURNS,
  DEFAULT_REVIEWER_MAX_TURNS,
  resolveMaxTurns,
  defaultDeps,
  parseReviewerPass,
} from './deps-defaults';
export type { AuditOutcome, HumanDecision, LoopGraphDeps } from './deps-types';
// LLM provider/model/key 解析（v1.4.8 条目 4 范围回收——A2 函数调用 RHS 豁免后解锁独立成件）
export { resolveLLMModel } from './llm-model-resolver';

/**
 * v1.2.7: Session Goal 评估函数——延迟导入避免编译时依赖。
 * 从 @sofagent/core 动态加载（运行时已编译为 dist）。
 */
async function loadGoalFunctions(): Promise<{
  loadSessionGoal: (dataDir: string) => SessionGoalState | null;
  evaluateGoal: (condition: string, currentState: string, dataDir: string) => Promise<'PASS' | 'CONTINUE' | 'FAIL'>;
  incrementContinuations: (dataDir: string) => number;
} | null> {
  try {
    const core = await import('@sofagent/core');
    return {
      loadSessionGoal: (dataDir: string): SessionGoalState | null => {
        const goal = core.loadSessionGoal(dataDir);
        if (!goal) return null;
        return {
          condition: goal.condition,
          maxContinuations: goal.maxContinuations,
          currentContinuations: goal.currentContinuations,
          lastEvalResult: null,
        };
      },
      evaluateGoal: core.evaluateGoal,
      incrementContinuations: core.incrementContinuations,
    };
  } catch {
    return null;
  }
}

/**
 * v1.2.7: 本地 fallback 实现——@sofagent/core 未编译时使用。
 * 从 data/orchestrator/goals/current.json 直接读取 goal。
 */
function loadSessionGoalLocal(dataDir: string): SessionGoalState | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { existsSync, readFileSync } = require('fs');
    const { join } = require('path');
    const goalPath = join(dataDir, 'orchestrator', 'goals', 'current.json');
    if (!existsSync(goalPath)) return null;
    const content = readFileSync(goalPath, 'utf-8').trim();
    if (!content) return null;
    return JSON.parse(content);
  } catch {
    return null;
  }
}




// ────────────────────────────────
// 节点实现（LangGraph node functions）
// ────────────────────────────────

/**
 * engineer 节点——执行任务（首轮）或按反馈修复（重试轮）。
 *
 * v1.2.2 P4：
 *   - 逐条消费 artifacts.subtasks（pending → done），当前子任务拼入任务描述
 *   - 节点执行后写 graph-state.json（活跃节点 + Work Graph 任务数）
 *   - decide/execute 分层在 defaultRunEngineer 内部顺序调用（图拓扑不变）
 */
export function makeEngineerNode(deps: LoopGraphDeps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (state: LoopGraphState): Promise<any> => {
    deps.log(`👷 engineer 执行中...（第 ${state.retryCount + 1} 轮）`);

    // P4：取当前 pending 子任务（Planner 产出），拼入任务上下文
    const subtasks = state.artifacts.subtasks ?? [];
    const currentSub = subtasks.find((s) => s.status === 'pending');
    const taskWithSub = currentSub
      ? `${state.artifacts.task}\n\n# 当前子任务（${currentSub.id}）\n${currentSub.description}`
      : state.artifacts.task;

    const feedback =
      state.retryCount > 0
        ? [state.artifacts.auditReport, state.artifacts.reviewReport].filter(Boolean).join('\n\n')
        : '';
    const output = await deps.runEngineer(taskWithSub, feedback);

    // P4：当前子任务标记 done
    const updatedSubtasks = currentSub
      ? subtasks.map((s) => (s.id === currentSub.id ? { ...s, status: 'done' as const } : s))
      : subtasks;

    // P4：Graph 状态落盘（Dashboard Graph Engine 区块数据源）
    // v1.2.3：dashboardDir 优先（AD-2 路径修复），dataDir 兜底；写入完整控制图
    const dashDir = deps.dashboardDir ?? deps.dataDir;
    if (dashDir) {
      writeGraphState(dashDir, {
        activeNode: 'engineer',
        retryCount: state.retryCount,
        degradationLevel: state.degradationLevel,
        subtasks: updatedSubtasks,
      });
    }

    deps.log('✅ engineer 完成');
    return {
      currentNode: 'engineer',
      artifacts: {
        engineerOutput: output,
        engineerOutputs: [...state.artifacts.engineerOutputs, output],
        subtasks: updatedSubtasks,
      },
    };
  };
}

/**
 * audit 节点——审计 engineer 产出。
 *
 * v1.2.2 P4 降级路由链（按 FAIL 累计次数推进，与 routeAfterAudit 五分支一一对应）：
 *   FAIL 第 1 次：degradationLevel=0，retryCount+1 → 回 engineer 重试（现有语义）
 *   FAIL 第 2 次：degradationLevel=0→1，auditReport 头部注入 [降级 L1]
 *         "先做最小可行版本"，retryCount+1 → 回 engineer
 *   FAIL 第 3 次：degradationLevel=1→2，auditReport 头部注入 [降级 L2]
 *         低可信标注，retryCount 不再烧 → routeAfterAudit 放行 reviewer（不 blocked）
 *   超限（degradationLevel=2 仍 FAIL 且 retryCount 已耗尽）：
 *         → routeAfterAudit 路由 human_confirm 人工确认
 *
 * 兼容性：degradationLevel 推进只在 degradationChainEnabled 时生效——
 * 老调用方（deps 未显式开启）保持 v1.2.1 纯 retry→blocked 语义；
 * runLoopGraph 默认开启（见 graph.ts buildDeps）。
 */
export function makeAuditNode(deps: LoopGraphDeps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (state: LoopGraphState): Promise<any> => {
    deps.log('🛡️ audit 审计中...');
    const outcome = await deps.runAudit(state.artifacts);
    deps.log(`🛡️ audit 判定: ${outcome.verdict}`);

    // v1.1.4：WARN 标注透传——不阻断流转，但标记到 reviewer 输入
    let auditReport = outcome.verdict === 'WARN'
      ? `[审计告警] ${outcome.report}`
      : outcome.report;

    // P4 降级链：FAIL 时按当前 degradationLevel 推进 0→1→2 并注入降级提示
    let degradationLevel = state.degradationLevel;
    if (outcome.verdict === 'FAIL' && deps.degradationChainEnabled) {
      if (degradationLevel === 0 && state.retryCount > 0) {
        // 第 2 次 FAIL（已 retry 过一次仍 FAIL）→ L1 降级任务范围
        degradationLevel = 1;
        auditReport = `[降级 L1] 先做最小可行版本——只实现核心路径，砍掉边缘情况与优化项。\n${auditReport}`;
        deps.log('🔻 audit FAIL · 降级 L1：缩小任务范围（最小可行版本）');
      } else if (degradationLevel === 1) {
        // 第 3 次 FAIL（L1 降级后仍 FAIL）→ L2 低可信，不再烧 retryCount
        degradationLevel = 2;
        auditReport = `[降级 L2] 低可信模式——本产出未经审计背书，请人工重点复核。\n${auditReport}`;
        deps.log('🔻 audit FAIL · 降级 L2：标记低可信，继续流转（不 blocked）');
      }
    }

    // v1.2.3：audit 完成后写 graph-state（判定结果回写 Dashboard 控制图）
    const dashDir = deps.dashboardDir ?? deps.dataDir;
    if (dashDir) {
      writeGraphState(dashDir, {
        activeNode: 'audit',
        retryCount: state.retryCount,
        degradationLevel,
        subtasks: state.artifacts.subtasks,
        auditResult: outcome.verdict,
      });
    }

    const base: Record<string, unknown> = {
      currentNode: 'audit',
      auditResult: outcome.verdict,
      degradationLevel,
      artifacts: {
        auditReport,
        auditReports: [...state.artifacts.auditReports, auditReport],
      },
    };

    if (outcome.verdict !== 'FAIL') {
      return base; // PASS/WARN → 继续流转 reviewer
    }

    // P4：L2 低可信——不再烧 retryCount，路由权交给 routeAfterAudit（→ reviewer）
    if (deps.degradationChainEnabled && degradationLevel >= 2) {
      return base;
    }

    if (state.retryCount < deps.maxRetries) {
      deps.log(`🔄 audit FAIL · 回 engineer 重试（${state.retryCount + 1}/${deps.maxRetries}）`);
      return { ...base, retryCount: state.retryCount + 1 };
    }

    // 重试已达上限仍 FAIL（且未进 L2）→ blocked 终态
    deps.log(`⛔ audit FAIL 且重试已达上限（${deps.maxRetries}）→ blocked`);
    const blockedState: LoopGraphState = { ...state, ...base, finalStatus: 'blocked' } as LoopGraphState;
    await deps.recordBlocked(blockedState);
    return { ...base, finalStatus: 'blocked' };
  };
}

/**
 * reviewer 节点——语义审查 engineer 产出
 */
export function makeReviewerNode(deps: LoopGraphDeps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (state: LoopGraphState): Promise<any> => {
    deps.log('🔍 reviewer 审查中...');
    const report = await deps.runReviewer(state.artifacts);
    deps.log('📝 reviewer 完成');
    return {
      currentNode: 'reviewer',
      artifacts: {
        reviewReport: report,
        reviewReports: [...state.artifacts.reviewReports, report],
      },
    };
  };
}

/**
 * human_confirm 节点——HITL 确认，双模式（v1.2.2 P3b）。
 *
 * 异步模式（{dataDir}/hitl/pending/ 目录存在）：
 *   1. 写 HITL 请求文件到 pending/{checkpointId}.json
 *      （checkpoint 已由 withCheckpoint 包装器在本节点前落盘 phase='before'）
 *   2. 返回 finalStatus='awaiting_human' → routeAfterHuman 路由 END，图挂起
 *   3. 外部信号写 resolved/{checkpointId}.json 后由 resumeLoopGraph() 续跑
 *
 * CLI 同步降级模式（目录不存在）：
 *   保持 readline 阻塞等待 stdin y/n——行为与 v1.2.1 完全一致。
 *   y → completed；n → 递增 retryCount 回 engineer（上限内）或 blocked；
 *   abort → aborted 终态（checkpoint 可续跑）。
 */
export function makeHumanConfirmNode(deps: LoopGraphDeps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (state: LoopGraphState): Promise<any> => {
    // ── 异步模式：存储驱动挂起，不阻塞等待 stdin ──
    const dataDir = deps.dataDir;
    if (dataDir && shouldUseAsyncHITL(dataDir)) {
      writeHITLRequest(dataDir, {
        checkpointId: state.checkpointId,
        createdAt: new Date().toISOString(),
        task: state.artifacts.task,
        reviewReport: state.artifacts.reviewReport,
        auditResult: state.auditResult ?? '',
        retryCount: state.retryCount,
        options: [...HITL_OPTIONS],
      });
      deps.log(
        `⏸️ HITL 异步挂起 · checkpointId=${state.checkpointId}\n` +
          `   等待外部信号：Dashboard POST / daemon 轮询 /\n` +
          `   CLI: sofagent-orchestrator loop --resolve ${state.checkpointId} --decision approve|reject`
      );
      return {
        currentNode: 'human_confirm',
        finalStatus: 'awaiting_human',
      };
    }

    // ── CLI 同步降级模式：readline 阻塞等待（与 v1.2.1 一致）──
    const isAuto = process.env.LOOP_AUTO === '1';
    deps.log(isAuto ? '🤖 自动审核判定中...' : '🙋 等待人工确认（不限时）...');
    const decision = await deps.confirmHuman(state.artifacts.reviewReport);

    if (decision === 'y') {
      deps.log('✅ 人工确认通过');
      return {
        currentNode: 'human_confirm',
        finalStatus: 'completed',
        artifacts: { humanFeedback: 'approved' },
      };
    }

    if (decision === 'abort') {
      deps.log('⏸️ 确认中断（stdin 关闭）——checkpoint 已保存，可 loop --resume 恢复');
      return {
        currentNode: 'human_confirm',
        finalStatus: 'aborted',
        artifacts: { humanFeedback: 'aborted' },
      };
    }

    // n = 驳回
    if (state.retryCount < deps.maxRetries) {
      deps.log(`🔄 人工驳回 · 回 engineer 修复（${state.retryCount + 1}/${deps.maxRetries}）`);
      return {
        currentNode: 'human_confirm',
        retryCount: state.retryCount + 1,
        artifacts: { humanFeedback: 'rejected' },
      };
    }

    deps.log(`⛔ 人工驳回且重试已达上限（${deps.maxRetries}）→ blocked`);
    const blockedState: LoopGraphState = {
      ...state,
      currentNode: 'human_confirm',
      finalStatus: 'blocked',
    } as LoopGraphState;
    await deps.recordBlocked(blockedState);
    return {
      currentNode: 'human_confirm',
      finalStatus: 'blocked',
      artifacts: { humanFeedback: 'rejected' },
    };
  };
}

/**
 * v1.2.7: goal 评估节点——每轮结束后评估当前状态是否满足 SessionGoal。
 *
 * 评估流程：
 *   1. 加载 SessionGoal（从 data/orchestrator/goals/current.json）
 *   2. 调轻量模型评估 condition vs 当前状态（audit + review 报告）
 *   3. PASS → finalStatus='completed'（stopReason='goal-met'）
 *   4. CONTINUE + continuations < max → 继续下一轮
 *   5. continuations >= max → finalStatus='blocked'（stopReason='goal-max-continuations'）
 *   6. FAIL → finalStatus='blocked'（stopReason='goal-failed'）
 *   7. 未设置 goal → no-op（fallback 到现有启发式）
 */
export function makeGoalEvalNode(deps: LoopGraphDeps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (state: LoopGraphState): Promise<any> => {
    const dataDir = deps.dataDir;
    if (!dataDir) {
      // 无 dataDir → 跳过 goal 评估
      return { currentNode: 'goal_eval' as LoopNodeName };
    }

    // 延迟加载 goal 函数（优先 @sofagent/core，fallback 本地实现）
    const goalFuncs = await loadGoalFunctions();
    const goal = (goalFuncs && typeof goalFuncs.loadSessionGoal === 'function')
      ? goalFuncs.loadSessionGoal(dataDir)
      : loadSessionGoalLocal(dataDir);

    if (!goal || !goal.condition) {
      // 未设置 goal → no-op（fallback 启发式）
      return { currentNode: 'goal_eval' as LoopNodeName };
    }

    const maxCont = goal.maxContinuations ?? 10;
    const curCont = goal.currentContinuations ?? 0;

    deps.log(`🎯 goal 评估中...（续接 ${curCont}/${maxCont}）`);

    // 构建当前状态摘要（audit 报告 + review 报告）
    const currentState = [
      '# 审计报告',
      state.artifacts.auditReport.slice(0, 2000),
      '# 审查报告',
      state.artifacts.reviewReport.slice(0, 2000),
    ].join('\n');

    // 调轻量模型评估
    let evalResult: 'PASS' | 'CONTINUE' | 'FAIL' = 'CONTINUE';
    if (goalFuncs && typeof goalFuncs.evaluateGoal === 'function') {
      evalResult = await goalFuncs.evaluateGoal(goal.condition, currentState, dataDir);
    }
    deps.log(`🎯 goal 评估结果: ${evalResult}`);

    if (evalResult === 'PASS') {
      deps.log('✅ goal 已满足 → goal-met');
      return {
        currentNode: 'goal_eval' as LoopNodeName,
        finalStatus: 'completed',
        goal: {
          condition: goal.condition,
          maxContinuations: maxCont,
          currentContinuations: curCont,
          lastEvalResult: 'PASS',
        },
      };
    }

    if (evalResult === 'FAIL') {
      deps.log('⛔ goal 无法满足 → goal-failed');
      return {
        currentNode: 'goal_eval' as LoopNodeName,
        finalStatus: 'blocked',
        goal: {
          condition: goal.condition,
          maxContinuations: maxCont,
          currentContinuations: curCont,
          lastEvalResult: 'FAIL',
        },
      };
    }

    // CONTINUE: 递增续接计数
    let newContinuations = curCont + 1;
    if (goalFuncs && typeof goalFuncs.incrementContinuations === 'function') {
      newContinuations = goalFuncs.incrementContinuations(dataDir);
    }
    if (newContinuations >= maxCont) {
      deps.log(`⛔ goal 续接已达上限（${maxCont}）→ goal-max-continuations`);
      return {
        currentNode: 'goal_eval' as LoopNodeName,
        finalStatus: 'blocked',
        goal: {
          condition: goal.condition,
          maxContinuations: maxCont,
          currentContinuations: newContinuations,
          lastEvalResult: 'CONTINUE',
        },
      };
    }

    // 继续下一轮
    deps.log(`🔄 goal 未满足 → 继续下一轮（${newContinuations}/${maxCont}）`);
    return {
      currentNode: 'goal_eval' as LoopNodeName,
      goal: {
        condition: goal.condition,
        maxContinuations: maxCont,
        currentContinuations: newContinuations,
        lastEvalResult: 'CONTINUE',
      },
    };
  };
}
