// ============================================================
// shared/atomic-write.ts · 原子文件写入工具
// v1.0.5 新增：gstack 工程学习——原子写入防并发冲突
// ============================================================
//
// 原子写入：先写临时文件，再 rename 覆盖目标。
// rename 在同文件系统上是原子操作，避免了并发写导致的脏读/交错问题。
//
// 参考：gstack 的 tmpStatePath() 模式——
// ${stateFile}.tmp.${pid}.${randomBytes(4).toString('hex')} 防并发冲突。
// ============================================================

import { writeFileSync, renameSync, existsSync, readFileSync, copyFileSync, unlinkSync } from 'fs';
import { randomBytes } from 'crypto';

/**
 * 生成临时文件路径——基于 gstack 的 tmpStatePath 模式
 * 包含 PID + 随机 hex，防止多进程并发冲突
 */
function tmpPath(filePath: string): string {
  return `${filePath}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`;
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
 * 原子追加——读入现有内容 + 追加行 + 原子写。
 * 适用于小文件（< 1MB）的追加场景。
 * 如果文件较大，退化为普通 append（风险已记录在注释中）。
 *
 * @param filePath 目标文件路径
 * @param line     要追加的行（自动加换行符）
 */
export function atomicAppendSync(filePath: string, line: string): void {
  const MAX_ATOMIC_SIZE = 1 * 1024 * 1024; // 1MB 阈值

  // 如果文件不存在或很小，用全量读入 + 原子写
  let existing: string;
  if (existsSync(filePath)) {
    const stat = require('fs').statSync(filePath);
    if (stat.size > MAX_ATOMIC_SIZE) {
      // 大文件退化为普通追加（风险：多进程并发可能交错）
      // TODO: v1.x 加 file lock 或改为单 writer 模式
      const { appendFileSync } = require('fs');
      appendFileSync(filePath, line + '\n', 'utf-8');
      return;
    }
    existing = readFileSync(filePath, 'utf-8');
  } else {
    existing = '';
  }

  const tmp = tmpPath(filePath);
  writeFileSync(tmp, existing + line + '\n', 'utf-8');
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
