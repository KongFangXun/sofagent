#!/usr/bin/env node
// ============================================================
// cli-quick.ts · npx sofagent-audit 零配置 CLI 入口
// v1.2.9 (⑧-1)：30 秒 aha moment——任何 git repo 都能跑
//
// 用法：
//   npx sofagent-audit              # 审计最近一次 commit
//   npx sofagent-audit HEAD~3..HEAD # 审计指定范围
//
// 设计约束：
//   - 零配置——不读 .sofagent/，不依赖 SKILL 加载链
//   - 自动检测——有 .git 就跑，没有就提示
//   - 零 token——纯本地规则扫描，不调 LLM
//   - 3 秒内输出——规则扫描本身是毫秒级
//
// 退出码：
//   0 = 全通过
//   1 = 有警告
//   2 = 有违规
//   3 = 非 git 仓库
// ============================================================

import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { parseDiff, isInGitRepo, type DiffFile } from '@sofagent/core';
import { runRules, type AuditResult, type RuleCheck } from './reporter';

/**
 * 获取最近一次 commit 的短 SHA
 */
function getLatestCommitSha(): string {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf-8',
    }).trim();
    return sha;
  } catch {
    return 'unknown';
  }
}

/**
 * 格式化单条审计结果为 emoji 输出行
 *
 * @param rule 单条规则检查结果
 * @returns 格式化后的输出行数组
 */
export function formatQuickResult(rule: RuleCheck): string[] {
  const lines: string[] = [];
  const icon =
    rule.status === 'FAIL' ? '❌' :
    rule.status === 'WARN' ? '⚠️ ' :
    rule.status === 'SKIPPED' ? '⏭️ ' :
    '✅';

  if (rule.status === 'PASS' || rule.status === 'SKIPPED') {
    // PASS / SKIPPED 不逐条输出，汇总即可
    return lines;
  }

  // FAIL / WARN 逐条输出详情
  if (rule.details.length === 0) {
    lines.push(`${icon} ${rule.name}`);
  } else {
    for (const detail of rule.details) {
      lines.push(`${icon} ${rule.name}：${detail}`);
    }
  }

  return lines;
}

/**
 * 生成完整的 quick 模式输出
 *
 * @param result 审计结果
 * @param commitSha 最近一次 commit 的短 SHA
 * @returns 完整输出字符串
 */
export function generateQuickOutput(
  result: AuditResult,
  commitSha: string
): string {
  const parts: string[] = [];

  // 标题行
  parts.push(`🔍 审计最近一次 commit（${commitSha}）`);
  parts.push('');

  // 违规 / 警告详情
  let violationCount = 0;
  let warnCount = 0;
  let passCount = 0;
  let skipCount = 0;

  for (const rule of result.rules) {
    if (rule.status === 'FAIL') violationCount++;
    else if (rule.status === 'WARN') warnCount++;
    else if (rule.status === 'PASS') passCount++;
    else if (rule.status === 'SKIPPED') skipCount++;

    const ruleLines = formatQuickResult(rule);
    parts.push(...ruleLines);
  }

  // 汇总行
  parts.push('');
  if (violationCount === 0 && warnCount === 0) {
    parts.push(`✅ 全部 ${passCount} 条规则通过${skipCount > 0 ? `（${skipCount} 条跳过）` : ''}`);
  } else {
    const summaryParts: string[] = [];
    if (violationCount > 0) summaryParts.push(`${violationCount} 条违规`);
    if (warnCount > 0) summaryParts.push(`${warnCount} 条警告`);
    if (passCount > 0) summaryParts.push(`${passCount} 条通过`);
    if (skipCount > 0) summaryParts.push(`${skipCount} 条跳过`);
    parts.push(`📊 ${summaryParts.join(' · ')}`);
  }

  // 产品签名
  parts.push('');
  parts.push('— sofagent 审计 · 零 token 纯 git diff 扫描');

  return parts.join('\n');
}

/**
 * cli-quick 主入口
 *
 * @param argv 命令行参数（process.argv）
 * @returns 退出码
 */
export function runCliQuick(argv: string[]): number {
  // 1. 检测 git 仓库
  const cwd = process.cwd();
  const isGitRepo = existsSync(join(cwd, '.git')) || isInGitRepo();

  if (!isGitRepo) {
    console.log('⚠️  当前目录不在 git 仓库内。');
    console.log('   npx sofagent-audit 需要在 git 仓库内运行。');
    console.log('   请 cd 到你的项目目录后重试。');
    return 3;
  }

  // 2. 确定 diff 范围（默认 HEAD~1..HEAD）
  const diffRange = argv[2] && !argv[2].startsWith('-') && argv[2] !== 'quick'
    ? argv[2]
    : 'HEAD~1..HEAD';

  // 3. 取 commit SHA
  const commitSha = getLatestCommitSha();

  // 4. 取 diff
  let diffOutput: string;
  try {
    diffOutput = execFileSync('git', ['diff', diffRange], {
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024, // 50MB
    });
  } catch {
    console.log(`⚠️  无法获取 git diff（范围：${diffRange}）。`);
    console.log('   可能原因：');
    console.log('   - 这是首次 commit（没有 HEAD~1）');
    console.log('   - diff 范围无效');
    console.log('');
    console.log('   尝试：npx sofagent-audit HEAD~2..HEAD');
    return 3;
  }

  // 5. 解析 diff
  let diffFiles: DiffFile[];
  try {
    diffFiles = parseDiff(diffOutput);
  } catch {
    console.log('⚠️  diff 解析失败。');
    return 3;
  }

  if (diffFiles.length === 0) {
    console.log(`🔍 审计最近一次 commit（${commitSha}）`);
    console.log('');
    console.log('✅ 无文件变更——没有需要审计的内容。');
    return 0;
  }

  // 6. 运行审计规则（quick 模式：silent=true，零日志依赖）
  const result = runRules(diffFiles, [], 'quick-audit', false, true);

  // 7. 格式化输出
  const output = generateQuickOutput(result, commitSha);
  console.log(output);

  // 8. 返回退出码
  return result.exitCode;
}

// 直接运行（非 require）
if (require.main === module) {
  const exitCode = runCliQuick(process.argv);
  process.exit(exitCode);
}
