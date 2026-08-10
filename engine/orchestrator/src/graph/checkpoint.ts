// ============================================================
// graph/checkpoint.ts · StateGraph Checkpoint 文件持久化
// v1.3.1 新增：每个节点执行前后 snapshot 状态到 .sofagent/checkpoint/
//
// 并发安全设计（五条全做）：
// 1. 文件名 = checkpoint-{ISO时间戳}-{6位随机}.json，永不覆盖
//    （时间戳中的 : 和 . 替换为 -，保证 Windows 文件名兼容；
//     原始 ISO 时间戳完整保留在 JSON 的 savedAt 字段中）
// 2. checkpoint/ 下维护 latest 符号链接指向最新一次完整 checkpoint，
//    orchestrator/daemon 统一通过 latest 访问
//    （文件系统不支持 symlink 时降级为指针文件，读取端两种都兼容）
// 3. checkpoint JSON 第一字段 schemaVersion: 'v1'，未来 schema 变化
//    走 migrateCheckpoint() 显式迁移，不静默丢失
// 4. 文件写入走 writeFileSync(tmp) + renameSync(tmp, final) 原子模式
//    （沿用 launcher.ts 现有范式，EXDEV 时降级 copy+unlink）
// 5. 多进程场景：单 checkpointId 只能被一个进程写——写前抢
//    locks/{checkpointId}.lock（O_EXCL 排它创建），抢不到 wait + retry，
//    不强行并发写；锁超过 LOCK_STALE_MS 视为残留锁清理后重试
// ============================================================

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  copyFileSync,
  unlinkSync,
  readdirSync,
  symlinkSync,
  lstatSync,
  readlinkSync,
  statSync,
  rmSync,
} from 'fs';
import { join, dirname } from 'path';
import { randomBytes } from 'crypto';

/** checkpoint 中保存的最小状态接口——与 CheckpointState 兼容 */
export interface CheckpointState {
  finalStatus: string;
  checkpointId: string;
  retryCount: number;
  currentNode: string;
  auditResult: string | null;
  resumeFrom: string | null;
  artifacts: Record<string, unknown>;
  [key: string]: unknown;
}

/** checkpoint schema 版本——schema 变化时递增并在 migrateCheckpoint 中显式迁移 */
export const CHECKPOINT_SCHEMA_VERSION = 'v1';

/** 锁文件视为残留（stale）的毫秒数——持锁进程崩溃后其他进程可回收 */
const LOCK_STALE_MS = 30_000;

/** 抢锁重试间隔（毫秒） */
const LOCK_RETRY_INTERVAL_MS = 200;

/** 抢锁最大重试次数（200ms × 50 = 最长等待 10s） */
const LOCK_MAX_RETRIES = 50;

/**
 * Checkpoint 落盘结构。
 * 注意：schemaVersion 必须是 JSON 序列化后的第一字段。
 */
export interface CheckpointRecord {
  /** schema 版本（第一字段） */
  schemaVersion: string;
  /** checkpoint 标识（一次 LOOP 运行一个） */
  checkpointId: string;
  /** 快照阶段：before=节点执行前 / after=节点执行后 */
  phase: 'before' | 'after';
  /** 快照时的节点名 */
  node: string;
  /** 原始 ISO 时间戳 */
  savedAt: string;
  /** StateGraph 完整状态 */
  state: CheckpointState;
}

/** 同步 sleep——锁等待用（checkpoint 写入是同步链路，无 event loop 可让出） */
function sleepSync(ms: number): void {
  const sab = new SharedArrayBuffer(4);
  const arr = new Int32Array(sab);
  Atomics.wait(arr, 0, 0, ms);
}

/**
 * 原子写入——先写临时文件，再 rename 覆盖目标（launcher.ts 同款范式）。
 */
function atomicWriteSync(filePath: string, content: string): void {
  const tmp = `${filePath}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`;
  writeFileSync(tmp, content, 'utf-8');
  try {
    renameSync(tmp, filePath);
  } catch (err: any) {
    if (err.code === 'EXDEV') {
      copyFileSync(tmp, filePath);
      unlinkSync(tmp);
    } else {
      throw err;
    }
  }
}

/**
 * 文件 Checkpointer——本地文件存储，与 daemon 共享 .sofagent/checkpoint/ 路径。
 */
export class FileCheckpointer {
  /** checkpoint 根目录（如 .sofagent/checkpoint） */
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  /** 生成一个新的 checkpointId：loop-{ISO时间戳文件名安全变体}-{6位随机} */
  static newCheckpointId(): string {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    return `loop-${ts}-${randomBytes(3).toString('hex')}`;
  }

  /** locks 子目录 */
  private get lockDir(): string {
    return join(this.dir, 'locks');
  }

  /** latest 符号链接路径 */
  private get latestPath(): string {
    return join(this.dir, 'latest');
  }

