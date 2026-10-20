// divergence-extractor.ts · v1.7.0 §七 · 偏离提取器（refs 命中 → 偏离模式 · 确定性）
// ============================================================
// 从 ruler-change 事件 rationale.refs 命中的 decision-log 条目集合，
// 聚成结构化偏离模式（时间窗内 · 按 aspect 归类 · 确定性输出——同输入
// 同结果，顺序无关：refs 顺序不改变聚类输出，可复现）。
//
// 品味样本链路的第一环：偏离模式 × 尺子变更 = 「在什么偏离模式出现时，
// 人会换成什么尺子」的监督信号（元判断）。确定性是硬约束——训练样本
// 构造不可依赖遍历顺序或时间戳噪音（同 refs 集合必须产出同一偏离模式，
// 否则样本不可复现、训练不可对账）。
// ============================================================

/** 偏离模式（结构化聚类输出——品味样本的「事发情境」侧） */
export interface DivergencePattern {
  /** 聚类指纹（确定性：同 refs 集合同指纹——顺序无关） */
  patternId: string;
  /** 聚入本模式的 decision-log 条目 ts（升序去重） */
  memberTs: string[];
  /** 时间窗（首末条目 ts——ISO 8601；单条目时窗宽 0） */
  windowStart: string;
  windowEnd: string;
  /** 条目涉及判据/规则面（kind × 触发规则名聚合——升序去重） */
  involvedSurfaces: string[];
  /** 条目数（= memberTs.length 的显式读数） */
  count: number;
}

/** decision-log 条目的最小消费投影（读侧已有完整条目——此处只取聚类所需字段） */
export interface DivergenceSourceEntry {
  /** 条目 ts（decision-log 以 ts 为条目标识） */
  ts: string;
  kind: string;
  /** 触发规则名（why.triggeredRule——可缺） */
  triggeredRule?: string;
}

/** 确定性排序键（ts 升序——同集合同序，与输入顺序无关） */
function canonicalOrder(entries: readonly DivergenceSourceEntry[]): DivergenceSourceEntry[] {
  const copy: DivergenceSourceEntry[] = [...entries];
  return copy.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
}

/**
 * 偏离提取（确定性——同 refs 命中的条目集合产出同一 DivergencePattern）。
 *
 * 聚类口径：**refs 命中的全部条目聚为单一模式**（一次尺子变更的完整事发
 * 情境——不做阈值切分；时间窗为命中条目的首末 ts 间距）。确定性保证：
 *   ① 条目先按 ts 规范排序（输入顺序无关）；
 *   ② patternId 由排序后条目的 (ts, kind, triggeredRule) 三元组哈希派生
 *      ——同集合同指纹；③ 全部聚合字段经排序去重（升序）。
 *
 * @param entries refs 命中的 decision-log 条目（可为空——空集由调用方
 *   按 insufficient-samples 口径处理，本函数不造假模式）
 */
export function extractDivergencePattern(entries: readonly DivergenceSourceEntry[]): DivergencePattern {
  const ordered = canonicalOrder(entries);
  if (ordered.length === 0) {
    throw new Error('[divergence-extractor] 输入为空（零偏离——调用方按 insufficient-samples 处理，不构造模式）');
  }
  const memberTs = ordered.map((e) => e.ts);
  // 涉及面聚合：kind + 触发规则名（缺 triggeredRule 时只记 kind）——升序去重
  const surfaces = new Set<string>();
  for (const e of ordered) {
    surfaces.add(e.triggeredRule ? `${e.kind}:${e.triggeredRule}` : e.kind);
  }
  // 确定性指纹：排序后条目三元组的稳定串接 → FNV-1a（同集合同指纹，顺序无关）
  const canonical = ordered.map((e) => `${e.ts}|${e.kind}|${e.triggeredRule ?? ''}`).join('\n');
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return {
    patternId: `div-${hash.toString(16).padStart(8, '0')}`,
    memberTs,
    windowStart: memberTs[0]!,
    windowEnd: memberTs[memberTs.length - 1]!,
    involvedSurfaces: [...surfaces].sort(),
    count: ordered.length,
  };
}
