// stats.test.ts · v1.4.3 第七章 测试
//
// 验收标准逐条覆盖：
// - --stats 输出聚合报告（默认 30 天，--days 可调，空历史降级不崩）
// - --json 输出纯净机器可读（零人类可读混行）
// - 指标口径与 HANDBOOK 一致（触发率/阻断率定义逐条对账）
// - 只读验证：聚合前后 history.jsonl 字节级一致（HMAC 链零破坏）

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  computeAuditStats,
  formatStatsJson,
  formatStatsReport,
  readHistoryEntries,
  statsHistoryFilePath,
} from '../stats';

// ── 测试基建 ──
let dataDir: string;
const NOW_MS = Date.parse('2026-08-29T12:00:00.000Z');

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-stats-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

/** 落盘一条 history 记录（timestamp 相对 NOW 偏移天；rule 字段映射 RuleCheck.name/number） */
function seedEntry(daysAgo: number, exitCode: number, ruleResults: Array<{ rule: string; status: string; message?: string }>): void {
  const dir = join(dataDir, 'audit');
  mkdirSync(dir, { recursive: true });
  const ts = new Date(NOW_MS - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  const line = JSON.stringify({
    timestamp: ts,
    diffRange: 'HEAD~1..HEAD',
    exitCode,
    ruleResults: ruleResults.map((r) => ({
      // RuleCheck 真实字段：name（规则名）/ number（编号）——规则码 A<n>（number<200）/ E<n-200>（number>=200，与 reporter.ts 口径一致）
      name: r.message ?? r.rule,
      number: r.rule.startsWith('E')
        ? 200 + (parseInt(r.rule.slice(1), 10) || 0)
        : parseInt(r.rule.replace('A', ''), 10) || 0,
      status: r.status,
      details: [],
    })),
    diffFileCount: 1,
  });
  writeFileSync(join(dir, 'history.jsonl'), line + '\n', { flag: 'a' });
}

// ════════════════════════════════════════
// 一、指标计算（HANDBOOK 口径逐条对账）
// ════════════════════════════════════════

describe('computeAuditStats 指标计算', () => {
  it('触发率 = (WARN+FAIL)/总数（HANDBOOK 口径）', () => {
    // 10 条：6 PASS + 3 WARN + 1 FAIL → 触发率 0.4
    for (let i = 0; i < 6; i++) seedEntry(1, 0, []);
    for (let i = 0; i < 3; i++) seedEntry(1, 1, [{ rule: 'A2', status: 'WARN', message: '密钥疑似泄漏' }]);
    seedEntry(1, 2, [{ rule: 'A9', status: 'FAIL', message: '注入攻击特征' }]);
    const report = computeAuditStats({ dataDir, now: () => NOW_MS, days: 30 });
    expect(report.totalChanges).toBe(10);
    expect(report.distribution).toEqual({ pass: 6, warn: 3, fail: 1 });
    expect(report.triggerRate).toBe(0.4); // (3+1)/10
  });

  it('阻断率 = FAIL/总数（exitCode=2 为准——HANDBOOK 口径）', () => {
    for (let i = 0; i < 8; i++) seedEntry(1, 0, []);
    seedEntry(1, 1, [{ rule: 'A3', status: 'WARN' }]);
    seedEntry(1, 2, [{ rule: 'A2', status: 'FAIL' }]);
    const report = computeAuditStats({ dataDir, now: () => NOW_MS });
    expect(report.blockRate).toBe(0.1); // 1/10
  });

  it('高危规则 Top 5（WARN+FAIL 合计降序 + FAIL 分计）', () => {
    seedEntry(1, 2, [
      { rule: 'A2', status: 'FAIL', message: '密钥泄漏：AKID...' },
      { rule: 'A9', status: 'FAIL', message: '注入特征' },
    ]);
    seedEntry(1, 2, [{ rule: 'A2', status: 'FAIL', message: '密钥泄漏：sk-...' }]);
    seedEntry(1, 1, [{ rule: 'A3', status: 'WARN', message: '越界编辑' }]);
    seedEntry(1, 1, [{ rule: 'A2', status: 'WARN' }]);
    const report = computeAuditStats({ dataDir, now: () => NOW_MS });
    expect(report.topRules[0]!.rule).toBe('A2');
    expect(report.topRules[0]!.count).toBe(3); // 2 FAIL + 1 WARN
    expect(report.topRules[0]!.failCount).toBe(2);
    expect(report.topRules[1]!.rule).toBe('A9');
    expect(report.topRules.length).toBe(3); // A2/A9/A3
  });

  it('E 系列规则码：number>=200 映射 E<n-200>（与 reporter.ts 口径一致，不显示成 A201）', () => {
    // E1（number=201）WARN + E2（number=202）FAIL —— 聚合后规则码应显示 E1/E2 而非 A201/A202
    seedEntry(1, 1, [{ rule: 'E1', status: 'WARN', message: 'E 系列规则一' }]);
    seedEntry(1, 2, [{ rule: 'E2', status: 'FAIL', message: 'E 系列规则二' }]);
    const report = computeAuditStats({ dataDir, now: () => NOW_MS });
    const codes = report.topRules.map((r) => r.rule);
    expect(codes).toContain('E1');
    expect(codes).toContain('E2');
    expect(codes).not.toContain('A201');
    expect(codes).not.toContain('A202');
    const e2 = report.topRules.find((r) => r.rule === 'E2')!;
    expect(e2.count).toBe(1);
    expect(e2.failCount).toBe(1);
  });

  it('窗口过滤：窗口外条目不进分母（--days 可调）', () => {
    seedEntry(1, 0, []); // 窗口内
    seedEntry(10, 0, []); // 10 天前——7 天窗口外、30 天窗口内
    seedEntry(60, 0, []); // 60 天前——两窗口外
    const week = computeAuditStats({ dataDir, now: () => NOW_MS, days: 7 });
    const month = computeAuditStats({ dataDir, now: () => NOW_MS, days: 30 });
    expect(week.totalChanges).toBe(1);
    expect(month.totalChanges).toBe(2);
  });

  it('空历史降级：totalChanges=0 + 触发率/阻断率 null（不硬凑 0——HANDBOOK 口径）', () => {
    const report = computeAuditStats({ dataDir, now: () => NOW_MS });
    expect(report.totalChanges).toBe(0);
    expect(report.triggerRate).toBeNull();
    expect(report.blockRate).toBeNull();
    expect(report.topRules).toEqual([]);
  });

  it('坏行容忍：JSON 损坏行跳过不崩', () => {
    const dir = join(dataDir, 'audit');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'history.jsonl'), '{broken json\n' + JSON.stringify({
      timestamp: new Date(NOW_MS).toISOString(),
      exitCode: 0,
      ruleResults: [],
    }) + '\n', 'utf-8');
    const entries = readHistoryEntries(dataDir);
    expect(entries.length).toBe(1);
    const report = computeAuditStats({ dataDir, now: () => NOW_MS });
    expect(report.totalChanges).toBe(1);
  });

  it('缺失 timestamp/exitCode 的条目不进分母（最小形状校验）', () => {
    const dir = join(dataDir, 'audit');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'history.jsonl'), JSON.stringify({ foo: 1 }) + '\n', 'utf-8');
    expect(readHistoryEntries(dataDir)).toEqual([]);
  });
});

