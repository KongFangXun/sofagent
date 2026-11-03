// ============================================================
// replay.test.ts · v1.8.0 §五 可复现重放单测
// ============================================================
import { describe, it, expect } from 'vitest';
import { replayDecision, assertReplayDeterminism, type ReplayArtifactFingerprint } from '../replay';
import type { DecisionRequest } from '../../decision-primitives';
import type { EncoderLike } from '../../judge-heads';

const enc: EncoderLike = {
  modelRevision: 'test-rev',
  maxContextTokens: 4096,
  encode: (s: string) => [[...s].map((c) => c.charCodeAt(0) % 97)],
  isSingleToken: () => true,
  decodeToken: (t: number) => String.fromCharCode(t),
};

const FP: ReplayArtifactFingerprint = {
  weightsSha256: 'a'.repeat(64),
  judgeHeadSha256: 'b'.repeat(64),
  criteriaVersion: 'criteria/2026-11-03',
  redactionVersion: 'redaction/v1',
};

const REQ: DecisionRequest = {
  state: '重放验证：把订单按金额分档。',
  questions: [
    { id: 'q1', kind: 'noul', question: '是否人工复核' },
    { id: 'q2', kind: 'score', question: '置信度', min: 0, max: 10 },
  ],
};

describe('v1.8.0 §五 · 判定可复现重放', () => {
  it('三件套指纹齐 + 调用方传入 state → 重放出概率分布（不落盘不联网）', () => {
    const r = replayDecision(FP, REQ, enc);
    expect(r.ok).toBe(true);
    expect(r.answers).toHaveLength(2);
    expect(r.answers![0]!.kind).toBe('noul');
    expect(r.answers![1]!.kind).toBe('score');
  });

  it('三件套缺一即拒（不可复现的重放没有意义）', () => {
    const bad = { ...FP, criteriaVersion: '' };
    const r = replayDecision(bad, REQ, enc);
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toContain('制品指纹缺失');
  });

  it('同一制品 + 同一 state 两次重放分布逐字段一致 ⇒ 可复现（确定性闸门）', () => {
    const chk = assertReplayDeterminism(FP, REQ, enc);
    expect(chk.reproducible).toBe(true);
  });
});
