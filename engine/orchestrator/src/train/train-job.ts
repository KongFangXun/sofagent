// train-job.ts · v1.4.2 块二 · train job 数据模型 + 状态机 + 幂等
//
// 定位：训练任务编排层的地基——「训练任务也是一种长任务」（与 dag-runner 管
// Agent 同构）。本文件只管数据模型与生命周期规则，进程编排（spawn/信号/事件
// 回流）在 train-scheduler.ts。
//
// 协议纪律（v1.3.6 SSOT）：job.json 字段以 train-protocol.ts 的 TrainJobSchema
// 为准，本文件只消费不重复定义。enterpriseId 是编排层字段（v1.4.2 块四企业
// 隔离依赖），只进 state.json，不进协议 job.json——协议即版本边界，不越界。
//
// 目录分区规范：data/train/<enterpriseId>/<jobId>/（目录中的 trainJobId 即
// jobId——同一标识，审计/隔离/幂等三用）：
//   - job.json     协议 job 快照（spawn 时传给 Python 的 --config 文件）
//   - state.json   编排层状态（状态机 + enterpriseId + 断点 + 用量）
//   - events.jsonl stdout 事件流 append-only 落盘（进度曲线查询源）
//
// 生命周期状态机：
//   queued → running → checkpointing → completed / failed / cancelled
//   （checkpointing ↔ running 可往返——SIGINT 存档暂停后可续跑恢复；
//     completed / failed / cancelled 为终态，无出边——续跑走新 job 血缘链）
//   v1.4.1 块七：interrupted（引擎崩溃恢复专用——state=running 但子进程
//   已死时由 crash-recovery 打标；可恢复中断，区别于 failed 终态）

import { existsSync, mkdirSync, readFileSync, readdirSync } from 'fs';
import { randomBytes } from 'crypto';
import { join } from 'path';
import { atomicWriteSync, atomicAppendSync } from '@sofagent/core';
import {
  validateTrainJob,
  parseTrainEventStream,
  type TrainJob,
  type TrainBudget,
  type TrainEvent,
  type TrainEventParseResult,
} from './train-protocol';
import { checkBudget, type TrainUsage } from './train-budget';
import {
  isSafePathSegment,
  type GuardedRead,
  type EnterpriseAccessError,
} from './isolation-guard';

// ════════════════════════════════════════
// 状态机定义
// ════════════════════════════════════════

/** train job 生命周期状态（queued → running → checkpointing → 终态 / interrupted） */
export const TRAIN_JOB_STATUSES = [
  'queued',
  'running',
  'checkpointing',
  'completed',
  'failed',
  'cancelled',
  // v1.4.1 块七：崩溃恢复中断态（非终态——可走三选项恢复：续跑/标败/人审）
  'interrupted',
] as const;

export type TrainJobStatus = (typeof TRAIN_JOB_STATUSES)[number];

/**
 * 合法状态迁移表（出边白名单——不在表内的迁移一律拒绝并抛错）。
 * 终态（completed/failed/cancelled）无出边：续跑通过 resumeTrainJob 创建
 * 新 job（resumedFromJobId 血缘）实现，不改写历史任务状态——审计可追溯。
 */
export const TRAIN_JOB_TRANSITIONS: Readonly<Record<TrainJobStatus, readonly TrainJobStatus[]>> = {
  queued: ['running', 'cancelled'],
  running: ['checkpointing', 'completed', 'failed', 'cancelled', 'interrupted'],
  checkpointing: ['running', 'completed', 'failed', 'cancelled', 'interrupted'],
  completed: [],
  failed: [],
  cancelled: [],
  // interrupted（块七）：崩溃恢复中断——可标败终止或人审挂起；续跑走新 job
  // 血缘链（resumeTrainJob），不直接回 running
  interrupted: ['failed', 'cancelled'],
};

/** 判定状态迁移是否合法 */
export function canTransition(from: TrainJobStatus, to: TrainJobStatus): boolean {
  const edges = TRAIN_JOB_TRANSITIONS[from];
  return Array.isArray(edges) && edges.includes(to);
}

