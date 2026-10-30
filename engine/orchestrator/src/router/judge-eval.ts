// judge-eval.ts · 零样本评测器（逐判据统计 + 失败模式分类 + 中英分列 + 分布内外分列）
// + v1.7.0 §六 三态对照 / 双指标分离 / best-of-N / 达阈判定（阶段二收口面）
// + v1.7.x 修补线 · 判定面分列（semantic/numeric faces）+ 确定性路由留痕
// ============================================================
// 在第五–七章数据集上跑零样本推理（基座不微调）；逐判据命中率/一致率；
// 失败模式分类（哪类判据零样本最弱——阶段二训练重点输入）；中英分列
// 落数（准确率+ECE 分列不合并）；分布内外分列（演示任务族 vs 从未训练
// 任务类型——泛化落差显式声明）；基线自产（引用他人数字不构成基线）；
// 耗时与成本同批记录（预算分配分母）。
//
// v1.7.0 §六 增量（同数据集同评测器三态对照）：
//   - buildThreeStateComparison：zeroShot（本版实测接口——无实机环境时
//     如实标 not-measured，不用 v1.6.0 mock 读数充第一态）/ trained /
//     calibrated 三态并列，提升幅度如实落数；
//   - 双指标分离：判定质量 = 逐判据一致率（zh/en 分列，≥0.70 冻结线）与
//     概率可信度 = ECE 分档（≤0.10 冻结线）**两线独立判定**，不合并单一
//     综合分（合并会掩盖「判得准但概率不可信」的危险组合）；
//   - best-of-N 选优列（N 与选择器口径随表落数）；
//   - 阶段三裁决：双达阈 → stage-three:proceed；任一未达 → stage-three:deferred。
//
// v1.7.x 修补线增量（架构师设计 §judge-eval 分列）：
//   - BaselineReport.faces：{semantic, numeric} 两面各自 zh/en 一致率与
//     样本量 + ECE 分列（numeric 面 ECE 恒 NOT_MEASURED——确定性答案的
//     退化分布不构成校准读数，one-hot 进 ECE 会污染校准面——主理人裁决②）；
//   - BaselineReport.routing：{enabled, routedCount, routedByRule,
//     failOpenCount}——确定性路由的直方图留痕（架构师地基对账面）；
//   - evaluateZeroShot opts.deterministic 可传 null 关路由（A/B 对照口径
//     ——主理人裁决⑤）；确定性行不进 calibRecords；
//   - gradelong 族单列读数（主理人裁决③——本版不覆盖，读数单独可见）。
// ============================================================
import type { DecisionSample } from './decision-dataset-schema';
import type { DecisionQuestion } from './decision-primitives';
import type { JudgeRuntime } from './judge-runtime';
import { computeCalibration, type CalibrationRecord, type CalibrationReport } from './calibration-report';
import { DeterministicJudge, RULE_FAMILY, type DeterministicRule } from './deterministic-judge';

/** 逐判据统计 */
export interface CriterionStat {
  criterionId: string;
  /** 命中率（预测与真值一致比例） */
  accuracy: number;
  /** 样本数 */
  count: number;
  /** 样本数（中文侧——agreementZh 加权分母，与 en 分列） */
  countZh: number;
  /** 样本数（英文侧——agreementEn 加权分母，与 zh 分列） */
  countEn: number;
  /** 按语言分列 */
  accuracyByLang: { zh: number; en: number };
  /**
   * 判定面分列（v1.7.x 修补线）：语义面/数值合成面各自一致率——
   * 归属由 DeterministicJudge.route 动态识别（单一事实源，非 origin 硬编码）。
   */
  accuracyByFacet: { semantic: number; numeric: number };
  /** 数值合成面样本数（accuracyByFacet.numeric 的分母） */
  countNumeric: number;
  /** 确定性命中数（source='deterministic' 留痕——零则该判据全走模型） */
  deterministicHits: number;
}

/** 失败模式分类 */
export type FailureMode =
  | 'completely-stuck' // 完全跑不动（命中率 < 随机基线）
  | 'boundary-blurred' // 边界模糊（0.4-0.6 区间聚集）
  | 'overconfident-wrong'; // 高置信错误

export interface FailureClassification {
  criterionId: string;
  mode: FailureMode;
  evidence: string;
}

