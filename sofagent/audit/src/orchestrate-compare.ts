#!/usr/bin/env node
// sofagent-orchestrate-compare · 编排方案 A/B 对比 + 任务编排 CLI
//
// TODO(v1.1): 实现连续胜出计数器（CONSECUTIVE_WINS_REQUIRED = 2）
// 当前只做单次对比。连续胜出判断需手动执行两次 compare 后人工决策。
// 参见 ARCHITECTURE.md §A/B 测试
//
// 用法:
//   sofagent-orchestrate-compare --current <dir> --candidate <dir> --output <dir>
//   sofagent-orchestrate-compare promote --candidate <dir>
//   sofagent-orchestrate-compare compose "任务描述" [--dry-run] [--worktree] [--model flash|pro]

import { execFileSync } from 'child_process';
import { existsSync, readdirSync, readFileSync, statSync, mkdirSync, writeFileSync, copyFileSync, renameSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { createHash } from 'crypto';
import { VERSION } from './shared/constants.js';

export interface Metric { runCount: number; auditViolations: number; avgSteps: number; firstPassRate: number; }
interface Args { current: string; candidate: string; output: string; }
type Winner = 'Current' | 'Candidate' | '—';

const RED = '\x1b[0;31m'; const GREEN = '\x1b[0;32m'; const YELLOW = '\x1b[1;33m'; const BLUE = '\x1b[0;34m'; const NC = '\x1b[0m';
const AO_TIMEOUT = 180_000;
const AO_UTIL_TIMEOUT = 30_000;

function info(msg: string) { console.log(`${BLUE}[orchestrate]${NC} ${msg}`); }
function ok(msg: string) { console.log(`${GREEN}[✓]${NC} ${msg}`); }
function warn(msg: string) { console.log(`${YELLOW}[!]${NC} ${msg}`); }
function err(msg: string) { console.error(`${RED}[✗]${NC} ${msg}`); }
function cmdExists(cmd: string): boolean {
  const which = process.platform === 'win32' ? 'where' : 'which';
  try { execFileSync(which, [cmd], { stdio: 'ignore' }); return true; } catch { return false; }
}

// ════════════════════════════════════════
// 子命令: compare (默认)
// ════════════════════════════════════════

function parseArgs(argv: string[]): Args {
  const a: Partial<Args> = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--current' && argv[i + 1]) a.current = argv[++i]!;
    else if (argv[i] === '--candidate' && argv[i + 1]) a.candidate = argv[++i]!;
    else if (argv[i] === '--output' && argv[i + 1]) a.output = argv[++i]!;
    else if (argv[i] === '--help' || argv[i] === '-h') {
      showHelp();
      process.exit(0);
    }
  }
  if (!a.current || !a.candidate || !a.output) {
    console.error('Usage: sofagent-orchestrate-compare --current <dir> --candidate <dir> --output <dir>');
    process.exit(1);
  }
  return { current: resolve(a.current), candidate: resolve(a.candidate), output: resolve(a.output) };
}

export function scanLogFiles(dir: string): string[] {
  // TODO(v1.1): 嵌套 try/catch 应展平为函数式错误处理管道
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      try { if (statSync(full).isDirectory()) for (const f of readdirSync(full)) {
        const fp = join(full, f);
        try { if (f.endsWith('.md') && statSync(fp).isFile()) files.push(fp); } catch { /* skip */ }
      } }      catch { /* skip unreadable subdir */ }
    }
  } catch { /* skip unreadable root */ }
  return files.sort();
}

