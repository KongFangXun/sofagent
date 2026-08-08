// ============================================================
// TDD_PRE_CODE: 此测试文件在功能代码编写之前创建
// 预期：所有测试当前 FAIL（被测模块 engine/daemon/src/webhook/ 尚不存在，
//       import 即失败——这是 TDD Red 的正常起点）。
// 工程师铁律：严禁修改此测试文件中的任何断言和测试用例。
//
// webhook-push.test.ts · Webhook 企业平台推送（v1.2.9 · P0 · 采购阻塞项）
//
// 🔴 TDD Red — 功能未实现，预期全部 FAIL。
//
// 被测契约（本测试文件即规格——工程师按此实现 engine/daemon/src/webhook/）：
//
//   模块路径：engine/daemon/src/webhook/index.ts
//
//   export type WebhookPlatform = 'feishu' | 'dingtalk' | 'wecom';
//   export type AuditVerdict = 'PASS' | 'WARN' | 'FAIL';
//
//   export interface WebhookPushResult {
//     success: boolean;      // 推送是否成功送达平台（HTTP 2xx）
//     platform: WebhookPlatform;
//     attempts: number;      // 实际发起的 HTTP 尝试次数（含重试）
//     degraded: boolean;     // 是否已降级为本地日志（失败兜底）
//     error?: string;        // 失败原因摘要（success=false 时存在）
//   }
//
//   export interface WebhookPusherOptions {
//     timeoutMs?: number;    // 单次请求超时，默认 5000
//     maxRetries?: number;   // 失败重试次数，默认 1
//     backoffMs?: number;    // 429 退避基数，默认 1000
//     env?: Record<string, string | undefined>;  // endpoint 来源，默认 process.env
//     logPath?: string;      // 降级本地日志路径（jsonl 追加），默认 .sofagent/webhook-fallback.log
//   }
//
//   export function createWebhookPusher(options?: WebhookPusherOptions): {
//     push(platform: WebhookPlatform, verdict: AuditVerdict, message: string): Promise<WebhookPushResult>;
//   }
//
//   endpoint 环境变量（与 push-target.ts 已有约定对齐）：
//     feishu   → SOFAGENT_WEBHOOK_FEISHU
//     dingtalk → SOFAGENT_WEBHOOK_DINGTALK
//     wecom    → SOFAGENT_WEBHOOK_WECOM
//
//   行为规格（来自 changelog v1.2.1 验收标准 + 主理人任务表）：
//     1. 三平台推送成功：HTTP 2xx → success=true, attempts=1, degraded=false
//     2. 鉴权失败（401/403）：不重试（永久错误），不抛异常，降级本地日志
//     3. 超时（timeoutMs 无响应）：重试 maxRetries 次后降级，不抛异常
//     4. 限流（HTTP 429）：按 backoffMs 退避后重试，最终成功则 success=true
//     5. 网络断开（fetch reject / DNS 失败）：不抛异常，降级本地日志
//     6. 未配置 endpoint：不发 HTTP 请求，直接降级本地日志
//     7. 任何失败路径都不得 reject——push() 永远 resolve（推送是辅助通道，不阻断审计主流程）
//
//   实现约束：模块必须通过全局 fetch 发请求（测试用 vi.stubGlobal('fetch') mock，
//   严禁真实网络请求）；降级日志为 jsonl 追加写，每行含 ts/platform/verdict/message/error。
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// 🔴 被测模块尚不存在——import 失败即 TDD Red 起点
import { createWebhookPusher } from '../webhook/index';
import type { WebhookPlatform, AuditVerdict } from '../webhook/index';

// ════════════════════════════════════════
// Helper
// ════════════════════════════════════════

const ENDPOINT_ENV: Record<WebhookPlatform, string> = {
  feishu: 'SOFAGENT_WEBHOOK_FEISHU',
  dingtalk: 'SOFAGENT_WEBHOOK_DINGTALK',
  wecom: 'SOFAGENT_WEBHOOK_WECOM',
};

const PLATFORMS: WebhookPlatform[] = ['feishu', 'dingtalk', 'wecom'];

/** 构造三平台 endpoint 齐全的假 env */
function makeEnv(): Record<string, string> {
  return {
    SOFAGENT_WEBHOOK_FEISHU: 'https://open.feishu.cn/open-apis/bot/v2/hook/fake-token',
    SOFAGENT_WEBHOOK_DINGTALK: 'https://oapi.dingtalk.com/robot/send?access_token=fake-token',
    SOFAGENT_WEBHOOK_WECOM: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=fake-key',
  };
}

