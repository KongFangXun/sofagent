// ============================================================
// intent-channel.test.ts · 审计输入双通道（调用意图 + 结果文本）单测（v1.5.1 第七章）
// ============================================================
// 覆盖（对齐第七章验收逐条）：
//   · 意图落盘（`tools/pre-execute` → intent.jsonl）——工具名 / 参数摘要 / 会话标识 / 时间戳
//   · 脱敏生效且**原始参数不入盘**（既有脱敏管线 REDACTION_PATTERNS，含嵌套参数）
//   · 双通道判定 + 默认通道回归（未声明通道的规则 → 结果通道，行为零变化）
//   · 意图与结果**同链留痕**（链条目类型可区分，举证可对照）
//   · 哈希输入扩展连带核：entryType 进签名（改类型 = 篡改）+ 未传 entryType 时
//     哈希输入逐字不变（既有权威常量重锚）
//   · 零执行权限：订阅面只有 `ctx.on`，且监听器不调 `next`、不返回判定
//   · 容错：防御式订阅 / 落盘失败不中断 / 不可归因不落盘 / 读侧坏行跳过
//
// 隔离纪律（同 chain-kernel.test.ts）：独立 mkdtemp 目录；**密钥与环境指纹显式注入**
// （默认解析分支单独用 SOFAGENT_KEY_PATH 隔离）——真实 ~/.sofagent-key 与真实 data 零接触。
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { createHash } from 'crypto';
import {
  createIntentChannel,
  readIntentEntries,
  readIntentSkips,
  recordIntentSkip,
  resolveInputChannels,
  resolveIntentLogPath,
  resolveIntentSkipLogPath,
  ruleSupportsChannel,
  sanitizeArgsSummary,
  summarizeIntentChannel,
  INTENT_LOG_FILENAME,
  INTENT_SKIP_LOG_FILENAME,
  type IntentEventContext,
} from '../intent-channel';
import { appendChained, verifyChain, ChainKernelError } from '../chain-kernel';
import { defaultRules, extendedRules } from '../rules';
import type { AuditInputChannel } from '../rules/types';
import { log } from '../logger';
import { getEnvFingerprint } from '@sofagent/core';

/** 与 chain-kernel.test.ts 同款固定密钥 / 固定指纹（硬锚输入全为常量） */
const TEST_KEY = 'intent-channel-key-0123456789abcdef';
const TEST_FP = 'intentfp';

/** golden 重锚用常量（与 chain-kernel.test.ts 逐字一致——未传 entryType 时必须零漂移） */
const GOLDEN_KEY = 'golden-vector-key-0123456789abcdef';
const GOLDEN_FP = 'goldenfp';
const GOLDEN_RECORD1 = {
  ts: '2026-01-01T00:00:00.000Z',
  kind: 'TOOL_GATE',
  agentId: 'engineer',
  sessionId: 'sess-golden',
  moment: 'ACT',
  why: { text: 'golden' },
  engine: 'sofagent-audit',
};
const GOLDEN_HMAC_1 = '98456bc81aaa8d223784f572fbb0bfd7';

let dir: string;
let savedKeyPath: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sofagent-intent-channel-'));
  savedKeyPath = process.env.SOFAGENT_KEY_PATH;
});

afterEach(() => {
  if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
  else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
  rmSync(dir, { recursive: true, force: true });
});

// ════════════════════════════════════════
// 工具 / Helpers
// ════════════════════════════════════════