// ════════════════════════════════════════
// 二、输出格式（人类可读 + JSON 纯净）
// ════════════════════════════════════════

describe('输出格式', () => {
  it('formatStatsReport 人类可读（窗口/分布/触发率/阻断率/Top 规则）', () => {
    seedEntry(1, 2, [{ rule: 'A9', status: 'FAIL', message: '注入特征' }]);
    seedEntry(1, 0, []);
    const report = computeAuditStats({ dataDir, now: () => NOW_MS });
    const text = formatStatsReport(report);
    expect(text).toContain('审计聚合报告');
    expect(text).toContain('近 30 天');
    expect(text).toContain('变更总数：2');
    expect(text).toContain('安全边界触发率');
    expect(text).toContain('50.00%'); // 1/2
    expect(text).toContain('阻断率');
    expect(text).toContain('A9');
  });

  it('formatStatsJson 纯净（零人类可读混行——可 JSON.parse 回环）', () => {
    seedEntry(1, 1, [{ rule: 'A3', status: 'WARN', message: '越界' }]);
    const report = computeAuditStats({ dataDir, now: () => NOW_MS });
    const json = formatStatsJson(report);
    // 纯净判定：整体可 parse 且 parse 回环等价
    const parsed = JSON.parse(json);
    expect(parsed.totalChanges).toBe(report.totalChanges);
    expect(parsed.triggerRate).toBe(report.triggerRate);
    expect(parsed.topRules).toEqual(report.topRules);
    // 零混行：不含报告横线等人类可读装饰
    expect(json).not.toContain('━━━');
    expect(json).not.toContain('═');
  });

  it('空历史的 JSON 输出也纯净（null 字段合法保留）', () => {
    const report = computeAuditStats({ dataDir, now: () => NOW_MS });
    const parsed = JSON.parse(formatStatsJson(report));
    expect(parsed.triggerRate).toBeNull();
    expect(parsed.totalChanges).toBe(0);
  });
});

// ════════════════════════════════════════
// 三、只读铁律（聚合前后字节级一致——HMAC 链零破坏）
// ════════════════════════════════════════

describe('只读铁律', () => {
  it('聚合前后 history.jsonl 字节级一致', () => {
    seedEntry(1, 0, []);
    seedEntry(2, 2, [{ rule: 'A2', status: 'FAIL' }]);
    const filePath = statsHistoryFilePath(dataDir);
    const before = readFileSync(filePath);
    // 聚合多次（含不同窗口）
    computeAuditStats({ dataDir, now: () => NOW_MS, days: 7 });
    computeAuditStats({ dataDir, now: () => NOW_MS, days: 30 });
    computeAuditStats({ dataDir, now: () => NOW_MS, days: 365 });
    const after = readFileSync(filePath);
    expect(after.equals(before)).toBe(true); // 字节级一致
  });

  it('history.jsonl 不存在时零崩溃零创建（空历史降级）', () => {
    const report = computeAuditStats({ dataDir, now: () => NOW_MS });
    expect(report.totalChanges).toBe(0);
    // 只读铁律：不存在的文件不被创建
    expect(require('fs').existsSync(statsHistoryFilePath(dataDir))).toBe(false);
  });
});
