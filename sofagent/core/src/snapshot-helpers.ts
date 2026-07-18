// ============================================================
// snapshot-helpers.ts · 快照辅助函数（人类可读封装）
// v1.1.4 从 @sofagent/daemon 迁移至 @sofagent/core
//
// 这三个函数是对 isomorphic-git.ts 底层原语的人类可读封装。
// 迁移目的：消除 audit↔daemon optional 循环依赖。
// daemon 保留 re-export，向后兼容。
// ============================================================

import {
  commitSnapshot,
  revertToSnapshot,
  listSnapshots,
  createShadowRepo,
  hasShadowRepo,
} from './filesystem/isomorphic-git';
import type { SnapshotEntry } from './filesystem/isomorphic-git';

/** 快照条目（人类可读） */
export interface SnapshotInfo {
  sha: string;
  shortSha: string;
  timestamp: string;
  fileCount: number;
}

/**
 * 审计通过后自动创建快照
 *
 * @param projectDir 项目根目录
 * @returns 新快照的 SHA，或 null（无变更）
 */
export function createPostAuditSnapshot(projectDir: string): string | null {
  try {
    if (!hasShadowRepo(projectDir)) {
      createShadowRepo(projectDir);
    }

    const sha = commitSnapshot(projectDir);
    console.log(`[snapshot] 快照已创建: ${sha.slice(0, 8)} (${new Date().toISOString()})`);
    return sha;
  } catch (err) {
    console.error('[snapshot] 快照创建失败:', (err as Error).message);
    return null;
  }
}

/**
 * 列出所有快照（人类可读格式）
 *
 * @param projectDir 项目根目录
 * @returns SnapshotInfo 数组
 */
export function listAllSnapshots(projectDir: string): SnapshotInfo[] {
  if (!hasShadowRepo(projectDir)) {
    return [];
  }

  try {
    const snapshots = listSnapshots(projectDir);
    return snapshots.map((s: SnapshotEntry) => ({
      sha: s.sha,
      shortSha: s.sha.slice(0, 8),
      timestamp: s.timestamp,
      fileCount: Object.keys(s.files).length,
    }));
  } catch (err) {
    console.error('[snapshot] 列出快照失败:', (err as Error).message);
    return [];
  }
}

/**
 * 恢复到指定快照
 *
 * 需要显式确认——CLI 端会先提示用户确认后再调用。
 * 恢复后建议运行 build + test 验证。
 *
 * @param projectDir 项目根目录
 * @param sha 快照 SHA（完整或短 SHA 前缀）
 * @returns 恢复的文件路径列表
 */
export function restoreSnapshot(projectDir: string, sha: string): string[] {
  if (!hasShadowRepo(projectDir)) {
    throw new Error('没有可用的快照。请先运行审计以创建快照。');
  }

  const snapshots = listSnapshots(projectDir);
  let fullSha = sha;

  if (sha.length < 40) {
    const matching = snapshots.filter((s: SnapshotEntry) => s.sha.startsWith(sha));
    if (matching.length === 0) {
      throw new Error(`未找到匹配的快照: ${sha}`);
    }
    if (matching.length > 1) {
      throw new Error(
        `多个快照匹配 "${sha}": ${matching.map((m: SnapshotEntry) => m.sha.slice(0, 8)).join(', ')}。请使用完整 SHA。`
      );
    }
    fullSha = matching[0]!.sha;
  }

  const restored = revertToSnapshot(projectDir, fullSha);
  console.log(`[snapshot] 已恢复到快照 ${fullSha.slice(0, 8)}，恢复了 ${restored.length} 个文件`);
  return restored;
}
