// train-fingerprint.ts · v1.4.1 块五 · 训练可复现指纹（冻结 + 校验 + 复现差异报告）
//
// 定位：「这个模型怎么训出来的」要能一键复现——train job 完成时把全部
// 影响训练结果的输入冻结成不可变指纹文件（train-fingerprint.json），事后
// 任何人拿同一份数据 + 同一环境 + 同一超参，理论上应产出等价模型。
// 与块三 train-audit 的分工：audit 记「过程发生了什么」（治理留痕），
// fingerprint 记「输入是什么」（可复现口径）——同源不同用途。
//
// HMAC 签名复用块三 train-audit.ts 的模式（与 decision-log 同一原语）：
//   recordForSig 排除 hmac 字段 →
//   createHmac('sha256', key).update(stableStringify(recordForSig) + '|' + fingerprint)
//     .digest('hex').slice(0,32)
// 同密钥（~/.sofagent-key / SOFAGENT_KEY_PATH）、同环境指纹（getEnvFingerprint）、
// 同稳定序列化（stableStringify）——篡改可检测。
//
// 三态校验（与 train-audit checkTrainAuditChain 同判定哲学）：
//   valid        签名匹配（内容未被篡改）
//   tampered     环境指纹一致但签名不匹配（确为内容被改）
//   unverifiable 环境指纹漂移（密钥轮换/换机器——历史证据不可复验，非篡改）
//
// checkpoint 续跑版本锁定：checkpoint 时冻结 datasetVersion，续跑前强制校验
// 版本未变——变了告警 + 人审（不自动切换数据）。纯函数
// assertDatasetVersionLocked 供块七 crash-recovery 三选项决策接线。

import { existsSync, mkdirSync, readFileSync, chmodSync, statSync, openSync, readSync, closeSync, readdirSync } from 'fs';
import { createHash, createHmac } from 'crypto';
import { join } from 'path';
import { z } from 'zod';
import { atomicWriteSync, getEnvFingerprint, getHmacKey, stableStringify } from '@sofagent/core';
import { trainJobDir } from './train-job';

// ════════════════════════════════════════
// 指纹 schema（zod——冻结前校验，坏输入拒绝冻结）
// ════════════════════════════════════════

/** 环境快照（引用块一 train-env 的就绪报告——不重复采集，只引用冻结） */
export const EnvSnapshotSchema = z
  .object({
    /** 环境 分支（cuda-ready 生产栈 / metal-degraded 降级栈） */
    branch: z.enum(['cuda-ready', 'metal-degraded']),
    /** GPU 标识（null = 无 GPU） */
    gpuName: z.string().nullable(),
    /** 训练框架名+版本（null = 未安装） */
    frameworkName: z.string().nullable(),
    frameworkVersion: z.string().nullable(),
    /** train-env 报告的时间戳（引用溯源） */
    checkedAt: z.string().min(1),
  })
  .strict();

/** 指纹主体 schema（hmac 由写入侧生成——冻结输入不含 hmac） */
export const TrainFingerprintBodySchema = z
  .object({
    /** 指纹 schema 版本（协议即版本边界） */
    schemaVersion: z.literal('v1'),
    /** 训练任务标识（关联 job 目录） */
    trainJobId: z.string().min(1),
    /** 数据集内容指纹（目录级 SHA-256——确定性文件顺序） */
    datasetHash: z.string().min(1),
    /** 数据集版本（数据目录名 / 显式版本 / hash 前 8 位兜底） */
    datasetVersion: z.string().min(1),
    /** 环境快照（块一 train-env 报告引用） */
    envSnapshot: EnvSnapshotSchema,
    /** 超参快照（job.json 的 hyperparams——冻结可复现口径） */
    hyperparams: z.record(z.string(), z.unknown()),
    /** 随机种子（复现口径核心——含 seed 的训练才有理论可复现性） */
    randomSeed: z.number().int().nonnegative(),
    /** 冻结时间戳（ISO） */
    timestamp: z.string().min(1),
  })
  .strict();

/** 完整指纹（body + hmac 链字段） */
export const TrainFingerprintSchema = TrainFingerprintBodySchema.extend({
  /** HMAC 签名（写入侧生成——校验侧复算比对） */
  hmac: z.string().min(1),
  /** 环境指纹（校验三态判定的依据——区分 tampered 与 unverifiable） */
  envFingerprint: z.string().min(1),
  /** 签名算法标记（'stable' = stableStringify 签名） */
  hmacAlgo: z.literal('stable'),
});

