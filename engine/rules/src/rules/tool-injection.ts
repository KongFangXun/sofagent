// ============================================================
// tool-injection.ts · 移植 audit rule-a9（prompt injection 检测）
// v1.5.3：tool 视角——扫 args 里的 prompt injection 模式
// ============================================================

import type { ToolRule, ToolCallContext, InterceptVerdict } from '../types';
import { TOOL_INJECTION_PATTERNS, ruleDefinition } from '@sofagent/core';

/** 共用规则定义（@sofagent/core 单一事实源——与 audit A9 同一套定义） */
const A9_DEF = ruleDefinition('A9')!;

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
 * tool-injection 规则——检查 tool call args 是否含 prompt injection 模式
 * 移植自 audit rule-a9（tool 视角）
 */
export const toolInjection: ToolRule = {
  name: 'tool-injection',
  number: A9_DEF.number,
  ruleClass: '业务底线',
  ruleType: 'tool',

  check(ctx: ToolCallContext): InterceptVerdict {
    const allStrings = extractStrings(ctx.args);
    const hits: string[] = [];

    for (const str of allStrings) {
      for (const pattern of TOOL_INJECTION_PATTERNS) {
        if (pattern.test(str)) {
          hits.push(str.substring(0, 80));
          break;
        }
      }
    }

    if (hits.length > 0) {
      return {
        status: 'FAIL',
        ruleName: 'tool-injection',
        ruleNumber: 9,
        details: [`检测到 prompt injection 模式: ${hits.length} 处。tool 参数中含可疑指令注入。`],
        suggestion: '检查 tool 参数来源——如果是用户输入，需在传入 tool 前做脱敏/转义。',
      };
    }

    return {
      status: 'PASS',
      ruleName: 'tool-injection',
      ruleNumber: 9,
      details: [],
      suggestion: '',
    };
  },
};
