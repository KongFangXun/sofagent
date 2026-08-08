// ============================================================
// cli-quick.test.ts · npx sofagent-audit 零配置 CLI 单测
// v1.2.9 (⑧-1)
// F-13 (v1.3.0 bugfix)：--help/--version/--init 等参数拦截行为测试
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  formatQuickResult,
  generateQuickOutput,
  runCliQuick,
} from './cli-quick';
import type { AuditResult, RuleCheck } from './reporter';

// F-13: 拦截 spawnSync，避免 --init 等路由测试真实拉起完整引擎
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawnSync: vi.fn(() => ({ status: 0 })),
  };
});

// F-13: 无参数行为测试——mock git 检测 + parseDiff，避免真实审计副作用
vi.mock('@sofagent/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sofagent/core')>();
  return {
    ...actual,
    isInGitRepo: vi.fn(() => true),
    parseDiff: vi.fn(() => []),
  };
});

import { spawnSync } from 'child_process';
import { parseDiff } from '@sofagent/core';

// 辅助：构造 RuleCheck
function makeRule(
  overrides: Partial<RuleCheck> = {}
): RuleCheck {
  return {
    name: 'A1 不碰敏感文件',
    number: 1,
    status: 'PASS',
    details: [],
    ...overrides,
  };
}

// 辅助：构造 AuditResult
function makeResult(
  rules: RuleCheck[],
  exitCode = 0
): AuditResult {
  return { rules, exitCode };
}

describe('formatQuickResult', () => {
  it('PASS 规则不输出行', () => {
    const rule = makeRule({ status: 'PASS' });
    const lines = formatQuickResult(rule);
    expect(lines).toHaveLength(0);
  });

  it('SKIPPED 规则不输出行', () => {
    const rule = makeRule({ status: 'SKIPPED' });
    const lines = formatQuickResult(rule);
    expect(lines).toHaveLength(0);
  });

  it('FAIL 规则输出 ❌ 行', () => {
    const rule = makeRule({
      name: 'A2 不泄密钥',
      status: 'FAIL',
      details: ['src/config.ts:42: 检测到硬编码密钥'],
    });
    const lines = formatQuickResult(rule);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('❌');
    expect(lines[0]).toContain('A2 不泄密钥');
    expect(lines[0]).toContain('src/config.ts');
  });

  it('WARN 规则输出 ⚠️ 行', () => {
    const rule = makeRule({
      name: 'A5 诚实报告',
      status: 'WARN',
      details: ['src/utils.ts L15: console.log 残留'],
    });
    const lines = formatQuickResult(rule);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('⚠️');
    expect(lines[0]).toContain('A5 诚实报告');
  });

  it('多条 details 输出多行', () => {
    const rule = makeRule({
      name: 'A2',
      status: 'FAIL',
      details: ['file1.ts:1: token1', 'file2.ts:2: token2'],
    });
    const lines = formatQuickResult(rule);
    expect(lines).toHaveLength(2);
  });

  it('无 details 的 FAIL 输出摘要行', () => {
    const rule = makeRule({
      name: 'A6 构建未坏',
      status: 'FAIL',
      details: [],
    });
    const lines = formatQuickResult(rule);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('❌');
    expect(lines[0]).toContain('A6 构建未坏');
  });
});

