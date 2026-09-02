// ============================================================
// with-retry.ts · 统一推送重试策略（v1.4.4 §8.2.1）
//
// 提供带指数退避 + jitter 的重试包装器。
// 推送函数（pushToTarget / pushWebhook / pushOpenClawIM）包裹 withRetry，
// 失败超过上限后写 daemon-errors.jsonl 并放弃重试。
// ============================================================

import { appendFileSync, existsSync, mkdirSync, statSync, renameSync, rmSync } from 'fs';
import { join } from 'path';
import { DATA_DIR } from '@sofagent/core';
import { notify } from './notify';

/** 重试选项 */
export interface RetryOptions {
  /** 最大重试次数（含首次执行，默认 3） */
  maxRetries?: number;
  /** 退避基数（毫秒，默认 1000） */
  baseDelay?: number;
  /** 最大退避（毫秒，默认 10000） */
  maxDelay?: number;
  /** 上下文标签（用于错误日志） */
  context?: string;
}

/** 默认重试选项 */
const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'context'>> = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
};

/** 延迟函数 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 计算带 jitter 的退避延迟。
 *
 * 指数退避：baseDelay * 2^attempt（1s → 2s → 4s ...）
 * jitter ±20%：在退避值基础上随机 ±20%
 * 上限 maxDelay 截断。
 *
 * @param attempt 当前重试序号（0 = 首次失败后的第一次重试）
 * @param baseDelay 退避基数
 * @param maxDelay 最大退避
 * @returns 实际延迟（毫秒）
 */
export function computeBackoff(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
): number {
  const exponential = baseDelay * Math.pow(2, attempt);
  const capped = Math.min(exponential, maxDelay);
  // jitter ±20%
  const jitterRange = capped * 0.2;
  const jitter = (Math.random() - 0.5) * 2 * jitterRange;
  return Math.max(0, Math.round(capped + jitter));
}

/**
 * daemon-errors.jsonl 错误日志追加。
 *
 * D-4 (v1.4.4)：加大小阈值轮转——文件 >1MB 时改名 .1 递推（.2→.3 删除旧 .3、
 * .1→.2、主文件→.1），保留 3 代上限。此前无轮转无告警，实测曾累积 436KB
 * 测试 fixture（4641 行）持续增长。
 *
 * @param entry 错误条目
 */
const ERROR_LOG_MAX_BYTES = 1024 * 1024; // 1MB
const ERROR_LOG_MAX_GENERATIONS = 3; // 保留 .1 .2 .3 三代

function rotateErrorLogIfNeeded(logPath: string): void {
  try {
    const stat = statSync(logPath);
    if (stat.size <= ERROR_LOG_MAX_BYTES) return;
    // 递推轮转：.2→.3（删除旧 .3）、.1→.2、主文件→.1
    for (let gen = ERROR_LOG_MAX_GENERATIONS - 1; gen >= 1; gen--) {
      const from = `${logPath}.${gen}`;
      const to = `${logPath}.${gen + 1}`;
      if (existsSync(from)) {
        if (existsSync(to)) rmSync(to);
        renameSync(from, to);
      }
    }
    renameSync(logPath, `${logPath}.1`);
  } catch {
    // 轮转失败不影响写入主流程
  }
}

function appendErrorLog(entry: {
  context: string;
  error: string;
  retries: number;
  ts: string;
}): void {
  try {
    const dataDir = process.env.SOFAGENT_DATA || DATA_DIR;
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    const logPath = join(dataDir, 'daemon-errors.jsonl');
    rotateErrorLogIfNeeded(logPath);
    appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf-8');
  } catch {
    // 日志写入失败不影响主流程
  }
}

/**
 * 带重试的异步函数包装器。
 *
 * 执行流程：
 *   1. 执行 fn
 *   2. 成功 → 返回 fn 的结果
 *   3. 失败 → 指数退避等待 → 重试
 *   4. 超过 maxRetries → 写 daemon-errors.jsonl，抛出最后一个错误
 *
 * @param fn 要执行的异步函数
 * @param options 重试选项
 * @returns fn 的返回值
 * @throws 超过重试上限后抛出最后一个错误
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const context = opts.context ?? 'unknown';
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < opts.maxRetries; attempt++) {
    try {
      const result = await fn();
      return result;
    } catch (err) {
      lastError = err as Error;

      // 还有重试机会
      if (attempt < opts.maxRetries - 1) {
        const delay = computeBackoff(attempt, opts.baseDelay, opts.maxDelay);
        notify(
          `${context} 第 ${attempt + 1}/${opts.maxRetries} 次失败，${delay}ms 后重试: ${lastError.message}`,
          { source: 'with-retry', level: 'warn' },
        );
        await sleep(delay);
      }
    }
  }

  // 超过上限——写错误日志，抛出
  const errorEntry = {
    context,
    error: lastError?.message ?? 'unknown error',
    retries: opts.maxRetries,
    ts: new Date().toISOString(),
  };
  appendErrorLog(errorEntry);
  notify(
    `${context} 重试 ${opts.maxRetries} 次后仍失败，已放弃: ${lastError?.message ?? 'unknown'}`,
    { source: 'with-retry', level: 'error' },
  );

  throw lastError ?? new Error(`${context} failed after ${opts.maxRetries} retries`);
}

/**
 * 带重试的异步函数包装器（best-effort 版）。
 *
 * 与 withRetry 的区别：超过上限后不抛错，而是返回 null。
 * 适用于推送类辅助通道——失败不应阻断主流程。
 *
 * @param fn 要执行的异步函数
 * @param options 重试选项
 * @returns 成功返回 fn 的结果，失败返回 null
 */
export async function withRetryBestEffort<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T | null> {
  try {
    return await withRetry(fn, options);
  } catch {
    return null;
  }
}
