// ============================================================
// tool-secret-leak.ts · 移植 audit rule-a2（密钥泄漏检测）
// v1.4.4：tool 视角——扫 args 字面量里的密钥模式
// v1.4.4 SECRET_PATTERNS 抽到 @sofagent/core 共享——此前本文件用严格
//   48 位 sk- 模式导致 32-47 位密钥被 ToolGate 放行（与 A2 漂移互补成洞）。
// ============================================================

import type { ToolRule, ToolCallContext, InterceptVerdict } from '../types';
import { SECRET_PATTERNS, stripDataUris } from '@sofagent/core';
/**
 * 从 tool call args 中提取所有字符串值（递归）
 */
function extractStrings(args: Record<string, unknown>): string[] {
  const strings: string[] = [];
  for (const value of Object.values(args)) {
    if (typeof value === 'string') {
      strings.push(value);
    } else if (typeof value === 'object' && value !== null) {
      strings.push(...extractStrings(value as Record<string, unknown>));
    }
  }
  return strings;
}

/**
 * tool-secret-leak 规则——检查 tool call args 是否含密钥串
 * 移植自 audit rule-a2（tool 视角）
 */
export const toolSecretLeak: ToolRule = {
  name: 'tool-secret-leak',
  number: 2,
  ruleClass: '业务底线',
  ruleType: 'tool',

  check(ctx: ToolCallContext): InterceptVerdict {
    const allStrings = extractStrings(ctx.args);
    const detections: string[] = [];

    for (const str of allStrings) {
      // v1.4.4：剥离 data URI 内嵌资源——base64 载荷原文撞裸 40 位模式 + 载荷内
      // 随机子串凑出 contextKeyword（实锤：70KB logo 载荷内藏 aws/key 子串被拦）。
      // 与 A2 同口径豁免（stripDataUris 共享自 @sofagent/core），剩余文本照常检测。
      const scanStr = stripDataUris(str);
      // v1.4.4：contextKeyword 按「行」判定——H-02 设计语义是「同行含关键词」，
      // 此前对整串判定：多行文本中 CSS @keyframes 的 "key"（第 1 行）能给 200 行外
      // 的 GitHub URL 40 位段（形如 KongFangXun/sofagent/blob/main/FDE/GUIDE）
      // 凑齐上下文——跨行凑词是预存语义 bug。多行文本逐行扫描，行内上下文语义
      // 与 A2（git diff 逐行）完全对齐；单行 args 行为不变。
      const lines = scanStr.includes('\n') ? scanStr.split('\n') : [scanStr];
      for (const line of lines) {
        for (const { pattern, label, contextKeyword } of SECRET_PATTERNS) {
          if (pattern.test(line)) {
            // v1.4.2 H-02: 带 contextKeyword 的模式需同行含关键词才报告（与 A2 同口径防误报）
            if (contextKeyword && !contextKeyword.test(line)) continue;
            detections.push(label);
          }
        }
      }
    }

    if (detections.length > 0) {
      return {
        status: 'FAIL',
        ruleName: 'tool-secret-leak',
        ruleNumber: 2,
        details: [`检测到密钥/令牌: ${detections.join(', ')}。密钥不应硬编码到工具参数中。`],
        suggestion: '将密钥写入 .env -> .gitignore 加 .env -> 使用环境变量引用。',
      };
    }

    return {
      status: 'PASS',
      ruleName: 'tool-secret-leak',
      ruleNumber: 2,
      details: [],
      suggestion: '',
    };
  },
};
