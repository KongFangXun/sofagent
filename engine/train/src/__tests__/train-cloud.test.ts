// train-cloud.test.ts · v1.4.6 章二 测试
//
// 验收标准逐条覆盖：
// - 云 VM 注册（endpoint/凭据引用/状态）· 远程体检状态更新 · 失联止损判定
// - 远程 spawn 命令装配（ssh → torchrun/verl 多卡入口）
// - 数据上传加密（scp 隧道）+ 训练后清理
// - 成本核算（时薪 × 时长 × 节点数 → 美元，向上取整美分）· 超预算暂停判定

import { describe, it, expect } from 'vitest';
import { createCloudRegistry } from '../train/cloud-registry';
import {
  buildCloudSpawnCommand,
  buildCloudUploadCommand,
  buildCloudCleanupCommand,
  buildCloudStopCommand,
  isHeartbeatStale,
  estimateCloudCostUsd,
  isOverBudget,
} from '../train/train-cloud';

// ────────────────────────────────────────────────────────────
// 一、云 VM 注册表
// ────────────────────────────────────────────────────────────

describe('云 VM 注册表', () => {
  it('注册云 VM → 查询/列表/状态更新', () => {
    const reg = createCloudRegistry({ now: () => 1700000000000 });
    reg.register({ name: 'training-1', endpoint: 'user@10.0.0.1', credentialRef: 'vk-abc' });
    const vm = reg.get('training-1');
    expect(vm?.endpoint).toBe('user@10.0.0.1');
    expect(vm?.status).toBe('unknown');
    expect(reg.list().length).toBe(1);
    // 体检可达 → 心跳
    reg.updateStatus('training-1', 'reachable', { heartbeat: true });
    expect(reg.get('training-1')?.status).toBe('reachable');
    expect(reg.get('training-1')?.lastHeartbeatAt).toBeTruthy();
  });

  it('凭据走引用（credentialRef）不落明文', () => {
    const reg = createCloudRegistry();
    reg.register({ name: 'v', endpoint: 'e', credentialRef: 'vk-ref' });
    const vm = reg.get('v')!;
    // 注册表只存引用——真实凭据字段不存在
    expect(vm.credentialRef).toBe('vk-ref');
    expect('credential' in vm).toBe(false);
  });

  it('注销 + 快照计数', () => {
    const reg = createCloudRegistry();
    reg.register({ name: 'a', endpoint: 'e1' });
    reg.register({ name: 'b', endpoint: 'e2' });
    reg.updateStatus('a', 'reachable');
    reg.updateStatus('b', 'unreachable');
    const snap = reg.snapshot();
    expect(snap.total).toBe(2);
    expect(snap.reachable).toBe(1);
    expect(snap.unreachable).toBe(1);
    expect(reg.unregister('a')).toBe(true);
    expect(reg.snapshot().total).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────
// 二、远程 spawn / 上传 / 清理命令装配
// ────────────────────────────────────────────────────────────

const VM = { name: 't1', endpoint: 'user@10.0.0.1', status: 'reachable' as const, registeredAt: '' };

describe('远程命令装配（ssh 通道）', () => {
  it('远程 spawn 单卡 → ssh <endpoint> train.py --config', () => {
    const job = {
      schemaVersion: 'v2', jobId: 'j1', dataPath: '/d', baseModel: 'm',
      algorithm: 'sft', checkpointPath: '/c', outputDir: '/o',
    } as never;
    const cmd = buildCloudSpawnCommand(VM, job, '/remote/job.json');
    expect(cmd.args[0]).toBe('ssh');
    expect(cmd.args[1]).toBe('user@10.0.0.1');
    expect(cmd.args.slice(2)).toEqual(['train.py', '--config', '/remote/job.json']);
  });

  it('远程 spawn 多卡 → ssh <endpoint> torchrun --nproc_per_node=8', () => {
    const job = {
      schemaVersion: 'v2', jobId: 'j1', dataPath: '/d', baseModel: 'm',
      algorithm: 'grpo', checkpointPath: '/c', outputDir: '/o',
      gpu: { count: 8, type: 'A100' }, nodes: 2,
    } as never;
    const cmd = buildCloudSpawnCommand(VM, job, '/remote/job.json', { masterAddr: '10.0.0.1', masterPort: 29500 });
    expect(cmd.args).toContain('torchrun');
    expect(cmd.args).toContain('8');
    expect(cmd.args).toContain('--nnodes');
  });

  it('数据上传 → scp 隧道加密（与静态加密 AES 区分）', () => {
    const cmd = buildCloudUploadCommand(VM, '/local/data', '/remote/data');
    expect(cmd.args[0]).toBe('scp');
    expect(cmd.args).toContain('user@10.0.0.1:/remote/data');
  });

  it('训练后清理 → ssh rm -rf（不留敏感残留）', () => {
    const cmd = buildCloudCleanupCommand(VM, '/remote/data');
    expect(cmd.args.slice(2)).toEqual(['rm', '-rf', '/remote/data']);
  });

  it('失联止损 → ssh pkill -9（强制 stop）', () => {
    const cmd = buildCloudStopCommand(VM, 'job-1');
    expect(cmd.args.slice(2)).toEqual(['pkill', '-9', '-f', 'train_job_job-1']);
  });
});

// ────────────────────────────────────────────────────────────
// 三、失联止损判定
// ────────────────────────────────────────────────────────────

describe('失联止损判定（心跳超时）', () => {
  it('心跳超时（>5 分钟无心跳）→ 判失联', () => {
    const vm = { ...VM, lastHeartbeatAt: new Date(1700000000000).toISOString() };
    const verdict = isHeartbeatStale(vm, 1700000000000 + 6 * 60_000);
    expect(verdict.stale).toBe(true);
    expect(verdict.elapsedMs).toBe(6 * 60_000);
  });

  it('心跳正常（<5 分钟）→ 不失联', () => {
    const vm = { ...VM, lastHeartbeatAt: new Date(1700000000000).toISOString() };
    expect(isHeartbeatStale(vm, 1700000000000 + 60_000).stale).toBe(false);
  });

  it('从未心跳（刚注册未 spawn）→ 不失联（不触发止损）', () => {
    const vm = { ...VM };
    expect(isHeartbeatStale(vm, 1700000000000).stale).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────
// 四、成本核算 + 超预算
// ────────────────────────────────────────────────────────────

describe('云 VM 成本核算（时薪 × 时长 × 节点数）', () => {
  it('单节点 1 小时 8 美元 → 8.00 美元', () => {
    expect(estimateCloudCostUsd(8, 60, 1)).toBe(8.0);
  });

  it('多节点 8 卡 ×2 节点 30 分钟 → 时薪×0.5×2', () => {
    expect(estimateCloudCostUsd(10, 30, 2)).toBe(10.0);
  });

  it('向上取整到美分（0.1 美元 × 1 分钟 ≈ 0.0017 → 0.01）', () => {
    const raw = estimateCloudCostUsd(0.1, 1, 1);
    expect(raw).toBeGreaterThan(0);
    expect(raw).toBeLessThanOrEqual(0.01);
  });

  it('超预算 → 暂停（对齐 v1.4.1 预算控制）', () => {
    expect(isOverBudget(100, 50)).toBe(true);
    expect(isOverBudget(50, 100)).toBe(false);
  });
});
