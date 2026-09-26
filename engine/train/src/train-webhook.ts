// train-webhook.ts · v1.5.3 第一章 · 训练事件三态推送（复用 v1.2.1 webhook）
//
// 定位：训练完成/失败/取消 → IM 推送（钉钉/飞书/企微）。复用 @sofagent/audit
// 的 pushAuditResult 通道语义（SSRF 防护 + 5s 超时 + fire-and-forget），
// 但载荷是训练事件不是审计结果——独立载荷构建，推送底座同源。
//
// 三态：completed（成功）/ failed（失败）/ cancelled（取消）——checkpointing
// 是暂停不是终态，不推送（推送语义 = 用户需要知道「结果」的时刻）。
//
// fire-and-forget：推送失败不阻断训练主链路（与审计 webhook 同纪律）。

import type { TrainJobRecord } from './train-job';
// v1.4.9 P1-3：SSRF 判定改为**真正复用** @sofagent/audit 的权威实现。
// 依赖方向合规（train L3 → audit L2 在 dependency-direction.yml 允许清单内）；
// train/package.json 本就依赖 @sofagent/audit（train-audit.ts 已静态 import 该包），
// 且 audit 不依赖 train ⇒ 无环。此前本文件自称「复用」实为自带内联副本，两处已漂移。
import { isPrivateWebhookUrl } from '@sofagent/audit';

/** 推送平台（对齐 @sofagent/audit webhook 三平台） */
export type TrainWebhookPlatform = 'dingtalk' | 'feishu' | 'wecom';

/** 三态事件类型（终态——用户需要知道结果的时刻） */
export type TrainEventType = 'completed' | 'failed' | 'cancelled';

/** 推送目标配置（企业级配置——train-env.json 或 config 外部化） */
export interface TrainWebhookTarget {
  platform: TrainWebhookPlatform;
  url: string;
}

/** 推送载荷（IM 文本消息——脱敏口径：不含数据路径/超参细节） */
export interface TrainEventPayload {
  type: TrainEventType;
  jobId: string;
  enterpriseId: string;
  baseModel: string;
  algorithm: string;
  /** 总耗时分钟（有时间对才算） */
  durationMinutes: number | null;
  /** 失败原因（failed 态携带——首段归一化） */
  reason?: string;
}

/** 推送函数注入（测试——默认 fetch 实现） */
export type PushFn = (target: TrainWebhookTarget, body: string) => Promise<boolean>;

/**
 * 构建三态推送文本（人读消息——IM 一行可读）。
 * 脱敏纪律：不含 hyperparams / dataPath（企业数据不进 IM）。
 */
export function buildTrainEventMessage(payload: TrainEventPayload): string {
  const icon = payload.type === 'completed' ? '✅' : payload.type === 'failed' ? '❌' : '⏹️';
  const label = payload.type === 'completed' ? '训练完成' : payload.type === 'failed' ? '训练失败' : '训练取消';
  const lines = [
    `${icon} [sofagent] ${label}`,
    `任务：${payload.jobId}（企业 ${payload.enterpriseId}）`,
    `模型：${payload.baseModel} · 算法 ${payload.algorithm}`,
  ];
  if (payload.durationMinutes !== null) {
    lines.push(`耗时：${payload.durationMinutes} 分钟`);
  }
  if (payload.reason !== undefined && payload.reason !== '') {
    lines.push(`原因：${payload.reason.slice(0, 200)}`);
  }
  return lines.join('\n');
}

/** 从 job 记录提取推送载荷（时长口径：startedAtMs → finishedAt） */
export function extractPayloadFromRecord(record: TrainJobRecord): TrainEventPayload | null {
  if (record.status !== 'completed' && record.status !== 'failed' && record.status !== 'cancelled') {
    return null; // 非终态不推送
  }
  let durationMinutes: number | null = null;
  if (typeof record.startedAtMs === 'number' && record.finishedAt !== undefined) {
    const endMs = Date.parse(record.finishedAt);
    if (!Number.isNaN(endMs) && endMs > record.startedAtMs) {
      durationMinutes = Math.round(((endMs - record.startedAtMs) / 60_000) * 10) / 10;
    }
  }
  return {
    type: record.status,
    jobId: record.jobId,
    enterpriseId: record.enterpriseId,
    baseModel: record.job.baseModel,
    algorithm: record.job.algorithm,
    durationMinutes,
    ...(record.reason !== undefined ? { reason: record.reason } : {}),
  };
}

