// ============================================================
// webhook.test.ts · webhook 推送模块测试
// 验证三平台 payload 格式 + 无需推送场景 + 推送内容过滤
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pushAuditResult, isPrivateWebhookUrl } from './webhook';
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

  it('全部 PASS 时也推送（v1.1.3 起 PASS 推送）', async () => {
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

  it('PASS 场景推送（exitCode=0，内容含审计通过）', async () => {
    const mockFetch = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const payload: WebhookPayload = {
      platform: 'dingtalk',
      url: 'https://oapi.dingtalk.com/robot/send?access_token=passtest',
      task: '功能开发完成',
      rules: [passRule],
      exitCode: 0,
    };

    const result = await pushAuditResult(payload);

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.text.content).toContain('✅ sofagent 审计通过');
  });

  it('WARN 场景推送（exitCode=1，内容含警告）', async () => {
    const mockFetch = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const payload: WebhookPayload = {
      platform: 'feishu',
      url: 'https://open.feishu.cn/open-apis/bot/v2/hook/warntest',
      task: '代码优化任务',
      rules: [warnRule],
      exitCode: 1,
    };

    const result = await pushAuditResult(payload);

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.content.text).toContain('⚠️ sofagent 审计警告');
    expect(body.content.text).toContain('A7 不存盲改');
  });

  it('FAIL 场景推送（exitCode=2，内容含拦截）', async () => {
    const mockFetch = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const payload: WebhookPayload = {
      platform: 'wecom',
      url: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=failtest',
      task: '安全修复',
      rules: [failRule],
      exitCode: 2,
    };

    const result = await pushAuditResult(payload);

    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.text.content).toContain('⚠️ sofagent 审计警告');
    expect(body.text.content).toContain('A3 不改越界');
  });

  // ── P2-4: SSRF 防护 ──
  it('P2-4: 内网/本机 webhook URL 被拒绝且不发起请求', async () => {
    const mockFetch = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const payload: WebhookPayload = {
      platform: 'feishu',
      url: 'http://127.0.0.1:8080/admin',
      rules: [failRule],
      exitCode: 2,
    };
    const result = await pushAuditResult(payload);
    expect(result).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('P2-4: 私网 IP（10.x/192.168.x）被拒绝', async () => {
    const mockFetch = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const payload: WebhookPayload = {
      platform: 'dingtalk',
      url: 'http://192.168.1.10/hook',
      rules: [failRule],
      exitCode: 2,
    };
    const result = await pushAuditResult(payload);
    expect(result).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('P2-4: 公网 webhook（oapi.dingtalk.com）正常放行', async () => {
    const mockFetch = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const payload: WebhookPayload = {
      platform: 'dingtalk',
      url: 'https://oapi.dingtalk.com/robot/send?access_token=abc',
      rules: [failRule],
      exitCode: 2,
    };
    const result = await pushAuditResult(payload);
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // ── P1-58: IPv6 字面量 SSRF 防护——URL 解析后 hostname 对 IPv6 保留方括号
  // （[::1]），isIP 判 0 会误入公共域名分支整体放行，下方全部 IPv6 防御不可达。
  // 修复：剥方括号后再判定。向量覆盖报告实测放行的 4 类攻击形态。
  describe('P1-58 · IPv6 字面量 SSRF 防护', () => {
    it('回环 [::1] 被拦截', () => {
      expect(isPrivateWebhookUrl('http://[::1]:8080/admin')).toBe(true);
    });

    it('v4-mapped 云元数据靶 [::ffff:169.254.169.254] 被拦截', () => {
      expect(isPrivateWebhookUrl('http://[::ffff:169.254.169.254]/latest/meta-data/')).toBe(true);
    });

    it('ULA [fd00::1] 被拦截', () => {
      expect(isPrivateWebhookUrl('http://[fd00::1]:8080/')).toBe(true);
    });

    it('链路本地 [fe80::1] 被拦截', () => {
      expect(isPrivateWebhookUrl('http://[fe80::1]/')).toBe(true);
    });

    it('公网 IPv6 [2001:4860::1] 正常放行（对照组）', () => {
      expect(isPrivateWebhookUrl('http://[2001:4860::1]/hook')).toBe(false);
    });

    it('pushAuditResult 集成：[::1] URL 拒绝且不发起请求', async () => {
      const mockFetch = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
      const payload: WebhookPayload = {
        platform: 'feishu',
        url: 'http://[::1]:9090/hook',
        rules: [failRule],
        exitCode: 2,
      };
      const result = await pushAuditResult(payload);
      expect(result).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ── v1.4.2 G-07: payload.task 脱敏——task 由 Agent 自由文本生成，
  // 可含密钥，推送出网前必须过 redactDetail 管道（与 details 同口径）
  describe('G-07 · payload.task 推送脱敏', () => {
    // 密钥样本运行时拼接（铁律：测试不字面写真实格式密钥）
    const leakyTask = 'key=' + 'sk-abc' + '123def456ghi789jkl012mno345';

    it('FAIL 分支：task 含 sk- 密钥 → 推送内容不含明文（含 REDACTED）', async () => {
      const mockFetch = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
      const payload: WebhookPayload = {
        platform: 'dingtalk',
        url: 'https://oapi.dingtalk.com/robot/send?access_token=g07',
        task: leakyTask,
        rules: [failRule],
        exitCode: 2,
      };
      await pushAuditResult(payload);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.text.content).not.toContain(leakyTask);
      expect(body.text.content).toContain('REDACTED');
    });

    it('PASS 分支：task 含 sk- 密钥 → 推送内容不含明文', async () => {
      const mockFetch = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
      const payload: WebhookPayload = {
        platform: 'dingtalk',
        url: 'https://oapi.dingtalk.com/robot/send?access_token=g07p',
        task: leakyTask,
        rules: [passRule],
        exitCode: 0,
      };
      await pushAuditResult(payload);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.text.content).not.toContain(leakyTask);
      expect(body.text.content).toContain('REDACTED');
    });

    it('正常 task 文本 → 原样推送不受影响', async () => {
      const mockFetch = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
      const payload: WebhookPayload = {
        platform: 'dingtalk',
        url: 'https://oapi.dingtalk.com/robot/send?access_token=g07n',
        task: '修复报价计算逻辑',
        rules: [failRule],
        exitCode: 2,
      };
      await pushAuditResult(payload);
      const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.text.content).toContain('修复报价计算逻辑');
    });
  });
});
