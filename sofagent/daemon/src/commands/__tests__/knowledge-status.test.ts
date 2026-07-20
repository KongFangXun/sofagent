// ============================================================
// knowledge-status.test.ts · knowledge status 聚合命令测试
// v1.1.6 新增
//
// 覆盖用例（共 5 case，门禁 ≥4）：
//   1. 空知识库 → lastDreamCycle undefined、health.triggered false、sensitivity 全 0
//   2. 有 knowledge/log.md → lastDreamCycle 正确解析（时间 + 计数）
//   3. 有 knowledge/health-report.md → health 字段正确填充
//   4. sensitivity 统计正确（public/internal/restricted 各计数）
//   5. restricted 不泄露：返回计数，格式化输出不含 restricted 条目内容
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { knowledgeStatus, formatKnowledgeStatus } from '../knowledge-status';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-ks-'));
}

function makeKnowledgeSkeleton(dir: string): string {
  const knowledgeDir = path.join(dir, '.sofagent', 'knowledge');
  for (const sub of ['entities', 'concepts', 'comparisons', 'summaries']) {
    fs.mkdirSync(path.join(knowledgeDir, sub), { recursive: true });
  }
  return knowledgeDir;
}

function writePage(
  knowledgeDir: string,
  relPath: string,
  frontmatter: Record<string, string>,
  body: string,
): void {
  const absPath = path.join(knowledgeDir, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const fm = Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`).join('\n');
  const content = fm ? `---\n${fm}\n---\n\n${body}` : body;
  fs.writeFileSync(absPath, content, 'utf-8');
}

describe('knowledgeStatus · 聚合命令', () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpDir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // 用例 1：空知识库 → 优雅降级
  it('空知识库 → lastDreamCycle undefined、health.triggered false、sensitivity 全 0，不抛异常', () => {
    expect(() => knowledgeStatus(dir)).not.toThrow();
    const report = knowledgeStatus(dir);
    expect(report.lastDreamCycle).toBeUndefined();
    expect(report.health.triggered).toBe(false);
    expect(report.health.findings).toBe(0);
    expect(report.sensitivity).toEqual({ public: 0, internal: 0, restricted: 0 });
  });

  // 用例 2：log.md → lastDreamCycle 正确解析
  it('有 knowledge/log.md 周报 → lastDreamCycle 正确解析（时间 + 计数）', () => {
    const knowledgeDir = makeKnowledgeSkeleton(dir);
    fs.writeFileSync(
      path.join(knowledgeDir, 'log.md'),
      '# 知识库操作日志\n\n' +
        '## 2026-07-13 Dream Cycle 周报\n\n本周学 5 个 concept / 3 个 atom，来自 7 条 audit history。\n\n' +
        '## 2026-07-20 Dream Cycle 周报\n\n本周学 12 个 concept / 8 个 atom，来自 8 条 audit history。\n',
      'utf-8',
    );
    const report = knowledgeStatus(dir);
    expect(report.lastDreamCycle).toBeDefined();
    // 取最近一段（2026-07-20）
    expect(report.lastDreamCycle!.at).toBe('2026-07-20');
    expect(report.lastDreamCycle!.concepts).toBe(12);
    expect(report.lastDreamCycle!.atoms).toBe(8);
    expect(report.lastDreamCycle!.auditEntries).toBe(8);
  });

  // 用例 3：health-report.md → health 字段正确填充
  it('有 knowledge/health-report.md → health 字段正确填充', () => {
    const knowledgeDir = makeKnowledgeSkeleton(dir);
    fs.writeFileSync(
      path.join(knowledgeDir, 'health-report.md'),
      '\n## 2026-07-20T01:00:00.000Z knowledge-health 巡检\n\n' +
        '- 孤立页 3 项：a.md, b.md, c.md\n' +
        '- 断裂链接 1 项：x.md → [[ghost]]\n' +
        '- （只建议不自动删——fail-closed 只读，修复留给 Agent + 人）\n',
      'utf-8',
    );
    const report = knowledgeStatus(dir);
    expect(report.health.triggered).toBe(true);
    expect(report.health.findings).toBe(2);
    expect(report.health.severity).toBe('warning');
  });

  // 用例 4：sensitivity 统计正确
  it('sensitivity 统计正确（public/internal/restricted 各计数，缺省按 internal）', () => {
    const knowledgeDir = makeKnowledgeSkeleton(dir);
    writePage(knowledgeDir, 'entities/pub.md', { sensitivity: 'public' }, '# 公开');
    writePage(knowledgeDir, 'entities/int1.md', { sensitivity: 'internal' }, '# 内部1');
    writePage(knowledgeDir, 'concepts/int2.md', {}, '# 缺省 → internal'); // 无 sensitivity
    writePage(knowledgeDir, 'concepts/secret.md', { sensitivity: 'restricted' }, '# 受限');
    const report = knowledgeStatus(dir);
    expect(report.sensitivity.public).toBe(1);
    expect(report.sensitivity.internal).toBe(2); // int1 + 缺省的 int2
    expect(report.sensitivity.restricted).toBe(1);
  });

  // 用例 5：restricted 不泄露（返回计数，格式化输出不含内容）
  it('restricted 只计数不返回内容（格式化输出不含 restricted 条目正文）', () => {
    const knowledgeDir = makeKnowledgeSkeleton(dir);
    writePage(
      knowledgeDir,
      'concepts/top-secret.md',
      { sensitivity: 'restricted' },
      '# 绝密内容-绝不泄露-NEVER-LEAK',
    );
    writePage(knowledgeDir, 'entities/ok.md', { sensitivity: 'public' }, '# 正常');
    const report = knowledgeStatus(dir);
    expect(report.sensitivity.restricted).toBe(1);
    // 报告结构里不含 restricted 条目内容（只有计数）
    const formatted = formatKnowledgeStatus(report);
    expect(formatted).toContain('restricted=1');
    expect(formatted).not.toContain('绝密内容-绝不泄露-NEVER-LEAK');
    expect(formatted).not.toContain('top-secret');
  });
});
