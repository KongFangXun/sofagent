// ============================================================
// quota-gate.test.ts · WARN/HARD 两模式 + 回写测试（v1.4.8 第六章）
// ============================================================
import { describe, expect, it } from 'vitest';
import { checkQuota, shouldRecordSpend, type QuotaConfig, type QuotaUsage } from '../cost/quota-gate';

const USAGE = (used: number): QuotaUsage => ({ usedTokens: used, periodStart: '2026-09-12T00:00:00Z' });

describe('第六章 · 事前配额检查（checkQuota）', () => {
  it('未配置 quota → allow 零开销直通（单机不破坏）', () => {
    const v = checkQuota(null, USAGE(999_999));
    expect(v.action).toBe('allow');
    const v2 = checkQuota(undefined, USAGE(100));
    expect(v2.action).toBe('allow');
  });

  it('额度内 → allow 且带余量', () => {
    const cfg: QuotaConfig = { maxTokens: 1000, period: 'daily' };
    const v = checkQuota(cfg, USAGE(400));
    expect(v.action).toBe('allow');
    expect(v.remaining).toBe(600);
  });

  it('超额 WARN 模式（缺省）→ 放行 + 警告', () => {
    const cfg: QuotaConfig = { maxTokens: 1000 }; // 缺省 WARN
    const v = checkQuota(cfg, USAGE(1200));
    expect(v.action).toBe('allow-with-warning');
    if (v.action === 'allow-with-warning') expect(v.warning).toContain('HARD'.length > 0 ? 'WARN 模式放行' : '');
  });

  it('超额 HARD 模式 → 拦截（fail-closed）', () => {
    const cfg: QuotaConfig = { maxTokens: 1000, mode: 'HARD', period: 'weekly' };
    const v = checkQuota(cfg, USAGE(1200));
    expect(v.action).toBe('block');
    if (v.action === 'block') {
      expect(v.reason).toContain('HARD 模式拦截');
      expect(v.period).toBe('weekly');
    }
  });

  it('恰好到上限 → 按超额处理（≥判定）', () => {
    const cfg: QuotaConfig = { maxTokens: 1000, mode: 'HARD' };
    const v = checkQuota(cfg, USAGE(1000));
    expect(v.action).toBe('block');
  });
});

describe('第六章 · 验证回写语义（shouldRecordSpend）', () => {
  it('验证通过 + 未记账 → 记', () => {
    expect(shouldRecordSpend(true, false).record).toBe(true);
  });

  it('未验证（失败/重试）→ 不记', () => {
    const r = shouldRecordSpend(false, false);
    expect(r.record).toBe(false);
    expect(r.reason).toContain('未验证');
  });

  it('已记过账 → 不重复记', () => {
    const r = shouldRecordSpend(true, true);
    expect(r.record).toBe(false);
    expect(r.reason).toContain('防重复');
  });
});
