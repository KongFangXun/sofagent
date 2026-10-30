// judge-runtime.ts · 编码器接入 + 多头并行 + 槽位协同 + 确定性前置路由
// ============================================================
// 判定运行时：编码器基座本地加载（离线）；同 state 多问一次编码多头并行
//（非逐问重复编码）；判定不占本地主模型槽位（行为锁——判定期间无本地
// 主模型推理请求，复用 v1.5.4 槽位信号量的独立判定槽位口径）；
// 权重溯源落链（modelRevision 随判定结果进 decision-log 形态记录）。
// v1.7.0 §五 生产装配：judgeFullOutputs 把判定头原始输出装配为三原语
// 完整概率面（choice 分布+熵 / score 区间+序 / noul 概率+四态）——
// 判定输出的汇聚点在此（多头结果 → FullOutput 的唯一生产装配位）。
//
// v1.7.x 修补线 · 确定性前置路由（架构师设计）：构造器第二参注入
// DeterministicJudge | null（缺省 new DeterministicJudge() 开启——主理人
// 裁决⑤；传 null 关闭 = A/B 对照口径）。judge()/judgeFullOutputs() 入口
// 逐问 solveQuestion：命中问句**完全绕过 encoder**（不 encode 不过
// isSingleToken 校验——确定性答案不依赖基座）；全命中 = 零编码快速路径；
// 部分命中 = 未命中问句走既有 encode+多头，答案按原序合并。确定性答案
// 带 source='deterministic' + deterministicTrace 留痕（decision-primitives）。
// ============================================================
import type { EncoderLike } from './judge-heads';
import { choiceHead, scoreHead, noulHead, JudgeHeadError } from './judge-heads';
import type { DecisionRequest, DecisionResult, DecisionAnswer, ChoiceQuestion, ScoreQuestion } from './decision-primitives';
import { makeChoiceAnswer, makeScoreAnswer, makeNoulAnswer, validateDecisionPairing } from './decision-primitives';
import { DeterministicJudge, RULE_FAMILY } from './deterministic-judge';
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
  /** 确定性判定核心（null = 关闭路由——A/B 对照口径） */
  private readonly deterministic: DeterministicJudge | null;
  /** 判定期间主模型推理请求计数（行为锁观测——判定期间应为 0） */
  mainModelRequestsDuringJudge = 0;

  constructor(encoder: EncoderLike, deterministic: DeterministicJudge | null = new DeterministicJudge()) {
    this.encoder = encoder;
    this.deterministic = deterministic;
  }

  /** 行为锁：主模型推理请求的观测钩子（判定期间调用即违规） */
  noteMainModelRequest(): void {
    this.mainModelRequestsDuringJudge += 1;
  }

  /**
   * 多问并行：同 state 一次编码、多头并行出全部答案（问题间不串扰、无静默缺问）。
   * 权重溯源：结果附 modelRevision（随判定可落 decision-log）。
   *
   * 确定性前置路由（v1.7.x 修补线）：逐问 solveQuestion——命中问句完全
   * 绕过 encoder（不 encode 不过 isSingleToken 校验）；全命中 = 零编码
   * 快速路径；部分命中 = 未命中问句走既有 encode+多头，答案按原序合并。
   * deterministic=null（构造器注入）时逐问全落模型（A/B 对照口径）。
   */
  judge(request: DecisionRequest): DecisionResult & { modelRevision: string } {
    const answers: DecisionAnswer[] = new Array(request.questions.length);
    const pending: number[] = []; // 待模型路径的问句下标（保持原序合并）

    // ① 确定性前置：逐问 solveQuestion（答案面 fail-closed 的 undefined
    //    与路由面 fail-open 的不识别统一落穿——语义收敛在返回值上）。
    //    optionsDef 喂入时剔除兜底项（isFallback）——数值比较族的兜底
    //（「以上都不是」类）是问句模板附加候选而非题目选项，非纯数字；
    //    复算下标按剔除后的自然序与 options_def 同构（评测侧同规则重建）。
    if (this.deterministic !== null) {
      request.questions.forEach((q, i) => {
        const optionsDef: Record<string, string> =
          q.kind === 'choice'
            ? Object.fromEntries(
                q.options.filter((o) => !o.isFallback).map((o, j) => [`opt${j}`, o.label]),
              )
            : {};
        const det = this.deterministic!.solveQuestion({
          state: request.state,
          instructions: q.question,
          optionsDef,
        });
        if (det === undefined) {
          pending.push(i);
          return;
        }
        const family = RULE_FAMILY[det.rule];
        if (family === 'choice' && q.kind === 'choice') {
          const choiceQ = q as ChoiceQuestion;
          // 下标映射与 optionsDef 构造同构（剔除兜底项后的自然序——
          // 复算下标指认非兜底候选，非 options 数组原位）
          const plainOptions = choiceQ.options.filter((o) => !o.isFallback);
          const selectedId = plainOptions[det.value]?.id;
          if (selectedId === undefined) {
            pending.push(i); // 复算下标越界（判别器与候选集不一致）→ 落穿
            return;
          }
          // 确定性答案的退化分布：选中项 1-ε、其余均摊 ε（makeChoiceAnswer
          // 要求全候选分布和≈1——确定性答案无概率语义，ε 仅保形态合法）
          const w = 1 / choiceQ.options.length;
          const dist: Record<string, number> = {};
          for (const o of choiceQ.options) {
            dist[o.id] = o.id === selectedId ? 1 - w * (choiceQ.options.length - 1) : w;
          }
          answers[i] = makeChoiceAnswer(choiceQ, selectedId, dist, undefined, {
            source: 'deterministic',
            deterministicTrace: det.trace,
          });
          return;
        }
        if (family === 'score' && q.kind === 'score') {
          const scoreQ = q as ScoreQuestion;
          if (det.value < scoreQ.min || det.value > scoreQ.max) {
            pending.push(i); // bandIdx 越问句值域（量表不匹配）→ 落穿
            return;
          }
          // 复算档位无亚档抖动：区间零宽、不确定度 0
          answers[i] = makeScoreAnswer(
            scoreQ,
            det.value,
            { lower: det.value, upper: det.value },
            0,
            { source: 'deterministic', deterministicTrace: det.trace },
          );
          return;
        }
        // 规则族与问句原语不符（路由面与请求面错位——防呆落穿，不硬答）
        pending.push(i);
      });
    } else {
      request.questions.forEach((_, i) => pending.push(i));
    }

    // ② 模型路径：仅未命中问句（一次编码多头共享——全命中则零编码）
    if (pending.length > 0) {
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
      for (const i of pending) {
        const q = request.questions[i]!;
        switch (q.kind) {
          case 'choice': {
            const out = choiceHead(sharedEncoder, request.state, q.options.map((o) => o.label), q.options.map((o) => o.id));
            const top = Object.entries(out.scores).sort((a, b) => b[1] - a[1])[0]!;
            answers[i] = makeChoiceAnswer(q, top[0], out.scores);
            break;
          }
          case 'score': {
            const out = scoreHead(sharedEncoder, request.state, { min: q.min, max: q.max });
            answers[i] = makeScoreAnswer(q, out.value, out.interval, (out.interval.upper - out.interval.lower) / 2);
            break;
          }
          case 'noul': {
            const out = noulHead(sharedEncoder, request.state);
            answers[i] = makeNoulAnswer(q, out.probability);
            break;
          }
        }
      }
    }

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
    const outputs: PrimitiveFullOutput[] = new Array(input.request.questions.length);
    const pending: number[] = [];

    // ① 确定性前置分流（与 judge() 同款）：命中问句完全绕过 encoder——
    //    choice → makeChoiceFullOutput（uncalibrated + 放行——确定性答案
    //    无概率语义，熵由构造器按退化分布算出；suggestedAction='放行'
    //    因复算结论无歧义）；score 族确定性档位同理走 makeScoreFullOutput。
    //    optionsDef 同款剔除兜底项（与 judge() 的下标映射同构）。
    if (this.deterministic !== null) {
      input.request.questions.forEach((q, i) => {
        const optionsDef: Record<string, string> =
          q.kind === 'choice'
            ? Object.fromEntries(
                q.options.filter((o) => !o.isFallback).map((o, j) => [`opt${j}`, o.label]),
              )
            : {};
        const det = this.deterministic!.solveQuestion({
          state: input.request.state,
          instructions: q.question,
          optionsDef,
        });
        if (det === undefined) {
          pending.push(i);
          return;
        }
        const family = RULE_FAMILY[det.rule];
        if (family === 'choice' && q.kind === 'choice') {
          const plainOptions = q.options.filter((o) => !o.isFallback);
          const selectedId = plainOptions[det.value]?.id;
          if (selectedId === undefined) {
            pending.push(i);
            return;
          }
          const w = 1 / q.options.length;
          const dist: Record<string, number> = {};
          for (const o of q.options) {
            dist[o.id] = o.id === selectedId ? 1 - w * (q.options.length - 1) : w;
          }
          outputs[i] = makeChoiceFullOutput({
            questionId: q.id,
            selected: selectedId,
            distribution: dist,
            calibrationStatus,
            suggestedAction: '放行',
          });
          return;
        }
        if (family === 'score' && q.kind === 'score') {
          if (det.value < q.min || det.value > q.max) {
            pending.push(i);
            return;
          }
          outputs[i] = makeScoreFullOutput({
            questionId: q.id,
            value: det.value,
            credibleInterval: { lower: det.value, upper: det.value },
            min: q.min,
            max: q.max,
            ordinalTotal: 3,
            calibrationStatus,
            suggestedAction: '放行',
          });
          return;
        }
        pending.push(i);
      });
    } else {
      input.request.questions.forEach((_, i) => pending.push(i));
    }

    // ② 模型路径（未命中问句——一次编码多头共享）
    if (pending.length > 0) {
      const encoded = this.encoder.encode(input.request.state);
      const sharedEncoder: EncoderLike = {
        modelRevision: this.encoder.modelRevision,
        maxContextTokens: this.encoder.maxContextTokens,
        encode: (state: string): number[][] => (state === input.request.state ? encoded : this.encoder.encode(state)),
        isSingleToken: (text: string): boolean => this.encoder.isSingleToken(text),
        decodeToken: (token: number): string => this.encoder.decodeToken(token),
      };
      for (const i of pending) {
        const q = input.request.questions[i]!;
        switch (q.kind) {
          case 'choice': {
            const out = choiceHead(sharedEncoder, input.request.state, q.options.map((o) => o.label), q.options.map((o) => o.id));
            const top = Object.entries(out.scores).sort((a, b) => b[1] - a[1])[0]!;
            outputs[i] = makeChoiceFullOutput({
              questionId: q.id,
              selected: top[0],
              distribution: out.scores,
              calibrationStatus,
              // 高熵（选项接近）→ 建议「复核」；低熵（判定明确）→ 建议「放行」
              suggestedAction: '复核',
            });
            break;
          }
          case 'score': {
            const out = scoreHead(sharedEncoder, input.request.state, { min: q.min, max: q.max });
            outputs[i] = makeScoreFullOutput({
              questionId: q.id,
              value: out.value,
              credibleInterval: out.interval,
              min: q.min,
              max: q.max,
              ordinalTotal: 3,
              calibrationStatus,
              suggestedAction: '复核',
            });
            break;
          }
          case 'noul': {
            const out = noulHead(sharedEncoder, input.request.state);
            outputs[i] = makeNoulFullOutput({
              questionId: q.id,
              probability: out.probability,
              segmentBoundaries,
              calibrationStatus,
              suggestedAction: '复核',
            });
            break;
          }
        }
      }
    }
    return outputs;
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
