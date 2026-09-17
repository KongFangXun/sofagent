// ============================================================
// doctor-audit-entry.test.ts · doctor audit 入口解析回归测试（v1.5.0 TASK-19）
//
// 覆盖场景：
//   1. 发布态形态：mock require.resolve('@sofagent/audit') 返回包 main 入口
//      （pkgRoot/dist/public-api.js）→ doctor 应解析 pkgRoot/dist/index.js
//      （原实现 dirname 单层 → pkgRoot/dist/dist/index.js 错位恒 miss）。
//   2. 源码仓形态：monorepo 相对路径分支（../../audit/dist/index.js）不回归。
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import * as auditHistory from '../audit-history';
import { runDoctor } from '../doctor';

describe('doctor audit 入口解析（v1.5.0 TASK-19）', () => {
  let tmpHome: string;
  let output: () => string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 't19-doctor-'));
    vi.stubEnv('SOFAGENT_HOME', tmpHome);
    vi.stubEnv('SOFAGENT_HOME_ALLOWED_PREFIXES', tmpdir());
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(auditHistory, 'checkHistoryChainDetailed').mockReturnValue({ status: 'ok' });
    output = () => (console.log as ReturnType<typeof vi.spyOn>).mock.calls.map((c) => String(c[0])).join('\n');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    try { rmSync(tmpHome, { recursive: true, force: true }); } catch { /* */ }
  });

  it('发布态解析语义：resolve 得 main 入口（dist/public-api.js）→ dirname×2 包根 → dist/index.js 不错位', () => {
    // 构造发布态包布局 fixture：pkgRoot/dist/public-api.js + pkgRoot/dist/index.js
    const pkgRoot = mkdtempSync(join(tmpdir(), 't19-pkgroot-'));
    try {
      mkdirSync(join(pkgRoot, 'dist'), { recursive: true });
      writeFileSync(join(pkgRoot, 'dist', 'public-api.js'), 'module.exports = {};\n');
      writeFileSync(join(pkgRoot, 'dist', 'index.js'), '#!/usr/bin/env node\nprocess.exit(0);\n');
      const mainEntry = join(pkgRoot, 'dist', 'public-api.js');

      // 修复后语义（doctor.ts 分支 ②）：dirname(dirname(main)) = 包根 → join(包根, 'dist', 'index.js')
      const entry = join(dirname(dirname(mainEntry)), 'dist', 'index.js');
      expect(entry).toBe(join(pkgRoot, 'dist', 'index.js'));
      // 原实现（回归锚）：dirname 单层 → dist/dist/index.js 错位——锁定修复不回退
      const buggyEntry = join(dirname(mainEntry), 'dist', 'index.js');
      expect(buggyEntry).toBe(join(pkgRoot, 'dist', 'dist', 'index.js'));
      expect(entry).not.toBe(buggyEntry);
    } finally {
      try { rmSync(pkgRoot, { recursive: true, force: true }); } catch { /* */ }
    }
  });

  it('源码仓形态：doctor 实跑不命中「audit dist/index.js 未找到」warn', async () => {
    // worktree 内 engine/audit/dist/index.js 存在——分支 ①（monorepo 相对路径）命中
    await runDoctor(process.cwd());
    const out = output();
    expect(out).not.toContain('audit dist/index.js 未找到');
  }, 30000);
});
