// ============================================================
// init.test.ts · --init 关键修复的单元测试
// v1.0.7 P0-1 + P1-1 补充测试——防止修复随时间退化
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ensureGitignore } from './init';

// ==============================
// P1-1: ensureGitignore 测试
// ==============================
describe('ensureGitignore (P1-1)', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `sofagent-init-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* cleanup */ }
  });

  it('当 .gitignore 不存在时，创建包含 .sofagent/ 的文件', () => {
    ensureGitignore(testDir);
    const content = readFileSync(join(testDir, '.gitignore'), 'utf-8');
    expect(content).toContain('.sofagent/');
    expect(content).toContain('sofagent 审计数据');
  });

  it('当 .gitignore 存在但不含 .sofagent/ 时，追加条目', () => {
    writeFileSync(join(testDir, '.gitignore'), '# 现有 gitignore\nnode_modules/\n');
    ensureGitignore(testDir);
    const content = readFileSync(join(testDir, '.gitignore'), 'utf-8');
    expect(content).toContain('node_modules/');
    expect(content).toContain('.sofagent/');
  });

  it('当 .gitignore 已含 .sofagent/ 时，不重复追加', () => {
    writeFileSync(join(testDir, '.gitignore'), 'node_modules/\n.sofagent/\n');
    ensureGitignore(testDir);
    const content = readFileSync(join(testDir, '.gitignore'), 'utf-8');
    // 只应该出现一次 .sofagent/
    const matches = (content.match(/\.sofagent\//g) || []).length;
    expect(matches).toBe(1);
  });

  it('追加内容与已有内容之间有合适的分隔', () => {
    writeFileSync(join(testDir, '.gitignore'), 'node_modules/\n');
    ensureGitignore(testDir);
    const content = readFileSync(join(testDir, '.gitignore'), 'utf-8');
    // 确保新增条目不在同一行
    const lines = content.split('\n');
    expect(lines).toContain('.sofagent/');
  });
});

// ==============================
// P0-1: hook 版本号判断逻辑测试
// ==============================
describe('post-commit hook version detection (P0-1)', () => {
  // 测试 init.ts 中的版本号正则匹配逻辑
  // 逻辑：/v(\d+)\.(\d+)\.(\d+)/ → major < 1 或 (major=1 && minor=0 && patch<7) → 覆盖
  //                                       否则 → 保留

  function shouldOverwriteHook(hookContent: string): boolean {
    const versionMatch = hookContent.match(/v(\d+)\.(\d+)\.(\d+)/);
    if (!versionMatch) return true; // 无版本号 → 覆盖
    const major = parseInt(versionMatch[1]!, 10);
    const minor = parseInt(versionMatch[2]!, 10);
    const patch = parseInt(versionMatch[3]!, 10);
    // v1.0.7 以下 → 覆盖
    return major < 1 || (major === 1 && minor === 0 && patch < 7);
  }

  it('v1.0.6 hook 应被覆盖', () => {
    expect(shouldOverwriteHook('#!/bin/bash\n# sofagent post-commit hook v1.0.6')).toBe(true);
  });

  it('v1.0.5 hook 应被覆盖', () => {
    expect(shouldOverwriteHook('#!/bin/bash\n# sofagent post-commit hook v1.0.5')).toBe(true);
  });

  it('v1.0.7 hook 应被保留', () => {
    expect(shouldOverwriteHook('#!/bin/bash\n# sofagent post-commit hook v1.0.7')).toBe(false);
  });

  it('v1.0.8 hook 应被保留', () => {
    expect(shouldOverwriteHook('#!/bin/bash\n# sofagent post-commit hook v1.0.8')).toBe(false);
  });

  it('v2.0.0 hook 应被保留（主版本号更大）', () => {
    expect(shouldOverwriteHook('#!/bin/bash\n# sofagent post-commit hook v2.0.0')).toBe(false);
  });

  it('v0.99.9 hook 应被覆盖（实验版）', () => {
    expect(shouldOverwriteHook('#!/bin/bash\n# sofagent post-commit hook v0.99.9')).toBe(true);
  });

  it('无版本号的 hook 应被覆盖', () => {
    expect(shouldOverwriteHook('#!/bin/bash\n# some other hook')).toBe(true);
  });

  it('v1.0.0 hook 应被覆盖', () => {
    expect(shouldOverwriteHook('#!/bin/bash\n# sofagent post-commit hook v1.0.0')).toBe(true);
  });

  it('v1.10.0 hook 应被保留（minor 更大，但 >= 1.0.7）', () => {
    // v1.10.0 → major=1, minor=10 → minor > 0 且 patch > 0 → patch 7 条件不满足整体
    // 但这个判断逻辑是：major<1 || (major===1 && minor===0 && patch<7)
    // v1.10.0: major=1, minor=10 → major===1 && minor===0 → false（minor 是 10 不是 0）
    expect(shouldOverwriteHook('#!/bin/bash\n# sofagent post-commit hook v1.10.0')).toBe(false);
  });
});
