// ============================================================
// encryption-degrade.test.ts · F-11：静态加密降级可见化测试
// ============================================================
// 「曾初始化但 data.key 缺失」的降级态此前零告警零记录：用户以为加密在跑，
// 实际新记录全明文；doctor 与 verify-chain 均无该检测项。
// 修复后三件：写入侧 stderr 告警（一次）+ history ENCRYPTION_DEGRADED 事件行
// （一次）+ doctor 一致性检查（红）。本文件锁定前两件（doctor 属 core 侧
// 手测面）。
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

import { appendHistory } from '../audit-history';
import {
  generateDataKey,
  writeInitializedMarker,
  keysDirPath,
} from '@sofagent/core';

function tmpDir(tag: string): string {
  const dir = join(tmpdir(), `sofagent-f11-${tag}-${Date.now()}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeEntry(ts: string) {
  return {
    timestamp: ts,
    diffRange: 'HEAD~1..HEAD',
    task: 'F-11 降级可见化测试',
    exitCode: 0,
    ruleResults: [
      { name: 'A1 不碰敏感', number: 1, status: 'PASS', details: [] },
    ],
    diffFileCount: 1,
    commitMsg: 'f11 degrade test',
  } as Parameters<typeof appendHistory>[0];
}

describe('F-11 · 静态加密降级可见化', () => {
  let testDir: string;
  let keyHome: string;
  let savedData: string | undefined;
  let savedHome: string | undefined;

  beforeEach(() => {
    testDir = tmpDir('data');
    keyHome = tmpDir('home');
    savedData = process.env.SOFAGENT_DATA;
    savedHome = process.env.SOFAGENT_HOME;
    process.env.SOFAGENT_DATA = testDir;
    process.env.SOFAGENT_HOME = keyHome;
  });

  afterEach(() => {
    if (savedData === undefined) delete process.env.SOFAGENT_DATA;
    else process.env.SOFAGENT_DATA = savedData;
    if (savedHome === undefined) delete process.env.SOFAGENT_HOME;
    else process.env.SOFAGENT_HOME = savedHome;
    for (const d of [testDir, keyHome]) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* */ }
    }
    vi.restoreAllMocks();
  });

  it('降级态首写：stderr 告警 + history 出现 ENCRYPTION_DEGRADED 事件行', () => {
    // 曾初始化（标记在）
    writeInitializedMarker(keyHome);
    // 但密钥缺失（不生成 data.key）→ 降级态
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    appendHistory(makeEntry('2026-09-25T10:00:00Z'));
    appendHistory(makeEntry('2026-09-25T10:01:00Z'));

    const errText = errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(errText).toContain('静态加密已降级为明文写入');

    const hist = join(testDir, 'audit', 'history.jsonl');
    expect(existsSync(hist)).toBe(true);
    const content = readFileSync(hist, 'utf8');
    expect(content).toContain('ENCRYPTION_DEGRADED');
    // 事件行只写一次（两条审计记录 → 一条事件）
    const events = content.split('\n').filter((l) => l.includes('ENCRYPTION_DEGRADED')).length;
    expect(events).toBe(1);
    // 审计记录本身是明文（降级语义）
    expect(content).toContain('F-11 降级可见化测试');
  });

  it('正常态（标记+密钥都在）：无降级告警、无事件行、密文写入', () => {
    generateDataKey(keyHome, { confirmBackup: true });
    writeInitializedMarker(keyHome);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    appendHistory(makeEntry('2026-09-25T10:02:00Z'));

    const errText = errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(errText).not.toContain('降级');
    const hist = join(testDir, 'audit', 'history.jsonl');
    const content = readFileSync(hist, 'utf8');
    expect(content).not.toContain('ENCRYPTION_DEGRADED');
    expect(content).toContain('SOFAGENT-AGE-V1'); // 密文写入
  });

  it('从未初始化（无标记）：不告警不写事件（合法未启用态）', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    appendHistory(makeEntry('2026-09-25T10:03:00Z'));
    const errText = errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(errText).not.toContain('降级');
    const hist = join(testDir, 'audit', 'history.jsonl');
    const content = readFileSync(hist, 'utf8');
    expect(content).not.toContain('ENCRYPTION_DEGRADED');
  });

  it('doctor 一致性检查（core）：标记在而钥缺 → fail 项在（经 doctor 源码断言）', async () => {
    // doctor 是交互式 CLI，此处做源码面断言：检查项与 fail 文案在位
    const src = readFileSync(join(__dirname, '..', '..', '..', 'core', 'src', 'doctor.ts'), 'utf8');
    expect(src).toContain('F-11：静态加密一致性检查');
    expect(src).toContain('初始化标记在而 data.key 缺失/损坏');
  });
});
