// ============================================================
// replay.ts · v1.9.0 §五 判定可复现重放执行器
// ============================================================
// 制品三件套指纹（权重 sha256 / 判定头 sha256 / 判据集版本）+ 脱敏层版本 +
// state 快照 → 离线重放出同一概率分布。
//
// 受红注⑥⑥ 口径：本版**不要求本仓留存快照**——state 由调用方传入
// （§二 消费面③「本版不落盘，重放时由调用方传入 state」同源）。
// 判据 = 同一制品三件套 + 同一脱敏层版本 + 同一 state ⇒ 重放输出的
// 概率分布与首次判定一致（替身 encoder 的确定性使该断言可机械验证；
// 真权重的分布一致性由 §一 跨仓回执面按 runner 实测）。
// ============================================================

import type { EncoderLike } from '../router/judge-heads';
import { choiceHead, scoreHead, noulHead } from '../router/judge-heads';
import type { DecisionRequest, DecisionResult } from '../router/decision-primitives';
import { makeChoiceAnswer, makeScoreAnswer, makeNoulAnswer } from '../router/decision-primitives';

/** 制品三件套指纹（重放的身份面——三件不齐即拒） */
export interface ReplayArtifactFingerprint {
  /** 权重制品 sha256（weights-manifest 的版本目录哈希） */
  weightsSha256: string;
  /** 判定头 sha256（实现版本锚——与 modelIdentity 对齐） */
  judgeHeadSha256: string;
  /** 判据集版本（criteriaVersion——与 §二 provenance 四件同源） */
  criteriaVersion: string;
  /** 脱敏层版本（redactionVersion——state 构造口径的代次锚） */
  redactionVersion: string;
}

/** 重放结果：概率分布 + 一致性判读 */
export interface ReplayOutcome {
  ok: boolean;
  issues: string[];
  /** 重放出的答案集（与首次判定同构——概率分布面） */
  answers?: DecisionResult['answers'];
}

/**
 * 离线重放：给定制品三件套指纹 + state 快照（调用方传入）+ 同一 encoder
 * 实现，重放出概率分布。**不落盘、不联网**（离线语义：重放期间零网络调用）。
 */
export function replayDecision(
  artifacts: ReplayArtifactFingerprint,
  request: DecisionRequest,
  encoder: EncoderLike,
): ReplayOutcome {
  const issues: string[] = [];
  // 三件套完整性（缺一即拒——不可复现的重放没有意义）
  for (const [k, v] of Object.entries(artifacts)) {
    if (typeof v !== 'string' || v.trim() === '') issues.push(`制品指纹缺失：${k}`);
  }
  if (issues.length > 0) return { ok: false, issues };

  // 重放（与 judge-runtime 模型路径同构——一次编码多头并行；
  // 确定性前置不在重放面：重放判「模型路径的概率分布」，确定性答案无概率语义）
  const encoded = encoder.encode(request.state);
  if (encoded.length > encoder.maxContextTokens) {
    return { ok: false, issues: [`state ${encoded.length} tokens 超上限——重放 fail-closed`] };
  }
  const sharedEncoder: EncoderLike = {
    modelRevision: encoder.modelRevision,
    maxContextTokens: encoder.maxContextTokens,
    encode: (state: string) => (state === request.state ? encoded : encoder.encode(state)),
    isSingleToken: (t: string) => encoder.isSingleToken(t),
    decodeToken: (t: number) => encoder.decodeToken(t),
    ...((encoder as { vocabChunkSize?: number }).vocabChunkSize !== undefined
      ? { vocabChunkSize: (encoder as { vocabChunkSize?: number }).vocabChunkSize }
      : {}),
  };
  const answers: import('../router/decision-primitives').DecisionAnswer[] = request.questions.map((q: import('../router/decision-primitives').DecisionQuestion) => {
    switch (q.kind) {
      case 'choice': {
        const out = choiceHead(sharedEncoder, request.state, q.options.map((o) => o.label), q.options.map((o) => o.id));
        const top = (Object.entries(out.scores) as [string, number][]).sort((a, b) => b[1] - a[1])[0]!;
        return makeChoiceAnswer(q, top[0], out.scores);
      }
      case 'score': {
        const out = scoreHead(sharedEncoder, request.state, { min: q.min, max: q.max });
        return makeScoreAnswer(q, out.value, out.interval, (out.interval.upper - out.interval.lower) / 2);
      }
      case 'noul': {
        const out = noulHead(sharedEncoder, request.state);
        return makeNoulAnswer(q, out.probability);
      }
    }
  });
  return { ok: true, issues: [], answers };
}

/**
 * 重放一致性判定（可复现性闸门）：同一制品三件套 + 同一 state 的两次重放，
 * 概率分布逐字段一致 ⇒ 可复现。漂移 ⇒ 不可复现（制品或实现漂了）。
 */
export function assertReplayDeterminism(
  artifacts: ReplayArtifactFingerprint,
  request: DecisionRequest,
  encoder: EncoderLike,
): { reproducible: boolean; issues: string[] } {
  const a = replayDecision(artifacts, request, encoder);
  const b = replayDecision(artifacts, request, encoder);
  if (!a.ok || !b.ok) return { reproducible: false, issues: [...a.issues, ...b.issues] };
  const sa = JSON.stringify(a.answers);
  const sb = JSON.stringify(b.answers);
  return sa === sb
    ? { reproducible: true, issues: [] }
    : { reproducible: false, issues: ['两次重放概率分布不一致——制品或实现漂移（不可复现）'] };
}
