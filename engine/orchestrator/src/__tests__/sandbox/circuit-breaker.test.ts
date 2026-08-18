// ============================================================
// circuit-breaker.test.ts · 断路器 + 行为监控测试
// v1.3.7 交付⑤ 新增
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import { createCircuitBreaker, DEFAULT_BEHAVIOR_THRESHOLDS } from '../../sandbox/circuit-breaker';

describe('断路器（ASI08 级联故障防御）', () => {
  it('连续 N 次失败自动熔断（N 可配置，默认 3）+ 事件通知人工', () => {
    const notify = vi.fn();
    const cb = createCircuitBreaker({ notify });
    cb.recordCall('a1', false);
    cb.recordCall('a1', false);
    expect(cb.state('a1')).toBe('closed'); // 未到阈值
    cb.recordCall('a1', false);
    expect(cb.state('a1')).toBe('open'); // 第 3 次熔断
    expect(cb.canAcceptTask('a1')).toBe(false);
    const events = cb.exportEvents();
    expect(events.some(e => e.type === 'breaker-open' && e.agentId === 'a1')).toBe(true);
    expect(notify).toHaveBeenCalled(); // 通知人工
  });

  it('N 可配置：阈值 5 时第 5 次才熔断', () => {
    const cb = createCircuitBreaker({ failureThreshold: 5 });
    for (let i = 0; i < 4; i++) cb.recordCall('a2', false);
    expect(cb.state('a2')).toBe('closed');
    cb.recordCall('a2', false);
    expect(cb.state('a2')).toBe('open');
  });

  it('成功调用重置连续失败计数（间歇失败不误熔断）', () => {
    const cb = createCircuitBreaker();
    cb.recordCall('a3', false);
    cb.recordCall('a3', false);
    cb.recordCall('a3', true); // 重置
    cb.recordCall('a3', false);
    expect(cb.state('a3')).toBe('closed');
  });

  it('冷却期满 → half-open 探测：成功自动恢复 closed', () => {
    const cb = createCircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 30 });
    cb.recordCall('a4', false);
    cb.recordCall('a4', false);
    expect(cb.state('a4')).toBe('open');
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(cb.canAcceptTask('a4')).toBe(true); // half-open 放行探测
        expect(cb.state('a4')).toBe('half-open');
        cb.recordCall('a4', true); // 探测成功
        expect(cb.state('a4')).toBe('closed');
        expect(cb.exportEvents().some(e => e.type === 'breaker-closed')).toBe(true);
        resolve();
      }, 50);
    });
  });

  it('冷却期内 canAcceptTask=false（暂停后续调用）', () => {
    const cb = createCircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 10_000 });
    cb.recordCall('a5', false);
    expect(cb.canAcceptTask('a5')).toBe(false);
  });
});

describe('行为监控（ASI10 失控 agent）', () => {
  it('三指标可采集：调用率/失败率/提权尝试', () => {
    const cb = createCircuitBreaker({ failureThreshold: 99 }); // 阈值抬高防熔断干扰指标断言
    for (let i = 0; i < 10; i++) cb.recordCall('b1', i >= 3); // 前 3 失败后 7 成功 → 失败率 0.3
    cb.recordElevationAttempt('b1');
    const m = cb.metrics('b1');
    expect(m.callRatePerMin).toBeGreaterThan(0);
    expect(m.failureRate).toBeCloseTo(0.3, 1);
    expect(m.elevationAttempts).toBe(1);
  });

  it('提权尝试超阈值 → 自动隔离（切回人工模式）', () => {
    const cb = createCircuitBreaker({ thresholds: { maxElevationAttempts: 2 } });
    cb.recordElevationAttempt('b2');
    cb.recordElevationAttempt('b2');
    expect(cb.isolatedAgents()).toEqual([]);
    cb.recordElevationAttempt('b2'); // 第 3 次超阈值（> 2）
    expect(cb.isolatedAgents()).toContain('b2');
    expect(cb.canAcceptTask('b2')).toBe(false); // 隔离态不接新任务（沙箱联动）
    expect(cb.exportEvents().some(e => e.type === 'isolation')).toBe(true);
  });

  it('失败率超阈值（≥5 样本）→ 隔离', () => {
    const cb = createCircuitBreaker({ failureThreshold: 99, thresholds: { maxFailureRate: 0.5 } });
    for (let i = 0; i < 6; i++) cb.recordCall('b3', i >= 4); // 前 4 失败后 2 成功 → 失败率 4/6≈67%
    expect(cb.isolatedAgents()).toContain('b3');
  });

  it('调用率超阈值 → 隔离（失控循环防御）', () => {
    const cb = createCircuitBreaker({ thresholds: { maxCallRatePerMin: 5 }, metricsWindowMs: 60_000 });
    for (let i = 0; i < 10; i++) cb.recordCall('b4', true); // 1 秒内 10 次 → 远超 5/min
    expect(cb.isolatedAgents()).toContain('b4');
    const evt = cb.exportEvents().find(e => e.type === 'isolation');
    expect(evt?.detail).toContain('调用率');
  });

  it('恢复路径：人工 recover() 复位（不永久卡死）', () => {
    const cb = createCircuitBreaker({ thresholds: { maxElevationAttempts: 0 } });
    cb.recordElevationAttempt('b5');
    expect(cb.isolatedAgents()).toContain('b5');
    cb.recover('b5', 'admin-kong');
    expect(cb.isolatedAgents()).toEqual([]);
    expect(cb.canAcceptTask('b5')).toBe(true);
    expect(cb.exportEvents().some(e => e.type === 'recovery' && e.detail.includes('admin-kong'))).toBe(true);
  });
});

describe('默认值文档化（验收 1）', () => {
  it('默认阈值导出可查（N=3 / 120/min / 0.5 / 3 次）', () => {
    expect(DEFAULT_BEHAVIOR_THRESHOLDS.maxCallRatePerMin).toBe(120);
    expect(DEFAULT_BEHAVIOR_THRESHOLDS.maxFailureRate).toBe(0.5);
    expect(DEFAULT_BEHAVIOR_THRESHOLDS.maxElevationAttempts).toBe(3);
  });
});