/** 单判定面读数（zh/en 分列一致率 + ECE——两列都报不藏数） */
export interface FaceReading {
  /** 中文侧一致率（按 zh 侧样本量加权） */
  agreementZh: number | typeof NOT_MEASURED;
  /** 英文侧一致率（按 en 侧样本量加权） */
  agreementEn: number | typeof NOT_MEASURED;
  /** 中文侧样本量 */
  countZh: number;
  /** 英文侧样本量 */
  countEn: number;
  /**
   * 中文侧 ECE——numeric 面恒 NOT_MEASURED：确定性答案的退化分布
   * 不构成校准读数（one-hot 进 ECE = 用映射常数冒充校准，§二门四同族防线）
   */
  eceZh: number | typeof NOT_MEASURED;
  /** 英文侧 ECE（numeric 面恒 NOT_MEASURED——同上） */
  eceEn: number | typeof NOT_MEASURED;
}

/** 判定面分列报告（semantic=模型判定面真实水平 / numeric=确定性路由效果读数） */
export interface FacesBreakdown {
  /** 语义判定面（boolq/csqa/snli/millet 等自然语言理解族——纯模型路径） */
  semantic: FaceReading;
  /** 数值合成面（proc-e 数值比较/分档评分族——确定性路由覆盖） */
  numeric: FaceReading;
  /**
   * gradelong 族单列（主理人裁决③：本版不覆盖继续落模型——读数单独
   * 可见，不混入 semantic 也不混入 numeric）
   */
  gradelong: FaceReading;
}

/** 确定性路由留痕（直方图对账面——架构师地基断言目标） */
export interface RoutingTrace {
  /** 路由开关（opts.deterministic=null → false） */
  enabled: boolean;
  /** 确定性出答案的问句总数 */
  routedCount: number;
  /** 按规则分布（extremum/nearest/digit-sum/binary/edges/table） */
  routedByRule: Record<string, number>;
  /** 识别但歧义落穿（答案面 fail-closed）+ 未识别落穿的问句数合计 */
  failOpenCount: number;
}

export interface BaselineReport {
  /** 逐判据统计 */
  perCriterion: CriterionStat[];
  /** 失败模式分类（按语言分开报） */
  failuresByLang: { zh: FailureClassification[]; en: FailureClassification[] };
  /** 校准现状（分桶+ECE——中英分列；确定性行不进校准面） */
  calibration: CalibrationReport;
  /** 分布内外分列（泛化落差显式声明） */
  inDistributionAccuracy: number;
  outOfDistributionAccuracy: number;
  generalizationGap: number;
  /** 候选集规模与利用率随基线同批落数（候选集规模是质量自变量） */
  candidateSetUtilization: { candidateSetSize: number; usedCount: number; utilizationRatio: number };
  /** 中英落差（超阈则不宣称中文可用） */
  zhEnGap: number;
  zhUsable: boolean;
  /**
   * 判定面分列（v1.7.x 修补线）：semantic / numeric / gradelong 三列
   * 各自 zh/en 一致率与 ECE——数值面读数是确定性路由的效果读数，语义面
   * 读数是模型判定面的真实水平（两者混报会互相掩盖）。
   */
  faces: FacesBreakdown;
  /** 确定性路由留痕（enabled/routedCount/routedByRule 直方图/failOpenCount） */
  routing: RoutingTrace;
  /** 耗时与成本（单次评测——预算分配分母） */
  runtime: { elapsedMs: number };
  /** 口径声明（零样本·单次运行·自产基线） */
  caveat: string;
}

const RANDOM_BASELINE = 0.5; // noul 二值随机基线
/** score 命中判定的区间外松弛（半档——亚档抖动容差，见 score hit 行注释） */
const SCORE_HIT_SLACK = 0.5;

// ── 判定面归属（detect 面单一事实源 = DeterministicJudge.route）────

/** 判定面归属（架构师设计：semantic / numeric 两面 + gradelong 单列） */
export type JudgeFacet = 'semantic' | 'numeric';

/**
 * 样本问句的路由规则（评测器侧对账用）：DatasetQuestion.options 按下标
 * 重建 options_def（与 frozen options_def {opt0:…} 同构），调
 * DeterministicJudge.route 判定——与 JudgeRuntime 路由层同一判别器实例
 * （单一事实源：判别器改动，路由与评测分列自动同步）。
 */
function routeOfSample(
  det: DeterministicJudge,
  s: DecisionSample,
): Array<{ rule: DeterministicRule | null }> {
  return s.questions.map((q) => {
    const optionsDef: Record<string, string> = {};
    (q.options ?? []).forEach((label, i) => {
      optionsDef[`opt${i}`] = label;
    });
    return { rule: det.route(s.state, q.question, optionsDef) };
  });
}

