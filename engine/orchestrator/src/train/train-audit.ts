// train-audit.ts · v1.4.5 块三 · 训练任务审计（train_job 事件 + HMAC 链 + 失败回滚）
//
// 定位：训练本身可审计——「这个模型是怎么训出来的」全程留痕。落盘位置
// data/train/<enterpriseId>/<trainJobId>/audit.jsonl（append-only），
// 与 events.jsonl 分开：events 是训练进度曲线（协议②），audit 是治理留痕。
//
// HMAC 链与 engine/audit/src/decision-log.ts 的 emitDecision 同模式
// （同密钥 ~/.sofagent-key、同签名算法、同环境指纹、同原子追加）：
//   1. prevHash：读末行 → sha256(JSON.stringify(lastRecordForHash) + '|' + fingerprint).slice(0,16)
//   2. 铁律：先脱敏再签名（hyperparams / reason 里的密钥文本先过 REDACTION_PATTERNS）
//   3. recordForSig 排除链字段（prevHash/hashVersion/hmacSig/hmacAlgo）
//   4. hmacSig = createHmac('sha256', key).update(stableStringify(recordForSig) + '|' + fingerprint).digest('hex').slice(0,32)
//   5. atomicAppendSync（@sofagent/core）→ chmodSync 0o600（权限失败告警不阻断）
//
// ⚠️ train_job 事件类型在本文件自持（audit 包无 writer.ts 扩展点，不动 engine/audit
// 任何现有文件）——union 开放扩展，后续块新增：train_abnormal_exit（块七）、
// artifact_tampered（块六）、train_engine_crash_recover（块七）。
//
// enterpriseId 强制：审计事件缺 enterpriseId 拒绝写入（块四隔离的审计规则，
// eng-env 的 isolation-guard 消费此约束）。

import { existsSync, mkdirSync, readFileSync, chmodSync, openSync, readSync, closeSync, statSync, readdirSync, renameSync, rmSync } from 'fs';
import { createHash, createHmac } from 'crypto';
import { getEnvFingerprint, getHmacKey, stableStringify, atomicAppendSync, REDACTION_PATTERNS } from '@sofagent/core';
import type { TrainJobStatus } from './train-job';

// ════════════════════════════════════════
// train_job 事件类型（本文件自持 · 可扩展 union）
// ════════════════════════════════════════

/**
 * 训练审计事件类型。
 * 六个生命周期事件（对应状态机六次迁移）+ 回滚动作事件 + 预留扩展位。
 */
export type TrainAuditEventType =
  // ── 生命周期（每次状态迁移记一条）──
  | 'train_job_submitted' // 创建（→ queued）
  | 'train_job_started' // 启动 Python 子进程（→ running）
  | 'train_job_checkpoint' // 存档暂停（→ checkpointing：SIGINT / 超预算 / 优雅退出）
  | 'train_job_completed' // 完成（→ completed）
  | 'train_job_failed' // 失败（→ failed）
  | 'train_job_cancelled' // 取消（→ cancelled）
  // ── 回滚动作（失败善后——type=train_job_failed 后紧跟一条）──
  | 'train_job_rollback'
  // ── 扩展位（后续块新增，先占 union 槽位防散字符串漂移）──
  | 'train_abnormal_exit' // 块七：进程异常退出（心跳超时 / 孤儿回收）
  | 'artifact_tampered' // 块六：产物完整性校验失败
  | 'train_engine_crash_recover' // 块七：引擎崩溃恢复
  | 'train_resume_rejected' // 块七：续跑被拒（数据集版本锁定校验未通过——转人审）
  // ── v1.4.5 第一章：推理服务生命周期（谁启的/哪个模型/哪个节点在用——
  //    hyperparams 携带 action/backend/model/endpoint/node/actor/pid）──
  | 'train_serve';

