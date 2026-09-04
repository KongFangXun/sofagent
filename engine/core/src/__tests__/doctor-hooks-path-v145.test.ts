// ============================================================
// v1.4.5 T14 · doctor hook 检查尊重 core.hooksPath
//
// 背景（跨工程师协调项 E1/E2）：audit 批已把安装侧（installHook）改为
// 尊重 repo 的 core.hooksPath（hook 写进配置目录）。doctor 此前三处
// hook 检查硬编码 $gitDir/hooks——repo 配 hooksPath 时必然假红。
//
// 覆盖场景：
//   1. core.hooksPath=.githooks + hook 装在配置目录（.git/hooks 为空）
//      → doctor 报「已安装」（关键区分点：若仍查 .git/hooks 会报未安装）
//   2. 未配置 hooksPath + hook 在 .git/hooks → 维持现状通过（回归保护）
//   3. 配置 hooksPath + 配置目录无 hook → 报「未安装」（真红，非假绿）
//   4. 相对 hooksPath 按 repo 顶层 resolve（子目录运行 doctor 也能查对）
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import * as auditHistory from '../audit-history';
import { runDoctor } from '../doctor';

/** git 不可用的环境（极端 CI 裁剪）跳过全组——与 getHmacKey null 跳过同先例 */
const GIT_OK = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
})();

/** 沙箱 HOME + 链校验 mock + console 静音（对齐 doctor.test.ts setupOntologyTest 先例） */
function setupDoctorSandbox(): void {
  const tmpHome = mkdtempSync(join(tmpdir(), 'doctor-t14-'));
  vi.stubEnv('SOFAGENT_HOME', tmpHome);
  // v1.3.2 path-traversal 白名单：/tmp 不在默认白名单
  vi.stubEnv('SOFAGENT_HOME_ALLOWED_PREFIXES', tmpdir());
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(auditHistory, 'checkHistoryChainDetailed').mockReturnValue({ status: 'ok' });
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
}

/** 输出收集（含 info 的 core.hooksPath 提示行） */
function output(): string {
  return (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls
    .map((c) => String(c[0]))
    .join('\n');
}

describe.skipIf(!GIT_OK)('T14 · doctor hook 检查尊重 core.hooksPath', () => {
  let repo: string;

  beforeEach(() => {
    setupDoctorSandbox();
    repo = mkdtempSync(join(tmpdir(), 't14-repo-'));
    git(repo, 'init', '-q');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ }
  });

  it('hooksPath=.githooks + hook 在配置目录（.git/hooks 空）→ 已安装（不假红）', () => {
    git(repo, 'config', 'core.hooksPath', '.githooks');
    mkdirSync(join(repo, '.githooks'));
    // 模拟安装侧（hook-install 尊重 hooksPath）写入的 hook——含 sofagent 标识
    writeFileSync(join(repo, '.githooks', 'commit-msg'), '#!/bin/bash\n# sofagent commit-msg hook v1.4.4\nexit 0\n', 'utf-8');

    const r = runDoctor(repo);
    const out = output();

    // 关键区分点：.git/hooks 为空——若 doctor 仍查缺省目录必报「未安装」
    expect(out).toContain('commit-msg hook 已安装并包含 sofagent');
    expect(out).not.toContain('commit-msg hook 未安装');
    // hooksPath 生效应有提示行（用户能看出 doctor 查的是配置目录）
    expect(out).toContain('core.hooksPath 已配置');
    expect(r.hook).toBe(true);
  });

  it('未配置 hooksPath + hook 在 .git/hooks → 维持现状通过（回归保护）', () => {
    mkdirSync(join(repo, '.git', 'hooks'), { recursive: true });
    writeFileSync(join(repo, '.git', 'hooks', 'commit-msg'), '#!/bin/bash\n# sofagent hook\nexit 0\n', 'utf-8');

    const r = runDoctor(repo);
    const out = output();

    expect(out).toContain('commit-msg hook 已安装并包含 sofagent');
    expect(out).not.toContain('core.hooksPath 已配置');
    expect(r.hook).toBe(true);
  });

  it('hooksPath 已配置但配置目录无 hook → 报未安装（真红，非假绿）', () => {
    git(repo, 'config', 'core.hooksPath', '.githooks');
    mkdirSync(join(repo, '.githooks'));
    // 注意：.git/hooks 也保持为空——两侧都无 hook，应报未安装

    const r = runDoctor(repo);
    const out = output();

    expect(out).toContain('commit-msg hook 未安装');
    expect(r.hook).toBe(false);
  });

  it('相对 hooksPath 按 repo 顶层 resolve——子目录运行 doctor 也能查对', () => {
    git(repo, 'config', 'core.hooksPath', '.githooks');
    mkdirSync(join(repo, '.githooks'));
    writeFileSync(join(repo, '.githooks', 'commit-msg'), '#!/bin/bash\n# sofagent commit-msg hook\nexit 0\n', 'utf-8');
    // 子目录：git rev-parse --show-toplevel 仍指向 repo 顶层，hooksPath 应以顶层 resolve
    const sub = join(repo, 'packages', 'app');
    mkdirSync(sub, { recursive: true });

    const r = runDoctor(sub);
    const out = output();

    expect(out).toContain('commit-msg hook 已安装并包含 sofagent');
    expect(r.hook).toBe(true);
  });
});
