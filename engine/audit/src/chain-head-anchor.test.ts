// ============================================================
// chain-head-anchor.test.ts · 审计链尾部截断防护——链头锚点测试
// finding-02：history.jsonl 哈希链只能证明「剩余内容自洽」，尾部截断
// （砍掉末尾 N 条）后剩余链自洽、纯链校验无感知。锚点文件
// history-chain-head 记录写入时总条数 + 末条哈希，读侧据此检出。
//
// 隔离：每个用例独立 mktemp dataDir + 临时 SOFAGENT_KEY_PATH，
// 绝不触碰真实 ~/.sofagent-key 与真实 data 目录。
// ============================================================

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import {
  appendHistory,
  clearHistory,
  getHistoryFilePath,
  getHistoryAnchorFilePath,
  checkHistoryChainDetailed,
  type AuditHistoryEntry,
} from './audit-history';

/** 临时密钥文件——≥16 字节随机 hex（弱密钥会触发 appendHistory 告警但不影响链语义） */
const keyDir = mkdtempSync(join(tmpdir(), 'sofagent-anchor-test-key-'));
const keyPath = join(keyDir, 'test-key');
writeFileSync(keyPath, randomBytes(32).toString('hex') + '\n', { mode: 0o600 });
const savedKeyPath = process.env.SOFAGENT_KEY_PATH;
process.env.SOFAGENT_KEY_PATH = keyPath;
afterAll(() => {
  process.env.SOFAGENT_KEY_PATH = savedKeyPath;
  try { rmSync(keyDir, { recursive: true, force: true }); } catch { /* */ }
});

/** 独立数据目录——每个用例一个，SOFAGENT_DATA 与真实数据目录零接触 */
function newDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'sofagent-anchor-test-data-'));
}

/** 构造一条测试用的历史条目（与 audit-history.test.ts 既有写法一致） */
function makeEntry(timestamp: string, exitCode: number): AuditHistoryEntry {
  return {
    timestamp,
    diffRange: 'HEAD~1..HEAD',
    task: '测试任务',
    exitCode,
    ruleResults: [
      { name: 'A1 不碰敏感', number: 1, status: 'PASS', details: [] },
      { name: 'A2 不泄密钥', number: 2, status: 'PASS', details: [] },
    ],
    diffFileCount: 3,
    commitMsg: 'test commit',
  };
}

