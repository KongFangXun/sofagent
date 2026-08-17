// ============================================================
// dual-gate-mw.test.ts · 双闸验证 middleware 测试（v1.3.6 交付⑫）
//
// 覆盖验收标准：
//   1. postToolCall 钩子存在并在每次工具执行后触发
//   2. 至少 3 条副作用复查规则（文件 / git / 网络）
//   3. 复查异常写审计 WARN 并中断后续调用
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, rmSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import {
  DualGateMiddleware,
  BUILTIN_SIDE_EFFECT_RULES,
  fileWriteScopeRule,
  gitImpactScopeRule,
  networkOutboundTargetRule,
  type ToolCallRecord,
} from '../dual-gate-mw';

function tmpDir(): string {
  const dir = join(tmpdir(), `sofagent-dual-gate-${Date.now()}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeCall(overrides: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return {
    toolName: 'write_file',
    args: { file_path: 'src/a.ts' },
    description: '写文件',
    ...overrides,
  };
}

describe('双闸验证（v1.3.6 交付⑫）', () => {
  let testDir: string;
  let savedKeyPath: string | undefined;

  beforeEach(() => {
    testDir = tmpDir();
    savedKeyPath = process.env.SOFAGENT_KEY_PATH;
    const KEY_PATH = join(testDir, 'test-hmac-key');
    writeFileSync(KEY_PATH, 'test-hmac-key-0123456789abcdef');
    process.env.SOFAGENT_KEY_PATH = KEY_PATH;
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* */ }
    if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
    else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
  });

  // ── 验收 1：postToolCall 钩子每次工具执行后触发 ──

  it('postToolCall 在每次工具执行后触发（计数递增）', async () => {
    const gate = new DualGateMiddleware({ dataDir: testDir });
    await gate.wrapToolCall(makeCall({ expectedPaths: ['src/'] }), async () => 'ok');
    await gate.wrapToolCall(makeCall({ expectedPaths: ['src/'] }), async () => 'ok');
    expect(gate.getPostCallCount()).toBe(2);
  });

  it('复查通过 → 返回原始工具结果', async () => {
    const gate = new DualGateMiddleware({ dataDir: testDir });
    const result = await gate.wrapToolCall(
      makeCall({ expectedPaths: ['src/'] }),
      async () => '写入成功',
    );
    expect(result).toBe('写入成功');
    expect(gate.isAborted()).toBe(false);
  });

  it('工具自身抛错 → 不跑复查，原样抛出', async () => {
    const gate = new DualGateMiddleware({ dataDir: testDir });
    await expect(
      gate.wrapToolCall(makeCall(), async () => { throw new Error('boom'); }),
    ).rejects.toThrow('boom');
    expect(gate.getPostCallCount()).toBe(0); // 抛错不算复查
  });

  // ── 验收 2：三条内置规则 ──

  it('内置规则集 = 3 条（文件 / git / 网络）', () => {
    expect(BUILTIN_SIDE_EFFECT_RULES.length).toBe(3);
    const names = BUILTIN_SIDE_EFFECT_RULES.map((r) => r.name);
    expect(names).toContain('file-write-scope');
    expect(names).toContain('git-impact-scope');
    expect(names).toContain('network-outbound-target');
  });

  it('文件写入范围规则：白名单内 PASS / 白名单外 WARN / 不声明不拦', () => {
    const call = makeCall({ args: { file_path: 'src/deep/b.ts' }, expectedPaths: ['src/'] });
    expect(fileWriteScopeRule.check(call, 'ok')).toBeNull(); // 前缀匹配放行

    const outside = makeCall({ args: { file_path: '/etc/passwd' }, expectedPaths: ['src/'] });
    const reason = fileWriteScopeRule.check(outside, 'ok');
    expect(reason).toContain('超出预期范围');

    const noScope = makeCall({ args: { file_path: '/any/where' } });
    expect(fileWriteScopeRule.check(noScope, 'ok')).toBeNull(); // 未声明白名单不复查

    const readOnly = makeCall({ toolName: 'read_file', args: { file_path: '/etc/passwd' }, expectedPaths: ['src/'] });
    expect(fileWriteScopeRule.check(readOnly, 'ok')).toBeNull(); // 只读工具不复查
  });

  it('git 影响范围规则：危险子命令 WARN / 普通命令 PASS / 非 git 不管', () => {
    const forcePush = makeCall({ toolName: 'run_bash', args: { command: 'git push origin main --force' } });
    expect(gitImpactScopeRule.check(forcePush, 'ok')).toContain('push --force');

    const resetHard = makeCall({ toolName: 'run_bash', args: { command: 'git reset --hard HEAD~3' } });
    expect(gitImpactScopeRule.check(resetHard, 'ok')).toContain('reset --hard');

    const normal = makeCall({ toolName: 'run_bash', args: { command: 'git status && git add .' } });
    expect(gitImpactScopeRule.check(normal, 'ok')).toBeNull();

    const notGit = makeCall({ toolName: 'run_bash', args: { command: 'ls -la' } });
    expect(gitImpactScopeRule.check(notGit, 'ok')).toBeNull();
  });

  it('网络外联规则：白名单 host PASS / 白名单外 WARN / 子域名放行', () => {
    const ok = makeCall({
      toolName: 'fetch_url',
      args: { url: 'https://api.github.com/repos/x' },
      allowedHosts: ['github.com'],
    });
    expect(networkOutboundTargetRule.check(ok, 'ok')).toBeNull(); // 子域名 .github.com 放行

    const bad = makeCall({
      toolName: 'fetch_url',
      args: { url: 'https://evil.example.com/steal' },
      allowedHosts: ['github.com'],
    });
    const reason = networkOutboundTargetRule.check(bad, 'ok');
    expect(reason).toContain('evil.example.com');

    const noWhitelist = makeCall({ toolName: 'fetch_url', args: { url: 'https://anywhere.io' } });
    expect(networkOutboundTargetRule.check(noWhitelist, 'ok')).toBeNull(); // 不声明不复查
  });

  // ── 验收 3：复查异常写审计 WARN 并中断 ──

  it('复查 WARN → 返回 WARN 消息 + 熔断后续调用', async () => {
    const gate = new DualGateMiddleware({ dataDir: testDir });
    const result = await gate.wrapToolCall(
      makeCall({ args: { file_path: '/etc/passwd' }, expectedPaths: ['src/'] }),
      async () => 'written',
    );
    expect(String(result)).toContain('双闸复查 WARN');
    expect(String(result)).toContain('file-write-scope');
    expect(gate.isAborted()).toBe(true);

    // 熔断后：后续调用直接中断，next 不执行
    let executed = false;
    const blocked = await gate.wrapToolCall(makeCall(), async () => { executed = true; return 'x'; });
    expect(String(blocked)).toContain('双闸中断');
    expect(executed).toBe(false);
  });

  it('复查 WARN 写 decision-log（kind=TOOL_GATE + dual-gate tag）', async () => {
    const gate = new DualGateMiddleware({ dataDir: testDir, agentId: 'test-agent' });
    await gate.wrapToolCall(
      makeCall({ args: { command: 'git reset --hard HEAD' } }),
      async () => 'done',
    );
    const logPath = join(testDir, 'audit', 'decision-log.jsonl');
    expect(existsSync(logPath)).toBe(true);
    const lines = readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
    expect(lines.length).toBe(1);
    const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(entry.kind).toBe('TOOL_GATE');
    expect(entry.agentId).toBe('test-agent');
    expect(JSON.stringify(entry.why)).toContain('双闸复查 WARN');
    expect(JSON.stringify(entry.why)).toContain('reset --hard');
  });

  it('abortSubsequent=false → WARN 留痕但不熔断', async () => {
    const gate = new DualGateMiddleware({ dataDir: testDir, abortSubsequent: false });
    await gate.wrapToolCall(
      makeCall({ args: { file_path: '/x' }, expectedPaths: ['src/'] }),
      async () => 'w',
    );
    expect(gate.isAborted()).toBe(false);
    // 后续调用照常执行
    const next = await gate.wrapToolCall(makeCall({ expectedPaths: ['src/'] }), async () => 'fine');
    expect(next).toBe('fine');
  });

  it('自定义规则集替换内置规则', async () => {
    const gate = new DualGateMiddleware({
      dataDir: testDir,
      abortSubsequent: false,
      rules: [{ name: 'always-warn', check: () => '测试规则命中' }],
    });
    const result = await gate.wrapToolCall(makeCall(), async () => 'x');
    expect(String(result)).toContain('测试规则命中');
    expect(String(result)).toContain('always-warn');
  });

  it('规则自身抛错 → 跳过该规则不反噬主流程', async () => {
    const gate = new DualGateMiddleware({
      dataDir: testDir,
      rules: [
        { name: 'broken', check: () => { throw new Error('rule crash'); } },
        fileWriteScopeRule,
      ],
    });
    const result = await gate.wrapToolCall(
      makeCall({ expectedPaths: ['src/'] }),
      async () => 'ok',
    );
    expect(result).toBe('ok');
  });
});
