#!/usr/bin/env node
// ============================================================
// sofagent-audit · 提交时审计 CLI 入口
// v1.0.4 · 审计闭环六步（检测+分类+根因+改进+回归+上线）
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
//
// 退出码：
//   0 = 全通过
//   1 = 有警告
//   2 = 有违规（A1 不碰敏感 / A2 不泄密钥）
// ============================================================

import { execFileSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, readdirSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { parseDiff, parseStagedDiff, isInGitRepo, type DiffFile } from './diff-parser';
import { checkLogs } from './log-checker';
import { runRules, type AuditResult } from './reporter';
import { loadConfig, ConfigLoadError } from './config-loader';
import { loadHistory, appendHistory, type AuditHistoryEntry } from './audit-history';
import { analyzeRootCause } from './audit-root-cause';
import { formatSuggestions } from './config-suggestion';
import { runRegression, type DiffSnapshot } from './audit-regression';
import { defaultRules } from './rules';
import type { RuleCheck } from './rules/types';
import { pushAuditResult, type WebhookPlatform } from './webhook';
import { generateThinkEntry } from './think-generator';
import { VERSION } from './shared/constants.js';
import { getFixSuggestion } from './fix-suggestions';

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
  doctor: boolean;
  /** staged 模式（首次提交场景）——diffRange 值为 --cached */
  cached: boolean;
  /** v1.0.4: eval harness */
  eval?: string;
  /** v1.0.4: A/B 测试 */
  abTest?: string;
  /** v1.0.5: Agent Dashboard */
  agents?: boolean;
  /** v1.0.5: hub 子命令 */
  hubCommand?: string;
  hubTemplate?: string;
}


