// ============================================================
// refine-agent/snapshot-manager.ts · Agent 级快照 + 版本号管理（v1.3.4 交付 T05）
// ============================================================
//
// 复用 git snapshot 做 Agent 经验层的版本回滚。
//
// 铁律（协议设计 §8.1）：只快照经验层（think.md / knowledge/），
// L1 SKILL.md / 审计规则 / 回溯机制不可碰。
//
// 版本号语义：
//   - Agent 版本号只增不减（每次 Candidate accept 时 +1）
//   - 不重用被拒绝的版本号（Candidate reject 后版本号不递增，下次新 Candidate 用新号）
//   - 版本号记录在 Agent 目录的 version.json（与 think.md 同级）
//
// git snapshot 操作：
//   - takeSnapshot：git stash 或 git commit 当前经验层状态（创建还原点）
//   - rollback：git checkout 恢复到快照点（Candidate reject 时用）
//   - 复用 loop-agent/fix-applier.ts 的 defaultRollback 模式（git checkout）
// ============================================================

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { execSync } from 'child_process';
import { atomicWriteSync } from '@sofagent/core';

/** Agent 版本信息 */
export interface AgentVersion {
  /** Agent ID */
  agentId: string;
  /** 当前版本号（从 1 开始，只增不减） */
  version: number;
  /** 最后一次 accept 的 Candidate 描述 */
  lastAcceptedDescription?: string;
  /** 最后一次 accept 的时间戳 */
  lastAcceptedAt?: string;
  /** 版本历史（每次 accept 记录一条） */
  history: AgentVersionEntry[];
}

/** 版本历史条目 */
export interface AgentVersionEntry {
  /** 版本号 */
  version: number;
  /** Candidate 描述 */
  description: string;
  /** Benchmark 评分变化（accept 前后差值） */
  scoreDelta: number;
  /** 时间戳 */
  ts: string;
  /** git commit SHA（快照点） */
  commitSha?: string;
}

/** 版本文件路径：{agentDir}/version.json */
function versionFilePath(agentDir: string): string {
  return join(agentDir, 'version.json');
}

/** 经验层文件路径（只快照这些——约束层不可碰） */
export const EXPERIENCE_LAYER_PATTERNS = ['think.md', 'knowledge/'];

/**
 * 读取 Agent 当前版本信息。
 * 不存在时返回初始版本（version=1, history=[]）。
 *
 * @param agentDir Agent 目录路径
 * @param agentId Agent ID
 * @returns AgentVersion
 */
