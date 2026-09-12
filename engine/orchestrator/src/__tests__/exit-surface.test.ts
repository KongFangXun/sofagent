// ============================================================
// exit-surface.test.ts · 条目 9 第 0 步：orchestrator 窄出口消费面契约
// ============================================================
// 目的：锁定「daemon 侧消费者所需符号可从新 subpath 取到」——防止
//   package.json exports 子路径被摘掉、或 barrel 漏导出时静默回归到根 barrel。
//   （根 barrel 保持 1448 符号不变；窄入口是新增的消费面，不是替换面。）
// 覆盖：./train · ./loop · ./model-registry · ./team-state 四条子路径，
//   对应已迁移的 6 个 daemon 消费文件（real-provider / cloud-train /
//   cloud-exec / team-channel / cloud-events / cloud-train.test）。
// ============================================================
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(SRC, p), 'utf-8');

const SUBPATHS = ['./train', './loop', './model-registry', './team-state'] as const;

describe('条目 9 · orchestrator 窄出口消费面契约', () => {
  it('package.json exports 声明四条窄入口（types/require/default 齐备）', () => {
    const pkg = JSON.parse(readFileSync(join(SRC, '..', 'package.json'), 'utf-8')) as {
      exports: Record<string, { types?: string; require?: string; default?: string }>;
    };
    for (const sub of SUBPATHS) {
      const entry = pkg.exports[sub];
      expect(entry, `exports 缺 ${sub}`).toBeTruthy();
      expect(entry.types, `${sub}.types`).toBeTruthy();
      expect(entry.require, `${sub}.require`).toBeTruthy();
      expect(entry.default, `${sub}.default`).toBeTruthy();
    }
  });

  it('./train 覆盖 daemon cloud-train/cloud-exec/cloud-events/cloud-train.test 所需运行时符号', async () => {
    const t = (await import('../train')) as Record<string, unknown>;
    for (const fn of [
      'channelAsExecutor',
      'createTrainScheduler',
      'emitTrainAudit',
      'checkTrainAuditChain',
      'buildCloudSpawnCommand',
      'buildCloudUploadCommand',
      'buildCloudCleanupCommand',
      'buildCloudStopCommand',
    ]) {
      expect(typeof t[fn], `./train 缺运行时符号 ${fn}`).toBe('function');
    }
  });

  it('./train 覆盖 daemon 消费者所需类型符号（train 域）', () => {
    const src = read('train/index.ts');
    for (const ty of [
      'TrainChannel',
      'ChannelJobSpec',
      'ChannelSubmitResult',
      'ChannelStatusResult',
      'ChannelStatus',
      'ChannelArtifact',
      'TrainEvent',
      'SignalAction',
      'TrainExecutor',
      'TrainExecutorHooks',
      'SpawnFn',
      'TrainAuditEventType',
      'EmitTrainAuditInput',
      'CloudCommand',
    ]) {
      expect(src.includes(ty), `./train 缺类型导出 ${ty}`).toBe(true);
    }
  });

  it('./loop 提供 FORGE 执行面核心导出（P0 消费面）', async () => {
    const l = (await import('../loop')) as Record<string, unknown>;
    for (const fn of [
      'runLoopGraph',
      'resumeLoopGraph',
      'buildLoopGraph',
      'defaultDeps',
      'makeEngineerNode',
      'makeAuditNode',
      'makeReviewerNode',
      'makeHumanConfirmNode',
    ]) {
      expect(typeof l[fn], `./loop 缺导出 ${fn}`).toBe('function');
    }
  });

  it('./model-registry 提供 loadRegistry（dream-cycle/real-provider 消费）', async () => {
    const m = (await import('../model-registry')) as Record<string, unknown>;
    expect(typeof m.loadRegistry).toBe('function');
  });

  it('./team-state 提供 TeamSyncChannel（federation/team-channel 消费）', () => {
    expect(read('team/team-state.ts').includes('TeamSyncChannel')).toBe(true);
  });
});