export type EnvSnapshot = z.infer<typeof EnvSnapshotSchema>;
export type TrainFingerprintBody = z.infer<typeof TrainFingerprintBodySchema>;
export type TrainFingerprint = z.infer<typeof TrainFingerprintSchema>;

// ════════════════════════════════════════
// 错误类型
// ════════════════════════════════════════

/** 指纹校验失败（schema/冻结输入非法）——不写文件 */
export class TrainFingerprintError extends Error {
  constructor(message: string) {
    super(`[train-fingerprint] ${message}`);
    this.name = 'TrainFingerprintError';
  }
}

/** 指纹文件写入失败（IO）——向上传播 */
export class TrainFingerprintWriteError extends Error {
  constructor(message: string, cause?: unknown) {
    super(
      `[train-fingerprint] 写入失败: ${message}${cause instanceof Error ? `（${cause.message}）` : ''}`,
    );
    this.name = 'TrainFingerprintWriteError';
  }
}

// ════════════════════════════════════════
// 数据集指纹（目录级确定性 SHA-256）
// ════════════════════════════════════════

/** 单文件分块 hash（64KB 块——GB 级数据集内存安全） */
function hashFile(filePath: string): string {
  const hash = createHash('sha256');
  let fd: number | null = null;
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) return 'unknown';
    fd = openSync(filePath, 'r');
    const chunkSize = 64 * 1024;
    const buffer = Buffer.alloc(chunkSize);
    let position = 0;
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
        /* 关闭失败不影响结果 */
      }
    }
  }
}

/**
 * 递归收集目录下全部文件路径（排序后返回——确定性顺序的来源）。
 * 文件系统返回顺序不可依赖（readdir 不保证序），统一 sort 后再逐文件
 * hash，保证「同数据不同列举顺序 → 同 hash」。
 */
function collectFilesSorted(rootDir: string, prefix = ''): string[] {
  const out: string[] = [];
  let entries;
  try {
    entries = readdirSync(join(rootDir, prefix), { withFileTypes: true });
  } catch {
    return out; // 读不动的目录按空处理（数据缺失可从 hash 稳定性反推）
  }
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...collectFilesSorted(rootDir, rel));
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

/**
 * 计算数据目录内容指纹（目录级 SHA-256）。
 *
 * 确定性口径：文件相对路径排序 → 逐文件 sha256 → 「relPath:fileHash」逐行
 * 汇总再整体 sha256。文件增删/改名/内容变 → hash 必变；文件列举顺序变
 * （OS 差异）→ hash 不变（排序消除）。
 *
 * @param datasetDir 数据目录（训练集所在）
 * @returns 64 位 hex 指纹；目录不存在返回 'unknown'（可审计占位）
 */
