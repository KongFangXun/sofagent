// train-scheduler.ts · v1.4.1 块二 · 训练任务编排（提交 / 监控 / 取消 / 续跑）
//
// 定位：Node 控制面 + Python 执行面的「控制面」。完整实现 v1.3.6 训练协议
// 三约定——协议字段/事件解析/信号控制全部消费 train-protocol.ts SSOT，不重复定义：
//   ① 启动：spawn(`python train.py --config <job.json>`)——单 JSON 文件传 job
//      （buildTrainSpawnArgs），Node 不传散参数
//   ② 回报：stdout 只解析 JSON 事件流（parseTrainEvent 逐行），实时 append-only
//      回流 events.jsonl（进度曲线查询源）
//   ③ 控制：SIGINT → Python 存 checkpoint 优雅退出（SignalController.gracefulStop）
//
// 续跑：复用 v1.3.1 Durable Execution checkpoint 语义（断点 = {checkpointPath,
// step}），衔接而非重造——断点持久化在 job state.json（lastCheckpoint），续跑
// 创建新 job 血缘链（resumedFromJobId）并透传协议 resumeFrom，不改写历史任务
// （审计可追溯）。用量继承父任务（预算口径连续）。
//
// 心跳钩子：块七 process-guard 实装，本块只留可注入点
// registerHeartbeat?(pid, jobId)——不实现不依赖。
//
// 测试纪律：spawn/信号/心跳全部可注入（零真实进程——对齐 SignalController 模式）。

