// train-webhook.ts · v1.4.5 第一章 · 训练事件三态推送（复用 v1.2.1 webhook）
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
 * SSRF 防护：url 指向内网/本机时拒绝（复用 @sofagent/audit isPrivateWebhookUrl）。
 */
export async function pushTrainEvent(
  target: TrainWebhookTarget | null,
  payload: TrainEventPayload | null,
  options: { push?: PushFn } = {},
): Promise<boolean> {
  if (!target || !payload) return false;
  // SSRF 防护（本文件自带判定——与 @sofagent/audit webhook 同规则：内网/本机/
  // 疑似数字编码 IP 一律拒绝；不 import audit 包避免 engine 间循环依赖）
  const { URL } = await import('url');
  const { isIP } = await import('net');
  let parsed: URL;
  try {
    parsed = new URL(target.url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http' && parsed.protocol !== 'https:') return false;
  const host = parsed.hostname;
  const isPrivateHost =
    /^localhost$/i.test(host) ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    /\.(local|internal|lan|intranet|home)$/i.test(host) ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    (isIP(host) === 0 &&
      host.split('.').some((seg) => /^\d+$/.test(seg) || /^0[xX][0-9a-fA-F]+$/.test(seg)));
  if (isPrivateHost) {
    console.warn(`[sofagent] train webhook URL 指向本机/内网地址，已拒绝推送（SSRF 防护）: ${target.url}`);
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
