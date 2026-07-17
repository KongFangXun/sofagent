// ============================================================
// webhook.ts · 审计结果 webhook 推送
// 支持 钉钉/飞书/企微 三平台，用 Node.js 内置 fetch
// fire-and-forget：失败不阻塞审计流程
// ============================================================

import type { RuleCheck } from './rules/types';
import { VERSION } from '@sofagent/core';

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
 * v1.1.3: PASS 也推送；所有消息以 sofagent 开头
 */
function buildContent(payload: WebhookPayload, failedRules: RuleCheck[], isPass: boolean): string {
  const version = VERSION;

  if (isPass) {
    const lines: string[] = ['✅ sofagent 审计通过'];
    if (payload.task) {
      lines.push(`任务：${payload.task}`);
    }
    lines.push(`扫描 ${payload.rules.length} 条规则全部通过`);
    lines.push(`审计引擎: sofagent-audit v${version}`);
    return lines.join('\n');
  }

  const lines: string[] = ['⚠️ sofagent 审计警告'];
  if (payload.task) {
    lines.push(`任务：${payload.task}`);
  }
  for (const rule of failedRules) {
    lines.push(`A${rule.number} ${rule.name}：${rule.details.join('；')}`);
  }
  lines.push(`详情：exit code ${payload.exitCode}`);
  lines.push(`审计引擎: sofagent-audit v${version}`);
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
 * v1.1.3: PASS 也推送（之前只在 WARN/FAIL 时推送）
 * 超时 5 秒，超时/失败 silently return false
 * @returns true 推送成功, false 推送失败
 */
export async function pushAuditResult(payload: WebhookPayload): Promise<boolean> {
  // v1.1.3: 过滤 FAIL/WARN 规则用于消息构建，但 PASS 也推送
  const failedRules = payload.rules.filter(
    (r) => r.status === 'FAIL' || r.status === 'WARN'
  );
  const isPass = failedRules.length === 0;

  const content = buildContent(payload, failedRules, isPass);
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
