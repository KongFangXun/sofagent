// collectors/hitl-collector.ts · HITL 裁决源采集（人工裁决 → 三元组）
// ============================================================
// 人工批准/拒绝是最高可信档 human-only 标签——直接可作校准的真值来源。
// 理解证据同采：裁决前是否产生过针对该变更的追问/修改意见/复核动作——
// 有 ⇒ understood: evidenced；无 ⇒ understood: unobserved
//（「未观测」≠「未理解」，禁止合并——合并即把「不知道」记成「没有」）。
// ============================================================
import type { DecisionSample, DatasetQuestion, DatasetAnswer } from '../decision-dataset-schema';

/** HITL 源输入（调用方从 hitl/resolved 通道读出） */
export interface HitlRecord {
  hitlSessionId: string;
  /** 被裁决的变更状态 */
  state: string;
  /** 人工裁决 */
  verdict: 'approved' | 'rejected';
  /** 裁决前是否产生过追问/修改意见/复核动作（理解证据——不做停留时长类形式指标） */
  hadEngagement: boolean;
  enterpriseId: string;
  lang: 'zh' | 'en';
}

/** HITL 样本扩展：理解证据二值（禁止合并语义） */
export interface HitlSampleMeta {
  understood: 'evidenced' | 'unobserved';
}

export interface HitlCollectResult {
  accepted: Array<DecisionSample & { hitlMeta: HitlSampleMeta }>;
  rejected: Array<{ record: HitlRecord; reason: string }>;
}

export function collectFromHitl(records: HitlRecord[]): HitlCollectResult {
  const accepted: HitlCollectResult['accepted'] = [];
  const rejected: HitlCollectResult['rejected'] = [];
  for (const r of records) {
    if (!r.hitlSessionId) {
      rejected.push({ record: r, reason: '缺 hitlSessionId（血缘锚点）' });
      continue;
    }
    const q: DatasetQuestion = { kind: 'noul', id: 'q-verdict', question: '该变更应被批准吗？' };
    const a: DatasetAnswer = {
      kind: 'noul',
      questionId: 'q-verdict',
      probability: r.verdict === 'approved' ? 0.95 : 0.05,
    };
    accepted.push({
      state: r.state,
      questions: [q],
      answers: [a],
      label: { source: 'human-only' }, // 最高可信档
      provenance: { hitlSessionId: r.hitlSessionId },
      enterpriseId: r.enterpriseId,
      lang: r.lang,
      hitlMeta: { understood: r.hadEngagement ? 'evidenced' : 'unobserved' },
    });
  }
  return { accepted, rejected };
}
