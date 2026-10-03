// ============================================================
// history-archive.test.ts · v1.5.6 章二：audit-history 历史段归档
//
// 覆盖：
//   ① 触发归档：头部（最旧）段移入 archive/，条数守恒 + 归档锚点落盘
//   ② 核心验收：归档后 checkHistoryChainDetailed **不报 tampered**（证主锚点重算正确）
//   ③ 幂等：文件已小（<= maxBytes）→ 不再归档、不改文件
//   ④ 负向：归档后手工砍掉主链尾部若干条 → 仍报 tampered（防截断能力未被削弱）
//   ⑤ 至少保留 1 条：主链仅 2 条时归档 → remainingEntries >= 1
//
// 夹具：用 @sofagent/audit 的 appendHistory 构造「可校验」链路（正确 prevHash + hmacSig
// + 链头锚点），与 audit 侧 audit-history.test.ts 的既有夹具同口径。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import {
  archiveHistoryHead,
  checkHistoryChainDetailed,
  getHistoryFilePath,
  getHistoryAnchorFilePath,
} from '../audit-history';
import { appendHistory, type AuditHistoryEntry } from '@sofagent/audit';

/** 构造一条测试用的历史条目（与 audit 侧夹具同结构） */
function makeEntry(timestamp: string, exitCode: number): AuditHistoryEntry {
  return {
    timestamp,
    diffRange: 'HEAD~1..HEAD',
    task: '历史段归档测试任务',
    exitCode,
    ruleResults: [
      { name: 'A1 不碰敏感', number: 1, status: 'PASS', details: [] },
      { name: 'A2 不泄密钥', number: 2, status: exitCode >= 1 ? 'WARN' : 'PASS', details: [] },
    ],
    diffFileCount: 2,
    commitMsg: 'test commit',
  };
}

