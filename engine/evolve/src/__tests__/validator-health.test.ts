// ============================================================
// validator-health.test.ts · 验证器自身老化检测测试（v1.5.9 章四）
// 覆盖：老化度三维 / 老化告警（只提示不阻断）/ 收益归因对照组（净贡献 + 轮换留痕）/
//       漂移三态（不误杀）/ 复检入口留痕 / 评估器解耦三级精判 / 判定件三边界 /
//       验证者链三机制
// 负向探针（硬约束「不得为凑验收虚标」锚点）：
//   · 漂移态：断言**未**触发回退 + **有**告警；
//   · 无跨面声明 ⇒ fail-closed 按自评处理；
//   · 老化告警不阻断晋升流程（verdict 逐字段不变、blocked=false）。
// 隔离纪律：SOFAGENT_DATA 指向临时目录（不触真实 ~/.sofagent/data）
// ============================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  AGING_CONSUMPTION_ALERT_THRESHOLD,
  AGING_STALE_RECHECK_DAYS,
  CONTROL_GROUP_ROTATION_DAYS,
  JUDGE_ARTIFACT_TIER,
  VERIFIER_CHAIN_MECHANISMS,
  computeEvalSetHealth,
  evaluateAgingAlert,
  applyAgingAlertToPromotion,
  collectAgingAlerts,
  computeAllEvalSetHealth,
  recordEvalSetUsage,
  readEvalSetUsage,
  recordEvalSetRecheck,
  readEvalSetRecheckLog,
  freezeControlGroup,
  readControlGroup,
  saveControlGroup,
  shouldRotateControlGroup,
  rotateControlGroup,
  readControlRotationLog,
  computeNetContribution,
  classifyValidationFailure,
  assertEvaluatorDecoupled,
  buildThreeTierPrecision,
  EvaluatorDecouplingError,
  routeJudgeTier,
  assertJudgeArtifactCanJudgeNotAuthor,
  judgeCrossSurface,
  judgeArtifactTier,
  assertFreshInstance,
  assertRejectHasReason,
  placeInvariant,
  resolveValidatorHealthDir,
  resolveEvalSetUsagePath,
  resolveRecheckLogPath,
  resolveControlGroupPath,
  resolveControlRotationPath,
  type EvalSetUsageRecord,
  type CrossSurfaceDeclaration,
} from '../validator-health';
import type { EvolutionBenefitMetrics, PromotionVerdict } from '../promotion-policy';

let dataDir: string;

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'validator-health-'));
  process.env.SOFAGENT_DATA = dataDir;
});

afterAll(() => {
  delete process.env.SOFAGENT_DATA;
  rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(dataDir, 'evolve'), { recursive: true, force: true });
});

/** 造一条消费记录 */
function usage(over: Partial<EvalSetUsageRecord> = {}): EvalSetUsageRecord {
  return { evalSetId: 'set-A', ts: '2026-10-01T00:00:00.000Z', passRate: 0.5, taskMetric: null, ...over };
}

/** 造一组通过率上升而任务指标未改善的记录 */
function risingRecords(n = 5): EvalSetUsageRecord[] {
  return Array.from({ length: n }, (_, i) =>
    usage({
      ts: `2026-10-0${i + 1}T00:00:00.000Z`,
      passRate: 0.5 + i * 0.05,
      taskMetric: 0.4,
    }),
  );
}

