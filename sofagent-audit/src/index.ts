#!/usr/bin/env node
// ============================================================
// sofagent-audit · 提交时审计 CLI 入口
// v0.94 · 审计独立化
// ============================================================
// 扫描 git diff，检查 Agent 是否遵守 sofagent 铁律。
// 零运行时依赖——只用 Node.js 内置模块。
//
// 用法：
//   node sofagent-audit --diff HEAD~1..HEAD --task "修复登录页 bug"
//   node sofagent-audit --diff HEAD~1..HEAD --silent --task "test"
//   node sofagent-audit --diff HEAD~1..HEAD --ci --task "test"
//
// 退出码：
//   0 = 全通过
//   1 = 有警告（铁律 #7/#10）
//   2 = 有违规（铁律 #1/#3 / R11 敏感文件）
// ============================================================

import { execFileSync } from 'child_process';
import { parseDiff, type DiffFile } from './diff-parser';
import { checkLogs } from './log-checker';
import { runRules, type AuditResult } from './reporter';

interface Args {
  diffRange: string;
  task?: string;
  strict: boolean;
  silent: boolean;
  ci: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { diffRange: 'HEAD~1..HEAD', strict: false, silent: false, ci: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--diff' && argv[i + 1]) {
      args.diffRange = argv[++i];
    } else if (argv[i] === '--task' && argv[i + 1]) {
      args.task = argv[++i];
    } else if (argv[i] === '--strict') {
      args.strict = true;
    } else if (argv[i] === '--silent') {
      args.silent = true;
    } else if (argv[i] === '--ci') {
      args.ci = true;
      args.strict = true;   // --ci 隐含 --strict
      args.silent = true;   // --ci 隐含 --silent
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('sofagent-audit v0.94 · 审计独立化\n');
      console.log('用法: sofagent-audit --diff <range> [--task <description>] [--strict] [--silent] [--ci]');
      console.log('  --diff    git diff 范围（默认 HEAD~1..HEAD）');
      console.log('  --task    任务描述（用于铁律 #7 谨慎修改检查）');
      console.log('  --strict  严格模式：无日志时铁律 #1 返回 FAIL 而非 WARN');
      console.log('  --silent  沉默模式：跳过日志依赖规则，走 diff 启发式回退');
      console.log('  --ci      CI 模式 = strict + silent（适合无 Agent 日志的 CI 环境）');
      console.log('退出码: 0=全通过 / 1=有警告 / 2=有违规');
      process.exit(0);
    } else if (argv[i] === '--version') {
      console.log('sofagent-audit v0.94');
      process.exit(0);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  // 1. 解析 git diff
  const diffFiles = parseDiff(args.diffRange);

  if (diffFiles.length === 0) {
    console.log('✅ 没有文件变更，无需审计。');
    process.exit(0);
  }

  // 2. 读取任务日志
  const logEntries = checkLogs();

  // 3. 读取 commit message（用于 R3/R5 规则及 #10 回退）
  let commitMsg = '';
  try {
    commitMsg = execFileSync('git', ['log', '-1', '--pretty=%B'], { encoding: 'utf-8' }).trim();
  } catch {
    // 非 git 仓库或无 commit，留空
  }

  // 4. 运行规则
  const results = runRules(diffFiles, logEntries, args.task, args.strict, args.silent, commitMsg);

  // 5. 输出结果
  printResults(results, diffFiles);
  process.exit(results.exitCode);
}

function printResults(results: AuditResult, diffFiles: DiffFile[]): void {
  console.log(`\n[sofagent-audit] 扫描 ${diffFiles.length} 个变更文件\n`);
  let hasAnyOutput = false;

  for (const rule of results.rules) {
    const status = rule.status;
    const icon = status === 'PASS' ? '✅' : status === 'WARN' ? '⚠️ ' : '❌';
    if (status === 'PASS') continue; // 跳过的规则不显示
    hasAnyOutput = true;

    const evidenceTag = rule.evidenceMode ? `[evidenceMode: ${rule.evidenceMode}]` : '';
    for (const detail of rule.details) {
      console.log(`${icon} ${rule.name} ${evidenceTag}: ${detail}`);
    }
  }

  if (!hasAnyOutput) {
    console.log('✅ 全部铁律通过。');
  }

  console.log('');
  console.log(`判定: ${results.exitCode === 0 ? '✅ PASS' : results.exitCode === 1 ? '⚠️  WARN (有警告)' : '❌ FAIL (有违规)'}`);
}

main().catch((err) => {
  console.error('sofagent-audit 内部错误:', err.message);
  process.exit(2);
});