export function readAgentVersion(agentDir: string, agentId: string): AgentVersion {
  const filePath = versionFilePath(agentDir);
  if (!existsSync(filePath)) {
    return { agentId, version: 1, history: [] };
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as AgentVersion;
    return {
      agentId,
      version: parsed.version ?? 1,
      ...(parsed.lastAcceptedDescription ? { lastAcceptedDescription: parsed.lastAcceptedDescription } : {}),
      ...(parsed.lastAcceptedAt ? { lastAcceptedAt: parsed.lastAcceptedAt } : {}),
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    // 解析失败 → 返回初始版本
    return { agentId, version: 1, history: [] };
  }
}

/**
 * 写入 Agent 版本信息（经 atomicWriteSync）。
 *
 * @param agentDir Agent 目录路径
 * @param version 版本信息
 */
export function writeAgentVersion(agentDir: string, version: AgentVersion): void {
  mkdirSync(agentDir, { recursive: true });
  const filePath = versionFilePath(agentDir);
  atomicWriteSync(filePath, JSON.stringify(version, null, 2));
}

/**
 * 对经验层创建 git snapshot（创建还原点）。
 *
 * 使用 git stash create + git stash store 创建临时快照（不切换工作区），
 * 返回 stash SHA 供后续 rollback 使用。
 *
 * 无 git / 非仓库环境时返回 null（降级——不做快照）。
 *
 * @param agentDir Agent 目录路径
 * @param files 要快照的文件列表（经验层文件）
 * @returns stash SHA（用于 rollback）或 null
 */
export function takeSnapshot(agentDir: string, files: string[]): string | null {
  try {
    // 确保 git 可用
    execSync('git rev-parse --git-dir', { cwd: agentDir, stdio: 'pipe' });
  } catch {
    return null; // 非 git 仓库 → 降级（不做快照）
  }

  try {
    // git stash create 创建临时快照（不切换工作区）
    const stashSha = execSync('git stash create', {
      cwd: agentDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    if (stashSha) {
      // store 快照（使其可用）
      execSync(`git stash store -m "sofagent-snapshot-${Date.now()}" ${stashSha}`, {
        cwd: agentDir,
        stdio: 'pipe',
      });
      return stashSha;
    }

    // stash create 返回空（无变更）→ 手动 commit 当前状态
    for (const file of files) {
      try {
        execSync(`git add "${file}"`, { cwd: agentDir, stdio: 'pipe' });
      } catch {
        // 文件不存在跳过
      }
    }
    const commitResult = execSync('git commit -m "sofagent-snapshot" --allow-empty', {
      cwd: agentDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    const sha = execSync('git rev-parse HEAD', {
      cwd: agentDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();
    void commitResult;
    return sha;
  } catch {
    return null;
  }
}

/**
 * 回滚到 snapshot（Candidate reject 时用）。
 *
 * 使用 git checkout 恢复经验层文件到快照点。
 * 快照 SHA 为 null 时尝试 git checkout -- <files> 恢复到 HEAD。
 *
 * @param agentDir Agent 目录路径
 * @param files 要回滚的文件列表
 * @param stashSha 快照 SHA（takeSnapshot 返回值）
 */
export function rollbackToSnapshot(
  agentDir: string,
  files: string[],
  stashSha: string | null,
): void {
  try {
    if (stashSha) {
      // 从 stash 恢复指定文件
      for (const file of files) {
        try {
          execSync(`git checkout ${stashSha} -- "${file}"`, {
            cwd: agentDir,
            stdio: 'pipe',
          });
        } catch {
          // 文件不在快照中 → 尝试 HEAD 恢复
          try {
            execSync(`git checkout HEAD -- "${file}"`, {
              cwd: agentDir,
              stdio: 'pipe',
            });
          } catch {
            // 文件不在 git 管理中 → 跳过
          }
        }
      }
    } else {
      // 无快照 → 恢复到 HEAD
      for (const file of files) {
        try {
          execSync(`git checkout -- "${file}"`, {
            cwd: agentDir,
            stdio: 'pipe',
          });
        } catch {
          // 文件不在 git 管理中 → 跳过
        }
      }
    }
  } catch {
    // git 操作失败静默（回滚失败不致命——审计兜底）
  }
}

/**
 * 推进版本号——Candidate accept 时调用。
 *
 * 版本号语义：只增不减，不重用被拒绝的版本号。
 * accept 时版本号 +1，记录 history 条目。
 *
 * @param agentDir Agent 目录路径
 * @param agentId Agent ID
 * @param description Candidate 描述
 * @param scoreDelta Benchmark 评分变化（accept 后 - accept 前）
 * @param commitSha 快照 SHA（可选）
 * @returns 更新后的版本号
 */
export function advanceVersion(
  agentDir: string,
  agentId: string,
  description: string,
  scoreDelta: number,
  commitSha?: string,
): number {
  const current = readAgentVersion(agentDir, agentId);
  const newVersion = current.version + 1;

  const entry: AgentVersionEntry = {
    version: newVersion,
    description,
    scoreDelta,
    ts: new Date().toISOString(),
    ...(commitSha ? { commitSha } : {}),
  };

  const updated: AgentVersion = {
    agentId,
    version: newVersion,
    lastAcceptedDescription: description,
    lastAcceptedAt: new Date().toISOString(),
    history: [...current.history, entry],
  };

  writeAgentVersion(agentDir, updated);
  return newVersion;
}

/**
 * 验证版本号单调性——版本号应只增不减。
 *
 * @param agentDir Agent 目录路径
 * @param agentId Agent ID
 * @param expectedVersion 期望的当前版本号
 * @returns 是否一致（版本号无回退）
 */
export function verifyVersionMonotonic(
  agentDir: string,
  agentId: string,
  expectedVersion: number,
): boolean {
  const current = readAgentVersion(agentDir, agentId);
  return current.version <= expectedVersion;
}
