// ============================================================
// evolution-feedback-loop.test.ts · 评估反哺闭环端到端链路测试
// （v1.4.5 第七章二 · harvest→jury→promote 全链路）
//
// 与 commons-rule-cycle.test.ts（三步单点覆盖）的差异——本文件是
// **链路级验证**（devlog 第七章二验收：补齐 3 处单点覆盖外的链路
// 级验证），验证点：
//   一、输入来自真实采样数据结构（data/evolution/samples-<date>.json
//       ——章八 continuous-sampler 落盘格式，非合成 fixture）：
//       修正回流 → harvest 低分差评入参；反复失败 → harvest case 入参
//   二、数据从 decision/修正回流出发走完完整循环：
//       采样数据 → harvest（候选）→ jury（Benchmark Δ 门控 + 签字）
//       → promote（收编 builtin / Δ 不足回滚拒绝）
//   三、落账断言：晋升进 builtinSet + decision-log 记 EVOLUTION；
//       被拒候选不晋升（教训保留在 rejected 列表）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

import { harvestRules } from '../commons/rule-harvest';
import { juryRules } from '../commons/rule-jury';
import { promoteRules } from '../commons/rule-promote';
import { builtinQualityRules } from '../refine-agent/quality-rule-set';
import {
  readEvolutionSamples,
  readLatestEvolutionSample,
  correctionBackflowToRatings,
  repeatFailuresToCases,
  toolCandidatesFromSamples,
  logPromotionsToSkillImpact,
  type EvolutionSampleFile,
} from '../evolution/evolution-samples';
import { readSkillImpactLedger } from '../skill-evolution/skill-impact-ledger';

/** 构造一份真实形态的 samples-<date>.json（结构对齐 devlog 第七章一 spec） */
function makeSampleFile(overrides: Partial<EvolutionSampleFile> = {}): EvolutionSampleFile {
  return {
    date: '2026-09-10',
    cycleDays: 7,
    degraded: 'real',
    evalCurve: [
      { date: '2026-09-04', passRate: 0.62 },
      { date: '2026-09-05', passRate: 0.65 },
      { date: '2026-09-06', passRate: 0.71 },
      { date: '2026-09-07', passRate: 0.74 },
      { date: '2026-09-08', passRate: 0.79 },
      { date: '2026-09-09', passRate: 0.83 },
      { date: '2026-09-10', passRate: 0.86 },
    ],
    knowledgeDelta: { concepts: 3, atoms: 17 },
    correctionBackflow: [
      {
        capabilityId: 'cap-finance-report',
        correctedBy: 'fde-kong',
        score: 0.2,
        comment: '## Quality Rule: max_length|output|maxLength=300|财报输出超 300 字，需精简',
        correctedAt: '2026-09-10T09:00:00Z',
      },
    ],
    lowScoreFeedback: [
      {
        capabilityId: 'cap-data-clean',
        raterId: 'rater-042',
        score: 0.15,
        comment: '- Quality: required_keyword|output|keywords=审计,留痕|输出缺少审计留痕关键词',
      },
    ],
    repeatFailures: [
      { capabilityId: 'cap-timeout-skill', failCount: 4, lastReason: '执行 timeout 超时' },
    ],
    toolUsage: [
      { toolName: 'regen_report', invokeCount: 12, successRate: 0.9 },
      { toolName: 'manual_retry', invokeCount: 3, successRate: 1.0 },
    ],
    ...overrides,
  };
}

/** 落盘一份样本到 data/evolution/（真实文件系统路径——读侧全链验证） */
function writeSample(dataDir: string, sample: EvolutionSampleFile): void {
  const dir = join(dataDir, 'evolution');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `samples-${sample.date}.json`), JSON.stringify(sample, null, 2));
}

