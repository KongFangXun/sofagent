// calibration.ts · v1.7.0 §二 · 校准实现（分桶温度拟合 + 三原语分别校准 + TVD + 达阈判定）
// ============================================================
// 定位：概率可信度的施工面——「让模型报出的概率值匹配真实发生的频率」。
// §一（scoring-rules）让概率有训练目标，本文件让概率可信：
//   1. 分桶温度拟合 bucketedTemperatureFit——按置信度分桶、桶内一维温度
//      优化（黄金分割法，仓内不引新依赖）；分桶粒度由配置读取（断言面）；
//   2. 三原语分别校准——choice（多类 logits 温度）/ score（有序分档温度
//      + 保序约束——校准后档位 argmax 序不变）/ noul（伯努利温度）；
//   3. 校准集隔离 assertDisjoint——拟合输入按家族级键分组（与
//      decision-dataset-schema familyKeyOf 同构：contrastive.familyId 否则
//      血缘锚点键），训练/校准交集非空返回违规清单（交集非空则 ECE 达阈
//      不算数——达标的分母可能是它自己训练过的样本）；
//   4. 独立制品——calibration artifact 为纯 JSON（primitive/bucketCount/
//      temperatures/fitMetrics/evaluatorVersion/fittedAt），loadCalibration
//      无权重亦可加载（与权重制品解耦，换基座可单独重拟合）；
//   5. computeEce——标准分箱 ECE；**空样本返回 not-measured 哨兵（字符串）
//      而非 0**（ECE=0 在本版语义下是「完美校准」，空集给 0 = 未测谎报为
//      最优——与 v1.6.0 校准报告口径分立，本文件是 §二验收口径的 SSOT）；
//   6. 三态对照 buildCalibrationReport——zeroShot/trained/calibrated 三态
//      并列（第一态 = 训练基座本版实测，v1.6.0 mock 读数并列留档不进对照列
//      ——W4 judge-eval 接口对齐注释在位）；
//   7. knownProbabilityTvd——构造已知真值题集（P(A) 由构造已知）经三原语
//      查询的全变差距离评分（ECE 达阈不蕴含本项通过——两项分别落数）；
//   8. eceVerdict——对照 THRESHOLDS.md 冻结线 0.10 逐档（原语×语言）判定；
//      三段门控门槛按原语分档重标入口 thresholdsByPrimitive（校准合格
//      不是「默认阈值可用」的充分理由——断言面）。
//
// 数值口径：温度 T ∈ [T_MIN, T_MAX]，softmax(z/T) / sigmoid(logit/T) 严格
// 单调 ⇒ choice/noul 的 argmax 不因温度改变（保序对 choice 自动成立）；
// score 的保序约束在**档位序**面断言（校准后 argmax 档与校准前一致 +
// 相邻档概率序不变）。黄金分割法对单谷函数收敛（NLL 对 T 在 (0,∞) 单谷
// ——温度缩放的标准性质，Guo et al. 2017 形态）。
// ============================================================

import type { RlcdTrainSample } from './train-rlcd';

/** 校准件错误（fail-closed 载体） */
export class CalibrationError extends Error {
  constructor(message: string) {
    super(`[calibration] ${message}`);
    this.name = 'CalibrationError';
  }
}

/** 温度搜索区间下界（T→0 分布坍缩为 one-hot——搜索不开到 0） */
export const TEMPERATURE_MIN = 0.05;
/** 温度搜索区间上界（T→∞ 分布坍缩为均匀——上界封顶防无意义搜索） */
export const TEMPERATURE_MAX = 10;
/** 黄金分割收敛容差（区间宽度 < 此值即停） */
export const GOLDEN_SECTION_TOL = 1e-6;

// ════════════════════════════════════════
// 分桶配置（粒度由配置读取——断言面）
// ════════════════════════════════════════

/** 校准配置（分桶粒度落配置——SSOT §二交付表「分桶温度拟合」行） */
export interface CalibrationConfig {
  /** 分桶数（按置信度等宽分桶——bucketCount 由配置读取，缺省 10） */
  bucketCount: number;
}

/** 缺省校准配置（10 桶等宽——[0,0.1)...[0.9,1.0]，与 §三 ECE 分箱同口径） */
export const DEFAULT_CALIBRATION_CONFIG: CalibrationConfig = { bucketCount: 10 };

/**
 * 解析校准配置：bucketCount 须为 2–100 的整数（粒度可配但有界——桶数 1
 * 退化为全局温度非分桶、>100 在小样本下每桶空载）。读取断言面：本函数
 * 是 bucketCount 进拟合的唯一入口，测试断言「改配置 → 桶数变」。
 */
export function resolveCalibrationConfig(
  config?: Partial<CalibrationConfig>,
): CalibrationConfig {
  const bucketCount = config?.bucketCount ?? DEFAULT_CALIBRATION_CONFIG.bucketCount;
  if (!Number.isInteger(bucketCount) || bucketCount < 2 || bucketCount > 100) {
    throw new CalibrationError(
      `bucketCount=${bucketCount} 非法（须为 2–100 整数——分桶粒度有界，桶数 1 退化全局温度）`,
    );
  }
  return { bucketCount };
}

// ════════════════════════════════════════
// 原语侧数学件（温度作用面）
// ════════════════════════════════════════

/** 数值稳定 softmax(logits / T) */
function softmaxTemp(logits: readonly number[], temperature: number): number[] {
  const scaled = logits.map((l) => l / temperature);
  const m = Math.max(...scaled);
  const exps = scaled.map((l) => Math.exp(l - m));
  const s = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / s);
}

