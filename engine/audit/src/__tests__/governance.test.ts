// governance.test.ts · v1.5.0 章一 · 治理 KPI 聚合测试
//
// 覆盖面：六卡聚合口径 + 空数据降级 + 周报/lineage 报告生成。
// 测试隔离：全部走临时目录（不碰真实 ~/.sofagent/data）。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  computeGovernanceKpis,
  formatGovernanceWeekly,
  buildDatasetLineageReport,
  readDecisionEntries,
  readDatasetVersionsLite,
} from '../governance';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-governance-test-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

/** 固定时钟：2026-09-17T12:00:00Z */
const FIXED_NOW = () => Date.parse('2026-09-17T12:00:00Z');

function writeAuditHistory(entries: object[]): void {
  mkdirSync(join(dataDir, 'audit'), { recursive: true });
  writeFileSync(
    join(dataDir, 'audit', 'history.jsonl'),
    entries.map((e) => JSON.stringify(e)).join('\n') + '\n',
    'utf8',
  );
}

function writeDecisionLog(entries: object[]): void {
  mkdirSync(join(dataDir, 'audit'), { recursive: true });
  writeFileSync(
    join(dataDir, 'audit', 'decision-log.jsonl'),
    entries.map((e) => JSON.stringify(e)).join('\n') + '\n',
    'utf8',
  );
}

