// ============================================================
// webhook.ts · 审计结果 webhook 推送
// 支持 钉钉/飞书/企微 三平台，用 Node.js 内置 fetch
// fire-and-forget：失败不阻塞审计流程
// ============================================================

import type { RuleCheck } from './rules/types';
import { VERSION, REDACTION_PATTERNS } from '@sofagent/core';
import { URL } from 'url';
import { isIP } from 'net';
import { execSync } from 'child_process';
import { hostname } from 'os';
import { cwd } from 'process';

export type WebhookPlatform = 'dingtalk' | 'feishu' | 'wecom';

export interface WebhookPayload {
  platform: WebhookPlatform;
  url: string;
  task?: string;
  rules: RuleCheck[];
  exitCode: number;
}

/**
 * P2-4: SSRF 防护——webhook URL 指向本机/内网时拒绝推送。
 * 审计数据（可能含文件路径/代码片段）不应被投递到内网服务：
 * 恶意 Agent 若可写 config.yml 的 webhook.url，就能把审计数据 POST 到
 * 内网管理端口（如 http://127.0.0.1:8080/admin）。
 * 规则：http/https + 非回环/非私网/非链路本地/非内网域名后缀。
 */
export function isPrivateWebhookUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return true; // 无法解析 → 拒绝
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
  const host = parsed.hostname;
  if (/^localhost$/i.test(host)) return true;
  if (/\.(local|internal|lan|intranet|home)$/i.test(host)) return true;
  const ipType = isIP(host);
  if (ipType === 0) {
    // v1.2.6: fail-closed——虽然 isIP 判定为非 IP（公共域名），但仍需防
    // 十进制/八进制/十六进制 IP 伪装（如 0x7f.0x0.0x0.0x1 或 2130706433）。
    // 这类 host 被 isIP 判为 0（非标准 IP 字面量），但实际解析为内网地址。
    // 含纯数字段或 0x 开头段的 host 一律拒绝（return true = 拦截）。
    const segments = host.split('.');
    for (const seg of segments) {
      if (/^\d+$/.test(seg) || /^0[xX][0-9a-fA-F]+$/.test(seg)) {
        return true; // fail-closed：疑似数字编码 IP，拦截
      }
    }
    return false; // 公共域名（钉钉/飞书/企微官方域名都是公网）放行
  }
  // IP 字面量
  if (host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') return true;
  if (ipType === 4) {
    const parts = host.split('.').map(Number);
    const a = parts[0] ?? 0;
    const b = parts[1] ?? 0;
    if (a === 10) return true;                      // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true;        // 192.168.0.0/16
    if (a === 169 && b === 254) return true;        // 169.254.0.0/16 链路本地
    if (a === 127) return true;                     // 127.0.0.0/8
  }
  // IPv6 私网/链路本地简判
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return true;
  return false;
}

/**
 * v1.2.6: 脱敏辅助——webhook 推送到第三方平台前，对审计详情做敏感信息脱敏。
 * 复用 @sofagent/core 的 REDACTION_PATTERNS（与审计引擎内部脱敏口径一致）。
 */
/**
 * v1.2.8 P1-5: 支持自定义脱敏正则（config.yml sanitizePatterns）
 */
