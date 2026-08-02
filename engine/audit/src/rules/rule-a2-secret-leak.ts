// ============================================================
// A2 不泄密钥（安全层 · 业务底线）
// 检测 diff 新增行内容是否含密钥字符串 → 命中任意一条 → FAIL
// v1.2.0：输出聚合——同文件同模式多次命中时限量显示，避免超大 diff 输出爆炸
// v1.2.5 P0-4：补编码绕过检测——新增行尝试 base64/hex 解码后再跑正则，
//   命中则报警（此前 `printf 'AKIA...' | base64 > encoded.txt` 即可绕过）。
//   另补 .gitattributes -diff 绕过检测——把文件标记为 -diff 会让 git diff
//   不输出内容行，A2 扫不到任何新增行（静默全绿），检测到该模式时 WARN。
// evidenceMode: git-diff
// ============================================================

import type { AuditContext, RuleCheck } from './types';

/**
 * 密钥泄漏检测正则模式
 *
 * 注意：sk-ant- 规则在 sk-[a-zA-Z0-9] 通用规则之前，保证 Anthropic key
 * 先被精确匹配而非被通用规则吞掉。聚合检测（groupedDetections）以 label
 * 去重，同一文件同一 label 只显示一次。
 *
 * 未覆盖的 key 格式（误报风险高，保守不加正则）：
 * - GLM（智谱）：格式为 id.secret 点分隔（如 8a3b1c2d9e7f4g5h.xxx），正则误报率高
 * - 通义千问：格式不确定
 * 以上规划在 v1.3.x 用 LLM 辅助检测。
 */
const SECRET_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /AKIA[A-Z0-9]{16}/, label: 'AWS Access Key' },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: 'Private Key' },
  { pattern: /sk-ant-(api03|api04)-[A-Za-z0-9_-]{40,}/, label: 'Anthropic API Key' },
  { pattern: /sk-proj-[a-zA-Z0-9_]{40,}/, label: 'OpenAI Project Key' },
  { pattern: /sk-svcacct-[a-zA-Z0-9_]{40,}/, label: 'OpenAI Service Account Key' },
  { pattern: /sk-admin-[a-zA-Z0-9_]{40,}/, label: 'OpenAI Admin Key' },
  // 通用 sk- key（48 位匹配 OpenAI，32-47 位匹配 DeepSeek 等短 key 厂商）
  { pattern: /sk-[a-zA-Z0-9]{32,}/, label: 'Possible API Key (OpenAI/DeepSeek)' },
  { pattern: /gh[ps]_[A-Za-z0-9]{36}/, label: 'GitHub Token' },
];

/** 同文件同模式的聚合上限——超过则用汇总行 */
const MAX_DISPLAY_PER_GROUP = 5;

/**
 * P0-4: 对一条新增行生成「明文候选」——原行 + 可能的 base64/hex 解码结果。
 * 仅当行内容形态符合编码特征（且能解码出可打印文本）才尝试，避免误伤普通文本。
 */
function candidatePlaintexts(content: string): string[] {
  const candidates: string[] = [content];
  const trimmed = content.trim();

  // base64 候选：仅含 base64 字符集、长度 ≥8 且为 4 的倍数、解码为可打印文本
  if (
    /^[A-Za-z0-9+/=\s]+$/.test(trimmed) &&
    trimmed.length >= 8 &&
    trimmed.length % 4 === 0
  ) {
    try {
      const decoded = Buffer.from(trimmed.replace(/\s+/g, ''), 'base64').toString('utf-8');
      if (decoded && /[\x20-\x7E\u4e00-\u9fff]/.test(decoded) && !decoded.includes('\uFFFD')) {
        candidates.push(decoded);
      }
    } catch { /* 解码失败忽略 */ }
  }

  // hex 候选：偶数长度、仅含 0-9a-f、解码为可打印文本
  const hexStr = trimmed.replace(/\s+/g, '');
  if (/^[0-9a-fA-F]+$/.test(hexStr) && hexStr.length >= 16 && hexStr.length % 2 === 0) {
    try {
      const decoded = Buffer.from(hexStr, 'hex').toString('utf-8');
      if (decoded && /[\x20-\x7E\u4e00-\u9fff]/.test(decoded) && !decoded.includes('\uFFFD')) {
        candidates.push(decoded);
      }
    } catch { /* 解码失败忽略 */ }
  }

  return candidates;
}

/**
 * P0-4: 检测 .gitattributes -diff 绕过。
 * 当 diff 中出现 `.gitattributes` 的新增行含 `-diff` 属性时，被标记文件的内容
 * 不会出现在 git diff 输出中 → A2 扫不到其新增行（静默全绿）。返回命中的文件名列表。
 */
function detectGitattributesDiffBypass(ctx: AuditContext): string[] {
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
        // P0-4: 原行 + base64/hex 解码候选
        for (const candidate of candidatePlaintexts(content)) {
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

  // P0-4: .gitattributes -diff 绕过检测（WARN 级——该模式可能让密钥对 git diff 隐身）
  const attrBypassTargets = detectGitattributesDiffBypass(ctx);
  if (attrBypassTargets.length > 0) {
    if (rule.status === 'PASS') rule.status = 'WARN';
    rule.details.push(
      `检测到 .gitattributes 将以下文件标记为 -diff（内容不会出现在 git diff 中，A2 无法扫描）: ${attrBypassTargets.join(', ')}。请确认这些文件不包含密钥，或改用真实二进制审计方案。`
    );
  }

  return rule;
}
