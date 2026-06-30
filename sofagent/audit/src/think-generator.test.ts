// ============================================================
// think-generator.test.ts · think.md 自动生成测试
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { generateThinkEntry, _resetThinkCache } from './think-generator';
import type { DiffFile } from './diff-parser';
import type { AuditResult } from './reporter';
import type { RuleCheck } from './rules/types';

let tempDir: string;
const fixedTime = new Date('2026-06-30T18:00:00');

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'sofagent-think-test-'));
  _resetThinkCache();
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  _resetThinkCache();
});

function makeDiffFile(path: string): DiffFile {
  return { path, status: 'modified', lines: ['+some line'] };
}

function makeResult(rules: RuleCheck[] = [], exitCode = 0): AuditResult {
  return { rules, exitCode };
}

function readThink(): string {
  return readFileSync(join(tempDir, 'think.md'), 'utf-8');
}

describe('think-generator', () => {
  it('空 diff → 不生成 think 条目', () => {
    generateThinkEntry([], makeResult([], 0), 'test task', { dataDir: tempDir, now: fixedTime });
    expect(existsSync(join(tempDir, 'think.md'))).toBe(false);
  });

  it('正常 diff + 全 PASS → 生成"无异常"条目', () => {
    const diff = [makeDiffFile('src/a.ts')];
    generateThinkEntry(diff, makeResult([], 0), '修 bug', { dataDir: tempDir, now: fixedTime });

    const content = readThink();
    expect(content).toContain('任务: 修 bug');
    expect(content).toContain('#审计结果: PASS');
    expect(content).toContain('#改动范围: 改了 1 个文件');
    expect(content).toContain('#教训: 本次改动符合规范，无异常');
  });

  it('diff + A3 WARN → 生成"越界修改"教训', () => {
    const diff = [makeDiffFile('src/a.ts'), makeDiffFile('src/b.ts')];
    const a3Rule: RuleCheck = {
      name: 'A3 不改越界',
      number: 3,
      status: 'WARN',
      details: ['改了任务外的文件'],
    };
    generateThinkEntry(diff, makeResult([a3Rule], 1), '修 bug', { dataDir: tempDir, now: fixedTime });

    const content = readThink();
    expect(content).toContain('#教训: 改了任务描述之外的文件，下次注意聚焦');
  });

  it('diff + A7 WARN → 生成"不存盲改"教训', () => {
    const diff = [makeDiffFile('src/a.ts')];
    const a7Rule: RuleCheck = {
      name: 'A7 不存盲改',
      number: 7,
      status: 'WARN',
      details: ['改了源码没写日志'],
    };
    generateThinkEntry(diff, makeResult([a7Rule], 1), '改功能', { dataDir: tempDir, now: fixedTime });

    const content = readThink();
    expect(content).toContain('#教训: 改了源码但没写日志/测试，下次先写日志');
  });

  it('think.md 已存在 → 追加不覆盖', () => {
    writeFileSync(join(tempDir, 'think.md'), '## 旧记录\n\n之前的反思\n', 'utf-8');
    _resetThinkCache();

    const diff = [makeDiffFile('src/a.ts')];
    generateThinkEntry(diff, makeResult([], 0), '新任务', { dataDir: tempDir, now: fixedTime });

    const content = readThink();
    expect(content).toContain('## 旧记录');
    expect(content).toContain('之前的反思');
    expect(content).toContain('任务: 新任务');
  });

  it('同一 task 同一分钟重复调用 → 幂等不重复写入', () => {
    const diff = [makeDiffFile('src/a.ts')];

    generateThinkEntry(diff, makeResult([], 0), '重复任务', { dataDir: tempDir, now: fixedTime });
    generateThinkEntry(diff, makeResult([], 0), '重复任务', { dataDir: tempDir, now: fixedTime });

    const content = readThink();
    const matches = content.match(/任务: 重复任务/g);
    expect(matches).toHaveLength(1);
  });

  it('文件超过 5 个 → 列表截断显示总数', () => {
    const diff = Array.from({ length: 8 }, (_, i) => makeDiffFile(`src/file${i}.ts`));
    generateThinkEntry(diff, makeResult([], 0), '大批量', { dataDir: tempDir, now: fixedTime });

    const content = readThink();
    expect(content).toContain('共 8 个');
    expect(content).toContain('改了 8 个文件');
  });

  it('高频问题检测 → 同类教训出现 ≥3 次标注重复模式', () => {
    // 预写历史 think.md，包含 2 次越界教训
    const existing = `
## 2026-06-29 10:00 任务: task1

- #教训: 改了任务描述之外的文件，下次注意聚焦

## 2026-06-29 11:00 任务: task2

- #教训: 改了任务描述之外的文件，下次注意聚焦
`;
    writeFileSync(join(tempDir, 'think.md'), existing, 'utf-8');
    _resetThinkCache();

    const diff = [makeDiffFile('src/a.ts'), makeDiffFile('src/b.ts')];
    const a3Rule: RuleCheck = {
      name: 'A3 不改越界',
      number: 3,
      status: 'WARN',
      details: ['越界'],
    };
    generateThinkEntry(diff, makeResult([a3Rule], 1), 'task3', { dataDir: tempDir, now: fixedTime });

    const content = readThink();
    expect(content).toContain('#重复模式: 越界修改高频出现');
  });
});
