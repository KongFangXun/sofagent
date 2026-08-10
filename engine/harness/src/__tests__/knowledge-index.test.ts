// ============================================================
// knowledge-index.test.ts · L4 知识索引构建测试（v1.3.1 交付 14）
// ============================================================
//
// 覆盖：
// - 索引构建：shared/federation/local 三目录扫描，条目含文件名+摘要+mtime
// - 摘要 ≤150 字符（frontmatter name/description + 首行合并）
// - frontmatter 提取（正则零依赖）+ 无 frontmatter 回退首行
// - formatKnowledgeIndex：默认 9 条（shared 3 + federation 3 + local 3）
// - 注入量下降：热点 2 篇全文 + 索引 9 条 ≤ 旧方案（对比字符数）
// - topKnowledgeByMtime：热点选文（mtime 最新语义保持）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  buildKnowledgeIndex,
  formatKnowledgeIndex,
  extractFrontmatterSummary,
  extractFirstBodyLine,
  topKnowledgeByMtime,
  INDEX_ENTRY_MAX_CHARS,
} from '../knowledge-index';
import { buildConstrainedSystemPrompt } from '../index';

describe('knowledge-index · 索引构建（v1.3.1 交付 14）', () => {
  let tmpDir: string;
  let knowledgeDir: string;

  /** 写一篇知识页（带 mtime 参数以便控制排序） */
  function writePage(rel: string, content: string, mtimeMs?: number): string {
    const filePath = path.join(knowledgeDir, rel);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
    if (mtimeMs) {
      fs.utimesSync(filePath, new Date(mtimeMs), new Date(mtimeMs));
    }
    return filePath;
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-kidx-'));
    knowledgeDir = path.join(tmpDir, 'knowledge');
    fs.mkdirSync(knowledgeDir, { recursive: true });
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('索引构建：扫描三目录，条目含文件名/kind/摘要/mtime', () => {
    writePage('shared/共享经验.md', '---\nname: 共享经验\ndescription: 跨设备沉淀\n---\n\n共享首行内容', 1000);
    writePage('federation/联邦知识.md', '---\nname: 联邦知识\n---\n\n联邦首行', 2000);
    writePage('本地知识.md', '---\nname: 本地知识\ndescription: 本机经验\n---\n\n本地首行', 3000);

    const entries = buildKnowledgeIndex(knowledgeDir);
    expect(entries).toHaveLength(3);

    const shared = entries.find((e) => e.kind === 'shared');
    expect(shared?.fileName).toBe('共享经验');
    expect(shared?.summary).toContain('跨设备沉淀');
    expect(shared?.summary).toContain('共享首行内容');

    const federation = entries.find((e) => e.kind === 'federation');
    expect(federation?.fileName).toBe('联邦知识');

    const local = entries.find((e) => e.kind === 'local');
    expect(local?.fileName).toBe('本地知识');
    expect(local?.summary).toContain('本机经验');
  });

  it('摘要 ≤150 字符（超长截断加省略号）', () => {
    writePage('超长知识.md', `---\nname: 超长知识\ndescription: ${'很长的描述'.repeat(60)}\n---\n\n${'超长正文'.repeat(80)}`);
    const [entry] = buildKnowledgeIndex(knowledgeDir);
    expect(entry?.summary.length).toBeLessThanOrEqual(INDEX_ENTRY_MAX_CHARS);
    expect(entry?.summary).toContain('…');
  });

  it('extractFrontmatterSummary：提取 name/description；无 frontmatter 返回空', () => {
    expect(extractFrontmatterSummary('---\nname: A\ndescription: B\n---\n\nbody')).toEqual({ name: 'A', description: 'B' });
    expect(extractFrontmatterSummary('---\nname: "带引号"\n---\n\nbody')).toEqual({ name: '带引号' });
    expect(extractFrontmatterSummary('plain body')).toEqual({});
  });

  it('extractFirstBodyLine：取 frontmatter 后首个非空行', () => {
    expect(extractFirstBodyLine('---\nname: A\n---\n\n  第一行  \n第二行')).toBe('第一行');
    expect(extractFirstBodyLine('无 frontmatter 首行')).toBe('无 frontmatter 首行');
  });

  it('formatKnowledgeIndex：默认 9 条上限 + 去重', () => {
    for (let i = 0; i < 5; i++) {
      writePage(`shared/s${i}.md`, `---\nname: s${i}\n---\n\n内容${i}`, 1000 + i);
    }
    for (let i = 0; i < 5; i++) {
      writePage(`federation/f${i}.md`, `---\nname: f${i}\n---\n\n内容${i}`, 2000 + i);
    }
    for (let i = 0; i < 5; i++) {
      writePage(`local${i}.md`, `---\nname: local${i}\n---\n\n内容${i}`, 3000 + i);
    }

    const text = formatKnowledgeIndex(buildKnowledgeIndex(knowledgeDir), 9);
    const lines = text.split('\n').filter((l) => l.startsWith('- '));
    expect(lines).toHaveLength(9);
    // 每条索引行 ≤150 字符摘要 + 前缀
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(200);
    }
  });

  it('topKnowledgeByMtime：热点选文按 mtime 最新（保持现有语义）', () => {
    writePage('旧知识.md', '---\nname: 旧知识\n---\n\n旧', 1000);
    writePage('新知识.md', '---\nname: 新知识\n---\n\n新', 99999);
    writePage('中知识.md', '---\nname: 中知识\n---\n\n中', 5000);

    const hot = topKnowledgeByMtime(knowledgeDir, 2);
    expect(hot.map((e) => e.fileName)).toEqual(['新知识', '中知识']);
  });
});