/** 数值稳定 sigmoid(logit / T)（伯努利温度作用面） */
function sigmoidTemp(logit: number, temperature: number): number {
  const z = logit / temperature;
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

/** log 钳制下界（与 scoring-rules.LOG_PROB_CLAMP 同量级——防 ±∞ 污染 NLL） */
const LOG_CLAMP = 1e-12;

/**
 * 黄金分割一维极小化（仓内自实现——不引新依赖）。
 * f 须为 [a,b] 上的单谷函数；返回 [x*, f(x*)]（区间宽度 < tol 即收敛）。
 */
export function goldenSectionMinimize(
  f: (x: number) => number,
  a: number,
  b: number,
  tol = GOLDEN_SECTION_TOL,
): { x: number; fx: number } {
  if (!(b > a)) throw new CalibrationError(`黄金分割区间非法（a=${a} ≥ b=${b}）`);
  const invPhi = (Math.sqrt(5) - 1) / 2; // 1/φ ≈ 0.618
  let lo = a;
  let hi = b;
  let c = hi - invPhi * (hi - lo);
  let d = lo + invPhi * (hi - lo);
  let fc = f(c);
  let fd = f(d);
  while (hi - lo > tol) {
    if (fc < fd) {
      hi = d;
      d = c;
      fd = fc;
      c = hi - invPhi * (hi - lo);
      fc = f(c);
    } else {
      lo = c;
      c = d;
      fc = fd;
      d = lo + invPhi * (hi - lo);
      fd = f(d);
    }
  }
  const x = (lo + hi) / 2;
  return { x, fx: f(x) };
}

// ════════════════════════════════════════
// 校准拟合样本（三原语统一形态）
// ════════════════════════════════════════

/** 三原语之一 */
export type CalibrationPrimitive = 'choice' | 'score' | 'noul';

/**
 * 校准拟合样本（三原语统一形态）：
 *   - noul：报出概率 p（由 logit = logit(p) 反解后做温度缩放）
 *   - choice / score：报出全档位分布 dist（由 logits = log(dist) 反解）
 *     ——choice 多类无序、score 有序（保序约束在 fit 输出面断言）
 * 真值侧：noul 0/1；choice/score one-hot 档位（确定性结果）或已知分布。
 */
export interface CalibrationFitItem {
  /** 原语类型 */
  primitive: CalibrationPrimitive;
  /** 语言（zh/en——达阈判定分原语×分语言逐档） */
  lang: 'zh' | 'en';
  /** 家族级键（隔离断言的分组单元——与 decision-dataset-schema familyKeyOf 同构） */
  familyKey: string;
  /** noul：报出概率（0/1 钳制到 [LOG_CLAMP, 1-LOG_CLAMP] 反解 logit） */
  reportedProb?: number;
  /** noul：事件是否发生 */
  outcome?: boolean;
  /** choice/score：报出分布（温度作用前——长度 ≥2，归一容差 1e-6） */
  reportedDist?: readonly number[];
  /** choice：实际选中项下标；score：实际档位下标（one-hot 真值侧） */
  realizedIndex?: number;
  /** score：真值分档分布（概率目标形态——与 realizedIndex 二选一） */
  truthDist?: readonly number[];
}

/** 拟合输入校验（fail-closed——缺字段/越界拒载） */
function assertFitItem(item: CalibrationFitItem): void {
  if (item.primitive === 'noul') {
    if (typeof item.reportedProb !== 'number' || typeof item.outcome !== 'boolean') {
      throw new CalibrationError('noul 拟合项缺 reportedProb/outcome（fail-closed 拒载）');
    }
    if (item.reportedProb < 0 || item.reportedProb > 1) {
      throw new CalibrationError(`noul reportedProb=${item.reportedProb} 越界 [0,1]`);
    }
    return;
  }
  if (!Array.isArray(item.reportedDist) || (item.reportedDist as number[]).length < 2) {
    throw new CalibrationError(`${item.primitive} 拟合项缺 reportedDist（≥2 档）`);
  }
  const dist = item.reportedDist as number[];
  if (dist.some((p) => p < 0 || p > 1)) {
    throw new CalibrationError(`${item.primitive} reportedDist 含越界概率`);
  }
  const sum = dist.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 1e-6) {
    throw new CalibrationError(`${item.primitive} reportedDist 和=${sum}（须≈1）`);
  }
  if (item.primitive === 'score' && item.realizedIndex === undefined && !Array.isArray(item.truthDist)) {
    throw new CalibrationError('score 拟合项缺 realizedIndex 或 truthDist（真值侧二选一）');
  }
  if (item.primitive === 'choice' && (item.realizedIndex === undefined || item.realizedIndex >= dist.length)) {
    throw new CalibrationError('choice 拟合项缺合法 realizedIndex');
  }
}

// ════════════════════════════════════════
// 校准集隔离（家族级键分组 + 交集断言）
// ════════════════════════════════════════

/** 隔离断言读数（交集非空 → violations 非空 → ECE 达阈不算数） */
export interface DisjointCheckResult {
  /** 是否隔离（训练∩校准 = ∅） */
  disjoint: boolean;
  /** 违规清单（两侧同现的家族级键——逐条列名） */
  violations: string[];
  /** 训练侧家族键集 */
  trainFamilies: string[];
  /** 校准侧家族键集 */
  calibFamilies: string[];
}

/**
 * 校准集隔离断言：拟合输入按家族级键分组（v1.6.0 §五同构——
 * decision-dataset-schema.familyKeyOf 的口径：对比样本取 familyId、否则
 * 血缘锚点键；本函数取样本自带 familyKey 字段，分组键的构造与该口径同源），
 * 训练集与校准集的家族键交集非空 → 返回违规清单（调用方据此拒载/标注
 * ECE 不算数）。注意：本函数**返回违规不抛错**——「ECE 达阈不算数」是
 * 判定语义不是程序错误，抛错形态由调用方（门禁脚本/测试断言）选择。
 *
 * 粒度一致性（复核第 1 轮漏报面）：训练侧键=criterionId（最粗粒度）、
 * 校准侧键=familyKey（可含 `:` 细分层级）——两侧同判据不同字串
 * （如校准 'crit-a:sub-1' vs 训练 'crit-a'）会被字串精确比对放过，
 * 隔离形同虚设。故本断言在字串等值之外增加粒度比对：任一侧键为
 * 另一侧键的 `:` 前缀细分（startsWith(key + ':')）即判同判据跨侧，
 * 列入 violations（reason 注明粒度错配——同判据样本不可同进两侧）。
 */
