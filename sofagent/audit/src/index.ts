#!/usr/bin/env node
// ============================================================
// sofagent-audit · 提交时审计 CLI 入口
// v0.97 · 铁律与审计分离
// ============================================================
// 扫描 git diff，检查 Agent 是否遵守审计规则。
// 零运行时依赖——只用 Node.js 内置模块。
//
// 用法：
//   node sofagent/audit/dist/index.js --diff HEAD~1..HEAD --task "修复登录页 bug"
//   node sofagent/audit/dist/index.js --diff HEAD~1..HEAD --silent --task "test"
//   node sofagent/audit/dist/index.js --diff HEAD~1..HEAD --ci --task "test"
//
// 退出码：
//   0 = 全通过
//   1 = 有警告
//   2 = 有违规（A1 不碰敏感 / A2 不泄密钥）
// ============================================================

import { execFileSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { parseDiff, type DiffFile } from './diff-parser';
import { checkLogs } from './log-checker';
import { runRules, type AuditResult } from './reporter';
import { loadConfig } from './config-loader';

interface Args {
  diffRange: string;
  task?: string;
  strict: boolean;
  silent: boolean;
  ci: boolean;
  installHook: boolean;
  json: boolean;
}

const VERSION = '0.97';

function parseArgs(argv: string[]): Args {
  const args: Args = { diffRange: 'HEAD~1..HEAD', strict: false, silent: false, ci: false, installHook: false, json: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--diff' && argv[i + 1]) {
      i++;
      args.diffRange = argv[i]!;
    } else if (argv[i] === '--task' && argv[i + 1]) {
      i++;
      args.task = argv[i]!;
    } else if (argv[i] === '--strict') {
      args.strict = true;
    } else if (argv[i] === '--silent') {
      args.silent = true;
    } else if (argv[i] === '--ci') {
      args.ci = true;
      args.strict = true;   // --ci 隐含 --strict
      args.silent = true;   // --ci 隐含 --silent
    } else if (argv[i] === '--install-hook') {
      args.installHook = true;
    } else if (argv[i] === '--json') {
      args.json = true;
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(`sofagent-audit v${VERSION} · 铁律与审计分离\n`);
      console.log('用法: sofagent-audit --diff <range> [--task <description>] [--strict] [--silent] [--ci] [--json] [--install-hook]');
      console.log('  --diff          git diff 范围（默认 HEAD~1..HEAD）');
      console.log('  --task          任务描述（用于 A3 不改越界检查）');
      console.log('  --strict        严格模式：无日志时 A7 返回 FAIL 而非 WARN');
      console.log('  --silent        沉默模式：跳过日志依赖规则，走 diff 启发式回退');
      console.log('  --ci            CI 模式 = strict + silent（适合无 Agent 日志的 CI 环境）');
      console.log('  --json          JSON 输出模式：输出 { exitCode, rules } JSON，适合 CI 解析');
      console.log('  --install-hook  安装 git pre-commit hook 到当前仓库的 .git/hooks/');
      console.log('退出码: 0=全通过 / 1=有警告 / 2=有违规');
      process.exit(0);
    } else if (argv[i] === '--version') {
      console.log(`sofagent-audit v${VERSION}`);
      process.exit(0);
    }
  }
  return args;
}

/**
 * 安装 git pre-commit hook
 * 从 cwd 往上查找 .git 目录，将 hooks/pre-commit 模板复制到 .git/hooks/
 */
