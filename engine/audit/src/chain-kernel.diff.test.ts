// ============================================================
// chain-kernel.diff.test.ts · 验链内核差分一致性测试（F16）
// ============================================================
// 背景：验链逻辑存在双实现——audit/chain-kernel.ts verifyChain（纯函数，
// decision-log 等消费）与 core/audit-history.ts checkHistoryChainDetailed
// （文件驱动，doctor/审计历史消费）。两实现靠注释对齐，曾漏一次
// （no-prevhash 分支 kernel 侧继续验签、core 侧 continue 跳过——即 F01）。
// 本文件用同一批 fixture 双跑两实现，断言 status 判定一致——
// 任一侧改判定分支而另一侧未跟，这里即红（防再漂移的机械锁）。
//
// 差分面（status 级）：ok / tampered / unverifiable / insufficient 四态。
// detail 文案属各侧诊断输出，不要求逐字一致（判定域对齐即可）。
//
// 双侧输入对齐方式：
//   · kernel 侧收 { key, fingerprint } 参数；
//   · core 侧从 SOFAGENT_KEY_PATH 读密钥、getEnvFingerprint(dataDir) 现算指纹——
//     测试预先用同一 dataDir 算出真值 fp，fixture 与 kernel 参数共用它。
//
// 隔离纪律：同 chain-kernel.test.ts——独立 mkdtemp 目录，密钥经
// SOFAGENT_KEY_PATH 指向临时文件，零接触真实 ~/.sofagent-key 与 ~/.sofagent 数据。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash, createHmac } from 'crypto';
import { verifyChain } from './chain-kernel';
import { checkHistoryChainDetailed } from './audit-history';
import { getEnvFingerprint, stableStringify } from '@sofagent/core';

/** 与 chain-kernel.test.ts 同款固定密钥（指纹取真值，见文件头说明） */
const DIFF_KEY = 'diff-test-key-0123456789abcdef';

let dir: string;
let keyFile: string;
let savedKeyPath: string | undefined;
/** 本轮真值指纹——fixture 拼装与双侧校验共用 */
let fp: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sofagent-chain-diff-'));
  mkdirSync(join(dir, 'audit'), { recursive: true });
  // 密钥注入：core 侧 getHmacKey 走 SOFAGENT_KEY_PATH（既有测试同款隔离模式）
  savedKeyPath = process.env.SOFAGENT_KEY_PATH;
  keyFile = join(dir, '.sofagent-key');
  writeFileSync(keyFile, DIFF_KEY, { mode: 0o600 });
  process.env.SOFAGENT_KEY_PATH = keyFile;
  // 指纹注入：core 侧 checkHistoryChainDetailed 内部对同一 dataDir 现算，
  // 此处先行取得真值供 fixture 与 kernel 参数共用（两侧输入必然一致）
  fp = getEnvFingerprint(dir);
});

afterEach(() => {
  if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
  else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
  rmSync(dir, { recursive: true, force: true });
});

/**
 * 签名输入——排除全部链字段（prevHash / hashVersion / hmacSig / hmacAlgo），
 * 保留 envFingerprint。与两侧实现的 recordForSig 同构。
 */
function omitSigFields(entry: Record<string, unknown>): Record<string, unknown> {
  const { prevHash: _p, hashVersion: _v, hmacSig: _s, hmacAlgo: _a, ...rest } = entry;
  return rest;
}

/**
 * v2 链字段拼装（复刻双侧写入算法）：
 *   prevHash = sha256(JSON.stringify({...prev, prevHash: undefined, hashVersion: undefined})
 *                     + '|' + fp).slice(0,16)   ——注意保留 prev 的 hmacSig/hmacAlgo/envFingerprint
 *   hmacSig  = hmac(sha256, key, stableStringify(omitSigFields(entry)) + '|' + fp).slice(0,32)
 * 首条 prevHash = 'genesis'（与 appendChained 写侧同款）。
 */
function chainFieldsFor(
  entry: Record<string, unknown>,
  prev: Record<string, unknown> | null,
): { prevHash: string; hmacSig: string } {
  const prevHash =
    prev === null
      ? 'genesis'
      : createHash('sha256')
          .update(
            JSON.stringify({ ...prev, prevHash: undefined, hashVersion: undefined }) + '|' + fp,
          )
          .digest('hex')
          .slice(0, 16);
  const hmacSig = createHmac('sha256', DIFF_KEY)
    .update(stableStringify(omitSigFields(entry)) + '|' + fp)
    .digest('hex')
    .slice(0, 32);
  return { prevHash, hmacSig };
}

/** 造一条合法 v2 链式条目序列（hashVersion:2 + envFingerprint + hmacAlgo:'stable'） */
function buildChainedEntries(n: number): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) {
    const base: Record<string, unknown> = {
      timestamp: new Date(2026, 0, 1 + i).toISOString(),
      exitCode: 0,
      ruleId: 'A1',
      note: `entry-${i}`,
      hashVersion: 2,
      envFingerprint: fp,
      hmacAlgo: 'stable',
    };
    const fields = chainFieldsFor(base, i === 0 ? null : out[i - 1]!);
    out.push({ ...base, ...fields });
  }
  return out;
}