describe('§v1.5.6 章二 · audit-history 历史段归档', () => {
  let dataDir: string;
  let keyPath: string;
  let savedKeyPath: string | undefined;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sofagent-history-archive-'));
    // 隔离 HMAC 密钥：绝不触碰真实 ~/.sofagent-key（随机 32 字节 hex = 强密钥）
    keyPath = join(dataDir, 'hmac.key');
    writeFileSync(keyPath, randomBytes(32).toString('hex'), { mode: 0o600 });
    savedKeyPath = process.env.SOFAGENT_KEY_PATH;
    process.env.SOFAGENT_KEY_PATH = keyPath;
  });

  afterEach(() => {
    if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
    else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // 清理失败不阻断
    }
  });

  /** 用 appendHistory 播种 n 条可校验记录（含正确 prevHash + hmacSig + 链头锚点） */
  function seed(n: number): void {
    for (let i = 0; i < n; i++) {
      const stamp = `2026-06-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`;
      appendHistory(makeEntry(stamp, 0), dataDir);
    }
  }

  it('① 触发归档：头部段入 archive/，条数守恒且归档锚点落盘', () => {
    seed(6);
    const histPath = getHistoryFilePath(dataDir);
    expect(checkHistoryChainDetailed(dataDir).status).toBe('ok');

    const size = statSync(histPath).size;
    const r = archiveHistoryHead({ dataDir, maxBytes: Math.floor(size * 0.8) });

    expect(r.archivedEntries).toBeGreaterThan(0);
    expect(r.remainingEntries).toBeGreaterThanOrEqual(1);
    expect(r.remainingEntries + r.archivedEntries).toBe(6);

    // 归档段物理落盘 + 条数正确
    expect(r.archivePath).not.toBeNull();
    expect(existsSync(r.archivePath!)).toBe(true);
    const archivedLines = readFileSync(r.archivePath!, 'utf-8').trim().split('\n').filter(Boolean);
    expect(archivedLines.length).toBe(r.archivedEntries);

    // 归档段独立锚点落盘（字段同 HistoryChainHeadAnchor）
    expect(r.archiveAnchorPath).not.toBeNull();
    expect(existsSync(r.archiveAnchorPath!)).toBe(true);
    const archiveAnchor = JSON.parse(readFileSync(r.archiveAnchorPath!, 'utf-8'));
    expect(archiveAnchor.version).toBe(1);
    expect(archiveAnchor.entryCount).toBe(r.archivedEntries);
    expect(typeof archiveAnchor.headHash).toBe('string');
    expect(archiveAnchor.headHash.length).toBe(16);

    // 主链只剩尾部段
    const remaining = readFileSync(histPath, 'utf-8').trim().split('\n').filter(Boolean);
    expect(remaining.length).toBe(r.remainingEntries);
  });

  it('② 核心验收：归档后主链校验不报 tampered（证主锚点重算正确）', () => {
    seed(6);
    const size = statSync(getHistoryFilePath(dataDir)).size;
    const r = archiveHistoryHead({ dataDir, maxBytes: Math.floor(size * 0.8) });
    expect(r.archivedEntries).toBeGreaterThan(0);

    const check = checkHistoryChainDetailed(dataDir);
    // 允许 ok / unverifiable，**不允许 tampered**（归档不得被误判为截断/重写）
    expect(check.status).not.toBe('tampered');

    // 主锚点已重算：entryCount = 剩余条数、envFingerprint 沿用旧值（非空）
    const anchor = JSON.parse(readFileSync(getHistoryAnchorFilePath(dataDir), 'utf-8'));
    expect(anchor.entryCount).toBe(r.remainingEntries);
    expect(typeof anchor.envFingerprint).toBe('string');
  });

  it('③ 幂等：文件已小（<= maxBytes）再次调用 → archivedEntries===0 且不改文件', () => {
    seed(6);
    const histPath = getHistoryFilePath(dataDir);
    const size = statSync(histPath).size;
    const threshold = Math.floor(size * 0.8);

    const r1 = archiveHistoryHead({ dataDir, maxBytes: threshold });
    expect(r1.archivedEntries).toBeGreaterThan(0);
    const afterFirst = readFileSync(histPath, 'utf-8');

    const r2 = archiveHistoryHead({ dataDir, maxBytes: threshold });
    expect(r2.archivedEntries).toBe(0);
    expect(r2.archivePath).toBeNull();
    // 文件逐字节未变
    expect(readFileSync(histPath, 'utf-8')).toBe(afterFirst);
  });

  it('④ 负向：归档后手工砍掉主链尾部若干条 → 仍报 tampered（防截断未被削弱）', () => {
    seed(6);
    const size = statSync(getHistoryFilePath(dataDir)).size;
    const r = archiveHistoryHead({ dataDir, maxBytes: Math.floor(size * 0.8) });
    expect(r.remainingEntries).toBeGreaterThanOrEqual(3);

    const histPath = getHistoryFilePath(dataDir);
    const lines = readFileSync(histPath, 'utf-8').trim().split('\n').filter(Boolean);
    // 砍掉最后 2 条 → 锚点 entryCount 仍记剩余条数 ⇒ 读侧必报截断
    writeFileSync(histPath, lines.slice(0, lines.length - 2).join('\n') + '\n', 'utf-8');

    expect(checkHistoryChainDetailed(dataDir).status).toBe('tampered');
  });

  it('⑤ 至少保留 1 条：主链仅 2 条时归档 → remainingEntries >= 1', () => {
    seed(2);
    const r = archiveHistoryHead({ dataDir, maxBytes: 10 });
    expect(r.remainingEntries).toBeGreaterThanOrEqual(1);
    expect(r.remainingEntries + r.archivedEntries).toBe(2);
  });

  it('⑥ 权限：归档前后主链与归档段 mode 均保持 0o600（治理动作不得放宽权限）', () => {
    seed(6);
    const histPath = getHistoryFilePath(dataDir);
    // 夹具以 0o600 落盘（对齐真实 ~/.sofagent/data 口径）
    expect(statSync(histPath).mode & 0o777).toBe(0o600);

    const size = statSync(histPath).size;
    const r = archiveHistoryHead({ dataDir, maxBytes: Math.floor(size * 0.8) });

    // P2-1 回归锁：归档覆盖写主链时缺 mode 会让 umask 022 下的 600 放宽为 644。
    // 主链持 HMAC 审计记录，权限不得因归档（治理动作）被放宽。
    expect(statSync(histPath).mode & 0o777).toBe(0o600);
    expect(r.archivePath).not.toBeNull();
    expect(statSync(r.archivePath!).mode & 0o777).toBe(0o600);
  });
});