export function computeDatasetHash(datasetDir: string): string {
  try {
    if (!existsSync(datasetDir) || !statSync(datasetDir).isDirectory()) return 'unknown';
  } catch {
    return 'unknown';
  }
  const files = collectFilesSorted(datasetDir);
  if (files.length === 0) {
    // 空目录也要有稳定指纹（区分「空数据」与「目录消失」）
    return createHash('sha256').update('empty-dataset').digest('hex');
  }
  const lines: string[] = [];
  for (const rel of files) {
    lines.push(`${rel}:${hashFile(join(datasetDir, rel))}`);
  }
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

/**
 * 解析数据集版本（优先级：显式版本 > 目录名 > hash 前 8 位兜底）。
 *
 * 无版本机制时的兜底：hash 前 8 位作为版本标识（注释说明——数据集没有
 * 显式版本号时，内容指纹片段即是唯一可用的版本语义）。
 */
export function resolveDatasetVersion(
  datasetDir: string,
  datasetHash: string,
  explicitVersion?: string,
): string {
  if (explicitVersion !== undefined && explicitVersion.trim() !== '') return explicitVersion;
  const dirName = datasetDir.split('/').filter(Boolean).pop();
  if (dirName && dirName.trim() !== '') return dirName;
  return datasetHash.slice(0, 8);
}

// ════════════════════════════════════════
// 指纹冻结（train job 完成时调用）
// ════════════════════════════════════════

/** 指纹文件路径：job 目录 train-fingerprint.json（单一出口） */
export function trainFingerprintPath(dataDir: string, enterpriseId: string, trainJobId: string): string {
  return join(trainJobDir(dataDir, enterpriseId, trainJobId), 'train-fingerprint.json');
}

/** 指纹冻结输入（调用方组装——scheduler 完成 / 块七恢复完成时调用） */
export interface FreezeTrainFingerprintInput {
  dataDir: string;
  enterpriseId: string;
  trainJobId: string;
  /** 数据集目录（目录级 hash 输入） */
  datasetDir: string;
  /** 显式数据集版本（可选——缺省用目录名 / hash 前 8 位） */
  datasetVersion?: string;
  /** 环境快照（块一 train-env 报告字段引用） */
  envSnapshot: EnvSnapshot;
  /** 超参快照（job.json 的 hyperparams） */
  hyperparams: Record<string, unknown>;
  /** 随机种子 */
  randomSeed: number;
  /** 冻结时间戳（缺省当前时间——测试可注入固定值） */
  timestamp?: string;
}

/**
 * 冻结训练指纹（train job 完成时调用——不可变写）。
 *
 * 语义：文件已存在时拒绝重冻结（指纹不可变——重复冻结 = 输入漂移，需
 * 人工排查而非静默覆盖）。返回已冻结的完整指纹。
 *
 * @throws TrainFingerprintError 输入 schema 非法 / 已存在指纹（不可变纪律）
 * @throws TrainFingerprintWriteError IO 失败
 */
export function freezeTrainFingerprint(input: FreezeTrainFingerprintInput): TrainFingerprint {
  const datasetHash = computeDatasetHash(input.datasetDir);
  const datasetVersion = resolveDatasetVersion(
    input.datasetDir,
    datasetHash,
    input.datasetVersion,
  );

  const body: TrainFingerprintBody = {
    schemaVersion: 'v1',
    trainJobId: input.trainJobId,
    datasetHash,
    datasetVersion,
    envSnapshot: input.envSnapshot,
    hyperparams: input.hyperparams,
    randomSeed: input.randomSeed,
    timestamp: input.timestamp ?? new Date().toISOString(),
  };

  const parsed = TrainFingerprintBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new TrainFingerprintError(
      `指纹输入非法（拒绝冻结）：${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('；')}`,
    );
  }

  const fingerprintFile = trainFingerprintPath(input.dataDir, input.enterpriseId, input.trainJobId);

  // 不可变纪律：已存在 → 拒绝（指纹一旦冻结不可覆盖）
  if (existsSync(fingerprintFile)) {
    throw new TrainFingerprintError(
      `指纹已存在（不可变纪律）：${fingerprintFile}——重复冻结意味着输入漂移，请人工排查`,
    );
  }

  const envFingerprint = getEnvFingerprint(input.dataDir);
  const hmacKey = getHmacKey();
  if (!hmacKey) {
    throw new TrainFingerprintError(
      'HMAC 密钥不可用（~/.sofagent-key 缺失）——无法签名，拒绝冻结无签名指纹',
    );
  }

  // 签名输入排除 hmac 本身（body 全量 + envFingerprint 参与签名）
  const recordForSig = { ...body };
  const hmac = createHmac('sha256', hmacKey)
    .update(stableStringify(recordForSig) + '|' + envFingerprint)
    .digest('hex')
    .slice(0, 32);

  const fingerprint: TrainFingerprint = {
    ...body,
    hmac,
    envFingerprint,
    hmacAlgo: 'stable',
  };

  const dir = join(fingerprintFile, '..');
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    atomicWriteSync(fingerprintFile, JSON.stringify(fingerprint, null, 2));
  } catch (err) {
    throw new TrainFingerprintWriteError(`指纹落盘失败 ${fingerprintFile}`, err);
  }
  try {
    chmodSync(fingerprintFile, 0o600);
  } catch (err) {
    // 权限失败告警不阻断（与 train-audit 同语义）
    console.error(
      `[train-fingerprint] 指纹文件权限设置失败: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return fingerprint;
}

/** 读取指纹文件（不存在/坏数据返回 null——调用方判空） */
export function loadTrainFingerprint(
  dataDir: string,
  enterpriseId: string,
  trainJobId: string,
): TrainFingerprint | null {
  const file = trainFingerprintPath(dataDir, enterpriseId, trainJobId);
  if (!existsSync(file)) return null;
  try {
    const parsed = TrainFingerprintSchema.safeParse(JSON.parse(readFileSync(file, 'utf-8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// ════════════════════════════════════════
// 三态校验（valid / tampered / unverifiable）
// ════════════════════════════════════════

export type TrainFingerprintVerifyStatus = 'valid' | 'tampered' | 'unverifiable' | 'unreadable';

export interface TrainFingerprintVerifyResult {
  status: TrainFingerprintVerifyStatus;
  detail?: string;
}

/**
 * 校验指纹文件完整性（三态判定）。
 *
 *   valid        HMAC 复算匹配（内容未被篡改）
 *   tampered     环境指纹一致但 HMAC 不匹配（确为内容被改——红色告警）
 *   unverifiable 环境指纹漂移（换机器/密钥轮换——历史证据不可复验，非篡改）
 *   unreadable   文件不存在/schema 坏（降级——调用方按需处理）
 */
export function verifyTrainFingerprint(
  dataDir: string,
  enterpriseId: string,
  trainJobId: string,
): TrainFingerprintVerifyResult {
  const file = trainFingerprintPath(dataDir, enterpriseId, trainJobId);
  if (!existsSync(file)) {
    return { status: 'unreadable', detail: '指纹文件不存在' };
  }
  let fingerprint: TrainFingerprint;
  try {
    const parsed = TrainFingerprintSchema.safeParse(JSON.parse(readFileSync(file, 'utf-8')));
    if (!parsed.success) {
      return { status: 'unreadable', detail: '指纹 schema 校验失败（疑似格式损坏）' };
    }
    fingerprint = parsed.data;
  } catch {
    return { status: 'unreadable', detail: '指纹文件解析失败' };
  }

  const hmacKey = getHmacKey();
  if (!hmacKey) {
    return { status: 'unverifiable', detail: 'HMAC 密钥不可用（无法复验）' };
  }

  // 环境指纹漂移判定：文件内记录的指纹 ≠ 当前环境指纹 → 不可复验（非篡改）
  const currentEnvFingerprint = getEnvFingerprint(dataDir);
  if (fingerprint.envFingerprint !== currentEnvFingerprint) {
    return {
      status: 'unverifiable',
      detail: `环境指纹漂移（记录 ${fingerprint.envFingerprint} / 当前 ${currentEnvFingerprint}）——换机器或密钥轮换，历史证据不可复验`,
    };
  }

  // HMAC 复算（签名输入排除 hmac/envFingerprint/hmacAlgo 三链字段）
  const recordForSig: TrainFingerprintBody = {
    schemaVersion: fingerprint.schemaVersion,
    trainJobId: fingerprint.trainJobId,
    datasetHash: fingerprint.datasetHash,
    datasetVersion: fingerprint.datasetVersion,
    envSnapshot: fingerprint.envSnapshot,
    hyperparams: fingerprint.hyperparams,
    randomSeed: fingerprint.randomSeed,
    timestamp: fingerprint.timestamp,
  };
  const expected = createHmac('sha256', hmacKey)
    .update(stableStringify(recordForSig) + '|' + currentEnvFingerprint)
    .digest('hex')
    .slice(0, 32);

  if (fingerprint.hmac !== expected) {
    return {
      status: 'tampered',
      detail: `HMAC 签名不匹配（环境指纹一致，确为内容被篡改）——记录 ${fingerprint.hmac} / 复算 ${expected}`,
    };
  }
  return { status: 'valid' };
}

// ════════════════════════════════════════
// 复现校验（结构化差异报告）
// ════════════════════════════════════════

/** 复现校验的当前上下文（调用方采集） */
export interface ReproduceContext {
  /** 当前数据目录（现场重算 hash 比对） */
  datasetDir: string;
  /** 当前环境快照（块一 train-env 报告字段） */
  envSnapshot: EnvSnapshot;
  /** 当前超参 */
  hyperparams: Record<string, unknown>;
  /** 当前随机种子 */
  randomSeed: number;
}

/** 单字段差异（before = 指纹冻结值 / after = 当前值） */
export interface FingerprintDiff {
  field: 'datasetHash' | 'envSnapshot' | 'hyperparams' | 'randomSeed';
  before: unknown;
  after: unknown;
  /** 差异说明（人读） */
  detail: string;
}

/** 复现校验结果 */
export interface ReproduceCheckResult {
  /** true = 四要素全一致（可复现） */
  reproducible: boolean;
  /** 差异列表（空 = 无差异） */
  diffs: FingerprintDiff[];
  /** 校验的指纹（引用） */
  fingerprint: TrainFingerprint;
}

/**
 * 复现校验——当前数据/环境/超参/种子 与冻结指纹逐项比对。
 *
 * 差异报告口径：**只报变的字段，不误报**——每个维度独立比对，未变维度
 * 不出现在 diffs 里（报告噪音直接影响排障效率）。
 *
 * @param fingerprintFile 已冻结的指纹
 * @param currentContext 当前复现上下文
 */
export function reproduceCheck(
  fingerprint: TrainFingerprint,
  currentContext: ReproduceContext,
): ReproduceCheckResult {
  const diffs: FingerprintDiff[] = [];

  // ① datasetHash：现场重算数据目录 hash（内容级比对——不是路径比对）
  const currentDatasetHash = computeDatasetHash(currentContext.datasetDir);
  if (currentDatasetHash !== fingerprint.datasetHash) {
    diffs.push({
      field: 'datasetHash',
      before: fingerprint.datasetHash,
      after: currentDatasetHash,
      detail: `数据集内容变化（冻结 ${fingerprint.datasetHash.slice(0, 12)}… / 当前 ${currentDatasetHash.slice(0, 12)}…）`,
    });
  }

  // ② envSnapshot：结构化逐字段比对（branch/gpu/framework 任一变即差异）
  const fpEnv = fingerprint.envSnapshot;
  const curEnv = currentContext.envSnapshot;
  const envChanged =
    fpEnv.branch !== curEnv.branch ||
    fpEnv.gpuName !== curEnv.gpuName ||
    fpEnv.frameworkName !== curEnv.frameworkName ||
    fpEnv.frameworkVersion !== curEnv.frameworkVersion;
  if (envChanged) {
    diffs.push({
      field: 'envSnapshot',
      before: fpEnv,
      after: curEnv,
      detail: `环境快照变化（${fpEnv.branch}→${curEnv.branch}${fpEnv.gpuName !== curEnv.gpuName ? `，GPU ${fpEnv.gpuName}→${curEnv.gpuName}` : ''}${fpEnv.frameworkVersion !== curEnv.frameworkVersion ? `，框架 ${fpEnv.frameworkVersion}→${curEnv.frameworkVersion}` : ''}）`,
    });
  }

  // ③ hyperparams：stableStringify 比对（键序不敏感——语义级等价判定）
  const hpBefore = stableStringify(fingerprint.hyperparams);
  const hpAfter = stableStringify(currentContext.hyperparams);
  if (hpBefore !== hpAfter) {
    diffs.push({
      field: 'hyperparams',
      before: fingerprint.hyperparams,
      after: currentContext.hyperparams,
      detail: '超参变化（stableStringify 语义比对不等价）',
    });
  }

  // ④ randomSeed：数值直接比对
  if (fingerprint.randomSeed !== currentContext.randomSeed) {
    diffs.push({
      field: 'randomSeed',
      before: fingerprint.randomSeed,
      after: currentContext.randomSeed,
      detail: `随机种子变化（${fingerprint.randomSeed} → ${currentContext.randomSeed}）`,
    });
  }

  return { reproducible: diffs.length === 0, diffs, fingerprint };
}

// ════════════════════════════════════════
// checkpoint 续跑版本锁定（纯函数——块七接线）
// ════════════════════════════════════════

/** 版本锁定校验结果 */
export interface DatasetVersionLockResult {
  /** true = 版本一致可续跑；false = 版本漂移须人审 */
  locked: boolean;
  /** 不通过时的原因（含两版本值——人审材料） */
  reason: string;
}

/**
 * 断言数据集版本锁定（checkpoint 续跑前校验）。
 *
 * 纯函数（无 IO）：currentVersion / lockedVersion 由调用方采集传入——
 * 块七 crash-recovery 的三选项决策（resume-checkpoint / mark-failed /
 * human-review）在 resume 分支调用本函数，locked=false 时必须转
 * human-review 路径（不自动切换数据集）。
 *
 * @param currentVersion 续跑现场的数据集版本（resolveDatasetVersion 采集）
 * @param lockedVersion checkpoint 冻结时锁定的版本（指纹/checkpoint manifest）
 */
export function assertDatasetVersionLocked(
  currentVersion: string,
  lockedVersion: string,
): DatasetVersionLockResult {
  if (currentVersion === lockedVersion) {
    return {
      locked: true,
      reason: `数据集版本一致（${lockedVersion}）——可续跑`,
    };
  }
  return {
    locked: false,
    reason: `数据集版本漂移：checkpoint 锁定 ${lockedVersion}，当前 ${currentVersion}——不自动切换，须人审决定（换数据重训 / 回退锁定版本续跑 / 标记失败）`,
  };
}

/**
 * 便捷封装：checkpoint 时把 datasetVersion 冻结进指纹可校验的锁定口径。
 * 返回「锁定条目」——调用方（块七 manifest 工具，eng-deps 手里）把它写进
 * checkpoint manifest 的 entry（本模块不直接写 manifest——职责分离）。
 */
export function buildDatasetLockEntry(
  fingerprint: TrainFingerprint,
): { datasetVersion: string; datasetHash: string; lockedAt: string; source: 'train-fingerprint' } {
  return {
    datasetVersion: fingerprint.datasetVersion,
    datasetHash: fingerprint.datasetHash,
    lockedAt: fingerprint.timestamp,
    source: 'train-fingerprint',
  };
}