export function assertDisjoint(
  trainSet: readonly CalibrationFitItem[],
  calibSet: readonly CalibrationFitItem[],
): DisjointCheckResult {
  const trainFamilies = [...new Set(trainSet.map((s) => s.familyKey))];
  const calibFamilies = [...new Set(calibSet.map((s) => s.familyKey))];
  const trainSetKeys = new Set(trainFamilies);
  const violations = calibFamilies.flatMap((f) => {
    if (trainSetKeys.has(f)) return [f];
    // 粒度错配 ①：校准键是训练判据的细分（familyKey 'crit-a:sub-1' vs
    // criterionId 'crit-a'）——同判据样本分进两侧，隔离失效
    const coarse = trainFamilies.find((t) => f.startsWith(`${t}:`));
    if (coarse) {
      return [`${f}（粒度错配：校准键是训练判据 ${coarse} 的细分——同判据样本不可同进两侧）`];
    }
    // 粒度错配 ②（对称面）：训练键是校准判据的细分——同族跨侧
    const fine = trainFamilies.find((t) => t.startsWith(`${f}:`));
    if (fine) {
      return [`${f}（粒度错配：训练键 ${fine} 是校准判据的细分——同判据样本不可同进两侧）`];
    }
    // 粒度错配 ③（CR3 🟡-1 平行细分）：两侧同为某判据的细分（'crit-a:sub-1' vs
    // 'crit-a:sub-2'）——前缀两支都不命中但同判据样本确实分进了两侧。家族级键
    // 的语义是「来源家族整体留同侧」（split-config 口径），首冒号前段即家族根。
    const root = f.split(':')[0]!;
    const sameRoot =
      root !== f &&
      trainFamilies.some((t) => t === root || (t.startsWith(`${root}:`) && t !== f));
    if (sameRoot) {
      return [`${f}（粒度错配：与训练键同属判据 ${root} 的家族（平行细分形态）——同判据样本不可同进两侧）`];
    }
    return [];
  });
  return {
    disjoint: violations.length === 0,
    violations,
    trainFamilies,
    calibFamilies,
  };
}

// ════════════════════════════════════════
// 分桶温度拟合（三原语分别 + 保序约束）
// ════════════════════════════════════════

/** 单桶拟合产物 */
export interface BucketFit {
  /** 桶下界（含）——按校准前置信度分桶 */
  lower: number;
  /** 桶上界（不含，末桶含） */
  upper: number;
  /** 桶内样本数（0 = 空桶——温度记 1 恒等） */
  count: number;
  /** 桶内拟合温度（空桶 = 1——恒等映射，不虚构） */
  temperature: number;
  /** 桶内最优 NLL（拟合目标值——审计面） */
  nll: number;
}

/** 拟合产物（单原语——多原语分别调本函数） */
export interface PrimitiveCalibrationFit {
  /** 原语类型 */
  primitive: CalibrationPrimitive;
  /** 分桶粒度（配置读取值——断言面：改配置桶数变） */
  bucketCount: number;
  /** 逐桶温度（长度 == bucketCount） */
  buckets: BucketFit[];
  /** 保序检查（score：校准前后档位 argmax 序一致；choice/noul：argmax 不变天然成立） */
  monotonicity: {
    /** 保序是否成立（score 校准不破序——RPS 优化出的序结构不受温度破坏） */
    held: boolean;
    /** 违规明细（held=false 时非空） */
    violations: string[];
  };
  /** 拟合指标（对外披露面） */
  fitMetrics: {
    /** 样本量 */
    sampleCount: number;
    /** 全体平均 NLL（拟合目标终值） */
    meanNll: number;
  };
}

/**
 * 桶内 NLL（温度 T 的拟合目标——极小化）：
 *   noul：−[y·log σ(z/T) + (1−y)·log(1−σ(z/T))]
 *   choice/score：−log softmax(logits/T)[y]（score 概率目标形态取
 *   −Σ_k truth[k]·log softmax(logits/T)[k]）
 */
function bucketNll(items: readonly CalibrationFitItem[], temperature: number): number {
  let acc = 0;
  for (const it of items) {
    if (it.primitive === 'noul') {
      const p = Math.min(Math.max(it.reportedProb as number, LOG_CLAMP), 1 - LOG_CLAMP);
      const logit = Math.log(p / (1 - p));
      const q = Math.min(Math.max(sigmoidTemp(logit, temperature), LOG_CLAMP), 1 - LOG_CLAMP);
      acc += (it.outcome as boolean) ? -Math.log(q) : -Math.log(1 - q);
    } else {
      const dist = it.reportedDist as number[];
      const logits = dist.map((p) => Math.log(Math.min(Math.max(p, LOG_CLAMP), 1)));
      const q = softmaxTemp(logits, temperature);
      if (it.truthDist !== undefined) {
        for (let k = 0; k < q.length; k++) {
          const tk = (it.truthDist as number[])[k] as number;
          if (tk > 0) acc += -tk * Math.log(Math.max(q[k] as number, LOG_CLAMP));
        }
      } else {
        acc += -Math.log(Math.max(q[it.realizedIndex as number] as number, LOG_CLAMP));
      }
    }
  }
  return items.length === 0 ? 0 : acc / items.length;
}

/**
 * 应用桶温度（apply 面——fit→apply 往返的另一端）：
 * 按置信度定位桶（末桶含上界），返回温度缩放后的概率/分布。
 * 置信度口径：noul 取报出概率本身；choice/score 取分布 max（max-prob
 * 统计量——与 §三统计量一致性对账面同源，见 STATISTIC_NAME）。
 */
