// ============================================================
// crash-recovery.test.ts · v1.4.1 块七 · 引擎崩溃恢复测试
// ============================================================
//
// 覆盖：
// - 假活检测：state=running 但 pid 已死 → 标 interrupted（mock probe）
// - 活进程跳过：引擎重启后子进程仍在 → 不动状态
// - interrupted 标记落盘：state.json 状态与 reason
// - 三选项决策：resume-checkpoint（无断点拒绝）/ mark-failed / human-review
// - 崩溃日志 append-only：连续追加不覆盖 + 坏行容忍回读
// - checkpoint manifest：登记/幂等/递增版本/坏数据降级
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  runCrashRecoveryScan,
  applyRecoveryDecision,
  appendEngineCrashLog,
  readEngineCrashLog,
  engineCrashLogPath,
  loadCheckpointManifest,
  recordCheckpointEntry,
  checkpointManifestPath,
  type ProbeFn,
  type EngineCrashLogEntry,
} from '../train/crash-recovery';
import { createTrainJob, loadTrainJobRecord, transitionTrainJob } from '../train/train-job';

/** 造一个 running + pid 的 job（走真实状态机路径） */
function seedRunningJob(dataDir: string, enterpriseId: string, pid: number, jobId?: string): string {
  const { record } = createTrainJob({
    dataDir,
    enterpriseId,
    ...(jobId ? { jobId } : {}),
    dataPath: '/tmp/fake-data.csv',
    baseModel: 'qwen3:4b',
    algorithm: 'sft',
  });
  transitionTrainJob(dataDir, enterpriseId, record.jobId, 'running', { pid });
  return record.jobId;
}

describe('crash-recovery · 假活扫描', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-cr-'));
  });
  afterEach(() => {
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('test_runCrashRecoveryScan_running状态死pid_标interrupted并记录', () => {
    // 场景：引擎崩溃重启——state=running 但子进程已死（probe 返回 false）
    const jobId = seedRunningJob(dataDir, 'ent-cr', 99999);
    const probe: ProbeFn = () => false; // 全死

    const result = runCrashRecoveryScan(dataDir, probe);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.jobId).toBe(jobId);
    expect(result.findings[0]!.pid).toBe(99999);
    expect(result.findings[0]!.status).toBe('running');

    // 状态已标 interrupted（区别于 failed——可恢复中断）
    const record = loadTrainJobRecord(dataDir, 'ent-cr', jobId);
    expect(record!.status).toBe('interrupted');
    expect(record!.reason).toContain('引擎崩溃恢复');
  });

  it('test_runCrashRecoveryScan_活进程_状态不动', () => {
    // 场景：引擎重启后子进程还活着（外部 spawn 的场景）——不该被打扰
    const jobId = seedRunningJob(dataDir, 'ent-cr', 12345);
    const result = runCrashRecoveryScan(dataDir, () => true);

    expect(result.findings).toHaveLength(0);
    const record = loadTrainJobRecord(dataDir, 'ent-cr', jobId);
    expect(record!.status).toBe('running'); // 保持 running
  });

  it('test_runCrashRecoveryScan_终态与queued任务_不在扫描面', () => {
    // 场景：completed/failed/cancelled/queued 的 job 不探测不标记
    const { record: queuedJob } = createTrainJob({
      dataDir, enterpriseId: 'ent-cr', dataPath: '/x.csv', baseModel: 'm', algorithm: 'sft',
    });
    const doneJob = seedRunningJob(dataDir, 'ent-cr', 11111);
    transitionTrainJob(dataDir, 'ent-cr', doneJob, 'completed');

    const result = runCrashRecoveryScan(dataDir, () => false); // 全死探测

    expect(result.findings.map((f) => f.jobId)).not.toContain(queuedJob.jobId);
    expect(result.findings.map((f) => f.jobId)).not.toContain(doneJob);
    expect(result.findings).toHaveLength(0);
  });

  it('test_runCrashRecoveryScan_checkpointing状态死pid_同样标interrupted', () => {
    // 场景：SIGINT 存档中途崩溃——checkpointing 也是活跃态，同样要恢复
    const jobId = seedRunningJob(dataDir, 'ent-cr', 22222);
    transitionTrainJob(dataDir, 'ent-cr', jobId, 'checkpointing', {
      lastCheckpoint: { checkpointPath: 'checkpoints/ckpt-100', step: 100 },
    });
    const result = runCrashRecoveryScan(dataDir, () => false);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.hasCheckpoint).toBe(true); // 断点就绪——三选项①可用
    expect(loadTrainJobRecord(dataDir, 'ent-cr', jobId)!.status).toBe('interrupted');
  });

  it('test_runCrashRecoveryScan_发现即写崩溃日志_engineCrashLog', () => {
    // 场景：扫描发现假活 → train_engine_crash_recover 落 engine-crash-log.jsonl
    seedRunningJob(dataDir, 'ent-cr', 33333);
    runCrashRecoveryScan(dataDir, () => false);

    const { entries } = readEngineCrashLog(dataDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.type).toBe('train_engine_crash_recover');
    expect(entries[0]!.fromStatus).toBe('running');
    expect(entries[0]!.toStatus).toBe('interrupted');
  });

  it('test_runCrashRecoveryScan_无train目录_空结果不抛错', () => {
    const result = runCrashRecoveryScan(dataDir, () => false);
    expect(result.findings).toHaveLength(0);
    expect(result.scannedJobs).toBe(0);
  });
});

