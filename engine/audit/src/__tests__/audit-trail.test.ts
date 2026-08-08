// ============================================================
// audit-trail.test.ts · 跨设备审计轨迹聚合测试（v1.2.9 §3.2）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  appendAuditTrail,
  readAuditTrails,
  aggregateTrails,
  getDeviceFingerprint,
  resolveTrailPath,
  formatTrailReport,
} from '../audit-trail';
import type { AuditTrailEntry } from '../audit-trail';

describe('§3.2 审计轨迹', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-trail-'));
    process.env.SOFAGENT_DATA = tmpDir;
  });

  afterEach(() => {
    delete process.env.SOFAGENT_DATA;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  describe('getDeviceFingerprint', () => {
    it('返回 8 位十六进制', () => {
      const fp = getDeviceFingerprint();
      expect(fp).toHaveLength(8);
      expect(fp).toMatch(/^[0-9a-f]{8}$/);
    });

    it('同进程多次调用 → 相同值', () => {
      const fp1 = getDeviceFingerprint();
      const fp2 = getDeviceFingerprint();
      expect(fp1).toBe(fp2);
    });
  });

  describe('appendAuditTrail + readAuditTrails', () => {
    it('写入一条轨迹后读回', () => {
      appendAuditTrail({
        agentId: 'agent-001',
        ruleId: 'A3',
        severity: 'PASS',
        summary: 'commit message 合规',
      });

      const trails = readAuditTrails();
      expect(trails).toHaveLength(1);
      expect(trails[0]!.agentId).toBe('agent-001');
      expect(trails[0]!.ruleId).toBe('A3');
      expect(trails[0]!.severity).toBe('PASS');
      expect(trails[0]!.deviceFingerprint).toHaveLength(8);
      expect(trails[0]!.timestamp).toBeTruthy();
    });

    it('写入多条后读回全部', () => {
      appendAuditTrail({ agentId: 'a1', ruleId: 'A1', severity: 'FAIL', summary: '敏感文件' });
      appendAuditTrail({ agentId: 'a1', ruleId: 'A3', severity: 'PASS', summary: 'commit msg' });
      appendAuditTrail({ agentId: 'a2', ruleId: 'A9', severity: 'WARN', summary: 'injection' });

      const trails = readAuditTrails();
      expect(trails).toHaveLength(3);
    });

    it('空文件时返回空数组', () => {
      const trails = readAuditTrails();
      expect(trails).toEqual([]);
    });

    it('按 agentId 过滤', () => {
      appendAuditTrail({ agentId: 'a1', ruleId: 'A1', severity: 'FAIL', summary: 'test1' });
      appendAuditTrail({ agentId: 'a2', ruleId: 'A2', severity: 'PASS', summary: 'test2' });
      appendAuditTrail({ agentId: 'a1', ruleId: 'A3', severity: 'PASS', summary: 'test3' });

      const trails = readAuditTrails({ agentId: 'a1' });
      expect(trails).toHaveLength(2);
      expect(trails.every((t) => t.agentId === 'a1')).toBe(true);
    });

    it('按 severity 过滤', () => {
      appendAuditTrail({ agentId: 'a1', ruleId: 'A1', severity: 'FAIL', summary: 'test1' });
      appendAuditTrail({ agentId: 'a2', ruleId: 'A2', severity: 'PASS', summary: 'test2' });

      const trails = readAuditTrails({ severity: 'FAIL' });
      expect(trails).toHaveLength(1);
      expect(trails[0]!.severity).toBe('FAIL');
    });
  });

  describe('aggregateTrails', () => {
    const sampleEntries: AuditTrailEntry[] = [
      { agentId: 'a1', timestamp: '2026-01-01T00:00:00Z', ruleId: 'A1', severity: 'FAIL', summary: 's', deviceFingerprint: 'abc12345' },
      { agentId: 'a1', timestamp: '2026-01-02T00:00:00Z', ruleId: 'A3', severity: 'PASS', summary: 's', deviceFingerprint: 'abc12345' },
      { agentId: 'a1', timestamp: '2026-01-03T00:00:00Z', ruleId: 'A9', severity: 'FAIL', summary: 's', deviceFingerprint: 'abc12345' },
      { agentId: 'a2', timestamp: '2026-01-01T00:00:00Z', ruleId: 'A1', severity: 'PASS', summary: 's', deviceFingerprint: 'def67890' },
    ];

    it('按 agentId 分组', () => {
      const result = aggregateTrails(sampleEntries, 'agentId');
      expect(result.size).toBe(2);

      const a1 = result.get('a1')!;
      expect(a1.total).toBe(3);
      expect(a1.passed).toBe(1);
      expect(a1.failed).toBe(2);
      expect(a1.rulesHit).toContain('A1');
      expect(a1.rulesHit).toContain('A3');
      expect(a1.rulesHit).toContain('A9');

      const a2 = result.get('a2')!;
      expect(a2.total).toBe(1);
      expect(a2.passed).toBe(1);
      expect(a2.failed).toBe(0);
    });

    it('按 ruleId 分组', () => {
      const result = aggregateTrails(sampleEntries, 'ruleId');
      expect(result.size).toBe(3);
      expect(result.get('A1')!.total).toBe(2);
      expect(result.get('A3')!.total).toBe(1);
      expect(result.get('A9')!.total).toBe(1);
    });

    it('按 deviceFingerprint 分组', () => {
      const result = aggregateTrails(sampleEntries, 'deviceFingerprint');
      expect(result.size).toBe(2);
      expect(result.get('abc12345')!.total).toBe(3);
      expect(result.get('def67890')!.total).toBe(1);
    });

    it('空数组返回空 Map', () => {
      const result = aggregateTrails([], 'agentId');
      expect(result.size).toBe(0);
    });
  });

  describe('formatTrailReport', () => {
    it('空轨迹返回提示文本', () => {
      const report = formatTrailReport([]);
      expect(report).toContain('为空');
    });

    it('生成可读报告', () => {
      const entries: AuditTrailEntry[] = [
        { agentId: 'a1', timestamp: '2026-01-01T00:00:00Z', ruleId: 'A1', severity: 'PASS', summary: 's', deviceFingerprint: 'abc12345' },
        { agentId: 'a1', timestamp: '2026-01-02T00:00:00Z', ruleId: 'A3', severity: 'FAIL', summary: 's', deviceFingerprint: 'abc12345' },
      ];
      const report = formatTrailReport(entries);
      expect(report).toContain('2 条记录');
      expect(report).toContain('a1');
      expect(report).toContain('通过率');
    });
  });
});
