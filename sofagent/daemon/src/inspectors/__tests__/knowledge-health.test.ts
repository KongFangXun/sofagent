// ============================================================
// knowledge-health.test.ts · knowledge 健康巡检器单元测试
// v1.1.6 新增
//
// 覆盖用例（≥8，镜像 conflict-check）：
//   1. knowledge/ 不存在 → triggered: false, severity: 'info'，不抛异常
//   2. 4 子目录空（真实仓库当前态）→ triggered: false，不误报
//   3. 只有孤立页（无入边）→ triggered: true, severity: 'warning'，含「孤立」
//   4. 只有重复页（normalized key 碰撞）→ triggered: true，detail 含 (detection=normalized-key)
//   5. 只有断裂链接（wikilink 目标不存在）→ triggered: true，含「断链」
//   6. index 过旧（mtime 早于源 >24h）→ triggered: true，含「index 过旧」
//   7. 缺源（concept 无 source:）→ triggered: true，含「缺源」
//   8. 五项混合 → 报告含全部五类
//   9. 健康知识库（互链 + source 齐全 + index 新鲜）→ triggered: false
//  10. health-report.md 追加生成（LUI A 可感知产物）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { checkKnowledgeHealth } from '../knowledge-health';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-kh-'));
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

/** 把文件 mtime 改成指定时间（index 过旧测试用） */
function setMtime(absPath: string, date: Date): void {
  fs.utimesSync(absPath, date, date);
}

