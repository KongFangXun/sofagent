// ============================================================
// companion.ts · FDE 陪跑期 daemon（v1.3.7 交付 5 #1）
// ============================================================
//
// 部署后前 2 周（陪跑期，COMPANION_DAYS=14）daemon 每日触发 Refine 巡检：
//   1. 触发 Refine（经 @sofagent/orchestrator 公开出口 runRefineLoop——
//      daemon 只 import orchestrator 的公开出口，不深挖内部模块路径）
//   2. 双向写 think.md（经 @sofagent/core 的 appendThinkEntry 契约——
//      append-only，多写入方是 memory-contract 认可的设计原意）
//   3. 巡检结果记 decision-log（经 @sofagent/audit 的 emitDecision——
//      kind=ORCHESTRATION，全程审计留痕）
//
// 陪跑期判定：deployedAt（ISO）距今天数 < 14 天。
// deployedAt 缺省从 {dataDir}/fde/sessions/current.json 的 startedAt 推断；
// 均不可得 → 视为非陪跑期（保守——不误触发 LLM 消耗）。
//
// ⚠️ 依赖方向已核实（dev-prompt）：daemon/package.json 已声明
//   @sofagent/orchestrator（daemon → orchestrator ✓）。
// ============================================================

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { loadEnvConfig, getThinkPath, appendThinkEntry, getDecisionLogPath } from '@sofagent/core';

/** 陪跑期天数（部署后前 2 周） */
export const COMPANION_DAYS = 14;

/** 陪跑期期满总结报告落盘路径 */
export function companionReportPath(dataDir?: string): string {
  return join(dataDir ?? loadEnvConfig().dataDir, 'fde', 'companion-final-report.md');
}

/** 陪跑期巡检执行统计（think.md + decision-log 双源汇总） */
export interface CompanionReportStats {
  /** think.md 中 sofagent-companion 巡检条目数 */
  thinkEntries: number;
  /** decision-log 中 sofagent-companion 决策条数 */
  decisionEntries: number;
  /** Refine 终态分布（decision-log why 解析） */
  finalStates: Record<string, number>;
  /** 报告生成时间（ISO） */
  generatedAt: string;
  /** 部署时间（ISO） */
  deployedAt: string | null;
  /** 已部署天数（报告生成时点） */
  daysSinceDeploy: number | null;
}

/** 陪跑期判定输入 */
export interface CompanionState {
  /** 是否在陪跑期 */
  active: boolean;
  /** 部署时间（ISO，未知为 null） */
  deployedAt: string | null;
  /** 已部署天数（unknown 时为 null） */
  daysSinceDeploy: number | null;
}

/**
 * 读取陪跑期状态。
 *
 * 部署时间来源（按优先级）：
 *   1. {dataDir}/fde/companion.json 的 deployedAt（显式标记，install/init 时写入）
 *   2. {dataDir}/fde/sessions/current.json 的 startedAt（首次 FDE 进场视为部署起点）
 *
 * @param dataDir 数据目录（缺省 loadEnvConfig）
 * @param now 当前时间（测试注入）
 */
export function getCompanionState(dataDir?: string, now: Date = new Date()): CompanionState {
  const dir = dataDir ?? loadEnvConfig().dataDir;
  let deployedAt: string | null = null;

  const markerPath = join(dir, 'fde', 'companion.json');
  if (existsSync(markerPath)) {
    try {
      const marker = JSON.parse(readFileSync(markerPath, 'utf-8')) as { deployedAt?: string };
      if (typeof marker.deployedAt === 'string') deployedAt = marker.deployedAt;
    } catch {
      // 坏标记忽略，走 fallback
    }
  }
  if (!deployedAt) {
    const currentPath = join(dir, 'fde', 'sessions', 'current.json');
    if (existsSync(currentPath)) {
      try {
        const meta = JSON.parse(readFileSync(currentPath, 'utf-8')) as { startedAt?: string };
        if (typeof meta.startedAt === 'string') deployedAt = meta.startedAt;
      } catch {
        // ignore
      }
    }
  }

  if (!deployedAt) {
    return { active: false, deployedAt: null, daysSinceDeploy: null };
  }
  const days = (now.getTime() - new Date(deployedAt).getTime()) / 86_400_000;
  const daysSinceDeploy = Number.isFinite(days) ? Math.floor(days) : null;
  return {
    active: daysSinceDeploy !== null && daysSinceDeploy >= 0 && daysSinceDeploy < COMPANION_DAYS,
    deployedAt,
    daysSinceDeploy,
  };
}