export function applyBucketedTemperature(
  fit: PrimitiveCalibrationFit,
  item: Pick<CalibrationFitItem, 'primitive' | 'reportedProb' | 'reportedDist'>,
): { prob?: number; dist?: number[] } {
  if (item.primitive !== fit.primitive) {
    throw new CalibrationError(
      `apply 原语不匹配（fit=${fit.primitive} item=${item.primitive}——三原语分别校准不得混用）`,
    );
  }
  let confidence: number;
  if (item.primitive === 'noul') {
    if (typeof item.reportedProb !== 'number') throw new CalibrationError('noul apply 缺 reportedProb');
    confidence = item.reportedProb;
  } else {
    const dist = item.reportedDist as number[];
    if (!Array.isArray(dist) || dist.length < 2) throw new CalibrationError(`${item.primitive} apply 缺 reportedDist`);
    confidence = Math.max(...dist);
  }
  // 定桶（末桶含上界 1.0——置信度 = 1 落末桶不越界）
  let bucket = fit.buckets[Math.min(
    Math.floor(confidence * fit.bucketCount),
    fit.bucketCount - 1,
  )];
  if (bucket === undefined) throw new CalibrationError('分桶越界（不可能态——构造校验应已拦截）');
  const t = bucket.temperature;
  if (item.primitive === 'noul') {
    const p = Math.min(Math.max(item.reportedProb as number, LOG_CLAMP), 1 - LOG_CLAMP);
    const logit = Math.log(p / (1 - p));
    return { prob: sigmoidTemp(logit, t) };
  }
  const dist = item.reportedDist as number[];
  const logits = dist.map((p) => Math.log(Math.min(Math.max(p, LOG_CLAMP), 1)));
  return { dist: softmaxTemp(logits, t) };
}

/**
 * 分桶温度拟合（SSOT §二交付表首行）：
 *   1. 按校准前置信度等宽分桶（bucketCount 桶——配置读取）；
 *   2. 桶内 NLL 对 T 黄金分割极小化（一维——仓内自实现不引依赖）；
 *   3. score 保序检查：对每个样本，校准前后的档位 argmax 一致 + 相邻档
 *      概率序（p[i] vs p[i+1] 的大小关系）不变；违规收集到 violations
 *      （held=false 时调用方须拒用该 fit——校准不得破坏 RPS 序结构）；
 *   4. choice/noul 的 argmax 保序由温度单调性天然保证，仍逐项检查落读数。
 * 空桶温度记 1（恒等——不虚构拟合）；样本量 0 拒载（无拟合面）。
 */
export function bucketedTemperatureFit(input: {
  items: readonly CalibrationFitItem[];
  config?: Partial<CalibrationConfig>;
}): PrimitiveCalibrationFit {
  if (input.items.length === 0) {
    throw new CalibrationError('拟合样本为空（无拟合面——fail-closed 拒载）');
  }
  const primitive = (input.items[0] as CalibrationFitItem).primitive;
  for (const it of input.items) {
    assertFitItem(it);
    if (it.primitive !== primitive) {
      throw new CalibrationError(
        `混装原语（${primitive} 与 ${it.primitive}——三原语须分别拟合）`,
      );
    }
  }
  const config = resolveCalibrationConfig(input.config);
  const width = 1 / config.bucketCount;

  // 分桶（首见样本的置信度定桶——每桶独立拟合）
  const bucketed: CalibrationFitItem[][] = Array.from(
    { length: config.bucketCount },
    () => [],
  );
  for (const it of input.items) {
    const confidence =
      it.primitive === 'noul'
        ? (it.reportedProb as number)
        : Math.max(...(it.reportedDist as number[]));
    const idx = Math.min(Math.floor(confidence * config.bucketCount), config.bucketCount - 1);
    (bucketed[idx] as CalibrationFitItem[]).push(it);
  }

  // 桶内黄金分割拟合
  const buckets: BucketFit[] = bucketed.map((items, i) => {
    if (items.length === 0) {
      return { lower: i * width, upper: (i + 1) * width, count: 0, temperature: 1, nll: 0 };
    }
    const { x, fx } = goldenSectionMinimize(
      (t) => bucketNll(items, t),
      TEMPERATURE_MIN,
      TEMPERATURE_MAX,
    );
    return { lower: i * width, upper: (i + 1) * width, count: items.length, temperature: x, nll: fx };
  });

  // 保序检查（score 重点——choice/noul 天然成立仍落读数）
  const monotonicity = checkMonotonicity(input.items, { primitive, bucketCount: config.bucketCount, buckets, monotonicity: { held: true, violations: [] }, fitMetrics: { sampleCount: input.items.length, meanNll: 0 } });

  const meanNll =
    buckets.reduce((acc, b) => acc + b.nll * b.count, 0) / input.items.length;
  return {
    primitive,
    bucketCount: config.bucketCount,
    buckets,
    monotonicity,
    fitMetrics: { sampleCount: input.items.length, meanNll },
  };
}

/** 保序检查：校准前后 argmax 档一致 + 相邻档概率序不变（score 序结构——RPS 优化产物） */
function checkMonotonicity(
  items: readonly CalibrationFitItem[],
  fit: PrimitiveCalibrationFit,
): PrimitiveCalibrationFit['monotonicity'] {
  const violations: string[] = [];
  for (const it of items) {
    if (it.primitive === 'noul') {
      const after = applyBucketedTemperature(fit, it).prob as number;
      const before = it.reportedProb as number;
      if ((before >= 0.5) !== (after >= 0.5)) {
        violations.push(`noul 过半翻转：${before} → ${after}`);
      }
      continue;
    }
    const before = it.reportedDist as number[];
    const after = applyBucketedTemperature(fit, it).dist as number[];
    const argmaxBefore = before.indexOf(Math.max(...before));
    const argmaxAfter = after.indexOf(Math.max(...after));
    if (argmaxBefore !== argmaxAfter) {
      violations.push(`${it.primitive} argmax 档位移：${argmaxBefore} → ${argmaxAfter}`);
    }
    if (it.primitive === 'score') {
      // 相邻档序：校准前 p[i] < p[i+1] ⇒ 校准后也须 <（严格序保持——温度只缩放不改序，
      // 但浮点极端桶温下须显式断言落读数）
      for (let k = 0; k + 1 < before.length; k++) {
        const b0 = before[k] as number;
        const b1 = before[k + 1] as number;
        const a0 = after[k] as number;
        const a1 = after[k + 1] as number;
        if (b0 < b1 && a0 >= a1) violations.push(`score 相邻档序破坏：档 ${k}/${k + 1} 前 ${b0}<${b1} 后 ${a0}≥${a1}`);
        if (b0 > b1 && a0 <= a1) violations.push(`score 相邻档序破坏：档 ${k}/${k + 1} 前 ${b0}>${b1} 后 ${a0}≤${a1}`);
      }
    }
  }
  return { held: violations.length === 0, violations };
}