function redactDetail(detail: string, customPatterns?: { pattern: RegExp; replacement: string }[]): string {
  let redacted = detail;
  for (const { pattern, replacement } of REDACTION_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  if (customPatterns) {
    for (const { pattern, replacement } of customPatterns) {
      try {
        redacted = redacted.replace(pattern, replacement);
      } catch {
        // 无效正则跳过
      }
    }
  }
  return redacted;
}

/**
 * 获取溯源信息（仓库路径 / commit SHA / 机器标识）
 * 用于企业集中告警场景定位告警来源
 */
function getTracingContext(): { repo: string; sha: string; machine: string } {
  let repo = '';
  let sha = '';
  try {
    repo = execSync('git rev-parse --show-toplevel 2>/dev/null', { encoding: 'utf-8' }).trim() || cwd();
  } catch {
    repo = cwd();
  }
  try {
    sha = execSync('git rev-parse --short HEAD 2>/dev/null', { encoding: 'utf-8' }).trim() || '';
  } catch {
    sha = '';
  }
  const machine = process.env.SOFAGENT_MACHINE_ID || hostname();
  return { repo, sha, machine };
}

/**
 * 构建消息文本内容
 * v1.1.3: PASS 也推送；所有消息以 sofagent 开头
 * v1.2.6: 推送前对审计详情脱敏（防止密钥/凭证泄露到钉钉/飞书/企微）
 * v1.2.7: 追加溯源字段（仓库路径 / commit SHA / 机器标识）
 */
function buildContent(payload: WebhookPayload, failedRules: RuleCheck[], isPass: boolean, customPatterns?: { pattern: RegExp; replacement: string }[]): string {
  const version = VERSION;
  const tracing = getTracingContext();
  // v1.2.8: P1-7 — 增加 actor（OS 用户 + git 提交者）
  const osUser = require('os').userInfo().username;
  let gitAuthor = 'N/A';
  try {
    gitAuthor = require('child_process').execSync('git config user.name', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() || 'N/A';
  } catch { /* 非 git 仓库或无配置 */ }
  const actor = `操作者: ${osUser} (git: ${gitAuthor})`;
  const tracingLine = `仓库: ${tracing.repo} | 提交: ${tracing.sha || 'N/A'} | 机器: ${tracing.machine} | ${actor}`;

  if (isPass) {
    const lines: string[] = ['✅ sofagent 审计通过'];
    if (payload.task) {
      lines.push(`任务：${payload.task}`);
    }
    lines.push(`扫描 ${payload.rules.length} 条规则全部通过`);
    lines.push(tracingLine);
    lines.push(`审计引擎: sofagent-audit v${version}`);
    return lines.join('\n');
  }

  const lines: string[] = ['⚠️ sofagent 审计警告'];
  if (payload.task) {
    lines.push(`任务：${payload.task}`);
  }
  for (const rule of failedRules) {
    lines.push(`A${rule.number} ${rule.name}：${rule.details.map((d: string) => redactDetail(d, customPatterns)).join('；')}`);
  }
  lines.push(`详情：exit code ${payload.exitCode}`);
  lines.push(tracingLine);
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
export async function pushAuditResult(payload: WebhookPayload, customPatterns?: { pattern: RegExp; replacement: string }[]): Promise<boolean> {
  // 测试豁免开关：仅供测试环境使用。
  // 验收测试（acceptance-test.sh 场景 34/34b/34c）用 localhost mock server 接收
  // webhook 推送做断言，而该地址会被下方 SSRF 防护拦截。显式设置
  // SOFAGENT_WEBHOOK_ALLOW_LOCALHOST=1 时跳过 SSRF 检查，便于测试环境放行 localhost。
  // 默认（未设置该变量）行为不变，生产环境 SSRF 防护不受影响。
  const allowLocalhost = process.env.SOFAGENT_WEBHOOK_ALLOW_LOCALHOST === '1';

  // P2-4: SSRF 防护——内网/本机 URL 直接拒绝，不发起请求（测试豁免模式下跳过）
  if (!allowLocalhost && isPrivateWebhookUrl(payload.url)) {
    console.warn(`[sofagent] webhook URL 指向本机/内网地址，已拒绝推送（SSRF 防护）: ${payload.url}`);
    return false;
  }
  if (allowLocalhost && isPrivateWebhookUrl(payload.url)) {
    console.warn(`[sofagent] 测试豁免模式（SOFAGENT_WEBHOOK_ALLOW_LOCALHOST=1）：放行本机/内网 webhook 推送: ${payload.url}`);
  }

  // v1.1.3: 过滤 FAIL/WARN 规则用于消息构建，但 PASS 也推送
  const failedRules = payload.rules.filter(
    (r) => r.status === 'FAIL' || r.status === 'WARN'
  );
  const isPass = failedRules.length === 0;

  const content = buildContent(payload, failedRules, isPass, customPatterns);
  const body = buildRequestBody(payload.platform, content);

  try {
    const response = await fetch(payload.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch (err) {
    // 超时或网络错误：不阻塞审计流程，但记录告警供排查
    console.warn('[sofagent] webhook 推送失败（非致命）:', err instanceof Error ? err.message : String(err));
    return false;
  }
}
