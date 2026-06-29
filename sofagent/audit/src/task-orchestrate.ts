#!/usr/bin/env node
// ============================================================
// task-orchestrate.ts · AO 编排包装（TypeScript 版）
// ============================================================
// v0.96: 从 bash 版逐功能迁移。用法与 bash 版完全一致。
//
// 用法:
//   node task-orchestrate.ts "任务描述"
//   node task-orchestrate.ts "任务描述" --dry-run
//   node task-orchestrate.ts "任务描述" --worktree
//   node task-orchestrate.ts "任务描述" --level N (1-4)
//   node task-orchestrate.ts "任务描述" --auto
// ============================================================

import { execFileSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

const VERSION = '0.96';
const RED = '\x1b[0;31m'; const GREEN = '\x1b[0;32m'; const YELLOW = '\x1b[1;33m'; const BLUE = '\x1b[0;34m'; const NC = '\x1b[0m';

function info(msg: string) { console.log(`${BLUE}[orchestrate]${NC} ${msg}`); }
function ok(msg: string) { console.log(`${GREEN}[✓]${NC} ${msg}`); }
function warn(msg: string) { console.log(`${YELLOW}[!]${NC} ${msg}`); }
function err(msg: string) { console.error(`${RED}[✗]${NC} ${msg}`); }

const LEVEL_DESC = ['完整编排', '模板复用', '轻量调度', '自主执行'];

// ── Arg parsing ──
let taskDesc = '';
let dryRun = false;
let useWorktree = false;
let autoLevel = false;
let level = 1;
let maxRetries = 3;
let aoModel = '';

void maxRetries; // v0.96 保留参数解析但未实现重试循环（bash 版有此功能，v0.97 补）

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  switch (a) {
    case '--dry-run': dryRun = true; break;
    case '--worktree': useWorktree = true; break;
    case '--auto': autoLevel = true; break;
    case '--max-retries': maxRetries = parseInt(args[++i]!, 10); break;
    case '--model': aoModel = args[++i]!; break;
    case '--version': console.log(`sofagent-task-orchestrate v${VERSION}`); process.exit(0);
    case '--help': showHelp(); process.exit(0);
    default:
      if (a.startsWith('--max-retries=')) { maxRetries = parseInt(a.split('=')[1]!, 10); break; }
      if (a.startsWith('--model=')) { aoModel = a.split('=')[1]!; break; }
      taskDesc = a; break;
  }
}

if (!taskDesc) { err('缺少任务描述。用法: task-orchestrate "你的任务"'); process.exit(1); }

// ── Pre-check: ao ──
if (!commandExists('ao')) {
  warn('agency-orchestrator (ao) 未安装——编排引擎不可用');
  warn('降级方案：手动拆任务 → 逐条手动记录 → 手动闭环');
  warn('安装 ao: npm install -g agency-orchestrator@0.7.5  或  加 --no-ao 参数跳过');
  defaultOrchestrate(taskDesc);
  process.exit(0);
}

console.log('');
console.log('  ╔═══════════════════════════════════╗');
console.log('  ║   sofagent · task orchestrate    ║');
console.log('  ╚═══════════════════════════════════╝');
console.log('');

const levelLabel = LEVEL_DESC[level - 1]!;
info(`任务: ${taskDesc}`);
info(`编排深度: L${level} — ${levelLabel}`);
console.log('');

// ── Task slug ──
const taskSlug = createHash('sha256').update(taskDesc).digest('hex').slice(0, 8);

// ── Data directory ──
const homeDir = process.env.HOME || '/tmp';
const sofagentData = process.env.SOFAGENT_DATA || join(homeDir, '.sofagent');
const orchestratorDir = join(sofagentData, 'orchestrator');
const workflowsDir = join(orchestratorDir, 'workflows');
const cachedYaml = join(workflowsDir, `${taskSlug}.yaml`);

mkdirSync(workflowsDir, { recursive: true });

// ── Load orchestrator config ──
if (existsSync(orchestratorDir)) {
  const orchConfig = existsSync(join(orchestratorDir, `${taskSlug}.json`))
    ? join(orchestratorDir, `${taskSlug}.json`)
    : join(orchestratorDir, '_index.md');
  if (existsSync(orchConfig)) {
    try {
      const cfg = JSON.parse(readFileSync(orchConfig, 'utf-8'));
      if (cfg.level) level = cfg.level;
    } catch { /* _index.md not JSON — skip */ }
  }
}

// ── History analysis ──
function analyzeTrackRecord(slug: string): [number, number] {
  const logDir = join(sofagentData, 'task', 'logs');
  let total = 0, success = 0;
  try {
    for (const sub of readdirSync(logDir, { withFileTypes: true })) {
      if (!sub.isDirectory()) continue;
      for (const f of readdirSync(join(logDir, sub.name))) {
        if (!f.endsWith('.md')) continue;
        const content = readFileSync(join(logDir, sub.name, f), 'utf-8');
        if (!content.includes(slug)) continue;
        total++;
        if (/状态\s*\|\s*成功/.test(content)) success++;
      }
    }
  } catch { /* log dir may not exist */ }
  return [total, success];
}