// ════════════════════════════════════════
// ECE（标准分箱 + not-measured 哨兵）
// ════════════════════════════════════════

/** not-measured 哨兵（字符串——空样本 ECE 不是 0（=完美校准）而是未测） */
export const ECE_NOT_MEASURED = 'not-measured' as const;

/** ECE 输入桶（已聚合——统计量来源见 STATISTIC_NAME） */
export interface EceBin {
  /** 桶内平均预测概率 */
  avgPredicted: number;
  /** 桶内真值频率 */
  avgActual: number;
  /** 桶内样本数 */
  count: number;
}

/** 校准面消费的置信度统计量名（§三统计量一致性对账锚——决策路径与 ECE 拟合同源） */
export const STATISTIC_NAME = 'max-prob' as const;

/**
 * 标准分箱 ECE：Σ (n_b / N) · |avgPredicted_b − avgActual_b|。
 * **空样本返回 not-measured 哨兵（字符串）而非 0**——ECE=0 在本版语义下
 * 是「完美校准」，空集给 0 等于把「未测」谎报为「最优」（有断言）。
 */
export function computeEce(bins: readonly EceBin[]): number | typeof ECE_NOT_MEASURED {
  const total = bins.reduce((a, b) => a + b.count, 0);
  if (total === 0) return ECE_NOT_MEASURED;
  return bins.reduce((acc, b) => acc + (b.count / total) * Math.abs(b.avgPredicted - b.avgActual), 0);
}

/** 把 (预测概率, 真值0/1) 对列表聚合为等宽分箱（nBins 桶——computeEce 输入面） */
export function binRecords(
  records: readonly { predicted: number; actual: 0 | 1 }[],
  nBins: number,
): EceBin[] {
  if (!Number.isInteger(nBins) || nBins < 1) throw new CalibrationError(`nBins=${nBins} 非法`);
  const width = 1 / nBins;
  const out: EceBin[] = [];
  for (let i = 0; i < nBins; i++) {
    const lower = i * width;
    const upper = (i + 1) * width;
    const inBin = records.filter((r) =>
      i === nBins - 1 ? r.predicted >= lower && r.predicted <= upper : r.predicted >= lower && r.predicted < upper,
    );
    const count = inBin.length;
    out.push({
      count,
      avgPredicted: count === 0 ? 0 : inBin.reduce((a, r) => a + r.predicted, 0) / count,
      avgActual: count === 0 ? 0 : inBin.reduce((a, r) => a + r.actual, 0) / count,
    });
  }
  return out;
}

// ════════════════════════════════════════
// 独立制品（JSON 序列化 + 无权重加载）
// ════════════════════════════════════════

/** 校准制品（纯 JSON——与权重制品解耦，换基座可单独重拟合不捆绑） */
export interface CalibrationArtifact {
  /** 制品 schema 版本 */
  schema: 'calibration-artifact/v1';
  /** 原语（三原语分别一制品） */
  primitive: CalibrationPrimitive;
  /** 分桶粒度（拟合时配置读取值） */
  bucketCount: number;
  /** 逐桶温度（下界/上界/温度三元组数组） */
  temperatures: Array<{ lower: number; upper: number; temperature: number }>;
  /** 拟合指标（披露面） */
  fitMetrics: { sampleCount: number; meanNll: number };
  /** 拟合所用统计量（§三统计量一致性对账锚） */
  statistic: typeof STATISTIC_NAME;
  /** 评测器版本（三态对照同源口径） */
  evaluatorVersion: string;
  /** 拟合时间（ISO 8601） */
  fittedAt: string;
}

/**
 * 序列化校准制品（JSON 字符串——概率字段不截断精度，见 §三概率有效位数纪律：
 * JSON.stringify 的 number 序列化保留全部有效位数，无 toFixed 截断点）。
 */
export function serializeCalibration(fit: PrimitiveCalibrationFit, meta: {
  evaluatorVersion: string;
  fittedAt?: string;
}): string {
  if (meta.evaluatorVersion.trim() === '') {
    throw new CalibrationError('评测器版本为空（制品缺校准信息——fail-closed）');
  }
  const artifact: CalibrationArtifact = {
    schema: 'calibration-artifact/v1',
    primitive: fit.primitive,
    bucketCount: fit.bucketCount,
    temperatures: fit.buckets.map((b) => ({ lower: b.lower, upper: b.upper, temperature: b.temperature })),
    fitMetrics: fit.fitMetrics,
    statistic: STATISTIC_NAME,
    evaluatorVersion: meta.evaluatorVersion,
    fittedAt: meta.fittedAt ?? new Date().toISOString(),
  };
  return JSON.stringify(artifact);
}

/**
 * 加载校准制品（**无权重亦可加载**——制品与权重解耦的断言面：本函数
 * 只读 JSON，不触权重面）。缺校准信息（schema/primitive/temperatures/
 * evaluatorVersion/fittedAt 任一缺失）→ 拒载抛错（制品缺校准信息即
 * fail-closed，对齐 §三「校准制品随行」纪律）。
 */
