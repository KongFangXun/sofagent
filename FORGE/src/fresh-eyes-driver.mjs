#!/usr/bin/env node
// ============================================================
// fresh-eyes-driver.mjs · fresh-eyes 单步角色执行器
//
// 定位（2026-09-26 整合归一）：多轮编排循环入口已退役——编排职责归
// harness session（注入主任务协议即跑，SSOT = FORGE/SKILL/fresh-eyes-loop/
// loop.md「执行形态」节）。本文件只保留 worker 单步执行链路，作为协议
// 角色执行三通道的通道②执行器。
//
// 用法：
//   node FORGE/src/fresh-eyes-driver.mjs --worker --step <step> --round-dir <abs> --target <ver>
//
// 保留机制：DSH 后端桥接（langgraph 显式回退）· worktree 隔离继承
// （FORGE_WORKTREE_ROOT 环境变量，由编排方注入）· 工具软硬熔断 ·
// 报告质量门控 · 零发现假绿检测 · usage 记账 · 经验飞轮
// ============================================================

import { spawn, execSync } from 'child_process';
import { createRequire } from 'module';
import {
  readFileSync, writeFileSync, mkdirSync, existsSync,
  appendFileSync, readdirSync, renameSync, statSync,
  unlinkSync,
} from 'fs';
import { createHash } from 'crypto';
import { join, resolve, dirname, relative, sep, basename } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

// v1.2.7 功能⑤：继承 driver-base 公共编排层
import { createForgeDriverBase } from './driver-base.mjs';

// v1.2.1 L2：SubAgent 内部可观测（工具调用序列 + 模型推理心跳）
// v1.2.4 新增 StallError 导出（watchdog 停顿检测错误类）
import { createProgressMiddleware, StallError } from './progress-middleware.mjs';

// v1.3.0 (交付 10 MA4)：FORGE worker 经验共享飞轮——FORGE_MEMORY_BACKEND
// 启用时 worker 启动前检索历史经验、完成后写入本次发现。
// 缺省 unset = 完全不变（与 v1.2.9 行为一致）。
import { memorySearch, memoryWrite, getMemoryBackendEndpoint } from './memory-client.mjs';

// v1.3.6 交付⑩：FORGE 隔离加固——worktree 隔离状态（run-07 事故根因修复）。
// driver 启动时在 runDir 内建 worktree 副本，worker 的 git 写入全落副本分支；
// run 结束（正常/异常/中止）teardown 清理，主仓 git status 全程干净。
// worker 子进程通过 FORGE_WORKTREE_ROOT 环境变量继承隔离副本路径（spawn 时注入）。
let globalWorktree = process.env.FORGE_WORKTREE_ROOT
  ? { worktreeDir: process.env.FORGE_WORKTREE_ROOT }
  : null;
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = resolve(__dirname, '../..');
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

// A/B/V/F 统一 glm-5.3（智谱 Coding Plan 订阅制），共用 GLM_API_KEY（v1.4.1 起）。
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
// 修复/验证类步骤（b-fix/c-verify）是有限任务，5 步够用
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
// v1.3.9 P2-1 调优（2026-08-21）：50/60。run-01 round-3 实测 24 个 worker 里
// 79% 撞 51-60 次硬熔断产出碎片（B 组 11/12 碎片）——V4 Flash 在 50 次预算内
// 收敛困难，40/50 对 deepseek-v4-flash 过紧。50/60 给复杂视角（红队/代码审读者）
// 更充裕的完成空间；配合模板收敛指令（合理用量 8-15 次）控制成本，不回到
// run-06 全局 60/80 覆辙。
const PERSPECTIVE_TOOL_SOFT = 50;
const PERSPECTIVE_TOOL_HARD = 60;

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
// + a-consolidate 合并报告 + b-fix/b-audit/c-verify 不变（单盲默认 12 份）。

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

