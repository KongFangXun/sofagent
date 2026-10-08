// examiner.test.ts · 出题 / 双成功 / 失败降级 / 三态沉淀 / 硬门 / 佐证门单测（v1.5.8 章四）
import { describe, expect, it } from 'vitest';
import {
  generateExamQuestion,
  assessExamination,
  decideSedimentation,
  checkDoNotCapture,
  checkCorroborationGate,
  applyExamResultToPoolItem,
  type ExamQuestion,
} from '../examiner';
import { scoreInstinct, applyExamStatusWeight, DEFAULT_CONFIDENCE_THRESHOLD, VERIFIED_CONFIDENCE_MULTIPLIER, FAILED_CONFIDENCE_MULTIPLIER } from '../scorer';
import type { StoredInstinct } from '../store';

function makeScored(confidence: number, occurrences = 3) {
  return {
    id: 'inst-test-1',
    pattern: '提交前先跑 shellcheck',
    source: 'think' as const,
    occurrences,
    passCount: Math.round(confidence * occurrences),
    failCount: occurrences - Math.round(confidence * occurrences),
    lastSeen: '2026-10-09T00:00:00Z',
    confidence,
    coverage: Math.min(1, occurrences / 3),
    passRate: confidence,
  };
}

describe('章四 · 出题器', () => {
  it('达阈值条目可生成考核题（场景 + 期望结果齐备）', () => {
    const scored = makeScored(0.9);
    const q = generateExamQuestion(scored, 'deterministic');
    expect(q).not.toBeNull();
    expect(q!.scenario).toContain('复现场景');
    expect(q!.expected).toContain('一致');
    expect(q!.domainTier).toBe('deterministic');
  });

  it('阈值与第三章同源（scorer.ts DEFAULT_CONFIDENCE_THRESHOLD = 0.7）', () => {
    const below = generateExamQuestion(makeScored(0.5), 'deterministic');
    expect(below).toBeNull();
    // 恰在阈值上可出题（≥ 语义）
    const at = generateExamQuestion(makeScored(DEFAULT_CONFIDENCE_THRESHOLD), 'model-judge');
    expect(at).not.toBeNull();
  });
});

describe('章四 · 双成功判定', () => {
  const baseQ: ExamQuestion = {
    id: 'exq-1-1', instinctId: 'inst-1', scenario: 's', expected: 'e',
    domainTier: 'deterministic', createdAt: '2026-10-09T00:00:00Z',
  };
  const ok = { pass: true, basis: '通过' };
  const bad = { pass: false, basis: '未通过' };

  it('答案校验 + 复现双通过 → verified', () => {
    const r = assessExamination({ question: baseQ, answerCheck: () => ok, reproduction: () => ok });
    expect(r.outcome).toBe('verified');
    expect(r.votes).toHaveLength(2);
  });

  it('任一票失败 → failed 并降级记原因（两票各占一票地位）', () => {
    const r1 = assessExamination({ question: baseQ, answerCheck: () => bad, reproduction: () => ok });
    expect(r1.outcome).toBe('failed');
    expect(r1.failureReason).toContain('answer-check');
    const r2 = assessExamination({ question: baseQ, answerCheck: () => ok, reproduction: () => bad });
    expect(r2.outcome).toBe('failed');
    expect(r2.failureReason).toContain('reproduction');
  });

  it('model-judge 域评分器与被考核模型同 id → 独立性硬门即拒', () => {
    const mq = { ...baseQ, domainTier: 'model-judge' as const };
    const r = assessExamination({
      question: mq, answerCheck: () => ok, reproduction: () => ok,
      judgeModelId: 'qwen-27b', examineeModelId: 'qwen-27b',
    });
    expect(r.outcome).toBe('failed');
    expect(r.failureReason).toContain('独立性硬门');
  });

  it('model-judge 域双 id 齐备且不同 → 正常判定', () => {
    const mq = { ...baseQ, domainTier: 'model-judge' as const };
    const r = assessExamination({
      question: mq, answerCheck: () => ok, reproduction: () => ok,
      judgeModelId: 'judge-model-a', examineeModelId: 'executor-model-b',
    });
    expect(r.outcome).toBe('verified');
  });

  it('model-judge 域缺任一 modelId → 拒（断言面必须可判）', () => {
    const mq = { ...baseQ, domainTier: 'model-judge' as const };
    const r = assessExamination({ question: mq, answerCheck: () => ok, reproduction: () => ok });
    expect(r.outcome).toBe('failed');
    expect(r.failureReason).toContain('modelId');
  });
});