export function loadCalibration(json: string): CalibrationArtifact {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new CalibrationError('校准制品 JSON 解析失败（fail-closed 拒载）');
  }
  const a = parsed as Partial<CalibrationArtifact>;
  if (a.schema !== 'calibration-artifact/v1') throw new CalibrationError('制品 schema 缺失或不识别');
  if (a.primitive !== 'choice' && a.primitive !== 'score' && a.primitive !== 'noul') {
    throw new CalibrationError('制品缺 primitive（三原语之一）');
  }
  if (!Number.isInteger(a.bucketCount) || (a.bucketCount as number) < 2) {
    throw new CalibrationError('制品 bucketCount 非法');
  }
  if (!Array.isArray(a.temperatures) || (a.temperatures as object[]).length === 0) {
    throw new CalibrationError('制品缺 temperatures（校准参数本体缺失——fail-closed）');
  }
  if (!a.fitMetrics || typeof a.fitMetrics.sampleCount !== 'number') {
    throw new CalibrationError('制品缺 fitMetrics（披露面缺失）');
  }
  if (typeof a.evaluatorVersion !== 'string' || a.evaluatorVersion === '') {
    throw new CalibrationError('制品缺 evaluatorVersion');
  }
  if (typeof a.fittedAt !== 'string' || a.fittedAt === '') {
    throw new CalibrationError('制品缺 fittedAt（拟合时间——校准依据声明制的字段）');
  }
  return {
    schema: 'calibration-artifact/v1',
    primitive: a.primitive,
    bucketCount: a.bucketCount as number,
    temperatures: a.temperatures as CalibrationArtifact['temperatures'],
    fitMetrics: a.fitMetrics,
    statistic: STATISTIC_NAME,
    evaluatorVersion: a.evaluatorVersion,
    fittedAt: a.fittedAt,
  };
}

// ════════════════════════════════════════
// 三态对照（zeroShot / trained / calibrated）
// ════════════════════════════════════════

/** 单态读数（样本数 + ECE 并列） */
export interface CalibrationStateReading {
  /** 态名 */
  state: 'zeroShot' | 'trained' | 'calibrated';
  /** 样本数（0 = not-measured 档） */
  sampleCount: number;
  /** ECE（number | 'not-measured'——空样本哨兵） */
  ece: number | typeof ECE_NOT_MEASURED;
  /** 分桶可靠图数据（每桶 avgPredicted/avgActual——并列展示面） */
  reliabilityBins: EceBin[];
}

/** 三态对照报告（§二交付表「校准前后对照」行） */
export interface CalibrationComparisonReport {
  /** 三态并列（第一态 zeroShot = 训练基座本版实测） */
  states: {
    zeroShot: CalibrationStateReading;
    trained: CalibrationStateReading;
    calibrated: CalibrationStateReading;
  };
  /** 口径注记（第一态读数来源） */
  note: string;
}

/**
 * 构建三态对照报告。
 *
 * 第一态（zeroShot）= **训练基座本版实测**——v1.6.0 的 mock 读数
 * （`datasets/baseline-zero-shot-result.json`：mock 契约编码器非真基座）
 * 仅并列留档、**不进对照列**；W4（judge-eval 三态对照接线）将把真基座
 * 零样本读数接到本结构的 zeroShot 位——本函数是 §六对照落数的结构 SSOT。
 */
export function buildCalibrationReport(input: {
  zeroShotRecords: readonly { predicted: number; actual: 0 | 1 }[];
  trainedRecords: readonly { predicted: number; actual: 0 | 1 }[];
  calibratedRecords: readonly { predicted: number; actual: 0 | 1 }[];
  nBins?: number;
}): CalibrationComparisonReport {
  const nBins = input.nBins ?? DEFAULT_CALIBRATION_CONFIG.bucketCount;
  const reading = (
    state: CalibrationStateReading['state'],
    records: readonly { predicted: number; actual: 0 | 1 }[],
  ): CalibrationStateReading => ({
    state,
    sampleCount: records.length,
    ece: computeEce(binRecords(records, nBins)),
    reliabilityBins: binRecords(records, nBins),
  });
  return {
    states: {
      zeroShot: reading('zeroShot', input.zeroShotRecords),
      trained: reading('trained', input.trainedRecords),
      calibrated: reading('calibrated', input.calibratedRecords),
    },
    note: '第一态 = 训练基座本版实测零样本读数（v1.6.0 mock 读数并列留档不进对照列——mock 契约编码器非真基座，跨口径不可比）',
  };
}

// ════════════════════════════════════════
// 已知题集 TVD（P(A) 由构造已知——ECE 之外的第二校准检验形态）
// ════════════════════════════════════════

/** 已知概率题（真值分布由构造给出——不依赖分箱估计） */
export interface KnownProbabilityQuestion {
  /** 题面（如「袋中 30 红 70 蓝，随机取一球，是红球吗」） */
  prompt: string;
  /** 原语类型 */
  primitive: CalibrationPrimitive;
  /** 构造已知真值分布（noul：[P(不成立), P(成立)]；choice/score：全档位） */
  truthDist: readonly number[];
  /** 模型对该题的报出（与 truthDist 同长度——归一） */
  reportedDist: readonly number[];
}

/**
 * 全变差距离：TVD(P, Q) = ½ Σ |P_i − Q_i| ∈ [0, 1]。
 * 0 = 完全重合；1 = 支撑集不相交（报出的概率含义与构造真值完全错位）。
 */
export function totalVariationDistance(
  p: readonly number[],
  q: readonly number[],
): number {
  if (p.length !== q.length) throw new CalibrationError(`TVD 两分布长度不一致（${p.length} vs ${q.length}）`);
  let acc = 0;
  for (let i = 0; i < p.length; i++) {
    acc += Math.abs((p[i] as number) - (q[i] as number));
  }
  return acc / 2;
}

/**
 * 已知题集 TVD 评分：题集（P(A) 由构造已知）经三原语查询后逐题 TVD，
 * 返回逐题 + 均值。**与 ECE 分别落数、分别判定**——ECE 达阈不蕴含本项
 * 通过（ECE 是分箱频率吻合，TVD 是构造真值重合，两者失败模式不同：
 * 分箱可被桶边界掩蔽、构造真值不可）。
 */