export function evaluateZeroShot(
  runtime: JudgeRuntime,
  dataset: DecisionSample[],
  opts?: {
    oodCriterionIds?: Set<string>;
    /**
     * 确定性路由开关（v1.7.x 修补线）：缺省 = 与 runtime 构造器一致；
     * 显式传 null = 强制关路由（A/B 对照口径——judge-eval 侧独立于
     * runtime 构造器可单独做开/关对照）。
     */
    deterministic?: DeterministicJudge | null;
  },
): BaselineReport {
  const startedAt = Date.now();
  const perCriterion = new Map<string, { hit: number; total: number; hitZh: number; totalZh: number; hitEn: number; totalEn: number; probs: number[]; truths: number[]; hitNumeric: number; totalNumeric: number; detHits: number; hitGrade: number; totalGrade: number }>();
  const calibRecords: CalibrationRecord[] = [];

  // 判别器实例（评测器侧路由对账与分列归属共用）；路由开关读 opts 优先
  const det =
    opts?.deterministic !== undefined
      ? opts.deterministic
      : new DeterministicJudge();
  const routingEnabled = det !== null;
  const routedByRule: Record<string, number> = {};
  let routedCount = 0;
  let failOpenCount = 0;
  // gradelong 识别（主理人裁决③单列）：state 含「评分标准（按紧急程度分」
  // 且无确定性规则命中——本版刻意不覆盖的族
  const isGradelong = (s: DecisionSample): boolean =>
    s.state.includes('评分标准（按紧急程度分') || /紧急程度分\s*0-\d+\s*级/.test(s.state);

  // 分面聚合器（zh/en × semantic/numeric/gradelong）
  const face = () => ({ hitZh: 0, totalZh: 0, hitEn: 0, totalEn: 0, calib: [] as CalibrationRecord[] });
  const facesAgg = { semantic: face(), numeric: face(), gradelong: face() };

  for (const s of dataset) {
    // DatasetQuestion → DecisionQuestion 适配（零格式分叉——结构同构，
    // choice 侧补 isFallback 标记位与兜底候选由判据集消费方保证）
    const questions = s.questions.map((q): DecisionQuestion => {
      if (q.kind !== 'choice') {
        if (q.kind === 'score') {
          // score 值域优先 q.scale（fresh-eyes run-01 项 8：此前恒 ??0/??10
          // 丢弃 scale——DatasetQuestion.scale 为 2-10 级刻度数组，首尾即
          // [min,max]；两者皆无才用默认 0-10）。schema 类型为 string[]
          //（刻度可为数字串），Number() 归一解析，NaN 项剔除。
          const scaleNums = (q.scale ?? [])
            .map((v) => (typeof v === 'number' ? v : Number(v)))
            .filter((v) => Number.isFinite(v));
          const scaleMin = scaleNums.length > 0 ? Math.min(...scaleNums) : undefined;
          const scaleMax = scaleNums.length > 0 ? Math.max(...scaleNums) : undefined;
          const min = (q as { min?: number }).min ?? scaleMin ?? 0;
          const max = (q as { max?: number }).max ?? scaleMax ?? 10;
          return { kind: 'score', id: q.id, question: q.question, min, max };
        }
        return { kind: 'noul', id: q.id, question: q.question };
      }
      const labels = q.options ?? [];
      return {
        kind: 'choice',
        id: q.id,
        question: q.question,
        options: labels.map((label, i) => ({
          id: `opt-${i}`,
          label,
          isFallback: i === labels.length - 1,
        })),
      };
    });
    const result = runtime.judge({ state: s.state, questions });
    // 分面归属（route 动态识别）+ gradelong 单列
    const routes = routingEnabled ? routeOfSample(det, s) : s.questions.map(() => ({ rule: null as DeterministicRule | null }));
    const gradelongSample = isGradelong(s);
    s.questions.forEach((q, i) => {
      const ans = result.answers[i]!;
      const truth = s.answers[i]!;
      const cid = q.id;
      const entry = perCriterion.get(cid) ?? { hit: 0, total: 0, hitZh: 0, totalZh: 0, hitEn: 0, totalEn: 0, probs: [], truths: [], hitNumeric: 0, totalNumeric: 0, detHits: 0, hitGrade: 0, totalGrade: 0 };
      // 路由留痕（routedByRule 直方图——确定性命中 = 答案带 deterministic source）
      const isDetAnswer = ans.kind !== 'noul' && (ans as { source?: string }).source === 'deterministic';
      const rule = routes[i]?.rule ?? null;
      if (routingEnabled) {
        if (isDetAnswer && rule) {
          routedCount += 1;
          routedByRule[rule] = (routedByRule[rule] ?? 0) + 1;
        } else {
          failOpenCount += 1; // 未识别落穿 + 识别但歧义落穿（答案面 fail-closed）
        }
      }
      // 命中判定：noul 概率阈值 0.5 二值对照；choice 选中一致；score 就近
      let hit = false;
      let prob = 0.5;
      let isCalibRow = true; // 确定性行不进 calibRecords（主理人裁决②）
      if (ans.kind === 'noul' && truth.kind === 'noul') {
        prob = ans.probability ?? 0.5;
        const truthVal = (truth.probability ?? 0.5) >= 0.5 ? 1 : 0;
        hit = (prob >= 0.5 ? 1 : 0) === truthVal;
        entry.probs.push(prob);
        entry.truths.push(truthVal);
      } else if (ans.kind === 'choice' && truth.kind === 'choice') {
        // CR3 🟠-2：truth.selected 语义归一——数据集真值形态有三种在野写法
        //（数字下标 0/1/…、标签文本、'opt-N' id），判定头输出恒 'opt-N'。
        // 此前直接字串比对：真值为数字/标签时命中率恒 0、概率 fallback 恒 0.5，
        // 且无任何报错（接线即全量判错）。归一失败（既非下标也非标签也非 id）
        // ⇒ fail-closed 抛错拒载，不产静默假读数。
        const candIds = (q as { options?: string[] }).options?.map((_, i) => `opt-${i}`) ?? [];
        const truthRaw = truth.selected;
        let truthId: string | undefined;
        if (typeof truthRaw === 'string' && candIds.includes(truthRaw)) {
          truthId = truthRaw;
        } else if (typeof truthRaw === 'number' && Number.isInteger(truthRaw) && truthRaw >= 0 && truthRaw < candIds.length) {
          truthId = candIds[truthRaw];
        } else if (typeof truthRaw === 'string') {
          const idx = (q as { options?: string[] }).options?.indexOf(truthRaw);
          if (idx !== undefined && idx >= 0) truthId = candIds[idx];
        }
        if (!truthId) {
          throw new Error(
            `judge-eval choice 真值无法归一到候选 id 空间（criterion=${cid} · selected=${JSON.stringify(truthRaw)} · candidates=${JSON.stringify((q as { options?: string[] }).options ?? [])}）——fail-closed 拒载，不产静默假读数`,
          );
        }
        hit = ans.selected === truthId;
        prob = ans.distribution?.[truthId] ?? 0.5;
        if (isDetAnswer) isCalibRow = false; // 退化分布非概率目标——不进校准面
      } else if (ans.kind === 'score' && truth.kind === 'score') {
        // score 就近容差：真值区间宽度 + SCORE_HIT_SLACK（登记常量，出处：
        // 区间内视为命中是 v1.6.0 判据集语义；0.5 为区间外松弛半档——防
        // 连续值读数的亚档抖动误判 miss，非拍脑袋数字）
        hit = Math.abs((ans.value ?? 0) - (truth.value ?? 0)) <= (truth.interval?.upper ?? 1) - (truth.interval?.lower ?? 0) + SCORE_HIT_SLACK;
        if (isDetAnswer) isCalibRow = false;
      }
      if (isCalibRow && (ans.kind === 'noul' || ans.kind === 'choice')) {
        const truthVal = ans.kind === 'noul' ? ((truth.probability ?? 0.5) >= 0.5 ? 1 : 0) : hit ? 1 : 0;
        calibRecords.push({ predicted: prob, actual: truthVal as 0 | 1, lang: s.lang });
      }
      entry.total += 1;
      if (hit) entry.hit += 1;
      if (s.lang === 'zh') { entry.totalZh += 1; if (hit) entry.hitZh += 1; }
      else { entry.totalEn += 1; if (hit) entry.hitEn += 1; }
      // 分面累计（numeric = route 命中；gradelong = 刻意不覆盖族——单列）
      const facet: 'semantic' | 'numeric' | 'gradelong' = gradelongSample ? 'gradelong' : rule ? 'numeric' : 'semantic';
      if (facet === 'numeric') {
        entry.totalNumeric += 1;
        if (hit) entry.hitNumeric += 1;
        if (isDetAnswer && hit) entry.detHits += 1;
      } else if (facet === 'gradelong') {
        entry.totalGrade += 1;
        if (hit) entry.hitGrade += 1;
      }
      const agg = facesAgg[facet];
      if (s.lang === 'zh') { agg.totalZh += 1; if (hit) agg.hitZh += 1; }
      else { agg.totalEn += 1; if (hit) agg.hitEn += 1; }
      if (facet !== 'numeric' && isCalibRow && (ans.kind === 'noul' || ans.kind === 'choice')) {
        // numeric 面不进 ECE（裁决②）——semantic/gradelong 照常
        const truthVal = ans.kind === 'noul' ? ((truth.probability ?? 0.5) >= 0.5 ? 1 : 0) : hit ? 1 : 0;
        agg.calib.push({ predicted: prob, actual: truthVal as 0 | 1, lang: s.lang });
      }
      perCriterion.set(cid, entry);
    });
  }

  const perCriterionOut: CriterionStat[] = [...perCriterion.entries()].map(([criterionId, e]) => ({
    criterionId,
    accuracy: e.total === 0 ? 0 : e.hit / e.total,
    count: e.total,
    countZh: e.totalZh,
    countEn: e.totalEn,
    accuracyByLang: {
      zh: e.totalZh === 0 ? 0 : e.hitZh / e.totalZh,
      en: e.totalEn === 0 ? 0 : e.hitEn / e.totalEn,
    },
    accuracyByFacet: {
      semantic: e.total - e.totalNumeric - e.totalGrade === 0 ? 0 : (e.hit - e.hitNumeric - e.hitGrade) / (e.total - e.totalNumeric - e.totalGrade),
      numeric: e.totalNumeric === 0 ? 0 : e.hitNumeric / e.totalNumeric,
    },
    countNumeric: e.totalNumeric,
    deterministicHits: e.detHits,
  }));

  // 失败模式分类（按语言分开）
  const classify = (lang: 'zh' | 'en'): FailureClassification[] => {
    const out: FailureClassification[] = [];
    for (const [cid, e] of perCriterion) {
      const total = lang === 'zh' ? e.totalZh : e.totalEn;
      const hit = lang === 'zh' ? e.hitZh : e.hitEn;
      if (total === 0) continue;
      const acc = hit / total;
      const boundaryRatio = e.probs.filter((p) => p >= 0.4 && p <= 0.6).length / Math.max(1, e.probs.length);
      if (acc < RANDOM_BASELINE) {
        out.push({ criterionId: cid, mode: 'completely-stuck', evidence: `准确率 ${acc.toFixed(3)} < 随机基线 ${RANDOM_BASELINE}` });
      } else if (boundaryRatio > 0.5) {
        out.push({ criterionId: cid, mode: 'boundary-blurred', evidence: `边界区聚集 ${(boundaryRatio * 100).toFixed(0)}%（0.4-0.6 区间）` });
      } else if (acc < 0.6) {
        out.push({ criterionId: cid, mode: 'overconfident-wrong', evidence: `准确率 ${acc.toFixed(3)}（低命中且非边界聚集）` });
      }
    }
    return out;
  };

  // 分布内外分列
  const oodIds = opts?.oodCriterionIds ?? new Set<string>();
  const inDist = perCriterionOut.filter((c) => !oodIds.has(c.criterionId));
  const outDist = perCriterionOut.filter((c) => oodIds.has(c.criterionId));
  const avg = (arr: CriterionStat[]) => {
    const w = arr.reduce((a, c) => a + c.count, 0);
    return w === 0 ? 0 : arr.reduce((a, c) => a + c.accuracy * c.count, 0) / w;
  };
  const inAcc = avg(inDist);
  const outAcc = avg(outDist);

  const calibration = computeCalibration(calibRecords);
  // 中英分列准确率：各语言侧按**自身样本量**加权（分母 = ΣcountZh / ΣcountEn
  // ——zh 读数不得作 en 分母，否则 en 读数是「en 准确率按全量加权」非 en 一致率）
  const zhAcc = perCriterionOut.reduce((a, c) => a + c.accuracyByLang.zh * c.countZh, 0) / Math.max(1, perCriterionOut.reduce((a, c) => a + c.countZh, 0));
  const enAcc = perCriterionOut.reduce((a, c) => a + c.accuracyByLang.en * c.countEn, 0) / Math.max(1, perCriterionOut.reduce((a, c) => a + c.countEn, 0));
  const zhEnGap = Math.abs(zhAcc - enAcc);

  // 分面读数装配（numeric 面 ECE 恒 NOT_MEASURED——裁决②；空侧哨兵防「空集给 0」）
  const faceReading = (
    agg: { hitZh: number; totalZh: number; hitEn: number; totalEn: number; calib: CalibrationRecord[] },
    numericFace: boolean,
  ): FaceReading => {
    const calib = numericFace ? null : agg.calib.length > 0 ? computeCalibration(agg.calib) : null;
    return {
      agreementZh: agg.totalZh === 0 ? NOT_MEASURED : agg.hitZh / agg.totalZh,
      agreementEn: agg.totalEn === 0 ? NOT_MEASURED : agg.hitEn / agg.totalEn,
      countZh: agg.totalZh,
      countEn: agg.totalEn,
      eceZh: numericFace || calib === null ? NOT_MEASURED : calib.eceByLang.zh,
      eceEn: numericFace || calib === null ? NOT_MEASURED : calib.eceByLang.en,
    };
  };

  const elapsedMs = Date.now() - startedAt;
  const usedCount = dataset.length;

  return {
    perCriterion: perCriterionOut,
    failuresByLang: { zh: classify('zh'), en: classify('en') },
    calibration,
    inDistributionAccuracy: inAcc,
    outOfDistributionAccuracy: outAcc,
    generalizationGap: inAcc - outAcc,
    candidateSetUtilization: {
      candidateSetSize: dataset.length,
      usedCount,
      utilizationRatio: dataset.length === 0 ? 0 : usedCount / dataset.length,
    },
    zhEnGap,
    zhUsable: zhEnGap <= 0.15, // 超阈不宣称中文可用（阈 0.15——如实落数口径）
    faces: {
      semantic: faceReading(facesAgg.semantic, false),
      numeric: faceReading(facesAgg.numeric, true),
      gradelong: faceReading(facesAgg.gradelong, false),
    },
    routing: {
      enabled: routingEnabled,
      routedCount,
      routedByRule,
      failOpenCount,
    },
    runtime: { elapsedMs },
    caveat: '零样本·单次运行·自产基线（不可复算数字不与可复算数字并列展示）·分面读数（semantic/numeric/gradelong 三列不合并）',
  };
}