describe('治理 KPI 聚合（v1.5.0 章一）', () => {
  it('空数据目录 → 各卡独立降级（rate null / 计数 0），不崩', () => {
    const report = computeGovernanceKpis({ dataDir, now: FIXED_NOW });
    expect(report.schemaVersion).toBe('v1');
    expect(report.boundary.triggerRate).toBeNull();
    expect(report.boundary.totalChanges).toBe(0);
    expect(report.coverage.rate).toBeNull();
    expect(report.hitl.resolvedCount).toBe(0);
    expect(report.hitl.medianLatencyMs).toBeNull();
    expect(report.weeklyTrend.thisWeek).toBeNull();
    expect(report.repetition.repetitionRate).toBeNull();
    expect(report.traceReconcile.latestRate).toBeNull();
    expect(report.datasetReview.totalVersions).toBe(0);
    expect(report.decisionHighlights).toEqual([]);
  });

  it('① 安全边界触发率：3 变更 1 WARN 1 FAIL → 0.6667 / 阻断率 0.3333', () => {
    writeAuditHistory([
      { timestamp: '2026-09-16T10:00:00Z', exitCode: 0, ruleResults: [], diffFileCount: 1 },
      { timestamp: '2026-09-16T11:00:00Z', exitCode: 1, ruleResults: [{ status: 'WARN', number: 3, name: 'A3 不改越界' }], diffFileCount: 2 },
      { timestamp: '2026-09-16T12:00:00Z', exitCode: 2, ruleResults: [{ status: 'FAIL', number: 1, name: 'A1 不碰敏感' }], diffFileCount: 3 },
    ]);
    const report = computeGovernanceKpis({ dataDir, now: FIXED_NOW });
    expect(report.boundary.totalChanges).toBe(3);
    expect(report.boundary.triggerRate).toBe(0.6667);
    expect(report.boundary.blockRate).toBe(0.3333);
    expect(report.boundary.distribution).toEqual({ pass: 1, warn: 1, fail: 1 });
    expect(report.boundary.topRules[0].rule).toBe('A3');
  });

  it('② 审计覆盖率：2/3 变更有 commitSha → 0.6667', () => {
    writeAuditHistory([
      { timestamp: '2026-09-16T10:00:00Z', exitCode: 0, ruleResults: [], diffFileCount: 1, commitSha: 'abc123' },
      { timestamp: '2026-09-16T11:00:00Z', exitCode: 0, ruleResults: [], diffFileCount: 1, commitSha: 'def456' },
      { timestamp: '2026-09-16T12:00:00Z', exitCode: 0, ruleResults: [], diffFileCount: 1 },
    ]);
    const report = computeGovernanceKpis({ dataDir, now: FIXED_NOW });
    expect(report.coverage.withSha).toBe(2);
    expect(report.coverage.total).toBe(3);
    expect(report.coverage.rate).toBe(0.6667);
  });

  it('③ HITL 时延：resolved 文件 createdAt→resolvedAt 中位数', () => {
    mkdirSync(join(dataDir, 'hitl', 'resolved'), { recursive: true });
    mkdirSync(join(dataDir, 'hitl', 'pending'), { recursive: true });
    writeFileSync(join(dataDir, 'hitl', 'resolved', 'cp-1.json'), JSON.stringify({
      checkpointId: 'cp-1', decision: 'approve',
      createdAt: '2026-09-16T10:00:00Z', resolvedAt: '2026-09-16T10:10:00Z', // 10 分钟
    }));
    writeFileSync(join(dataDir, 'hitl', 'resolved', 'cp-2.json'), JSON.stringify({
      checkpointId: 'cp-2', decision: 'reject',
      createdAt: '2026-09-16T11:00:00Z', resolvedAt: '2026-09-16T11:00:30Z', // 30 秒
    }));
    writeFileSync(join(dataDir, 'hitl', 'pending', 'cp-3.json'), JSON.stringify({ checkpointId: 'cp-3' }));
    const report = computeGovernanceKpis({ dataDir, now: FIXED_NOW });
    expect(report.hitl.resolvedCount).toBe(2);
    expect(report.hitl.pendingCount).toBe(1);
    // 中位数：升序 [30s, 10min] → 取 [1] = 10 分钟
    expect(report.hitl.medianLatencyMs).toBe(10 * 60 * 1000);
    expect(report.hitl.avgLatencyMs).toBe(Math.round((10 * 60 * 1000 + 30 * 1000) / 2));
  });

  it('④ 周环比：本周/上周 daily 聚合 + delta', () => {
    mkdirSync(join(dataDir, 'dashboard'), { recursive: true });
    // 本周（09-11 ~ 09-17）：violations 10+20=30
    writeFileSync(join(dataDir, 'dashboard', 'daily-2026-09-15.json'), JSON.stringify({ date: '2026-09-15', violations: 10, taskCount: 5, localOps: 100 }));
    writeFileSync(join(dataDir, 'dashboard', 'daily-2026-09-16.json'), JSON.stringify({ date: '2026-09-16', violations: 20, taskCount: 5, localOps: 100 }));
    // 上周（09-04 ~ 09-10）：violations 10
    writeFileSync(join(dataDir, 'dashboard', 'daily-2026-09-07.json'), JSON.stringify({ date: '2026-09-07', violations: 10, taskCount: 5, localOps: 100 }));
    const report = computeGovernanceKpis({ dataDir, now: FIXED_NOW });
    expect(report.weeklyTrend.thisWeek?.violations).toBe(30);
    expect(report.weeklyTrend.lastWeek?.violations).toBe(10);
    expect(report.weeklyTrend.delta.violationsPct).toBe(2); // +200%
  });

  it('⑤ 任务重复执行率：同指纹 3 次 + 独立 1 次 → 1/2', () => {
    writeDecisionLog([
      { ts: '2026-09-16T10:00:00Z', agentId: 'agent-a', kind: 'TOOL_GATE', moment: 'ACT', why: { text: 'x', tags: ['sf_write'] } },
      { ts: '2026-09-16T11:00:00Z', agentId: 'agent-a', kind: 'TOOL_GATE', moment: 'ACT', why: { text: 'x', tags: ['sf_write'] } },
      { ts: '2026-09-16T12:00:00Z', agentId: 'agent-a', kind: 'TOOL_GATE', moment: 'ACT', why: { text: 'x', tags: ['sf_write'] } },
      { ts: '2026-09-16T13:00:00Z', agentId: 'agent-b', kind: 'TOOL_GATE', moment: 'ACT', why: { text: 'y', tags: ['sf_read'] } },
    ]);
    const report = computeGovernanceKpis({ dataDir, now: FIXED_NOW });
    expect(report.repetition.totalDecisions).toBe(4);
    expect(report.repetition.uniqueFingerprints).toBe(2);
    expect(report.repetition.repeatedFingerprints).toBe(1);
    expect(report.repetition.repetitionRate).toBe(0.5);
    expect(report.repetition.topRepeated[0].count).toBe(3);
  });

  it('⑥ trace 对账一致率：COVERAGE 决策最新一条解析', () => {
    writeDecisionLog([
      {
        ts: '2026-09-16T10:00:00Z', agentId: 'sofagent-trace-reconcile', kind: 'COVERAGE', moment: 'ATTRIBUTION',
        why: 'trace 对账：12 session vs 8 diff 文件——一致率 0.75，差异 3 项',
      },
      {
        ts: '2026-09-17T09:00:00Z', agentId: 'sofagent-trace-reconcile', kind: 'COVERAGE', moment: 'ATTRIBUTION',
        why: 'trace 对账：15 session vs 10 diff 文件——一致率 0.8，差异 4 项',
      },
    ]);
    const report = computeGovernanceKpis({ dataDir, now: FIXED_NOW });
    // 最新一条（ts 09-17）胜出
    expect(report.traceReconcile.latestRate).toBe(0.8);
    expect(report.traceReconcile.totalSessions).toBe(15);
    expect(report.traceReconcile.diffFiles).toBe(10);
    expect(report.traceReconcile.discrepancies).toBe(4);
    expect(report.traceReconcile.lastRunAt).toBe('2026-09-17T09:00:00Z');
  });

  it('决策高亮：仅带 causedBy 的决策入选，链深与因果类型带出', () => {
    writeDecisionLog([
      // 无因果边——不入选
      { ts: '2026-09-16T09:00:00Z', agentId: 'a', kind: 'TOOL_GATE', moment: 'ACT', why: { text: '普通放行' } },
      // 有因果边——入选（链深 2）
      {
        ts: '2026-09-16T10:00:00Z', agentId: 'agent-x', kind: 'TOOL_GATE', moment: 'ACT', category: 'skip',
        why: { text: '拦截写入：上游路由决策判定越界' },
        causedBy: ['2026-09-16T09:30:00Z', '2026-09-16T09:45:00Z'], causalType: 'caused',
      },
    ]);
    const report = computeGovernanceKpis({ dataDir, now: FIXED_NOW });
    expect(report.decisionHighlights.length).toBe(1);
    const h = report.decisionHighlights[0]!;
    expect(h.agentId).toBe('agent-x');
    expect(h.kind).toBe('TOOL_GATE');
    expect(h.category).toBe('skip');
    expect(h.causalType).toBe('caused');
    expect(h.causedByCount).toBe(2);
    expect(h.whySummary).toContain('拦截写入');
  });

  it('决策高亮：无因果边决策 → 空数组（不硬凑）', () => {
    writeDecisionLog([
      { ts: '2026-09-16T10:00:00Z', agentId: 'a', kind: 'TOOL_GATE', moment: 'ACT', why: { text: 'x' } },
    ]);
    const report = computeGovernanceKpis({ dataDir, now: FIXED_NOW });
    expect(report.decisionHighlights).toEqual([]);
  });

  it('第七卡：数据集版本台账抽样（最新在前 + 审阅状态归一）', () => {
    mkdirSync(join(dataDir, 'train', 'ent-1', 'datasets'), { recursive: true });
    writeFileSync(join(dataDir, 'train', 'ent-1', 'datasets', 'versions.jsonl'), [
      JSON.stringify({ versionId: 'v1', datasetId: 'ds-a', createdAt: '2026-09-10T00:00:00Z', sampleCount: 100, redactionHits: 3 }),
      JSON.stringify({ versionId: 'v2', datasetId: 'ds-a', createdAt: '2026-09-15T00:00:00Z', sampleCount: 150, redactionHits: 5, reviewStatus: 'approved' }),
    ].join('\n') + '\n');
    const report = computeGovernanceKpis({ dataDir, now: FIXED_NOW, sampleLimit: 8 });
    expect(report.datasetReview.totalVersions).toBe(2);
    expect(report.datasetReview.sample[0].versionId).toBe('v2'); // 最新在前
    expect(report.datasetReview.sample[0].reviewStatus).toBe('approved');
    expect(report.datasetReview.sample[1].reviewStatus).toBe('pending');
  });
});