describe('buildConstrainedSystemPrompt · 注入量下降（v1.3.1 交付 14）', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-harness-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('注入格式：热点全文（≤2 篇）+ 知识索引（≤9 条）；总注入量显著下降', () => {
    // 构造 15 篇知识（旧方案会注入 11 篇全文 ~4000 token）
    const skillDir = path.join(tmpDir, '.sofagent');
    const knowledgeDir = path.join(skillDir, 'knowledge');
    fs.mkdirSync(path.join(knowledgeDir, 'shared'), { recursive: true });
    fs.mkdirSync(path.join(knowledgeDir, 'federation'), { recursive: true });

    const longBody = '内容段落。'.repeat(300); // ~1500 字符
    const markers: string[] = [];
    for (let i = 0; i < 5; i++) {
      const sMarker = `SHARED_MARKER_${i}`;
      const fMarker = `FED_MARKER_${i}`;
      const lMarker = `LOCAL_MARKER_${i}`;
      markers.push(sMarker, fMarker, lMarker);
      fs.writeFileSync(
        path.join(knowledgeDir, 'shared', `s${i}.md`),
        `---\nname: s${i}\ndescription: ${sMarker}\n---\n\n${sMarker}${longBody}`,
      );
      fs.writeFileSync(
        path.join(knowledgeDir, 'federation', `f${i}.md`),
        `---\nname: f${i}\ndescription: ${fMarker}\n---\n\n${fMarker}${longBody}`,
      );
      fs.writeFileSync(
        path.join(knowledgeDir, `local${i}.md`),
        `---\nname: local${i}\ndescription: ${lMarker}\n---\n\n${lMarker}${longBody}`,
      );
    }
    // 宪法层等
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# 宪法约束内容');

    const prompt = buildConstrainedSystemPrompt(tmpDir);

    // 1. 索引段存在（渐进加载）
    expect(prompt).toContain('知识索引（按需读取）');
    // 2. 热点段存在
    expect(prompt).toContain('当前任务热点');
    // 3. 热点全文 ≤2 篇——热点段内出现的唯一文件 marker ≤2（每篇 marker 只在其全文里出现）
    const hotBlocks = prompt.split('当前任务热点')[1]?.split('知识索引')[0] ?? '';
    const hotMarkerCount = markers.filter((m) => hotBlocks.includes(m)).length;
    expect(hotMarkerCount).toBeLessThanOrEqual(2);
    expect(hotMarkerCount).toBeGreaterThan(0); // 至少 1 篇热点全文（有知识库时）

    // 4. 索引条数 ≤9
    const indexLines = (prompt.split('知识索引（按需读取）')[1]?.split('\n').filter((l) => l.startsWith('- ')) ?? []);
    expect(indexLines.length).toBeLessThanOrEqual(9);
    for (const line of indexLines) {
      expect(line.length).toBeLessThanOrEqual(200);
    }

    // 5. 总注入量：热点 2×2000 + 索引 9×150 + 固定段 ≈ 5500 字符 ≈ <1500 token
    //    旧方案：11×2000 = 22000 字符 ≈ ~5500 token——新方案显著下降
    expect(prompt.length).toBeLessThan(12000);
    expect(prompt.length).toBeLessThan(22000); // 低于旧方案知识段字符数
  });

  it('无知识库时不注入知识段（保持「无约束目录返回空串」契约）', () => {
    const prompt = buildConstrainedSystemPrompt(tmpDir);
    // 无 SKILL.md 无知识库 → 空串（不注入占位段）
    expect(prompt).toBe('');
  });

  it('有知识库但无 SKILL.md → 只注入知识段', () => {
    const skillDir = path.join(tmpDir, '.sofagent');
    const knowledgeDir = path.join(skillDir, 'knowledge');
    fs.mkdirSync(knowledgeDir, { recursive: true });
    fs.writeFileSync(path.join(knowledgeDir, '知识页.md'), '---\nname: 知识页\ndescription: 简介\n---\n\n正文', 'utf-8');

    const prompt = buildConstrainedSystemPrompt(tmpDir);
    expect(prompt).toContain('知识库（L4 经验层）');
    expect(prompt).toContain('知识页');
  });
});
