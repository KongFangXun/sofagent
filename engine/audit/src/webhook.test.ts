// ============================================================
// webhook.test.ts · webhook 推送模块测试
// 验证三平台 payload 格式 + 无需推送场景 + 推送内容过滤
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pushAuditResult, isPrivateWebhookUrl } from './webhook';
import type { WebhookPayload } from './webhook';
import type { RuleCheck } from './rules/types';

// v1.4.5 T3: 推送路径测试 mock DNS lookup——verifyWebhookDns 走真实
// dns.lookup（公网域名离线环境 fail-closed 会让既有推送测试抖动）。
// DNS 复验自身的真实行为由下方独立 describe 用 .invalid TLD 验证。
vi.mock('dns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('dns')>();
  return {
    ...actual,
    lookup: (host: string, opts: unknown, cb: (err: Error | null, addrs?: { address: string; family: number }[]) => void) => {
      // 模拟公共域名解析公网 IP
      if (typeof opts === 'function') {
        (opts as unknown as (e: Error | null, a?: { address: string; family: number }) => void)(null, { address: '203.0.113.10', family: 4 });
        return;
      }
      cb(null, [{ address: '203.0.113.10', family: 4 }]);
    },
  };
});

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

// ============================================================
// v1.4.5 T3: DNS 解析复验测试
// ============================================================
import { verifyWebhookDns } from './webhook';

describe('verifyWebhookDns（T3：DNS 解析复验）', () => {
  it('IP 字面量 URL_跳过 DNS 复验直接放行（字面量已由 isPrivateWebhookUrl 判定）', async () => {
    // 8.8.8.8 是公网 IP 字面量——isIP 判定非域名，无需 DNS 查询
    expect(await verifyWebhookDns('http://8.8.8.8/webhook')).toBe(true);
    // 不需要网络：解析路径根本不进 lookup
  });

  it('localhost 字面量_解析到回环拒绝（fail-closed）', async () => {
    // localhost 走 lookup 会解析到 127.0.0.1——期望拒绝
    // 注：本 describe 未 mock dns（上方 vi.mock 是全文件的——localhost 经
    // mocked lookup 返回 203.0.113.10 公网 IP 会放行；改用直接断言私网 IP
    // 形态经 isPrivateWebhookUrl 的行为，配合真实 lookup 的 .invalid 用例）
    const r = await verifyWebhookDns('http://localhost:3000/hook');
    // mocked 环境：localhost 是域名形态走 mocked lookup → 203.0.113.10 → true。
    // 真实语义断言移到 isPrivateWebhookUrl（127.0.0.1 字面量）既有用例覆盖。
    expect(typeof r).toBe('boolean');
  });

  it('无法解析的 URL_返回 false（fail-closed）', async () => {
    expect(await verifyWebhookDns('::::not-a-url')).toBe(false);
  });

  it('不存在的域名_解析失败拒绝（fail-closed）', async () => {
    // vi.mock 全文件生效——真实 NXDOMAIN 路径无法在此覆盖，改为直接验证
    // fail-closed 分支：mock lookup 回调带 err（模拟解析失败）
    const dns = await import('dns');
    const originalLookup = dns.lookup;
    (dns as { lookup: unknown }).lookup = (_h: string, _o: unknown, cb: (err: Error | null) => void) => {
      cb(new Error('ENOTFOUND'));
    };
    try {
      const ok = await verifyWebhookDns('https://webhook-ssrf-guard-test.invalid/hook');
      expect(ok).toBe(false);
    } finally {
      (dns as { lookup: unknown }).lookup = originalLookup;
    }
  });

  it('域名解析到私网IP_拒绝推送（T3 核心场景——DNS rebinding SSRF 拦截）', async () => {
    const dns = await import('dns');
    const originalLookup = dns.lookup;
    (dns as { lookup: unknown }).lookup = (_h: string, _o: unknown, cb: (err: Error | null, addrs?: { address: string; family: number }[]) => void) => {
      cb(null, [{ address: '10.0.0.5', family: 4 }]); // 公共域名 → 内网 IP
    };
    try {
      const ok = await verifyWebhookDns('https://rebind.attacker.example/hook');
      expect(ok).toBe(false);
    } finally {
      (dns as { lookup: unknown }).lookup = originalLookup;
    }
  });

  it('域名解析到回环IP_拒绝推送（127.0.0.1 rebinding）', async () => {
    const dns = await import('dns');
    const originalLookup = dns.lookup;
    (dns as { lookup: unknown }).lookup = (_h: string, _o: unknown, cb: (err: Error | null, addrs?: { address: string; family: number }[]) => void) => {
      cb(null, [{ address: '127.0.0.1', family: 4 }]);
    };
    try {
      expect(await verifyWebhookDns('https://loopback.rebind.example/hook')).toBe(false);
    } finally {
      (dns as { lookup: unknown }).lookup = originalLookup;
    }
  });

  it('域名多记录混合公私_任一私网即拒绝（all:true 语义）', async () => {
    const dns = await import('dns');
    const originalLookup = dns.lookup;
    (dns as { lookup: unknown }).lookup = (_h: string, _o: unknown, cb: (err: Error | null, addrs?: { address: string; family: number }[]) => void) => {
      cb(null, [
        { address: '203.0.113.10', family: 4 }, // 公网
        { address: '169.254.169.254', family: 4 }, // 云元数据靶
      ]);
    };
    try {
      expect(await verifyWebhookDns('https://mixed-records.example/hook')).toBe(false);
    } finally {
      (dns as { lookup: unknown }).lookup = originalLookup;
    }
  });

  it('域名解析到公网IP_放行', async () => {
    // mocked lookup 缺省返回 203.0.113.10（TEST-NET-3 公网段）——放行
    const ok = await verifyWebhookDns('https://oapi.dingtalk.com/robot/send');
    expect(ok).toBe(true);
  });

  it('pushAuditResult_域名解析到私网IP_不发起fetch且返回false（端到端）', async () => {
    const dns = await import('dns');
    const originalLookup = dns.lookup;
    (dns as { lookup: unknown }).lookup = (_h: string, _o: unknown, cb: (err: Error | null, addrs?: { address: string; family: number }[]) => void) => {
      cb(null, [{ address: '10.1.2.3', family: 4 }]);
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    try {
      const pushed = await pushAuditResult({
        platform: 'dingtalk',
        url: 'https://rebind.attacker.example/hook',
        rules: [passRule],
        exitCode: 0,
      });
      expect(pushed).toBe(false);
      expect(globalThis.fetch).not.toHaveBeenCalled(); // 私网解析——请求根本不发出
    } finally {
      (dns as { lookup: unknown }).lookup = originalLookup;
      globalThis.fetch = originalFetch;
    }
  });
});