function installHook(): void {
  // 从 cwd 往上查找 .git 目录
  let currentDir: string = process.cwd();
  let gitDir: string | null = null;

  while (true) {
    const candidate = join(currentDir, '.git');
    if (existsSync(candidate)) {
      gitDir = candidate;
      break;
    }
    const parent = dirname(currentDir);
    if (parent === currentDir) {
      // 到达根目录，未找到
      break;
    }
    currentDir = parent;
  }

  if (!gitDir) {
    console.error('❌ 未找到 .git 目录。请在 git 仓库内运行 --install-hook。');
    process.exit(1);
  }

  // 定位 pre-commit 模板
  // dist/index.js 编译后，模板在 ../../hooks/pre-commit（相对于 dist/）
  const hookTemplate = join(__dirname, '..', 'hooks', 'pre-commit');

  if (!existsSync(hookTemplate)) {
    console.error(`❌ 未找到 pre-commit 模板: ${hookTemplate}`);
    process.exit(1);
  }

  // 确保目标目录存在
  const hooksDir = join(gitDir, 'hooks');
  if (!existsSync(hooksDir)) {
    mkdirSync(hooksDir, { recursive: true });
  }

  const destPath = join(hooksDir, 'pre-commit');

  // 读取模板并写入
  const templateContent = readFileSync(hookTemplate, 'utf-8');
  writeFileSync(destPath, templateContent);
  chmodSync(destPath, 0o755);

  console.log(`✅ pre-commit hook 已安装到 ${destPath}`);
  console.log('   每次 git commit 前会自动运行 sofagent-audit 检查。');
  process.exit(0);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  // --install-hook 在开头处理，完成后退出
  if (args.installHook) {
    installHook();
    return;
  }

  // 1. 解析 git diff
  const diffFiles = parseDiff(args.diffRange);

  if (diffFiles.length === 0) {
    if (args.json) {
      console.log(JSON.stringify({ exitCode: 0, rules: [] }, null, 2));
    } else {
      console.log('✅ 没有文件变更，无需审计。');
    }
    process.exit(0);
  }

  // 2. 读取任务日志
  const logEntries = checkLogs();

  // 3. 读取 commit message（用于 E2/A5 规则回退）
  let commitMsg = '';
  try {
    commitMsg = execFileSync('git', ['log', '-1', '--pretty=%B'], { encoding: 'utf-8' }).trim();
  } catch {
    // 非 git 仓库或无 commit，留空
  }

  // 4. 加载审计配置（三级 fallback）
  const config = loadConfig();

  // 5. 运行规则
  const results = runRules(diffFiles, logEntries, args.task, args.strict, args.silent, commitMsg, config);

  // 6. 输出结果
  printResults(results, diffFiles, args.json, args.ci);
  process.exit(results.exitCode);
}

function printResults(results: AuditResult, diffFiles: DiffFile[], json: boolean, ci: boolean): void {
  // JSON 输出模式——输出结构化 JSON，适合 CI 系统解析
  if (json) {
    console.log(JSON.stringify({ exitCode: results.exitCode, rules: results.rules }, null, 2));
    return;
  }

  console.log(`\n[sofagent-audit] 扫描 ${diffFiles.length} 个变更文件\n`);
  let hasAnyOutput = false;

  for (const rule of results.rules) {
    const status = rule.status;
    const icon = status === 'PASS' ? '✅' : status === 'WARN' ? '⚠️ ' : '❌';
    if (status === 'PASS') continue; // 跳过的规则不显示
    hasAnyOutput = true;

    const evidenceTag = rule.evidenceMode ? `[evidenceMode: ${rule.evidenceMode}]` : '';
    const classTag = rule.ruleClass === '业务底线' ? '[底线]' : rule.ruleClass === '能力拐杖' ? '[拐杖]' : '';
    for (const detail of rule.details) {
      console.log(`${icon} ${rule.name} ${classTag} ${evidenceTag}: ${detail}`);
    }
  }

  if (!hasAnyOutput) {
    console.log('✅ 全部审计规则通过。');
  }

  console.log('');
  console.log(`判定: ${results.exitCode === 0 ? '✅ PASS' : results.exitCode === 1 ? '⚠️  WARN (有警告)' : '❌ FAIL (有违规)'}`);

  // CI 模式提醒——CI 仅检查 git diff 硬证据，完整审计需配合 Agent 日志
  if (ci) {
    console.log('💡 提示：CI 模式仅检查 git diff（硬证据）。完整审计需配合 Agent 日志（A7/A8）。');
  }
}

main().catch((err) => {
  console.error('sofagent-audit 内部错误:', err.message);
  process.exit(2);
});
