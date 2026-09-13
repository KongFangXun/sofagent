// ============================================================
// exit-surface.test.ts · orchestrator 窄出口消费面契约
// ============================================================
// 目的：锁定「跨包消费者所需符号可从窄入口取到」——防止 package.json
//   exports 子路径被摘掉、或 barrel 漏导出时静默回退到根 barrel。
//
// 🔴 v1.4.8 第 7 批（train 拆包）变更：
//   `./train` 子路径**已移除**——train 源码整体迁至独立包 @sofagent/train
//   （engine/train/）。原经 `./train` 消费的 daemon/mcp 全部改走
//   `@sofagent/train`。本文件相应把 train 契约测试的**落点**从本包
//   子路径改为新包根 barrel（契约本身不弱化：仍逐符号断言）。
//   同时新增 4 个「拆包时派生」的窄入口（train 包经它们取 orchestrator 内部
//   契约），一并纳入锁定，防被摘掉。
//
// 覆盖子路径与消费者对应：
//   ./loop                     → 暂无消费者（先挂既有 FORGE barrel，如实保留）
//   ./model-registry           → daemon dream-cycle/real-provider
//   ./fde-compose              → mcp tools/fde-compose；train train-analyze
//                                （v1.4.8 第 7 批新增 fdeWorkbenchPaths）
//   ./fde-quantify-core 🆕      → train train-report；mcp tools/train-report
//                                （computeQuantification 拆包时下沉至此）
//   ./benchmark-eval 🆕         → train train-eval-loop
//   ./weights-manifest 🆕       → train artifact-register / train-deliverable
//   ./sandbox-network-gateway 🆕→ train env-manager / train-sandbox
//   ./team-state               → daemon federation/team-channel
//   ./workflow                 → mcp tools/route-workflow + tools/workflow-crud
//   ./worklog                  → mcp tools/worklog-query
//   ./benchmark                → mcp __tests__/evaluate.test
//   根 barrel 例外：computeQuantification / QuantificationMetrics / QuantifyInput
//     三符号保持 @public（源改指 ./fde/quantify-core），仓外 adopter 不受影响。
// ============================================================
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(SRC, p), 'utf-8');
/** engine/train/src（train 已独立成包——跨包读源用） */
const TRAIN_SRC = join(__dirname, '..', '..', '..', 'train', 'src');
const readTrain = (p: string): string => readFileSync(join(TRAIN_SRC, p), 'utf-8');

