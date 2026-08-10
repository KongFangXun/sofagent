// ============================================================
// shared/secret-patterns.ts · 密钥检测正则单一事实源
// v1.3.1 A2（engine/audit rule-a2）与 ToolGate（engine/rules
//   tool-secret-leak）此前各持一份正则且漂移——ToolGate 用严格 48 位
//   sk- 模式导致 32-47 位密钥被放行，运行时洞与提交时洞错开互补。
//   现抽共享常量，两处 import 同一来源。
// v1.3.1 §4.10.2: 扩展为全规则共享库——新增 REDACTION_PATTERNS /
//   DOMAIN_WHITELIST / DANGEROUS_SCRIPT_CMDS 三组共享正则
// ============================================================
/** 密钥泄漏检测正则模式（权威集——以 audit A2 的宽口径为准） */
export const SECRET_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /AKIA[A-Z0-9]{16}/, label: 'AWS Access Key' },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: 'Private Key' },
  { pattern: /sk-ant-(api03|api04)-[A-Za-z0-9_-]{40,}/, label: 'Anthropic API Key' },
  { pattern: /sk-proj-[a-zA-Z0-9_]{40,}/, label: 'OpenAI Project Key' },
  { pattern: /sk-svcacct-[a-zA-Z0-9_]{40,}/, label: 'OpenAI Service Account Key' },
  { pattern: /sk-admin-[a-zA-Z0-9_]{40,}/, label: 'OpenAI Admin Key' },
  // 通用 sk- key（48 位匹配 OpenAI，32-47 位匹配 DeepSeek 等短 key 厂商）——
  // ⚠️ 必须保持 32+ 宽口径，勿改回严格 48(修复：ToolGate 曾放行 32-47 位）
  // v1.3.1 #46: 扩展支持连字符/下划线（部分厂商 key 含分隔符），首字符仍限字母数字。
  { pattern: /sk-[a-zA-Z0-9][a-zA-Z0-9_\-]{31,}/, label: 'Possible API Key (OpenAI/DeepSeek)' },
  { pattern: /gh[ps]_[A-Za-z0-9]{36}/, label: 'GitHub Token' },
];

/**
 * v1.2.5 §4.10.2: 脱敏正则（从 A9 sanitizeDetailLine 迁移）
 *
 * 用于审计 details 输出时脱敏——防止密钥通过审计报告/历史记录外泄。
 */
export const REDACTION_PATTERNS: { pattern: RegExp; replacement: string }[] = [
  { pattern: /sk-[a-zA-Z0-9_\-]{16,}/g, replacement: 'sk-***REDACTED***' },
  { pattern: /AKIA[0-9A-Z]{16}/g, replacement: 'AKIA***REDACTED***' },
  { pattern: /\b1[3-9]\d{9}\b/g, replacement: '1**REDACTED***' },
  { pattern: /gh[ps]_[a-zA-Z0-9]{36,}/g, replacement: 'gh***REDACTED***' },
];

/**
 * v1.2.5 §4.10.2: 域名白名单（A20 不泄外联用）
 *
 * 白名单域名不触发外联告警——registry/CDN/文档仓库等合法外联目标。
 */
export const DOMAIN_WHITELIST: string[] = [
  'localhost', '127.0.0.1', '0.0.0.0', '::1',
  'registry.npmjs.org', 'registry.npmmirror.com', 'registry.yarnpkg.com',
  'github.com', 'raw.githubusercontent.com', 'codeload.github.com',
  'pypi.org', 'files.pythonhosted.org', 'test.pypi.org',
  'crates.io', 'static.crates.io',
  'rubygems.org',
  'repo1.maven.org', 'repo.maven.apache.org',
  'nodejs.org', 'npmjs.com',
  'googleapis.com', 'cloudflare.com',
];

/**
 * v1.2.5 §4.10.2: 危险脚本命令正则（A10 postinstall 检测用）
 *
 * 检测 package.json scripts 中 postinstall/preinstall hook 是否含危险执行命令。
 */
export const DANGEROUS_SCRIPT_CMDS: RegExp = /(?:curl|wget)\s+.*?(?:\||bash|sh)|eval\s*\(|new\s+Function\s*\(|child_process|require\s*\(\s*['"]child_process|exec\s*\(|spawn\s*\(/gi;