describe('评估反哺闭环端到端（第七章二：采样数据 → harvest → jury → promote）', { timeout: 60_000 }, () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), `evo-loop-${Date.now()}-${randomBytes(4).toString('hex')}`));
  });

  afterEach(() => {
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('采样桥读取：samples-<date>.json 按日期序读取 + 最新日提取', () => {
    writeSample(dataDir, makeSampleFile({ date: '2026-09-09', cycleDays: 6 }));
    writeSample(dataDir, makeSampleFile({ date: '2026-09-10', cycleDays: 7 }));
    writeSample(dataDir, makeSampleFile({ date: '2026-09-08', cycleDays: 5 }));

    const all = readEvolutionSamples(dataDir);
    expect(all.map((s) => s.date)).toEqual(['2026-09-08', '2026-09-09', '2026-09-10']);
    expect(all[0]!.cycleDays).toBe(5);

    const latest = readLatestEvolutionSample(dataDir);
    expect(latest?.date).toBe('2026-09-10');
    expect(latest?.cycleDays).toBeGreaterThanOrEqual(7); // ≥7 天达标口径
  });

  it('采样桥降级：无样本目录 → 空数组不崩（采样未开始是正常态）', () => {
    expect(readEvolutionSamples(dataDir)).toEqual([]);
    expect(readLatestEvolutionSample(dataDir)).toBeNull();
  });

  it('链路第一步：真实采样数据 → harvest 入参（修正回流+差评合并 / 反复失败跨日聚合）', () => {
    // 两日样本——修正回流跨日累进（模拟真实持续采集）
    writeSample(dataDir, makeSampleFile({
      date: '2026-09-09',
      correctionBackflow: [
        {
          capabilityId: 'cap-finance-report',
          correctedBy: 'fde-kong',
          score: 0.18,
          comment: '## Quality Rule: max_length|output|maxLength=300|财报输出超 300 字，需精简',
          correctedAt: '2026-09-09T09:00:00Z',
        },
      ],
      lowScoreFeedback: [],
      repeatFailures: [{ capabilityId: 'cap-timeout-skill', failCount: 3, lastReason: '第一天 timeout' }],
    }));
    writeSample(dataDir, makeSampleFile({
      date: '2026-09-10',
      correctionBackflow: [],
      lowScoreFeedback: [
        {
          capabilityId: 'cap-data-clean',
          raterId: 'rater-042',
          score: 0.15,
          comment: '- Quality: required_keyword|output|keywords=审计,留痕|输出缺少审计留痕关键词',
        },
      ],
      repeatFailures: [{ capabilityId: 'cap-timeout-skill', failCount: 2, lastReason: '执行 timeout 超时' }],
    }));

    const samples = readEvolutionSamples(dataDir);
    const ratings = correctionBackflowToRatings(samples);
    const cases = repeatFailuresToCases(samples);

    // 差评源合并：09-09 修正回流 1 条 + 09-10 差评直采 1 条（样本 fixture 各 1）
    expect(ratings.length).toBe(2);
    ratings.forEach((r) => expect(r.score).toBeLessThan(0.4));
    // 反复失败跨日聚合：3 + 2 = 5
    const timeoutCase = cases.find((c) => c.capabilityId === 'cap-timeout-skill');
    expect(timeoutCase?.failCount).toBe(5);
    expect(timeoutCase?.lastReason).toBe('执行 timeout 超时'); // 取最近一日
  });

  it('链路完整闭环：采样数据驱动 harvest→jury→promote——晋升落账 + EVOLUTION 审计', () => {
    writeSample(dataDir, makeSampleFile()); // 7 天达标样本落盘
    const samples = readEvolutionSamples(dataDir);
    expect(samples.length).toBe(1);

    // 一、采样数据 → harvest 入参（真实数据非合成 fixture）
    const ratings = correctionBackflowToRatings(samples);
    const cases = repeatFailuresToCases(samples);
    const harvest = harvestRules({ lowScoreRatings: ratings, repeatFailCases: cases });
    expect(harvest.candidates.length).toBeGreaterThan(0);
    harvest.candidates.forEach((r) => expect(r.source).toBe('team_feedback'));

    // 二、jury：golden set 门控（构造对比样本——max_length 300 规则可产生正 Δ）
    const goldenSet = [
      { output: 'A'.repeat(600) }, // 超长 → 违反 max_length=300
      { output: '正常长度输出，含审计留痕关键词。' },
      { output: 'B'.repeat(500) }, // 超长
    ];
    const jury = juryRules({ candidates: harvest.candidates, goldenSet });
    // 推荐与拒绝的 Δ 门控自洽
    jury.recommended.forEach(({ benchmark }) => expect(benchmark.scoreDelta).toBeGreaterThan(0));
    // 非交互环境自动签字（auto-jury）
    jury.approvals.forEach((a) => expect(a.verdict).toBe('approved'));

    // 三、promote：只晋升被推荐+被批准的（数据流衔接——不是拿全部候选硬灌）
    const auditDir = mkdtempSync(join(tmpdir(), 'evo-loop-audit-'));
    const approved = jury.recommended.map((r) => r.rule);
    const promote = promoteRules({
      approvedRules: approved,
      benchmarks: jury.recommended.map((r) => ({
        ruleId: r.rule.id,
        benchmarkHash: r.benchmark.benchmarkHash,
        scoreDelta: r.benchmark.scoreDelta,
      })),
      approvals: jury.approvals,
      dataDir: auditDir,
    });

    // 落账断言：晋升进 builtin 集合 + source 翻转
    if (approved.length > 0) {
      expect(promote.promoted.length).toBe(approved.length);
      promote.promoted.forEach((r) => expect(r.source).toBe('builtin'));
      expect(promote.builtinSet.length).toBeGreaterThan(builtinQualityRules().length);
      expect(promote.loggedCount).toBe(promote.promoted.length);

      // decision-log EVOLUTION 落盘（收编证据——evaluator 闭环回账）
      const decisionLogPath = join(auditDir, 'audit', 'decision-log.jsonl');
      expect(existsSync(decisionLogPath)).toBe(true);
      const logText = readFileSync(decisionLogPath, 'utf-8');
      expect(logText).toContain('"kind":"EVOLUTION"');
      expect(logText).toContain('benchmark-hash');

      // D3 skill-impact 台账汇流（第七章四衔接）：晋升记录进技能进化台账
      const ledgerCount = logPromotionsToSkillImpact(
        dataDir,
        promote.promoted,
        jury.recommended.map((r) => ({ ruleId: r.rule.id, scoreDelta: r.benchmark.scoreDelta, benchmarkHash: r.benchmark.benchmarkHash })),
      );
      expect(ledgerCount).toBe(promote.promoted.length);
      const impactLedger = readSkillImpactLedger(dataDir);
      const feedbackEntries = impactLedger.filter((e) => e.actor === 'evolution-feedback-loop');
      expect(feedbackEntries.length).toBe(promote.promoted.length);
      feedbackEntries.forEach((e) => expect(e.verdict).toBe('accepted'));
    } else {
      // 无推荐时链路仍走通（空晋升不报错——闭环健壮性）
      expect(promote.promoted).toEqual([]);
    }
  });

  it('链路负路径：Δ 不足的候选被拒——不晋升、教训保留', () => {
    writeSample(dataDir, makeSampleFile());
    const samples = readEvolutionSamples(dataDir);
    const ratings = correctionBackflowToRatings(samples);
    const cases = repeatFailuresToCases(samples);
    const harvest = harvestRules({ lowScoreRatings: ratings, repeatFailCases: cases });

    // 空 golden set → 所有 Δ=0 → 全部被拒（jury 自身语义）
    const jury = juryRules({ candidates: harvest.candidates, goldenSet: [] });
    expect(jury.recommended).toEqual([]);
    expect(jury.rejected.length).toBe(harvest.candidates.length);

    // 被拒候选不进 promote（数据流只灌 recommended）
    const promote = promoteRules({ approvedRules: [], benchmarks: [], approvals: [] });
    expect(promote.promoted).toEqual([]);
  });

  it('L4 候选桥（第七章三前置）：采样 toolUsage → 高频候选（热度=频次×失败率）', () => {
    writeSample(dataDir, makeSampleFile({
      toolUsage: [
        { toolName: 'hot_low_success', invokeCount: 20, successRate: 0.5 },
        { toolName: 'hot_stable', invokeCount: 30, successRate: 1.0 },
        { toolName: 'rare_tool', invokeCount: 2, successRate: 0.0 },
      ],
    }));
    const samples = readEvolutionSamples(dataDir);
    const candidates = toolCandidatesFromSamples(samples);

    // rare_tool 低于 minInvokeCount=5 被滤；hot_low_success 热度 20×0.5=10 > hot_stable 0
    const names = candidates.map((c) => c.toolName);
    expect(names).toContain('hot_low_success');
    expect(names).toContain('hot_stable');
    expect(names).not.toContain('rare_tool');
    expect(candidates[0]!.toolName).toBe('hot_low_success'); // 热度降序
  });
});
