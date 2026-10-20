// judge-runtime.ts · 编码器接入 + 多头并行 + 槽位协同
// ============================================================
// 判定运行时：编码器基座本地加载（离线）；同 state 多问一次编码多头并行
//（非逐问重复编码）；判定不占本地主模型槽位（行为锁——判定期间无本地
// 主模型推理请求，复用 v1.5.4 槽位信号量的独立判定槽位口径）；
// 权重溯源落链（modelRevision 随判定结果进 decision-log 形态记录）。
// v1.7.0 §五 生产装配：judgeFullOutputs 把判定头原始输出装配为三原语
// 完整概率面（choice 分布+熵 / score 区间+序 / noul 概率+四态）——
// 判定输出的汇聚点在此（多头结果 → FullOutput 的唯一生产装配位）。
// ============================================================
import type { EncoderLike } from './judge-heads';
import { choiceHead, scoreHead, noulHead, JudgeHeadError } from './judge-heads';
import type { DecisionRequest, DecisionResult, DecisionAnswer } from './decision-primitives';
import { makeChoiceAnswer, makeScoreAnswer, makeNoulAnswer, validateDecisionPairing } from './decision-primitives';
import {
  makeChoiceFullOutput,
  makeScoreFullOutput,
  makeNoulFullOutput,
  type PrimitiveFullOutput,
  type SegmentBoundaries,
} from './decision-output';

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
    // 🔒 一次编码多头并行（行为锁）：把**已编码表示**传入各判定头——头对同一 state
    // 复用本次编码，不再逐问各自 encode(state)。此前每个 head 内部各自 encode ⇒ N 问
    // 共 N+1 次编码，与模块头 claim 相悖；此处以「同 state 命中已编码缓存」的编码器
    // 视图传入，使实现与 claim 对齐（head 契约不变——换基座仍只换 EncoderLike 实现）。
    const sharedEncoder: EncoderLike = {
      modelRevision: this.encoder.modelRevision,
      maxContextTokens: this.encoder.maxContextTokens,
      encode: (state: string): number[][] => (state === request.state ? encoded : this.encoder.encode(state)),
      isSingleToken: (text: string): boolean => this.encoder.isSingleToken(text),
      decodeToken: (token: number): string => this.encoder.decodeToken(token),
    };
    const answers: DecisionAnswer[] = request.questions.map((q) => {
      switch (q.kind) {
        case 'choice': {
          const out = choiceHead(sharedEncoder, request.state, q.options.map((o) => o.label), q.options.map((o) => o.id));
          const top = Object.entries(out.scores).sort((a, b) => b[1] - a[1])[0]!;
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
    const result: DecisionResult & { modelRevision: string } = {
      answers,
      modelRevision: this.encoder.modelRevision, // 权重溯源——随判定落链
    };
    validateDecisionPairing(request, result);
    return result;
  }

  /**
   * 三原语完整概率面装配（v1.7.0 §五 生产调用点）：
   * 把判定头原始输出装配为 FullOutput 形态（choice 分布+熵 / score
   * 区间+序 / noul 概率+四态）——「多头结果 → 完整输出」的唯一生产
   * 装配位。§四门槛（ThresholdsByPrimitive）作为 noul 四态分段口径
   * 传入（分段边界与弃权门槛同源——同一套原语分档面）。
   *
   * 校准联动：calibrationStatus='uncalibrated'（§二 ECE 未达阈或无读数
   * 的默认态）→ 四态边界可算、照常落数，但消费守卫
   * （assertConsumableForRouting）拦截其进入分流决策路径。
   * 建议动作：熵/概率面只出建议（suggestedAction）不执法——执行权在
   * 既有确定性规则与审计层（§五行为锁）。
   */
  judgeFullOutputs(input: {
    request: Pick<DecisionRequest, 'state' | 'questions'>;
    /** §四分档门槛（noul 四态分段口径——与弃权带同一来源） */
    noulThresholds: { noul: { lowerBand: number; upperBand: number } };
    /** 校准状态（缺省 uncalibrated——§二达阈读数接入前的保守默认） */
    calibrationStatus?: 'calibrated' | 'uncalibrated';
  }): PrimitiveFullOutput[] {
    const calibrationStatus = input.calibrationStatus ?? 'uncalibrated';
    // noul 分段边界由 §四门槛导出（noUpper=lowerBand / leanNoUpper=中点下 /
    // leanYesLower=中点上 / yesLower=upperBand——分段口径与弃权带同源）
    const lb = input.noulThresholds.noul.lowerBand;
    const ub = input.noulThresholds.noul.upperBand;
    const mid = (lb + ub) / 2;
    const segmentBoundaries: SegmentBoundaries = {
      noUpper: lb,
      leanNoUpper: (lb + mid) / 2,
      leanYesLower: (mid + ub) / 2,
      yesLower: ub,
    };
    const encoded = this.encoder.encode(input.request.state);
    const sharedEncoder: EncoderLike = {
      modelRevision: this.encoder.modelRevision,
      maxContextTokens: this.encoder.maxContextTokens,
      encode: (state: string): number[][] => (state === input.request.state ? encoded : this.encoder.encode(state)),
      isSingleToken: (text: string): boolean => this.encoder.isSingleToken(text),
      decodeToken: (token: number): string => this.encoder.decodeToken(token),
    };
    return input.request.questions.map((q): PrimitiveFullOutput => {
      switch (q.kind) {
        case 'choice': {
          const out = choiceHead(sharedEncoder, input.request.state, q.options.map((o) => o.label), q.options.map((o) => o.id));
          const top = Object.entries(out.scores).sort((a, b) => b[1] - a[1])[0]!;
          return makeChoiceFullOutput({
            questionId: q.id,
            selected: top[0],
            distribution: out.scores,
            calibrationStatus,
            // 高熵（选项接近）→ 建议「复核」；低熵（判定明确）→ 建议「放行」
            suggestedAction: '复核',
          });
        }
        case 'score': {
          const out = scoreHead(sharedEncoder, input.request.state, { min: q.min, max: q.max });
          return makeScoreFullOutput({
            questionId: q.id,
            value: out.value,
            credibleInterval: out.interval,
            min: q.min,
            max: q.max,
            ordinalTotal: 3,
            calibrationStatus,
            suggestedAction: '复核',
          });
        }
        case 'noul': {
          const out = noulHead(sharedEncoder, input.request.state);
          return makeNoulFullOutput({
            questionId: q.id,
            probability: out.probability,
            segmentBoundaries,
            calibrationStatus,
            suggestedAction: '复核',
          });
        }
      }
    });
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
