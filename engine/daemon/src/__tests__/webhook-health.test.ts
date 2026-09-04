// ============================================================
// webhook-health.test.ts · v1.4.5 T9：webhook 告警通道健康盲区
// ============================================================
//
// 问题：webhook 是「告警的通道」，但通道自己挂了没人知道——
//       push 失败只降级本地 jsonl，健康面板（daemon-health.json）
//       不感知。告警系统对自身故障静默 = 告警盲区。
//
// 修复：pusher 成功/失败后经 writeHealthFile 透传 webhook 通道健康
//       （lastSuccessAt / lastError 摘要），心跳不擦除（daemon-health
//       T9 字段已加）。另：dist 版本戳校验（推送侧 WARN）。
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createWebhookPusher, readWebhookChannelHealth } from '../webhook/index';

describe('Webhook 通道健康（v1.4.5 T9）', () => {
  let tmp: { dir: string; logPath: string };
  let savedData: string | undefined;

  beforeEach(() => {
    tmp = {
      dir: fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-webhook-health-')),
      logPath: '',
    };
    tmp.logPath = path.join(tmp.dir, 'webhook-fallback.log');
    savedData = process.env.SOFAGENT_DATA;
    process.env.SOFAGENT_DATA = tmp.dir;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (savedData === undefined) delete process.env.SOFAGENT_DATA;
    else process.env.SOFAGENT_DATA = savedData;
    try { fs.rmSync(tmp.dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  const makeEnv = () => ({
    SOFAGENT_WEBHOOK_FEISHU: 'https://open.feishu.cn/hook/fake-key',
    SOFAGENT_WEBHOOK_DINGTALK: 'https://oapi.dingtalk.com/robot/send?access_token=fake',
    SOFAGENT_WEBHOOK_WECOM: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=fake',
  });

  it('test_push成功_通道健康记录lastSuccessAt', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const pusher = createWebhookPusher({ env: makeEnv(), logPath: tmp.logPath });
    const result = await pusher.push('feishu', 'PASS', '探针消息');

    expect(result.success).toBe(true);
    // 通道健康落盘：lastSuccessAt 非 null，无失败摘要
    const health = readWebhookChannelHealth(tmp.dir);
    expect(health).not.toBeNull();
    expect(health!.lastSuccessAt).not.toBeNull();
    expect(health!.lastError).toBeNull();
  });

  it('test_push失败降级_通道健康记录lastError摘要', async () => {
    // 401 = 鉴权失败（permanent）——降级本地日志
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    const pusher = createWebhookPusher({ env: makeEnv(), logPath: tmp.logPath });
    const result = await pusher.push('feishu', 'WARN', '探针消息');

    expect(result.success).toBe(false);
    expect(result.degraded).toBe(true);
    // 通道健康落盘：失败摘要含平台名 + 状态码
    const health = readWebhookChannelHealth(tmp.dir);
    expect(health).not.toBeNull();
    expect(health!.lastError).toContain('feishu');
    expect(health!.lastError).toContain('401');
    // 此前无成功 → lastSuccessAt 为 null
    expect(health!.lastSuccessAt).toBeNull();
  });

  it('test_成功后失败_lastSuccessAt保留不覆盖为null', async () => {
    // 第一次成功
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    const pusher = createWebhookPusher({ env: makeEnv(), logPath: tmp.logPath });
    await pusher.push('feishu', 'PASS', '第一条');

    // 第二次失败（断网）
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND')));
    await pusher.push('feishu', 'FAIL', '第二条');

    const health = readWebhookChannelHealth(tmp.dir);
    // 成功时间保留（不因后续失败清空）+ 失败摘要更新
    expect(health!.lastSuccessAt).not.toBeNull();
    expect(health!.lastError).toContain('ENOTFOUND');
  });

  it('test_健康文件不存在_readWebhookChannelHealth返回null不抛错', () => {
    // daemon-health.json 不存在（daemon 未启动）→ null，不抛
    expect(() => readWebhookChannelHealth(tmp.dir)).not.toThrow();
    expect(readWebhookChannelHealth(tmp.dir)).toBeNull();
  });
});
