// collectors/history-collector.ts · 轨迹源采集（history → 三元组）
// ============================================================
// 从历史执行轨迹抽取 (state, questions, answers)——状态从轨迹最小可判定
// 前缀取，答案是当时实际发生的处置（非「应该怎样」）。
// 来源真实性门：只收经审计链锚定的真实运行痕迹；合成/Agent 自述/未建链
// 来源默认拒收（fail-closed，拒收原因可查）。
// ============================================================
import type { DecisionSample, DatasetQuestion, DatasetAnswer, ProvenanceAnchor } from '../decision-dataset-schema';

/** 轨迹源输入（调用方从 audit-history / trace 读出的最小结构） */
export interface TraceRecord {
  /** 轨迹 id（血缘锚点） */
  traceId: string;
  /** 轨迹最小可判定前缀（状态快照——截取至最后一个可判定事件） */
  statePrefix: string;
  /** 当时实际发生的处置（allow / block / warn / skip） */
  actualDisposition: 'allow' | 'block' | 'warn' | 'skip';
  /** 是否经审计链锚定（HMAC 链上可验） */
  chainAnchored: boolean;
  /** 来源标记（合成来源拒收） */
  origin?: 'runtime' | 'synthetic' | 'agent-self-report';
  enterpriseId: string;
  lang: 'zh' | 'en';
}

/** 采集结果（含拒收原因——可观测） */
export interface CollectResult {
  accepted: DecisionSample[];
  rejected: Array<{ record: TraceRecord; reason: string }>;
}

const DISPOSITION_TO_PROB: Record<TraceRecord['actualDisposition'], number> = {
  allow: 0.9,
  block: 0.95,
  warn: 0.6,
  skip: 0.5,
};

export function collectFromHistory(records: TraceRecord[]): CollectResult {
  const accepted: DecisionSample[] = [];
  const rejected: CollectResult['rejected'] = [];
  for (const r of records) {
    // 来源真实性门：未建链 / 合成 / Agent 自述 → 拒收（fail-closed）
    if (!r.chainAnchored) {
      rejected.push({ record: r, reason: '未建链（chainAnchored=false）——只收经审计链锚定的真实运行痕迹' });
      continue;
    }
    if (r.origin === 'synthetic') {
      rejected.push({ record: r, reason: '合成来源——门一默认拒收' });
      continue;
    }
    if (r.origin === 'agent-self-report') {
      rejected.push({ record: r, reason: 'Agent 自述来源——不可作证据（防自证污染）' });
      continue;
    }
    const q: DatasetQuestion = { kind: 'noul', id: 'q-disposition', question: '该状态当时的处置应是什么？' };
    const a: DatasetAnswer = {
      kind: 'noul',
      questionId: 'q-disposition',
      probability: DISPOSITION_TO_PROB[r.actualDisposition] ?? 0.5,
    };
    accepted.push({
      state: r.statePrefix,
      questions: [q],
      answers: [a],
      label: { source: 'deterministic' }, // 答案=当时实际处置（可复算——读轨迹）
      provenance: { traceId: r.traceId } satisfies ProvenanceAnchor,
      enterpriseId: r.enterpriseId,
      lang: r.lang,
      // 不进校准集（fresh-eyes run-01 项 9）：上面的 probability 是 disposition
      // → 概率的**硬编码档位映射**（allow→0.9 / block→0.95），不是模型/人给出的
      // 概率判断——门四「只有能表达概率目标的样本进校准集」要求概率语义真实
      // （choice 分布 / score 区间 / noul 真值概率），映射常数进校准集会把常数
      // 当读数污染 ECE。标 false 显式豁免（字段缺省 true，不影响其他采集源）；
      // 样本照常进训练/评测面（答案本身是可复算的事实记录）。
      calibrationEligible: false,
    });
  }
  return { accepted, rejected };
}
