#!/usr/bin/env node
// ============================================================
// sofagent-audit · 提交时审计 CLI 入口
// v0.99.5 · 审计闭环六步（检测+分类+根因+改进+回归+上线）
// ============================================================
// 扫描 git diff，检查 Agent 是否遵守审计规则。
// 最小运行时依赖：仅 js-yaml（YAML 配置解析），其余用 Node.js 内置模块。
//
// 用法：
//   node sofagent/audit/dist/index.js --diff HEAD~1..HEAD --task "修复登录页 bug"
//   node sofagent/audit/dist/index.js --diff HEAD~1..HEAD --silent --task "test"
//   node sofagent/audit/dist/index.js --diff HEAD~1..HEAD --ci --task "test"
//   node sofagent/audit/dist/index.js --root-cause
//   node sofagent/audit/dist/index.js --regression ./test-fixtures
//
// 退出码：
//   0 = 全通过
//   1 = 有警告
//   2 = 有违规（A1 不碰敏感 / A2 不泄密钥）
// ============================================================

import { execFileSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { parseDiff, isInGitRepo, type DiffFile } from './diff-parser';
import { checkLogs } from './log-checker';
import { runRules, type AuditResult } from './reporter';
import { loadConfig } from './config-loader';
import { loadHistory, appendHistory, type AuditHistoryEntry } from './audit-history';
import { analyzeRootCause } from './audit-root-cause';
import { formatSuggestions } from './config-suggestion';
import { runRegression, type DiffSnapshot } from './audit-regression';
import { defaultRules } from './rules';
import type { RuleCheck } from './rules/types';
import { pushAuditResult, type WebhookPlatform } from './webhook';
import { generateThinkEntry } from './think-generator';
import { VERSION } from './shared/constants.js';

interface Args {
  diffRange: string;
  task?: string;
  strict: boolean;
  silent: boolean;
  ci: boolean;
  installHook: boolean;
  json: boolean;
  rootCause: boolean;
  regressionDir?: string;
  webhook?: WebhookPlatform;
  webhookUrl?: string;
  mcp: boolean;
}


function parseArgs(argv: string[]): Args {
  const args: Args = { diffRange: 'HEAD~1..HEAD', strict: false, silent: false, ci: false, installHook: false, json: false, rootCause: false, webhookUrl: process.env.SOFAGENT_WEBHOOK_URL, mcp: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--diff' && argv[i + 1]) {
      i++;
      args.diffRange = argv[i] as string;
    } else if (argv[i] === '--task' && argv[i + 1]) {
      i++;
      args.task = argv[i] as string;
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
    } else if (argv[i] === '--root-cause') {
      args.rootCause = true;
    } else if (argv[i] === '--regression' && argv[i + 1]) {
      i++;
      args.regressionDir = argv[i] as string;
    } else if (argv[i] === '--webhook' && argv[i + 1]) {
      i++;
      const platform = argv[i] as string;
      if (platform === 'dingtalk' || platform === 'feishu' || platform === 'wecom') {
        args.webhook = platform;
      } else {
        console.error(`❌ 无效的 webhook 平台: ${platform}（支持: dingtalk / feishu / wecom）`);
        process.exit(1);
      }
    } else if (argv[i] === '--webhook-url' && argv[i + 1]) {
      i++;
      args.webhookUrl = argv[i] as string;
    } else if (argv[i] === '--mcp') {
      // MCP Server 模式：启动 JSON-RPC 2.0 over stdio
      args.mcp = true;
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(`sofagent-audit v${VERSION} · 审计闭环六步\n`);
      console.log('用法: sofagent-audit --diff <range> [--task <description>] [--strict] [--silent] [--ci] [--json] [--install-hook]');
      console.log('      sofagent-audit --root-cause');
      console.log('      sofagent-audit --regression <dir>');
      console.log('      sofagent-audit --mcp');
      console.log('  --diff          git diff 范围（默认 HEAD~1..HEAD）');
      console.log('  --task          任务描述（用于 A3 不改越界检查）');
      console.log('  --strict        严格模式：无日志时 A7 返回 FAIL 而非 WARN');
      console.log('  --silent        沉默模式：跳过日志依赖规则，走 diff 启发式回退');
      console.log('  --ci            CI 模式 = strict + silent（适合无 Agent 日志的 CI 环境）');
      console.log('  --json          JSON 输出模式：输出 { exitCode, rules } JSON，适合 CI 解析');
      console.log('  --install-hook  安装 git pre-commit hook 到当前仓库的 .git/hooks/');
      console.log('  --root-cause    分析审计历史，输出根因报告 + 配置建议');
      console.log('  --regression <dir>  对指定目录下的历史快照跑回归验证');
      console.log('  --webhook <platform>  webhook 推送平台（dingtalk / feishu / wecom），有 WARN/FAIL 时推送');
      console.log('  --webhook-url <url>   webhook URL（也可通过 SOFAGENT_WEBHOOK_URL 环境变量设置）');
      console.log('  --mcp           启动 MCP Server（JSON-RPC 2.0 over stdio），暴露审计能力给 MCP Client');
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

/**
 * --root-cause 模式：分析审计历史，输出根因报告 + 配置建议
 */
function runRootCauseAnalysis(): void {
  const history = loadHistory();

  if (history.length === 0) {
    console.log('无历史数据。运行 sofagent-audit --diff <range> 后会自动记录审计历史。');
    process.exit(0);
  }

  const report = analyzeRootCause(history);
  const output = formatSuggestions(report);
  console.log(output);

  process.exit(0);
}

/**
 * --regression 模式：对指定目录下的历史快照跑回归验证
 * 第一版只接受 fixture 目录路径，加载里面的预构筑 snapshots
 * @param dir fixture 目录路径
 */
function runRegressionMode(dir: string): void {
  if (!existsSync(dir)) {
    console.error(`❌ 目录不存在: ${dir}`);
    process.exit(1);
  }

  // 从 fixture 目录加载 snapshots
  // fixture 目录结构：每个 .json 文件是一个 snapshot
  const snapshots = loadSnapshotsFromDir(dir);

  if (snapshots.length === 0) {
    console.log(`目录 ${dir} 中没有找到快照文件。`);
    console.log('快照文件格式：JSON，包含 timestamp / diffFiles / logEntries / previousResults 字段。');
    process.exit(0);
  }

  const report = runRegression(snapshots, defaultRules);

  console.log('\n=== 回归验证报告 ===\n');
  console.log(`快照数: ${report.totalSnapshots}`);
  console.log(`新增问题: ${report.newIssues}`);
  console.log(`解决问题: ${report.resolvedIssues}`);
  console.log(`无变化: ${report.unchanged}`);

  if (report.details.length > 0) {
    console.log('\n--- 详细变化 ---');
    for (const detail of report.details) {
      const icon = detail.newStatus === 'PASS' ? '✅' : detail.newStatus === 'WARN' ? '⚠️ ' : '❌';
      console.log(`  ${icon} [${detail.timestamp}] ${detail.ruleName}: ${detail.oldStatus} → ${detail.newStatus}`);
    }
  }

  console.log('\n=== 报告结束 ===\n');
  process.exit(0);
}

/**
 * 从 fixture 目录加载快照文件
 * @param dir 目录路径
 * @returns DiffSnapshot 数组
 */
function loadSnapshotsFromDir(dir: string): DiffSnapshot[] {
  const snapshots: DiffSnapshot[] = [];

  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return snapshots;
  }

  for (const file of files) {
    try {
      const content = readFileSync(join(dir, file), 'utf-8');
      const data = JSON.parse(content);
      // 宽松解析——只提取必要字段
      snapshots.push({
        timestamp: data.timestamp || file,
        diffFiles: data.diffFiles || [],
        logEntries: data.logEntries || [],
        task: data.task,
        previousResults: (data.previousResults || []) as RuleCheck[],
      });
    } catch {
      // 跳过解析失败的文件
    }
  }

  return snapshots;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  // --mcp 模式：MCP Server 已拆分为独立包 @sofagent/mcp
  if (args.mcp) {
    console.log('MCP Server 已拆分为独立包 @sofagent/mcp。');
    console.log('请使用 sofagent-mcp 命令启动，或在 package.json 中安装 @sofagent/mcp。');
    console.log('');
    console.log('安装: npm install @sofagent/mcp');
    console.log('启动: npx sofagent-mcp');
    console.log('');
    console.log('MCP Client 配置示例:');
    console.log('  {');
    console.log('    "mcpServers": {');
    console.log('      "sofagent": {');
    console.log('        "command": "npx",');
    console.log('        "args": ["sofagent-mcp"]');
    console.log('      }');
    console.log('    }');
    console.log('  }');
    process.exit(0);
  }

  // --install-hook 在开头处理，完成后退出
  if (args.installHook) {
    installHook();
    return;
  }

  // --root-cause 模式：分析审计历史，输出根因报告 + 配置建议
  if (args.rootCause) {
    runRootCauseAnalysis();
    return;
  }

  // --regression 模式：对指定目录下的历史快照跑回归验证
  if (args.regressionDir) {
    runRegressionMode(args.regressionDir);
    return;
  }

  // 1. 检查 git 仓库
  if (!isInGitRepo()) {
    if (args.json) {
      console.log(JSON.stringify({ exitCode: 2, rules: [], error: 'NOT_A_GIT_REPO' }, null, 2));
    } else {
      console.error('错误：当前目录不在 git 仓库内。sofagent-audit 需要 git 仓库才能运行。');
    }
    process.exit(2);
  }

  // 2. 解析 git diff
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

  // 7. webhook 推送（fire-and-forget，有 WARN/FAIL 且配置了 webhook 时推送）
  if (results.exitCode > 0 && args.webhook && args.webhookUrl) {
    try {
      const pushed = await pushAuditResult({
        platform: args.webhook,
        url: args.webhookUrl,
        task: args.task,
        rules: results.rules,
        exitCode: results.exitCode,
      });
      if (!pushed) {
        console.warn('⚠️  webhook 推送失败或无需推送（不影响审计结果）。');
      }
    } catch {
      console.warn('⚠️  webhook 推送异常（不影响审计结果）。');
    }
  }

  // 8. 写入审计历史（JSONL 持久化，用于根因分析和回归验证）
  try {
    const historyEntry: AuditHistoryEntry = {
      timestamp: new Date().toISOString(),
      diffRange: args.diffRange,
      task: args.task,
      exitCode: results.exitCode,
      ruleResults: results.rules,
      diffFileCount: diffFiles.length,
      commitMsg: commitMsg || undefined,
    };
    appendHistory(historyEntry);
  } catch {
    // 历史写入失败不影响审计结果
  }

  // 9. 自动生成 think.md（方案 A：基于 git diff 硬证据）
  if (diffFiles.length > 0) {
    try {
      generateThinkEntry(diffFiles, results, args.task);
    } catch {
      // think 生成失败不影响审计结果
    }
  }

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
