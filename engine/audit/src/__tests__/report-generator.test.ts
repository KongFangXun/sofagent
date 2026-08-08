// ============================================================
// report-generator.test.ts · 数据主权审计报告生成器单测
// v1.2.9 P0 — 覆盖 aggregateStats / generateReport / 三档报告
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import {
  aggregateStats,
  generateReport,
  generateDailyReport,
  generateWeeklyReport,
  generateMonthlyReport,
  type GeneratedReport,
} from '../report-generator';
import { DataSovereigntyLogger } from '../data-sovereignty';
import type { DataSovereigntyRecord } from '../data-sovereignty';

// ── 测试工具 ──

function makeTmpDir(): string {
  const dir = join(tmpdir(), `sofagent-rg-test-${Date.now()}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 构造一条合法记录 */
function makeRecord(
  overrides: Partial<DataSovereigntyRecord> = {},
): DataSovereigntyRecord {
  return {
    cloudCall: {
      timestamp: '2026-07-28T10:00:00.000Z',
      provider: 'openai',
      model: 'gpt-4o',
      endpoint: 'https://api.openai.com',
      tokenCount: { input: 100, output: 50 },
      purpose: 'code-gen',
    },
    localAction: {
      type: 'model-inference',
      target: 'gpt-4o',
      description: '生成代码',
      auditResult: 'PASS',
    },
    dataFlow: {
      direction: 'outbound',
      sensitivity: 'internal',
      fields: ['code'],
      destination: 'cloud-api',
      redacted: false,
    },
    taskContext: {
      taskId: 't1',
      userIntent: '写函数',
      agentRole: 'engineer',
    },
    ...overrides,
  } as DataSovereigntyRecord;
}

/** 往临时 home 写入若干条记录（用真实 DataSovereigntyLogger） */
function seedRecords(tmpHome: string, records: DataSovereigntyRecord[]): void {
  const logger = new DataSovereigntyLogger(tmpHome);
  for (const r of records) {
    logger.append(r);
  }
}

// ============================================================
// aggregateStats · 统计聚合
// ============================================================

describe('aggregateStats', () => {
  it('空数组返回全零统计', () => {
    // 测试：无记录时所有计数为 0，sensitiveLocalRate 默认为 1
    const stats = aggregateStats([]);
    expect(stats.total).toBe(0);
    expect(stats.cloudCallCount).toBe(0);
    expect(stats.localActionCount).toBe(0);
    expect(stats.outboundCount).toBe(0);
    expect(stats.anomalyCount).toBe(0);
    expect(stats.sensitiveLocalRate).toBe(1);
  });

  it('cloudCallCount 正确统计 destination=cloud-api 的记录', () => {
    // 测试：2 条 cloud-api + 1 条 local-file → cloudCallCount=2
    const records: DataSovereigntyRecord[] = [
      makeRecord({ dataFlow: { direction: 'outbound', sensitivity: 'internal', fields: ['x'], destination: 'cloud-api', redacted: false } }),
      makeRecord({ dataFlow: { direction: 'outbound', sensitivity: 'internal', fields: ['x'], destination: 'cloud-api', redacted: false } }),
      makeRecord({ dataFlow: { direction: 'local-only', sensitivity: 'public', fields: ['x'], destination: 'local-file', redacted: false } }),
    ];
    const stats = aggregateStats(records);
    expect(stats.cloudCallCount).toBe(2);
  });

  it('outboundCount / inboundCount / localOnlyCount 按 direction 正确分桶', () => {
    // 测试：3 outbound + 1 inbound + 2 local-only
    const records: DataSovereigntyRecord[] = [
      makeRecord({ dataFlow: { direction: 'outbound', sensitivity: 'public', fields: ['x'], destination: 'cloud-api', redacted: false } }),
      makeRecord({ dataFlow: { direction: 'outbound', sensitivity: 'public', fields: ['x'], destination: 'cloud-api', redacted: false } }),
      makeRecord({ dataFlow: { direction: 'outbound', sensitivity: 'public', fields: ['x'], destination: 'cloud-api', redacted: false } }),
      makeRecord({ dataFlow: { direction: 'inbound', sensitivity: 'public', fields: ['x'], destination: 'local-tool', redacted: false } }),
      makeRecord({ dataFlow: { direction: 'local-only', sensitivity: 'public', fields: ['x'], destination: 'local-file', redacted: false } }),
      makeRecord({ dataFlow: { direction: 'local-only', sensitivity: 'public', fields: ['x'], destination: 'local-file', redacted: false } }),
    ];
    const stats = aggregateStats(records);
    expect(stats.outboundCount).toBe(3);
    expect(stats.inboundCount).toBe(1);
    expect(stats.localOnlyCount).toBe(2);
  });

  it('anomalyCount 统计 auditResult=FAIL 的记录', () => {
    // 测试：1 FAIL → anomalyCount=1
    const records: DataSovereigntyRecord[] = [
      makeRecord({ localAction: { type: 'file-write', target: 'a', description: 'x', auditResult: 'FAIL' } }),
      makeRecord({ localAction: { type: 'file-write', target: 'b', description: 'x', auditResult: 'PASS' } }),
    ];
    const stats = aggregateStats(records);
    expect(stats.anomalyCount).toBe(1);
  });

  it('anomalyCount 统计 restricted 数据流向 cloud-api', () => {
    // 测试：restricted + cloud-api 也算异常
    const records: DataSovereigntyRecord[] = [
      makeRecord({
        localAction: { type: 'model-inference', target: 'gpt-4o', description: 'x', auditResult: 'PASS' },
        dataFlow: { direction: 'outbound', sensitivity: 'restricted', fields: ['x'], destination: 'cloud-api', redacted: false },
      }),
    ];
    const stats = aggregateStats(records);
    expect(stats.anomalyCount).toBe(1);
  });

  it('sensitiveLocalRate = 敏感且 local-only / 全部敏感', () => {
    // 测试：2 条 restricted（1 local-only + 1 outbound）→ rate = 0.5
    const records: DataSovereigntyRecord[] = [
      makeRecord({ dataFlow: { direction: 'local-only', sensitivity: 'restricted', fields: ['x'], destination: 'local-file', redacted: false } }),
      makeRecord({ dataFlow: { direction: 'outbound', sensitivity: 'restricted', fields: ['x'], destination: 'cloud-api', redacted: false } }),
    ];
    const stats = aggregateStats(records);
    expect(stats.sensitiveLocalRate).toBeCloseTo(0.5, 5);
  });

  it('routeDist 按模型名启发式分桶（gpt-4o → cloudStrong）', () => {
    // 测试：gpt-4o 匹配 /4o/ → cloudStrong
    const records: DataSovereigntyRecord[] = [
      makeRecord({
        cloudCall: { timestamp: '2026-07-28T10:00:00.000Z', provider: 'openai', model: 'gpt-4o', endpoint: 'x', tokenCount: { input: 1, output: 1 }, purpose: 'p' },
        dataFlow: { direction: 'outbound', sensitivity: 'public', fields: ['x'], destination: 'cloud-api', redacted: false },
      }),
    ];
    const stats = aggregateStats(records);
    expect(stats.routeDist.cloudStrong).toBe(1);
    expect(stats.routeDist.cloudFast).toBe(0);
  });

  it('routeDist 本地 0.5B 模型归入 local05b', () => {
    // 测试：qwen2.5-0.5b + local-model → local05b
    const records: DataSovereigntyRecord[] = [
      makeRecord({
        cloudCall: { timestamp: '2026-07-28T10:00:00.000Z', provider: 'local', model: 'qwen2.5-0.5b', endpoint: 'x', tokenCount: { input: 1, output: 1 }, purpose: 'p' },
        dataFlow: { direction: 'local-only', sensitivity: 'public', fields: ['x'], destination: 'local-model', redacted: false },
      }),
    ];
    const stats = aggregateStats(records);
    expect(stats.routeDist.local05b).toBe(1);
  });
});

// ============================================================
// generateReport · 统一入口
// ============================================================

describe('generateReport', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = makeTmpDir();
  });

  afterEach(() => {
    try { rmSync(tmpHome, { recursive: true, force: true }); } catch { /* */ }
  });

  it('daily 报告：返回 kind=daily 的 GeneratedReport', () => {
    // 测试：统一入口 kind=daily 正确路由
    const report = generateReport('daily', '2026-07-28', tmpHome);
    expect(report.kind).toBe('daily');
    expect(report.label).toBe('2026-07-28');
    expect(report.markdown).toContain('数据主权审计报告');
    expect(report.stats).toBeDefined();
  });

  it('weekly 报告：返回 kind=weekly', () => {
    // 测试：kind=weekly 路由正确
    seedRecords(tmpHome, [
      makeRecord({ cloudCall: { timestamp: '2026-07-13T10:00:00.000Z', provider: 'openai', model: 'gpt-4o', endpoint: 'x', tokenCount: { input: 1, output: 1 }, purpose: 'p' } }),
    ]);
    const report = generateReport('weekly', '2026-W28', tmpHome);
    expect(report.kind).toBe('weekly');
    expect(report.label).toBe('2026-W28');
  });

  it('monthly 报告：返回 kind=monthly', () => {
    // 测试：kind=monthly 路由正确
    seedRecords(tmpHome, [
      makeRecord({ cloudCall: { timestamp: '2026-07-15T10:00:00.000Z', provider: 'openai', model: 'gpt-4o', endpoint: 'x', tokenCount: { input: 1, output: 1 }, purpose: 'p' } }),
    ]);
    const report = generateReport('monthly', '2026-07', tmpHome);
    expect(report.kind).toBe('monthly');
    expect(report.label).toBe('2026-07');
  });
});

// ============================================================
// generateDailyReport · 日报
// ============================================================

describe('generateDailyReport', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = makeTmpDir();
  });

  afterEach(() => {
    try { rmSync(tmpHome, { recursive: true, force: true }); } catch { /* */ }
  });

  it('读取指定日期的 JSONL 并聚合统计', () => {
    // 测试：seed 2 条 2026-07-28 → stats.total=2
    seedRecords(tmpHome, [
      makeRecord({ cloudCall: { timestamp: '2026-07-28T10:00:00.000Z', provider: 'openai', model: 'gpt-4o', endpoint: 'x', tokenCount: { input: 1, output: 1 }, purpose: 'p' } }),
      makeRecord({ cloudCall: { timestamp: '2026-07-28T11:00:00.000Z', provider: 'openai', model: 'gpt-4o', endpoint: 'x', tokenCount: { input: 2, output: 2 }, purpose: 'p2' } }),
    ]);
    const report = generateDailyReport('2026-07-28', tmpHome);
    expect(report.stats.total).toBe(2);
  });

  it('无数据的日期返回空统计报告', () => {
    // 测试：空日期 → total=0，markdown 仍可生成
    const report = generateDailyReport('2020-01-01', tmpHome);
    expect(report.stats.total).toBe(0);
    expect(report.markdown).toContain('数据主权审计报告');
  });

  it('写入可见目录 visiblePath 存在', () => {
    // 测试：报告双写——visiblePath 指向生成的 .md 文件
    seedRecords(tmpHome, [
      makeRecord({ cloudCall: { timestamp: '2026-07-28T10:00:00.000Z', provider: 'openai', model: 'gpt-4o', endpoint: 'x', tokenCount: { input: 1, output: 1 }, purpose: 'p' } }),
    ]);
    const report = generateDailyReport('2026-07-28', tmpHome);
    expect(report.visiblePath).toBeDefined();
    expect(existsSync(report.visiblePath!)).toBe(true);
  });
});

// ============================================================
// generateWeeklyReport · 周报
// ============================================================

describe('generateWeeklyReport', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = makeTmpDir();
  });

  afterEach(() => {
    try { rmSync(tmpHome, { recursive: true, force: true }); } catch { /* */ }
  });

  it('2026-W29 覆盖 7 月 13-19 日（ISO 周范围）', () => {
    // 测试：ISO 周——2026-W29 对应 2026-07-13 ~ 2026-07-19
    // seed 一条在范围内的记录 + 一条在范围外的
    seedRecords(tmpHome, [
      makeRecord({ cloudCall: { timestamp: '2026-07-15T10:00:00.000Z', provider: 'openai', model: 'gpt-4o', endpoint: 'x', tokenCount: { input: 1, output: 1 }, purpose: 'in-range' } }),
      makeRecord({ cloudCall: { timestamp: '2026-07-25T10:00:00.000Z', provider: 'openai', model: 'gpt-4o', endpoint: 'x', tokenCount: { input: 1, output: 1 }, purpose: 'out-range' } }),
    ]);
    const report = generateWeeklyReport('2026-W29', tmpHome);
    expect(report.stats.total).toBe(1); // 只有 07-15 在 W29 内
  });
});

// ============================================================
// generateMonthlyReport · 月报
// ============================================================

describe('generateMonthlyReport', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = makeTmpDir();
  });

  afterEach(() => {
    try { rmSync(tmpHome, { recursive: true, force: true }); } catch { /* */ }
  });

  it('2026-07 覆盖整月 1-31 日', () => {
    // 测试：月报范围——2026-07-01 ~ 2026-07-31
    seedRecords(tmpHome, [
      makeRecord({ cloudCall: { timestamp: '2026-07-01T10:00:00.000Z', provider: 'openai', model: 'gpt-4o', endpoint: 'x', tokenCount: { input: 1, output: 1 }, purpose: 'start' } }),
      makeRecord({ cloudCall: { timestamp: '2026-07-31T10:00:00.000Z', provider: 'openai', model: 'gpt-4o', endpoint: 'x', tokenCount: { input: 1, output: 1 }, purpose: 'end' } }),
      makeRecord({ cloudCall: { timestamp: '2026-08-01T10:00:00.000Z', provider: 'openai', model: 'gpt-4o', endpoint: 'x', tokenCount: { input: 1, output: 1 }, purpose: 'next-month' } }),
    ]);
    const report = generateMonthlyReport('2026-07', tmpHome);
    expect(report.stats.total).toBe(2); // 07-01 和 07-31，排除 08-01
  });
});