function buildPerspectiveSteps() {
  const steps = {};
  // 单盲改造：B 侧双盲 check 默认不生成——A 审（12 视角）→ B 修（b-fix）
  // → C 验（c-verify）→ D 复核（d-review）四角色流水线取代 A/B 双盲。
  // FORGE_ENABLE_B_CHECK=1 为 legacy 逃生门：恢复 24 视角双盲（含 B 侧报告
  // 合并、成本翻倍），仅用于回归对照或四角色链故障时降级回旧链。
  const enableBCheck = process.env.FORGE_ENABLE_B_CHECK === '1';
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
      // v1.3.9 P2-1：预算 50/60 → recursionLimit 130（60 次工具 × 2 步 + 10 冗余）。
      recursionLimit: 130,
      toolSoftLimit: PERSPECTIVE_TOOL_SOFT,
      toolHardLimit: PERSPECTIVE_TOOL_HARD,
    };
    if (enableBCheck) {
      steps[`b-check-p${p.id}`] = {
        role: 'B',
        prompt: `b-check-perspective-${p.id}.md`,
        outputs: [`check-b-p${p.id}.md`],
        inputs: [],
        perspective: p.label,
        recursionLimit: 130,
        toolSoftLimit: PERSPECTIVE_TOOL_SOFT,
        toolHardLimit: PERSPECTIVE_TOOL_HARD,
      };
    }
  }
  return steps;
}

const STEPS = {
  // v1.2.9 功能①：A/B 各 12 个 perspective worker（短任务化）
  ...buildPerspectiveSteps(),
  // a-consolidate 合并 perspective 报告（单盲默认 A 侧 12 份；legacy 双盲 24 份）
  // maxTokens：步骤级输出 token 上限覆盖。未定义时回退到 MODEL_CONFIGS[role].maxTokens。
  // a-consolidate 需合并 A/B 两份完整 12 视角报告为单份 findings，输出超长，
  // 单独调高到 32000，避免顶格 16000 被截断生成不了合法 result.md（整轮降级根因）。
  // v1.3.0 run-21 修复：a-consolidate 必须读 24 份 check 报告（inputs 只注入路径，
  // 内容仍需 sf_read），工具调用天然 40-60 次，撞全局 45 硬熔断后裸 LLM 兜底产物
  // 缺 ===FILE: 分隔符 → result.md 判空 → b-fix 跳过 → 假绿停止（run-21 3 轮全丢）。
  // 单独提高预算：check worker 已有 12/15 覆盖（不受影响），不重蹈 run-06 全局 60/80 覆辙。
  // v1.4.4 优化四：增量模式下 a-consolidate 只收裁剪视角的报告——inputs
  // 由静态 24 份改为动态构造（本轮 activePerspectives）。全量模式行为不变。
  // 单盲改造：inputs 动态取 buildPerspectiveSteps 实际生成的视角步骤（默认仅
  // A 侧 12 份；FORGE_ENABLE_B_CHECK=1 时恢复 A+B 24 份）。
  'a-consolidate': {
    role: 'A',
    prompt: 'a-consolidate.md',
    outputs: ['findings.md', 'result.md'],
    // 动态 inputs：与 buildPerspectiveSteps 的开关口径一致（b-check 默认不生成
    // → inputs 不含 check-b-pN，worker 端 sf_read 不会尝试读不存在的文件）。
    inputs: Object.values(buildPerspectiveSteps()).flatMap(s => s.outputs),
    maxTokens: 32000,
    toolSoftLimit: 60,
    toolHardLimit: 80,
  },
  'b-fix':         { role: 'B', prompt: 'b-fix.md',         outputs: ['summary.md'],             inputs: ['result.md','findings.md'] },
  // v1.2.8 功能⑥：b-audit 步骤——b-fix 改完代码后 driver 自动跑 sofagent-audit
  'b-audit':       { role: null, prompt: null,              outputs: ['audit-result.md'],        inputs: [], driverFn: 'runAuditGate' },
  // 单盲改造：c-verify 取代 a-verify——A 兼任发现者+验证者是「原告兼法官」，
  // C 为独立验收者（零上下文、与 A 无信息通路），每条亲手实测不采信自报。
  'c-verify':      { role: 'C', prompt: 'c-verify.md',      outputs: ['result.md'],              inputs: ['findings.md','result.md','summary.md'] },
  // 单盲改造新增：d-review——对抗性复核者 D，只处理 P0/P1，
  // 产出 CONFIRM/DOWNGRADE/REOPEN 裁决 + 尾部 REOPEN_COUNT: N 机器可读行。
  'd-review':      { role: 'D', prompt: 'd-review.md',      outputs: ['d-review.md'],            inputs: ['findings.md','result.md','summary.md'] },
};