export function knownProbabilityTvd(
  questions: readonly KnownProbabilityQuestion[],
): {
  perQuestion: Array<{ prompt: string; primitive: CalibrationPrimitive; tvd: number }>;
  meanTvd: number | typeof ECE_NOT_MEASURED;
} {
  if (questions.length === 0) {
    return { perQuestion: [], meanTvd: ECE_NOT_MEASURED }; // 空题集 = 未测（缺题集即验收不通过——哨兵同口径）
  }
  const perQuestion = questions.map((q) => {
    if (q.truthDist.length !== q.reportedDist.length) {
      throw new CalibrationError(`题「${q.prompt}」真值/报出分布长度不一致`);
    }
    return { prompt: q.prompt, primitive: q.primitive, tvd: totalVariationDistance(q.truthDist, q.reportedDist) };
  });
  return {
    perQuestion,
    meanTvd: perQuestion.reduce((a, q) => a + q.tvd, 0) / perQuestion.length,
  };
}

/**
 * 示例题集构造器（确定性概率题——真值由构造给出，可复算）：
 *   1. 袋中球：30 红 70 蓝 → P(红)=0.3（noul：报 [0.7, 0.3] vs 真 [0.7, 0.3] 完全重合）
 *   2. 骰子：P(六)=1/6（noul）
 *   3. 三选路：A/B/C 权重 1:2:2（choice）
 *   4. 有序三档：低/中/高 = 0.2/0.5/0.3（score）
 * reportedDist 取「完全重合」形态（构造侧可注入任意报出做偏差演示——
 * 调用方传 overrides 覆盖单题报出）。
 */
export function buildKnownProbabilityQuestionSet(overrides?: Partial<Record<number, readonly number[]>>): KnownProbabilityQuestion[] {
  const base: KnownProbabilityQuestion[] = [
    {
      prompt: '袋中有 30 个红球与 70 个蓝球，随机取一球，该球是红球',
      primitive: 'noul',
      truthDist: [0.7, 0.3],
      reportedDist: [0.7, 0.3],
    },
    {
      prompt: '投一枚均匀骰子，点数为六',
      primitive: 'noul',
      truthDist: [5 / 6, 1 / 6],
      reportedDist: [5 / 6, 1 / 6],
    },
    {
      prompt: '三条路 A/B/C 按车流权重 1:2:2 随机选一条疏导，选中 A',
      primitive: 'choice',
      truthDist: [0.2, 0.4, 0.4],
      reportedDist: [0.2, 0.4, 0.4],
    },
    {
      prompt: '负载分档低/中/高，当前负载落在中档',
      primitive: 'score',
      truthDist: [0.2, 0.5, 0.3],
      reportedDist: [0.2, 0.5, 0.3],
    },
  ];
  if (overrides) {
    for (const [idx, dist] of Object.entries(overrides)) {
      const i = Number(idx);
      const target = base[i];
      if (target && dist) {
        base[i] = { ...target, reportedDist: dist };
      }
    }
  }
  return base;
}

// ════════════════════════════════════════
// 达阈判定（0.10 冻结线 · 分原语×分语言逐档）
// ════════════════════════════════════════

/** ECE 硬线冻结值（THRESHOLDS.md 动工前冻结——事后只许收紧不许放宽） */
export const ECE_HARD_LINE = 0.10;

/** 逐档 ECE 读数（原语 × 语言） */
export interface PerPrimitivePerLanguageEce {
  primitive: CalibrationPrimitive;
  lang: 'zh' | 'en';
  /** number = 已测；'not-measured' = 空样本档（不计入达标面但显式列出） */
  ece: number | typeof ECE_NOT_MEASURED;
}

/** 单档判定 */
export interface EceSlotVerdict {
  primitive: CalibrationPrimitive;
  lang: 'zh' | 'en';
  ece: number | typeof ECE_NOT_MEASURED;
  /** 是否达阈（not-measured → false——未测不得记达标） */
  pass: boolean;
  /** 判定说明（含线距） */
  reason: string;
}

/** 达阈判定读数 */
export interface EceVerdictResult {
  /** 总判定（任一档未达即未达阈——中英分列不合并） */
  achieved: boolean;
  /** 逐档判定 */
  slots: EceSlotVerdict[];
  /** 冻结线（读数回显——对账用） */
  hardLine: typeof ECE_HARD_LINE;
}

/**
 * ECE 达阈判定：对照 0.10 冻结线逐档（原语 × 语言）判定。
 * not-measured 档 pass=false（未测不得记达标——与「空集给 0」同族防线）。
 */
export function eceVerdict(readings: readonly PerPrimitivePerLanguageEce[]): EceVerdictResult {
  if (readings.length === 0) {
    throw new CalibrationError('达阈判定输入为空（无档可判——fail-closed 拒载）');
  }
  const slots: EceSlotVerdict[] = readings.map((r) => {
    if (r.ece === ECE_NOT_MEASURED) {
      return { primitive: r.primitive, lang: r.lang, ece: r.ece, pass: false, reason: 'not-measured（空样本——未测不得记达标）' };
    }
    const pass = r.ece <= ECE_HARD_LINE;
    return {
      primitive: r.primitive,
      lang: r.lang,
      ece: r.ece,
      pass,
      reason: pass
        ? `ECE ${r.ece.toFixed(4)} ≤ 冻结线 ${ECE_HARD_LINE}`
        : `ECE ${r.ece.toFixed(4)} > 冻结线 ${ECE_HARD_LINE}（未达阈）`,
    };
  });
  return {
    achieved: slots.every((s) => s.pass),
    slots,
    hardLine: ECE_HARD_LINE,
  };
}

/**
 * 三段门控门槛按原语分档重标入口（SSOT §二验收末条——「校准合格」不是
 * 「默认阈值可用」的充分理由）：
 *   - 输入：各原语档校准后的置信分布（校准集读数）+ 目标分流性质；
 *   - 输出：逐原语门槛（高自动/中复核/低转人工三段边界）。
 * 缺省策略 = 分位数切（qHigh 自动 / qMid 复核——从校准分布实取，不从
 * 拍脑袋数字取）；**校准达阈与否不改变本函数须被调用的义务**——达阈
 * 只是把读数标可信，门槛定位仍须按原语分档实测重标。
 * 「不得把概率校准合格当默认阈值可用」的断言面：本函数不读 ECE、不设
 * 全局默认 0.8/0.5/0.2——门槛唯一来源是各原语自己的分布读数。
 */
