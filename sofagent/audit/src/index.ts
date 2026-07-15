#!/usr/bin/env node
// ============================================================
// sofagent-audit · 提交时审计 CLI 入口
// v1.1.1 · 审计闭环六步（检测+分类+根因+改进+回归+上线）
// v1.1.1 精简：compose→orchestrator, subagent→orchestrator,
//          hub→work模板市场, skillopt-run→skillopt, ab-test→ab-test,
//          daemon→daemon, doctor/verify→core (deprecation shim)
// ============================================================
// 扫描 git diff，检查 Agent 是否遵守审计规则。
// 最小运行时依赖：仅 js-yaml（YAML 配置解析），其余用 Node.js 内置模块。
//
// 用法：
//   node sofagent/audit/dist/index.js --diff HEAD~1..HEAD --task "修复登录页 bug"
//   node sofagent/audit/dist/index.js --diff HEAD~1..HEAD --silent --task "test"
//   node sofagent/audit/dist/index.js --diff HEAD~1..HEAD --ci --task "test"
//   node sofagent/audit/dist/index.js --root-cause
//   node sofagent/audit/dist/index.js --regression ./src
//   node sofagent/audit/dist/index.js ontology view
//
// 退出码：
//   0 = 全通过
//   1 = 有警告
//   2 = 有违规（A1 不碰敏感 / A2 不泄密钥）
// ============================================================

import { execFileSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { createInterface } from 'readline';
import { parseDiff, parseStagedDiff, isInGitRepo, type DiffFile } from '@sofagent/core';
import { loadConfig, ConfigLoadError } from '@sofagent/core';
import { VERSION } from '@sofagent/core';
import { resolveDiffEndpoint } from './diff-ref';
import { checkLogs } from '@sofagent/core';
import { runRules, type AuditResult } from './reporter';
import { loadHistory, appendHistory, type AuditHistoryEntry } from './audit-history';
import { analyzeRootCause } from './audit-root-cause';
import { formatSuggestions } from './config-suggestion';
import { runRegression, type DiffSnapshot } from './audit-regression';
import { defaultRules } from './rules';
import type { RuleCheck } from './rules/types';
import { pushAuditResult, type WebhookPlatform } from './webhook';
import { getFixSuggestion } from './fix-suggestions';
import { loadPermission, checkPermission } from './permission';

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
  init: boolean;
  /** staged 模式（首次提交场景）——diffRange 值为 --cached */
  cached: boolean;
  /** v1.0.9: 恢复到指定快照 SHA */
  revertSha?: string;
  /** v1.0.9: --timeline 查看快照时间线 */
  timeline?: boolean;
  timelineLimit?: number;
  timelineJson?: boolean;
  /** v1.0.9: ontology 子命令 */
  ontologyCommand?: string;
}