// ═══════════════════════════════════════════════════════════
//  CLI 参数解析
// ═══════════════════════════════════════════════════════════
function parseArgs(argv) {
  const args = { worker: false, step: null, roundDir: null, target: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--worker')      args.worker   = true;
    else if (a === '--step')      args.step     = argv[++i];
    else if (a === '--round-dir') args.roundDir = argv[++i];
    else if (a === '--target')    args.target   = argv[++i];
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
 * 当前配置：A = B = glm-5.3（智谱 Coding Plan 订阅制，v1.4.1 起）。
 * 换模型只改 FORGE/models/profile.mjs，不需要改 driver 代码。
 *
 * 参数注入按模型文件声明的字段自适应：glm-5.3 同时定义 thinking 与 reasoningEffort，
 * 两个条件分支都会注入（见 FORGE/models/glm-5.3.mjs 字段为准）——历史注记：
 * deepseek-v4-flash 时代仅 reasoningEffort='max' + temperature=1.0（无 thinking 字段）。
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
import { createGateTools } from './gate-tools.mjs';

/**
 * v1.4.3 第六章步二：fresh-eyes 全 step 走 DSH（分级切完成）。
 *
 * 分级切历史（从弱到强依序交付）：
 *   v1.3.9：b-fix（执行类）先切 dsh——rc 期守卫自动降级投产验证
 *   v1.4.3 步一：DSH 事件流三职责重建（session.events → streamHandler 回放
 *   ——报告捕获/软硬熔断/usage 记账），DSH 后端行为与 langgraph 等深
 *   v1.4.3 步二：a-verify → a-consolidate → check worker（流式依赖从弱到强）
 *   依次切换，切换前双后端镜像验证（同 prompt 两后端跑 findings 一致性比对
 *   ——v1.3.9 backend-ab 方法论复用）
 *
 * 降级链保留：DSH 路径异常 fallback LangGraph 且产物不丢（红线不动——
 * execution-backend 工厂层 fallback 机制不变）。
 *
 * 环境变量覆盖链：FORGE_FRESH_EYES_BACKEND（整体）> SOFAGENT_EXECUTION_BACKEND > 缺省 dsh
 */
function resolveFreshEyesBackend(step) {
  const envOverride = process.env.FORGE_FRESH_EYES_BACKEND || process.env.SOFAGENT_EXECUTION_BACKEND;
  if (envOverride === 'langgraph' || envOverride === 'dsh') return envOverride;
  // v1.4.3 第六章步二：全 step 切 dsh（镜像验证通过；FORGE_FRESH_EYES_BACKEND=langgraph 显式回退口保留）
  void step;
  return 'dsh';
}

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
            // v1.3.9 六十一：worker 工具拦截消息加 [sofagent 审计] 签名前缀（与 audit-middleware.mjs 同口径）
            return `⛔ [sofagent 审计] 拦截：${rawTool.name} 被拒绝执行：${verdict.reason}`;
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

  // 从环境变量读取轮次号（由编排方通过 FORGE_ROUND 注入）
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
  let promptTemplate = readFileSync(join(PROMPTS_DIR, stepDef.prompt), 'utf-8');

  // v1.3.9 P2-2：perspective worker 公共收敛指令注入（单点生效，不逐个改 24 个模板）。
  // run-01 round-3 实测：V4 Flash 在模板已有的"合理用量 8-15 次"引导下仍普遍撞
  // 51-60 次硬熔断（B 组 11/12 碎片）——模板引导不够硬。这里在注入层追加强收敛
  // 指令，对未来新增视角同样生效。
  if (stepDef.perspective) {
    promptTemplate += `

## 🔴 收敛要求（v1.3.9 强化）

0. **开工即先写报告骨架**（章·步零 A 侧收敛指令）：读任务后先用 sf_write 把报告骨架
   （各章节标题 + 你计划核验的问题清单）写入产物文件，之后每完成一项探查就回填一项——
   探查只是验证骨架里的假设，不是开放式漫游。零成本防撞熔断后从零补写报告。
1. 证据充分立即停止探索：目标 **8-15 次工具调用**完成本视角审查，软上限 50 次、硬上限 60 次。
2. **到第 40 次工具调用时必须转入写报告**，禁止继续探索。
3. 同一文件最多读 2 次；同一关键词最多 grep 2 次——禁止反复验证同一件事。
4. 报告必须 ≥500 字符且含 ## 标题；找不到 P0 就明确写"未发现 P0"，再给出 P1/P2 观察项。
5. 发现 3-8 条即可收尾，不要为了凑数无限扩张探索范围。`;

    // v1.4.4 优化一：增量审查——round-2+ 注入上轮 b-fix 改动文件清单，
    // worker 只需围绕这些文件审查（其他文件上轮已审过、结论仍然有效）。
    // FORGE_INCREMENTAL_FILES 由编排方写入（\\n 分隔）；不在增量模式的
    // worker（round-1 / 全量回退）不注入此段，行为与旧版完全一致。
    const incrementalFiles = (process.env.FORGE_INCREMENTAL_FILES || '')
      .split('\n').map(s => s.trim()).filter(Boolean);
    if (incrementalFiles.length > 0) {
      promptTemplate += `

## 🔍 增量审查范围（本轮只审这些）

上一轮修复（b-fix）改动了以下 ${incrementalFiles.length} 个文件，本轮你的审查对象
就是这些改动（可用 git diff/log 查看具体变化，或直接读文件）。未列出的文件在
之前轮次已审查过，除非改动直接波及否则不必重审：

${incrementalFiles.map(f => `- ${f}`).join('\n')}`;
    }
  }

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
  // - 文本处理类（a-consolidate/c-verify）：主要做合并/格式化，给 100 够了
  // - b-fix：分片后每批 5 条 finding × 5 工具调用 = 25 步，给 150 是 6 倍余量
  //   太高会导致消息累积 OOM（exit 137）
  // - c-verify：分片后每批 5 条 × 2 操作 = 10 步，给 300 是 30 倍余量（独立验收者逐条实测更耗步）
  // v1.2.9 功能①：短任务化后 STEP_RECURSION_LIMITS 按新 step key 生成。
  // 每个 perspective worker 用 recursionLimit=30（单视角短任务）。
  // STEPS 中已定义 recursionLimit 字段的 perspective worker 直接从 stepDef 读取。
  // 这里只为非 perspective 步骤（a-consolidate/b-fix/c-verify/d-review）保留显式覆盖。
  const STEP_RECURSION_LIMITS = {
    'a-consolidate': 100,
    'b-fix': 300,
    'c-verify': 300,
    // d-review：对抗复核 P0/P1，每条读证据文件 1-2 次，80 步（=40 轮）足够
    'd-review': 80,
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
    // v1.3.9（五）：按场景切后端——同 driver 两后端并存，后端选择显式：
    //   审查类 step（a-check/b-check/a-consolidate/c-verify，对应 SOP 阶段一「审上版本」
    //   的审查场景）→ createReactAgent 保留；
    //   执行类 step（b-fix 修复执行，对应阶段四「审本版本」的执行场景）→ DSH；
    //   FORGE_FRESH_EYES_BACKEND / SOFAGENT_EXECUTION_BACKEND 环境变量可整体覆盖。
    const stepBackend = resolveFreshEyesBackend(step);
    const backend = await createExecutionBackend({ preferred: stepBackend });
    console.log(`[worker:${step}] 执行后端：preferred=${stepBackend} → actual=${backend.name}`);
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
      content: execResult.output ?? '',   // DSH CLI 桥接无 rawMessages——output 是唯一文本面（ExecutionResult 标准字段）
      _hardBreak: execResult.hardBreak || hardBreak,
      // v1.4.3 第六章步三：运行时级 usage 透传（DSH session.events 自动计量——
      // recordUsage 的 extractUsage 多级 fallback 优先命中此字段，零手记）
      usage: execResult.runtimeUsage ?? undefined,
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
        // v1.4.4 优化三：空响应标记为可重试错误——run-2026-08-29 实测 B 侧
        // glm-5.3-flash 偶发空响应（1-2 次工具调用后 content 为空，消息太少
        // 碎片合成也无素材），退出码 1 直接判死导致 r2-r4 B 侧崩溃 1→5→8 份
        // 爬升。[empty-response] 标记抛出后由编排方重跑本角色（最多
        // 2 次）——偶发空响应重跑即过，系统性故障仍按原路径失败。
        const err = new Error(`[worker:${step}] DeepAgent 未返回内容且无法合成报告`);
        // stderr 标记（编排方据此识别空响应并重跑本角色）
        console.error(`[empty-response] ${err.message}`);
        err.isEmptyResponseError = true;
        throw err;
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
    // v1.4.6 骨架占位门控（run-2026-09-07 实锤）：收敛指令要求「先写报告骨架再回填」，
    // 部分 perspective worker 写完骨架即提前收工——61~201B 骨架经本通道静默落盘
    // （completion 仅 689~1692 tokens），下游 a-consolidate 把占位当有效发现合并，
    // 该视角的发现凭空丢失。门控镜像收敛要求第 4 条（≥500 字符且含 ## 标题）：
    // 不过门 → 打 [empty-response] 标记抛错，由编排方重跑本角色
    // （最多 2 次，三次仍不过才降级占位）。硬熔断的部分报告已带标记头且宽限窗口
    // 机制已尽力抢救，不重复拦截（拦截会浪费整轮预算重跑）。
    if (stepDef.perspective && !hardBreakFlag &&
        !(text.length >= REPORT_MIN_CHARS && /^#{1,3}\s/m.test(text))) {
      console.error(`[empty-response] [worker:${step}] 产物 ${text.length} 字符未达报告门控（≥${REPORT_MIN_CHARS} 字符且含 ## 标题）——疑似骨架未回填，触发重试`);
      const err = new Error(`[worker:${step}] 报告产物未达质量门控（${text.length} 字符，疑似只写骨架未回填终稿）`);
      err.isEmptyResponseError = true;
      throw err;
    }
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
    // 如果所有 AI message 都不达标 → 返回空字符串 → 走 generateReportWithoutTools / synthesize 降级。
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
    // 🔴 v1.4.3 修复：此处原有一层「从后往前找非 ToolMessage 的消息」的兜底，实测它
    //    绕过了上面的 isReportText 质量门控，造成两种灾情：
    //      ① AI 消息是思考碎片（「现在让我查看一些特定的代码文件」，15 字符）→ 第一层
    //         判不达标，第二层原样捞出写入产物文件——正是 v1.2.7 run-07 要修的那个 bug，
    //         当年只修了第一层，兜底这一层把碎片又捞了回来；
    //      ② AI 消息 content 为 undefined（带 tool_calls 的形态）→ 第二层一路往前找到
    //         HumanMessage，把**输入 prompt 全文**当成 agent 报告写入产物文件。
    //    根因是判定口径错了：「非 ToolMessage」≠「agent 输出」——HumanMessage 是输入
    //    不是输出，它和 ToolMessage 一样不该被当成报告。
    //    删除后与 release-gate-driver 同行为：AI 消息不达标即返回空，由调用方按
    //    hardBreak 走裸 LLM 抢救或碎片合成（见下方 1482 行起的既有降级链）。
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
async function generateReportWithoutTools(model, messages, step, role, stepDef, opts = {}) {
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
  // 返回 INCOMPLETE 占位，让下游（收敛判定 / a-consolidate /
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
    // v1.3.9 P1-1：兜底碎片重试——首次生成未达质量门控时，重试一次并追加
    // 收敛指令（证据仍不足时重试无意义，由上方 MIN_TOOL_EVIDENCE 门控拦截）。
    ...(opts.retry
      ? ['',
         '🔴 重试要求（上一轮输出未达质量门控）：',
         '报告不得少于 500 字符，必须含 ## 标题行。',
         '至少列出 1 条有文件路径的具体发现（P0/P1/P2 均可，找不到 P0 就如实写"未发现 P0"，',
         '再给 P1/P2 观察项）。禁止只输出一句话、半截中间思考或空泛总评。',
         '宁可详细完整，不要精简。']
      : []),
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
  // 文本，让下游收敛判定 / b-fix 能识别"该视角审查未完成"而非误读
  // 碎片为有效 finding。
  if (respText && isReportText(respText)) {
    return respText;
  }
  // v1.3.9 P1-1：碎片重试一次（证据足够但生成未达质量门控）。
  // 重试带更强收敛指令（opts.retry=true）；重试仍失败才落降级占位。
  // 防死循环：retry 标志只允许一次递归。
  if (!opts.retry) {
    console.warn(`  ┄ [${step}] 裸 LLM 报告未达质量门控（${respText.length} 字符），重试一次`);
    try {
      const retried = await generateReportWithoutTools(model, messages, step, role, stepDef, { retry: true });
      if (retried && isReportText(retried)) {
        console.log(`  ✅ [${step}] 重试报告生成成功（${retried.length} 字符）`);
        return retried;
      }
    } catch (retryErr) {
      console.warn(`  ⚠️ [${step}] 裸 LLM 重试失败: ${retryErr.message}，落降级占位`);
    }
  }
  // 碎片不达标 → 返回结构化占位（含降级标记词，让收敛判定识别）
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

  // ── 路径 C：单行括号格式（[视角] 路径:行号 · 描述 · 优先级(P1)）──
  // 部分模型在 B 侧摘要中输出此格式；与 A（# 标题）/ B（| 表格）不重叠
  for (const line of lines) {
    const bracketMatch = line.match(/^\[([^\]]+)\]\s*(.+)$/);
    if (!bracketMatch) continue;
    const tail = bracketMatch[2].trim();
    if (tail.startsWith('(')) continue; // markdown 链接 [标题](路径)，非 finding 行
    const prioMatch = tail.match(/·\s*(?:优先级\s*[（(]\s*)?(P[0-3])\s*[）)]?\s*$/);
    if (!prioMatch) continue;
    const prio = prioMatch[1];
    if (prio !== 'P0' && prio !== 'P1') continue;
    const desc = tail.slice(0, prioMatch.index).replace(/·\s*$/, '').trim();
    // 从描述中提取文件引用（含可选 :行号）作为修复目标
    const fileRefs = desc.match(/[A-Za-z0-9_./-]+\.(?:ts|tsx|js|mjs|cjs|md|sh|json|ya?ml|html|css)(?::\d+)?/g);
    const filePath = fileRefs ? fileRefs[0] : '(文件待确认)';
    items.push({
      title: desc.replace(fileRefs ? fileRefs[0] : '', '').replace(/^[\s:：·-]+/, '').slice(0, 80) || bracketMatch[1].trim(),
      filePath,
      desc: desc.slice(0, 200),
      source: `${source}·${bracketMatch[1].trim()}`,
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
 * result.md 写一个最小结构让收敛判定能数 P0/P1。
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

  // v1.2.9 功能①读全部 perspective 报告；单盲改造后默认只读 A 侧 12 份
  // （legacy 双盲 FORGE_ENABLE_B_CHECK=1 时仍读 B 侧——文件存在即收，天然兼容旧 run 数据）。
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
  // 让 b-fix 能真正修复而非空转重试。保留"降级生成"标记 → 收敛判定判 isDegraded
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

  // 🔴 fallback 去重器（降级链 findings 逐轮放大事故实锤）：降级提取不认识
  // 「多视角报同一问题」——A/B 双盲同题各报一次、相近措辞各算一条，findings
  // 8→16→20 逐轮滚雪球，b-fix 每轮修重复项。防线：按「文件路径 + 描述指纹」
  // 去重——描述去空白/标点后做前缀匹配（视角间对同一问题的表述在文件锚点相同
  // 时高度重合，常见形态是同题 + 一方多带补充尾巴；固定截断 slice(0,40) 对
  // 短于 40 字符的描述不生效），一方是另一方前缀且公共部分 ≥20 字符即合并：
  // 保留首条，来源追加标注，修复批工作量按去重后条数计。
  const MIN_PREFIX_LEN = 20; // 公共前缀下限：防短指纹（如「版本号未更新」）过合并
  const seenByFile = new Map(); // filePath → [{ normDesc, item }]
  const deduped = [];
  for (const it of extracted) {
    const normDesc = (it.desc || '').replace(/[\s\p{P}\p{S}]+/gu, '');
    let group = seenByFile.get(it.filePath);
    if (!group) { group = []; seenByFile.set(it.filePath, group); }
    const hit = group.find((prev) =>
      Math.min(prev.normDesc.length, normDesc.length) >= MIN_PREFIX_LEN
      && (normDesc.startsWith(prev.normDesc) || prev.normDesc.startsWith(normDesc)));
    if (hit) {
      const first = hit.item;
      if (!first.dupSources) first.dupSources = [first.source];
      first.dupSources.push(it.source);
      continue;
    }
    group.push({ normDesc, item: it });
    deduped.push(it);
  }
  if (deduped.length < extracted.length) {
    console.log(`     [fallback 去重] ${extracted.length} → ${deduped.length} 条（合并 ${extracted.length - deduped.length} 条跨视角同题）`);
  }
  const finalExtracted = deduped;

  let resultContent;
  if (finalExtracted.length > 0) {
    const findingBlocks = finalExtracted.map((it, i) => {
      const seq = String(i + 1).padStart(2, '0');
      const dupNote = it.dupSources
        ? `（跨视角同题合并：${it.dupSources.join(' / ')}）`
        : '';
      return [
        `### finding-${seq}: ${it.title}`,
        '',
        `**来源**: ${it.source}（fallback 从 check 报告提取，请 b-fix 核实后再改）${dupNote}`,
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
      `> ⚠️ 降级生成——a-consolidate 失败。以下 ${finalExtracted.length} 条 finding 由各 check 报告提取（已跨视角去重），优先级基于原文标记。`,
      '',
      ...findingBlocks,
      '',
    ].join('\n');
  } else {
    // 防御：禁止用全文正则统计 P0/P1 出现次数——"未发现 P0""无 P0 问题"这类
    // 否定句同样命中，会产出虚构计数误导后续判停。提取失败时如实报 0 条，
    // 原始摘要已落盘 findings.md，可人工查阅。
    resultContent = [
      '# 修复结果（降级生成——a-consolidate 失败）',
      '',
      `| # | 发现 | 优先级 | 状态 |`,
      `|---|------|--------|------|`,
      `| fallback | a-consolidate 失败，且各 check 报告未提取到 P0/P1 finding（原始摘要见 findings.md） | P0×0 P1×0 | SKIP |`,
      '',
    ].join('\n');
  }
  writeFileSync(join(roundDir, 'result.md'), resultContent, 'utf-8');

  // v1.3.0 run-23 修复：写独立降级标记文件 degraded.flag。
  // 降级标记不能只存在 result.md——c-verify 步骤会覆盖 result.md（回填 verify 列），
  // 把"降级生成"文本抹掉 → 收敛判定读到干净 result.md → 降级轮被误判
  // isClean=true（run-23 R1 实测）。flag 与 result.md 解耦，c-verify 覆盖不影响。
  // 收敛判定优先查 flag；文本标记匹配保留做旧 run 数据兼容。
  const degradedFlag = join(roundDir, 'degraded.flag');
  writeFileSync(degradedFlag,
    `fallback-rebuild\nreason: a-consolidate 产物解析失败，由 check 报告降级重建\ntime: ${new Date().toISOString()}\nfindings: ${finalExtracted.length}\n`,
    'utf-8');

  console.log(`     降级 findings.md 已写入（check 提取 ${finalExtracted.length} 条可修 finding（去重后），degraded.flag 已标记）`);
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
async function main() {
  const args = parseArgs(process.argv);

  // ─── Worker 模式（唯一入口）───
  if (args.worker) {
    if (!args.step || !args.roundDir || !args.target) {
      console.error('worker 模式需要 --step --round-dir --target');
      process.exit(1);
    }
    try {
      await runWorker(args.step, args.roundDir, args.target);
      // worker 写完产物后强制退出：残留句柄（LangGraph stream / API 长连接 /
      // 定时器 / audit middleware 监听器）会让事件循环永不空 → 进程挂起
      // （run-23 实测 hang 18 分钟）。process.exit 无视残留句柄强制回收。
      process.exit(0);
    } catch (err) {
      console.error(`[worker:${args.step}] 失败: ${err.message}`);
      if (err.errors) {
        console.error('--- 子错误 (' + err.errors.length + ' 条) ---');
        for (const [i, subErr] of err.errors.entries()) {
          console.error(`  [${i}] ${subErr?.message || subErr}`);
          if (subErr?.stack) {
            console.error('     stack:', subErr.stack.split('\n').slice(0, 6).join('\n'));
          }
        }
      } else if (err.stack) {
        console.error(err.stack);
      }
      process.exit(1);
    }
    return;
  }

  // ─── 多轮编排循环已退役 ───
  console.error('多轮编排循环入口已退役（整合归一）：本文件仅提供单步角色执行器。');
  console.error('用法：node FORGE/src/fresh-eyes-driver.mjs --worker --step <step> --round-dir <abs> --target <ver>');
  console.error('编排职责归 harness session——注入主任务协议即跑（SSOT：FORGE/SKILL/fresh-eyes-loop/loop.md「执行形态」节）。');
  process.exit(2);
}

main().catch((err) => {
  console.error('[fresh-eyes-worker] fatal:', err.message);
  process.exit(1);
});
