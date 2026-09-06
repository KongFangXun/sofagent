// cleanup.ts · v1.4.5 块四 · 训练数据覆写清理（数据主权：先覆写再删除）
//
// 定位：`train cleanup <enterpriseId>` 的实现——清空该企业全部训练数据
// （权重 / checkpoint / 事件 / 状态）。「删除」在数据主权语境下不够：
// unlink 只解除引用，磁盘块上的原文仍在（fs journal / 快照 / 恢复工具都可
// 复原）。满足「企业退出即数据不可复原」的最低标准是**覆写后删除**。
//
// 覆写标准的技术选型（如实声明，不夸大）：
//   - 本实现 = 单遍全随机字节覆写 + 截断 + 重命名三步，再 unlink。
//   - 与 Gutmann（35 遍） / srm（DoD 7 遍）的关系：多遍方案针对的是
//     「磁头定位精度的磁残留复原」，对现代 SSD/加密盘已无必要（SSD 的
//     wear-leveling 使任何软件多遍方案都不可靠，正确途径是整盘加密 +
//     销毁密钥）。单遍随机覆写对旋转盘（NIST 800-88 Clear 单遍认可）与
//     常规合规场景是「成本/收益的最优解」，Node fs 自实现零外部依赖。
//   - 诚实边界：SSD 上本方案与 srm 同样无法保证覆盖物理块——若客户有
//     更高等级要求（如涉密），应叠加「数据目录落在加密卷」的部署约束，
//     这属于部署面而非本模块职责。
//
// 安全边界：只允许清 data/train/<enterpriseId>/ 下的内容——目录解析后
// 必须仍在该企业分区内（防 ../ 逃逸，复用 isolation-guard 的段校验 +
// containment 双保险）。覆写失败（如文件被锁）→ 记入 skipped 如实报告，
// 绝不静默吞掉。

import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeSync,
  ftruncateSync,
} from 'fs';
import { randomBytes } from 'crypto';
import { dirname, join, resolve } from 'path';
import {
  assertSafePathSegment,
  isPathInside,
  EnterpriseAccessDeniedError,
} from './isolation-guard';

// ══════════════════════════════════════
// 结果模型（如实报告——成功与跳过都可见）
// ══════════════════════════════════════

/** 单个文件的清理结果 */
export interface FileCleanupResult {
  /** 原文件路径（审计留痕——清理报告需要说明清了什么） */
  path: string;
  /** 覆写+删除全部完成 */
  status: 'wiped';
  /** 覆写失败（文件被锁/权限），已如实跳过 */
  status2?: never;
}

/** 跳过项（覆写失败——如实报告，不静默） */
export interface SkippedItem {
  path: string;
  /** 跳过原因（如「覆写失败: EBUSY」——供运维定位） */
  reason: string;
  /** 失败阶段（overwrite / truncate / rename / unlink / stat） */
  stage: 'overwrite' | 'truncate' | 'rename' | 'unlink' | 'stat' | 'chmod';
}

/** 目录混淆记录（目录名抹除——原名不再出现在磁盘元数据） */
export interface DirObfuscation {
  /** 原目录相对路径 */
  originalPath: string;
  /** 混淆后临时名（删除前的中转名——报告用，磁盘上已不存在） */
  obfuscatedName: string;
}

/** cleanup 汇总报告 */
export interface CleanupReport {
  /** 企业分区根（绝对路径） */
  enterpriseDir: string;
  /** 成功覆写删除的文件数 */
  wipedFiles: number;
  /** 成功混淆删除的目录数 */
  removedDirs: number;
  /** 覆写字节数（粗算——报告透明度用） */
  overwrittenBytes: number;
  /** 跳过项（失败如实报告——为空才是全清） */
  skipped: SkippedItem[];
  /** 目录混淆记录 */
  obfuscations: DirObfuscation[];
  /** 企业分区目录本身是否已删除 */
  enterpriseDirRemoved: boolean;
  /** 开始/结束时间戳 */
  startedAt: string;
  finishedAt: string;
  /** skipped 为空即全部成功 */
  fullyCleaned: boolean;
}

/** 覆写参数 */
export interface CleanupOptions {
  /**
   * 覆写遍数（默认 1——单遍随机对现代介质已是合理标准，见文件头选型说明；
   * 合规要求更高可调大，每遍独立随机）
   */
  passes?: number;
  /** 每次写盘块大小（默认 1 MiB——覆写大文件不爆内存） */
  chunkBytes?: number;
}

