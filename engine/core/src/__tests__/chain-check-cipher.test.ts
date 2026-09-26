// ============================================================
// chain-check-cipher.test.ts · F-29：静态加密 × HMAC 链校验互毁修复测试
// ============================================================
//
// 背景：checkHistoryChainDetailed（core）此前逐行 JSON.parse 且零解密通路，
// 加密态落盘的 SOFAGENT-AGE-V1: 密文行必进 malformedLines ⇒ 恒报 tampered（红）。
// 本文件锁定修复后的三态语义：
//   ① 密文行 + 密钥在 → 解密后正常校验（ok / unverifiable，不再是 tampered）
//   ② 密文行 + 密钥全部不可用 → unverifiable（黄，含恢复指引），非 tampered
//   ③ 密文行被篡改（改一字节）→ 不可解密（同②面），但其余明文链 tampered 判定
//      不受影响；锚点计数防护由既有机制承担
//   ④ 轮换读侧（F-30）：当前 data.key 轮换后，旧钥归档 .bak 仍可解旧密文
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, renameSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

import {
  checkHistoryChainDetailed,
  getHistoryFilePath,
} from '../audit-history';
import {
  generateDataKey,
  writeInitializedMarker,
  keysDirPath,
  dataKeyPath,
  encryptWithAge,
  isAgePayload,
} from '../crypto/key-manager';
import { encryptWithAge as enc, isAgePayload as isAge } from '../crypto/age-wrapper';

// 测试用 HMAC 密钥内容——64 位 hex（Shannon 熵 ≈4.0 bit/char，不含弱模式词）。
// 链校验的「密钥在场但条目无签名 → unverifiable」分支靠 HMAC 密钥在场成立，
// 密钥经 SOFAGENT_KEY_PATH 解析（不走 SOFAGENT_HOME）——必须就地隔离，
// 否则用例结果随开发机是否有 ~/.sofagent-key 漂移（无密钥机器上恒取 ok 分支）。
const HMAC_TEST_KEY = 'c81f4a6e29b7d3508e6c1a4f7b2d9e58a3c6f1902b8e4d7a5f1c3e9b6d802a4f';

/** 生成密钥（测试环境，confirmBackup 直传 true——临时目录即丢弃，无备份语义） */
function genKey(home: string): void {
  generateDataKey(home, { confirmBackup: true });
}

