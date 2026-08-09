#!/usr/bin/env node
// ============================================================
// FORGE/src/release-gate-driver.mjs · FORGE release-gate-loop Driver
//
// 发版闸门循环编排层：V 阶段（5 步验证）+ F 阶段（verdict FAIL 时触发的修复链）。
// V 跑完出 PASS/FAIL。FAIL → F 链（f-diagnose → f-fix → f-audit，最多 3 轮）。
//
// 用法：
//   node FORGE/src/release-gate-driver.mjs --target v1.2.1 [--dry-run] [--skip-acceptance]
//   node FORGE/src/release-gate-driver.mjs --step <step> --target v1.2.1 [--run-dir <dir>]
//   node FORGE/src/release-gate-driver.mjs --help
//   <step> 可选: acceptance|regression|coverage|consolidate|verdict|f-diagnose|f-fix|f-audit
//
// 自 forks 为 worker：
//   node FORGE/src/release-gate-driver.mjs --worker --step <step> --run-dir <abs> --target <ver>
//
// 模型配置（V + F 双角色，v1.2.8）：
//   V（验证者）= GLM-5.2  reviewer skill + REVIEWER_TOOLS（只读）
//   F（修复者）= GLM-5.2  engineer skill + ENGINEER_TOOLS（可写代码）
//   f-audit = driver 步骤（role:null，不调 LLM，driver 直接跑 sofagent-audit）
//
// 与 fresh-eyes-driver 的差异：
//   - V+F 双角色（无 A/B 双盲），V 只读验证，F 读写修复
//   - V 单轮线性 5 步 → verdict → FAIL 时 F 链最多 3 轮收敛
//   - V 用 REVIEWER_TOOLS（只读），F 用 ENGINEER_TOOLS（可写）
// ============================================================

