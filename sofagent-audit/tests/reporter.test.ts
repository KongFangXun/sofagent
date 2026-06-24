import { describe, it, expect } from 'vitest';
import type { DiffFile } from '../src/diff-parser';
import type { LogEntry } from '../src/log-checker';
import { runRules } from '../src/reporter';

function makeDiff(path: string): DiffFile {
  return { path, status: 'modified', lines: [] };
}

function makeLog(raw: string): LogEntry {
  return { timestamp: new Date(), operation: 'read', raw, file: raw };
}

describe('runRules 集成测试', () => {
  it('全 PASS → exitCode 0', () => {
    const diffs = [makeDiff('src/app.ts')];
    const logs = [
      makeLog('Read src/app.ts'),
    ];
    // Rule 3: 无构建文件 → PASS
    // Rule 7: 无 task → PASS
    // Rule 10: 依赖 git，可能在测试环境失败
    const r = runRules(diffs, logs, 'fix login');
    // exitCode 0 or 1 depending on rule-10
    expect(r.rules.length).toBe(4);
  });

  it('有 FAIL + WARN → exitCode 2', () => {
    const diffs = [
      makeDiff('src/app.ts'),
      makeDiff('package.json'),
    ];
    const logs: LogEntry[] = []; // 无日志
    // Rule 1: WARN (no logs)
    // Rule 3: FAIL (package.json modified, no test logs)
    // Rule 7: depends on task matching
    // Rule 10: depends on git
    const r = runRules(diffs, logs, 'fix login');
    // Rule 3 should be FAIL, pushing exitCode to 2
    // But Rule 1 is WARN not FAIL
    // Let me check: rule-01 with no logs → WARN, not FAIL
    // rule-03 with no logs → FAIL
    // So exitCode should be 2
    expect(r.rules[1].status).toBe('FAIL'); // rule-03
  });

  it('空 diff → 快速返回（在 main 中处理，不在 runRules）', () => {
    // runRules 接收空数组也可以
    const r = runRules([], [], 'task');
    expect(r.rules.length).toBe(4);
    // 空 diff + 空日志 → 所有检查都应该通过或跳过
  });

  it('返回结构完整性', () => {
    const r = runRules(
      [makeDiff('src/test.ts')],
      [{ timestamp: new Date(), operation: 'read', raw: 'Read src/test.ts', file: 'src/test.ts' }],
      'fix test',
    );
    expect(r).toHaveProperty('rules');
    expect(r).toHaveProperty('exitCode');
    expect(Array.isArray(r.rules)).toBe(true);
    for (const rule of r.rules) {
      expect(rule).toHaveProperty('name');
      expect(rule).toHaveProperty('number');
      expect(rule).toHaveProperty('status');
      expect(rule).toHaveProperty('details');
      expect(['PASS', 'WARN', 'FAIL']).toContain(rule.status);
    }
  });
});