describe('knowledge-health · knowledge 健康巡检', () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // 用例 1：knowledge/ 整个不存在 → info，不抛异常
  it('knowledge/ 不存在 → triggered: false, severity: info，不抛异常', () => {
    expect(() => checkKnowledgeHealth(dir)).not.toThrow();
    const result = checkKnowledgeHealth(dir);
    expect(result.name).toBe('knowledge-health');
    expect(result.triggered).toBe(false);
    expect(result.severity).toBe('info');
  });

  // 用例 2：4 子目录空（真实仓库当前态）→ triggered: false，不误报
  it('4 子目录空 + index.md/log.md 有框架（真实仓库态）→ triggered: false，不误报', () => {
    const knowledgeDir = makeKnowledgeSkeleton(dir);
    // 复刻真实仓库：index.md/log.md 有框架但无页面
    fs.writeFileSync(
      path.join(knowledgeDir, 'index.md'),
      '# 知识库目录\n\n| 页面 | 域 | 可访问节点 |\n|------|-----|------------|\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(knowledgeDir, 'log.md'),
      '# 知识库操作日志\n\n| 时间 | 操作 | 影响页面 | 详情 |\n|------|------|---------|------|\n',
      'utf-8',
    );
    const result = checkKnowledgeHealth(dir);
    expect(result.triggered).toBe(false);
    expect(result.severity).toBe('info');
  });

  // 用例 3：只有孤立页 → warning + 含「孤立」
  it('只有孤立页（无入边）→ triggered: true, severity: warning，含「孤立」', () => {
    const knowledgeDir = makeKnowledgeSkeleton(dir);
    writePage(knowledgeDir, 'entities/alice.md', { source: 'dream-cycle:x' }, '# Alice');
    writePage(knowledgeDir, 'entities/bob.md', { source: 'dream-cycle:x' }, '# Bob');
    // 两页互不相链，也无 index 引用 → 都孤立
    const result = checkKnowledgeHealth(dir);
    expect(result.triggered).toBe(true);
    expect(result.severity).toBe('warning');
    expect(result.message).toContain('孤立');
  });

  // 用例 4：重复页（normalized key 碰撞）→ 含 (detection=normalized-key)
  it('重复页（normalized key 碰撞）→ triggered: true，detail 标注 (detection=normalized-key)', () => {
    const knowledgeDir = makeKnowledgeSkeleton(dir);
    // user-profile / UserProfile / user_profile → normalized key 都是 userprofile
    writePage(knowledgeDir, 'entities/user-profile.md', { source: 'x' }, '# A 引用 [[user-profile]]');
    writePage(knowledgeDir, 'entities/UserProfile.md', { source: 'x' }, '# B');
    writePage(knowledgeDir, 'concepts/user_profile.md', { source: 'x' }, '# C');
    const result = checkKnowledgeHealth(dir);
    expect(result.triggered).toBe(true);
    expect(result.message).toContain('重复');
    expect(result.message).toContain('(detection=normalized-key');
  });

  // 用例 5：断裂链接（wikilink 目标不存在）→ 含「断链」
  it('断裂链接（wikilink 目标不存在）→ triggered: true，含「断链」', () => {
    const knowledgeDir = makeKnowledgeSkeleton(dir);
    writePage(
      knowledgeDir,
      'entities/alice.md',
      { source: 'x' },
      '# Alice\n\n详见 [[ghost-page]] 和 [Bob](../concepts/bob.md)。',
    );
    // alice 引用不存在的 ghost-page 和 bob → 断链；alice 自身有出边但无入边（也孤立）
    const result = checkKnowledgeHealth(dir);
    expect(result.triggered).toBe(true);
    expect(result.message).toContain('断链');
    expect(result.message).toContain('ghost-page');
  });

  // 用例 6：index 过旧（mtime 早于源 >24h）→ 含「index 过旧」
  it('index 过旧（mtime 早于最新源 >24h）→ triggered: true，含「index 过旧」', () => {
    const knowledgeDir = makeKnowledgeSkeleton(dir);
    writePage(knowledgeDir, 'entities/alice.md', { source: 'x' }, '# Alice 引用 [[alice]]');
    const indexPath = path.join(knowledgeDir, 'index.md');
    fs.writeFileSync(indexPath, '# Index\n\n| 页面 | 域 |\n|------|----|\n| entities/alice.md | - |\n', 'utf-8');
    // index.md mtime 改成 3 天前（远早于 alice.md 的现在）
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    setMtime(indexPath, threeDaysAgo);
    const result = checkKnowledgeHealth(dir);
    expect(result.triggered).toBe(true);
    expect(result.message).toContain('index 过旧');
  });

  // 用例 7：缺源（concept 无 source:）→ 含「缺源」
  it('缺源（concept 无 source: frontmatter）→ triggered: true，含「缺源」', () => {
    const knowledgeDir = makeKnowledgeSkeleton(dir);
    writePage(knowledgeDir, 'concepts/orphan-concept.md', {}, '# 无 source 的 concept，引用 [[orphan-concept]]');
    const result = checkKnowledgeHealth(dir);
    expect(result.triggered).toBe(true);
    expect(result.message).toContain('缺源');
    expect(result.message).toContain('concepts/orphan-concept.md');
  });

  // 用例 8：五项混合 → 报告含全部五类
  it('五项混合 → 报告含全部五类', () => {
    const knowledgeDir = makeKnowledgeSkeleton(dir);
    // 孤立：isolated.md 无入边
    writePage(knowledgeDir, 'entities/isolated.md', { source: 'x' }, '# Isolated');
    // 重复：dup-page / dup_page 碰撞（且互链避免孤立干扰判断）
    writePage(knowledgeDir, 'entities/dup-page.md', { source: 'x' }, '# A [[dup_page]]');
    writePage(knowledgeDir, 'concepts/dup_page.md', { source: 'x' }, '# B [[dup-page]]');
    // 断链：broken.md → [[nonexistent]]
    writePage(knowledgeDir, 'entities/broken.md', { source: 'x' }, '# Broken [[nonexistent]]');
    // 缺源：no-source concept
    writePage(knowledgeDir, 'concepts/no-source.md', {}, '# No source [[no-source]]');
    // index 过旧
    const indexPath = path.join(knowledgeDir, 'index.md');
    fs.writeFileSync(indexPath, '# Index\n', 'utf-8');
    setMtime(indexPath, new Date(Date.now() - 3 * 24 * 60 * 60 * 1000));
    const result = checkKnowledgeHealth(dir);
    expect(result.triggered).toBe(true);
    expect(result.message).toContain('孤立');
    expect(result.message).toContain('重复');
    expect(result.message).toContain('断链');
    expect(result.message).toContain('index 过旧');
    expect(result.message).toContain('缺源');
  });

  // 用例 9：健康知识库（互链 + source 齐全 + index 新鲜）→ triggered: false
  it('健康知识库（互链 + source 齐全 + index 新鲜）→ triggered: false', () => {
    const knowledgeDir = makeKnowledgeSkeleton(dir);
    writePage(knowledgeDir, 'entities/alice.md', { source: 'x' }, '# Alice [[bob]]');
    writePage(knowledgeDir, 'concepts/bob.md', { source: 'x' }, '# Bob [[alice]]');
    // index.md 引用两页且 mtime 新鲜（刚写）
    fs.writeFileSync(
      path.join(knowledgeDir, 'index.md'),
      '# Index\n\n| 页面 | 域 |\n|------|----|\n| entities/alice.md | - |\n| concepts/bob.md | - |\n',
      'utf-8',
    );
    const result = checkKnowledgeHealth(dir);
    expect(result.triggered).toBe(false);
    expect(result.severity).toBe('info');
  });

  // 用例 10：health-report.md 追加生成（LUI A 可感知产物）
  it('triggered 时追加 knowledge/health-report.md（LUI A 可感知产物）', () => {
    const knowledgeDir = makeKnowledgeSkeleton(dir);
    writePage(knowledgeDir, 'entities/lonely.md', { source: 'x' }, '# Lonely 孤立页');
    const result = checkKnowledgeHealth(dir);
    expect(result.triggered).toBe(true);
    const reportPath = path.join(knowledgeDir, 'health-report.md');
    expect(fs.existsSync(reportPath)).toBe(true);
    const reportContent = fs.readFileSync(reportPath, 'utf-8');
    expect(reportContent).toContain('knowledge-health 巡检');
    expect(reportContent).toContain('孤立');
    // 源数据未被改动（fail-closed 只读）
    const sourceContent = fs.readFileSync(path.join(knowledgeDir, 'entities', 'lonely.md'), 'utf-8');
    expect(sourceContent).toContain('# Lonely 孤立页');
  });
});
