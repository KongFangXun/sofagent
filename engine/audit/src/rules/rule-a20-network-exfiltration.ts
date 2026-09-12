// ============================================================
// A20 不泄外联（安全层 · 业务底线）v1.3.7 新增
// 检测 git diff 新增行中是否含数据外传/凭证外发模式
// evidenceMode: git-diff
// ============================================================

import { getAddedLines } from '@sofagent/core';
import { DOMAIN_WHITELIST } from '@sofagent/core';
import type { AuditContext, RuleScan, RuleStatus } from './types';
import { sanitizeDetailLine } from './rule-a9-no-injection';
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

export function scanA20(ctx: AuditContext): RuleScan {
  let status: RuleStatus = 'PASS';
  const details: string[] = [];

  const { diffFiles } = ctx;

  interface Hit { file: string; line: string; pattern: string }
  const hits: Hit[] = [];

  for (const file of diffFiles) {
    // 跳过文档目录；测试文件不再静默跳过（v1.4.8 fresh-eyes finding-11：文件命名
    // 完全在被审计 Agent 控制下，命中在末尾拆分降级 WARN 人工确认）
    if (file.path.startsWith('docs/')) continue;
    if (file.path.endsWith('.md') && !file.path.includes('SECURITY')) continue;

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

  // v1.4.8 fresh-eyes（finding-11）：测试文件命中拆出主判定——不 FAIL，降级 WARN 人工确认
  const isTestFilePath = (p: string) => p.includes('.test.') || p.includes('__tests__/');
  const testFileHits = hits.filter((h) => isTestFilePath(h.file));
  const mainHits = hits.filter((h) => !isTestFilePath(h.file));

  if (mainHits.length > 0) {
    status = 'FAIL';
    details.push(
      `检测到 ${mainHits.length} 处数据外传模式（双条件：外传动作 + 敏感数据）: ` +
      mainHits.map(h => `${h.file}: "${h.line}" (${h.pattern})`).join('; ')
    );
  }
  if (testFileHits.length > 0) {
    if (status === 'PASS') status = 'WARN';
    details.push(
      `测试文件豁免命中（不 FAIL 但需人工确认）: ` +
      testFileHits.slice(0, 5).map(h => `${h.file}: "${sanitizeDetailLine(h.line)}" (${h.pattern})`).join('; ') +
      (testFileHits.length > 5 ? ` 等 ${testFileHits.length} 处` : '') +
      `。测试文件命名在被审计 Agent 控制下，请确认以上命中均为合法 fixture 而非真实外传夹带。`
    );
  }

  return { status, details };
}
