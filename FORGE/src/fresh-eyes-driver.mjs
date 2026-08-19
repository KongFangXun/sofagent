#!/usr/bin/env node
// ============================================================
// FORGE/src/fresh-eyes-driver.mjs · FORGE fresh-eyes-loop Driver
//
// 纯编排层：起子进程、传文件路径、判停止条件、写 LEDGER。
// 不审查、不修复、不读审查内容做语义判断。
//
// 用法：
//   node FORGE/src/fresh-eyes-driver.mjs --target v1.2.0 [--max-rounds 10] [--dry-run]
//
// 自 forks 为 worker：
//   node FORGE/src/fresh-eyes-driver.mjs --worker --step <step> --round-dir <abs> --target <ver>
//
// 模型配置抽取到 FORGE/models/（换模型只改 profile.mjs 一行）：
//   A/B/V 统一 GLM-5.2            智谱 Coding Plan 订阅制
//   双盲审查通过 A/B 不同 prompt 视角保证（a-check.md ≠ b-check.md），不依赖不同模型。
//   Qwen3.8-max（thinking-only）在工具循环中无法被约束，已弃用（run-07 验证）。
//   切换模型：编辑 FORGE/models/profile.mjs，改 import 和映射即可，不需要改本文件。
// ============================================================

import { spawn } from 'child_process';
import { createRequire } from 'module';
import {
  readFileSync, writeFileSync, mkdirSync, existsSync,
  appendFileSync, readdirSync, renameSync, statSync,
} from 'fs';
import { join, resolve, dirname, relative, sep, basename } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

// v1.2.7 功能⑤：继承 driver-base 公共编排层
import { createForgeDriverBase, runPreflight, formatPreflightReport, resolveMaxConcurrency, createConcurrencyDegrader, checkDriverLiveness } from './driver-base.mjs';

// 可见性：核心层 + 适配器（agent 无关 + 渐进适配）
import { createVisibility, EVENTS } from './visibility.mjs';

// v1.2.1 L2：SubAgent 内部可观测（工具调用序列 + 模型推理心跳）
// v1.2.4 新增 StallError 导出（watchdog 停顿检测错误类）
import { createProgressMiddleware, StallError } from './progress-middleware.mjs';

// v1.3.0 (交付 10 MA4)：FORGE worker 经验共享飞轮——FORGE_MEMORY_BACKEND
// 启用时 worker 启动前检索历史经验、完成后写入本次发现。
// 缺省 unset = 完全不变（与 v1.2.9 行为一致）。
import { memorySearch, memoryWrite, getMemoryBackendEndpoint } from './memory-client.mjs';

// 模块级引用——让 catch 块也能写可见性事件（失败场景覆盖）
let globalVisibility = null;

// 模块级快照——让 main().catch() 能保留已完成轮的数据，不清零。
// 🔴 v1.2.2 教训（run-07）：fatal-error 时 actualRounds/counts 归零，
// 导致 Round 1 的审查成果全部消失。
let preservedActualRounds = 0;
let preservedFinalCounts   = { p0: 0, p1: 0, p2: 0 };
// 模块级 latest.json 指针上下文——让 main().catch() 在 fatal-error 时也能更新指针
let preservedRunDir       = null;
let preservedStopReason   = null;
let preservedTotalRounds  = 0;
// v1.3.6 交付⑩：FORGE 隔离加固——worktree 隔离状态（run-07 事故根因修复）。
// driver 启动时在 runDir 内建 worktree 副本，worker 的 git 写入全落副本分支；
// run 结束（正常/异常/中止）teardown 清理，主仓 git status 全程干净。
// worker 子进程通过 FORGE_WORKTREE_ROOT 环境变量继承隔离副本路径（spawn 时注入）。
let globalWorktree = process.env.FORGE_WORKTREE_ROOT
  ? { worktreeDir: process.env.FORGE_WORKTREE_ROOT }
  : null;