// ════════════════════════════════════════
// v1.7.0 §六 · 三态对照 + 双指标分离 + best-of-N + 达阈判定（阶段二收口面）
// ════════════════════════════════════════

/** 一致率冻结线（动工前冻结——事后只许收紧不许放宽，不得由实现结果反推） */
export const AGREEMENT_HARD_LINE = 0.70;

/** ECE 冻结线（与 §二 ECE_HARD_LINE 同值冻结——orchestrator 侧独立常量防包循环） */
export const ECE_HARD_LINE_JUDGE = 0.10;

/** 达阈哨兵值：未实测（空样本或无实机环境——ECE=0 在本版语义下是「完美校准」，空集给 0 = 未测谎报为最优） */
export const NOT_MEASURED = 'not-measured' as const;

/** 单态读数（三态对照的一列） */
export interface ThreeStateReading {
  /** 态名：zeroShot（本版实测训练基座零样本——非 v1.6.0 mock 读数） / trained / calibrated */
  state: 'zeroShot' | 'trained' | 'calibrated';
  /** 判定质量指标一：逐判据一致率（中文列——≥0.70 且分列各自达线） */
  agreementZh: number | typeof NOT_MEASURED;
  /** 判定质量指标一：逐判据一致率（英文列——≥0.70 且分列各自达线） */
  agreementEn: number | typeof NOT_MEASURED;
  /** 概率可信度指标二：ECE 中文读数（≤0.10 冻结线） */
  eceZh: number | typeof NOT_MEASURED;
  /** 概率可信度指标二：ECE 英文读数（≤0.10 冻结线） */
  eceEn: number | typeof NOT_MEASURED;
  /** 样本量（0 ⇒ 各指标产 not-measured 哨兵） */
  sampleCount: number;
  /** 口径注记（not-measured 环境如实标注原因——不修饰） */
  note?: string;
}

