// ============================================================
// A2 不泄密钥（安全层 · 业务底线）
// 检测 diff 新增行内容是否含密钥字符串 → 命中任意一条 → FAIL
// v1.4.4：输出聚合——同文件同模式多次命中时限量显示，避免超大 diff 输出爆炸
// v1.3.7 补编码绕过检测——新增行尝试 base64/hex 解码后再跑正则，
//   命中则报警（此前 `printf 'AKIA...' | base64 > encoded.txt` 即可绕过）。
//   另补 .gitattributes -diff 绕过检测——把文件标记为 -diff 会让 git diff
//   不输出内容行，A2 扫不到任何新增行（静默全绿），检测到该模式时 WARN。
// evidenceMode: git-diff
// ============================================================

import type { AuditContext, RuleCheck } from './types';
import { SECRET_PATTERNS, stripDataUris, REDACTION_PATTERNS } from '@sofagent/core';

/**
 * 密钥泄漏检测正则模式
 *
 * 单一事实源 = @sofagent/core shared/secret-patterns.ts（与 ToolGate
 *   tool-secret-leak 共用同一套正则，杜绝 32-47 位密钥被运行时防线放行的漂移）。
 * 确认——A2 本身无独立长度门槛，所有正则均来自 SECRET_PATTERNS。
 *   通用 sk- key 模式为 {32,}（覆盖 DeepSeek 等短 key），厂商专属模式
 *   （sk-ant/sk-proj/sk-svcacct/sk-admin）为 {40,}（厂商文档最小长度）。
 *
 * 未覆盖的 key 格式（误报风险高，保守不加正则）：
 * - GLM（智谱）：格式为 id.secret 点分隔（如 8a3b1c2d9e7f4g5h.xxx），正则误报率高
 * - 通义千问：格式不确定
 * 以上规划在 v1.3.x 用 LLM 辅助检测。
 */

/** 同文件同模式的聚合上限——超过则用汇总行 */
const MAX_DISPLAY_PER_GROUP = 5;

/**
 * 对一条新增行生成「明文候选」——原行 + 可能的 base64/hex 解码结果。
 * 仅当行内容形态符合编码特征（且能解码出可打印文本）才尝试，避免误伤普通文本。
 */
/**
 * v1.4.4：data URI 剥离已下沉 @sofagent/core stripDataUris（共享单一事实源——
 * A2 与 ToolGate tool-secret-leak 同口径豁免，防两防线漂移互补成洞）。
 */
function tryDecodeBase64(s: string): string | null {
  // finding-13: 字符集补 URL-safe base64 的 - _（Node Buffer 原生兼容两套字母表，
  // 此前仅字符集门槛拦路——URL-safe 编码的密钥逃逸解码检测）
  if (!/^[A-Za-z0-9+/=\s_-]+$/.test(s) || s.replace(/\s+/g, '').length < 8 || s.replace(/\s+/g, '').length % 4 !== 0) {
    return null;
  }
  try {
    const decoded = Buffer.from(s.replace(/\s+/g, ''), 'base64').toString('utf-8');
    // v1.3.8 P0-2（FFFD 短路绕过修复）：解码产生 \uFFFD（非法 UTF-8 字节）时不再整体放弃——
    // 攻击者可在 AKIA 密钥后拼非法 UTF-8 尾字节（如 0xd4 0x90 0x8b）再 base64，
    // 此前「含 FFFD 即 return null」会让密钥候选整体逃逸。密钥本体是 ASCII，
    // FFFD 只是干扰尾巴——剥离后再做可打印性判定与后续密钥正则检测。
    const cleaned = decoded.replace(/\uFFFD/g, '');
    if (cleaned && /[\x20-\x7E\u4e00-\u9fff]/.test(cleaned)) {
      return cleaned;
    }
    debugLogDecode('base64', s, '解码结果不含可打印文本（剥离 FFFD 后为空/纯二进制）');
  } catch (e) {
    // v1.4.5 T14: 解码异常留 debug 痕（SOFAGENT_DEBUG=1 时输出）——
    // 此前静默吞掉，charset 门槛通过但 Buffer 抛错的真实样本无从排查
    debugLogDecode('base64', s, e instanceof Error ? e.message : String(e));
  }
  return null;
}