// 安全 teardown——所有退出路径（正常/catch/uncaughtException）共用。
// 绝不抛错：teardown 自身失败只打日志，不掩盖原始退出原因。
function safeTeardownWorktree() {
  if (!globalWorktree || !preservedRunDir) return;
  try {
    const r = base.teardownWorktree(preservedRunDir);
    if (r.removed) console.log(`   worktree 清理 = 已移除（分支 ${r.branch ?? ''} 保留待人工回流）`);
  } catch (err) {
    console.warn(`   worktree 清理失败（不阻塞退出）: ${err.message}`);
  } finally {
    globalWorktree = null;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = resolve(__dirname, '../..');

// CJS interop — dist 产物是 CommonJS，.mjs 里用 createRequire 导入
const require = createRequire(import.meta.url);

// ─── 路径常量 ────────────────────────────────────────────────
const LOOP_DIR    = join(REPO_ROOT, 'FORGE/SKILL/fresh-eyes-loop');
const PROMPTS_DIR = join(LOOP_DIR, 'prompts');
// v1.2.1 安装路径分离：runs 输出优先到 SOFAGENT_HOME/data/forge-runs/，
// fallback 到仓库内 data/forge-runs/（开发模式兼容）
const SOFAGENT_HOME = process.env.SOFAGENT_HOME || join(os.homedir(), '.sofagent');
const RUNS_DIR    = join(SOFAGENT_HOME, 'data', 'forge-runs');
const LEDGER_PATH = join(REPO_ROOT, 'FORGE/LEDGER.md');
const AGENTS_DIR  = join(REPO_ROOT, 'SKILL/agents');

// A/B/V 统一 GLM-5.2 Coding Plan，共用 GLM_API_KEY。
// 双盲审查通过 A/B 不同 prompt 视角保证，不依赖不同模型。
// key 跟模型走——模型文件标注 apiKeyEnv，profile.mjs 引用时自动继承。
// ─── 模型配置（从 FORGE/models/ 加载，换模型改 profile.mjs 即可）─────────────
import { resolveConfigs, resolvePricing } from '../models/index.mjs';
const MODEL_CONFIGS = resolveConfigs(AGENTS_DIR);

// ─── 三层熔断阈值（模块级常量，避免散落在不同函数作用域） ──────────
// 三层防线协同设计（run-01/run-02 事故修复）：
//   L1 软熔断(TOOL_SOFT_LIMIT)：stateModifier 注入 HumanMessage 强制收尾
//   L2 硬熔断(TOOL_HARD_LIMIT)：stream 循环物理 break，抢救部分产物
//   L3 框架兜底(STEP_RECURSION_LIMITS)：LangGraph recursionLimit 最终防线
//
// v1.2.7 run-06 教训（2026-08-05）：TOOL_SOFT_LIMIT=60 / TOOL_HARD_LIMIT=80 时，
// GLM-5.2 在审查步骤调 60+ 次工具不收敛——软熔断注入的"别调工具了"HumanMessage
// 被无视，因为 tools 数组仍在，模型有工具可调就继续调。
// v1.2.7 修复（2026-08-05）：大幅收紧工具预算 + 缩短写报告窗口。
//   审查步骤（a-check/b-check）的核心任务是在 12 个视角里 grep+cat 文件，
//   每个视角约 2-3 次工具调用 = 24-36 次。35 次软上限给足取证空间，
//   45 次硬上限 + 15 步窗口确保模型收敛写报告。
//   recursionLimit 500→300：原值给的空间太大反而让模型不收敛。
const TOOL_SOFT_LIMIT  = 35;   // stateModifier：超此值注入"立即写报告"HumanMessage
const TOOL_HARD_LIMIT  = 45;   // stream loop：超此值进入"写报告窗口"
// 审查类步骤（a-check/b-check）探索深度高（12 视角 × 2-3 文件），需要时间切换到报告模式
// 修复/验证类步骤（b-fix/a-verify）是有限任务，5 步够用
// v1.2.7 run-07 教训（2026-08-05）：GLM-5.2 和 Qwen3.8-max 在写报告窗口内
// 都继续调工具（HumanMessage 对有 tools 可用的模型无物理约束力）。
// 窗口给了 15 步反而浪费 15 次工具调用的消息累积 → OOM 风险。
// 改为零窗口——撞硬上限立即 break，直接走 generateReportWithoutTools。
const REVIEW_GRACE_STEPS  = 0;   // 审查步骤写报告窗口（0=撞硬上限立即中断）
const DEFAULT_GRACE_STEPS = 0;   // 其他步骤同上
// v1.3.2 preflight-check：perspective worker 工具预算提取为模块级常量，
// 供 preflight 预算合理性检查引用。
// v1.3.4 run-01 调优（2026-08-14）：15/20 → 40/50。根因：零窗口模式下 20 次
// 工具调用连 2870 文件 monorepo 的结构都摸不完，24 个 worker 全部撞硬熔断后
// 走裸 LLM 兜底，拿着碎片上下文补全报告 → 审查臆造（"automerge 排期升级"
// 等无中生有的 finding）→ b-fix 基于臆造越界改文件。40/50 保证单视角有
// 充裕预算完成"摸地形 → 定点审查 → 输出报告"全流程。
const PERSPECTIVE_TOOL_SOFT = 40;
const PERSPECTIVE_TOOL_HARD = 50;

// ─── 模型定价（从 FORGE/models/ 加载）──────────────────────
// 单位：CNY per 1M tokens（百万 token 计价）
//
// ⚠️ 计费模式区分（2026-08-03 确认）：
//   A (qwen3.8-max) = 阿里百炼 Token Plan 订阅制 → 不按 token 计价。
//   B (glm-5.2) = 智谱 Coding Plan 订阅制 → 不按 token 计价。
//   订阅制按周期固定付费，与 token 消耗无关，因此 MODEL_PRICING 的按 token
//   成本估算对订阅账号意义有限，仅供参考。
//   recordUsage 的 billing === 'subscription' 分支输出 cost_cny = null，不硬凑按量成本。
//
// ⚠️ 这是「估算」不是「账单」：
//   即便是按量计费模型，官方标价 ≠ 实际扣费。缓存命中率、账号促销、
//   套餐折扣都会影响最终费用。driver 算出的 cost_cny 仅供成本感知
//   （「这轮大概花了多少」），真实账单请到各厂商 API 后台查看。
const MODEL_PRICING = resolvePricing();

// ─── driver-base 公共编排层实例 ──────────────────────────
// v1.2.7 功能⑤：继承 driver-base，复用公共工具函数。
// fresh-eyes-driver 保留自身的差异化逻辑（多轮循环、并行 worker、分片执行、
// 停止判定、StallError 重试），公共工具函数（sliceMultiOutput 等）从 base 复用。
const base = createForgeDriverBase({
  driverName: 'fresh-eyes',
  loopDir: LOOP_DIR,
  repoRoot: REPO_ROOT,
  modelConfigs: MODEL_CONFIGS,
  modelPricing: MODEL_PRICING,
});

// ─── 步骤定义（role / prompt / output / extraInputs / maxTokens）────────
// v1.2.9 功能①：FORGE Driver 短任务化——12 视角拆分为 24 个独立 worker（A/B 各 12）。
//
// 改造动机：
//   原 a-check/b-check 各是一个 worker，单 worker 要在 35 次工具预算内跑完 12 个
//   视角（平均每视角 3 次），容易撞硬熔断导致碎片报告。短任务化后每个视角独立
//   worker（recursionLimit=30, toolSoftLimit=12, toolHardLimit=15），单视角
//   工具预算充裕，报告质量大幅提升。
//
// STEPS 动态生成：A 侧 12 个 perspective worker + B 侧 12 个 perspective worker
// + a-consolidate 合并 24 份报告 + b-fix/b-audit/a-verify 不变。

/**
 * v1.2.9 功能①：fresh-eyes 审查的 12 个视角定义。
 * 每个视角对应 playbook/fresh-eyes-review.md 中的一个审查身份。
 * A/B 各跑一遍（双盲），合计 24 个独立 perspective worker。
 */
const PERSPECTIVES = [
  { id: 1,  name: 'stranger',        label: '陌生人' },
  { id: 2,  name: 'enterprise-it',   label: '企业 IT' },
  { id: 3,  name: 'competitor',      label: '竞品' },
  { id: 4,  name: 'npm-user',        label: 'npm 用户' },
  { id: 5,  name: 'reviewer',        label: '开源审查员' },
  { id: 6,  name: 'journey',         label: '用户旅程' },
  { id: 7,  name: 'red-team',        label: '红队' },
  { id: 8,  name: 'detective',       label: '数字侦探' },
  { id: 9,  name: 'perception',      label: '感知层' },
  { id: 10, name: 'doc-consistency', label: '文档一致性' },
  { id: 11, name: 'code-reader',     label: '代码审读者' },
  { id: 12, name: 'file-stranger',   label: '文件结构陌生人' },
];

/**
 * 动态生成 A 侧 perspective 步骤（a-check-p1 ~ a-check-p12）。
 * 每个 perspective worker 的配置：
 *   - prompt: a-check-perspective-N.md（N = perspective.id）
 *   - outputs: ['check-a-pN.md']
 *   - recursionLimit: 30（短任务——单视角只需读 2-3 个文件）
 *   - toolSoftLimit: 15, toolHardLimit: 20
 */
function buildPerspectiveSteps() {
  const steps = {};
  for (const p of PERSPECTIVES) {
    steps[`a-check-p${p.id}`] = {
      role: 'A',
      prompt: `a-check-perspective-${p.id}.md`,
      outputs: [`check-a-p${p.id}.md`],
      inputs: [],
      perspective: p.label,
      // v1.3.4：预算 15/20→40/50 后 recursionLimit 同步放大（30→110）。
      // LangGraph recursionLimit 按 super-step 计：每轮 LLM 调用+工具执行 = 2 步，
      // 50 次工具调用至少需 100 步，+10 冗余。原 30 会在工具预算用完前先熔断。
      recursionLimit: 110,
      toolSoftLimit: PERSPECTIVE_TOOL_SOFT,
      toolHardLimit: PERSPECTIVE_TOOL_HARD,
    };
    steps[`b-check-p${p.id}`] = {
      role: 'B',
      prompt: `b-check-perspective-${p.id}.md`,
      outputs: [`check-b-p${p.id}.md`],
      inputs: [],
      perspective: p.label,
      recursionLimit: 110,
      toolSoftLimit: PERSPECTIVE_TOOL_SOFT,
      toolHardLimit: PERSPECTIVE_TOOL_HARD,
    };
  }
  return steps;
}

const STEPS = {
  // v1.2.9 功能①：A/B 各 12 个 perspective worker（短任务化）
  ...buildPerspectiveSteps(),
  // a-consolidate 合并 24 份 perspective 报告（A 侧 12 + B 侧 12）
  // maxTokens：步骤级输出 token 上限覆盖。未定义时回退到 MODEL_CONFIGS[role].maxTokens。
  // a-consolidate 需合并 A/B 两份完整 12 视角报告为单份 findings，输出超长，
  // 单独调高到 32000，避免顶格 16000 被截断生成不了合法 result.md（整轮降级根因）。
  // v1.3.0 run-21 修复：a-consolidate 必须读 24 份 check 报告（inputs 只注入路径，
  // 内容仍需 sf_read），工具调用天然 40-60 次，撞全局 45 硬熔断后裸 LLM 兜底产物
  // 缺 ===FILE: 分隔符 → result.md 判空 → b-fix 跳过 → 假绿停止（run-21 3 轮全丢）。
  // 单独提高预算：check worker 已有 12/15 覆盖（不受影响），不重蹈 run-06 全局 60/80 覆辙。
  'a-consolidate': {
    role: 'A',
    prompt: 'a-consolidate.md',
    outputs: ['findings.md', 'result.md'],
    inputs: PERSPECTIVES.flatMap(p => [`check-a-p${p.id}.md`, `check-b-p${p.id}.md`]),
    maxTokens: 32000,
    toolSoftLimit: 60,
    toolHardLimit: 80,
  },
  'b-fix':         { role: 'B', prompt: 'b-fix.md',         outputs: ['summary.md'],             inputs: ['result.md','findings.md'] },
  // v1.2.8 功能⑥：b-audit 步骤——b-fix 改完代码后 driver 自动跑 sofagent-audit
  'b-audit':       { role: null, prompt: null,              outputs: ['audit-result.md'],        inputs: [], driverFn: 'runAuditGate' },
  'a-verify':      { role: 'A', prompt: 'a-verify.md',      outputs: ['result.md'],              inputs: ['findings.md','result.md','summary.md'] },
};

/**
 * v1.2.9 功能①：spawnParallel 并发限制。
 * 24 个 perspective worker 同时启动会触发 API rate limit（GLM Coding Plan
 * 并发上限）。分批执行：N 个一批，全部完成后启动下一批。
 *
 * v1.3.7 ⑦ 自适应并发：不再写死 2——resolveMaxConcurrency() 三级来源解析
 * （显式 CLI/env > os.totalmem() 预算表自适应 > 兜底 1）。8GB 机器自动取 1
 * （防 OOM），16GB+ 机器按预算表提升吞吐。运行中 worker SIGKILL（OOM）时
 * 经 createConcurrencyDegrader 熔断降级（本批剩余串行，连续 2 批回退 1）。
 */
const CONCURRENCY_RESOLVED = resolveMaxConcurrency({ defaultConcurrency: 1 });
const MAX_CONCURRENCY = CONCURRENCY_RESOLVED.concurrency;
// v1.3.7 ⑦ OOM 保险丝：批次内 worker 被信号杀死 → 降级器接管后续批次并发
const concurrencyDegrader = createConcurrencyDegrader(MAX_CONCURRENCY);

// ═══════════════════════════════════════════════════════════
//  CLI 参数解析
// ═══════════════════════════════════════════════════════════
function parseArgs(argv) {
  const args = { target: null, maxRounds: 10, dryRun: false,
                 worker: false, step: null, roundDir: null,
                 resume: false, checkAlive: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target')           args.target    = argv[++i];
    else if (a === '--max-rounds')  args.maxRounds = parseInt(argv[++i], 10);
    else if (a === '--dry-run')     args.dryRun    = true;
    else if (a === '--worker')      args.worker    = true;
    else if (a === '--step')        args.step      = argv[++i];
    else if (a === '--round-dir')   args.roundDir  = argv[++i];
    // v1.2.8 功能⑦：断点续跑（参数名与 driver-base.parseDriverArgs / release-gate 保持一致）
    else if (a === '--resume')      args.resume    = true;
    // v1.3.8 交付五：liveness 探针——只认 status.json 心跳不认日志
    else if (a === '--check-alive') args.checkAlive = argv[++i];
  }
  return args;
}

// ═══════════════════════════════════════════════════════════
//  Worker 模式 — 在独立子进程内执行单个步骤
// ═══════════════════════════════════════════════════════════

/**
 * 从 SKILL.md 构建 systemPrompt（复用 builtin-agents 的 parseSkillMd 逻辑）。
 * dist 里没导出 parseSkillMd，这里内联精简版：剥离 frontmatter、提取身份标签。
 */
function buildSystemPrompt(skillPath) {
  const raw = readFileSync(skillPath, 'utf-8');
  const parts = raw.split('---');
  if (parts.length < 3) return raw.trim();
  const fm = parts[1];
  const body = parts.slice(2).join('---').trim();
  const val = (k) => (fm.match(new RegExp(`^${k}:\\s*(.*)`, 'm')) ?? [])[1]?.trim() ?? '';
  const header = [
    `[Agent: ${val('name')}]`,
    val('description') ? `[描述: ${val('description')}]` : '',
    val('triggers') ? `[触发条件: ${val('triggers')}]` : '',
  ].filter(Boolean).join('\n');

  // macOS BSD 工具约束——GLM/DeepSeek 常用 Linux 语法导致命令报错，
  // 浪费 recursionLimit 步数在重试错误命令上。
  // run-05 教训：GLM-5.2 用 150 步限额全浪费在 sed/openssl 报错重试上导致崩溃。
  const shellConstraints = [
    '',
    '## 🔴 铁律：macOS BSD 工具约束（违反必崩）',
    '',
    '你在 macOS 上运行，shell 是 BSD 版本，**不是 GNU/Linux**。以下命令在此环境会报错：',
    '- `grep -P` → 不存在，用 `grep -E`',
    '- `sed --version` / `sed -V` → 不存在，`sed -i` 必须带后缀 `sed -i ""`',
    '- `openssl --version` / `openssl -V` → 用 `openssl version`（无横杠）',
    '- `cat -A` → 用 `cat -v` 或 `od -c`',
    '- `stat --format` → 用 `stat -f`',
    '- `readlink -f` → 用 `python3 -c "import os; print(os.path.realpath(\'...\'))`"',
    '- `<(...)` process substitution → 不支持',
    '',
    '**铁律：命令报错时立即换方案或跳过，禁止用相同语法重试。**',
    '你已经浪费了大量步数在 BSD 命令报错上——从现在起，任何命令第一次报错就放弃该路径。',
  ].join('\n');

  // v1.2.5：工具调用预算——防止 worker 陷入"找不到文件→换路径再找"的死循环，
  // 最终撞上 LangGraph recursionLimit 导致零产出崩溃。
  // run-01 教训：A worker 调了 1119 次工具仍未收敛写报告，GraphRecursionError 终止整个循环。
  // run-07 教训：v1.2.6 大版本审查，60 次预算不够取证，提到 200 次。
  const toolBudget = [
    '',
    '## 🔴 铁律：工具调用预算（超限必崩）',
    '',
    '你有**最多 100 次工具调用**的硬预算。超过后进程会被强制终止，你写不出任何报告。',
    '',
    '**节奏要求**：',
    '- 第 1-70 次：自由探索（读文件、跑命令、搜索）',
    '- 第 70-85 次：停止探索新方向，整理已发现的问题，准备写报告',
    '- 第 85-100 次：写报告，把发现写入产物文件',
    '',
    '**禁止行为**：',
    '- 禁止对同一个文件用不同路径反复 cat（`No such file` = 不存在，记下来继续）',
    '- 禁止对同一问题反复验证（验证一次够用，进入下一个）',
    '- 禁止"我再看看"式的无效探索——你已经知道得够多了，去写报告',
    '',
    '**铁律：`No such file or directory` = 该文件不存在。记录为"缺失"，立即继续，禁止换路径重试。**',
  ].join('\n');

  return header + '\n\n' + body + shellConstraints + toolBudget;
}

/**
 * 为指定角色创建 LLM 模型实例。
 *
 * 模型配置从 FORGE/models/ 加载（profile.mjs 定义角色→模型映射）。
 * 当前配置：A = Qwen3.8-max（阿里百炼 Token Plan），B = GLM-5.2（智谱 Coding Plan）。
 * 换模型只改 FORGE/models/profile.mjs，不需要改 driver 代码。
 *
 * Qwen3.8-max 是 thinking-only 模型——始终思考、无法关闭，
 * 不需要传 thinking/reasoningEffort 参数：MODEL_CONFIGS.A 未定义这两个字段，
 * 下方条件注入分支（cfg.thinking / cfg.reasoningEffort）天然不会触发。
 *
 * GLM-5.2 支持 thinking + reasoning_effort 参数：MODEL_CONFIGS.B 定义了
 * thinking={type:'enabled'} + reasoningEffort='max' + temperature=1.0，
 * 下方条件注入分支会自动带上这些参数。
 *
 * @param {string} role              角色 'A' / 'B'
 * @param {number} [maxTokensOverride]  步骤级输出 token 上限覆盖（如 a-consolidate
 *                                      需合并两份完整报告，输出超长，单独调高）。
 *                                      未传时回退到 MODEL_CONFIGS[role].maxTokens。
 */
async function createModel(role, maxTokensOverride) {
  const cfg = MODEL_CONFIGS[role];
  const apiKey = process.env[cfg.apiKeyEnv];
  if (!apiKey) {
    throw new Error(`环境变量 ${cfg.apiKeyEnv} 未设置（角色 ${role}）`);
  }

  const { ChatOpenAI } = await import('@langchain/openai');

  const ctorArgs = {
    modelName: cfg.model,
    configuration: { baseURL: cfg.baseURL },
    apiKey: apiKey,           // @langchain/openai >=1.x 主参数名
    openAIApiKey: apiKey,     // 旧版 alias（向后兼容）
    // v1.3.7 run-28 修复：LLM 超时保护（同 driver-base createModelFromConfig）——
    // 网络抖断时 fetch 无限挂死，driver 失联被回收（run-27/28 连续两死）
    timeout: 600_000,
    maxRetries: 2,
  };

  // GLM-5.2 参数：temperature（推荐 1.0）
  if (cfg.temperature !== undefined) {
    ctorArgs.temperature = cfg.temperature;
  }

  // 限制输出 token（防止 thinking 模式无限消耗）
  // 步骤级覆盖优先（如 a-consolidate 合并双份完整报告需 32000），否则用角色默认值
  const effectiveMaxTokens = maxTokensOverride ?? cfg.maxTokens;
  if (effectiveMaxTokens) {
    ctorArgs.maxTokens = effectiveMaxTokens;
  }

  // GLM-5.2 / DeepSeek 特殊参数（thinking + reasoningEffort）
  if (cfg.reasoningEffort) {
    ctorArgs.reasoningEffort = cfg.reasoningEffort;
  }
  if (cfg.thinking) {
    // modelKwargs 会原样透传到 API 请求 body
    ctorArgs.modelKwargs = { thinking: cfg.thinking };
  }

  try {
    return new ChatOpenAI(ctorArgs);
  } catch (err) {
    if (role === 'B' && cfg.thinking) {
      // 退化：去掉 thinking 再试（reasoning_effort 大概率被支持）
      console.warn(`[fresh-eyes] ChatOpenAI 不接受 thinking 参数，退化仅用 reasoningEffort: ${err.message}`);
      delete ctorArgs.modelKwargs;
      return new ChatOpenAI(ctorArgs);
    }
    throw err;
  }
}

/**
 * 从 dist 导入工具集（ENGINEER_TOOLS / REVIEWER_TOOLS）。
 * dist 是 CJS，createRequire 导入后直接解构。
 */
/**
 * 加载工具集并转换为 DeepAgents 兼容格式。
 *
 * dist/tools.js 里的工具是手写 ExecutableTool（{name, description, schema, func}），
 * 但 deepagents 的 ToolNode 期望 tool() 函数创建的 DynamicStructuredTool。
 * 直接用 ExecutableTool 会触发 "Cannot read properties of undefined (reading 'length')"
 * （ToolNode 的 wrapToolCall 把 func 返回的字符串当数组处理）。
 *
 * 这里加转换层：ExecutableTool → DynamicStructuredTool（通过 @langchain/core/tools 的 tool()）。
 *
 * v1.2.1 L2：可选第二参数 progressMw（ProgressMiddleware）——传入后每个
 * 工具的 func 经 wrapToolCall 包裹，agent 的每次工具调用都写
 * start/end 事件到 sub-progress-<role>.jsonl。middleware 内部容错，
 * 观测失败绝不影响工具执行（与 L1 visibility 容错策略一致）。
 */
// ─── 工具输出截断（v1.2.5 性能优化 → v1.2.8 功能③：迁移到统一中间件）──
// v1.2.8：truncateToolOutput 从 tool-output-budget.mjs 统一导入，
// 不再在此文件内联定义。删除旧实现 L317-349。
import { truncateToolOutput, createToolOutputBudget, DEFAULT_BUDGET as TOOL_OUTPUT_MAX_LINES } from './tool-output-budget.mjs';

function loadTools(role, progressMw = null, auditMw = null) {
  const cfg = MODEL_CONFIGS[role];
  const toolsModule = require('../../engine/orchestrator/dist/tools.js');
  const rawTools = toolsModule[cfg.toolsKey];
  if (!rawTools) {
    throw new Error(`工具集 ${cfg.toolsKey} 未在 dist/tools.js 中找到`);
  }

  // 转换：ExecutableTool → DynamicStructuredTool
  // 用 @langchain/core/tools 的 tool() 函数包装
  const { tool } = require('@langchain/core/tools');
  const { z } = require('zod');

  return rawTools.map((rawTool) => {
    // 如果已经是 DynamicStructuredTool（有 lc_namespace），直接用
    if (rawTool.lc_namespace) return rawTool;

    // ExecutableTool → 转换 schema（JSON Schema → zod 简化版）
    // 注意：deepagents 的 schema 用 JSON Schema 格式，zod 需要转。
    // 这里用 z.object + z.string() 做最小转换（当前所有工具的参数都是 string 类型）。
    const properties = rawTool.schema?.properties || {};
    const zodShape = {};
    const requiredFields = rawTool.schema?.required || [];

    for (const [key, prop] of Object.entries(properties)) {
      let zodField;
      // 根据类型选 zod 校验器
      if (prop.type === 'string') {
        zodField = z.string();
      } else if (prop.type === 'number' || prop.type === 'integer') {
        zodField = z.number();
      } else if (prop.type === 'boolean') {
        zodField = z.boolean();
      } else {
        zodField = z.string();  // fallback
      }
      if (prop.description) zodField = zodField.describe(prop.description);
      if (!requiredFields.includes(key)) zodField = zodField.optional();
      zodShape[key] = zodField;
    }

    const wrappedTool = tool(
      async (input) => {
        // v1.3.0 (交付 1)：运行时审计 tool wrapper——audit 检查在最外层，
        // FAIL 拦截优先于 progress 埋点（被拦截的工具不执行、不埋 start/end）。
        if (auditMw) {
          const verdict = auditMw.check(rawTool.name, input ?? {});
          if (verdict?.blocked) {
            return `⛔ [Audit 拦截] ${rawTool.name} 被拒绝执行：${verdict.reason}`;
          }
        }

        // v1.2.1 L2：工具调用埋点（start → handler → end，含 duration）
        // v1.2.5：工具输出截断——超过 200 行的输出只保留头尾，防止上下文膨胀
        // v1.3.1 P0-1 修复：run_bash 强制在 REPO_ROOT 执行——worker 模型经常
        // 自己写 `cd /Users/<拼错用户名>/...` 导致 cwd 错误、bash 大面积失效。
        // 修复：① 剥离命令开头错误的 cd 前缀 ② 用 execSync 注入 cwd=REPO_ROOT。
        // v1.3.6 交付⑩：worktree 隔离——globalWorktree 存在时 cwd 切到副本，
        // worker 的 git 写入（含红队模拟恶意 commit）全部落在隔离分支上，主仓零污染。
        const execFn = async () => {
          let raw;
          if (rawTool.name === 'run_bash') {
            const cmd = String((input && input.command) ?? '');
            // 剥离开头 `cd <路径>` 或 `cd <路径> && ...` 前缀（模型常拼错用户名路径）
            // 🔴 v1.3.1 P0-1 修复（正则修正）：分隔符须匹配 && || ; |（含多字符）
            const stripped = cmd.replace(/^cd\s+("([^"]*)"|'([^']*)'|\S+)(\s*(?:&&|\|\||;|\|)\s*)?/, '');
            const { execSync } = await import('child_process');
            try {
              const stdout = execSync(stripped, {
                encoding: 'utf-8',
                maxBuffer: 16 * 1024 * 1024,
                timeout: 60_000,
                cwd: (globalWorktree && globalWorktree.worktreeDir) || REPO_ROOT,
              });
              raw = stdout || '(命令执行完成，无 stdout 输出)';
            } catch (err) {
              const e = err || {};
              const stderr = e.stderr ? (typeof e.stderr === 'string' ? e.stderr : e.stderr.toString()) : '';
              raw = `命令执行失败（exit ${e.status ?? '?'}）：${e.message ?? ''}\n${stderr}`;
            }
            if (cmd !== stripped) {
              raw = `[已自动剥离 cd 前缀，在项目根目录执行]\n${raw}`;
            }
          } else {
            raw = await rawTool.func(input);
          }
          return truncateToolOutput(raw);
        };
        if (progressMw) {
          return await progressMw.wrapToolCall(
            { tool: rawTool.name, args: input },
            execFn,
          );
        }
        return await execFn();
      },
      {
        name: rawTool.name,
        description: rawTool.description,
        schema: z.object(zodShape),
      }
    );

    return wrappedTool;
  });
}

/**
 * 从 DeepAgent invoke 结果中提取 usage 数据（多级 fallback）。
 *
 * DeepAgents 返回格式不固定，尝试以下路径：
 *   1. result.usage
 *   2. result.llmResult?.usage
 *   3. result.messages[-1].usage_metadata
 *   4. result.messages[-1].response_metadata?.token_usage
 *
 * @param {object} result  DeepAgent invoke 返回值
 * @returns {{ prompt_tokens:number, completion_tokens:number, total_tokens:number } | null}
 */
function extractUsage(result) {
  // Path 1: result.usage
  if (result?.usage) {
    const u = result.usage;
    const pt = u.prompt_tokens ?? u.input_tokens ?? 0;
    const ct = u.completion_tokens ?? u.output_tokens ?? 0;
    return { prompt_tokens: pt, completion_tokens: ct, total_tokens: u.total_tokens ?? (pt + ct) };
  }

  // Path 2: result.llmResult.usage
  if (result?.llmResult?.usage) {
    const u = result.llmResult.usage;
    const pt = u.prompt_tokens ?? u.input_tokens ?? 0;
    const ct = u.completion_tokens ?? u.output_tokens ?? 0;
    return { prompt_tokens: pt, completion_tokens: ct, total_tokens: u.total_tokens ?? (pt + ct) };
  }

  // Path 3: result.messages[-1].usage_metadata (LangChain 格式)
  if (result?.messages?.length > 0) {
    const last = result.messages[result.messages.length - 1];
    if (last?.usage_metadata) {
      const u = last.usage_metadata;
      const pt = u.input_tokens ?? u.prompt_tokens ?? 0;
      const ct = u.output_tokens ?? u.completion_tokens ?? 0;
      return { prompt_tokens: pt, completion_tokens: ct, total_tokens: u.total_tokens ?? (pt + ct) };
    }
    // Path 4: result.messages[-1].response_metadata.token_usage (OpenAI 格式)
    if (last?.response_metadata?.token_usage) {
      const u = last.response_metadata.token_usage;
      const pt = u.prompt_tokens ?? 0;
      const ct = u.completion_tokens ?? 0;
      return { prompt_tokens: pt, completion_tokens: ct, total_tokens: u.total_tokens ?? (pt + ct) };
    }
  }

  return null;
}

/**
 * 记录单次 invoke 的 usage 到 runDir/usage.jsonl。
 *
 * 从 DeepAgent result 提取 usage（多级 fallback），算成本，追加到 jsonl。
 * 如果 API 未返回 usage，记 usage: null（不静默丢弃）。
 *
 * @param {string} runDir     本次 run 的根目录
 * @param {string} step       步骤名（如 'a-check'）
 * @param {number} round      轮次（从 1 开始）
 * @param {string} role       角色 'A' 或 'B'
 * @param {string} model      模型名（如 'deepseek-v4-flash'）
 * @param {object} result     DeepAgent invoke 返回值
 * @param {number} latencyMs  本次 invoke 耗时（毫秒）
 * @param {string} target     审查目标版本号
 */
function recordUsage(runDir, step, round, role, model, result, latencyMs, target) {
  const usagePath = join(runDir, 'usage.jsonl');
  const pricing = MODEL_PRICING[model];
  const usage = extractUsage(result);

  // 根据 model 名反查 billing 模式
  let billing = 'pay-as-you-go';
  for (const [roleKey, cfg] of Object.entries(MODEL_CONFIGS)) {
    if (cfg.model === model) { billing = cfg.billing; break; }
  }

  let record;
  if (usage) {
    // 成本计算分流（按 billing 模式）：
    //   subscription → cost = null，不适用按量计价
    //   pay-as-you-go + 有 pricing → 按 token 估算
    //   pay-as-you-go + 无 pricing → cost = null，无法估算
    let cost = null;
    let priceConfidence;
    if (billing === 'subscription') {
      cost = null;
      priceConfidence = 'subscription';
    } else if (pricing) {
      cost = ((usage.prompt_tokens / 1_000_000) * pricing.input +
             (usage.completion_tokens / 1_000_000) * pricing.output);
      priceConfidence = 'estimated';
    } else {
      cost = null;
      priceConfidence = 'no-pricing';
    }

    record = {
      ts:                 new Date().toISOString(),
      target:             target,
      round:              round,
      step:               step,
      role:               role,
      model:              model,
      prompt_tokens:      usage.prompt_tokens,
      completion_tokens:  usage.completion_tokens,
      total_tokens:       usage.total_tokens,
      cost_cny:           cost,
      price_confidence:   priceConfidence,
      latency_ms:         latencyMs,
    };
  } else {
    // API 未返回 usage → 不静默丢弃，记 null
    record = {
      ts:                 new Date().toISOString(),
      target:             target,
      round:              round,
      step:               step,
      role:               role,
      model:              model,
      usage:              null,
      note:               'API 未返回 usage 字段',
      latency_ms:         latencyMs,
    };
  }

  appendFileSync(usagePath, JSON.stringify(record) + '\n', 'utf-8');
}

/**
 * Worker 主逻辑：读 prompt → 建 model+tools → invoke → 写产物。
 */
async function runWorker(step, roundDir, target) {
  const stepDef = STEPS[step];
  if (!stepDef) throw new Error(`未知步骤: ${step}`);

  const role = stepDef.role;
  const cfg  = MODEL_CONFIGS[role];

  // 从环境变量读取轮次号（由 spawnWorker 通过 FORGE_ROUND 注入）
  const round = parseInt(process.env.FORGE_ROUND || '0', 10);

  // worker-alive 戳：每 30s 写时间戳到 roundDir，事后可区分「driver 死（戳还在跳）
  // vs「整树死（戳同停）」——SIGKILL 下 driver/worker 都来不及写终态，这是唯一的
  // 尸检证据。finally 清理定时器，戳文件本身保留供取证。
  const workerAlivePath = join(roundDir, 'worker-alive.json');
  const workerAliveTimer = setInterval(() => {
    try {
      writeFileSync(workerAlivePath, JSON.stringify({
        step, pid: process.pid, ts: new Date().toISOString(),
      }) + '\n');
    } catch { /* 戳写失败不中断 worker 主流程 */ }
  }, 30_000);
  // 首跑立即写一次（否则最早 30s 内无戳）
  try {
    writeFileSync(workerAlivePath, JSON.stringify({
      step, pid: process.pid, ts: new Date().toISOString(),
    }) + '\n');
  } catch { /* 同上 */ }


  // 1. 构建 systemPrompt
  const systemPrompt = buildSystemPrompt(cfg.agentSkillPath);

  // 2. 读 prompt 正文
  const promptTemplate = readFileSync(join(PROMPTS_DIR, stepDef.prompt), 'utf-8');

  // 3. 组装 user message：prompt 正文 + 路径注入 + target 注入
  // 分片模式：环境变量 FORGE_BATCH_RESULT 覆盖 result.md 的文件名，
  // FORGE_CUSTOM_OUTPUT 覆盖输出文件名（如 summary-batch-1.md / result-verified-batch-1.md）。
  const batchResultName = process.env.FORGE_BATCH_RESULT || '';
  const customOutputName = process.env.FORGE_CUSTOM_OUTPUT || '';

  const inputPaths = stepDef.inputs
    .map(f => {
      const actualFile = (batchResultName && f === 'result.md') ? batchResultName : f;
      return `  - ${join(roundDir, actualFile)}`;
    })
    .join('\n');
  const outputPaths = stepDef.outputs
    .map(f => {
      // 分片模式：FORGE_CUSTOM_OUTPUT 覆盖首个输出文件名
      // b-fix: summary.md → summary-batch-1.md
      // a-verify: result.md → result-verified-batch-1.md
      const actualFile = (customOutputName && f === stepDef.outputs[0]) ? customOutputName : f;
      return `  - ${join(roundDir, actualFile)}`;
    })
    .join('\n');

  // 多产物步骤：注入分隔符约定（driver 按此切片分别写入文件）
  const multiOutputHint = stepDef.outputs.length > 1
    ? stepDef.outputs.map(f => `===FILE: ${f}===\n<${f} 正文>`).join('\n\n')
    : '';

  // v1.3.8 交付八：B 侧复核模式——b-check-p* worker 收到 FORGE_B_REVIEW_MODE
  // 时，prompt 追加「独立复核 A 的 P0/P1 发现」指令段（替代全量重审）。
  // A 侧同视角报告路径注入：check-a-pN.md（同 roundDir）。
  // 视角独立性保留：B 仍以自己的身份评判——可推翻 A、也可补 A 漏报。
  let bReviewModeHint = '';
  if (process.env.FORGE_B_REVIEW_MODE === 'recheck-a-findings' && step.startsWith('b-check-p')) {
    const perspectiveNum = step.match(/p(\d+)/)?.[1] || '?';
    const aReportPath = join(roundDir, `check-a-p${perspectiveNum}.md`);
    const aReportExists = existsSync(aReportPath);
    bReviewModeHint = [
      '',
      '--- B 侧复核模式（v1.3.8 交付八 · 成本重构）---',
      '',
      '你的任务从「全量重审本视角」收窄为「独立复核 A 的 P0/P1 发现」。',
      aReportExists
        ? `A 的同视角审查报告：${aReportPath}（先读它，提取其中全部 P0/P1 finding）`
        : `⚠️ A 的同视角报告（check-a-p${perspectiveNum}.md）不存在——A 侧 worker 崩溃或被跳过。此时你回退为全量审查本视角。`,
      '',
      '复核纪律：',
      '1. 逐条复核 A 报的 P0/P1：读对应文件/跑对应命令，独立给出「确认（附证据）/ 推翻（附反证）/ 存疑（说明缺什么证据）」',
      '2. P2 与你的视角强相关的也可复核，但不强制',
      '3. **兜底补充**：复核过程中发现 A 漏报的明显问题（本视角内），照样报——复核不是只挑错，是提高发现质量',
      '4. 禁止盲从 A：A 说有问题但证据不成立 → 推翻；A 说没问题但你发现新问题 → 补充',
      '',
      '输出格式：复核结论表 + 兜底发现（如有）：',
      '| A-finding | 复核结论 | 依据（文件/命令输出） |',
      '|-----------|---------|----------------------|',
      '',
      '复核表 + 兜底发现都写入你的产物文件（driver 切片逻辑不变）。',
    ].join('\n');
  }

  const userMessage = [
    promptTemplate.trim(),
    '',
    '--- driver 注入 ---',
    `本次审查对象 = sofagent ${target} 完整交付物`,
    // v1.3.6 交付⑩：worktree 隔离——worker 看到的项目根是隔离副本，
    // 所有读/grep/git 操作都落在副本上，主仓不受影响。产物仍写 roundDir（runDir 内，副本外）。
    `项目根目录 = ${(globalWorktree && globalWorktree.worktreeDir) || REPO_ROOT}`,
    inputPaths ? `输入文件（已由 driver 中转）：\n${inputPaths}` : '',
    multiOutputHint
      ? `产物输出（本步骤产出多个文件，必须用 ===FILE: <文件名>=== 分隔各产物，driver 会按此切片写入）：\n${outputPaths}\n\n格式约定：\n${multiOutputHint}`
      : `产物输出路径（把你的输出写到这个文件）：\n${outputPaths}`,
    bReviewModeHint,
  ].filter(Boolean).join('\n');

  // 4. 创建 model + tools + agent
  // 步骤级 maxTokens 覆盖（如 a-consolidate=32000）优先于角色默认值
  const model = await createModel(role, stepDef.maxTokens);

  // v1.2.1 L2：ProgressMiddleware 注入（SubAgent 内部可观测）。
  // 事件写 <roundDir>/sub-progress-<role>.jsonl——Dashboard 靠它看到
  // 「A 正在读哪些文件 / B 正在改哪行 / 模型推理是否卡死」。
  // 观测层创建失败不阻断 worker 主流程（与 L1 visibility 容错策略一致）。
  let progressMw = null;
  try {
    progressMw = createProgressMiddleware({ roundDir, role });
  } catch (mwErr) {
    console.warn(`[worker:${step}] ProgressMiddleware 创建失败（不影响主流程）: ${mwErr.message}`);
  }

  // v1.3.0 (交付 1)：运行时审计 tool wrapper——tool-gate 规则动态拦截 + 审计日志留证。
  // 创建失败不阻断 worker（与 L1 visibility 容错策略一致）。
  let auditMw = null;
  try {
    const { createAuditMiddleware } = await import('./audit-middleware.mjs');
    const { RulesEngine, defaultToolRules } = require('../../engine/rules/dist/index.js');
    auditMw = createAuditMiddleware(new RulesEngine(defaultToolRules), {
      agentName: role,
      taskDesc: stepDef?.task ?? '',
      cwd: process.cwd(),
      sessionId: `forge-${role}-${step}`,
      emitDecision: true,
    });
  } catch (auditErr) {
    console.warn(`[worker:${step}] AuditMiddleware 创建失败（不影响主流程）: ${auditErr.message}`);
  }
  const tools = loadTools(role, progressMw, auditMw);

  // 用 @langchain/langgraph 的 createReactAgent 替代 deepagents createDeepAgent。
  //
  // 根因（2026-07-25 定位）：createDeepAgent 硬编码注入 FilesystemMiddleware
  // （源码 5879-5895 行），middleware:[] 只是追加到链尾无法替换它。
  // REQUIRED_MIDDLEWARE_NAMES = Set(["FilesystemMiddleware","SubAgentMiddleware"])
  // 明确禁止排除。FilesystemMiddleware 的 wrapToolCall 在并行工具调用时
  // 触发 `undefined.length` 崩溃（superstep N AggregateError）。
  // DeepSeek 偶然没触发并行调用所以能跑，GLM-5.2 在 superstep 5 触发即崩。
  //
  // createReactAgent 是同一套 LangGraph React 模式，但不带 FilesystemMiddleware——
  // 我们有自己的 sf_read/sf_write/run_bash，不需要 deepagents 的内置文件工具。
  // v1.2.5 性能优化：stateModifier 同时实现「system prompt 注入」+「上下文裁剪」。
  // prompt 和 stateModifier 互斥（LangGraph 源码 _getPrompt 强校验），
  // 所以把 systemPrompt 移到 stateModifier 内部以 SystemMessage 形式注入。
  //
  // 上下文裁剪：保留 system + 第一条 user（原始任务）+ 最后 MAX_CONTEXT_MESSAGES 条。
  // 中间被裁掉的旧工具调用结果，其关键信息已被 Agent 提取到后续推理中，
  // 无需在每次 LLM 调用时重复处理（这是 prompt_tokens 从 30k→100k+ 膨胀的根因）。
  // HumanMessage 用于 stateModifier 内的工具预算软熔断注入——
  // prompt 层纪律（铁律文本）对 qwen3.8-max / glm-5.2 无效，必须在代码层做硬熔断。
  // run-01 教训：A worker 调了 1119 次工具仍未收敛，撞 GraphRecursionError 零产出。
  const { SystemMessage, HumanMessage } = await import('@langchain/core/messages');
  const MAX_CONTEXT_MESSAGES = 16; // 最后 8 轮工具交互（调用+结果各 1 条）
  const systemMsg = new SystemMessage(systemPrompt);

  // 🔴 v1.2.7 run-03/run-04 教训：消息裁剪会切断 tool_calls ↔ ToolMessage 配对。
  // DeepSeek API 严格校验两种方向：
  //   ① "Messages with role 'tool' must be a response to a preceding message with 'tool_calls'"
  //      → 裁剪后开头的 ToolMessage 找不到它的 AI tool_calls 父消息
  //   ② "An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'"
  //      → 裁剪后尾部的 AI tool_calls 消息对应的 ToolMessage 被切掉了
  //
  // trimMessagesSafe 做 3 步：
  //   1. slice 取最后 keepCount 条
  //   2. 清除配对：扫一遍，标记所有孤立的 tool_calls / ToolMessage，从结果中移除
  //   3. 返回清洗后的安全消息数组
  function trimMessagesSafe(messages, keepCount) {
    if (messages.length <= keepCount) return [...messages];
    let recent = messages.slice(-keepCount);

    // 配对清洗：收集所有 AI tool_calls 的 id 和所有 ToolMessage 的 tool_call_id
    // 如果 ToolMessage 的 tool_call_id 在 recent 中找不到对应的 AI tool_calls → 移除
    // 如果 AI tool_calls 的某个 tool_call_id 在 recent 中找不到对应的 ToolMessage → 从 tool_calls 中移除该条
    // 如果 AI 消息的所有 tool_calls 都找不到对应 ToolMessage → 移除整条 AI 消息

    const aiToolCallIds = new Set();
    for (const msg of recent) {
      if (msg?._getType?.() === 'ai' && msg.tool_calls?.length > 0) {
        for (const tc of msg.tool_calls) {
          if (tc.id) aiToolCallIds.add(String(tc.id));
        }
      }
    }

    const toolMsgIds = new Set();
    for (const msg of recent) {
      if (msg?._getType?.() === 'tool' && msg.tool_call_id) {
        toolMsgIds.add(String(msg.tool_call_id));
      }
    }

    // 过滤：移除孤立的 ToolMessage 和孤立的 AI tool_calls
    const cleaned = [];
    for (const msg of recent) {
      const type = msg?._getType?.();
      if (type === 'tool' && msg.tool_call_id) {
        // ToolMessage 有对应的 AI tool_calls？→ 保留
        if (aiToolCallIds.has(String(msg.tool_call_id))) {
          cleaned.push(msg);
        }
        // 否则跳过（孤立的 ToolMessage）
      } else if (type === 'ai' && msg.tool_calls?.length > 0) {
        // AI 消息有 tool_calls → 检查每个 tool_call 是否都有对应的 ToolMessage
        const validCalls = msg.tool_calls.filter(tc =>
          !tc.id || toolMsgIds.has(String(tc.id))
        );
        if (validCalls.length === msg.tool_calls.length) {
          // 所有配对完整 → 保留原消息
          cleaned.push(msg);
        } else if (validCalls.length > 0) {
          // 部分配对 → 保留消息但更新 tool_calls（创建修改副本）
          cleaned.push({ ...msg, tool_calls: validCalls });
        }
        // 所有 tool_calls 都无配对 → 跳过（孤立的 AI tool_calls）
      } else {
        // 普通消息（Human/AI text/System）→ 直接保留
        cleaned.push(msg);
      }
    }

    return cleaned;
  }

  // v1.2.9 功能⑨：动态 token 估算——粗估消息总 token 数（content 长度 / 4）
  function estimateTokens(messages) {
    let totalChars = 0;
    for (const msg of messages) {
      const content = msg?.content;
      if (typeof content === 'string') {
        totalChars += content.length;
      } else if (Array.isArray(content)) {
        for (const part of content) {
          if (typeof part === 'string') {
            totalChars += part.length;
          } else if (part && typeof part.text === 'string') {
            totalChars += part.text.length;
          }
        }
      }
    }
    return Math.ceil(totalChars / 4);
  }

  // v1.2.9 功能①：perspective worker 用自己的 toolSoftLimit/toolHardLimit（12/15）。
  // 非 perspective 步骤用模块级 TOOL_SOFT_LIMIT/TOOL_HARD_LIMIT（35/45）。
  // 🔴 run-07 修复：原声明在 stateModifier 闭包内，invokeAgent 引用时
  // effectiveHardLimit is not defined（跨闭包不可见）。提到 agent 定义前，
  // stateModifier 和 invokeAgent 都能访问。
  const effectiveSoftLimit = stepDef.toolSoftLimit ?? TOOL_SOFT_LIMIT;
  const effectiveHardLimit = stepDef.toolHardLimit ?? TOOL_HARD_LIMIT;

  // v1.3.4 增量：stateModifier 构造为闭包——传给 langgraph-backend 作为 stateModifierFactory 回调。
  // 逻辑零改动（保留所有 run-XX 教训沉淀）：工具预算软熔断 + 上下文裁剪 + tool_calls 配对清洗。
  const buildStateModifier = ({ systemPrompt: _sp, toolBudget: _tb }) => {
    return (state) => {
      const messages = state.messages ?? [];

      // 统计历史消息中所有 AI tool_calls 总数
      let toolCallCount = 0;
      for (const msg of messages) {
        if (msg?._getType?.() === 'ai' && msg.tool_calls?.length > 0) {
          toolCallCount += msg.tool_calls.length;
        }
      }
      if (toolCallCount >= effectiveHardLimit) {
        const forceReport = new HumanMessage({
          content: '【🔴🔴 绝对最终指令——违反将导致你的审查成果全部丢弃 🔴🔴】\n' +
            `你已调用 ${toolCallCount} 次工具，已到达硬上限 ${effectiveHardLimit}。\n` +
            '任何进一步的工具调用都将被系统拦截，你的审查工作将归零。\n\n' +
            '现在立即、马上、在这一条回复中输出完整的审查报告。\n' +
            '不要思考下一步该看什么文件。不要写"让我再检查一下"。\n' +
            '直接写报告。格式：\n' +
            '## 审查发现\n\n### finding-01\n- 视角：XXX\n- 文件：路径\n- 描述：问题\n- 优先级：P0|P1|P2\n\n' +
            '用你现在已经掌握的全部信息写。信息不足的发现标注 P2。'
        });
        if (messages.length <= MAX_CONTEXT_MESSAGES + 1) {
          return [systemMsg, forceReport, ...messages];
        }
        const first = messages[0];
        const recent = trimMessagesSafe(messages, MAX_CONTEXT_MESSAGES);
        return [systemMsg, forceReport, first, ...recent];
      }

      if (toolCallCount >= effectiveSoftLimit) {
        const forceReport = new HumanMessage({
          content: '【🔴 系统强制指令——你已超过工具预算 🔴】\n' +
            `你已调用 ${toolCallCount} 次工具，超过软上限 ${effectiveSoftLimit}。\n` +
            `硬上限 ${effectiveHardLimit} 即将到来。到硬上限时系统将物理中断你的工作。\n\n` +
            '立即停止探索，用已掌握的信息写报告并写入产物文件。\n' +
            '你的工具调用已经足够——现在需要的是把发现组织成报告，而不是继续搜集信息。'
        });
        console.warn(`  ⚡ [${step}#${role}] 工具调用 ${toolCallCount} 次超软上限，注入强制收尾指令（硬上限 ${effectiveHardLimit}）`);
        if (messages.length <= MAX_CONTEXT_MESSAGES + 1) {
          return [systemMsg, forceReport, ...messages];
        }
        const first = messages[0];
        const recent = trimMessagesSafe(messages, MAX_CONTEXT_MESSAGES);
        return [systemMsg, forceReport, first, ...recent];
      }

      if (messages.length <= MAX_CONTEXT_MESSAGES + 1) {
        return [systemMsg, ...messages];
      }
      const first = messages[0];
      const recent = trimMessagesSafe(messages, MAX_CONTEXT_MESSAGES);
      return [systemMsg, first, ...recent];
    };
  };

  // v1.3.4 增量：preModelHook 保留——传给 langgraph-backend 的 modelConfig.preModelHook
  const preModelHook = (state) => {
      const TOKEN_HARD = 100000;
      const messages = state.messages ?? [];
      const tokenEst = estimateTokens(messages);

      if (tokenEst > TOKEN_HARD) {
        const first = messages[0];
        const recent = trimMessagesSafe(messages, 12);
        return { ...state, messages: [first, ...recent] };
      }

      return state;
    };

  // 5. 通过 ExecutionBackend 执行 agent（v1.3.4 增量）
  console.log(`[worker:${step}] 开始执行（role=${role}, model=${cfg.model}）`);
  const t0 = Date.now();

  // recursionLimit 按步骤类型区分：
  // - 审查类（a-check/b-check）：需要读文件+搜索，给 500（=250 轮工具调用）
  //   v1.2.5 run-01 教训：原 200 让 worker 有空间调 1119 次工具陷入死循环，
  //   但现在 L1/L2 熔断(200)会先介入，不会回到死循环。
  //   run-07 教训：50/60 步不够 v1.2.6 大范围审查取证，调到 200/200/500 给足冗余。
  // - 文本处理类（a-consolidate/a-verify）：主要做合并/格式化，给 100 够了
  // - b-fix：分片后每批 5 条 finding × 5 工具调用 = 25 步，给 150 是 6 倍余量
  //   太高会导致消息累积 OOM（exit 137）
  // - a-verify：分片后每批 5 条 × 2 操作 = 10 步，给 150 是 15 倍余量
  // v1.2.9 功能①：短任务化后 STEP_RECURSION_LIMITS 按新 step key 生成。
  // 每个 perspective worker 用 recursionLimit=30（单视角短任务）。
  // STEPS 中已定义 recursionLimit 字段的 perspective worker 直接从 stepDef 读取。
  // 这里只为非 perspective 步骤（a-consolidate/b-fix/a-verify）保留显式覆盖。
  const STEP_RECURSION_LIMITS = {
    'a-consolidate': 100,
    'b-fix': 300,
    'a-verify': 300,
  };
  // perspective worker（a-check-p1 ~ b-check-p12）的 recursionLimit 从 stepDef.recursionLimit 读取
  const recursionLimit = STEP_RECURSION_LIMITS[step] ?? stepDef.recursionLimit ?? 50;

  // v1.2.5：流式执行——实时打印工具调用，用户不再盯着空白等 5 分钟
  //
  // 🔴 stream 数据结构适配（P0 bugfix da1039a → 本 commit）：
  //   agent.stream(streamMode:'updates') 的 chunk 格式是 { [nodeName]: stateDelta }，
  //   不是 invoke() 的扁平 { messages: [...] }。直接赋 finalState = chunk 会导致
  //   下游 extractAgentText / extractUsage 找 result.messages 拿到 undefined。
  //
  //   正确做法：累积所有 chunk 的 delta.messages 到一个扁平数组，模拟 invoke 返回格式。

  // 报告质量门控——非空 content 不一定是报告（可能是中间思考碎片）
  // run-07 Round 5：155 字节一句话（"Rule count checks out. Now let me verify..."）
  // 在窗口期被当"报告捕获" → gotReport=true → 流提前结束。
  // 真报告至少含 1 个 ## 标题行 或 ≥ 500 字符。
  // v1.2.7 run-09：isReportText 提到模块级（extractAgentText 也要用）

  const invokeAgent = async () => {
    // v1.3.4 增量：通过 ExecutionBackend 调用 agent
    // streamHandler 回调维护 toolCallCount / graceWindow / hardBreak 状态——逻辑零改动
    let streamToolCallCount = 0;
    let inGraceWindow = false;
    let graceStepCount = 0;
    let hardBreak = false;
    let gotReport = false;
    const graceSteps = (step === 'a-check' || step === 'b-check')
      ? REVIEW_GRACE_STEPS
      : DEFAULT_GRACE_STEPS;

    const streamHandler = (chunk) => {
      for (const [, delta] of Object.entries(chunk)) {
        const msgs = delta?.messages;
        if (!Array.isArray(msgs)) continue;
        for (const msg of msgs) {
          // 检测 AI message 是否有非空 content（模型开始写报告）
          if (msg?._getType?.() === 'ai') {
            const c = msg?.content;
            let textContent = '';
            if (typeof c === 'string') textContent = c;
            else if (Array.isArray(c)) textContent = c.map(x => typeof x === 'string' ? x : x?.text ?? '').join('');
            if (inGraceWindow && isReportText(textContent)) {
              gotReport = true;
              console.log(`  ✅ [${step}#${role}] 写报告窗口内捕获到报告文本（${textContent.length} 字符）`);
            }
          }
          if (msg?._getType?.() === 'ai' && msg.tool_calls?.length > 0) {
            for (const tc of msg.tool_calls) {
              streamToolCallCount++;
              console.log(`  → [${step}#${role}] tool #${streamToolCallCount}: ${tc.name}`);
            }
            if (inGraceWindow && !gotReport) {
              graceStepCount += 2;
              console.warn(`  ⚠️ [${step}#${role}] 写报告窗口内仍调工具（惩罚 +2，进度 ${graceStepCount}/${graceSteps}）`);
            }
          }
        }
      }
      if (streamToolCallCount >= effectiveHardLimit && !inGraceWindow && !hardBreak) {
        inGraceWindow = true;
        if (graceSteps > 0) {
          console.warn(`  ⏳ [${step}#${role}] 工具调用 ${streamToolCallCount} 次撞硬上限，进入 ${graceSteps} 步写报告窗口`);
        } else {
          console.warn(`  🛑 [${step}#${role}] 工具调用 ${streamToolCallCount} 次撞硬上限，立即中断（零窗口模式）`);
        }
      }
      if (inGraceWindow && !gotReport && !hardBreak) {
        graceStepCount++;
        if (graceStepCount >= graceSteps) {
          hardBreak = true;
          if (graceSteps > 0) {
            console.warn(`  🛑 [${step}#${role}] 写报告窗口耗尽（${graceSteps} 步），模型仍未输出文本，强制中断`);
          }
          return { hardBreak: true };
        }
      }
      if (gotReport) {
        console.log(`  📝 [${step}#${role}] 报告已捕获，正常结束`);
        return { hardBreak: true };
      }
      return {};
    };

    const { createExecutionBackend } = await import('../../engine/orchestrator/dist/execution-backend.js');
    const backend = await createExecutionBackend();
    const execResult = await backend.execute({
      systemPrompt,
      task: userMessage,
      tools,
      modelConfig: { model, preModelHook },
      toolBudget: { softLimit: effectiveSoftLimit, hardLimit: effectiveHardLimit },
      recursionLimit,
      stateModifierFactory: buildStateModifier,
      streamHandler,
    });

    return {
      messages: execResult.rawMessages ?? [],
      _hardBreak: execResult.hardBreak || hardBreak,
    };
  };

  const result = progressMw
    ? await progressMw.wrapModelCall({ step, role, model: cfg.model }, invokeAgent)
    : await invokeAgent();
  const latencyMs = Date.now() - t0;

  // v1.2.6：从 result 解包 _hardBreak flag——stream 硬熔断时标记部分报告
  const hardBreakFlag = result?._hardBreak || false;

  // 5b. 记录 usage（try/catch 包住——usage 记录失败不能中断主流程）
  try {
    // 从 roundDir 推导 runDir（roundDir = runDir/round-NN）
    const runDir = resolve(roundDir, '..');
    recordUsage(runDir, step, round, role, cfg.model, result, latencyMs, target);
  } catch (usageErr) {
    console.warn(`[worker:${step}] usage 记录失败（不影响主流程）: ${usageErr.message}`);
  }

  // 6. 提取文本输出
  let text = extractAgentText(result);
  if (!text) {
    // v1.2.7 run-06 修复：generateReportWithoutTools 只在硬熔断(hardBreak)时触发。
    //
    // 原设计问题：无论是否硬熔断，只要 extractAgentText 返回空就走裸 LLM 报告生成。
    // 这导致正常流程中模型偶尔没输出文本（如 API 超时重试后 content 丢失）时，
    // 也会启动一个完全脱离 agent 上下文的裸 LLM 调用——报告质量极差且不可预测。
    //
    // 正确行为：
    //   - hardBreak=true（工具预算耗尽，agent 被物理中断）→ 启动裸 LLM 抢救（合理）
    //   - hardBreak=false（正常完成但 content 为空）→ 直接走 synthesizeReportFromMessages 碎片合成
    if (hardBreakFlag) {
      console.warn(`  ┄ [${step}] 硬熔断后模型未输出文本，启动无工具裸 LLM 报告生成`);
      try {
        text = await generateReportWithoutTools(model, result?.messages ?? [], step, role, stepDef);
        if (text) {
          console.log(`  ✅ [${step}] 裸 LLM 报告生成成功（${text.length} 字符）`);
        }
      } catch (bareErr) {
        console.warn(`  ⚠️ [${step}] 裸 LLM 报告生成失败: ${bareErr.message}，降级为碎片合成`);
      }
    }
    if (!text) {
      // 最终兜底：从工具结果合成最小报告
      text = synthesizeReportFromMessages(result?.messages ?? [], step, role);
      if (!text) {
        throw new Error(`[worker:${step}] DeepAgent 未返回内容且无法合成报告`);
      }
    }
  }

  // v1.2.6：stream 硬熔断时给报告加标记头，让下游知道这是部分报告
  if (hardBreakFlag) {
    text = `<!-- ⚠️ 工具预算耗尽，此为部分报告——worker 被强制中断 -->\n\n` + text;
  }

  // 7. 写产物
  //    单输出：直接写。
  //    多输出（如 a-consolidate 产 findings.md + result.md）：
  //      约定 agent 返回文本用 `===FILE: <filename>===` 分隔多产物，
  //      driver 按分隔符切片分别写入对应文件。
  //      若找不到分隔符，fallback 把整个文本写入第一个产物（不丢内容）。
  //    分片模式：环境变量 FORGE_CUSTOM_OUTPUT 覆盖输出文件名（如 summary-batch-1.md / result-verified-batch-1.md）。
  if (stepDef.outputs.length === 1) {
    const actualOutput = customOutputName || stepDef.outputs[0];
    const outPath = join(roundDir, actualOutput);
    writeFileSync(outPath, text, 'utf-8');
    console.log(`[worker:${step}] 产物已写入 ${outPath}`);
  } else {
    const slices = sliceMultiOutput(text, stepDef.outputs);
    for (const filename of stepDef.outputs) {
      const outPath = join(roundDir, filename);
      writeFileSync(outPath, slices[filename], 'utf-8');
      console.log(`[worker:${step}] 产物已写入 ${outPath}`);
    }
    // v1.3.0 run-21 修复：a-consolidate 产物无 ===FILE: 分隔符时，sliceMultiOutput
    // 把 result.md 判空 → b-fix 拿 0 finding → 假绿停止（3 轮 findings 全丢）。
    // run-22 补充：result.md 有内容但用分类段落（### 🔴 P0 阻塞项）而非 finding-NN
    // 结构时，splitFindings 同样切 0 条 → 假绿。检测扩展为：
    //   空占位 / 无内容 → 重建；有内容且含 P0/P1/P2 标记但切不出 finding → 重建。
    //   无任何 P 标记 → 视为确实干净，不重建（避免真干净轮被降级标记拖成永不停止）。
    if (step === 'a-consolidate') {
      const rPath = join(roundDir, 'result.md');
      const rText = existsSync(rPath) ? readFileSync(rPath, 'utf-8') : '';
      const isEmpty = isPlaceholderOutput(rText) || !rText.trim();
      const noFindings = splitFindings(rText).length === 0;
      const hasPrioMarkers = /\bP0\b|\bP1\b|\bP2\b/.test(rText);
      if (isEmpty || (noFindings && hasPrioMarkers)) {
        console.warn(`  ⚠️ [worker:${step}] result.md 不可消费（${isEmpty ? '空占位' : `切 0 finding 但含 P 标记`}），触发 fallback 重建`);
        writeFallbackFindings(roundDir);
      }
    }
  }
}

/**
 * 按 `===FILE: <filename>===` 分隔符切片多产物输出。
 * v1.2.7 功能⑤：复用 driver-base 的 sliceMultiOutput 实现。
 */
const sliceMultiOutput = base.sliceMultiOutput;

// ─── 报告质量门控（模块级，extractAgentText 和 stream loop 共用）──────────
// v1.2.7 run-07：GLM 的中间思考碎片（172 字符"现在让我查看..."）被当报告写入。
// 真报告至少含 1 个 ## 标题行 或 ≥ 500 字符。
const REPORT_MIN_CHARS = 500;
function isReportText(text) {
  if (!text || !text.trim()) return false;
  if (text.length >= REPORT_MIN_CHARS) return true;       // 长度够
  if (/^#{1,3}\s/m.test(text)) return true;               // 含 ## 标题行
  return false;
}

/**
 * 从 DeepAgent invoke 结果中提取文本（兼容多种返回格式）。
 */
function extractAgentText(result) {
  if (typeof result === 'string') return result;
  // 直接有 content 字段（非 messages 结构）
  if (result?.content) {
    const content = result.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map(c => typeof c === 'string' ? c : c?.text ?? '').join('');
    }
    if (content && typeof content === 'object') {
      if (typeof content.text === 'string') return content.text;
      if (typeof content.content === 'string') return content.content;
      return JSON.stringify(content);
    }
  }
  // messages 数组结构（LangGraph stream 返回格式）
  if (result?.messages) {
    // 从后往前找最后一条「有报告级 content 的」AI 消息。
    //
    // v1.2.7 run-07 修复：原来只要 text.trim() 非空就返回，但 GLM/Qwen 在
    // 硬熔断前的最后一条 AI message 可能是一句中间思考碎片（如"现在让我
    // 查看一些特定的代码文件"），172 字符的碎片被当成报告写入了产物文件。
    //
    // 报告质量门控：≥500 字符 或 含 ## 标题行（与 stream loop 的 isReportText 一致）。
    // 如果所有 AI message 都不达标 → 返回 null → 走 generateReportWithoutTools / synthesize 降级。
    for (let i = result.messages.length - 1; i >= 0; i--) {
      const msg = result.messages[i];
      const isAI = msg?._getType?.() === 'ai' || (msg?.tool_calls !== undefined && msg?.content !== undefined);
      if (!isAI) continue;

      const content = msg?.content;
      // 提取文本
      let text = '';
      if (typeof content === 'string') text = content;
      else if (Array.isArray(content)) text = content.map(c => typeof c === 'string' ? c : c?.text ?? '').join('');
      else if (content && typeof content === 'object') {
        if (typeof content.text === 'string') text = content.text;
        else if (typeof content.content === 'string') text = content.content;
        else text = JSON.stringify(content);
      }
      // 报告质量门控：非空 + (≥500 字符 或 含 ## 标题行)
      if (text.trim() && isReportText(text)) return text;
    }
    // 所有消息都不是 AI 类型——从最后一条往前找非 ToolMessage 的消息。
    // 硬中断场景：最后一条可能是 ToolMessage（工具返回值，如 sf_read 读到的
    // prompt 文件内容），不能把工具返回值当 agent 输出写入报告。
    for (let i = result.messages.length - 1; i >= 0; i--) {
      const msg = result.messages[i];
      // 跳过 ToolMessage——它的 content 是工具返回值不是 agent 输出
      if (msg?._getType?.() === 'tool') continue;
      const content = msg?.content;
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        return content.map(c => typeof c === 'string' ? c : c?.text ?? '').join('');
      }
      if (content && typeof content === 'object') {
        if (typeof content.text === 'string') return content.text;
        return JSON.stringify(content);
      }
    }
    // 全是 ToolMessage 则返回空字符串（让调用方走 synthesizeReportFromMessages 兜底）
    return '';
  }
  // 最终 fallback——避免 String(object) 产出 "[object Object]"
  if (result && typeof result === 'object') {
    return JSON.stringify(result);
  }
  return String(result ?? '');
}

/**
 * 无工具裸 LLM 报告生成（仅硬熔断 hardBreak=true 时触发）。
 *
 * 当 agent 撞了 TOOL_HARD_LIMIT 后进入写报告窗口，窗口耗尽模型仍没输出文本，
 * 此时用裸 LLM 调用（不传 tools）作为最后抢救——模型无法调工具只能输出文本。
 *
 * v1.2.7 run-06 修复：此函数从"extractAgentText 返回空就调用"改为
 * "仅 hardBreak=true 时调用"。正常流程模型没输出文本不该走这条路径，
 * 那属于 API 异常，应该走 synthesizeReportFromMessages 碎片合成。
 *
 * 为什么这么做：createReactAgent 的 tools 在创建时就固定了，stateModifier
 * 只能改消息不能改 tools。LangGraph React 循环里只要 tools 不为空，
 * model 如果选择 tool_call 就继续走 tool 路线。唯一出路是绕过 agent
 * 循环，直接用 model.invoke()——不带 tools 参数，模型没有工具可调，
 * 只能输出文本。
 *
 * @param {object} model   ChatOpenAI 实例
 * @param {Array}  messages agent 消息历史
 * @param {string} step     步骤名
 * @param {string} role     角色 A/B
 * @param {object} stepDef  步骤定义（含 prompt 文件名等）
 * @returns {Promise<string>} 报告文本，失败返回 null
 */
async function generateReportWithoutTools(model, messages, step, role, stepDef) {
  // 1. 从工具结果中提取关键摘要（文件路径 + grep 结果等）
  // v1.2.7 run-07：200 字符→500 字符，让裸 LLM 有足够上下文判断 P0/P1 而非全标 P2
  const toolSummaries = [];
  for (const msg of messages) {
    if (msg?._getType?.() === 'tool') {
      const content = typeof msg.content === 'string' ? msg.content : '';
      // 截取每个工具结果的前 500 字符（保留文件内容片段和关键 grep 输出）
      if (content.trim()) {
        const truncated = content.slice(0, 500).trim();
        toolSummaries.push(truncated);
      }
    }
  }
  // 去重 + 最多 20 条（500 字符 × 20 = ~10K tokens prompt，控制总量）
  const unique = [...new Set(toolSummaries)].slice(0, 20);

  // v1.3.4 run-01 臆造修复：工具结果摘要不足时禁止裸 LLM 生成报告。
  // 根因：run-01 中 24 个 worker 全部撞硬熔断，裸 LLM 拿着几条碎片"补全"
  // 审查报告，编造出"automerge 排期升级 v1.3.5"等项目中不存在的计划，
  // b-fix 基于臆造越界改文件。没报告比有臆造报告好——信息不足直接
  // 返回 INCOMPLETE 占位，让下游（parseStopCondition / a-consolidate /
  // 人工复核）明确知道该视角审查未完成，而不是把臆造当 finding。
  const MIN_TOOL_EVIDENCE = 5;  // 少于 5 条有效工具结果 = 证据不足
  if (unique.length < MIN_TOOL_EVIDENCE) {
    return [
      `## ${step}（角色 ${role}）审查未完成 [INCOMPLETE]`,
      '',
      '> **降级占位——工具证据不足，禁止裸 LLM 生成报告**',
      `> 该 worker 撞硬熔断时仅收集到 ${unique.length} 条工具结果摘要`,
      `>（要求 ≥${MIN_TOOL_EVIDENCE} 条才允许裸 LLM 兜底）。`,
      '> 信息不足时强行生成报告 = 鼓励模型臆造（v1.3.4 run-01 教训）。',
      '> 本份产物不含任何 finding，请重跑该视角或人工复核。',
      '',
      'INCOMPLETE 降级占位（证据不足）',
    ].join('\n');
  }

  // 2. 构造裸 LLM 请求——无 tools，只有 system + user 消息
  const { SystemMessage, HumanMessage } = await import('@langchain/core/messages');

  const reportPrompt = [
    '你是审查报告生成器。以下是之前审查过程中工具调用的结果摘要。',
    '请基于这些信息，写出完整的审查报告。',
    '',
    '报告要求：',
    `- 步骤：${step}（角色 ${role}）`,
    `- 产物文件：${(stepDef?.outputs ?? ['report.md']).join(', ')}`,
    '- 每条发现标注优先级：P0（严重/阻塞）/ P1（应该修）/ P2（观察项）',
    '- 给出文件路径和具体描述',
    // v1.3.4 run-01 臆造修复：裸 LLM 兜底只允许"总结已证实的证据"，
    // 禁止"基于合理推断"补全。臆造链：碎片摘要 → LLM 联想出项目中
    // 不存在的计划/版本/决策 → b-fix 据此越界改文件。
    '- 🔴 反臆造铁律：只允许报告摘要中有直接文字证据的内容。',
    '  摘要里没有明确写的东西（版本计划、升级决策、路线图排期、',
    '  文件内容、数字），一律不得出现在报告中——不知道就写"未确认"，',
    '  宁可留空也不得推测补全。',
    '- 只有摘要信息确实不足以确认时才标 P2"待证实"——禁止把推测升为 P0/P1',
    '- 用中文写，Markdown 格式',
    // v1.3.0 run-21 修复：多产物步骤（a-consolidate 产 findings.md+result.md）的
    // 兜底报告也必须带 ===FILE: 分隔符，否则 sliceMultiOutput 把 result.md 判空，
    // b-fix 拿不到 finding → 假绿停止（run-21 3 轮全丢的根因）。
    // run-22 补充：result.md 正文还必须用 `### finding-NN` 结构（splitFindings 只认
    // 该格式），分类段落（### 🔴 P0 阻塞项）切不出 finding 同样假绿。
    ...(stepDef && stepDef.outputs && stepDef.outputs.length > 1
      ? ['',
         '🔴 本步骤产出多个文件，必须用 ===FILE: <文件名>=== 分隔各产物，格式：',
         ...stepDef.outputs.map(f => `===FILE: ${f}===\n<${f} 正文>`),
         ...(stepDef.outputs.includes('result.md')
           ? ['',
              '🔴 result.md 是 B 的执行 prompt，每条修复指令必须用 `### finding-NN` 开头',
              '（NN=两位数字 01/02/03…），正文含 **问题** / **修复方案** / **验证** 三段。',
              '禁止用 `### 🔴 P0 阻塞项` 等分类段落标题——解析器只认 finding-NN 格式。']
           : []),
         '']
      : []),
    '',
    `以下是 ${unique.length} 条工具结果摘要：`,
    '---',
    ...unique.map((s, i) => `[${i + 1}] ${s}`),
    '---',
  ].join('\n');

  const reportMessages = [
    new SystemMessage('你是 sofagent 项目的独立审查者。现在需要你根据已有工具调用结果写出审查报告。不调用任何工具，直接输出报告文本。'),
    new HumanMessage(reportPrompt),
  ];

  // 3. 裸调用——不带 tools，模型只能输出文本
  const response = await model.invoke(reportMessages);
  let respText = typeof response === 'string'
    ? response
    : (response?.content ?? '');
  // 处理数组格式 content
  if (Array.isArray(respText)) {
    respText = respText.map(x => typeof x === 'string' ? x : x?.text ?? '').join('');
  }
  respText = (typeof respText === 'string') ? respText.trim() : '';

  // v1.3.1 run-03 教训：裸 LLM 降级产出的半截碎片（如 184 字节一句话中间思考）
  // 被直接写入产物文件，下游 isDegraded 判定（CHECK_MIN_BYTES=200）刚卡不住，
  // 但碎片不含任何有效审查内容，污染整轮 finding 计数。加结构校验：
  // 降级产物必须满足"≥ REPORT_MIN_CHARS(500) 且含 ## 标题行"才算有效报告
  // （与 extractAgentText 的 isReportText 门控一致）。不达标返回明确的占位
  // 文本，让下游 parseStopCondition / b-fix 能识别"该视角审查未完成"而非误读
  // 碎片为有效 finding。
  if (respText && isReportText(respText)) {
    return respText;
  }
  // 碎片不达标 → 返回结构化占位（含降级标记词，让 parseStopCondition 识别）
  return [
    `## ${step}（角色 ${role}）审查未完成`,
    '',
    '> **降级生成——裸 LLM 报告未达质量门控**',
    `> 该视角的 worker 撞硬熔断后，裸 LLM 降级报告未通过结构校验`,
    `> （要求 ≥${REPORT_MIN_CHARS} 字符 且 含 ## 标题行，实际 ${respText.length} 字符）。`,
    '> 本份产物不含有效 finding，请人工复核该视角。',
    '',
    '降级占位',
  ].join('\n');
}

/**
 * 从工具调用结果合成最小报告（硬熔断兜底）。
 *
 * 当模型在写报告窗口内仍未输出文本时，从 ToolMessage 里提取
 * 关键信息（文件路径、搜索结果摘要），拼成一个占位报告。
 * 质量不如模型自己写的，但比 throw 后全部丢失好。
 *
 * @param {Array} messages  agent 返回的消息数组
 * @param {string} step      步骤名
 * @param {string} role      角色 A/B
 * @returns {string}         合成的报告文本
 */
function synthesizeReportFromMessages(messages, step, role) {
  const findings = [];
  for (const msg of messages) {
    // 从 ToolMessage 提取内容
    if (msg?._getType?.() === 'tool') {
      const content = typeof msg.content === 'string' ? msg.content : '';
      // 从工具输出里提取文件路径行（cat/grep/find 的输出常含路径）
      const pathLines = content.split('\n')
        .filter(l => /\.(ts|md|sh|js|mjs|json)\b/.test(l))
        .slice(0, 3);  // 每个工具结果最多取 3 行
      if (pathLines.length > 0) {
        findings.push(...pathLines);
      }
    }
  }
  if (findings.length === 0) return '';
  // 取前 30 条去重，拼成最小报告
  const unique = [...new Set(findings)].slice(0, 30);
  return [
    `<!-- ⚠️ 硬熔断兜底报告——模型未输出文本，此内容由 driver 从工具结果自动合成 -->`,
    `<!-- step=${step} role=${role} 工具结果摘要 ${unique.length} 条 -->`,
    '',
    '## 审查发现（自动合成——质量有限）',
    '',
    ...unique.map((f, i) => `${i + 1}. ${f.trim()}`),
    '',
    '## 总评',
    `本报告由 driver 从 ${messages.length} 条消息中的工具结果自动合成。模型在硬熔断后未输出文本。`,
  ].join('\n');
}

// ═══════════════════════════════════════════════════════════
//  Driver 模式 — 编排循环
// ═══════════════════════════════════════════════════════════

/**
 * 生成 run 目录路径：runs/<workflow-name>/YYYY-MM-DD/run-NN/
 * 第一级 = workflow 名，第二级 = 拍平日期（非 YYYY/MM/DD 三级嵌套），第三级 = run 序号
 * 同日多次跑 = run-01, run-02 ...
 */
function resolveRunDir() {
  const now = new Date();
  const y  = String(now.getFullYear());
  const m  = String(now.getMonth() + 1).padStart(2, '0');
  const d  = String(now.getDate()).padStart(2, '0');
  const dateStr = `${y}-${m}-${d}`;            // 拍平：YYYY-MM-DD
  const workflowDir = join(RUNS_DIR, 'fresh-eyes-loop');  // 第一级：workflow 名
  const dateDir = join(workflowDir, dateStr);             // 第二级：日期

  let runNum = 1;
  if (existsSync(dateDir)) {
    const existing = readdirSync(dateDir)
      .filter(n => n.startsWith('run-'))
      .map(n => parseInt(n.replace('run-', ''), 10))
      .filter(n => !isNaN(n));
    if (existing.length > 0) runNum = Math.max(...existing) + 1;
  }

  const runDir = join(dateDir, `run-${String(runNum).padStart(2, '0')}`);
  mkdirSync(runDir, { recursive: true });
  return { runDir, runId: `${y}${m}${d}-${String(runNum).padStart(2, '0')}`, dateStr: `${y}-${m}-${d}` };
}

/**
 * v1.2.8 功能⑦：从已有 run 目录反推 runId / dateStr（resume 模式复用已有目录）。
 * run 目录结构：RUNS_DIR/fresh-eyes-loop/YYYY-MM-DD/run-NN/
 *
 * @param {string} runDir - 已有 run 目录绝对路径
 * @returns {{runDir: string, runId: string, dateStr: string}}
 */
function resolveRunDirInfo(runDir) {
  const runName = basename(runDir);              // run-03
  const dateDir = basename(dirname(runDir));     // 2026-08-07
  const runNumStr = runName.replace('run-', '').padStart(2, '0');
  const digits = dateDir.replace(/-/g, '');
  return { runDir, runId: `${digits}-${runNumStr}`, dateStr: dateDir };
}

/**
 * v1.2.8 功能⑦：--resume 时自动发现最近的 run 目录。
 *
 * 优先级：
 *   1. 读 latest.json 指针（runDir 字段）——driver 每轮结束都会刷新该指针
 *   2. 目录时间倒序兜底——latest.json 缺失/损坏时扫最新日期目录里最大的 run-NN
 *
 * 铁律：只读发现，不修改任何已有产物。
 *
 * @returns {string|null} 最近的 run 目录绝对路径；无任何历史 run 时返回 null
 */
function discoverLatestRunDir() {
  const workflowDir = join(RUNS_DIR, 'fresh-eyes-loop');

  // 1. latest.json 指针优先
  const latestPath = join(workflowDir, 'latest.json');
  if (existsSync(latestPath)) {
    try {
      const pointer = JSON.parse(readFileSync(latestPath, 'utf-8'));
      if (pointer && typeof pointer.runDir === 'string' && pointer.runDir) {
        // relativeRunDir 写入的是相对 SOFAGENT_HOME/data 的路径（fallback 相对 REPO_ROOT）
        const dataRoot = join(SOFAGENT_HOME, 'data');
        let candidate = join(dataRoot, pointer.runDir);
        if (!existsSync(candidate)) candidate = resolve(REPO_ROOT, pointer.runDir);
        if (existsSync(candidate)) return candidate;
      }
    } catch { /* latest.json 损坏——走兜底扫描 */ }
  }

  // 2. 兜底：扫日期目录（倒序）+ 每天最大的 run-NN
  if (!existsSync(workflowDir)) return null;
  const dates = readdirSync(workflowDir)
    .filter(n => /^\d{4}-\d{2}-\d{2}$/.test(n))
    .sort()
    .reverse();
  for (const dateStr of dates) {
    const dateDir = join(workflowDir, dateStr);
    const nums = readdirSync(dateDir)
      .filter(n => n.startsWith('run-'))
      .map(n => parseInt(n.replace('run-', ''), 10))
      .filter(n => !isNaN(n));
    if (nums.length > 0) {
      const runDir = join(dateDir, `run-${String(Math.max(...nums)).padStart(2, '0')}`);
      if (existsSync(runDir)) return runDir;
    }
  }
  return null;
}

// ─── b-fix 分片工具函数 ──────────────────────────────────────

/**
 * 将 result.md 按 finding 切片。
 * 每个 finding 以 "### finding-NN" / "### finding-P0-NN" 或带冒号开头。
 * Slice result.md by finding. Each finding starts with
 * "### finding-NN" / "### finding-P0-NN" (with optional colon).
 *
 * @param {string} resultText - result.md 全文 / full text
 * @returns {Array<{id: string, content: string}>} - 每个 finding 的 id 和正文（含 ### 行）
 */
function splitFindings(resultText) {
  const findings = [];
  // 匹配 ### finding-01 / ### finding-/ ### finding-等格式
  // Accept: pure digits (01) or level-prefixed (, )
  const re = /^### finding-([A-Z0-9-]+)[：:]?/gm;
  const marks = [];
  let m;
  while ((m = re.exec(resultText)) !== null) {
    marks.push({ id: m[1], start: m.index });
  }

  for (let i = 0; i < marks.length; i++) {
    const end = (i + 1 < marks.length) ? marks[i + 1].start : resultText.length;
    const content = resultText.slice(marks[i].start, end).trimEnd();
    findings.push({ id: marks[i].id, content });
  }

  return findings;
}

/**
 * 将数组按指定大小分批。
 *
 * @param {Array} arr
 * @param {number} size
 * @returns {Array<Array>}
 */
function chunk(arr, size) {
  const batches = [];
  for (let i = 0; i < arr.length; i += size) {
    batches.push(arr.slice(i, i + size));
  }
  return batches;
}

/**
 * b-fix 分片执行：把 result.md 按 finding 切片，每批 BATCH_SIZE 条，
 * 每批启动一个独立 worker（全新 agent session，零历史消息）。
 *
 * 每批 worker 只收到本批的 findings（写入 result-batch-N.md），
 * 避免单 session 消息累积导致 recursionLimit 超限或 OOM。
 *
 * @param {string} roundDir - round 目录绝对路径
 * @param {string} target   - 验证目标版本号
 * @param {number} round    - 轮次号
 */
/**
 * 动态计算 batch size（#7 优化）：finding 越多，每批越小，
 * 保证单 worker 工具调用数不撞 recursionLimit（150 步）。
 * 经验公式：每批 ≤ 5 条，总量 > 20 降到 3，> 35 降到 2。
 */
function computeBatchSize(findingCount) {
  if (findingCount <= 20) return 5;
  if (findingCount <= 35) return 3;
  return 2;
}

async function runBFixSharded(roundDir, target, round) {
  // BATCH_SIZE 在 splitFindings 之后动态计算

  // 1. 读 result.md
  const resultPath = join(roundDir, 'result.md');
  const resultText = readFileSync(resultPath, 'utf-8');

  // 2. 按 finding 切片 + 动态 batch（#7）
  const findings = splitFindings(resultText);
  const BATCH_SIZE = computeBatchSize(findings.length);
  console.log(`  [b-fix 分片] 共 ${findings.length} 条 finding，动态 batch=${BATCH_SIZE}`);

  // 防回归：切出 0 条 finding 但 result.md 中 P0+P1 计数 > 0 时报警
  // Anti-regression: warn when 0 findings are parsed but P0/P1 markers exist
  if (findings.length === 0 && resultText.length > 0) {
    const p0Matches = resultText.match(/### finding-P0-/g) || [];
    const p1Matches = resultText.match(/### finding-P1-/g) || [];
    if (p0Matches.length > 0 || p1Matches.length > 0) {
      console.warn(
        `\n  ⚠️  [splitFindings] 切出 0 条 finding，但 result.md 中含 ${p0Matches.length} 个 P0 + ${p1Matches.length} 个 P1。\n` +
        `      可能原因：finding 标题格式不符（应为 ### finding-NN 或 ### finding-P0-NN）。\n` +
        `      跳过修复环节——请检查 a-consolidate 输出格式。`
      );
      // 写 stall 类警示事件到 sub-progress jsonl
      // Write stall-class warning event to sub-progress jsonl
      const warningEvent = {
        ts: new Date().toISOString(),
        role: 'system',
        event: 'split-findings-empty-warning',
        p0Count: p0Matches.length,
        p1Count: p1Matches.length,
        resultLength: resultText.length,
      };
      if (typeof visibility !== 'undefined' && typeof visibility.emit === 'function') {
        visibility.emit('split-findings-empty-warning', warningEvent);
      }
    }
  }

  // 3. 边界情况：0 finding → 不需要修复，直接跳过
  if (findings.length === 0) {
    console.log(`  [b-fix 分片] 0 条 finding，跳过修复`);
    writeFileSync(join(roundDir, 'summary.md'), '# summary.md · 本轮无 finding，跳过修复\n', 'utf-8');
    return;
  }

  // 4. 分批
  const batches = chunk(findings, BATCH_SIZE);

  // 5. 每批启动一个独立 worker
  const batchSummaries = [];
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchNum = i + 1;
    console.log(`\n  [b-fix 分片 ${batchNum}/${batches.length}] 修复 finding: ${batch.map(f => f.id).join(', ')}`);

    // 5a. 构造这批的临时 result 文件
    const batchResultPath = join(roundDir, `result-batch-${batchNum}.md`);
    const batchHeader =
      `# result-batch-${batchNum}.md · B 的执行 prompt（分片 ${batchNum}/${batches.length}）\n\n` +
      `> **给 B**：以下是本批 ${batch.length} 条修复指令。按顺序逐条修复。\n\n---\n\n`;
    const batchContent = batch.map(f => f.content).join('\n\n---\n\n');
    writeFileSync(batchResultPath, batchHeader + batchContent, 'utf-8');

    // 5b. spawn worker（传入分片文件名作为 result.md 的替换）
    try {
      await spawnWorker('b-fix', roundDir, target, round, {
        customInputs: { 'result.md': `result-batch-${batchNum}.md` },
        customOutput: `summary-batch-${batchNum}.md`,
      });
      const summaryPath = join(roundDir, `summary-batch-${batchNum}.md`);
      if (existsSync(summaryPath)) {
        batchSummaries.push(readFileSync(summaryPath, 'utf-8'));
      }
    } catch (batchErr) {
      console.warn(`\n  ⚠️  [b-fix 分片 ${batchNum}] 失败: ${batchErr.message}`);
      batchSummaries.push(
        `## 分片 ${batchNum} 失败\n\n` +
        `错误: ${batchErr.message}\n\n` +
        `涉及 finding: ${batch.map(f => f.id).join(', ')}\n`
      );
      // 继续下一批，不中断
    }
  }

  // 6. 合并所有 batch 的 summary 为 summary.md
  const mergedSummary = [
    '# summary.md · b-fix 分片执行合并报告',
    '',
    `> 共 ${batches.length} 批，${findings.length} 条 finding`,
    '',
    ...batchSummaries,
  ].join('\n');
  writeFileSync(join(roundDir, 'summary.md'), mergedSummary, 'utf-8');
  console.log(`\n  [b-fix 分片] 全部完成，${batchSummaries.length} 份 summary 已合并`);
}

/**
 * a-verify 分片执行：把 result.md 按 finding 切片，每批 BATCH_SIZE 条，
 * 每批启动一个独立 worker（全新 agent session，零历史消息）。
 *
 * 与 runBFixSharded 平行，区别：
 *   - 每批输入文件名：result-verify-batch-N.md
 *   - 每批输出文件名：result-verified-batch-N.md
 *   - 最后合并覆盖回 result.md（a-verify 产物就是回填 verify 列的 result.md，
 *     driver 的 parseStopCondition 读它判停止条件）
 *
 * @param {string} roundDir - round 目录绝对路径
 * @param {string} target   - 验证目标版本号
 * @param {number} round    - 轮次号
 */
async function runAVerifySharded(roundDir, target, round) {
  const resultPath = join(roundDir, 'result.md');
  const resultText = readFileSync(resultPath, 'utf-8');

  const findings = splitFindings(resultText);
  const BATCH_SIZE = computeBatchSize(findings.length);  // #7 动态 batch
  console.log(`  [a-verify 分片] 共 ${findings.length} 条 finding，动态 batch=${BATCH_SIZE}`);

  // 防回归：切出 0 条 finding 但 result.md 中 P0+P1 计数 > 0 时报警
  // Anti-regression: warn when 0 findings are parsed but P0/P1 markers exist
  if (findings.length === 0 && resultText.length > 0) {
    const p0Matches = resultText.match(/### finding-P0-/g) || [];
    const p1Matches = resultText.match(/### finding-P1-/g) || [];
    if (p0Matches.length > 0 || p1Matches.length > 0) {
      console.warn(
        `\n  ⚠️  [splitFindings] 切出 0 条 finding，但 result.md 中含 ${p0Matches.length} 个 P0 + ${p1Matches.length} 个 P1。\n` +
        `      可能原因：finding 标题格式不符（应为 ### finding-NN 或 ### finding-P0-NN）。\n` +
        `      跳过验证环节——请检查 a-consolidate 输出格式。`
      );
      // 写 stall 类警示事件到 sub-progress jsonl
      // Write stall-class warning event to sub-progress jsonl
      const warningEvent = {
        ts: new Date().toISOString(),
        role: 'system',
        event: 'split-findings-empty-warning',
        p0Count: p0Matches.length,
        p1Count: p1Matches.length,
        resultLength: resultText.length,
      };
      if (typeof visibility !== 'undefined' && typeof visibility.emit === 'function') {
        visibility.emit('split-findings-empty-warning', warningEvent);
      }
    }
  }

  if (findings.length === 0) {
    console.log(`  [a-verify 分片] 0 条 finding，跳过验证`);
    writeFileSync(join(roundDir, 'verify.md'), '# verify.md · 本轮无 finding，跳过验证\n', 'utf-8');
    return;
  }

  const batches = chunk(findings, BATCH_SIZE);
  const batchResults = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchNum = i + 1;
    console.log(`\n  [a-verify 分片 ${batchNum}/${batches.length}] 验证 finding: ${batch.map(f => f.id).join(', ')}`);

    // 构造分片输入
    const batchResultPath = join(roundDir, `result-verify-batch-${batchNum}.md`);
    const batchHeader =
      `# result-verify-batch-${batchNum}.md · A 验证（分片 ${batchNum}/${batches.length}）\n\n` +
      `> 以下是本批 ${batch.length} 条的验证指令。\n\n---\n\n`;
    const batchContent = batch.map(f => f.content).join('\n\n---\n\n');
    writeFileSync(batchResultPath, batchHeader + batchContent, 'utf-8');

    try {
      await spawnWorker('a-verify', roundDir, target, round, {
        customInputs: { 'result.md': `result-verify-batch-${batchNum}.md` },
        customOutput: `result-verified-batch-${batchNum}.md`,
      });
      const verifiedPath = join(roundDir, `result-verified-batch-${batchNum}.md`);
      if (existsSync(verifiedPath)) {
        batchResults.push(readFileSync(verifiedPath, 'utf-8'));
      }
    } catch (batchErr) {
      console.warn(`\n  ⚠️  [a-verify 分片 ${batchNum}] 失败: ${batchErr.message}`);
      batchResults.push(
        `## 分片 ${batchNum} 验证失败\n\n` +
        `错误: ${batchErr.message}\n\n` +
        `涉及 finding: ${batch.map(f => f.id).join(', ')}\n`
      );
      // 继续下一批，不中断
    }
  }

  // 合并回填到 result.md
  const mergedResult = [
    '# result.md · a-verify 分片合并（已回填 verify 列）',
    '',
    `> 共 ${batches.length} 批，${findings.length} 条 finding`,
    '',
    ...batchResults,
  ].join('\n');
  writeFileSync(join(roundDir, 'result.md'), mergedResult, 'utf-8');
  console.log(`\n  [a-verify 分片] 全部完成，已合并回填 result.md`);
}

/**
 * 起一个 worker 子进程（真·零上下文：独立 node 进程）。
 * 返回 Promise，resolve 时子进程已退出。
 * v1.2.4：StallError 重试——检测 stderr 中的 [stall-watchdog] 标记，
 * 最多重试 STALL_RETRY_MAX 次（默认 2）。
 *
 * @param {string} step      步骤名
 * @param {string} roundDir  本轮目录绝对路径
 * @param {string} target    审查目标版本号
 * @param {number} round     轮次号（通过 FORGE_ROUND 环境变量传给 worker）
 * @param {object} [options] 可选：分片模式覆盖
 * @param {object} [options.customInputs] 输入文件名映射
 * @param {string} [options.customOutput]  输出文件名覆盖
 */
/** v1.2.4 StallError 重试次数上限 / StallError retry limit */
const STALL_RETRY_MAX = parseInt(process.env.FORGE_STALL_RETRY_MAX || '2', 10);

/**
 * 步骤级 stall 超时覆盖表（run-05 教训）。
 * key = step 名，value = 注入 worker 子进程的环境变量覆盖。
 * 未列出的步骤使用全局默认（STALL_MAX=3 ≈ 9min）。
 *
 * 为什么 a-consolidate 需要特殊对待：
 *   - 输入双份完整 12 视角审查报告（check-a.md ~10KB + check-b.md ~5KB）
 *   - 需要在单次 LLM 调用中理解+合并+输出 findings.md
 *   - 模型在长上下文处理时事件循环长时间不 yield，心跳检测判定 stall
 *   - run-05 连续 18 次 StallError，3 轮全部降级
 *
 * STALL_MAX=8 ≈ 24min 容忍；STALL_ABORT_MS=30min 单次极端停顿中止。
 */
const STALL_OVERRIDE = {
  'a-consolidate': {
    FORGE_STALL_MAX: '8',           // 累计停顿次数：3→8（≈9min→≈24min）
    FORGE_STALL_ABORT_MS: '1800000', // 单次极端停顿：10min→30min
  },
};

function spawnWorker(step, roundDir, target, round, options = {}) {
  /** 单次执行 worker 子进程 */
  function runOnce() {
    return new Promise((resolveP, rejectP) => {
      const env = { ...process.env, FORGE_ROUND: String(round) };

      // v1.3.6 交付⑩：worktree 隔离透传——worker 读 FORGE_WORKTREE_ROOT 后把
      // run_bash cwd / 项目根目录全部切到副本（红队模拟 commit 零污染主仓）。
      if (globalWorktree && globalWorktree.worktreeDir) {
        env.FORGE_WORKTREE_ROOT = globalWorktree.worktreeDir;
      }

      // v1.3.0 (交付 10 MA4)：worker 启动前检索历史经验（仅 FORGE_MEMORY_BACKEND 启用时）。
      // 检索结果注入 FORGE_MEMORY_CONTEXT 环境变量，worker 读取后拼入 system prompt。
      // 缺省 unset / 不可达 → 不注入（与 v1.2.9 完全一致）。
      const memoryEndpoint = getMemoryBackendEndpoint();
      if (memoryEndpoint) {
        memorySearch(`forge/fresh-eyes/${step}`, target)
          .then((hits) => {
            if (hits && hits.length > 0) {
              const ctx = hits.map((h) => h.content ?? '').filter(Boolean).join('\n').slice(0, 4000);
              if (ctx) env.FORGE_MEMORY_CONTEXT = ctx;
            }
          })
          .catch(() => { /* 检索失败不阻断 spawn */ });
      }

      // 步骤级 stall 超时覆盖（run-05 教训：a-consolidate 合并双份完整报告，
      // 输入 check-a.md(~10KB)+check-b.md(~5KB)，deepseek-v4-flash/glm-5.2
      // 在长文本合并时事件循环长时间不推进，默认 STALL_MAX=3（~9min）不够，
      // 连续 18 次 StallError → 全部降级。给文本密集步骤更宽容的心跳预算。
      //
      // STALL_MAX=8 ≈ 24min 无响应才判定 stall（每次 stall ~3min）。
      // STALL_ABORT_MS=1800000 = 30min 单次极端停顿立即中止。
      if (STALL_OVERRIDE[step]) {
        Object.assign(env, STALL_OVERRIDE[step]);
      }

      // 分片模式：通过环境变量把覆盖项传给 worker
      if (options.customInputs && options.customInputs['result.md']) {
        env.FORGE_BATCH_RESULT = options.customInputs['result.md'];
      }
      if (options.customOutput) {
        env.FORGE_CUSTOM_OUTPUT = options.customOutput;
      }

      // 捕获 stderr 以检测 StallError（worker 进程打印 [stall-watchdog] 标记）
      // Capture stderr to detect StallError marker from worker process
      let stderrBuf = '';
      const child = spawn(process.execPath, [
        '--max-old-space-size=1024',   // worker 实际负载是 grep/read 型轻内存（工具调用 0.0s 级），1024 够用；降半后在 8GB 机器上并发 2 也只占 ≤2GB heap 上限。若再遇 worker OOM（stderr 含 heap out of memory），回调 2048 并回退并发 1。
        __filename,
        '--worker',
        '--step', step,
        '--round-dir', roundDir,
        '--target', target,
      ], {
        cwd: REPO_ROOT,
        stdio: ['pipe', 'inherit', 'pipe'],
        env,
      });

      child.stderr.on('data', (chunk) => {
        stderrBuf += chunk.toString();
        process.stderr.write(chunk); // 保持实时可见
      });

      child.on('close', (code, signal) => {
        // v1.3.0 (交付 10 MA4)：worker 完成后写入本次发现（仅 FORGE_MEMORY_BACKEND 启用时）。
        // 写入失败 warn + 不阻断（优雅降级铁律）。
        if (code === 0 && getMemoryBackendEndpoint()) {
          const summary = (options.customOutput || options.customInputs?.['result.md'] || `step=${step} round=${round}`).slice(0, 2000);
          memoryWrite(`forge/fresh-eyes/${step}`, summary, { perspective: step, round: String(round), ts: new Date().toISOString() })
            .catch(() => { /* 写入失败不阻断 */ });
        }

        if (code === 0) {
          resolveP();
        } else if (code === null) {
          // 进程被信号杀死（最常见：OOM SIGKILL）
          console.error(`  💀 [worker:${step}] 子进程被信号杀死: ${signal}（可能是 OOM）`);
          const err = new Error(`worker ${step} 被信号杀死 (${signal})，可能是内存不足`);
          err.isStallError = false;
          err.isSignalKill = true;
          rejectP(err);
        } else {
          // 检测 StallError（watchdog 中止标记）
          // Detect StallError (watchdog abort marker)
          const isStall = stderrBuf.includes('[stall-watchdog]') ||
                          stderrBuf.includes('StallError');
          const err = new Error(`worker ${step} 退出码 ${code}`);
          err.isStallError = isStall;
          rejectP(err);
        }
      });
      child.on('error', rejectP);
    });
  }

  // v1.2.4：StallError 重试逻辑（最多 STALL_RETRY_MAX 次）
  // v1.2.4: StallError retry logic (up to STALL_RETRY_MAX times)
  return (async () => {
    for (let attempt = 0; attempt <= STALL_RETRY_MAX; attempt++) {
      try {
        return await runOnce();
      } catch (err) {
        if (err.isStallError && attempt < STALL_RETRY_MAX) {
          console.warn(
            `\n  ⚠️  [worker:${step}] StallError — watchdog 检测到事件循环冻结，` +
            `重试 ${attempt + 1}/${STALL_RETRY_MAX}`
          );
          continue; // 重试
        }
        throw err; // 非 StallError 或重试已耗尽，上抛
      }
    }
  })();
}

/**
 * 并行起多个 worker（用于步骤 ①② 双盲独立审查）。
 *
 * v1.2.9 功能①：MAX_CONCURRENCY 分批执行。
 * 24 个 perspective worker 同时启动会触发 API rate limit。MAX_CONCURRENCY=6
 * 把 worker 数组按并发数分批，每批全部完成后启动下一批。
 *
 * v1.2.6：allSettled 替代 all——一方崩溃不拖累另一方。
 * run-01/run-02 教训：a-check 崩溃导致 Promise.all reject，
 * b-check 的成果也随之丢弃（虽然 b-check 可能已成功写出 check-b.md）。
 * 返回 { results, failures } 让调用方做降级判定。
 *
 * @param {Array<[string,string,string]>} workers  [step, roundDir, target] 元组数组
 * @param {number} round  轮次号（透传给 spawnWorker）
 */
function spawnParallel(workers, round) {
  // v1.2.6：allSettled 替代 all——一方崩溃不拖累另一方。
  // run-01/run-02 教训：a-check 崩溃导致 Promise.all reject，
  // b-check 的成果也随之丢弃（虽然 b-check 可能已成功写出 check-b.md）。
  // 返回 { results, failures } 让调用方做降级判定。
  return (async () => {
    // v1.2.9 功能①：MAX_CONCURRENCY 分批执行。
    // 24 个 perspective worker 分批：并发数个一批，批内并行，
    // 批间串行。避免 API rate limit。
    //
    // v1.3.7 ⑦ OOM 熔断降级：批次内 worker 被 SIGKILL（code=null，OOM 典型
    // 特征）→ 降级器接管——本批记录事件，后续批次并发降为 1（串行）；连续
    // 2 批次触发 → 持续并发 1 继续跑（不中止 run，只降速）——「宁可慢，不猝死」。
    const results = [];
    const failures = [];

    for (let batchStart = 0; batchStart < workers.length; ) {
      const concurrency = Math.max(1, Math.min(concurrencyDegrader.getState().concurrency, workers.length - batchStart));
      const batch = workers.slice(batchStart, batchStart + concurrency);
      const batchNum = Math.floor(batchStart / concurrency) + 1;
      console.log(`  [并发批次 ${batchNum}] 启动 ${batch.length} 个 worker（并发=${concurrency}）`);

      const settled = await Promise.allSettled(
        batch.map(([step, roundDir, target]) => spawnWorker(step, roundDir, target, round))
      );
      // v1.3.7 ⑦：检测本批次是否有 OOM SIGKILL（isSignalKill 由 spawnWorker 标记）
      const batchHadSigkill = settled.some(s => s.status === 'rejected' && s.reason?.isSignalKill);
      if (batchHadSigkill) {
        const evt = concurrencyDegrader.onBatchResult(true);
        console.warn(`  ⚡ [OOM 降级] 本批次检测到 worker 被信号杀死——后续批次并发 → ${concurrencyDegrader.getState().concurrency}（事件：degraded-concurrency × ${evt.consecutiveDegradedBatches}）`);
      } else {
        concurrencyDegrader.onBatchResult(false);
      }
      settled.forEach((s, i) => {
        const globalIndex = batchStart + i;
        const [step] = workers[globalIndex];
        if (s.status === 'fulfilled') {
          results.push({ step, value: s.value });
        } else {
          results.push({ step, value: null });
          failures.push({ step, reason: s.reason });
        }
      });
      batchStart += concurrency;
    }
    return { results, failures };
  })();
}

/**
 * 从单份 check 报告中提取结构化 finding（P0/P1 级）。
 *
 * v1.3.0 run-21 修复：a-consolidate 产物解析失败时，从 24 份 check 报告
 * 直接提取 finding 生成可修的 result.md（### finding-NN 格式），
 * 让 b-fix 能真正修复，而不是空转重试。
 *
 * 兼容两种 check 报告格式：
 *   A 侧：## 🔴 P1 发现项 段落 + ### N. 标题 + - **文件路径**: X + - **具体描述**: Y
 *   B 侧：| 视角 | 文件路径 | 具体描述 | 优先级 | 表格行（末列 P0/P1/P2）
 *
 * @param {string} text   check 报告全文
 * @param {string} source 来源标签（如 A-陌生人 / B-陌生人）
 * @returns {Array<{title:string, filePath:string, desc:string, source:string}>}
 */
function extractFindingsFromCheck(text, source) {
  const items = [];
  const lines = text.split('\n');

  // ── 路径 A：标题块格式（### N. 标题 + 属性列表）──
  let currentPrio = null;
  let currentTitle = null;
  let currentFile = null;
  const currentDesc = [];
  let inFinding = false;
  const flush = () => {
    if (inFinding && (currentPrio === 'P0' || currentPrio === 'P1')) {
      items.push({
        title: (currentTitle || '未命名 finding').slice(0, 80),
        filePath: (currentFile || '(文件待确认)').trim(),
        desc: currentDesc.join(' ').replace(/\s+/g, ' ').trim().slice(0, 200),
        source,
        prio: currentPrio,
      });
    }
    currentTitle = null;
    currentFile = null;
    currentDesc.length = 0;
    inFinding = false;
  };
  for (const line of lines) {
    // 段落标题（## ...）→ 切出上一个 finding，更新当前优先级
    if (/^#{1,2}\s/.test(line)) {
      flush();
      currentPrio = null;
      const pm = line.match(/\b(P[0-3])\b/);
      if (pm) currentPrio = pm[1];
      continue;
    }
    const titleMatch = line.match(/^###+\s+\d+[.、]\s*(.+)/);
    if (titleMatch) {
      flush();
      currentTitle = titleMatch[1].trim();
      inFinding = true;
      continue;
    }
    if (inFinding) {
      const fileMatch = line.match(/-\s*\*\*文件路径\*\*\s*[:：]\s*(.+)/);
      if (fileMatch) { currentFile = fileMatch[1].trim(); continue; }
      const descMatch = line.match(/-\s*\*\*具体描述\*\*\s*[:：]\s*(.+)/);
      if (descMatch) { currentDesc.push(descMatch[1].trim()); continue; }
    }
  }
  flush();

  // ── 路径 B：表格行格式（| 视角 | 文件路径 | 具体描述 | 优先级 |）──
  // 四列，末列为 P0/P1/P2；路径列可能含反引号，描述列可能很长
  for (const line of lines) {
    const rowMatch = line.match(/^\|\s*[^|]+\|\s*`?([^`|]+)`?\s*\|\s*(.+?)\s*\|\s*(P[0-3])\s*\|$/);
    if (!rowMatch) continue;
    const prio = rowMatch[3];
    if (prio !== 'P0' && prio !== 'P1') continue;
    const filePath = rowMatch[1].trim();
    const desc = rowMatch[2].trim();
    items.push({
      title: desc.slice(0, 80),
      filePath,
      desc: desc.slice(0, 200),
      source,
      prio,
    });
  }

  return items;
}

/**
 * 判断多产物切片是否为"空占位"（sliceMultiOutput 无分隔符 fallback 产生）。
 */
function isPlaceholderOutput(content) {
  return /未检测到 ===FILE:|agent 未产出此文件/.test(content || '');
}

/**
 * 降级兜底：a-consolidate 失败时，直接拼接所有 perspective 报告作为 findings.md。
 *
 * v1.2.9 功能①：短任务化后 check 产物从 check-a.md/check-b.md 变为
 * check-a-p1~12.md / check-b-p1~12.md（24 份）。降级时读全部 24 份。
 *
 * 不做去重/合并/优先级排序——只是让循环能继续走到 b-fix。
 * findings.md 里保留每份报告的**摘要**（P0/P1 条目 + 总评），不传完整正文——
 * 避免 b-fix 收到完整报告后上下文溢出（run-06 教训：119 万 tokens > 104 万上限）。
 * result.md 写一个最小结构让 parseStopCondition 能数 P0/P1。
 */
function writeFallbackFindings(roundDir) {
  /**
   * 从 check 报告中提取摘要：P0/P1 条目 + 总评行。
   * 跳过 P2 细节和冗长描述，把单份报告压缩到 ~2KB 以内。
   */
  function summarize(filePath, label) {
    if (!existsSync(filePath)) return `（${label} 报告未找到）`;
    const text = readFileSync(filePath, 'utf-8');
    const lines = text.split('\n');
    const kept = [];
    let inP0P1 = false;
    for (const line of lines) {
      // 保留标题行
      if (/^#{1,3}\s/.test(line)) {
        kept.push(line);
        inP0P1 = /P0|P1|🔴|严重|关键/.test(line);
        continue;
      }
      // 保留 P0/P1 相关行
      if (/\bP0\b|\bP1\b|🔴/.test(line)) {
        kept.push(line);
        inP0P1 = true;
        continue;
      }
      // 保留总评行
      if (/总评|评分|score|\/10/.test(line)) {
        kept.push(line);
        continue;
      }
      // P0/P1 区块内的内容行也保留（列表项）
      if (inP0P1 && /^\s*\d+\.|^\s*[-*]\s/.test(line)) {
        kept.push(line);
        continue;
      }
      // 其他内容跳过（压缩）
      inP0P1 = false;
    }
    return kept.join('\n');
  }

  const parts = ['# Fallback Findings（a-consolidate 失败降级·摘要模式）', '',
    '> ⚠️ a-consolidate 失败，以下为各 perspective 报告的 P0/P1 摘要（非完整报告）。', ''];

  // v1.2.9 功能①：读全部 24 份 perspective 报告
  for (const p of PERSPECTIVES) {
    const checkA = join(roundDir, `check-a-p${p.id}.md`);
    const checkB = join(roundDir, `check-b-p${p.id}.md`);
    if (existsSync(checkA)) {
      parts.push(`## A-${p.label}`, '', summarize(checkA, `A-${p.label}`), '');
    }
    if (existsSync(checkB)) {
      parts.push(`## B-${p.label}`, '', summarize(checkB, `B-${p.label}`), '');
    }
  }

  const findingsText = parts.join('\n');
  writeFileSync(join(roundDir, 'findings.md'), findingsText, 'utf-8');

  // v1.3.0 run-21 修复：result.md 从 24 份 check 报告提取可修 finding（### finding-NN 格式），
  // 让 b-fix 能真正修复而非空转重试。保留"降级生成"标记 → parseStopCondition 判 isDegraded
  // → 本轮不判 clean；修复经 b-audit auto-commit 后，下一轮在新代码上重审（保守正确）。
  const extracted = [];
  for (const p of PERSPECTIVES) {
    for (const [label, fileName] of [
      ['A', `check-a-p${p.id}.md`],
      ['B', `check-b-p${p.id}.md`],
    ]) {
      const filePath = join(roundDir, fileName);
      if (!existsSync(filePath)) continue;
      const items = extractFindingsFromCheck(readFileSync(filePath, 'utf-8'), `${label}-${p.label}`);
      for (const it of items) extracted.push(it);
    }
  }

  let resultContent;
  if (extracted.length > 0) {
    const findingBlocks = extracted.map((it, i) => {
      const seq = String(i + 1).padStart(2, '0');
      return [
        `### finding-${seq}: ${it.title}`,
        '',
        `**来源**: ${it.source}（fallback 从 check 报告提取，请 b-fix 核实后再改）`,
        '',
        `**优先级**: ${it.prio}`,
        '',
        `**问题**: ${it.desc}`,
        '',
        `**修复方案**:`,
        `- 文件：\`${it.filePath}\``,
        `- 操作：${it.desc}（具体改法以 check 报告原文为准，b-fix 需读文件核实）`,
        '',
        `**验证**: 依据 check 报告原文中的验证建议执行`,
      ].join('\n');
    });
    resultContent = [
      '# 修复结果（降级生成——a-consolidate 产物解析失败，由 check 报告提取）',
      '',
      `> ⚠️ 降级生成——a-consolidate 失败。以下 ${extracted.length} 条 finding 由各 check 报告提取，优先级基于原文标记。`,
      '',
      ...findingBlocks,
      '',
    ].join('\n');
  } else {
    const p0 = (findingsText.match(/\bP0\b/g) || []).length;
    const p1 = (findingsText.match(/\bP1\b/g) || []).length;
    resultContent = [
      '# 修复结果（降级生成——a-consolidate 失败）',
      '',
      `| # | 发现 | 优先级 | 状态 |`,
      `|---|------|--------|------|`,
      `| fallback | a-consolidate 失败，findings 由各 perspective 报告摘要拼接 | P0×${p0} P1×${p1} | SKIP |`,
      '',
    ].join('\n');
  }
  writeFileSync(join(roundDir, 'result.md'), resultContent, 'utf-8');

  // v1.3.0 run-23 修复：写独立降级标记文件 degraded.flag。
  // 降级标记不能只存在 result.md——a-verify 步骤会覆盖 result.md（回填 verify 列），
  // 把"降级生成"文本抹掉 → parseStopCondition 读到干净 result.md → 降级轮被误判
  // isClean=true（run-23 R1 实测）。flag 与 result.md 解耦，a-verify 覆盖不影响。
  // parseStopCondition 优先查 flag；文本标记匹配保留做旧 run 数据兼容。
  const degradedFlag = join(roundDir, 'degraded.flag');
  writeFileSync(degradedFlag,
    `fallback-rebuild\nreason: a-consolidate 产物解析失败，由 check 报告降级重建\ntime: ${new Date().toISOString()}\nfindings: ${extracted.length}\n`,
    'utf-8');

  console.log(`     降级 findings.md 已写入（check 提取 ${extracted.length} 条可修 finding，degraded.flag 已标记）`);
}

/**
 * 解析停止条件——driver 唯一做判断的地方。
 *
 * 从 result.md 的结构化 finding 表格数 P0/P1/P2；读 verify 列数 FAIL。
 * 只解析机器可读信号，不读审查内容做语义判断。
 *
 * run-06 教训：原来从 findings.md 裸文本数 \bP0\b 正则匹配——但 findings.md
 * 里的叙述性文字（"无 P0" "P2/待证实" "不含 P0/P1"）本身就含 P0/P1 字符串，
 * 导致每轮计数 >0，连续"干净轮"判定永远不成立，driver 永不停止。
 * 修复：改从 result.md 的结构化表格解析。result.md 的 finding 行格式：
 *   ### finding- 或  ### finding-01  + 正文含 priority 列
 * 用 splitFindings 切片后逐条判断优先级。
 *
 * @returns {{ p0:number, p1:number, p2:number, hasFail:boolean, isClean:boolean, isDegraded:boolean }}
 */
function parseStopCondition(roundDir) {
  const findingsPath = join(roundDir, 'findings.md');
  const resultPath   = join(roundDir, 'result.md');

  let p0 = 0, p1 = 0, p2 = 0;

  // 从 result.md 结构化解析（不再从 findings.md 裸文本数正则）
  let structuredParseUsed = false;  // 标记是否走了结构化路径
  if (existsSync(resultPath)) {
    const resultText = readFileSync(resultPath, 'utf-8');
    const findingsList = splitFindings(resultText);
    if (findingsList.length > 0) {
      structuredParseUsed = true;
      for (const f of findingsList) {
        // finding ID 含 P0/P1/P2 前缀（如 finding-）
        const idLower = f.id.toLowerCase();
        if (idLower.includes('p0')) { p0++; continue; }
        if (idLower.includes('p1')) { p1++; continue; }
        if (idLower.includes('p2')) { p2++; continue; }
        // ID 无前缀时从正文找 priority 标记（表格行的 priority 列）
        const content = f.content;
        if (/\bP0\b/.test(content)) { p0++; continue; }
        if (/\bP1\b/.test(content)) { p1++; continue; }
        if (/\bP2\b/.test(content)) { p2++; continue; }
        // 无法确定优先级的 finding 计为 P2（保守不丢）
        p2++;
      }
    }
  }

  // 🔴 fallback：splitFindings 切出 0 条说明 result.md 没按 "### finding-XXX" 格式写
  // （v1.3.2 run-11 教训：worker 用 "### 1. xxx" 自由编号 → splitFindings 返回空 → 计数全 0
  // → isClean=true → 假阳性 clean → driver 误判完成）
  // 此时直接在 result.md + findings.md 裸文本里数 P0/P1 标记。
  // 已知假阳性：叙述性文字（"无 P0""P2/待证实"）也会命中，导致计数偏高——
  // 但"偏高让 driver 多跑几轮"比"为 0 让 driver 误判完成"安全得多（fail-safe 原则）。
  if (!structuredParseUsed) {
    for (const filePath of [resultPath, findingsPath]) {
      if (!existsSync(filePath)) continue;
      const text = readFileSync(filePath, 'utf-8');
      // 优先匹配 markdown 表格 priority 列（如 "| **P0** |" 或 "| P0 |"）
      const p0TableMatches = text.match(/\|\s*\**P0\**\s*\|/gi) || [];
      const p1TableMatches = text.match(/\|\s*\**P1\**\s*\|/gi) || [];
      const p2TableMatches = text.match(/\|\s*\**P2\**\s*\|/gi) || [];
      // 再匹配 ### 标题前缀（如 "### P0" / "### 🔴 P0"）
      const p0HeadingMatches = text.match(/^#{1,4}\s+.*\bP0\b/gm) || [];
      const p1HeadingMatches = text.match(/^#{1,4}\s+.*\bP1\b/gm) || [];
      // 取两种匹配的较大值（去重：一行同时含表格 + 标题算 1 条）
      p0 += Math.max(p0TableMatches.length, p0HeadingMatches.length);
      p1 += Math.max(p1TableMatches.length, p1HeadingMatches.length);
      p2 += p2TableMatches.length;
    }
    // 没匹配到任何 P0/P1 标记，但两个文件都存在且非空——保守判 P2=1（防漏）
    if (p0 === 0 && p1 === 0 && p2 === 0) {
      for (const filePath of [resultPath, findingsPath]) {
        if (existsSync(filePath) && readFileSync(filePath, 'utf-8').trim().length > 100) {
          p2 = 1;
          break;
        }
      }
    }
  }

  // 读 result.md verify 列，数 FAIL
  let hasFail = false;
  if (existsSync(resultPath)) {
    const text = readFileSync(resultPath, 'utf-8');
    // verify 列出现 FAIL → 未闭环
    hasFail = /\bFAIL\b/i.test(text);
  }

  // 降级检测：findings/result 是降级占位文件时强制不干净。
  // run-05 教训：4 个 worker 全崩 → 降级写 3 行模板占位 →
  // parseStopCondition 数正则标记全是 0 → isClean=true → 连续 2 轮误判"成功完成"。
  // 占位文件内容特征：包含"崩溃""降级占位""worker 异常终止""a-consolidate 失败"等标记。
  //
  // v1.3.0 run-23 修复：优先查独立降级标记文件 degraded.flag——文本标记存在 result.md
  // 里会被 a-verify 覆盖抹掉（run-23 R1 实测降级轮被误判 isClean=true）。flag 与
  // result.md 解耦，任何下游覆盖都不影响。文本标记匹配保留做旧 run 数据兼容（取或）。
  let isDegraded = false;
  const degradedFlagPath = join(roundDir, 'degraded.flag');
  if (existsSync(degradedFlagPath)) {
    isDegraded = true;
  }
  const degradedMarkers = [
    '崩溃（降级占位）',
    'worker 异常终止',
    '降级生成——a-consolidate 失败',
    'b-fix 降级（未完成）',
    '降级占位',
  ];
  if (!isDegraded) {
    for (const filePath of [findingsPath, resultPath]) {
      if (!existsSync(filePath)) continue;
      const text = readFileSync(filePath, 'utf-8');
      for (const marker of degradedMarkers) {
        if (text.includes(marker)) {
          isDegraded = true;
          break;
        }
      }
      if (isDegraded) break;
    }
  }

  // 碎片内容假阳性干净——check 产物最小内容阈值检查
  // run-07 教训：兜底合成产出的碎片内容（155 字节一句话中间思考）
  // 不含 P0/P1 标记也不含降级标记词 → 数标记得到 0/0/0 → isClean=true → 假阳性。
  // 补充检查：check 产物太短说明审查不完整，强制不干净。
  // v1.2.9 功能①：短任务化后 check 产物从 check-a.md/check-b.md 变为
  // check-a-p1~12.md / check-b-p1~12.md（24 份）。检查每份的最小字节数。
  //
  // v1.3.1 run-03 教训：原逻辑"任一 checkFile < 200 → isDegraded=true"是
  // 一票否决——1 份短产物连累 23 份正常产物，整轮被误判降级。实测 run-03
  // Round 1：24 份里只有 check-a-p6.md=184 字节触发降级（其余 2-7KB），
  // 但整轮被标 isDegraded=true → 连续 2 轮降级触发熔断退出，循环白跑。
  // 改为比例阈值：短产物占比 > 25% 才判整轮降级。单份短产物更可能是该
  // 视角本身发现少（如"文件结构陌生人"对结构清晰的项目可能确实无话可说），
  // 不该上升到整轮降级。25% 阈值仍能抓住真·大面积降级（run-05 的 4/4 全崩）。
  const CHECK_MIN_BYTES = 200;  // 单视角审查报告至少 200 字节才算真实产物（短任务阈值降低）
  const CHECK_SHORT_RATIO = 0.25;  // 短产物占比超过 25% 才判整轮降级（防一票否决误伤）
  let hasAnyCheckProduct = false;
  let shortCheckCount = 0;   // < CHECK_MIN_BYTES 的产物数
  let totalCheckCount = 0;   // 产物总数（a + b 两份各算 1）
  for (const p of PERSPECTIVES) {
    for (const checkFile of [`check-a-p${p.id}.md`, `check-b-p${p.id}.md`]) {
      const checkPath = join(roundDir, checkFile);
      if (existsSync(checkPath)) {
        hasAnyCheckProduct = true;
        totalCheckCount++;
        const stat = statSync(checkPath);
        if (stat.size < CHECK_MIN_BYTES) {
          shortCheckCount++;
        }
      }
    }
  }
  if (totalCheckCount > 0 && (shortCheckCount / totalCheckCount) > CHECK_SHORT_RATIO) {
    isDegraded = true;
  }
  // 如果一份 check 产物都没有（全部 perspective worker 崩溃），也是降级
  if (!hasAnyCheckProduct && !isDegraded) {
    isDegraded = true;
  }

  // 干净轮 = 无 P0 无 P1 无 P2 闭环失败 且 非降级产物
  const isClean = !isDegraded && (p0 === 0 && p1 === 0 && p2 === 0 && !hasFail);

  // 🔴 v1.3.2 run-11 sanity check（postflight）——防 parseStopCondition 本身有 bug
  // 假装判 isClean=true 但 reports.md/findings.md 里明明有 P0/P1 标记。
  // 触发条件：isClean=true 但任一文件含 markdown P0/P1 表格行或标题前缀。
  // 行为：把 isClean 强制改 false 并 console.warn——治本是 driver 自己的解析逻辑，
  // 但这是兜底防线，防止下次 worker 又换格式时再次假阳性 clean。
  if (isClean) {
    for (const filePath of [findingsPath, resultPath]) {
      if (!existsSync(filePath)) continue;
      const text = readFileSync(filePath, 'utf-8');
      const hasP0Marker = /\|\s*\**P0\**\s*\|/i.test(text) || /^#{1,4}\s+.*\bP0\b/im.test(text);
      const hasP1Marker = /\|\s*\**P1\**\s*\|/i.test(text) || /^#{1,4}\s+.*\bP1\b/im.test(text);
      if (hasP0Marker || hasP1Marker) {
        console.warn(
          `\n  ⚠️  [parseStopCondition sanity] ${filePath} 含 P0/P1 标记但解析计数为 0 — ` +
          `判定强制降级为 isClean=false（防假阳性 clean，见 v1.3.2 run-11 教训）`
        );
        return { p0: Math.max(p0, 1), p1: Math.max(p1, 1), p2, hasFail, isClean: false, isDegraded };
      }
    }
  }

  return { p0, p1, p2, hasFail, isClean, isDegraded };
}

/**
 * #13 加权收敛检测：finding 数在轮次间波动（R1=10→R2=32→R3=16→R4=11）时，
 * 单纯"连续 2 轮干净"过于保守。本函数在 severity 历史足够长时，
 * 用「近窗加权平均 + 趋势判断」提前收敛，避免无意义的继续轮转。
 *
 * 收敛条件（全部满足）：
 *   1. 至少有 3 轮历史
 *   2. 最新一轮 severity（P0+P1）<= 2（已接近干净）
 *   3. 近 3 轮加权平均 <= 4（整体低位）
 *   4. 趋势非上升（最新轮 <= 近 3 轮加权平均，没在反弹）
 *
 * 权重：越近权重越高（1 / 2 / 3，最新轮权重 3）。
 *
 * @param {number[]} history 每轮 (P0+P1) 的数组
 * @returns {boolean} 是否应提前收敛停止
 */
function detectWeightedConvergence(history) {
  if (history.length < 3) return false;
  const latest = history[history.length - 1];
  if (latest > 2) return false;

  // 近 3 轮，权重 1/2/3（最新轮权重最高）
  const window = history.slice(-3);
  const weights = [1, 2, 3];
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const weightedAvg = window.reduce((acc, v, i) => acc + v * weights[i], 0) / weightSum;

  if (weightedAvg > 4) return false;   // 整体还不够低
  if (latest > weightedAvg) return false;  // 最新轮在反弹，不收

  return true;
}

/**
 * 向 LEDGER.md 追加一行。
 * 格式（来自 LEDGER.md 列定义）：
 *   日期 | run-id | 循环 | 轮数 | P0 | P1 | P2 | 停止原因 | → runs 指针
 */
function appendLedger(dateStr, runId, rounds, counts, stopReason, runDir) {
  const relPath = runDir.replace(REPO_ROOT + '/', '');
  const line = [
    dateStr.padEnd(14),
    runId.padEnd(14),
    'fresh-eyes'.padEnd(11),
    String(rounds).padEnd(4),
    String(counts.p0).padEnd(3),
    String(counts.p1).padEnd(3),
    String(counts.p2).padEnd(3),
    stopReason.padEnd(15),
    relPath,
  ].join(' | ');

  const content = `\n${line}\n`;
  appendFileSync(LEDGER_PATH, content, 'utf-8');
  console.log(`[driver] LEDGER 已追加: ${line}`);
}

/**
 * 读 usage.jsonl 累计某一轮（指定 round 号）各角色的 token 和成本。
 *
 * @param {string} runDir   run 根目录
 * @param {number} roundNum 轮次号（匹配 jsonl 中 round 字段）
 * @returns {{ A: {model,tokens,cost}, B: {model,tokens,cost} }}
 */
function summarizeRoundCost(runDir, roundNum) {
  const usagePath = join(runDir, 'usage.jsonl');
  const summary = {
    A: { model: '', tokens: 0, cost: 0 },
    B: { model: '', tokens: 0, cost: 0 },
  };

  if (!existsSync(usagePath)) return summary;

  const lines = readFileSync(usagePath, 'utf-8').split('\n').filter(Boolean);
  for (const line of lines) {
    let rec;
    try { rec = JSON.parse(line); } catch (err) { console.error('[sofagent:forge] JSON 解析失败，行已跳过', { line: line.substring(0, 100), error: err.message }); continue; }
    if (rec._summary) continue;
    if (rec.round !== roundNum) continue;
    if (!rec.role || !(rec.role in summary)) continue;

    summary[rec.role].model = rec.model || summary[rec.role].model;
    if (rec.total_tokens) summary[rec.role].tokens += rec.total_tokens;
    if (rec.cost_cny)     summary[rec.role].cost   += rec.cost_cny;
  }

  return summary;
}

/**
 * 读 usage.jsonl 全量累计，生成 _summary 行并追加到文件末尾。
 *
 * @param {string} runDir   run 根目录
 * @param {number} rounds   实际跑的轮数
 * @returns {object} summary 对象（也用于 stdout 打印）
 */
function appendUsageSummary(runDir, rounds) {
  const usagePath = join(runDir, 'usage.jsonl');
  const byRole = {
    A: { model: '', prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost_cny: 0 },
    B: { model: '', prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost_cny: 0 },
  };

  if (existsSync(usagePath)) {
    const lines = readFileSync(usagePath, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      let rec;
      try { rec = JSON.parse(line); } catch (err) { console.error('[sofagent:forge] JSON 解析失败，行已跳过', { line: line.substring(0, 100), error: err.message }); continue; }
      if (rec._summary) continue;
      if (!rec.role || !(rec.role in byRole)) continue;

      byRole[rec.role].model = rec.model || byRole[rec.role].model;
      if (rec.prompt_tokens)     byRole[rec.role].prompt_tokens     += rec.prompt_tokens;
      if (rec.completion_tokens) byRole[rec.role].completion_tokens += rec.completion_tokens;
      if (rec.total_tokens)      byRole[rec.role].total_tokens      += rec.total_tokens;
      if (rec.cost_cny)          byRole[rec.role].cost_cny          += rec.cost_cny;
    }
  }

  const totalTokens = byRole.A.total_tokens + byRole.B.total_tokens;
  const totalCost   = byRole.A.cost_cny + byRole.B.cost_cny;

  const summary = {
    _summary:       true,
    total_tokens:   totalTokens,
    total_cost_cny: Number(totalCost.toFixed(6)),
    rounds:         rounds,
    by_role:        byRole,
    a_billing:      MODEL_CONFIGS.A.billing,
  };

  appendFileSync(usagePath, JSON.stringify(summary) + '\n', 'utf-8');
  return summary;
}

// ─── latest.json 指针维护（Dashboard 可见性）─────────────────

/** 指针文件相对路径（用于 JSON 内的 runDir 字段，Dashboard 据此找 round 目录） */
function relativeRunDir(runDir) {
  // 优先相对于 SOFAGENT_HOME/data，fallback 到 REPO_ROOT
  const dataRoot = join(SOFAGENT_HOME, 'data');
  if (runDir.startsWith(dataRoot)) {
    return runDir.replace(dataRoot + sep, '').split(sep).join('/');
  }
  return relative(REPO_ROOT, runDir).split(sep).join('/');
}

/**
 * 聚合 sub-progress-*.jsonl 中的 stall-detected 事件。
 *
 * 扫描 runDir 下所有 sub-progress-<role>.jsonl 文件，提取 event == "stall-detected"
 * 的行，统计总次数，取最后一条的 ts 和 gapMs。
 *
 * @param {string} runDir  run 根目录
 * @returns {{ stallCount:number, stallLastTime:string|null, stallLastGap:number|null }}
 */
function aggregateStallEvents(runDir) {
  const result = { stallCount: 0, stallLastTime: null, stallLastGap: null };
  if (!existsSync(runDir)) return result;

  let subFiles;
  try {
    subFiles = readdirSync(runDir)
      .filter(n => n.startsWith('sub-progress-') && n.endsWith('.jsonl'));
  } catch {
    return result;
  }
  if (subFiles.length === 0) return result;

  // 收集所有 stall-detected 事件（带时间戳以便排序）
  const stallEvents = [];
  for (const file of subFiles) {
    try {
      const lines = readFileSync(join(runDir, file), 'utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        let rec;
        try { rec = JSON.parse(line); } catch (err) { console.error('[sofagent:forge] JSON 解析失败，行已跳过', { line: line.substring(0, 100), error: err.message }); continue; }
        if (rec.event === 'stall-detected') {
          stallEvents.push({
            ts: rec.ts || '',
            gapMs: typeof rec.gapMs === 'number' ? rec.gapMs : 0,
          });
        }
      }
    } catch {
      // 单文件解析失败不影响整体
    }
  }

  if (stallEvents.length === 0) return result;

  // 按时间戳排序取最后一条
  stallEvents.sort((a, b) => a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0);
  result.stallCount = stallEvents.length;
  result.stallLastTime = stallEvents[stallEvents.length - 1].ts;
  result.stallLastGap = stallEvents[stallEvents.length - 1].gapMs;

  return result;
}

/**
 * 从 runDir 下各轮 round 目录提取最新轮的 A/B 进度信息。
 *
 * @param {string} runDir  run 根目录
 * @param {number} currentRound  当前轮次
 * @returns {{ agentA: object, agentB: object }}
 */
function extractAgentStatus(runDir, currentRound) {
  const roundDir = join(runDir, `round-${String(currentRound).padStart(2, '0')}`);

  function agentInfo(role) {
    const subFile = join(roundDir, `sub-progress-${role}.jsonl`);
    const info = { status: 'idle', currentFile: '', findings: 0, cumulative: 'P0×0 P1×0' };

    if (!existsSync(subFile)) return info;

    try {
      const lines = readFileSync(subFile, 'utf-8').split('\n').filter(Boolean);
      if (lines.length === 0) return info;

      // 取最后一条带 target 的事件 → currentFile
      let lastTarget = '';
      for (const line of lines) {
        let rec;
        try { rec = JSON.parse(line); } catch (err) { console.error('[sofagent:forge] JSON 解析失败，行已跳过', { line: line.substring(0, 100), error: err.message }); continue; }
        if (rec.target) lastTarget = rec.target;
      }
      if (lastTarget) {
        // basename（兼容 POSIX 和 Windows）
        info.currentFile = lastTarget.split('/').pop().split(sep).pop() || lastTarget;
      }

      // 判断 status：最近事件是否有 end 标记
      let lastRec = null;
      for (let i = lines.length - 1; i >= 0; i--) {
        try { lastRec = JSON.parse(lines[i]); break; } catch (err) { console.error('[sofagent:forge] JSON 解析失败，行已跳过', { line: lines[i].substring(0, 100), error: err.message }); continue; }
      }
      if (lastRec?.phase === 'end') {
        info.status = 'idle';
      } else if (lastRec?.event === 'llm-chunk') {
        info.status = 'running';
      } else {
        info.status = 'running';
      }
    } catch {
      // 解析失败保持默认
    }

    return info;
  }

  return { agentA: agentInfo('A'), agentB: agentInfo('B') };
}

/**
 * 原子写入 latest.json 指针文件。
 *
 * 写到 SOFAGENT_HOME/data/forge-runs/fresh-eyes-loop/latest.json，
 * Dashboard 通过此文件实时展示 FORGE 审查进度。
 *
 * 原子策略：先写 .latest.json.tmp，再 rename 到 latest.json。
 * Dashboard 不会读到半截文件。
 *
 * @param {string} runDir      run 根目录（绝对路径）
 * @param {object} opts        可选覆盖
 * @param {number} [opts.round]         当前轮次
 * @param {number} [opts.totalRounds]   总轮次
 * @param {string|null} [opts.stopReason]  停止原因
 * @param {string} [opts.statusOverride]  覆盖 agent 状态（启动/结束阶段）
 */
function updateLatestPointer(runDir, opts = {}) {
  try {
    const loopDir = join(SOFAGENT_HOME, 'data', 'forge-runs', 'fresh-eyes-loop');
    mkdirSync(loopDir, { recursive: true });

    const latestPath = join(loopDir, 'latest.json');
    const tmpPath = join(loopDir, '.latest.json.tmp');

    const {
      round = 0,
      totalRounds = 0,
      stopReason = null,
      statusOverride = null,
    } = opts;

    // stall 事件聚合：sub-progress-*.jsonl 实际位于 round-XX/ 子目录，
    // 而 runDir 是 run 根目录，直接扫 runDir 会扫不到文件 → stallCount 恒为 0。
    // 必须按当前轮定位到 round-XX/ 才能统计；round=0（启动时）尚无 round 目录，
    // 退化为 runDir（无文件，stallCount=0，符合预期）。
    const stallScanDir = (round > 0)
      ? join(runDir, `round-${String(round).padStart(2, '0')}`)
      : runDir;
    const stallData = aggregateStallEvents(stallScanDir);

    // agent 状态提取（仅运行中有意义——round > 0 时）
    let agentA, agentB;
    if (round > 0 && !statusOverride) {
      const agents = extractAgentStatus(runDir, round);
      agentA = agents.agentA;
      agentB = agents.agentB;
    } else {
      agentA = { status: statusOverride || 'idle', currentFile: '', findings: 0, cumulative: 'P0×0 P1×0' };
      agentB = { status: statusOverride || 'idle', currentFile: '', findings: 0, cumulative: 'P0×0 P1×0' };
    }

    // 从当前轮的 roundDir 提取 P0/P1 累计（parseStopCondition 的结果由调用者传入）
    const counts = opts.counts || { p0: 0, p1: 0, p2: 0 };
    agentA.cumulative = `P0×${counts.p0} P1×${counts.p1}`;
    agentB.cumulative = `P0×${counts.p0} P1×${counts.p1}`;

    const payload = {
      runDir:      relativeRunDir(runDir),
      round,
      totalRounds,
      stopReason,
      agentA,
      agentB,
      stallCount:   stallData.stallCount,
      stallLastTime: stallData.stallLastTime,
      stallLastGap:  stallData.stallLastGap,
      updatedAt:    new Date().toISOString(),
    };

    // 原子写入：先 tmp 再 rename
    writeFileSync(tmpPath, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
    renameSync(tmpPath, latestPath);
  } catch (err) {
    // latest.json 是观测层，写失败不阻断主流程
    console.warn(`[driver] latest.json 写入失败（不影响主流程）: ${err.message}`);
  }
}

/**
 * 执行一轮（短任务化 24 perspective worker + 合并 + 修复 + 审计 + 验证）。
 *
 * v1.2.9 功能①：短任务化改造——原 a-check/b-check 各 1 个 worker
 * 拆分为 A/B 各 12 个 perspective worker（24 个并行，MAX_CONCURRENCY=6 分批）。
 *
 * v1.2.9 功能②：worker 级断点——每个 perspective worker 完成后更新断点，
 * --resume 时跳过已完成的 worker。
 *
 * @param {number} roundNum  轮次号
 * @param {string} runDir    run 根目录
 * @param {string} target    验证目标版本号
 * @param {boolean} dryRun   dry-run 模式
 * @param {Object} [opts]    可选参数
 * @param {Object} [opts.resumeState]  本轮的 resume 断点（含 completedWorkers）
 * @param {number} [opts.maxRounds]    最大轮数（写入断点）
 * @returns {Promise<{roundDir:string, counts:object, isClean:boolean}>}
 */
async function runRound(roundNum, runDir, target, dryRun, opts = {}) {
  const { resumeState: resumeStateForRound = null, maxRounds: args_maxRoundsForCheckpoint = 10 } = opts;
  const roundDir = join(runDir, `round-${String(roundNum).padStart(2, '0')}`);
  mkdirSync(roundDir, { recursive: true });
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  Round ${roundNum} — ${roundDir}`);
  console.log(`${'═'.repeat(60)}`);

  if (dryRun) {
    console.log('  [dry-run] 将执行以下步骤：');
    console.log(`    ① a-check × 12 视角 (A 独立审查·短任务化)  → check-a-p1~12.md`);
    console.log(`    ② b-check × 12 视角 (B 独立审查·短任务化)  → check-b-p1~12.md   [与①并行]`);
    console.log('    ③ a-consolidate (A 合并 24 份报告)         → findings.md + result.md');
    console.log('    ④ b-fix     (B 修复)                      → summary.md');
    console.log('    ④½ b-audit  (dogfooding)                  → audit-result.md [v1.2.8]');
    console.log('    ⑤ a-verify  (A 验证·分片)                → result.md 回填 verify');
    const counts = parseStopCondition(roundDir);
    return { roundDir, counts, isClean: true };
  }

  // v1.2.9 功能①：步骤 ①② 双盲独立审查——24 个 perspective worker 并行分批
  // 每个 perspective worker 是独立的子进程（零上下文），单视角工具预算 12/15 次，recursionLimit=30。
  // A/B 各 12 个 worker 合计 24 个，按 resolveMaxConcurrency 解析的并发分批执行。
  //
  // v1.3.8 交付八：B 侧复核模式（成本重构）——两段式执行替代全量双盲：
  //   第一段：A 侧 12 个 perspective worker 全量审查（不变）。
  //   第二段：B 侧 12 个 worker 不再全量重审，改为「独立复核 A 的 P0/P1 发现」
  //   （确认/推翻+依据）——B 拿到同视角 A 报告后只做定点验证，探索面收窄，
  //   省 B 侧约一半 token。视角独立性保留：B 仍以自己的视角身份评判，
  //   A 报错的地方 B 可推翻，A 漏报的地方 B 兜底补充（prompt 明示）。
  //   复核指令经 FORGE_B_REVIEW_MODE 环境变量注入 worker（prompt 构造处拼接）。
  console.log('\n  [步骤 ①②] A 全量审查 + B 复核模式（24 perspective worker，并发=' + MAX_CONCURRENCY + '，来源=' + CONCURRENCY_RESOLVED.source + '）...');

  // v1.2.9 功能②：worker 级断点——跳过已完成的 perspective worker（resume 模式）
  const resumeCompletedWorkers = resumeStateForRound?.completedWorkers || [];
  const allPerspectiveWorkers = PERSPECTIVES.flatMap(p => [
    [`a-check-p${p.id}`, roundDir, target],
    [`b-check-p${p.id}`, roundDir, target],
  ]);
  // 过滤掉已完成的 worker（resume 模式跳过）
  const pendingWorkers = allPerspectiveWorkers.filter(
    ([step]) => !resumeCompletedWorkers.includes(step)
  );
  const skippedCount = allPerspectiveWorkers.length - pendingWorkers.length;
  if (skippedCount > 0) {
    console.log(`  [resume] 跳过 ${skippedCount} 个已完成的 perspective worker`);
  }

  // v1.3.8 交付八：两段式拆分——A 批先跑（B 复核依赖 A 产物，不能与 A 并行）
  const pendingAWorkers = pendingWorkers.filter(([step]) => step.startsWith('a-check'));
  const pendingBWorkers = pendingWorkers.filter(([step]) => step.startsWith('b-check'));

  // 跟踪本轮已完成的 worker（用于 worker 级断点）
  const roundCompletedWorkers = [...resumeCompletedWorkers];

  // 批执行闭包：spawn + 断点更新 + 崩溃降级占位（v1.3.8 交付八从原内联逻辑提取，
  // A 批/B 批两段复用，行为与原单批完全一致）
  const runCheckBatch = async (batchWorkers) => {
    if (batchWorkers.length === 0) return { results: [], failures: [] };
    const { results: checkResults, failures: checkFailures } = await spawnParallel(batchWorkers, roundNum);

    // 记录成功完成的 worker（用于 worker 级断点）
    for (const r of checkResults) {
      if (r.value !== null) {
        roundCompletedWorkers.push(r.step);
      }
    }

    // v1.2.9 功能②：worker 级断点——每批 perspective worker 完成后更新断点
    if (!dryRun) {
      try {
        base.saveResumePoint(runDir, {
          round: roundNum,
          completedWorkers: roundCompletedWorkers,
          workers: {},
          counts: { p0: 0, p1: 0, p2: 0 },
          target,
          maxRounds: args_maxRoundsForCheckpoint,
        });
      } catch (ckptErr) {
        console.warn(`  ⚠️  worker 级断点写入失败（不影响主流程）: ${ckptErr.message}`);
      }
    }

    // 降级：perspective worker 崩溃时写部分报告占位，让后续步骤能继续。
    for (const f of checkFailures) {
      console.warn(`\n  ⚠️  ${f.step} 失败: ${f.reason?.message || f.reason}`);
      const outFile = f.step.startsWith('a-check')
        ? `check-a-p${f.step.match(/p(\d+)/)?.[1] || '?'}.md`
        : `check-b-p${f.step.match(/p(\d+)/)?.[1] || '?'}.md`;
      const outPath = join(roundDir, outFile);
      if (!existsSync(outPath)) {
        writeFileSync(outPath,
          `# ${outFile} · ${f.step} 崩溃（降级占位）\n\n` +
          `> ⚠️ worker 异常终止: ${f.reason?.message || f.reason}\n` +
          `> 其他视角的报告仍可用。后续合并步骤会标注此部分缺失。\n`,
          'utf-8');
        console.warn(`     降级：写最小占位 ${outFile}，循环继续`);
      } else {
        console.warn(`     产物 ${outFile} 已存在（stream 抢救成功），保留不覆盖`);
      }
    }
    return { results: checkResults, failures: checkFailures };
  };

  if (pendingWorkers.length > 0) {
    // 第一段：A 侧全量审查（B 复核的对象）
    console.log(`\n  [批次 A] ${pendingAWorkers.length} 个 A perspective worker（全量审查）...`);
    await runCheckBatch(pendingAWorkers);

    // 第二段：B 侧复核模式——FORGE_B_REVIEW_MODE 注入，spawnWorker 按 step
    // 前缀（b-check-p*）透传给 worker 子进程，runWorker 的 prompt 构造读取。
    console.log(`\n  [批次 B] ${pendingBWorkers.length} 个 B perspective worker（复核 A 的 P0/P1 发现）...`);
    const prevReviewMode = process.env.FORGE_B_REVIEW_MODE;
    process.env.FORGE_B_REVIEW_MODE = 'recheck-a-findings';
    try {
      await runCheckBatch(pendingBWorkers);
    } finally {
      if (prevReviewMode === undefined) delete process.env.FORGE_B_REVIEW_MODE;
      else process.env.FORGE_B_REVIEW_MODE = prevReviewMode;
    }
  }

  // 步骤 ③ A 合并
  // 如果 a-consolidate 失败（OOM/recursionLimit/模型错误），降级用两份 check
  // 报告拼接一个 findings.md，让循环能继续走到 b-fix。
  console.log('\n  [步骤 ③] A 合并 check-a + check-b → findings + result...');
  try {
    await spawnWorker('a-consolidate', roundDir, target, roundNum);
  } catch (consolidateErr) {
    console.warn(`\n  ⚠️  a-consolidate 失败: ${consolidateErr.message}`);
    console.warn(`     降级：直接拼接 check-a + check-b 作为 findings.md`);
    writeFallbackFindings(roundDir);
  }

  // 步骤 ④ B 修复（分片执行）
  // 如果 b-fix 整体崩溃（模型错误/API 超时/未预期异常），降级写一个最小 summary.md，
  // 让循环能继续走到 a-verify。findings/result 保留不丢——是审查成果。
  console.log('\n  [步骤 ④] B 按 result.md 修复（分片模式）...');
  try {
    await runBFixSharded(roundDir, target, roundNum);
  } catch (fixErr) {
    console.warn(`\n  ⚠️  b-fix 失败: ${fixErr.message}`);
    console.warn(`     降级：写最小 summary.md，标记 b-fix 未完成，findings/result 保留`);
    writeFileSync(
      join(roundDir, 'summary.md'),
      `# summary.md · b-fix 降级（未完成）\n\n> ⚠️ b-fix 整体失败: ${fixErr.message}\n> findings.md 和 result.md 已保留，可人工介入修复。\n`,
      'utf-8'
    );
  }

  // 步骤 ④½ b-audit（v1.2.8 功能⑥）
  // b-fix 改完代码后，driver 自动 git commit + 跑 sofagent-audit --diff HEAD~1..HEAD。
  // 这就是 dogfooding——FORGE 自己的审计规则审查 FORGE 自己的修改。
  // audit exit 0=全过 1=警告(不阻塞) 2=违规(打回重修)。
  // 设计决策：这里只记录结果不中断循环——fresh-eyes 的循环停止条件由
  // parseStopCondition 独立判定，audit 违规记入 audit-result.md 供后续 review。
  console.log('\n  [步骤 ④½] b-audit — dogfooding 审计 b-fix 改动...');
  try {
    // v1.3.6 交付⑩：worktree 隔离时 git 操作在副本上（b-fix 的 commit 落副本分支），
    // 审计二进制仍从主仓绝对路径加载（副本无 node_modules）。
    const auditResult = await base.runAuditGate(roundDir, 'b-fix', roundNum, {
      gitRoot: (globalWorktree && globalWorktree.worktreeDir) || undefined,
    });
    if (auditResult.passed) {
      console.log(`     ✅ audit gate 通过（exitCode=${auditResult.exitCode}）`);
    } else {
      console.warn(`     ⚠️  audit gate 发现违规（exitCode=${auditResult.exitCode}）`);
      console.warn(`     结果已写入 ${join(roundDir, 'audit-result.md')}`);
      console.warn(`     循环继续——findings 停止条件独立判定`);
    }
  } catch (auditErr) {
    console.warn(`\n  ⚠️  b-audit 失败: ${auditErr.message}`);
    console.warn(`     降级：跳过审计，循环继续`);
  }

  // 步骤 ⑤ A 验证（分片执行）
  // 如果 a-verify 崩溃，降级跳过验证——parseStopCondition 仍能从 findings/result 判停止。
  console.log('\n  [步骤 ⑤] A 验证修复（分片模式）...');
  try {
    await runAVerifySharded(roundDir, target, roundNum);
  } catch (verifyErr) {
    console.warn(`\n  ⚠️  a-verify 失败: ${verifyErr.message}`);
    console.warn(`     降级：跳过验证，result.md verify 列不回填`);
  }

  // 判定停止条件
  const counts = parseStopCondition(roundDir);
  console.log(`\n  [停止判定] P0=${counts.p0} P1=${counts.p1} P2=${counts.p2} FAIL=${counts.hasFail}${counts.isDegraded ? ' DEGRADED' : ''} → ${counts.isClean ? 'CLEAN' : 'NOT-CLEAN'}`);

  // 打印本轮成本摘要
  const costSummary = summarizeRoundCost(runDir, roundNum);
  const aModel = costSummary.A.model || 'qwen3.8-max';
  const bModel = costSummary.B.model || 'glm-5.2';
  console.log(
    `  [Round ${roundNum} 成本] A(${aModel}): ${costSummary.A.tokens.toLocaleString()} tokens / ¥${costSummary.A.cost.toFixed(4)}  |  ` +
    `B(${bModel}): ${costSummary.B.tokens.toLocaleString()} tokens / ¥${costSummary.B.cost.toFixed(4)}  |  ` +
    `合计: ¥${(costSummary.A.cost + costSummary.B.cost).toFixed(4)}`
  );

  return { roundDir, counts, isClean: counts.isClean };
}

// ═══════════════════════════════════════════════════════════
//  可见性：适配器探测
// ═══════════════════════════════════════════════════════════

/**
 * 探测环境中可用的进度适配器。
 *
 * v1.2.0 起 session 监控协议（SKILL.md 定义）替代了 CLI 推送——
 * session 自己每 5 分钟读 status.json，driver 不需要主动推。
 * codebuddy-reporter 已废弃，保留文件供历史参考。
 *
 * 返回空数组——visibility 只写 progress.jsonl + status.json。
 */
async function detectReporters() {
  return [];
}

// ═══════════════════════════════════════════════════════════
//  主入口
// ═══════════════════════════════════════════════════════════

async function main() {
  const args = parseArgs(process.argv);

  // ─── v1.3.8 交付五：liveness 探针（--check-alive <runDir>）───
  // 只认 status.json 心跳不认日志——LLM 长窗口期间日志冻结≠死亡。
  // alive → RC=0 输出 alive；超 90s / 无心跳 → RC=1 输出 dead + 最后 event/phase。
  if (args.checkAlive !== null) {
    const result = checkDriverLiveness(args.checkAlive);
    console.log(`[check-alive] ${args.checkAlive}`);
    console.log(result.report);
    process.exit(result.rc);
  }

  // ─── Worker 模式 ───
  if (args.worker) {
    if (!args.step || !args.roundDir || !args.target) {
      console.error('worker 模式需要 --step --round-dir --target');
      process.exit(1);
    }
    try {
      await runWorker(args.step, args.roundDir, args.target);
      // v1.3.0 run-23 修复：worker 写完产物后强制退出。
      // 若 runWorker 内部残留未清理句柄（LangGraph stream / API 长连接 / 定时器 /
      // audit middleware 监听器），事件循环不清空 → 进程永不退出 → driver 的
      // spawnWorkerStep await 永久挂起（run-23 round-5 b-fix 第 3 批实测 hang 18 分钟）。
      // process.exit 无视残留句柄，强制回收 worker 进程。
      // （workerAliveTimer 同属残留句柄，由 process.exit 一并回收，无需显式清理）
      process.exit(0);
    } catch (err) {
      console.error(`[worker:${args.step}] 失败: ${err.message}`);
      // 打印复合错误的子错误（DeepAgents 的 Multiple errors）
      if (err.errors) {
        console.error('--- 子错误 (' + err.errors.length + ' 条) ---');
        for (const [i, subErr] of err.errors.entries()) {
          console.error(`  [${i}] ${subErr?.message || subErr}`);
          if (subErr?.stack) {
            console.error('     stack:', subErr.stack.split('\n').slice(0, 6).join('\n'));
          }
        }
      } else {
        console.error('--- stack ---');
        console.error(err.stack);
      }
      process.exit(1);
    }
    return;
  }

  // ─── Driver 模式 ───

  // ─── v1.2.8 功能⑦：断点续跑（--resume）───
  // driver 被杀后已完成轮的产物全部有效；--resume 从断点继续，不重跑已完成轮。
  // 铁律：resume 只跳过重跑，不修改任何已有轮产物（findings.md/result.md/summary.md）。
  // dry-run 永远不写断点，也不受 resume 影响（dry-run 分支在下方单独处理）。
  // worker 模式已在上面 return，这里不会进入。
  let resumeState = null;       // loadResumePoint 的结果（null = 无断点）
  let resumeRunDir = null;      // resume 复用的已有 run 目录
  let resumeFromRound = 0;      // 下一轮从这里开始（= 最后完成轮号，循环从 +1 起）

  // ─── v1.3.8 交付五：resume 自动检测 ───
  // 启动时（未显式传 --resume）扫描最近 run 目录的 resume-point.json——
  // 存在未完成断点则打印续跑提示并自动启用 --resume（等价于显式传参）。
  // 🔴 不改 resume 语义：run-29 修复（completedWorkers 只对被续跑轮生效，
  // commit 40d63fb7）在下方 resumeState 消费处保留，此处只做「入口自动接线」。
  // 断点显示 completed 且已达 maxRounds 时 loadResumePoint 的消费逻辑会自然
  // 判「循环已完成」，不会无意义续跑。
  if (!args.resume && !args.dryRun && !args.worker) {
    try {
      const candidate = discoverLatestRunDir();
      if (candidate) {
        const candidateState = base.loadResumePoint(candidate);
        if (candidateState) {
          resumeRunDir = candidate;
          args.resume = true;
          console.log(`🔄 检测到未消费断点（自动进入 resume 模式）:`);
          console.log(`   runDir = ${candidate}`);
          console.log(`   断点   = round ${candidateState.round}` +
            `${Array.isArray(candidateState.completedWorkers) ? `（${candidateState.completedWorkers.length} 个 worker 已完成）` : ''}`);
          console.log(`   提示   = 如需全新 run，请删除该目录或显式换 SOFAGENT_HOME`);
        }
      }
    } catch (probeErr) {
      // 断点探测失败降级为普通启动——探针是优化层不是正确性层
      console.warn(`   ⚠️ resume 断点探测失败（降级为全新启动）: ${probeErr.message}`);
    }
  }

  if (args.resume && !args.dryRun) {
    resumeRunDir = discoverLatestRunDir();
    if (!resumeRunDir) {
      console.warn('⚠️  --resume：未找到任何历史 run 目录，从头开始');
    } else {
      resumeState = base.loadResumePoint(resumeRunDir);
      if (!resumeState) {
        console.warn(`⚠️  --resume：${resumeRunDir} 无有效断点（resume-point.json 不存在或损坏），从头开始`);
        // 无断点 → 从头开始 = 新建 run 目录。
        // 铁律：不能复用旧 runDir 从 Round 1 重跑，否则会覆盖已完成轮的产物。
        resumeRunDir = null;
      } else if (resumeState.completed === true) {
        // completed=true（轮级完成标记，新旧格式都保留）：round 轮已完成 → 从 round+1 继续
        resumeFromRound = resumeState.round;
        console.log(`🔄 resume：断点显示 Round ${resumeState.round} 已完成，从 Round ${resumeFromRound + 1} 继续`);
      } else if (Array.isArray(resumeState.completedWorkers) && resumeState.completedWorkers.length > 0) {
        // v1.2.9 功能②：worker 级断点——本轮有部分 perspective worker 已完成。
        // 重跑本轮但跳过已完成的 worker（runRound 内部用 resumeState.completedWorkers 过滤）。
        resumeFromRound = resumeState.round - 1;
        console.log(`🔄 resume：断点显示 Round ${resumeState.round} 有 ${resumeState.completedWorkers.length} 个 perspective worker 已完成，重跑 Round ${resumeState.round}（跳过已完成 worker）`);
      } else {
        // 无完成标记 → 重跑该轮
        resumeFromRound = Math.max(0, resumeState.round - 1);
        console.log(`🔄 resume：断点显示 Round ${resumeState.round} 未完成，重跑 Round ${resumeState.round}`);
      }
    }
  }

  if (!args.target) {
    // --target 未传时从断点读取 target（v1.2.8 功能⑦）；断点也没有则报错退出
    if (resumeState && typeof resumeState.target === 'string' && resumeState.target) {
      args.target = resumeState.target;
      console.log(`   target    = ${args.target}（从断点恢复）`);
    } else {
      console.error('用法: node FORGE/src/fresh-eyes-driver.mjs --target vX.Y.Z [--max-rounds N] [--dry-run] [--resume]');
      console.error('      --resume 模式也需 --target，除非断点中已保存 target');
      process.exit(1);
    }
  }

  // resumeFromRound >= maxRounds → 循环已完成，无需续跑（正常退出）
  if (resumeFromRound >= args.maxRounds) {
    console.log(`✅ 循环已完成（断点轮 ${resumeFromRound} ≥ max-rounds ${args.maxRounds}），无需续跑`);
    process.exit(0);
  }

  // ─── 防 macOS 后台节流（v1.2.4 · P0）───
  // 背景：run-03 Round 5 在 macOS 后台被节流冻结 2h44m，driver 零感知。
  // 根因：macOS App Nap / timer throttling 挂起后台 node 进程。
  // 方案：darwin 平台下用 caffeinate -dimsu -w <pid> 绑定自身 pid，
  // 防止系统空闲休眠与 App Nap 冻结定时器。非 darwin 平台跳过。
  // caffeinate 以子进程方式启动（unref），driver 退出时操作系统自动回收。
  //
  // Anti-macOS background throttle (v1.2.4 · P0).
  // Bind caffeinate -dimsu -w <pid> to prevent App Nap timer freeze.
  // Non-darwin: skip. caffeinate auto-reaped on driver exit.
  if (process.platform === 'darwin' && !args.dryRun) {
    try {
      const caf = spawn('caffeinate', ['-dimsu', '-w', String(process.pid)], {
        stdio: 'ignore',
      });
      caf.unref(); // driver 退出即自动解除 / auto-released on driver exit
      console.log(`   防休眠     = caffeinate 已绑定 pid=${process.pid}`);
    } catch (err) {
      // caffeinate 不可用时降级为警告，不阻断主流程
      // Fallback to warning if caffeinate unavailable, do not block
      console.warn(`   防休眠     = ⚠️ caffeinate 不可用（${err.message}），降级运行`);
    }
  }

  // ─── 全局异常兜底（v1.2.7 · P0）───
  // 背景：进程被 OS 直接杀死（OOM SIGKILL）时 main().catch() 不执行，
  // status.json 停在 "round-N-running" 永远不会更新。
  // 方案：在 main() 调用之前注册 uncaughtException / unhandledRejection handler，
  // 确保任何致命路径都更新 latest.json 的 stopReason 为 'fatal-crash'。
  process.on('uncaughtException', (err) => {
    console.error(`\n💥 uncaughtException: ${err.message}`);
    console.error(err.stack);
    if (preservedRunDir) {
      try { updateLatestPointer(preservedRunDir, { round: preservedActualRounds, totalRounds: preservedTotalRounds, stopReason: 'fatal-crash', counts: preservedFinalCounts }); } catch {}
    }
    safeTeardownWorktree(); // v1.3.6 交付⑩：崩溃路径也清理 worktree
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    console.error(`\n💥 unhandledRejection: ${reason instanceof Error ? reason.message : String(reason)}`);
    if (reason instanceof Error) console.error(reason.stack);
    if (preservedRunDir) {
      try { updateLatestPointer(preservedRunDir, { round: preservedActualRounds, totalRounds: preservedTotalRounds, stopReason: 'fatal-crash', counts: preservedFinalCounts }); } catch {}
    }
    safeTeardownWorktree(); // v1.3.6 交付⑩：崩溃路径也清理 worktree
    process.exit(1);
  });

  // 验证环境变量
  const missingEnvs = [];
  for (const role of ['A', 'B']) {
    const cfg = MODEL_CONFIGS[role];
    if (!process.env[cfg.apiKeyEnv])  missingEnvs.push(cfg.apiKeyEnv);
    if (!process.env[cfg.specEnv])    missingEnvs.push(cfg.specEnv);
  }
  if (missingEnvs.length > 0 && !args.dryRun) {
    console.error(`缺少环境变量: ${missingEnvs.join(', ')}`);
    console.error('请在 ~/.zshrc 中设置后 source ~/.zshrc');
    process.exit(1);
  }

  // ─── preflight-check 跑前自检 ───
  // 开跑前把环境前置条件全部验一遍（路径/管道/API/预算/目录/磁盘），
  // 避免 15-60 分钟的长任务跑到一半因环境问题崩溃。
  // 铁律：dry-run 跳过（不真跑 worker，检查无意义）；preflight 自身异常
  // 降级 WARN 绝不阻塞；HALT 级失败才 exit(1)。
  if (!args.dryRun) {
    let preflightResult;
    try {
      preflightResult = await runPreflight({
        repoRoot: REPO_ROOT,
        runDir: join(RUNS_DIR, 'fresh-eyes-loop'), // 预检 runs 根目录可写（幂等 mkdir）
        modelConfigs: MODEL_CONFIGS,
        roles: ['A', 'B'],
        loopName: 'fresh-eyes-loop',
        toolConfig: {
          globalSoft: TOOL_SOFT_LIMIT, globalHard: TOOL_HARD_LIMIT,
          perspectiveSoft: PERSPECTIVE_TOOL_SOFT, perspectiveHard: PERSPECTIVE_TOOL_HARD,
        },
      });
    } catch (pfErr) {
      // preflight 模块自身异常——降级 WARN，绝不因检查工具故障阻塞主流程
      console.warn(`   ⚠️ preflight-check 自身异常（降级跳过）: ${pfErr.message}`);
      preflightResult = null;
    }
    if (preflightResult) {
      console.log(formatPreflightReport(preflightResult));
      if (preflightResult.shouldHalt) process.exit(1);
    }
  }

  // 建 run 目录（v1.2.8 功能⑦：resume 模式复用已有目录，不新建）
  const { runDir, runId, dateStr } = resumeRunDir
    ? resolveRunDirInfo(resumeRunDir)
    : resolveRunDir();

  // ─── v1.3.6 worktree 留存根治：启动时陈旧兜底扫描 ───
  // 信号清理（下方 registerSignalCleanup）也可能失败——SIGKILL 无法捕获、
  // cleanup 中途再被打断。这里扫描 runs 根目录下超 7 天的陈旧 worktree 收走
  // （跳过本次 run 目录）。分支照旧保留（回流闸门），只清目录与 git 注册。
  try {
    const stale = base.cleanupStaleWorktrees({ runsRoot: RUNS_DIR, excludeRunDir: runDir });
    if (stale.cleaned > 0) {
      console.log(`   陈旧清理   = 收走 ${stale.cleaned} 个超 7 天的遗留 worktree（分支保留待回流）`);
      for (const line of stale.detail) console.log(`     · ${line}`);
    }
  } catch (staleErr) {
    console.warn(`   ⚠️ 陈旧 worktree 扫描失败（不阻塞）: ${staleErr.message}`);
  }

  // ─── v1.3.6 交付⑩：worktree 隔离（run-07 事故根因修复）───
  // 审查 worker 与主仓共享工作目录导致两次进程死亡 + 红队残留污染主仓。
  // driver 在 runDir 内建 worktree 副本，worker 的 git 写入全落副本分支；
  // 主仓 git status 全程干净，主仓历史零污染。失败降级（不隔离直跑），
  // 绝不因隔离基建故障阻塞审查主流程。dry-run 跳过（不真跑 worker）。
  if (!args.dryRun) {
    try {
      globalWorktree = base.setupWorktree(runDir, { runId });
      console.log(`   隔离模式   = worktree ${globalWorktree.reused ? '复用' : '新建'}（分支 ${globalWorktree.branch}，基线 ${globalWorktree.baseSha.slice(0, 8)}）`);
    } catch (wtErr) {
      console.warn(`   ⚠️ worktree 隔离创建失败（降级为共享主仓模式）: ${wtErr.message}`);
      globalWorktree = null;
    }
  }

  // ─── v1.3.6 worktree 留存根治：SIGTERM/SIGINT 信号清理 ───
  // 背景（run-03 2026-08-17）：人工 pkill 终止 driver 时 teardown 不执行，
  // worktree（~80MB）+ git 注册永久留存。此 handler 确保任何终止信号都先清
  // 理再退出；正常结束路径解除（disarm）避免重复 teardown。
  const disarmSignalCleanup = base.registerSignalCleanup({
    cleanup: () => {
      safeTeardownWorktree();
      try {
        updateLatestPointer(runDir, {
          round: preservedActualRounds,
          totalRounds: args.maxRounds,
          stopReason: 'aborted-signal',
          counts: preservedFinalCounts,
        });
      } catch { /* latest.json 更新失败不阻塞退出 */ }
    },
    stopReason: 'aborted-signal',
  });

  // ─── 可见性：启动时探测可用适配器并初始化 ───
  const reporters = await detectReporters();
  const visibility = createVisibility(runDir, reporters);
  globalVisibility = visibility;  // 暴露给 catch 块
  visibility.emit(EVENTS.RUN_START, {
    target: args.target,
    maxRounds: args.maxRounds,
    runDir: runDir.replace(REPO_ROOT + '/', ''),
  });
  console.log(`   可见性     = ${reporters.length} 个适配器${reporters.map(r => ` [${r.name}]`).join('')}`);

  // 🔴 v1.2.7 心跳定时器（run-01 SIGKILL 教训）。
  // SIGKILL 杀进程时所有 Node handler 都来不及执行，status.json 停在上一次状态。
  // 解法：每 15s 更新 heartbeat 字段，监控端可判断"超 60s 没更新 = driver 已死"。
  const heartbeatTimer = setInterval(() => {
    try { visibility.heartbeat(); } catch { /* 心跳失败不中断 */ }
  }, 15_000);

  console.log(`\n🔍 fresh-eyes-loop 启动`);
  console.log(`   target    = sofagent ${args.target}`);
  console.log(`   max-rounds = ${args.maxRounds}`);
  console.log(`   run-dir    = ${runDir}`);
  console.log(`   dry-run    = ${args.dryRun}`);
  // v1.2.8 功能⑦：启动日志打印 resume 状态
  if (args.resume && !args.dryRun) {
    if (resumeState) {
      console.log(`   resume     = 断点恢复（最后完成轮 ${resumeFromRound}，从 Round ${resumeFromRound + 1} 继续）`);
    } else {
      console.log(`   resume     = 无有效断点，从头开始`);
    }
  }
  console.log(`   A          = ${MODEL_CONFIGS.A.model} (${MODEL_CONFIGS.A.baseURL})`);
  console.log(`   B          = ${MODEL_CONFIGS.B.model} (${MODEL_CONFIGS.B.baseURL})`);

  // latest.json 指针：启动时写一次（Dashboard 立即看到 driver 已启动）
  updateLatestPointer(runDir, {
    round: 0,
    totalRounds: args.maxRounds,
    statusOverride: 'starting',
  });

  // 为 fatal-error catch 块保留 latest.json 上下文
  preservedRunDir       = runDir;
  preservedTotalRounds  = args.maxRounds;
  preservedStopReason   = null;

  // ─── 状态变量：resume 模式从断点恢复，否则全部归零 ───
  // v1.2.8 功能⑦：断点里存了最后完成轮的状态摘要（cleanStreak / counts /
  // severityHistory / consecutiveDegraded），恢复后收敛判定逻辑与不中断时等价。
  let cleanStreak   = 0;
  let stopReason    = 'max-rounds';
  let actualRounds  = resumeFromRound;   // 已完成轮数（resume 起点；fresh run 为 0）
  let finalCounts   = { p0: 0, p1: 0, p2: 0 };
  let severityHistory = [];  // #13 每轮 (P0+P1) 趋势，用于加权收敛检测
  // v1.2.7：连续降级检测——run-06 教训：3 轮全降级消耗 132k tokens 零产出。
  // 连续 2 轮 isDegraded=true → 直接 error 退出，不浪费 token 跑无意义的循环。
  let consecutiveDegraded = 0;

  if (resumeState) {
    if (resumeState.counts && typeof resumeState.counts === 'object') {
      finalCounts = {
        p0: resumeState.counts.p0 ?? 0,
        p1: resumeState.counts.p1 ?? 0,
        p2: resumeState.counts.p2 ?? 0,
      };
    }
    if (typeof resumeState.cleanStreak === 'number') cleanStreak = resumeState.cleanStreak;
    if (typeof resumeState.consecutiveDegraded === 'number') consecutiveDegraded = resumeState.consecutiveDegraded;
    if (Array.isArray(resumeState.severityHistory)) severityHistory = [...resumeState.severityHistory];
    // fatal-error 兜底：新轮还没跑完就崩时，catch 块至少保留已完成轮的数据
    preservedActualRounds = resumeFromRound;
    preservedFinalCounts  = { ...finalCounts };
    console.log(
      `   断点状态   = counts P0=${finalCounts.p0} P1=${finalCounts.p1} P2=${finalCounts.p2} ` +
      `cleanStreak=${cleanStreak} severity=[${severityHistory.join(',')}]\n`
    );
  }

  for (let round = resumeFromRound + 1; round <= args.maxRounds; round++) {
    actualRounds = round;
    visibility.emit(EVENTS.ROUND_START, { round, target: args.target });

    // #14 轮内实时刷新：轮执行期间每 30s 刷一次 latest.json，
    // 让 Dashboard 不用等轮结束就能看到 stall / agent 状态变化。
    // 轮结束（runRound resolve）后自动清理定时器。
    const intraRoundTimer = setInterval(() => {
      try {
        updateLatestPointer(runDir, {
          round,
          totalRounds: args.maxRounds,
          counts: finalCounts,
        });
      } catch { /* 刷新失败不中断主流程 */ }
    }, 30_000);

    let runRoundResult;
    try {
      // v1.2.9 功能②：传入 resume 断点（含 completedWorkers），让 runRound 跳过已完成的 perspective worker
      // v1.3.7 run-29 修复：completedWorkers 只对「被续跑的那一轮」生效——
      // 此前 resumeState 原样传入每一轮，Round N+1 作为全新轮也被迫跳过 24 个
      // worker，但其 round-N+1/ 目录是空的 → consolidate INPUT-MISSING 降级 ×3
      // → consecutive-degraded-error 优雅退出（run-29 实录）。
      const isResumedRound = round === resumeState?.round;
      runRoundResult = await runRound(round, runDir, args.target, args.dryRun, {
        resumeState: isResumedRound ? resumeState : null,
        maxRounds: args.maxRounds,
      });
    } finally {
      clearInterval(intraRoundTimer);
    }

    const { roundDir, counts, isClean } = runRoundResult;
    finalCounts = counts;
    // #13 记录本轮 severity 趋势
    severityHistory.push(counts.p0 + counts.p1);
    // 快照——如果后续轮 fatal-error，catch 块用这组数据，不清零
    preservedActualRounds = actualRounds;
    preservedFinalCounts   = { ...finalCounts };

    // ─── v1.2.8 功能⑦：断点写入闭包 ───
    // 每轮完成后写 resume-point.json（runDir 根目录，不是 round 子目录）。
    // 铁律：dry-run 永远不写断点；断点只存状态摘要不存大体积数据；
    // 写失败不阻断主流程（断点是优化层不是正确性层）。
    // 调用时机：本轮 cleanStreak / consecutiveDegraded 更新完毕之后，
    // 保证 resume 恢复时拿到的正是本轮完成那一刻的状态。
    const saveRoundCheckpoint = () => {
      if (args.dryRun) return;
      try {
        base.saveResumePoint(runDir, {
          round,
          // v1.2.9 功能②：worker 级断点——轮完成后 completedWorkers 标记为全部完成
          completedWorkers: [],
          completed: true,
          counts,
          cleanStreak,
          consecutiveDegraded,
          severityHistory,
          target: args.target,
          maxRounds: args.maxRounds,
        });
      } catch (ckptErr) {
        console.warn(`  ⚠️  断点写入失败（不影响主流程）: ${ckptErr.message}`);
      }
    };

    // 可见性：每轮结束 emit（含停止判定结果）
    visibility.emit(EVENTS.ROUND_END, {
      round,
      counts,
      isClean,
    });

    // latest.json 指针：每轮结束更新（Dashboard 实时刷新进度）
    updateLatestPointer(runDir, {
      round,
      totalRounds: args.maxRounds,
      counts,
    });

    if (args.dryRun) {
      // dry-run 只跑一轮示意
      stopReason = 'dry-run';
      break;
    }

    // v1.2.7：连续降级 → 直接 error 退出
    // run-06 教训：3 轮全降级消耗 132k tokens 零产出
    // v1.3.1 run-03 教训：原阈值 >=2 太激进——run-03 因 P0 比例阈值修复前的
    // 一票否决误伤（1 份短产物连累整轮），连续 2 轮误判降级即触发熔断，
    // 循环在第 2 轮就被腰斩，没给第 3 轮自我修复机会。改为 >=3：与 run-06
    // 原始教训（3 轮全降级）精确对齐，给偶发降级 1 次容错。
    if (counts.isDegraded) {
      consecutiveDegraded++;
      if (consecutiveDegraded >= 3) {
        console.error(`\n💥 连续 ${consecutiveDegraded} 轮降级，循环无产出意义，直接退出`);
        stopReason = 'consecutive-degraded-error';
        preservedStopReason = stopReason;
        saveRoundCheckpoint();  // v1.2.8 功能⑦：退出前写断点（本轮已完成）
        break;
      }
    } else {
      consecutiveDegraded = 0;
    }

    if (isClean) {
      cleanStreak++;
      console.log(`\n  ✅ 干净轮 (${cleanStreak}/2)`);
      if (cleanStreak >= 2) {
        stopReason = '2-rounds-clean';
        saveRoundCheckpoint();  // v1.2.8 功能⑦：退出前写断点（本轮已完成）
        break;
      }
    } else {
      cleanStreak = 0;
      // #13 加权收敛：不干净但趋势已收敛到极低位时，提前停止
      if (detectWeightedConvergence(severityHistory)) {
        console.log(`\n  📉 加权收敛：近 3 轮 severity=${severityHistory.slice(-3).join('→')}，已收敛到极低位，提前停止`);
        stopReason = 'weighted-convergence';
        saveRoundCheckpoint();  // v1.2.8 功能⑦：退出前写断点（本轮已完成）
        break;
      }
      console.log(`\n  ❌ 本轮有 P0/P1/FAIL，进入下一轮`);
    }

    // v1.2.8 功能⑦：本轮完成（进入下一轮前）写断点——
    // 进程若在轮间被杀，resume 从本轮的下一轮继续，本轮成果不丢。
    saveRoundCheckpoint();
  }

  // usage.jsonl 全量摘要（非 dry-run）
  if (!args.dryRun) {
    const usageSummary = appendUsageSummary(runDir, actualRounds);
    // token 为主的展示格式——A/B 均为 Qwen Token Plan 订阅制，不硬凑按量成本
    console.log(
      `\n  [总用量] tokens: ${usageSummary.total_tokens.toLocaleString()}  ` +
      `(A/B 均 Qwen Token Plan 订阅制，不按量计价)`
    );
    console.log(
      `           A(${usageSummary.by_role.A.model || 'qwen3.8-max'}):       ` +
      `${usageSummary.by_role.A.total_tokens.toLocaleString()} tokens  [Token Plan 订阅额度]`
    );
    console.log(
      `           B(${usageSummary.by_role.B.model || 'glm-5.2'}):   ` +
      `${usageSummary.by_role.B.total_tokens.toLocaleString()} tokens  [Token Plan 订阅额度]`
    );
  }

  // 写 LEDGER
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  循环结束 — 停止原因: ${stopReason}`);
  console.log(`  实际轮数: ${actualRounds}  最终: P0=${finalCounts.p0} P1=${finalCounts.p1} P2=${finalCounts.p2}`);
  console.log(`${'═'.repeat(60)}`);

  if (!args.dryRun) {
    appendLedger(dateStr, runId, actualRounds, finalCounts, stopReason, runDir);
  }

  // 可见性：整个循环结束
  visibility.emit(EVENTS.LOOP_END, {
    actualRounds,
    stopReason,
    counts: finalCounts,
  });

  // 🔴 v1.2.7 清理心跳定时器
  clearInterval(heartbeatTimer);

  // latest.json 指针：driver 结束时更新（标记停止原因，Dashboard 不再显示"运行中"）
  updateLatestPointer(runDir, {
    round: actualRounds,
    totalRounds: args.maxRounds,
    stopReason,
    counts: finalCounts,
  });

  // v1.3.6 worktree 留存根治：正常结束解除信号清理（后续 safeTeardownWorktree 兜底）
  disarmSignalCleanup();

  // v1.3.6 交付⑩：正常结束清理 worktree（run 结束 worktree 清理 + LEDGER 留行）
  safeTeardownWorktree();

  console.log('\n✅ fresh-eyes-loop 完成\n');
}

main().catch(err => {
  console.error(`\n💥 致命错误: ${err.message}`);
  console.error(err.stack);
  // 🔴 v1.2.7 清理心跳定时器（catch 路径）
  // 注意：heartbeatTimer 是 main() 内的局部变量，这里无法直接 clearInterval。
  // 但 process.exit(1) 会清理所有定时器，所以不是问题。
  // 可见性：失败路径也要写事件——否则 Dashboard 看到"永远在跑"。
  // 🔴 v1.2.2 教训（run-07）：catch 块曾把 actualRounds/counts 归零，
  // 导致明明跑完 Round 1（5 P0 + 11 P1）的成果全部消失。
  // 现在保留 main() 的 finalCounts——如果一轮都没跑完才为 0。
  if (globalVisibility) {
    globalVisibility.emit(EVENTS.ERROR, {
      message: err.message,
      stack: err.stack?.split('\n').slice(0, 3).join(' | '),
    });
    globalVisibility.emit(EVENTS.LOOP_END, {
      actualRounds: preservedActualRounds,
      stopReason: 'fatal-error',
      counts: preservedFinalCounts,
    });
  }

  // latest.json 指针：fatal-error 时也更新（Dashboard 能看到最终状态）
  if (preservedRunDir) {
    updateLatestPointer(preservedRunDir, {
      round: preservedActualRounds,
      totalRounds: preservedTotalRounds,
      stopReason: 'fatal-error',
      counts: preservedFinalCounts,
    });
  }

  // v1.3.6 交付⑩：fatal-error 路径也清理 worktree（异常退出同样清理——铁律）
  safeTeardownWorktree();

  process.exit(1);
});
