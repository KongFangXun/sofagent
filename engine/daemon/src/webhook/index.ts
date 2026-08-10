// webhook/index.ts · Webhook 企业平台推送（v1.3.1 · P0 · 采购阻塞项）
// ============================================================
// 将审计三态（PASS/WARN/FAIL）推送到企业协同平台：飞书 / 钉钉 / 企业微信。
//
// 铁律：push() 永不 reject——推送是辅助通道，任何失败（鉴权/超时/限流/断网/
// 未配置）都降级为本地 jsonl 日志，绝不阻断审计主流程。
//
// endpoint 环境变量（与 push-target.ts 已有约定对齐）：
//   feishu   → SOFAGENT_WEBHOOK_FEISHU
//   dingtalk → SOFAGENT_WEBHOOK_DINGTALK
//   wecom    → SOFAGENT_WEBHOOK_WECOM
//
// 失败语义：
//   401/403（鉴权）→ 永久错误，不重试，直接降级
//   429（限流）    → 按 backoffMs 退避后重试，直至成功或重试耗尽
//   超时/断网      → 临时错误，重试 maxRetries 次后降级
//   未配置 endpoint → 不发 HTTP，attempts=0，直接降级
// ============================================================

import * as fs from 'fs';
import * as path from 'path';

// ────────────────────────────────
// 公开类型
// ────────────────────────────────

/** 支持的企业协同平台 */
export type WebhookPlatform = 'feishu' | 'dingtalk' | 'wecom';

/** 审计三态 */
export type AuditVerdict = 'PASS' | 'WARN' | 'FAIL';

/** 单次推送结果 */
export interface WebhookPushResult {
  /** 推送是否成功送达平台（HTTP 2xx） */
  success: boolean;
  platform: WebhookPlatform;
  /** 实际发起的 HTTP 尝试次数（含重试） */
  attempts: number;
  /** 是否已降级为本地日志（失败兜底） */
  degraded: boolean;
  /** 失败原因摘要（success=false 时存在） */
  error?: string;
}

/** createWebhookPusher 配置项 */
export interface WebhookPusherOptions {
  /** 单次请求超时（毫秒），默认 5000 */
  timeoutMs?: number;
  /** 失败重试次数，默认 1 */
  maxRetries?: number;
  /** 429 退避基数（毫秒），默认 1000 */
  backoffMs?: number;
  /** endpoint 来源，默认 process.env */
  env?: Record<string, string | undefined>;
  /** 降级本地日志路径（jsonl 追加），默认 data/webhook-fallback.log（v1.2.1 起） */
  logPath?: string;
}

/** 推送器实例 */
export interface WebhookPusher {
  push(
    platform: WebhookPlatform,
    verdict: AuditVerdict,
    message: string,
  ): Promise<WebhookPushResult>;
}

// ────────────────────────────────
// 常量与内部类型
// ────────────────────────────────

const ENDPOINT_ENV: Record<WebhookPlatform, string> = {
  feishu: 'SOFAGENT_WEBHOOK_FEISHU',
  dingtalk: 'SOFAGENT_WEBHOOK_DINGTALK',
  wecom: 'SOFAGENT_WEBHOOK_WECOM',
};

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_BACKOFF_MS = 1000;
// v1.2.1：降级日志从 .sofagent/ 迁移到 data/
const DEFAULT_LOG_PATH = 'data/webhook-fallback.log';

/** 单次 HTTP 尝试的结果分类 */
type AttemptKind = 'success' | 'permanent' | 'retryable';

interface AttemptOutcome {
  kind: AttemptKind;
  /** HTTP 状态码（网络层失败时无） */
  status?: number;
  error: string;
}

/** 降级日志记录（jsonl 每行一条，审计证据链的一部分） */
interface FallbackRecord {
  ts: string;
  platform: WebhookPlatform;
  verdict: AuditVerdict;
  message: string;
  error: string;
}

// ────────────────────────────────
// 内部实现
// ────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 构建平台 payload（格式与 push-target.ts 对齐）。
 * body 必须携带 verdict 三态与原始消息——平台侧按三态渲染。
 */
function buildPayload(
  platform: WebhookPlatform,
  verdict: AuditVerdict,
  message: string,
): string {
  const title = `[${verdict}] sofagent 审计通知`;
  if (platform === 'feishu') {
    return JSON.stringify({
      msg_type: 'text',
      content: { text: `${title}\n\n${message}` },
    });
  }
  if (platform === 'dingtalk') {
    return JSON.stringify({
      msgtype: 'markdown',
      markdown: { title, text: `## ${title}\n\n${message}` },
    });
  }
  // wecom
  return JSON.stringify({
    msgtype: 'markdown',
    markdown: { content: `## ${title}\n\n${message}` },
  });
}