describe('crash-recovery · 三选项决策', () => {
  let dataDir: string;
  const ent = 'ent-decide';

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-cd-'));
  });
  afterEach(() => {
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('test_applyRecoveryDecision_有checkpoint续跑_返回断点说明不spawn', () => {
    // 场景：选项①——checkpoint 就绪，返回续跑前置条件（实际 spawn 归 resumeTrainJob）
    const jobId = seedRunningJob(dataDir, ent, 44444);
    const { record } = { record: loadTrainJobRecord(dataDir, ent, jobId)! };
    // 直接落 interrupted + 断点（模拟扫描后状态）
    const next = { ...record, status: 'interrupted' as const, lastCheckpoint: { checkpointPath: 'checkpoints/ckpt-7', step: 700 } };
    fs.writeFileSync(
      path.join(dataDir, 'train', ent, jobId, 'state.json'),
      JSON.stringify(next, null, 2),
    );

    const result = applyRecoveryDecision(dataDir, ent, jobId, 'resume-checkpoint');
    expect(result.decision).toBe('resume-checkpoint');
    expect(result.detail).toContain('step=700');
    expect(result.detail).toContain('resumeTrainJob');
    // 决策本身不 spawn——状态保持 interrupted 等调度器续跑
    expect(loadTrainJobRecord(dataDir, ent, jobId)!.status).toBe('interrupted');
  });

  it('test_applyRecoveryDecision_无checkpoint续跑_拒绝并抛错', () => {
    // 场景：选项①但无断点——无法续跑，显式拒绝
    const jobId = seedRunningJob(dataDir, ent, 55555);
    const rec = loadTrainJobRecord(dataDir, ent, jobId)!;
    fs.writeFileSync(
      path.join(dataDir, 'train', ent, jobId, 'state.json'),
      JSON.stringify({ ...rec, status: 'interrupted' }, null, 2),
    );
    expect(() => applyRecoveryDecision(dataDir, ent, jobId, 'resume-checkpoint')).toThrow(/无 checkpoint/);
  });

  it('test_applyRecoveryDecision_标败终止_落failed终态', () => {
    // 场景：选项②——interrupted → failed（审计可追溯的放弃）
    const jobId = seedRunningJob(dataDir, ent, 66666);
    const rec = loadTrainJobRecord(dataDir, ent, jobId)!;
    fs.writeFileSync(
      path.join(dataDir, 'train', ent, jobId, 'state.json'),
      JSON.stringify({ ...rec, status: 'interrupted' }, null, 2),
    );

    const result = applyRecoveryDecision(dataDir, ent, jobId, 'mark-failed');
    expect(result.detail).toContain('failed');
    const after = loadTrainJobRecord(dataDir, ent, jobId)!;
    expect(after.status).toBe('failed');
    expect(after.finishedAt).toBeTruthy();
  });

  it('test_applyRecoveryDecision_人审挂起_保持interrupted', () => {
    // 场景：选项③——挂起等人（决策即不动）
    const jobId = seedRunningJob(dataDir, ent, 77777);
    const rec = loadTrainJobRecord(dataDir, ent, jobId)!;
    fs.writeFileSync(
      path.join(dataDir, 'train', ent, jobId, 'state.json'),
      JSON.stringify({ ...rec, status: 'interrupted' }, null, 2),
    );

    const result = applyRecoveryDecision(dataDir, ent, jobId, 'human-review');
    expect(result.detail).toContain('人工介入');
    expect(loadTrainJobRecord(dataDir, ent, jobId)!.status).toBe('interrupted');
  });

  it('test_applyRecoveryDecision_任务不存在_抛错', () => {
    expect(() => applyRecoveryDecision(dataDir, ent, 'job-ghost', 'human-review')).toThrow(/不存在/);
  });
});