/** 判定是否终态（completed/failed/cancelled——无出边） */
export function isTerminalStatus(status: TrainJobStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

// ════════════════════════════════════════
// 数据模型
// ════════════════════════════════════════

/** 断点记录（SIGINT 存档 / checkpoint 事件——续跑起点） */
export interface TrainJobCheckpoint {
  /** checkpoint 目录/文件路径 */
  checkpointPath: string;
  /** 断点步数 */
  step: number;
}

/** train job 编排层记录（持久化到 state.json） */
export interface TrainJobRecord {
  /** 训练任务标识（= 协议 job.json 的 jobId，目录名同源） */
  jobId: string;
  /** 企业标识（v1.4.1 块四隔离依赖——必填，只进编排层不进协议） */
  enterpriseId: string;
  /** 生命周期状态 */
  status: TrainJobStatus;
  /** 协议 job 快照（v1.3.6 SSOT——spawn 时落盘为 job.json 传给 Python） */
  job: TrainJob;
  createdAt: string;
  updatedAt: string;
  /** Python 子进程 pid（running/checkpointing 时存在） */
  pid?: number;
  /** 开始运行时间戳（ms——预算耗时维度累计用） */
  startedAtMs?: number;
  finishedAt?: string;
  /** 最近断点（续跑起点——checkpoint 事件 / SIGINT 存档回填） */
  lastCheckpoint?: TrainJobCheckpoint;
  /** 续跑血缘（本 job 由哪个 job 续跑而来——新 job 链） */
  resumedFromJobId?: string;
  /** 失败/取消原因 */
  reason?: string;
  /** 用量快照（从事件流累计——预算检查输入） */
  usage: TrainUsage;
}

/** 创建 train job 输入（字段对齐 TrainJobSchema + 编排层扩展） */
export interface CreateTrainJobInput {
  /** 数据目录（job 落在 dataDir/train/<enterpriseId>/<jobId>/） */
  dataDir: string;
  /** 企业标识（🔴 必填——缺失拒绝创建，块四企业隔离依赖） */
  enterpriseId: string;
  /** 训练任务标识（缺省自动生成；同 jobId 重复提交幂等返回既有任务） */
  jobId?: string;
  /** 数据路径（训练集） */
  dataPath: string;
  /** 基座模型 */
  baseModel: string;
  /** 训练算法 */
  algorithm: 'sft' | 'dpo' | 'grpo';
  /** 超参（透传训练框架，缺省 {}） */
  hyperparams?: Record<string, unknown>;
  /** 预算（可选——超限 SIGINT 暂停等人审） */
  budget?: TrainBudget;
  /** checkpoint 根路径（缺省 job 目录下 checkpoints/） */
  checkpointPath?: string;
  /** 产物目录（缺省 job 目录下 output/） */
  outputDir?: string;
  /** 续跑断点（协议③——从 checkpoint 恢复） */
  resumeFrom?: TrainJobCheckpoint;
  /** 续跑血缘（resumeTrainJob 填充） */
  resumedFromJobId?: string;
  /** 初始用量（续跑继承父任务消耗——预算预检用，缺省全 0） */
  initialUsage?: TrainUsage;
}

/** 创建结果（created=false = 幂等命中既有任务） */
export interface CreateTrainJobResult {
  record: TrainJobRecord;
  created: boolean;
}

// ════════════════════════════════════════
// 目录与路径
// ════════════════════════════════════════

/** job 目录：data/train/<enterpriseId>/<jobId>/（企业分区规范） */
export function trainJobDir(dataDir: string, enterpriseId: string, jobId: string): string {
  return join(dataDir, 'train', enterpriseId, jobId);
}

/** job 目录内文件路径（job.json / state.json / events.jsonl） */
export function trainJobFilePaths(dataDir: string, enterpriseId: string, jobId: string): {
  jobDir: string;
  jobFile: string;
  stateFile: string;
  eventsFile: string;
} {
  const jobDir = trainJobDir(dataDir, enterpriseId, jobId);
  return {
    jobDir,
    jobFile: join(jobDir, 'job.json'),
    stateFile: join(jobDir, 'state.json'),
    eventsFile: join(jobDir, 'events.jsonl'),
  };
}

/** 生成训练任务标识（job-<时间基36>-<随机8hex>——防扫描防碰撞） */
export function generateTrainJobId(): string {
  return `job-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
}

// ════════════════════════════════════════
// 记录读写（原子写——@sofagent/core）
// ════════════════════════════════════════

/** 读取单个 job 记录（不存在/坏数据降级 null——调用方判空） */
export function loadTrainJobRecord(
  dataDir: string,
  enterpriseId: string,
  jobId: string,
): TrainJobRecord | null {
  const { stateFile } = trainJobFilePaths(dataDir, enterpriseId, jobId);
  if (!existsSync(stateFile)) return null;
  try {
    const parsed = JSON.parse(readFileSync(stateFile, 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const rec = parsed as TrainJobRecord;
    if (typeof rec.jobId !== 'string' || typeof rec.enterpriseId !== 'string') return null;
    return rec;
  } catch {
    return null; // 坏数据降级（对齐 loadTrainJobs 模式）
  }
}

/** 持久化 job 记录（原子写 state.json） */
export function saveTrainJobRecord(dataDir: string, record: TrainJobRecord): void {
  const { jobDir, stateFile } = trainJobFilePaths(dataDir, record.enterpriseId, record.jobId);
  if (!existsSync(jobDir)) mkdirSync(jobDir, { recursive: true });
  atomicWriteSync(stateFile, JSON.stringify(record, null, 2));
}

/** 列出企业分区下全部 job 记录（目录扫描——续跑幂等查血缘用） */
export function listTrainJobRecords(dataDir: string, enterpriseId: string): TrainJobRecord[] {
  const enterpriseDir = join(dataDir, 'train', enterpriseId);
  if (!existsSync(enterpriseDir)) return [];
  const records: TrainJobRecord[] = [];
  for (const entry of readdirSync(enterpriseDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const rec = loadTrainJobRecord(dataDir, enterpriseId, entry.name);
    if (rec) records.push(rec);
  }
  return records;
}

// ════════════════════════════════════════
// 创建（enterpriseId 必填 + 协议校验 + 幂等）
// ════════════════════════════════════════

/**
 * 创建 train job（幂等——同一 jobId 已存在时返回既有记录，不新建不覆盖）。
 *
 * 校验顺序（快速失败）：
 *   1. enterpriseId 必填（块四隔离依赖——缺失直接拒绝）
 *   2. 协议校验 validateTrainJob（v1.3.6 SSOT——失败拒绝创建，等价拒绝 spawn）
 *   3. 预算预检 checkBudget（初始用量超限拒绝——续跑继承用量场景）
 */
export function createTrainJob(input: CreateTrainJobInput): CreateTrainJobResult {
  // 1. enterpriseId 必填（v1.4.1 块四企业隔离依赖——现在就加避免返工）
  if (
    typeof input.enterpriseId !== 'string' ||
    input.enterpriseId.trim() === ''
  ) {
    throw new Error('[train-job] enterpriseId 必填（企业隔离分区依赖）——缺失拒绝创建');
  }

  const jobId = input.jobId ?? generateTrainJobId();
  if (typeof jobId !== 'string' || jobId.trim() === '') {
    throw new Error('[train-job] jobId 非法（非空字符串）');
  }

  const paths = trainJobFilePaths(input.dataDir, input.enterpriseId, jobId);

  // 2. 幂等：同 jobId 已存在 → 返回既有 job（不新建不覆盖——重复提交安全）
  const existing = loadTrainJobRecord(input.dataDir, input.enterpriseId, jobId);
  if (existing) {
    return { record: existing, created: false };
  }

  // 3. 组装协议 job（字段对齐 TrainJobSchema——缺省值收敛在编排层）
  const job: TrainJob = {
    schemaVersion: 'v1',
    jobId,
    dataPath: input.dataPath,
    baseModel: input.baseModel,
    algorithm: input.algorithm,
    hyperparams: input.hyperparams ?? {},
    checkpointPath: input.checkpointPath ?? join(paths.jobDir, 'checkpoints'),
    outputDir: input.outputDir ?? join(paths.jobDir, 'output'),
    ...(input.budget ? { budget: input.budget } : {}),
    ...(input.resumeFrom ? { resumeFrom: input.resumeFrom } : {}),
  };

  const validation = validateTrainJob(job);
  if (!validation.valid) {
    throw new Error(
      `[train-job] job 校验失败（拒绝创建）：${(validation.issues ?? []).join('；')}`,
    );
  }

  // 4. 预算预检（checkBudget——初始用量超限即拒绝，续跑继承用量防「生而超限」）
  const usage: TrainUsage = input.initialUsage ?? { elapsedMinutes: 0, steps: 0, cost: 0 };
  const budgetCheck = checkBudget(job.budget, usage);
  if (!budgetCheck.within) {
    const v = budgetCheck.violation;
    throw new Error(
      `[train-job] 预算校验失败（拒绝创建）：${v.dimension} 实际 ${v.actual} / 上限 ${v.limit}`,
    );
  }

  // 5. 落盘（协议快照 + 编排状态分离——协议不越界）
  const now = new Date().toISOString();
  const record: TrainJobRecord = {
    jobId,
    enterpriseId: input.enterpriseId,
    status: 'queued',
    job,
    createdAt: now,
    updatedAt: now,
    usage,
    ...(input.resumedFromJobId ? { resumedFromJobId: input.resumedFromJobId } : {}),
  };
  if (!existsSync(paths.jobDir)) mkdirSync(paths.jobDir, { recursive: true });
  atomicWriteSync(paths.jobFile, JSON.stringify(job, null, 2));
  atomicWriteSync(paths.stateFile, JSON.stringify(record, null, 2));
  return { record, created: true };
}

// ════════════════════════════════════════
// 状态迁移（非法迁移拒绝并抛错）
// ════════════════════════════════════════

/** 迁移时可补充的字段（原因/断点/pid/用量等） */
export type TrainJobTransitionPatch = Partial<
  Pick<TrainJobRecord, 'pid' | 'reason' | 'lastCheckpoint' | 'usage' | 'finishedAt'>
>;

/**
 * 纯函数迁移：校验 + 返回新记录（不落盘——便于调度器组合后一次持久化）。
 * 非法迁移抛错（状态机铁律——白名单之外的迁移一律拒绝）。
 */
export function applyTrainJobTransition(
  record: TrainJobRecord,
  to: TrainJobStatus,
  patch: TrainJobTransitionPatch = {},
): TrainJobRecord {
  if (!canTransition(record.status, to)) {
    throw new Error(
      `[train-job] 非法状态迁移：${record.status} → ${to}（job=${record.jobId}）`,
    );
  }
  const now = new Date().toISOString();
  return {
    ...record,
    status: to,
    updatedAt: now,
    ...(to === 'completed' || to === 'failed' || to === 'cancelled'
      ? { finishedAt: patch.finishedAt ?? now }
      : {}),
    ...patch,
  };
}

/**
 * 加载 → 迁移 → 落盘（一步到位的持久化迁移）。
 * @throws 非法迁移 / 任务不存在
 */
export function transitionTrainJob(
  dataDir: string,
  enterpriseId: string,
  jobId: string,
  to: TrainJobStatus,
  patch: TrainJobTransitionPatch = {},
): TrainJobRecord {
  const record = loadTrainJobRecord(dataDir, enterpriseId, jobId);
  if (!record) {
    throw new Error(`[train-job] 训练任务不存在：${jobId}（enterprise=${enterpriseId}）`);
  }
  const next = applyTrainJobTransition(record, to, patch);
  saveTrainJobRecord(dataDir, next);
  return next;
}

// ════════════════════════════════════════
// 事件回流（events.jsonl append-only）
// ════════════════════════════════════════

/**
 * 追加一条事件到 events.jsonl（append-only——进度曲线查询源）。
 * 事件本体是协议 TrainEvent（v1.3.6 约定②），外层补 ts 时间戳信封；
 * parseTrainEvent 对未知字段宽容，回读时 ts 不干扰协议解析。
 */
export function appendTrainEventLine(
  dataDir: string,
  enterpriseId: string,
  jobId: string,
  event: TrainEvent,
): void {
  const { jobDir, eventsFile } = trainJobFilePaths(dataDir, enterpriseId, jobId);
  if (!existsSync(jobDir)) mkdirSync(jobDir, { recursive: true });
  atomicAppendSync(eventsFile, JSON.stringify({ ts: new Date().toISOString(), ...event }));
}

/**
 * 读取事件流（逐行解析——坏行收集不中断，对齐 parseTrainEventStream 语义）。
 * @returns 解析后的事件列表 + 坏行列表（坏行进 train_protocol_error 审计）
 */
export function readTrainEvents(
  dataDir: string,
  enterpriseId: string,
  jobId: string,
): { events: TrainEvent[]; errors: TrainEventParseResult[] } {
  const { eventsFile } = trainJobFilePaths(dataDir, enterpriseId, jobId);
  if (!existsSync(eventsFile)) return { events: [], errors: [] };
  const raw = readFileSync(eventsFile, 'utf-8');
  const lines = raw.split('\n').filter((l) => l.trim() !== '');
  return parseTrainEventStream(lines);
}

// ══════════════════════════════════════
// 受守卫查询（v1.4.1 块四——跨企业读阻断 / listJobs 不泄露存在性）
// ══════════════════════════════════════

/**
 * 受守卫读取单个 job 记录：请求企业 ≠ 资源归属企业 → 结构化拒绝。
 *
 * 注意：资源不存在时返回 { ok: true, data: null }（与「存在但无权」同形——
 * 隔离层不做存在性区分，存在性本身是敏感信息）。
 */
export function getJobGuarded(
  dataDir: string,
  requestingEnterpriseId: string,
  jobId: string,
): GuardedRead<TrainJobRecord | null> {
  // 段校验（enterpriseId/jobId 含 ../ 等构造直接拒——路径逃逸拦截）
  if (!isSafePathSegment(requestingEnterpriseId)) {
    return unsafeSegmentResult('enterpriseId');
  }
  if (!isSafePathSegment(jobId)) {
    return unsafeSegmentResult('jobId');
  }
  // 分区作用域读取：只会在本企业分区下找该 jobId——找不到即 null
  const record = loadTrainJobRecord(dataDir, requestingEnterpriseId, jobId);
  if (!record) return { ok: true, data: null };
  // 资源归属校验（防御纵深：state.json 的 enterpriseId 与请求方不一致即拒——
  // 防数据被人为移动/串目录后的越权读）
  if (record.enterpriseId !== requestingEnterpriseId) {
    return {
      ok: false,
      error: {
        code: 'ENTERPRISE_MISMATCH',
        message: `跨企业访问拒绝：资源 ${jobId} 归属企业 ${record.enterpriseId}，请求方为 ${requestingEnterpriseId}`,
        resourceRef: jobId,
        requestingEnterpriseId,
        resourceEnterpriseId: record.enterpriseId,
      },
    };
  }
  return { ok: true, data: record };
}

/**
 * 受守卫读取训练事件流（进度曲线）：请求企业 ≠ 资源归属 → 拒绝。
 * 事件内容（loss/reward 曲线）是企业数据——跨企业读取被阻断。
 */
export function readTrainEventsGuarded(
  dataDir: string,
  requestingEnterpriseId: string,
  jobId: string,
): GuardedRead<{ events: TrainEvent[]; errors: TrainEventParseResult[] }> {
  const recordResult = getJobGuarded(dataDir, requestingEnterpriseId, jobId);
  if (!recordResult.ok) {
    return { ok: false, error: recordResult.error };
  }
  // 记录为 null（不存在）→ 返回空事件流（与 getJobGuarded 同形的 null 语义）
  if (recordResult.data === null) {
    return { ok: true, data: { events: [], errors: [] } };
  }
  return {
    ok: true,
    data: readTrainEvents(dataDir, requestingEnterpriseId, jobId),
  };
}

/**
 * 受守卫列 job：按请求企业过滤（只扫本企业分区——其他企业的 jobId
 * 连存在性都不泄露）。段校验拒绝非法 enterpriseId。
 */
export function listJobsGuarded(
  dataDir: string,
  requestingEnterpriseId: string,
): GuardedRead<TrainJobRecord[]> {
  if (!isSafePathSegment(requestingEnterpriseId)) {
    return unsafeSegmentResult('enterpriseId');
  }
  // 分区作用域扫描：listTrainJobRecords 只读 data/train/<enterpriseId>/ 下
  // 的目录——其他企业的 job 不在扫描范围（零泄露，非「扫全部再过滤」）
  return { ok: true, data: listTrainJobRecords(dataDir, requestingEnterpriseId) };
}

/** 构造段非法的结构化拒绝 */
function unsafeSegmentResult(label: string): { ok: false; error: EnterpriseAccessError } {
  return {
    ok: false,
    error: {
      code: 'UNSAFE_PATH_SEGMENT',
      message: `路径段非法：${label} 含逃逸构造（../、分隔符或空字节），已拒绝`,
      resourceRef: `${label}`,
      requestingEnterpriseId: '',
    },
  };
}