/** 生命周期事件 ↔ 终态映射（写入侧推导事件类型用） */
export const STATUS_TO_EVENT: Readonly<Record<TrainJobStatus, TrainAuditEventType>> = {
  queued: 'train_job_submitted',
  running: 'train_job_started',
  checkpointing: 'train_job_checkpoint',
  completed: 'train_job_completed',
  failed: 'train_job_failed',
  cancelled: 'train_job_cancelled',
  // 块七：崩溃恢复检测到 running 但进程消失 → interrupted（异常退出事件）
  interrupted: 'train_abnormal_exit',
};

// ════════════════════════════════════════
// 审计条目 schema（自持——与 decision-log 同构的链字段）
// ════════════════════════════════════════

/** 训练审计条目（audit.jsonl 单行） */
export interface TrainAuditEntry {
  /** 时间戳（ISO） */
  ts: string;
  /** 事件类型 */
  type: TrainAuditEventType;
  /** 训练任务标识 */
  trainJobId: string;
  /** 企业标识（🔴 必填——缺失拒绝写入，块四隔离依赖） */
  enterpriseId: string;
  /** 数据源内容指纹（sha256——可溯源到具体训练集内容） */
  dataSourceHash: string;
  /** 超参快照（已脱敏——冻结可复现性口径） */
  hyperparams: Record<string, unknown>;
  /** 产物目录 */
  outputDir?: string;
  /** checkpoint 根路径 */
  checkpointPath?: string;
  /** 状态迁移起点（submitted 时缺省） */
  fromStatus?: TrainJobStatus;
  /** 状态迁移终点 */
  toStatus?: TrainJobStatus;
  /** 原因/说明（已脱敏） */
  reason?: string;
  /** 回滚信息（train_job_rollback 事件） */
  rollback?: {
    /** 回滚目标 checkpoint（null = 无断点，失败现场封存 failed-artifacts/） */
    rollbackTo: string | null;
    /** 封存的半成品路径列表 */
    quarantined: string[];
  };
  // ── 链字段（与 decision-log 同构）──
  prevHash: string;
  hashVersion: 2;
  envFingerprint: string;
  hmacAlgo?: 'stable';
  hmacSig?: string;
  /** 写入引擎标识 */
  engine: string;
}

/** 审计写入入参（不含链字段——链字段由写入侧生成） */
export interface EmitTrainAuditInput {
  type: TrainAuditEventType;
  trainJobId: string;
  enterpriseId: string;
  dataSourceHash: string;
  hyperparams?: Record<string, unknown>;
  outputDir?: string;
  checkpointPath?: string;
  fromStatus?: TrainJobStatus;
  toStatus?: TrainJobStatus;
  reason?: string;
  rollback?: { rollbackTo: string | null; quarantined: string[] };
}

/** schema 校验失败（类型非法/必填缺失）——不写文件 */
export class TrainAuditSchemaError extends Error {
  constructor(message: string) {
    super(`[train-audit] schema 校验失败: ${message}`);
    this.name = 'TrainAuditSchemaError';
  }
}

/** 写入失败（atomicAppendSync 抛错）——向上传播，绝不静默丢弃 */
export class TrainAuditWriteError extends Error {
  constructor(message: string, cause?: unknown) {
    super(
      `[train-audit] 写入失败: ${message}${cause instanceof Error ? `（${cause.message}）` : ''}`,
    );
    this.name = 'TrainAuditWriteError';
  }
}

/** 合法事件类型集合（运行时校验用） */
const VALID_EVENT_TYPES: readonly string[] = [
  'train_job_submitted',
  'train_job_started',
  'train_job_checkpoint',
  'train_job_completed',
  'train_job_failed',
  'train_job_cancelled',
  'train_job_rollback',
  'train_abnormal_exit',
  'artifact_tampered',
  'train_engine_crash_recover',
  'train_resume_rejected',
  'train_serve',
];

// ════════════════════════════════════════
// 脱敏（铁律：先脱敏再签名）
// ════════════════════════════════════════

