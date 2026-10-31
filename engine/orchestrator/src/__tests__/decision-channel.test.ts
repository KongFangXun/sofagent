// ============================================================
// decision-channel.test.ts · DecisionChannel 契约与回落面单测（v1.8.0 §一 S1）
//
// 覆盖 §一 验收中可在**无真权重**条件下机械核的部分：
//   ① 契约可插拔——默认（未配置）/ 替身 A / 替身 B 三实现，对同一组问句须满足
//      同一套契约（`assertContractCompliance` 全过 / 或按契约拒绝），实现可换契约不动
//   ② 七路回落面逐路单测——通道级五路（load-failed / weights-missing / channel-error /
//      timeout / type-mismatch）+ 答案级两路（abstained / low-confidence），
//      每路都落 L0 且原因可查（§一 验收「回落路径补全」要求逐路单测）
//   ③ 失败语义 fail-closed——异常不得静默放行，必须归因到七路之一
//   ④ 契约扩展位存在且**不侵入** `judge` 签名（类型占位，不改行为）
//
// 不在本文件覆盖（需真权重 / 实机，归 S2/S3）：
//   真模型 L1 可用 · 两档加载策略三读数 · decision-log 落盘 · 不占主槽位行为锁
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  assertContractCompliance,
  CHANNEL_LEVEL_REASONS,
  classifyJudgeError,
  createUnconfiguredDecisionChannel,
  DecisionChannelUnavailableError,
  resolveFallback,
  TypeMismatchError,
  type DecisionChannel,
  type DecisionQuestion,
  type DecisionResult,
  type DecisionState,
} from '../router/decision-channel';

/** 一组固定问句（契约测试的锚——换实现时问句不变，答案须同构）。 */
const QUESTIONS: DecisionQuestion[] = [
  { id: 'q1', primitive: 'choice', options: ['ALLOW', 'ASK', 'ABSTAIN', 'DENY', 'other'], fallback: 'other' },
  { id: 'q2', primitive: 'score', range: { min: 0, max: 1 } },
  { id: 'q3', primitive: 'noul' },
];

const STATE: DecisionState = { text: '把这条变更交给执行档，是否需要人工复核？', evidenceReadiness: 'none' };

/** 合规的替身实现（照契约产出答案）。 */
class FakeChannel implements DecisionChannel {
  readonly name: string;
  constructor(name = 'fake') {
    this.name = name;
  }
  async judge(_state: DecisionState, questions: DecisionQuestion[]): Promise<DecisionResult> {
    return {
      modelVersion: 'fake-test-v0',
      tempBucket: 'choice-5',
      latencyMs: 1,
      answers: questions.map((q) => {
        if (q.primitive === 'choice') {
          return {
            id: q.id,
            value: 'ALLOW',
            probability: 0.7,
            distribution: { ALLOW: 0.7, ASK: 0.1, ABSTAIN: 0.1, DENY: 0.05, other: 0.05 },
            status: 'answered' as const,
          };
        }
        if (q.primitive === 'score') {
          return { id: q.id, value: 0.6, probability: 0.6, interval: { min: 0, max: 1 }, status: 'answered' as const };
        }
        return { id: q.id, value: true, probability: 0.8, status: 'answered' as const };
      }),
    };
  }
}

describe('v1.8.0 §一 · 契约可插拔（换实现不动契约）', () => {
  it('替身 A / 替身 B 两个不同实现，对同一组问句都产出合规结果（契约面一致）', async () => {
    for (const impl of [new FakeChannel('impl-a'), new FakeChannel('impl-b')]) {
      const res = await impl.judge(STATE, QUESTIONS);
      expect(assertContractCompliance(res, QUESTIONS)).toEqual([]);
    }
  });

  it('未配置实现按契约拒绝（抛 DecisionChannelUnavailableError），不得静默返回空答案', async () => {
    const ch = createUnconfiguredDecisionChannel();
    await expect(ch.judge(STATE, QUESTIONS)).rejects.toBeInstanceOf(DecisionChannelUnavailableError);
  });

  it('契约扩展位是**平行接口**——未配置通道不带 govern（不侵入 judge）', () => {
    const ch = createUnconfiguredDecisionChannel() as unknown as Record<string, unknown>;
    expect(typeof ch.judge).toBe('function');
    expect(ch.govern).toBeUndefined();
  });
});

