import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { extractLessons } from '../lessons-extract';

describe('experience sharing 端到端', () => {
  it('设备 A 踩坑 → 提取 lessons → 设备 B 可读', () => {
    const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-devA-'));
    fs.mkdirSync(path.join(dirA, '.sofagent'), { recursive: true });
    fs.writeFileSync(
      path.join(dirA, '.sofagent', 'think.md'),
      '## 教训：不要用 rm -rf\n原因：删了整个项目\n## 其他\n无关\n',
    );

    const result = extractLessons(dirA);
    expect(result.extracted).toBe(1);
    expect(result.target).toContain('lessons-');
    expect(fs.existsSync(result.target)).toBe(true);

    // 设备 B 读 shared knowledge
    const sharedDir = path.join(dirA, '.sofagent', 'knowledge', 'shared');
    const files = fs.readdirSync(sharedDir).filter((f) => f.startsWith('lessons-'));
    expect(files.length).toBeGreaterThanOrEqual(1);
    const content = fs.readFileSync(path.join(sharedDir, files[0]!), 'utf-8');
    expect(content).toContain('不要用 rm -rf');

    fs.rmSync(dirA, { recursive: true, force: true });
  });
});
