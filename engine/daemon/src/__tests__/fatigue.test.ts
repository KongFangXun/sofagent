// ============================================================
// fatigue.test.ts · Agent 疲劳度检测测试（v1.3.6 交付⑬）
// 验收标准：
//   - 3 个疲劳信号可采集（连续失败 / 窗口占用 / 输出相似度）
//   - 疲劳度评分写 daemon-health.json
//   - 超阈值触发 compact 或重启建议
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  FatigueTracker,
  computeFatigueScore,
  recommendAction,
  outputSimilarity,
  writeFatigueReport,
  readFatigueReport,
  COMPACT_THRESHOLD,
  RESTART_THRESHOLD,
} from '../fatigue';

describe('fatigue 信号采集', () => {
  let tracker: FatigueTracker;

  beforeEach(() => {
    tracker = new FatigueTracker();
  });

  it('信号 1：同一工具连续失败计数递增，成功后归零', () => {
    expect(tracker.recordToolCall('run_bash', false)).toBe(1);
    expect(tracker.recordToolCall('run_bash', false)).toBe(2);
    expect(tracker.recordToolCall('run_bash', false)).toBe(3);
    expect(tracker.getConsecutiveFailures('run_bash')).toBe(3);
    // 成功 → 归零
    expect(tracker.recordToolCall('run_bash', true)).toBe(0);
    expect(tracker.getConsecutiveFailures('run_bash')).toBe(0);
    // 未记录过的工具 = 0
    expect(tracker.getConsecutiveFailures('never-seen')).toBe(0);
  });

  it('信号 1：跨工具取最严重（最大连续失败）', () => {
    tracker.recordToolCall('a', false);
    tracker.recordToolCall('b', false);
    tracker.recordToolCall('b', false);
    tracker.recordToolCall('c', false);
    tracker.recordToolCall('c', false);
    tracker.recordToolCall('c', false);
    const signals = tracker.collectSignals();
    expect(signals.toolConsecutiveFailures).toBe(3); // c 连败 3 次最严重
  });

  it('信号 2：窗口占用率截断到 0-1', () => {
    tracker.setWindowOccupancy(0.92);
    expect(tracker.collectSignals().windowOccupancy).toBe(0.92);
    tracker.setWindowOccupancy(1.5); // 超界截断
    expect(tracker.collectSignals().windowOccupancy).toBe(1);
    tracker.setWindowOccupancy(-0.3); // 负数截断
    expect(tracker.collectSignals().windowOccupancy).toBe(0);
    tracker.setWindowOccupancy(NaN); // NaN 归零
    expect(tracker.collectSignals().windowOccupancy).toBe(0);
  });

  it('信号 3：输出相似度——复读机检测', () => {
    const reply = '我已经完成了任务，结果写入 result.md，请查收确认';
    tracker.recordOutput(reply);
    tracker.recordOutput(reply); // 完全复读
    expect(tracker.collectSignals().outputSimilarity).toBe(1);
  });

  it('信号 3：无历史输出时相似度为 0', () => {
    tracker.recordOutput('第一条输出，没有历史可比对');
    expect(tracker.collectSignals().outputSimilarity).toBe(0);
    // 全新空 tracker
    expect(new FatigueTracker().collectSignals().outputSimilarity).toBe(0);
  });

  it('信号 3：全新内容相似度低', () => {
    tracker.recordOutput('今天天气晴朗，适合出门散步呼吸新鲜空气');
    tracker.recordOutput('数据库连接超时，需要检查网络配置和端口设置');
    expect(tracker.collectSignals().outputSimilarity).toBeLessThan(0.3);
  });

  it('输出历史环形缓冲——超容量丢最旧', () => {
    const tracker2 = new FatigueTracker();
    for (let i = 0; i < 25; i++) {
      tracker2.recordOutput(`输出内容编号 ${i}，用于测试环形缓冲容量上限`);
    }
    // 不抛错且能正常评估
    const report = tracker2.assess();
    expect(report.score).toBeGreaterThanOrEqual(0);
  });

  it('reset 清空全部信号', () => {
    tracker.recordToolCall('x', false);
    tracker.recordToolCall('x', false);
    tracker.setWindowOccupancy(0.8);
    tracker.recordOutput('一些输出内容，用来测试重置功能是否生效');
    tracker.reset();
    const signals = tracker.collectSignals();
    expect(signals.toolConsecutiveFailures).toBe(0);
    expect(signals.windowOccupancy).toBe(0);
    expect(signals.outputSimilarity).toBe(0);
  });
});

