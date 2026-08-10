// ============================================================
// A20 不泄外联（安全层 · 业务底线）v1.3.1 新增
// 检测 git diff 新增行中是否含数据外传/凭证外发模式
// evidenceMode: git-diff
// ============================================================

import { getAddedLines } from '@sofagent/core';
import { DOMAIN_WHITELIST } from '@sofagent/core';
import type { AuditContext, RuleCheck } from './types';
/** 外传动作模式——curl/wget POST、fetch POST、DNS 隧道 */
const EXFIL_ACTION_PATTERNS: { pattern: RegExp; name: string }[] = [
  // curl/wget 发送数据到外部（不用 g 标志——避免 lastIndex 状态问题）
  { pattern: /(?:curl|wget)\b[^|;\n]*?(?:--data|--data-raw|-d|--data-binary)\b[^|;\n]*?(?:https?:|ftp:)/i, name: 'curl/wget POST 外传' },
  { pattern: /(?:curl|wget)\b[^|;\n]*?-X\s*POST[^|;\n]*?(?:https?|ftp)/i, name: 'curl -X POST 外传' },
  // fetch/axios POST 含 process.env
  { pattern: /(?:fetch|axios)\s*\([^)]*(?:method\s*:\s*['"]POST|process\.env)/i, name: 'fetch/axios POST 含 env' },
  // DNS 隧道
  { pattern: /dns\.resolve|resolve4|resolve6/i, name: 'DNS 隧道外传' },
  // WebSocket 外传
  { pattern: /new\s+WebSocket\s*\(\s*['"]wss?:\/\//i, name: 'WebSocket 外联' },
];

/** 凭证/敏感数据模式——与外传动作同时出现才告警（双条件） */
const SENSITIVE_DATA_PATTERNS: { pattern: RegExp; name: string }[] = [
  { pattern: /process\.env\.\w+/i, name: '环境变量引用' },
  { pattern: /\.env\b/i, name: '.env 文件引用' },
  { pattern: /\b(token|secret|password|passwd|credential|apikey|api_key)\b/i, name: '凭证关键词' },
  { pattern: /\bsk-[a-zA-Z0-9]{16,}/i, name: 'API 密钥' },
  { pattern: /AKIA[A-Z0-9]{16}/i, name: 'AWS Access Key' },
];

/**
 * 检查 URL 是否在白名单域名中（精确 hostname 比对）
 * v1.2.6: 从 includes 子串匹配改为 URL 解析后精确 hostname 比对——
 * 防止 attacker.com 白名单绕过（如 evil-github.com 含子串 github.com）
 */
function isWhitelisted(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return DOMAIN_WHITELIST.some(domain =>
    host === domain || host.endsWith('.' + domain)
  );
}

/**
 * 从一行文本中提取所有 URL
 */
function extractUrls(line: string): string[] {
  const urls: string[] = [];
  const urlPattern = /https?:\/\/[^\s'"<>)]+/gi;
  let match: RegExpExecArray | null;
  while ((match = urlPattern.exec(line)) !== null) {
    if (match[0]) urls.push(match[0]);
  }
  return urls;
}

export function checkRuleA20(ctx: AuditContext): RuleCheck {
  const rule: RuleCheck = {
    name: 'A20 不泄外联',
    number: 20,
    status: 'PASS',
    details: [],
    evidenceMode: 'git-diff',
    ruleClass: '业务底线',
  };

  const { diffFiles } = ctx;

  interface Hit { file: string; line: string; pattern: string }
  const hits: Hit[] = [];

  for (const file of diffFiles) {
    // 跳过文档和测试文件
    if (file.path.startsWith('docs/')) continue;
    if (file.path.endsWith('.md') && !file.path.includes('SECURITY')) continue;
    if (file.path.includes('.test.') || file.path.includes('__tests__/')) continue;

    const addedLines = getAddedLines(file);
    for (const line of addedLines) {
      // 检查是否有外传动作
      let actionHit: string | null = null;
      for (const { pattern, name } of EXFIL_ACTION_PATTERNS) {
        if (pattern.test(line)) {
          actionHit = name;
          break;
        }
      }
      if (!actionHit) continue;

      // 检查是否有凭证/敏感数据（双条件）
      let hasSensitive = false;
      for (const { pattern } of SENSITIVE_DATA_PATTERNS) {
        if (pattern.test(line)) {
          hasSensitive = true;
          break;
        }
      }

      // 如果有外传动作但没有明确凭证，检查 URL 是否在白名单
      if (!hasSensitive) {
        const urls = extractUrls(line);
        const nonWhitelistedUrls = urls.filter(url => !isWhitelisted(url));

        // curl/wget POST 到非白名单域名也算外传（明确的数据发送意图）
        if (nonWhitelistedUrls.length > 0 && actionHit.includes('POST')) {
          hasSensitive = true;
        }

        // WebSocket 外联——wss/ws 通道本身就是数据通道，检查非白名单域名
        if (!hasSensitive && actionHit.includes('WebSocket')) {
          const wsMatch = line.match(/wss?:\/\/([^\s'"<>)]+)/i);
          if (wsMatch && wsMatch[0]) {
            hasSensitive = !isWhitelisted(wsMatch[0]);
          }
        }
      }

      if (hasSensitive) {
        hits.push({
          file: file.path,
          line: line.trim().slice(0, 100),
          pattern: actionHit,
        });
      }
    }
  }

  if (hits.length > 0) {
    rule.status = 'FAIL';
    rule.details.push(
      `检测到 ${hits.length} 处数据外传模式（双条件：外传动作 + 敏感数据）: ` +
      hits.map(h => `${h.file}: "${h.line}" (${h.pattern})`).join('; ')
    );
  }

  return rule;
}