describe('周报与 lineage 报告导出（v1.5.0 章一）', () => {
  it('周报：空数据降级文案 + 六卡表格投影', () => {
    const report = computeGovernanceKpis({ dataDir, now: FIXED_NOW });
    const md = formatGovernanceWeekly(report);
    expect(md).toContain('# sofagent 治理 KPI 周报');
    expect(md).toContain('①');
    expect(md).toContain('⑥');
    expect(md).toContain('—'); // 空数据降级符号
    expect(md).toContain('暂无数据集版本台账');
  });

  it('lineage 报告：四段式结构（六源/双闸/版本演进/审计链）', () => {
    mkdirSync(join(dataDir, 'train', 'ent-1', 'datasets'), { recursive: true });
    writeFileSync(join(dataDir, 'train', 'ent-1', 'datasets', 'versions.jsonl'), JSON.stringify({
      versionId: 'v1', datasetId: 'ds-a', source: 'db-upload', createdAt: '2026-09-10T00:00:00Z',
      sampleCount: 100, redactionHits: 3, reviewStatus: 'approved',
    }) + '\n');
    writeAuditHistory([
      { timestamp: '2026-09-16T10:00:00Z', exitCode: 0, ruleResults: [], diffFileCount: 1, commitSha: 'abc' },
    ]);
    const md = buildDatasetLineageReport({ dataDir, now: FIXED_NOW });
    expect(md).toContain('# sofagent 数据集 lineage 合规报告');
    expect(md).toContain('## 一、数据来源（六源）');
    expect(md).toContain('db-upload');
    expect(md).toContain('## 二、双闸记录');
    expect(md).toContain('## 三、版本演进');
    expect(md).toContain('## 四、审计链引用');
    expect(md).toContain('history-chain-head');
  });
});