/** 读 JSONL 文件为条目数组 */
function readLines(filePath: string): Record<string, unknown>[] {
  return readFileSync(filePath, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/**
 * 只读订阅面 ctx（零执行权限的机械证明）：Proxy 只放行 `on`——
 * 意图通道一旦触碰 `waterfall` / `next` / 任何宿主执行面，本测试立即抛错。
 */
function readonlyCtx(): {
  ctx: IntentEventContext;
  listeners: Map<string, (...args: unknown[]) => unknown>;
} {
  const listeners = new Map<string, (...args: unknown[]) => unknown>();
  const base = {
    on(event: string, listener: (...args: unknown[]) => unknown): () => void {
      listeners.set(event, listener);
      return () => listeners.delete(event);
    },
  };
  const ctx = new Proxy(base, {
    get(target, prop, receiver) {
      if (prop !== 'on') {
        throw new Error(`意图通道访问了非只读订阅面：${String(prop)}（审计对意图流只有只读消费权）`);
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as unknown as IntentEventContext;
  return { ctx, listeners };
}

/** 造一条宿主 `tools/pre-execute` 事件载荷（形状对齐 DSH 插件 seam 实测面） */
function preExecuteExec(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'run_bash',
    arguments: { command: 'rm -rf /tmp/demo' },
    callId: 'call-1',
    agent: { id: 'engineer', session: { id: 'sess-1' } },
    ...over,
  };
}

/** 复刻内核 prevHash 算法（校验链链接；输入取**文件里的前一条**，与内核读侧同源） */
function expectedPrevHash(prev: Record<string, unknown>, fp: string): string {
  return createHash('sha256')
    .update(JSON.stringify({ ...prev, prevHash: undefined, hashVersion: undefined }) + '|' + fp)
    .digest('hex')
    .slice(0, 16);
}

/** 造一个已挂载的意图通道（固定密钥 / 固定指纹） */
function mountChannel(dataDir = dir) {
  const channel = createIntentChannel({ dataDir, key: TEST_KEY, fingerprint: TEST_FP });
  const { ctx, listeners } = readonlyCtx();
  const dispose = channel.plugin(ctx);
  return { channel, listeners, dispose };
}

// ════════════════════════════════════════
// 一、意图落盘（tools/pre-execute → intent.jsonl）
// ════════════════════════════════════════

describe('第七章 · 意图落盘', () => {
  it('test_pre-execute事件落intent.jsonl_工具名与参数摘要与会话标识与时间戳齐备', () => {
    const { channel, listeners } = mountChannel();
    listeners.get('tools/pre-execute')!(preExecuteExec());

    expect(channel.filePath).toBe(join(dir, 'audit', INTENT_LOG_FILENAME));
    const rows = readLines(channel.filePath);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.entryType).toBe('intent');
    expect(row.channel).toBe('intent');
    expect(row.tool).toBe('run_bash');
    expect(row.sessionId).toBe('sess-1');
    expect(row.agentId).toBe('engineer');
    expect(row.callId).toBe('call-1');
    expect(typeof row.ts).toBe('string');
    expect(Number.isNaN(Date.parse(row.ts as string))).toBe(false);
    // 参数摘要带上了「想做什么」——结果文本通道看不见的那一面
    expect(row.argsSummary).toEqual({ command: 'rm -rf /tmp/demo' });
    // 链字段齐备（走既有链内核，不是裸 append）
    expect(row.prevHash).toBe('genesis');
    expect(row.hashVersion).toBe(2);
    expect(typeof row.hmacSig).toBe('string');
    expect((row.hmacSig as string).length).toBe(32);
  });

  it('test_订阅的事件域与audit插件seamHandlers逐字一致', () => {
    const { listeners } = mountChannel();
    expect([...listeners.keys()]).toEqual(['tools/pre-execute', 'tools/result']);
  });

  it('test_落盘路径与history.jsonl同目录解析口径', () => {
    expect(resolveIntentLogPath(dir)).toBe(join(dir, 'audit', INTENT_LOG_FILENAME));
  });

  it('test_密钥与指纹缺省时走既有解析面（SOFAGENT_KEY_PATH隔离_不碰真实密钥）', () => {
    const keyFile = join(dir, '.sofagent-key');
    writeFileSync(keyFile, TEST_KEY, { mode: 0o600 });
    process.env.SOFAGENT_KEY_PATH = keyFile;
    const channel = createIntentChannel({ dataDir: dir }); // key / fingerprint 两条均缺省
    channel.handle('tools/pre-execute', [preExecuteExec()]);
    channel.handle('tools/pre-execute', [preExecuteExec({ callId: 'call-2' })]);
    const rows = readLines(channel.filePath);
    expect(rows).toHaveLength(2);
    // 缺省指纹 = core 现算真值（与 history.jsonl 链同源解析，不另造）
    expect(rows[0]!.envFingerprint).toBe(getEnvFingerprint(dir));
    expect(rows[0]!.hmacAlgo).toBe('stable');
    // 缺省密钥 = SOFAGENT_KEY_PATH 指向的密钥 → 链可验签（证明两条缺省分支都真解到了值）
    expect(verifyChain(rows, { key: TEST_KEY, fingerprint: getEnvFingerprint(dir) }).status).toBe('ok');
  });
});

// ════════════════════════════════════════
// 二、脱敏（原始参数不入盘）
// ════════════════════════════════════════

describe('第七章 · 脱敏生效（原始参数不入盘）', () => {
  const RAW_SK = `sk-proj-${'A'.repeat(40)}`;
  const RAW_AKIA = 'AKIAIOSFODNN7EXAMPLE';
  const RAW_PHONE = '13800138000';

  it('test_参数经脱敏管线_原始参数逐字不入盘', () => {
    const { channel, listeners } = mountChannel();
    listeners.get('tools/pre-execute')!(
      preExecuteExec({
        arguments: {
          command: `curl -H "Authorization: Bearer ${RAW_SK}" https://example.com`,
          token: RAW_SK,
          phone: RAW_PHONE,
        },
      }),
    );

    const rawText = readFileSync(channel.filePath, 'utf-8');
    // 断言：原始参数**逐字**不入盘（密钥 / 手机号 / 嵌套族）
    expect(rawText).not.toContain(RAW_SK);
    expect(rawText).not.toContain(RAW_PHONE);
    // 断言：脱敏占位符在场（不是「因为没写参数所以没泄漏」）
    expect(rawText).toContain('sk-proj-***REDACTED***');
    expect(rawText).toContain('1**REDACTED***');
  });

  it('test_嵌套参数先序列化再整体过管道_嵌套密钥同样打码', () => {
    const { channel, listeners } = mountChannel();
    listeners.get('tools/pre-execute')!(
      preExecuteExec({ arguments: { payload: { nested: { apiKey: RAW_AKIA }, list: [RAW_PHONE] } } }),
    );
    const rawText = readFileSync(channel.filePath, 'utf-8');
    expect(rawText).not.toContain(RAW_AKIA);
    expect(rawText).not.toContain(RAW_PHONE);
    expect(rawText).toContain('AKIA***REDACTED***');
  });

  it('test_工具的result事件参数同样过脱敏管线', () => {
    const { channel, listeners } = mountChannel();
    listeners.get('tools/result')!(
      preExecuteExec({ arguments: { env: { OPENAI_API_KEY: RAW_SK } } }),
      { isError: false, output: 'ok' },
    );
    const rawText = readFileSync(channel.filePath, 'utf-8');
    expect(rawText).not.toContain(RAW_SK);
    expect(readLines(channel.filePath)[0]!.entryType).toBe('result');
  });

  it('test_工具名等非参数字段同样过脱敏管线（工具名是模型产出）', () => {
    const { channel, listeners } = mountChannel();
    listeners.get('tools/pre-execute')!(preExecuteExec({ name: `run_${RAW_SK}`, callId: RAW_AKIA }));
    const rawText = readFileSync(channel.filePath, 'utf-8');
    expect(rawText).not.toContain(RAW_SK);
    expect(rawText).not.toContain(RAW_AKIA);
    const row = readLines(channel.filePath)[0]!;
    expect(row.tool).toBe('run_sk-proj-***REDACTED***');
    expect(row.callId).toBe('AKIA***REDACTED***');
  });

  it('test_参数摘要脱敏在截断之前_长值不产生半个明文密钥', () => {
    // 明文超过截断上限：若顺序颠倒（先截断后脱敏），尾部残缺 token 会留下可爆破前缀。
    const longSecret = `sk-proj-${'B'.repeat(600)}`;
    const summary = sanitizeArgsSummary({ blob: `${longSecret}${'x'.repeat(600)}` });
    expect(summary.blob).not.toContain('sk-proj-BBB');
    expect(summary.blob).toContain('sk-proj-***REDACTED***');
    expect(summary.blob!.length).toBeLessThanOrEqual(301);
  });

  it('test_非对象参数返回空摘要_不猜测', () => {
    expect(sanitizeArgsSummary(undefined)).toEqual({});
    expect(sanitizeArgsSummary(null)).toEqual({});
    expect(sanitizeArgsSummary('rm -rf /')).toEqual({});
    expect(sanitizeArgsSummary(['a', 'b'])).toEqual({});
  });
});

// ════════════════════════════════════════
// 三、双通道判定 + 默认通道回归
// ════════════════════════════════════════

describe('第七章 · 规则可显式声明输入通道（默认结果通道）', () => {
  it('test_未声明通道_默认结果通道', () => {
    expect(resolveInputChannels({})).toEqual(['result']);
    expect(resolveInputChannels({ inputChannels: undefined })).toEqual(['result']);
    expect(resolveInputChannels({ inputChannels: [] })).toEqual(['result']);
    expect(ruleSupportsChannel({}, 'result')).toBe(true);
    expect(ruleSupportsChannel({}, 'intent')).toBe(false);
  });

  it('test_显式声明意图通道_opt-in生效', () => {
    const rule: { inputChannels?: AuditInputChannel[] } = { inputChannels: ['intent'] };
    expect(resolveInputChannels(rule)).toEqual(['intent']);
    expect(ruleSupportsChannel(rule, 'intent')).toBe(true);
    expect(ruleSupportsChannel(rule, 'result')).toBe(false);
  });

  it('test_双通道同时声明_两条输入面都可用', () => {
    const rule: { inputChannels?: AuditInputChannel[] } = { inputChannels: ['result', 'intent'] };
    expect(resolveInputChannels(rule)).toEqual(['result', 'intent']);
    expect(ruleSupportsChannel(rule, 'result')).toBe(true);
    expect(ruleSupportsChannel(rule, 'intent')).toBe(true);
  });

  it('test_默认通道回归_既有24条规则零声明_行为零变化', () => {
    const all = [...defaultRules, ...extendedRules];
    expect(all).toHaveLength(24);
    // 逐条断言：全部走默认结果通道，无一条进入意图通道（本章不新增规则、不改判定）
    for (const rule of all) {
      expect(rule.inputChannels, `${rule.id} 意外声明了输入通道`).toBeUndefined();
      expect(resolveInputChannels(rule)).toEqual(['result']);
      expect(ruleSupportsChannel(rule, 'intent')).toBe(false);
    }
  });
});

// ════════════════════════════════════════
// 四、同链留痕（意图与结果条目类型可区分）
// ════════════════════════════════════════

describe('第七章 · 意图与结果同链留痕', () => {
  it('test_意图与结果落同一条链_条目类型可区分且链链接成立', () => {
    const { channel, listeners } = mountChannel();
    listeners.get('tools/pre-execute')!(preExecuteExec());
    listeners.get('tools/result')!(preExecuteExec(), { isError: true, output: 'boom' });

    const rows = readLines(channel.filePath);
    expect(rows).toHaveLength(2);
    // 条目类型可区分（举证：这一条是「想做什么」，那一条是「做成了什么」）
    expect(rows.map((r) => r.entryType)).toEqual(['intent', 'result']);
    // 同一次调用可对照（callId 相同）
    expect(rows[0]!.callId).toBe(rows[1]!.callId);
    expect(rows[1]!.outcome).toBe('error');
    // 同一条链：第二条 prevHash = 第一条的重算值
    expect(rows[0]!.prevHash).toBe('genesis');
    expect(rows[1]!.prevHash).toBe(expectedPrevHash(rows[0]!, TEST_FP));
    expect(rows[1]!.prevHash).not.toBe('genesis');
    // 链完整性（含 HMAC）
    expect(verifyChain(rows, { key: TEST_KEY, fingerprint: TEST_FP }).status).toBe('ok');
  });

  it('test_结果事件与意图事件可交替落链_链仍完整', () => {
    const { channel, listeners } = mountChannel();
    const order = ['tools/pre-execute', 'tools/result', 'tools/pre-execute', 'tools/result'] as const;
    for (const ev of order) {
      listeners.get(ev)!(preExecuteExec({ callId: `call-${ev === 'tools/pre-execute' ? 'a' : 'b'}` }), { isError: false });
    }
    const rows = readLines(channel.filePath);
    expect(rows.map((r) => r.entryType)).toEqual(['intent', 'result', 'intent', 'result']);
    expect(verifyChain(rows, { key: TEST_KEY, fingerprint: TEST_FP }).status).toBe('ok');
  });
});

// ════════════════════════════════════════
// 五、哈希输入扩展连带核（entryType 入签名 + golden 重锚）
// ════════════════════════════════════════

describe('第七章 · 链条目类型进哈希输入（连带回归）', () => {
  it('test_同内容不同条目类型_hmacSig必不同（类型在签名输入内）', () => {
    const record = { ts: '2026-01-01T00:00:00.000Z', tool: 'run_bash', sessionId: 's' };
    const asIntent = appendChained(record, {
      filePath: join(dir, 'intent-only.jsonl'),
      validKinds: ['intent', 'result'],
      kindField: 'entryType',
      entryType: 'intent',
      key: TEST_KEY,
      fingerprint: TEST_FP,
    });
    const asResult = appendChained(record, {
      filePath: join(dir, 'result-only.jsonl'),
      validKinds: ['intent', 'result'],
      kindField: 'entryType',
      entryType: 'result',
      key: TEST_KEY,
      fingerprint: TEST_FP,
    });
    expect(asIntent.entryType).toBe('intent');
    expect(asResult.entryType).toBe('result');
    expect(asIntent.hmacSig).not.toBe(asResult.hmacSig);
  });

  it('test_篡改条目类型_保留原签名_判tampered（类型不可被静默改标）', () => {
    const { channel, listeners } = mountChannel();
    listeners.get('tools/pre-execute')!(preExecuteExec());
    listeners.get('tools/pre-execute')!(preExecuteExec({ callId: 'call-2' }));

    const filePath = channel.filePath;
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
    const tampered = JSON.parse(lines[1]!) as Record<string, unknown>;
    tampered.entryType = 'result'; // 把第 2 条「意图」改标成「结果」，签名原样保留
    lines[1] = JSON.stringify(tampered);
    writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');

    const result = verifyChain(readLines(filePath), { key: TEST_KEY, fingerprint: TEST_FP });
    expect(result.status).toBe('tampered');
    expect(result.index).toBe(1);
  });

  it('test_非法条目类型_被调用方白名单kind门挡住', () => {
    expect(() =>
      appendChained(
        { ts: '2026-01-01T00:00:00.000Z' },
        {
          filePath: join(dir, 'bad.jsonl'),
          validKinds: ['intent', 'result'],
          kindField: 'entryType',
          // @ts-expect-error 故意传枚举外值——核验 kind 门（调用方自持白名单）
          entryType: 'forged',
          key: TEST_KEY,
          fingerprint: TEST_FP,
        },
      ),
    ).toThrow(ChainKernelError);
  });

  it('test_未传entryType_哈希输入逐字不变（既有权威常量重锚）', () => {
    const filePath = join(dir, 'golden-anchor.jsonl');
    const entry = appendChained({ ...GOLDEN_RECORD1 }, {
      filePath,
      validKinds: ['TOOL_GATE'],
      key: GOLDEN_KEY,
      fingerprint: GOLDEN_FP,
    });
    expect(entry.prevHash).toBe('genesis');
    expect(entry.hmacSig).toBe(GOLDEN_HMAC_1);
    expect(entry.entryType).toBeUndefined();
    expect('entryType' in entry).toBe(false);
  });

  it('test_未传entryType_不改动调用方入参对象（浅拷贝注入）', () => {
    const record: Record<string, unknown> = { ts: '2026-01-01T00:00:00.000Z', kind: 'TOOL_GATE' };
    appendChained(record, {
      filePath: join(dir, 'no-mutate-a.jsonl'),
      validKinds: ['TOOL_GATE'],
      key: TEST_KEY,
      fingerprint: TEST_FP,
    });
    expect(record.entryType).toBeUndefined();
    expect(Object.keys(record)).toEqual(['ts', 'kind']);

    const record2: Record<string, unknown> = { ts: '2026-01-01T00:00:00.000Z' };
    appendChained(record2, {
      filePath: join(dir, 'no-mutate-b.jsonl'),
      validKinds: ['intent'],
      kindField: 'entryType',
      entryType: 'intent',
      key: TEST_KEY,
      fingerprint: TEST_FP,
    });
    expect(record2.entryType).toBeUndefined(); // 注入发生在内核侧副本上
  });
});

// ════════════════════════════════════════
// 六、零执行权限（只读消费 + 落盘）
// ════════════════════════════════════════

describe('第七章 · 审计零执行权限不变', () => {
  it('test_只注册观察面订阅_不触碰waterfall等执行面（Proxy只放行on）', () => {
    const channel = createIntentChannel({ dataDir: dir, key: TEST_KEY, fingerprint: TEST_FP });
    const { ctx, listeners } = readonlyCtx();
    const dispose = channel.plugin(ctx); // ctx 只放行 on——触碰任何执行面即抛错
    expect([...listeners.keys()].sort()).toEqual(['tools/pre-execute', 'tools/result']);
    expect(() => dispose()).not.toThrow();
  });

  it('test_监听器不调用next_不返回任何判定（拦截能力不在审计）', () => {
    const { listeners } = mountChannel();
    const next = vi.fn();
    for (const ev of ['tools/pre-execute', 'tools/result']) {
      const ret = listeners.get(ev)!(preExecuteExec(), next);
      expect(next).not.toHaveBeenCalled();
      expect(ret).toBeUndefined(); // 无 deny/allow 语义——审计不取得拦截权
    }
  });

  it('test_订阅失败逐事件降级_不影响宿主执行', () => {
    const calls: string[] = [];
    const ctx: IntentEventContext = {
      on(event: string): () => void {
        calls.push(event);
        if (event === 'tools/result') throw new Error('事件域不存在');
        return () => {};
      },
    };
    const channel = createIntentChannel({ dataDir: dir, key: TEST_KEY, fingerprint: TEST_FP });
    const dispose = channel.plugin(ctx); // 不抛
    expect(calls).toEqual(['tools/pre-execute', 'tools/result']);
    expect(() => dispose()).not.toThrow();
  });

  it('test_落盘失败不冒泡到宿主_仅可见告警并丢该条', () => {
    const blocker = join(dir, 'blocker');
    writeFileSync(blocker, 'not-a-dir', 'utf-8'); // 用「文件」冒充数据目录 → mkdir 必失败
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const channel = createIntentChannel({ dataDir: blocker, key: TEST_KEY, fingerprint: TEST_FP });
      expect(() => channel.handle('tools/pre-execute', [preExecuteExec()])).not.toThrow();
      expect(channel.entries).toHaveLength(0);
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});

// ════════════════════════════════════════
// 七、容错 / 读侧
// ════════════════════════════════════════

describe('第七章 · 容错与读侧', () => {
  it('test_无工具名不落盘_不可归因不猜测', () => {
    const { channel, listeners } = mountChannel();
    listeners.get('tools/pre-execute')!({ arguments: { command: 'rm -rf /' }, agent: { session: { id: 's' } } });
    expect(channel.entries).toHaveLength(0);
    expect(() => readFileSync(channel.filePath, 'utf-8')).toThrow();
  });

  it('test_事件域以外的调用不落盘', () => {
    const channel = createIntentChannel({ dataDir: dir, key: TEST_KEY, fingerprint: TEST_FP });
    channel.handle('agent/turn-stopped', [preExecuteExec()]);
    channel.handle('fs/write-intent', [preExecuteExec()]);
    expect(channel.entries).toHaveLength(0);
  });

  it('test_会话标识不可达时显式unknown而非丢弃条目', () => {
    const { channel, listeners } = mountChannel();
    listeners.get('tools/pre-execute')!({ name: 'run_bash', arguments: { command: 'ls' } });
    expect(channel.entries).toHaveLength(1);
    expect(channel.entries[0]!.sessionId).toBe('unknown');
    expect(channel.entries[0]!.agentId).toBeUndefined();
  });

  it('test_参数名兼容arguments与args与params三种形态', () => {
    const { channel, listeners } = mountChannel();
    listeners.get('tools/pre-execute')!({ name: 't1', args: { path: '/a' }, agent: { session: { id: 's' } } });
    listeners.get('tools/pre-execute')!({ name: 't2', params: { path: '/b' }, agent: { session: { id: 's' } } });
    expect(channel.entries.map((e) => e.argsSummary)).toEqual([{ path: '/a' }, { path: '/b' }]);
  });

  it('test_读侧_文件不存在返回空_坏行跳过_非法条目过滤', () => {
    expect(readIntentEntries(join(dir, 'nope.jsonl'))).toEqual([]);
    const filePath = join(dir, 'mixed.jsonl');
    writeFileSync(
      filePath,
      [
        JSON.stringify({ channel: 'intent', tool: 'run_bash', sessionId: 's', ts: 't' }),
        '{ 坏行，不是 JSON',
        JSON.stringify({ channel: 'bogus', tool: 'x', sessionId: 's', ts: 't' }),
        JSON.stringify({ channel: 'result', tool: 42, sessionId: 's', ts: 't' }),
        JSON.stringify({ channel: 'result', tool: 'read', sessionId: 's', ts: 't' }),
      ].join('\n') + '\n',
      'utf-8',
    );
    const rows = readIntentEntries(filePath);
    expect(rows.map((r) => r.tool)).toEqual(['run_bash', 'read']);
  });

  it('test_读回落盘条目_可装配规则的意图输入面', () => {
    const { channel, listeners } = mountChannel();
    listeners.get('tools/pre-execute')!(preExecuteExec());
    const rows = readIntentEntries(channel.filePath);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.channel).toBe('intent');
    expect(rows[0]!.argsSummary?.command).toBe('rm -rf /tmp/demo');
  });
});

// ════════════════════════════════════════
// 八、跳失留痕（收口 · 「跳过」必须可审计）
// ════════════════════════════════════════
//
// 背景：宿主侧有一条纪律「身份不可达 ⇒ 跳过留证，不猜测」。若这条纪律只打日志，
// 运维就分不清「宿主没有工具调用」与「每次调用都被挡下」——磁盘状态都是「没有
// intent.jsonl」。本组的断言面 = 跳过的事实必须**落盘可查**，且**不污染调用证据面**。

describe('第七章 · 跳失留痕（跳过必须可审计）', () => {
  const RAW_SK = `sk-proj-${'A'.repeat(40)}`;

  it('test_跳失落盘intent-skips.jsonl_与调用证据同目录同解析_字段齐备且不进链', () => {
    const rec = recordIntentSkip(dir, {
      reason: 'identity-unreachable',
      event: 'tools/pre-execute',
      tool: 'run_bash',
    });
    expect(rec).not.toBeNull();
    expect(rec!.reason).toBe('identity-unreachable');
    expect(rec!.event).toBe('tools/pre-execute');
    expect(Number.isNaN(Date.parse(rec!.ts))).toBe(false);

    // 路径：与 intent.jsonl 同目录同解析（只换文件名——不造第二套路径解析）
    expect(resolveIntentSkipLogPath(dir)).toBe(join(dir, 'audit', INTENT_SKIP_LOG_FILENAME));
    expect(dirname(resolveIntentSkipLogPath(dir))).toBe(dirname(resolveIntentLogPath(dir)));

    // 内容：进盘不进链——活性证据不做完整性声明，故四个链字段一个都不该有
    const row = readLines(resolveIntentSkipLogPath(dir))[0]!;
    expect(row.reason).toBe('identity-unreachable');
    expect(row.tool).toBe('run_bash');
    expect(row.prevHash).toBeUndefined();
    expect(row.hashVersion).toBeUndefined();
    expect(row.hmacSig).toBeUndefined();
    expect(row.envFingerprint).toBeUndefined();

    // 读侧回得来（运维查询面，不是只写不可读的黑洞）
    expect(readIntentSkips(resolveIntentSkipLogPath(dir))).toEqual([rec]);
  });

  it('test_跳失不污染调用证据面_意图与结果条目零影响', () => {
    const { channel, listeners } = mountChannel();
    listeners.get('tools/pre-execute')!(preExecuteExec());
    recordIntentSkip(dir, { reason: 'identity-unreachable', event: 'tools/pre-execute', tool: 'run_bash' });

    // 规则输入面（readIntentEntries）只看见真实调用条目：跳失不进这个面
    const rows = readIntentEntries(channel.filePath);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tool).toBe('run_bash');
    expect(rows[0]!.entryType).toBe('intent');
    // 另一面同时存在（两个文件、两种语义——不是互相覆盖）
    expect(readIntentSkips(resolveIntentSkipLogPath(dir))).toHaveLength(1);
  });

  it('test_跳失记录的工具名同样过脱敏管线（工具名是模型产出）', () => {
    recordIntentSkip(dir, { reason: 'tool-unattributable', event: 'tools/result', tool: `run_${RAW_SK}` });
    const raw = readFileSync(resolveIntentSkipLogPath(dir), 'utf-8');
    expect(raw).not.toContain(RAW_SK);
    expect(readIntentSkips(resolveIntentSkipLogPath(dir))[0]!.tool).toBe('run_sk-proj-***REDACTED***');
  });

  it('test_写失败返回null不抛_仅可见告警（fail-open，留证故障不升级为宿主故障）', () => {
    const blocker = join(dir, 'skip-blocker');
    writeFileSync(blocker, 'not-a-dir', 'utf-8'); // 用「文件」冒充数据目录 → mkdir 必失败
    const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
    try {
      let rec: unknown;
      expect(() => {
        rec = recordIntentSkip(blocker, { reason: 'identity-unreachable', event: 'tools/pre-execute' });
      }).not.toThrow();
      expect(rec).toBeNull();
      expect(warnSpy).toHaveBeenCalled(); // 降级可见（不是静默吞错）
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('test_读侧_文件不存在返回空_坏行与非法形态跳过', () => {
    expect(readIntentSkips(join(dir, 'nope.jsonl'))).toEqual([]);
    const filePath = join(dir, 'skips-mixed.jsonl');
    writeFileSync(
      filePath,
      [
        JSON.stringify({ ts: 't', reason: 'identity-unreachable', event: 'tools/pre-execute' }),
        '{ 坏行，不是 JSON',
        JSON.stringify({ ts: 't', reason: 'bogus', event: 'tools/pre-execute' }),
        JSON.stringify({ ts: 't', reason: 'tool-unattributable', event: 42 }),
        JSON.stringify({ ts: 't', reason: 'tool-unattributable', event: 'tools/result' }),
      ].join('\n') + '\n',
      'utf-8',
    );
    expect(readIntentSkips(filePath).map((r) => r.reason)).toEqual([
      'identity-unreachable',
      'tool-unattributable',
    ]);
  });

  it('test_活性快照三态_idle_skipped-only_recording（陌生运维只读盘即可判定）', () => {
    // ① 两者皆空：尚未发生工具调用事件（或通道未挂载）——不谎报「在工作」
    const idle = summarizeIntentChannel(dir);
    expect(idle.verdict).toBe('idle');
    expect(idle.intentEntries).toBe(0);
    expect(idle.skipped).toBe(0);
    expect(idle.intentLog).toBe(join(dir, 'audit', INTENT_LOG_FILENAME));
    expect(idle.skipLog).toBe(join(dir, 'audit', INTENT_SKIP_LOG_FILENAME));

    // ② 有跳失无调用证据：接线在、但每次都被身份门挡下——按原因聚合能回答「为什么跳」
    recordIntentSkip(dir, { reason: 'identity-unreachable', event: 'tools/pre-execute', tool: 'run_bash' });
    recordIntentSkip(dir, { reason: 'identity-unreachable', event: 'tools/result', tool: 'run_bash' });
    const skippedOnly = summarizeIntentChannel(dir);
    expect(skippedOnly.verdict).toBe('skipped-only');
    expect(skippedOnly.skipped).toBe(2);
    expect(skippedOnly.skipReasons).toEqual({ 'identity-unreachable': 2 });
    expect(skippedOnly.intentEntries).toBe(0);
    expect(skippedOnly.lastSkip!.event).toBe('tools/result');

    // ③ 有调用证据：通道在工作（跳失计数并存——两个问题各自答得出来，不互相掩盖）
    const { listeners } = mountChannel();
    listeners.get('tools/pre-execute')!(preExecuteExec());
    const recording = summarizeIntentChannel(dir);
    expect(recording.verdict).toBe('recording');
    expect(recording.intentEntries).toBe(1);
    expect(recording.skipped).toBe(2);
  });

  // v1.5.1 修复批 B2：第三态补口——**身份可达但工具名缺失**时，原实现在此直接 return，
  // 既不落调用证据也不落跳失记录（'tool-unattributable' 枚举零生产发射点），
  // 「跳过必须可审计」在这条路径上不成立。本用例钉住补口后的行为。
  it('test_第三态_身份可达但工具名缺失_落跳失tool-unattributable且不落调用证据', () => {
    const { channel, listeners } = mountChannel();
    // exec 带完整身份但**无工具名**（宿主 exec 形状不全）——第三态：不是「没有调用」
    listeners.get('tools/pre-execute')!({
      callId: 'call-third',
      arguments: { command: 'rm -rf /tmp/demo' },
      agent: { id: 'engineer', session: { id: 'sess-third' } },
    });

    // 调用证据面：零条目（不可归因 → 不落，不猜测）
    expect(readIntentEntries(channel.filePath)).toHaveLength(0);
    // 跳失面：恰一条且 reason 为该枚举值（跳过可审计，不是黑洞）
    const skips = readIntentSkips(resolveIntentSkipLogPath(dir));
    expect(skips).toHaveLength(1);
    expect(skips[0]!.reason).toBe('tool-unattributable');
    expect(skips[0]!.event).toBe('tools/pre-execute');
    // 照旧不进链（活性证据不做完整性声明）
    expect(readLines(resolveIntentSkipLogPath(dir))[0]!.prevHash).toBeUndefined();
    // 活性快照据此把「接线在但每次都被挡下」与「宿主没调用」区分开
    expect(summarizeIntentChannel(dir).verdict).toBe('skipped-only');
  });
});

