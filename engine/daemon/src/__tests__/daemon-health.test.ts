// ============================================================
// daemon-health.test.ts · daemon 健康自检测试（v1.3.6 交付⑬ 补疲劳保留）
// 核心回归：心跳重写 daemon-health.json 时不擦除 fatigue 字段
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { writeHealthFile, readHealthFile } from '../daemon-health';
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
