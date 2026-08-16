// ============================================================
// companion.ts · FDE 陪跑期 daemon（v1.3.6 交付 5 #1）
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

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { loadEnvConfig, getThinkPath, appendThinkEntry } from '@sofagent/core';

/** 陪跑期天数（部署后前 2 周） */
export const COMPANION_DAYS = 14;

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
    return {
      ran: false,
      reason: state.deployedAt === null
        ? '部署时间未知（无 companion.json / sessions/current.json）——保守跳过'
        : `陪跑期已结束（已部署 ${state.daysSinceDeploy} 天 ≥ ${COMPANION_DAYS} 天）`,
      daysSinceDeploy: state.daysSinceDeploy,
      decisionLogged: false,
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
  } catch {
    // think.md 写失败不阻断（best-effort）
  }

  // 4. decision-log（kind=ORCHESTRATION，全程审计留痕）
  let decisionLogged = false;
  try {
    const audit = (await import('@sofagent/audit')) as unknown as {
      emitDecision: (input: {
        agentId: string;
        sessionId: string;
        kind: string;
        moment: string;
        why: string;
        evidence?: string[];
      }, dataDir?: string) => unknown;
    };
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
  } catch {
    // decision-log 写失败不阻断（best-effort——emitDecision 抛错时静默降级）
  }

  return {
    ran: true,
    finalState,
    rounds,
    daysSinceDeploy: state.daysSinceDeploy,
    decisionLogged,
  };
}