// ⚠️ extractMetrics 用 emoji 计数（✅/🔴）计算首次通过率
// 此方法受日志输出格式影响，格式变更时需同步更新计数逻辑。
// TODO(v1.1): emoji 计数脆弱——依赖日志输出格式，应改用结构化 metric 字段。
export function extractMetrics(dir: string): Metric {
  const files = scanLogFiles(dir);
  let fails = 0, steps = 0, pass = 0, fail = 0;
  for (const file of files) {
    try {
      const c = readFileSync(file, 'utf-8');
      fails += (c.match(/FAIL/g) ?? []).length;
      steps += (c.match(/Step\s+\d+/gi) ?? []).length;
      pass += (c.match(/✅/g) ?? []).length;
      fail += (c.match(/🔴/g) ?? []).length;
    } catch { /* skip unreadable */ }
  }
  const n = files.length;
  const total = pass + fail;
  return {
    runCount: n,
    auditViolations: fails,
    avgSteps: n > 0 ? Math.round((steps / n) * 10) / 10 : 0,
    firstPassRate: total > 0 ? Math.round((pass / total) * 100) : 0,
  };
}

export function generateReport(curr: Metric, cand: Metric, date: string): string {
  const compare = (current: number, candidate: number, lowerBetter: boolean): Winner => {
    if (current === candidate) return '—';
    const cw = lowerBetter ? current < candidate : current > candidate;
    return cw ? 'Current' : 'Candidate';
  };
  type Row = [string, string, string, Winner];
  const rows: Row[] = [
    ['Runs', String(curr.runCount), String(cand.runCount), '—'],
    ['Audit violations', String(curr.auditViolations), String(cand.auditViolations),
      compare(curr.auditViolations, cand.auditViolations, true)],
    ['Avg steps', String(curr.avgSteps), String(cand.avgSteps),
      compare(curr.avgSteps, cand.avgSteps, true)],
    ['First-pass rate', `${curr.firstPassRate}%`, `${cand.firstPassRate}%`,
      compare(curr.firstPassRate, cand.firstPassRate, false)],
  ];
  const table = [
    '| Metric | Current | Candidate | Winner |',
    '|--------|---------|-----------|--------|',
    ...rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3]} |`),
  ].join('\n');

  const cw = rows.filter(r => r[3] === 'Candidate').length;
  const kw = rows.filter(r => r[3] === 'Current').length;
  const decisive = cw !== kw;
  const result = decisive ? (cw > kw ? 'Candidate' : 'Current') : 'Tie';
  const winCount = Math.max(cw, kw);
  const metricCount = rows.length - 1;

  const minRuns = Math.min(curr.runCount, cand.runCount);
  const confidence = minRuns >= 30 ? 'high' : minRuns >= 15 ? 'medium' : 'low';
  const note = curr.runCount !== cand.runCount
    ? ` (candidate has fewer runs: ${cand.runCount} vs ${curr.runCount})` : '';

  const action = result === 'Candidate'
    ? '`sofagent-orchestrate-compare promote`'
    : result === 'Current' ? 'keep current scheme' : 'manual review needed';

  return [
    `# Orchestration A/B Comparison — ${date}`,
    '', '## Summary', '', table, '', '## Decision', '',
    `- **Result**: ${result}${decisive ? ` wins on ${winCount}/${metricCount} metrics` : ''}`,
    `- **Action**: ${action}`,
    `- **Confidence**: ${confidence}${note}`,
    `- **Next re-evaluation**: after ${Math.max(30, minRuns + 10)} more sessions`,
    '',
  ].join('\n');
}

// ════════════════════════════════════════
// 子命令: promote
// ════════════════════════════════════════

interface PromoteArgs { candidate: string; }

function parsePromoteArgs(argv: string[]): PromoteArgs {
  let candidate = '';
  for (let i = 3; i < argv.length; i++) {
    if (argv[i] === '--candidate' && argv[i + 1]) candidate = argv[++i]!;
  }
  if (!candidate) {
    console.error('Usage: sofagent-orchestrate-compare promote --candidate <dir>');
    process.exit(1);
  }
  return { candidate: resolve(candidate) };
}