function parseArgs(argv: string[]): Args {
  const args: Args = { diffRange: 'HEAD~1..HEAD', strict: false, silent: false, ci: false, installHook: false, json: false, rootCause: false, webhookUrl: process.env.SOFAGENT_WEBHOOK_URL, mcp: false, init: false, cached: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--diff' && argv[i + 1]) {
      i++;
      args.diffRange = argv[i] as string;
      if (args.diffRange === '--cached') {
        args.cached = true;
      }
    } else if (argv[i] === '--task' && argv[i + 1]) {
      i++;
      args.task = argv[i] as string;
    } else if (argv[i] === '--strict') {
      args.strict = true;
    } else if (argv[i] === '--silent') {
      args.silent = true;
    } else if (argv[i] === '--ci') {
      args.ci = true;
      args.silent = true;   // --ci 隐含 --silent（CI 友好输出），不隐含 --strict
    } else if (argv[i] === '--install-hook') {
      args.installHook = true;
    } else if (argv[i] === '--json') {
      args.json = true;
    } else if (argv[i] === '--root-cause') {
      args.rootCause = true;
    } else if (argv[i] === '--regression' && argv[i + 1]) {
      i++;
      args.regressionDir = argv[i] as string;
    } else if (argv[i] === '--revert') {
      // v1.1.1: 无参报错修复
      if (!argv[i + 1] || argv[i + 1]!.startsWith('--')) {
        console.error('❌ sofagent 提示：缺少快照 SHA 参数，用法: sofagent-audit --revert <snapshot-sha>');
        console.error('   查看可用快照：sofagent-audit --timeline');
        process.exit(2);
      }
      i++;
      args.revertSha = argv[i] as string;
    } else if (argv[i] === '--timeline') {
      // v1.1.1: 快照时间线
      args.timeline = true;
      args.timelineJson = argv.includes('--json');
      // 下一个参数如果是数字则为 limit
      if (argv[i + 1] && /^\d+$/.test(argv[i + 1]!)) {
        i++;
        args.timelineLimit = parseInt(argv[i] as string, 10);
      }
    } else if (argv[i] === '--webhook' && argv[i + 1]) {
      i++;
      const platform = argv[i] as string;
      if (platform === 'dingtalk' || platform === 'feishu' || platform === 'wecom') {
        args.webhook = platform;
      } else {
        console.error(`❌ sofagent 提示：不支持的 webhook 平台 "${platform}"（可用: dingtalk / feishu / wecom）`);
        process.exit(1);
      }
    } else if (argv[i] === '--webhook-url' && argv[i + 1]) {
      i++;
      args.webhookUrl = argv[i] as string;
    } else if (argv[i] === '--mcp') {
      // MCP Server 模式：启动 JSON-RPC 2.0 over stdio
      args.mcp = true;
    } else if (argv[i] === '--init') {
      args.init = true;
    } else if (argv[i] === 'ontology' && argv[i + 1]) {
      i++;
      args.ontologyCommand = argv[i] as string;
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      const verbose = argv.includes('--verbose');
      console.log(`sofagent-audit v${VERSION} · Agent 提交时审计\n`);
      console.log('快速开始:');
      console.log('  安装    npm install -g @sofagent/audit && sofagent-audit --init');
      console.log('  试用    sofagent-audit --diff HEAD~1..HEAD');
      console.log('  npx     npx -p @sofagent/audit sofagent-audit --init');
      console.log('命令:');
      console.log('  sofagent-audit --diff <range> [--task <desc>]   审计 git diff');
      console.log('  sofagent-audit --init                           一键初始化（配置+hook+冒烟）');
      console.log('  sofagent-audit --root-cause                     根因分析');
      console.log('  sofagent-audit --regression <dir>               回归验证');
      console.log('  sofagent-audit --install-hook                   安装 commit-msg hook');
      console.log('  sofagent-audit --revert <snapshot-sha>              恢复到指定快照');
      console.log('  sofagent-audit --timeline [N]                      查看快照时间线');
      console.log('  sofagent-audit ontology view                        本体人类可读视图');
      console.log('');
      console.log('v1.1.1 已迁移的子命令:');
      console.log('  compose      → sofagent-orchestrator compose');
      console.log('  subagent run → sofagent-orchestrator subagent run');
      console.log('  hub          → sofagent-work模板市场');
      console.log('  skillopt-run → sofagent-skillopt');
      console.log('  ab-test      → sofagent-ab-test');
      console.log('  daemon       → sofagent-daemon');
      console.log('  doctor/verify → sofagent-core');
      console.log('模式对照表:');
      console.log('  默认模式    全部规则（含 Agent 日志）   exit 0/1/2');
      console.log('  --silent    只跑 git-diff 规则          exit 0/1/2');
      console.log('  --strict    任何警告都 exit 2            exit 0/2');
      console.log('  --ci        = --silent（CI 友好输出，无交互提示）     exit 0/1/2');
      if (verbose) {
        console.log('\n完整参数列表:');
        console.log('  --diff <range>     git diff 范围（默认 HEAD~1..HEAD）');
        console.log('  --task <desc>      任务描述');
        console.log('  --strict           严格模式');
        console.log('  --silent           静默模式');
        console.log('  --ci               CI 模式（= --silent，CI 友好输出，无交互提示）');
        console.log('  --json             JSON 输出');
        console.log('  --install-hook     安装 commit-msg hook');
        console.log('  --root-cause       根因分析');
        console.log('  --regression <dir> 回归验证');
        console.log('  --init             一键初始化');
        console.log('  --webhook <p>      webhook 推送（dingtalk/feishu/wecom）');
        console.log('  --webhook-url <u>  webhook URL');
        console.log('  --mcp              MCP Server（已拆分为 @sofagent/mcp）');
        console.log('\n退出码: 0=全通过 / 1=有警告 / 2=有违规');
      } else {
        console.log('\n完整参数列表: sofagent-audit --help --verbose');
      }
      process.exit(0);
    } else if (argv[i] === '--version') {
      console.log(`sofagent-audit v${VERSION}`);
      process.exit(0);
    } else {
      const arg = argv[i];
      if (arg && arg.startsWith('--')) {
        console.error(`❌ sofagent 提示：不支持的参数 "${arg}"`);
        console.error('   使用 --help 查看可用参数');
        process.exit(1);
      } else if (arg && !arg.startsWith('-')) {
        // v1.1.1: 未知子命令报错
        const SUBCOMMANDS = ['ontology'];
        if (!SUBCOMMANDS.includes(arg)) {
          console.error(`未知子命令: ${arg}`);
          console.error(`可用子命令: ${SUBCOMMANDS.join(', ')}`);
          process.exit(1);
        }
      }
    }
  }
  return args;
}

