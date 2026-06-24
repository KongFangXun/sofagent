#!/usr/bin/env node
// ============================================================
// sofagent-audit · 提交时审计 CLI 入口
// v0.91 · 由 DeepSeek V4 Pro 和 GLM-5.2 配合生成
// ============================================================
// 扫描 git diff，检查 Agent 是否遵守 sofagent 铁律。
// 零运行时依赖——只用 Node.js 内置模块。
//
// 用法：
//   node sofagent-audit --diff HEAD~1..HEAD --task "修复登录页 bug"
//   npx sofagent-audit --diff HEAD~1..HEAD
//
// 退出码：
//   0 = 全通过
//   1 = 有警告（铁律 #7/#10）
//   2 = 有违规（铁律 #1/#3）
// ============================================================

import { parseDiff, type DiffFile } from './diff-parser';
import { checkLogs } from './log-checker';
import { runRules, type AuditResult } from './reporter';

interface Args {
  diffRange: string;
  task?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { diffRange: 'HEAD~1..HEAD' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--diff' && argv[i + 1]) {
      args.diffRange = argv[++i];
    } else if (argv[i] === '--task' && argv[i + 1]) {
      args.task = argv[++i];
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('sofagent-audit v0.91 · 提交时审计\n');
      console.log('用法: sofagent-audit --diff <range> [--task <description>]');
      console.log('  --diff    git diff 范围（默认 HEAD~1..HEAD）');
      console.log('  --task    任务描述（用于铁律 #7 谨慎修改检查）');
      console.log('退出码: 0=全通过 / 1=有警告 / 2=有违规');
      process.exit(0);
    } else if (argv[i] === '--version') {
      console.log('sofagent-audit v0.91');
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

  // 3. 运行规则
  const results = runRules(diffFiles, logEntries, args.task);

  // 4. 输出结果
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

    for (const detail of rule.details) {
      console.log(`${icon} ${rule.name}: ${detail}`);
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