  private ensureDirs(): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    if (!existsSync(this.lockDir)) mkdirSync(this.lockDir, { recursive: true });
  }

  // ────────────────────────────────
  // 锁（并发安全第 5 条）
  // ────────────────────────────────

  private lockPath(checkpointId: string): string {
    // checkpointId 只含 [a-zA-Z0-9-]，直接拼文件名安全
    return join(this.lockDir, `${checkpointId}.lock`);
  }

  /**
   * 抢占 checkpointId 写锁。
   * O_EXCL 排它创建锁文件；已被占用时 wait + retry；
   * 锁文件 mtime 超过 LOCK_STALE_MS 视为持锁进程已死，清理后重试。
   *
   * @throws 重试耗尽仍未拿到锁
   */
  acquireLock(checkpointId: string): void {
    this.ensureDirs();
    const lock = this.lockPath(checkpointId);

    for (let attempt = 0; attempt <= LOCK_MAX_RETRIES; attempt++) {
      try {
        // flag 'wx'：文件已存在则抛 EEXIST——排它创建，天然原子
        writeFileSync(lock, String(process.pid), { flag: 'wx' });
        return;
      } catch (err: any) {
        if (err.code !== 'EEXIST') throw err;

        // 残留锁检测：mtime 超过阈值视为持锁进程已死
        try {
          const age = Date.now() - statSync(lock).mtimeMs;
          if (age > LOCK_STALE_MS) {
            rmSync(lock, { force: true });
            continue; // 立即重试抢占
          }
        } catch {
          // 锁文件刚被释放（statSync ENOENT）——立即重试
          continue;
        }

        if (attempt === LOCK_MAX_RETRIES) {
          throw new Error(
            `checkpoint 锁等待超时：${checkpointId} 正被其他进程写入（${lock}）`
          );
        }
        sleepSync(LOCK_RETRY_INTERVAL_MS);
      }
    }
  }

  /** 释放 checkpointId 写锁 */
  releaseLock(checkpointId: string): void {
    try {
      rmSync(this.lockPath(checkpointId), { force: true });
    } catch {
      // 释放失败不影响主流程——残留锁会被 stale 检测回收
    }
  }

  // ────────────────────────────────
  // 保存 / 读取
  // ────────────────────────────────

  /**
   * 保存一次 checkpoint 快照。
   *
   * - 文件名永不覆盖（并发安全第 1 条）
   * - 写入前抢 checkpointId 锁（第 5 条），写完更新 latest（第 2 条）
   * - schemaVersion 为 JSON 第一字段（第 3 条），原子写（第 4 条）
   *
   * @returns 落盘的 checkpoint 文件绝对路径
   */
  save(state: CheckpointState, node: string, phase: 'before' | 'after'): string {
    this.ensureDirs();

    const savedAt = new Date().toISOString();
    const fileTs = savedAt.replace(/[:.]/g, '-');
    const fileName = `checkpoint-${fileTs}-${randomBytes(3).toString('hex')}.json`;
    const filePath = join(this.dir, fileName);

    const record: CheckpointRecord = {
      schemaVersion: CHECKPOINT_SCHEMA_VERSION,
      checkpointId: state.checkpointId,
      phase,
      node,
      savedAt,
      state,
    };

    this.acquireLock(state.checkpointId);
    try {
      atomicWriteSync(filePath, JSON.stringify(record, null, 2));
      this.updateLatest(fileName);
    } finally {
      this.releaseLock(state.checkpointId);
    }

    return filePath;
  }

  /**
   * 更新 latest 符号链接（相对路径指向同目录文件，目录整体迁移仍有效）。
   * symlink 不可用（如 Windows 无权限）时降级为指针文件——
   * 内容为目标文件名，load 端两种形态都兼容。
   */
  private updateLatest(targetFileName: string): void {
    const latest = this.latestPath;
    const tmpLink = `${latest}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`;
    try {
      symlinkSync(targetFileName, tmpLink);
      renameSync(tmpLink, latest); // rename 原子替换旧符号链接
    } catch {
      try { rmSync(tmpLink, { force: true }); } catch { /* 清理临时链接失败可忽略 */ }
      // 降级：指针文件（原子写），内容 = 目标文件名
      atomicWriteSync(latest, targetFileName);
    }
  }

  /** 解析 latest 指向的 checkpoint 文件路径；不存在返回 null */
  resolveLatestPath(): string | null {
    const latest = this.latestPath;
    try {
      const st = lstatSync(latest);
      const target = st.isSymbolicLink()
        ? readlinkSync(latest)
        : readFileSync(latest, 'utf-8').trim();
      const resolved = join(this.dir, target);
      return existsSync(resolved) ? resolved : null;
    } catch {
      return null;
    }
  }

  /** 读取最近一次 checkpoint；无 checkpoint 或损坏时返回 null */
  loadLatest(): CheckpointRecord | null {
    const path = this.resolveLatestPath();
    if (!path) return null;
    return this.loadFile(path);
  }

  /** 读取指定 checkpoint 文件 */
  loadFile(filePath: string): CheckpointRecord | null {
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
      return migrateCheckpoint(parsed);
    } catch {
      return null;
    }
  }

  /** 列出目录下全部 checkpoint 文件名（按名称升序 = 按时间升序） */
  list(): string[] {
    if (!existsSync(this.dir)) return [];
    try {
      return readdirSync(this.dir)
        .filter((f) => f.startsWith('checkpoint-') && f.endsWith('.json'))
        .sort();
    } catch {
      return [];
    }
  }
}

/**
 * checkpoint schema 显式迁移（并发安全第 3 条的配套约束）。
 *
 * - v1：当前版本，原样返回
 * - 未知版本：返回 null（显式拒绝，不静默丢字段）——调用方决定如何提示
 */
export function migrateCheckpoint(raw: unknown): CheckpointRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  if (obj.schemaVersion === 'v1') {
    if (typeof obj.checkpointId !== 'string' || !obj.state || typeof obj.state !== 'object') {
      return null;
    }
    return obj as unknown as CheckpointRecord;
  }

  // 未来版本在此处添加 v1 → v2 的显式迁移分支
  return null;
}