/** 默认推送实现（fetch + 5s 超时——对齐审计 webhook 底座纪律） */
const defaultPush: PushFn = async (target, body) => {
  try {
    const response = await fetch(target.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false; // fire-and-forget：失败静默（不阻断训练）
  }
};

/**
 * 推送训练终态事件（三态——fire-and-forget）。
 *
 * 目标未配置（null）或载荷为 null（非终态）直接返回 false 不发请求。
 * SSRF 防护：复用 @sofagent/audit `isPrivateWebhookUrl`（v1.4.9 P1-3 起为**真复用**）。
 */
export async function pushTrainEvent(
  target: TrainWebhookTarget | null,
  payload: TrainEventPayload | null,
  options: { push?: PushFn } = {},
): Promise<boolean> {
  if (!target || !payload) return false;
  // v1.4.9 P1-3：替换掉原先的内联 SSRF 副本，改用 @sofagent/audit 的权威实现。
  //
  // 被替换的内联版有三处与 audit 侧漂移（① ② 是产生行为差异的实际缺陷；③ 仅判定
  // 口径不同、无行为差异——列入等值项）：
  //   ① 协议白名单写错：`parsed.protocol !== 'http'` **恒真**（WHATWG 规范下
  //      `URL.protocol` 恒带冒号，取值只可能是 'http:' / 'https:'）⇒
  //      **所有 http:// 端点被静默拒发**（https:// 正常，故既有测试未暴露）。
  //   ② IPv6 未剥方括号：`URL.hostname` 对 IPv6 字面量返回 `[::1]`，内联版拿 `'::1'`
  //      直接比 ⇒ `http://[::1]:8080/admin` 判定穿透。
  //   ③ IPv4 私网判定口径不同：内联版用字符串前缀（`host.startsWith('10.')` /
  //      `'192.168.'`），audit 侧按八位组精确解析。⚠️ 该形态**两侧同拦、无行为差异**
  //      （`10.example.com` 这类数字段标签 audit 侧 fail-closed），已列入下方
  //      「等值 46 项」，**不是**已修掉的放宽/从严项。
  //
  // 合并后的行为差异（**实测清单**——63 条 URL 样本逐个跑两版判定：等值 46 / 从严 8 / 放宽 9）：
  //   放宽 9 项 —— 全部同一根因：`http://` + 公网/合法端点由「静默拒发」改「正常放行」
  //     （http://example.com · http://oapi.dingtalk.com · http://172.15.0.1 ·
  //       http://100.128.0.1 · http://[2001:4860::1] · http://1.2.3.4 …）。
  //     这正是 P1-3 要修的协议白名单 bug：`protocol !== 'http'` 恒真 ⇒ http 一律被挡。
  //     ⚠️ 该 bug 会**掩蔽**下方全部私网判定差异——旧版对任何 http:// 都拒发，
  //     所以私网差异只在 **https://** 侧才暴露（下表 8 项清一色 https）。
  //   从严 8 项 —— 均为 `https://` + 私网/非法主机（旧版放行、新版拒发）：
  //     ① 127.0.0.0/8 全段（旧版只拦 `127.0.0.1` 单点）：https://127.0.0.2 · https://127.1.2.3
  //     ② 169.254.0.0/16 云元数据靶：https://169.254.169.254
  //     ③ 100.64.0.0/10（CGN）：https://100.64.1.1
  //     ④ IPv6 字面量：https://[::1] · [fd00::1] · [fe80::1] · [::ffff:169.254.169.254]
  //        （旧版 `host === '::1'` 对 hostname 取值 `'[::1]'` 永不命中，且无 fc/fd/fe80
  //          与 IPv6-mapped IPv4 判定）
  //   等值 46 项 —— 无行为变化：10/8 · 172.16/12 · 192.168/16 前缀段、localhost、0.0.0.0、
  //     .local/.internal/.lan/.intranet/.home、数字段/0x 段 fail-closed
  //     （`10.example.com` · `2130706433` · `0x7f.0x0.0x0.0x1` 两侧都拦）；
  //     不可解析 URL 两侧都拒（旧版 catch → return false，**不是**放宽项——勿望文生义）。
  // 返回值语义注记：audit 侧 `true` = 内网/非法（拒绝），与内联版 `true` = 可发**相反**，
  // 故此处条件与内联版相反，勿照抄。
  //
  // 未做（属独立决策，不在本批）：接入 audit 的 `verifyWebhookDns` 异步 DNS 复验
  //（DNS rebinding 纵深防御）。它是 fail-closed——离线/受限 CI 下解析失败即拒发，
  // 会把正常推送一并拒掉，影响推送可用性，不能藏进「修一行协议判定」里。
  if (isPrivateWebhookUrl(target.url)) {
    console.warn(`[sofagent] train webhook URL 指向本机/内网或协议非法，已拒绝推送（SSRF 防护）: ${target.url}`);
    return false;
  }
  const push = options.push ?? defaultPush;
  const content = buildTrainEventMessage(payload);
  const body = JSON.stringify(
    target.platform === 'feishu'
      ? { msg_type: 'text', content: { text: content } }
      : { msgtype: 'text', text: { content } },
  );
  return push(target, body);
}
