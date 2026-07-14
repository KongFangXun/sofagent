import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { extractLessons } from '../lessons-extract';

describe('extractLessons', () => {
  it('无 think.md 返回 0', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-test-'));
    fs.mkdirSync(path.join(tmpDir, '.sofagent'), { recursive: true });
    const result = extractLessons(tmpDir);
    expect(result.extracted).toBe(0);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('有 think.md 含教训段落返回正确', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-test-'));
    fs.mkdirSync(path.join(tmpDir, '.sofagent'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.sofagent', 'think.md'), '## 教训：不要用 rm -rf\n## 其他\n无关内容\n');
    const result = extractLessons(tmpDir);
    expect(result.extracted).toBe(1);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