describe('审计链尾部截断防护——链头锚点', () => {
  it('test_appendHistory_三次追加_锚点存在且0600且entryCount为3且链校验ok', () => {
    const dataDir = newDataDir();
    try {
      appendHistory(makeEntry('2026-01-01T00:00:00.000Z', 0), dataDir);
      appendHistory(makeEntry('2026-01-02T00:00:00.000Z', 0), dataDir);
      appendHistory(makeEntry('2026-01-03T00:00:00.000Z', 0), dataDir);

      // 锚点文件存在且与 history.jsonl 同目录
      const anchorPath = getHistoryAnchorFilePath(dataDir);
      expect(anchorPath).toBe(join(dataDir, 'audit', 'history-chain-head'));
      expect(existsSync(anchorPath)).toBe(true);

      // 权限 0600（写入后 chmodSync 收紧）
      const mode = statSync(anchorPath).mode & 0o777;
      expect(mode & 0o077).toBe(0); // group/other 无任何权限位

      // 单行 JSON：version=1、entryCount=3
      const anchor = JSON.parse(readFileSync(anchorPath, 'utf-8'));
      expect(anchor.version).toBe(1);
      expect(anchor.entryCount).toBe(3);
      expect(typeof anchor.headHash).toBe('string');
      expect(anchor.headHash.length).toBe(16);
      expect(typeof anchor.envFingerprint).toBe('string');

      // 链校验不受锚点影响，仍为 ok
      const result = checkHistoryChainDetailed(dataDir);
      expect(result.status).toBe('ok');
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('test_尾部截断_3条砍到2条_判定tampered且detail含截断', () => {
    const dataDir = newDataDir();
    try {
      appendHistory(makeEntry('2026-01-01T00:00:00.000Z', 0), dataDir);
      appendHistory(makeEntry('2026-01-02T00:00:00.000Z', 0), dataDir);
      appendHistory(makeEntry('2026-01-03T00:00:00.000Z', 0), dataDir);

      // 模拟攻击：砍掉末尾 1 条——剩余 2 条链内部自洽（修复前此处误报 ok）
      const filePath = getHistoryFilePath(dataDir);
      const lines = readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
      writeFileSync(filePath, lines.slice(0, 2).join('\n') + '\n', 'utf-8');

      const result = checkHistoryChainDetailed(dataDir);
      expect(result.status).toBe('tampered');
      expect(result.detail).toContain('截断');
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('test_保持行数_篡改中间条目内容_判定tampered', () => {
    const dataDir = newDataDir();
    try {
      appendHistory(makeEntry('2026-01-01T00:00:00.000Z', 0), dataDir);
      appendHistory(makeEntry('2026-01-02T00:00:00.000Z', 0), dataDir);
      appendHistory(makeEntry('2026-01-03T00:00:00.000Z', 0), dataDir);

      // 条数不变，改写中间条目的 task 字段——HMAC 链校验应判篡改
      const filePath = getHistoryFilePath(dataDir);
      const lines = readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
      const tampered = JSON.parse(lines[1]!);
      tampered.task = '被篡改的任务描述';
      lines[1] = JSON.stringify(tampered);
      writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');

      const result = checkHistoryChainDetailed(dataDir);
      expect(result.status).toBe('tampered');
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('test_clearHistory_锚点同步删除_再追加2条链校验ok', () => {
    const dataDir = newDataDir();
    try {
      appendHistory(makeEntry('2026-01-01T00:00:00.000Z', 0), dataDir);
      appendHistory(makeEntry('2026-01-02T00:00:00.000Z', 0), dataDir);
      appendHistory(makeEntry('2026-01-03T00:00:00.000Z', 0), dataDir);

      // 清空：history.jsonl 置空 + 锚点同步删除（残留锚点会让新链被误判截断）
      clearHistory(dataDir);
      expect(existsSync(getHistoryAnchorFilePath(dataDir))).toBe(false);

      // 重建 2 条：新锚点 entryCount=2，链校验 ok
      appendHistory(makeEntry('2026-02-01T00:00:00.000Z', 0), dataDir);
      appendHistory(makeEntry('2026-02-02T00:00:00.000Z', 0), dataDir);
      const anchor = JSON.parse(readFileSync(getHistoryAnchorFilePath(dataDir), 'utf-8'));
      expect(anchor.entryCount).toBe(2);
      const result = checkHistoryChainDetailed(dataDir);
      expect(result.status).toBe('ok');
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('test_创世条目被篡改_环境指纹一致_判定tampered', () => {
    // 创世条目（索引 0）HMAC 校验曾缺环境指纹比对——v2 指纹条目被篡改时误归
    // 「不可复验（黄）」，与主循环同路径判定不对齐；指纹一致时 HMAC 不匹配
    // 只能是内容在签名后被改，应判红
    const dataDir = newDataDir();
    try {
      appendHistory(makeEntry('2026-01-01T00:00:00.000Z', 0), dataDir);
      appendHistory(makeEntry('2026-01-02T00:00:00.000Z', 0), dataDir);

      // 条数不变，改写创世条目（索引 0）的 task 字段——保留其 envFingerprint
      const filePath = getHistoryFilePath(dataDir);
      const lines = readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
      const tamperedGenesis = JSON.parse(lines[0]!);
      tamperedGenesis.task = '被篡改的创世条目';
      lines[0] = JSON.stringify(tamperedGenesis);
      writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');

      const result = checkHistoryChainDetailed(dataDir);
      expect(result.status).toBe('tampered');
      expect(result.index).toBe(0);
      expect(result.detail).toContain('创世条目');
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('test_删除锚点文件_链校验ok_向后兼容旧行为', () => {
    const dataDir = newDataDir();
    try {
      appendHistory(makeEntry('2026-01-01T00:00:00.000Z', 0), dataDir);
      appendHistory(makeEntry('2026-01-02T00:00:00.000Z', 0), dataDir);

      // 无锚点环境（旧数据 / 锚点写入失败）：读侧跳过锚点校验，行为与修复前一致
      unlinkSync(getHistoryAnchorFilePath(dataDir));
      expect(existsSync(getHistoryAnchorFilePath(dataDir))).toBe(false);
      const result = checkHistoryChainDetailed(dataDir);
      expect(result.status).toBe('ok');
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
