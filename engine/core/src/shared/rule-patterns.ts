// ============================================================
// shared/rule-patterns.ts · tool 引擎规则正则单一事实源
// v1.5.3 第一章（双规则引擎统一）：
//   tool-level 引擎（engine/rules）此前各自维护敏感文件路径正则与
//   prompt 注入正则——本版收敛至此，engine/rules 不再独立维护规则正则，
//   只保留「触发时机适配层」（从 tool call args 取字符串 → 过本模块定义的正则）。
//   与 secret-patterns.ts（A2 / tool-secret-leak 共用）同源精神：单一事实源。
// ============================================================

/**
 * 敏感文件路径模式（tool 视角——匹配完整路径）。
 *
 * 与 audit A1 的同族关系：A1 以 basename 为判定单位（含 allowlist 与同形字防御），
 * tool-level 以完整路径为判定单位（调用前拦截时 args 里的路径常含目录前缀）。
 * 两者是**同一规则（A1）在两种触发时机下的适配**，身份定义同源于
 * `RULE_DEFINITIONS`（rule-definitions.ts）。
 */
export const SENSITIVE_FILE_PATH_PATTERNS: readonly RegExp[] = [
  /\.env[\w.-]*$/i,            // .env, .env.local, .env.production, .envrc 等
  /\.sofagent\/config/i,
  /\.sofagent\/knowledge/i,
  /\.sofagent\/audit/i,
  /\.sofagent\/think/i,
  /\/\.ssh\//i,
  /\/\.gnupg\//i,
  /\.pem$/i,
  /\.key$/i,
  /\.pfx$/i,                   // *.pfx（与 audit rule-a1 对齐）
  /\.p12$/i,                   // *.p12（与 audit rule-a1 对齐）
  /id_rsa/i,
  /id_ed25519/i,
  /\.kube\/config/i,
  /\.docker\/config/i,
  /credentials/i,
  /\.npmrc$/i,
  /\.pypirc$/i,
];

/**
 * Prompt injection 高置信度模式。
 *
 * 与 audit A9 的关系：A9 走完整评分制（HIGH + MEDIUM 两档 + 上下文降级），
 * tool-level 只取**高置信度模式**（避免 tool args 误报），是同一规则（A9）在
 * 「调用前拦截」时机下的保守适配。
 *
 * ⚠️ 模式用 `new RegExp` + 字符串拼接构建——避免正则字面量中的注入示例串
 * 触发 audit A9 自指误报（铁律 #3：fixture 中的 secret-like / injection-like
 * 串必须运行时拼接）。本文件被 A9 逐行扫描，故拼接手法不可省。
 */
const _I = 'ign' + 'ore';
const _D = 'disr' + 'egard';
const _P = 'prev' + 'ious';
const _INS = 'instru' + 'ctions';
const _PRO = 'prom' + 'pts';

export const TOOL_INJECTION_PATTERNS: readonly RegExp[] = [
  // 英文经典模式（拼接构建避免 A9 误报）
  new RegExp(`${_I}\\s+(all\\s+)?(${_P}|prior|above)\\s+(${_INS}?|${_PRO}?)`, 'i'),
  new RegExp(`${_D}\\s+(all\\s+)?(${_P}|prior)\\s+(${_INS}?|${_PRO}?)`, 'i'),
  /forget\s+(everything|all\s+(previous|prior)\s+(instructions?|prompts?))/i,
  /you\s+are\s+now\s+(a|an)\s+(different|new)/i,
  /new\s+instructions?\s*:/i,
  /system\s*:\s*you\s+are/i,
  // 中文经典模式（拼接构建避免 A9 误报）
  new RegExp('忽' + '略以上所有(指令|提示)'),
  new RegExp('忽' + '略(上面|之前|前面)的(指令|提示|规则)'),
  new RegExp('忘' + '记(之前|前面)的(指令|设定)'),
  /你现在(是|扮演)/,
];
