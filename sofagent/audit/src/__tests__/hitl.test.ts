// ============================================================
// hitl.test.ts · HITL 渐进自主度测试
// v1.0.4 新增
// ============================================================

import { describe, it, expect } from 'vitest';
import { assessRisk } from '../hitl/risk-assessor';
import { tagAction, calculateHitlStats } from '../hitl/confidence-tagger';
import type { ConfidenceTag, HitlStats } from '../hitl/types';

describe('risk-assessor', () => {
  it('删除操作 → 🔒 critical', () => {
    const result = assessRisk({ action: 'rm -rf /var/data' });
    expect(result.tag).toBe('🔒');
    expect(result.level).toBe('critical');
    expect(result.forcedTriggers).toContain('删除操作');
  });

  it('外部 API 调用 → 🔒 critical', () => {
    const result = assessRisk({ action: 'fetch("https://api.example.com/data")' });
    expect(result.tag).toBe('🔒');
    expect(result.level).toBe('critical');
    expect(result.forcedTriggers).toContain('外部 API 调用');
  });

  it('权限变更 → 🔒 critical', () => {
    const result = assessRisk({ action: 'chmod 777 /etc/config' });
    expect(result.tag).toBe('🔒');
    expect(result.level).toBe('critical');
    expect(result.forcedTriggers).toContain('权限变更');
  });

  it('数据迁移 → 🔒 critical', () => {
    const result = assessRisk({ action: 'ALTER TABLE users ADD COLUMN temp' });
    expect(result.tag).toBe('🔒');
    expect(result.level).toBe('critical');
    expect(result.forcedTriggers).toContain('数据迁移');
  });

  it('只读操作 → 🟢 low risk', () => {
    const result = assessRisk({ action: 'read report.md' });
    expect(result.tag).toBe('🟢');
    expect(result.level).toBe('low');
    expect(result.forcedTriggers).toHaveLength(0);
  });
});

describe('confidence-tagger', () => {
  it('🟢 标注 ≥99 分', () => {
    const result = tagAction('read document', undefined, {});
    expect(result.tag).toBe('🟢');
  });

  it('高风险操作 → 🔒', () => {
    const result = tagAction('rm -rf logs/', undefined, {});
    expect(result.tag).toBe('🔒');
  });

  it('复杂操作 → 🟡 或 🔒', () => {
    const result = tagAction('write config', '/etc/config', { key: 'value', another: 'param' });
    // 取决于参数复杂度，至少不是 🟢
    expect(['🟡', '🔒']).toContain(result.tag);
  });
});

describe('hitl-stats', () => {
  it('计算 HITL 统计信息正确', () => {
    const history = [
      { tag: '🟢' as ConfidenceTag, score: 100, level: 'low' },
      { tag: '🟢' as ConfidenceTag, score: 100, level: 'low' },
      { tag: '🟡' as ConfidenceTag, score: 85, level: 'medium' },
      { tag: '🔒' as ConfidenceTag, score: 60, level: 'high' },
      { tag: '🔒' as ConfidenceTag, score: 0, level: 'critical' },
    ];

    const stats = calculateHitlStats(history);
    expect(stats.totalActions).toBe(5);
    expect(stats.byTag['🟢']).toBe(2);
    expect(stats.byTag['🟡']).toBe(1);
    expect(stats.byTag['🔒']).toBe(2);
    expect(stats.forcedReviews).toBe(2);
  });
});
