// ============================================================
// graph/nodes.ts · LOOP StateGraph 节点实现
// v1.1.3 新增：engineer / audit / reviewer / human_confirm 四节点
//
// 设计：
// - 节点通过 LoopGraphDeps 依赖注入——默认实现走 launcher.ts 的
//   Sub Agent 启动机制（engineer/reviewer）+ @sofagent/audit 程序化
//   调用（audit）+ stdin readline（human_confirm）；测试注入 mock
// - 节点间数据只通过 state.artifacts 流转，不依赖外部全局变量
// - 重试语义（统一计数）：audit FAIL 或 HITL 驳回都递增 retryCount；
//   retryCount < maxRetries(3) → 回 engineer 重试；
//   已达上限仍未过 → finalStatus='blocked' 终态 + 写入 audit history
// ============================================================

import { execSync } from 'child_process';
import { createInterface } from 'readline';
import { ENGINEER_AGENT, REVIEWER_AGENT } from '../builtin-agents';
import { spawnSubAgent } from '../launcher';
import type { AuditVerdict, LoopArtifacts, LoopGraphState } from './state';
import type { FileCheckpointer } from './checkpoint';

/** 重试上限：第 3 轮重试后仍未过 → blocked 终态 */
export const DEFAULT_MAX_RETRIES = 3;

/** audit 节点产出 */
export interface AuditOutcome {
  verdict: AuditVerdict;
  report: string;
}

/** HITL 确认结果：y=通过 / n=驳回 / abort=中断（stdin 关闭等） */
export type HumanDecision = 'y' | 'n' | 'abort';

/**
 * 节点依赖注入接口——默认实现见 defaultDeps()，测试可整体替换
 */
export interface LoopGraphDeps {
  /** engineer 执行：输入任务 + 上一轮反馈，输出产出摘要（diff/代码） */
  runEngineer: (task: string, feedback: string) => Promise<string>;
  /** audit 执行：输入 engineer 产出，输出 PASS/WARN/FAIL + 报告 */
  runAudit: (artifacts: LoopArtifacts) => Promise<AuditOutcome>;
  /** reviewer 执行：输入 engineer 产出 + audit 报告，输出审查报告 */
  runReviewer: (artifacts: LoopArtifacts) => Promise<string>;
  /** HITL 确认：展示审查报告，等待人工 y/n（不限时） */
  confirmHuman: (reviewReport: string) => Promise<HumanDecision>;
  /** blocked 终态回写 audit history（终态可追溯，不无限循环） */
  recordBlocked: (state: LoopGraphState) => Promise<void>;
  /** checkpoint 存储 */
  checkpointer: FileCheckpointer;
  /** 重试上限（默认 3） */
  maxRetries: number;
  /** 日志输出 */
  log: (msg: string) => void;
}

// ────────────────────────────────
// 默认依赖实现
// ────────────────────────────────

/**
 * 默认 engineer 实现——通过 launcher.ts 的 Sub Agent 机制启动
 * 最小变更工程师（agents/engineering-minimal-change-engineer.md）
 */
async function defaultRunEngineer(task: string, feedback: string): Promise<string> {
  const fullTask = [
    '# LOOP 任务',
    task,
    '',
    '# 执行纪律',
    '1. 先读再改：修改前先 Read 目标文件',
    '2. 最小变更：只触碰任务要求的内容',
    '3. 验证再继续：完成后确认 build 通过',
    ...(feedback
      ? ['', '# 上一轮反馈（audit/review 未通过原因，只修复标记的问题）', feedback.slice(0, 2000)]
      : []),
  ].join('\n');
  return spawnSubAgent(ENGINEER_AGENT, fullTask);
}

/**
 * 默认 audit 实现——程序化调用 @sofagent/audit（比 CLI 子进程侵入更小：
 * 无需假设二进制安装路径，且类型安全）。
 *
 * 流程：git diff HEAD（工作区未提交变更）→ parseDiff → runRules。
 * 审计引擎不可用（如 git 环境缺失）时降级 WARN 并在报告注明——
 * 不直接 FAIL 以免烧穿重试次数，由 reviewer + human_confirm 兜底把关。
 */