export function promoteWorkflow(candidateDir: string): void {
  if (!existsSync(candidateDir)) { throw new Error(`candidate 目录不存在: ${candidateDir}`); }
  const candidateYaml = join(candidateDir, 'workflow.yaml');
  if (!existsSync(candidateYaml)) { throw new Error(`candidate 目录下无 workflow.yaml: ${candidateDir}`); }
  const orchestratorDir = join(candidateDir, '..');
  const currentDir = join(orchestratorDir, 'current');
  const historyDir = join(orchestratorDir, 'history');
  mkdirSync(historyDir, { recursive: true });
  mkdirSync(currentDir, { recursive: true });
  const currentYaml = join(currentDir, 'workflow.yaml');
  if (existsSync(currentYaml)) {
    const ts = new Date().toISOString().slice(0, 10);
    renameSync(currentYaml, join(historyDir, `v1-${ts}.yaml`));
  }
  copyFileSync(candidateYaml, currentYaml);
}

// ════════════════════════════════════════
// 子命令: compose（原 task-orchestrate）
// ════════════════════════════════════════

const BINARY_MODE = { SPLIT: '拆', DIRECT: '不拆' } as const;

function shouldSkipAoCompose(cachedYaml: string): boolean {
  return existsSync(cachedYaml);
}

