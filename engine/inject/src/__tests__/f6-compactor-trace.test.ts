// ============================================================
// f6-compactor-trace.test.ts · 压缩留痕完整性（F6.4 · v1.9 §六）
// ============================================================
// 要证的一件事：压缩**有损**，但判定依据的**引用**不能丢——
// 压缩后的文本自身要能还原「当时依据了哪些段」，而不是只剩一句摘要。
// ============================================================

import { describe, it, expect } from 'vitest';
import { compactIfNeeded, COMPACT_START_MARKER } from '../load-chain/compactor';

/** 造一段「超预算」的长文档：多个段标题 + 大段正文 */
function longDoc(): string {
  const filler = Array.from({ length: 40 }, (_, i) => `明细行 ${i}：` + 'x'.repeat(120));
  return [
    '## 判据A · 动作红线',
    '🚫 不得外发客户数据',
    '## 判据B · 证据充分性',
    ...filler,
    '## 判据C · 弃权条件',
    ...filler,
  ].join('\n');
}

describe('F6.4 · 压缩留痕（生产端索引）', () => {
  it('O20 压缩后每个段标题仍可在交付文本中还原（引用不丢）', () => {
    const before = longDoc();
    const r = compactIfNeeded(before, { contextWindowTokens: 1000, maxRatio: 0.03 }, { maxSectionLines: 5 });
    expect(r.compacted).toBe(true);
    expect(r.content.startsWith(COMPACT_START_MARKER)).toBe(true);
    for (const ref of ['判据A · 动作红线', '判据B · 证据充分性', '判据C · 弃权条件']) {
      expect(r.content).toContain(`[ref:${ref}]`);
    }
    expect(r.event.evidenceRefs).toEqual(
      expect.arrayContaining(['判据A · 动作红线', '判据B · 证据充分性', '判据C · 弃权条件']),
    );
  });

  it('O21 未超预算时不动内容，但 evidenceRefs 仍如实登记（契约一致）', () => {
    const before = '## 判据A\n短内容';
    const r = compactIfNeeded(before, { contextWindowTokens: 10_000_000 });
    expect(r.compacted).toBe(false);
    expect(r.content).toBe(before);
    expect(r.event.evidenceRefs).toEqual(['判据A']);
  });

  it('O22 保留行（红线/铁律）在压缩后逐字仍在', () => {
    const r = compactIfNeeded(longDoc(), { contextWindowTokens: 1000, maxRatio: 0.03 }, { maxSectionLines: 3 });
    expect(r.content).toContain('🚫 不得外发客户数据');
  });
});
