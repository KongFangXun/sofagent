// ============================================================
// A2 不泄密钥（安全层 · 业务底线）
// 检测 diff 新增行内容是否含密钥字符串 → 命中任意一条 → FAIL
// v1.3.7：输出聚合——同文件同模式多次命中时限量显示，避免超大 diff 输出爆炸
// v1.3.7 补编码绕过检测——新增行尝试 base64/hex 解码后再跑正则，
//   命中则报警（此前 `printf 'AKIA...' | base64 > encoded.txt` 即可绕过）。
//   另补 .gitattributes -diff 绕过检测——把文件标记为 -diff 会让 git diff
//   不输出内容行，A2 扫不到任何新增行（静默全绿），检测到该模式时 WARN。
// evidenceMode: git-diff
// ============================================================

import type { AuditContext, RuleCheck } from './types';
import { SECRET_PATTERNS } from '@sofagent/core';

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
function tryDecodeBase64(s: string): string | null {
  if (!/^[A-Za-z0-9+/=\s]+$/.test(s) || s.replace(/\s+/g, '').length < 8 || s.replace(/\s+/g, '').length % 4 !== 0) {
    return null;
  }
  try {
    const decoded = Buffer.from(s.replace(/\s+/g, ''), 'base64').toString('utf-8');
    if (decoded && /[\x20-\x7E\u4e00-\u9fff]/.test(decoded) && !decoded.includes('\uFFFD')) {
      return decoded;
    }
  } catch { /* 解码失败忽略 */ }
  return null;
}

function tryDecodeHex(s: string): string | null {
  const hexStr = s.replace(/\s+/g, '');
  if (!/^[0-9a-fA-F]+$/.test(hexStr) || hexStr.length < 16 || hexStr.length % 2 !== 0) {
    return null;
  }
  try {
    const decoded = Buffer.from(hexStr, 'hex').toString('utf-8');
    if (decoded && /[\x20-\x7E\u4e00-\u9fff]/.test(decoded) && !decoded.includes('\uFFFD')) {
      return decoded;
    }
  } catch { /* 解码失败忽略 */ }
  return null;
}

function candidatePlaintexts(content: string): string[] {
  const candidates: string[] = [content];
  const trimmed = content.trim();

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
          for (const { pattern, label } of SECRET_PATTERNS) {
            if (pattern.test(candidate)) {
              const key = `${file.path}|${label}`;
              const existing = groupedDetections.get(key);
              if (existing) {
                existing.count++;
              } else {
                groupedDetections.set(key, { file: file.path, label, count: 1 });
              }
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

  // .gitattributes -diff 绕过检测（WARN 级——该模式可能让密钥对 git diff 隐身）
  const attrHiddenTargets = detectGitattributesDiffHidden(ctx);
  if (attrHiddenTargets.length > 0) {
    if (rule.status === 'PASS') rule.status = 'WARN';
    rule.details.push(
      `检测到 .gitattributes 将以下文件标记为 -diff（内容不会出现在 git diff 中，A2 无法扫描）: ${attrHiddenTargets.join(', ')}。请确认这些文件不包含密钥，或改用真实二进制审计方案。`
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
