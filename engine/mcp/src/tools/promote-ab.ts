// ============================================================
// promote-ab.ts · MCP tool：晋升 candidate 为 current（v1.3.6 交付 1）
// ============================================================
//
// 自进化闭环的「晋升」半环——🔴 强制人审（破坏性操作）：
//
//   human_confirmed ≠ true（默认）：
//     不执行任何破坏性动作。返回结构化 pending 结果——含完整决策依据
//     （decidePromotion 的决策 + latest.json 的最近实验数据），text 明示
//     「挂起等待人工确认」。满足 DSH 冒烟「未确认时挂起」验收路径。
//
//   human_confirmed === true：
//     执行晋升（copyFileSync candidate → current 覆写）+ decision-log
//     审计留痕（kind=EVOLUTION，evidence 附实验数据）。
//
// 人审交互模式说明：与 delete_entity / commons_retire 的 confirmed 门控同款
// （仓库先例），不走 hitl/pending/ 文件通道——该通道与 LOOP checkpoint
// 强耦合（resumeLoopGraph 只恢复 LOOP），promote_ab 不是 LOOP 操作。
// ============================================================

import { existsSync, readFileSync, copyFileSync } from 'fs';
import { AB_TEST_LATEST } from '@sofagent/core';

// ============================================================
// 类型定义
// ============================================================

export interface PromoteAbArgs {
  /** 当前版本 Agent 定义路径（晋升目标——被覆写方）（必填） */
  current: string;
  /** 候选版本 Agent 定义路径（晋升来源）（必填） */
  candidate: string;
  /**
   * 🔴 人工确认（破坏性操作强制人审）。
   * false/缺省 → 只返回决策依据挂起，不执行晋升；
   * true → 执行晋升（copy candidate → current）+ 审计留痕。
   */
  human_confirmed?: boolean;
  /** 决策备注（写入 decision-log，如审批人/理由） */
  comment?: string;
}

export interface PromoteAbResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  /** 结构化数据 */
  data: {
    isError: boolean;
    /** 是否已执行晋升（false = 挂起等人审） */
    executed: boolean;
    /** 是否处于挂起等人审状态 */
    awaitingHuman: boolean;
    decision: {
      shouldPromote: boolean;
      reason: string;
      consecutiveWins: number;
      margin: number;
    };
    currentPath: string;
    candidatePath: string;
    decisionLogged: boolean;
    message?: string;
  };
}

// ============================================================
// 决策依据读取
// ============================================================

/** latest.json 的持久化形状（ab-test/persistence.ts） */
interface LatestABPayload {
  timestamp: string;
  winner: string;
  currentScore: { overall: number };
  candidateScore: { overall: number };
  margin: number;
  consecutiveWins: number;
}

function readLatest(): LatestABPayload | null {
  try {
    return JSON.parse(readFileSync(AB_TEST_LATEST, 'utf-8')) as LatestABPayload;
  } catch {
    return null;
  }
}

// ============================================================
// 主函数
// ============================================================

/**
 * 晋升 candidate 为 current（强制人审）。
 *
 * @param args 晋升参数
 * @returns 结构化结果（text + data）
 */
