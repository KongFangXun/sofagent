// ============================================================
// tool-sensitive-file.ts · 移植 audit rule-a1（敏感文件保护）
// v1.3.5：tool 视角——校验 args 里的文件路径
// ============================================================

import type { ToolRule, ToolCallContext, InterceptVerdict } from '../types';

/** 敏感文件路径模式（与 audit rule-a1 取并集统一） */
const SENSITIVE_PATTERNS: RegExp[] = [
  /\.env[\w.-]*$/i,            // .env, .env.local, .env.production, .envrc 等
  /\.sofagent\/config/i,
  /\.sofagent\/knowledge/i,
  /\.sofagent\/audit/i,
  /\.sofagent\/think/i,
  /\/\.ssh\//i,
  /\/\.gnupg\//i,
  /\.pem$/i,
  /\.key$/i,
  /\.pfx$/i,                   // *.pfx（与 audit rule-a1 对齐）
  /\.p12$/i,                   // *.p12（与 audit rule-a1 对齐）
  /id_rsa/i,
  /id_ed25519/i,
  /\.kube\/config/i,
  /\.docker\/config/i,
  /credentials/i,
  /\.npmrc$/i,
  /\.pypirc$/i,
];

/** 路径类字段名匹配（仅这些 key 的值才当作文件路径扫描） */
const PATH_LIKE_KEY = /path|file|dir|folder|source|dest|target/i;

/**
 * 从 tool call args 中提取"路径类字段"的字符串值。
 *
 * v1.2.0 修复：只取路径类字段（path / file_path / edit_path 等），
 * 不再把 write_file 的 content、edit_file 的 old/new_string、
 * run_bash 的 command 等文本字段当路径扫描——
 * 否则合法写入（内容含 "credentials" 字样）或
 * `cat ~/.ssh/config` 这类命令会被误判为敏感文件操作。
 */
function extractFilePaths(args: Record<string, unknown>): string[] {
  const paths: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    const keyIsPathLike = PATH_LIKE_KEY.test(key);
    if (typeof value === 'string' && value.length > 0) {
      // 标量字符串：仅路径类字段参与扫描
      if (keyIsPathLike) paths.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item.length > 0) {
          // 数组元素：仅当数组所在 key 本身是路径类字段（如 files / paths）
          // 才把其中的字符串当作路径。避免扫描 command 等文本数组。
          if (keyIsPathLike) paths.push(item);
        } else if (typeof item === 'object' && item !== null) {
          paths.push(...extractFilePaths(item as Record<string, unknown>));
        }
      }
    } else if (typeof value === 'object' && value !== null) {
      paths.push(...extractFilePaths(value as Record<string, unknown>));
    }
  }
  return paths;
}

/**
 * tool-sensitive-file 规则——检查 tool call 是否操作了敏感文件
 * 移植自 audit rule-a1（tool 视角）
 *
 * 同形字防御（与 audit rule-a1 对齐）：路径以点开头、含 "nv" 子串、且含非 ASCII 字符时，
 * 视为可疑同形字文件名（如西里尔字母 е 替换拉丁 e 的 .еnv），按 FAIL 处理。
 */
export const toolSensitiveFile: ToolRule = {
  name: 'tool-sensitive-file',
  number: 1,
  ruleClass: '业务底线',
  ruleType: 'tool',

  check(ctx: ToolCallContext): InterceptVerdict {
    const filePaths = extractFilePaths(ctx.args);
    const hits: string[] = [];

    for (const filePath of filePaths) {
      // 同形字防御（与 audit rule-a1 对齐）
      const baseName = filePath.split('/').pop() ?? filePath;
      if (/^\..*nv/i.test(baseName) && /[^\x00-\x7f]/.test(baseName)) {
        hits.push(`${filePath}（可疑同形字文件名）`);
        continue;
      }
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
