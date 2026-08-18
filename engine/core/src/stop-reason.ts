// ============================================================
// stop-reason.ts · LLM 调用终止原因六值分类（v1.3.7 交付 12）
//
// 设计来源：PenguinHarness Agent Loop 六值 stop_reason + 自动重连。
//
// 六值语义与引擎反应：
//   completed  正常完成          → 继续
//   aborted    用户中断          → 停止，交还用户（不重试）
//   timeout    LLM 超时/传输断开 → 自动重连（指数退避阶梯）
//   malformed  解析失败/流截断   → 自动重连（指数退避阶梯）
//   failed     其余错误          → 自动重连（同退避阶梯）
//   auth       凭证被拒(401/403) → 永不重试（铁律：重试不会让错误凭证变有效）
//
// 零新依赖：仅 Node.js 内置能力。
// ============================================================

/** LLM 调用终止原因六值分类 */
export type StopReason = 'completed' | 'aborted' | 'timeout' | 'malformed' | 'failed' | 'auth';

/**
 * 指数退避时间表：2s → 4s → 8s → 16s → 30s（封顶 30s，最多 5 次）。
 * 总耐心窗口约 60s，替换 v1.3.0 的固定 maxRetries=1。
 */
export const BACKOFF_SCHEDULE_MS: readonly number[] = [2000, 4000, 8000, 16000, 30000];

/** 最大重试次数（与退避表长度一致，≤5 次） */
export const MAX_RETRY_COUNT: number = BACKOFF_SCHEDULE_MS.length;

/** 凭证类 HTTP 状态码——命中即归类 auth（永不重试） */
const AUTH_HTTP_STATUS = new Set<number>([401, 403]);

/**
 * 从错误对象上提取 HTTP 状态码（若可识别）。
 * 支持 err.httpStatus / err.status 数值属性，以及「返回错误 NNN」消息模式。
 */
function extractHttpStatus(err: unknown): number | undefined {
  if (err && typeof err === 'object') {
    const candidate = (err as { httpStatus?: unknown; status?: unknown }).httpStatus
      ?? (err as { status?: unknown }).status;
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
  }
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const match = msg.match(/返回错误\s*(\d{3})/);
  if (match && match[1]) return Number(match[1]);
  return undefined;
}

/**
 * 对 LLM 调用错误做 stop_reason 六值分类。
 *
 * 分类优先级：
 *   1. HTTP 401/403 → auth（铁律：永不重试）
 *   2. 用户主动中断 → aborted（不重试）
 *   3. 超时 / 传输断开 / 网络错误 → timeout（自动重连）
 *   4. 解析失败 / 流截断 / 空内容 → malformed（自动重连）
 *   5. 其余 → failed（自动重连，状态仍报 failed）
 *
 * @param err 错误对象（Error 或任意可字符串化值）
 * @param httpStatus 可选的 HTTP 状态码（调用方已知时显式传入，优先于消息推断）
 * @returns stop_reason 六值之一
 */
export function classifyError(err: unknown, httpStatus?: number): StopReason {
  // 1) 凭证被拒——auth（永不重试）
  const status = httpStatus ?? extractHttpStatus(err);
  if (status !== undefined && AUTH_HTTP_STATUS.has(status)) return 'auth';

  const msg = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
  const name = err && typeof err === 'object' && 'name' in err
    ? String((err as { name?: unknown }).name ?? '').toLowerCase()
    : '';

  // 2) 用户主动中断——aborted（区别于传输层 abort）
  if (msg.includes('用户中断') || msg.includes('aborted by user') || msg.includes('user abort')) {
    return 'aborted';
  }

  // 3) 超时 / 传输断开 / 网络错误——timeout
  if (
    name === 'aborterror' ||
    name === 'timeouterror' ||
    /timeout|timed out|timedout|etimedout|econnaborted|econnreset|econnrefused|fetch failed|network|socket hang up|aborted|und_err/.test(msg)
  ) {
    return 'timeout';
  }

  // 4) 解析失败 / 流截断 / 空内容——malformed
  if (
    /json|parse|解析|malformed|truncat|截断|unexpected token|unexpected end|invalid (content|response)|空内容/.test(msg)
  ) {
    return 'malformed';
  }

  // 5) 其余——failed
  return 'failed';
}

/**
 * 判断 stop_reason 是否可重试。
 *
 * 铁律：auth 永不重试（重试不会让错误凭证变有效）；
 * aborted（用户中断）与 completed（正常完成）不重试。
 * timeout / malformed / failed 按退避阶梯重连。
 *
 * @param reason stop_reason 六值之一
 * @returns true = 可按退避阶梯重试
 */
export function isRetryableStopReason(reason: StopReason): boolean {
  return reason === 'timeout' || reason === 'malformed' || reason === 'failed';
}

/**
 * 取第 attempt 次重试前的退避延时（ms）。
 * attempt 从 0 开始；超出表长度时取封顶值（30s）。
 *
 * @param attempt 重试序号（0-based）
 * @returns 延时毫秒数
 */
export function backoffDelayMs(attempt: number): number {
  const index = Math.max(0, Math.min(attempt, BACKOFF_SCHEDULE_MS.length - 1));
  return BACKOFF_SCHEDULE_MS[index] ?? 30_000;
}
