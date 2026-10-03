// ============================================================
// audit-dir-maintenance.test.ts · v1.5.6 章二：遗留备份接管清理
//
// 覆盖：
//   ① 只清超龄遗留备份（*.bak-* / *.broken-*），新备份保留、普通文件不动
//   ② dryRun=true → 一个都不删但 deleted 列表非空
//   ③ 每个删除动作写一条 decision-log（kind=LEGACY_CLEANUP）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, utimesSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import { cleanupLegacyArtifacts, runAuditDirMaintenance } from '../audit-dir-maintenance';

const DAY_MS = 86_400_000;
const NOW = new Date('2026-09-26T00:00:00.000Z');

describe('§v1.5.6 章二 · 遗留备份接管清理', () => {
  let dataDir: string;
  let auditDir: string;
  let keyPath: string;
  let savedKeyPath: string | undefined;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'sofagent-audit-maint-'));
    auditDir = join(dataDir, 'audit');
    mkdirSync(auditDir, { recursive: true });
    // 隔离 HMAC 密钥（decision-log 签名用）——绝不触碰真实 ~/.sofagent-key
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

  /** 造一个遗留/正常文件并设定 mtime */
  function seed(name: string, mtime: Date, size: number): string {
    const p = join(auditDir, name);
    writeFileSync(p, 'x'.repeat(size), 'utf-8');
    utimesSync(p, mtime, mtime);
    return p;
  }

  /** 标准 4 文件布局 */
  function seedFour(): void {
    seed('history.jsonl.bak-old', new Date(NOW.getTime() - 60 * DAY_MS), 100);
    seed('a.broken-1', new Date(NOW.getTime() - 60 * DAY_MS), 50);
    seed('history.jsonl.bak-new', new Date(NOW.getTime() - 1 * DAY_MS), 10);
    seed('x.jsonl', new Date(NOW.getTime() - 60 * DAY_MS), 70);
  }

  it('① 只清超龄遗留备份：删 2 个、保留新的、普通文件不动', () => {
    seedFour();
    const r = cleanupLegacyArtifacts({ dataDir, maxAgeDays: 30, now: NOW });

    expect(r.scanned).toBe(4);
    expect(r.deleted.length).toBe(2);
    expect(r.deleted.some((p) => p.endsWith('history.jsonl.bak-old'))).toBe(true);
    expect(r.deleted.some((p) => p.endsWith('a.broken-1'))).toBe(true);
    expect(r.kept).toBe(1);
    expect(r.freedBytes).toBe(150);

    // 物理结果
    expect(existsSync(join(auditDir, 'history.jsonl.bak-old'))).toBe(false);
    expect(existsSync(join(auditDir, 'a.broken-1'))).toBe(false);
    expect(existsSync(join(auditDir, 'history.jsonl.bak-new'))).toBe(true);
    expect(existsSync(join(auditDir, 'x.jsonl'))).toBe(true);
  });

  it('② dryRun=true：一个都不删，但 deleted 列表非空', () => {
    seedFour();
    const r = cleanupLegacyArtifacts({ dataDir, maxAgeDays: 30, now: NOW, dryRun: true });

    expect(r.deleted.length).toBe(2);
    expect(r.freedBytes).toBe(150);
    // 全部原地未动
    expect(existsSync(join(auditDir, 'history.jsonl.bak-old'))).toBe(true);
    expect(existsSync(join(auditDir, 'a.broken-1'))).toBe(true);
  });

  it('③ 每个删除动作写一条 decision-log（kind=LEGACY_CLEANUP）', () => {
    seedFour();
    cleanupLegacyArtifacts({ dataDir, maxAgeDays: 30, now: NOW });

    const logPath = join(auditDir, 'decision-log.jsonl');
    expect(existsSync(logPath)).toBe(true);
    const entries = readFileSync(logPath, 'utf-8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const cleanups = entries.filter((e) => e.kind === 'LEGACY_CLEANUP');
    expect(cleanups.length).toBe(2);
    // 留痕含被删文件名 + 大小（证据可查）
    const evidence = cleanups.flatMap((e) => (e.evidence as string[]) ?? []).join(' ');
    expect(evidence).toContain('history.jsonl.bak-old');
    expect(evidence).toContain('a.broken-1');
    expect(evidence).toContain('size=100');
  });

  it('④ 接通：runAuditDirMaintenance 清超龄遗留备份 + 留痕；doctor --repair 确有调用', () => {
    seed('history.jsonl.bak-old', new Date(NOW.getTime() - 60 * DAY_MS), 100);
    seed('history.jsonl.bak-new', new Date(NOW.getTime() - 1 * DAY_MS), 10);

    const r = runAuditDirMaintenance({ dataDir, maxAgeDays: 30, now: NOW });
    expect(r.cleanup.deleted.length).toBe(1);
    expect(existsSync(join(auditDir, 'history.jsonl.bak-old'))).toBe(false);
    expect(existsSync(join(auditDir, 'history.jsonl.bak-new'))).toBe(true);

    const entries = readFileSync(join(auditDir, 'decision-log.jsonl'), 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(entries.filter((e) => e.kind === 'LEGACY_CLEANUP').length).toBe(1);

    // doctor --repair 分支确有对编排入口的调用（grep 级接线断言）
    const doctorSrc = readFileSync(fileURLToPath(new URL('../doctor.ts', import.meta.url)), 'utf-8');
    expect(doctorSrc).toContain('runAuditDirMaintenance(');
  });

  it('⑤ 接通：runAuditDirMaintenance 超阈值时归档历史段并留痕', () => {
    // 造可被归档的 history.jsonl（archiveHistoryHead 只按字节/条数归档，不校验链）
    const lines: string[] = [];
    for (let i = 0; i < 6; i++) {
      lines.push(JSON.stringify({ timestamp: `2026-06-0${i + 1}T00:00:00.000Z`, exitCode: 0, ruleResults: [] }));
    }
    writeFileSync(join(auditDir, 'history.jsonl'), lines.join('\n') + '\n', 'utf-8');

    const r = runAuditDirMaintenance({ dataDir, maxAgeDays: 30, now: NOW, archiveMaxBytes: 10 });
    expect(r.archive.archivedEntries).toBeGreaterThan(0);
    expect(r.archive.archivePath).not.toBeNull();
    expect(existsSync(r.archive.archivePath!)).toBe(true);

    const entries = readFileSync(join(auditDir, 'decision-log.jsonl'), 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(
      entries.some(
        (e) =>
          e.kind === 'LEGACY_CLEANUP' &&
          ((e.evidence as string[]) ?? []).join(' ').includes('archived='),
      ),
    ).toBe(true);
  });
});
