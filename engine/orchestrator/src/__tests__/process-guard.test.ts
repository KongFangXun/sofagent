// ============================================================
// process-guard.test.ts · v1.4.1 块七 · 训练进程守卫测试
// ============================================================
//
// 覆盖：
// - 心跳监听：注册/刷新/注销 + 超时判卡死（时钟注入冻结验证）
// - 进程组杀除：组杀成功 / 组杀失败降级单杀 / 双杀失败记录（mock kill）
// - GPU 显存快照：可用 / unsupported 降级（mock exec——不装假数据）
// - 异常回收四步：kill → gpu → tmp 清理 → 审计入链（方案 A 验证）
// - 临时文件清理：tmp 前缀删除非 tmp 保留
// - 孤儿检测：特征命中 / 有主排除 / 可选杀除
//
// A2 纪律：kill/exec/时钟全部注入，零真实进程零真实 shell。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  createProcessGuard,
  snapshotGpuMemory,
  killProcessGroup,
  abnormalReclaim,
  cleanupTmpFiles,
  emitTrainAbnormalExit,
  detectTrainOrphans,
  type KillFn,
  type ExecFn,
} from '../train/process-guard';
import { createTrainJob } from '../train/train-job';
import { checkTrainAuditChain } from '../train/train-audit';

describe('process-guard · 心跳监听', () => {
  it('test_registerHeartbeat_注册后立即可检测_不判卡死', () => {
    // 场景：spawn 后立即注册心跳——注册即心跳，不应判卡死
    let t = 1000; // 冻结时钟（ms）
    const guard = createProcessGuard({ now: () => t });
    guard.registerHeartbeat(1234, 'job-1');
    expect(guard.size()).toBe(1);
    expect(guard.detectStalled()).toHaveLength(0);
  });

  it('test_registerHeartbeat_非法pid与jobId_拒绝注册并抛错', () => {
    // 场景：pid 非法（0/负数/非数值）或 jobId 为空——防脏数据进表
    const guard = createProcessGuard();
    expect(() => guard.registerHeartbeat(0, 'job-1')).toThrow(/非法 pid/);
    expect(() => guard.registerHeartbeat(-5, 'job-1')).toThrow(/非法 pid/);
    expect(() => guard.registerHeartbeat(Number.NaN, 'job-1')).toThrow(/非法 pid/);
    expect(() => guard.registerHeartbeat(1234, '')).toThrow(/非法 jobId/);
    expect(guard.size()).toBe(0);
  });

  it('test_detectStalled_超过阈值无心跳_判卡死并返回静默时长', () => {
    // 场景：默认 120s 阈值——121s 无心跳判卡死，silentMs 口径正确
    let t = 1_000_000;
    const guard = createProcessGuard({ now: () => t });
    guard.registerHeartbeat(111, 'job-a');
    guard.registerHeartbeat(222, 'job-b');
    t += 121_000; // 两个都超时
    const stalled = guard.detectStalled();
    expect(stalled).toHaveLength(2);
    expect(stalled[0]!.pid).toBe(111); // pid 升序稳定输出
    expect(stalled[0]!.silentMs).toBe(121_000);
    expect(stalled[0]!.jobId).toBe('job-a');
  });

  it('test_markHeartbeat_定期刷新_永不判卡死', () => {
    // 场景：事件回流时刷新心跳（下一波 scheduler 挂钩点）——每 60s 刷一次，
    // 即使总时长远超阈值也不判卡死
    let t = 0;
    const guard = createProcessGuard({ now: () => t });
    guard.registerHeartbeat(333, 'job-c');
    for (let i = 0; i < 10; i++) {
      t += 60_000;
      guard.markHeartbeat(333);
    }
    expect(guard.detectStalled()).toHaveLength(0);
  });

  it('test_markHeartbeat_未注册pid_返回false不抛错', () => {
    const guard = createProcessGuard();
    expect(guard.markHeartbeat(99999)).toBe(false);
  });

  it('test_unregisterHeartbeat_进程正常退出注销_表收缩', () => {
    // 场景：正常退出进程从表移除——防表膨胀 + 防误判已退出进程
    let t = 0;
    const guard = createProcessGuard({ now: () => t });
    guard.registerHeartbeat(444, 'job-d');
    guard.registerHeartbeat(555, 'job-e');
    guard.unregisterHeartbeat(444);
    expect(guard.size()).toBe(1);
    t += 121_000; // 推进时钟超阈值——只剩 555 判卡死
    expect(guard.detectStalled().map((s) => s.pid)).toEqual([555]);
  });

  it('test_detectStalled_阈值可配_自定义间隔生效', () => {
    // 场景：阈值配 30s——31s 即判卡死（不同训练负载可调）
    let t = 0;
    const guard = createProcessGuard({ staleThresholdMs: 30_000, now: () => t });
    guard.registerHeartbeat(666, 'job-f');
    t += 31_000;
    expect(guard.detectStalled()).toHaveLength(1);
  });
});

