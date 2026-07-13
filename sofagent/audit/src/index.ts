#!/usr/bin/env node
// ============================================================
// sofagent-audit · 提交时审计 CLI 入口
// v1.0.8 · 审计闭环六步（检测+分类+根因+改进+回归+上线）
// v1.0.8 新增：compose 子命令 + 未知子命令报错 + audit fast-fail
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
//   node sofagent/audit/dist/index.js compose --task "审计最近 5 次提交"
//
// 退出码：
//   0 = 全通过
//   1 = 有警告
//   2 = 有违规（A1 不碰敏感 / A2 不泄密钥）
// ============================================================

import { execFileSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, readdirSync, copyFileSync, unlinkSync } from 'fs';
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
  /** v1.0.8: eval harness */
  eval?: string;
  /** v1.0.8: A/B 测试 */
  abTest?: string;
  /** v1.0.8: Agent Dashboard */
  agents?: boolean;
  /** v1.0.8: hub 子命令 */
  hubCommand?: string;
  hubTemplate?: string;
  /** v1.0.8: compose 子命令 */
  composeTask?: string;
  composeAgent?: string;
  composeRun?: boolean;
  /** v1.0.8: subagent 子命令 */
  subagentName?: string;
  subagentTask?: string;
  /** v1.0.8: subagent 运行模式 */
  subagentMode?: 'deploy' | 'sustain';
  /** v1.0.8: 恢复到指定快照 SHA */
  revertSha?: string;
  /** v1.0.8: ontology 子命令 */
  ontologyCommand?: string;
  /** v1.0.8: daemon 子命令 */
  daemonCommand?: string;
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
      args.silent = true;   // --ci 隐含 --silent（紧凑输出），不隐含 --strict
    } else if (argv[i] === '--install-hook') {
      args.installHook = true;
    } else if (argv[i] === '--json') {
      args.json = true;
    } else if (argv[i] === '--root-cause') {
      args.rootCause = true;
    } else if (argv[i] === '--regression' && argv[i + 1]) {
      i++;
      args.regressionDir = argv[i] as string;
    } else if (argv[i] === '--revert' && argv[i + 1]) {
      i++;
      args.revertSha = argv[i] as string;
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
    } else if (argv[i] === 'compose') {
      // v1.0.8: compose 子命令
      args.composeTask = '';
      for (let j = i + 1; j < argv.length; j++) {
        if (argv[j] === '--task' && argv[j + 1]) {
          j++;
          args.composeTask = argv[j] as string;
        } else if (argv[j] === '--agent' && argv[j + 1]) {
          j++;
          args.composeAgent = argv[j] as string;
        } else if (argv[j] === '--run') {
          args.composeRun = true;
        } else if (!argv[j]!.startsWith('--')) {
          // positional arg after compose
          if (!args.composeTask) args.composeTask = argv[j] as string;
        }
      }
      i = argv.length; // consume remaining args
    } else if (argv[i] === 'subagent' && argv[i + 1] === 'run') {
      // v1.0.8: subagent run 子命令
      i += 2;
      args.subagentName = argv[i] as string;
      args.subagentMode = 'deploy'; // v1.0.8: 默认 deploy 模式
      for (let j = i + 1; j < argv.length; j++) {
        if (argv[j] === '--task' && argv[j + 1]) {
          j++;
          args.subagentTask = argv[j] as string;
        } else if (argv[j] === '--mode' && argv[j + 1]) {
          j++;
          const mode = argv[j] as string;
          if (mode === 'deploy' || mode === 'sustain') {
            args.subagentMode = mode;
          } else {
            console.error(`❌ 无效的 mode: ${mode}（支持: deploy / sustain）`);
            process.exit(1);
          }
        }
      }
      i = argv.length;
    } else if (argv[i] === 'hub' && argv[i + 1]) {
      i++;
      args.hubCommand = argv[i] as string;
      if ((args.hubCommand === 'deploy' || args.hubCommand === 'list') && argv[i + 1] && !argv[i + 1]!.startsWith('--')) {
        i++;
        args.hubTemplate = argv[i] as string;
      }
    } else if (argv[i] === 'ontology' && argv[i + 1]) {
      i++;
      args.ontologyCommand = argv[i] as string;
    } else if (argv[i] === '--daemon' && argv[i + 1]) {
      i++;
      args.daemonCommand = argv[i] as string;
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
      console.log('  sofagent-audit hub list                         列出 Workflow Hub 模板');
      console.log('  sofagent-audit hub deploy <模板名>               部署 Workflow Hub 模板');
      console.log('  sofagent-audit --root-cause                     根因分析');
      console.log('  sofagent-audit --regression <dir>               回归验证');
      console.log('  sofagent-audit --install-hook                   安装 commit-msg hook');
      console.log('  sofagent-audit --eval <golden-set.yml>          eval harness 评测');
      console.log('  sofagent-audit --ab-test <config.yml>           Sub Agent A/B 测试');
      console.log('  sofagent-audit skillopt-run --input <path>       SkillOpt 自动优化（需 skillopt-sleep）');
      console.log('  sofagent-audit compose --task <desc>             编排方案生成（DeepAgents）');
      console.log('  sofagent-audit subagent run <name> --task <desc> 运行预装 Sub Agent（fde / audit）');
      console.log('  sofagent-audit subagent run fde --mode sustain --task <desc> FDE 持续优化模式（v1.0.8）');
      console.log('  sofagent-audit --revert <snapshot-sha>              恢复到指定快照（v1.0.8）');
      console.log('  sofagent-audit ontology view                        本体人类可读视图（v1.0.8）');
      console.log('  sofagent-audit --daemon start                       启动文件系统监控 daemon（v1.0.8）');
      console.log('模式对照表:');
      console.log('  默认模式    全部规则（含 Agent 日志）   exit 0/1/2');
      console.log('  --silent    只跑 git-diff 规则          exit 0/1/2');
      console.log('  --strict    任何警告都 exit 2            exit 0/2');
      console.log('  --ci        = --silent (紧凑输出)     exit 0/1/2');
      if (verbose) {
        console.log('\n完整参数列表:');
        console.log('  --diff <range>     git diff 范围（默认 HEAD~1..HEAD）');
        console.log('  --task <desc>      任务描述');
        console.log('  --strict           严格模式');
        console.log('  --silent           静默模式');
        console.log('  --ci               CI 模式（= --silent，紧凑输出）');
        console.log('  --json             JSON 输出');
        console.log('  --install-hook     安装 commit-msg hook');
        console.log('  --root-cause       根因分析');
        console.log('  --regression <dir> 回归验证');
        console.log('  --init             一键初始化');
        console.log('  --doctor           健康诊断');
        console.log('  --eval <path>      eval harness 评测');
        console.log('  --ab-test <path>   Sub Agent A/B 测试');
        console.log('  skillopt-run       SkillOpt 自动优化（--input <path> [--scoring <path>]，就地演化 --target-skill-path）');
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
        // skillopt-run 子命令使用独立参数解析（--input/--output/--scoring），
        // 由 main() 中专门的 skillopt-run 块从 process.argv 解析，这里跳过误报。
        if (process.argv[2] === 'skillopt-run') {
          continue;
        }
        console.error(`❌ 未知参数: ${arg}`);
        console.error('   使用 --help 查看可用参数');
        process.exit(1);
      } else if (arg && !arg.startsWith('-')) {
        // v1.0.8: 未知子命令报错
        // skillopt-run 子命令的 positional args（如文件路径）不在这里处理
        if (process.argv[2] === 'skillopt-run') {
          continue;
        }
        const SUBCOMMANDS = ['hub', 'skillopt-run', 'compose', 'subagent', 'ontology'];
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
    console.error('❌ 未找到 .git 目录。请在 git 仓库内运行 --install-hook。');
    process.exit(1);
  }

  // 定位 commit-msg 模板
  // dist/index.js 编译后，模板在 ../../hooks/commit-msg（相对于 dist/）
  const hookTemplate = join(__dirname, '..', 'hooks', 'commit-msg');

  if (!existsSync(hookTemplate)) {
    console.error(`❌ 未找到 commit-msg 模板: ${hookTemplate}`);
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
  // 就地演化模型：runSkillOpt 内部调用 `skillopt-sleep run --target-skill-path <input> --auto-adopt`，
  // 演化后文件即 input 本身；编排层先备份、再演化、再对比备份验证、不达标则回滚。
  if (process.argv[2] === 'skillopt-run') {
    const { runSkillOpt, validateCandidate } = await import('./skillopt-integration');
    const argsArr = process.argv.slice(3);
    const inputIdx = argsArr.indexOf('--input');
    const outputIdx = argsArr.indexOf('--output');
    const inputPath: string | undefined = inputIdx >= 0 ? argsArr[inputIdx + 1] : undefined;
    // --output 在早期 flat 契约中用于指定候选输出路径；就地演化模型下已废弃（runSkillOpt 忽略）。
    let outputPath = '/tmp/skillopt-candidate.md';
    if (outputIdx >= 0 && argsArr[outputIdx + 1]) {
      outputPath = argsArr[outputIdx + 1] as string;
    }
    const scoringIdx = argsArr.indexOf('--scoring');
    const scoringPath: string | undefined = scoringIdx >= 0 ? argsArr[scoringIdx + 1] : undefined;

    if (!inputPath) {
      console.error('用法: sofagent-audit skillopt-run --input <SKILL.md路径> [--scoring <scoring.md路径>]');
      process.exit(1);
    }

    if (!existsSync(inputPath)) {
      console.error(`❌ 输入文件不存在: ${inputPath}`);
      process.exit(1);
    }

    // 1. 演化前先备份原始文件（用于回滚 / 对比基线）
    const backupPath = inputPath + '.bak.' + Date.now();
    copyFileSync(inputPath, backupPath);

    // 2. 就地演化（runSkillOpt 内部用 --auto-adopt 把候选写回 inputPath）
    const result = runSkillOpt(inputPath, outputPath, scoringPath);
    if (!result.success) {
      // 运行失败：inputPath 未被修改，删除无用备份，退出非零。
      try { unlinkSync(backupPath); } catch { /* 忽略 */ }
      console.error(`❌ SkillOpt 运行失败: ${result.error}`);
      process.exit(1);
    }

    // 3. 验证演化后文件 vs 原始备份
    const validation = validateCandidate(inputPath, backupPath);
    if (!validation.canReplace) {
      // 回滚：用备份覆盖（inputPath 即演化后文件），保留备份供人工检视。
      copyFileSync(backupPath, inputPath);
      console.log(`⚠️ 候选 Skill 未通过验证: ${validation.reason}。已回滚至原始版本（备份: ${backupPath}）。`);
      process.exit(0);
    }

    // 4. 通过验证：保留就地演化结果（runSkillOpt 已写回 inputPath，无需再 copyFileSync）
    console.log(`✅ Skill 自动优化完成: ${inputPath}（备份: ${backupPath}，提升: ${validation.scoreDiff?.toFixed(1) || 'N/A'} 分）`);
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
      // v1.0.8: Agent Dashboard 原型
      const { runAgentDashboard } = await import('./commands/doctor');
      runAgentDashboard();
      return;
    }
    const { runDoctor } = await import('./commands/doctor');
    runDoctor();
    return;
  }

  // compose 子命令（v1.0.8 新增）
  if (args.composeTask !== undefined) {
    if (!args.composeTask) {
      console.error('用法: sofagent-audit compose --task "任务描述" [--agent <agent>] [--run]');
      process.exit(1);
    }
    try {
      const { composeWithDeepAgents } = await import('./subagents/composer');
      const yaml = await composeWithDeepAgents(args.composeTask);
      if (yaml) {
        process.stdout.write(yaml);
        process.stdout.write('\n');
        process.exit(0);
      } else {
        process.stderr.write('❌ 编排方案生成失败——DeepAgents 不可用。\n');
        process.exit(2);
      }
    } catch (err) {
      process.stderr.write(`❌ compose 执行失败: ${(err as Error).message}\n`);
      process.exit(2);
    }
    return;
  }

  // subagent 子命令（v1.0.8 新增）
  if (args.subagentName) {
    if (!args.subagentTask) {
      console.error('用法: sofagent-audit subagent run <name> --task "任务描述" [--mode deploy|sustain]');
      console.error('预装 Sub Agent: fde, audit');
      process.exit(1);
    }
    try {
      const { listAgents } = await import('./subagents/registry');
      const agents = listAgents('.sofagent');
      const agent = agents.find(a => a.name === args.subagentName);
      if (!agent) {
        console.error(`未找到 Sub Agent: ${args.subagentName}`);
        console.error(`可用: ${agents.map(a => a.name).join(', ')}`);
        process.exit(1);
      }
      // v1.0.8: 传入 mode 参数
      const { spawnSubAgent } = await import('./subagents/launcher');
      const result = await spawnSubAgent(agent, args.subagentTask!, args.subagentMode);
      process.stdout.write(result);
      process.stdout.write('\n');
      process.exit(0);
    } catch (err) {
      process.stderr.write(`❌ subagent 执行失败: ${(err as Error).message}\n`);
      process.exit(2);
    }
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

  // ontology 子命令（v1.0.8 新增）
  if (args.ontologyCommand === 'view') {
    const { generateOntologyView } = await import('./ontology/ontology-view');
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

  // --daemon start：启动文件系统监控 daemon（v1.0.8 新增）
  if (args.daemonCommand === 'start') {
    const { startWatching } = await import('./daemon/fs-watch');
    const { loadWatchConfig } = await import('./config/watch-config');
    const projectDir = process.cwd();
    const config = loadWatchConfig(projectDir);
    console.log('sofagent daemon · 文件系统监控');
    console.log(`  监控路径: ${config.paths.join(', ') || '(默认: 当前目录)'}`);
    console.log(`  防抖: ${config.debounceMs ?? 5000}ms`);
    console.log('');
    console.log('  Daemon 已启动。按 Ctrl+C 停止。');
    const fs = await import('fs');
    const noticePath = join(projectDir, '.sofagent', 'daemon-notice.md');
    startWatching(projectDir, async (changedFiles) => {
      const time = new Date().toISOString();
      const lines = [
        `- [${time}] 检测到文件变更`,
        ...changedFiles.map(f => `  - ${f}`),
      ];
      console.log(lines.join('\n'));
      // 写入 daemon-notice.md 供审计引擎后续检查
      try {
        fs.appendFileSync(noticePath, lines.join('\n') + '\n', 'utf-8');
      } catch {
        // 写入失败不崩溃
      }
    });
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

  // --revert 模式：恢复到指定快照（v1.0.8 新增）
  if (args.revertSha) {
    try {
      const { restoreSnapshot, listAllSnapshots } = await import('./daemon/snapshot');
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

      // 显式确认（交互式）
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const answer = await new Promise<string>((resolve) => {
        rl.question(`⚠️  即将恢复到快照 ${args.revertSha}。此操作将覆盖当前文件。确认？[y/N] `, resolve);
      });
      rl.close();

      if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
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
  if (!commitMsg) {
    try {
      commitMsg = execFileSync('git', ['log', '-1', '--pretty=%B'], { encoding: 'utf-8' }).trim();
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

  // ===== v1.0.8 可视化输出 =====

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
        // 修复建议（v1.0.8 新增）
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