/**
 * HTTP 状态码分类：
 *   2xx      → success
 *   401/403  → permanent（鉴权是永久错误，重试无意义）
 *   其余     → retryable（429 限流 / 5xx / 其他临时性错误）
 */
function classifyStatus(status: number): AttemptKind {
  if (status >= 200 && status < 300) return 'success';
  if (status === 401 || status === 403) return 'permanent';
  return 'retryable';
}

/**
 * 发起单次 HTTP 推送。
 * 超时通过 Promise.race 主动中止——不依赖对端 fetch 实现是否
 * 响应 AbortSignal（挂起的连接不能拖死 daemon）。
 */
async function attemptOnce(
  endpoint: string,
  body: string,
  timeoutMs: number,
): Promise<AttemptOutcome> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`请求超时（${timeoutMs}ms 无响应）`));
      }, timeoutMs);
    });
    const res = await Promise.race([
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      }),
      timeoutPromise,
    ]);
    const kind = classifyStatus(res.status);
    if (kind === 'success') return { kind, error: '' };
    return { kind, status: res.status, error: `HTTP ${res.status}` };
  } catch (err) {
    // 超时中止 / fetch reject（DNS 失败、断网）——均按临时错误处理
    const msg = err instanceof Error ? err.message : String(err);
    return { kind: 'retryable', error: msg };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * 追加降级日志（jsonl）。写失败也静默——推送是辅助通道，
 * 本地日志又失败时没有更高层的兜底，抛出只会误伤审计主流程。
 */
function writeFallbackLog(logPath: string, record: FallbackRecord): void {
  try {
    const dir = path.dirname(logPath);
    if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(logPath, `${JSON.stringify(record)}\n`, 'utf-8');
  } catch {
    // 降级日志写失败不抛出
  }
}

// ────────────────────────────────
// 公开工厂
// ────────────────────────────────

/**
 * 创建 Webhook 推送器。
 *
 * @param options 超时/重试/退避/env/logPath 配置（均有默认值）
 * @returns { push } — push() 永远 resolve，失败路径降级本地日志
 */
export function createWebhookPusher(options: WebhookPusherOptions = {}): WebhookPusher {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const env = options.env ?? process.env;
  const logPath = options.logPath ?? DEFAULT_LOG_PATH;

  const degrade = (
    platform: WebhookPlatform,
    verdict: AuditVerdict,
    message: string,
    attempts: number,
    error: string,
  ): WebhookPushResult => {
    writeFallbackLog(logPath, {
      ts: new Date().toISOString(),
      platform,
      verdict,
      message,
      error,
    });
    return { success: false, platform, attempts, degraded: true, error };
  };

  return {
    async push(
      platform: WebhookPlatform,
      verdict: AuditVerdict,
      message: string,
    ): Promise<WebhookPushResult> {
      // 铁律：永不 reject
      try {
        const envKey = ENDPOINT_ENV[platform];
        const endpoint = env[envKey];
        if (!endpoint) {
          // 配置缺失是部署问题不是平台问题——不发 HTTP，直接降级
          return degrade(platform, verdict, message, 0, `未配置 endpoint 环境变量 ${envKey}`);
        }

        const body = buildPayload(platform, verdict, message);
        const maxAttempts = 1 + Math.max(0, maxRetries);
        let attempts = 0;
        let lastError = '未知错误';

        while (attempts < maxAttempts) {
          attempts += 1;
          const outcome = await attemptOnce(endpoint, body, timeoutMs);
          if (outcome.kind === 'success') {
            return { success: true, platform, attempts, degraded: false };
          }
          lastError = outcome.error;
          // 永久错误（401/403）不重试
          if (outcome.kind === 'permanent') break;
          // 429 限流：按 backoffMs 线性退避后再重试
          if (attempts < maxAttempts && outcome.status === 429) {
            await sleep(backoffMs * attempts);
          }
        }

        return degrade(platform, verdict, message, attempts, lastError);
      } catch (err) {
        // 兜底：任何未预期异常也不得外抛
        const msg = err instanceof Error ? err.message : String(err);
        return degrade(platform, verdict, message, 0, msg);
      }
    },
  };
}