export async function promoteAb(args: PromoteAbArgs): Promise<PromoteAbResult> {
  const fail = (message: string): PromoteAbResult => ({
    text: `[sofagent] 晋升失败：${message}`,
    data: {
      isError: true,
      executed: false,
      awaitingHuman: false,
      decision: { shouldPromote: false, reason: message, consecutiveWins: 0, margin: 0 },
      currentPath: args.current ?? '',
      candidatePath: args.candidate ?? '',
      decisionLogged: false,
      message,
    },
  });

  if (!args.current || !args.candidate) {
    return fail('缺少必填参数 current / candidate（两版 Agent 定义路径）');
  }

  // ── 决策依据（不依赖人审状态先算好——pending 返回也要带上）──
  let ab: typeof import('@sofagent/ab-test');
  try {
    ab = await import('@sofagent/ab-test');
  } catch (err) {
    return fail(`@sofagent/ab-test 不可用: ${err instanceof Error ? err.message : String(err)}`);
  }

  const latest = readLatest();
  if (!latest) {
    return fail(`未找到 A/B 实验结果（${AB_TEST_LATEST}）——先调 run_ab_test 积累实验数据`);
  }

  const promoteThreshold = 2;
  const decision = ab.decidePromotion(
    {
      currentScore: latest.currentScore as import('@sofagent/ab-test').ABTestResult['currentScore'],
      candidateScore: latest.candidateScore as import('@sofagent/ab-test').ABTestResult['candidateScore'],
      winner: latest.winner as 'current' | 'candidate' | 'tie',
      margin: latest.margin,
      consecutiveWins: latest.consecutiveWins,
    },
    [],
    {
      current: args.current,
      candidate: args.candidate,
      evalSet: '',
      promoteThreshold,
      minSampleSize: 3,
      scoreWeights: { exactMatch: 0.5, semanticSimilarity: 0.2, ruleCompliance: 0.3 },
    },
  );

  const decisionData = {
    shouldPromote: decision.shouldPromote,
    reason: decision.reason,
    consecutiveWins: latest.consecutiveWins,
    margin: latest.margin,
  };

  // ── 决策不通过——直接返回（未达人审条件的挂起不是人审问题，是实验不充分）──
  if (!decision.shouldPromote) {
    return {
      text: [
        '[sofagent] 晋升未执行——实验决策不通过:',
        `  原因: ${decision.reason}`,
        `  最近实验: winner=${latest.winner} margin=${latest.margin.toFixed(4)} 连续胜出=${latest.consecutiveWins}/${promoteThreshold}`,
        '  继续调 run_ab_test 积累连续胜出次数。',
      ].join('\n'),
      data: {
        isError: false,
        executed: false,
        awaitingHuman: false,
        decision: decisionData,
        currentPath: args.current,
        candidatePath: args.candidate,
        decisionLogged: false,
      },
    };
  }

  // ── 🔴 人审门控：human_confirmed ≠ true → 挂起，绝不执行 ──
  if (args.human_confirmed !== true) {
    return {
      text: [
        '⚠️ [sofagent] promote_ab 挂起——破坏性操作等待人工确认，未执行任何变更。',
        `  晋升决策依据: ${decision.reason}`,
        `  最近实验: winner=${latest.winner} margin=${latest.margin.toFixed(4)} 连续胜出=${latest.consecutiveWins}/${promoteThreshold}（${latest.timestamp}）`,
        `  待执行动作: 覆写 ${args.current} ← ${args.candidate}`,
        '  确认执行请带 human_confirmed=true 重新调用；放弃请忽略本消息。',
      ].join('\n'),
      data: {
        isError: false,
        executed: false,
        awaitingHuman: true,
        decision: decisionData,
        currentPath: args.current,
        candidatePath: args.candidate,
        decisionLogged: false,
        message: '破坏性操作未确认——挂起等待人审（human_confirmed=true 才执行）',
      },
    };
  }

  // ── 人审已确认——执行晋升 ──
  if (!existsSync(args.candidate)) {
    return fail(`candidate 路径不存在: ${args.candidate}`);
  }
  try {
    copyFileSync(args.candidate, args.current);
  } catch (err) {
    return fail(`晋升覆写失败: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 审计留痕（kind=EVOLUTION——与 commons rule-promote 同款）
  let decisionLogged = false;
  try {
    const audit = (await import('@sofagent/audit')) as unknown as {
      emitDecision: (input: {
        agentId: string;
        sessionId: string;
        kind: string;
        moment: string;
        why: string;
        specRef?: string;
        artifactRef?: string;
        evidence?: string[];
      }) => unknown;
    };
    audit.emitDecision({
      agentId: 'sofagent-mcp-promote-ab',
      sessionId: `promote-ab-${Date.now()}`,
      kind: 'EVOLUTION',
      moment: 'EVOLVE',
      why: `A/B 晋升已执行（人工确认）: ${decision.reason}${args.comment ? ` · 备注: ${args.comment}` : ''}`,
      artifactRef: args.current,
      evidence: [
        `candidate=${args.candidate}`,
        `latest experiment ${latest.timestamp}: winner=${latest.winner} margin=${latest.margin.toFixed(4)} consecutiveWins=${latest.consecutiveWins}`,
        ...(args.comment ? [`human comment: ${args.comment}`] : []),
      ],
    });
    decisionLogged = true;
  } catch {
    // decision-log best-effort——晋升已完成，留痕失败不回滚（人审已确认的动作优先保住）
  }

  return {
    text: [
      '[sofagent] ✅ A/B 晋升已执行（人工确认）:',
      `  ${args.candidate} → ${args.current}`,
      `  决策依据: ${decision.reason}`,
      decisionLogged ? '  审计留痕: decision-log（kind=EVOLUTION）已写入' : '  ⚠️ 审计留痕失败（best-effort 降级，晋升本身已完成）',
    ].join('\n'),
    data: {
      isError: false,
      executed: true,
      awaitingHuman: false,
      decision: decisionData,
      currentPath: args.current,
      candidatePath: args.candidate,
      decisionLogged,
    },
  };
}