describe('v1.8.0 §一 · 七路回落面（逐路单测）', () => {
  const cases: Array<[Parameters<typeof resolveFallback>[0], boolean]> = [
    ['load-failed', true],
    ['weights-missing', true],
    ['channel-error', true],
    ['timeout', true],
    ['type-mismatch', true],
    ['abstained', false],
    ['low-confidence', false],
  ];

  it('七路枚举齐备且每路都落 L0', () => {
    expect(cases).toHaveLength(7);
    for (const [reason, channelLevel] of cases) {
      const d = resolveFallback(reason, 'test');
      expect(d.layer).toBe('L0');
      expect(d.reason).toBe(reason);
      expect(d.detail).toBe('test');
      expect(d.channelLevel).toBe(channelLevel);
    }
  });

  it('通道级/答案级分类与 CHANNEL_LEVEL_REASONS 一致（防两处口径漂移）', () => {
    for (const [reason, channelLevel] of cases) {
      expect(CHANNEL_LEVEL_REASONS.includes(reason)).toBe(channelLevel);
    }
  });

  it('回落原因可查：detail 原样保留（不吞错因）', () => {
    const d = resolveFallback('timeout', 'judge 超过 800ms 未返回');
    expect(d.detail).toContain('800ms');
  });
});

describe('v1.8.0 §一 · 通道级五路归因（异常 → 原因）', () => {
  it('权重缺失：DecisionChannelUnavailableError 且消息含「权重」', () => {
    const e = new DecisionChannelUnavailableError('判定件权重缺失：/models/v6-s20261030 不存在');
    expect(classifyJudgeError(e)).toBe('weights-missing');
  });

  it('加载失败：同型错误但非权重问题', () => {
    expect(classifyJudgeError(new DecisionChannelUnavailableError('判定通道未配置'))).toBe('load-failed');
  });

  it('超时：AbortError 或消息含 timeout/超时', () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(classifyJudgeError(abort)).toBe('timeout');
    expect(classifyJudgeError(new Error('judge timeout after 800ms'))).toBe('timeout');
    expect(classifyJudgeError(new Error('判定超时'))).toBe('timeout');
  });

  it('类型不符：TypeMismatchError 优先于兜底 channel-error', () => {
    expect(classifyJudgeError(new TypeMismatchError('distribution 和 0.83 ≠ 1'))).toBe('type-mismatch');
  });

  it('其余异常一律 channel-error（fail-closed，不静默放行）', () => {
    expect(classifyJudgeError(new Error('ECONNREFUSED'))).toBe('channel-error');
    expect(classifyJudgeError('字符串异常')).toBe('channel-error');
    expect(classifyJudgeError(undefined)).toBe('channel-error');
  });
});

describe('v1.8.0 §一 · 契约合规校验（负向用例：每类不合规都必须被抓到）', () => {
  const base = async () => new FakeChannel().judge(STATE, QUESTIONS);

  it('合规结果返回空问题清单（阳性对照）', async () => {
    expect(assertContractCompliance(await base(), QUESTIONS)).toEqual([]);
  });

  it('① 答案 id 集与问句集不一致', async () => {
    const r = await base();
    r.answers = r.answers.slice(0, 2);
    expect(assertContractCompliance(r, QUESTIONS).join()).toContain('id 集');
  });

  it('② abstained 缺 abstainReason', async () => {
    const r = await base();
    r.answers[0] = { ...r.answers[0], status: 'abstained' };
    expect(assertContractCompliance(r, QUESTIONS).join()).toContain('abstainReason');
  });

  it('③ 概率越界 / distribution 和 ≠ 1', async () => {
    const bad1 = await base();
    bad1.answers[0] = { ...bad1.answers[0], probability: 1.4 };
    expect(assertContractCompliance(bad1, QUESTIONS).join()).toContain('probability 越界');

    const bad2 = await base();
    bad2.answers[0] = { ...bad2.answers[0], distribution: { ALLOW: 0.5, ASK: 0.3 } };
    expect(assertContractCompliance(bad2, QUESTIONS).join()).toContain('distribution 和');
  });

  it('④ modelVersion / tempBucket 空、latencyMs 负', async () => {
    const r = await base();
    r.modelVersion = '';
    r.tempBucket = '';
    r.latencyMs = -1;
    const problems = assertContractCompliance(r, QUESTIONS).join();
    expect(problems).toContain('modelVersion');
    expect(problems).toContain('tempBucket');
    expect(problems).toContain('latencyMs');
  });
});
