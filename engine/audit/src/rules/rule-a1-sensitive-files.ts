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
// 仅 .example/.sample/.d.ts/.test.<代码扩展名>/.spec.<代码扩展名> 或 .env.<代码扩展名> 结尾的放行；
// .env.local/.env.production 等仍 FAIL。
// ⚠️ 豁免口径以 isSensitiveFile 内守卫为准（allowlist 是必要非充分条件）：
// basename 以 .env 开头者（.env.example/.env.sample/.env.test.js 等）**不进豁免**，
// 一律走 SENSITIVE_PATTERNS 匹配（finding-08：豁免面叠加曾把 .env.test.js 从
// 拦截变放行）；schema.env.example 等非 .env 开头的模板名正常放行。
// round-3 finding-01/02/03：收窄两处绕过面——
// ① 剔除 json/ya?ml/toml/md 数据容器臂：serverless.env.yml（Serverless Framework 经典
//    密钥文件）、.env.json/.env.yaml 等 env dump 标准载体曾被静默放行，仅剩 A2 内容兜底；
// ② .test./.spec. 从无锚定子串收紧为「代码扩展名尾锚定」：原形态使 prod.test.env.local
//    整名放行、creds.test.pem 跳过 .pem 检测。
const A1_ALLOWLIST =
  /(\.example|\.sample|\.d\.ts)$|\.(?:test|spec)\.[cm]?[jt]sx?$|\.env\.[cm]?[jt]sx?$/i;

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
  // round-3 finding-03：仅对 basename 判定——src/foo.test.js/.env 这类目录组件
  // 含 .test./.spec. 的路径不再整文件豁免（目录名由被审计 Agent 完全可控）
  // round-3 finding-08：basename 以 .env 开头者不进 allowlist——.env.test.js 旧版经
  // ^\.env…$ FAIL 拦截，allowlist 两臂（\.env\.<代码扩展名>$ 与 \.(?:test|spec)\.<代码扩展名>$）
  // 均会重新放行，叠加 finding-11 测试豁免降级 + hook 对 WARN 放行 = 阻断→放行回归；
  // config.env.ts 等前缀形态不受影响
  if (!/^\.env/i.test(name) && A1_ALLOWLIST.test(name)) {
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
