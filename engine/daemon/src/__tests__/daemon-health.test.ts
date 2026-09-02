// ============================================================
// daemon-health.test.ts · daemon 健康自检测试（v1.3.6 交付⑬ 补疲劳保留）
// 核心回归：心跳重写 daemon-health.json 时不擦除 fatigue 字段
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { writeHealthFile, readHealthFile, recordDaemonExit, checkDaemonHealth, resolveHealthFilePath } from '../daemon-health';
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
    expect(health!.status).toBe('running');
  });
});

// ============================================================
// v1.4.4 #32+47：daemon 退出码落盘与 doctor 感知
// 核心回归：writeHealthFile 诞生即死已接线——退出码 78 可被 checkDaemonHealth 检出
// ============================================================
describe('daemon 退出码落盘与 doctor 感知（v1.4.4 #32+47）', () => {
  let testDir: string;
  let savedData: string | undefined;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-exit-'));
    savedData = process.env.SOFAGENT_DATA;
    process.env.SOFAGENT_DATA = testDir;
  });

  afterEach(() => {
    if (savedData === undefined) delete process.env.SOFAGENT_DATA;
    else process.env.SOFAGENT_DATA = savedData;
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('recordDaemonExit(78) 落盘 lastExitCode=78 + status=stopped', () => {
    writeHealthFile('start');
    recordDaemonExit(78, 'uncaught-exception', 'boom: config corrupt');
    const health = readHealthFile();
    expect(health).not.toBeNull();
    expect(health!.lastExitCode).toBe(78);
    expect(health!.stoppedReason).toBe('uncaught-exception');
    expect(health!.status).toBe('stopped');
    expect(health!.lastError).toBe('boom: config corrupt');
  });

  it('正常停止（exit 0）不触发死亡判定', () => {
    writeHealthFile('start');
    recordDaemonExit(0, 'sigint');
    const result = checkDaemonHealth();
    // exit 0 + 心跳新鲜 → 不是 dead（可能 running 或新启动覆盖）
    expect(result.status).not.toBe('dead');
    expect(result.healthy).toBe(true);
  });

  it('exit 78 + 心跳陈旧 → checkDaemonHealth 判 dead（守护已死亡可感知）', () => {
    writeHealthFile('start');
    recordDaemonExit(78, 'uncaught-exception', 'fatal');
    // 人工把心跳拨回 11min 前（recordDaemonExit 刚写的 lastHeartbeat 是现在）
    const healthPath = resolveHealthFilePath();
    const raw = JSON.parse(fs.readFileSync(healthPath, 'utf-8')) as { lastHeartbeat: string };
    raw.lastHeartbeat = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    fs.writeFileSync(healthPath, JSON.stringify(raw, null, 2), 'utf-8');

    const result = checkDaemonHealth();
    expect(result.status).toBe('dead');
    expect(result.healthy).toBe(false);
    expect(result.message).toContain('exit 78');
    expect(result.message).toContain('uncaught-exception');
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
