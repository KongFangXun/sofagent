// ============================================================
// eval-failures.ts · L1 eval 失败检测 → think-generator（v1.3.9 · P0b）
// ============================================================
//
// @daily：检测 data/eval/latest.json 的 mtime 是否更新，
// 若更新且 failures 非空，调用 generateThinkFromEval() 生成反思条目。
//
// 幂等保证：
//   - 比对 latest.json 的 mtime 与 .last-think-processed 标记文件
//   - mtime 未变 → 静默跳过
//   - latest.json 不存在 / 解析失败 / failures 为空 → 静默跳过（severity: info）
//
// 数据流：
//   eval CLI → data/eval/latest.json (failures 数组)
//       ↓ 本 inspector 检测 mtime 变更
//   generateThinkFromEval() → data/think.md (append-only)
//       ↓
//   harness 加载链第 3 层消费 think.md → 约束 Agent 行为
// ============================================================

import { existsSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { loadEnvConfig } from '@sofagent/core';
import type { InspectorResult } from './types';

/** 标记文件路径（记录上次处理的 latest.json mtime） */
function getLastProcessedMarkerPath(dataDir: string): string {
  return join(dataDir, 'eval', '.last-think-processed');
}

/**
 * 检测 eval 失败并生成反思条目
 *
 * @param projectDir 项目根目录（本 inspector 数据走 SOFAGENT_HOME 路径 SSOT）
 */
export function runEvalFailuresCheck(projectDir: string): InspectorResult {
  const env = loadEnvConfig();
  const dataDir = env.dataDir;
  const latestPath = join(dataDir, 'eval', 'latest.json');
  const markerPath = getLastProcessedMarkerPath(dataDir);

  // latest.json 不存在 → 静默跳过
  if (!existsSync(latestPath)) {
    return {
      name: 'eval-failures',
      triggered: false,
      message: 'eval latest.json 不存在（eval 尚未运行过）',
      severity: 'info',
    };
  }

  // 读 mtime
  let currentMtime: number;
  try {
    currentMtime = statSync(latestPath).mtimeMs;
  } catch {
    return {
      name: 'eval-failures',
      triggered: false,
      message: 'eval latest.json stat 失败',
      severity: 'info',
    };
  }

  // 幂等检查：比对 mtime 与标记文件
  let lastProcessedMtime = 0;
  if (existsSync(markerPath)) {
    try {
      lastProcessedMtime = parseInt(readFileSync(markerPath, 'utf-8').trim(), 10);
    } catch {
      // 标记文件损坏 → 视为未处理（mtime=0）
    }
  }

  if (currentMtime <= lastProcessedMtime) {
    // mtime 未变 → 静默跳过
    return {
      name: 'eval-failures',
      triggered: false,
      message: 'eval latest.json 未变更，跳过',
      severity: 'info',
    };
  }

  // 读 latest.json 检查 failures
  let failureCount = 0;
  try {
    const raw = readFileSync(latestPath, 'utf-8');
    const data = JSON.parse(raw) as { failures?: unknown[] };
    failureCount = Array.isArray(data.failures) ? data.failures.length : 0;
  } catch {
    // 解析失败 → 静默跳过
    return {
      name: 'eval-failures',
      triggered: false,
      message: 'eval latest.json 解析失败，跳过',
      severity: 'info',
    };
  }

  // failures 为空 → 静默跳过
  if (failureCount === 0) {
    // 更新标记文件（避免 mtime 变了但 failures 一直为空时反复读）
    try {
      writeFileSync(markerPath, String(currentMtime));
    } catch {
      // 标记写入失败不阻塞
    }
    return {
      name: 'eval-failures',
      triggered: false,
      message: 'eval 全通过（failures 为空），跳过',
      severity: 'info',
    };
  }

  // 调用 generateThinkFromEval() 生成反思条目
  try {
    // 动态 import 避免 daemon 硬依赖 think 包（think → daemon 不是依赖方向，但 think 不依赖 daemon 所以安全）
    const { generateThinkFromEval } = require('@sofagent/think') as {
      generateThinkFromEval: (opts?: { dataDir?: string }) => void;
    };
    generateThinkFromEval({ dataDir });

    // 更新标记文件
    writeFileSync(markerPath, String(currentMtime));

    return {
      name: 'eval-failures',
      triggered: true,
      message: `检测到 ${failureCount} 条 eval 失败 → 已生成 think.md 反思条目`,
      severity: 'warning',
    };
  } catch (err) {
    // generateThinkFromEval 失败不阻塞 L1 其余巡检
    return {
      name: 'eval-failures',
      triggered: false,
      message: `think 生成失败（不阻塞巡检）：${err instanceof Error ? err.message : String(err)}`,
      severity: 'info',
    };
  }
}