function composeTask(args: string[]): void {
  let taskDesc = '';
  let dryRun = false;
  let useWorktree = false;
  let aoModel = '';

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    switch (a) {
      case '--dry-run': dryRun = true; break;
      case '--worktree': useWorktree = true; break;
      case '--model': aoModel = args[++i]!; break;
      case '--version': console.log(`sofagent-orchestrate-compare compose v${VERSION}`); process.exit(0);
      case '--help': showComposeHelp(); process.exit(0);
      default:
        if (a.startsWith('--model=')) { aoModel = a.split('=')[1]!; break; }
        if (!a.startsWith('--')) { taskDesc = a; break; }
    }
  }

  if (!taskDesc) { err('缺少任务描述。用法: sofagent-orchestrate-compare compose "你的任务"'); process.exit(1); }

  if (!cmdExists('ao')) {
    warn('agency-orchestrator (ao) 未安装——编排引擎不可用');
    warn('降级方案：手动拆任务 → 逐条手动记录 → 手动闭环');
    defaultOrchestrate(taskDesc);
    process.exit(0);
  }

  console.log('');
  console.log('  ╔═══════════════════════════════════╗');
  console.log('  ║   sofagent · task orchestrate    ║');
  console.log('  ╚═══════════════════════════════════╝');
  console.log('');

  const taskSlug = createHash('sha256').update(taskDesc).digest('hex').slice(0, 8);
  const homeDir = process.env.HOME || '/tmp';
  const sofagentData = process.env.SOFAGENT_DATA || join(homeDir, '.sofagent');
  const orchestratorDir = join(sofagentData, 'orchestrator');
  const workflowsDir = join(orchestratorDir, 'workflows');
  const cachedYaml = join(workflowsDir, `${taskSlug}.yaml`);
  mkdirSync(workflowsDir, { recursive: true });

  const [totalRuns, successRuns] = analyzeTrackRecord(taskDesc, sofagentData);
  if (totalRuns > 0) {
    const pct = Math.round(successRuns * 100 / totalRuns);
    info(`历史记录: ${totalRuns} 次运行 · 成功率 ${pct}%`);
  }

  let mode: '拆' | '不拆';
  let skipAoCompose = shouldSkipAoCompose(cachedYaml);

  if (skipAoCompose) {
    mode = BINARY_MODE.DIRECT;
    ok(`缓存复用 — ${taskSlug}.yaml（跳编排）`);
  } else if (totalRuns >= 3 && successRuns >= totalRuns) {
    mode = BINARY_MODE.DIRECT;
    info(`${BINARY_MODE.DIRECT} — 任务稳定（连续 ${successRuns}/${totalRuns} 成功），直接交付 Agent`);
  } else {
    mode = BINARY_MODE.SPLIT;
    info(`编排模式: ${BINARY_MODE.SPLIT} — AO compose 一次性拆解`);
  }

  console.log('');

  if (mode === BINARY_MODE.DIRECT && !skipAoCompose) {
    info('跳过编排/Harness/worktree，直接执行...');
    const start = Date.now();
    const r = runAo([taskDesc]);
    const elapsed = Math.round((Date.now() - start) / 1000);
    console.log('');
    r.code === 0 ? ok(`任务完成（耗时 ${elapsed}s）`) : warn(`任务结束（exit ${r.code}，耗时 ${elapsed}s）`);
    console.log('');
    console.log(`  编排结束。exit code: ${r.code} · 模式: ${BINARY_MODE.DIRECT}`);
    console.log('');
    process.exit(r.code);
  }

  let workflowFile = '';
  if (skipAoCompose) {
    workflowFile = cachedYaml;
    info('Step 1/3 · 使用缓存模板');
  } else {
    info('Step 1/3 · AO 编排分析（一次性拆解）...');
    if (aoModel) info(`  模型: ${aoModel}`);
    workflowFile = join(process.env.TMPDIR || '/tmp', `sofagent-workflow-${process.pid}.yaml`);
    try {
      const aoArgs = aoModel ? ['compose', '--model', aoModel, taskDesc] : ['compose', taskDesc];
      const output = execFileSync('ao', aoArgs, { encoding: 'utf-8', timeout: AO_TIMEOUT });
      writeFileSync(workflowFile, output);
    } catch {
      warn('ao compose 未生成 YAML，尝试直接执行...');
      try {
        execFileSync('ao', ['compose', taskDesc, '--run'], { stdio: 'inherit', timeout: AO_TIMEOUT });
        process.exit(0);
      } catch { process.exit(1); }
    }

    if (existsSync(workflowFile)) {
      ok('编排计划已生成');
      try {
        info('编排预览:');
        execFileSync('ao', ['explain', workflowFile], { stdio: 'inherit', timeout: AO_UTIL_TIMEOUT });
      } catch {
        console.log(readFileSync(workflowFile, 'utf-8').split('\n').slice(0, 20).join('\n'));
      }
    }
  }

  console.log('');

  if (dryRun) { info('dry-run 模式，退出'); process.exit(0); }

  const worktrees: string[] = [];

  function cleanupWorktrees(): void {
    for (const wt of worktrees) {
      if (existsSync(wt)) {
        info(`清理 worktree: ${wt}`);
        try {
          execFileSync('git', ['worktree', 'remove', wt, '--force'], { stdio: 'ignore', timeout: AO_UTIL_TIMEOUT });
        } catch {
          try { rmSync(wt, { recursive: true, force: true }); } catch { /* */ }
        }
      }
    }
  }

  process.on('exit', cleanupWorktrees);
  process.on('SIGINT', () => { cleanupWorktrees(); process.exit(130); });
  process.on('SIGTERM', () => { cleanupWorktrees(); process.exit(143); });

  if (useWorktree) {
    let inGitRepo = false;
    try { execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'ignore' }); inGitRepo = true; } catch { /* */ }
    if (inGitRepo) {
      info('Step 2/3 · 创建 worktree 隔离...');
      let subCount = 1;
      const cachedFile = skipAoCompose ? cachedYaml : workflowFile;
      if (existsSync(cachedFile)) {
        try {
          const yamlContent = readFileSync(cachedFile, 'utf-8');
          const matches = yamlContent.match(/subtask|agent|workflow/gi);
          if (matches) subCount = Math.min(Math.max(matches.length, 1), 5);
        } catch { /* */ }
      }
      let baseBranch = 'main';
      try {
        baseBranch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf-8', timeout: AO_UTIL_TIMEOUT }).trim() || 'main';
      } catch { /* */ }
      for (let i = 1; i <= subCount; i++) {
        const wtName = `sofagent-task-${i}-${process.pid}`;
        const wtPath = join(process.env.TMPDIR || '/tmp', wtName);
        info(`  创建 worktree ${i}/${subCount}: ${wtPath}`);
        try {
          execFileSync('git', ['worktree', 'add', wtPath, baseBranch], { stdio: 'ignore', timeout: AO_UTIL_TIMEOUT });
          worktrees.push(wtPath);
        } catch {
          warn('  worktree 创建失败，跳过隔离');
        }
      }
      if (worktrees.length > 0) ok(`${worktrees.length} 个 worktree 就绪`);
    } else {
      warn('不在 git 仓库中，跳过 worktree 隔离');
    }
  } else {
    info('Step 2/3 · 跳过 worktree 隔离（加 --worktree 启用）');
  }

  console.log('');
  info('Step 3/3 · Harness 约束...');
  const hookDir = join(homeDir, '.openclaw', 'hooks', 'sofagent-load-chain');
  if (existsSync(join(hookDir, 'handler.ts')) && existsSync(join(hookDir, 'HOOK.md'))) {
    ok('加载链 hook 就绪');
  } else {
    warn(`加载链 hook 未部署: ${hookDir}`);
    warn('子 Agent 可能拿不到 think.md/fde.md');
  }
  console.log('');

  info('执行任务编排...');
  const startTime = Date.now();
  let result: { code: number };

  const executeFile = existsSync(workflowFile) ? workflowFile : '';
  if (executeFile) {
    result = runAo(['run', executeFile]);
  } else {
    result = runAo(['compose', taskDesc, '--run']);
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log('');
  if (result.code === 0) {
    ok(`任务完成（耗时 ${elapsed}s）`);
    if (!skipAoCompose && existsSync(workflowFile)) {
      try {
        mkdirSync(orchestratorDir, { recursive: true });
        copyFileSync(workflowFile, cachedYaml);
        info(`工作流已缓存: ${taskSlug}.yaml`);
      } catch { /* */ }
    }
  } else {
    warn(`任务结束（exit ${result.code}，耗时 ${elapsed}s）`);
  }

  console.log('');
  console.log(`  编排结束。exit code: ${result.code} · 模式: ${mode}`);
  console.log('');
  process.exit(result.code);
}

