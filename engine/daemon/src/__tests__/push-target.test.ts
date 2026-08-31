// ============================================================
// push-target.test.ts · MCP push target 路由——webhook 出站 SSRF 防护
//
// 纵深防御：daemon 的 IM webhook 出站（push-target.ts pushWebhook）
// 与审计/训练侧出站同口径——内网/本机 URL 拒绝发起请求，并提供
// SOFAGENT_WEBHOOK_ALLOW_LOCALHOST=1 豁免开关（本地联调合法场景）。
//
// 测试范围（本文件只锁 SSRF 行为，不重复 pushWebhook 已有路由逻辑）：
//   1. 回环 endpoint → 零 HTTP 调用，返回 false
//   2. 豁免开关开启 → 正常发起请求
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { pushToTarget } from '../push-target';

describe('push-target webhook SSRF 防护', () => {
  const ENV_KEYS = ['SOFAGENT_WEBHOOK_DINGTALK', 'SOFAGENT_WEBHOOK_FEISHU', 'SOFAGENT_WEBHOOK_WECOM', 'SOFAGENT_WEBHOOK_ALLOW_LOCALHOST'];
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = savedEnv[k];
      }
    }
  });

  // 测试：webhook URL 指向本机回环地址时，不发起任何 HTTP 请求，推送失败返回 false。
  // 输入：SOFAGENT_WEBHOOK_DINGTALK=http://127.0.0.1:8080/admin
  // 预期：fetch 零调用，pushToTarget 返回 false（辅助通道失败不阻断主流程）。
  it('testPushToTarget_ssrfLoopbackEnv_noHttpCall_returnsFalse', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    process.env.SOFAGENT_WEBHOOK_DINGTALK = 'http://127.0.0.1:8080/admin';

    const result = await pushToTarget({
      target: 'webhook:dingtalk',
      title: 'SSRF 探针',
      message: '回环 endpoint 应被拦截',
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  // 测试：豁免开关（SOFAGENT_WEBHOOK_ALLOW_LOCALHOST=1）下，本机 endpoint 照常发起请求——
  // 与审计侧 pushAuditResult 豁免口径一致，本地联调接收器不受影响。
  it('testPushToTarget_allowLocalhostEscapeHatch_httpCallSucceeds_returnsTrue', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    process.env.SOFAGENT_WEBHOOK_DINGTALK = 'http://127.0.0.1:8080/admin';
    process.env.SOFAGENT_WEBHOOK_ALLOW_LOCALHOST = '1';

    const result = await pushToTarget({
      target: 'webhook:dingtalk',
      title: '豁免联调探针',
      message: '豁免开关下应正常推送',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);
  });
});