async function defaultRunAudit(artifacts: LoopArtifacts): Promise<AuditOutcome> {
  try {
    const audit = await import('@sofagent/audit');
    const rawDiff = execSync('git diff HEAD', {
      encoding: 'utf-8',
      maxBuffer: 16 * 1024 * 1024,
    });
    if (!rawDiff.trim()) {
      return {
        verdict: 'WARN',
        report: '审计提示：git diff HEAD 无变更——engineer 可能未产生文件修改，请人工复核。',
      };
    }
    const diffFiles = audit.parseDiff('HEAD');
    const result = audit.runRules(diffFiles, [], artifacts.task, false, true);
    const verdict: AuditVerdict =
      result.exitCode === 0 ? 'PASS' : result.exitCode === 1 ? 'WARN' : 'FAIL';
    const lines = result.rules
      .filter((r) => r.status !== 'SKIPPED')
      .map((r) => `- [${r.status}] #${r.number} ${r.name}${r.details.length ? `：${r.details.join('；')}` : ''}`);
    return {
      verdict,
      report: [`审计判定: ${verdict}（exitCode=${result.exitCode}）`, ...lines].join('\n'),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      verdict: 'WARN',
      report: `审计提示：审计引擎不可用（${msg}）——降级 WARN，由 reviewer 与人工确认兜底。`,
    };
  }
}

/**
 * 默认 reviewer 实现——通过 launcher.ts 的 Sub Agent 机制启动
 * 代码审查员（agents/engineering-code-reviewer.md）
 */
async function defaultRunReviewer(artifacts: LoopArtifacts): Promise<string> {
  const reviewTask = [
    '# 审查任务',
    '审查以下 Engineer 的产出：',
    '',
    '```',
    artifacts.engineerOutput.slice(0, 4000),
    '```',
    '',
    '# 审计报告（供参考）',
    artifacts.auditReport.slice(0, 2000),
    '',
    '# 审查要求',
    '1. 按 🔴🟡💭 分级标注问题',
    '2. 检查是否满足原始任务要求',
    '3. 检查是否有范围蔓延（做了任务不需要的改动）',
    '4. 输出判定：IS_PASS: YES 或 IS_PASS: NO',
  ].join('\n');
  return spawnSubAgent(REVIEWER_AGENT, reviewTask);
}

/**
 * 默认 HITL 实现——stdin readline，等待不限时（人可以明天再回来确认）。
 *
 * v1.1.3 范围注：当前为单进程/常驻方式（CLI 前台 loop 命令）。
 * daemon 推送确认提示 + y/n 回传的跨进程集成经评估超出 daemon
 * "最小改动"边界（需要新增 IPC 事件通道），顺延 v1.1.4——
 * checkpoint 已落盘，届时 daemon 可从 latest 恢复挂起的确认。
 */
function defaultConfirmHuman(reviewReport: string): Promise<HumanDecision> {
  console.log('');
  console.log('══════════ 审查报告（HITL 确认） ══════════');
  console.log(reviewReport);
  console.log('═══════════════════════════════════════════');

  return new Promise<HumanDecision>((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let settled = false;
    const settle = (decision: HumanDecision) => {
      if (settled) return;
      settled = true;
      rl.close();
      resolve(decision);
    };

    const ask = () => {
      // readline 无超时——等待不限时
      rl.question('确认通过？(y=通过 / n=驳回回 engineer 修复): ', (answer) => {
        const a = answer.trim().toLowerCase();
        if (a === 'y' || a === 'yes') return settle('y');
        if (a === 'n' || a === 'no') return settle('n');
        console.log('请输入 y 或 n');
        ask();
      });
    };
    ask();

    // stdin 关闭（EOF/非交互环境）：视为中断而非通过/驳回——
    // checkpoint 已保存，可用 loop --resume 恢复到本确认节点
    rl.on('close', () => settle('abort'));
  });
}