const SUBPATHS = [
  './loop',
  './model-registry',
  './team-state',
  './workflow',
  './fde-compose',
  './worklog',
  './benchmark',
  // v1.4.8 第 7 批（train 拆包）派生窄入口
  './fde-quantify-core',
  './benchmark-eval',
  './weights-manifest',
  './sandbox-network-gateway',
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

  it('@sofagent/train 覆盖 daemon cloud-train/cloud-exec/cloud-events/cloud-train.test + mcp train-* 所需运行时符号', async () => {
    // v1.4.8 第 7 批：train 已独立成包——契约落点由 ./train 迁至 @sofagent/train
    const t = (await import('@sofagent/train')) as Record<string, unknown>;
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
      // mcp 侧经根 barrel 消费的 train 符号（拆包后全部改走本包）
      'generateTrainReport',
      'createTrainJob',
      'trainJobDir',
      'listJobsGuarded',
      'getTrainJobRecord',
      'getTrainProgress',
      'diagnoseTrainFailure',
      'saveTrainDiagnoseReport',
      'generateTrainDeliverable',
      'verifyTrainDeliverable',
      'trainDoctor',
      'checkAnticheatBaseline',
      'runDryrun',
      'markProvenance',
      'scanDatasetCompliance',
      'stampComplianceOnVersion',
      'findTrainJob',
      'upsertTrainJob',
      'createTrainServeManager',
      'validateDataPush',
      'gateDataPush',
      // daemon 侧
      'runContinuousTraining',
      'archiveExpired',
      'checkDiskPressure',
      'purgeExpiredArchives',
      // 拆包时下沉 FDE 侧、本包仍 re-export（保持旧面）
      'computeQuantification',
    ]) {
      expect(typeof t[fn], `@sofagent/train 缺运行时符号 ${fn}`).toBe('function');
    }
  });

  it('@sofagent/train 覆盖 daemon/mcp 消费者所需类型符号（train 域）', () => {
    const src = readTrain('index.ts');
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
      // 拆包时下沉 FDE 侧、本包仍 re-export（保持旧面）
      'QuantificationMetrics',
      'QuantifyInput',
    ]) {
      expect(src.includes(ty), `@sofagent/train 缺类型导出 ${ty}`).toBe(true);
    }
  });

  it('@sofagent/train 是独立 workspace 包（name/main/types 齐备）', () => {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '..', '..', '..', 'train', 'package.json'), 'utf-8'),
    ) as { name: string; version: string; main: string; types: string; exports: Record<string, unknown> };
    expect(pkg.name).toBe('@sofagent/train');
    // v1.4.8：不硬编码版本（bump 会红）——与 workspace SSOT（根 package.json）动态比对。
    // 本测试的意图是「train 作为独立包与主线版本一致」，而非锚定某个具体版本号。
    const rootPkg = JSON.parse(
      readFileSync(join(__dirname, '..', '..', '..', '..', 'package.json'), 'utf-8'),
    ) as { version: string };
    expect(pkg.version).toBe(rootPkg.version);
    expect(pkg.main).toBeTruthy();
    expect(pkg.types).toBeTruthy();
    expect(pkg.exports['.'], '@sofagent/train 缺 "." 出口').toBeTruthy();
    // 通配子路径：cli.ts 经 `${TRAIN_PKG}/<module>` 惰性加载 train 各模块
    expect(pkg.exports['./*'], '@sofagent/train 缺 "./*" 通配出口').toBeTruthy();
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

  it('./fde-compose 覆盖 mcp fde-compose + train train-analyze 所需符号', async () => {
    const f = (await import('../fde-compose')) as Record<string, unknown>;
    // v1.4.8 第 7 批：fdeWorkbenchPaths 新增（train train-analyze 拆包后经此消费）
    for (const fn of ['classifyAutomation', 'generateWorkflowDraft', 'validateDraftDag', 'fdeWorkbenchPaths']) {
      expect(typeof f[fn], `./fde-compose 缺运行时符号 ${fn}`).toBe('function');
    }
    const src = read('fde-compose/index.ts');
    for (const ty of ['ComposeSession', 'NodeInterview']) {
      expect(src.includes(ty), `./fde-compose 缺类型导出 ${ty}`).toBe(true);
    }
  });

  it('./fde-quantify-core 提供 computeQuantification + 两类型（train train-report / mcp train-report 消费）', async () => {
    // v1.4.8 第 7 批：从 train/train-report.ts 搬出，解 train ⇄ fde 依赖环
    const q = (await import('../fde/quantify-core')) as Record<string, unknown>;
    expect(typeof q.computeQuantification, './fde-quantify-core 缺 computeQuantification').toBe('function');
    const r = q.computeQuantification as (i: {
      annualSalary: number;
      takeoverRatio: number;
      aiAnnualCost: number;
      oneTimeInvestment?: number;
    }) => { annualSaving: { value: number }; paybackPeriod: { display: string } };
    // GUIDE §4.3 公式锁：年节省 = 年薪 × 接管占比
    const m = r({ annualSalary: 60_000, takeoverRatio: 0.33, aiAnnualCost: 3_000, oneTimeInvestment: 10_000 });
    expect(m.annualSaving.value).toBeCloseTo(19_800, 5);
    expect(m.paybackPeriod.display).toContain('个月');
    const src = read('fde/quantify-core.ts');
    for (const ty of ['QuantificationMetrics', 'QuantifyInput']) {
      expect(src.includes(ty), `./fde-quantify-core 缺类型导出 ${ty}`).toBe(true);
    }
  });

  it('./benchmark-eval 覆盖 train train-eval-loop 所需符号（case-evaluator + evaluation-log）', async () => {
    // v1.4.8 第 7 批派生：既有 ./benchmark 只指 benchmark-designer 单文件，不可改其指向
    const b = (await import('../benchmark-eval')) as Record<string, unknown>;
    for (const fn of ['evaluateCase', 'appendEvaluationRecord', 'readEvaluationLog', 'getEvaluationLogPath']) {
      expect(typeof b[fn], `./benchmark-eval 缺运行时符号 ${fn}`).toBe('function');
    }
    const src = read('benchmark-eval.ts');
    for (const ty of ['EvaluateCaseInput', 'CaseEvaluation', 'EvaluationLogInput', 'EvaluationLogRecord']) {
      expect(src.includes(ty), `./benchmark-eval 缺类型导出 ${ty}`).toBe(true);
    }
  });

  it('./weights-manifest 覆盖 train artifact-register / train-deliverable 所需符号', async () => {
    const w = (await import('../weights-manifest')) as Record<string, unknown>;
    for (const fn of ['manifestPath', 'checkWeightsDir', 'hashDir', 'appendVersion']) {
      expect(typeof w[fn], `./weights-manifest 缺运行时符号 ${fn}`).toBe('function');
    }
    expect(read('weights-manifest.ts').includes('WeightsManifest'), './weights-manifest 缺类型导出 WeightsManifest').toBe(true);
  });

  it('./sandbox-network-gateway 覆盖 train env-manager / train-sandbox 所需符号', async () => {
    const n = (await import('../sandbox/network-gateway')) as Record<string, unknown>;
    expect(typeof n.createNetworkGateway, './sandbox-network-gateway 缺 createNetworkGateway').toBe('function');
    expect(read('sandbox/network-gateway.ts').includes('NetworkGateway'), './sandbox-network-gateway 缺类型导出 NetworkGateway').toBe(true);
  });

  it('根 barrel 保留 quantify 三符号（拆包后改指 ./fde/quantify-core，仓外 adopter 不受影响）', async () => {
    const root = (await import('../index')) as Record<string, unknown>;
    expect(typeof root.computeQuantification, '根 barrel 缺 computeQuantification').toBe('function');
    const src = read('index.ts');
    expect(src.includes('} from \'./fde/quantify-core\''), '根 barrel 的 quantify 未改指 fde/quantify-core').toBe(true);
    // 反向锁：根 barrel 不得再引用已迁走的 ./train/*（先剥注释——拆包说明本身
    // 会提到 './train/' 字样，直接正则会误判）
    const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(codeOnly.includes("'./train/"), '根 barrel 仍残留 ./train/ 重导出').toBe(false);
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