export interface PerPrimitiveThresholds {
  primitive: CalibrationPrimitive;
  /** 高自动段下界（≥ 此置信走自动——校准分布 qHigh 分位） */
  autoMinConfidence: number;
  /** 中复核段下界（≥ 此走复核、< autoMinConfidence） */
  reviewMinConfidence: number;
  /** 低于 reviewMinConfidence → 转人工 */
  humanBelow: number;
  /** 来源注记（门槛由分布重标非拍脑袋——留痕） */
  source: 'calibrated-distribution-quantile';
}

/**
 * 按原语分档重标三段门槛（分位数法——从各原语校准后置信分布实取）。
 * qHigh/qMid 缺省 0.8/0.5 分位（分位是**算法参数**非门槛值本身——门槛值
 * 由分布读数导出，与 DEFAULT_GRADE_THRESHOLDS 的静态常数性质不同）。
 */
export function thresholdsByPrimitive(
  perPrimitiveConfidence: Readonly<Record<CalibrationPrimitive, readonly number[] | undefined>>,
  opts?: { qHigh?: number; qMid?: number },
): PerPrimitiveThresholds[] {
  const qHigh = opts?.qHigh ?? 0.8;
  const qMid = opts?.qMid ?? 0.5;
  if (!(0 < qMid && qMid < qHigh && qHigh < 1)) {
    throw new CalibrationError(`分位参数非法（qMid=${qMid} qHigh=${qHigh} 须 0<qMid<qHigh<1）`);
  }
  const quantile = (sorted: readonly number[], q: number): number => {
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    if (lo === hi) return sorted[lo] as number;
    return (sorted[lo] as number) + ((sorted[hi] as number) - (sorted[lo] as number)) * (pos - lo);
  };
  const out: PerPrimitiveThresholds[] = [];
  for (const primitive of ['choice', 'score', 'noul'] as const) {
    const confs = perPrimitiveConfidence[primitive];
    if (!confs || confs.length === 0) {
      throw new CalibrationError(
        `${primitive} 无校准分布读数（门槛重标须各原语分档实测——不得回落全局默认值）`,
      );
    }
    const sorted = [...confs].sort((a, b) => a - b);
    out.push({
      primitive,
      autoMinConfidence: quantile(sorted, qHigh),
      reviewMinConfidence: quantile(sorted, qMid),
      humanBelow: quantile(sorted, qMid),
      source: 'calibrated-distribution-quantile',
    });
  }
  return out;
}

// ════════════════════════════════════════
// 训练后校准步骤（train-rlcd 消费面——生产调用点）
// ════════════════════════════════════════

/** 训练后校准读数（train-rlcd.ts 训练完成后的校准步骤产物） */
export interface PostTrainCalibrationReadout {
  /** 三原语各自拟合（空原语档跳过并记 not-fit） */
  fits: Array<{ primitive: CalibrationPrimitive; status: 'fitted' | 'not-fit'; fit?: PrimitiveCalibrationFit }>;
  /** 校准集隔离检查（disjoint=false 时 ECE 达阈不算数） */
  isolation: DisjointCheckResult;
  /** 隔离违规时拒出读数（fail-closed——防污染 ECE 流入对照面） */
  isolationRefused: boolean;
}

/**
 * 训练后校准步骤（train-rlcd 的生产消费点）：
 *   1. 先隔离断言（训练/校准家族键交集非空 → 拒出读数，violations 落盘）；
 *   2. 三原语分别拟合（样本量 0 的原语标 not-fit——不虚构）；
 *   3. score 保序检查（held=false 的 fit 仍返回但 status 带明细——调用方
 *      须拒用该 fit 做分流）。
 * 注意隔离断言优先于拟合（先防污染再算数——顺序即纪律）。
 */
export function calibrateAfterTraining(input: {
  primitiveBuckets: Readonly<Record<CalibrationPrimitive, readonly CalibrationFitItem[] | undefined>>;
  trainSamples?: readonly RlcdTrainSample[];
  config?: Partial<CalibrationConfig>;
}): PostTrainCalibrationReadout {
  // 隔离断言：训练侧家族键从 trainSamples 的样本键导出（criterionId——
  // 家族级键的最粗粒度形态；更细粒度（轨迹/租户）由调用方在 familyKey 预分组）
  const calibItems = (['choice', 'score', 'noul'] as const)
    .flatMap((p) => input.primitiveBuckets[p] ?? []);
  const trainFamilies = (input.trainSamples ?? []).map(
    (s) => s.key.criterionId,
  );
  const trainSide: CalibrationFitItem[] = trainFamilies.map((familyKey) => ({
    primitive: 'noul',
    lang: 'zh',
    familyKey,
  }));
  const isolation = assertDisjoint(trainSide, calibItems);
  const isolationRefused = !isolation.disjoint;

  // CR3 🟠-3：隔离违规 ⇒ 三原语全部 not-fit（fail-closed 落地）——此前只置
  // isolationRefused 标志但拟合照常产出完整 fits（含桶温），「拒出读数」的
  // 注释承诺没有实现面（牌子立了门没装）：调用方若只读 fits 不检查标志，
  // 污染读数即外流。违规态一律不产 fit。
  const fits: PostTrainCalibrationReadout['fits'] = [];
  if (isolationRefused) {
    for (const p of ['choice', 'score', 'noul'] as const) {
      fits.push({ primitive: p, status: 'not-fit' });
    }
    return { fits, isolation, isolationRefused };
  }
  for (const p of ['choice', 'score', 'noul'] as const) {
    const items = input.primitiveBuckets[p];
    if (!items || items.length === 0) {
      fits.push({ primitive: p, status: 'not-fit' });
      continue;
    }
    fits.push({ primitive: p, status: 'fitted', fit: bucketedTemperatureFit({ items, config: input.config }) });
  }
  return { fits, isolation, isolationRefused };
}
