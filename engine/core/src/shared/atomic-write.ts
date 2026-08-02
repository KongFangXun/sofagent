// ============================================================
// shared/atomic-write.ts · 原子文件写入工具
// v1.2.0 新增：gstack 工程学习——原子写入防并发冲突
// v1.2.5 P1-2: atomicAppendSync 加文件锁互斥（O_EXCL 锁文件 + 过期回收），
//   消除 read-modify-write 非原子的并发丢数据；>1MB 不再退化为无保护 append。
// ============================================================
//
// 原子写入：先写临时文件，再 rename 覆盖目标。
// rename 在同文件系统上是原子操作，避免了并发写导致的脏读/交错问题。
//
// 参考：gstack 的 tmpStatePath() 模式——
// ${stateFile}.tmp.${pid}.${randomBytes(4).toString('hex')} 防并发冲突。
// ============================================================

import { writeFileSync, renameSync, existsSync, readFileSync, copyFileSync, unlinkSync, openSync, closeSync, statSync } from 'fs';
import { randomBytes } from 'crypto';

/**
 * 生成临时文件路径——基于 gstack 的 tmpStatePath 模式
 * 包含 PID + 随机 hex，防止多进程并发冲突
 */
function tmpPath(filePath: string): string {
  return `${filePath}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`;
}

// ────────────────────────────────────────────────────────────
// P1-2: 文件锁（O_EXCL 互斥 + 过期回收）
// ────────────────────────────────────────────────────────────

/** 锁文件过期阈值（10s——正常读改写远快于此，超时视为死锁残留回收） */
const LOCK_STALE_MS = 10_000;
/** 锁获取重试间隔（非 CPU 自旋，Atomics.wait 真休眠） */
const LOCK_RETRY_MS = 20;
/** 锁获取超时（5s——超过抛错，避免永久阻塞） */
const LOCK_TIMEOUT_MS = 5_000;

/** 同步休眠（Atomics.wait 真休眠；主线程不可用则退化极短微休眠） */
function sleepSync(ms: number): void {
  try {
    const sab = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(sab, 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) { /* 退化路径（主线程 Atomics.wait 抛错），仅 20ms 内 */ }
  }
}

function lockPathOf(filePath: string): string {
  return `${filePath}.lock`;
}

/**
 * 带文件锁的互斥执行（P1-2）：
 * 通过 O_EXCL 创建锁文件实现同机跨进程互斥；锁文件带 PID/时间戳，
 * 超过 LOCK_STALE_MS 视为死锁残留自动回收（防崩溃遗留永久卡死）。
 * 用于 atomicAppendSync 的读-改-写，杜绝并发丢数据。
 */
export function withFileLockSync<T>(filePath: string, fn: () => T): T {
  const lock = lockPathOf(filePath);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      const fd = openSync(lock, 'wx', 0o600);
      try {
        writeFileSync(lock, `${process.pid} ${Date.now()}\n`, 'utf-8');
      } finally {
        closeSync(fd);
      }
      break; // 拿到锁
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw err;
      // 锁已存在——检查是否过期（死锁残留）
      try {
        const st = statSync(lock);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          unlinkSync(lock);
          continue; // 回收后重试
        }
      } catch {
        // 锁文件刚被释放（stat 失败），重试
      }
      if (Date.now() > deadline) {
        throw new Error(`[sofagent] 获取文件锁超时（${lock}）——可能存在死锁，请检查`);
      }
      sleepSync(LOCK_RETRY_MS);
    }
  }
  try {
    return fn();
  } finally {
    try { unlinkSync(lock); } catch { /* 锁已被清理则忽略 */ }
  }
}

/**
 * 原子写入——先写临时文件，再 rename 覆盖目标。
 * rename 在同文件系统上是原子操作，避免了并发写导致的脏读/交错问题。
 *
 * @param filePath 目标文件路径
 * @param content  要写入的内容
 */
export function atomicWriteSync(filePath: string, content: string): void {
  const tmp = tmpPath(filePath);
  writeFileSync(tmp, content, 'utf-8');
  try {
    renameSync(tmp, filePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EXDEV') {
      copyFileSync(tmp, filePath);
      unlinkSync(tmp);
    } else {
      throw err;
    }
  }
}

/**
 * 原子追加——读入现有内容 + 追加行 + 原子写。
 * P1-2: 整个读-改-写在 withFileLockSync 互斥下执行（O_EXCL 锁文件），
 *   多进程并发不再丢数据；>1MB 大文件同样加锁读改写（不再退化为无保护 append）。
 *
 * @param filePath 目标文件路径
 * @param line     要追加的行（自动加换行符）
 */
export function atomicAppendSync(filePath: string, line: string): void {
  withFileLockSync(filePath, () => {
    let existing: string;
    if (existsSync(filePath)) {
      existing = readFileSync(filePath, 'utf-8');
    } else {
      existing = '';
    }

    const tmp = tmpPath(filePath);
    writeFileSync(tmp, existing + line + '\n', 'utf-8');
    try {
      renameSync(tmp, filePath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EXDEV') {
        copyFileSync(tmp, filePath);
        unlinkSync(tmp);
      } else {
        throw err;
      }
    }
  });
}
