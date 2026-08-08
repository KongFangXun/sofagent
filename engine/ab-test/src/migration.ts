// ============================================================
// migration.ts · ab-history 路径迁移逻辑
// v1.2.9 新增
//
// 旧路径：data/ab-history.jsonl
// 新路径：data/ab-test/scheduler-history.jsonl
//
// 自动迁移策略：
//   1. 新路径已存在 → 直接返回新路径（不迁移）
//   2. 旧路径存在 → mkdirSync 新目录 → rename 到新路径
//   3. 都不存在 → 返回新路径（首次运行场景）
// ============================================================

import { existsSync, mkdirSync, renameSync } from 'fs';
import { dirname, join } from 'path';
import { loadEnvConfig } from '@sofagent/core';

/**
 * 迁移 ab-history 文件
 *
 * @param oldPath 旧路径（data/ab-history.jsonl）
 * @param newPath 新路径（data/ab-test/scheduler-history.jsonl）
 * @returns 迁移成功返回 true，无需迁移返回 false
 */
export function migrateAbHistory(oldPath: string, newPath: string): boolean {
  // 新路径已存在 → 不迁移
  if (existsSync(newPath)) {
    return false;
  }

  // 旧路径不存在 → 不迁移（首次运行场景）
  if (!existsSync(oldPath)) {
    return false;
  }

  // 确保目标目录存在
  const targetDir = dirname(newPath);
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  // 执行迁移
  renameSync(oldPath, newPath);
  return true;
}

/**
 * 解析 ab-history 路径（新路径优先，旧路径 fallback 迁移）
 *
 * 路径基于 loadEnvConfig().dataDir 动态解析，确保测试隔离生效。
 *
 * @returns ab-history 的最终路径
 */
export function resolveAbHistoryPath(): string {
  const dataDir = loadEnvConfig().dataDir;
  const newPath = join(dataDir, 'ab-test', 'scheduler-history.jsonl');
  const oldPath = join(dataDir, 'ab-history.jsonl');

  // 尝试迁移
  migrateAbHistory(oldPath, newPath);

  return newPath;
}