/** 造一条 legacy 链（无 v2 字段、无签名、prevHash 不带指纹后缀） */
function buildLegacyEntries(n: number): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) {
    const base: Record<string, unknown> = {
      timestamp: new Date(2026, 0, 1 + i).toISOString(),
      exitCode: 0,
      ruleId: 'A1',
      note: `legacy-${i}`,
    };
    const prevHash =
      i === 0
        ? 'genesis'
        : createHash('sha256')
            .update(JSON.stringify({ ...out[i - 1]!, prevHash: undefined }))
            .digest('hex')
            .slice(0, 16);
    out.push({ ...base, prevHash });
  }
  return out;
}

/** 写 core 侧 history.jsonl（core 读取路径：<dir>/audit/history.jsonl） */
function writeCoreHistory(entries: Record<string, unknown>[]): void {
  writeFileSync(
    join(dir, 'audit', 'history.jsonl'),
    entries.map((e) => JSON.stringify(e)).join('\n') + '\n',
  );
}

/** 双跑断言：kernel 与 core 对同一批条目的 status 必须相等 */
function expectSameStatus(entries: Record<string, unknown>[], key: string | null): { kernel: string; core: string } {
  const kernel = verifyChain(entries, { key, fingerprint: fp, subject: '差分' }).status;
  const core = checkHistoryChainDetailed(dir).status;
  expect(kernel).toBe(core);
  return { kernel, core };
}

describe('验链内核差分一致性（kernel verifyChain vs core checkHistoryChainDetailed）', () => {
  it('干净 v2 链——两侧同判 ok', () => {
    const entries = buildChainedEntries(3);
    writeCoreHistory(entries);
    const r = expectSameStatus(entries, DIFF_KEY);
    expect(r.kernel).toBe('ok');
  });

  it('中间条目被篡改（改内容留原签名）——两侧同判 tampered', () => {
    const entries = buildChainedEntries(3);
    entries[1]!.note = '篡改后的内容';
    writeCoreHistory(entries);
    const r = expectSameStatus(entries, DIFF_KEY);
    expect(r.kernel).toBe('tampered');
  });

  it('F01 复合攻击（篡改内容 + 剥 prevHash）——两侧同判 tampered（红，不降级为黄）', () => {
    const entries = buildChainedEntries(3);
    entries[1]!.note = '篡改后的内容';
    delete (entries[1] as Record<string, unknown>).prevHash;
    writeCoreHistory(entries);
    // F01 修复语义：有密钥时 no-prevhash 只置黄不跳 HMAC——内容被改 + 原签名仍在 → 红。
    // 本用例是 core 侧对齐修复的回归锁：退回「continue 跳过验签」时 core=unverifiable 即红。
    const r = expectSameStatus(entries, DIFF_KEY);
    expect(r.kernel).toBe('tampered');
  });

  it('剥掉中间条目 prevHash（内容不动）——两侧判定一致且 ≠ ok', () => {
    const entries = buildChainedEntries(3);
    delete (entries[1] as Record<string, unknown>).prevHash;
    writeCoreHistory(entries);
    const r = expectSameStatus(entries, DIFF_KEY);
    expect(r.kernel).not.toBe('ok');
  });

  it('剥掉 hmacSig（签名剥离）——两侧判定一致且 ≠ ok', () => {
    const entries = buildChainedEntries(3);
    delete (entries[1] as Record<string, unknown>).hmacSig;
    writeCoreHistory(entries);
    const r = expectSameStatus(entries, DIFF_KEY);
    expect(r.kernel).not.toBe('ok');
  });

  it('不足 2 条——两侧同判 insufficient', () => {
    const entries = buildChainedEntries(1);
    writeCoreHistory(entries);
    const r = expectSameStatus(entries, DIFF_KEY);
    expect(r.kernel).toBe('insufficient');
  });

  it('无密钥 legacy 链——两侧同判（降级 SHA-256 链自洽）', () => {
    const entries = buildLegacyEntries(3);
    writeCoreHistory(entries);
    // key=null 语义要求 core 侧同样读不到密钥。不能 delete 环境变量——
    // 那会回落读真实 ~/.sofagent-key（开发机上存在）。指向不存在路径，
    // core getHmacKey 返回 null，与 kernel key=null 对齐（既有测试同款手法）。
    process.env.SOFAGENT_KEY_PATH = join(dir, 'no-such-key');
    try {
      const r = expectSameStatus(entries, null);
      expect(r.kernel).toBe('ok');
    } finally {
      process.env.SOFAGENT_KEY_PATH = keyFile;
    }
  });
});