/**
 * 安装 git commit-msg hook
 * 从 cwd 往上查找 .git 目录，将 hooks/commit-msg 模板复制到 .git/hooks/
 * 迁移：如果 .git/hooks/pre-commit 含 sofagent 标识，自动移除旧 hook
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
    console.error('❌ sofagent 提示：当前目录不是 git 仓库。请在 git 仓库内运行此命令，或先 git init。');
    process.exit(1);
  }

  // 定位 commit-msg 模板
  // dist/index.js 编译后，模板在 ../../hooks/commit-msg（相对于 dist/）
  const hookTemplate = join(__dirname, '..', 'hooks', 'commit-msg');

  if (!existsSync(hookTemplate)) {
    console.error(`❌ sofagent 内部错误：commit-msg 模板文件缺失——${hookTemplate}`);
    process.exit(1);
  }

  // 确保目标目录存在
  const hooksDir = join(gitDir, 'hooks');
  if (!existsSync(hooksDir)) {
    mkdirSync(hooksDir, { recursive: true });
  }

  // 迁移：移除旧版 pre-commit hook（含 sofagent 标识的）
  const legacyPath = join(hooksDir, 'pre-commit');
  if (existsSync(legacyPath)) {
    try {
      const legacyContent = readFileSync(legacyPath, 'utf-8');
      if (legacyContent.includes('sofagent')) {
        require('fs').unlinkSync(legacyPath);
        console.log('  → 已移除旧版 pre-commit hook（迁移到 commit-msg）');
      }
    } catch { /* 读不了就跳过 */ }
  }

  const destPath = join(hooksDir, 'commit-msg');

  // 读取模板并写入
  const templateContent = readFileSync(hookTemplate, 'utf-8');
  writeFileSync(destPath, templateContent);
  chmodSync(destPath, 0o755);

  console.log(`✅ commit-msg hook 已安装到 ${destPath}`);
  console.log('   每次 git commit 时会自动运行 sofagent-audit 检查。');
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
    console.error(`❌ sofagent 提示：目录不存在——${dir}`);
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

// ============================================================
// v1.0.9: --timeline 快照时间线
// ============================================================

function printTimeline(limit: number, json: boolean): void {
  try {
    const { listAllSnapshots } = awaitLoadSnapshot();
    const projectDir = process.cwd();
    const snapshots = listAllSnapshots(projectDir).slice(0, limit);

    if (json) {
      console.log(JSON.stringify(snapshots, null, 2));
      return;
    }

    if (snapshots.length === 0) {
      console.log('暂无快照。运行审计后会自动创建快照。');
      return;
    }

    for (const snap of snapshots) {
      const time = new Date(snap.timestamp).toLocaleString('zh-CN');
      console.log(`${time}  ${snap.shortSha}  ${snap.fileCount} 文件`);
    }
    console.log(`\n  共 ${snapshots.length} 条快照（最近 ${limit} 条）`);
    console.log('  回滚：sofagent-audit --revert <SHA>');
  } catch (err) {
    console.error('❌ sofagent 获取快照时间线时遇到问题:', (err as Error).message);
    process.exit(1);
  }
}

