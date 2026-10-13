// collectors/index.ts · 三源统一入口 + 去重 + 切分
// ============================================================
// 三源（history/HITL/PR）统一收集；近重复检测（去重或标记不静默混入）；
// 同一轨迹不跨训练/验证集（轨迹粒度切分——泄漏防护）；
// 冷启动三类通道（门一唯一例外，逐类定边界）；
// 采集量/档位占比/拒收原因可观测；中英文占比分列落数。
// ============================================================
import type { DecisionSample } from '../decision-dataset-schema';
import { collectFromHistory, type TraceRecord } from './history-collector';
import { collectFromHitl, type HitlRecord } from './hitl-collector';
import { collectFromPr, type PrRecord } from './pr-collector';

/** 统一采集输入 */
export interface CollectInput {
  history?: TraceRecord[];
  hitl?: HitlRecord[];
  pr?: PrRecord[];
}

/** 冷启动通道标记（门一唯一例外——逐类定边界） */
export type ColdStartChannel = 'audit-chain-history' | 'real-state-model-judge' | 'synthetic-state';

export interface UnifiedCollectReport {
  samples: DecisionSample[];
  /** 轨迹粒度切分（train/eval——同一轨迹不跨侧） */
  split: { train: DecisionSample[]; eval: DecisionSample[] };
  /** 近重复（被去除或标记） */
  nearDuplicates: Array<{ kept: string; dropped: string }>;
  /** 拒收原因分布（可观测） */
  rejectionReasons: Record<string, number>;
  /** 档位占比 */
  labelSourceCounts: Record<string, number>;
  /** 中英文占比分列（不合并） */
  langCounts: { zh: number; en: number };
  /** 冷启动通道声明（有则各样本带前缀标签） */
  coldStartChannels?: ColdStartChannel[];
}

/** 样本私有哈希（近重复检测——state+问题指纹） */
function sampleHash(s: DecisionSample): string {
  const crypto = require('node:crypto') as typeof import('node:crypto');
  const key = JSON.stringify([s.state, s.questions.map((q) => [q.id, q.kind])]);
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/** 轨迹键（同一轨迹不跨训练/验证——按轨迹粒度切分） */
function traceKey(s: DecisionSample): string {
  return s.provenance.traceId ?? s.provenance.hitlSessionId ?? `pr-${s.provenance.prNumber ?? 'x'}`;
}

export function collectAll(input: CollectInput, opts?: { coldStartChannels?: ColdStartChannel[] }): UnifiedCollectReport {
  const rejectionReasons: Record<string, number> = {};
  const bump = (r: string) => { rejectionReasons[r] = (rejectionReasons[r] ?? 0) + 1; };

  const all: DecisionSample[] = [];
  const h = collectFromHistory(input.history ?? []);
  for (const r of h.rejected) bump(r.reason);
  all.push(...h.accepted);
  const hitl = collectFromHitl(input.hitl ?? []);
  for (const r of hitl.rejected) bump(r.reason);
  all.push(...hitl.accepted);
  const pr = collectFromPr(input.pr ?? []);
  for (const r of pr.rejected) bump(r.reason);
  all.push(...pr.accepted);

  // 冷启动通道标记：合成 state 标 synthetic（只用于扩面不定标）
  const channels = opts?.coldStartChannels ?? [];
  if (channels.includes('synthetic-state')) {
    for (const s of all) {
      if ((s as { origin?: string }).origin === 'synthetic') {
        (s as { synthetic?: boolean }).synthetic = true;
      }
    }
  }

  // 近重复检测（同 state+问题指纹——去除并留痕，不静默混入）
  const seen = new Map<string, number>(); // hash → 首见索引
  const nearDuplicates: UnifiedCollectReport['nearDuplicates'] = [];
  const deduped: DecisionSample[] = [];
  all.forEach((s, i) => {
    const hsh = sampleHash(s);
    if (seen.has(hsh)) {
      nearDuplicates.push({ kept: String(seen.get(hsh)), dropped: String(i) });
    } else {
      seen.set(hsh, i);
      deduped.push(s);
    }
  });

  // 轨迹粒度切分（防泄漏）：同轨迹键全部同侧——首见定侧（这里 hash 轮转做近似均衡）
  const side = new Map<string, 'train' | 'eval'>();
  const train: DecisionSample[] = [];
  const evalSet: DecisionSample[] = [];
  let toggle = 0;
  for (const s of deduped) {
    const tk = traceKey(s);
    if (!side.has(tk)) {
      side.set(tk, toggle % 4 === 3 ? 'eval' : 'train'); // ~25% eval
      toggle += 1;
    }
    (side.get(tk) === 'train' ? train : evalSet).push(s);
  }

  // 可观测：档位占比 + 中英分列
  const labelSourceCounts: Record<string, number> = {};
  const langCounts = { zh: 0, en: 0 };
  for (const s of deduped) {
    labelSourceCounts[s.label.source] = (labelSourceCounts[s.label.source] ?? 0) + 1;
    langCounts[s.lang] += 1;
  }

  return {
    samples: deduped,
    split: { train, eval: evalSet },
    nearDuplicates,
    rejectionReasons,
    labelSourceCounts,
    langCounts,
    ...(channels.length > 0 ? { coldStartChannels: channels } : {}),
  };
}
