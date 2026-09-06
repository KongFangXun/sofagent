// ============================================================
// github-formatter.ts · GitHub Annotations 格式化器
// v1.4.5 (⑧-3)：将审计结果转为 GitHub Actions Annotation 格式
//
// GitHub Annotations 规范：
//   ::error file={file},line={line}::{message}
//   ::warning file={file},line={line}::{message}
//
// GitHub Actions 运行器自动捕获这种格式的 stdout，
// 渲染成 PR diff 上的红框（error）/ 黄框（warning）。
// ============================================================

import type { AuditResult, RuleCheck } from '../reporter';

/**
 * GitHub Annotations 输出格式选项
 */
export interface GithubFormatOptions {
  /** 工作区根目录（用于将绝对路径转为相对路径，GitHub 需要相对路径） */
  workspaceRoot?: string;
}

/**
 * 从规则检查详情中提取文件路径和行号
 *
 * 规则详情格式因规则而异，常见模式：
 *   "src/config.ts:42: 检测到硬编码的API密钥"
 *   "src/utils.ts L15: console.log残留"
 *   "src/config.ts(42,1): ..."
 *
 * @param detail 规则详情字符串
 * @returns 文件路径和行号（行号缺省为 1）
 */
export function extractFileLine(
  detail: string
): { file: string; line: number } | null {
  // 匹配 "path/to/file.ext:line" 或 "path/to/file.ext Lline" 或 "path/to/file.ext(line"
  // 支持常见格式：file.ts:42 / file.ts L42 / file.ts(42
  const patterns: RegExp[] = [
    /([^\s:]+?\.\w+):(\d+)/,        // file.ts:42
    /([^\s]+?\.\w+)\s*L(\d+)/i,      // file.ts L42
    /([^\s(]+?\.\w+)\((\d+)/,        // file.ts(42
  ];

  for (const pattern of patterns) {
    const match = detail.match(pattern);
    if (match && match[1] && match[2]) {
      return {
        file: match[1],
        line: parseInt(match[2], 10) || 1,
      };
    }
  }

  // 匹配纯文件路径（无行号）——排除括号/引号等包裹字符
  const fileOnly = detail.match(/([^\s:()（）"']+?\.\w+)/);
  if (fileOnly && fileOnly[1]) {
    return { file: fileOnly[1], line: 1 };
  }

  return null;
}

/**
 * 将文件路径转为相对路径（GitHub Annotations 需要 repo 相对路径）
 *
 * @param filePath 文件路径
 * @param workspaceRoot 工作区根目录（可选）
 * @returns 相对于工作区的路径
 */
function toRelativePath(
  filePath: string,
  workspaceRoot?: string
): string {
  if (!workspaceRoot) return filePath;
  // 标准化路径分隔符
  const normalizedRoot = workspaceRoot.replace(/\/$/, '');
  const normalizedFile = filePath;
  if (normalizedFile.startsWith(normalizedRoot + '/')) {
    return normalizedFile.slice(normalizedRoot.length + 1);
  }
  if (normalizedFile.startsWith(normalizedRoot)) {
    return normalizedFile.slice(normalizedRoot.length);
  }
  return normalizedFile;
}

/**
 * 将审计结果格式化为 GitHub Annotations 字符串数组
 *
 * 每条违规（FAIL）输出为 `::error`，每条警告（WARN）输出为 `::warning`。
 * PASS 和 SKIPPED 规则不输出。
 *
 * @param result 审计结果（runRules 返回值）
 * @param options 格式化选项
 * @returns GitHub Annotations 字符串数组（每行一条）
 */
export function formatGithubAnnotations(
  result: AuditResult,
  options?: GithubFormatOptions
): string[] {
  const lines: string[] = [];

  for (const rule of result.rules) {
    if (rule.status === 'PASS' || rule.status === 'SKIPPED') {
      continue;
    }

    const level = rule.status === 'FAIL' ? 'error' : 'warning';
    const ruleName = `${rule.name}`;

    for (const detail of rule.details) {
      const location = extractFileLine(detail);
      if (location) {
        const file = toRelativePath(location.file, options?.workspaceRoot);
        const line = location.line;
        lines.push(
          `::${level} file=${file},line=${line}::${ruleName}：${detail}`
        );
      } else {
        // 无法提取文件位置，输出无位置 annotation
        lines.push(`::${level} ::${ruleName}：${detail}`);
      }
    }

    // 如果规则没有 details（仅 status），输出摘要
    if (rule.details.length === 0) {
      lines.push(`::${level} ::${ruleName}`);
    }
  }

  return lines;
}

/**
 * 生成完整的 GitHub Annotations 输出（含产品签名行）
 *
 * 输出到 stdout，GitHub Actions 运行器自动捕获。
 *
 * @param result 审计结果
 * @param ruleCount 参与审计的规则总数（用于签名行）
 * @param options 格式化选项
 * @returns 完整输出字符串（多行）
 */
export function generateGithubOutput(
  result: AuditResult,
  ruleCount: number,
  options?: GithubFormatOptions
): string {
  const annotations = formatGithubAnnotations(result, options);
  const parts: string[] = [];

  // 产品签名行（人类可读，非 annotation 格式）
  const verdict =
    result.exitCode === 0
      ? '✅ PASS'
      : result.exitCode === 1
        ? '⚠️ WARN'
        : '❌ FAIL';
  parts.push(`[sofagent] 审计完成 · ${ruleCount} 规则 · ${verdict}`);

  // Annotations
  if (annotations.length > 0) {
    parts.push(...annotations);
  } else {
    parts.push('✅ 所有规则全部通过');
  }

  return parts.join('\n');
}
