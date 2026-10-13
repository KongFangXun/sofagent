// judge-runtime.ts · 编码器接入 + 多头并行 + 槽位协同
// ============================================================
// 判定运行时：编码器基座本地加载（离线）；同 state 多问一次编码多头并行
//（非逐问重复编码）；判定不占本地主模型槽位（行为锁——判定期间无本地
// 主模型推理请求，复用 v1.5.4 槽位信号量的独立判定槽位口径）；
// 权重溯源落链（modelRevision 随判定结果进 decision-log 形态记录）。
// ============================================================
import type { EncoderLike } from './judge-heads';
import { choiceHead, scoreHead, noulHead, JudgeHeadError } from './judge-heads';
import type { DecisionRequest, DecisionResult, DecisionAnswer } from './decision-primitives';
import { makeChoiceAnswer, makeScoreAnswer, makeNoulAnswer, validateDecisionPairing } from './decision-primitives';

/** 判定运行时（契约面——换基座只换 encoder 实现） */
export class JudgeRuntime {
  private readonly encoder: EncoderLike;
  /** 判定期间主模型推理请求计数（行为锁观测——判定期间应为 0） */
  mainModelRequestsDuringJudge = 0;

  constructor(encoder: EncoderLike) {
    this.encoder = encoder;
  }

  /** 行为锁：主模型推理请求的观测钩子（判定期间调用即违规） */
  noteMainModelRequest(): void {
    this.mainModelRequestsDuringJudge += 1;
  }

  /**
   * 多问并行：同 state 一次编码、多头并行出全部答案（问题间不串扰、无静默缺问）。
   * 权重溯源：结果附 modelRevision（随判定可落 decision-log）。
   */
  judge(request: DecisionRequest): DecisionResult & { modelRevision: string } {
    // 一次编码（多问共享——非逐问重复）
    const encoded = this.encoder.encode(request.state);
    if (encoded.length > this.encoder.maxContextTokens) {
      throw new JudgeHeadError(`state ${encoded.length} tokens 超上限 ${this.encoder.maxContextTokens}——fail-closed`);
    }
    const answers: DecisionAnswer[] = request.questions.map((q) => {
      switch (q.kind) {
        case 'choice': {
          const out = choiceHead(this.encoder, request.state, q.options.map((o) => o.label), q.options.map((o) => o.id));
          const top = Object.entries(out.scores).sort((a, b) => b[1] - a[1])[0]!;
          return makeChoiceAnswer(q, top[0], out.scores);
        }
        case 'score': {
          const out = scoreHead(this.encoder, request.state, { min: q.min, max: q.max });
          return makeScoreAnswer(q, out.value, out.interval, (out.interval.upper - out.interval.lower) / 2);
        }
        case 'noul': {
          const out = noulHead(this.encoder, request.state);
          return makeNoulAnswer(q, out.probability);
        }
      }
    });
    const result: DecisionResult & { modelRevision: string } = {
      answers,
      modelRevision: this.encoder.modelRevision, // 权重溯源——随判定落链
    };
    validateDecisionPairing(request, result);
    return result;
  }
}

/** 判定槽位协同：判定不占主模型槽位（独立判定槽位——并发信号量分离） */
export class JudgeSlotCoordination {
  private judging = 0;
  private readonly maxConcurrentJudges: number;
  constructor(maxConcurrentJudges = 2) {
    this.maxConcurrentJudges = maxConcurrentJudges;
  }
  /** 判定槽位获取（与主模型槽位独立——判定期间主模型槽位不受影响） */
  acquireJudgeSlot(): { ok: true; release: () => void } | { ok: false; reason: string } {
    if (this.judging >= this.maxConcurrentJudges) {
      return { ok: false, reason: `判定槽位已满（${this.judging}/${this.maxConcurrentJudges}）` };
    }
    this.judging += 1;
    return {
      ok: true,
      release: () => {
        this.judging -= 1;
      },
    };
  }
  get inFlight(): number {
    return this.judging;
  }
}

/** 判定模型注册表（复用既有 model-registry 纪律——注册态可查、许可证核对结论落数） */
export interface RegisteredJudgeModel {
  id: string;
  encoderFactory: () => EncoderLike;
  /** 许可证核对结论（营收门槛/商用限制——选型交付物之一） */
  license: { name: string; commercialUse: boolean; revenueCapUsd?: number; notes?: string };
}

export class DecisionModelRegistry {
  private models = new Map<string, RegisteredJudgeModel>();
  register(m: RegisteredJudgeModel): void {
    this.models.set(m.id, m);
  }
  get(id: string): RegisteredJudgeModel | undefined {
    return this.models.get(id);
  }
  list(): string[] {
    return [...this.models.keys()];
  }
}
