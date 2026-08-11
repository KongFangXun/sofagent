// ============================================================
// loop-agent/judge.ts · L1 判定器（v1.3.2 交付 8）
// ============================================================
//
// Onboard Agent L1 = 半自动，工程级判定——只判「跑没跑起来」，
// **不判语义对错**（那是 L2-L5 的事，v1.3.2 交付）。
//
// 三态判定：
//   crash   进程崩溃（信号终止 / 退出码缺失且异常）→ 报错给人工修
//   error   非零退出码 / stderr 有输出 → 报错给人工修
//   timeout 超过超时阈值（可配）→ 报错给人工修
//   passed  以上都不是 → 跑起来了（不判对不对）
//
// 判定优先级：timeout > crash > error > passed（超时最明确，优先暴露）。
//
// 零新依赖。
// ============================================================

/** L1 判定状态（四态——三态失败 + passed） */
export type JudgeState = 'passed' | 'crash' | 'error' | 'timeout';

/** 单次运行的原始产出（判定输入） */
export interface RunOutcome {
  /** 进程退出码（null = 未正常退出，如被信号杀死） */
  exitCode?: number | null;
  /** 终止信号（SIGKILL / SIGSEGV / SIGABRT 等——崩溃证据） */
  signal?: string | null;
  /** 标准输出 */
  stdout?: string;
  /** 标准错误 */
  stderr?: string;
  /** 运行耗时（ms） */
  durationMs?: number;
}

/** 判定选项 */
export interface JudgeOptions {
  /** 超时阈值（ms，默认 120_000 = 2 分钟） */
  timeoutMs?: number;
}

/** L1 判定结果 */
export interface JudgeVerdict {
  /** 判定状态 */
  state: JudgeState;
  /** 人类可读判定理由（人工修复的定位线索） */
  detail: string;
  /** 运行耗时（ms，有则带） */
  durationMs?: number;
}

/** 默认超时阈值（ms）——2 分钟 */
export const DEFAULT_TIMEOUT_MS = 120_000;

/** 崩溃信号集合（进程被信号终止——crash 证据） */
const CRASH_SIGNALS = new Set([
  'SIGKILL', 'SIGSEGV', 'SIGABRT', 'SIGBUS', 'SIGILL', 'SIGFPE', 'SIGTRAP', 'SIGQUIT',
]);

/**
 * L1 判定——一次运行产出 → crash / error / timeout / passed。
 *
 * 「不判对不对」：本函数只看进程级信号（退出码/信号/耗时/stderr），
 * 不看输出内容是否满足业务语义。
 *
 * @param outcome 运行产出
 * @param options 判定选项（超时阈值可配）
 * @returns JudgeVerdict
 */
export function judgeRunResult(outcome: RunOutcome, options: JudgeOptions = {}): JudgeVerdict {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const durationMs = outcome.durationMs;

  // 1. 超时——最明确的失败态，优先暴露
  if (durationMs !== undefined && durationMs > timeoutMs) {
    return {
      state: 'timeout',
      durationMs,
      detail: `运行超时：耗时 ${durationMs}ms 超过阈值 ${timeoutMs}ms（自动重连或人工介入）`,
    };
  }

  // 2. 崩溃——进程被信号终止，或退出码缺失且 stderr 非空
  const signal = outcome.signal ?? null;
  if (signal && CRASH_SIGNALS.has(signal)) {
    return {
      state: 'crash',
      durationMs,
      detail: `进程崩溃：被信号 ${signal} 终止（核心转储/段错误类）——附审计日志定位`,
    };
  }
  if (signal) {
    return {
      state: 'crash',
      durationMs,
      detail: `进程异常终止：信号 ${signal}（未正常退出）`,
    };
  }
  if (outcome.exitCode === null || outcome.exitCode === undefined) {
    // 无退出码且无信号——视为异常终止
    return {
      state: 'crash',
      durationMs,
      detail: '进程未正常退出（无退出码、无信号）——疑似崩溃',
    };
  }

  // 3. 错误——非零退出码或 stderr 有输出
  if (outcome.exitCode !== 0) {
    return {
      state: 'error',
      durationMs,
      detail: `运行错误：退出码 ${outcome.exitCode}${outcome.stderr ? `，stderr: ${outcome.stderr.slice(0, 300)}` : ''}`,
    };
  }
  if (outcome.stderr && outcome.stderr.trim().length > 0) {
    return {
      state: 'error',
      durationMs,
      detail: `运行错误：stderr 有输出——${outcome.stderr.trim().slice(0, 300)}`,
    };
  }

  // 4. 跑起来了（不判对不对）
  return {
    state: 'passed',
    durationMs,
    detail: '进程正常退出（退出码 0，无 stderr）——L1 判定通过（语义对错留 L2-L5）',
  };
}
