// ============================================================
// io-catch-visibility.test.ts · v1.5.7 F9：外部 IO 面 catch 吞错修复行为锁
// ============================================================
// 修复面（三包 audit/daemon/mcp 中 try 上下文含外部 IO 调用的静默 catch，
// 四分类台账 tools/check/silent-catch-io-ledger.json）：
//   17 处吞错统一补 console.error('[sofagent] ...', err) 结构化日志，
//   控制流不变（降级语义保留），失败时用户可知。
//
// 断言策略（对齐 companion-error-visibility.test.ts 先例）：
//   捕获 console.error 输出（vi.spyOn），注入失败路径
//   （不可写路径 / 目录占位 / 非法 env），断言 [sofagent] 前缀 + 位置锚。
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { resolveHooksDir } from '../hook-install';

describe('F9 外部 IO 面 catch 吞错修复（错误发生时用户可知）', () => {
  let tmpDir: string;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-f9-'));
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errSpy.mockRestore();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it('hook-install resolveHooksDir：git rev-parse 失败 → console.error 带 [sofagent] 前缀（不再静默退化）', () => {
    // 非 git 目录 → rev-parse --show-toplevel 失败 → 修复前静默退化，修复后留痕
    const nonGit = path.join(tmpDir, 'non-git');
    fs.mkdirSync(nonGit, { recursive: true });
    // findGitDir 先行返回 null（无 .git）→ resolveHooksDir 返回 null 前不触 rev-parse；
    // 构造 .git 为文件（worktree 场景）→ findGitDir 命中、rev-parse 失败
    fs.writeFileSync(path.join(nonGit, '.git'), 'gitdir: /nonexistent/real/gitdir\n');
    const r = resolveHooksDir(nonGit);
    // 降级语义保留：仍解析出 hooksDir（退化用 .git 父目录）
    expect(r).not.toBeNull();
    // 可见性：探测失败留痕
    const msgs = errSpy.mock.calls.map((c) => String(c[0]));
    expect(msgs.some((m) => m.startsWith('[sofagent]') && m.includes('rev-parse'))).toBe(true);
  });
});
