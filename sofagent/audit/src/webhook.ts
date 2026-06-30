// ============================================================
// webhook.ts · 审计结果 webhook 推送
// 支持 钉钉/飞书/企微 三平台，用 Node.js 内置 fetch
// fire-and-forget：失败不阻塞审计流程
// ============================================================

import type { RuleCheck } from './rules/types';

export type WebhookPlatform = 'dingtalk' | 'feishu' | 'wecom';

export interface WebhookPayload {
  platform: WebhookPlatform;
  url: string;
  task?: string;
  rules: RuleCheck[];
  exitCode: number;
}

/**
 * 构建消息文本内容
 * 只包含 FAIL 和 WARN 的规则，PASS 不推
 */
function buildContent(payload: WebhookPayload, failedRules: RuleCheck[]): string {
  const lines: string[] = ['⚠️ sofagent 审计警告'];
  if (payload.task) {
    lines.push(`任务：${payload.task}`);
  }
  for (const rule of failedRules) {
    lines.push(`A${rule.number} ${rule.name}：${rule.details.join('；')}`);
  }
  lines.push(`详情：exit code ${payload.exitCode}`);
  return lines.join('\n');
}

/**
 * 按平台适配请求体格式
 */
function buildRequestBody(platform: WebhookPlatform, content: string): Record<string, unknown> {
  switch (platform) {
    case 'dingtalk':
      return { msgtype: 'text', text: { content } };
    case 'feishu':
      return { msg_type: 'text', content: { text: content } };
    case 'wecom':
      return { msgtype: 'text', text: { content } };
  }
}

/**
 * 推送审计结果到 webhook
 * 只在有 FAIL 或 WARN 时推送
 * 超时 5 秒，超时/失败 silently return false
 * @returns true 推送成功, false 推送失败或无需推送
 */
export async function pushAuditResult(payload: WebhookPayload): Promise<boolean> {
  // 过滤出 FAIL 和 WARN 的规则
  const failedRules = payload.rules.filter(
    (r) => r.status === 'FAIL' || r.status === 'WARN'
  );
  if (failedRules.length === 0) {
    return false;
  }

  const content = buildContent(payload, failedRules);
  const body = buildRequestBody(payload.platform, content);

  try {
    const response = await fetch(payload.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    // 超时或网络错误：silently fail，不阻塞审计流程
    return false;
  }
}
