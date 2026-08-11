// ============================================================
// audit-trail.test.ts · MCP audit_trail tool 测试（v1.3.2 交付 7）
// ============================================================
//
// 覆盖：
// - 有 agentId 记录：按 agent 查完整轨迹（时间升序）
// - 无记录：返回空轨迹不报错
// - 跨设备合并：注入 peer 记录 → 完整轨迹（trust 裁决不覆盖本地）
// - 无 agent_id：列出全部有轨迹的 agent
//
// 全部经 setAuditTrailTestRecords 注入 fake 记录——不读真实文件系统。
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { auditTrail, setAuditTrailTestRecords } from '../tools/audit-trail';

/** 构造一条审计记录（测试注入形状） */
function entry(overrides: Record<string, unknown> = {}) {
  return {
    timestamp: '2026-08-10T01:00:00.000Z',
    diffRange: 'HEAD~1..HEAD',
    exitCode: 0,
    ...overrides,
  };
}

describe('audit_trail · 跨设备审计轨迹查询（v1.3.1 交付 7）', () => {
  let tmpDir: string;
  let origData: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-mcp-at-'));
    origData = process.env.SOFAGENT_DATA;
    vi.stubEnv('SOFAGENT_DATA', tmpDir);
    setAuditTrailTestRecords(null);
  });

  afterEach(() => {
    setAuditTrailTestRecords(null);
    vi.stubEnv('SOFAGENT_DATA', origData ?? '');
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('有 agentId 记录：按 agent 查完整轨迹（时间升序）', async () => {
    setAuditTrailTestRecords([
      { entry: entry({ agentId: 'agent-1', timestamp: '2026-08-10T02:00:00Z' }), deviceId: 'local', trust: 'internal' },
      { entry: entry({ agentId: 'agent-1', timestamp: '2026-08-10T01:00:00Z' }), deviceId: 'local', trust: 'internal' },
      { entry: entry({ agentId: 'agent-2', timestamp: '2026-08-10T01:30:00Z' }), deviceId: 'local', trust: 'internal' },
    ]);

    const result = await auditTrail({ agent_id: 'agent-1' });
    expect(result.data.isError).toBe(false);
    expect(result.data.trail).toHaveLength(2);
    // 时间升序
    expect(result.data.trail?.[0]?.timestamp).toBe('2026-08-10T01:00:00Z');
    expect(result.data.trail?.[1]?.timestamp).toBe('2026-08-10T02:00:00Z');
    expect(result.text).toContain('[sofagent]');
    expect(result.text).toContain('agent-1');
  });

  it('无记录：返回空轨迹不报错', async () => {
    setAuditTrailTestRecords([]);
    const result = await auditTrail({ agent_id: 'agent-none' });
    expect(result.data.isError).toBe(false);
    expect(result.data.trail).toEqual([]);
    expect(result.text).toContain('无审计轨迹');
  });

  it('跨设备合并：注入 peer 记录 → 完整轨迹；同 commitSha 冲突 peer 不覆盖本地', async () => {
    setAuditTrailTestRecords([
      // 本地 internal（旧）
      { entry: entry({ agentId: 'agent-1', timestamp: '2026-08-10T01:00:00Z', commitSha: 'abc' }), deviceId: 'local', trust: 'internal' },
      // peer user（同 commitSha 新但低 trust——不覆盖）
      { entry: entry({ agentId: 'agent-1', timestamp: '2026-08-10T08:00:00Z', commitSha: 'abc' }), deviceId: 'peer-1', trust: 'user' },
      // peer user（不同 commitSha——进轨迹）
      { entry: entry({ agentId: 'agent-1', timestamp: '2026-08-10T09:00:00Z', commitSha: 'def' }), deviceId: 'peer-1', trust: 'user' },
    ]);

    const result = await auditTrail({ agent_id: 'agent-1', include_peers: true });
    expect(result.data.isError).toBe(false);
    // 同 commitSha 冲突合并为 1 条（local 胜出）+ 不同 commitSha 1 条 = 2 条
    expect(result.data.trail).toHaveLength(2);
    // 第一条是 local internal（trust 高胜出）
    expect(result.data.trail?.[0]?.deviceId).toBe('local');
    expect(result.data.trail?.[0]?.trust).toBe('internal');
    // 第二条是 peer（不同 commitSha）
    expect(result.data.trail?.[1]?.deviceId).toBe('peer-1');
  });

  it('无 agent_id：列出全部有轨迹的 agent', async () => {
    setAuditTrailTestRecords([
      { entry: entry({ agentId: 'agent-1', timestamp: '2026-08-10T01:00:00Z' }), deviceId: 'local', trust: 'internal' },
      { entry: entry({ agentId: 'agent-1', timestamp: '2026-08-10T02:00:00Z' }), deviceId: 'local', trust: 'internal' },
      { entry: entry({ agentId: 'agent-2', timestamp: '2026-08-10T01:30:00Z' }), deviceId: 'peer-1', trust: 'user' },
    ]);

    const result = await auditTrail({});
    expect(result.data.isError).toBe(false);
    expect(result.data.agents).toHaveLength(2);
    const a1 = result.data.agents?.find((a) => a.agentId === 'agent-1');
    expect(a1?.recordCount).toBe(2);
    const a2 = result.data.agents?.find((a) => a.agentId === 'agent-2');
    expect(a2?.devices).toContain('peer-1');
  });
});