function analyzeTrackRecord(taskDesc: string, sofagentData: string): [number, number] {
  const logDir = join(sofagentData, 'task', 'logs');
  let total = 0, success = 0;
  try {
    for (const sub of readdirSync(logDir, { withFileTypes: true })) {
      if (!sub.isDirectory()) continue;
      for (const f of readdirSync(join(logDir, sub.name))) {
        if (!f.endsWith('.md')) continue;
        const content = readFileSync(join(logDir, sub.name, f), 'utf-8');
        if (!content.includes(taskDesc)) continue;
        total++;
        if (/状态\s*\|\s*成功/.test(content)) success++;
      }
    }
  } catch { /* log dir may not exist */ }
  return [total, success];
}

function runAo(aoArgs: string[]): { code: number } {
  try {
    execFileSync('ao', aoArgs, { stdio: 'inherit', timeout: AO_TIMEOUT });
    return { code: 0 };
  } catch (e: any) {
    return { code: e.status ?? e.code ?? 1 };
  }
}

function defaultOrchestrate(task: string): void {
  console.log('');
  console.log('  ╔═══════════════════════════════════╗');
  console.log('  ║   sofagent · 默认编排（无 ao）    ║');
  console.log('  ╚═══════════════════════════════════╝');
  console.log('');
  console.log(`  任务: ${task}`);
  console.log('');
  console.log('  建议手动拆为 3-5 个子任务：');
  console.log('    1. 分析/准备 → developer');
  console.log('    2. 核心实现 → developer');
  console.log('    3. 验证/测试 → qa-engineer');
  console.log('    4. 文档/收尾 → technical-writer');
  console.log('');
}