// ══════════════════════════════════════
// 单文件覆写（覆写 → 截断 → 重命名 → unlink）
// ══════════════════════════════════════

/**
 * 三步覆写单个文件：
 *   一、随机字节覆写全部内容（多遍可配——每遍独立随机）
 *   二、截断为 0（消除文件长度元数据线索）
 *   三、重命名为随机名（消除文件名元数据线索）后 unlink
 * 覆写前补 chmod 0o600（只读文件先解锁，否则 open 'r+' 报 EACCES）。
 */
export function wipeFile(filePath: string, opts: CleanupOptions = {}): {
  overwrittenBytes: number;
} {
  const passes = Math.max(1, opts.passes ?? 1);
  const chunkBytes = Math.max(4096, opts.chunkBytes ?? 1024 * 1024);

  // 0. 只读文件先解锁（权限恢复失败如实抛——调用方记 skipped）
  let size: number;
  try {
    size = statSync(filePath).size;
  } catch (e) {
    throw stageError(e, 'stat', filePath);
  }
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // chmod 失败不必然阻断（可能本来就是可写）——继续尝试打开
  }

  // 一、随机覆写（passes 遍——每遍独立随机字节）
  let fd: number;
  try {
    fd = openSync(filePath, 'r+');
  } catch (e) {
    throw stageError(e, 'overwrite', filePath);
  }
  try {
    for (let pass = 0; pass < passes; pass++) {
      let written = 0;
      while (written < size) {
        const n = Math.min(chunkBytes, size - written);
        const buf = randomBytes(n);
        const w = writeSync(fd, buf, 0, n, written);
        written += w;
      }
    }
  } catch (e) {
    closeSync(fd);
    throw stageError(e, 'overwrite', filePath);
  }

  // 二、截断为 0（长度元数据抹除）
  try {
    ftruncateSync(fd, 0);
  } catch (e) {
    closeSync(fd);
    throw stageError(e, 'truncate', filePath);
  }
  closeSync(fd);

  // 三、重命名混淆后删除（文件名元数据抹除）
  const obfuscated = `.wipe-${randomBytes(8).toString('hex')}`;
  const target = join(dirname(filePath), obfuscated);
  try {
    renameSync(filePath, target);
  } catch (e) {
    throw stageError(e, 'rename', filePath);
  }
  try {
    unlinkSync(target);
  } catch (e) {
    throw stageError(e, 'unlink', filePath);
  }
  return { overwrittenBytes: size * passes };
}

/** 带 stage 的错误包装（skipped.reason 可读） */
function stageError(e: unknown, stage: SkippedItem['stage'], path: string): Error {
  const msg = e instanceof Error ? e.message : String(e);
  const err = new Error(`${stage} 失败: ${msg}`);
  (err as Error & { stage?: SkippedItem['stage'] }).stage = stage;
  return err;
}

/** 从错误上取 stage（wipeFile 抛出时附带） */
function stageOf(e: unknown): SkippedItem['stage'] {
  const s = (e as { stage?: SkippedItem['stage'] }).stage;
  return typeof s === 'string' ? s : 'overwrite';
}

// ══════════════════════════════════════
// 目录递归清理（后序遍历：先文件后目录）
// ══════════════════════════════════════

/** 生成目录混淆名（短随机——原名不再出现在磁盘目录项） */
function obfuscatedDirName(): string {
  return `d-${randomBytes(6).toString('hex')}`;
}

/**
 * 递归覆写删除目录下全部内容（不删 root 本身——由调用方决定）。
 * 后序遍历：先清文件（覆写三步），再混淆删除子目录，最后混淆删除 root。
 */
