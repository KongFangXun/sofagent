// ============================================================
// loop/deps-defaults.ts · LOOP 默认依赖实现（v1.4.9 深模块条目 4）
// ============================================================
// 从 nodes.ts 迁出（原位 85-113 + 402-685 行）：maxTurns 解析、审计默认实现、
// reviewer IS_PASS 解析、HITL 默认确认（自动/readline 双模式）、blocked 回写、
// defaultDeps 装配。与「节点工厂」（nodes.ts）解耦——节点只依赖注入接口，
// 默认实现独立成件即换即用。
//
// 注：原 nodes.ts 中残留在本节的两处 JSDoc（描述批二已迁走的
// defaultRunEngineer / defaultRunReviewer）不再随迁——它们指向本文件不存在的
// 符号（同级于 nodes.ts:332 引用已删 setLoopRouterForTest 的陈旧注释）。
//
// nodes.ts 原样 re-export 本文件导出——loop/index.ts 与测试的既有导入面不变。
// ============================================================

import { execSync } from 'child_process';
import { createInterface } from 'readline';
import { ENGINEER_AGENT, REVIEWER_AGENT } from '../builtin-agents';
import { makeAgentRunner } from './agent-runner';
import { ENGINEER_TOOLS, REVIEWER_TOOLS } from '../tools';
import { loadConfig, loadEnvConfig, resolveDataDir } from '@sofagent/core';
import type { AuditHistoryEntry } from '@sofagent/audit';
import type { FileCheckpointer } from '../graph/checkpoint';
import type { AuditVerdict, LoopArtifacts, LoopGraphState } from './state';
import type { AuditOutcome, HumanDecision, LoopGraphDeps } from './deps-types';
import { getLoopSovereigntyMw, getLoopProgressMw } from './middleware-registry';

/** 重试上限：第 3 轮重试后仍未过 → blocked 终态 */
export const DEFAULT_MAX_RETRIES = 3;

/** Agent 最大轮次默认值（v1.1.4 硬编码 20 → v1.1.5 可配置）
 * 配置位置：.sofagent/config.yml 的 loop.maxTurns.{engineer,reviewer}
 * config 不存在 → fallback 到此处默认值 */
export const DEFAULT_ENGINEER_MAX_TURNS = 20;
export const DEFAULT_REVIEWER_MAX_TURNS = 15;

/**
 * v1.1.5: 按角色解析 maxTurns
 * 优先级：config.yml loop.maxTurns.{role} > 默认值
 * @param role 'engineer' | 'reviewer'
 * @param cwd 项目根目录（用于定位 .sofagent/config.yml）
 */
export function resolveMaxTurns(role: 'engineer' | 'reviewer', cwd?: string): number {
  const fallback = role === 'engineer' ? DEFAULT_ENGINEER_MAX_TURNS : DEFAULT_REVIEWER_MAX_TURNS;
  try {
    const config = loadConfig(cwd, false);
    const roleMax = config.loop?.maxTurns?.[role];
    if (typeof roleMax === 'number' && roleMax > 0) {
      return roleMax;
    }
    return fallback;
  } catch (err) {
    console.warn('[sofagent] loadConfig 解析 maxTurns 失败，使用默认值:', err instanceof Error ? err.message : String(err));
    return fallback;
  }
}