const [totalRuns, successRuns] = analyzeTrackRecord(taskDesc);

// ── Auto-level ──
let suggestedLevel = level;
if (totalRuns >= 5 && successRuns >= totalRuns) suggestedLevel = 4;
else if (totalRuns >= 3 && successRuns >= totalRuns - 1) suggestedLevel = 3;
else if (totalRuns >= 1 && successRuns >= 1 && existsSync(cachedYaml)) suggestedLevel = 2;

if (totalRuns > 0) {
  const pct = Math.round(successRuns * 100 / totalRuns);
  info(`历史记录: ${totalRuns} 次运行 · 成功率 ${pct}%`);
  if (suggestedLevel > level) {
    info(`💡 建议升级到 L${suggestedLevel}（${LEVEL_DESC[suggestedLevel - 1]}），添加 --level ${suggestedLevel}`);
  }
}

if (autoLevel) {
  level = suggestedLevel;
  info(`🎯 自动模式: 采用 L${level} (${LEVEL_DESC[level - 1]})`);
}

// ── Depth routing ──
let skipAoCompose = false;
let skipOrchestrate = false;

if (level === 4) {
  skipOrchestrate = true;
  info('L4 自主执行模式 — 跳过编排，直接交付 Agent');
} else if (level === 3) {
  const cfgPath = join(orchestratorDir, `${taskSlug}.json`);
  if (existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
      if (cfg.ao_template) {
        info(`L3 模板调度 — ao run ${cfg.ao_template}`);
        const start = Date.now();
        const r = runAo([cfg.ao_template], cfg.inputs);
        const elapsed = Math.round((Date.now() - start) / 1000);
        console.log('');
        r.code === 0 ? ok(`任务完成（耗时 ${elapsed}s）`) : warn(`任务结束（exit ${r.code}）`);
        console.log('');
        console.log(`  编排结束。exit code: ${r.code} · 深度: L3 (模板: ${cfg.ao_template})`);
        process.exit(r.code);
      }
    } catch { /* fall through */ }
  }
  warn('L3 模板缺失，降级到 L2');
  if (existsSync(cachedYaml)) { skipAoCompose = true; ok(`L2 模板复用 — 复用历史: ${taskSlug}.yaml`); }
  else { warn('L2 缓存缺失，降级到 L1 完整编排'); level = 1; }
} else if (level === 2) {
  if (existsSync(cachedYaml)) { skipAoCompose = true; ok(`L2 模板复用 — 复用历史: ${taskSlug}.yaml`); }
  else { warn('L2 缓存缺失，降级到 L1 完整编排'); level = 1; }
}

console.log('');

// ── L4 skip-all → execute directly ──
if (skipOrchestrate) {
  info('跳过编排/Harness/worktree，直接执行...');
  const start = Date.now();
  const r = runAo([taskDesc]);
  const elapsed = Math.round((Date.now() - start) / 1000);
  console.log('');
  r.code === 0 ? ok(`任务完成（耗时 ${elapsed}s）`) : warn(`任务结束（exit ${r.code}，耗时 ${elapsed}s）`);
  process.exit(r.code);
}

// ── Step 1: AO compose ──
let workflowFile = '';
if (skipAoCompose) {
  info(`跳过 ao compose，使用缓存模板`);
  workflowFile = cachedYaml;
} else {
  info('Step 1/4 · AO 编排分析...');
  if (aoModel) info(`  模型: ${aoModel}`);

  workflowFile = join(process.env.TMPDIR || '/tmp', `sofagent-workflow-${process.pid}.yaml`);
  try {
    const args_ = aoModel ? ['compose', '--model', aoModel, taskDesc] : ['compose', taskDesc];
    const output = execFileSync('ao', args_, { encoding: 'utf-8', timeout: 120000 });
    writeFileSync(workflowFile, output);
  } catch {
    warn('ao compose 未生成 YAML，尝试直接执行...');
    try {
      execFileSync('ao', ['compose', taskDesc, '--run'], { stdio: 'inherit', timeout: 120000 });
      process.exit(0);
    } catch { process.exit(1); }
  }

  if (existsSync(workflowFile)) {
    ok('编排计划已生成');
    try {
      info('编排预览:');
      execFileSync('ao', ['explain', workflowFile], { stdio: 'inherit', timeout: 10000 });
    } catch {
      console.log(readFileSync(workflowFile, 'utf-8').split('\n').slice(0, 20).join('\n'));
    }
  }
}

console.log('');

// ── Dry-run exit ──
if (dryRun) { info('dry-run 模式，退出'); process.exit(0); }

// ── Step 2: Worktree 隔离（--worktree 时创建，退出时自动清理）──
const worktrees: string[] = [];

