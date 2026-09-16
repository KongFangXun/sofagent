// ============================================================
// chain-kernel.test.ts · HMAC 审计链协议内核测试（v1.4.8 第〇批收口）
// ============================================================
// 覆盖：
//   · golden vector 硬锚（固定密钥 + 固定记录 → hmacSig / prevHash 常量）——
//     这是「改 slice(0,32)/prevHash 长度会变红」的判据，且因两侧共用内核，
//     一次锚住 decision-log.jsonl 与 audit.jsonl 两条链。
//   · appendChained：kind 门（调用方自持白名单）/ kindField / 链字段装配 /
//     无密钥降级 / chmod 0600 / 错误工厂注入。
//   · verifyChain：ok / tampered / unverifiable / insufficient 四态。
//
// 隔离纪律：每个用例独立 mkdtemp 目录；**密钥与环境指纹显式注入**（不读环境）
// ——真实 ~/.sofagent-key 与真实 data 目录零接触。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { appendChained, verifyChain, ChainKernelError } from './chain-kernel';

/** golden vector 固定密钥 / 固定环境指纹（硬锚的全部输入均为常量——不读机器环境） */
const GOLDEN_KEY = 'golden-vector-key-0123456789abcdef';
const GOLDEN_FP = 'goldenfp';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sofagent-chain-kernel-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 固定记录 1（字段与值全为常量——golden 输入） */
function goldenRecord1(): Record<string, unknown> {
  return {
    ts: '2026-01-01T00:00:00.000Z',
    kind: 'TOOL_GATE',
    agentId: 'engineer',
    sessionId: 'sess-golden',
    moment: 'ACT',
    why: { text: 'golden' },
    engine: 'sofagent-audit',
  };
}

/** 固定记录 2（golden 输入——用于锚定 prevHash 链） */
function goldenRecord2(): Record<string, unknown> {
  return {
    ts: '2026-01-01T00:00:01.000Z',
    kind: 'TOOL_GATE',
    agentId: 'engineer',
    sessionId: 'sess-golden',
    moment: 'ACT',
    why: { text: 'golden-2' },
    engine: 'sofagent-audit',
  };
}

