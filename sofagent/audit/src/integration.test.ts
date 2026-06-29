// ============================================================
// integration.test.ts · 集成测试——fixture 驱动
// 测试 diff-parser 名称状态解析 + A1 敏感文件规则
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { checkRuleA1 } from './rules/rule-a1-sensitive-files';
import type { DiffFile } from './diff-parser';
import type { AuditContext } from './rules/types';

/** 从 fixture 文件解析 --name-status 格式为 DiffFile[]（不含 diff 内容行） */
function parseNameStatusFixture(fixturePath: string): DiffFile[] {
  const content = readFileSync(fixturePath, 'utf-8');
  const lines = content.trim().split('\n').filter(Boolean);
  const files: DiffFile[] = [];

  for (const line of lines) {
    const parts = line.split('\t');
    const statusCode = parts[0];
    if (!statusCode) continue;

    let status: DiffFile['status'] = 'modified';
    let path: string;
    let oldPath: string | undefined;

    if (statusCode.startsWith('R')) {
      status = 'renamed';
      const p1 = parts[1];
      const p2 = parts[2];
      if (!p1 || !p2) continue;
      oldPath = p1;
      path = p2;
    } else if (statusCode === 'A') {
      status = 'added';
      const p = parts[1];
      if (!p) continue;
      path = p;
    } else if (statusCode === 'D') {
      status = 'deleted';
      const p = parts[1];
      if (!p) continue;
      path = p;
    } else {
      const p = parts[1];
      if (!p) continue;
      path = p;
    }

    if (path) {
      files.push({ path, status, oldPath, lines: [] });
    }
  }

  return files;
}

function makeCtxFromFiles(diffFiles: DiffFile[]): AuditContext {
  return { diffFiles, logEntries: [] };
}

const FIXTURES_DIR = join(__dirname, '..', 'test-fixtures');

describe('集成测试', () => {
  it('add-mod-del fixture → 解析文件状态正确', () => {
    const files = parseNameStatusFixture(join(FIXTURES_DIR, 'add-mod-del.fixture'));
    expect(files).toHaveLength(5);

    const added = files.filter((f) => f.status === 'added');
    const modified = files.filter((f) => f.status === 'modified');
    const deleted = files.filter((f) => f.status === 'deleted');

    expect(added).toHaveLength(2);
    expect(modified).toHaveLength(2);
    expect(deleted).toHaveLength(1);
    expect(added.map((f) => f.path)).toContain('src/new-file.ts');
    expect(added.map((f) => f.path)).toContain('src/another-new.ts');
    expect(deleted.map((f) => f.path)).toContain('src/old-file.ts');
  });

  it('rename fixture → 解析重命名状态正确', () => {
    const files = parseNameStatusFixture(join(FIXTURES_DIR, 'rename.fixture'));
    expect(files).toHaveLength(3);

    const renamed = files.filter((f) => f.status === 'renamed');
    expect(renamed).toHaveLength(2);

    const r1 = renamed.find((f) => f.path === 'src/new-name.ts');
    expect(r1).toBeDefined();
    expect(r1!.oldPath).toBe('src/old-name.ts');

    const r2 = renamed.find((f) => f.path === 'src/components/NewButton.tsx');
    expect(r2).toBeDefined();
    expect(r2!.oldPath).toBe('src/components/OldButton.tsx');
  });

  it('sensitive-env fixture → A1 检测敏感文件变更', () => {
    const files = parseNameStatusFixture(join(FIXTURES_DIR, 'sensitive-env.fixture'));
    expect(files).toHaveLength(6);

    // A1 应该检测到 .env、.env.local、credentials.json、server.pem
    const result = checkRuleA1(makeCtxFromFiles(files));
    expect(result.status).toBe('FAIL');
    expect(result.details[0]).toContain('.env');
    expect(result.details[0]).toContain('.env.local');
    expect(result.details[0]).toContain('credentials.json');
    expect(result.details[0]).toContain('server.pem');
  });
});
