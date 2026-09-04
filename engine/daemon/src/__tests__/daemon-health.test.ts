// ============================================================
// daemon-health.test.ts · daemon 健康自检测试（v1.3.6 交付⑬ 补疲劳保留）
// 核心回归：心跳重写 daemon-health.json 时不擦除 fatigue 字段
// v1.4.5 T5：version 从 package.json 运行时读取（消灭 1.4.3 硬编码漂移）
// v1.4.5 T9：webhook 通道健康透传（心跳不擦除）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { writeHealthFile, readHealthFile, recordDaemonExit, checkDaemonHealth, resolveHealthFilePath, resolveDaemonVersion } from '../daemon-health';
import { FatigueTracker, writeFatigueReport } from '../fatigue';

describe('daemon-health fatigue 保留（v1.3.6 交付⑬）', () => {
  let testDir: string;
  let savedData: string | undefined;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-health-'));
    savedData = process.env.SOFAGENT_DATA;
    process.env.SOFAGENT_DATA = testDir;
  });

  afterEach(() => {
    if (savedData === undefined) delete process.env.SOFAGENT_DATA;
    else process.env.SOFAGENT_DATA = savedData;
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('writeHealthFile 心跳重写保留 fatigue 报告', () => {
    // 1. daemon 启动写 health
    writeHealthFile('start');
    // 2. fatigue.ts 独立写入疲劳报告（@hourly 采集）
    const tracker = new FatigueTracker();
    tracker.setWindowOccupancy(0.88);
    const report = tracker.assess();
    expect(writeFatigueReport(report, testDir)).toBe(true);
    // 3. daemon 心跳重写——fatigue 不能被擦除
    writeHealthFile('heartbeat');
    const health = readHealthFile();
    expect(health).not.toBeNull();
    expect(health!.fatigue).toBeDefined();
    expect(health!.fatigue!.score).toBe(report.score);
    expect(health!.fatigue!.signals.windowOccupancy).toBe(0.88);
  });

  it('writeHealthFile error 事件也保留 fatigue', () => {
    writeHealthFile('start');
    const report = new FatigueTracker().assess();
    writeFatigueReport(report, testDir);
    writeHealthFile('error', { lastError: 'push failed' });
    const health = readHealthFile();
    expect(health!.fatigue).toBeDefined();
    expect(health!.status).toBe('degraded');
  });

  it('无 fatigue 时心跳正常写（不凭空造字段）', () => {
    writeHealthFile('start');
    writeHealthFile('heartbeat');
    const health = readHealthFile();
    expect(health).not.toBeNull();
    expect(health!.fatigue).toBeUndefined();
  });

  // ────────────────────────────────────────────────
  // v1.4.5 T5：version 运行时读取 package.json
  // ────────────────────────────────────────────────

  it('test_resolveDaemonVersion_运行时读取_与packageJson一致', () => {
    // 修复本体：原硬编码 '1.4.3'（daemon 已是 1.4.4）——每次升版必漂移。
    // 现在从 package.json 运行时读取，与本包版本恒一致。
    const pkgJson = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf-8'),
    ) as { version: string };
    expect(resolveDaemonVersion()).toBe(pkgJson.version);
  });

  it('test_writeHealthFile_version字段_等于运行时包版本', () => {
    writeHealthFile('start');
    const health = readHealthFile();
    const pkgJson = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf-8'),
    ) as { version: string };
    expect(health!.version).toBe(pkgJson.version);
    // 回归：不再出现历史漂移值
    expect(health!.version).not.toBe('1.4.3');
  });

  // ────────────────────────────────────────────────
  // v1.4.5 T9：webhook 通道健康透传（心跳不擦除）
  // ────────────────────────────────────────────────

  it('test_writeHealthFile_心跳重写_webhookHealth不被擦除', () => {
    writeHealthFile('start');
    // 模拟 webhook pusher 写入通道健康（最近成功/失败摘要）
    writeHealthFile('heartbeat', {
      webhook: {
        lastSuccessAt: '2026-08-20T10:00:00.000Z',
        lastError: null,
      },
    });
    // 后续普通心跳（无 webhook 字段）——webhook 健康不能被擦除
    writeHealthFile('heartbeat');
    const health = readHealthFile();
    expect(health!.webhook).toBeDefined();
    expect(health!.webhook!.lastSuccessAt).toBe('2026-08-20T10:00:00.000Z');
  });

  it('test_writeHealthFile_webhook失败摘要_记录并透传', () => {
    writeHealthFile('start');
    writeHealthFile('heartbeat', {
      webhook: {
        lastSuccessAt: '2026-08-20T09:00:00.000Z',
        lastError: 'feishu: HTTP 401（attempts=1）',
      },
    });
    const health = readHealthFile();
    expect(health!.webhook!.lastError).toContain('401');
  });

  it('exit 78 但心跳新鲜（daemon 已重启）→ 不误报 dead', () => {
    writeHealthFile('start');
    recordDaemonExit(78, 'startup-failure'); // 上一次启动失败
    writeHealthFile('start'); // 立即重启成功——新一轮 start
    // 注意：writeHealthFile('start') 不清 lastExitCode（残留上轮值），
    // 但心跳新鲜 → 判 running，不误报 dead
    const result = checkDaemonHealth();
    expect(result.status).toBe('running');
    expect(result.healthy).toBe(true);
  });

  it('exit 落盘保留 fatigue 报告（退出不擦除既有字段）', () => {
    writeHealthFile('start');
    const tracker = new FatigueTracker();
    tracker.setWindowOccupancy(0.9);
    writeFatigueReport(tracker.assess(), testDir);
    recordDaemonExit(78, 'uncaught-exception');
    const health = readHealthFile();
    expect(health!.fatigue).toBeDefined();
    expect(health!.fatigue!.signals.windowOccupancy).toBe(0.9);
    expect(health!.lastExitCode).toBe(78);
  });

  it('文件不存在 → never-started（全新安装不误报）', () => {
    const result = checkDaemonHealth();
    expect(result.status).toBe('never-started');
    expect(result.healthy).toBe(false);
  });
});