/**
 * 默认 audit 实现——程序化调用 @sofagent/audit（比 CLI 子进程侵入更小：
 * 无需假设二进制安装路径，且类型安全）。
 *
 * 流程：git diff HEAD（工作区未提交变更）→ parseDiff → runRules。
 * 审计模块不可用（如 git 环境缺失）时降级 WARN 并在报告注明——
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
      const emptyWarnOutcome: AuditOutcome = {
        verdict: 'WARN',
        report: '审计提示：git diff HEAD 无变更——engineer 可能未产生文件修改，请人工复核。',
      };
      recordLoopAuditHistory(audit, emptyWarnOutcome, artifacts.task);
      return emptyWarnOutcome;
    }
    const diffFiles = audit.parseDiff('HEAD');
    const result = audit.runRules(diffFiles, [], artifacts.task, false, true);
    const verdict: AuditVerdict =
      result.exitCode === 0 ? 'PASS' : result.exitCode === 1 ? 'WARN' : 'FAIL';
    const lines = result.rules
      .filter((r) => r.status !== 'SKIPPED')
      .map((r) => `- [${r.status}] #${r.number} ${r.name}${r.details.length ? `：${r.details.join('；')}` : ''}`);
    const outcome: AuditOutcome = {
      verdict,
      report: [`审计判定: ${verdict}（exitCode=${result.exitCode}）`, ...lines].join('\n'),
    };
    recordLoopAuditHistory(audit, outcome, artifacts.task, {
      ruleResults: result.rules,
      diffFileCount: diffFiles.length,
    });
    return outcome;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const degradedOutcome: AuditOutcome = {
      verdict: 'WARN',
      report: `审计提示：审计模块不可用（${msg}）——降级 WARN，由 reviewer 与人工确认兜底。`,
    };
    // 审计模块不可用时也尝试写 history（engine 字段标 loop-graph-degraded 便于追溯）
    try {
      const audit = await import('@sofagent/audit');
      recordLoopAuditHistory(audit, degradedOutcome, artifacts.task, { engine: 'loop-graph-degraded' });
    } catch {
      // 连 import 都失败——忽略，history 写入失败不阻塞 LOOP 流程
    }
    return degradedOutcome;
  }
}

/**
 * 将 LOOP 内的审计判定写入 audit history。
 * 三态都写——这是 warn-accumulator 判定「WARN 之后是否有 PASS 清理」的前提。
 * 写入失败不抛异常（history 是辅助追溯，不阻塞 LOOP 主流程）。
 */
function recordLoopAuditHistory(
  audit: typeof import('@sofagent/audit'),
  outcome: AuditOutcome,
  task: string,
  extra?: { ruleResults?: unknown[]; diffFileCount?: number; engine?: string },
): void {
  try {
    audit.appendHistory({
      timestamp: new Date().toISOString(),
      diffRange: 'HEAD',
      task: task.slice(0, 500),
      exitCode: outcome.verdict === 'PASS' ? 0 : outcome.verdict === 'WARN' ? 1 : 2,
      ruleResults: (extra?.ruleResults as AuditHistoryEntry['ruleResults']) ?? [],
      diffFileCount: extra?.diffFileCount ?? 0,
      commitMsg: `[LOOP audit] verdict=${outcome.verdict}`,
      engine: extra?.engine ?? 'loop-graph',
    });
  } catch {
    // history 写入失败不阻塞 LOOP 主流程
  }
}

/**
 * 从 reviewer 审查报告中提取 IS_PASS 判定。
 * reviewer 被要求在报告中输出 "IS_PASS: YES" 或 "IS_PASS: NO"。
 */
export function parseReviewerPass(reviewReport: string): boolean | null {
  const match = reviewReport.match(/\bIS_PASS\s*:\s*(YES|NO)\b/i);
  if (!match) return null;
  return match[1]!.toUpperCase() === 'YES';
}

/**
 * 自动确认——LOOP_AUTO=1 时根据 reviewer 的 IS_PASS 自动判定。
 * IS_PASS: YES → y（通过）
 * IS_PASS: NO  → n（驳回回 engineer）
 * 无法解析      → n（保守默认驳回）
 */
function autoConfirmHuman(reviewReport: string): HumanDecision {
  const isPass = parseReviewerPass(reviewReport);
  if (isPass === true) return 'y';
  if (isPass === false) return 'n';
  // 无法解析 IS_PASS——保守默认驳回
  console.log('[sofagent] 自动模式：无法从 review 报告中解析 IS_PASS，默认驳回');
  return 'n';
}