export function wipeDirectoryContents(
  rootDir: string,
  opts: CleanupOptions,
  report: {
    skipped: SkippedItem[];
    obfuscations: DirObfuscation[];
    wipedFiles: number;
    removedDirs: number;
    overwrittenBytes: number;
  },
): void {
  const entries = readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      wipeDirectoryContents(full, opts, report);
      // 目录内容已清——混淆目录名后删除
      const obf = obfuscatedDirName();
      const target = join(dirname(full), obf);
      try {
        renameSync(full, target);
        rmSync(target, { recursive: true, force: true });
        report.obfuscations.push({ originalPath: full, obfuscatedName: obf });
        report.removedDirs += 1;
      } catch (e) {
        report.skipped.push({
          path: full,
          reason: e instanceof Error ? e.message : String(e),
          stage: 'rename',
        });
      }
    } else if (entry.isFile()) {
      try {
        const { overwrittenBytes } = wipeFile(full, opts);
        report.wipedFiles += 1;
        report.overwrittenBytes += overwrittenBytes;
      } catch (e) {
        report.skipped.push({
          path: full,
          reason: e instanceof Error ? e.message : String(e),
          stage: stageOf(e),
        });
      }
    } else {
      // 符号链接等特殊文件：不覆写（不追内容——防越界），直接 unlink
      try {
        unlinkSync(full);
      } catch (e) {
        report.skipped.push({
          path: full,
          reason: `特殊文件 unlink 失败: ${e instanceof Error ? e.message : String(e)}`,
          stage: 'unlink',
        });
      }
    }
  }
}

// ══════════════════════════════════════
// 主入口：train cleanup <enterpriseId>
// ══════════════════════════════════════

/**
 * 清理企业全部训练数据（数据主权三步：覆写 → 混淆 → 删除）。
 *
 * 只清 data/train/<enterpriseId>/ 分区：
 *   - enterpriseId 过段校验（`..`/分隔符/NUL 直接拒——EnterpriseAccessDeniedError）
 *   - 解析后 containment 兜底（必须在 data/train/ 内）
 *
 * @param dataDir 数据根目录（与 train-job.ts 同一 dataDir）
 * @param enterpriseId 企业标识（路径段——先校验后使用）
 * @returns CleanupReport（skipped 非空 = 有失败项，如实报告不静默）
 * @throws EnterpriseAccessDeniedError 路径段非法 / 分区越界（调用前置校验失败）
 */
export function cleanupEnterpriseTrainData(
  dataDir: string,
  enterpriseId: string,
  opts: CleanupOptions = {},
): CleanupReport {
  assertSafePathSegment(enterpriseId, 'enterpriseId');

  const trainRoot = resolve(dataDir, 'train');
  const enterpriseDir = resolve(trainRoot, enterpriseId);
  if (!isPathInside(enterpriseDir, trainRoot)) {
    // 纵深防御（段校验已封死正常路径——此为兜底）
    throw new EnterpriseAccessDeniedError({
      code: 'UNSAFE_PATH_SEGMENT',
      message: '路径段非法：enterpriseId 含逃逸构造（../、分隔符或空字节），已拒绝',
      resourceRef: `enterpriseId（解析后越出 data/train/）`,
      requestingEnterpriseId: '',
    });
  }

  const startedAt = new Date().toISOString();
  const report = {
    skipped: [] as SkippedItem[],
    obfuscations: [] as DirObfuscation[],
    wipedFiles: 0,
    removedDirs: 0,
    overwrittenBytes: 0,
  };

  let enterpriseDirRemoved = false;
  let enterpriseDirExisted = false;
  if (existsSync(enterpriseDir)) {
    enterpriseDirExisted = true;
    wipeDirectoryContents(enterpriseDir, opts, report);
    // 企业分区根自身：混淆后删除（目录名抹除）
    const obf = obfuscatedDirName();
    try {
      renameSync(enterpriseDir, join(trainRoot, obf));
      rmSync(join(trainRoot, obf), { recursive: true, force: true });
      enterpriseDirRemoved = true;
    } catch (e) {
      report.skipped.push({
        path: enterpriseDir,
        reason: `企业分区根删除失败: ${e instanceof Error ? e.message : String(e)}`,
        stage: 'rename',
      });
    }
  }

  return {
    enterpriseDir,
    wipedFiles: report.wipedFiles,
    removedDirs: report.removedDirs,
    overwrittenBytes: report.overwrittenBytes,
    skipped: report.skipped,
    obfuscations: report.obfuscations,
    enterpriseDirRemoved,
    startedAt,
    finishedAt: new Date().toISOString(),
    // 分区从未存在 = 目标态天然达成（无可清之物），也算 fullyCleaned
    fullyCleaned: report.skipped.length === 0 && (!enterpriseDirExisted || enterpriseDirRemoved),
  };
}