/**
 * 陪跑期巡检统计——从 think.md（sofagent-companion 标记条目）与
 * decision-log.jsonl（agentId=sofagent-companion）双源汇总。
 *
 * @param dataDir 数据目录
 * @param state 陪跑期状态（deployedAt/daysSinceDeploy 复用）
 */
function collectCompanionStats(dataDir: string, state: CompanionState, now: Date): CompanionReportStats {
  const stats: CompanionReportStats = {
    thinkEntries: 0,
    decisionEntries: 0,
    finalStates: {},
    generatedAt: now.toISOString(),
    deployedAt: state.deployedAt,
    daysSinceDeploy: state.daysSinceDeploy,
  };

  // think.md：统计 sofagent-companion 标记的巡检条目（审计视角那条）
  const thinkPath = getThinkPath(dataDir);
  if (existsSync(thinkPath)) {
    try {
      const thinkContent = readFileSync(thinkPath, 'utf-8');
      stats.thinkEntries = (thinkContent.match(/\(sofagent-companion\)/g) ?? []).length;
    } catch {
      // 读失败按 0 计（报告仍生成，标注数据缺失）
    }
  }

  // decision-log.jsonl：agentId=sofagent-companion 条目计数 + finalState 分布
  const decisionLogPath = getDecisionLogPath(dataDir);
  if (existsSync(decisionLogPath)) {
    try {
      const lines = readFileSync(decisionLogPath, 'utf-8').split('\n').filter((l) => l.trim() !== '');
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as {
            agentId?: string;
            why?: { text?: string } | string;
          };
          if (entry.agentId !== 'sofagent-companion') continue;
          stats.decisionEntries += 1;
          const whyText = typeof entry.why === 'string' ? entry.why : (entry.why?.text ?? '');
          const match = whyText.match(/finalState=([^，,\s]+)/);
          if (match) stats.finalStates[match[1]!] = (stats.finalStates[match[1]!] ?? 0) + 1;
        } catch {
          // 单行坏 JSON 跳过（不改总行数语义）
        }
      }
    } catch {
      // 读失败按 0 计
    }
  }

  return stats;
}

/**
 * 生成陪跑期期满总结报告（v1.5.0 章五）。
 *
 * 数据源：think.md 双向写记录（执行统计）+ decision-log 统计（介入记录
 * 汇总 + Refine 终态分布）。幂等——companion.json 已含 reportGeneratedAt
 * 时跳过（返回 alreadyGenerated=true）。
 *
 * @param dataDir 数据目录（缺省 loadEnvConfig）
 * @param now 当前时间（测试注入）
 * @returns 报告路径 + 是否新生成（已生成时 path 为既有报告路径）
 */
export function generateCompanionReport(
  dataDir?: string,
  now: Date = new Date(),
): { path: string; generated: boolean } {
  const dir = dataDir ?? loadEnvConfig().dataDir;
  const state = getCompanionState(dir, now);
  const reportPath = companionReportPath(dir);

  // 幂等判定：companion.json 已标记 reportGeneratedAt → 不重复生成
  const markerPath = join(dir, 'fde', 'companion.json');
  let marker: Record<string, unknown> = {};
  if (existsSync(markerPath)) {
    try {
      marker = JSON.parse(readFileSync(markerPath, 'utf-8')) as Record<string, unknown>;
    } catch {
      // 坏标记按空处理（下面重建）
    }
  }
  if (typeof marker.reportGeneratedAt === 'string') {
    return { path: reportPath, generated: false };
  }

  const stats = collectCompanionStats(dir, state, now);

  // 报告正文——FDE 离场前的交接底稿
  const finalStateLines = Object.entries(stats.finalStates)
    .map(([state_, count]) => `| ${state_} | ${count} |`)
    .join('\n');
  const report = [
    '# FDE 陪跑期总结报告',
    '',
    `> 部署时间：${stats.deployedAt ?? '未知'}；本报告生成于 ${stats.generatedAt}（已部署 ${stats.daysSinceDeploy ?? '?'} 天，陪跑期 ${COMPANION_DAYS} 天已结束）`,
    '',
    '## 执行统计',
    '',
    `- think.md 陪跑巡检条目：**${stats.thinkEntries}** 条（含审计视角 + FDE 视角双向写）`,
    `- decision-log 决策留痕：**${stats.decisionEntries}** 条（kind=ORCHESTRATION）`,
    '',
    '## Refine 终态分布',
    '',
    finalStateLines ? `| 终态 | 次数 |\n|------|------|\n${finalStateLines}` : '_（decision-log 无终态记录——数据缺失或陪跑期内无成功巡检）_',
    '',
    '## 介入记录汇总',
    '',
    stats.decisionEntries > 0
      ? `共 ${stats.decisionEntries} 条介入决策（见 decision-log.jsonl，agentId=sofagent-companion）。若终态含 error:*，建议 FDE 离场前检查质量规则集与 LLM 链路。`
      : '_（无介入决策记录——陪跑期内未产生巡检留痕）_',
    '',
    '---',
    '',
    `_本报告由 sofagent companion 自动生成（期满触发），后续可经 fde_registry 或 dashboard 查阅。_`,
    '',
  ].join('\n');

  mkdirSync(join(dir, 'fde'), { recursive: true });
  writeFileSync(reportPath, report, 'utf-8');

  // companion.json 落 reportGeneratedAt 标记（deployedAt 一并保底写入——
  // fde_deploy 衔接前部署的存量部署也能闭环）
  marker.reportGeneratedAt = stats.generatedAt;
  if (typeof marker.deployedAt !== 'string' && state.deployedAt !== null) {
    marker.deployedAt = state.deployedAt;
  }
  writeFileSync(markerPath, JSON.stringify(marker, null, 2) + '\n', 'utf-8');

  return { path: reportPath, generated: true };
}