// ════════════════════════════════════════════════════════════
describe('章四 · 验证集老化指标（消费次数 / 通过率趋势 / 复检时间）', () => {
  it('老化度可计算：三维分项齐备 + 老化度 = 三维等权平均', () => {
    const records = risingRecords(5);
    const h = computeEvalSetHealth('set-A', records, { now: '2026-10-06T00:00:00.000Z' });
    expect(h.consumptionCount).toBe(5);
    expect(h.passRateTrend).toBeGreaterThan(0);
    expect(h.trailingRises).toBe(4);
    expect(h.lastManualRecheckAt).toBeNull();
    // 无复检 ⇒ 复检陈旧度满分
    expect(h.dimensions.staleRecheck).toBe(1);
    const expected = (h.dimensions.consumption + h.dimensions.suspicion + h.dimensions.staleRecheck) / 3;
    expect(h.agingDegree).toBeCloseTo(expected, 10);
  });

  it('通过率上升 + 任务指标未改善 ⇒ 趋势可疑度计入（疑「门变松」）', () => {
    const h = computeEvalSetHealth('set-A', risingRecords(5), { now: '2026-10-06T00:00:00.000Z' });
    expect(h.taskMetricTrend).not.toBeNull();
    expect(h.dimensions.suspicion).toBeGreaterThan(0);
  });

  it('任务指标同样上升 ⇒ 趋势可疑度为 0（能力确实变强，不误告警）', () => {
    const records = Array.from({ length: 5 }, (_, i) =>
      usage({ ts: `2026-10-0${i + 1}T00:00:00.000Z`, passRate: 0.5 + i * 0.05, taskMetric: 0.3 + i * 0.05 }),
    );
    const h = computeEvalSetHealth('set-A', records, { now: '2026-10-06T00:00:00.000Z' });
    expect(h.dimensions.suspicion).toBe(0);
  });

  it('任务指标未采集 ⇒ 不猜（趋势可疑度为 0——宁缺勿假）', () => {
    const records = Array.from({ length: 5 }, (_, i) => usage({ ts: `2026-10-0${i + 1}T00:00:00.000Z`, passRate: 0.5 + i * 0.05, taskMetric: null }));
    const h = computeEvalSetHealth('set-A', records, { now: '2026-10-06T00:00:00.000Z' });
    expect(h.taskMetricTrend).toBeNull();
    expect(h.dimensions.suspicion).toBe(0);
  });

  it('台账落盘与聚合：recordEvalSetUsage → computeAllEvalSetHealth / collectAgingAlerts', () => {
    expect(resolveValidatorHealthDir(dataDir)).toBe(join(dataDir, 'evolve', 'validator-health'));
    expect(resolveEvalSetUsagePath(dataDir)).toBe(join(resolveValidatorHealthDir(dataDir), 'eval-set-usage.jsonl'));
    for (const r of risingRecords(5)) recordEvalSetUsage(r, { dataDir });
    expect(existsSync(resolveEvalSetUsagePath(dataDir))).toBe(true);
    expect(readEvalSetUsage(dataDir)).toHaveLength(5);
    const healths = computeAllEvalSetHealth({ dataDir, now: '2026-10-06T00:00:00.000Z' });
    expect(healths.map((h) => h.evalSetId)).toEqual(['set-A']);
    const alerts = collectAgingAlerts({ dataDir, now: '2026-10-06T00:00:00.000Z' });
    expect(alerts).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════════
describe('章四 · 老化告警（只提示不阻断）', () => {
  it('条件 A：通过率连续上升 + 任务指标未改善 ⇒ 告警，且 blocksPromotion=false', () => {
    const h = computeEvalSetHealth('set-A', risingRecords(5), { now: '2026-10-06T00:00:00.000Z' });
    expect(h.alert).not.toBeNull();
    expect(h.alert!.level).toBe('warn');
    expect(h.alert!.blocksPromotion).toBe(false);
    expect(h.alert!.suggestion).toContain('冻结');
    expect(h.alert!.reasons.some((r) => r.includes('真实任务指标未改善'))).toBe(true);
  });

  it('条件 B：消费次数超阈值且长期无复检 ⇒ 告警', () => {
    const n = AGING_CONSUMPTION_ALERT_THRESHOLD;
    const records = Array.from({ length: n }, (_, i) => usage({ ts: `2026-09-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`, passRate: 0.5, taskMetric: 0.5 }));
    const h = computeEvalSetHealth('set-A', records, { now: '2026-10-06T00:00:00.000Z' });
    expect(h.consumptionCount).toBe(n);
    expect(h.alert).not.toBeNull();
    expect(h.alert!.reasons.some((r) => r.includes('长期无复检'))).toBe(true);
  });

  it('健康验证集（少量消费 + 近期复检 + 无上升）⇒ 无告警', () => {
    const h = computeEvalSetHealth('set-A', [usage({ ts: '2026-10-05T00:00:00.000Z', passRate: 0.5 }), usage({ ts: '2026-10-05T01:00:00.000Z', passRate: 0.5 })], {
      now: '2026-10-06T00:00:00.000Z',
      rechecks: [{ evalSetId: 'set-A', action: 'add-sample', sampleId: 's-new', actor: 'fde-1', reason: '补样本', at: '2026-10-05T12:00:00.000Z' }],
    });
    expect(h.alert).toBeNull();
    expect(h.agingDegree).toBeLessThan(0.6);
  });

  it('负向探针 · 老化告警不阻断晋升流程：verdict 逐字段不变、blocked=false', () => {
    const h = computeEvalSetHealth('set-A', risingRecords(5), { now: '2026-10-06T00:00:00.000Z' });
    const verdict: PromotionVerdict = { action: 'promote-skill', basis: '四门全过' };
    const applied = applyAgingAlertToPromotion(h.alert, verdict);
    expect(applied.blocked).toBe(false);
    expect(applied.verdict).toEqual(verdict);
    expect(applied.advisory).toContain('冻结');
    // 无告警时也不阻断、无建议
    const none = applyAgingAlertToPromotion(null, verdict);
    expect(none.blocked).toBe(false);
    expect(none.verdict).toEqual(verdict);
    expect(none.advisory).toBeNull();
  });

  it('evaluateAgingAlert 显式传入健康度对象时同样只返回 warn（不含阻断语义）', () => {
    const h = computeEvalSetHealth('set-A', risingRecords(5), { now: '2026-10-06T00:00:00.000Z' });
    const again = evaluateAgingAlert(h, '2026-10-06T00:00:00.000Z');
    expect(again!.blocksPromotion).toBe(false);
    expect(again!.level).toBe('warn');
  });
});

// ════════════════════════════════════════════════════════════
describe('章四 · 收益归因对照组（反事实基线 + 净贡献 + 轮换留痕）', () => {
  const treatment: EvolutionBenefitMetrics = { passRateTrend: 0.1, recurrenceRate: 0.3, skillReuseRate: 0.7, interventionRate: 0.1 };
  const control: EvolutionBenefitMetrics = { passRateTrend: 0.02, recurrenceRate: 0.5, skillReuseRate: 0.55, interventionRate: 0.18 };

  it('进化开启前冻结对照组：代次 0 + 内容寻址 id', () => {
    const cg = freezeControlGroup({ label: 'pre-evolution', payload: { skill: 'frozen', inject: 'off', train: 'off' } }, { now: '2026-10-01T00:00:00.000Z', rotationPeriodDays: CONTROL_GROUP_ROTATION_DAYS });
    expect(cg.generation).toBe(0);
    expect(cg.id).toMatch(/^cg-[0-9a-f]{16}$/);
    expect(cg.frozenConfig.frozenAt).toBe('2026-10-01T00:00:00.000Z');
    expect(cg.rotationPeriodDays).toBe(CONTROL_GROUP_ROTATION_DAYS);
  });

  it('净贡献 = 进化组 − 对照组（逐指标差值 + 按方向折算的净改善）', () => {
    const rows = computeNetContribution(treatment, control);
    const byMetric = new Map(rows.map((r) => [r.metric, r]));
    expect(byMetric.get('passRateTrend')!.delta).toBeCloseTo(0.08, 10);
    expect(byMetric.get('passRateTrend')!.direction).toBe('higher');
    expect(byMetric.get('passRateTrend')!.improvement).toBeCloseTo(0.08, 10);
    // recurrenceRate 越小越好：delta 负、改善为正
    expect(byMetric.get('recurrenceRate')!.delta).toBeCloseTo(-0.2, 10);
    expect(byMetric.get('recurrenceRate')!.direction).toBe('lower');
    expect(byMetric.get('recurrenceRate')!.improvement).toBeCloseTo(0.2, 10);
  });

  it('对照组到周期 ⇒ 应轮换；未到 ⇒ 不轮换', () => {
    const cg = freezeControlGroup({ label: 'pre-evolution', payload: {} }, { now: '2026-10-01T00:00:00.000Z', rotationPeriodDays: 30 });
    expect(shouldRotateControlGroup(cg, '2026-10-15T00:00:00.000Z')).toBe(false);
    expect(shouldRotateControlGroup(cg, '2026-11-05T00:00:00.000Z')).toBe(true);
  });

  it('轮换重置：代次 +1、id 变化、新冻结时刻，且轮换留痕落盘', () => {
    const cg = freezeControlGroup({ label: 'pre-evolution', payload: { skill: 'frozen' } }, { now: '2026-10-01T00:00:00.000Z', rotationPeriodDays: 30 });
    saveControlGroup(cg, { dataDir });
    const { state, rotation } = rotateControlGroup(cg, { now: '2026-11-05T00:00:00.000Z', reason: '周期轮换', actor: 'fde-2', dataDir });
    expect(state.generation).toBe(1);
    expect(state.id).not.toBe(cg.id);
    expect(state.lastRotatedAt).toBe('2026-11-05T00:00:00.000Z');
    expect(rotation.previousId).toBe(cg.id);
    expect(rotation.generation).toBe(1);
    // 轮换留痕 + 状态落盘
    expect(resolveControlGroupPath(dataDir)).toBe(join(resolveValidatorHealthDir(dataDir), 'control-group.json'));
    expect(resolveControlRotationPath(dataDir)).toBe(join(resolveValidatorHealthDir(dataDir), 'control-rotation.jsonl'));
    expect(existsSync(resolveControlRotationPath(dataDir))).toBe(true);
    expect(readControlRotationLog(dataDir).rows).toHaveLength(1);
    expect(readControlGroup(dataDir)!.generation).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════
describe('章四 · 验证漂移三态（真失败 / 环境漂移 / 证据不足）', () => {
  it('真失败：环境一致 + 证据充分 ⇒ 降置信度 + 可回退', () => {
    const v = classifyValidationFailure({ envFingerprintMatched: true, reproducible: true, hasSufficientEvidence: true, sampleCount: 5 });
    expect(v.state).toBe('true-failure');
    expect(v.lowerConfidence).toBe(true);
    expect(v.triggerRollback).toBe(true);
    expect(v.alert).toBe(true);
    expect(v.pendingEnvReview).toBe(false);
  });

  it('负向探针 · 环境漂移不误杀：未触发回退 + 未降置信度 + 有告警 + 标记待环境复核', () => {
    const v = classifyValidationFailure({ envFingerprintMatched: false, reproducible: false, hasSufficientEvidence: true, sampleCount: 5 });
    expect(v.state).toBe('environment-drift');
    expect(v.triggerRollback).toBe(false);
    expect(v.lowerConfidence).toBe(false);
    expect(v.alert).toBe(true);
    expect(v.pendingEnvReview).toBe(true);
    expect(v.basis).toContain('环境漂移');
  });

  it('证据不足：挂起待补证据，不降置信度、不回退', () => {
    const v = classifyValidationFailure({ envFingerprintMatched: true, reproducible: false, hasSufficientEvidence: false, sampleCount: 1 });
    expect(v.state).toBe('insufficient-evidence');
    expect(v.triggerRollback).toBe(false);
    expect(v.lowerConfidence).toBe(false);
    expect(v.alert).toBe(true);
    expect(v.pendingEnvReview).toBe(true);
  });

  it('优先级：证据不足 > 环境漂移（连是否漂移都判不准时先挂起）', () => {
    const v = classifyValidationFailure({ envFingerprintMatched: false, reproducible: false, hasSufficientEvidence: false, sampleCount: 0 });
    expect(v.state).toBe('insufficient-evidence');
  });
});

// ════════════════════════════════════════════════════════════
describe('章四 · 验证集复检入口（人工复检 + 留痕）', () => {
  it('复检动作留痕：标记样本失效 / 新增样本逐条可追溯', () => {
    expect(resolveRecheckLogPath(dataDir)).toBe(join(resolveValidatorHealthDir(dataDir), 'recheck.jsonl'));
    recordEvalSetRecheck({ evalSetId: 'set-A', action: 'invalidate-sample', sampleId: 's-1', actor: 'fde-1', reason: '样本已过时', at: '2026-10-05T00:00:00.000Z' }, { dataDir });
    recordEvalSetRecheck({ evalSetId: 'set-A', action: 'add-sample', sampleId: 's-2', actor: 'fde-1', reason: '补新样本', at: '2026-10-05T01:00:00.000Z' }, { dataDir });
    const log = readEvalSetRecheckLog(dataDir);
    expect(log.rows.map((r) => r.action)).toEqual(['invalidate-sample', 'add-sample']);
    expect(log.rows.every((r) => r.actor === 'fde-1' && r.reason !== '')).toBe(true);
  });

  it('复检后老化度重算：lastManualRecheckAt 更新、复检陈旧度归零', () => {
    const records = [usage({ ts: '2026-10-05T00:00:00.000Z', passRate: 0.5 }), usage({ ts: '2026-10-05T01:00:00.000Z', passRate: 0.5 })];
    const rechecks = [{ evalSetId: 'set-A', action: 'invalidate-sample', sampleId: 's-1', actor: 'fde-1', reason: '样本失效', at: '2026-10-05T12:00:00.000Z' }];
    const h = computeEvalSetHealth('set-A', records, { now: '2026-10-06T00:00:00.000Z', rechecks });
    expect(h.lastManualRecheckAt).toBe('2026-10-05T12:00:00.000Z');
    expect(h.dimensions.staleRecheck).toBeLessThan(1);
    expect(h.dimensions.staleRecheck).toBeCloseTo(0.5 / AGING_STALE_RECHECK_DAYS, 6);
  });

  it('批量复检约束：消费次数超阈值时，及时复检可抑制条件 B 告警', () => {
    const n = AGING_CONSUMPTION_ALERT_THRESHOLD;
    const records = Array.from({ length: n }, (_, i) => usage({ ts: `2026-09-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`, passRate: 0.5, taskMetric: 0.5 }));
    const withRecheck = computeEvalSetHealth('set-A', records, {
      now: '2026-10-06T00:00:00.000Z',
      rechecks: [{ evalSetId: 'set-A', action: 'add-sample', sampleId: 's-x', actor: 'fde-1', reason: '复检', at: '2026-10-05T00:00:00.000Z' }],
    });
    // 近期复检 ⇒ 条件 B 的「长期无复检」不成立（条件 A 因通过率平稳也不成立）
    expect(withRecheck.alert).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════
describe('章四 · 评估器解耦与三级精判', () => {
  it('自评禁令：评估模型与执行模型同 id ⇒ 拒绝', () => {
    const dec = assertEvaluatorDecoupled({ role: 'executor', modelId: 'm-exec' }, { role: 'evaluator', modelId: 'm-exec' });
    expect(dec.ok).toBe(false);
    expect(String(dec.reason)).toContain('自评');
  });

  it('自评禁令：评估者角色不得为 executor', () => {
    const dec = assertEvaluatorDecoupled({ role: 'executor', modelId: 'm-exec' }, { role: 'executor', modelId: 'm-judge' });
    expect(dec.ok).toBe(false);
  });

  it('解耦达成：评估模型与执行模型不同 id ⇒ 允许', () => {
    expect(assertEvaluatorDecoupled({ role: 'executor', modelId: 'm-exec' }, { role: 'evaluator', modelId: 'm-judge' }).ok).toBe(true);
  });

  it('三级精判装配：规则预筛 → 独立评估模型 → 关键样本人审（定标权 human）', () => {
    const cfg = buildThreeTierPrecision('m-exec', 'm-judge', { humanSampleRate: 0.1 });
    expect(cfg.prefilter.enabled).toBe(true);
    expect(cfg.independentModel.modelId).toBe('m-judge');
    expect(cfg.independentModel.decoupledFrom).toBe('m-exec');
    expect(cfg.humanSpotCheck.calibrationAuthority).toBe('human');
    expect(cfg.humanSpotCheck.sampleRate).toBe(0.1);
  });

  it('三级精判装配违反自评禁令 ⇒ 抛错（fail-closed）', () => {
    expect(() => buildThreeTierPrecision('m-exec', 'm-exec')).toThrow(EvaluatorDecouplingError);
  });

  it('精判路由：规则可判 ⇒ 规则预筛；关键样本 ⇒ 人审抽检；其余 ⇒ 独立模型', () => {
    expect(routeJudgeTier({ sampleId: 'a', ruleDeterminable: true, key: false }).tier).toBe('rule-prefilter');
    const keyRoute = routeJudgeTier({ sampleId: 'b', ruleDeterminable: false, key: true });
    expect(keyRoute.tier).toBe('human-spot-check');
    expect(keyRoute.calibrationAuthority).toBe('human');
    const modelRoute = routeJudgeTier({ sampleId: 'c', ruleDeterminable: false, key: false });
    expect(modelRoute.tier).toBe('independent-model');
    expect(modelRoute.calibrationAuthority).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════
describe('章四 · 判定件作为验证器（三边界）', () => {
  it('判定件登记为 model-judge 档首选验证器', () => {
    expect(judgeArtifactTier()).toBe('model-judge');
    expect(JUDGE_ARTIFACT_TIER).toBe('model-judge');
  });

  it('能判不能出题：canJudge=true 且 canAuthor=false ⇒ 通过', () => {
    expect(assertJudgeArtifactCanJudgeNotAuthor({ id: 'ja-1', surface: 'code', capabilities: { canJudge: true, canAuthor: false } }).ok).toBe(true);
  });

  it('能判不能出题：canAuthor=true ⇒ 拒绝（作判题器不作出题器）', () => {
    const r = assertJudgeArtifactCanJudgeNotAuthor({ id: 'ja-1', surface: 'code', capabilities: { canJudge: true, canAuthor: true } });
    expect(r.ok).toBe(false);
    expect(String(r.reason)).toContain('能判不能出题');
  });

  it('能判不能出题：canJudge=false ⇒ 拒绝', () => {
    expect(assertJudgeArtifactCanJudgeNotAuthor({ id: 'ja-1', surface: 'code', capabilities: { canJudge: false, canAuthor: false } }).ok).toBe(false);
  });

  it('自评禁则：判定件不得为自身所属判定面的进化当裁判', () => {
    const v = judgeCrossSurface('code', 'code', []);
    expect(v.allowed).toBe(false);
    expect(v.treatedAsSelfReview).toBe(true);
    expect(v.basis).toContain('自评禁则');
  });

  it('跨面互审：异面且登记表显式声明 ⇒ 允许', () => {
    const decls: CrossSurfaceDeclaration[] = [{ judgeSurface: 'code', targetSurface: 'memory', declaredIn: 'dv-code-entry', basis: 'code 判定件可评 memory 面产物' }];
    const v = judgeCrossSurface('code', 'memory', decls);
    expect(v.allowed).toBe(true);
    expect(v.treatedAsSelfReview).toBe(false);
  });

  it('负向探针 · 异面但无声明 ⇒ fail-closed 按自评处理', () => {
    const v = judgeCrossSurface('code', 'memory', []);
    expect(v.allowed).toBe(false);
    expect(v.treatedAsSelfReview).toBe(true);
    expect(v.basis).toContain('fail-closed');
  });
});

// ════════════════════════════════════════════════════════════
describe('章四 · 验证者链三机制', () => {
  it('三机制名单单一来源（不新立角色、不新增档位）', () => {
    expect([...VERIFIER_CHAIN_MECHANISMS]).toEqual(['fresh-instance', 'reject-returns-reason', 'invariants-in-format-layer']);
  });

  it('① 每次判定用全新实例：实例已用过 ⇒ 拒绝', () => {
    expect(assertFreshInstance({ verifierInstanceId: 'v-2' }, new Set(['v-1'])).ok).toBe(true);
    expect(assertFreshInstance({ verifierInstanceId: 'v-1' }, new Set(['v-1'])).ok).toBe(false);
    expect(assertFreshInstance({ verifierInstanceId: 'v-1', reusedInstanceIds: ['v-1'] }, new Set()).ok).toBe(false);
  });

  it('② 判负必须回抛原因：passed=false 无原因 ⇒ 拒绝；有原因 ⇒ 通过', () => {
    expect(assertRejectHasReason({ passed: false, reason: '字段 X 缺失' }).ok).toBe(true);
    const r = assertRejectHasReason({ passed: false });
    expect(r.ok).toBe(false);
    expect(String(r.reason)).toContain('判负未回抛原因');
    expect(assertRejectHasReason({ passed: true }).ok).toBe(true);
  });

  it('③ 不需外部执行即可判定的不变量 ⇒ 归格式校验层，不加验证者', () => {
    const noExec = placeInvariant(false);
    expect(noExec.useVerifier).toBe(false);
    expect(noExec.formatValidation).toBe(true);
    const needExec = placeInvariant(true);
    expect(needExec.useVerifier).toBe(true);
    expect(needExec.formatValidation).toBe(false);
  });
});