describe('process-guard · 进程组杀除（mock kill）', () => {
  it('test_killProcessGroup_组杀成功_一次命中进程组', () => {
    // 场景：detached spawn 的组长——kill(-pid) 一次杀整组
    const calls: Array<{ pid: number; signal: string }> = [];
    const killFn: KillFn = (pid, signal) => {
      calls.push({ pid, signal: String(signal) });
    };
    const step = killProcessGroup(777, killFn);
    expect(step.ok).toBe(true);
    expect(step.detail).toContain('进程组 -777');
    expect(calls).toEqual([{ pid: -777, signal: 'SIGKILL' }]); // 单次组杀，无降级
  });

  it('test_killProcessGroup_组杀失败_降级单杀并记录', () => {
    // 场景：非 detached spawn（无进程组）——组杀抛 ESRCH，降级单杀成功
    const calls: Array<{ pid: number }> = [];
    const killFn: KillFn = (pid) => {
      calls.push({ pid });
      if (pid < 0) throw new Error('ESRCH: no such process group');
    };
    const step = killProcessGroup(888, killFn);
    expect(step.ok).toBe(true);
    expect(step.detail).toContain('降级单杀');
    expect(calls.map((c) => c.pid)).toEqual([-888, 888]); // 先组后单
  });

  it('test_killProcessGroup_组杀单杀双失败_ok为false留痕', () => {
    // 场景：进程早已消失（别人已杀）——双杀均失败，记录不抛出
    const killFn: KillFn = () => {
      throw new Error('ESRCH');
    };
    const step = killProcessGroup(999, killFn);
    expect(step.ok).toBe(false);
    expect(step.detail).toContain('均失败');
  });
});

describe('process-guard · GPU 显存快照（mock exec）', () => {
  it('test_snapshotGpuMemory_nvidiaSmi可用_返回各卡显存', () => {
    // 场景：两卡机——csv 输出解析为 perGpuUsedMiB
    const execFn: ExecFn = () => '1024\n2048\n';
    const snap = snapshotGpuMemory(execFn);
    expect(snap.supported).toBe(true);
    expect(snap.perGpuUsedMiB).toEqual([1024, 2048]);
    expect(snap.note).toContain('2 卡');
  });

  it('test_snapshotGpuMemory_无nvidiaSmi_unsupported不装假数据', () => {
    // 场景：macOS 无 nvidia-smi——ENOENT 降级 unsupported，note 记原因
    const execFn: ExecFn = () => {
      throw new Error('spawnSync nvidia-smi ENOENT');
    };
    const snap = snapshotGpuMemory(execFn);
    expect(snap.supported).toBe(false);
    expect(snap.perGpuUsedMiB).toBeUndefined();
    expect(snap.note).toContain('不可用');
  });
});