describe('crash-recovery · 崩溃日志 append-only', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-cl-'));
  });
  afterEach(() => {
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('test_appendEngineCrashLog_连续追加_不覆盖既有行', () => {
    // 场景：多次引擎崩溃——日志只增不减（append-only 铁律）
    const entry = (n: number): EngineCrashLogEntry => ({
      type: 'train_engine_crash_recover',
      enterpriseId: 'ent-log',
      jobId: `job-log-${n}`,
      pid: 1000 + n,
      fromStatus: 'running',
      toStatus: 'interrupted',
      hasCheckpoint: false,
      ts: new Date(Date.now() + n).toISOString(),
    });
    appendEngineCrashLog(dataDir, entry(1));
    appendEngineCrashLog(dataDir, entry(2));
    appendEngineCrashLog(dataDir, entry(3));

    const { entries } = readEngineCrashLog(dataDir);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.jobId)).toEqual(['job-log-1', 'job-log-2', 'job-log-3']);
  });

  it('test_readEngineCrashLog_坏行容忍_计数不中断', () => {
    // 场景：日志被外物写坏一行——解析跳过坏行，计数暴露
    appendEngineCrashLog(dataDir, {
      type: 'train_engine_crash_recover',
      enterpriseId: 'ent-log', jobId: 'job-ok', pid: 1,
      fromStatus: 'running', toStatus: 'interrupted', hasCheckpoint: false, ts: new Date().toISOString(),
    });
    fs.appendFileSync(engineCrashLogPath(dataDir), 'not-a-json-line\n');
    const { entries, badLines } = readEngineCrashLog(dataDir);
    expect(entries).toHaveLength(1);
    expect(badLines).toBe(1);
  });

  it('test_readEngineCrashLog_文件不存在_空结果', () => {
    const { entries, badLines } = readEngineCrashLog(dataDir);
    expect(entries).toHaveLength(0);
    expect(badLines).toBe(0);
  });
});

describe('crash-recovery · checkpoint manifest 读写', () => {
  let dataDir: string;
  let jobId: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-ckpt-'));
    const { record } = createTrainJob({
      dataDir, enterpriseId: 'ent-ckpt', dataPath: '/x.csv', baseModel: 'm', algorithm: 'sft',
    });
    jobId = record.jobId;
  });
  afterEach(() => {
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('test_recordCheckpointEntry_登记递增_版本号连续', () => {
    // 场景：训练过程三次存档——version 1/2/3 递增，step 升序
    recordCheckpointEntry(dataDir, 'ent-ckpt', jobId, 100);
    recordCheckpointEntry(dataDir, 'ent-ckpt', jobId, 200);
    const { entry } = recordCheckpointEntry(dataDir, 'ent-ckpt', jobId, 300);

    expect(entry.version).toBe(3);
    expect(entry.step).toBe(300);
    const manifest = loadCheckpointManifest(dataDir, 'ent-ckpt', jobId);
    expect(manifest.entries.map((e) => e.version)).toEqual([1, 2, 3]);
    expect(manifest.entries.every((e) => e.createdAt)).toBe(true);
  });

  it('test_recordCheckpointEntry_同step幂等_不重复登记', () => {
    // 场景：重复上报同一断点（事件重放）——返回既有条目不新增
    recordCheckpointEntry(dataDir, 'ent-ckpt', jobId, 500);
    const { entry, created } = recordCheckpointEntry(dataDir, 'ent-ckpt', jobId, 500);
    expect(created).toBe(false);
    expect(entry.step).toBe(500);
    expect(loadCheckpointManifest(dataDir, 'ent-ckpt', jobId).entries).toHaveLength(1);
  });

  it('test_recordCheckpointEntry_自定义路径_清单记录原路径', () => {
    recordCheckpointEntry(dataDir, 'ent-ckpt', jobId, 42, 'checkpoints/custom-dir');
    const manifest = loadCheckpointManifest(dataDir, 'ent-ckpt', jobId);
    expect(manifest.entries[0]!.checkpointPath).toBe('checkpoints/custom-dir');
  });

  it('test_loadCheckpointManifest_无清单_降级空清单', () => {
    const manifest = loadCheckpointManifest(dataDir, 'ent-ckpt', jobId);
    expect(manifest.schemaVersion).toBe('v1');
    expect(manifest.entries).toHaveLength(0);
  });

  it('test_loadCheckpointManifest_坏数据_降级空清单不抛错', () => {
    // 场景：manifest.json 被写坏——降级空清单（调用方重建）
    const manifestPath = checkpointManifestPath(dataDir, 'ent-ckpt', jobId);
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, '{broken json');
    const manifest = loadCheckpointManifest(dataDir, 'ent-ckpt', jobId);
    expect(manifest.entries).toHaveLength(0);
  });
});
