// ============================================================
// cost-baseline.test.ts · 成本基线单元测试
// v1.0.2 新增
// ============================================================

import { describe, it, expect } from 'vitest';
import { calculateBaseline, isAnomaly, isColdStart, type Baseline } from '@sofagent/core';

describe('isAnomaly', () => {
  const baseline: Baseline = { mean: 1000, stddev: 200, sampleCount: 20 };

  it('正常值不触发异常检测', () => {
    expect(isAnomaly(1200, baseline)).toBe(false);
    expect(isAnomaly(1000, baseline)).toBe(false);
    expect(isAnomaly(800, baseline)).toBe(false);
  });

  it('超过 mean+2σ 时触发异常', () => {
    // mean=1000, stddev=200, threshold=1400
    expect(isAnomaly(1500, baseline)).toBe(true);
  });

  it('正好等于阈值不算异常', () => {
    // mean=1000, 2*stddev=400, threshold=1400
    expect(isAnomaly(1400, baseline)).toBe(false);
  });

  it('边界值精确判断', () => {
    expect(isAnomaly(1401, baseline)).toBe(true);
  });
});

describe('isColdStart', () => {
  it('样本数少于默认阈值（10）时返回 true', () => {
    expect(isColdStart(5)).toBe(true);
    expect(isColdStart(0)).toBe(true);
    expect(isColdStart(9)).toBe(true);
  });

  it('样本数达到阈值时返回 false', () => {
    expect(isColdStart(10)).toBe(false);
    expect(isColdStart(100)).toBe(false);
  });

  it('支持自定义最小样本数', () => {
    expect(isColdStart(5, 10)).toBe(true);
    expect(isColdStart(15, 20)).toBe(true);
    expect(isColdStart(20, 20)).toBe(false);
  });
});

describe('calculateBaseline', () => {
  it('空数据目录返回 null', () => {
    const result = calculateBaseline('test', '/tmp/nonexistent-sofagent-data');
    expect(result).toBeNull();
  });

  it('无该类型日志时返回 null', () => {
    // 使用实际数据目录，但 search 一个不存在的类型
    const result = calculateBaseline('__nonexistent_task_type__', process.cwd());
    expect(result).toBeNull();
  });
});
