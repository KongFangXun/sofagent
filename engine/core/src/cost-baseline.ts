// ============================================================
// cost-baseline.ts · 成本基线与异常检测
// v1.2.0 新增：从 task/logs 读历史 token 消耗，计算基线 + 检测异常
// ============================================================

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

export interface Baseline {
  mean: number;
  stddev: number;
  sampleCount: number;
}

export interface TaskLogEntry {
  timestamp: string;
  taskType: string;
  tokenCount: number;
}

/** 冷启动最小样本数——前 N 条只积累不检测 */
const COLD_START_MIN_SAMPLES = 10;

/**
 * 从 task/logs 目录解析 token 消耗记录
 * 遍历 data/task/logs/（v1.2.1 起，原 .sofagent/task/logs/）下所有子目录和 .md 文件，
 * 提取 token 消耗数字（匹配 "token" 相关行）
 */
function loadTaskLogs(dataDir: string): TaskLogEntry[] {
  const logsDir = join(dataDir, 'task', 'logs');
  if (!existsSync(logsDir)) return [];

  const entries: TaskLogEntry[] = [];

  try {
    const items = readdirSync(logsDir, { withFileTypes: true });
    for (const item of items) {
      if (item.isDirectory()) {
        // 子目录中可能有 .md 文件
        const subDir = join(logsDir, item.name);
        const subItems = readdirSync(subDir, { withFileTypes: true });
        for (const sub of subItems) {
          if (sub.isFile() && sub.name.endsWith('.md')) {
            const entry = parseLogFile(join(subDir, sub.name), item.name);
            if (entry) entries.push(entry);
          }
        }
      } else if (item.isFile() && item.name.endsWith('.md')) {
        const entry = parseLogFile(join(logsDir, item.name), 'default');
        if (entry) entries.push(entry);
      }
    }
  } catch {
    // 读取失败返回空
  }

  return entries;
}

/**
 * 从单个 .md 日志文件中提取 token 消耗
 * 匹配模式：`token: N` 或 `消耗: N tokens` 或 `使用了 N tokens`
 */
function parseLogFile(filePath: string, taskType: string): TaskLogEntry | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    // 尝试多种 token 消耗格式
    const patterns = [
      /token[:\s]+(\d[\d,]*)/i,
      /消耗[:\s]+(\d[\d,]*)\s*(?:tokens?)?/i,
      /使用了?\s*(\d[\d,]*)\s*(?:tokens?)?/i,
      /(\d[\d,]*)\s*tokens/i,
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match?.[1]) {
        const tokenCount = parseInt(match[1].replace(/,/g, ''), 10);
        if (!isNaN(tokenCount) && tokenCount > 0) {
          // 用文件修改时间作为时间戳
          const { statSync } = require('fs');
          const stat = statSync(filePath);
          return {
            timestamp: stat.mtime.toISOString(),
            taskType,
            tokenCount,
          };
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 计算指定任务类型的成本基线
 * @param taskType 任务类型（用于过滤日志）
 * @param dataDir 数据根目录（v1.2.1 起为 data/，原 .sofagent/）
 * @returns 基线统计（mean, stddev, sampleCount），样本不足时返回 null
 */
export function calculateBaseline(taskType: string, dataDir: string): Baseline | null {
  const entries = loadTaskLogs(dataDir);
  const relevant = entries.filter((e) => e.taskType === taskType);
  if (relevant.length < COLD_START_MIN_SAMPLES) return null;

  const values = relevant.map((e) => e.tokenCount);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  const stddev = Math.sqrt(variance);

  return { mean, stddev, sampleCount: relevant.length };
}

/**
 * 判断当前 token 消耗是否为异常（超过 mean + 2σ）
 */
export function isAnomaly(current: number, baseline: Baseline): boolean {
  return current > baseline.mean + 2 * baseline.stddev;
}

/**
 * 判断是否处于冷启动期（样本不足）
 */
export function isColdStart(sampleCount: number, minSamples: number = COLD_START_MIN_SAMPLES): boolean {
  return sampleCount < minSamples;
}
