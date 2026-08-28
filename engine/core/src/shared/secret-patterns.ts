// ============================================================
// shared/secret-patterns.ts · 密钥检测正则单一事实源
// v1.4.2 A2（engine/audit rule-a2）与 ToolGate（engine/rules
//   tool-secret-leak）此前各持一份正则且漂移——ToolGate 用严格 48 位
//   sk- 模式导致 32-47 位密钥被放行，运行时洞与提交时洞错开互补。
//   现抽共享常量，两处 import 同一来源。
// v1.3.7 §4.10.2: 扩展为全规则共享库——新增 REDACTION_PATTERNS /
//   DOMAIN_WHITELIST / DANGEROUS_SCRIPT_CMDS 三组共享正则
// ============================================================
/** 密钥泄漏检测正则模式（权威集——以 audit A2 的宽口径为准）
 *  v1.4.2 H-02: 新增可选 contextKeyword 字段——裸形态误报面大的模式（如 AWS Secret
 *  Access Key 的裸 40 位 base64）声明「同行需含关键词才报告」，由消费方做行级二次判定；
 *  未声明该字段的模式无上下文条件，行为与旧版完全一致（向后兼容）。 */
export const SECRET_PATTERNS: { pattern: RegExp; label: string; contextKeyword?: RegExp }[] = [
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
  // v1.4.2 H-02: Google API Key——固定 AIza 前缀 + 35 位 base64url 字符。
  // 误报面评估：AIza 前缀由 Google 内部生成（base64url 头两位恰为 AIza），随机字符串
  // 命中概率可忽略；普通代码不会出现该前缀。真实 key 形如 AIzaSyA...（39 字符总长）。
  { pattern: /AIza[0-9A-Za-z\-_]{35}/, label: 'Google API Key' },
  // v1.4.2 H-02: Slack Token——xox[baprs]- 前缀 + ≥10 位 body。
  // 误报面评估：xox 前缀后必随 b/a/p/r/s 之一的类型字母再接连字符，自然语言与
  // 普通标识符不会构造出该形态；宽松 {10,} 兼容 bot/user/app/refresh 各长度。
  { pattern: /xox[baprs]-[A-Za-z0-9\-]{10,}/, label: 'Slack Token' },
  // v1.4.2 H-02: JWT——eyJ 开头三段式（header.payload. 前两段显式锚定，签名段不限定长度）。
  // 误报面评估：eyJ 是 base64({'{" 的固定头，随机 base64 不会出现；仅锚定前两段 + 尾点，
  // 第三段（签名）任意——完整 JWT 必含三段，短句误报可忽略。
  { pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, label: 'JWT Token' },
  // v1.4.2 H-02: AWS Secret Access Key——裸 40 位 base64 无前缀特征，误报面大（任意 40 位
  // base64 串如 hash/commit 都会命中），采用 b 方案上下文条件：仅当同一行含
  // aws|secret|key 关键词（不区分大小写）才报告。字段经 requiresLineContext 声明，
  // 由消费方（A2/ToolGate）做行级上下文二次判定——裸串不报，防误报。
  { pattern: /\b[A-Za-z0-9/+=]{40}\b/, label: 'Possible AWS Secret Access Key', contextKeyword: /aws|secret|key/i },
];

/**
 * v1.4.4：剥离字符串中的 data URI 内嵌资源载荷（data:image/*;base64,... 等）。
 * 合法内嵌资源（dashboard logo/图标）的 base64 载荷既会解码撞密钥正则（A2），
 * 也会原文撞裸 40 位模式 + 载荷内随机子串凑出 contextKeyword（tool-secret-leak
 * 实锤：70KB PNG 载荷内藏 "aws"/"key" 子串）。data URI 是标准 Web 资源内嵌形态
 * 非密钥载体——A2 与 ToolGate 两防线在检测前统一剥离，剩余文本照常全路径检测。
 * URL-safe base64 载荷（含 -_ 字符）不匹配此正则，保持原扫不豁免。
 */
export const DATA_URI_PATTERN = /data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi;

/** v1.4.4：剥离 data URI 内嵌资源（见 DATA_URI_PATTERN 注释） */
export function stripDataUris(s: string): string {
  return s.replace(DATA_URI_PATTERN, '');
}

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
 *
 * ⚠️ v1.3.9 bugfix 四十七（fresh-eyes H-12）：通用域白名单的隐蔽外联风险评估——显式权衡记录：
 *   - github.com / raw.githubusercontent.com / codeload.github.com：**保留**。CI 场景（npm
 *     install 拉 GitHub 依赖、action 拉 raw 文件）是合法高频外联，拦截会导致 CI 全线误报；
 *     代价是恶意 Agent 可借 gist/raw 隐蔽外传——已通过 A20 的审计留痕（外联动作落日志）+ 人工
 *     复核提示兜底，属「可审计的已知缺口」，非静默放行。若未来需要更强边界，改为「gist 仅 GET、
 *     raw 高敏感」分级（排期随 A20 规则演进评估）。
 *   - googleapis.com / cloudflare.com：**保留**。Google Cloud / Cloudflare 是主流云服务
 *     SDK 默认端点（存储/函数/边缘），拦截会误伤正常云集成；隐蔽外传风险同上，靠审计留痕兜底。
 *   - 综合：白名单域「全动作放行」是当前形态，未做 GET/写 分级——已知缺口，登记不静默。
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