/** best-of-N 选优列读数（N 与选择器口径随表落数） */
export interface BestOfNReading {
  /** 采样候选数 N */
  n: number;
  /** 选择器口径（如何从 N 候选选优——如「判定头 max-prob」） */
  selector: string;
  /** 选优后一致率（zh 分列；无实测环境时 not-measured） */
  agreementZh: number | typeof NOT_MEASURED;
  /** 选优后一致率（en 分列） */
  agreementEn: number | typeof NOT_MEASURED;
}

/** 双指标两线独立判定读数 */
export interface DualThresholdVerdict {
  /** 判定质量线：逐判据一致率 ≥0.70 且 zh/en 分列各自达线（not-measured ⇒ 未达——未测不得记达标） */
  agreementPass: boolean;
  /** 概率可信度线：ECE 各档 ≤0.10（not-measured ⇒ 未达） */
  ecePass: boolean;
  /** 阶段三裁决：双达阈 → proceed；任一未达 → deferred（阶段三暂缓，回退阶段一/二修补） */
  stageThree: 'proceed' | 'deferred';
  /** 判定明细（逐线理由——非自指：报「相对基座提升 Δ」与「线距实值」） */
  reasons: string[];
}

/** 三态对照报告（同数据集同评测器） */
export interface ThreeStateComparison {
  /** 数据集标识（对照口径不漂移的锚） */
  datasetId: string;
  /** 评测器口径（版本号——阶段二对照须与基线同评测器） */
  evaluatorVersion: string;
  /** 三态读数（zeroShot / trained / calibrated 并列——第一态本版实测，mock 读数并列留档不进对照列） */
  states: ThreeStateReading[];
  /** v1.6.0 mock 读数留档（mock 契约编码器非真基座，跨口径不可比——不进对照列） */
  v1_6_mockArchive: { agreementZh: number; agreementEn: number; note: string };
  /** best-of-N 选优列 */
  bestOfN: BestOfNReading;
  /** 双达阈判定（两线独立） */
  verdict: DualThresholdVerdict;
  /** 口径声明 */
  caveat: string;
}

