// divergence-extractor.test.ts · v1.7.0 §七 · 偏离提取器确定性测试
// ============================================================
// 确定性断言：同 refs 集合 → 同偏离模式（可复现）；顺序无关（refs 顺序
// 不改变聚类输出）；空输入 fail-loud（不造假模式）。
// ============================================================
import { describe, it, expect } from 'vitest';
import { extractDivergencePattern, type DivergenceSourceEntry } from '../router/divergence-extractor';

const entries: DivergenceSourceEntry[] = [
  { ts: '2026-10-18T10:00:00.000Z', kind: 'TOOL_GATE', triggeredRule: 'A1' },
  { ts: '2026-10-19T11:00:00.000Z', kind: 'ESCALATE_REPORT' },
  { ts: '2026-10-19T12:30:00.000Z', kind: 'TOOL_GATE', triggeredRule: 'A1' },
  { ts: '2026-10-20T09:00:00.000Z', kind: 'TOOL_GATE', triggeredRule: 'A3' },
];

describe('偏离提取器（确定性）', () => {
  it('test_divergence_同refs集合同偏离模式_可复现', () => {
    const a = extractDivergencePattern(entries);
    const b = extractDivergencePattern([...entries]); // 同集复制
    expect(a.patternId).toBe(b.patternId);
    expect(a).toEqual(b); // 全字段一致（可复现）
  });

  it('test_divergence_顺序无关_打乱后同输出', () => {
    const base = extractDivergencePattern(entries);
    // 三种打乱形态（逆序 / 旋转 / 随机置换）——patternId 与全部字段不变
    const reversed = extractDivergencePattern([...entries].reverse());
    expect(reversed.patternId).toBe(base.patternId);
    expect(reversed.memberTs).toEqual(base.memberTs); // memberTs 恒为 ts 升序
    const rotated = extractDivergencePattern([entries[2]!, entries[0]!, entries[3]!, entries[1]!]);
    expect(rotated).toEqual(base);
  });

  it('test_divergence_时间窗与涉及面聚合', () => {
    const p = extractDivergencePattern(entries);
    expect(p.windowStart).toBe('2026-10-18T10:00:00.000Z');
    expect(p.windowEnd).toBe('2026-10-20T09:00:00.000Z');
    expect(p.count).toBe(4);
    expect(p.memberTs).toEqual([...p.memberTs].sort()); // 升序
    // involvedSurfaces：kind 或 kind:rule 形态、升序去重
    expect(p.involvedSurfaces).toEqual(['ESCALATE_REPORT', 'TOOL_GATE:A1', 'TOOL_GATE:A3']);
  });

  it('test_divergence_空输入fail_loud_不造假模式', () => {
    expect(() => extractDivergencePattern([])).toThrow(/零偏离/);
  });

  it('test_divergence_不同集合不同指纹', () => {
    const a = extractDivergencePattern(entries);
    const b = extractDivergencePattern(entries.slice(0, 3));
    expect(a.patternId).not.toBe(b.patternId);
    // 集合差异体现于 memberTs 与 count
    expect(b.count).toBe(3);
  });
});