describe('章四 · 沉淀裁决三态', () => {
  const verifiedResult = {
    instinctId: 'inst-1', questionId: 'exq-1',
    votes: [
      { vote: 'answer-check' as const, pass: true, basis: 'ok' },
      { vote: 'reproduction' as const, pass: true, basis: 'ok' },
    ],
    outcome: 'verified' as const,
    sedimentVerdict: 'SAVE' as const,
  };
  const existing = [
    { id: 'inst-0', pattern: '提交前先跑 shellcheck 检查' },
  ];

  it('考核通过 + 无近似 → SAVE', () => {
    const r = decideSedimentation(verifiedResult, existing, () => false);
    expect(r.sedimentVerdict).toBe('SAVE');
  });

  it('考核通过 + 近似项在册 → FOLD_INTO（并入目标 + 升版本）', () => {
    const r = decideSedimentation(verifiedResult, existing, (_c, e) => e.id === 'inst-0');
    expect(r.sedimentVerdict).toBe('FOLD_INTO');
    expect(r.foldIntoId).toBe('inst-0');
  });

  it('考核未通过 → NOTHING_TO_SAVE（显式落账——审过无货 ≠ 未审）', () => {
    const failed = { ...verifiedResult, outcome: 'failed' as const };
    const r = decideSedimentation(failed, existing, () => false);
    expect(r.sedimentVerdict).toBe('NOTHING_TO_SAVE');
  });
});

describe('章四 · 不捕获清单（硬门）', () => {
  it('四类命中即拒（拒收记录可审计）', () => {
    expect(checkDoNotCapture({ id: 'a', pattern: '缺少 credential 二进制依赖' })?.kind).toBe('environment-dependent');
    expect(checkDoNotCapture({ id: 'b', pattern: '不要用 npm 工具' })?.kind).toBe('tool-negative-claim');
    expect(checkDoNotCapture({ id: 'c', pattern: 'ECONNRESET 超时后重试成功' })?.kind).toBe('transient-retryable');
    expect(checkDoNotCapture({ id: 'd', pattern: '一次性任务 仅此一次' })?.kind).toBe('one-off-narrative');
  });

  it('正常教训不误拒', () => {
    expect(checkDoNotCapture({ id: 'e', pattern: '提交前先跑 shellcheck' })).toBeNull();
  });
});

describe('章四 · 佐证门', () => {
  it('有挽回佐证 + 重复出现 → 送审', () => {
    const v = checkCorroborationGate({ id: 'x', occurrences: 3 }, { recovered: true });
    expect(v.sendToExam).toBe(true);
  });

  it('仅复杂信号（弱证据）→ 登记在册待补，非静默丢弃', () => {
    const v = checkCorroborationGate({ id: 'x', occurrences: 1 }, { complexOnly: true });
    expect(v.sendToExam).toBe(false);
    expect(v.pending).toBeDefined();
    expect(v.pending!.awaiting).toContain('recovered');
    expect(v.pending!.awaiting).toContain('recurring');
    expect(v.pending!.signal).toBe('complex-only');
  });
});

describe('章四 · 考核态进 scorer 置信度（单调性双向）', () => {
  it('verified 必升（×1.25 后截断 [0,1]）', () => {
    expect(applyExamStatusWeight(0.6, 'verified')).toBeCloseTo(Math.min(1, 0.6 * VERIFIED_CONFIDENCE_MULTIPLIER));
    expect(applyExamStatusWeight(0.6, 'verified')).toBeGreaterThan(0.6);
    expect(applyExamStatusWeight(0.95, 'verified')).toBeLessThanOrEqual(1); // 截断
  });

  it('failed 必降（×0.5）', () => {
    expect(applyExamStatusWeight(0.8, 'failed')).toBeCloseTo(0.8 * FAILED_CONFIDENCE_MULTIPLIER);
    expect(applyExamStatusWeight(0.8, 'failed')).toBeLessThan(0.8);
  });

  it('unexamined 不变（中性）', () => {
    expect(applyExamStatusWeight(0.7, 'unexamined')).toBe(0.7);
  });

  it('既有评分面零回归（scoreInstinct 行为不变）', () => {
    const s = scoreInstinct({
      id: 'i', pattern: 'p', source: 'think', occurrences: 3, passCount: 2, failCount: 1, lastSeen: '2026-10-09T00:00:00Z',
    });
    expect(s.coverage).toBe(1);
    expect(s.passRate).toBeCloseTo(2 / 3);
    expect(s.confidence).toBeCloseTo(2 / 3);
  });
});

describe('章四 · 考核态写回池（与第三章闭环）', () => {
  it('verified 结果 → 池条目 verified 态', () => {
    const item: StoredInstinct = {
      id: 'i1', pattern: 'p', source: 'think', occurrences: 3, passCount: 3, failCount: 0, lastSeen: '2026-10-09T00:00:00Z',
      verified: 'unexamined',
    };
    const updated = applyExamResultToPoolItem(item, {
      instinctId: 'i1', questionId: 'q1',
      votes: [
        { vote: 'answer-check', pass: true, basis: 'ok' },
        { vote: 'reproduction', pass: true, basis: 'ok' },
      ],
      outcome: 'verified', sedimentVerdict: 'SAVE',
    });
    expect(updated.verified).toBe('verified');
  });
});