/**
 * 从既有 BaselineReport 提取单态读数（三态对照的构造器——同一评测器口径）。
 * 样本量为 0 或环境未实测时各指标产 not-measured 哨兵（不产 0——空集给 0
 * = 未测谎报为最优，§二「空集哨兵」同族防线）。
 */
export function readingFromReport(
  state: ThreeStateReading['state'],
  report: BaselineReport,
  opts?: { note?: string },
): ThreeStateReading {
  const n = report.perCriterion.reduce((a, c) => a + c.count, 0);
  const notMeasured = n === 0;
  // 逐判据一致率（zh/en 分列——各语言侧按自身样本量加权：zh 分母 = ΣcountZh、
  // en 分母 = ΣcountEn。复核第 1 轮错位面：en 曾以全量 zhTotal 作分母，读数
  // 变成「en 准确率按全量加权」而非 en 一致率，且直接进 0.70 达阈判定
  const zhTotal = report.perCriterion.reduce((a, c) => a + c.countZh, 0);
  const enTotal = report.perCriterion.reduce((a, c) => a + c.countEn, 0);
  const zhWeighted = report.perCriterion.reduce((a, c) => a + c.accuracyByLang.zh * c.countZh, 0);
  const enWeighted = report.perCriterion.reduce((a, c) => a + c.accuracyByLang.en * c.countEn, 0);
  const eceZh = report.calibration.eceByLang.zh;
  const eceEn = report.calibration.eceByLang.en;
  return {
    state,
    // 单语言空侧同产 not-measured 哨兵（CR3 🟠-1）：「空集给 0 = 未测谎报为最优/最差」
    // 双向都不成立——en 无样本时 agreementEn=0 恰好方向安全（0<0.70 未达），但 eceEn=0
    // 会撞 ≤0.10 达线（方向反了）。分语言各自按自身 total 判空。
    agreementZh: notMeasured || zhTotal === 0 ? NOT_MEASURED : zhWeighted / zhTotal,
    agreementEn: notMeasured || enTotal === 0 ? NOT_MEASURED : enWeighted / enTotal,
    eceZh: notMeasured || zhTotal === 0 ? NOT_MEASURED : eceZh,
    eceEn: notMeasured || enTotal === 0 ? NOT_MEASURED : eceEn,
    sampleCount: n,
    note: opts?.note,
  };
}

