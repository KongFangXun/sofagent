// train-webhook-ssrf.test.ts · v1.4.9 P1-3 · train webhook SSRF 判定与 @sofagent/audit 对齐锁
//
// 背景：train-webhook.ts 此前**自称**复用 @sofagent/audit 的 isPrivateWebhookUrl，实际是
// 自带一份内联副本，且把协议白名单写成 `parsed.protocol !== 'http'`（WHATWG 下恒真）
// ⇒ **所有 http:// 端点被静默拒发**。既有 train-monitor.test.ts 的正例只用 https://，
// 故该 bug 长期假绿。v1.4.9 P1-3 改为真复用，本文件锁死三件事：
//   ① http:// 公网端点必须放行（原 bug 的正面回归锁，反向注入可测出红）
//   ② 非 http/https · 不可解析 · 内网/回环/链路本地/CGN/IPv6 字面量必须拒发
//   ③ train 判定与 audit 判定**逐 URL 同结果**（SSOT 派生，防两处再漂移）

import { describe, it, expect, vi, afterEach } from 'vitest';
import { isPrivateWebhookUrl } from '@sofagent/audit';
import { pushTrainEvent, type TrainEventPayload, type TrainWebhookTarget } from '../train-webhook';

const PAYLOAD: TrainEventPayload = {
  type: 'completed',
  jobId: 'j',
  enterpriseId: 'e',
  baseModel: 'm',
  algorithm: 'sft',
  durationMinutes: null,
};

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * 探针：push 注入函数**是否真的被调用** = SSRF 判定是否放行的可观测出口。
 * 返回 true = 放行（发了请求），false = 拒发。
 */
async function isAllowed(url: string): Promise<boolean> {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  let called = false;
  const target: TrainWebhookTarget = { platform: 'dingtalk', url };
  const ok = await pushTrainEvent(target, PAYLOAD, {
    push: async () => {
      called = true;
      return true;
    },
  });
  // 判定放行必然走到 push；判定拒发必然 return false 且 push 未被调用
  expect(ok).toBe(called);
  return called;
}

describe('v1.4.9 P1-3：train webhook SSRF 与 @sofagent/audit 对齐', () => {
  it('① http:// 公网端点必须放行（内联版 protocol !== \'http\' 恒真把它全拒了）', async () => {
    expect(await isAllowed('http://example.com/hook')).toBe(true);
  });

  it('① https:// 公网端点放行（不回归既有行为）', async () => {
    expect(await isAllowed('https://oapi.dingtalk.com/robot/send?access_token=x')).toBe(true);
  });

  it('② 非 http/https 协议拒发（file: / ftp:）', async () => {
    expect(await isAllowed('file:///tmp/x')).toBe(false);
    expect(await isAllowed('ftp://example.com/x')).toBe(false);
  });

  it('② 不可解析 URL 拒发（fail-closed；注：旧版此处也拒，非本次放宽/从严项）', async () => {
    expect(await isAllowed('not-a-url')).toBe(false);
    expect(await isAllowed('')).toBe(false);
  });

  it('② 私网/回环/链路本地/CGN 拒发（用 https://——旧版协议 bug 会掩蔽 http:// 侧的私网判定，见下注）', async () => {
    // 注：旧内联版把 `protocol !== 'http'` 写错 ⇒ 任何 http:// 都被拒发，
    // 于是「私网判定本身漏没漏」在 http:// 侧**看不出来**。必须用 https:// 才能
    // 检验私网规则；本用例覆盖的 127.0.0.2 / 169.254.169.254 / 100.64.1.1
    // 正是旧版判定真实漏掉的三类（旧版放行、新版拒发）。
    for (const url of [
      'https://127.0.0.1:8080/hook', // 旧版也拦（单点）
      'https://127.0.0.2:8080/hook', // 旧版**漏**（只比对 127.0.0.1 单点，无 127/8 全段）
      'https://127.1.2.3/hook', // 旧版**漏**（同上）
      'https://169.254.169.254/latest/meta-data/', // 旧版**漏**（云元数据靶）
      'https://100.64.1.1/hook', // 旧版**漏**（CGN 100.64/10）
      'https://10.0.0.5/hook',
      'https://192.168.1.10/hook',
      'https://172.16.0.9/hook',
      'https://0.0.0.0/hook',
      'https://localhost:3000/hook',
      'https://svc.internal/hook',
      'https://example.local/hook',
      // http:// 侧也要拒（协议修好后不能把私网判定一起放跑）
      'http://127.0.0.1:8080/hook',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.5/hook',
    ]) {
      expect(await isAllowed(url), `${url} 应拒发`).toBe(false);
    }
  });

  it('② IPv6 字面量拒发（旧版未剥方括号 ⇒ hostname 取值 [::1] 与 ::1 永不相等，判定穿透）', async () => {
    for (const url of [
      'https://[::1]:8080/admin', // 旧版漏：hostname 是 '[::1]'
      'https://[fd00::1]:8080/hook', // 旧版漏（IPv6 私网）
      'https://[fe80::1]/hook', // 旧版漏（IPv6 链路本地）
      'https://[::ffff:169.254.169.254]/latest/', // 旧版漏（IPv6-mapped 云元数据）
      'http://[::1]:8080/admin', // http 侧（旧版靠协议 bug 误挡，非判定之功）
    ]) {
      expect(await isAllowed(url), `${url} 应拒发`).toBe(false);
    }
  });

  it('③ SSOT 对齐：判定结果与 @sofagent/audit isPrivateWebhookUrl 逐 URL 一致（防再漂移）', async () => {
    // 样本表不手写「期望值」——期望值由 audit 侧**本身**派生，两侧口径只能一起动
    const urls = [
      'http://example.com/hook',
      'https://oapi.dingtalk.com/robot/send?access_token=x',
      'https://open.feishu.cn/open-apis/bot/v2/hook/x',
      'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x',
      'http://10.example.com/hook', // 数字段标签：两侧都拦（fail-closed），非放宽项
      'http://192.168.example.com/hook',
      'http://example.local/hook',
      'file:///tmp/x',
      'ftp://example.com/x',
      'not-a-url',
      'http://127.0.0.1:8080/hook',
      'http://127.0.0.2:8080/hook',
      'http://169.254.169.254/latest/meta-data/',
      'http://100.64.1.1/hook',
      'http://10.0.0.5/hook',
      'http://192.168.1.10/hook',
      'http://172.31.255.254/hook',
      'http://172.15.0.1/hook', // 172.15 不在 172.16/12 内 —— 公网段
      'http://0.0.0.0/hook',
      'http://localhost:3000/hook',
      'http://svc.internal/hook',
      'http://[::1]:8080/admin',
      'http://[fd00::1]:8080/hook',
      'http://[fe80::1]/hook',
      'http://[::ffff:169.254.169.254]/latest/',
      'http://[2001:4860::1]/hook', // 公网 IPv6
    ];
    const drift: string[] = [];
    for (const url of urls) {
      const auditBlocks = isPrivateWebhookUrl(url);
      const trainAllows = await isAllowed(url);
      if (trainAllows === auditBlocks) {
        // train 放行 ⇔ audit 不拦；train 拒发 ⇔ audit 拦
        drift.push(`${url}: audit${auditBlocks ? '拦' : '放'} / train${trainAllows ? '放' : '拒'}`);
      }
    }
    expect(drift, `train 与 audit 判定漂移：\n${drift.join('\n')}`).toEqual([]);
  });
});