/**
 * 默认 HITL 实现。
 * LOOP_AUTO=1 时：自动根据 reviewer 的 IS_PASS 判定（不等待人工）。
 * LOOP_AUTO 未设时：stdin readline 等待人工 y/n（不限时）。
 */
function defaultConfirmHuman(reviewReport: string): Promise<HumanDecision> {
  // v1.1.4：LOOP_AUTO=1 时自动判定，不走 stdin readline
  if (process.env.LOOP_AUTO === '1') {
    const autoDecision = autoConfirmHuman(reviewReport);
    console.log(`\n🤖 自动模式判定: ${autoDecision === 'y' ? '✅ 通过 (IS_PASS: YES)' : '🔄 驳回 (IS_PASS: NO)'}`);
    return Promise.resolve(autoDecision);
  }

  // HITL 模式——stdin readline
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
 * 从 createReactAgent invoke 结果中提取文本内容
 * 兼容 string / { content } / { messages: [...] } 多种返回格式
 */
function extractAgentText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    if (typeof obj.content === 'string') return obj.content;
    if (typeof obj.text === 'string') return obj.text;
    if (Array.isArray(obj.messages)) {
      for (let i = obj.messages.length - 1; i >= 0; i--) {
        const msg = obj.messages[i] as Record<string, unknown>;
        if ((msg.role === 'assistant' || msg.type === 'ai') && typeof msg.content === 'string') {
          return msg.content;
        }
      }
    }
  }
  return String(result ?? '');
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
  // v1.4.8 深模块条目 4：角色 runner 经 makeAgentRunner 装配（骨架收编——
  // LLM 解析/gate 三段/心跳/主权包裹/文本提取/降级路径单源；角色差异在 spec）
  const engineerRunner = makeAgentRunner(
    {
      role: 'engineer',
      tools: ENGINEER_TOOLS,
      agentDef: ENGINEER_AGENT,
      buildTask: () => '',
      endpoints: { endpoint: 'loop-engineer', purpose: 'engineer-loop' },
      progressTitle: 'engineer work',
      gateTaskDesc: 'engineer task',
    },
    { sovereigntyMw: getLoopSovereigntyMw(), progressMw: getLoopProgressMw() },
  );
  const reviewerRunner = makeAgentRunner(
    {
      role: 'reviewer',
      tools: REVIEWER_TOOLS,
      agentDef: REVIEWER_AGENT,
      buildTask: () => '',
      endpoints: { endpoint: 'loop-reviewer', purpose: 'reviewer-loop' },
      progressTitle: 'code review',
      gateTaskDesc: 'code review',
    },
    { sovereigntyMw: getLoopSovereigntyMw(), progressMw: getLoopProgressMw() },
  );
  return {
    runEngineer: (task: string, feedback: string) =>
      engineerRunner([
        '# LOOP 任务',
        task,
        '',
        '# 执行纪律',
        '1. 先读再改：修改前先 Read 目标文件',
        '2. 最小变更：只触碰任务要求的内容',
        '3. 验证再继续：完成后确认 build 通过',
        ...(feedback ? ['', '# 上一轮反馈（audit/review 未通过原因，只修复标记的问题）', feedback.slice(0, 2000)] : []),
      ].join('\n')),
    runAudit: defaultRunAudit,
    runReviewer: (artifacts: LoopArtifacts) =>
      reviewerRunner([
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
      ].join('\n')),
    confirmHuman: defaultConfirmHuman,
    recordBlocked: defaultRecordBlocked,
    checkpointer,
    maxRetries: DEFAULT_MAX_RETRIES,
    log: (msg: string) => {
      if (!silent) console.log(msg);
    },
    // v1.2.2 P3b：HITL 异步模式根路径（pending/resolved 均落在此目录下）
    dataDir: loadEnvConfig().dataDir,
    // v1.2.3 AD-2：Dashboard 数据目录——$SOFAGENT_HOME/data（路径 bug 修复：
    // graph-state.json 写到 Dashboard bash 实际读取的位置，而非仓库内 fallback）
    dashboardDir: resolveDataDir(),
  };
}
