// ============================================================
// A1 不碰敏感（安全层 · 业务底线）
// diff 含 .env / *.pem / *.key / id_rsa / credentials.* → 直接 FAIL
// evidenceMode: git-diff（纯 diff 判定，不需要 --task、不需要日志、不需要 --silent）
// ============================================================

import { basename } from 'path';
import type { AuditContext, RuleCheck } from './types';

/** 敏感文件匹配模式（匹配 basename） */
const SENSITIVE_PATTERNS = [
  /^\.env(\.\w+)?$/i,           // .env, .env.local, .env.production
  /\.pem$/i,                     // *.pem
  /\.key$/i,                     // *.key
  /(^|\/)id_rsa$/,               // id_rsa
  /(^|\/)id_ed25519$/,           // id_ed25519
  /^credentials(\.\w+)?$/i,      // credentials, credentials.json
  /\.pfx$/i,                     // *.pfx
  /\.p12$/i,                     // *.p12
];

/**
 * 检查文件路径是否为敏感文件
 * 同时检查 path 和 oldPath（重命名场景）
 */
function isSensitiveFile(filePath: string): boolean {
  const name = basename(filePath);
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
