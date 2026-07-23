// ============================================================
// tool-sensitive-file.ts · 移植 audit rule-a1（敏感文件保护）
// v1.2.0：tool 视角——校验 args 里的文件路径
// ============================================================

import type { ToolRule, ToolCallContext, InterceptVerdict } from '../types';

/** 敏感文件路径模式（与 audit rule-a1 对齐） */
const SENSITIVE_PATTERNS: RegExp[] = [
  /\.env$/i,
  /\.env\./i,
  /\.sofagent\/config/i,
  /\.sofagent\/knowledge/i,
  /\.sofagent\/audit/i,
  /\.sofagent\/think/i,
  /\/\.ssh\//i,
  /\/\.gnupg\//i,
  /\.pem$/i,
  /\.key$/i,
  /id_rsa/i,
  /id_ed25519/i,
  /\.kube\/config/i,
  /\.docker\/config/i,
  /credentials/i,
  /\.npmrc$/i,
  /\.pypirc$/i,
];

/**
 * 从 tool call args 中提取所有可能是文件路径的字符串值
 */
function extractFilePaths(args: Record<string, unknown>): string[] {
  const paths: string[] = [];
  for (const value of Object.values(args)) {
    if (typeof value === 'string' && value.length > 0) {
      paths.push(value);
    }
    if (typeof value === 'object' && value !== null) {
      paths.push(...extractFilePaths(value as Record<string, unknown>));
    }
  }
  return paths;
}

/**
 * tool-sensitive-file 规则——检查 tool call 是否操作了敏感文件
 * 移植自 audit rule-a1（tool 视角）
 */
export const toolSensitiveFile: ToolRule = {
  name: 'tool-sensitive-file',
  number: 1,
  ruleClass: '业务底线',

  check(ctx: ToolCallContext): InterceptVerdict {
    const filePaths = extractFilePaths(ctx.args);
    const hits: string[] = [];

    for (const filePath of filePaths) {
      for (const pattern of SENSITIVE_PATTERNS) {
        if (pattern.test(filePath)) {
          hits.push(filePath);
          break;
        }
      }
    }

    if (hits.length > 0) {
      return {
        status: 'FAIL',
        ruleName: 'tool-sensitive-file',
        ruleNumber: 1,
        details: [`检测到敏感文件操作: ${hits.join(', ')}`],
        suggestion: '敏感文件操作需用户确认。如确需操作，请在用户明确授权后执行。',
      };
    }

    return {
      status: 'PASS',
      ruleName: 'tool-sensitive-file',
      ruleNumber: 1,
      details: [],
      suggestion: '',
    };
  },
};
