// collectors/hard-sample-collector.ts · 九类困难样本采集点
// ============================================================
// 九类（每类附「判定它属于本类的判据」——可断言实现，不靠关键词匹配）：
//   ① 弃权记录 ② 上下文取舍 ③ 路由对比 ④ 措辞不变性 ⑤ OOD（按判据域）
//   ⑥ 漂移探测 ⑦ 对抗 ⑧ 对齐分歧 ⑨ 出站裁决
// 每类分别落数（命中数 + 最后一次命中时点，零值也落——「零命中」须与
// 「采集点未就位」可区分）。
// ============================================================
import type { DecisionSample } from '../decision-dataset-schema';

/** 九类采集点键（闭合枚举） */
export type HardSampleKind =
  | 'abstention'          // ① 弃权记录
  | 'context-tradeoff'    // ② 上下文取舍
  | 'routing-divergence'  // ③ 路由对比
  | 'paraphrase-invariance' // ④ 措辞不变性
  | 'ood'                 // ⑤ 分布外（按判据域登记）
  | 'drift'               // ⑥ 漂移探测
  | 'adversarial'         // ⑦ 对抗
  | 'alignment-disagreement' // ⑧ 对齐分歧
  | 'egress-verdict';     // ⑨ 出站裁决

/** 九类各自的归类判据输入 */
export interface HardSampleInput {
  kind: HardSampleKind;
  /** 样本本体 */
  sample: DecisionSample;
  /** 归类判据的断言证据（各 kind 的字段——见 assertHardSampleKind） */
  evidence: {
    /** ①弃权：输出态 ABSTAIN 或选中兜底项；须同记当时概率与门槛 */
    abstainedOrFallback?: { abstained: boolean; fallbackSelected: boolean; probability: number; threshold: number };
    /** ②取舍：成对可比——差异只在被取舍片段；须过必要性检查（删后焦点变未知） */
    pairComparable?: { focusBecameUnknownAfterRemoval: boolean; budget: { candidates: number; contextWindow: number; rerankEnabled: boolean } };
    /** ③路由对比：三档层结论不同（L0/L1/L2 分歧本身是标签）+ 确定性规则结论参照 */
    layerDivergence?: { l0: string; l1: string; l2: string; deterministicRuleVerdict?: string };
    /** ④措辞不变性：改写语义等价性已确认 + 漂移量按改写类型分列 */
    paraphraseConfirmed?: { semanticEquivalenceConfirmed: boolean; driftByType: Record<string, number> };
    /** ⑤OOD：判据域不在本版判据集内（按域登记） */
    oodDomain?: { criterionDomain: string; inCurrentCriteriaSet: boolean };
    /** ⑥漂移：两时点分桶可靠图单向偏移 + 同记时点 */
    driftObserved?: { t1BucketReliability: number[]; t2BucketReliability: number[]; t1: string; t2: string };
    /** ⑦对抗：state 诱导答案偏移 / 越权请求 */
    adversarialForm?: { inducedAnswerShift: boolean } | { carriesPolicyText: boolean };
    /** ⑧对齐分歧：model-judge 与 human 冲突 */
    labelConflict?: { modelLabel: string; humanLabel: string };
    /** ⑨出站裁决：白名单外 host 请求的裁决 */
    egressEvent?: { host: string; whitelisted: boolean };
  };
}

/** 每类命中落数（零值也落） */
export interface HardSampleLedger {
  kind: HardSampleKind;
  hitCount: number;
  lastHitAt: string | null;
  /** 采集点就位标记（区分「零命中」与「未就位」） */
  collectorReady: boolean;
}