import { spawn, type ChildProcess } from 'child_process';
import { existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { atomicWriteSync } from '@sofagent/core';
import {
  buildTrainSpawnArgs,
  parseTrainEvent,
  createSignalController,
  validateTrainJob,
  type TrainBudget,
  type TrainEvent,
  type SignalAction,
  type SignalController,
  type SignalControllerOptions,
} from './train-protocol';
import {
  createTrainBudgetMonitor,
  checkBudget,
  type TrainBudgetMonitor,
  type TrainUsage,
  type BudgetCheckResult,
} from './train-budget';
import {
  createTrainJob,
  loadTrainJobRecord,
  saveTrainJobRecord,
  applyTrainJobTransition,
  transitionTrainJob,
  appendTrainEventLine,
  readTrainEvents,
  trainJobFilePaths,
  generateTrainJobId,
  isTerminalStatus,
  type TrainJobRecord,
  type TrainJobStatus,
  type TrainJobCheckpoint,
  type CreateTrainJobResult,
} from './train-job';
import {
  emitTrainAudit,
  computeDataSourceHash,
  failTrainJobWithRollback,
  STATUS_TO_EVENT,
  type TrainAuditEntry,
  type TrainAuditEventType,
} from './train-audit';
import {
  freezeTrainFingerprint,
  assertDatasetVersionLocked,
  computeDatasetHash,
  resolveDatasetVersion,
  loadTrainFingerprint,
  type EnvSnapshot,
} from './train-fingerprint';
// 块七挂线：进程守卫（心跳/崩溃恢复）——scheduler 启动即接管异常面。
// 无环依赖：process-guard → {train-job, train-audit}，crash-recovery → train-job，
// 均不回引本文件。
import { createProcessGuard, type ProcessGuard } from './process-guard';
import { runCrashRecoveryScan } from './crash-recovery';

// ════════════════════════════════════════
// 注入点（测试零真实进程 · 心跳可插拔）
// ════════════════════════════════════════

/**
 * 心跳注册钩子（块七 process-guard 实装——本块只留接口）。
 * spawn 后立即回调；测试注入观察器验证接线，不依赖真实实现。
 */
export type RegisterHeartbeat = (pid: number, jobId: string) => void;

/** 可注入的 spawn 函数（测试用假子进程替换——零真实进程） */
export type SpawnFn = (
  command: string,
  args: string[],
  options: { cwd?: string; stdio?: ('ignore' | 'pipe')[] },
) => ChildProcess;

/** 调度器选项（全注入点集中——signal/spawn/heartbeat/时间均可替换） */
export interface TrainSchedulerOptions {
  /** 数据目录（job 状态持久化根） */
  dataDir: string;
  /** 企业标识（调度器绑定企业分区——隔离从构造时收敛） */
  enterpriseId: string;
  /** Python 解释器（缺省 python） */
  pythonBin?: string;
  /** 训练脚本（缺省 train.py——buildTrainSpawnArgs 第二参） */
  trainScript?: string;
  /** spawn 工作目录（缺省 cwd） */
  spawnCwd?: string;
  /** spawn 注入（测试——零真实进程） */
  spawnFn?: SpawnFn;
  /** 信号控制器注入（测试——对齐 SignalControllerOptions 模式） */
  signalOptions?: SignalControllerOptions;
  /**
   * 心跳注册钩子（块七已实装——缺省自动创建进程内 process-guard）。
   * 注入自定义钩子时接管心跳注册（guard 仍由本块自建用于刷新/注销）。
   */
  registerHeartbeat?: RegisterHeartbeat;
  /** 进程守卫注入（缺省 createProcessGuard——块七挂线。测试可观察） */
  processGuard?: ProcessGuard;
  /** 卡死判定阈值 ms（透传 process-guard，缺省 120_000） */
  staleThresholdMs?: number;
  /**
   * 引擎启动崩溃扫描（缺省 true——scheduler 创建即扫假活并只记告警，
   * 不做任何自动恢复；runCrashRecoveryScan 自身已把假活标 interrupted
   * + 写 engine-crash-log.jsonl。传 false 跳过（测试/重复创建））。
   */
  crashRecoveryScan?: boolean;
  /** 事件回调（监控/审计外挂——不传则只落盘） */
  onEvent?: (jobId: string, event: TrainEvent) => void;
  /** SIGINT 超时（ms，缺省 30000——透传 SignalController） */
  sigintTimeoutMs?: number;
  /** 时钟注入（测试——默认真实时间） */
  now?: () => number;
  /**
   * 审计写入注入（测试——默认 emitTrainAudit 受控写）。
   * 返回 null = 审计降级不阻断训练（写失败容错语义由调用方决定）。
   */
  auditSink?: (
    input: {
      type: TrainAuditEventType;
      trainJobId: string;
      enterpriseId: string;
      dataSourceHash: string;
      hyperparams: Record<string, unknown>;
      fromStatus?: TrainJobStatus;
      toStatus?: TrainJobStatus;
      reason?: string;
      outputDir?: string;
      checkpointPath?: string;
    },
  ) => TrainAuditEntry | null;
  /**
   * 环境快照供给（块五指纹冻结用——块一 prepareTrainEnv 的报告引用）。
   * 缺省返回 null（环境未探测）→ 指纹冻结降级跳过（不阻断完成）。
   */
  envSnapshotProvider?: () => EnvSnapshot | null;
  /** 随机种子（指纹冻结用——缺省从 hyperparams.seed / hyperparams.random_seed 读） */
  randomSeed?: number;
}

// ════════════════════════════════════════
// 结果类型
// ════════════════════════════════════════

/** 提交输入（协议字段——v1.3.6 SSOT） */
export interface SubmitTrainJobInput {
  dataPath: string;
  baseModel: string;
  algorithm: 'sft' | 'dpo' | 'grpo';
  hyperparams?: Record<string, unknown>;
  /** 预算（可选——超限 SIGINT 暂停等人审） */
  budget?: TrainBudget;
  /** 任务标识（缺省自动生成——同 jobId 重复提交幂等） */
  jobId?: string;
  checkpointPath?: string;
  outputDir?: string;
}

/** 订阅句柄（等待训练终态用） */
export interface TrainRunHandle {
  jobId: string;
  /** 底层子进程（测试探测——生产代码不直接操作） */
  child: ChildProcess;
  /** 训练终态（completed/failed/cancelled/checkpointing 均可能 resolve） */
  done: Promise<TrainJobRecord>;
}

/** 提交结果（created=false = 幂等命中既有 job；handle=null = 未 spawn） */
export interface SubmitTrainJobResult {
  result: CreateTrainJobResult;
  /** null = 幂等命中（在跑复用 / 终态不重启）——未产生新进程 */
  handle: TrainRunHandle | null;
}

/** 监控快照（step/loss/reward 曲线查询 + 预算结论） */
export interface TrainMonitorSnapshot {
  jobId: string;
  enterpriseId: string;
  status: TrainJobStatus;
  usage: TrainUsage;
  /** 预算检查结论（within=false = 已超限——SIGINT 已触发） */
  budget: BudgetCheckResult;
  /** 最近 checkpoint（续跑断点） */
  lastCheckpoint: TrainJobCheckpoint | null;
  /** 已解析事件数 */
  eventCount: number;
  /** 协议解析坏行数（train_protocol_error 审计源） */
  protocolErrors: number;
}

/** 取消结果（幂等——已终态返回 alreadyInTerminalState） */
export interface CancelTrainJobResult {
  jobId: string;
  /** 信号动作留痕（sigint 优雅 / sigkill 兜底 / noop 进程已退） */
  signal: SignalAction;
  status: TrainJobStatus;
  /** 幂等命中：任务已是终态，未重复取消 */
  alreadyInTerminalState: boolean;
}

/** 续跑结果（幂等——同源 job 已有续跑时返回既有新 job） */
export interface ResumeTrainJobResult {
  jobId: string;
  /** 续跑新建（或复用）的 job id（血缘链节点） */
  newJobId: string;
  /** 幂等命中：复用既有续跑 job（不重复消费断点） */
  reused: boolean;
  resumeFrom: TrainJobCheckpoint;
}

/** 续跑返回（handle=null = 复用已完成续跑，未产生新进程） */
export interface ResumeTrainJobOutcome {
  resume: ResumeTrainJobResult;
  handle: TrainRunHandle | null;
}

// ════════════════════════════════════════
// 调度器
// ════════════════════════════════════════

/** 进程内运行注册表条目 */
interface RunEntry {
  child: ChildProcess;
  monitor: TrainBudgetMonitor;
  done: Promise<TrainJobRecord>;
}

/**
 * 创建训练任务调度器（每实例绑定一个 dataDir + enterpriseId——企业分区隔离
 * 从构造时就收敛，杜绝跨企业误操作）。
 */
export function createTrainScheduler(opts: TrainSchedulerOptions) {
  const {
    dataDir,
    enterpriseId,
    pythonBin = 'python',
    trainScript = 'train.py',
    spawnCwd,
    signalOptions,
    onEvent,
    sigintTimeoutMs = 30_000,
    now = Date.now,
  } = opts;
  const spawnFn: SpawnFn = opts.spawnFn ?? ((cmd, args, options) => spawn(cmd, args, options));

  // ── 块七挂线①：进程守卫（心跳 + 崩溃扫描）──
  const guard: ProcessGuard = opts.processGuard ?? createProcessGuard({ staleThresholdMs: opts.staleThresholdMs });
  const registerHeartbeat = opts.registerHeartbeat ?? guard.registerHeartbeat;

  // 引擎启动崩溃扫描（假活显性化：state=running 但 pid 已死 → interrupted）。
  // 只记录告警不自动操作——三选项恢复决策必须由调用方/人审选择（块七铁律）。
  if (opts.crashRecoveryScan !== false) {
    try {
      const scan = runCrashRecoveryScan(dataDir);
      if (scan.findings.length > 0) {
        console.warn(
          `[train-scheduler] 崩溃恢复扫描：发现 ${scan.findings.length} 个假活任务（已标 interrupted，等待人审——` +
            `恢复三选项 resume-checkpoint / mark-failed / human-review 见 crash-recovery）：` +
            scan.findings.map((f) => `${f.enterpriseId}/${f.jobId}(pid=${f.pid}, checkpoint=${f.hasCheckpoint})`).join(', '),
        );
      }
    } catch (err) {
      // 扫描失败不阻断调度器创建（告警面——生产可用性优先）
      console.warn(
        `[train-scheduler] 崩溃恢复扫描失败（不阻断调度）：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 运行期注册表（进程内视角——重启恢复走块九 crash-recovery，不在本块）
  const runs = new Map<string, RunEntry>();

  // 数据源指纹缓存（jobId → sha256——提交时算一次，后续事件复用不重算大文件）
  const dataSourceHashes = new Map<string, string>();

  // ── 内部：审计写入（每次状态迁移记一条——降级不阻断训练主链路） ──
  const audit = (
    record: TrainJobRecord,
    fields: {
      type?: TrainAuditEventType;
      fromStatus?: TrainJobStatus;
      toStatus?: TrainJobStatus;
      reason?: string;
    } = {},
  ): void => {
    const sink = opts.auditSink ?? defaultAuditSink;
    try {
      sink({
        type:
          fields.type ??
          (fields.toStatus !== undefined ? STATUS_TO_EVENT[fields.toStatus] : 'train_job_started'),
        trainJobId: record.jobId,
        enterpriseId: record.enterpriseId,
        dataSourceHash: dataSourceHashes.get(record.jobId) ?? 'unknown',
        hyperparams: record.job.hyperparams,
        outputDir: record.job.outputDir,
        checkpointPath: record.job.checkpointPath,
        ...(fields.fromStatus !== undefined ? { fromStatus: fields.fromStatus } : {}),
        ...(fields.toStatus !== undefined ? { toStatus: fields.toStatus } : {}),
        ...(fields.reason !== undefined ? { reason: fields.reason } : {}),
      });
    } catch {
      // 审计失败不阻断训练（可观测性降级——链校验 doctor 会暴露缺失段）
    }
  };

  // 默认审计写入：emitTrainAudit 受控写（HMAC 链）
  const defaultAuditSink: NonNullable<TrainSchedulerOptions['auditSink']> = (input) => {
    try {
      return emitTrainAudit(
        {
          type: input.type,
          trainJobId: input.trainJobId,
          enterpriseId: input.enterpriseId,
          dataSourceHash: input.dataSourceHash,
          hyperparams: input.hyperparams,
          ...(input.outputDir !== undefined ? { outputDir: input.outputDir } : {}),
          ...(input.checkpointPath !== undefined ? { checkpointPath: input.checkpointPath } : {}),
          ...(input.fromStatus !== undefined ? { fromStatus: input.fromStatus } : {}),
          ...(input.toStatus !== undefined ? { toStatus: input.toStatus } : {}),
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
        },
        dataDir,
      );
    } catch {
      return null; // 降级（写失败容错——训练不因审计故障中断）
    }
  };

  // ── 内部：完成时冻结指纹（块五——降级不阻断完成事实）──
  const freezeFingerprintQuietly = (record: TrainJobRecord): void => {
    try {
      const envSnapshot = opts.envSnapshotProvider?.() ?? null;
      if (!envSnapshot) return; // 环境未探测（无 train-env 报告）→ 跳过冻结
      const seed =
        opts.randomSeed ??
        (typeof record.job.hyperparams.seed === 'number'
          ? record.job.hyperparams.seed
          : typeof record.job.hyperparams.random_seed === 'number'
            ? record.job.hyperparams.random_seed
            : null);
      if (seed === null) return; // 无种子不可复现 → 跳过冻结（口径不完整宁缺毋滥）
      freezeTrainFingerprint({
        dataDir,
        enterpriseId: record.enterpriseId,
        trainJobId: record.jobId,
        datasetDir: record.job.dataPath,
        envSnapshot,
        hyperparams: record.job.hyperparams,
        randomSeed: seed,
      });
    } catch {
      // 冻结失败不阻断完成（已完成是事实——指纹缺失由 verify unreadable 暴露）
    }
  };

  // ── 内部：加载记录（不存在抛错——操作前置校验） ──
  const mustLoad = (jobId: string): TrainJobRecord => {
    const record = loadTrainJobRecord(dataDir, enterpriseId, jobId);
    if (!record) {
      throw new Error(
        `[train-scheduler] 训练任务不存在：${jobId}（enterprise=${enterpriseId}）`,
      );
    }
    return record;
  };

  // ── 内部：企业分区内 job 扫描（续跑血缘查重） ──
  const listEnterpriseJobs = (): TrainJobRecord[] => {
    const enterpriseRoot = join(dataDir, 'train', enterpriseId);
    if (!existsSync(enterpriseRoot)) return [];
    const out: TrainJobRecord[] = [];
    for (const entry of readdirSync(enterpriseRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const rec = loadTrainJobRecord(dataDir, enterpriseId, entry.name);
      if (rec) out.push(rec);
    }
    return out;
  };

  // ── 内部：优雅停子进程（约定③——SIGINT 超时升级 SIGKILL） ──
  const gracefulStopChild = async (jobId: string): Promise<SignalAction> => {
    const controller: SignalController = createSignalController({
      ...signalOptions,
      sigintTimeoutMs: signalOptions?.sigintTimeoutMs ?? sigintTimeoutMs,
    });
    const run = runs.get(jobId);
    if (!run || run.child.pid === undefined) {
      return { action: 'noop' }; // 无进程（崩溃残留/未 spawn）——状态机直接收尾
    }
    return controller.gracefulStop(run.child.pid);
  };

  // ── 内部：协议事件 → 状态推进 + 事件回流 + 预算检查 ──
  const consumeEvent = (
    record: TrainJobRecord,
    monitor: TrainBudgetMonitor,
    event: TrainEvent,
  ): TrainJobRecord => {
    // 约定②：事件 append-only 回流 events.jsonl（进度曲线查询源）
    appendTrainEventLine(dataDir, enterpriseId, record.jobId, event);
    if (onEvent) onEvent(record.jobId, event);

    // 块七挂线①：事件回流即心跳（子进程活着且还在说话——刷新守卫表防误判卡死）
    const runForBeat = runs.get(record.jobId);
    if (runForBeat && typeof runForBeat.child.pid === 'number') {
      guard.markHeartbeat(runForBeat.child.pid);
    }

    let next: TrainJobRecord = { ...record, updatedAt: new Date().toISOString() };
    switch (event.type) {
      case 'progress': {
        // 预算监控（步数/成本维度累计——elapsedMinutes 由控制面定时器驱动，本块不启）
        const budget = monitor.feedProgress({ step: event.step });
        next = { ...next, usage: monitor.usage() };
        if (!budget.within && next.status === 'running') {
          // 超预算 → SIGINT 暂停（协议③）→ checkpointing 态等人审
          void gracefulStopChild(record.jobId).catch(() => {
            /* close 钩子兜底收尾 */
          });
          next = applyTrainJobTransition(next, 'checkpointing', {
            usage: monitor.usage(),
            reason: `train_budget_exceeded:${budget.violation.dimension}`,
          });
          audit(next, {
            fromStatus: 'running',
            toStatus: 'checkpointing',
            reason: `超预算暂停：${budget.violation.dimension} 实际 ${budget.violation.actual} / 上限 ${budget.violation.limit}`,
          });
        }
        break;
      }
      case 'checkpoint': {
        next = {
          ...next,
          lastCheckpoint: { checkpointPath: event.path, step: event.step },
          usage: monitor.usage(),
        };
        break;
      }
      case 'done': {
        // 终态幂等防御（重复 done 事件不重复迁移）
        if (!isTerminalStatus(next.status)) {
          next = applyTrainJobTransition(next, 'completed', { usage: monitor.usage() });
          audit(next, { fromStatus: record.status, toStatus: 'completed' });
          // 指纹冻结（块五：完成时冻结可复现口径——降级不阻断完成事实）
          freezeFingerprintQuietly(next);
        }
        break;
      }
      case 'failed': {
        if (!isTerminalStatus(next.status)) {
          next = applyTrainJobTransition(next, 'failed', {
            reason: event.reason,
            usage: monitor.usage(),
          });
          // 失败回滚（块三：半成品隔离 + 现场封存 + train_job_rollback 审计）
          runFailureRollback(next, event.reason);
          audit(next, { fromStatus: record.status, toStatus: 'failed', reason: event.reason });
        }
        break;
      }
    }
    saveTrainJobRecord(dataDir, next);
    return next;
  };

  // ── 内部：失败回滚（半成品 → failed-artifacts/ + rollback 审计事件） ──
  const runFailureRollback = (record: TrainJobRecord, reason: string): void => {
    if (opts.auditSink) {
      // 注入审计环境（测试）——直接调 rollback 逻辑而绕过默认 HMAC 写
      rollbackWithSink(record, reason);
      return;
    }
    try {
      failTrainJobWithRollback(
        dataDir,
        {
          trainJobId: record.jobId,
          enterpriseId: record.enterpriseId,
          lastCheckpoint: record.lastCheckpoint ?? null,
          outputDir: record.job.outputDir,
          checkpointPath: record.job.checkpointPath,
          hyperparams: record.job.hyperparams,
          fromStatus: record.status === 'failed' ? 'running' : record.status,
          reason,
        },
        dataSourceHashes.get(record.jobId) ?? 'unknown',
      );
    } catch {
      // 回滚失败不改变失败事实（状态机已落 failed）——审计 doctor 可暴露
    }
  };

  // 注入 sink 的回滚路径（测试用——rollback 事件经注入 sink 留痕）
  const rollbackWithSink = (record: TrainJobRecord, _reason: string): void => {
    const sink = opts.auditSink;
    if (!sink) return;
    try {
      sink({
        type: 'train_job_rollback',
        trainJobId: record.jobId,
        enterpriseId: record.enterpriseId,
        dataSourceHash: dataSourceHashes.get(record.jobId) ?? 'unknown',
        hyperparams: record.job.hyperparams,
        toStatus: 'failed',
        reason: '失败回滚：半成品现场封存 failed-artifacts/（注入审计环境）',
      });
    } catch {
      /* 审计降级不阻断 */
    }
  };

  // ── 内部：spawn + 事件流消费（约定①②③全链路） ──
  const launch = (record: TrainJobRecord): TrainRunHandle => {
    if (isTerminalStatus(record.status)) {
      throw new Error(
        `[train-scheduler] 拒绝启动终态任务：${record.jobId}（status=${record.status}，续跑请用 resumeTrainJob）`,
      );
    }
    const { jobDir, jobFile } = trainJobFilePaths(dataDir, enterpriseId, record.jobId);
    if (!existsSync(jobDir)) mkdirSync(jobDir, { recursive: true });

    // 约定①：job.json 落盘（协议快照——spawn 前重校验，失败拒绝 spawn）
    const validation = validateTrainJob(record.job);
    if (!validation.valid) {
      throw new Error(
        `[train-scheduler] job.json 校验失败拒绝 spawn：${(validation.issues ?? []).join('；')}`,
      );
    }
    atomicWriteSync(jobFile, JSON.stringify(record.job, null, 2));

    // 状态机：→ running（queued/checkpointing 均可进入）
    const running = applyTrainJobTransition(record, 'running');
    const child = spawnFn(pythonBin, buildTrainSpawnArgs(jobFile, trainScript), {
      ...(spawnCwd ? { cwd: spawnCwd } : {}),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const current: TrainJobRecord = {
      ...running,
      pid: child.pid,
      startedAtMs: record.startedAtMs ?? now(),
      updatedAt: new Date().toISOString(),
    };
    saveTrainJobRecord(dataDir, current);
    // 审计：启动（→ running——train_job_started 事件）
    audit(current, { fromStatus: record.status, toStatus: 'running' });

    // 心跳注册钩子（块七 process-guard 实装——本块只接线）
    if (registerHeartbeat && typeof child.pid === 'number') {
      registerHeartbeat(child.pid, record.jobId);
    }

    // 预算监控器（从事件流累计消耗）
    const monitor = createTrainBudgetMonitor({ jobId: record.jobId, budget: record.job.budget });

    let latest = current;

    const done = new Promise<TrainJobRecord>((resolve) => {
      // 约定②：stdout 逐行解析（只认 JSON 行——坏行静默容忍不崩溃）
      let stdoutBuf = '';
      child.stdout?.on('data', (chunk: Buffer | string) => {
        stdoutBuf += chunk.toString();
        const lines = stdoutBuf.split('\n');
        stdoutBuf = lines.pop() ?? '';
        for (const line of lines) {
          if (line.trim() === '') continue;
          const parsed = parseTrainEvent(line);
          if (parsed.event) {
            latest = consumeEvent(latest, monitor, parsed.event);
          }
        }
      });

      // stderr：日志留痕（不解析——协议只认 stdout）
      let stderrTail = '';
      child.stderr?.on('data', (chunk: Buffer | string) => {
        stderrTail = (stderrTail + chunk.toString()).slice(-2000);
      });

      child.on('close', (code) => {
        runs.delete(record.jobId);
        // 块七挂线①：进程退出即注销心跳（防守卫表膨胀 + 防已死 pid 被误回收）
        if (typeof child.pid === 'number') guard.unregisterHeartbeat(child.pid);
        const fresh = loadTrainJobRecord(dataDir, enterpriseId, record.jobId) ?? latest;
        if (isTerminalStatus(fresh.status)) {
          resolve(fresh); // 事件流已收尾（done/failed/取消）——幂等不重复迁移
          return;
        }
        if (code === 0) {
          // 退出码 0 + 未收尾 → 协议③存档暂停（SIGINT 优雅退出的正常落点）
          const paused = applyTrainJobTransition(fresh, 'checkpointing', {
            pid: undefined,
            usage: monitor.usage(),
          });
          saveTrainJobRecord(dataDir, paused);
          // 审计：存档暂停（→ checkpointing——SIGINT 优雅退出正常落点）
          audit(paused, {
            fromStatus: fresh.status,
            toStatus: 'checkpointing',
            reason: 'Python 退出码 0（SIGINT 存档 / 优雅退出）',
          });
          resolve(paused);
          return;
        }
        const failReason = `python 退出码 ${code}${stderrTail ? `：${stderrTail.slice(-500)}` : ''}`;
        const failed = applyTrainJobTransition(fresh, 'failed', {
          pid: undefined,
          reason: failReason,
          usage: monitor.usage(),
        });
        // 失败回滚（半成品隔离 + 现场封存 + rollback 审计）
        runFailureRollback(failed, failReason);
        saveTrainJobRecord(dataDir, failed);
        audit(failed, { fromStatus: fresh.status, toStatus: 'failed', reason: failReason });
        resolve(failed);
      });

      child.on('error', (err) => {
        runs.delete(record.jobId);
        // 块七挂线①：spawn 失败同样注销心跳（注册先于 error——防表残留）
        if (typeof child.pid === 'number') guard.unregisterHeartbeat(child.pid);
        const fresh = loadTrainJobRecord(dataDir, enterpriseId, record.jobId) ?? latest;
        if (isTerminalStatus(fresh.status)) {
          resolve(fresh);
          return;
        }
        const failReason = `spawn 失败：${err.message}`;
        const failedRecord = applyTrainJobTransition(fresh, 'failed', {
          pid: undefined,
          reason: failReason,
        });
        runFailureRollback(failedRecord, failReason);
        saveTrainJobRecord(dataDir, failedRecord);
        audit(failedRecord, { fromStatus: fresh.status, toStatus: 'failed', reason: failReason });
        resolve(failedRecord);
      });
    });

    const handle: TrainRunHandle = { jobId: record.jobId, child, done };
    runs.set(record.jobId, { child, monitor, done });
    return handle;
  };

  // ── ① 提交（幂等：同 jobId 返回既有——不重复 spawn / 终态不重启） ──
  const submitTrainJob = (input: SubmitTrainJobInput): SubmitTrainJobResult => {
    const result = createTrainJob({
      dataDir,
      enterpriseId,
      jobId: input.jobId,
      dataPath: input.dataPath,
      baseModel: input.baseModel,
      algorithm: input.algorithm,
      ...(input.hyperparams !== undefined ? { hyperparams: input.hyperparams } : {}),
      ...(input.budget !== undefined ? { budget: input.budget } : {}),
      ...(input.checkpointPath !== undefined ? { checkpointPath: input.checkpointPath } : {}),
      ...(input.outputDir !== undefined ? { outputDir: input.outputDir } : {}),
    });

    if (result.created) {
      // 数据源指纹（提交时算一次缓存——后续审计事件复用，不重算大文件）
      dataSourceHashes.set(result.record.jobId, computeDataSourceHash(input.dataPath));
      // 审计：提交（→ queued——train_job_submitted 事件，数据源可溯源）
      audit(result.record, { toStatus: 'queued', reason: '训练任务提交' });
    }

    // 幂等命中：既有 job 在跑 → 复用进程句柄（不重复 spawn）
    if (!result.created) {
      const run = runs.get(result.record.jobId);
      if (run) {
        return {
          result,
          handle: { jobId: result.record.jobId, child: run.child, done: run.done },
        };
      }
      // 既有 job 不在跑：崩溃残留（queued/checkpointing）→ 复跑同 jobId（协议幂等）
      if (!isTerminalStatus(result.record.status)) {
        return { result, handle: launch(result.record) };
      }
      // 终态任务重复提交 → 返回既有记录，不重启（审计语义：任务已完成）
      return { result, handle: null };
    }

    return { result, handle: launch(result.record) };
  };

  // ── ② 监控（进度快照——step/loss/reward 曲线查询源） ──
  const monitorTrainJob = (jobId: string): TrainMonitorSnapshot => {
    const record = mustLoad(jobId);
    const { events, errors } = readTrainEvents(dataDir, enterpriseId, jobId);
    const budget = checkBudget(record.job.budget, record.usage);
    return {
      jobId,
      enterpriseId: record.enterpriseId,
      status: record.status,
      usage: record.usage,
      budget,
      lastCheckpoint: record.lastCheckpoint ?? null,
      eventCount: events.length,
      protocolErrors: errors.length,
    };
  };

  // ── ③ 取消（幂等——终态任务重复取消安全返回，不抛错） ──
  const cancelTrainJob = async (jobId: string): Promise<CancelTrainJobResult> => {
    const record = mustLoad(jobId);

    // 幂等：已是终态 → 不重复取消（重复取消是安全操作）
    if (isTerminalStatus(record.status)) {
      return {
        jobId,
        signal: { action: 'noop' },
        status: record.status,
        alreadyInTerminalState: true,
      };
    }

    // 约定③：SIGINT → checkpoint 优雅退出（超时升级 SIGKILL 兜底）
    const signal = await gracefulStopChild(jobId);

    // 状态机收尾（防御 close 钩子竞态——以落盘后的最新状态为准）
    const fresh = loadTrainJobRecord(dataDir, enterpriseId, jobId) ?? record;
    let next: TrainJobRecord;
    if (isTerminalStatus(fresh.status)) {
      next = fresh; // close 钩子已收尾
    } else if (fresh.status === 'running') {
      // 优雅存档路径：running → checkpointing（记录断点语义）→ cancelled
      const paused = transitionTrainJob(dataDir, enterpriseId, jobId, 'checkpointing', {
        pid: undefined,
      });
      next = applyTrainJobTransition(paused, 'cancelled', { pid: undefined, reason: '用户取消' });
      saveTrainJobRecord(dataDir, next);
      // 审计：取消（→ cancelled——优雅存档路径）
      audit(next, { fromStatus: 'running', toStatus: 'cancelled', reason: '用户取消（SIGINT 优雅退出）' });
    } else {
      // queued / checkpointing → cancelled
      next = transitionTrainJob(dataDir, enterpriseId, jobId, 'cancelled', {
        pid: undefined,
        reason: '用户取消',
      });
      // 审计：取消（→ cancelled）
      audit(next, { fromStatus: fresh.status, toStatus: 'cancelled', reason: '用户取消' });
    }
    return { jobId, signal, status: next.status, alreadyInTerminalState: false };
  };

  // ── ④ 续跑（checkpoint 恢复——新 job 血缘链，幂等防重复消费） ──
  const resumeTrainJob = (jobId: string): ResumeTrainJobOutcome => {
    const record = mustLoad(jobId);

    // 断点解析：显式 resumeFrom > lastCheckpoint（checkpoint 事件 / SIGINT 存档）
    const checkpoint: TrainJobCheckpoint | null =
      record.job.resumeFrom ?? record.lastCheckpoint ?? null;
    if (!checkpoint) {
      throw new Error(
        `[train-scheduler] 续跑失败：任务 ${jobId} 无 checkpoint（resumeFrom / lastCheckpoint 均缺）`,
      );
    }

    // ── 块七挂线②：续跑版本锁定校验（checkpoint 冻结版本 vs 现场版本）──
    // 双闸门（指纹把 version 与 hash 绑在一起，续跑校验两者都守）：
    //   ① 版本串漂移（数据集目录切换 v1→v2 / 显式版本变更）→ assertDatasetVersionLocked 拒绝
    //   ② 同目录内容漂移（版本串不变但 datasetHash 变）→ 等价拒绝（版本锁的
    //     字面口径抓目录切换，hash 闸门堵「换内容不换目录」的绕道——指纹
    //     本就把两值绑定，续跑吃的是内容不是目录名）
    // 口径：父 job 冻结过指纹才设闸（无锁定材料不制造假阻断）；不锁定时
    // 拒绝续跑 + 审计告警（train_resume_rejected）——不自动切换数据。
    const parentFingerprint = loadTrainFingerprint(dataDir, enterpriseId, jobId);
    if (parentFingerprint) {
      const currentHash = computeDatasetHash(record.job.dataPath);
      const currentVersion = resolveDatasetVersion(record.job.dataPath, currentHash);
      const lock = assertDatasetVersionLocked(currentVersion, parentFingerprint.datasetVersion);
      const hashLock = assertDatasetVersionLocked(currentHash, parentFingerprint.datasetHash);
      if (!lock.locked || !hashLock.locked) {
        const reason = !lock.locked
          ? lock.reason
          : `数据集内容漂移：checkpoint 锁定 hash ${parentFingerprint.datasetHash.slice(0, 12)}…，当前 ${currentHash.slice(0, 12)}…——版本串未变但内容已变，不自动切换，须人审决定`;
        audit(record, {
          type: 'train_resume_rejected',
          reason: `续跑被拒（数据集版本锁定校验未通过）：${reason}`,
        });
        throw new Error(`[train-scheduler] ${reason}`);
      }
    }

    // 幂等：同源 job 已有续跑 job（血缘查重）→ 返回既有（不重复消费断点）
    const existingResume = listEnterpriseJobs()
      .filter((r) => r.resumedFromJobId === jobId)
      .find((r) => r.status !== 'cancelled' && r.status !== 'failed');
    if (existingResume) {
      const run = runs.get(existingResume.jobId);
      return {
        resume: {
          jobId,
          newJobId: existingResume.jobId,
          reused: true,
          resumeFrom: checkpoint,
        },
        // 在跑复用句柄；已完成/终态 → 不重启（断点已消费）
        handle: run
          ? { jobId: existingResume.jobId, child: run.child, done: run.done }
          : null,
      };
    }

    // 新 job 血缘链（不改写历史任务——审计可追溯）+ 协议 resumeFrom 透传
    const created = createTrainJob({
      dataDir,
      enterpriseId: record.enterpriseId,
      jobId: generateTrainJobId(),
      dataPath: record.job.dataPath,
      baseModel: record.job.baseModel,
      algorithm: record.job.algorithm,
      hyperparams: record.job.hyperparams,
      ...(record.job.budget ? { budget: record.job.budget } : {}),
      checkpointPath: record.job.checkpointPath,
      outputDir: record.job.outputDir,
      resumeFrom: checkpoint,
      resumedFromJobId: jobId,
      initialUsage: record.usage, // 用量继承（预算预检口径连续）
    });
    return {
      resume: {
        jobId,
        newJobId: created.record.jobId,
        reused: false,
        resumeFrom: checkpoint,
      },
      handle: launch(created.record),
    };
  };

  return {
    submitTrainJob,
    monitorTrainJob,
    cancelTrainJob,
    resumeTrainJob,
    /** 进程守卫实例（块七——detectStalled/size 诊断出口；注入优先返回注入值） */
    processGuard: guard,
  };
}

// ════════════════════════════════════════
// 便捷查询（不依赖调度器实例——监控查询零副作用）
// ════════════════════════════════════════

/** 读取 job 记录（编排层状态） */
export function getTrainJobRecord(
  dataDir: string,
  enterpriseId: string,
  jobId: string,
): TrainJobRecord | null {
  return loadTrainJobRecord(dataDir, enterpriseId, jobId);
}

/** 读取进度曲线数据（step/loss/reward 事件流） */
export function getTrainProgress(
  dataDir: string,
  enterpriseId: string,
  jobId: string,
): { events: TrainEvent[]; errors: number } {
  const { events, errors } = readTrainEvents(dataDir, enterpriseId, jobId);
  return { events, errors: errors.length };
}