function tryDecodeHex(s: string): string | null {
  const hexStr = s.replace(/\s+/g, '');
  if (!/^[0-9a-fA-F]+$/.test(hexStr) || hexStr.length < 16 || hexStr.length % 2 !== 0) {
    return null;
  }
  try {
    const decoded = Buffer.from(hexStr, 'hex').toString('utf-8');
    // v1.3.8 P0-2：同 base64 路径——剥离 \uFFFD 再检测（同款 FFFD 短路绕过防御）
    const cleaned = decoded.replace(/\uFFFD/g, '');
    if (cleaned && /[\x20-\x7E\u4e00-\u9fff]/.test(cleaned)) {
      return cleaned;
    }
    debugLogDecode('hex', hexStr, '解码结果不含可打印文本（剥离 FFFD 后为空/纯二进制）');
  } catch (e) {
    debugLogDecode('hex', hexStr, e instanceof Error ? e.message : String(e));
  }
  return null;
}

/**
 * v1.4.5 T14: 解码路径 debug 留痕——SOFAGENT_DEBUG=1 时向 stderr 输出
 * 「哪个候选串、走哪条解码路径、为何被丢弃」。候选串本身可能含密钥，
 * 输出前过 REDACTION_PATTERNS 脱敏（调试信息不能变成新的泄漏面），
 * 且截断至 48 字符（诊断只需形态不需全文）。默认关闭零噪声。
 */
function debugLogDecode(kind: 'base64' | 'hex', candidate: string, reason: string): void {
  if (process.env.SOFAGENT_DEBUG !== '1') return;
  try {
    let safe = candidate.slice(0, 48);
    for (const { pattern, replacement } of REDACTION_PATTERNS) {
      safe = safe.replace(pattern, replacement);
    }
    process.stderr.write(`[sofagent-audit][debug] A2 ${kind} 候选丢弃（${reason}）: ${safe}\n`);
  } catch {
    // debug 留痕自身绝不抛错（诊断面不能反过来破坏审计主流程）
  }
}

/**
 * v1.4.1 F-15：还原 JS 字符串里的 \xNN 十六进制转义序列
 * （如 "\x41\x4b\x49\x41..." → "AKIA..."）。还原结果要求基本可打印，
 * 防止随机转义噪声触发后续解码路径。
 */
function restoreHexEscapes(s: string): string | null {
  if (!/\\x[0-9a-fA-F]{2}/.test(s)) return null;
  const restored = s.replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  // 还原后须以可打印 ASCII 为主，否则视为噪声转义（如 \x00 控制字符串）
  if (restored && /^[\x20-\x7E]+$/.test(restored)) return restored;
  return null;
}

/**
 * v1.4.1 F-15：合并同行相邻字符串字面量拼接
 * （密钥拆成两半用 + 号相邻摆放，合并后才露出完整形态——如 AWS 前缀段 + 尾段）。
 * 拼接是字符串分割绕过的最简形态——密钥拆成两半各自无特征，合并后才命中。
 */
