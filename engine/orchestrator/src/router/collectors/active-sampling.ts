// collectors/active-sampling.ts · 主动学习四类选样 + 焦点翻转对构造
// ============================================================
// 四类选样（不确定/分歧/代表/漂移——可配置，选样理由落痕非黑箱挑样）；
// 焦点翻转对（单变量翻转、其余逐字不动、标 synthetic 扩面样本不进校准集）。
// ============================================================
import type { DecisionSample, DatasetQuestion, DatasetAnswer } from '../decision-dataset-schema';
import { privateSampleHash } from './quality-gates';

/** 选样策略（四类闭合枚举） */
export type SamplingStrategy = 'uncertainty' | 'disagreement' | 'representative' | 'drift';

/** 选样结果（含理由——留痕非黑箱） */
export interface SamplingPick {
  sample: DecisionSample;
  reason: string;
  priority: number;
}

/** 选样输入面 */
export interface SamplingContext {
  strategy: SamplingStrategy;
  /** 不确定优先输入：各样本主概率 */
  probabilities?: Map<string, number>;
  /** 分歧优先输入：模型判定 vs 人工裁决不一致的样本哈希集 */
  disagreementHashes?: Set<string>;
  /** 代表优先输入：各判据域已有样本计数（稀疏域优先） */
  domainCounts?: Map<string, number>;
  /** 漂移优先输入：标定失准的判据域集 */
  driftedDomains?: Set<string>;
  topK: number;
}

export function selectSamples(samples: DecisionSample[], ctx: SamplingContext): SamplingPick[] {
  const picks: SamplingPick[] = [];
  for (const s of samples) {
    const hash = privateSampleHash(s);
    switch (ctx.strategy) {
      case 'uncertainty': {
        const p = ctx.probabilities?.get(hash);
        if (p === undefined) continue;
        const distance = Math.abs(p - 0.5); // 越近 0.5 越接近决策边界
        picks.push({ sample: s, reason: `不确定优先：主概率 ${p.toFixed(3)}（距边界 ${distance.toFixed(3)}）`, priority: -distance });
        break;
      }
      case 'disagreement': {
        if (!ctx.disagreementHashes?.has(hash)) continue;
        picks.push({ sample: s, reason: '分歧优先：模型判定与人工裁决不一致', priority: 1 });
        break;
      }
      case 'representative': {
        const domain = (s as { criterionDomain?: string }).criterionDomain ?? 'unknown';
        const count = ctx.domainCounts?.get(domain) ?? 0;
        picks.push({ sample: s, reason: `代表优先：判据域 ${domain} 现有 ${count} 条（稀疏域优先）`, priority: -count });
        break;
      }
      case 'drift': {
        const domain = (s as { criterionDomain?: string }).criterionDomain ?? 'unknown';
        if (!ctx.driftedDomains?.has(domain)) continue;
        picks.push({ sample: s, reason: `漂移优先：判据域 ${domain} 标定失准`, priority: 1 });
        break;
      }
    }
  }
  picks.sort((a, b) => b.priority - a.priority);
  return picks.slice(0, ctx.topK);
}

/** 焦点翻转对构造（单变量翻转、其余逐字不动；标 synthetic 扩面不进校准） */
export interface FlippedPairInput {
  /** 原始真实样本 */
  base: DecisionSample;
  /** 翻转后的 state（只改一个焦点事实——事实须取自真实痕迹非凭空编造） */
  flippedState: string;
  /** 翻转后的答案（同一问句下的相反判定） */
  flippedAnswer: DatasetAnswer;
  /** 翻转说明（哪个焦点事实被翻转） */
  focusFact: string;
}

export interface FlippedPairOutput {
  original: DecisionSample;
  flipped: DecisionSample;
  familyId: string;
  syntheticMark: true;
}

export function buildFlippedPair(input: FlippedPairInput): FlippedPairOutput {
  const familyId = `flip-${privateSampleHash(input.base)}`;
  const flipped: DecisionSample = {
    ...input.base,
    state: input.flippedState,
    answers: [input.flippedAnswer],
    label: { source: 'model-judge' }, // 翻转构造非真实痕迹——扩面样本
    contrastive: {
      isContrastive: true,
      familyId,
      focusFact: input.focusFact,
      changedWords: 1,
      evidenceCertificate: {
        baseline: [{ statement: input.focusFact, status: 'supported' }],
        counterfactual: [{ statement: input.focusFact, status: 'refuted' }],
        deletedLeft: [{ statement: input.focusFact, status: 'unknown' }],
        deletedRight: [{ statement: input.focusFact, status: 'unknown' }],
      },
    },
  };
  (flipped as { synthetic?: boolean }).synthetic = true; // 扩面标记——不进校准集
  return {
    original: { ...input.base, contrastive: { ...flipped.contrastive!, familyId } },
    flipped,
    familyId,
    syntheticMark: true,
  };
}

/** 中英文占比分列统计（章六/七共用口径——不合并为总量） */
export function langRatio(samples: DecisionSample[]): { zh: number; en: number; zhRatio: number; enRatio: number } {
  const zh = samples.filter((s) => s.lang === 'zh').length;
  const en = samples.filter((s) => s.lang === 'en').length;
  const total = zh + en;
  return { zh, en, zhRatio: total === 0 ? 0 : zh / total, enRatio: total === 0 ? 0 : en / total };
}