/**
 * 单日陪跑巡检结果（结构化，供 inspector 消费/单测断言）。
 */
export interface CompanionRunResult {
  /** 是否执行了 Refine */
  ran: boolean;
  /** 跳过原因（ran=false 时） */
  reason?: string;
  /** Refine 终态（ran=true 时） */
  finalState?: string;
  /** 巡检轮数 */
  rounds?: number;
  /** 陪跑天数 */
  daysSinceDeploy: number | null;
  /** decision-log 是否写入成功（best-effort，失败不阻断） */
  decisionLogged: boolean;
  /** 期满总结报告路径（v1.5.0 章五——期满首检生成时返回） */
  reportPath?: string;
}

/**
 * 陪跑期每日 Refine 巡检（单次 tick——由 daemon cron @daily 或
 * inspector fde-companion-daily 触发）。
 *
 * 步骤：
 *   1. 判定陪跑期（inactive 直接返回，不计费）
 *   2. 触发 runRefineLoop（经 orchestrator 公开出口动态 import——
 *      与 cron.ts ab-schedule 同范式，走 dist 产物）
 *   3. 双向写 think.md（审计视角 + FDE 视角两条记录）
 *   4. 巡检结果记 decision-log（kind=ORCHESTRATION）
 *
 * @param options 可选注入（测试隔离：dataDir / refineFn / now）
 */
