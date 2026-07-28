// ============================================================
// A2 不泄密钥（安全层 · 业务底线）
// 检测 diff 新增行内容是否含密钥字符串 → 命中任意一条 → FAIL
// v1.2.0：输出聚合——同文件同模式多次命中时限量显示，避免超大 diff 输出爆炸
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
        for (const { pattern, label } of SECRET_PATTERNS) {
          if (pattern.test(content)) {
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

  return rule;
}
