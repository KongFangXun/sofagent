// collectors/pr-collector.ts · PR 审阅源采集（审阅结论 → 三元组）
// ============================================================
// 从 pr-store 的审阅结论与 suggestion 采纳情况抽取——采纳/拒绝构成标签。
// ============================================================
import type { DecisionSample, DatasetQuestion, DatasetAnswer } from '../decision-dataset-schema';

/** PR 源输入 */
export interface PrRecord {
  prNumber: number;
  /** PR 的变更状态（diff 摘要或 review 上下文） */
  state: string;
  /** 审阅结论（采纳/拒绝构成标签） */
  outcome: 'merged' | 'rejected' | 'changes-requested';
  enterpriseId: string;
  lang: 'zh' | 'en';
}

export interface PrCollectResult {
  accepted: DecisionSample[];
  rejected: Array<{ record: PrRecord; reason: string }>;
}

export function collectFromPr(records: PrRecord[]): PrCollectResult {
  const accepted: DecisionSample[] = [];
  const rejected: PrCollectResult['rejected'] = [];
  for (const r of records) {
    if (typeof r.prNumber !== 'number' || Number.isNaN(r.prNumber)) {
      rejected.push({ record: r, reason: 'prNumber 非法（血缘锚点）' });
      continue;
    }
    if (r.outcome === 'changes-requested') {
      // 待定态不构成标签——跳过并记原因
      rejected.push({ record: r, reason: 'changes-requested 为中间态（未形成采纳/拒绝标签）' });
      continue;
    }
    const q: DatasetQuestion = { kind: 'noul', id: 'q-pr', question: '该 PR 应被合入吗？' };
    const a: DatasetAnswer = {
      kind: 'noul',
      questionId: 'q-pr',
      probability: r.outcome === 'merged' ? 0.9 : 0.1,
    };
    accepted.push({
      state: r.state,
      questions: [q],
      answers: [a],
      label: { source: 'human-only' }, // PR 审阅=人工裁决（与 HITL 同档）
      provenance: { prNumber: r.prNumber },
      enterpriseId: r.enterpriseId,
      lang: r.lang,
    });
  }
  return { accepted, rejected };
}
