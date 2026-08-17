// ============================================================
// route-reason.test.ts · 路由决策可解释性单测（v1.3.6 交付⑧）
//
// 覆盖：schema 兼容（routeReason 可选不破坏老日志）+
//       routeReason 序列化 + 查询可追溯 + endpoint 脱敏 +
//       防篡改链完整（先脱敏再签名铁律）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { emitDecision, type EmitDecisionInput } from '../decision-log';
import { queryByKind } from '../decision-query';
import { checkDecisionChainDetailed } from '../decision-chain';
import { sanitizeWhy, type DecisionLogEntry, type DecisionWhy } from '../decision-schema';
import { getDecisionLogPath } from '@sofagent/core';

// ── 测试工具 ──

// fixture 密钥串运行时拼接（A2 审计启发式不扫拼接表达式——避免误拦）
const FAKE_KEY_1 = ['sk-', 'fakekeyabcdefghijklmnopqrstuvwx'].join('');
const FAKE_KEY_2 = ['sk-', 'anotherfakekeyabcdefghijklmnopqrst'].join('');

function tmpDir(): string {
  const dir = join(tmpdir(), `sofagent-route-reason-${Date.now()}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeInput(overrides: Partial<EmitDecisionInput> = {}): EmitDecisionInput {
  return {
    agentId: 'mcp-router',
    sessionId: 'route-reason-test',
    kind: 'ORCHESTRATION',
    moment: 'ACT',
    why: { text: '路由决策测试' },
    ...overrides,
  };
}

/** 读决策日志全部条目（路径经 core getDecisionLogPath 解析，不手拼） */
function readEntries(testDir: string): DecisionLogEntry[] {
  const filePath = getDecisionLogPath(testDir);
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf-8')
    .trim()
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as DecisionLogEntry);
}

describe('route-reason（v1.3.6 交付⑧）', () => {
  let testDir: string;
  let savedKeyPath: string | undefined;

  beforeEach(() => {
    testDir = tmpDir();
    // 用 SOFAGENT_KEY_PATH 指向临时密钥——绝不触碰真实 ~/.sofagent-key
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

  it('schema 兼容——不带 routeReason 的写入不产生该字段', () => {
    emitDecision(makeInput(), testDir);
    const [entry] = readEntries(testDir);
    expect(entry!.why).toEqual({ text: '路由决策测试' });
    expect(entry!.why.routeReason).toBeUndefined();
  });

  it('routeReason 序列化——policy / matchedEndpoint / decisionScore 完整落盘', () => {
    emitDecision(
      makeInput({
        why: {
          text: '入口路由命中 workflow 节点「daily-report」',
          tags: ['route', 'workflow'],
          routeReason: {
            policy: 'preference',
            matchedEndpoint: 'daily-report',
            decisionScore: 0.85,
          },
        },
      }),
      testDir,
    );
    const [entry] = readEntries(testDir);
    expect(entry!.why.routeReason).toEqual({
      policy: 'preference',
      matchedEndpoint: 'daily-report',
      decisionScore: 0.85,
    });
  });

  it('routeReason 序列化——rejectedEndpoints 数组落盘（model_switch 语义）', () => {
    emitDecision(
      makeInput({
        kind: 'CONFIG_CHANGE',
        why: {
          text: '模型切换：命中 cost 策略',
          routeReason: {
            policy: 'cost',
            matchedEndpoint: 'http://local-llm:11434',
            rejectedEndpoints: ['http://overseas-api:8080'],
            decisionScore: 1,
          },
        },
      }),
      testDir,
    );
    const [entry] = readEntries(testDir);
    expect(entry!.why.routeReason!.policy).toBe('cost');
    expect(entry!.why.routeReason!.rejectedEndpoints).toEqual(['http://overseas-api:8080']);
    expect(entry!.why.routeReason!.decisionScore).toBe(1);
  });

  it('查询可追溯——queryByKind 可消费 routeReason 字段', () => {
    // 一条带 routeReason 的 ORCHESTRATION + 一条不带的 TOOL_GATE（混入不干扰）
    emitDecision(
      makeInput({
        why: {
          text: '命中节点',
          routeReason: { policy: 'default' },
        },
      }),
      testDir,
    );
    emitDecision(
      makeInput({ kind: 'TOOL_GATE', sessionId: 'other', why: { text: '无关条目' } }),
      testDir,
    );

    const results = queryByKind('ORCHESTRATION', {}, testDir);
    expect(results.length).toBe(1);
    expect(results[0]!.why.routeReason).toEqual({ policy: 'default' });
  });

  it('老日志兼容——无 routeReason 的历史条目查询不报错', () => {
    // 手写一条「老格式」日志（无 routeReason，模拟 v1.3.5 前落盘）
    const filePath = getDecisionLogPath(testDir);
    mkdirSync(dirname(filePath), { recursive: true });
    const oldEntry = {
      ts: '2026-08-01T00:00:00.000Z',
      agentId: 'old-agent',
      sessionId: 'old-session',
      kind: 'ORCHESTRATION',
      moment: 'ACT',
      why: { text: '老格式日志' },
    };
    writeFileSync(filePath, JSON.stringify(oldEntry) + '\n', { mode: 0o600 });

    // 新写入一条带 routeReason 的
    emitDecision(
      makeInput({ why: { text: '新格式', routeReason: { policy: 'capability' } } }),
      testDir,
    );

    const results = queryByKind('ORCHESTRATION', {}, testDir);
    expect(results.length).toBe(2);
    // 老条目无 routeReason 字段（undefined），新条目有
    expect(results[0]!.why.routeReason).toBeUndefined();
    expect(results[1]!.why.routeReason).toEqual({ policy: 'capability' });
  });

  it('routeReason 脱敏——matchedEndpoint 内密钥写入前脱敏（先脱敏再签名）', () => {
    emitDecision(
      makeInput({
        why: {
          text: '切换模型',
          routeReason: {
            policy: 'cost',
            matchedEndpoint: `http://api.example.com?key=${FAKE_KEY_1}`,
            rejectedEndpoints: [`http://b.example.com?token=${FAKE_KEY_2}`],
          },
        },
      }),
      testDir,
    );
    const [entry] = readEntries(testDir);
    expect(entry!.why.routeReason!.matchedEndpoint).toContain('REDACTED');
    expect(entry!.why.routeReason!.matchedEndpoint).not.toContain(FAKE_KEY_1);
    expect(entry!.why.routeReason!.rejectedEndpoints![0]).toContain('REDACTED');
    expect(entry!.why.routeReason!.rejectedEndpoints![0]).not.toContain(FAKE_KEY_2);
  });

  it('防篡改链——带 routeReason 条目写入后链校验通过', () => {
    emitDecision(
      makeInput({
        why: { text: '第一条', routeReason: { policy: 'default' } },
      }),
      testDir,
    );
    emitDecision(
      makeInput({ sessionId: 's2', why: { text: '第二条', routeReason: { policy: 'cost', decisionScore: 1 } } }),
      testDir,
    );
    const result = checkDecisionChainDetailed(testDir);
    expect(result.status).toBe('ok');
  });

  it('sanitizeWhy 纯函数——routeReason 各字段逐项脱敏且 policy/decisionScore 原样保留', () => {
    const why: DecisionWhy = {
      text: '测试',
      routeReason: {
        policy: 'latency',
        matchedEndpoint: 'http://fast-endpoint:9000',
        rejectedEndpoints: [],
        decisionScore: 0.5,
      },
    };
    const sanitized = sanitizeWhy(why);
    expect(sanitized.routeReason!.policy).toBe('latency');
    expect(sanitized.routeReason!.decisionScore).toBe(0.5);
    expect(sanitized.routeReason!.rejectedEndpoints).toEqual([]);
    expect(sanitized.routeReason!.matchedEndpoint).toBe('http://fast-endpoint:9000');
  });
});