/**
 * 双达阈判定（两线独立判定，任一未达即阶段三暂缓）：
 *   - 判定质量线：trained/calibrated 态（有效态=最后一次机制作用后的读数）
 *     一致率 zh 与 en **各自** ≥0.70（分列不合并计，not-measured ⇒ 未达）；
 *   - 概率可信度线：同有效态 ECE zh 与 en 各自 ≤0.10（not-measured ⇒ 未达）；
 *   - 非自指纪律：判定不引用自身结果反推阈值；超线仍须报「相对基座提升 Δ」
 *     与「线距实值」（超线不构成训练有效证据——基座既有水平不得顶替判定）。
 */
export function judgeThresholdVerdict(
  states: readonly ThreeStateReading[],
  baseline?: ThreeStateReading,
): DualThresholdVerdict {
  // 有效态：取 calibrated（若在读）否则 trained——两线在同一有效态上判定
  const effective = states.find((s) => s.state === 'calibrated') ?? states.find((s) => s.state === 'trained');
  const reasons: string[] = [];
  if (!effective) {
    return {
      agreementPass: false,
      ecePass: false,
      stageThree: 'deferred',
      reasons: ['无有效态读数（trained/calibrated 均缺席）——双线均未达，阶段三暂缓'],
    };
  }
  const zhOk = effective.agreementZh !== NOT_MEASURED && effective.agreementZh >= AGREEMENT_HARD_LINE;
  const enOk = effective.agreementEn !== NOT_MEASURED && effective.agreementEn >= AGREEMENT_HARD_LINE;
  const agreementPass = zhOk && enOk;
  // 线距实值 + 相对基座提升 Δ（非自指——超线仍报 Δ 与线距）
  const fmt = (v: number | typeof NOT_MEASURED) => (v === NOT_MEASURED ? 'not-measured' : v.toFixed(3));
  reasons.push(
    `判定质量线（一致率 ≥${AGREEMENT_HARD_LINE}，中英分列各自达线）：zh ${fmt(effective.agreementZh)} ${zhOk ? '达线' : effective.agreementZh === NOT_MEASURED ? '未测不得记达标' : '未达'} · en ${fmt(effective.agreementEn)} ${enOk ? '达线' : effective.agreementEn === NOT_MEASURED ? '未测不得记达标' : '未达'}`,
  );
  if (baseline && baseline.agreementZh !== NOT_MEASURED && effective.agreementZh !== NOT_MEASURED) {
    reasons.push(
      `相对基座提升 Δ：zh ${(effective.agreementZh - baseline.agreementZh >= 0 ? '+' : '') + (effective.agreementZh - baseline.agreementZh).toFixed(3)} · en ${(effective.agreementEn !== NOT_MEASURED && baseline.agreementEn !== NOT_MEASURED ? (effective.agreementEn - baseline.agreementEn >= 0 ? '+' : '') + (effective.agreementEn - baseline.agreementEn).toFixed(3) : 'not-measured')}（超线不构成训练有效证据——基座既有水平不得顶替判定）`,
    );
  }
  const eceZhOk = effective.eceZh !== NOT_MEASURED && effective.eceZh <= ECE_HARD_LINE_JUDGE;
  const eceEnOk = effective.eceEn !== NOT_MEASURED && effective.eceEn <= ECE_HARD_LINE_JUDGE;
  const ecePass = eceZhOk && eceEnOk;
  reasons.push(
    `概率可信度线（ECE ≤${ECE_HARD_LINE_JUDGE}，各档独立）：zh ${fmt(effective.eceZh)} ${eceZhOk ? '达线' : effective.eceZh === NOT_MEASURED ? '未测不得记达标' : '未达'} · en ${fmt(effective.eceEn)} ${eceEnOk ? '达线' : effective.eceEn === NOT_MEASURED ? '未测不得记达标' : '未达'}`,
  );
  const stageThree = agreementPass && ecePass ? 'proceed' : 'deferred';
  if (stageThree === 'deferred') {
    reasons.push('任一线未达 ⇒ 阶段三暂缓（回退阶段一/二修补——接线一个不可信的判定模型比不接线更危险）');
  }
  return { agreementPass, ecePass, stageThree, reasons };
}

