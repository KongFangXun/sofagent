// ============================================================
// audit-log.test.ts · 审计日志引擎测试
// v0.97 新增
// ============================================================

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { existsSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { appendAuditLog, extractLogEntries, syncLogsToAudit } from './audit-log';

function tmpDir(): string {
  const dir = join(tmpdir(), `sofagent-audit-test-${Date.now()}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const originalEnv = { ...process.env };

describe('audit-log', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = tmpDir();
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* */ }
  });

  afterAll(() => {
    // Restore env
    process.env.SOFA_AUDIT_ENABLED = originalEnv.SOFA_AUDIT_ENABLED;
  });

  describe('appendAuditLog', () => {
    it('审计未启用时返回 false', () => {
      process.env.SOFA_AUDIT_ENABLED = '';
      expect(appendAuditLog({ operation: 'install', target: 'test', result: 'ok' })).toBe(false);
    });

    it('审计启用时成功写入日志', () => {
      process.env.SOFA_AUDIT_ENABLED = 'true';

      const result = appendAuditLog(
        { operation: 'install', target: 'v0.97', result: '成功' },
        testDir,
      );
      expect(result).toBe(true);

      // 验证文件存在且包含数据
      const month = new Date().toISOString().slice(0, 7);
      const date = new Date().toISOString().slice(0, 10);
      const auditFile = join(testDir, 'task', 'audit', month, `${date}.md`);
      expect(existsSync(auditFile)).toBe(true);

      const content = readFileSync(auditFile, 'utf-8');
      expect(content).toContain('install');
      expect(content).toContain('v0.97');
      expect(content).toContain('成功');
    });

    it('多次追加到同一文件不覆盖', () => {
      process.env.SOFA_AUDIT_ENABLED = 'true';

      appendAuditLog({ operation: 'install', target: '开始', result: 'v0.97' }, testDir);
      appendAuditLog({ operation: 'install', target: '完成', result: '成功' }, testDir);

      const month = new Date().toISOString().slice(0, 7);
      const date = new Date().toISOString().slice(0, 10);
      const auditFile = join(testDir, 'task', 'audit', month, `${date}.md`);
      const content = readFileSync(auditFile, 'utf-8');

      const lines = content.split('\n').filter(l => l.startsWith('|'));
      // Header line + 2 data lines
      expect(lines.length).toBeGreaterThanOrEqual(3);
    });

    it('Markdown | 字符被转义', () => {
      process.env.SOFA_AUDIT_ENABLED = 'true';

      appendAuditLog({ operation: 'test', target: 'a|b', result: 'c|d' }, testDir);

      const month = new Date().toISOString().slice(0, 7);
      const date = new Date().toISOString().slice(0, 10);
      const auditFile = join(testDir, 'task', 'audit', month, `${date}.md`);
      const content = readFileSync(auditFile, 'utf-8');

      // Should have escaped pipes
      expect(content).toContain('a\\|b');
      expect(content).toContain('c\\|d');
    });
  });

  describe('extractLogEntries', () => {
    it('task/logs 不存在时返回空数组', () => {
      expect(extractLogEntries(testDir)).toEqual([]);
    });

    it('成功提取日志条目', () => {
      const logDir = join(testDir, 'task', 'logs', '2026-06');
      mkdirSync(logDir, { recursive: true });

      const logContent = `# 2026-06-28 任务日志

| 字段 | 值 |
|------|------|
| **任务** | 重构用户模块 |
| **状态** | 成功 |
| **耗时** | 45s |
`;
      writeFileSync(join(logDir, '2026-06-28.md'), logContent);

      const entries = extractLogEntries(testDir);
      expect(entries.length).toBe(1);
      expect(entries[0]!.operation).toBe('task-record');
      expect(entries[0]!.target).toBe('重构用户模块');
      expect(entries[0]!.result).toBe('成功');
    });

    it('跳过非 .md 文件', () => {
      const logDir = join(testDir, 'task', 'logs', '2026-06');
      mkdirSync(logDir, { recursive: true });

      writeFileSync(join(logDir, 'test.txt'), 'not a log');
      writeFileSync(join(logDir, '2026-06-28.md'), '# test\n**任务** | 测试\n**状态** | 成功\n');

      const entries = extractLogEntries(testDir);
      // Only .md files should be processed
      expect(entries.every(e => e.result !== 'unknown')).toBe(true);
    });
  });

  describe('syncLogsToAudit', () => {
    it('审计未启用时返回 0', () => {
      process.env.SOFA_AUDIT_ENABLED = '';
      const result = syncLogsToAudit(testDir);
      expect(result.total).toBe(0);
      expect(result.synced).toBe(0);
    });
  });
});
