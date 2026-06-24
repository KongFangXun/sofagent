import { describe, it, expect } from 'vitest';
import type { DiffFile } from '../src/diff-parser';
import type { LogEntry } from '../src/log-checker';
import { checkRule03 } from '../src/rules/rule-03-verify-before-continue';

function makeDiff(path: string, status: DiffFile['status'] = 'modified'): DiffFile {
  return { path, status, lines: [] };
}

function makeLog(raw: string, operation = 'execute'): LogEntry {
  return { timestamp: new Date(), operation, raw };
}

describe('铁律 #3 验证再干', () => {
  it('无构建文件变更 → PASS', () => {
    const r = checkRule03([makeDiff('src/app.ts'), makeDiff('README.md')], []);
    expect(r.status).toBe('PASS');
    expect(r.details).toEqual([]);
  });

  it('修改 package.json 且有 npm test 记录 → PASS', () => {
    const logs = [makeLog('npm test')];
    const r = checkRule03([makeDiff('package.json')], logs);
    expect(r.status).toBe('PASS');
  });

  it('修改 package.json 无 test/build 记录 → FAIL', () => {
    const r = checkRule03([makeDiff('package.json')], []);
    expect(r.status).toBe('FAIL');
    expect(r.details[0]).toContain('package.json');
  });

  it('修改 tsconfig.json + yarn build → PASS', () => {
    // tsconfig.json is not in BUILD_FILES list... let me check
    // BUILD_FILES includes: package.json, package-lock.json, yarn.lock, pnpm-lock.yaml,
    // build.gradle, build.gradle.kts, Cargo.toml, Cargo.lock, requirements.txt,
    // Pipfile, pyproject.toml, go.mod, go.sum, Gemfile, composer.json
    // tsconfig.json is NOT in the list. So this test case doesn't apply.
    // Let me use a file that IS in the list.
    const logs = [makeLog('yarn build')];
    const r = checkRule03([makeDiff('Cargo.toml')], logs);
    expect(r.status).toBe('PASS');
  });

  it('多个构建文件变更但无记录 → FAIL', () => {
    const r = checkRule03(
      [makeDiff('package.json'), makeDiff('go.mod')],
      [],
    );
    expect(r.status).toBe('FAIL');
    expect(r.details[0]).toContain('package.json');
    expect(r.details[0]).toContain('go.mod');
  });

  it('有日志但无 test/build 命令 → FAIL', () => {
    const logs = [makeLog('git status', 'execute')];
    const r = checkRule03([makeDiff('package.json')], logs);
    expect(r.status).toBe('FAIL');
  });
});