describe('process-guard · 异常回收四步 + 审计入链（方案 A）', () => {
  let dataDir: string;
  let jobId: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-pg-'));
    const { record } = createTrainJob({
      dataDir,
      enterpriseId: 'ent-guard',
      dataPath: '/tmp/fake-data.csv',
      baseModel: 'qwen3:4b',
      algorithm: 'sft',
    });
    jobId = record.jobId;
  });

  afterEach(() => {
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('test_abnormalReclaim_四步全记录_审计事件入HMAC链', () => {
    // 场景：卡死 job 的完整回收——kill/gpu/tmp/audit 四步均执行且留痕，
    // 审计行进 audit.jsonl 且与 train-audit 链兼容（checkTrainAuditChain ok）
    const killCalls: number[] = [];
    const result = abnormalReclaim(dataDir, {
      enterpriseId: 'ent-guard',
      jobId,
      pid: 12345,
      reason: '心跳超时 121s',
      dataPath: '/tmp/fake-data.csv',
    }, {
      killFn: (pid) => { killCalls.push(pid); },
      execFn: () => { throw new Error('ENOENT'); }, // 无 GPU——unsupported 分支
    });

    expect(result.steps.map((s) => s.name)).toEqual(['kill', 'gpu-notify', 'tmp-cleanup', 'audit']);
    expect(killCalls).toEqual([-12345]); // 组杀成功（无降级单杀）
    expect(result.steps[1]!.detail).toContain('unsupported'); // GPU 降级留痕
    expect(result.steps[3]!.ok).toBe(true); // 审计写入成功
    expect(result.allOk).toBe(true);

    // 再触发一次回收——审计行 ≥2 条构成可验证链（checkTrainAuditChain 需要 ≥2 条）
    abnormalReclaim(dataDir, {
      enterpriseId: 'ent-guard',
      jobId,
      pid: 12345,
      reason: '心跳超时 121s（第二次）',
      dataPath: '/tmp/fake-data.csv',
    }, {
      killFn: () => { /* */ },
      execFn: () => { throw new Error('ENOENT'); },
    });
    // 审计链完整性：abnormal_exit 事件与其他事件同链（方案 A 核心验证）
    const chain = checkTrainAuditChain(dataDir, 'ent-guard', jobId);
    expect(chain.status).toBe('ok');
  });

  it('test_abnormalReclaim_组杀降级单杀_detail留痕', () => {
    // 场景：非 detached 进程——组杀失败降级单杀，detail 记录降级路径
    const result = abnormalReclaim(dataDir, {
      enterpriseId: 'ent-guard',
      jobId,
      pid: 22222,
      reason: '测试降级',
      dataPath: '/tmp/fake-data.csv',
    }, {
      killFn: (pid) => {
        if (pid < 0) throw new Error('ESRCH');
      },
      execFn: () => '512\n',
    });
    const killStep = result.steps[0]!;
    expect(killStep.ok).toBe(true);
    expect(killStep.detail).toContain('降级单杀');
  });

  it('test_emitTrainAbnormalExit_审计行含reason与steps摘要', () => {
    // 场景：单独调用审计写入——reason 含四步 ok/fail 摘要
    const step = emitTrainAbnormalExit(dataDir, {
      enterpriseId: 'ent-guard',
      jobId,
      pid: 33333,
      reason: '孤儿回收',
      dataPath: '/tmp/fake-data.csv',
    }, [
      { name: 'kill', ok: true, detail: '组杀成功' },
      { name: 'gpu-notify', ok: true, detail: 'unsupported' },
    ]);
    expect(step.ok).toBe(true);
    const auditFile = path.join(dataDir, 'train', 'ent-guard', jobId, 'audit.jsonl');
    const lines = fs.readFileSync(auditFile, 'utf-8').trim().split('\n');
    const entry = JSON.parse(lines[lines.length - 1]!) as { type: string; reason: string };
    expect(entry.type).toBe('train_abnormal_exit');
    expect(entry.reason).toContain('kill=ok');
    expect(entry.reason).toContain('gpu-notify=ok');
    // 明细文件也落盘（观测面）
    const detailFile = path.join(dataDir, 'train', 'ent-guard', jobId, 'reclaim-detail.jsonl');
    expect(fs.existsSync(detailFile)).toBe(true);
  });
});

