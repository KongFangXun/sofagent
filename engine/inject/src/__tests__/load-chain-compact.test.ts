// ============================================================
// load-chain-compact.test.ts · 超预算触发 + 标记可识别（v1.4.8 第四章）
// ============================================================
import { describe, expect, it } from 'vitest';
import { checkBudget, estimateTokens } from '../load-chain/budget';
import { compactIfNeeded, COMPACT_START_MARKER, COMPACT_END_MARKER } from '../load-chain/compactor';

describe('第四章 · 预算检测（budget）', () => {
  it('estimateTokens：中英混合启发式', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1); // 4 英文字符 ≈ 1 token
    expect(estimateTokens('中文字')).toBeGreaterThan(0);
  });

  it('未配置预算 → 永不超（零开销路径）', () => {
    const v = checkBudget('x'.repeat(100000));
    expect(v.over).toBe(false);
    expect(v.budgetTokens).toBe(Number.POSITIVE_INFINITY);
  });

  it('超 3% 预算 → over=true', () => {
    // 窗口 1000 token，预算 30；内容 200 token → 超
    const v = checkBudget('a'.repeat(800), { contextWindowTokens: 1000 });
    expect(v.over).toBe(true);
    expect(v.budgetTokens).toBe(30);
  });

  it('预算内 → over=false', () => {
    const v = checkBudget('ab', { contextWindowTokens: 1000 });
    expect(v.over).toBe(false);
  });
});

describe('第四章 · 自动压缩（compactor）', () => {
  const BIG = ['背景说明……\n'.repeat(5), ...Array.from({ length: 80 }, (_, i) => `历史细节行 ${i}：长篇背景叙述，用于撑大体积触发压缩。`)].join('\n');
  const RULES = '🚫 底线一：不碰敏感文件\n🔴 铁律：提交前必过审计\n';
  const content = `${RULES}\n${BIG}`;

  it('未超预算 → 原样返回不压缩（零开销）', () => {
    const r = compactIfNeeded(content); // 无预算配置
    expect(r.compacted).toBe(false);
    expect(r.content).toBe(content);
    expect(r.content).not.toContain(COMPACT_START_MARKER);
  });

  it('超预算 → 压缩 + start/end 标记可识别', () => {
    const r = compactIfNeeded(content, { contextWindowTokens: 600 });
    expect(r.compacted).toBe(true);
    expect(r.content.startsWith(COMPACT_START_MARKER)).toBe(true);
    expect(r.content.endsWith(COMPACT_END_MARKER)).toBe(true);
    expect(r.event.compactedLines).toBeGreaterThan(0);
  });

  it('红线/铁律内容不丢（保留段原样）', () => {
    const r = compactIfNeeded(content, { contextWindowTokens: 600 });
    expect(r.content).toContain('🚫 底线一：不碰敏感文件');
    expect(r.content).toContain('🔴 铁律：提交前必过审计');
    expect(r.event.preservedSections.length).toBeGreaterThan(0);
  });

  it('压缩事件走回调出口（调用方落审计——harness 零依赖纪律）', () => {
    let callbackFired = false;
    let eventTokens = 0;
    compactIfNeeded(content, { contextWindowTokens: 600 }, {
      onCompact: (r) => { callbackFired = true; eventTokens = r.event.beforeTokens; },
    });
    expect(callbackFired).toBe(true);
    expect(eventTokens).toBeGreaterThan(0);
  });

  it('压缩后体积下降', () => {
    const r = compactIfNeeded(content, { contextWindowTokens: 600 });
    expect(r.event.afterTokens).toBeLessThan(r.event.beforeTokens);
  });
});
