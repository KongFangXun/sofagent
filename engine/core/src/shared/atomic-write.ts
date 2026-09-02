// ============================================================
// shared/atomic-write.ts · 原子文件写入工具
// v1.3.7 新增：gstack 工程学习——原子写入防并发冲突
// v1.4.4 atomicAppendSync 加文件锁互斥（O_EXCL 锁文件 + 过期回收），
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
// 文件锁（O_EXCL 互斥 + 过期回收）
// ────────────────────────────────────────────────────────────

/**
 * 锁文件过期阈值（30s）。
 * 「慢写进程保护」权衡：本锁用于 >1MB 文件读改写，慢磁盘下写可能超 10s；
 * 10s 阈值会把仍持锁的慢写进程误判为死锁并回收，锁互斥失效。
 * 放宽至 30s——正常写不会触发回收，真死锁最多晚 20s 被回收（可接受）。
 */
const LOCK_STALE_MS = 30_000;
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
 * 带文件锁的互斥执行：
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
        // 锁内容：`${pid} ${acquiredAt} ${startedAt}`。
        // v1.4.3 追加 startedAt（写开始时间戳）字段：当前获取即写、两值相等，
        // 字段先落位，供后续区分「慢写」（进程存活且 startedAt 距今未超写耗时上限）与「死锁残留」。
        writeFileSync(lock, `${process.pid} ${Date.now()} ${Date.now()}\n`, 'utf-8');
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
 * 整个读-改-写在 withFileLockSync 互斥下执行（O_EXCL 锁文件），
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

/**
 * 合并策略：保留 existing 中未在 incoming 出现的行（追加到末尾）。
 * 用于进化链路写保护——其他进程在读取后追加了新行（如新的反思条目），
 * 写入时保留这些并发新增，不盲目覆盖。
 *
 * ⚠️ 方向说明：参数顺序为 merge(existing, incoming)——existing 是磁盘当前内容
 * （可能含并发新增），incoming 是本进程要写入的内容。返回 = incoming +
 * existing 中不在 incoming 的行（并发新增保留）。
 */
export function mergeAppendMissing(existing: string, incoming: string): string {
  if (!existing) return incoming;
  if (!incoming) return existing;
  if (existing === incoming) return incoming;
  const incomingLines = new Set(incoming.split('\n'));
  const extra = existing.split('\n').filter((l) => !incomingLines.has(l));
  return extra.length > 0 ? incoming + '\n' + extra.join('\n') : incoming;
}

/**
 * 写前 mtime 检测 + 合并原子写（v1.3.0 交付 11 · prime-agent _sync_from_disk 启发）。
 *
 * 解决进化链路（think.md / knowledge/ / 状态文件）的 read-modify-write 并发覆盖：
 *   1. 读现有内容 + 记录写前 mtime
 *   2. 若读取后 mtime 已变化（其他进程在读取与写入之间改写了文件）→ 重读最新内容再合并
 *   3. 合并后经 withFileLockSync + atomicWriteSync 落盘（不盲目覆盖并发写入）
 *
 * @param filePath 目标文件路径
 * @param content  本次要写入的内容（与 existing 合并）
 * @param merge    合并策略（缺省 = 用 content 覆盖，仅做 mtime 检测告警）
 */
export function atomicWriteWithMergeSync(
  filePath: string,
  content: string,
  merge: (existing: string, incoming: string) => string = (_existing, incoming) => incoming,
): void {
  withFileLockSync(filePath, () => {
    const existedBefore = existsSync(filePath);
    const mtimeBefore = existedBefore ? statSync(filePath).mtimeMs : null;
    let existing = existedBefore ? readFileSync(filePath, 'utf-8') : '';

    // 写前 mtime 检测：读取后若 mtime 变化 → 其他进程并发改写，重读最新内容合并
    if (existedBefore && mtimeBefore !== null) {
      const mtimeAfterRead = statSync(filePath).mtimeMs;
      if (mtimeAfterRead !== mtimeBefore) {
        console.warn(`[atomic-write] ${filePath} 写前 mtime 变化——重读最新内容合并，避免覆盖并发写入`);
        existing = readFileSync(filePath, 'utf-8');
      }
    }

    atomicWriteSync(filePath, merge(existing, content));
  });
}