export async function runCompanionDaily(
  options: {
    dataDir?: string;
    /** Refine 运行器注入（测试 mock——不调 LLM） */
    refineFn?: (task: string) => Promise<{ finalState: string; rounds: Array<unknown> }>;
    now?: Date;
  } = {},
): Promise<CompanionRunResult> {
  const now = options.now ?? new Date();
  const dataDir = options.dataDir ?? loadEnvConfig().dataDir;

  // 1. 陪跑期判定
  const state = getCompanionState(dataDir, now);
  if (!state.active) {
    // v1.5.0 章五：期满首检自动生成总结报告（幂等——已生成则跳过；
    // deployedAt 已知但报告未生成时触发，FDE 离场交接底稿）
    let reportGenerated = false;
    if (state.deployedAt !== null) {
      try {
        reportGenerated = generateCompanionReport(dataDir, now).generated;
      } catch (err) {
        // 报告生成失败不阻断 tick 返回——可见即可
        console.warn(`[sofagent] companion 期满报告生成失败（不阻断）: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return {
      ran: false,
      reason: state.deployedAt === null
        ? '部署时间未知（无 companion.json / sessions/current.json）——保守跳过'
        : reportGenerated
          ? `陪跑期已结束（已部署 ${state.daysSinceDeploy} 天 ≥ ${COMPANION_DAYS} 天）——期满总结报告已生成`
          : `陪跑期已结束（已部署 ${state.daysSinceDeploy} 天 ≥ ${COMPANION_DAYS} 天）`,
      daysSinceDeploy: state.daysSinceDeploy,
      decisionLogged: false,
      ...(reportGenerated ? { reportPath: companionReportPath(dataDir) } : {}),
    };
  }

  // 2. 触发 Refine（注入 or 真实链路）
  let finalState = 'unknown';
  let rounds = 0;
  try {
    if (options.refineFn) {
      const result = await options.refineFn('FDE 陪跑期每日质量巡检');
      finalState = result.finalState;
      rounds = result.rounds.length;
    } else {
      // 经编译产物动态引入（orchestrator 新增导出随 dist 重建生效——cron.ts 同范式）
      const orchestrator = (await import('@sofagent/orchestrator')) as {
        runRefineLoop: (
          task: string,
          options?: Record<string, unknown>,
        ) => Promise<{ finalState: string; rounds: Array<unknown> }>;
      };
      const result = await orchestrator.runRefineLoop('FDE 陪跑期每日质量巡检', {
        taskId: `companion-${now.toISOString().slice(0, 10)}`,
      });
      finalState = result.finalState;
      rounds = result.rounds.length;
    }
  } catch (err) {
    // Refine 失败不阻断陪跑——记录后继续 think.md / decision-log
    finalState = `error: ${err instanceof Error ? err.message : String(err)}`;
  }

  // 3. 双向写 think.md（append-only 契约；多写入方是设计原意）
  const timestamp = `${now.toISOString().slice(0, 10)} ${now.toISOString().slice(11, 16)}`;
  try {
    const thinkPath = getThinkPath(dataDir);
    appendThinkEntry(
      thinkPath,
      `\n## ${timestamp} 任务: FDE 陪跑期每日 Refine 巡检\n\n` +
      `- #审计结果(sofagent-companion): INFO — Refine finalState=${finalState}（${rounds} 轮）\n` +
      `- #改动范围: 无文件改动（巡检性任务）\n` +
      `- #教训: 陪跑期第 ${state.daysSinceDeploy} 天巡检完成，终态 ${finalState}\n\n`,
    );
    appendThinkEntry(
      thinkPath,
      `\n## ${timestamp} 任务: FDE 陪跑反馈（人侧视角）\n\n` +
      `- #审计结果(sofagent-companion): INFO — 面向 FDE 的陪跑记录\n` +
      `- #改动范围: think.md（本条）\n` +
      `- #教训: Refine 巡检终态 ${finalState}；如连续 ERROR 请 FDE 介入检查质量规则集\n\n`,
    );
  } catch (err) {
    // v1.4.5 T8：think.md 写失败不阻断（best-effort），但必须可见——
    // 原空 catch 静默，写入失败无人知晓（磁盘满/权限等部署问题被掩盖）。
    console.warn(`[sofagent] companion think.md 写入失败（不阻断巡检）: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 4. decision-log（kind=ORCHESTRATION，全程审计留痕）
  let decisionLogged = false;
  try {
    // v1.4.5 T8：删 `as unknown as` 双重断言——@sofagent/audit 的动态
    // import 本身强类型（daemon/package.json 已声明依赖）。运行时只做
    // emitDecision 存在性窄化（防 dist 过旧缺导出），不再绕过类型系统。
    const audit = await import('@sofagent/audit');
    if (typeof audit.emitDecision !== 'function') {
      throw new Error('@sofagent/audit 未导出 emitDecision（dist 过旧——rebuild audit 包）');
    }
    audit.emitDecision(
      {
        agentId: 'sofagent-companion',
        sessionId: `companion-${now.toISOString().slice(0, 10)}`,
        kind: 'ORCHESTRATION',
        moment: 'ACT',
        why: `FDE 陪跑期第 ${state.daysSinceDeploy} 天每日 Refine 巡检：finalState=${finalState}，共 ${rounds} 轮`,
        evidence: [`companion.json deployedAt=${state.deployedAt}`, `Refine rounds=${rounds}`],
      },
      dataDir,
    );
    decisionLogged = true;
  } catch (err) {
    // v1.4.5 T8：decision-log 失败不阻断（best-effort），但审计留痕丢失
    // 必须可见——原空 catch 静默，emitDecision 抛错（schema/写盘）无人知晓。
    console.warn(`[sofagent] companion decision-log 写入失败（审计留痕缺失）: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    ran: true,
    finalState,
    rounds,
    daysSinceDeploy: state.daysSinceDeploy,
    decisionLogged,
  };
}