/**
 * 默认 blocked 回写实现——追加 audit history（engine 标记 loop-graph），
 * blocked 作为终态可被 audit-root-cause / 周报追溯。
 */
async function defaultRecordBlocked(state: LoopGraphState): Promise<void> {
  try {
    const audit = await import('@sofagent/audit');
    audit.appendHistory({
      timestamp: new Date().toISOString(),
      diffRange: 'loop-graph',
      task: `[LOOP blocked] ${state.artifacts.task}`.slice(0, 500),
      exitCode: 2,
      ruleResults: [],
      diffFileCount: 0,
      commitMsg: `checkpointId=${state.checkpointId} retryCount=${state.retryCount}`,
      engine: 'loop-graph',
    });
  } catch {
    // audit history 写入失败不阻塞终态返回——blocked 状态本身已在 checkpoint 落盘
  }
}

/**
 * 构建默认依赖集
 */
export function defaultDeps(checkpointer: FileCheckpointer, silent = false): LoopGraphDeps {
  return {
    runEngineer: defaultRunEngineer,
    runAudit: defaultRunAudit,
    runReviewer: defaultRunReviewer,
    confirmHuman: defaultConfirmHuman,
    recordBlocked: defaultRecordBlocked,
    checkpointer,
    maxRetries: DEFAULT_MAX_RETRIES,
    log: (msg: string) => {
      if (!silent) console.log(msg);
    },
  };
}

// ────────────────────────────────
// 节点实现（LangGraph node functions）
// ────────────────────────────────

/**
 * engineer 节点——执行任务（首轮）或按反馈修复（重试轮）
 */
export function makeEngineerNode(deps: LoopGraphDeps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (state: LoopGraphState): Promise<any> => {
    deps.log(`👷 engineer 执行中...（第 ${state.retryCount + 1} 轮）`);
    const feedback =
      state.retryCount > 0
        ? [state.artifacts.auditReport, state.artifacts.reviewReport].filter(Boolean).join('\n\n')
        : '';
    const output = await deps.runEngineer(state.artifacts.task, feedback);
    deps.log('✅ engineer 完成');
    return {
      currentNode: 'engineer',
      artifacts: {
        engineerOutput: output,
        engineerOutputs: [...state.artifacts.engineerOutputs, output],
      },
    };
  };
}

/**
 * audit 节点——审计 engineer 产出。
 * FAIL 时递增 retryCount；达到上限直接标记 blocked 终态 + 写 history。
 */
export function makeAuditNode(deps: LoopGraphDeps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (state: LoopGraphState): Promise<any> => {
    deps.log('🛡️ audit 审计中...');
    const outcome = await deps.runAudit(state.artifacts);
    deps.log(`🛡️ audit 判定: ${outcome.verdict}`);

    const base: Record<string, unknown> = {
      currentNode: 'audit',
      auditResult: outcome.verdict,
      artifacts: {
        auditReport: outcome.report,
        auditReports: [...state.artifacts.auditReports, outcome.report],
      },
    };

    if (outcome.verdict !== 'FAIL') {
      return base; // PASS/WARN → 继续流转 reviewer
    }

    if (state.retryCount < deps.maxRetries) {
      deps.log(`🔄 audit FAIL · 回 engineer 重试（${state.retryCount + 1}/${deps.maxRetries}）`);
      return { ...base, retryCount: state.retryCount + 1 };
    }

    // 重试已达上限仍 FAIL → blocked 终态
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
 * human_confirm 节点——HITL 确认（等待不限时）。
 * y → completed；n → 递增 retryCount 回 engineer（上限内）或 blocked；
 * abort → aborted 终态（checkpoint 可续跑）。
 */
export function makeHumanConfirmNode(deps: LoopGraphDeps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (state: LoopGraphState): Promise<any> => {
    deps.log('🙋 等待人工确认（不限时）...');
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