function showComposeHelp(): void {
  console.log(`sofagent-orchestrate-compare compose v${VERSION}`);
  console.log('  包装 ao compose，加 worktree 隔离 + 约束注入');
  console.log('');
  console.log('  用法:');
  console.log('    sofagent-orchestrate-compare compose "任务描述"');
  console.log('    sofagent-orchestrate-compare compose "任务描述" --dry-run    仅预览编排');
  console.log('    sofagent-orchestrate-compare compose "任务描述" --worktree   创建独立 worktree');
  console.log('    sofagent-orchestrate-compare compose "任务描述" --model flash|pro  指定模型');
  console.log('');
  console.log('  两档拆解:');
  console.log('    拆    首次运行或复杂任务，AO compose 一次性拆解');
  console.log('    不拆  历史成功率100%或有缓存 → 直接交付 Agent');
  console.log('');
  console.log('  依赖: agency-orchestrator (ao), git (worktree 模式)');
}

// ════════════════════════════════════════
// Help
// ════════════════════════════════════════

function showHelp(): void {
  console.log(`sofagent-orchestrate-compare v${VERSION}`);
  console.log('  sofagent 编排方案对比 & 任务编排 CLI');
  console.log('');
  console.log('  子命令:');
  console.log('    (默认)   sofagent-orchestrate-compare --current <dir> --candidate <dir> --output <dir>');
  console.log('    promote  sofagent-orchestrate-compare promote --candidate <dir>');
  console.log('    compose  sofagent-orchestrate-compare compose "任务描述" [--dry-run] [--worktree] [--model flash|pro]');
}

// ════════════════════════════════════════
// main
// ════════════════════════════════════════

function main(): void {
  if (process.argv[2] === 'promote') {
    const args = parsePromoteArgs(process.argv);
    try {
      promoteWorkflow(args.candidate);
      console.log(`✅ promote 完成: ${join(args.candidate, 'workflow.yaml')} → ${join(join(args.candidate, '..'), 'current', 'workflow.yaml')}`);
    } catch (e: any) {
      console.error(`❌ ${e.message}`);
      process.exit(1);
    }
    return;
  }

  if (process.argv[2] === 'compose') {
    composeTask(process.argv.slice(3));
    return;
  }

  if (process.argv[2] === '--help' || process.argv[2] === '-h') {
    showHelp();
    process.exit(0);
  }

  const args = parseArgs(process.argv);
  for (const [label, dir] of [['current', args.current], ['candidate', args.candidate]] as const) {
    if (!existsSync(dir)) { console.error(`❌ ${label} 目录不存在: ${dir}`); process.exit(1); }
  }
  // 时间窗口校验：两个目录的日志如果来自不同时间段，对比意义有限
  const mtimeA = statSync(args.current).mtimeMs;
  const mtimeB = statSync(args.candidate).mtimeMs;
  const timeDiffHours = Math.abs(mtimeA - mtimeB) / (1000 * 60 * 60);
  if (timeDiffHours > 24) {
    console.warn(`⚠️ 数据时间跨度 ${timeDiffHours.toFixed(1)} 小时，A/B 对比置信度可能降低`);
  }
  const curr = extractMetrics(args.current);
  const cand = extractMetrics(args.candidate);
  if (curr.runCount === 0 && cand.runCount === 0) {
    console.error('❌ 两个目录下都没有日志文件。'); process.exit(1);
  }
  try { mkdirSync(args.output, { recursive: true }); } catch {
    console.error(`❌ 无法创建输出目录: ${args.output}`); process.exit(1);
  }
  const date = new Date().toISOString().slice(0, 10);
  const report = generateReport(curr, cand, date);
  const outPath = join(args.output, `${date}.md`);
  writeFileSync(outPath, report, 'utf-8');
  console.log(`✅ 对比报告已生成: ${outPath}`);
}

if (process.argv[1]?.includes('orchestrate-compare')) main();
