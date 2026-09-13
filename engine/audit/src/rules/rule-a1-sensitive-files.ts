// ============================================================
// A1 不碰敏感（安全层 · 业务底线）
// diff 含 .env / *.pem / *.key / id_rsa / credentials.* → 直接 FAIL
// evidenceMode: git-diff（纯 diff 判定，不需要 --task、不需要日志、不需要 --silent）
// ============================================================

import { basename } from 'path';
import type { AuditContext, RuleScan } from './types';

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

/**
 * 规则判定本体（v1.4.8 条目 7）：只产出 status/details——
 * 前置块（name/number/evidenceMode/ruleClass）由 assembleCheck 从注册表 meta 装配。
 *
 * v1.4.9 P1-10：按 `DiffFile.status` 的**方向**分级——数据早就在位
 * （core/diff-parser.ts 的 `'added' | 'modified' | 'deleted' | 'renamed'`），
 * 旧实现只读 `path`/`oldPath`、零 status 消费 ⇒ `git rm .env` 这类**补救 commit**
 * 被判 FAIL → hook exit 2 → 用户被迫 `--no-verify`（恰好落进产品自己定义要防的
 * 「诚实 Agent 疏忽」场景）。
 *   - `deleted` 敏感文件 = **移除**（补救动作）→ WARN + 保留「删除 ≠ 止损完成」提示
 *   - `renamed` 且敏感 oldPath → 非敏感 newPath = **移出**敏感区 → 同 WARN
 *   - 新增/修改敏感文件 = **引入**泄漏面 → 维持 FAIL（现行为不变）
 * A1 注册表 meta（priority: 'critical'）**不需要改**：runner 的 fast-fail 判定键是
 * `status === 'FAIL'`（runner.ts:206），不是 priority——同一规则返回 WARN 不会触发
 * 后续层 SKIPPED。
 */
export function scanA1(ctx: AuditContext): RuleScan {
  const { diffFiles } = ctx;

  /** 引入泄漏面（新增/修改敏感文件；或改名后仍/新为敏感）→ FAIL */
  const introduced: string[] = [];
  /** 补救方向（删除 / 移出敏感区）→ WARN */
  const removed: string[] = [];

  for (const file of diffFiles) {
    const pathSensitive = isSensitiveFile(file.path);
    const oldSensitive = file.oldPath !== undefined && isSensitiveFile(file.oldPath);

    // ① 敏感文件被删除——补救动作，不是引入
    if (file.status === 'deleted') {
      if (pathSensitive) removed.push(file.path);
      continue;
    }

    // ② 从敏感区改名离开（old 敏感、new 不敏感）——补救动作
    if (file.status === 'renamed' && oldSensitive && !pathSensitive) {
      removed.push(`${file.oldPath} → ${file.path}`);
      continue;
    }

    // ③ 其余（added / modified / renamed 后仍在敏感区）——引入泄漏面
    if (pathSensitive) introduced.push(file.path);
    // 保留旧实现对「oldPath 敏感」的兜底判定（不放松既有拦截面）
    if (oldSensitive && !pathSensitive) introduced.push(file.oldPath!);
  }

  if (introduced.length === 0 && removed.length === 0) {
    return { status: 'PASS', details: [] };
  }

  const details: string[] = [];
  if (introduced.length > 0) {
    details.push(
      `检测到敏感文件变更: ${introduced.join(', ')}。密钥/凭据文件不应提交到版本控制。`,
    );
  }
  if (removed.length > 0) {
    details.push(
      `敏感文件已移除: ${removed.join(', ')}——删除 ≠ 止损完成：密钥若曾入库，历史仍在，` +
        `请轮换凭据并考虑 git filter-repo 清理历史。`,
    );
  }

  // 最严者胜：同时存在引入与移除时整体判 FAIL（有引入就必须拦）
  return { status: introduced.length > 0 ? 'FAIL' : 'WARN', details };
}