describe('fatigue 评分与建议动作', () => {
  it('outputSimilarity Jaccard 计算正确', () => {
    // 完全相同 → 1
    expect(outputSimilarity('a b c d e f', 'a b c d e f')).toBe(1);
    // 完全不重叠 → 0
    expect(outputSimilarity('alpha beta gamma delta epsilon', 'one two three four five')).toBe(0);
    // 太短不参与（< 5 token）
    expect(outputSimilarity('hi', 'hi there my friend')).toBe(0);
    // 部分重叠在 0-1 之间
    const s = outputSimilarity('a b c d e', 'c d e f g');
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });

  it('computeFatigueScore 加权正确', () => {
    // 全满信号 = 100
    expect(computeFatigueScore({ toolConsecutiveFailures: 5, windowOccupancy: 1, outputSimilarity: 1 })).toBe(100);
    // 连败饱和封顶（10 次也只算满 40）
    expect(computeFatigueScore({ toolConsecutiveFailures: 10, windowOccupancy: 0, outputSimilarity: 0 })).toBe(40);
    // 全零信号 = 0
    expect(computeFatigueScore({ toolConsecutiveFailures: 0, windowOccupancy: 0, outputSimilarity: 0 })).toBe(0);
    // 只有窗口满 = 30
    expect(computeFatigueScore({ toolConsecutiveFailures: 0, windowOccupancy: 1, outputSimilarity: 0 })).toBe(30);
  });

  it('recommendAction 三级阈值', () => {
    expect(recommendAction(0)).toBe('none');
    expect(recommendAction(COMPACT_THRESHOLD - 1)).toBe('none');
    expect(recommendAction(COMPACT_THRESHOLD)).toBe('compact');
    expect(recommendAction(RESTART_THRESHOLD - 1)).toBe('compact');
    expect(recommendAction(RESTART_THRESHOLD)).toBe('restart');
    expect(recommendAction(100)).toBe('restart');
  });

  it('assess 端到端——高疲劳触发 restart 建议', () => {
    const tracker = new FatigueTracker();
    for (let i = 0; i < 5; i++) tracker.recordToolCall('run_bash', false);
    tracker.setWindowOccupancy(1); // 窗口拉满
    // 多 token 输出（中文无空格分词 token 少，用含空格文本保证 ≥5 token）
    const reply = 'retry the same command again hoping it will work this time';
    tracker.recordOutput(reply);
    tracker.recordOutput(reply); // 复读
    const report = tracker.assess();
    // 40（连败满）+ 30（窗口满）+ 30（复读满）= 100
    expect(report.score).toBeGreaterThanOrEqual(RESTART_THRESHOLD);
    expect(report.action).toBe('restart');
    expect(report.summary).toContain('建议重启');
    expect(report.ts).toBeTruthy();
  });

  it('assess 端到端——中疲劳触发 compact 建议', () => {
    const tracker = new FatigueTracker();
    for (let i = 0; i < 4; i++) tracker.recordToolCall('sf_write', false);
    tracker.setWindowOccupancy(0.7);
    const report = tracker.assess();
    // 4/5*40 + 0.7*30 = 32 + 21 = 53 → 需再加相似度或占用才能到 compact；
    // 这里直接断言落在 compact 区间
    tracker.setWindowOccupancy(1);
    const report2 = tracker.assess();
    expect(report2.score).toBeGreaterThanOrEqual(COMPACT_THRESHOLD);
    expect(report2.score).toBeLessThan(RESTART_THRESHOLD);
    expect(report2.action).toBe('compact');
    expect(report2.summary).toContain('/compact');
    expect(report.score).toBeLessThan(report2.score);
  });

  it('assess 端到端——无信号状态正常', () => {
    const report = new FatigueTracker().assess();
    expect(report.score).toBe(0);
    expect(report.action).toBe('none');
    expect(report.summary).toContain('状态正常');
  });
});

describe('fatigue 写 daemon-health.json', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-fatigue-'));
  });

  afterEach(() => {
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('writeFatigueReport 创建 daemon-health.json 并写 fatigue 字段', () => {
    const report = new FatigueTracker().assess();
    expect(writeFatigueReport(report, testDir)).toBe(true);

    const healthPath = path.join(testDir, 'daemon-health.json');
    expect(fs.existsSync(healthPath)).toBe(true);
    const health = JSON.parse(fs.readFileSync(healthPath, 'utf-8'));
    expect(health.fatigue).toBeDefined();
    expect(health.fatigue.score).toBe(report.score);
    expect(health.fatigue.action).toBe(report.action);
  });

  it('writeFatigueReport 合并现有 health 字段（不覆盖 pid/heartbeat）', () => {
    const healthPath = path.join(testDir, 'daemon-health.json');
    const existing = { pid: 12345, status: 'running', lastHeartbeat: '2026-08-17T10:00:00Z' };
    fs.writeFileSync(healthPath, JSON.stringify(existing), 'utf-8');

    const tracker = new FatigueTracker();
    tracker.setWindowOccupancy(0.99);
    const report = tracker.assess();
    expect(writeFatigueReport(report, testDir)).toBe(true);

    const health = JSON.parse(fs.readFileSync(healthPath, 'utf-8'));
    expect(health.pid).toBe(12345); // 原字段保留
    expect(health.status).toBe('running');
    expect(health.fatigue.score).toBe(30); // 只有窗口满 = 30
  });

  it('writeFatigueReport 容忍损坏文件（重建）', () => {
    const healthPath = path.join(testDir, 'daemon-health.json');
    fs.writeFileSync(healthPath, '{ broken json', 'utf-8');
    const report = new FatigueTracker().assess();
    expect(writeFatigueReport(report, testDir)).toBe(true);
    const health = JSON.parse(fs.readFileSync(healthPath, 'utf-8'));
    expect(health.fatigue).toBeDefined();
  });

  it('readFatigueReport 往返一致', () => {
    const tracker = new FatigueTracker();
    tracker.recordToolCall('tool', false);
    tracker.recordToolCall('tool', false);
    const report = tracker.assess();
    writeFatigueReport(report, testDir);
    const read = readFatigueReport(testDir);
    expect(read).not.toBeNull();
    expect(read!.score).toBe(report.score);
    expect(read!.signals.toolConsecutiveFailures).toBe(2);
  });

  it('readFatigueReport 文件不存在返回 null', () => {
    expect(readFatigueReport(testDir)).toBeNull();
  });
});
