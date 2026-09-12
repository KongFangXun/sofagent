// ============================================================
// exit-surface.test.ts · 条目 9 第 0 步：orchestrator 窄出口消费面契约
// ============================================================
// 目的：锁定「12 个消费者（daemon 6 + mcp 6）所需符号可从新 subpath 取到」——
//   防止 package.json exports 子路径被摘掉、或 barrel 漏导出时静默回归到根 barrel。
//   （根 barrel 符号集不动；窄入口是新增的消费面，不是替换面。）
// 覆盖子路径与消费者对应：
//   ./train         → daemon cloud-train/cloud-exec/cloud-events/cloud-train.test
//                     + mcp tools/train-cloud
//   ./loop          → 暂无消费者（先挂既有 FORGE barrel，如实保留）
//   ./model-registry→ daemon dream-cycle/real-provider
//   ./team-state    → daemon federation/team-channel
//   ./workflow      → mcp tools/route-workflow + tools/workflow-crud
//   ./fde-compose   → mcp tools/fde-compose
//   ./worklog       → mcp tools/worklog-query
//   ./benchmark     → mcp __tests__/evaluate.test
// ============================================================
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(SRC, p), 'utf-8');

const SUBPATHS = [
  './train',
  './loop',
  './model-registry',
  './team-state',
  './workflow',
  './fde-compose',
  './worklog',
  './benchmark',
] as const;

describe('条目 9 · orchestrator 窄出口消费面契约', () => {
  it('package.json exports 声明全部窄入口（types/require/default 齐备）', () => {
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

  it('./train 覆盖 daemon cloud-train/cloud-exec/cloud-events/cloud-train.test + mcp train-cloud 所需运行时符号', async () => {
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
      'createCloudRegistry',
    ]) {
      expect(typeof t[fn], `./train 缺运行时符号 ${fn}`).toBe('function');
    }
  });

  it('./train 覆盖 daemon/mcp 消费者所需类型符号（train 域）', () => {
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
      'CloudVmRecord',
    ]) {
      expect(src.includes(ty), `./train 缺类型导出 ${ty}`).toBe(true);
    }
  });

  it('./loop 提供 FORGE 执行面核心导出（P0 消费面；本批暂无消费者）', async () => {
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

  it('./model-registry 提供 loadRegistry（daemon real-provider 消费）', async () => {
    const m = (await import('../model-registry')) as Record<string, unknown>;
    expect(typeof m.loadRegistry).toBe('function');
  });

  it('./team-state 提供 TeamSyncChannel（daemon team-channel 消费）', () => {
    expect(read('team/team-state.ts').includes('TeamSyncChannel')).toBe(true);
  });

  it('./workflow 覆盖 mcp route-workflow + workflow-crud 所需符号', async () => {
    const w = (await import('../workflow')) as Record<string, unknown>;
    for (const fn of [
      'routeRequest',
      'workflowCreate',
      'workflowUpdate',
      'workflowNodeAdd',
      'workflowDiffPreview',
    ]) {
      expect(typeof w[fn], `./workflow 缺运行时符号 ${fn}`).toBe('function');
    }
    const src = read('workflow/index.ts');
    for (const ty of ['ParsedWorkflow', 'RouteResult', 'CrudResult']) {
      expect(src.includes(ty), `./workflow 缺类型导出 ${ty}`).toBe(true);
    }
  });

  it('./fde-compose 覆盖 mcp fde-compose 所需符号', async () => {
    const f = (await import('../fde-compose')) as Record<string, unknown>;
    for (const fn of ['classifyAutomation', 'generateWorkflowDraft', 'validateDraftDag']) {
      expect(typeof f[fn], `./fde-compose 缺运行时符号 ${fn}`).toBe('function');
    }
    const src = read('fde-compose/index.ts');
    for (const ty of ['ComposeSession', 'NodeInterview']) {
      expect(src.includes(ty), `./fde-compose 缺类型导出 ${ty}`).toBe(true);
    }
  });

  it('./worklog 提供 WorklogAggregator（mcp worklog-query 消费）', async () => {
    const w = (await import('../worklog/aggregator')) as Record<string, unknown>;
    expect(typeof w.WorklogAggregator, './worklog 缺 WorklogAggregator').toBe('function');
  });

  it('./benchmark 覆盖 mcp evaluate.test 所需符号', async () => {
    const b = (await import('../benchmark/benchmark-designer')) as Record<string, unknown>;
    for (const fn of ['createBenchmark', 'addCase', 'freezeBenchmark', 'writeBenchmarkLayout', 'benchmarksRoot']) {
      expect(typeof b[fn], `./benchmark 缺运行时符号 ${fn}`).toBe('function');
    }
  });
});