/** 归类判据（可断言——不靠关键词匹配；不过判据的输入被拒收并给原因） */
export function assertHardSampleKind(input: HardSampleInput): { ok: true } | { ok: false; reason: string } {
  const { kind, evidence } = input;
  switch (kind) {
    case 'abstention': {
      const a = evidence.abstainedOrFallback;
      if (!a) return { ok: false, reason: '①弃权：缺 abstainedOrFallback 证据' };
      if (!a.abstained && !a.fallbackSelected) return { ok: false, reason: '①弃权：既非 ABSTAIN 态也未选兜底项——不属本类' };
      if (a.probability === undefined || a.threshold === undefined) return { ok: false, reason: '①弃权：须同记当时概率与门槛（区分真不确定与门槛设错）' };
      return { ok: true };
    }
    case 'context-tradeoff': {
      const c = evidence.pairComparable;
      if (!c) return { ok: false, reason: '②取舍：缺 pairComparable 证据' };
      if (!c.focusBecameUnknownAfterRemoval) return { ok: false, reason: '②取舍：必要性检查未过——删片段后焦点未变未知（冗余非必需证据）' };
      if (!c.budget || c.budget.candidates === undefined) return { ok: false, reason: '②取舍：须同记预算口径（候选数/上下文窗口/重排）' };
      return { ok: true };
    }
    case 'routing-divergence': {
      const d = evidence.layerDivergence;
      if (!d) return { ok: false, reason: '③路由对比：缺 layerDivergence 证据' };
      const all = new Set([d.l0, d.l1, d.l2]);
      if (all.size === 1) return { ok: false, reason: '③路由对比：三档层结论一致——无分歧不构成本类' };
      return { ok: true };
    }
    case 'paraphrase-invariance': {
      const p = evidence.paraphraseConfirmed;
      if (!p) return { ok: false, reason: '④措辞不变性：缺 paraphraseConfirmed 证据' };
      if (!p.semanticEquivalenceConfirmed) return { ok: false, reason: '④措辞不变性：改写语义等价性未确认（未确认的改写只是新样本）' };
      return { ok: true };
    }
    case 'ood': {
      const o = evidence.oodDomain;
      if (!o) return { ok: false, reason: '⑤OOD：缺 oodDomain 证据（按判据域登记非形态）' };
      if (o.inCurrentCriteriaSet) return { ok: false, reason: '⑤OOD：判据域在当前集内——非分布外' };
      return { ok: true };
    }
    case 'drift': {
      const dft = evidence.driftObserved;
      if (!dft) return { ok: false, reason: '⑥漂移：缺 driftObserved 证据' };
      if (!dft.t1 || !dft.t2) return { ok: false, reason: '⑥漂移：须同记两时点（否则不可复现）' };
      // 最小断言：可靠图单向偏移（fresh-eyes run-01 项 7）——两时点各产分桶
      // 命中数组，须至少一桶发生单调变化（逐桶差值存在非零项）才算 drift 类。
      // 此前仅查 t1/t2 非空——空数组/全等数组也落 ok:true，把「无漂移」误归
      // drift 类（台账虚高）。长度不齐 = 分桶口径漂了，同为不可判证据。
      const t1 = dft.t1BucketReliability;
      const t2 = dft.t2BucketReliability;
      if (!Array.isArray(t1) || !Array.isArray(t2) || t1.length === 0 || t1.length !== t2.length) {
        return { ok: false, reason: '⑥漂移：两时点分桶可靠图数组缺失或长度不齐（须同口径同桶数）' };
      }
      const deltas = t1.map((v, i) => (t2[i] as number) - v);
      if (deltas.every((d) => d === 0)) {
        return { ok: false, reason: '⑥漂移：两时点分桶可靠图逐桶零变化——无单向偏移不构成本类' };
      }
      return { ok: true };
    }
    case 'adversarial': {
      const adv = evidence.adversarialForm;
      if (!adv) return { ok: false, reason: '⑦对抗：缺 adversarialForm 证据' };
      // 判别键先校验（fresh-eyes run-01 项 6）：空对象/无判别键的 adversarialForm
      // 此前直落 ok:true（`in` 检查全不命中即漏过）——先验必需判别键在位，缺键拒收。
      const hasShiftKey = 'inducedAnswerShift' in adv;
      const hasPolicyKey = 'carriesPolicyText' in adv;
      if (!hasShiftKey && !hasPolicyKey) {
        return { ok: false, reason: '⑦对抗：adversarialForm 缺判别键（须 inducedAnswerShift 或 carriesPolicyText 至少其一）' };
      }
      if (hasShiftKey) {
        if (!(adv as { inducedAnswerShift: boolean }).inducedAnswerShift) return { ok: false, reason: '⑦对抗：同一事实换措辞答案未变——非诱导偏移样本' };
      } else {
        if (!(adv as { carriesPolicyText: boolean }).carriesPolicyText) return { ok: false, reason: '⑦对抗：未携带授权/政策类文本——非越权形态' };
      }
      return { ok: true };
    }
    case 'alignment-disagreement': {
      const lc = evidence.labelConflict;
      if (!lc) return { ok: false, reason: '⑧对齐分歧：缺 labelConflict 证据' };
      if (lc.modelLabel === lc.humanLabel) return { ok: false, reason: '⑧对齐分歧：两侧标签一致——无分歧' };
      return { ok: true };
    }
    case 'egress-verdict': {
      const e = evidence.egressEvent;
      if (!e) return { ok: false, reason: '⑨出站裁决：缺 egressEvent 证据' };
      if (e.whitelisted) return { ok: false, reason: '⑨出站裁决：白名单内请求——非困难样本（稀有正例在名单外）' };
      return { ok: true };
    }
  }
}

/** 九类采集器（分别落数——零值也落） */
export class HardSampleCollector {
  private ledgers = new Map<HardSampleKind, HardSampleLedger>();
  private collected: Array<HardSampleInput & { acceptedAt: string }> = [];
  private readonly now: () => string;

  constructor(now?: () => string) {
    this.now = now ?? (() => new Date().toISOString());
    for (const k of [
      'abstention', 'context-tradeoff', 'routing-divergence', 'paraphrase-invariance',
      'ood', 'drift', 'adversarial', 'alignment-disagreement', 'egress-verdict',
    ] as HardSampleKind[]) {
      this.ledgers.set(k, { kind: k, hitCount: 0, lastHitAt: null, collectorReady: true });
    }
  }

  /** 采集一条（归类判据不过则拒收并返回原因——对抗类样本采集不改变判定行为只留证） */
  collect(input: HardSampleInput): { ok: true } | { ok: false; reason: string } {
    const verdict = assertHardSampleKind(input);
    if (!verdict.ok) return verdict;
    const ts = this.now();
    this.collected.push({ ...input, acceptedAt: ts });
    const ledger = this.ledgers.get(input.kind)!;
    ledger.hitCount += 1;
    ledger.lastHitAt = ts;
    return { ok: true };
  }

  /** 九类台账（命中数 + 最后命中时点——零值也落，「零命中」与「未就位」可区分） */
  ledger(): HardSampleLedger[] {
    return [...this.ledgers.values()];
  }

  /** OOD 类落数分布内外分列（禁止合并成单一总准确率） */
  oodSplit(): { inDistribution: number; outOfDistribution: number } {
    let inD = 0;
    let outD = 0;
    for (const c of this.collected) {
      if (c.kind !== 'ood') continue;
      if (c.evidence.oodDomain?.inCurrentCriteriaSet) inD += 1;
      else outD += 1;
    }
    return { inDistribution: inD, outOfDistribution: outD };
  }

  /** 中英文样本占比分别落数（不合并为总量） */
  langSplit(): { zh: number; en: number } {
    let zh = 0;
    let en = 0;
    for (const c of this.collected) {
      if (c.sample.lang === 'zh') zh += 1;
      else en += 1;
    }
    return { zh, en };
  }
}
