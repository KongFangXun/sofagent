// ============================================================
// session-report.test.ts · buildSessionReport / writeSessionReport
// v1.1.5 新增（审计结果 session 可见性）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { buildSessionReport, writeSessionReport, type SessionReport } from '../session-report';
import type { AuditResult, RuleCheck } from '../reporter';
import type { DiffFile } from '@sofagent/core';

const tmpDir = join(__dirname, '__sr_tmp__');

function makeResults(rules: RuleCheck[], exitCode?: number): AuditResult {
  const c =
    exitCode ??
    (rules.some((r) => r.status === 'FAIL')
      ? 2
      : rules.some((r) => r.status === 'WARN')
        ? 1
        : 0);
  return { rules, exitCode: c };
}

describe('session-report · buildSessionReport', () => {
  it('case1: 字段正确（status 由 exitCode 推导、counts 正确、violations 含 fix）', () => {
    const diffFiles: DiffFile[] = [{ path: 'src/foo.ts', status: 'modified', lines: [] }];
    const rules: RuleCheck[] = [
      { name: 'A1 不碰敏感', number: 1, status: 'FAIL', details: ['src/foo.ts 不应提交敏感文件'], ruleClass: '业务底线' },
      { name: 'A2 不泄密钥', number: 2, status: 'PASS', details: [] },
      { name: 'A3 不改越界', number: 3, status: 'SKIPPED', details: [] },
    ];
    const report = buildSessionReport(makeResults(rules, 2), diffFiles, { task: 't1', commitSha: 'abc123' });

    expect(report.exitCode).toBe(2);
    expect(report.status).toBe('FAIL');
    expect(report.ruleCount).toBe(3);
    expect(report.failCount).toBe(1);
    expect(report.passCount).toBe(1);
    expect(report.skipCount).toBe(1);
    expect(report.warnCount).toBe(0);
    expect(report.task).toBe('t1');
    expect(report.commitSha).toBe('abc123');
    expect(report.engine).toContain('sofagent-audit v');

    // files: 反查命中 → 该文件状态为 FAIL
    expect(report.files).toHaveLength(1);
    expect(report.files[0].path).toBe('src/foo.ts');
    expect(report.files[0].status).toBe('FAIL');

    // violations: 仅非 PASS 规则（SKIPPED 不计）
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0].rule).toBe('A1 不碰敏感');
    expect(report.violations[0].detail).toContain('src/foo.ts');
    expect(report.violations[0].fix).toContain('.gitignore');
  });

  it('无规则关联文件时 files[].status 降级为 AFFECTED', () => {
    const diffFiles: DiffFile[] = [{ path: 'src/bar.ts', status: 'added', lines: [] }];
    const rules: RuleCheck[] = [{ name: 'A2 不泄密钥', number: 2, status: 'FAIL', details: ['别处发现密钥'] }];
    const report = buildSessionReport(makeResults(rules, 2), diffFiles, {});
    expect(report.files[0].status).toBe('AFFECTED');
  });
});

describe('session-report · writeSessionReport', () => {
  beforeEach(() => {
    try { if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true }); } catch { /* #9 shim 加固 */ }
  });
  afterEach(() => {
    try { if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true }); } catch { /* #9 shim 加固 */ }
  });

  it('case2: 写入 json + md，JSON 可解析、MD 含 [sofagent] 前缀与状态行', () => {
    const diffFiles: DiffFile[] = [{ path: 'src/baz.ts', status: 'modified', lines: [] }];
    const rules: RuleCheck[] = [
      { name: 'A7 不存盲改', number: 7, status: 'WARN', details: ['src/baz.ts 未 Read'], ruleClass: '能力拐杖' },
      { name: 'A2 不泄密钥', number: 2, status: 'PASS', details: [] },
    ];
    const report = buildSessionReport(makeResults(rules, 1), diffFiles, { task: 'warn-task' });
    const { jsonPath, mdPath } = writeSessionReport(report, tmpDir);

    expect(existsSync(jsonPath)).toBe(true);
    expect(existsSync(mdPath)).toBe(true);

    const parsed: SessionReport = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    expect(parsed.status).toBe('WARN');
    expect(parsed.warnCount).toBe(1);

    const md = readFileSync(mdPath, 'utf-8');
    expect(md).toContain('[sofagent]');
    expect(md).toContain('审计');
    expect(md).toContain('WARN');
  });
});
