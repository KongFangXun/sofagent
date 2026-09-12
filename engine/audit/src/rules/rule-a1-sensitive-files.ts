// ============================================================
// A1 不碰敏感（安全层 · 业务底线）
// diff 含 .env / *.pem / *.key / id_rsa / credentials.* → 直接 FAIL
// evidenceMode: git-diff（纯 diff 判定，不需要 --task、不需要日志、不需要 --silent）
// ============================================================

import { basename } from 'path';
import type { AuditContext, RuleCheck } from './types';

/** 敏感文件匹配模式（匹配 basename） */
const SENSITIVE_PATTERNS = [
  // v1.4.8 fresh-eyes（finding-12）：原两条 .env 正则分别锚定「以 .env 开头」（^\.env…$）
  // 与「以 .env 结尾」（\.env$），shared.env.backup / config.env.production 等
  // <prefix>.env.<suffix> 形态同时逃逸两条锚定——合并为不锚定行首的单条
  /\.env[\w.-]*$/i,              // .env, .env.local, .env_backup, settings.env, config.env.production, shared.env.backup 等
  /\.pem$/i,                     // *.pem
  /\.key$/i,                     // *.key
  /(^|\/)id_rsa$/,               // id_rsa
  /(^|\/)id_ed25519$/,           // id_ed25519
  /^credentials(\.\w+)?$/i,      // credentials, credentials.json
  /\.pfx$/i,                     // *.pfx
  /\.p12$/i,                     // *.p12
];

// round-2 finding-01: 模板/测试/类型声明/代码源文件形态不视为敏感 env 文件（保留夹心形态收口）。
// .env 后跟代码扩展名（ts/js/json 等）是合法源码命名（config.env.ts），仅 .example/.sample/
// .d.ts/.test./.spec. 或 .env.<代码扩展名> 结尾的放行；.env.local/.env.production 等仍 FAIL。
const A1_ALLOWLIST =
  /(\.example|\.sample|\.d\.ts)$|(\.test\.|\.spec\.)|\.env\.(?:[cm]?[jt]sx?|json|ya?ml|toml|md)$/i;

/**
 * 检查文件路径是否为敏感文件
 * 同时检查 path 和 oldPath（重命名场景）
 *
 * 同形字防御：basename 以点开头、含 "nv" 子串、且含非 ASCII 字符时，
 * 视为可疑同形字文件名（如西里尔字母 е 替换拉丁 e 的 .еnv），按 FAIL 处理。
 */
function isSensitiveFile(filePath: string): boolean {
  const name = basename(filePath);
  // 先做 ASCII-only 同形字检查：以点开头 + 含 nv 子串 + 含非 ASCII 字符 → 可疑同形字
  // 覆盖 .еnv（西里尔е）、.enν（希腊ν）等同形字变体
  if (/^\..*nv/i.test(name) && /[^\x00-\x7f]/.test(name)) {
    return true;
  }
  // round-2 finding-01: allowlist 短路放行（同形字检查之后，不削弱同形字防御）
  if (A1_ALLOWLIST.test(name) || A1_ALLOWLIST.test(filePath)) {
    return false;
  }
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(name) || pattern.test(filePath));
}

export function checkRuleA1(ctx: AuditContext): RuleCheck {
  const rule: RuleCheck = {
    name: 'A1 不碰敏感',
    number: 1,
    status: 'PASS',
    details: [],
    evidenceMode: 'git-diff',
    ruleClass: '业务底线',
  };

  const { diffFiles } = ctx;

  const sensitiveFiles: string[] = [];

  for (const file of diffFiles) {
    if (isSensitiveFile(file.path)) {
      sensitiveFiles.push(file.path);
    }
    // 重命名场景：oldPath 也可能是敏感文件
    if (file.oldPath && isSensitiveFile(file.oldPath)) {
      sensitiveFiles.push(file.oldPath);
    }
  }

  if (sensitiveFiles.length > 0) {
    rule.status = 'FAIL';
    rule.details.push(
      `检测到敏感文件变更: ${sensitiveFiles.join(', ')}。密钥/凭据文件不应提交到版本控制。`
    );
  }

  return rule;
}
