// ============================================================
// audit-trail-inspector.test.ts · 审计轨迹聚合巡检器测试（v1.3.2 交付 7）
// ============================================================
//
// 覆盖：
// - @daily 巡检：无审计历史 → info 不触发
// - 本地记录按 agentId 聚合 → 触发 warning（多记录轨迹）
// - 跨设备合并：注入 peer 记录 → 完整轨迹（peer user 不覆盖 local internal）
// - aggregateAuditTrails 聚合结果可复用
//
// 全部临时目录隔离（history.jsonl 写入 temp dataDir）。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { runAuditTrailInspector, aggregateAuditTrails } from '../audit-trail';
import { getHistoryFilePath } from '@sofagent/core';

/** 构造最小审计记录（写 history.jsonl 用） */
function entry(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    timestamp: '2026-08-10T01:00:00.000Z',
    diffRange: 'HEAD~1..HEAD',
    exitCode: 0,
    ruleResults: [],
    diffFileCount: 1,
    ...overrides,
  };
}

/** 写 history.jsonl 到临时数据目录 */
function writeHistory(dataDir: string, entries: Array<Record<string, unknown>>): void {
  const filePath = getHistoryFilePath(dataDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
}

describe('audit-trail inspector · @daily 聚合巡检（v1.3.1 交付 7）', () => {
  let tmpDir: string;
  let dataDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-audittrail-'));
    dataDir = path.join(tmpDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('无审计历史 → info 不触发', () => {
    const result = runAuditTrailInspector(tmpDir, { dataDir });
    expect(result.name).toBe('audit-trail');
    expect(result.triggered).toBe(false);
    expect(result.message).toContain('No audit history');
  });

  it('本地单 agent 多记录 → 触发 warning（多记录轨迹）', () => {
    writeHistory(dataDir, [
      entry({ agentId: 'agent-1', timestamp: '2026-08-10T01:00:00Z' }),
      entry({ agentId: 'agent-1', timestamp: '2026-08-10T02:00:00Z' }),
      entry({ agentId: 'agent-2', timestamp: '2026-08-10T01:30:00Z' }),
    ]);

    const result = runAuditTrailInspector(tmpDir, { dataDir });
    expect(result.triggered).toBe(true);
    expect(result.message).toContain('agent-1');
    expect(result.message).toContain('多记录');
    expect(result.message).toContain('2 个 agent');
  });

  it('无 agentId 记录 → 有审计历史但无轨迹 → info 不触发', () => {
    writeHistory(dataDir, [entry({})]);
    const result = runAuditTrailInspector(tmpDir, { dataDir });
    expect(result.triggered).toBe(false);
    expect(result.message).toContain('No agent-id audit records');
  });

  it('跨设备合并：注入 peer 记录 → 完整轨迹（peer user 不覆盖 local internal）', () => {
    writeHistory(dataDir, [
      entry({ agentId: 'agent-1', timestamp: '2026-08-10T01:00:00Z' }),
    ]);
    const peerRecords = [
      { entry: entry({ agentId: 'agent-1', timestamp: '2026-08-10T02:00:00Z' }), deviceId: 'peer-1', trust: 'user' },
      { entry: entry({ agentId: 'agent-1', timestamp: '2026-08-10T03:00:00Z' }), deviceId: 'peer-1', trust: 'user' },
    ] as Array<{ entry: Record<string, unknown>; deviceId: string; trust: string }>;

    const result = runAuditTrailInspector(tmpDir, { dataDir, peerRecords: peerRecords as never });
    expect(result.triggered).toBe(true);
    expect(result.message).toContain('agent-1');

    // 聚合结果：agent-1 三条记录（本地 1 + peer 2），时间升序
    const byAgent = aggregateAuditTrails({ dataDir, peerRecords: peerRecords as never });
    expect(byAgent['agent-1']).toHaveLength(3);
    expect(byAgent['agent-1']?.map((m) => m.entry.timestamp)).toEqual([
      '2026-08-10T01:00:00Z',
      '2026-08-10T02:00:00Z',
      '2026-08-10T03:00:00Z',
    ]);
  });

  it('跨设备同 mergeKey 冲突：peer user 不覆盖 local internal', () => {
    writeHistory(dataDir, [
      entry({ agentId: 'agent-1', timestamp: '2026-08-10T01:00:00Z', commitSha: 'abc' }),
    ]);
    const peerRecords = [
      // 同 commitSha 但 peer user——不应覆盖 local internal
      { entry: entry({ agentId: 'agent-1', timestamp: '2026-08-10T05:00:00Z', commitSha: 'abc' }), deviceId: 'peer-1', trust: 'user' },
    ] as Array<{ entry: Record<string, unknown>; deviceId: string; trust: string }>;

    const byAgent = aggregateAuditTrails({ dataDir, peerRecords: peerRecords as never });
    expect(byAgent['agent-1']).toHaveLength(1);
    expect(byAgent['agent-1']?.[0]?.deviceId).toBe('local'); // local internal 胜出
    expect(byAgent['agent-1']?.[0]?.entry.timestamp).toBe('2026-08-10T01:00:00Z');
  });
});
