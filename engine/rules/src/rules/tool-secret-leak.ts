// ============================================================
// tool-secret-leak.ts · 移植 audit rule-a2（密钥泄漏检测）
// v1.2.9：tool 视角——扫 args 字面量里的密钥模式
// v1.2.9 SECRET_PATTERNS 抽到 @sofagent/core 共享——此前本文件用严格
//   48 位 sk- 模式导致 32-47 位密钥被 ToolGate 放行（与 A2 漂移互补成洞）。
// ============================================================

import type { ToolRule, ToolCallContext, InterceptVerdict } from '../types';
import { SECRET_PATTERNS } from '@sofagent/core';
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

  check(ctx: ToolCallContext): InterceptVerdict {
    const allStrings = extractStrings(ctx.args);
    const detections: string[] = [];

    for (const str of allStrings) {
      for (const { pattern, label } of SECRET_PATTERNS) {
        if (pattern.test(str)) {
          detections.push(label);
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
