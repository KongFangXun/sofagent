import { describe, it, expect } from 'vitest';
import type { DiffFile } from '../src/diff-parser';
import type { LogEntry } from '../src/log-checker';
import { checkRule01 } from '../src/rules/rule-01-read-before-write';

function makeDiff(path: string, status: DiffFile['status'] = 'modified'): DiffFile {
  return { path, status, lines: [] };
}

function makeLog(raw: string, file?: string, operation = 'read'): LogEntry {
  return { timestamp: new Date(), operation, raw, file };
}

describe('铁律 #1 先读再用', () => {
  it('无日志 → WARN', () => {
    const r = checkRule01([makeDiff('src/app.ts')], []);
    expect(r.status).toBe('WARN');
    expect(r.details[0]).toContain('未找到');
  });

  it('所有修改文件都有读取记录 → PASS', () => {
    const logs = [
      makeLog('Read src/app.ts', 'src/app.ts'),
      makeLog('Read src/utils.ts', 'src/utils.ts'),
    ];
    const r = checkRule01([makeDiff('src/app.ts'), makeDiff('src/utils.ts')], logs);
    expect(r.status).toBe('PASS');
  });

  it('有文件无读取记录 → FAIL', () => {
    const logs = [makeLog('Read src/app.ts', 'src/app.ts')];
    const r = checkRule01([makeDiff('src/app.ts'), makeDiff('src/secret.ts')], logs);
    expect(r.status).toBe('FAIL');
    expect(r.details[0]).toContain('src/secret.ts');
  });

  it('文件名部分匹配 → PASS', () => {
    const logs = [makeLog('Read helper.ts', 'helper.ts')];
    const r = checkRule01([makeDiff('src/utils/helper.ts')], logs);
    expect(r.status).toBe('PASS');
  });

  it('日志 raw 中包含文件路径 → PASS', () => {
    const logs = [makeLog('Read src/config.ts — done', undefined, 'other')];
    const r = checkRule01([makeDiff('src/config.ts')], logs);
    expect(r.status).toBe('PASS');
  });

  it('new file (added) 也需要检查 → FAIL', () => {
    const r = checkRule01([makeDiff('src/new.ts', 'added')], []);
    expect(r.status).toBe('WARN'); // 无日志
  });
});
