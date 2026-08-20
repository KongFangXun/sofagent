// ============================================================
// shared/secret-patterns.ts · 密钥检测正则单一事实源
// v1.3.8 A2（engine/audit rule-a2）与 ToolGate（engine/rules
//   tool-secret-leak）此前各持一份正则且漂移——ToolGate 用严格 48 位
//   sk- 模式导致 32-47 位密钥被放行，运行时洞与提交时洞错开互补。
//   现抽共享常量，两处 import 同一来源。
// v1.3.7 §4.10.2: 扩展为全规则共享库——新增 REDACTION_PATTERNS /
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
  // v1.3.2 #46: 扩展支持连字符/下划线（部分厂商 key 含分隔符），首字符仍限字母数字。
  { pattern: /sk-[a-zA-Z0-9][a-zA-Z0-9_\-]{31,}/, label: 'Possible API Key (OpenAI/DeepSeek)' },
  { pattern: /gh[ps]_[A-Za-z0-9]{36}/, label: 'GitHub Token' },
  // v1.3.6 B24: Stripe 下划线前缀（sk_live_/sk_test_）——与现有 sk- 连字符族不同源，
  // 无论长短均不匹配旧模式（fresh-eyes 报告四实测 sk-live-abc123456789 放行暴露此洞）。
  // Stripe 真实 key ≥24 位；误报面评估：生产代码中 sk_live_/sk_test_ 前缀几乎无合法用途
  //（测试文档需用占位符，与 v1.3.5 脱敏教训一致）——可控，纳入覆盖。
  { pattern: /sk_(live|test)_[a-zA-Z0-9]{24,}/, label: 'Stripe Secret Key' },
];

/**
 * v1.2.5 §4.10.2: 脱敏正则（从 A9 sanitizeDetailLine 迁移）
 *
 * 用于审计 details 输出时脱敏——防止密钥通过审计报告/历史记录外泄。
 * v1.3.9 四十五：补齐与 SECRET_PATTERNS 的对齐（9 检测 → 9 脱敏，类型/数量对齐）——
 * 此前 PEM 私钥检出但原样落盘（不对称洞）。每族检测正则各配一条脱敏正则。
 * ⚠️ 宽度铁律：脱敏是落盘前最后防线，「宁多脱敏勿漏」——脱敏 pattern 宽度必须
 * **⊇ 检测 pattern**（可更宽，绝不比检测更窄）；收紧到与检测同宽会漏掉合法短 key。
 * 另含 1 条 PII（手机号，非密钥）。
 */
// ⚠️ A2 自指误报规避：本文件是规则源码，若直接写 PEM 私钥头尾（BEGIN/END 那串）字面量，
// 会被 A2 逐行扫描判为硬编码私钥（自指误报）。故 PEM 脱敏正则与替换串均用运行时拼接
// 构造——'PRIVATE ' 与 'KEY' 分列两个字符串字面量，任一行不出现完整连写。
const PEM_WORD = ['PRIVATE ', 'KEY'].join('');
const PEM_BLOCK_REDACTION = new RegExp(
  '-----BEGIN [A-Z ]*' + PEM_WORD + '-----[\\s\\S]*?-----END [A-Z ]*' + PEM_WORD + '-----',
  'g',
);
const PEM_BLOCK_REPLACEMENT = [
  '-----BEGIN ', PEM_WORD, '-----***REDACTED***-----END ', PEM_WORD, '-----',
].join('');

export const REDACTION_PATTERNS: { pattern: RegExp; replacement: string }[] = [
  // 1. AWS Access Key（与 SECRET_PATTERNS #1 同源）
  { pattern: /AKIA[A-Z0-9]{16}/g, replacement: 'AKIA***REDACTED***' },
  // 2. PEM 私钥块（多行——BEGIN 到 END 整块替换；此前检测命中但原样落盘 = 不对称洞）
  { pattern: PEM_BLOCK_REDACTION, replacement: PEM_BLOCK_REPLACEMENT },
  // 3. Anthropic（sk-ant-，与 #3 同源）
  { pattern: /sk-ant-(api03|api04)-[A-Za-z0-9_-]{40,}/g, replacement: 'sk-ant-***REDACTED***' },
  // 4. OpenAI Project（sk-proj-，与 #4 同源）
  { pattern: /sk-proj-[a-zA-Z0-9_]{40,}/g, replacement: 'sk-proj-***REDACTED***' },
  // 5. OpenAI Service Account（sk-svcacct-，与 #5 同源）
  { pattern: /sk-svcacct-[a-zA-Z0-9_]{40,}/g, replacement: 'sk-svcacct-***REDACTED***' },
  // 6. OpenAI Admin（sk-admin-，与 #6 同源）
  { pattern: /sk-admin-[a-zA-Z0-9_]{40,}/g, replacement: 'sk-admin-***REDACTED***' },
  // 7. 通用 sk-（宽口径 {16,}——脱敏 ⊇ 检测；v1.3.9 曾误收紧到与检测同宽 {31,}
  //    导致 31 字符短 key 漏脱敏，QA 门禁抓回，已恢复 v1.3.8 宽口径）
  { pattern: /sk-[a-zA-Z0-9_\-]{16,}/g, replacement: 'sk-***REDACTED***' },
  // 8. GitHub Token（ghp_/ghs_，与 #8 同源；{36,} 宽口径——GitHub PAT 固定 36 位，多余位一并吞掉）
  { pattern: /gh[ps]_[A-Za-z0-9]{36,}/g, replacement: 'gh***REDACTED***' },
  // 9. Stripe（sk_live_/sk_test_，宽口径 {16,}——脱敏 ⊇ 检测，宁多勿漏）
  { pattern: /sk_(live|test)_[a-zA-Z0-9]{16,}/g, replacement: 'sk_***REDACTED***' },
  // 10. PII（非密钥）：中国大陆手机号（隐私脱敏，无对应 SECRET_PATTERNS）
  { pattern: /\b1[3-9]\d{9}\b/g, replacement: '1**REDACTED***' },
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