describe('process-guard · 临时文件清理', () => {
  let dataDir: string;
  let jobId: string;
  let jobDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-tmp-'));
    const { record } = createTrainJob({
      dataDir,
      enterpriseId: 'ent-tmp',
      dataPath: '/tmp/fake-data.csv',
      baseModel: 'qwen3:4b',
      algorithm: 'sft',
    });
    jobId = record.jobId;
    jobDir = path.join(dataDir, 'train', 'ent-tmp', jobId);
  });

  afterEach(() => {
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('test_cleanupTmpFiles_tmp前缀文件_全部删除', () => {
    // 场景：训练中途的临时文件（tmp 前缀）——回收时清掉
    fs.writeFileSync(path.join(jobDir, 'tmp-shard-0.bin'), 'x');
    fs.writeFileSync(path.join(jobDir, 'tmp-upload.part'), 'y');
    const step = cleanupTmpFiles(dataDir, 'ent-tmp', jobId);
    expect(step.ok).toBe(true);
    expect(step.detail).toContain('2 个');
    expect(fs.existsSync(path.join(jobDir, 'tmp-shard-0.bin'))).toBe(false);
    expect(fs.existsSync(path.join(jobDir, 'tmp-upload.part'))).toBe(false);
  });

  it('test_cleanupTmpFiles_非tmp前缀文件_保留不动', () => {
    // 场景：正经产物（state.json/job.json）不能被误删
    fs.writeFileSync(path.join(jobDir, 'output.bin'), 'keep me');
    const step = cleanupTmpFiles(dataDir, 'ent-tmp', jobId);
    expect(step.ok).toBe(true);
    expect(step.detail).toContain('无 tmp 前缀文件');
    expect(fs.existsSync(path.join(jobDir, 'output.bin'))).toBe(true);
    expect(fs.existsSync(path.join(jobDir, 'state.json'))).toBe(true); // 状态文件保留
  });

  it('test_cleanupTmpFiles_job目录不存在_安全跳过', () => {
    const step = cleanupTmpFiles(dataDir, 'ent-tmp', 'job-not-exist');
    expect(step.ok).toBe(true);
    expect(step.detail).toContain('不存在');
  });
});

describe('process-guard · 孤儿检测', () => {
  it('test_detectTrainOrphans_训练特征无归属进程_标记孤儿', () => {
    // 场景：python train.py 进程但命令行无任何已知 jobId——孤儿（引擎重启丢表/job 目录被删）
    const { orphans } = detectTrainOrphans(
      [
        { pid: 100, command: 'python train.py --config /x/job-abc-123/job.json' },
        { pid: 101, command: 'python -u train.py' },
        { pid: 102, command: 'node server.js --config prod' }, // 非训练进程（非 python）
      ],
      ['job-known-001'],
    );
    expect(orphans.map((o) => o.pid)).toEqual([100, 101]);
    expect(orphans[0]!.matchedBy).toContain('train.py');
    expect(orphans[0]!.matchedBy).toContain('--config');
  });

  it('test_detectTrainOrphans_命令行含已知jobId_有主不报', () => {
    // 场景：进程命令行指向已知 job 的 config——有归属，不报孤儿
    const { orphans } = detectTrainOrphans(
      [
        { pid: 200, command: 'python train.py --config /data/train/ent/job-known-001/job.json' },
      ],
      ['job-known-001'],
    );
    expect(orphans).toHaveLength(0);
  });

  it('test_detectTrainOrphans_默认不杀_显式kill选项才杀除', () => {
    // 场景：铁律——检测默认只标记告警；杀除必须显式 opt-in
    const procs = [{ pid: 300, command: 'python train.py' }];
    const defaultResult = detectTrainOrphans(procs, []);
    expect(defaultResult.orphans).toHaveLength(1);
    expect(defaultResult.killed).toHaveLength(0); // 默认零杀除

    const killed: number[] = [];
    const killResult = detectTrainOrphans(procs, [], {
      kill: true,
      killFn: (pid) => { killed.push(pid); },
    });
    expect(killResult.killed).toEqual([300]);
    expect(killed).toEqual([300]);
  });

  it('test_detectTrainOrphans_杀失败_保留告警列表', () => {
    // 场景：kill 抛错（进程恰好已退出）——孤儿仍留在告警列表
    const { orphans, killed } = detectTrainOrphans(
      [{ pid: 400, command: 'python train.py' }],
      [],
      { kill: true, killFn: () => { throw new Error('ESRCH'); } },
    );
    expect(orphans).toHaveLength(1);
    expect(killed).toHaveLength(0);
  });
});