function parseArgs(argv: string[]): Args {
  const args: Args = { diffRange: 'HEAD~1..HEAD', strict: false, silent: false, ci: false, installHook: false, json: false, rootCause: false, webhookUrl: process.env.SOFAGENT_WEBHOOK_URL, mcp: false, init: false, doctor: false, cached: false };
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
    } else if (argv[i] === '--init') {
      args.init = true;
    } else if (argv[i] === '--doctor') {
      args.doctor = true;
    } else if (argv[i] === '--eval' && argv[i + 1]) {
      i++;
      args.eval = argv[i] as string;
    } else if (argv[i] === '--ab-test' && argv[i + 1]) {
      i++;
      args.abTest = argv[i] as string;
    } else if (argv[i] === '--agents') {
      args.agents = true;
    } else if (argv[i] === 'hub' && argv[i + 1]) {
      i++;
      args.hubCommand = argv[i] as string;
      if ((args.hubCommand === 'deploy' || args.hubCommand === 'list') && argv[i + 1] && !argv[i + 1]!.startsWith('--')) {
        i++;
        args.hubTemplate = argv[i] as string;
      }
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
      console.log('  sofagent-audit --doctor                         健康诊断');
      console.log('  sofagent-audit --doctor --agents                Agent 协同状态');
      console.log('  sofagent-audit hub list                         列出 Work模板市场 模板');
      console.log('  sofagent-audit hub deploy <模板名>               部署 Work模板市场 模板');
      console.log('  sofagent-audit --root-cause                     根因分析');
      console.log('  sofagent-audit --regression <dir>               回归验证');
      console.log('  sofagent-audit --install-hook                   安装 pre-commit hook');
      console.log('  sofagent-audit --eval <golden-set.yml>          eval harness 评测');
      console.log('  sofagent-audit --ab-test <config.yml>           Sub Agent A/B 测试');
      console.log('  sofagent-audit skillopt-run --input <path>       SkillOpt 自动优化（需 skillopt-sleep）');
      console.log('模式对照表:');
      console.log('  默认模式    全部规则（含 Agent 日志）   exit 0/1/2');
      console.log('  --silent    只跑 git-diff 规则          exit 0/1/2');
      console.log('  --strict    任何警告都 exit 2            exit 0/2');
      console.log('  --ci        = --silent + --strict        exit 0/2');
      if (verbose) {
        console.log('\n完整参数列表:');
        console.log('  --diff <range>     git diff 范围（默认 HEAD~1..HEAD）');
        console.log('  --task <desc>      任务描述');
        console.log('  --strict           严格模式');
        console.log('  --silent           静默模式');
        console.log('  --ci               CI 模式（= --silent + --strict）');
        console.log('  --json             JSON 输出');
        console.log('  --install-hook     安装 pre-commit hook');
        console.log('  --root-cause       根因分析');
        console.log('  --regression <dir> 回归验证');
        console.log('  --init             一键初始化');
        console.log('  --doctor           健康诊断');
        console.log('  --eval <path>      eval harness 评测');
        console.log('  --ab-test <path>   Sub Agent A/B 测试');
        console.log('  skillopt-run       SkillOpt 自动优化（--input <path> [--output <path>]）');
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
        console.error(`❌ 未知参数: ${arg}`);
        console.error('   使用 --help 查看可用参数');
        process.exit(1);
      }
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

  // --skillopt-run 模式：SkillOpt 自动优化管道（P0-7）
  if (process.argv[2] === 'skillopt-run') {
    const { runSkillOpt, validateCandidate } = await import('./skillopt-integration');
    const argsArr = process.argv.slice(3);
    const inputIdx = argsArr.indexOf('--input');
    const outputIdx = argsArr.indexOf('--output');
    const inputPath: string | undefined = inputIdx >= 0 ? argsArr[inputIdx + 1] : undefined;
    let outputPath = '/tmp/skillopt-candidate.md';
    if (outputIdx >= 0 && argsArr[outputIdx + 1]) {
      outputPath = argsArr[outputIdx + 1] as string;
    }
    const scoringIdx = argsArr.indexOf('--scoring');
    const scoringPath: string | undefined = scoringIdx >= 0 ? argsArr[scoringIdx + 1] : undefined;

    if (!inputPath) {
      console.error('用法: sofagent-audit skillopt-run --input <SKILL.md路径> [--output <输出路径>] [--scoring <scoring.md路径>]');
      process.exit(1);
    }

    // 1. 调 runSkillOpt
    const result = runSkillOpt(inputPath!, outputPath, scoringPath);
    if (!result.success) {
      console.error(`❌ SkillOpt 运行失败: ${result.error}`);
      process.exit(1);
    }

    // 2. 验证 candidate
    const validation = validateCandidate(result.candidatePath!, inputPath!);
    if (!validation.canReplace) {
      console.log(`⚠️ 候选 Skill 未通过验证: ${validation.reason}。不替换。`);
      process.exit(0);
    }

    // 3. 替换（先备份）
    const backupPath = inputPath! + '.bak.' + Date.now();
    copyFileSync(inputPath!, backupPath);
    copyFileSync(result.candidatePath!, inputPath!);
    console.log(`✅ Skill 自动优化完成: ${inputPath!}（备份: ${backupPath}，提升: ${validation.scoreDiff?.toFixed(1) || 'N/A'} 分）`);
    process.exit(0);
  }

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

  // --doctor 模式：健康诊断
  if (args.doctor) {
    if (args.agents) {
      // v1.0.5: Agent Dashboard 原型
      const { runAgentDashboard } = await import('./commands/doctor');
      runAgentDashboard();
      return;
    }
    const { runDoctor } = await import('./commands/doctor');
    runDoctor();
    return;
  }

  // hub 子命令
  if (args.hubCommand) {
    if (args.hubCommand === 'list') {
      const { listHubTemplates } = await import('./commands/hub');
      listHubTemplates();
      return;
    }
    if (args.hubCommand === 'deploy' && args.hubTemplate) {
      const { hubDeploy } = await import('./commands/hub');
      await hubDeploy(args.hubTemplate, { interactive: true });
      return;
    }
    console.error(`❌ hub 命令用法: sofagent hub list | sofagent hub deploy <模板名>`);
    process.exit(1);
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

  // --eval 模式：eval harness 评测
  if (args.eval) {
    const { runEval } = await import('./eval/eval-runner');
    const { printEvalReport } = await import('./eval/eval-reporter');
    try {
      const result = await runEval({ goldenSetPath: args.eval, verbose: true });
      printEvalReport(result);
    } catch (err) {
      console.error(`❌ eval 运行失败: ${(err as Error).message}`);
      process.exit(1);
    }
    return;
  }

  // --ab-test 模式：Sub Agent A/B 测试
  if (args.abTest) {
    const { runABTest } = await import('./ab-testing/ab-runner');
    const { decidePromotion } = await import('./ab-testing/ab-promoter');
    const { DEFAULT_SCORE_WEIGHTS } = await import('./ab-testing/types');
    const yl = await import('js-yaml');
    const fsMod = await import('fs');

    try {
      // 加载 A/B 配置
      if (!fsMod.existsSync(args.abTest)) {
        console.error(`❌ A/B 配置文件不存在: ${args.abTest}`);
        process.exit(1);
      }
      const abConfigRaw = yl.load(fsMod.readFileSync(args.abTest, 'utf-8')) as Record<string, unknown>;
      const config = {
        current: String(abConfigRaw['current'] ?? ''),
        candidate: String(abConfigRaw['candidate'] ?? ''),
        evalSet: String(abConfigRaw['evalSet'] ?? ''),
        promoteThreshold: Number(abConfigRaw['promoteThreshold'] ?? 2),
        minSampleSize: Number(abConfigRaw['minSampleSize'] ?? 10),
        scoreWeights: {
          exactMatch: Number((abConfigRaw['scoreWeights'] as Record<string, number>)?.exactMatch ?? 0.5),
          semanticSimilarity: Number((abConfigRaw['scoreWeights'] as Record<string, number>)?.semanticSimilarity ?? 0.2),
          ruleCompliance: Number((abConfigRaw['scoreWeights'] as Record<string, number>)?.ruleCompliance ?? 0.3),
        },
      };

      // 加载 test cases
      const testCasesRaw = yl.load(fsMod.readFileSync(config.evalSet, 'utf-8')) as Array<Record<string, unknown>>;
      const typedCases = testCasesRaw.map((tc) => ({
        id: String(tc['id'] ?? ''),
        description: String(tc['description'] ?? ''),
        input: tc['input'] as Record<string, unknown>,
        expected: tc['expected'] as Record<string, unknown>,
        tags: tc['tags'] as string[] | undefined,
      }));

      const result = await runABTest(config, typedCases);
      console.log(`A/B 测试结果:`);
      console.log(`  current:  ${(result.currentScore.overall * 100).toFixed(1)}%`);
      console.log(`  candidate: ${(result.candidateScore.overall * 100).toFixed(1)}%`);
      console.log(`  胜出方: ${result.winner}`);
      console.log(`  连续胜出: ${result.consecutiveWins}`);
      console.log(`  分差: ${(result.margin * 100).toFixed(1)}%`);

      const decision = decidePromotion(result, [], config);
      console.log(`  晋升: ${decision.shouldPromote ? '✅ 是' : '❌ 否'} — ${decision.reason}`);
    } catch (err) {
      console.error(`❌ A/B 测试运行失败: ${(err as Error).message}`);
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

  // 3. 读取 commit message（优先读 COMMIT_EDITMSG，用于 pre-commit 阶段获取当前消息）
  let commitMsg = '';
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

  // fallback：COMMIT_EDITMSG 不可用时，尝试 git log → args.task
  if (!commitMsg) {
    try {
      commitMsg = execFileSync('git', ['log', '-1', '--pretty=%B'], { encoding: 'utf-8' }).trim();
    } catch {
      commitMsg = args.task || '';
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

  // 5. 运行规则
  const results = runRules(diffFiles, logEntries, args.task, args.strict, args.silent, commitMsg || undefined, config);

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
    };
    appendHistory(historyEntry);
  } catch {
    // 历史写入失败不影响审计结果
    process.stderr.write('[sofagent-audit] 警告: 审计历史写入失败，跳过（不影响审计结果）\n');
  }

  // 9. 自动生成 think.md（方案 A：基于 git diff 硬证据）
  if (diffFiles.length > 0) {
    try {
      generateThinkEntry(diffFiles, results, args.task);
    } catch {
      // think 生成失败不影响审计结果
      process.stderr.write('[sofagent-audit] 警告: think.md 反思生成失败，跳过（不影响审计结果）\n');
    }
  }

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
    const problems = results.rules.filter((r) => r.status !== 'PASS');
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

  // ===== v1.0.4 可视化输出 =====

  const exitCode = results.exitCode;
  const totalRules = results.rules.length;
  const failCount = results.rules.filter((r) => r.status === 'FAIL').length;
  const warnCount = results.rules.filter((r) => r.status === 'WARN').length;
  const passCount = totalRules - failCount - warnCount;

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
        // 修复建议（v1.0.4 新增）
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
    const icon = r.status === 'PASS' ? '✅' : r.status === 'WARN' ? '⚠️' : '❌';
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