/**
 * 构造三态对照报告（§六收口面）。
 * 第一态 = 训练基座本版实测零样本读数（not-measured 环境如实标注）；
 * v1.6.0 mock 读数并列留档、不进对照列（mock 契约编码器非真基座，跨口径不可比）。
 */
export function buildThreeStateComparison(input: {
  datasetId: string;
  evaluatorVersion: string;
  zeroShot: ThreeStateReading;
  trained: ThreeStateReading;
  calibrated: ThreeStateReading;
  bestOfN: BestOfNReading;
}): ThreeStateComparison {
  const states = [input.zeroShot, input.trained, input.calibrated];
  return {
    datasetId: input.datasetId,
    evaluatorVersion: input.evaluatorVersion,
    states,
    v1_6_mockArchive: {
      agreementZh: 0.667,
      agreementEn: 0.333,
      note: 'v1.6.0 mock 契约编码器读数（datasets/baseline-zero-shot-result.json）——并列留档不进对照列：mock 非真基座，跨口径不可比',
    },
    bestOfN: input.bestOfN,
    verdict: judgeThresholdVerdict(states, input.zeroShot),
    caveat: '三态对照·同数据集同评测器·双指标分离（判定质量与概率可信度不合并）·两线独立判定（任一未达即阶段三暂缓）',
  };
}
