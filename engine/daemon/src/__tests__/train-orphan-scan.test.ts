// ============================================================
// train-orphan-scan.test.ts · v1.4.1 块七 · 训练孤儿任务巡检测试（daemon 侧）
// ============================================================
//
// 覆盖：
// - L1 注册：train-orphan-scan 在 LAYER_INSPECTORS.L1（自动 @daily）
// - 无 data/train：跳过（info 不告警）
// - 运行中全活：不触发（info）
// - 假活 job：triggered=true + severity warning + 告警消息含定位
// - 坏 state.json：容忍跳过不崩溃
//
// 隔离：SOFAGENT_DATA 指向 tmp（避免扫真实 ~/.sofagent），
// probe 全部注入（零真实进程探测）。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runTrainOrphanScan, type ProbeFn } from '../inspectors/train-orphan-scan';
import { getLayerInspectorNames, LAYER_SCHEDULE } from '../inspector-layers';

/** 造一个 job 的 state.json（磁盘契约直写——daemon 侧不依赖 orchestrator 运行时） */
function seedJob(
  trainRoot: string,
  enterpriseId: string,
  jobId: string,
  status: string,
  pid?: number,
): void {
  const jobDir = path.join(trainRoot, enterpriseId, jobId);
  fs.mkdirSync(jobDir, { recursive: true });
  fs.writeFileSync(
    path.join(jobDir, 'state.json'),
    JSON.stringify({ jobId, enterpriseId, status, ...(pid !== undefined ? { pid } : {}) }),
  );
}

describe('train-orphan-scan · daemon L1 巡检', () => {
  let tmpDataDir: string;
  let trainRoot: string;
  let prevData: string | undefined;

  beforeEach(() => {
    tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-tos-'));
    trainRoot = path.join(tmpDataDir, 'train');
    prevData = process.env.SOFAGENT_DATA;
    process.env.SOFAGENT_DATA = tmpDataDir; // 隔离：loadEnvConfig 走这里
  });

  afterEach(() => {
    if (prevData === undefined) delete process.env.SOFAGENT_DATA;
    else process.env.SOFAGENT_DATA = prevData;
    try { fs.rmSync(tmpDataDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('test_getLayerInspectorNames_L1注册_trainOrphanScan在列', () => {
    // 场景：注册进 LAYER_INSPECTORS.L1——自动获得 @daily 调度
    expect(getLayerInspectorNames('L1')).toContain('train-orphan-scan');
    expect(LAYER_SCHEDULE.L1).toBe('@daily');
  });

  it('test_runTrainOrphanScan_无train目录_跳过返回info', () => {
    // 场景：全新部署没有训练任务——巡检跳过不告警
    const result = runTrainOrphanScan(tmpDataDir);
    expect(result.name).toBe('train-orphan-scan');
    expect(result.triggered).toBe(false);
    expect(result.severity).toBe('info');
    expect(result.message).toContain('不存在');
  });

  it('test_runTrainOrphanScan_无运行中任务_info不触发', () => {
    // 场景：有 train 目录但全是终态 job——无观测对象
    seedJob(trainRoot, 'ent-a', 'job-done-1', 'completed', 111);
    seedJob(trainRoot, 'ent-a', 'job-fail-1', 'failed', 112);
    const result = runTrainOrphanScan(tmpDataDir);
    expect(result.triggered).toBe(false);
    expect(result.message).toContain('无运行中训练任务');
  });

  it('test_runTrainOrphanScan_子进程全活_info不触发', () => {
    // 场景：running 的 job 进程都活着——健康（probe 注入全 true）
    seedJob(trainRoot, 'ent-a', 'job-alive-1', 'running', 12345);
    seedJob(trainRoot, 'ent-b', 'job-alive-2', 'checkpointing', 12346);
    const probe: ProbeFn = () => true;
    const result = runTrainOrphanScan(tmpDataDir, probe);
    expect(result.triggered).toBe(false);
    expect(result.severity).toBe('info');
    expect(result.message).toContain('2 个');
    expect(result.message).toContain('存活');
  });

  it('test_runTrainOrphanScan_死进程假活_触发warn含定位', () => {
    // 场景：state 说 running 但进程已死（引擎崩溃场景）——warn 告警 + 企业/job/pid 定位
    seedJob(trainRoot, 'ent-a', 'job-alive-1', 'running', 12345);
    seedJob(trainRoot, 'ent-x', 'job-dead-1', 'running', 66666);
    const probe: ProbeFn = (pid) => pid !== 66666; // 只有 66666 死
    const result = runTrainOrphanScan(tmpDataDir, probe);

    expect(result.triggered).toBe(true);
    expect(result.severity).toBe('warning');
    expect(result.message).toContain('1 个孤儿');
    expect(result.message).toContain('ent-x/job-dead-1');
    expect(result.message).toContain('pid=66666');
    expect(result.message).toContain('crash-recovery'); // 处置指引
  });

  it('test_runTrainOrphanScan_无pid字段的running_跳过不崩', () => {
    // 场景：旧版本 state.json 无 pid——无探测对象，容忍跳过
    seedJob(trainRoot, 'ent-a', 'job-nopid', 'running');
    const result = runTrainOrphanScan(tmpDataDir, () => false);
    expect(result.triggered).toBe(false);
  });

  it('test_runTrainOrphanScan_坏stateJson_容忍跳过', () => {
    // 场景：state.json 写坏（半截 JSON）——该 job 跳过，其余正常巡检
    seedJob(trainRoot, 'ent-a', 'job-dead-1', 'running', 77777);
    const badDir = path.join(trainRoot, 'ent-a', 'job-bad');
    fs.mkdirSync(badDir, { recursive: true });
    fs.writeFileSync(path.join(badDir, 'state.json'), '{broken');
    const result = runTrainOrphanScan(tmpDataDir, () => false);

    expect(result.triggered).toBe(true); // job-dead-1 仍被发现
    expect(result.message).toContain('job-dead-1');
    expect(result.message).not.toContain('job-bad');
  });
});