// 同步加载 snapshot 模块（v1.1.1 迁移到 @sofagent/daemon）
function awaitLoadSnapshot(): any {
  try {
    return require('@sofagent/daemon');
  } catch {
    throw new Error('sofagent daemon 模块未安装。请安装 @sofagent/daemon 包。');
  }
}

// v1.0.9: confirm 辅助函数（非 TTY 自动确认，不挂起）
function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return Promise.resolve(true);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (ans) => {
      rl.close();
      resolve(/^(y|yes|是)$/i.test(ans.trim()));
    });
  });
}

async function main(): Promise<void> {
  // === v1.1.1 deprecation shim ===
  // 在 args 解析之后、主 switch 分支之前，拦截已迁移的子命令
  const rawArgs = process.argv.slice(2);

  // compose → sofagent-orchestrator (v1.1.1 P0-2: 友好报错降级，不再 execFileSync)
  if (rawArgs.includes('compose')) {
    console.error('⚠️  "sofagent-audit compose" 已迁移到 "sofagent-orchestrator compose"（v1.1.1）。');
    console.error('   请直接运行：sofagent-orchestrator compose');
    console.error('   安装：npm install -g @sofagent/orchestrator');
    process.exit(1);
  }

  // doctor → sofagent-core (v1.1.1 已改 doctor direct import；compose/verify 见 P0-2)
  if (rawArgs.includes('--doctor')) {
    console.error('⚠️  "sofagent-audit --doctor" 已迁移到 "sofagent-core --doctor"（v1.1.1）。将在 v1.2.0 移除此兼容入口。');
    const { runDoctor } = await import('@sofagent/core');
    const report = runDoctor(process.cwd());
    process.exit(report.allOk ? 0 : 1);
  }

  // verify → sofagent-core (v1.1.1 P0-2: 友好报错降级，不再 execFileSync)
  if (rawArgs.includes('verify')) {
    console.error('⚠️  "sofagent-audit verify" 已迁移到 "sofagent-core verify"（v1.1.1）。');
    console.error('   请直接运行：sofagent-core verify');
    console.error('   安装：npm install -g @sofagent/core');
    process.exit(1);
  }

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

  // --init 模式：一键初始化 config + hook + 冒烟测试
  if (args.init) {
    const { runInit } = await import('./commands/init');
    runInit();
    return;
  }

  // ontology 子命令（v1.0.9 新增，v1.1.1 改用 @sofagent/ontology）
  if (args.ontologyCommand === 'view') {
    const { generateOntologyView } = await import('@sofagent/ontology');
    try {
      const output = generateOntologyView(process.cwd());
      process.stdout.write(output);
      process.stdout.write('\n');
      process.exit(0);
    } catch (err) {
      process.stderr.write(`❌ ontology view 失败: ${(err as Error).message}\n`);
      process.exit(1);
    }
  }

  // --timeline 模式：快照时间线（v1.0.9 新增）
  if (args.timeline) {
    printTimeline(args.timelineLimit || 20, args.timelineJson || false);
    return;
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

  // --revert 模式：恢复到指定快照（v1.0.9 新增，v1.0.9 确认交互改进）
  if (args.revertSha) {
    try {
      const { restoreSnapshot, listAllSnapshots } = await import('@sofagent/daemon');
      const projectDir = process.cwd();

      // 列出可用快照供用户参考
      const snapshots = listAllSnapshots(projectDir);
      if (snapshots.length === 0) {
        console.error('❌ 没有可用的快照。请先运行审计以创建快照。');
        process.exit(1);
      }

      console.log('可用快照:');
      for (const s of snapshots) {
        console.log(`  ${s.shortSha}  ${s.timestamp}  (${s.fileCount} 个文件)`);
      }
      console.log('');

      // v1.0.9: 使用 confirm() 辅助函数（非 TTY 自动确认）
      const confirmed = await confirm(`⚠️  即将恢复到快照 ${args.revertSha}。此操作将覆盖当前文件。确认？`);
      if (!confirmed) {
        console.log('已取消恢复操作。');
        process.exit(0);
      }

      const restored = restoreSnapshot(projectDir, args.revertSha);
      console.log(`✅ 已恢复 ${restored.length} 个文件:`);
      for (const f of restored) {
        console.log(`  → ${f}`);
      }
      console.log('');
      console.log('💡 建议运行 npm run build && npm test 验证恢复结果。');
    } catch (err) {
      console.error(`❌ 恢复失败: ${(err as Error).message}`);
      process.exit(1);
    }
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

  // 2. 解析 git diff（--cached 模式用于首次提交场景）
  const diffFiles = args.cached ? parseStagedDiff() : parseDiff(args.diffRange);

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

  // 3. 读取 commit message（优先级：--task 参数 > COMMIT_EDITMSG > git log > 空）
  let commitMsg = args.task || '';

  if (!commitMsg) {
    try {
      const gitDirResult = execFileSync('git', ['rev-parse', '--git-dir'], { encoding: 'utf-8' }).trim();
      const gitDir = gitDirResult.startsWith('/') ? gitDirResult : join(process.cwd(), gitDirResult);
      const editMsgPath = join(gitDir, 'COMMIT_EDITMSG');
      if (existsSync(editMsgPath)) {
        commitMsg = readFileSync(editMsgPath, 'utf-8').trim();
      }
    } catch {
      // git rev-parse 失败（非 git 仓库），留空
    }
  }

  // 最终 fallback：git log
  // v1.0.9: 从 --diff range 提取终点 commit，而非始终取 HEAD
  if (!commitMsg) {
    try {
      // v1.0.9 T02：从 --diff range 提取**终点** commit，而非始终取 HEAD
      const refArg = resolveDiffEndpoint(args.diffRange);
      commitMsg = execFileSync('git', ['log', '-1', '--pretty=%B', refArg], { encoding: 'utf-8' }).trim();
    } catch {
      // 完全无法获取，保持空
    }
  }

  // 4. 加载审计配置（三级 fallback）——YAML 语法错误时按模式处理
  let config;
  try {
    config = loadConfig(undefined, args.strict);
  } catch (err) {
    if (err instanceof ConfigLoadError) {
      const msg = `config.yml 解析错误: ${err.message}`;
      if (args.json) {
        console.log(JSON.stringify({ exitCode: args.strict ? 2 : 1, rules: [], error: 'CONFIG_PARSE_ERROR', detail: msg }, null, 2));
        process.exit(args.strict ? 2 : 1);
      }
      console.error(`❌ ${msg}`);
      // --strict / --ci 模式下阻断（exit 2），默认模式 WARN（exit 1）
      process.exit(args.strict ? 2 : 1);
    }
    throw err;
  }

  // 4.5 权限检查（v1.1.1：权限作用域化）
  const permission = loadPermission(process.cwd());
  const permissionDenials: string[] = [];
  for (const file of diffFiles) {
    const check = checkPermission(permission, file.path, 'write');
    if (!check.allowed) {
      permissionDenials.push(`${file.path}: ${check.matchedRule || 'denied'}`);
    }
  }

  // 5. 运行规则
  const results = runRules(diffFiles, logEntries, args.task, args.strict, args.silent, commitMsg || undefined, config);

  // 6. 输出结果
  if (permissionDenials.length > 0) {
    results.permissionDenials = permissionDenials;
  }
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
    // P1-15: 获取当前 HEAD SHA
    let commitSha: string | undefined;
    try {
      commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch { /* 非 git 环境 */ }

    const historyEntry: AuditHistoryEntry = {
      timestamp: new Date().toISOString(),
      diffRange: args.diffRange,
      task: args.task,
      exitCode: results.exitCode,
      ruleResults: results.rules,
      diffFileCount: diffFiles.length,
      commitMsg: commitMsg || undefined,
      commitSha,
      engine: `sofagent-audit v${VERSION}`,
    };
    appendHistory(historyEntry);
  } catch {
    // 历史写入失败不影响审计结果
    process.stderr.write('[sofagent-audit] 警告: 审计历史写入失败，跳过（不影响审计结果）\n');
  }

  // think.md 生成由 @sofagent/think 的 generateThinkEntry 负责（审计后反思生成器），
  // 其内部经 @sofagent/core 的 appendThinkEntry 契约写入，保证 append-only 不变量。
  // audit 包不直接写 think.md（避免反向依赖 think 生成器）。

  process.exit(results.exitCode);
}

// ============================================================
// CJK 宽度计算——终端中文字符占 2 列，ASCII 占 1 列
// padEnd 按字符数 pad，会导致 banner 右边框错位
// ============================================================

function isCJK(code: number): boolean {
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||  // CJK Unified Ideographs
    (code >= 0x3000 && code <= 0x303f) ||  // CJK Symbols and Punctuation
    (code >= 0xff00 && code <= 0xffef)     // Fullwidth Forms
  );
}

function visualWidth(str: string): number {
  let w = 0;
  for (const ch of str) {
    w += isCJK(ch.codePointAt(0) ?? 0) ? 2 : 1;
  }
  return w;
}

function padVisual(str: string, width: number): string {
  const pad = width - visualWidth(str);
  return pad > 0 ? str + ' '.repeat(pad) : str;
}

// ============================================================
// banner 辅助——生成带左右边框的行
// ============================================================

const BANNER_WIDTH = 44; // ╔══ ... ══╗ 内部宽度

function bannerTop(): string {
  return '╔' + '═'.repeat(BANNER_WIDTH) + '╗';
}

function bannerBottom(): string {
  return '╚' + '═'.repeat(BANNER_WIDTH) + '╝';
}

function bannerLine(text: string): string {
  return '║ ' + padVisual(text, BANNER_WIDTH - 2) + ' ║';
}

// ============================================================
// 历史拦截统计
// ============================================================

function getHistoryStats(): { total: number; thisMonth: number } | null {
  try {
    const history = loadHistory(500);
    if (history.length === 0) return null;

    const now = new Date();
    const yearMonth = now.toISOString().slice(0, 7); // YYYY-MM
    const thisMonth = history.filter((e) => e.timestamp.startsWith(yearMonth)).length;

    return { total: history.length, thisMonth };
  } catch {
    return null;
  }
}

function printResults(results: AuditResult, diffFiles: DiffFile[], json: boolean, ci: boolean): void {
  // JSON 输出模式——输出结构化 JSON，适合 CI 系统解析
  if (json) {
    console.log(JSON.stringify({ exitCode: results.exitCode, rules: results.rules }, null, 2));
    return;
  }

  // CI 静默模式——只在有 WARN/FAIL 时输出简短结果
  if (ci) {
    const problems = results.rules.filter((r) => r.status !== 'PASS' && r.status !== 'SKIPPED');
    if (problems.length === 0) return;

    for (const rule of problems) {
      const icon = rule.status === 'FAIL' ? '❌' : '⚠️';
      const classTag = rule.ruleClass === '业务底线' ? '[底线]' : rule.ruleClass === '能力拐杖' ? '[拐杖]' : '';
      for (const detail of rule.details) {
        console.log(`${icon} ${rule.name} ${classTag}: ${detail}`);
      }
      // 修复建议
      const suggestion = getFixSuggestion(rule.name);
      if (suggestion) {
        console.log(`   怎么修: ${suggestion}`);
      }
    }
    console.log(`\n判定: ${results.exitCode === 1 ? '⚠️  WARN' : '❌ FAIL'} (exit ${results.exitCode})`);
    return;
  }

  // ===== v1.0.9 可视化输出 =====

  const exitCode = results.exitCode;
  const totalRules = results.rules.length;
  const failCount = results.rules.filter((r) => r.status === 'FAIL').length;
  const warnCount = results.rules.filter((r) => r.status === 'WARN').length;
  const skipCount = results.rules.filter((r) => r.status === 'SKIPPED').length;
  const passCount = totalRules - failCount - warnCount - skipCount;

  // banner 状态
  const statusLabel = exitCode === 0 ? '✅ 审计通过' : exitCode === 1 ? '⚠️  有警告' : '❌ 审计拦截';
  const actionLabel = exitCode === 0 ? '可以放心提交' : exitCode === 1 ? '建议修复后再提交' : '提交已被阻止';
  const issueWord = failCount > 0 ? `${failCount} 违规` : warnCount > 0 ? `${warnCount} 警告` : '0 违规';

  console.log('');
  console.log(bannerTop());
  console.log(bannerLine(`sofagent-audit · v${VERSION}`));
  console.log(bannerLine(`扫描 ${diffFiles.length} 文件 · ${totalRules} 项检查 · ${issueWord}`));
  console.log(bannerLine(`${statusLabel}  ·  ${actionLabel}`));
  console.log(bannerBottom());

  // 违规/警告详情
  const problems = results.rules.filter((r) => r.status !== 'PASS');
  if (problems.length > 0) {
    console.log('');
    for (const rule of problems) {
      const icon = rule.status === 'FAIL' ? '❌' : '⚠️';
      const classTag = rule.ruleClass === '业务底线' ? '[底线]' : rule.ruleClass === '能力拐杖' ? '[拐杖]' : '';
      for (const detail of rule.details) {
        console.log(`  ${icon} ${rule.name} ${classTag}: ${detail}`);
        // 修复建议（v1.0.9 新增）
        const suggestion = getFixSuggestion(rule.name);
        if (suggestion) {
          console.log(`     怎么修: ${suggestion}`);
        }
      }
    }
  }

  // 规则网格——一行展示全部规则状态
  console.log('');
  const gridParts = results.rules.map((r) => {
    const num = r.number >= 200 ? `E${r.number - 200}` : `A${r.number}`;
    const icon = r.status === 'PASS' ? '✅' : r.status === 'WARN' ? '⚠️' : r.status === 'SKIPPED' ? '⏭️' : '❌';
    return `${num} ${icon}`;
  });
  // 分两行避免太长
  const half = Math.ceil(gridParts.length / 2);
  console.log(`  审计规则   ${gridParts.slice(0, half).join('  ')}`);
  if (gridParts.length > half) {
    console.log(`             ${gridParts.slice(half).join('  ')}`);
  }

  // 扩展规则状态
  if (!results.rules.some((r) => r.number > 11)) {
    console.log('  扩展规则   未启用（E1 E2 E3 E4，config 中开启）');
  }

  // 历史拦截统计
  const stats = getHistoryStats();
  if (stats) {
    console.log('');
    console.log(`  历史拦截：${stats.total} 次审计记录（本月 ${stats.thisMonth} 次）`);
  }

  // 判定行
  console.log('');
  const judgeIcon = exitCode === 0 ? '✅ PASS' : exitCode === 1 ? '⚠️  WARN (有警告)' : '❌ FAIL (有违规)';
  console.log(`  判定: ${judgeIcon} · exit code ${exitCode}`);
  const ruleSummary = exitCode === 0
    ? `${results.rules.length} 条规则全部通过`
    : `${results.rules.length} 条规则已完成检测`;
  console.log(`  审计引擎: sofagent-audit v${VERSION} · ${ruleSummary}`);

  // 失败时输出"下一步"指引
  if (exitCode > 0) {
    console.log('');
    console.log('  ┌─ 下一步 ─────────────────────────────────────────────┐');
    console.log('  │ 1. 修复上述问题后重新 git add + git commit            │');
    console.log('  │ 2. 如需临时跳过（不推荐）：git commit --no-verify     │');
    console.log('  │ 3. 查看完整文档：sofagent-audit --help                │');
    console.log('  └──────────────────────────────────────────────────────┘');
  }

  // CI 模式提醒
  if (ci) {
    console.log('  💡 CI 模式仅检查 git diff 硬证据，完整审计需配合 Agent 日志（A7/A8）。');
  }

  console.log('');
}

main().catch((err) => {
  console.error('sofagent-audit 内部错误:', err.message);
  process.exit(2);
});