function joinAdjacentLiterals(s: string): string | null {
  // 仅当存在 "..." + "..." / '...' + '...' 形态才处理，避免无关行空转
  if (!/["'][^"']*["']\s*\+\s*["'][^"']*["']/.test(s)) return null;
  let joined = s;
  // 反复合并相邻字面量对，直到无新合并（支持 "a"+"b"+"c" 链式）
  for (let i = 0; i < 8; i++) {
    const next = joined.replace(
      /(["'])([^"']*)\1\s*\+\s*(["'])([^"']*)\3/g,
      (_m, q1: string, a: string, _q2: string, b: string) => `${q1}${a}${b}${q1}`,
    );
    if (next === joined) break;
    joined = next;
  }
  // 抽出最长的合并产物作为候选（密钥本体通常是最长字面量）
  const literals = joined.match(/["']([^"']{8,})["']/g) ?? [];
  let best: string | null = null;
  for (const lit of literals) {
    const inner = lit.slice(1, -1);
    if (!best || inner.length > best.length) best = inner;
  }
  return best;
}

/**
 * v1.4.1 F-15：提取函数调用参数位的字符串字面量——base64 函数参数位绕过修复。
 * 覆盖形态（v1.4.1 F-15 红队实锤堵洞）：
 *   Buffer.from("...", "base64") / atob("...") / decode(..., "base64") 等
 * 攻击形态：密钥 base64 编码后放进函数第二参数位——旧值提取正则只看
 * 等号/冒号后的值，函数参数位完全逃逸（报告四红队实测 exit 0 放行）。
 * 提取策略保守：只对「看起来像编码串」的参数（纯 base64/hex 字符集）解码，
 * 且解码结果需通过密钥正则才告警——普通字符串参数不误报。
 */
function extractCallArgLiterals(content: string): string[] {
  const out: string[] = [];
  // 函数调用参数位：ident("..." [, "..."])——单引号/双引号/无引号 base64 形态
  const callArgRe = /\b(?:Buffer\.from|atob|Buffer\.alloc|decode|decodeURIComponent|unzip|gunzipSync|inflateSync)\s*\(([^()]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = callArgRe.exec(content)) !== null) {
    const args = m[1] ?? '';
    // 拆参数：按引号字面量提取，非引号参数（变量名/数字）跳过
    const strLits = args.match(/(["'])([^"']*)\1/g) ?? [];
    for (const lit of strLits) {
      const val = lit.slice(1, -1);
      if (val.length < 8) continue; // 护栏：过短的参数不可能是编码密钥
      const b64 = tryDecodeBase64(val);
      if (b64) out.push(b64);
      const hex = tryDecodeHex(val);
      if (hex) out.push(hex);
    }
  }
  return out;
}

function candidatePlaintexts(content: string): string[] {
  // v1.4.4：入口先剥离 data URI 内嵌资源——base64 图像解码/原文的随机 40 位段
  // 会撞密钥正则（实锤：dashboard logo 70KB PNG data-URI 误报 AWS Secret Key）。
  // data URI 是标准 Web 资源内嵌形态非密钥载体；剥离后剩余文本照常走全路径检测
  // （资源以外藏真密钥仍会被抓）。URL-safe base64 载荷（含 -_）不匹配剥离正则，保持原扫。
  const stripped = stripDataUris(content);
  const candidates: string[] = [stripped];
  const trimmed = stripped.trim();

  // P1-A4: 带变量前缀的赋值行（如 `token = <b64>` / `key: <hex>`）
  // 提取等号/冒号后的值部分，尝试解码——堵住 `token = <base64>` 绕过路径
  const assignMatch = trimmed.match(/(?:^|\s)([\w.-]+)\s*[:=]\s*(.+)$/);
  if (assignMatch) {
    const valuePart = assignMatch[2]!.trim().replace(/['"`;,\s]+$/g, '');

    // base64 候选（值部分）
    const b64Decoded = tryDecodeBase64(valuePart);
    if (b64Decoded) candidates.push(b64Decoded);

    // hex 候选（值部分）
    const hexDecoded = tryDecodeHex(valuePart);
    if (hexDecoded) candidates.push(hexDecoded);
  }

  // 整行 base64 候选
  const wholeB64 = tryDecodeBase64(trimmed);
  if (wholeB64) candidates.push(wholeB64);

  // 整行 hex 候选
  const wholeHex = tryDecodeHex(trimmed);
  if (wholeHex) candidates.push(wholeHex);

  // v1.4.1 F-15：函数参数位提取（Buffer.from/atob/decode 等）——红队实锤绕过堵洞
  for (const decoded of extractCallArgLiterals(trimmed)) {
    candidates.push(decoded);
  }

  // v1.4.1 F-15：\xNN 十六进制转义还原（如 "\x41\x4b..." → "AKIA..."）
  const hexEscaped = restoreHexEscapes(trimmed);
  if (hexEscaped) candidates.push(hexEscaped);

  // v1.4.1 F-15：相邻字符串拼接合并（前缀段 + 尾段合并露出完整密钥）
  const joinedLiteral = joinAdjacentLiterals(trimmed);
  if (joinedLiteral) candidates.push(joinedLiteral);

  return candidates;
}

/**
 * 检测 .gitattributes -diff 隐藏（函数名刻意避免英文绕过类字样——
 * A9 启发式会把英文绕过类字样误判为 prompt 注入模式，顺带清理）。
 * 当 diff 中出现 `.gitattributes` 的新增行含 `-diff` 属性时，被标记文件的内容
 * 不会出现在 git diff 输出中 → A2 扫不到其新增行（静默全绿）。返回命中的文件名列表。
 */
function detectGitattributesDiffHidden(ctx: AuditContext): string[] {
  const hits: string[] = [];
  for (const file of ctx.diffFiles) {
    if (!file.path.endsWith('.gitattributes')) continue;
    for (const line of file.lines) {
      if (!line.startsWith('+') || line.startsWith('+++')) continue;
      const content = line.substring(1);
      // 形如：secrets.js -diff  /  *.env -diff  /  key.bin -diff merge=keep
      if (/^\s*[^\s#][^\s]*\s+-diff(\s|$)/.test(content)) {
        const attrTarget = content.trim().split(/\s+/)[0] ?? '(unknown)';
        hits.push(attrTarget);
      }
    }
  }
  return hits;
}

/**
 * 二进制文件扩展名——新增即 WARN（内容不扫，人工确认盲区）。
 * 含 NUL 字节的文件 git 也输出 "Binary files differ"，与扩展名检测互补。
 */
const BINARY_EXTENSIONS = /\.(bin|exe|dll|so|dylib|a|lib|o|class|jar|war|pyc|wasm|img|iso|dmg)(\.|$)/i;

/**
 * 检测新增的二进制文件（WARN 级——内容扫描盲区）。
 * 红队实测：5KB 随机字节夹带密钥的 blob 可绕过内容扫描（git 对二进制
 * 只输出 "Binary files ... differ"，无内容行可扫）。两条判定路径：
 *   ① 新增文件 + 二进制扩展名（.bin/.exe/.dll/.so/.dylib 等）；
 *   ② 新增文件 + diff 输出含 "Binary files ... differ" 标记（无二进制扩展名
 *      但内容含 NUL 字节的文件，git 自动按二进制处理——正是夹带密钥的
 *      blob 形态）。
 */
function detectNewBinaryFiles(ctx: AuditContext): string[] {
  const hits: string[] = [];
  for (const file of ctx.diffFiles) {
    if (file.status !== 'added') continue;
    if (BINARY_EXTENSIONS.test(file.path)) {
      hits.push(file.path);
      continue;
    }
    // git 对含 NUL 字节的文件输出 "Binary files a/x and b/x differ"
    if (file.lines.some((l) => l.startsWith('Binary files ') && l.includes('differ'))) {
      hits.push(file.path);
    }
  }
  return hits;
}

export function checkRuleA2(ctx: AuditContext): RuleCheck {
  const rule: RuleCheck = {
    name: 'A2 不泄密钥',
    number: 2,
    status: 'PASS',
    details: [],
    evidenceMode: 'git-diff',
    ruleClass: '业务底线',
  };

  const { diffFiles } = ctx;

  // 聚合结构：Map<"文件路径|密钥标签", string[]>
  const groupedDetections = new Map<string, { file: string; label: string; count: number }>();

  for (const file of diffFiles) {
    for (const line of file.lines) {
      // 只检查新增行（以 + 开头且不是 +++）
      if (line.startsWith('+') && !line.startsWith('+++')) {
        const content = line.substring(1);
        // v1.2.9: — zero-width 字符归一化（防止 U+200B/U+200C/U+200D/U+FEFF 拆分密钥绕过）
        let normalized = content.replace(/[\u200B\u200C\u200D\uFEFF]/g, '');
        // v1.3.1 #46: NFKC Unicode 归一化——防止全角字符（如 ｓｋ-）或同形字符绕过密钥检测。
        // NFKC 将兼容性字符折叠为标准形式（全角字母→半角、连字→拆分），堵住 Unicode 同形攻击。
        try {
          normalized = normalized.normalize('NFKC');
        } catch {
          // normalize 在极少数情况下可能失败（无效 surrogate pair），保留原值继续
        }
        // 原行 + base64/hex 解码候选（v1.2.9: 用归一化后的内容防 zero-width 绕过）
        for (const candidate of candidatePlaintexts(normalized)) {
          for (const { pattern, label, contextKeyword } of SECRET_PATTERNS) {
            if (pattern.test(candidate)) {
              // v1.4.2 H-02: 带 contextKeyword 的模式（裸 40 位 base64 形态）需同行含
              // 关键词才报告——裸串误报面大（hash/commit 都是 40 位 base64），上下文
              // 二次判定防误报。
              if (contextKeyword && !contextKeyword.test(candidate)) continue;
              const key = `${file.path}|${label}`;
              const existing = groupedDetections.get(key);
              if (existing) {
                existing.count++;
              } else {
                groupedDetections.set(key, { file: file.path, label, count: 1 });
              }
            }
          }
          // v1.4.0 交付四③：SECRET_ASSIGNMENT_REGEX——赋值形态通用检测（补已知格式之外的空档）
          // 覆盖 api_key=xxx / token: "xxx" / secret = xxx / password=xxx 等通用赋值；
          // 值长度 ≥8 且排除常见占位符（REPLACE_ME/your_/example/xxx）——保守防误报
          const ASSIGNMENT_PATTERN =
            /(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|token|secret|passwd|password)\s*[=:]\s*["']?([A-Za-z0-9_\-./+=]{8,})/i;
          const m = candidate.match(ASSIGNMENT_PATTERN);
          const assigned = m?.[1];
          if (assigned && !/^(REPLACE_ME|YOUR_[A-Z_]+|EXAMPLE|PLACEHOLDER|CHANGE_ME|xxxx+)$/i.test(assigned)) {
            const key = `${file.path}|密钥赋值`;
            const existing = groupedDetections.get(key);
            if (existing) {
              existing.count++;
            } else {
              groupedDetections.set(key, { file: file.path, label: '密钥赋值形态', count: 1 });
            }
          }
        }
      }
    }
  }

  if (groupedDetections.size > 0) {
    rule.status = 'FAIL';
    const parts: string[] = [];
    for (const { file, label, count } of groupedDetections.values()) {
      if (count > MAX_DISPLAY_PER_GROUP) {
        parts.push(`${file}: 检测到 ${label} ×${count} 处`);
      } else {
        parts.push(`${file}: 检测到 ${label}${count > 1 ? ` ×${count}` : ''}`);
      }
    }
    rule.details.push(
      `检测到疑似密钥/令牌泄漏: ${parts.join('; ')}。密钥不应硬编码到源码中。`
    );
  }

  // .gitattributes -diff 绕过检测（v1.3.8 P1-A2 升级为 FAIL）
  // 红队实测两步隐身：第一步提交 .gitattributes 标记 secrets.js -diff（此处仅 WARN 放行），
  // 第二步提交密钥文件——git diff 不输出内容行，A2 无内容可扫静默全绿。
  // -diff 标记对审计引擎是「结构性隐藏证据」，合法场景（真正的二进制产物如 .png/.lock）
  // 极少需要 -diff；按 fail-closed 原则升级 FAIL，用户确属误报可用 --ruleset 自定义豁免。
  const attrHiddenTargets = detectGitattributesDiffHidden(ctx);
  if (attrHiddenTargets.length > 0) {
    rule.status = 'FAIL';
    rule.details.push(
      `检测到 .gitattributes 将以下文件标记为 -diff（内容不会出现在 git diff 中，A2 无法扫描——两步隐身路径：先标记 -diff 再提交密钥文件即静默绕过）: ${attrHiddenTargets.join(', ')}。如属真实二进制产物请改用审计友好的标记方式（如 .gitattributes 注释说明），密钥文件必须移除 -diff 标记。`
    );
  }

  // 新增二进制文件 WARN（内容扫描盲区——git 不输出二进制内容行，密钥可藏身）
  const binaryFiles = detectNewBinaryFiles(ctx);
  if (binaryFiles.length > 0) {
    if (rule.status === 'PASS') rule.status = 'WARN';
    rule.details.push(
      `检测到 ${binaryFiles.length} 个新增二进制文件（${binaryFiles.slice(0, 5).join(', ')}${binaryFiles.length > 5 ? ' 等' : ''}）：二进制文件不扫内容，请人工确认无密钥夹带。`
    );
  }

  return rule;
}