function writeDecisionLogRaw(lines: string[]): void {
  mkdirSync(join(dataDir, 'audit'), { recursive: true });
  writeFileSync(join(dataDir, 'audit', 'decision-log.jsonl'), lines.join('\n') + '\n', 'utf8');
}

describe('只读辅助出口（v1.5.0 章一）', () => {
  it('readDecisionEntries：坏行容忍 + limitEntries 截尾', () => {
    // 直接手写原始行——真实坏行是非法 JSON（不是合法 JSON 字符串）
    writeDecisionLogRaw([
      JSON.stringify({ ts: '2026-09-16T10:00:00Z', agentId: 'a', kind: 'TOOL_GATE', moment: 'ACT', why: 'x' }),
      '{broken json',
      JSON.stringify({ ts: '2026-09-16T11:00:00Z', agentId: 'b', kind: 'TOOL_GATE', moment: 'ACT', why: 'y' }),
    ]);
    const all = readDecisionEntries(dataDir);
    expect(all.length).toBe(2); // 坏行跳过
    const limited = readDecisionEntries(dataDir, 1);
    expect(limited.length).toBe(1);
    expect(limited[0]?.agentId).toBe('b'); // 截尾保留最新
  });

  it('readDatasetVersionsLite：多企业目录扫描 + 抽样上限', () => {
    for (const ent of ['ent-1', 'ent-2']) {
      mkdirSync(join(dataDir, 'train', ent, 'datasets'), { recursive: true });
      // createdAt 拉开差距——ent-2 恒晚于 ent-1（readdir 顺序不参与排序稳定性）
      const day = ent === 'ent-2' ? '2026-09-14' : '2026-09-12';
      writeFileSync(join(dataDir, 'train', ent, 'datasets', 'versions.jsonl'), [
        JSON.stringify({ versionId: `${ent}-v1`, createdAt: '2026-09-10T00:00:00Z' }),
        JSON.stringify({ versionId: `${ent}-v2`, createdAt: `${day}T00:00:00Z` }),
      ].join('\n') + '\n');
    }
    const r = readDatasetVersionsLite(dataDir, 3);
    expect(r.total).toBe(4);
    expect(r.rows.length).toBe(3); // 抽样上限
    expect(r.rows[0].versionId).toBe('ent-2-v2'); // 全局最新在前
  });
});
