// judge-eval.ts · 零样本评测器（逐判据统计 + 失败模式分类 + 中英分列 + 分布内外分列）
// ============================================================
// 在第五–七章数据集上跑零样本推理（基座不微调）；逐判据命中率/一致率；
// 失败模式分类（哪类判据零样本最弱——阶段二训练重点输入）；中英分列
// 落数（准确率+ECE 分列不合并）；分布内外分列（演示任务族 vs 从未训练
// 任务类型——泛化落差显式声明）；基线自产（引用他人数字不构成基线）；
// 耗时与成本同批记录（预算分配分母）。
// ============================================================
import type { DecisionSample } from './decision-dataset-schema';
import type { DecisionQuestion } from './decision-primitives';
import type { JudgeRuntime } from './judge-runtime';
import { computeCalibration, type CalibrationRecord, type CalibrationReport } from './calibration-report';

/** 逐判据统计 */
export interface CriterionStat {
  criterionId: string;
  /** 命中率（预测与真值一致比例） */
  accuracy: number;
  /** 样本数 */
  count: number;
  /** 按语言分列 */
  accuracyByLang: { zh: number; en: number };
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

export interface BaselineReport {
  /** 逐判据统计 */
  perCriterion: CriterionStat[];
  /** 失败模式分类（按语言分开报） */
  failuresByLang: { zh: FailureClassification[]; en: FailureClassification[] };
  /** 校准现状（分桶+ECE——中英分列） */
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
  /** 耗时与成本（单次评测——预算分配分母） */
  runtime: { elapsedMs: number };
  /** 口径声明（零样本·单次运行·自产基线） */
  caveat: string;
}

const RANDOM_BASELINE = 0.5; // noul 二值随机基线

export function evaluateZeroShot(
  runtime: JudgeRuntime,
  dataset: DecisionSample[],
  opts?: { oodCriterionIds?: Set<string> },
): BaselineReport {
  const startedAt = Date.now();
  const perCriterion = new Map<string, { hit: number; total: number; hitZh: number; totalZh: number; hitEn: number; totalEn: number; probs: number[]; truths: number[] }>();
  const calibRecords: CalibrationRecord[] = [];

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
    s.questions.forEach((q, i) => {
      const ans = result.answers[i]!;
      const truth = s.answers[i]!;
      const cid = q.id;
      const entry = perCriterion.get(cid) ?? { hit: 0, total: 0, hitZh: 0, totalZh: 0, hitEn: 0, totalEn: 0, probs: [], truths: [] };
      // 命中判定：noul 概率阈值 0.5 二值对照；choice 选中一致；score 就近
      let hit = false;
      let prob = 0.5;
      if (ans.kind === 'noul' && truth.kind === 'noul') {
        prob = ans.probability ?? 0.5;
        const truthVal = (truth.probability ?? 0.5) >= 0.5 ? 1 : 0;
        hit = (prob >= 0.5 ? 1 : 0) === truthVal;
        entry.probs.push(prob);
        entry.truths.push(truthVal);
        calibRecords.push({ predicted: prob, actual: truthVal as 0 | 1, lang: s.lang });
      } else if (ans.kind === 'choice' && truth.kind === 'choice') {
        hit = ans.selected === truth.selected;
        prob = ans.distribution?.[truth.selected ?? ''] ?? 0.5;
        calibRecords.push({ predicted: prob, actual: hit ? 1 : 0, lang: s.lang });
      } else if (ans.kind === 'score' && truth.kind === 'score') {
        hit = Math.abs((ans.value ?? 0) - (truth.value ?? 0)) <= (truth.interval?.upper ?? 1) - (truth.interval?.lower ?? 0) + 0.5;
      }
      entry.total += 1;
      if (hit) entry.hit += 1;
      if (s.lang === 'zh') { entry.totalZh += 1; if (hit) entry.hitZh += 1; }
      else { entry.totalEn += 1; if (hit) entry.hitEn += 1; }
      perCriterion.set(cid, entry);
    });
  }

  const perCriterionOut: CriterionStat[] = [...perCriterion.entries()].map(([criterionId, e]) => ({
    criterionId,
    accuracy: e.total === 0 ? 0 : e.hit / e.total,
    count: e.total,
    accuracyByLang: {
      zh: e.totalZh === 0 ? 0 : e.hitZh / e.totalZh,
      en: e.totalEn === 0 ? 0 : e.hitEn / e.totalEn,
    },
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
  const zhAcc = perCriterionOut.reduce((a, c) => a + c.accuracyByLang.zh * (c.count || 0), 0) / Math.max(1, perCriterionOut.reduce((a, c) => a + c.count, 0));
  const enAcc = perCriterionOut.reduce((a, c) => a + c.accuracyByLang.en * (c.count || 0), 0) / Math.max(1, perCriterionOut.reduce((a, c) => a + c.count, 0));
  const zhEnGap = Math.abs(zhAcc - enAcc);

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
    runtime: { elapsedMs },
    caveat: '零样本·单次运行·自产基线（不可复算数字不与可复算数字并列展示）',
  };
}