describe('generateQuickOutput', () => {
  it('全 PASS 时输出通过消息', () => {
    const result = makeResult([
      makeRule({ name: 'A1', number: 1, status: 'PASS' }),
      makeRule({ name: 'A2', number: 2, status: 'PASS' }),
    ], 0);

    const output = generateQuickOutput(result, 'abc1234');
    expect(output).toContain('abc1234');
    expect(output).toContain('全部 2 条规则通过');
    expect(output).toContain('sofagent 审计');
  });

  it('有 FAIL 时输出违规详情 + 汇总', () => {
    const result = makeResult([
      makeRule({ name: 'A1', number: 1, status: 'PASS' }),
      makeRule({
        name: 'A2 不泄密钥',
        number: 2,
        status: 'FAIL',
        details: ['src/config.ts:42: token'],
      }),
      makeRule({
        name: 'A5 诚实报告',
        number: 5,
        status: 'WARN',
        details: ['src/utils.ts L15: console.log'],
      }),
    ], 2);

    const output = generateQuickOutput(result, 'abc1234');
    expect(output).toContain('abc1234');
    expect(output).toContain('❌');
    expect(output).toContain('A2 不泄密钥');
    expect(output).toContain('⚠️');
    expect(output).toContain('1 条违规');
    expect(output).toContain('1 条警告');
    expect(output).toContain('1 条通过');
  });

  it('只有 WARN 时输出警告汇总', () => {
    const result = makeResult([
      makeRule({ name: 'A1', number: 1, status: 'PASS' }),
      makeRule({
        name: 'A5',
        number: 5,
        status: 'WARN',
        details: ['console.log 残留'],
      }),
    ], 1);

    const output = generateQuickOutput(result, 'def5678');
    expect(output).toContain('⚠️');
    expect(output).toContain('1 条警告');
    expect(output).toContain('1 条通过');
  });

  it('包含 SKIPPED 时在汇总中显示', () => {
    const result = makeResult([
      makeRule({ name: 'A1', number: 1, status: 'PASS' }),
      makeRule({ name: 'A2', number: 2, status: 'SKIPPED' }),
    ], 0);

    const output = generateQuickOutput(result, 'abc1234');
    expect(output).toContain('1 条跳过');
  });

  it('产品签名行存在', () => {
    const result = makeResult([
      makeRule({ name: 'A1', number: 1, status: 'PASS' }),
    ], 0);

    const output = generateQuickOutput(result, 'abc1234');
    expect(output).toContain('sofagent 审计');
    expect(output).toContain('零 token');
  });
});

// ── F-13 (v1.3.0 bugfix)：参数拦截行为 ──
describe('runCliQuick 参数拦截（F-13）', () => {
  beforeEach(() => {
    vi.mocked(spawnSync).mockClear();
    vi.mocked(parseDiff).mockClear();
  });

  it('--help 显示帮助且不执行审计', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const code = runCliQuick(['node', 'cli-quick.js', '--help']);
      expect(code).toBe(0);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('用法'));
      // 不路由到完整引擎、不跑审计
      expect(spawnSync).not.toHaveBeenCalled();
      expect(parseDiff).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it('-h 短参数同样显示帮助', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const code = runCliQuick(['node', 'cli-quick.js', '-h']);
      expect(code).toBe(0);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('用法'));
      expect(parseDiff).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it('--version 输出版本号且不执行审计', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const code = runCliQuick(['node', 'cli-quick.js', '--version']);
      expect(code).toBe(0);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('sofagent-audit v'));
      expect(parseDiff).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it('-v 短参数同样输出版本号', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const code = runCliQuick(['node', 'cli-quick.js', '-v']);
      expect(code).toBe(0);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('sofagent-audit v'));
      expect(parseDiff).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });

  it('--init 路由到完整引擎（dist/index.js，spawn 方式）', () => {
    const code = runCliQuick(['node', 'cli-quick.js', '--init']);
    expect(code).toBe(0);
    expect(spawnSync).toHaveBeenCalledTimes(1);
    const [execPath, args] = vi.mocked(spawnSync).mock.calls[0] as [string, string[]];
    expect(execPath).toBe(process.execPath);
    expect(args[0]).toContain('index.js');
    expect(args).toContain('--init');
  });

  it('--list-rulesets 路由到完整引擎', () => {
    const code = runCliQuick(['node', 'cli-quick.js', '--list-rulesets']);
    expect(code).toBe(0);
    expect(spawnSync).toHaveBeenCalledTimes(1);
    const [, args] = vi.mocked(spawnSync).mock.calls[0] as [string, string[]];
    expect(args).toContain('--list-rulesets');
  });

  it('无参数时行为不变（审计 HEAD~1..HEAD，不路由、不显示帮助）', () => {
    const code = runCliQuick(['node', 'cli-quick.js']);
    expect(code).toBe(0);
    expect(spawnSync).not.toHaveBeenCalled();
    // 走到默认 diffRange=HEAD~1..HEAD（parseDiff 被 mock 为空 diff）
    expect(parseDiff).toHaveBeenCalledWith('HEAD~1..HEAD');
  });

  it('位置参数时行为不变（审计指定范围）', () => {
    const code = runCliQuick(['node', 'cli-quick.js', 'HEAD~3..HEAD']);
    expect(code).toBe(0);
    expect(spawnSync).not.toHaveBeenCalled();
    expect(parseDiff).toHaveBeenCalledWith('HEAD~3..HEAD');
  });
});