/** 单字符串脱敏——逐条应用 REDACTION_PATTERNS（与 sanitizeWhy 同规则） */
function redactString(text: string): string {
  let out = text;
  for (const { pattern, replacement } of REDACTION_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/** 深度脱敏任意值（字符串逐个过 patterns；对象/数组递归） */
export function sanitizeDeep(value: unknown): unknown {
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map(sanitizeDeep);
  if (value && typeof value === 'object' && value.constructor === Object) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      out[key] = sanitizeDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

// ════════════════════════════════════════
// 数据源指纹（sha256 分块读——内存安全）
// ════════════════════════════════════════

/**
 * 计算训练集内容指纹（sha256 分块读文件——GB 级数据集不撑内存）。
 * 文件不存在返回 'unknown'（可审计的确定性占位，dataPath 错误可追查）。
 */
export function computeDataSourceHash(dataPath: string): string {
  let fd: number | null = null;
  try {
    const stat = statSync(dataPath);
    if (!stat.isFile()) return 'unknown';
    fd = openSync(dataPath, 'r');
    const hash = createHash('sha256');
    const chunkSize = 64 * 1024;
    const buffer = Buffer.alloc(chunkSize);
    let position = 0;
    // 分块读循环（readSync 同步但内存恒定——大数据集安全）
    while (position < stat.size) {
      const bytes = readSync(fd, buffer, 0, chunkSize, position);
      if (bytes <= 0) break;
      hash.update(buffer.subarray(0, bytes));
      position += bytes;
    }
    return hash.digest('hex');
  } catch {
    return 'unknown';
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* 关闭失败不影响指纹结果 */
      }
    }
  }
}

// ════════════════════════════════════════
// 受控写唯一入口（HMAC 链——与 emitDecision 同模式）
// ════════════════════════════════════════

/** 审计文件路径：data/train/<enterpriseId>/<trainJobId>/audit.jsonl（单一出口） */
export function trainAuditPath(dataDir: string, enterpriseId: string, trainJobId: string): string {
  return `${dataDir}/train/${enterpriseId}/${trainJobId}/audit.jsonl`;
}

/**
 * 追加一条训练审计记录到 audit.jsonl（受控写唯一入口）。
 *
 * 签名顺序（逐字对齐 decision-log.emitDecision）：
 *   1. prevHash：读末行 → sha256(JSON.stringify(lastRecordForHash) + '|' + fingerprint).slice(0,16)
 *   2. 先脱敏再签名（hyperparams / reason → sanitizeDeep）
 *   3. recordForSig 排除链字段
 *   4. hmacSig = createHmac('sha256', key).update(stableStringify(recordForSig) + '|' + fingerprint).digest('hex').slice(0,32)
 *   5. atomicAppendSync → chmodSync 0o600（失败告警不阻断）
 *
 * @throws TrainAuditSchemaError 校验失败（含 enterpriseId 缺失——不写文件）
 * @throws TrainAuditWriteError 写入失败（向上传播）
 */
export function emitTrainAudit(input: EmitTrainAuditInput, dataDir: string): TrainAuditEntry {
  // ── 校验（写前——enterpriseId 缺失拒绝写入是块四的审计规则）──
  if (!VALID_EVENT_TYPES.includes(input.type)) {
    throw new TrainAuditSchemaError(
      `非法事件类型 "${String(input.type)}"——必须在 TrainAuditEventType 枚举内`,
    );
  }
  if (typeof input.trainJobId !== 'string' || input.trainJobId.trim() === '') {
    throw new TrainAuditSchemaError('trainJobId 必填且不能为空');
  }
  if (typeof input.enterpriseId !== 'string' || input.enterpriseId.trim() === '') {
    throw new TrainAuditSchemaError('enterpriseId 必填（缺失拒绝写入——企业隔离审计规则）');
  }
  if (typeof input.dataSourceHash !== 'string' || input.dataSourceHash === '') {
    throw new TrainAuditSchemaError('dataSourceHash 必填（数据源可溯源依赖）');
  }

  const filePath = trainAuditPath(dataDir, input.enterpriseId, input.trainJobId);
  const dir = filePath.slice(0, filePath.lastIndexOf('/'));

  try {
    if (!existsSync(dir)) {
      // 权限收紧 0o700（与 decision-log 目录语义一致）
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
  } catch (err) {
    throw new TrainAuditWriteError(`创建目录失败 ${dir}`, err);
  }

  const fingerprint = getEnvFingerprint(dataDir);

  // ── 1. prevHash（读末行）──
  let prevHash = 'genesis';
  if (existsSync(filePath)) {
    try {
      const lines = readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
      if (lines.length > 0) {
        const lastLine = lines[lines.length - 1]!;
        const lastEntry = JSON.parse(lastLine) as TrainAuditEntry;
        const lastRecordForHash = { ...lastEntry, prevHash: undefined, hashVersion: undefined };
        prevHash = createHash('sha256')
          .update(JSON.stringify(lastRecordForHash) + '|' + fingerprint)
          .digest('hex')
          .slice(0, 16);
      }
    } catch {
      // 末行解析失败——无法建立链，保守置 'unknown'（与 emitDecision 同语义）
      prevHash = 'unknown';
    }
  }

  // ── 2-3. 先脱敏再签名（铁律）──
  const hmacKey = getHmacKey();
  const baseSanitized: TrainAuditEntry = {
    ts: new Date().toISOString(),
    type: input.type,
    trainJobId: input.trainJobId,
    enterpriseId: input.enterpriseId,
    dataSourceHash: input.dataSourceHash,
    hyperparams: (sanitizeDeep(input.hyperparams ?? {}) ?? {}) as Record<string, unknown>,
    ...(input.outputDir !== undefined ? { outputDir: input.outputDir } : {}),
    ...(input.checkpointPath !== undefined ? { checkpointPath: input.checkpointPath } : {}),
    ...(input.fromStatus !== undefined ? { fromStatus: input.fromStatus } : {}),
    ...(input.toStatus !== undefined ? { toStatus: input.toStatus } : {}),
    ...(input.reason !== undefined ? { reason: redactString(input.reason) } : {}),
    ...(input.rollback !== undefined
      ? {
          rollback: {
            rollbackTo: input.rollback.rollbackTo,
            quarantined: input.rollback.quarantined.map(redactString),
          },
        }
      : {}),
    prevHash,
    hashVersion: 2,
    envFingerprint: fingerprint,
    hmacAlgo: hmacKey ? 'stable' : undefined,
    engine: 'sofagent-train-audit',
  };

  // ── 4-5. 签名输入排除链字段 + HMAC ──
  const recordForSig = {
    ...baseSanitized,
    prevHash: undefined,
    hashVersion: undefined,
    hmacSig: undefined,
    hmacAlgo: undefined,
  };
  const hmacSig = hmacKey
    ? createHmac('sha256', hmacKey)
        .update(stableStringify(recordForSig) + '|' + fingerprint)
        .digest('hex')
        .slice(0, 32)
    : undefined;

  const finalEntry: TrainAuditEntry = { ...baseSanitized, hmacSig: hmacSig ?? undefined };

  // ── 6. 原子追加 + 收紧权限 ──
  try {
    atomicAppendSync(filePath, JSON.stringify(finalEntry));
  } catch (err) {
    throw new TrainAuditWriteError(`atomicAppendSync 失败 ${filePath}`, err);
  }
  try {
    chmodSync(filePath, 0o600);
  } catch (err) {
    // 权限失败告警不阻断（与 emitDecision 同语义）
    console.error(
      `[train-audit] 审计文件权限设置失败: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return finalEntry;
}

/** 读取 job 的全部审计条目（坏行跳过——查询侧容错） */
export function readTrainAudit(
  dataDir: string,
  enterpriseId: string,
  trainJobId: string,
): TrainAuditEntry[] {
  const filePath = trainAuditPath(dataDir, enterpriseId, trainJobId);
  if (!existsSync(filePath)) return [];
  const out: TrainAuditEntry[] = [];
  for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      out.push(JSON.parse(trimmed) as TrainAuditEntry);
    } catch {
      /* 坏行跳过（链校验会给出 tampered 判定） */
    }
  }
  return out;
}

// ════════════════════════════════════════
// 链完整性校验（mirror decision-chain.ts 三态判定）
// ════════════════════════════════════════

export type TrainAuditChainStatus = 'ok' | 'tampered' | 'unverifiable' | 'insufficient';

export interface TrainAuditChainResult {
  status: TrainAuditChainStatus;
  detail?: string;
  index?: number;
}

/**
 * 校验 audit.jsonl 的 HMAC 链完整性（与 checkDecisionChainDetailed 完全同构）。
 * 三类异常：'tampered' 真篡改（红：指纹一致但签名不匹配）/ 'unverifiable'
 * 环境漂移（黄：密钥轮换或指纹变化）/ 'insufficient' 历史不足（灰：不足 2 条）。
 */
export function checkTrainAuditChain(
  dataDir: string,
  enterpriseId: string,
  trainJobId: string,
): TrainAuditChainResult {
  const filePath = trainAuditPath(dataDir, enterpriseId, trainJobId);
  if (!existsSync(filePath)) {
    return { status: 'insufficient', detail: '审计文件不存在，无法验证防篡改链' };
  }

  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (err) {
    console.error('[train-audit] 读取审计文件失败:', err);
    return { status: 'tampered', detail: 'audit.jsonl 读取失败（疑似权限/损坏）' };
  }

  const entries: TrainAuditEntry[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      entries.push(JSON.parse(trimmed) as TrainAuditEntry);
    } catch (err) {
      console.error('[train-audit] 解析审计条目 JSON 失败:', err);
    }
  }

  if (entries.length <= 1) {
    return { status: 'insufficient', detail: '审计记录不足 2 条，无法构成可验证的防篡改链' };
  }

  const fingerprint = getEnvFingerprint(dataDir);
  const hmacKey = getHmacKey();
  const keyAvailable = hmacKey !== null;
  let foundUnverifiable = false;

  // 创世条目独立验签（与 decision-chain 一致）
  const genesisEntry = entries[0]!;
  if (
    genesisEntry &&
    typeof genesisEntry.hmacSig === 'string' &&
    genesisEntry.hmacSig &&
    keyAvailable &&
    hmacKey
  ) {
    const genesisUseFingerprint = genesisEntry.hashVersion === 2;
    const genesisRecordForSig = {
      ...genesisEntry,
      prevHash: undefined,
      hashVersion: undefined,
      hmacSig: undefined,
      hmacAlgo: undefined,
    };
    const genesisHashInput = genesisUseFingerprint
      ? stableStringify(genesisRecordForSig) + '|' + fingerprint
      : stableStringify(genesisRecordForSig);
    const genesisExpectedHmac = createHmac('sha256', hmacKey)
      .update(genesisHashInput)
      .digest('hex')
      .slice(0, 32);
    if (genesisEntry.hmacSig !== genesisExpectedHmac) {
      if (genesisEntry.hmacAlgo === 'stable' && !genesisUseFingerprint) {
        return {
          status: 'tampered',
          index: 0,
          detail: '审计创世条目（索引 0）HMAC 签名不匹配（stable 条目，无环境指纹），疑似内容被篡改',
        };
      }
      foundUnverifiable = true;
    }
  }

  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1]!;
    const curr = entries[i]!;
    const currUseFingerprint = curr.hashVersion === 2;

    // 1) prevHash 链校验
    if (curr.prevHash == null || curr.prevHash === 'unknown') continue;
    const recordForHash = { ...prev, prevHash: undefined, hashVersion: undefined };
    const hashInput = currUseFingerprint
      ? JSON.stringify(recordForHash) + '|' + fingerprint
      : JSON.stringify(recordForHash);
    const expectedPrevHash = createHash('sha256').update(hashInput).digest('hex').slice(0, 16);
    if (curr.prevHash !== expectedPrevHash) {
      if (currUseFingerprint) {
        foundUnverifiable = true;
      } else {
        return {
          status: 'tampered',
          index: i,
          detail: `审计条目 ${i} prevHash 不匹配（旧算法，环境无关），疑似内容被篡改`,
        };
      }
      continue;
    }

    // 2) HMAC 验签
    if (curr.hmacSig && keyAvailable && hmacKey) {
      const recordForSig = {
        ...curr,
        prevHash: undefined,
        hashVersion: undefined,
        hmacSig: undefined,
        hmacAlgo: undefined,
      };
      const expectedHmac = createHmac('sha256', hmacKey)
        .update(stableStringify(recordForSig) + '|' + fingerprint)
        .digest('hex')
        .slice(0, 32);
      if (curr.hmacSig !== expectedHmac) {
        if (curr.hmacAlgo === 'stable') {
          if (currUseFingerprint) {
            const recordedFingerprint = curr.envFingerprint;
            if (typeof recordedFingerprint === 'string' && recordedFingerprint.length > 0) {
              if (recordedFingerprint === fingerprint) {
                return {
                  status: 'tampered',
                  index: i,
                  detail: `审计条目 ${i} HMAC 签名不匹配（环境指纹一致，确为内容被篡改）`,
                };
              }
              foundUnverifiable = true;
            } else {
              foundUnverifiable = true;
            }
          } else {
            return {
              status: 'tampered',
              index: i,
              detail: `审计条目 ${i} HMAC 签名不匹配（stable 条目，无环境指纹），疑似内容被篡改`,
            };
          }
        } else {
          foundUnverifiable = true;
        }
      }
    }
  }

  if (foundUnverifiable) {
    return {
      status: 'unverifiable',
      detail: '部分审计段（v2 含环境指纹条目）因密钥或环境指纹漂移无法复验，属历史证据不可复验，非篡改',
    };
  }
  return { status: 'ok' };
}

// ════════════════════════════════════════
// 失败回滚（半成品隔离 + 现场封存 + 审计留痕）
// ════════════════════════════════════════

/**
 * 失败回滚结果。
 *
 * 回滚语义（dev-prompt「git snapshot 兜底」的落地形态——训练数据目录不在
 * git 管辖，等价实现为失败现场完整封存）：
 *   - 有 checkpoint → rollbackTo=checkpoint 路径（续跑从断点恢复）
 *   - 无 checkpoint → rollbackTo=null + 失败现场（半成品产出）封存到
 *     <jobId>/failed-artifacts/——目录不可删（审计证据链）
 */
export interface TrainRollbackResult {
  trainJobId: string;
  enterpriseId: string;
  /** 回滚目标 checkpoint（null = 无断点可回，现场已封存） */
  rollbackTo: string | null;
  /** 挪到 failed-artifacts/ 的半成品路径（相对 job 目录） */
  quarantined: string[];
  /** 封存目录（rollbackTo=null 时为失败现场证据目录） */
  quarantineDir: string;
}

/**
 * 递归删除目录内容但保留目录本身（失败现场的容器不可删——审计证据链）。
 */
function clearDirContents(dir: string): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const target = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      rmSync(target, { recursive: true, force: true });
    } else {
      rmSync(target, { force: true });
    }
  }
}

/**
 * 训练失败回滚——半成品隔离 + 现场封存 + 审计留痕。
 *
 * 由 train-scheduler 在迁移到 failed 态后调用（每次失败恰好一次——幂等由
 * 调用方状态机保证，failed 是终态不会重入）：
 *   1. job 目录下 output/ 与 checkpoints/ 的半成品挪到 failed-artifacts/
 *      （保留证据——不删除，块六产物完整性校验消费）
 *   2. rollbackTo = lastCheckpoint?.checkpointPath ?? null（无断点封存现场）
 *   3. 记 train_job_rollback 审计事件（进 HMAC 链）
 *
 * @param dataDir 数据目录
 * @param jobCtx job 上下文（train-scheduler 传入）
 * @param dataSourceHash 数据源指纹（审计事件携带——可溯源）
 */
export function rollbackFailedTrainJob(
  dataDir: string,
  jobCtx: {
    trainJobId: string;
    enterpriseId: string;
    /** 上一 checkpoint（回滚目标——null 表示无断点） */
    lastCheckpoint: { checkpointPath: string; step: number } | null;
    outputDir: string;
    checkpointPath: string;
    hyperparams: Record<string, unknown>;
  },
  dataSourceHash: string,
): TrainRollbackResult {
  const { trainJobId, enterpriseId, outputDir, checkpointPath } = jobCtx;
  const jobDir = `${dataDir}/train/${enterpriseId}/${trainJobId}`;
  const quarantineDir = `${jobDir}/failed-artifacts`;

  if (!existsSync(quarantineDir)) {
    mkdirSync(quarantineDir, { recursive: true, mode: 0o700 });
  }
  // 重入清理（同一 job 重复失败场景——理论不可达，防御性清空）
  clearDirContents(quarantineDir);

  // 半成品识别：output/ 与 checkpoints/ 均在 job 目录内才算「job 资产」
  // （外部绝对路径不碰——避免误挪企业其他资产）
  const quarantined: string[] = [];
  for (const [label, path] of [['output', outputDir], ['checkpoints', checkpointPath]] as const) {
    if (!existsSync(path)) continue;
    // 只有 job 目录内的产出才隔离（外部传入的绝对路径跳过）
    if (!path.startsWith(jobDir)) continue;
    if (path === quarantineDir || path.startsWith(quarantineDir)) continue; // 防自身嵌套
    const target = `${quarantineDir}/${label}`;
    try {
      renameSync(path, target);
      quarantined.push(label);
    } catch {
      // 挪动失败（跨设备等）——降级删除（保留可写状态续跑不被半成品污染）
      rmSync(path, { recursive: true, force: true });
      quarantined.push(`${label}(removed-fallback)`);
    }
  }

  const rollbackTo = jobCtx.lastCheckpoint?.checkpointPath ?? null;

  // 审计留痕（进 HMAC 链——回滚动作可追溯）
  emitTrainAudit(
    {
      type: 'train_job_rollback',
      trainJobId,
      enterpriseId,
      dataSourceHash,
      hyperparams: jobCtx.hyperparams,
      toStatus: 'failed',
      reason: rollbackTo
        ? `失败回滚：挪走半成品 → 从 checkpoint 恢复可用（rollbackTo=${rollbackTo}）`
        : '失败回滚：无 checkpoint 可回——半成品现场封存 failed-artifacts/（git snapshot 等价实现）',
      rollback: { rollbackTo, quarantined },
    },
    dataDir,
  );

  return { trainJobId, enterpriseId, rollbackTo, quarantined, quarantineDir };
}

/**
 * 便捷封装：失败迁移 + 回滚一体（train-scheduler 调用点）。
 * 先记 train_job_failed（终态事件），再做半成品隔离（train_job_rollback）。
 */
export function failTrainJobWithRollback(
  dataDir: string,
  jobCtx: {
    trainJobId: string;
    enterpriseId: string;
    lastCheckpoint: { checkpointPath: string; step: number } | null;
    outputDir: string;
    checkpointPath: string;
    hyperparams: Record<string, unknown>;
    fromStatus: TrainJobStatus;
    reason: string;
  },
  dataSourceHash: string,
): { rollback: TrainRollbackResult; auditEntry: TrainAuditEntry } {
  const auditEntry = emitTrainAudit(
    {
      type: 'train_job_failed',
      trainJobId: jobCtx.trainJobId,
      enterpriseId: jobCtx.enterpriseId,
      dataSourceHash,
      hyperparams: jobCtx.hyperparams,
      outputDir: jobCtx.outputDir,
      checkpointPath: jobCtx.checkpointPath,
      fromStatus: jobCtx.fromStatus,
      toStatus: 'failed',
      reason: jobCtx.reason,
    },
    dataDir,
  );
  const rollback = rollbackFailedTrainJob(
    dataDir,
    {
      trainJobId: jobCtx.trainJobId,
      enterpriseId: jobCtx.enterpriseId,
      lastCheckpoint: jobCtx.lastCheckpoint,
      outputDir: jobCtx.outputDir,
      checkpointPath: jobCtx.checkpointPath,
      hyperparams: jobCtx.hyperparams,
    },
    dataSourceHash,
  );
  return { rollback, auditEntry };
}
