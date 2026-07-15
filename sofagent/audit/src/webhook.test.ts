// ============================================================
// webhook.test.ts · webhook 推送模块测试
// 验证三平台 payload 格式 + 无需推送场景 + 推送内容过滤
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pushAuditResult } from './webhook';
import type { WebhookPayload } from './webhook';
import type { RuleCheck } from './rules/types';

/** 构造 RuleCheck 辅助函数 */
function makeRule(
  name: string,
  number: number,
  status: RuleCheck['status'],
  details: string[]
): RuleCheck {
  return { name, number, status, details };
}

const failRule = makeRule('不改越界', 3, 'FAIL', ['2 个文件不在任务范围内']);
const warnRule = makeRule('不存盲改', 7, 'WARN', ['task/logs 未找到本次任务记录']);
const passRule = makeRule('不碰敏感', 1, 'PASS', []);

describe('webhook', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('钉钉 payload 格式正确', async () => {
    const mockFetch = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const payload: WebhookPayload = {
      platform: 'dingtalk',
      url: 'https://oapi.dingtalk.com/robot/send?access_token=test',
      task: '测试任务',
      rules: [failRule],
      exitCode: 2,
    };

    await pushAuditResult(payload);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0]!;
    expect(url).toBe(payload.url);
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.msgtype).toBe('text');
    expect(body.text.content).toContain('⚠️ sofagent 审计警告');
    expect(body.text.content).toContain('A3 不改越界');
  });

  it('飞书 payload 格式正确', async () => {
    const mockFetch = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const payload: WebhookPayload = {
      platform: 'feishu',
      url: 'https://open.feishu.cn/open-apis/bot/v2/hook/test',
      task: '测试任务',
      rules: [failRule],
      exitCode: 2,
    };

    await pushAuditResult(payload);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, options] = mockFetch.mock.calls[0]!;
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.msg_type).toBe('text');
    expect(body.content.text).toContain('⚠️ sofagent 审计警告');
  });

  it('企微 payload 格式正确', async () => {
    const mockFetch = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const payload: WebhookPayload = {
      platform: 'wecom',
      url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test',
      task: '测试任务',
      rules: [failRule],
      exitCode: 2,
    };

    await pushAuditResult(payload);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, options] = mockFetch.mock.calls[0]!;
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.msgtype).toBe('text');
    expect(body.text.content).toContain('⚠️ sofagent 审计警告');
  });

  it('全部 PASS 时也推送（v1.1.1 起 PASS 推送）', async () => {
    const mockFetch = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const payload: WebhookPayload = {
      platform: 'dingtalk',
      url: 'https://example.com/webhook',
      rules: [passRule],
      exitCode: 0,
    };

    const result = await pushAuditResult(payload);

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.text.content).toContain('✅ sofagent 审计通过');
  });

  it('有 FAIL 时推送并验证 URL 和 body', async () => {
    const mockFetch = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const payload: WebhookPayload = {
      platform: 'dingtalk',
      url: 'https://oapi.dingtalk.com/robot/send?access_token=abc123',
      task: '修复报价计算逻辑',
      rules: [failRule, warnRule, passRule],
      exitCode: 2,
    };

    const result = await pushAuditResult(payload);

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0]!;
    expect(url).toBe(payload.url);
    const body = JSON.parse((options as RequestInit).body as string);
    // 只包含 FAIL 和 WARN，不含 PASS
    expect(body.text.content).toContain('A3 不改越界');
    expect(body.text.content).toContain('A7 不存盲改');
    expect(body.text.content).not.toContain('A1');
    expect(body.text.content).toContain('修复报价计算逻辑');
  });
});