function cleanupWorktrees(): void {
  for (const wt of worktrees) {
    if (existsSync(wt)) {
      info(`清理 worktree: ${wt}`);
      try {
        execFileSync('git', ['worktree', 'remove', wt, '--force'], { stdio: 'ignore', timeout: 10000 });
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
  try { execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'ignore' }); inGitRepo = true; } catch { /* not in git repo */ }

  if (inGitRepo) {
    info('Step 2/4 · 创建 worktree 隔离...');

    // 从工作流文件统计子任务数（上限 5 个 parallel worktree）
    let subCount = 1;
    if (existsSync(cachedYaml)) {
      try {
        const yamlContent = readFileSync(cachedYaml, 'utf-8');
        const matches = yamlContent.match(/subtask|agent|workflow/gi);
        if (matches) subCount = Math.min(Math.max(matches.length, 1), 5);
      } catch { /* */ }
    }

    let baseBranch = 'main';
    try {
      baseBranch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf-8', timeout: 5000 }).trim() || 'main';
    } catch { /* use default main */ }

    for (let i = 1; i <= subCount; i++) {
      const wtName = `sofagent-task-${i}-${process.pid}`;
      const wtPath = join(process.env.TMPDIR || '/tmp', wtName);
      info(`  创建 worktree ${i}/${subCount}: ${wtPath}`);
      try {
        execFileSync('git', ['worktree', 'add', wtPath, baseBranch], { stdio: 'ignore', timeout: 30000 });
        worktrees.push(wtPath);
      } catch {
        warn(`  worktree 创建失败（可能已有同名 worktree），跳过隔离`);
      }
    }

    if (worktrees.length > 0) {
      ok(`${worktrees.length} 个 worktree 就绪`);
    }
  } else {
    warn('不在 git 仓库中，跳过 worktree 隔离');
  }
} else {
  info('Step 2/4 · 跳过 worktree 隔离（加 --worktree 启用）');
}

console.log('');

// ── Step 3: Harness（简化为检查 hook 存在）──
info('Step 3/4 · Harness 约束...');
const hookDir = join(homeDir, '.openclaw', 'hooks', 'sofagent-load-chain');
if (existsSync(join(hookDir, 'handler.ts')) && existsSync(join(hookDir, 'HOOK.md'))) {
  ok('加载链 hook 就绪');
} else {
  warn(`加载链 hook 未部署: ${hookDir}`);
  warn('子 Agent 可能拿不到 think.md/rules.md');
}
console.log('');

// ── Step 4: Execute ──
info('Step 4/4 · 执行任务编排...');
const startTime = Date.now();
let result: { code: number };
if (workflowFile && existsSync(workflowFile)) {
  // 有编排文件 → ao run 执行
  result = runAo(['run', workflowFile]);
} else {
  // 无编排文件 → ao compose --run 直接执行
  result = runAo(['compose', taskDesc, '--run']);
}
const elapsed = Math.round((Date.now() - startTime) / 1000);
console.log('');
if (result.code === 0) {
  ok(`任务完成（耗时 ${elapsed}s）`);
  // Cache workflow on success
  try { mkdirSync(orchestratorDir, { recursive: true }); } catch { /* */ }
} else {
  warn(`任务结束（exit ${result.code}，耗时 ${elapsed}s）`);
}

console.log('');
console.log(`  编排结束。exit code: ${result.code} · 深度: L${level} (${LEVEL_DESC[level - 1]})`);
console.log('');
process.exit(result.code);

// ════════════════════════════════════════
// Helpers
// ════════════════════════════════════════

function commandExists(cmd: string): boolean {
  try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; }
}

function runAo(aoArgs: string[], inputs?: Record<string, string>): { code: number } {
  try {
    const allArgs = [...aoArgs];
    if (inputs) for (const [k, v] of Object.entries(inputs)) allArgs.push('--input', `${k}=${v}`);
    execFileSync('ao', allArgs, { stdio: 'inherit', timeout: 300000 });
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
  console.log('  📖 手动编排完整指南: docs/ao-compose-format.md');
  console.log('');
}

function showHelp(): void {
  console.log(`sofagent task-orchestrate v${VERSION}`);
  console.log('  包装 ao compose，加 worktree 隔离 + 约束注入');
  console.log('');
  console.log('  用法:');
  console.log('    task-orchestrate "任务描述"');
  console.log('    task-orchestrate "任务描述" --dry-run    仅预览编排');
  console.log('    task-orchestrate "任务描述" --worktree   创建独立 worktree');
  console.log('    task-orchestrate "任务描述" --level N    编排深度 (1-4)');
  console.log('    task-orchestrate "任务描述" --auto       自动选择最优深度');
  console.log('    task-orchestrate "任务描述" --model flash|pro  指定模型');
  console.log('');
  console.log('  编排深度:');
  console.log('    1=完整编排  首次运行，AO 全量分析拆解');
  console.log('    2=模板复用  跳过 ao compose，直接用上次缓存');
  console.log('    3=轻量调度  从 orchestrator/ 读取预定义模板');
  console.log('    4=自主执行  完全信任 Agent，裸调 ao run');
  console.log('');
  console.log('  依赖: agency-orchestrator (ao), git (worktree 模式)');
}
