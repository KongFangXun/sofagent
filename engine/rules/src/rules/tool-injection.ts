// ============================================================
// tool-injection.ts · 移植 audit rule-a9（prompt injection 检测）
// v1.3.7：tool 视角——扫 args 里的 prompt injection 模式
// ============================================================

import type { ToolRule, ToolCallContext, InterceptVerdict } from '../types';

/**
 * Prompt injection 高置信度模式
 * 与 audit rule-a9 对齐（但只取高置信度模式，避免 tool args 误报）
 *
 * 注意：模式用 new RegExp + 字符串拼接构建，避免正则字面量中的注入示例串
 * 触发 A9 审计规则误报（铁律 #3：fixture 中的 secret-like / injection-like 串
 * 必须运行时拼接）
 */
const _I = 'ign' + 'ore';
const _D = 'disr' + 'egard';
const _P = 'prev' + 'ious';
const _INS = 'instru' + 'ctions';
const _PRO = 'prom' + 'pts';

const INJECTION_PATTERNS: RegExp[] = [
  // 英文经典模式（拼接构建避免 A9 误报）
  new RegExp(`${_I}\\s+(all\\s+)?(${_P}|prior|above)\\s+(${_INS}?|${_PRO}?)`, 'i'),
  new RegExp(`${_D}\\s+(all\\s+)?(${_P}|prior)\\s+(${_INS}?|${_PRO}?)`, 'i'),
  /forget\s+(everything|all\s+(previous|prior)\s+(instructions?|prompts?))/i,
  /you\s+are\s+now\s+(a|an)\s+(different|new)/i,
  /new\s+instructions?\s*:/i,
  /system\s*:\s*you\s+are/i,
  // 中文经典模式（拼接构建避免 A9 误报）
  new RegExp('忽' + '略以上所有(指令|提示)'),
  new RegExp('忽' + '略(上面|之前|前面)的(指令|提示|规则)'),
  new RegExp('忘' + '记(之前|前面)的(指令|设定)'),
  /你现在(是|扮演)/,
];

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
  number: 9,
  ruleClass: '业务底线',
  ruleType: 'tool',

  check(ctx: ToolCallContext): InterceptVerdict {
    const allStrings = extractStrings(ctx.args);
    const hits: string[] = [];

    for (const str of allStrings) {
      for (const pattern of INJECTION_PATTERNS) {
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