/** HTTP 200 成功响应 */
function okResponse(): Response {
  return new Response(JSON.stringify({ errcode: 0 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** 永不 resolve 的 fetch（模拟超时场景——对端 5s+ 无任何响应） */
function hangingFetch(): Promise<Response> {
  return new Promise<Response>(() => {
    // 永不 settle——实现方必须用 timeout 中止，否则此 promise 挂死测试
  });
}

function tmpLogPath(): { dir: string; logPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-webhook-'));
  return { dir, logPath: path.join(dir, 'webhook-fallback.log') };
}

// ════════════════════════════════════════
// Tests
// ════════════════════════════════════════

describe('Webhook 企业平台推送（v1.2.1 P0 · 采购阻塞）', () => {
  let tmp: { dir: string; logPath: string };

  beforeEach(() => {
    tmp = tmpLogPath();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    fs.rmSync(tmp.dir, { recursive: true, force: true });
  });

  // ────────────────────────────────────────
  // 用例 1 · 三平台推送成功（PASS 态）
  // ────────────────────────────────────────

  // 测试：飞书/钉钉/企微三平台各自推送一条 PASS 态审计结果，平台返回 HTTP 200。
  // 输入：mock fetch → 200；push(platform, 'PASS', msg)
  // 预期：success=true, degraded=false, attempts=1（一次成功不重试），
  //       且 fetch 被调用到该平台环境变量配置的 URL（POST）。
  // 覆盖：changelog 验收标准第一条——"三平台各验证一条推送"。
  it.each(PLATFORMS)('testWebhookPush_%s_passVerdict_http200_returnsSuccess', async (platform) => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    const pusher = createWebhookPusher({ env: makeEnv(), logPath: tmp.logPath });
    const result = await pusher.push(platform, 'PASS', '审计通过：9/9 规则全绿');

    expect(result.success).toBe(true);
    expect(result.degraded).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.platform).toBe(platform);

    // 请求确实发往该平台 endpoint（POST 方法）
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(String(calledUrl)).toBe(makeEnv()[ENDPOINT_ENV[platform]]);
    expect((calledInit as RequestInit).method?.toUpperCase() ?? 'POST').toBe('POST');
  });

  // 测试：请求体必须携带审计三态 verdict——平台侧要能区分 PASS/WARN/FAIL 渲染。
  // 输入：push('feishu', verdict, msg)，verdict 遍历三态
  // 预期：每次 fetch 的 body 字符串中包含该 verdict 字样。
  // 覆盖：changelog 验收标准——"三态推送"的内容完整性。
  it.each(['PASS', 'WARN', 'FAIL'] as AuditVerdict[])(
    'testWebhookPush_feishu_verdict_%s_payloadContainsVerdict',
    async (verdict) => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse());
      vi.stubGlobal('fetch', fetchMock);

      const pusher = createWebhookPusher({ env: makeEnv(), logPath: tmp.logPath });
      await pusher.push('feishu', verdict, 'payload 内容探针');

      const body = String((fetchMock.mock.calls[0][1] as RequestInit).body);
      expect(body).toContain(verdict);
      expect(body).toContain('payload 内容探针');
    },
  );

  // ────────────────────────────────────────
  // 用例 2 · 鉴权失败（错误 token → 401/403）
  // ────────────────────────────────────────

  // 测试：平台返回 401（token 错误）时，push 不抛异常、不重试（鉴权是永久错误，重试无意义），
  //       降级写本地日志。
  // 输入：mock fetch → 401 → 预期：promise resolve（不 reject），success=false，
  //       degraded=true, attempts=1，logPath 落一条含平台名与错误信息的 jsonl 记录。
  // 边界：降级日志是审计证据链的一部分——平台不可达时结果绝不能丢。
  it('testWebhookPush_authFailure401_noRetry_degradesToLocalLog_noThrow', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('invalid token', { status: 401 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const pusher = createWebhookPusher({ env: makeEnv(), logPath: tmp.logPath });
    // 关键断言 1：永不 reject
    const result = await pusher.push('dingtalk', 'FAIL', '审计失败：发现 P0 阻断项');

    expect(result.success).toBe(false);
    expect(result.degraded).toBe(true);
    expect(result.attempts).toBe(1); // 永久错误不重试
    expect(result.error).toBeTruthy();

    // 关键断言 2：本地降级日志落盘，内容可追溯（平台 + 消息 + 三态）
    expect(fs.existsSync(tmp.logPath)).toBe(true);
    const lines = fs.readFileSync(tmp.logPath, 'utf-8').trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const record = JSON.parse(lines[lines.length - 1]);
    expect(record.platform).toBe('dingtalk');
    expect(record.verdict).toBe('FAIL');
    expect(record.message).toContain('P0');
  });

  // 测试：403 与 401 同属鉴权类永久失败——同样不重试、不抛异常、降级。
  it('testWebhookPush_authFailure403_noRetry_degrades_noThrow', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('forbidden', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);

    const pusher = createWebhookPusher({ env: makeEnv(), logPath: tmp.logPath });
    const result = await pusher.push('wecom', 'WARN', '审计告警');

    expect(result.success).toBe(false);
    expect(result.degraded).toBe(true);
    expect(result.attempts).toBe(1);
  });

  // ────────────────────────────────────────
  // 用例 3 · 超时（对端无响应）
  // ────────────────────────────────────────

  // 测试：平台 5s 无响应时，实现方必须按 timeoutMs 中止请求并重试 1 次，
  //       仍失败则降级本地日志，不抛异常。
  // 输入：mock fetch 永不 resolve；timeoutMs=50, maxRetries=1（注入小超时避免测试等 5s）
  // 预期：attempts=2（首次 + 重试 1 次），success=false, degraded=true，promise resolve。
  // 边界：超时必须主动中止——挂起的连接不能拖死 daemon。
  it('testWebhookPush_timeout_retriesOnceThenDegrades_noThrow', async () => {
    const fetchMock = vi.fn().mockImplementation(hangingFetch);
    vi.stubGlobal('fetch', fetchMock);

    const pusher = createWebhookPusher({
      env: makeEnv(),
      logPath: tmp.logPath,
      timeoutMs: 50,
      maxRetries: 1,
    });
    const result = await pusher.push('feishu', 'PASS', '超时探针');

    expect(fetchMock).toHaveBeenCalledTimes(2); // 1 次原始 + 1 次重试
    expect(result.attempts).toBe(2);
    expect(result.success).toBe(false);
    expect(result.degraded).toBe(true);
    expect(fs.existsSync(tmp.logPath)).toBe(true);
  }, 10_000);

  // ────────────────────────────────────────
  // 用例 4 · 限流（HTTP 429）
  // ────────────────────────────────────────

  // 测试：平台返回 429（限流）时，按退避策略等待后重试；第二次成功则整体成功。
  // 输入：mock fetch 第 1 次 429、第 2 次 200；backoffMs=1（注入小退避避免测试等待）
  // 预期：success=true, attempts=2，fetch 恰好调用 2 次。
  // 边界：429 是临时错误——与 401 的永久错误语义相反，必须重试。
  it('testWebhookPush_rateLimited429_backoffRetry_thenSuccess', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('too many requests', { status: 429 }))
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    const pusher = createWebhookPusher({
      env: makeEnv(),
      logPath: tmp.logPath,
      backoffMs: 1,
      maxRetries: 1,
    });
    const result = await pusher.push('wecom', 'PASS', '限流探针');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.attempts).toBe(2);
    expect(result.success).toBe(true);
    expect(result.degraded).toBe(false);
  });

  // 测试：429 持续超出重试上限时，降级本地日志，不抛异常。
  // 输入：mock fetch 永远 429；maxRetries=1 → 预期：attempts=2, success=false, degraded=true。
  it('testWebhookPush_rateLimited429_exhausted_degradesToLocalLog', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('too many requests', { status: 429 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const pusher = createWebhookPusher({
      env: makeEnv(),
      logPath: tmp.logPath,
      backoffMs: 1,
      maxRetries: 1,
    });
    const result = await pusher.push('feishu', 'WARN', '持续限流探针');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(false);
    expect(result.degraded).toBe(true);
  });

  // ────────────────────────────────────────
  // 用例 5 · 网络断开（DNS 解析失败）
  // ────────────────────────────────────────

  // 测试：断网时 fetch 直接 reject（TypeError: fetch failed / ENOTFOUND），
  //       push 必须 catch 住、降级本地日志、正常 resolve——绝不能把异常抛给 daemon。
  // 输入：mock fetch reject TypeError → 预期：success=false, degraded=true，
  //       logPath 有记录，error 字段非空。
  it('testWebhookPush_networkDown_dnsFailure_noThrow_degradesToLocalLog', async () => {
    const fetchMock = vi.fn().mockRejectedValue(
      new TypeError('fetch failed: getaddrinfo ENOTFOUND open.feishu.cn'),
    );
    vi.stubGlobal('fetch', fetchMock);

    const pusher = createWebhookPusher({
      env: makeEnv(),
      logPath: tmp.logPath,
      maxRetries: 0, // 断网场景不强制重试——实现方允许重试，attempts 断言放宽为 ≥1
    });
    const result = await pusher.push('feishu', 'FAIL', '断网探针');

    expect(result.success).toBe(false);
    expect(result.degraded).toBe(true);
    expect(result.attempts).toBeGreaterThanOrEqual(1);
    expect(result.error).toBeTruthy();

    const lines = fs.readFileSync(tmp.logPath, 'utf-8').trim().split('\n');
    const record = JSON.parse(lines[lines.length - 1]);
    expect(record.platform).toBe('feishu');
    expect(record.verdict).toBe('FAIL');
  });

  // ────────────────────────────────────────
  // 用例 6 · 未配置 endpoint
  // ────────────────────────────────────────

  // 测试：平台环境变量缺失时，不发起任何 HTTP 请求，直接降级本地日志。
  // 输入：env 中无 SOFAGENT_WEBHOOK_WECOM → 预期：fetch 零调用，
  //       success=false, degraded=true, attempts=0。
  // 边界：配置缺失是部署问题不是平台问题——本地日志要能让运维发现"没配"。
  it('testWebhookPush_missingEndpointEnv_noHttpCall_degradesLocally', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    const env = makeEnv();
    delete env.SOFAGENT_WEBHOOK_WECOM;

    const pusher = createWebhookPusher({ env, logPath: tmp.logPath });
    const result = await pusher.push('wecom', 'PASS', '未配置探针');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.attempts).toBe(0);
    expect(result.success).toBe(false);
    expect(result.degraded).toBe(true);
  });
});
