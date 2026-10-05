// ============================================================
// io-catch-visibility.test.ts · v1.5.7 F9：mcp 外部 IO 面 catch 吞错修复行为锁
// ============================================================
// 修复面（engine/mcp 中 try 上下文含外部 IO 调用的静默 catch，四分类台账
// tools/check/silent-catch-io-ledger.json）：
//   - tools/audit-tools.ts runAudit：git log 取 commitMsg 失败 → 补 [sofagent] 留痕
//
// 断言策略：vi.mock('child_process') 只对 ['log', ...] 子命令注入失败
//   （对齐 cli-quick.test.ts 的 mock 先例），真实临时 git 仓保 parseDiff
//   路径可用；断言 [sofagent] 前缀留痕 + 工具仍正常返回（降级语义不变）。
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execFileSync: vi.fn((...args: unknown[]) => {
      const argv = args[1] as string[] | undefined;
      if (Array.isArray(argv) && argv[0] === 'log' && argv.includes('--pretty=%B')) {
        throw new Error('injected: git log unavailable');
      }
      return actual.execFileSync(...(args as [string, string[]]));
    }),
  };
});

import { runAudit } from '../tools/audit-tools';

describe('F9 mcp 外部 IO 面 catch 吞错修复（错误发生时用户可知）', () => {
  let tmpDir: string;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-f9-mcp-'));
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errSpy.mockRestore();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it('runAudit：git log 取 commitMsg 失败 → console.error 带 [sofagent] 前缀（审计仍完成）', () => {
    // 两个真实提交：parseDiff('HEAD~1..HEAD') diff 非空 → 走到 git log 取 commitMsg 分支
    execFileSync('git', ['init', '-q'], { cwd: tmpDir });
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'one\n');
    execFileSync('git', ['add', 'a.txt'], { cwd: tmpDir });
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'first'], { cwd: tmpDir });
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'two\n');
    execFileSync('git', ['add', 'a.txt'], { cwd: tmpDir });
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'second'], { cwd: tmpDir });

    const cwd = process.cwd();
    process.chdir(tmpDir);
    try {
      const r = runAudit({ diff: 'HEAD~1..HEAD', silent: true }, undefined);
      // 降级语义保留：工具正常返回（commitMsg 为空走默认审计路径）
      expect(r).toBeDefined();
      // 可见性：git log 失败留痕
      const msgs = errSpy.mock.calls.map((c) => String(c[0]));
      expect(msgs.some((m) => m.startsWith('[sofagent]') && m.includes('commitMsg'))).toBe(true);
    } finally {
      process.chdir(cwd);
    }
  });
});
