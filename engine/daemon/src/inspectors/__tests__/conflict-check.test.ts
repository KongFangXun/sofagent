// ============================================================
// conflict-check.test.ts · 矛盾/孤儿/死链巡检器单元测试
// v1.1.6 新增
//
// 覆盖用例：
//   1. 空 knowledge 目录（子目录存在但无 .md）→ triggered: false
//   2. 只有孤儿 → triggered: true, severity: 'warning'，报告含「孤儿」
//   3. 只有死链 → triggered: true, severity: 'warning'，报告含「死链」
//   4. 只有矛盾 → triggered: true, severity: 'critical'，报告含「矛盾」
//   5. 三类混合 → 报告含全部三类，severity: 'critical'
//   6. knowledge/ 不存在 → triggered: false, severity: 'info'，不抛异常
//   7. 同名 entity 但 frontmatter 缺 domain → 不报矛盾
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { checkConflict } from '../conflict-check';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-conflict-'));
}

/** 在临时项目下创建 knowledge/{entities,...}/ 骨架 */
function makeKnowledgeSkeleton(dir: string): string {
  const knowledgeDir = path.join(dir, '.sofagent', 'knowledge');
  for (const sub of ['entities', 'concepts', 'comparisons', 'summaries']) {
    fs.mkdirSync(path.join(knowledgeDir, sub), { recursive: true });
  }
  return knowledgeDir;
}

/** 写一个 knowledge 页面（带 frontmatter） */
function writePage(
  knowledgeDir: string,
  relPath: string,
  frontmatter: Record<string, string>,
  body: string,
): void {
  const absPath = path.join(knowledgeDir, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const fm = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  const content = fm ? `---\n${fm}\n---\n\n${body}` : body;
  fs.writeFileSync(absPath, content, 'utf-8');
}

/** 写 index.md 目录表 */
function writeIndex(knowledgeDir: string, refs: string[]): void {
  const rows = refs.map((r) => `| ${r} | - | - |`).join('\n');
  const content = `# Knowledge Index\n\n| 页面 | 域 | 备注 |\n|------|----|------|\n${rows}\n`;
  fs.writeFileSync(path.join(knowledgeDir, 'index.md'), content, 'utf-8');
}

describe('conflict-check · knowledge 矛盾/孤儿/死链巡检', () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // 用例 1：空 knowledge 目录 → triggered: false
  it('空 knowledge 目录 → triggered: false, severity: info', () => {
    makeKnowledgeSkeleton(dir);
    const result = checkConflict(dir);
    expect(result.name).toBe('conflict-check');
    expect(result.triggered).toBe(false);
    expect(result.severity).toBe('info');
  });

  // 用例 2：只有孤儿 → warning + 报告含「孤儿」
  it('只有孤儿（文件有、index 没行）→ warning + 含「孤儿」', () => {
    const knowledgeDir = makeKnowledgeSkeleton(dir);
    writePage(knowledgeDir, 'entities/alice.md', { domain: 'user' }, '# Alice');
    writeIndex(knowledgeDir, []); // index.md 不列 alice
    const result = checkConflict(dir);
    expect(result.triggered).toBe(true);
    expect(result.severity).toBe('warning');
    expect(result.message).toContain('孤儿');
    expect(result.message).toContain('entities/alice.md');
  });

  // 用例 3：只有死链 → warning + 报告含「死链」
  it('只有死链（index 列了、文件没）→ warning + 含「死链」', () => {
    const knowledgeDir = makeKnowledgeSkeleton(dir);
    // index 列了一个不存在的页面
    writeIndex(knowledgeDir, ['entities/ghost.md']);
    const result = checkConflict(dir);
    expect(result.triggered).toBe(true);
    expect(result.severity).toBe('warning');
    expect(result.message).toContain('死链');
    expect(result.message).toContain('entities/ghost.md');
  });

  // 用例 4：只有矛盾 → critical + 报告含「矛盾」
  it('同名 entity 多目录 + domain 冲突 → critical + 含「矛盾」', () => {
    const knowledgeDir = makeKnowledgeSkeleton(dir);
    writePage(knowledgeDir, 'entities/alice.md', { domain: 'user' }, '# Alice (user)');
    writePage(knowledgeDir, 'summaries/alice.md', { domain: 'order' }, '# Alice (order)');
    // index 列全 → 无孤儿
    writeIndex(knowledgeDir, ['entities/alice.md', 'summaries/alice.md']);
    const result = checkConflict(dir);
    expect(result.triggered).toBe(true);
    expect(result.severity).toBe('critical');
    expect(result.message).toContain('矛盾');
    expect(result.message).toContain('alice');
  });

  // 用例 5：三类混合 → 报告含全部三类 + severity: critical
  it('矛盾+孤儿+死链混合 → 报告含全部三类 + critical', () => {
    const knowledgeDir = makeKnowledgeSkeleton(dir);
    // 矛盾：alice 在两目录，domain 不同
    writePage(knowledgeDir, 'entities/alice.md', { domain: 'user' }, '# A');
    writePage(knowledgeDir, 'summaries/alice.md', { domain: 'order' }, '# A2');
    // 孤儿：bob 只在文件系统
    writePage(knowledgeDir, 'concepts/bob.md', { domain: 'core' }, '# B');
    // 死链：index 列了不存在的 ghost
    writeIndex(knowledgeDir, ['entities/alice.md', 'summaries/alice.md', 'entities/ghost.md']);
    const result = checkConflict(dir);
    expect(result.triggered).toBe(true);
    expect(result.severity).toBe('critical');
    expect(result.message).toContain('矛盾');
    expect(result.message).toContain('孤儿');
    expect(result.message).toContain('死链');
  });

  // 用例 6：knowledge/ 整个不存在 → info，不抛异常
  it('knowledge/ 不存在 → triggered: false, severity: info，不抛异常', () => {
    // 故意不创建 .sofagent/knowledge
    expect(() => checkConflict(dir)).not.toThrow();
    const result = checkConflict(dir);
    expect(result.triggered).toBe(false);
    expect(result.severity).toBe('info');
  });

  // 用例 7（加分项）：同名 entity 但 frontmatter 缺 domain → 不报矛盾
  it('同名 entity 缺 domain 字段 → 不报矛盾', () => {
    const knowledgeDir = makeKnowledgeSkeleton(dir);
    // 两份 alice，一份有 domain、另一份没有
    writePage(knowledgeDir, 'entities/alice.md', { domain: 'user' }, '# A');
    writePage(knowledgeDir, 'summaries/alice.md', {}, '# A2'); // 无 domain
    writeIndex(knowledgeDir, ['entities/alice.md', 'summaries/alice.md']);
    const result = checkConflict(dir);
    // 不报矛盾 → 不 critical；可能 triggered=false 或仅 warning
    expect(result.severity).not.toBe('critical');
    expect(result.message).not.toContain('矛盾');
  });

  // 用例 8（页面正文死链）：页面 markdown 链接指向不存在页面 → 死链
  it('页面正文 markdown 链接指向不存在页面 → 死链', () => {
    const knowledgeDir = makeKnowledgeSkeleton(dir);
    writePage(
      knowledgeDir,
      'entities/alice.md',
      { domain: 'user' },
      '# Alice\n\n详见 [Bob](../concepts/bob.md)。',
    );
    writeIndex(knowledgeDir, ['entities/alice.md']);
    const result = checkConflict(dir);
    expect(result.triggered).toBe(true);
    expect(result.message).toContain('死链');
    expect(result.message).toContain('bob.md');
  });
});