/** 读取 JSONL 并解析为条目数组 */
function readEntries(filePath: string): Record<string, unknown>[] {
  return readFileSync(filePath, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

// ════════════════════════════════════════
// 一、golden vector 硬锚
// ════════════════════════════════════════

describe('chain-kernel · golden vector 硬锚', () => {
  it('test_golden_首条_hmacSig常量_锚定HMAC协议', () => {
    const filePath = join(dir, 'golden.jsonl');
    const entry = appendChained(goldenRecord1(), {
      filePath,
      validKinds: ['TOOL_GATE'],
      key: GOLDEN_KEY,
      fingerprint: GOLDEN_FP,
    });
    // 硬锚：字面量常量（改 slice(0,32) → 变红）
    expect(entry.prevHash).toBe('genesis');
    expect(entry.hashVersion).toBe(2);
    expect(entry.envFingerprint).toBe('goldenfp');
    expect(entry.hmacAlgo).toBe('stable');
    expect(entry.hmacSig!.slice(0, 8)).toBe('98456bc8');
    expect(entry.hmacSig).toBe('98456bc81aaa8d223784f572fbb0bfd7');
    expect(entry.hmacSig!.length).toBe(32);
  });

  it('test_golden_第二条_prevHash与hmacSig常量_锚定链协议', () => {
    const filePath = join(dir, 'golden.jsonl');
    appendChained(goldenRecord1(), { filePath, validKinds: ['TOOL_GATE'], key: GOLDEN_KEY, fingerprint: GOLDEN_FP });
    const second = appendChained(goldenRecord2(), {
      filePath,
      validKinds: ['TOOL_GATE'],
      key: GOLDEN_KEY,
      fingerprint: GOLDEN_FP,
    });
    // 硬锚：字面量常量（改 prevHash slice(0,16) 或 hmacSig slice(0,32) → 变红）
    expect(second.prevHash.slice(0, 8)).toBe('96e6224e');
    expect(second.prevHash).toBe('96e6224e71e48b90');
    expect(second.hmacSig!.slice(0, 8)).toBe('e3359bfe');
    expect(second.hmacSig).toBe('e3359bfe1a78c4721f635dfec9d9b177');
  });
});

// ════════════════════════════════════════
// 二、appendChained
// ════════════════════════════════════════

describe('chain-kernel · appendChained', () => {
  it('test_合法kind_落盘一条_链字段齐全', () => {
    const filePath = join(dir, 'x.jsonl');
    appendChained(goldenRecord1(), { filePath, validKinds: ['TOOL_GATE'], key: GOLDEN_KEY, fingerprint: GOLDEN_FP });
    const entries = readEntries(filePath);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.prevHash).toBe('genesis');
    expect(typeof entries[0]!.hmacSig).toBe('string');
    expect((entries[0]!.hmacSig as string).length).toBe(32);
  });

  it('test_非法kind_缺省抛ChainKernelError_不写文件', () => {
    const filePath = join(dir, 'x.jsonl');
    expect(() =>
      appendChained(goldenRecord1(), { filePath, validKinds: ['OTHER'], key: GOLDEN_KEY, fingerprint: GOLDEN_FP }),
    ).toThrow(ChainKernelError);
    // 未写文件（kind 门在目录创建/追加之前）
    expect(() => readFileSync(filePath, 'utf-8')).toThrow();
  });

  it('test_非法kind_注入错误工厂_抛调用方错误类型', () => {
    const filePath = join(dir, 'x.jsonl');
    class CustomSchemaError extends Error {}
    expect(() =>
      appendChained(goldenRecord1(), {
        filePath,
        validKinds: ['OTHER'],
        key: GOLDEN_KEY,
        fingerprint: GOLDEN_FP,
        onInvalidKind: (kind) => new CustomSchemaError(`非法 kind ${String(kind)}`),
      }),
    ).toThrow(CustomSchemaError);
  });

  it('test_kindField可配置_train侧type字段', () => {
    const filePath = join(dir, 'x.jsonl');
    const record = { ts: '2026-01-01T00:00:00.000Z', type: 'train_job_started', trainJobId: 'job-1' };
    const entry = appendChained(record, {
      filePath,
      validKinds: ['train_job_started'],
      kindField: 'type',
      key: GOLDEN_KEY,
      fingerprint: GOLDEN_FP,
    });
    expect(entry.prevHash).toBe('genesis');
    expect(typeof entry.hmacSig).toBe('string');
    // 白名单不含该 type → 抛错
    expect(() =>
      appendChained(record, {
        filePath: join(dir, 'y.jsonl'),
        validKinds: ['other_event'],
        kindField: 'type',
        key: GOLDEN_KEY,
        fingerprint: GOLDEN_FP,
      }),
    ).toThrow(ChainKernelError);
  });

  it('test_无密钥_降级SHA256链_hmacSig缺省', () => {
    const filePath = join(dir, 'x.jsonl');
    const e1 = appendChained(goldenRecord1(), { filePath, validKinds: ['TOOL_GATE'], key: null, fingerprint: GOLDEN_FP });
    const e2 = appendChained(goldenRecord2(), { filePath, validKinds: ['TOOL_GATE'], key: null, fingerprint: GOLDEN_FP });
    expect(e1.hmacSig).toBeUndefined();
    expect(e1.hmacAlgo).toBeUndefined();
    expect(e2.prevHash).not.toBe('genesis');
    // 降级链仍可自洽校验
    expect(verifyChain(readEntries(filePath), { key: null, fingerprint: GOLDEN_FP }).status).toBe('ok');
  });

  it('test_落盘后文件权限0600', () => {
    const filePath = join(dir, 'x.jsonl');
    appendChained(goldenRecord1(), { filePath, validKinds: ['TOOL_GATE'], key: GOLDEN_KEY, fingerprint: GOLDEN_FP });
    expect(statSync(filePath).mode & 0o777).toBe(0o600);
    appendChained(goldenRecord2(), { filePath, validKinds: ['TOOL_GATE'], key: GOLDEN_KEY, fingerprint: GOLDEN_FP });
    expect(statSync(filePath).mode & 0o777).toBe(0o600);
  });

  it('test_目录创建失败_注入错误工厂_抛调用方错误类型', () => {
    // 用一个「文件」冒充目录——mkdirSync 必失败（ENOTDIR）
    const blocker = join(dir, 'blocker');
    writeFileSync(blocker, 'not-a-dir', 'utf-8');
    class CustomWriteError extends Error {}
    expect(() =>
      appendChained(goldenRecord1(), {
        filePath: join(blocker, 'x.jsonl'),
        validKinds: ['TOOL_GATE'],
        key: GOLDEN_KEY,
        fingerprint: GOLDEN_FP,
        onWriteError: (message) => new CustomWriteError(message),
      }),
    ).toThrow(CustomWriteError);
  });
});

// ════════════════════════════════════════
// 三、verifyChain 四态
// ════════════════════════════════════════

describe('chain-kernel · verifyChain', () => {
  it('test_不足2条_insufficient', () => {
    expect(verifyChain([], { key: GOLDEN_KEY, fingerprint: GOLDEN_FP }).status).toBe('insufficient');
    expect(verifyChain([goldenRecord1()], { key: GOLDEN_KEY, fingerprint: GOLDEN_FP }).status).toBe('insufficient');
  });

  it('test_连续两条_ok', () => {
    const filePath = join(dir, 'x.jsonl');
    appendChained(goldenRecord1(), { filePath, validKinds: ['TOOL_GATE'], key: GOLDEN_KEY, fingerprint: GOLDEN_FP });
    appendChained(goldenRecord2(), { filePath, validKinds: ['TOOL_GATE'], key: GOLDEN_KEY, fingerprint: GOLDEN_FP });
    expect(verifyChain(readEntries(filePath), { key: GOLDEN_KEY, fingerprint: GOLDEN_FP }).status).toBe('ok');
  });

  it('test_篡改第二条内容_指纹一致_tampered', () => {
    const filePath = join(dir, 'x.jsonl');
    appendChained(goldenRecord1(), { filePath, validKinds: ['TOOL_GATE'], key: GOLDEN_KEY, fingerprint: GOLDEN_FP });
    appendChained(goldenRecord2(), { filePath, validKinds: ['TOOL_GATE'], key: GOLDEN_KEY, fingerprint: GOLDEN_FP });
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
    const tampered = JSON.parse(lines[1]!) as Record<string, unknown>;
    tampered.why = { text: '被篡改' };
    lines[1] = JSON.stringify(tampered);
    writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');

    const result = verifyChain(readEntries(filePath), { key: GOLDEN_KEY, fingerprint: GOLDEN_FP });
    expect(result.status).toBe('tampered');
    expect(result.index).toBe(1);
    expect(result.detail).toContain('篡改');
  });

  it('test_篡改创世条目_指纹一致_tampered（篡改优先，对齐主循环与 core/audit-history）', () => {
    // v2 创世条目记录的 envFingerprint 与当前环境一致时，HMAC 不匹配只能是内容被改
    // ——与 verifyChain 主循环、checkHistoryChainDetailed 同判据，不再误归 unverifiable。
    const filePath = join(dir, 'x.jsonl');
    appendChained(goldenRecord1(), { filePath, validKinds: ['TOOL_GATE'], key: GOLDEN_KEY, fingerprint: GOLDEN_FP });
    appendChained(goldenRecord2(), { filePath, validKinds: ['TOOL_GATE'], key: GOLDEN_KEY, fingerprint: GOLDEN_FP });
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
    const genesis = JSON.parse(lines[0]!) as Record<string, unknown>;
    genesis.why = { text: '创世被篡改' };
    lines[0] = JSON.stringify(genesis);
    writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');

    const result = verifyChain(readEntries(filePath), { key: GOLDEN_KEY, fingerprint: GOLDEN_FP });
    expect(result.status).toBe('tampered');
    expect(result.index).toBe(0);
    expect(result.detail).toContain('创世条目');
  });

  it('test_环境指纹漂移_unverifiable', () => {
    const filePath = join(dir, 'x.jsonl');
    appendChained(goldenRecord1(), { filePath, validKinds: ['TOOL_GATE'], key: GOLDEN_KEY, fingerprint: GOLDEN_FP });
    appendChained(goldenRecord2(), { filePath, validKinds: ['TOOL_GATE'], key: GOLDEN_KEY, fingerprint: GOLDEN_FP });
    // 用不同指纹复验（= 换机器 / 密钥轮换 / 路径变化）
    const result = verifyChain(readEntries(filePath), { key: GOLDEN_KEY, fingerprint: 'other-fingerprint' });
    expect(result.status).toBe('unverifiable');
    expect(result.detail).toContain('不可复验');
  });

  it('test_密钥错误_指纹一致_tampered_指纹不一致_unverifiable', () => {
    const filePath = join(dir, 'x.jsonl');
    appendChained(goldenRecord1(), { filePath, validKinds: ['TOOL_GATE'], key: GOLDEN_KEY, fingerprint: GOLDEN_FP });
    appendChained(goldenRecord2(), { filePath, validKinds: ['TOOL_GATE'], key: GOLDEN_KEY, fingerprint: GOLDEN_FP });
    const entries = readEntries(filePath);
    // 指纹一致 + 密钥错 → HMAC 不匹配且指纹相同 → tampered
    expect(verifyChain(entries, { key: 'wrong-key', fingerprint: GOLDEN_FP }).status).toBe('tampered');
    // 指纹不一致 + 密钥错 → unverifiable
    expect(verifyChain(entries, { key: 'wrong-key', fingerprint: 'moved-host' }).status).toBe('unverifiable');
  });
});

// ════════════════════════════════════════
// 四、防 prevHash 短路 / 创世 stable 门控（v1.4.9 红队探针收编）
// ════════════════════════════════════════

describe('chain-kernel · verifyChain 防 prevHash 短路（红队探针回归）', () => {
  /** 构建合法 3 条链并返回文件路径 */
  function buildChain(): string {
    const filePath = join(dir, 'probe.jsonl');
    appendChained(goldenRecord1(), { filePath, validKinds: ['TOOL_GATE'], key: GOLDEN_KEY, fingerprint: GOLDEN_FP });
    appendChained(goldenRecord2(), { filePath, validKinds: ['TOOL_GATE'], key: GOLDEN_KEY, fingerprint: GOLDEN_FP });
    const third = { ...goldenRecord1(), ts: '2026-01-01T00:00:02.000Z' };
    appendChained(third, { filePath, validKinds: ['TOOL_GATE'], key: GOLDEN_KEY, fingerprint: GOLDEN_FP });
    return filePath;
  }

  it('test_防prevHash短路_篡改内容+保留hmacSig+prevHash置unknown_tampered', () => {
    // 红队探针收编：旧实现对 prevHash=='unknown' 直接 continue（位于 HMAC 验签之前），
    // 篡改内容 + prevHash 置 'unknown' 即整条免验返回 ok。签名输入排除 prevHash，
    // 故保留原 hmacSig 时内容篡改必然失配 → tampered（红），不得为 ok。
    const filePath = buildChain();
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
    const entry = JSON.parse(lines[1]!) as Record<string, unknown>;
    entry.why = { text: '被篡改' };
    entry.prevHash = 'unknown';
    lines[1] = JSON.stringify(entry);
    writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');

    const result = verifyChain(readEntries(filePath), { key: GOLDEN_KEY, fingerprint: GOLDEN_FP });
    expect(result.status).toBe('tampered');
    expect(result.index).toBe(1);
    expect(result.detail).toContain('篡改');
  });

  it('test_防prevHash短路_篡改内容+删hmacSig+prevHash置unknown_unverifiable', () => {
    // 内容被改 + 签名被剥 + prevHash 置 'unknown'：无签名可验 → 不可复验（黄），
    // 原因标记含 no-prevhash（链接缺失）与 signature-stripped（签名缺失），不得为 ok。
    const filePath = buildChain();
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
    const entry = JSON.parse(lines[1]!) as Record<string, unknown>;
    entry.why = { text: '被篡改' };
    entry.prevHash = 'unknown';
    delete entry.hmacSig;
    lines[1] = JSON.stringify(entry);
    writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');

    const result = verifyChain(readEntries(filePath), { key: GOLDEN_KEY, fingerprint: GOLDEN_FP });
    expect(result.status).toBe('unverifiable');
    expect(result.detail).toContain('no-prevhash');
    expect(result.detail).toContain('signature-stripped');
  });

  it('test_防prevHash短路_删除prevHash字段_内容未改_签名有效_unverifiable', () => {
    // 合法链删除中间条目的 prevHash 字段（内容未改、签名有效）：链接不可复验 → 黄，
    // 不得静默跳过后返回 ok。
    const filePath = buildChain();
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
    const entry = JSON.parse(lines[1]!) as Record<string, unknown>;
    delete entry.prevHash;
    lines[1] = JSON.stringify(entry);
    writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');

    const result = verifyChain(readEntries(filePath), { key: GOLDEN_KEY, fingerprint: GOLDEN_FP });
    expect(result.status).toBe('unverifiable');
    expect(result.detail).toContain('no-prevhash');
  });
});

describe('chain-kernel · verifyChain 创世 stable 门控（与 core/主循环同判据）', () => {
  it('test_创世非stable条目_指纹一致_HMAC失配_unverifiable非tampered', () => {
    // v2 非 stable 创世条目（指纹一致 + HMAC 失配）：与主循环 L416-418、
    // core/audit-history 创世分支同判据 → 不可复验（黄），不再误判 tampered（红）。
    const filePath = join(dir, 'x.jsonl');
    appendChained(goldenRecord1(), { filePath, validKinds: ['TOOL_GATE'], key: GOLDEN_KEY, fingerprint: GOLDEN_FP });
    appendChained(goldenRecord2(), { filePath, validKinds: ['TOOL_GATE'], key: GOLDEN_KEY, fingerprint: GOLDEN_FP });
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
    const genesis = JSON.parse(lines[0]!) as Record<string, unknown>;
    genesis.why = { text: '创世被篡改' };
    delete genesis.hmacAlgo;
    lines[0] = JSON.stringify(genesis);
    writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');

    const result = verifyChain(readEntries(filePath), { key: GOLDEN_KEY, fingerprint: GOLDEN_FP });
    expect(result.status).toBe('unverifiable');
    expect(result.detail).toContain('genesis-hmac-drift');
  });
});

describe('chain-kernel · verifyChain 防签名剥离（密钥在场，v1.4.9 审 F06）', () => {
  it('test_防签名剥离_密钥在场_创世条目删hmacSig_unverifiable', () => {
    // round-4 创世防剥离分支回归：密钥在场 + 创世条目无签名（被剥离或 legacy 未签名）
    // → 不可复验（黄），不得静默跳过返回 ok。
    const filePath = join(dir, 'x.jsonl');
    appendChained(goldenRecord1(), { filePath, validKinds: ['TOOL_GATE'], key: GOLDEN_KEY, fingerprint: GOLDEN_FP });
    appendChained(goldenRecord2(), { filePath, validKinds: ['TOOL_GATE'], key: GOLDEN_KEY, fingerprint: GOLDEN_FP });
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
    const genesis = JSON.parse(lines[0]!) as Record<string, unknown>;
    delete genesis.hmacSig;
    lines[0] = JSON.stringify(genesis);
    writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');

    const result = verifyChain(readEntries(filePath), { key: GOLDEN_KEY, fingerprint: GOLDEN_FP });
    expect(result.status).toBe('unverifiable');
    expect(result.detail).toContain('genesis-signature-stripped');
  });

  it('test_防签名剥离_密钥在场_中间条目删hmacSig_unverifiable非ok', () => {
    // round-4 主循环防剥离分支回归：密钥在场 + 中间条目签名被剥（内容与链接字段未动）
    // → 不可复验（黄），不得为 ok。
    const filePath = join(dir, 'x.jsonl');
    appendChained(goldenRecord1(), { filePath, validKinds: ['TOOL_GATE'], key: GOLDEN_KEY, fingerprint: GOLDEN_FP });
    appendChained(goldenRecord2(), { filePath, validKinds: ['TOOL_GATE'], key: GOLDEN_KEY, fingerprint: GOLDEN_FP });
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
    const entry = JSON.parse(lines[1]!) as Record<string, unknown>;
    delete entry.hmacSig;
    lines[1] = JSON.stringify(entry);
    writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');

    const result = verifyChain(readEntries(filePath), { key: GOLDEN_KEY, fingerprint: GOLDEN_FP });
    expect(result.status).toBe('unverifiable');
    expect(result.detail).toContain('signature-stripped');
  });
});