import { spawn } from 'child_process';
import { createRequire } from 'module';
import {
  readFileSync, writeFileSync, mkdirSync, existsSync,
  appendFileSync, readdirSync, copyFileSync, createWriteStream,
} from 'fs';
import { join, resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

// v1.2.7 功能⑤：继承 driver-base 公共编排层
import { createForgeDriverBase } from './driver-base.mjs';

// 可见性：核心层 + 适配器（agent 无关 + 渐进适配）
import { createVisibility, EVENTS } from './visibility.mjs';

// L2：SubAgent 内部可观测（工具调用序列 + 模型推理心跳）
import { createProgressMiddleware } from './progress-middleware.mjs';

// 模块级引用——让 catch 块也能写可见性事件（失败场景覆盖）
let globalVisibility = null;

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = resolve(__dirname, '../..');

// CJS interop — dist 产物是 CommonJS，.mjs 里用 createRequire 导入
const require = createRequire(import.meta.url);

// ─── 路径常量 ────────────────────────────────────────────────
const LOOP_DIR    = join(REPO_ROOT, 'FORGE/SKILL/release-gate-loop');
const PROMPTS_DIR = join(LOOP_DIR, 'prompts');
// runs 输出优先到 SOFAGENT_HOME/data/forge-runs/，
// fallback 到仓库内 data/forge-runs/（开发模式兼容）
const SOFAGENT_HOME = process.env.SOFAGENT_HOME || join(os.homedir(), '.sofagent');
const RUNS_DIR    = join(SOFAGENT_HOME, 'data', 'forge-runs');
const LEDGER_PATH = join(REPO_ROOT, 'FORGE/LEDGER.md');
const AGENTS_DIR  = join(REPO_ROOT, 'SKILL/agents');

// ─── 单角色模型配置（V = 验证者，从 FORGE/models/ 加载）──────
// V 用 GLM-5.2：智谱 Coding Plan 订阅制（OpenAI 兼容接口）。
// 换模型改 FORGE/models/profile.mjs 即可，不需要改 driver 代码。
import { resolveConfigs, resolvePricing } from '../models/index.mjs';
const MODEL_CONFIGS = resolveConfigs(AGENTS_DIR);

// ─── 模型定价（从 FORGE/models/ 加载）─────────────────────
// 单位：CNY per 1M tokens（百万 token 计价）
// V 用 GLM-5.2 = 智谱 Coding Plan 订阅制 → 不按 token 计价。
// 订阅制按周期固定付费，与 token 消耗无关，MODEL_PRICING 的成本估算对
// 订阅账号意义有限，仅供参考（recordUsage 的 subscription 分支输出 cost_cny = null）。
const MODEL_PRICING = resolvePricing();

// ─── driver-base 公共编排层实例 ──────────────────────────
// v1.2.7 功能⑤：继承 driver-base，复用公共工具函数。
// release-gate-driver 保留自身的差异化逻辑（单角色 V、单轮线性串行、
// 预执行器、PASS/FAIL 裁决），公共工具函数（sliceMultiOutput 等）从 base 复用。
const base = createForgeDriverBase({
  driverName: 'release-gate',
  loopDir: LOOP_DIR,
  repoRoot: REPO_ROOT,
  modelConfigs: MODEL_CONFIGS,
  modelPricing: MODEL_PRICING,
});

// ─── 步骤定义（prompt / output / inputs / maxTokens）─────────────────────
// v1.2.8 功能⑤：从单角色 V 升级为 V + F 双角色 + audit gate
// V 步骤补加 role: 'V' 显式化（v1.2.7 无此字段）
// F 步骤为 v1.2.8 新增（LLM 步骤）
// f-audit 为 driver 步骤（role: null，不调 LLM，driver 直接执行 runAuditGate）
// maxTokens：步骤级输出 token 上限覆盖。未定义时回退到 MODEL_CONFIGS[role].maxTokens。
// consolidate 需合并 acceptance/regression/coverage 三份完整报告为单份 stage6-report，输出超长，
// 单独调高到 32000，避免顶格 16000 被截断生成不了合法报告（整轮降级根因）。
// ─── v1.2.9 功能①：acceptance 维度分片 ──────────────────────
// 把 acceptance-test.sh 的 N 个场景按 12 个维度分片，每片一个独立 worker 分析。
// 每个 worker 只分析分配到的场景编号范围（从 acceptance-raw.log 中提取），
// 产出 acceptance-sN.md，最后 acceptance-consolidate 合并为单份 acceptance.md。
//
// 分片策略：按场景编号均分（N / 12 个场景/片）。
// v1.3.0 修复：场景数硬编码 148 → 动态从 acceptance-test.sh 提取（与 check-test-count.sh 同口径），
// 防场景数增长后（S149+）超出分片范围导致新场景零分析。
const ACCEPTANCE_TOTAL_SCENARIOS = (() => {
  const scriptPath = join(__dirname, '../../FORGE/playbook/acceptance-test.sh');
  try {
    const s = readFileSync(scriptPath, 'utf8');
    const m = s.match(/^scenario (\d+)[a-z]? "/gm);
    const maxNum = m ? Math.max(...m.map(x => parseInt(x.match(/\d+/)[0], 10))) : 148;
    return maxNum;
  } catch { return 148; }
})();
const ACCEPTANCE_SHARD_COUNT = parseInt(process.env.FORGE_ACCEPTANCE_SHARDS || '12', 10);

/**
 * 计算每个分片负责的场景编号范围。
 * @returns {Array<{id:number, start:number, end:number}>}
 */
function computeAcceptanceShards() {
  const shards = [];
  const perShard = Math.ceil(ACCEPTANCE_TOTAL_SCENARIOS / ACCEPTANCE_SHARD_COUNT);
  for (let i = 0; i < ACCEPTANCE_SHARD_COUNT; i++) {
    const start = i * perShard + 1;
    const end = Math.min((i + 1) * perShard, ACCEPTANCE_TOTAL_SCENARIOS);
    if (start > ACCEPTANCE_TOTAL_SCENARIOS) break;
    shards.push({ id: i + 1, start, end });
  }
  return shards;
}

const ACCEPTANCE_SHARDS = computeAcceptanceShards();

/**
 * 动态生成 acceptance 分片步骤 + consolidate 步骤。
 * 替换原来的单个 acceptance 步骤。
 */
function buildAcceptanceSteps() {
  const steps = {};
  const shardInputs = [];
  for (const s of ACCEPTANCE_SHARDS) {
    steps[`acceptance-s${s.id}`] = {
      role: 'V',
      prompt: `acceptance-shard-${s.id}.md`,
      outputs: [`acceptance-s${s.id}.md`],
      inputs: [],
      shard: s,
      recursionLimit: 40,
    };
    shardInputs.push(`acceptance-s${s.id}.md`);
  }
  // consolidate：合并 12 份分片报告为单份 acceptance.md
  steps['acceptance-consolidate'] = {
    role: 'V',
    prompt: 'acceptance-consolidate.md',
    outputs: ['acceptance.md'],
    inputs: shardInputs,
    maxTokens: 16000,
  };
  return steps;
}

const STEPS = {
  // v1.2.9 功能①：acceptance 分片（12 个 shard worker + 1 个 consolidate）
  ...buildAcceptanceSteps(),
  'regression':  { role: 'V', prompt: 'regression.md',  outputs: ['regression.md'],  inputs: ['regression-precheck.json'], precheck: true },
  'coverage':    { role: 'V', prompt: 'coverage.md',    outputs: ['coverage.md'],    inputs: ['acceptance.md', 'coverage-precheck.json'], precheck: true },
  'consolidate': { role: 'V', prompt: 'consolidate.md', outputs: ['stage6-report.md'], inputs: ['acceptance.md', 'regression.md', 'coverage.md'], maxTokens: 32000 },
  'verdict':     { role: 'V', prompt: 'verdict.md',     outputs: ['verdict.md'],     inputs: ['stage6-report.md'] },
  // v1.2.8 新增 F 步骤（LLM 步骤——verdict FAIL 后触发）
  'f-diagnose':  { role: 'F', prompt: 'f-diagnose.md',  outputs: ['fix-plan.md'],     inputs: ['verdict.md'] },
  'f-fix':       { role: 'F', prompt: 'f-fix.md',       outputs: ['fix-summary.md'],  inputs: ['fix-plan.md', 'verdict.md'] },
  // v1.2.8 新增 audit 步骤（driver 步骤——role: null，不调 LLM）
  'f-audit':     { role: null, prompt: null,            outputs: ['audit-result.md'], inputs: [], driverFn: 'runAuditGate' },
};

// 步骤执行顺序（driver 按此顺序串行执行）
// v1.2.9 功能①：acceptance 拆为 12 shard + consolidate，替换原单步 acceptance。
// shard 步骤并行执行（spawnParallel），consolidate 在所有 shard 完成后串行。
const ACCEPTANCE_SHARD_STEPS = ACCEPTANCE_SHARDS.map(s => `acceptance-s${s.id}`);
const STEP_ORDER = [...ACCEPTANCE_SHARD_STEPS, 'acceptance-consolidate', 'regression', 'coverage', 'consolidate', 'verdict'];

// 每步的 recursionLimit（L3 框架兜底——L1/L2 熔断应在此之前触发）
// v1.2.5+ 优化：regression 改用 driver 预执行器（parseRegressionDimensions + runRegressionPrecheck），
// 命令执行从 LLM 手里剥离。worker 只读 regression-precheck.json 判定结果，工具调用 ≤ 5 次，
// recursionLimit 从 400 降到 50（不再需要模型逐维度跑命令，也消除了 GraphRecursionError）。
// v1.2.5+ coverage：同样加预执行器（runCoveragePrecheck），recursionLimit 100→40，
// worker 只读 coverage-precheck.json 交叉判定。
const STEP_RECURSION_LIMITS = {
  // v1.2.9 功能①：acceptance shard 用 40（短任务——分析日志片段）
  'acceptance-consolidate': 60,
  'regression':  50,
  'coverage':    40,
  'consolidate': 80,
  'verdict':     50,
};

// ═══════════════════════════════════════════════════════════
//  三层熔断常量（移植自 fresh-eyes-driver，适配 release-gate 单角色 V 架构）
// ═══════════════════════════════════════════════════════════
// L1 软熔断：stateModifier 注入 HumanMessage 强制写报告
// L2 硬熔断：stream 循环物理 break + grace window 报告抢救
// L3 框架兜底：LangGraph recursionLimit（上面的 STEP_RECURSION_LIMITS）
//
// 数值关系：30(劝) → 40(拽) → L3(杀)
// release-gate 任务比 fresh-eyes 简单（读预执行结果 + 分析文档），
// 所以阈值比 fresh-eyes(50/60) 更低，更早收敛。
const TOOL_SOFT_LIMIT = 35;   // L1：超过此数注入"立即写报告"HumanMessage
const TOOL_HARD_LIMIT = 45;   // L2：超过此数进入 grace window
const GRACE_STEPS_DEFAULT = 0;    // 零窗口模式（v1.2.7：撞硬上限立即中断，和 fresh-eyes-driver 对齐）
const GRACE_STEPS_ANALYSIS = 0;  // 分析型步骤同样零窗口

// v1.2.7：isReportText + REPORT_MIN_CHARS 提到模块级（和 fresh-eyes-driver 对齐，避免局部作用域引用 bug）
const REPORT_MIN_CHARS = 300;
function isReportText(text) {
  if (!text || !text.trim()) return false;
  if (text.length >= REPORT_MIN_CHARS) return true;
  if (/^#{1,3}\s/m.test(text)) return true;
  return false;
}

// 维度级超时覆盖（默认 60s；重遍历/全仓扫描类维度给更长时间）
// v1.2.5：维度 49（旧路径零残留 node 递归遍历 7 目录）实测 60s 超时 → 上调 120s
const DIM_TIMEOUT_OVERRIDE = {
  49: 120_000,
};

// ═══════════════════════════════════════════════════════════
//  CLI 参数解析
// ═══════════════════════════════════════════════════════════
function parseArgs(argv) {
  const args = { target: null, dryRun: false,
                 worker: false, step: null, runDir: null,
                 skipAcceptance: false, help: false,
                 resume: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help             = true;
    else if (a === '--target')           args.target         = argv[++i];
    else if (a === '--dry-run')     args.dryRun         = true;
    else if (a === '--worker')      args.worker         = true;
    else if (a === '--step')        args.step           = argv[++i];
    else if (a === '--run-dir')     args.runDir         = argv[++i];
    else if (a === '--skip-acceptance') args.skipAcceptance = true;
    // v1.2.8 功能⑦：断点续跑（参数名与 driver-base.parseDriverArgs / fresh-eyes 保持一致）
    else if (a === '--resume')      args.resume         = true;
  }
  return args;
}

// ═══════════════════════════════════════════════════════════
//  Worker 模式 — 在独立子进程内执行单个步骤
// ═══════════════════════════════════════════════════════════

/**
 * 从 SKILL.md 构建 systemPrompt。
 *
 * 复用 fresh-eyes-driver 的逻辑：剥离 frontmatter、提取身份标签。
 * 末尾追加 macOS BSD 工具约束段 + 纯只读铁律段（release-gate-loop 特有）。
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

  // macOS BSD 工具约束——GLM 常用 Linux 语法导致命令报错
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
    '- `command -v` 代替 `which`（更可移植）',
    '- `<(...)` process substitution → 不支持',
    '',
    '**铁律：命令报错时立即换方案或跳过，禁止用相同语法重试。**',
  ].join('\n');

  // 纯只读铁律——release-gate-loop 核心约束
  const readOnlyRule = [
    '',
    '## 🔴 铁律：纯只读（release-gate-loop 核心约束）',
    '',
    '你**不得创建或修改任何代码或文档文件**。你的任务是验证 + 生成报告，不是修复。',
    '',
    '**禁止操作：**',
    '- 禁止使用 write_file / edit_file 等写工具',
    '- 禁止 git commit / git push',
    '- 禁止 npm publish / npm install',
    '- 禁止修改 acceptance-test.sh / regression-checklist.md / 任何源码',
    '',
    '**允许操作：**',
    '- 读文件（read_file / ls / glob / grep）',
    '- 跑验证命令（bash / node / grep 等，但不得有写副作用）',
    '- 写自己的产物文件（driver 从你的最终回复中提取）',
  ].join('\n');

  return header + '\n\n' + body + shellConstraints + '\n' + readOnlyRule;
}

/**
 * 为角色 V 创建 LLM 模型实例。
 *
 * 模型配置从 FORGE/models/ 加载（profile.mjs 定义角色→模型映射）。
 * 当前配置：V = GLM-5.2（智谱 Coding Plan，OpenAI 兼容接口，coding 专用端点）。
 * 换模型只改 FORGE/models/profile.mjs，不需要改 driver 代码。
 *
 * GLM-5.2 支持 thinking + reasoning_effort 参数：MODEL_CONFIGS.V 定义了
 * thinking={type:'enabled'} + reasoningEffort='max' + temperature=1.0，
 * 下方条件注入分支自动带上这些参数。
 *
 * @param {string} role 角色名（本 driver 固定为 'V'）
 * @param {number} [maxTokensOverride] 步骤级输出 token 上限覆盖，优先于 cfg.maxTokens
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
    apiKey: apiKey,
    openAIApiKey: apiKey,
  };

  // 限制输出 token（防止 thinking 模式无限消耗）
  // 步骤级 maxTokensOverride 优先于角色默认值 cfg.maxTokens
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
    if (cfg.thinking) {
      // 退化：去掉 thinking 再试（reasoning_effort 大概率被支持）
      console.warn(`[release-gate] ChatOpenAI 不接受 thinking 参数，退化仅用 reasoningEffort: ${err.message}`);
      delete ctorArgs.modelKwargs;
      return new ChatOpenAI(ctorArgs);
    }
    throw err;
  }
}

// ─── 工具输出截断（v1.2.5 性能优化 → v1.2.8 功能③：迁移到统一中间件）──
// v1.2.8：truncateToolOutput 从 tool-output-budget.mjs 统一导入，
// 不再在此文件内联定义。删除旧实现 L293-309。
import { truncateToolOutput, DEFAULT_BUDGET as TOOL_OUTPUT_MAX_LINES } from './tool-output-budget.mjs';

/**
 * 从 dist 导入工具集（REVIEWER_TOOLS）。
 * 转换 ExecutableTool → DynamicStructuredTool（与 fresh-eyes-driver 同逻辑）。
 */
function loadTools(role, progressMw = null) {
  const cfg = MODEL_CONFIGS[role];
  const toolsModule = require('../../engine/orchestrator/dist/tools.js');
  const rawTools = toolsModule[cfg.toolsKey];
  if (!rawTools) {
    throw new Error(`工具集 ${cfg.toolsKey} 未在 dist/tools.js 中找到`);
  }

  const { tool } = require('@langchain/core/tools');
  const { z } = require('zod');

  return rawTools.map((rawTool) => {
    if (rawTool.lc_namespace) return rawTool;

    const properties = rawTool.schema?.properties || {};
    const zodShape = {};
    const requiredFields = rawTool.schema?.required || [];

    for (const [key, prop] of Object.entries(properties)) {
      let zodField;
      if (prop.type === 'string') {
        zodField = z.string();
      } else if (prop.type === 'number' || prop.type === 'integer') {
        zodField = z.number();
      } else if (prop.type === 'boolean') {
        zodField = z.boolean();
      } else {
        zodField = z.string();
      }
      if (prop.description) zodField = zodField.describe(prop.description);
      if (!requiredFields.includes(key)) zodField = zodField.optional();
      zodShape[key] = zodField;
    }

    const wrappedTool = tool(
      async (input) => {
        // v1.2.5：工具输出截断——超过 200 行的输出只保留头尾，防止上下文膨胀
        const execFn = async () => {
          const raw = await rawTool.func(input);
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
 * 与 fresh-eyes-driver 完全一致的 4 路径 fallback。
 */
function extractUsage(result) {
  if (result?.usage) {
    const u = result.usage;
    const pt = u.prompt_tokens ?? u.input_tokens ?? 0;
    const ct = u.completion_tokens ?? u.output_tokens ?? 0;
    return { prompt_tokens: pt, completion_tokens: ct, total_tokens: u.total_tokens ?? (pt + ct) };
  }

  if (result?.llmResult?.usage) {
    const u = result.llmResult.usage;
    const pt = u.prompt_tokens ?? u.input_tokens ?? 0;
    const ct = u.completion_tokens ?? u.output_tokens ?? 0;
    return { prompt_tokens: pt, completion_tokens: ct, total_tokens: u.total_tokens ?? (pt + ct) };
  }

  if (result?.messages?.length > 0) {
    const last = result.messages[result.messages.length - 1];
    if (last?.usage_metadata) {
      const u = last.usage_metadata;
      const pt = u.input_tokens ?? u.prompt_tokens ?? 0;
      const ct = u.output_tokens ?? u.completion_tokens ?? 0;
      return { prompt_tokens: pt, completion_tokens: ct, total_tokens: u.total_tokens ?? (pt + ct) };
    }
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
 * 单角色 V，round 字段固定为 1（单轮）。
 */
function recordUsage(runDir, step, role, model, result, latencyMs, target) {
  const usagePath = join(runDir, 'usage.jsonl');
  const pricing = MODEL_PRICING[model];
  const usage = extractUsage(result);

  let billing = 'pay-as-you-go';
  for (const [roleKey, cfg] of Object.entries(MODEL_CONFIGS)) {
    if (cfg.model === model) { billing = cfg.billing; break; }
  }

  let record;
  if (usage) {
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
    record = {
      ts:                 new Date().toISOString(),
      target:             target,
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
 * 解析 changelog 文件路径（相对 REPO_ROOT）。
 *
 * changelog 目录结构（v1.2.5 实测）：
 *   docs/changelog/v1.2/v1.2.5.md   ← 按大版本嵌套子目录
 * 顶层 docs/changelog/v1.2.5.md 不存在。
 *
 * 解析顺序：
 *   1. docs/changelog/TARGET.md        （顶层——部分老版本在此）
 *   2. docs/changelog/v-子目录/TARGET.md（扫 v1.x 等嵌套目录，取第一个命中）
 * 均未命中 → 返回 null（调用方回退到顶层路径字符串，模型自行处理）。
 *
 * @param {string} target 版本号，如 "v1.2.5"
 * @returns {string|null} 相对路径（/ 分隔），未找到返回 null
 */
function resolveChangelogPath(target) {
  const topLevel = `docs/changelog/${target}.md`;
  if (existsSync(join(REPO_ROOT, topLevel))) {
    return topLevel;
  }
  // 递归扫 docs/changelog/ 下的 v1.x 等子目录，找 TARGET.md
  const changelogDir = join(REPO_ROOT, 'docs/changelog');
  if (existsSync(changelogDir)) {
    for (const sub of readdirSync(changelogDir, { withFileTypes: true })) {
      if (!sub.isDirectory() || !sub.name.startsWith('v')) continue;
      const candidate = `docs/changelog/${sub.name}/${target}.md`;
      if (existsSync(join(REPO_ROOT, candidate))) {
        return candidate;
      }
    }
  }
  console.warn(`[driver] changelog 未找到（顶层+嵌套均无）: ${target}，回退到顶层路径字符串`);
  return topLevel;
}

/**
 * Worker 主逻辑：读 prompt → 建 model+tools → invoke → 写产物。
 */
async function runWorker(step, runDir, target) {
  const stepDef = STEPS[step];
  if (!stepDef) throw new Error(`未知步骤: ${step}`);

  // v1.2.8：从 STEPS 定义读取角色，不再硬编码 'V'。
  // V 步骤 → reviewer skill，F 步骤 → engineer skill。
  const role = stepDef.role;
  const cfg  = MODEL_CONFIGS[role];

  // 1. 构建 systemPrompt
  const systemPrompt = buildSystemPrompt(cfg.agentSkillPath);

  // 2. 读 prompt 正文
  const promptTemplate = readFileSync(join(PROMPTS_DIR, stepDef.prompt), 'utf-8');

  // 3. 组装 user message：prompt 正文 + 路径注入 + target 注入
  const inputPaths = stepDef.inputs.map(f => `  - ${join(runDir, f)}`).join('\n');
  const outputPaths = stepDef.outputs.map(f => `  - ${join(runDir, f)}`).join('\n');

  // 注入 changelog 路径（步骤③ coverage 需要）
  // v1.2.5 bugfix：changelog 按版本号嵌套在 docs/changelog/v1.2/v1.2.5.md，
  // 顶层 docs/changelog/v1.2.5.md 不存在 → 模型陷入找文件死循环（run-06 coverage 崩溃根因）。
  // 修复：先试顶层，不存在则扫 v1.x 等子目录匹配。
  const changelogPath = resolveChangelogPath(target);

  const userMessage = [
    promptTemplate.trim(),
    '',
    '--- driver 注入 ---',
    `本次验证对象 = sofagent ${target} 完整交付物`,
    `项目根目录 = ${REPO_ROOT}`,
    inputPaths ? `输入文件（已由 driver 中转）：\n${inputPaths}` : '',
    `Changelog 路径 = ${changelogPath}`,
    `产物输出路径（把你的输出写到这个文件）：\n${outputPaths}`,
  ].filter(Boolean).join('\n');

  // 4. 创建 model + tools + agent
  // 步骤级 maxTokens 覆盖（如 consolidate=32000）优先于角色默认值
  const model = await createModel(role, stepDef.maxTokens);

  // L2：ProgressMiddleware 注入
  // 单角色，文件名 sub-progress.jsonl（不带角色字母）
  let progressMw = null;
  try {
    progressMw = createProgressMiddleware({ roundDir: runDir, role: 'V' });
  } catch (mwErr) {
    console.warn(`[worker:${step}] ProgressMiddleware 创建失败（不影响主流程）: ${mwErr.message}`);
  }
  const tools = loadTools(role, progressMw);

  const { createReactAgent } = await import('@langchain/langgraph/prebuilt');
  const { SystemMessage, HumanMessage } = await import('@langchain/core/messages');

  // v1.2.5 性能优化：stateModifier 同时实现「system prompt 注入」+「上下文裁剪」。
  // prompt 和 stateModifier 互斥（LangGraph 源码 _getPrompt 强校验），
  // 所以把 systemPrompt 移到 stateModifier 内部以 SystemMessage 形式注入。
  //
  // v1.2.6 内存优化：preModelHook 物理裁剪 state.messages。
  // stateModifier 只裁剪「发给 LLM 的 prompt」，不影响 LangGraph 内部 state——
  // state.messages 数组在工具调用循环中持续增长（每次 +2 条：AI tool_call + ToolMessage），
  // 全部消息内容（thinking tokens、工具输出）驻留在内存中。
  // preModelHook 在每次模型调用前物理替换 state.messages，旧消息可被 GC 回收。
  // 实测：regression 步骤 17 次工具调用从 OOM(exit 137) 降到正常完成。
  const MAX_CONTEXT_MESSAGES = 16;
  const systemMsg = new SystemMessage(systemPrompt);

  // 🔴 F-4 修复：从 fresh-eyes-driver.mjs 复制 trimMessagesSafe + estimateTokens。
  // 原 release-gate 用 raw slice 裁剪，会切断 tool_calls ↔ ToolMessage 配对，
  // 产生孤立消息触发 LangGraph / DeepSeek API 校验报错。

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

  // 粗估消息总 token 数（content 长度 / 4）
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

  const agent = createReactAgent({
    llm: model,
    tools,
    stateModifier: (state) => {
      const messages = state.messages ?? [];

      // 统计历史消息中所有 AI tool_calls 总数
      let toolCallCount = 0;
      for (const msg of messages) {
        if (msg?._getType?.() === 'ai' && msg.tool_calls?.length > 0) {
          toolCallCount += msg.tool_calls.length;
        }
      }

      // 上下文裁剪辅助函数：保留 system + 第一条 user + 最后 N 条
      // F-4：用 trimMessagesSafe 替换 raw slice，避免孤立 tool_calls/ToolMessage
      const trimmed = (extra) => {
        if (messages.length <= MAX_CONTEXT_MESSAGES + 1) {
          return extra ? [systemMsg, extra, ...messages] : [systemMsg, ...messages];
        }
        const first = messages[0];
        const recent = trimMessagesSafe(messages, MAX_CONTEXT_MESSAGES);
        return extra ? [systemMsg, extra, first, ...recent] : [systemMsg, first, ...recent];
      };

      // L2 硬熔断：更强制的"最终警告"
      if (toolCallCount >= TOOL_HARD_LIMIT) {
        const forceReport = new HumanMessage({
          content: '【🔴 系统最终警告 🔴】你已调用 ' + toolCallCount + ' 次工具，远超预算。' +
            '现在必须立即输出完整的分析报告文本。禁止再调用任何工具。' +
            '直接在回复中写出你的完整分析结果。'
        });
        return trimmed(forceReport);
      }

      // L1 软熔断：强制收尾指令
      if (toolCallCount >= TOOL_SOFT_LIMIT) {
        const forceReport = new HumanMessage({
          content: '【系统强制指令】你已经调用了 ' + toolCallCount + ' 次工具，超过软上限。' +
            '立即停止所有探索，用已掌握的信息写报告并写入产物文件。不要再调任何工具。'
        });
        console.warn(`  ⚡ [${step}#V] 工具调用 ${toolCallCount} 次超软上限，注入强制收尾指令`);
        return trimmed(forceReport);
      }

      // 正常：只做上下文裁剪
      return trimmed(null);
    },
    preModelHook: (state) => {
      // F-4：token 维度激进裁剪——只在 token 超硬阈值时裁剪。
      // 消息条数裁剪已由 stateModifier 处理，这里补 stateModifier 看不到的维度：
      // 单条消息超长（如 500 行审查报告全文）导致总 token 爆炸但消息条数还不多。
      const messages = state.messages ?? [];
      const tokenEst = estimateTokens(messages);

      // token 超硬阈值 → 激进裁剪
      if (tokenEst > 100000) {
        const first = messages[0];
        const recent = trimMessagesSafe(messages, 12);
        return { ...state, messages: [first, ...recent] };
      }

      return state;
    },
  });

  // 5. stream（计时）—— v1.2.5 改为流式输出
  console.log(`[worker:${step}] 开始执行（role=V, model=${cfg.model}）`);
  const t0 = Date.now();

  // v1.2.9 功能①：acceptance shard 用 stepDef.recursionLimit（40），其他用 STEP_RECURSION_LIMITS
  const recursionLimit = STEP_RECURSION_LIMITS[step] ?? stepDef.recursionLimit ?? 50;

  // v1.2.5：流式执行——实时打印工具调用
  //
  // 🔴 stream 数据结构适配（P0 bugfix da1039a → 本 commit）：
  //   agent.stream(streamMode:'updates') 的 chunk 是 { [nodeName]: stateDelta }，
  //   不是 invoke() 的扁平 { messages: [...] }。累积 delta.messages 到扁平数组，
  //   返回格式兼容 invoke()，确保下游 extractAgentText / extractUsage 正常工作。
  const invokeAgent = async () => {
    const stream = await agent.stream(
      { messages: [{ role: 'user', content: userMessage }] },
      { recursionLimit, streamMode: 'updates' }
    );

    const allMessages = [];
    let toolCallCount = 0;

    // L2 硬熔断状态（移植自 fresh-eyes-driver）
    let inGraceWindow = false;   // 是否进入写报告窗口期
    let graceStepCount = 0;      // 窗口期 superstep 计数
    let hardBreak = false;       // 窗口耗尽，强制中断
    let gotReport = false;       // 窗口期内捕获到报告文本

    // 报告质量门控：使用模块级 isReportText（v1.2.7：从局部提到模块级）
    // 真报告至少含 ## 标题行 或 ≥ 300 字符

    for await (const chunk of stream) {
      for (const [, delta] of Object.entries(chunk)) {
        const msgs = delta?.messages;
        if (!Array.isArray(msgs)) continue;
        for (const msg of msgs) {
          allMessages.push(msg);

          // 检测 AI 消息是否有非空 content（报告文本）
          if (msg?._getType?.() === 'ai') {
            const c = msg?.content;
            let textContent = '';
            if (typeof c === 'string') textContent = c;
            else if (Array.isArray(c)) textContent = c.map(x => typeof x === 'string' ? x : x?.text ?? '').join('');
            // 窗口期内检测报告质量
            if (inGraceWindow && isReportText(textContent)) {
              gotReport = true;
              console.log(`  ✅ [${step}#V] 写报告窗口内捕获到报告文本（${textContent.length} 字符）`);
            }
          }

          // 工具调用计数
          if (msg?._getType?.() === 'ai' && msg.tool_calls?.length > 0) {
            for (const tc of msg.tool_calls) {
              toolCallCount++;
              console.log(`  → [${step}#V] tool #${toolCallCount}: ${tc.name}`);
            }
          }
        }
      }

      // L2：撞硬上限 → 进入 grace window
      // 分析型步骤（coverage/consolidate）给 10 步 grace，其他给 5 步
      const graceSteps = (step === 'coverage' || step === 'consolidate')
        ? GRACE_STEPS_ANALYSIS : GRACE_STEPS_DEFAULT;
      if (toolCallCount >= TOOL_HARD_LIMIT && !inGraceWindow && !hardBreak) {
        inGraceWindow = true;
        console.warn(`  ⏳ [${step}#V] 工具调用 ${toolCallCount} 次撞硬上限，进入 ${graceSteps} 步写报告窗口`);
      }

      // Grace window 倒计时
      if (inGraceWindow && !gotReport && !hardBreak) {
        graceStepCount++;
        if (graceStepCount >= graceSteps) {
          hardBreak = true;
          console.warn(`  🛑 [${step}#V] 写报告窗口耗尽（${graceSteps} 步），模型仍未输出文本，强制中断`);
          break;
        }
      }

      // 窗口期内拿到报告 → 正常结束
      if (gotReport) {
        console.log(`  📝 [${step}#V] 报告已捕获，正常结束`);
        break;
      }
    }

    return { messages: allMessages, hardBreak };
  };

  const result = progressMw
    ? await progressMw.wrapModelCall({ step, role: 'V', model: cfg.model }, invokeAgent)
    : await invokeAgent();
  const latencyMs = Date.now() - t0;

  // 5b. 记录 usage
  try {
    recordUsage(runDir, step, role, cfg.model, result, latencyMs, target);
  } catch (usageErr) {
    console.warn(`[worker:${step}] usage 记录失败（不影响主流程）: ${usageErr.message}`);
  }

  // 6. 提取文本输出
  let text = extractAgentText(result);
  if (!text) {
    // v1.2.7：hardBreak 后 agent 无文本，走无工具裸 LLM 报告生成（和 fresh-eyes-driver 对齐）
    if (result?.hardBreak) {
      console.warn(`  ┄ [${step}] 硬熔断后模型未输出文本，启动无工具裸 LLM 报告生成`);
      try {
        text = await generateReportWithoutTools(model, result?.messages ?? [], step, 'V', stepDef);
      } catch (bareErr) {
        console.warn(`  ┄ [${step}] 裸 LLM 报告生成也失败: ${bareErr.message}`);
      }
    }
    if (!text) {
      throw new Error(`[worker:${step}] Agent 未返回内容`);
    }
  }

  // 7. 写产物（release-gate 每步只产出 1 个文件）
  if (stepDef.outputs.length === 1) {
    const outPath = join(runDir, stepDef.outputs[0]);
    writeFileSync(outPath, text, 'utf-8');
    console.log(`[worker:${step}] 产物已写入 ${outPath}`);
  } else {
    const slices = sliceMultiOutput(text, stepDef.outputs);
    for (const filename of stepDef.outputs) {
      const outPath = join(runDir, filename);
      writeFileSync(outPath, slices[filename], 'utf-8');
      console.log(`[worker:${step}] 产物已写入 ${outPath}`);
    }
  }
}

/**
 * 按 `===FILE: <filename>===` 分隔符切片多产物输出。
 * v1.2.7 功能⑤：复用 driver-base 的 sliceMultiOutput 实现。
 */
const sliceMultiOutput = base.sliceMultiOutput;

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
    // v1.2.7 修复（同步自 fresh-eyes-driver run-07）：原来只要 text.trim()
    // 非空就返回，但 GLM 在硬熔断前的最后一条 AI message 可能是一句中间思考
    // 碎片（如"现在我已经有了所需的所有数据。让我阅读日志的中间部分..."），
    // 碎片被当成报告写入了产物文件。
    //
    // 报告质量门控：≥REPORT_MIN_CHARS 字符 或 含 ## 标题行（与 stream loop 的 isReportText 一致）。
    // 如果所有 AI message 都不达标 → 返回 null → 走 generateReportWithoutTools 降级。
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
      // 报告质量门控：非空 + (≥REPORT_MIN_CHARS 字符 或 含 ## 标题行)
      if (text.trim() && isReportText(text)) return text;
    }
    // 所有 AI message 都不达标（碎片/中间思考）→ 返回空，让调用方走 generateReportWithoutTools。
    // 注意：硬中断场景下最后一条可能是 ToolMessage（工具返回值），不能把工具返回值当报告。
    return '';
  }
  // 最终 fallback——避免 String(object) 产出 "[object Object]"
  if (result && typeof result === 'object') {
    return JSON.stringify(result);
  }
  return String(result ?? '');
}

/**
 * 硬熔断后的无工具裸 LLM 报告生成。
 *
 * 当 agent 撞硬上限（TOOL_HARD_LIMIT + 零窗口）仍未输出文本时，
 * 从 ToolMessage 中提取摘要，构造无 tools 的 prompt 让模型直接输出报告。
 *
 * v1.2.7：从 fresh-eyes-driver.mjs 同步——release-gate 和 fresh-eyes 共享
 * 相同的熔断架构，需要相同的降级策略，否则 release-gate 撞硬上限后直接 throw。
 *
 * @param {object} model    已初始化的 LLM 实例（ChatOpenAI）
 * @param {Array}  messages agent 执行期间累积的消息列表
 * @param {string} step     当前步骤名（acceptance/regression/coverage/consolidate/verdict）
 * @param {string} role     角色名（release-gate 固定为 'V'）
 * @param {object} stepDef  步骤定义（含 outputs 数组）
 * @returns {Promise<string|null>} 报告文本，或 null（生成失败）
 */
async function generateReportWithoutTools(model, messages, step, role, stepDef) {
  // 1. 从工具结果中提取关键摘要（文件路径 + grep 结果等）
  // 每个 ToolMessage 截取前 500 字符，去重后最多 20 条（~10K tokens prompt）
  const toolSummaries = [];
  for (const msg of messages) {
    if (msg?._getType?.() === 'tool') {
      const content = typeof msg.content === 'string' ? msg.content : '';
      if (content.trim()) {
        toolSummaries.push(content.slice(0, 500).trim());
      }
    }
  }
  const unique = [...new Set(toolSummaries)].slice(0, 20);

  // 2. 构造裸 LLM 请求——无 tools，只有 system + user 消息
  const { SystemMessage, HumanMessage } = await import('@langchain/core/messages');

  const reportPrompt = [
    '你是发版闸门审查报告生成器。以下是之前审查过程中工具调用的结果摘要。',
    '请基于这些信息，写出完整的审查报告。',
    '',
    '报告要求：',
    `- 步骤：${step}（角色 ${role}）`,
    `- 产物文件：${(stepDef?.outputs ?? ['report.md']).join(', ')}`,
    '- 每条发现标注优先级：P0（严重/阻塞）/ P1（应该修）/ P2（观察项）',
    '- 给出文件路径和具体描述',
    '- 基于摘要中能看到的实际证据做判断——如果摘要中有明确的代码/配置/路径问题，标 P0 或 P1',
    '- 只有当摘要信息确实不足以确认时才标 P2"待证实"',
    '- 用中文写，Markdown 格式',
    '',
    `以下是 ${unique.length} 条工具结果摘要：`,
    '---',
    ...unique.map((s, i) => `[${i + 1}] ${s}`),
    '---',
  ].join('\n');

  const reportMessages = [
    new SystemMessage('你是 sofagent 项目的发版闸门独立审查者。现在需要你根据已有工具调用结果写出审查报告。不调用任何工具，直接输出报告文本。'),
    new HumanMessage(reportPrompt),
  ];

  // 3. 裸调用——不带 tools，模型只能输出文本
  const response = await model.invoke(reportMessages);
  const respText = typeof response === 'string'
    ? response
    : (response?.content ?? '');
  // 处理数组格式 content
  if (Array.isArray(respText)) {
    return respText.map(x => typeof x === 'string' ? x : x?.text ?? '').join('');
  }
  return typeof respText === 'string' && respText.trim() ? respText : null;
}

// ═══════════════════════════════════════════════════════════
//  Driver 模式 — 编排 5 步线性验证
// ═══════════════════════════════════════════════════════════

/**
 * 生成 run 目录路径：runs/release-gate-loop/YYYY-MM-DD/run-NN/
 * 单轮结构，无 round 子目录。
 */
function resolveRunDir() {
  const now = new Date();
  const y  = String(now.getFullYear());
  const m  = String(now.getMonth() + 1).padStart(2, '0');
  const d  = String(now.getDate()).padStart(2, '0');
  const dateStr = `${y}-${m}-${d}`;
  const workflowDir = join(RUNS_DIR, 'release-gate-loop');
  const dateDir = join(workflowDir, dateStr);

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
 * run 目录结构：RUNS_DIR/release-gate-loop/YYYY-MM-DD/run-NN/
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
 * release-gate-loop 不写 latest.json 指针，直接扫目录：
 * 日期目录倒序 → 每天取最大的 run-NN。
 *
 * 铁律：只读发现，不修改任何已有产物。
 *
 * @returns {string|null} 最近的 run 目录绝对路径；无任何历史 run 时返回 null
 */
function discoverLatestRunDir() {
  const workflowDir = join(RUNS_DIR, 'release-gate-loop');
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

/**
 * 起一个 worker 子进程（真·零上下文：独立 node 进程）。
 * 返回 Promise，resolve 时子进程已退出。
 *
 * @param {string} step      步骤名
 * @param {string} runDir    run 目录绝对路径
 * @param {string} target    验证目标版本号
 */
function spawnWorker(step, runDir, target) {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(process.execPath, [
      __filename,
      '--worker',
      '--step', step,
      '--run-dir', runDir,
      '--target', target,
    ], {
      cwd: REPO_ROOT,
      stdio: ['pipe', 'inherit', 'inherit'],
      env: { ...process.env },
    });

    child.on('close', (code) => {
      if (code === 0) resolveP();
      else rejectP(new Error(`worker ${step} 退出码 ${code}`));
    });
    child.on('error', rejectP);
  });
}

/**
 * v1.2.9 功能①：并行执行 acceptance 分片 worker（带并发限制）。
 *
 * 把 12 个 shard worker 按 maxConcurrency 分批执行，避免 API rate limit。
 *
 * @param {Array<[string,string,string]>} workers  [step, runDir, target] 元组数组
 * @param {string} _target  验证目标版本号（当前未使用，预留）
 * @param {number} maxConcurrency  最大并发数
 * @returns {Promise<{results: Array, failures: Array}>}
 */
async function spawnAcceptanceShards(workers, _target, maxConcurrency = 6) {
  const concurrency = Math.max(1, Math.min(maxConcurrency, workers.length));
  const results = [];
  const failures = [];

  for (let batchStart = 0; batchStart < workers.length; batchStart += concurrency) {
    const batch = workers.slice(batchStart, batchStart + concurrency);
    const batchNum = Math.floor(batchStart / concurrency) + 1;
    const totalBatches = Math.ceil(workers.length / concurrency);
    console.log(`  [acceptance 并发批次 ${batchNum}/${totalBatches}] 启动 ${batch.length} 个 shard worker（并发=${concurrency}）`);

    const settled = await Promise.allSettled(
      batch.map(([step, runDir, target]) => spawnWorker(step, runDir, target))
    );
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
  }
  return { results, failures };
}

/**
 * 运行一个 shell 命令并等待完成（用于 driver 直接执行，无 run_bash 60s 限制）。
 *
 * @param {string} command    shell 命令
 * @param {string} cwd        工作目录
 * @param {number} timeoutMs  超时（毫秒）
 * @returns {Promise<{ stdout: string, stderr: string, code: number }>}
 */
function runCommand(command, cwd, timeoutMs) {
  return new Promise((resolveP, rejectP) => {
    const child = spawn('bash', ['-c', command], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rejectP(new Error(`命令超时 (${timeoutMs}ms): ${command}`));
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolveP({ stdout, stderr, code });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      rejectP(err);
    });
  });
}

/**
 * driver 直接预跑 acceptance-test.sh（绕过 LLM agent 的 60s 限制）。
 *
 * 流程：
 *   1. 先 cd engine/audit && npm run build（acceptance-test.sh 依赖 dist 产物）
 *   2. spawn bash acceptance-test.sh，等待完成（Node.js 没有 60s 限制）
 *   3. 完整输出写入 {runDir}/acceptance-raw.log
 *
 * 即使预跑失败也不中断——把错误写入 acceptance-raw.log，让 worker 从错误日志生成报告。
 *
 * @param {string} runDir   run 目录绝对路径
 * @returns {Promise<{ exitCode: number, logPath: string, stdout: string }>}
 */
async function runAcceptanceTestDirectly(runDir) {
  const logPath = join(runDir, 'acceptance-raw.log');
  const scriptPath = join(REPO_ROOT, 'FORGE/playbook/acceptance-test.sh');

  // 第 1 步：构建审计包（acceptance-test.sh 依赖 dist 产物）
  // 优化：dist/index.js 已存在时跳过 build，减少 driver 被 sandbox kill 的窗口
  const auditDist = join(REPO_ROOT, 'engine/audit/dist/index.js');
  if (existsSync(auditDist)) {
    console.log('[driver] 审计包 dist 已存在，跳过 build');
  } else {
    console.log('[driver] 预跑 acceptance-test.sh — 先构建审计包 (engine/audit)...');
    try {
      const buildResult = await runCommand(
        'npm run build',
        join(REPO_ROOT, 'engine/audit'),
        120_000,
      );
      if (buildResult.code !== 0) {
        console.warn(`[driver] 构建审计包退出码 ${buildResult.code}（继续尝试运行测试）`);
      } else {
        console.log('[driver] 审计包构建完成');
      }
    } catch (buildErr) {
      console.warn(`[driver] 审计包构建失败（继续尝试运行测试）: ${buildErr.message}`);
    }
  }

  // 第 2 步：直接 spawn acceptance-test.sh，driver 等待完成
  // v1.2.5 加固：流式写入日志（sandbox kill 时已捕获部分不丢失）+ progress 日志 + signal 处理
  const ACCEPTANCE_TIMEOUT_MS = 900_000; // 15 分钟（比 sandbox kill 窗口长，但不至于等太久）
  console.log(`[driver] 开始运行 acceptance-test.sh（超时 ${ACCEPTANCE_TIMEOUT_MS / 60_000} 分钟）...`);
  const startTime = Date.now();

  const result = await new Promise((resolveP, rejectP) => {
    const child = spawn('bash', [scriptPath], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let lastProgressLog = Date.now();

    // 流式写入：收到数据就追加到日志文件（sandbox kill 时已捕获部分不丢失）
    const writeStream = createWriteStream(logPath, { flags: 'w' });

    child.stdout.on('data', (d) => {
      stdout += d;
      writeStream.write(d);
      // 每 30s 输出一次进度（便于诊断卡住位置）
      if (Date.now() - lastProgressLog > 30_000) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const lastLine = stdout.trim().split('\n').pop()?.slice(0, 80) || '(empty)';
        console.log(`[driver] acceptance-test.sh 运行中... ${elapsed}s, 已捕获 ${stdout.length} bytes, 末行: ${lastLine}`);
        lastProgressLog = Date.now();
      }
    });
    child.stderr.on('data', (d) => {
      stderr += d;
      writeStream.write(d);
    });

    // 超时处理
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      writeStream.end(`\n--- DRIVER TIMEOUT (${ACCEPTANCE_TIMEOUT_MS}ms) ---\n`);
      rejectP(new Error(`acceptance-test.sh 超时 (${ACCEPTANCE_TIMEOUT_MS}ms)`));
    }, ACCEPTANCE_TIMEOUT_MS);

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      writeStream.end(stderr ? `\n--- STDERR ---\n${stderr}` : '');
      const fullLog = stdout + (stderr ? '\n--- STDERR ---\n' + stderr : '');
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      // v1.2.5: 处理 signal——被 sandbox kill 时 code=null, signal='SIGTERM'/'SIGKILL'
      if (signal) {
        console.warn(`[driver] acceptance-test.sh 被信号终止: ${signal}（可能是 sandbox kill），耗时 ${elapsed}s，已捕获 ${stdout.length} bytes`);
      } else {
        console.log(`[driver] acceptance-test.sh 完成，exit code = ${code}，耗时 ${elapsed}s`);
      }
      resolveP({ exitCode: code ?? -1, logPath, stdout: fullLog });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      writeStream.end();
      rejectP(err);
    });
  });

  console.log(`[driver] 日志已流式写入 ${logPath}`);

  return result;
}

// ═══════════════════════════════════════════════════════════
// v1.2.5+ 性能优化：regression 预执行器（方案 A：执行层从 LLM 剥离）
// ═══════════════════════════════════════════════════════════
// 背景：run-02 实测 regression worker 跑了 1665 个工具调用、耗时 ~50 分钟，
//   worker 在模型写完报告前被 GraphRecursionError(limit=400) 截断崩溃。
//   根因：regression-checklist.md 的命令是确定性的，但 LLM 逐维度探索执行，
//   大量重复读文件/乱试命令/失败重试，把「确定性检查」跑成了「探索型任务」。
// 方案：driver 直接解析 checklist 的 ```bash 代码块并按维度批量执行（零 LLM），
//   结果写入 {runDir}/regression-precheck.json。worker 只读该文件判定 PASS/FAIL，
//   工具调用从 1665 次降到 ~5 次，消除递归超限 + 大幅提速。

/**
 * 解析 regression-checklist.md，提取每个维度的 bash 代码块。
 * 锚点：`#### N. 维度标题`；块：维度内所有 ```bash ... ``` 代码块。
 * 跳过维度外的代码块（如「清单自身健康度自校验」）。
 *
 * @returns {Array<{ num: number, title: string, script: string }>}
 */
function parseRegressionDimensions() {
  const checklistPath = join(REPO_ROOT, 'FORGE/playbook/regression-checklist.md');
  const md = readFileSync(checklistPath, 'utf-8');
  const lines = md.split('\n');

  const dims = [];
  let current = null;       // { num, title, blocks: [] }
  let inCode = false;
  let codeBuf = [];

  const flushCode = () => {
    if (current && codeBuf.length > 0) {
      current.script = (current.script || '') + codeBuf.join('\n') + '\n';
    }
    codeBuf = [];
  };

  for (const line of lines) {
    const dimMatch = line.match(/^####\s+(\d+)\.\s+(.*)$/);
    if (dimMatch) {
      flushCode();
      current = { num: parseInt(dimMatch[1], 10), title: dimMatch[2].trim(), script: '' };
      dims.push(current);
      continue;
    }
    if (/^```bash\s*$/.test(line)) {
      flushCode();           // 上一个块收尾（如有）
      inCode = true;
      codeBuf = [];
      continue;
    }
    if (/^```\s*$/.test(line)) {
      flushCode();
      inCode = false;
      continue;
    }
    if (inCode && current) {
      codeBuf.push(line);
    }
    // 维度外的代码块（current === null 或不在维度内）忽略
  }
  flushCode();

  return dims.filter(d => d.script.trim().length > 0);
}

/**
 * 执行一个维度的 bash 脚本（单次 runCommand，无 60s 限制），捕获输出。
 * 失败不中断——exitCode 和 output 都记录，交给 worker 判定。
 *
 * @param {string} script  维度 bash 脚本
 * @param {number} timeoutMs 超时（毫秒），默认 60s
 * @returns {Promise<{ exitCode: number|null, output: string }>}
 */
async function execRegressionDim(script, timeoutMs = 60_000) {
  try {
    const { stdout, stderr, code } = await runCommand(script, REPO_ROOT, timeoutMs);
    const output = `${stdout}\n${stderr}`.trim();
    return { exitCode: code ?? null, output: output.slice(0, 8000) };
  } catch (err) {
    return { exitCode: null, output: `[driver] 执行异常: ${err.message}` };
  }
}

/**
 * 预执行全部 regression 维度，写 {runDir}/regression-precheck.json。
 *
 * 文件格式：
 * {
 *   "meta": { "source": "FORGE/playbook/regression-checklist.md", "dims": 49, "runAt": "..." },
 *   "dims": {
 *     "1": { "num": 1, "title": "CHANGELOG 纯度与完整性", "exitCode": 0, "output": "..." },
 *     ...
 *   }
 * }
 *
 * worker 依据 exitCode + output 判定 PASS/FAIL/⏰/⏸️，不再自己跑命令。
 *
 * @param {string} runDir  run 目录
 */
async function runRegressionPrecheck(runDir) {
  console.log('[driver] 预执行 regression-checklist（方案 A：命令执行从 LLM 剥离）...');
  const t0 = Date.now();
  const dims = parseRegressionDimensions();
  console.log(`[driver] 解析到 ${dims.length} 个维度（含 bash 代码块）`);

  const payload = {
    meta: {
      source: 'FORGE/playbook/regression-checklist.md',
      dims: dims.length,
      runAt: new Date().toISOString(),
      note: '由 driver 预执行生成（v1.2.5+ 方案 A）。worker 只读此文件判定，禁止重新执行命令。',
    },
    dims: {},
  };

  // 顺序执行（维度间无依赖；串行以复用 runCommand 简单实现）
  for (const dim of dims) {
    const timeout = DIM_TIMEOUT_OVERRIDE[dim.num] ?? 60_000;
    const { exitCode, output } = await execRegressionDim(dim.script, timeout);
    payload.dims[String(dim.num)] = {
      num: dim.num,
      title: dim.title,
      exitCode,
      output,
    };
    console.log(`  [precheck] 维度 ${dim.num} ${dim.title.slice(0, 24)}... exit=${exitCode ?? 'ERR'} (${output.length}B)`);
  }

  const outPath = join(runDir, 'regression-precheck.json');
  writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf-8');
  console.log(`[driver] regression-precheck.json 已写入 ${outPath}（${dims.length} 维度，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s）`);
  return outPath;
}

// ═══════════════════════════════════════════════════════════
// v1.2.5+ 性能优化：coverage 预执行器（方案 A 扩展到步骤③）
// ═══════════════════════════════════════════════════════════
// 背景：run-06 coverage worker 因注入的 changelog 路径错误（docs/changelog/v1.2.5.md
//   不存在，实际在 docs/changelog/v1.2/v1.2.5.md）陷入找文件死循环，39 个工具调用
//   后撞硬上限，写报告窗口耗尽被强杀（"Agent 未返回内容"）。
// 方案：driver 预解析 changelog 功能模块标题 + acceptance-test.sh 场景索引，
//   写入 coverage-precheck.json。worker 只读该文件做交叉判定，不再自行 find/grep。

/**
 * 解析 acceptance-test.sh 的场景索引（编号 + 标题）。
 * 格式：`scenario N "标题"`（可跨多行——标题在下一行；用正则宽松匹配）。
 *
 * @returns {Array<{ num: number, title: string }>}
 */
function parseAcceptanceScenarios() {
  const accPath = join(REPO_ROOT, 'FORGE/playbook/acceptance-test.sh');
  const src = readFileSync(accPath, 'utf-8');
  const scenarios = [];
  // 匹配 scenario <num> "<title>..."> 或 scenario <num> 换行 "<title>"
  const re = /scenario\s+(\d+)\s*(?:\([^)]*\))?\s*"([^"]{0,120})/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const title = m[2].trim();
    if (title.length > 0) {
      scenarios.push({ num: parseInt(m[1], 10), title });
    }
  }
  return scenarios;
}

/**
 * 解析 changelog 的功能模块标题（## 开头的一级模块）。
 *
 * @param {string} changelogRelPath changelog 相对路径（resolveChangelogPath 结果）
 * @returns {Array<{ title: string }>}
 */
function parseChangelogModules(changelogRelPath) {
  const absPath = join(REPO_ROOT, changelogRelPath);
  if (!existsSync(absPath)) {
    console.warn(`[driver] changelog 不存在，模块解析为空: ${changelogRelPath}`);
    return [];
  }
  const md = readFileSync(absPath, 'utf-8');
  const modules = [];
  for (const line of md.split('\n')) {
    const m = line.match(/^##\s+(.+)$/);
    if (m && !/^##\s+(背景|前置依赖|状态)/.test(line)) {
      modules.push({ title: m[1].trim() });
    }
  }
  return modules;
}

/**
 * 预执行 coverage 交叉检查的数据准备，写 {runDir}/coverage-precheck.json。
 *
 * 文件格式：
 * {
 *   "meta": { "changelogPath": "docs/changelog/v1.2/v1.2.5.md", "modules": N, "scenarios": M, "runAt": "..." },
 *   "changelog": [ { "title": "🔗 激活链 Phase 1：ACTIVATE" }, ... ],
 *   "scenarios": [ { "num": 1, "title": "..." }, ... ]
 * }
 *
 * worker 依据 changelog 模块 + 场景索引交叉判定覆盖情况，不再自行探索文件。
 *
 * @param {string} runDir  run 目录
 * @param {string} target  版本号
 * @returns {string} 产物路径
 */
async function runCoveragePrecheck(runDir, target) {
  console.log('[driver] 预执行 coverage（方案 A：场景索引 + changelog 模块从 LLM 剥离）...');
  const t0 = Date.now();

  const changelogRel = resolveChangelogPath(target);
  const changelogModules = parseChangelogModules(changelogRel);
  const scenarios = parseAcceptanceScenarios();

  const payload = {
    meta: {
      changelogPath: changelogRel,
      modules: changelogModules.length,
      scenarios: scenarios.length,
      runAt: new Date().toISOString(),
      note: '由 driver 预执行生成（v1.2.5+ 方案 A）。worker 只读此文件做覆盖交叉判定，禁止重新探索文件。',
    },
    changelog: changelogModules,
    scenarios,
  };

  const outPath = join(runDir, 'coverage-precheck.json');
  writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf-8');
  console.log(`[driver] coverage-precheck.json 已写入 ${outPath}（${changelogModules.length} 模块 / ${scenarios.length} 场景，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s）`);
  return outPath;
}

/**
 * 从 verdict.md 解析最终裁决（PASS/FAIL）。
 * driver 用于 LEDGER 记录和最终输出。
 *
 * @param {string} runDir   run 目录
 * @returns {{ verdict: string, reason: string }}
 */
function parseVerdict(runDir) {
  const verdictPath = join(runDir, 'verdict.md');

  if (!existsSync(verdictPath)) {
    return { verdict: 'ERROR', reason: 'verdict.md 不存在（步骤⑤未产出）' };
  }

  const text = readFileSync(verdictPath, 'utf-8');

  /**
   * 从文本中提取裁决关键词（PASS/FAIL/SKIP）。
   *
   * 健壮性要点：
   *  1. 先剥离 ``` 围栏代码块——报告正文的日志转储/负向测试输出常含 FAIL 字样，
   *     它们不是裁决结论，必须先去除以免污染解析。
   *  2. 只在「判定」「结论」标记所在行及其紧邻窗口内提取结论词，
   *     绝不做「全文含 FAIL 即判 FAIL」这类脆弱兜底。
   *  3. 标记与结论词之间允许夹杂 emoji（✅/❌）、标点（：:）、空白与 markdown 符号；
   *     一旦出现中文或英文字母（如「判定理由」「判定为」）即中断匹配，
   *     防止误抓「无 FAIL 条目」「全部判定 PASS」这类无关句子。
   *
   * @param {string} raw 原始文本
   * @returns {string|null} 'PASS' | 'FAIL' | 'SKIP' | null
   */
  function extractVerdictKeyword(raw) {
    const stripped = raw.replace(/```[\s\S]*?```/g, '\n');
    const lines = stripped.split(/\r?\n/);
    const markers = ['判定', '结论'];
    for (const marker of markers) {
      for (let i = 0; i < lines.length; i++) {
        const col = lines[i].indexOf(marker);
        if (col === -1) continue;
        // 窗口 = 标记行剩余部分 + 后续 3 行
        const windowText = lines.slice(i, i + 4).join('\n').slice(col + marker.length);
        const m = windowText.match(/^[^A-Za-z\u4e00-\u9fff]*?(PASS|FAIL|SKIP)/i);
        if (m) return m[1].toUpperCase();
      }
    }
    return null;
  }

  const keyword = extractVerdictKeyword(text);
  if (keyword === 'PASS' || keyword === 'FAIL') {
    return { verdict: keyword, reason: 'verdict.md 裁决' };
  }

  // 兜底：找不到可判定的结论标记。不再用「全文含 FAIL」误判，直接报 ERROR。
  return { verdict: 'ERROR', reason: 'verdict.md 未能从「判定/结论」行解析出 PASS/FAIL' };
}

/**
 * 从三份产物中提取各步骤的验证结果（PASS/FAIL/SKIP）。
 * 用于 LEDGER 记录。
 *
 * @param {string} runDir   run 目录
 * @returns {{ acceptance: string, regression: string, coverage: string }}
 */
function parseStepResults(runDir) {
  /**
   * 从单份报告文本中提取结论关键词（PASS/FAIL/SKIP）。
   * 解析策略与 parseVerdict 完全一致：剥离代码块 → 定位「判定/结论」标记行 →
   * 仅在标记行窗口内取结论词，杜绝「全文含 FAIL 即判 FAIL」的系统性误判
   * （负向测试场景、覆盖率表的 ❌ 都会让旧兜底把 PASS 报告误读成 FAIL）。
   *
   * @param {string} raw 原始文本
   * @returns {string|null} 'PASS' | 'FAIL' | 'SKIP' | null
   */
  function extractVerdictKeyword(raw) {
    const stripped = raw.replace(/```[\s\S]*?```/g, '\n');
    const lines = stripped.split(/\r?\n/);
    const markers = ['判定', '结论'];
    for (const marker of markers) {
      for (let i = 0; i < lines.length; i++) {
        const col = lines[i].indexOf(marker);
        if (col === -1) continue;
        // 窗口 = 标记行剩余部分 + 后续 3 行
        const windowText = lines.slice(i, i + 4).join('\n').slice(col + marker.length);
        const m = windowText.match(/^[^A-Za-z\u4e00-\u9fff]*?(PASS|FAIL|SKIP)/i);
        if (m) return m[1].toUpperCase();
      }
    }
    return null;
  }

  function extractResult(filename) {
    const filePath = join(runDir, filename);
    if (!existsSync(filePath)) return 'SKIP';
    const text = readFileSync(filePath, 'utf-8');
    const keyword = extractVerdictKeyword(text);
    if (keyword) return keyword;
    // 兜底：报告缺少可识别的结论标记 → 记为 SKIP（未知），
    // 不再用「全文含 FAIL」把 PASS 报告误判成 FAIL。
    return 'SKIP';
  }

  // v1.3.0 run-21 修复：acceptance 结果用确定性日志判定，不依赖 LLM worker 解读。
  //
  // 背景：acceptance-consolidate/分片 worker 解读预跑日志不可靠——run-21 实测：
  //   ① 把 grep 命令的 exit code（无匹配→1）误当脚本退出码，幻觉「EXIT: 1」；
  //   ② 不懂场景编号非连续设计，把不存在的编号（105/107/109-116）当「9 场景缺失」；
  //   ③ 把 S028 的 ⚠️ WARN 当缺陷 → 误判 acceptance FAIL → F 修复链对假 FAIL 空跑一轮。
  //
  // 修复：预跑日志总结行是权威（「验收测试结果：N 通过 / M 失败」+「✅ 全部通过」），
  // driver 用确定性正则判定。日志存在且可解析 → 直接给结论（覆盖 LLM 解读）；
  // 日志缺失/不可解析 → 回退 extractResult('acceptance.md')（LLM 解读兜底）。
  function extractAcceptanceResult() {
    const logPath = join(runDir, 'acceptance-raw.log');
    if (existsSync(logPath)) {
      const raw = readFileSync(logPath, 'utf-8');
      // 剥离 ANSI 颜色码——acceptance-test.sh 输出带 \x1b[0;32m 等转义，
      // 「241 通过」实为「\x1b[0;32m241 通过\x1b[0m」，直接正则匹配会失败（run-21 回放实测）。
      const log = raw.replace(/\x1b\[[0-9;]*m/g, '');
      const summaryMatch = log.match(/验收测试结果：\s*(\d+)\s*通过\s*\/\s*(\d+)\s*失败/);
      if (summaryMatch) {
        const passCount = parseInt(summaryMatch[1], 10);
        const failCount = parseInt(summaryMatch[2], 10);
        if (passCount > 0 && failCount === 0 && /全部通过/.test(log)) return 'PASS';
        return 'FAIL';
      }
    }
    return extractResult('acceptance.md');
  }

  return {
    acceptance:  extractAcceptanceResult(),
    regression:  extractResult('regression.md'),
    coverage:    extractResult('coverage.md'),
  };
}

/**
 * 复制 stage6-report.md 到桌面。
 * 目标路径：~/Desktop/vX.Y-stage6-report.md
 */
function copyToDesktop(runDir, target) {
  const reportPath = join(runDir, 'stage6-report.md');
  if (!existsSync(reportPath)) {
    console.warn('[driver] stage6-report.md 不存在，跳过桌面复制');
    return;
  }
  const desktopPath = join(os.homedir(), 'Desktop', `${target}-stage6-report.md`);
  try {
    copyFileSync(reportPath, desktopPath);
    console.log(`[driver] 报告已复制到桌面: ${desktopPath}`);
  } catch (err) {
    console.warn(`[driver] 桌面复制失败（不影响主流程）: ${err.message}`);
  }
}

/**
 * 向 LEDGER.md 追加一行。
 * 格式（release-gate 列定义）：
 *   日期 | run-id | 循环 | 步数 | acceptance | regression | coverage | 裁决 | → runs 指针
 */
function appendLedger(dateStr, runId, steps, results, verdict, runDir) {
  const relPath = runDir.replace(REPO_ROOT + '/', '');
  const line = [
    dateStr.padEnd(14),
    runId.padEnd(14),
    'release-gate'.padEnd(12),
    String(steps).padEnd(4),
    results.acceptance.padEnd(10),
    results.regression.padEnd(10),
    results.coverage.padEnd(8),
    verdict.padEnd(7),
    relPath,
  ].join(' | ');

  const content = `\n${line}\n`;
  appendFileSync(LEDGER_PATH, content, 'utf-8');
  console.log(`[driver] LEDGER 已追加: ${line}`);
}

/**
 * 读 usage.jsonl 全量累计，生成 _summary 行并追加到文件末尾。
 * 单角色 V，by_role 只有 V。
 */
function appendUsageSummary(runDir, steps) {
  const usagePath = join(runDir, 'usage.jsonl');
  const byRole = {
    V: { model: '', prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost_cny: 0 },
  };

  if (existsSync(usagePath)) {
    const lines = readFileSync(usagePath, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      let rec;
      try { rec = JSON.parse(line); } catch { continue; }
      if (rec._summary) continue;
      if (!rec.role || !(rec.role in byRole)) continue;

      byRole[rec.role].model = rec.model || byRole[rec.role].model;
      if (rec.prompt_tokens)     byRole[rec.role].prompt_tokens     += rec.prompt_tokens;
      if (rec.completion_tokens) byRole[rec.role].completion_tokens += rec.completion_tokens;
      if (rec.total_tokens)      byRole[rec.role].total_tokens      += rec.total_tokens;
      if (rec.cost_cny)          byRole[rec.role].cost_cny          += rec.cost_cny;
    }
  }

  const totalTokens = byRole.V.total_tokens;
  const totalCost   = byRole.V.cost_cny;

  const summary = {
    _summary:       true,
    total_tokens:   totalTokens,
    total_cost_cny: Number(totalCost.toFixed(6)),
    steps:          steps,
    by_role:        byRole,
    v_billing:      'subscription',
  };

  appendFileSync(usagePath, JSON.stringify(summary) + '\n', 'utf-8');
  return summary;
}

// ═══════════════════════════════════════════════════════════
//  可见性：适配器探测
// ═══════════════════════════════════════════════════════════

/**
 * 探测环境中可用的进度适配器。
 * 与 fresh-eyes-driver 一致——返回空数组，session 自己读 status.json。
 */
async function detectReporters() {
  return [];
}

/**
 * 确保 acceptance 步骤的预跑日志存在。
 *
 * 三种情况：
 *   1. --skip-acceptance 且日志不存在 → 写占位文件，提示手动预跑
 *   2. 日志已存在 → 跳过预跑（复用模式）
 *   3. 其他 → driver 直接预跑 acceptance-test.sh
 *
 * @param {object} args   解析后的 CLI 参数
 * @param {string} runDir run 目录绝对路径
 */
async function ensureAcceptancePreRun(args, runDir) {
  const preRunLog = join(runDir, 'acceptance-raw.log');
  const externalLog = '/tmp/acceptance-raw.log';
  if (args.skipAcceptance && !existsSync(preRunLog)) {
    // v1.2.7 修复：先检查 /tmp/acceptance-raw.log（外部预跑日志），存在就复制到 runDir
    // 根因：runDir 由 driver 启动时创建，用户无法在启动前预跑日志到 runDir
    if (existsSync(externalLog)) {
      copyFileSync(externalLog, preRunLog);
      console.log(`  [driver] --skip-acceptance 已从 ${externalLog} 复制预跑日志到 runDir`);
    } else {
      console.log('  [driver] --skip-acceptance 已指定，但未找到预跑日志');
      console.log(`  [driver] 请先手动预跑：bash FORGE/playbook/acceptance-test.sh > ${externalLog} 2>&1`);
      writeFileSync(preRunLog,
        '--skip-acceptance 模式：未预跑 acceptance-test.sh。\n' +
        `请手动预跑后把日志放到 ${externalLog}（driver 会自动复制），\n` +
        '或去掉 --skip-acceptance 参数让 driver 自动预跑。\n',
        'utf-8');
    }
  } else if (existsSync(preRunLog)) {
    console.log('  [driver] acceptance-raw.log 已存在，跳过预跑（复用模式）');
  } else {
    console.log('  [driver] acceptance 特殊处理：driver 直接预跑 acceptance-test.sh');
    try {
      await runAcceptanceTestDirectly(runDir);
    } catch (e) {
      console.warn(`  [driver] acceptance-test.sh 预跑失败: ${e.message}`);
      // 即使预跑失败也继续 spawnWorker，让 agent 从错误日志中生成报告
      writeFileSync(
        preRunLog,
        `acceptance-test.sh 预跑失败: ${e.message}\n${e.stack || ''}`,
        'utf-8',
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  主入口
// ═══════════════════════════════════════════════════════════

/**
 * 打印用法帮助。
 */
function printHelp() {
  console.log(`
release-gate-driver.mjs - FORGE release-gate-loop Driver

用法:
  node FORGE/src/release-gate-driver.mjs --target <version> [options]
  node FORGE/src/release-gate-driver.mjs --step <step> --target <version> [options]
  node FORGE/src/release-gate-driver.mjs --worker --step <step> --run-dir <dir> --target <version>

参数:
  --target <ver>            验证目标版本号 (如 v1.2.4)
  --step <stepName>         只执行单个步骤然后退出 (单步模式)
                            stepName: acceptance | regression | coverage | consolidate | verdict
  --run-dir <dir>           指定 run 目录绝对路径 (单步模式下用于多步共享同一目录)
  --skip-acceptance         跳过 acceptance 预跑 (复用手动预跑的 acceptance-raw.log)
  --dry-run                 只打印将执行的步骤，不实际运行
  --worker                  内部 worker 模式 (由 driver spawn，一般不手动使用)
  --help, -h                显示此帮助信息

模式说明:
  全量模式 (默认):  串行执行全部 5 步，每步 spawn 独立 worker 子进程
  单步模式 (--step): 只执行指定步骤，执行完后进程退出 (exit 0)
                    stdout 打印: [driver] STEP_DONE: <stepName> EXIT_CODE=0
                    与全量模式使用相同的 run 目录逻辑，确保产物写到正确位置
                    适合外层 bash 脚本编排，每步一个全新进程，内存归零
`);
}

async function main() {
  const args = parseArgs(process.argv);

  // ─── 帮助 ───
  if (args.help) {
    printHelp();
    return;
  }

  // ─── Worker 模式 ───
  if (args.worker) {
    if (!args.step || !args.runDir || !args.target) {
      console.error('worker 模式需要 --step --run-dir --target');
      process.exit(1);
    }
    try {
      await runWorker(args.step, args.runDir, args.target);
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
  // release-gate 的"轮" = V 阶段一轮 + 可能的 F 修复轮。断点策略：
  //   - V 阶段 verdict 解析后写 { phase: 'verdict-done', verdict, fixRoundsRun: 0 }
  //   - 每个 F 轮完成后写 { phase: 'f-round-done', fixRoundsRun: round }
  //   - V 阶段步骤幂等可重跑（产物会被覆盖），V 阶段内不写步骤级断点
  // 铁律：resume 只跳过重跑，不修改已有产物；dry-run 永远不写断点；
  // worker 模式已在上面 return，不处理 resume。
  let resumeState = null;        // loadResumePoint 的结果（null = 无断点）
  let resumeRunDir = null;       // resume 复用的已有 run 目录
  let skipVPhase = false;        // 断点已过 verdict → 跳过 V 阶段 5 步
  let resumeVerdict = null;      // 断点记录的 verdict（resume 进入 F 链的入口）
  let resumeReason = 'resume：复用断点记录的 verdict';
  let resumeFixRoundsRun = 0;    // F 链已完成轮数
  let resumeCompletedSteps = 0;  // 已完成步数（V:5 + F:每轮 3 步）

  if (args.resume && !args.dryRun) {
    const discovered = discoverLatestRunDir();
    if (!discovered) {
      console.warn('⚠️  --resume：未找到任何历史 run 目录，从头开始');
    } else {
      resumeState = base.loadResumePoint(discovered);
      if (!resumeState) {
        console.warn(`⚠️  --resume：${discovered} 无有效断点（resume-point.json 不存在或损坏），从头开始`);
      } else if (resumeState.phase === 'verdict-done' && resumeState.verdict === 'PASS') {
        console.log('✅ resume：上次 V 阶段 verdict=PASS，无需续跑');
        process.exit(0);
      } else if (resumeState.phase === 'f-round-done' && resumeState.verdict === 'PASS') {
        console.log('✅ resume：F 修复链已收敛为 PASS，无需续跑');
        process.exit(0);
      } else if (resumeState.phase === 'verdict-done' && resumeState.verdict === 'FAIL') {
        resumeRunDir = discovered;
        skipVPhase = true;
        resumeVerdict = 'FAIL';
        resumeFixRoundsRun = 0;
        resumeCompletedSteps = STEP_ORDER.length;
        console.log(`🔄 resume：上次 V 阶段 verdict=FAIL，从 F 修复链 Round 1 开始，复用 ${discovered}`);
      } else if (resumeState.phase === 'f-round-done') {
        resumeRunDir = discovered;
        skipVPhase = true;
        resumeVerdict = 'FAIL';
        resumeFixRoundsRun = typeof resumeState.fixRoundsRun === 'number' ? resumeState.fixRoundsRun : 0;
        resumeCompletedSteps = STEP_ORDER.length + resumeFixRoundsRun * 3;
        console.log(`🔄 resume：F 修复链已完成 ${resumeFixRoundsRun} 轮，从 Round ${resumeFixRoundsRun + 1} 开始，复用 ${discovered}`);
      } else {
        console.warn(`⚠️  --resume：断点 phase=${resumeState.phase || '?'} 不可续跑（V 阶段内中断），从头开始`);
        // 从头开始 = 新建 run 目录——不能复用旧 runDir 覆盖已有产物
        resumeState = null;
      }
    }
  }

  if (!args.target) {
    // --target 未传时从断点读取 target（v1.2.8 功能⑦）；断点也没有则报错退出
    if (resumeState && typeof resumeState.target === 'string' && resumeState.target) {
      args.target = resumeState.target;
      console.log(`   target    = ${args.target}（从断点恢复）`);
    } else {
      console.error('用法: node FORGE/src/release-gate-driver.mjs --target vX.Y.Z [--dry-run] [--skip-acceptance] [--resume]');
      console.error('      node FORGE/src/release-gate-driver.mjs --step <acceptance|regression|coverage|consolidate|verdict|f-diagnose|f-fix|f-audit> --target vX.Y.Z');
      console.error('      node FORGE/src/release-gate-driver.mjs --help');
      console.error('      --resume 模式也需 --target，除非断点中已保存 target');
      process.exit(1);
    }
  }

  // 验证环境变量（dry-run 跳过）
  // v1.2.8：V + F 双角色都需要校验
  const missingEnvs = [];
  for (const role of ['V', 'F']) {
    const cfg = MODEL_CONFIGS[role];
    if (!process.env[cfg.apiKeyEnv])  missingEnvs.push(cfg.apiKeyEnv);
    if (!process.env[cfg.specEnv])    missingEnvs.push(cfg.specEnv);
  }
  if (missingEnvs.length > 0 && !args.dryRun) {
    console.error(`缺少环境变量: ${missingEnvs.join(', ')}`);
    console.error('请在 ~/.zshrc 中设置后 source ~/.zshrc');
    process.exit(1);
  }

  // ─── 单步模式 (--step，非 worker) ───
  // 只执行指定步骤，然后进程退出。每步一个全新进程，内存归零。
  // 适合外层 bash 编排脚本逐步调用。
  // v1.2.8：支持 V + F + audit(driver) 全部步骤
  const ALL_STEPS = [...STEP_ORDER, 'f-diagnose', 'f-fix', 'f-audit'];
  if (args.step && !args.worker) {
    if (!ALL_STEPS.includes(args.step)) {
      console.error(`未知步骤: ${args.step}，可选: ${ALL_STEPS.join(', ')}`);
      process.exit(1);
    }

    // run 目录：优先使用 --run-dir，否则自动发现最新 run 目录或新建
    let stepRunDir = args.runDir;
    if (!stepRunDir) {
      const resolved = resolveRunDir();
      stepRunDir = resolved.runDir;
    }
    if (!existsSync(stepRunDir)) {
      mkdirSync(stepRunDir, { recursive: true });
    }

    console.log(`[driver] 单步模式: step=${args.step} target=${args.target}`);
    console.log(`[driver] run-dir = ${stepRunDir}`);

    // acceptance 特殊处理：单步模式下也执行预跑逻辑
    // v1.2.9 功能①：acceptance shard 步骤也需要预跑日志
    if (args.step === 'acceptance' || args.step.startsWith('acceptance-s') || args.step === 'acceptance-consolidate') {
      await ensureAcceptancePreRun(args, stepRunDir);
    }

    try {
      // v1.2.8：role:null 步骤走 driver 直接执行（runAuditGate），不 spawn worker
      const stepDef = STEPS[args.step];
      if (stepDef.role === null) {
        console.log(`[driver] ${args.step} = driver 步骤（role:null），直接执行 ${stepDef.driverFn}`);
        const result = await base.runAuditGate(stepRunDir, args.step, 1);
        console.log(`[driver] audit gate: passed=${result.passed} exitCode=${result.exitCode}`);
      } else {
        await runWorker(args.step, stepRunDir, args.target);
      }
      console.log(`[driver] STEP_DONE: ${args.step} EXIT_CODE=0`);
      process.exit(0);
    } catch (err) {
      console.error(`[driver] STEP_DONE: ${args.step} EXIT_CODE=1 ERROR=${err.message}`);
      process.exit(1);
    }
  }

  // 建 run 目录（v1.2.8 功能⑦：resume 模式复用已有目录，不新建）
  const { runDir, runId, dateStr } = resumeRunDir
    ? resolveRunDirInfo(resumeRunDir)
    : resolveRunDir();

  // ─── v1.2.8 功能⑦：断点写入闭包 ───
  // 铁律：dry-run 永远不写断点；断点只存状态摘要不存大体积数据；
  // 写失败不阻断主流程（断点是优化层不是正确性层）。
  // round 字段：V 阶段 verdict-done 时为 0，F 轮完成时为已完成 F 轮数。
  const saveGateCheckpoint = (phase, currentVerdict, fixRounds) => {
    if (args.dryRun) return;
    try {
      base.saveResumePoint(runDir, {
        round: fixRounds,
        completed: true,
        phase,
        verdict: currentVerdict,
        fixRoundsRun: fixRounds,
        target: args.target,
      });
    } catch (ckptErr) {
      console.warn(`  ⚠️  断点写入失败（不影响主流程）: ${ckptErr.message}`);
    }
  };

  // ─── 可见性：初始化 ───
  const reporters = await detectReporters();
  const visibility = createVisibility(runDir, reporters);
  globalVisibility = visibility;
  visibility.emit(EVENTS.RUN_START, {
    target: args.target,
    runDir: runDir.replace(REPO_ROOT + '/', ''),
  });
  console.log(`   可见性     = ${reporters.length} 个适配器`);

  console.log(`\n🚪 release-gate-loop 启动`);
  console.log(`   target    = sofagent ${args.target}`);
  console.log(`   run-dir    = ${runDir}`);
  console.log(`   dry-run    = ${args.dryRun}`);
  if (args.skipAcceptance) {
    console.log(`   skip-acc   = true（跳过 acceptance 预跑，复用手动预跑日志）`);
  }
  // v1.2.8 功能⑦：启动日志打印 resume 状态
  if (args.resume && !args.dryRun) {
    if (resumeRunDir) {
      console.log(`   resume     = 断点恢复（phase=${resumeState.phase} verdict=${resumeState.verdict} F 轮=${resumeFixRoundsRun}）`);
    } else {
      console.log(`   resume     = 无有效断点，从头开始`);
    }
  }
  console.log(`   V          = ${MODEL_CONFIGS.V.model} (${MODEL_CONFIGS.V.baseURL})`);
  console.log(`   F          = ${MODEL_CONFIGS.F?.model || 'N/A'} (${MODEL_CONFIGS.F?.baseURL || 'N/A'}) [v1.2.8]`);

  if (args.dryRun) {
    console.log(`\n  [dry-run] 将执行以下步骤：`);
    console.log(`  ── V 阶段（验证）──`);
    console.log(args.skipAcceptance
      ? `    ① acceptance × ${ACCEPTANCE_SHARD_COUNT} 维度分片 (--skip-acceptance)  → acceptance-s1~12.md → acceptance.md`
      : `    ① acceptance × ${ACCEPTANCE_SHARD_COUNT} 维度分片 (跑 acceptance-test.sh)  → acceptance-s1~12.md → acceptance.md`);
    console.log(`       分片 worker 并行（MAX_CONCURRENCY=6），各分析场景范围`);
    console.log('    ② regression  (跑 regression-checklist)   → regression.md');
    console.log('    ③ coverage    (覆盖率交叉检查)             → coverage.md');
    console.log('    ④ consolidate (合并三份结果)               → stage6-report.md');
    console.log('    ⑤ verdict     (PASS/FAIL 裁决)             → verdict.md');
    console.log(`  ── F 阶段（修复，仅 verdict=FAIL 时触发，最多 3 轮）── [v1.2.8]`);
    console.log('    f-diagnose  (F 诊断)                        → fix-plan.md');
    console.log('    f-fix       (F 修复)                        → fix-summary.md');
    console.log('    f-audit     (driver: runAuditGate)          → audit-result.md');
    console.log('\n  ✅ dry-run 完成（未实际执行）\n');

    visibility.emit(EVENTS.LOOP_END, {
      verdict: 'DRY-RUN',
      stopReason: 'dry-run',
    });
    return;
  }

  // ─── V 阶段：5 步串行执行（acceptance → regression → coverage → consolidate → verdict）───
  // v1.2.8 功能⑦：resume 断点已过 verdict 时跳过整个 V 阶段（产物复用，不重跑不覆盖）
  let completedSteps = resumeCompletedSteps;
  let stopReason = 'completed';
  const stepErrors = [];

  if (skipVPhase) {
    console.log(`\n  🔄 resume：跳过 V 阶段 5 步（断点已完成），从 F 修复链继续`);
  }

  // v1.2.9 功能①：acceptance shard 步骤并行执行——在循环外先处理。
  // 预跑 acceptance-test.sh（所有 shard 共享同一份日志）
  if (!skipVPhase) {
    await ensureAcceptancePreRun(args, runDir);

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  V 步骤 — acceptance × ${ACCEPTANCE_SHARD_COUNT} 维度分片（并行）`);
    console.log(`${'═'.repeat(60)}`);

    // 并行执行所有 acceptance shard worker
    const shardWorkers = ACCEPTANCE_SHARDS.map(s => [`acceptance-s${s.id}`, runDir, args.target]);
    const MAX_ACC_CONCURRENCY = parseInt(process.env.FORGE_ACCEPTANCE_CONCURRENCY || '6', 10);
    const { results: shardResults, failures: shardFailures } = await spawnAcceptanceShards(shardWorkers, args.target, MAX_ACC_CONCURRENCY);

    for (const f of shardFailures) {
      console.warn(`\n  ⚠️  ${f.step} 失败: ${f.reason?.message || f.reason}`);
      // 降级：写最小占位文件
      const outFile = `${f.step}.md`;
      const outPath = join(runDir, outFile);
      if (!existsSync(outPath)) {
        writeFileSync(outPath,
          `# ${outFile} · ${f.step} 崩溃（降级占位）\n\n` +
          `> ⚠️ worker 异常终止: ${f.reason?.message || f.reason}\n` +
          `> 其他分片的结果仍可用。\n`,
          'utf-8');
      }
      stepErrors.push({ step: f.step, error: f.reason?.message || String(f.reason) });
    }

    for (const r of shardResults) {
      if (r.value !== null) completedSteps++;
    }

    console.log(`  ✅ acceptance 分片完成（${shardResults.filter(r => r.value !== null).length}/${ACCEPTANCE_SHARDS.length} 成功）`);

    // acceptance-consolidate：合并分片报告（串行执行，用标准 spawnWorker）
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  V 步骤 — acceptance-consolidate（合并 ${ACCEPTANCE_SHARDS.length} 份分片报告）`);
    console.log(`${'═'.repeat(60)}`);
    try {
      await spawnWorker('acceptance-consolidate', runDir, args.target);
      completedSteps++;
      console.log(`  ✅ acceptance-consolidate 完成`);
    } catch (consErr) {
      console.warn(`\n  ⚠️  acceptance-consolidate 失败: ${consErr.message}`);
      console.warn(`     降级：直接拼接分片报告作为 acceptance.md`);
      // 降级：直接拼接所有分片
      const parts = ['# Acceptance Test 结果（降级——分片拼接）', ''];
      for (const s of ACCEPTANCE_SHARDS) {
        const sPath = join(runDir, `acceptance-s${s.id}.md`);
        if (existsSync(sPath)) {
          parts.push(readFileSync(sPath, 'utf-8'), '');
        }
      }
      writeFileSync(join(runDir, 'acceptance.md'), parts.join('\n'), 'utf-8');
      stepErrors.push({ step: 'acceptance-consolidate', error: consErr.message });
    }
  }

  // 非 acceptance shard 步骤串行执行（跳过已处理的 acceptance shard 步骤）
  const nonShardSteps = (skipVPhase ? [] : STEP_ORDER).filter(
    step => !ACCEPTANCE_SHARD_STEPS.includes(step) && step !== 'acceptance-consolidate'
  );

  for (const step of nonShardSteps) {
    const stepIndex = STEP_ORDER.indexOf(step) + 1;
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  V 步骤 ${stepIndex}/${STEP_ORDER.length} — ${step}`);
    console.log(`${'═'.repeat(60)}`);

    // regression 特殊处理（v1.2.5+）：driver 预执行 checklist，worker 只读结果判定
    if (step === 'regression' && STEPS.regression.precheck) {
      try {
        await runRegressionPrecheck(runDir);
      } catch (preErr) {
        console.warn(`[driver] regression 预执行失败（worker 将回退到自行执行）: ${preErr.message}`);
      }
    }

    // coverage 特殊处理（v1.2.5+）：driver 预解析场景索引 + changelog 模块，worker 只读判定
    if (step === 'coverage' && STEPS.coverage.precheck) {
      try {
        await runCoveragePrecheck(runDir, args.target);
      } catch (preErr) {
        console.warn(`[driver] coverage 预执行失败（worker 将回退到自行执行）: ${preErr.message}`);
      }
    }

    try {
      await spawnWorker(step, runDir, args.target);
      completedSteps++;

      visibility.emit(EVENTS.STEP_DONE, {
        step,
        stepIndex,
        totalSteps: STEP_ORDER.length,
      });

      console.log(`  ✅ ${step} 完成`);

      // 步骤④完成后复制报告到桌面
      if (step === 'consolidate') {
        copyToDesktop(runDir, args.target);
      }
    } catch (stepErr) {
      console.warn(`\n  ⚠️  ${step} 失败: ${stepErr.message}`);
      console.warn(`     继续执行后续步骤（步骤崩溃不中断）`);
      stepErrors.push({ step, error: stepErr.message });

      visibility.emit(EVENTS.STEP_DONE, {
        step,
        stepIndex,
        totalSteps: STEP_ORDER.length,
        error: stepErr.message,
      });

      stopReason = 'step-error';
    }
  }

  // ─── 解析 V 阶段裁决 ───
  const results = parseStepResults(runDir);
  let verdict, reason;
  if (skipVPhase) {
    // v1.2.8 功能⑦：resume 模式下 verdict 取自断点（V 阶段未重跑，
    // 断点是唯一权威——不重新 parseVerdict，避免读旧 verdict.md 产生歧义）
    verdict = resumeVerdict;
    reason = resumeReason;
    console.log(`\n  🔄 resume：verdict=${verdict}（来自断点）`);
  } else {
    ({ verdict, reason } = parseVerdict(runDir));
    // v1.2.8 功能⑦：V 阶段完成后（verdict 解析后）写断点
    // fixRoundsRun=0 表示 F 轮尚未开始；V 阶段内不写步骤级断点（幂等可重跑）
    saveGateCheckpoint('verdict-done', verdict, 0);
  }

  // ═══════════════════════════════════════════════════════════
  //  v1.2.8 功能⑤：F 修复链——verdict FAIL 时触发
  //  流程：verdict FAIL → f-diagnose → f-fix → f-audit → 回到 verdict 判定
  //  最多 MAX_FIX_ROUNDS 轮，每轮独立诊断+修复+审计
  // ═══════════════════════════════════════════════════════════
  const MAX_FIX_ROUNDS = 3;
  const F_STEPS = ['f-diagnose', 'f-fix', 'f-audit'];
  // v1.2.8 功能⑦：resume 模式从断点恢复已完成 F 轮数，从 fixRoundsRun+1 继续
  let fixRoundsRun = resumeFixRoundsRun;

  while (verdict === 'FAIL' && fixRoundsRun < MAX_FIX_ROUNDS) {
    fixRoundsRun++;
    const round = fixRoundsRun;
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  🚪 F 修复链 — Round ${round}/${MAX_FIX_ROUNDS}`);
    console.log(`     verdict=${verdict} reason=${reason}`);
    console.log(`${'═'.repeat(60)}`);

    for (const fStep of F_STEPS) {
      const stepDef = STEPS[fStep];
      console.log(`\n  [F/${round}] ${fStep} ...`);

      try {
        if (stepDef.role === null) {
          // driver 步骤：直接执行 runAuditGate（不 spawn worker）
          console.log(`     → driver 步骤（role:null），执行 ${stepDef.driverFn}`);
          const auditResult = await base.runAuditGate(runDir, fStep, round);
          console.log(`     audit gate: passed=${auditResult.passed} exitCode=${auditResult.exitCode}`);
          completedSteps++;
        } else {
          // LLM 步骤：spawn worker
          await spawnWorker(fStep, runDir, args.target);
          completedSteps++;
          console.log(`  ✅ ${fStep} 完成`);
        }
      } catch (fErr) {
        console.warn(`\n  ⚠️  ${fStep} 失败: ${fErr.message}`);
        stepErrors.push({ step: `${fStep}/${round}`, error: fErr.message });
        // F 步骤失败不中断循环，继续下一步（降级处理）
      }
    }

    // 重新解析裁决（F 修复后可能变 PASS）
    // 注意：f-fix 改了代码，需要重跑 verdict 才能拿到新裁决。
    // 但重跑 verdict 意味着再 spawn 一个 V worker——这里走轻量路径：
    // 如果 f-audit passed=true，认为本轮修复有效，跳出 F 链。
    // 如果 f-audit passed=false（有违规），继续下一轮 F 链。
    const auditResultPath = join(runDir, 'audit-result.md');
    let auditPassed = true; // 默认乐观
    if (existsSync(auditResultPath)) {
      const auditText = readFileSync(auditResultPath, 'utf-8');
      if (auditText.includes('VIOLATIONS')) {
        auditPassed = false;
      }
    }

    if (auditPassed) {
      console.log(`\n  [F/${round}] audit gate 通过（无违规），F 修复链收敛`);
      verdict = 'PASS';
      reason = `F 修复链 Round ${round} 后 audit 通过`;
      // v1.3.0 run-21 修复：F 收敛后同步 verdict.md——否则文件仍是 V 阶段 FAIL 文本，
      // 监控端读 verdict.md(FAIL) 与 status.json(PASS) 矛盾（run-21 实测）。
      // 追加收敛记录而非覆盖（保留 V 阶段 FAIL 依据可追溯）。
      try {
        const verdictPath = join(runDir, 'verdict.md');
        if (existsSync(verdictPath)) {
          appendFileSync(verdictPath,
            `\n---\n\n## F 修复链收敛（Round ${round}）\n\n判定更新：FAIL → **PASS**\n依据：f-audit 通过（无 VIOLATIONS），F 修复链收敛\n`,
            'utf-8');
        }
      } catch (vErr) {
        console.warn(`  ⚠️  verdict.md 同步失败（不影响主流程）: ${vErr.message}`);
      }
      // Bug-F2 修复：F 修复链收敛为 PASS 后，重新解析 results 确保状态一致。
      // 原 bug：results 只在 V 阶段结束后解析一次（L1980），F 修复后 verdict 改为 PASS
      // 但 results.acceptance/regression 仍为初始 FAIL 值——状态不一致。
      const updatedResults = parseStepResults(runDir);
      results.acceptance = updatedResults.acceptance;
      results.regression = updatedResults.regression;
      results.coverage = updatedResults.coverage;
      console.log(`     更新后 results: acceptance=${results.acceptance} regression=${results.regression} coverage=${results.coverage}`);
      // v1.2.8 功能⑦：本轮 F 完成且收敛为 PASS → 写断点（resume 时识别为已完成）
      saveGateCheckpoint('f-round-done', verdict, round);
      break;
    } else {
      console.log(`\n  [F/${round}] audit gate 发现违规，${round < MAX_FIX_ROUNDS ? '进入下一轮修复' : '已达最大轮次上限'}`);
      // v1.2.8 功能⑦：本轮 F 完成（仍有违规）→ 写断点，resume 从 round+1 继续
      saveGateCheckpoint('f-round-done', 'FAIL', round);
    }
  }

  if (verdict === 'FAIL' && fixRoundsRun >= MAX_FIX_ROUNDS) {
    stopReason = 'fix-rounds-exhausted';
    console.log(`\n  ⚠️  F 修复链已达 ${MAX_FIX_ROUNDS} 轮上限，仍有违规——标记为 FAIL 交付`);
  }

  // v1.2.8 功能⑦：循环正常走完（含 fix-rounds-exhausted）写最终断点——
  // 记录终态 verdict，resume 时直接识别为已完成（PASS）或轮次耗尽（FAIL），
  // 不会无意义地重新续跑。
  saveGateCheckpoint('f-round-done', verdict, fixRoundsRun);

  // usage.jsonl 全量摘要
  const usageSummary = appendUsageSummary(runDir, completedSteps);
  console.log(
    `\n  [总用量] tokens: ${usageSummary.total_tokens.toLocaleString()}  ` +
    `(V+F 订阅制)`
  );

  // 写 LEDGER
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  循环结束 — 停止原因: ${stopReason}`);
  console.log(`  完成步数: ${completedSteps}（V: 5 + F 链: ${fixRoundsRun * 3}）`);
  console.log(`  验证结果: acceptance=${results.acceptance} regression=${results.regression} coverage=${results.coverage}`);
  console.log(`  最终裁决: ${verdict} (${reason})`);
  if (fixRoundsRun > 0) {
    console.log(`  F 修复链: ${fixRoundsRun}/${MAX_FIX_ROUNDS} 轮`);
  }
  if (stepErrors.length > 0) {
    console.log(`  步骤错误: ${stepErrors.map(e => e.step).join(', ')}`);
  }
  console.log(`${'═'.repeat(60)}`);

  appendLedger(dateStr, runId, completedSteps, results, verdict, runDir);

  // 可见性：循环结束
  visibility.emit(EVENTS.LOOP_END, {
    verdict,
    stopReason,
    completedSteps,
    results,
    stepErrors: stepErrors.map(e => e.step),
  });

  console.log(`\n${verdict === 'PASS' ? '✅' : '❌'} release-gate-loop 完成 — 裁决: ${verdict}\n`);
}

main().catch(err => {
  console.error(`\n💥 致命错误: ${err.message}`);
  console.error(err.stack);
  if (globalVisibility) {
    globalVisibility.emit(EVENTS.ERROR, {
      message: err.message,
      stack: err.stack?.split('\n').slice(0, 3).join(' | '),
    });
    globalVisibility.emit(EVENTS.LOOP_END, {
      verdict: 'ERROR',
      stopReason: 'fatal-error',
    });
  }
  process.exit(1);
});