function tmpDir(tag: string): string {
  const dir = join(tmpdir(), `sofagent-chain-cipher-${tag}-${Date.now()}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}



/** 构造一条链上合法的明文审计记录（含 prevHash/hmacSig 由调用方补） */
function makePlainEntry(timestamp: string): Record<string, unknown> {
  return {
    timestamp,
    diffRange: 'HEAD~1..HEAD',
    task: 'F-29 链校验加密态测试',
    exitCode: 0,
    ruleResults: [
      { name: 'A1 不碰敏感', number: 1, status: 'PASS', details: [] },
    ],
    diffFileCount: 1,
    commitMsg: 'chain cipher matrix test',
  };
}

/**
 * 直接构造「自洽双行明文链」写入 history.jsonl——绕开 appendHistory（它属于
 * audit 包，本测试在 core 侧只验校验函数）。双行链：第 2 行 prevHash 指向
 * 第 1 行、两行均无 hmacSig（legacy 形态，校验侧归 unverifiable 而非 tampered）。
 */
function writeSelfConsistentPlainChain(dataDir: string): void {
  const e1 = makePlainEntry('2026-09-25T00:00:00Z');
  const e2 = makePlainEntry('2026-09-25T00:01:00Z');
  // prevHash = sha256(前一条去 prevHash/hashVersion 后的 JSON) 前 16 位——对齐
  // checkHistoryChainDetailed 的 expectedPrevHash 计算（无指纹形态）
  const { createHash } = require('crypto') as typeof import('crypto');
  const rec1 = { ...e1, prevHash: undefined, hashVersion: undefined };
  const h = createHash('sha256').update(JSON.stringify(rec1)).digest('hex').slice(0, 16);
  (e2 as Record<string, unknown>).prevHash = h;
  const file = getHistoryFilePath(dataDir);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, `${JSON.stringify(e1)}\n${JSON.stringify(e2)}\n`, 'utf8');
}

describe('F-29 · checkHistoryChainDetailed × 静态加密三态', () => {
  let testDir: string;
  let keyHome: string;
  let savedData: string | undefined;
  let savedHome: string | undefined;
  let savedKeyPath: string | undefined;

  beforeEach(() => {
    testDir = tmpDir('data');
    keyHome = tmpDir('home');
    savedData = process.env.SOFAGENT_DATA;
    savedHome = process.env.SOFAGENT_HOME;
    savedKeyPath = process.env.SOFAGENT_KEY_PATH;
    process.env.SOFAGENT_DATA = testDir;
    process.env.SOFAGENT_HOME = keyHome;
    // HMAC 密钥就地隔离（与同目录 audit 包测试同款惯例）——绝不触碰真实 ~/.sofagent-key。
    // 密钥文件随 keyHome 一起在 afterEach 清理。
    const keyFile = join(keyHome, 'hmac-key');
    writeFileSync(keyFile, HMAC_TEST_KEY, { mode: 0o600 });
    process.env.SOFAGENT_KEY_PATH = keyFile;
  });

  afterEach(() => {
    if (savedData === undefined) delete process.env.SOFAGENT_DATA;
    else process.env.SOFAGENT_DATA = savedData;
    if (savedHome === undefined) delete process.env.SOFAGENT_HOME;
    else process.env.SOFAGENT_HOME = savedHome;
    if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
    else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
    for (const d of [testDir, keyHome]) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* */ }
    }
  });

  it('① 密文链 + 密钥在 → 不再恒报 tampered（修复主断言）', () => {
    // 生成密钥并初始化
    genKey(keyHome);
    writeInitializedMarker(keyHome);
    const key = readFileSync(dataKeyPath(keyHome), 'utf8').trim();
    const keyBuf = Buffer.from(key, 'base64');

    // 构造自洽明文链后整体加密重写
    writeSelfConsistentPlainChain(testDir);
    const file = getHistoryFilePath(testDir);
    const plain = readFileSync(file, 'utf8');
    const encLines = plain
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => enc(l, keyBuf));
    writeFileSync(file, encLines.join('\n') + '\n', 'utf8');
    expect(existsSync(file)).toBe(true);
    expect(isAge(readFileSync(file, 'utf8').split('\n')[0]!)).toBe(true);

    const r = checkHistoryChainDetailed(testDir);
    // 修复前：密文行 JSON.parse 失败 → tampered。修复后：解密成功 → 走正常链校验。
    // 双行链无 hmacSig（legacy）→ 结果应为 unverifiable（黄）而绝不能是 tampered。
    expect(r.status).not.toBe('tampered');
    expect(r.status).toBe('unverifiable');
  });

  it('② 密文链 + 密钥全部不可用 → unverifiable（黄）+ 恢复指引', () => {
    genKey(keyHome);
    writeInitializedMarker(keyHome);
    const keyBuf = Buffer.from(readFileSync(dataKeyPath(keyHome), 'utf8').trim(), 'base64');

    writeSelfConsistentPlainChain(testDir);
    const file = getHistoryFilePath(testDir);
    const plain = readFileSync(file, 'utf8');
    writeFileSync(file, plain.split('\n').filter((l) => l.trim() !== '').map((l) => enc(l, keyBuf)).join('\n') + '\n', 'utf8');

    // 删除密钥 + 删除归档（模拟密钥彻底不可用）
    rmSync(keysDirPath(keyHome), { recursive: true, force: true });

    const r = checkHistoryChainDetailed(testDir);
    expect(r.status).toBe('unverifiable');
    expect(r.detail).toContain('不可复验');
    expect(r.detail).toContain('data.key');
  });

  it('③ 明文链被改一字节 → 仍 tampered（红）——解密通路不吞真篡改', () => {
    writeSelfConsistentPlainChain(testDir);
    const file = getHistoryFilePath(testDir);
    const content = readFileSync(file, 'utf8');
    // 篡改第二条的 task 字段内容（保持 JSON 合法但内容变了 → prevHash 不匹配）
    const tampered = content.replace('F-29 链校验加密态测试', 'F-29 被篡改的内容!!');
    expect(tampered).not.toBe(content); // 确认替换生效
    writeFileSync(file, tampered, 'utf8');

    const r = checkHistoryChainDetailed(testDir);
    expect(r.status).toBe('tampered');
  });

  it('④ 轮换读侧（F-30）：旧钥归档 .bak 后旧密文仍可解', () => {
    genKey(keyHome);
    writeInitializedMarker(keyHome);
    const oldKeyBuf = Buffer.from(readFileSync(dataKeyPath(keyHome), 'utf8').trim(), 'base64');

    writeSelfConsistentPlainChain(testDir);
    const file = getHistoryFilePath(testDir);
    const plain = readFileSync(file, 'utf8');
    writeFileSync(file, plain.split('\n').filter((l) => l.trim() !== '').map((l) => enc(l, oldKeyBuf)).join('\n') + '\n', 'utf8');

    // 轮换：旧 data.key 改名为归档形态 data.key.<stamp>.bak，再生成新钥
    const stamp = '20260925';
    renameSync(dataKeyPath(keyHome), join(keysDirPath(keyHome), `data.key.${stamp}.bak`));
    genKey(keyHome);

    const r = checkHistoryChainDetailed(testDir);
    // 归档钥可解 → 不因「钥已轮换」报黄/红；链本身 legacy 无签名 → unverifiable
    expect(r.status).not.toBe('tampered');
    expect(r.status).toBe('unverifiable');
    expect(r.detail).not.toContain('不可用');
  });

  it('⑤ 基线回归：明文链 + 无密钥 → 行为与修复前完全一致（unverifiable）', () => {
    writeSelfConsistentPlainChain(testDir);
    const r = checkHistoryChainDetailed(testDir);
    expect(r.status).toBe('unverifiable'); // legacy 无签名的既有语义
  });
});
