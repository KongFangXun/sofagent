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
// 模型（2026-08-06 切换，孔老师定稿）：
//   A（审查者）= Qwen3.8-max-preview  阿里百炼 Token Plan 订阅制
//   B（工程师）= Qwen3.8-max-preview  阿里百炼 Token Plan 订阅制
//   baseURL = https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1（OpenAI 兼容）
//   Qwen3.8-max-preview 是 thinking-only 模型——始终思考、无法关闭，
//   不需要（也不应传）enable_thinking/thinking 参数，也没有 reasoningEffort（DeepSeek 专属）。
// ============================================================

import { spawn } from 'child_process';
import { createRequire } from 'module';
import {
  readFileSync, writeFileSync, mkdirSync, existsSync,
  appendFileSync, readdirSync, renameSync,
} from 'fs';
import { join, resolve, dirname, relative, sep } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

// 可见性：核心层 + 适配器（agent 无关 + 渐进适配）
import { createVisibility, EVENTS } from './visibility.mjs';

// v1.2.1 L2：SubAgent 内部可观测（工具调用序列 + 模型推理心跳）
// v1.2.4 新增 StallError 导出（watchdog 停顿检测错误类）
import { createProgressMiddleware, StallError } from './progress-middleware.mjs';

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

// Qwen Token Plan 单 key，A/B 共用。
// 若设置了 SOFAGENT_LLM_B_API_KEY，强制 A 的 key 与 B 一致，确保双角色使用同一 Token Plan key。
if (process.env.SOFAGENT_LLM_B_API_KEY) {
  process.env.SOFAGENT_LLM_A_API_KEY = process.env.SOFAGENT_LLM_B_API_KEY;
}// ─── 模型配置（A/B 共用 Qwen3.8-max-preview） ────────────────────────────────────────────
const MODEL_CONFIGS = {
  A: {
    baseURL:         'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    model:           'qwen3.8-max-preview',
    maxTokens:       16000,  // 限制输出 token，防止 thinking 模式无限消耗
    apiKeyEnv:       'SOFAGENT_LLM_A_API_KEY',
    specEnv:         'SOFAGENT_LLM_A',
    agentSkillPath:  join(AGENTS_DIR, 'reviewer/SKILL.md'),
    toolsKey:        'REVIEWER_TOOLS',
    billing:         'subscription',  // Token Plan 订阅制
  },
  B: {
    baseURL:         'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    model:           'qwen3.8-max-preview',
    maxTokens:       16000,  // 限制输出 token，防止 thinking 模式无限消耗（与 A 对齐）
    apiKeyEnv:       'SOFAGENT_LLM_B_API_KEY',
    specEnv:         'SOFAGENT_LLM_B',
    agentSkillPath:  join(AGENTS_DIR, 'engineer/SKILL.md'),
    toolsKey:        'ENGINEER_TOOLS',
    billing:         'subscription',  // Token Plan 订阅制
  },
};

// ─── 三层熔断阈值（模块级常量，避免散落在不同函数作用域） ──────────
// 三层防线协同设计（run-01/run-02 事故修复）：
//   L1 软熔断(TOOL_SOFT_LIMIT=50)：stateModifier 注入 HumanMessage 强制收尾
//   L2 硬熔断(TOOL_HARD_LIMIT=60)：stream 循环物理 break，抢救部分产物
//   L3 框架兜底(STEP_RECURSION_LIMITS)：LangGraph recursionLimit 最终防线
// 数值关系：50(劝) → 60(拽) → 130(杀)，L2 和 L3 之间留 10 superstep 稳定窗口。
const TOOL_SOFT_LIMIT  = 50;  // stateModifier：超此值注入"立即写报告"HumanMessage
const TOOL_HARD_LIMIT  = 60;  // stream loop：超此值物理 break（L2 硬熔断）

// ─── 模型定价（usage.jsonl 成本估算基础）─────────────────────
// 单位：CNY per 1M tokens（百万 token 计价）
//
// ⚠️ 计费模式区分（2026-08-06 确认）：
//   A/B (qwen3.8-max-preview) = 阿里百炼 Token Plan 订阅制 → 不按 token 计价。
//   订阅制按周期固定付费，与 token 消耗无关，因此 MODEL_PRICING 的按 token
//   成本估算对订阅账号意义有限，仅供参考。
//   recordUsage 的 billing === 'subscription' 分支输出 cost_cny = null，不硬凑按量成本。
//
// ⚠️ 这是「估算」不是「账单」：
//   即便是按量计费模型，官方标价 ≠ 实际扣费。缓存命中率、账号促销、
//   套餐折扣都会影响最终费用。driver 算出的 cost_cny 仅供成本感知
//   （「这轮大概花了多少」），真实账单请到各厂商 API 后台查看。
//
// Qwen3.8-max-preview（A/B 当前实际使用，Token Plan 订阅制）：
//   https://help.aliyun.com/zh/model-studio/deep-thinking
//   订阅制无按量单价，input/output 置 0。
//
// DeepSeek 条目（deepseek-v4-pro / deepseek-v4-flash）保留做历史参考：
//   A/B 曾使用 DeepSeek V4 Flash 按量计费——input 0.5元（缓存未命中）/ output 8元 /
//   缓存命中 input 0.025元。https://api-docs.deepseek.com/quick_start/pricing
//   切换 Qwen 后 recordUsage 按 model 名查表自动命中 qwen 条目；DeepSeek 条目不删，供回溯。
const MODEL_PRICING = {
  'qwen3.8-max-preview': {
    input: 0,
    output: 0,
    currency: 'CNY',
    source: 'https://help.aliyun.com/zh/model-studio/deep-thinking',
    note: 'Token Plan 订阅制，不按量计价，此处置 0；成本估算对订阅账号不适用',
  },
  'deepseek-v4-pro': {
    input: 3,
    output: 6,
    currency: 'CNY',
    source: 'https://api-docs.deepseek.com/quick_start/pricing',
    note: '缓存命中 input 0.025元/M（120x 价差）。本表按未命中算（成本上界）',
  },
  'deepseek-v4-flash': {
    input: 0.5,
    output: 8,
    currency: 'CNY',
    source: 'https://api-docs.deepseek.com/quick_start/pricing',
    note: 'Flash 版定价（缓存未命中）。缓存命中 input 0.025元/M',
  },
};

// ─── 步骤定义（role / prompt / output / extraInputs / maxTokens）────────
// maxTokens：步骤级输出 token 上限覆盖。未定义时回退到 MODEL_CONFIGS[role].maxTokens。
// a-consolidate 需合并 A/B 两份完整 12 视角报告为单份 findings，输出超长，
// 单独调高到 32000，避免顶格 16000 被截断生成不了合法 result.md（整轮降级根因）。
const STEPS = {
  'a-check':       { role: 'A', prompt: 'a-check.md',       outputs: ['check-a.md'],             inputs: [] },
  'b-check':       { role: 'B', prompt: 'b-check.md',       outputs: ['check-b.md'],             inputs: [] },
  'a-consolidate': { role: 'A', prompt: 'a-consolidate.md', outputs: ['findings.md','result.md'],inputs: ['check-a.md','check-b.md'], maxTokens: 32000 },
  'b-fix':         { role: 'B', prompt: 'b-fix.md',         outputs: ['summary.md'],             inputs: ['result.md','findings.md'] },
  'a-verify':      { role: 'A', prompt: 'a-verify.md',      outputs: ['result.md'],              inputs: ['findings.md','result.md','summary.md'] },
};

// ═══════════════════════════════════════════════════════════
//  CLI 参数解析
// ═══════════════════════════════════════════════════════════
function parseArgs(argv) {
  const args = { target: null, maxRounds: 10, dryRun: false,
                 worker: false, step: null, roundDir: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target')           args.target    = argv[++i];
    else if (a === '--max-rounds')  args.maxRounds = parseInt(argv[++i], 10);
    else if (a === '--dry-run')     args.dryRun    = true;
    else if (a === '--worker')      args.worker    = true;
    else if (a === '--step')        args.step      = argv[++i];
    else if (a === '--round-dir')   args.roundDir  = argv[++i];
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
  // 最终撞上 LangGraph recursionLimit（200 supersteps）导致零产出崩溃。
  // run-01 教训：A worker 调了 1119 次工具仍未收敛写报告，GraphRecursionError 终止整个循环。
  const toolBudget = [
    '',
    '## 🔴 铁律：工具调用预算（超限必崩）',
    '',
    '你有**最多 60 次工具调用**的硬预算。超过后进程会被强制终止，你写不出任何报告。',
    '',
    '**节奏要求**：',
    '- 第 1-40 次：自由探索（读文件、跑命令、搜索）',
    '- 第 40-50 次：停止探索新方向，整理已发现的问题，准备写报告',
    '- 第 50-60 次：写报告，把发现写入产物文件',
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
 * 两角色均使用 Qwen3.8-max-preview（阿里百炼 Token Plan，OpenAI 兼容接口）。
 * Qwen3.8-max-preview 是 thinking-only 模型——始终思考、无法关闭，
 * 不需要传 thinking/reasoningEffort 参数：MODEL_CONFIGS 未定义这两个字段，
 * 下方条件注入分支（cfg.thinking / cfg.reasoningEffort）天然不会触发。
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
  };

  // GLM 特殊参数
  if (cfg.temperature !== undefined) {
    ctorArgs.temperature = cfg.temperature;
  }

  // 限制输出 token（防止 thinking 模式无限消耗）
  // 步骤级覆盖优先（如 a-consolidate 合并双份完整报告需 32000），否则用角色默认值
  const effectiveMaxTokens = maxTokensOverride ?? cfg.maxTokens;
  if (effectiveMaxTokens) {
    ctorArgs.maxTokens = effectiveMaxTokens;
  }

  // DeepSeek 特殊参数
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
// ─── 工具输出截断（v1.2.5 性能优化）────────────────────────────
// Agent 跑一次 run_bash（如 npm test）输出可能 2000+ 行，完整输出被追加到
// messages 列表后每一次 LLM 调用都要重新处理它。截断到头尾各 100 行，
// 砍掉中间重复内容，可将单步 prompt_tokens 从 100k+ 降到 30-40k。
const TOOL_OUTPUT_MAX_LINES = 200;

function truncateToolOutput(text, maxLines = TOOL_OUTPUT_MAX_LINES) {
  const str = String(text);

  // No such file 检测——辅助手段，在工具输出末尾追加系统提示。
  // 本质是 prompt 层措施（模型可能无视），不构成死循环的核心修复——
  // 真正的防线是 stateModifier 软熔断(50) + stream 硬熔断(60)。
  // 价值在于减少模型对错误信息的误判，明确告诉它"文件不存在"。
  const hasNoSuchFile = /No such file or directory/i.test(str);

  const lines = str.split('\n');
  if (lines.length <= maxLines) {
    return hasNoSuchFile
      ? str + '\n\n[系统提示] 该文件不存在，请记录为缺失并继续下一步，禁止换路径重试。'
      : str;
  }
  const half = maxLines / 2;
  const head = lines.slice(0, half);
  const tail = lines.slice(-half);
  const truncated = [
    ...head,
    `\n... [${lines.length - maxLines} lines truncated by FORGE driver — head ${half} + tail ${half}] ...\n`,
    ...tail,
  ].join('\n');
  return hasNoSuchFile
    ? truncated + '\n\n[系统提示] 该文件不存在，请记录为缺失并继续下一步，禁止换路径重试。'
    : truncated;
}

function loadTools(role, progressMw = null) {
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
        // v1.2.1 L2：工具调用埋点（start → handler → end，含 duration）
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

  const userMessage = [
    promptTemplate.trim(),
    '',
    '--- driver 注入 ---',
    `本次审查对象 = sofagent ${target} 完整交付物`,
    `项目根目录 = ${REPO_ROOT}`,
    inputPaths ? `输入文件（已由 driver 中转）：\n${inputPaths}` : '',
    multiOutputHint
      ? `产物输出（本步骤产出多个文件，必须用 ===FILE: <文件名>=== 分隔各产物，driver 会按此切片写入）：\n${outputPaths}\n\n格式约定：\n${multiOutputHint}`
      : `产物输出路径（把你的输出写到这个文件）：\n${outputPaths}`,
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
  const tools = loadTools(role, progressMw);

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
  // prompt 层纪律（铁律文本）对 qwen3.8-max-preview 无效，必须在代码层做硬熔断。
  // run-01 教训：A worker 调了 1119 次工具仍未收敛，撞 GraphRecursionError 零产出。
  const { SystemMessage, HumanMessage } = await import('@langchain/core/messages');
  const MAX_CONTEXT_MESSAGES = 16; // 最后 8 轮工具交互（调用+结果各 1 条）
  const STATE_MESSAGES_HARD_LIMIT = 20;

  const { createReactAgent } = await import('@langchain/langgraph/prebuilt');
  const systemMsg = new SystemMessage(systemPrompt);
  const agent = createReactAgent({
    llm: model,
    tools,
    // v1.2.5：stateModifier = system prompt + 上下文窗口裁剪（替代 prompt 参数）
    // v1.2.6：preModelHook 物理裁剪 state.messages，防止内存累积 OOM
    // v1.2.6：stateModifier 加工具调用计数 + 软熔断注入。
    // run-01/run-02 教训：qwen3.8-max-preview 无视 prompt 铁律，
    // 陷入"找不到文件→换路径重试"死循环（1119 次工具调用）。
    // 这里在代码层做硬兜底：累计 tool_calls 超过 TOOL_SOFT_LIMIT(50)
    // 时注入 HumanMessage 强制要求写报告——HumanMessage 比 SystemMessage
    // 优先级更高，模型更容易遵从。
    // 50 = 12 视角 × 4 次调用 = 48，给充分探索空间后强制收敛。
    stateModifier: (state) => {
      const messages = state.messages ?? [];

      // 统计历史消息中所有 AI tool_calls 总数
      let toolCallCount = 0;
      for (const msg of messages) {
        if (msg?._getType?.() === 'ai' && msg.tool_calls?.length > 0) {
          toolCallCount += msg.tool_calls.length;
        }
      }
      if (toolCallCount >= TOOL_SOFT_LIMIT) {
        const forceReport = new HumanMessage({
          content: '【系统强制指令】你已经调用了 ' + toolCallCount + ' 次工具，超过软上限。' +
            '立即停止所有探索，用已掌握的信息写报告并写入产物文件。不要再调任何工具。'
        });
        console.warn(`  ⚡ [${step}#${role}] 工具调用 ${toolCallCount} 次超软上限，注入强制收尾指令`);
        if (messages.length <= MAX_CONTEXT_MESSAGES + 1) {
          return [systemMsg, forceReport, ...messages];
        }
        // 保留第一条 + 最后 N 条，同时插入强制指令
        const first = messages[0];
        const recent = messages.slice(-MAX_CONTEXT_MESSAGES);
        return [systemMsg, forceReport, first, ...recent];
      }

      if (messages.length <= MAX_CONTEXT_MESSAGES + 1) {
        return [systemMsg, ...messages];
      }
      // 保留第一条（原始任务 prompt）+ 最后 N 条（近期工具交互）
      const first = messages[0];
      const recent = messages.slice(-MAX_CONTEXT_MESSAGES);
      return [systemMsg, first, ...recent];
    },
    preModelHook: (state) => {
      const messages = state.messages ?? [];
      if (messages.length <= STATE_MESSAGES_HARD_LIMIT) {
        return state;
      }
      const first = messages[0];
      const recent = messages.slice(-STATE_MESSAGES_HARD_LIMIT);
      return { ...state, messages: [first, ...recent] };
    },
  });

  // 5. stream（计时）—— v1.2.5 改为流式输出，实时打印工具调用进度
  console.log(`[worker:${step}] 开始执行（role=${role}, model=${cfg.model}）`);
  const t0 = Date.now();

  // recursionLimit 按步骤类型区分：
  // - 审查类（a-check/b-check）：需要读文件+搜索，给 130（=65 轮工具调用）
  //   v1.2.5 run-01 教训：200 让 worker 有空间调 1119 次工具陷入死循环。
  //   配合 systemPrompt 里的「60 次工具预算」铁律，130 步够用且能更早熔断。
  //   审查 P1 修复：原 120 与 L2 硬熔断的 superstep 119 仅差 1 步，
  //   LangGraph 隐含 superstep（路由/条件边）可能导致 L3 先触发，
  //   使 L2 的产物抢救功能失效。+10 步给 L2 稳定的优先窗口。
  // - 文本处理类（a-consolidate/a-verify）：主要做合并/格式化，给 100 够了
  // - b-fix：分片后每批 5 条 finding × 5 工具调用 = 25 步，给 150 是 6 倍余量
  //   太高会导致消息累积 OOM（exit 137）
  // - a-verify：分片后每批 5 条 × 2 操作 = 10 步，给 150 是 15 倍余量
  const STEP_RECURSION_LIMITS = {
    // a-check/b-check: 130 = L2 硬熔断(60次×2superstep=120) + 10步缓冲。
    // 审查 P1 修复：原 120 与 L2 硬熔断的 superstep 119 仅差 1 步，
    // LangGraph 隐含 superstep（路由/条件边）可能导致 L3 先触发，
    // 使 L2 的产物抢救功能失效。+10 步给 L2 稳定的优先窗口。
    'a-check': 130,
    'b-check': 130,
    'a-consolidate': 100,
    'b-fix': 150,
    'a-verify': 150,
  };
  const recursionLimit = STEP_RECURSION_LIMITS[step] ?? 50;

  // v1.2.5：流式执行——实时打印工具调用，用户不再盯着空白等 5 分钟
  //
  // 🔴 stream 数据结构适配（P0 bugfix da1039a → 本 commit）：
  //   agent.stream(streamMode:'updates') 的 chunk 格式是 { [nodeName]: stateDelta }，
  //   不是 invoke() 的扁平 { messages: [...] }。直接赋 finalState = chunk 会导致
  //   下游 extractAgentText / extractUsage 找 result.messages 拿到 undefined。
  //
  //   正确做法：累积所有 chunk 的 delta.messages 到一个扁平数组，模拟 invoke 返回格式。
  const invokeAgent = async () => {
    const stream = await agent.stream(
      { messages: [{ role: 'user', content: userMessage }] },
      { recursionLimit, streamMode: 'updates' }
    );

    const allMessages = [];  // 累积所有 delta.messages，模拟 invoke 返回的扁平结构
    let toolCallCount = 0;
    // v1.2.6：stream 层硬熔断——stateModifier 软熔断(50)兜底。
    // run-01/run-02 教训：即使注入了强制收尾指令，qwen3.8-max-preview 仍可能
    // 无视 HumanMessage 继续调工具。这里是最后防线：到 TOOL_HARD_LIMIT(60)
    // 直接 break stream 循环，用已累积的 messages 抢救部分产物。
    let hardBreak = false;
    for await (const chunk of stream) {
      // chunk 是 { nodeName: stateDelta }——解包每个节点的 delta
      for (const [, delta] of Object.entries(chunk)) {
        const msgs = delta?.messages;
        if (!Array.isArray(msgs)) continue;
        for (const msg of msgs) {
          allMessages.push(msg);
          // 工具调用消息（AI 发起 tool_call）
          if (msg?._getType?.() === 'ai' && msg.tool_calls?.length > 0) {
            for (const tc of msg.tool_calls) {
              toolCallCount++;
              console.log(`  → [${step}#${role}] tool #${toolCallCount}: ${tc.name}`);
              if (toolCallCount >= TOOL_HARD_LIMIT && !hardBreak) {
                hardBreak = true;
                console.warn(`  🛑 [${step}#${role}] 工具调用 ${toolCallCount} 次撞硬上限，强制中断 stream`);
                break;
              }
            }
          }
          if (hardBreak) break;
        }
        if (hardBreak) break;
      }
      if (hardBreak) break;
    }
    if (hardBreak) {
      console.warn(`  🛑 [${step}#${role}] stream 已中断，从 ${allMessages.length} 条消息抢救产物`);
      // 显式通知 generator 终止——break 会触发 return()，但某些实现可能
      // 不在 return() 时取消底层 HTTP 请求。显式调用确保资源清理。
      // 审查 P2 修复：避免 break 后的"幽灵"API 请求继续消耗 Token Plan 额度。
      try {
        await stream.return(undefined);
      } catch {
        // generator 已关闭或不可返回——忽略
      }
    }
    // 返回扁平结构——与 invoke() 返回格式兼容，下游 extractAgentText / extractUsage 正常工作
    // _hardBreak flag 让写产物逻辑能给报告加标记头
    return { messages: allMessages, _hardBreak: hardBreak };
  };

  // v1.2.1 L2：模型推理心跳。LangGraph 1.4.7 的 createReactAgent 无
  // middleware 参数（deepagents 的 middleware 链又硬编码 FilesystemMiddleware
  // 不可用——见上方注释），模型调用的可达接缝是 agent 运行期整体包裹：
  // 多轮 superstep（LLM 推理 + 工具执行交替）期间持续发 llm-chunk 心跳，
  // Dashboard 据最后一条事件时间戳判活；工具阶段另有 start/end 事件可区分。
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
    throw new Error(`[worker:${step}] DeepAgent 未返回内容`);
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
  }
}

/**
 * 按 `===FILE: <filename>===` 分隔符切片多产物输出。
 *
 * 约定 agent 返回格式：
 *   ===FILE: findings.md===
 *   <findings 正文>
 *   ===FILE: result.md===
 *   <result 正文>
 *
 * 每个 slice 取分隔符行到下一个分隔符行（或文本末尾）之间的内容，
 * trim 前后空白后返回。找不到某文件名对应的 slice 时，该文件写空占位提示。
 *
 * @param {string} text  agent 返回的完整文本
 * @param {string[]} outputs  期望的产物文件名列表
 * @returns {Record<string, string>}  filename → content
 */
function sliceMultiOutput(text, outputs) {
  const SEPARATOR_RE = /^===FILE:\s*(.+?)\s*===\s*$/gm;
  const slices = {};

  // 收集所有分隔符位置
  const marks = [];
  let m;
  while ((m = SEPARATOR_RE.exec(text)) !== null) {
    const filename = m[1].trim();
    const contentStart = SEPARATOR_RE.lastIndex;
    marks.push({ filename, contentStart });
  }

  if (marks.length === 0) {
    // 无分隔符：fallback 全写第一个产物，其余空占位
    slices[outputs[0]] = text;
    for (let i = 1; i < outputs.length; i++) {
      slices[outputs[i]] = `<!-- 未检测到 ===FILE: 分隔符，此产物为空。请检查 agent 输出。 -->\n`;
    }
    return slices;
  }

  // 计算每个 slice 的文本范围
  for (let i = 0; i < marks.length; i++) {
    const contentEnd = (i + 1 < marks.length)
      ? text.lastIndexOf('===FILE:', marks[i + 1].contentStart)
      : text.length;
    const raw = text.slice(marks[i].contentStart, contentEnd).trim();
    slices[marks[i].filename] = raw;
  }

  // 补齐期望产物中未被 agent 显式产出的（空占位）
  for (const filename of outputs) {
    if (!(filename in slices)) {
      slices[filename] = `<!-- agent 未产出此文件，检查 prompt 指令。 -->\n`;
    }
  }

  return slices;
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
    // 从后往前找最后一条「有非空 content 的」AI 消息。
    // 审查 P1 修复：硬熔断(_hardBreak)时最后一条 AI message 可能只有 tool_calls
    // 没有 content（qwen3.8 纯函数调用模式），直接 return 空字符串会导致
    // throw → allSettled rejected → 走降级占位，抢救的部分报告白丢。
    // 改为：跳过空 content 的 AI 消息，继续往前找有内容的。
    for (let i = result.messages.length - 1; i >= 0; i--) {
      const msg = result.messages[i];
      const isAI = msg?._getType?.() === 'ai' || (msg?.tool_calls !== undefined && msg?.content !== undefined);
      if (!isAI) continue;

      const content = msg?.content;
      // 提取文本——如果为空字符串则跳过继续往前找（硬熔断抢救场景）
      let text = '';
      if (typeof content === 'string') text = content;
      else if (Array.isArray(content)) text = content.map(c => typeof c === 'string' ? c : c?.text ?? '').join('');
      else if (content && typeof content === 'object') {
        if (typeof content.text === 'string') text = content.text;
        else if (typeof content.content === 'string') text = content.content;
        else text = JSON.stringify(content);
      }
      if (text.trim()) return text;  // 非空才返回，空则继续往前找
    }
    // 所有消息都不是 AI 类型——尝试最后一条的 content
    const last = result.messages[result.messages.length - 1];
    const content = last?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map(c => typeof c === 'string' ? c : c?.text ?? '').join('');
    }
    if (content && typeof content === 'object') {
      if (typeof content.text === 'string') return content.text;
      return JSON.stringify(content);
    }
  }
  // 最终 fallback——避免 String(object) 产出 "[object Object]"
  if (result && typeof result === 'object') {
    return JSON.stringify(result);
  }
  return String(result ?? '');
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
  // 匹配 ### finding-01 / ### finding-P0-01 / ### finding-P1-02 等格式
  // Accept: pure digits (01) or level-prefixed (P0-01, P1-02)
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

function spawnWorker(step, roundDir, target, round, options = {}) {
  /** 单次执行 worker 子进程 */
  function runOnce() {
    return new Promise((resolveP, rejectP) => {
      const env = { ...process.env, FORGE_ROUND: String(round) };
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

      child.on('close', (code) => {
        if (code === 0) {
          resolveP();
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
 * 并行起两个 worker（用于步骤 ①② 双盲独立审查）。
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
    const settled = await Promise.allSettled(
      workers.map(([step, roundDir, target]) => spawnWorker(step, roundDir, target, round))
    );
    const results = [];
    const failures = [];
    settled.forEach((s, i) => {
      const [step] = workers[i];
      if (s.status === 'fulfilled') {
        results.push({ step, value: s.value });
      } else {
        results.push({ step, value: null });
        failures.push({ step, reason: s.reason });
      }
    });
    return { results, failures };
  })();
}

/**
 * 降级兜底：a-consolidate 失败时，直接拼接 check-a + check-b 作为 findings.md。
 *
 * 不做去重/合并/优先级排序——只是让循环能继续走到 b-fix。
 * findings.md 里保留两份报告的**摘要**（P0/P1 条目 + 总评），不传完整正文——
 * 避免 b-fix 收到完整报告后上下文溢出（run-06 教训：119 万 tokens > 104 万上限）。
 * result.md 写一个最小结构让 parseStopCondition 能数 P0/P1。
 */
function writeFallbackFindings(roundDir) {
  const checkA = join(roundDir, 'check-a.md');
  const checkB = join(roundDir, 'check-b.md');

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
    '> ⚠️ a-consolidate 失败，以下为 check-a/check-b 的 P0/P1 摘要（非完整报告）。', ''];
  if (existsSync(checkA)) {
    parts.push('## A 审查摘要', '', summarize(checkA, 'A'), '');
  }
  if (existsSync(checkB)) {
    parts.push('## B 审查摘要', '', summarize(checkB, 'B'), '');
  }
  const findingsText = parts.join('\n');
  writeFileSync(join(roundDir, 'findings.md'), findingsText, 'utf-8');

  // result.md 写最小结构——parseStopCondition 靠数 P0/P1/P2 标记判定
  const p0 = (findingsText.match(/\bP0\b/g) || []).length;
  const p1 = (findingsText.match(/\bP1\b/g) || []).length;
  const resultContent = [
    '# 修复结果（降级生成——a-consolidate 失败）',
    '',
    `| # | 发现 | 优先级 | 状态 |`,
    `|---|------|--------|------|`,
    `| fallback | a-consolidate 失败，findings 由 check-a + check-b 摘要拼接 | P0×${p0} P1×${p1} | SKIP |`,
    '',
  ].join('\n');
  writeFileSync(join(roundDir, 'result.md'), resultContent, 'utf-8');

  console.log(`     降级 findings.md 已写入（P0×${p0} P1×${p1}，摘要模式）`);
}

/**
 * 解析停止条件——driver 唯一做判断的地方。
 *
 * 读 findings.md 数 P0/P1/P2 标记；读 result.md verify 列数 FAIL。
 * 只解析机器可读信号，不读审查内容做语义判断。
 *
 * @returns {{ p0:number, p1:number, p2:number, hasFail:boolean, isClean:boolean }}
 */
function parseStopCondition(roundDir) {
  const findingsPath = join(roundDir, 'findings.md');
  const resultPath   = join(roundDir, 'result.md');

  let p0 = 0, p1 = 0, p2 = 0;

  // 数 findings.md 里的 P0/P1/P2 标记
  if (existsSync(findingsPath)) {
    const text = readFileSync(findingsPath, 'utf-8');
    // 匹配 "优先级(P0)" / "P0" / "优先级：P0" 等格式
    const p0Matches = text.match(/\bP0\b/g);
    const p1Matches = text.match(/\bP1\b/g);
    const p2Matches = text.match(/\bP2\b/g);
    p0 = p0Matches ? p0Matches.length : 0;
    p1 = p1Matches ? p1Matches.length : 0;
    p2 = p2Matches ? p2Matches.length : 0;
  }

  // 读 result.md verify 列，数 FAIL
  let hasFail = false;
  if (existsSync(resultPath)) {
    const text = readFileSync(resultPath, 'utf-8');
    // verify 列出现 FAIL → 未闭环
    hasFail = /\bFAIL\b/i.test(text);
  }

  // 干净轮 = 无 P0 无 P1 无 P2 闭环失败（P2 全量修，未闭环也计入不干净）
  const isClean = (p0 === 0 && p1 === 0 && p2 === 0 && !hasFail);

  return { p0, p1, p2, hasFail, isClean };
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
 * 执行一轮（5 步）。
 * @returns {Promise<{roundDir:string, counts:object, isClean:boolean}>}
 */
async function runRound(roundNum, runDir, target, dryRun) {
  const roundDir = join(runDir, `round-${String(roundNum).padStart(2, '0')}`);
  mkdirSync(roundDir, { recursive: true });
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  Round ${roundNum} — ${roundDir}`);
  console.log(`${'═'.repeat(60)}`);

  if (dryRun) {
    console.log('  [dry-run] 将执行以下步骤：');
    console.log('    ① a-check   (A 独立审查)    → check-a.md');
    console.log('    ② b-check   (B 独立审查)    → check-b.md   [与①并行]');
    console.log('    ③ a-consolidate (A 合并)    → findings.md + result.md');
    console.log('    ④ b-fix     (B 修复)        → summary.md');
    console.log('    ⑤ a-verify  (A 验证·分片) → result.md 回填 verify');
    const counts = parseStopCondition(roundDir);
    return { roundDir, counts, isClean: true };
  }

  // 步骤 ①② 双盲独立审查——并行（allSettled：一方崩不拖累另一方）
  console.log('\n  [步骤 ①②] A/B 双盲独立审查（并行）...');
  const { failures: checkFailures } = await spawnParallel([
    ['a-check', roundDir, target],
    ['b-check', roundDir, target],
  ], roundNum);
  // 降级：a-check/b-check 崩溃时写部分报告占位，让后续步骤能继续。
  // run-01/run-02 教训：一方 worker 死循环崩溃后，另一方的审查报告也被丢弃，
  // 导致整轮零产出。占位文件让 a-consolidate 至少有输入可处理。
  for (const f of checkFailures) {
    console.warn(`\n  ⚠️  ${f.step} 失败: ${f.reason?.message || f.reason}`);
    const outFile = f.step === 'a-check' ? 'check-a.md' : 'check-b.md';
    const outPath = join(roundDir, outFile);
    if (!existsSync(outPath)) {
      writeFileSync(outPath,
        `# ${outFile} · ${f.step} 崩溃（降级占位）\n\n` +
        `> ⚠️ worker 异常终止: ${f.reason?.message || f.reason}\n` +
        `> 对方的审查报告仍可用。后续合并步骤会标注此部分缺失。\n`,
        'utf-8');
      console.warn(`     降级：写最小占位 ${outFile}，循环继续`);
    } else {
      console.warn(`     产物 ${outFile} 已存在（stream 抢救成功），保留不覆盖`);
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
  console.log(`\n  [停止判定] P0=${counts.p0} P1=${counts.p1} P2=${counts.p2} FAIL=${counts.hasFail} → ${counts.isClean ? 'CLEAN' : 'NOT-CLEAN'}`);

  // 打印本轮成本摘要
  const costSummary = summarizeRoundCost(runDir, roundNum);
  const aModel = costSummary.A.model || 'qwen3.8-max-preview';
  const bModel = costSummary.B.model || 'qwen3.8-max-preview';
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

  // ─── Worker 模式 ───
  if (args.worker) {
    if (!args.step || !args.roundDir || !args.target) {
      console.error('worker 模式需要 --step --round-dir --target');
      process.exit(1);
    }
    try {
      await runWorker(args.step, args.roundDir, args.target);
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
  if (!args.target) {
    console.error('用法: node FORGE/src/fresh-eyes-driver.mjs --target vX.Y.Z [--max-rounds N] [--dry-run]');
    process.exit(1);
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

  // 建 run 目录
  const { runDir, runId, dateStr } = resolveRunDir();

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

  console.log(`\n🔍 fresh-eyes-loop 启动`);
  console.log(`   target    = sofagent ${args.target}`);
  console.log(`   max-rounds = ${args.maxRounds}`);
  console.log(`   run-dir    = ${runDir}`);
  console.log(`   dry-run    = ${args.dryRun}`);
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

  let cleanStreak   = 0;
  let stopReason    = 'max-rounds';
  let actualRounds  = 0;
  let finalCounts   = { p0: 0, p1: 0, p2: 0 };
  let severityHistory = [];  // #13 每轮 (P0+P1) 趋势，用于加权收敛检测

  for (let round = 1; round <= args.maxRounds; round++) {
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
      runRoundResult = await runRound(round, runDir, args.target, args.dryRun);
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

    if (isClean) {
      cleanStreak++;
      console.log(`\n  ✅ 干净轮 (${cleanStreak}/2)`);
      if (cleanStreak >= 2) {
        stopReason = '2-rounds-clean';
        break;
      }
    } else {
      cleanStreak = 0;
      // #13 加权收敛：不干净但趋势已收敛到极低位时，提前停止
      if (detectWeightedConvergence(severityHistory)) {
        console.log(`\n  📉 加权收敛：近 3 轮 severity=${severityHistory.slice(-3).join('→')}，已收敛到极低位，提前停止`);
        stopReason = 'weighted-convergence';
        break;
      }
      console.log(`\n  ❌ 本轮有 P0/P1/FAIL，进入下一轮`);
    }
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
      `           A(${usageSummary.by_role.A.model || 'qwen3.8-max-preview'}):       ` +
      `${usageSummary.by_role.A.total_tokens.toLocaleString()} tokens  [Token Plan 订阅额度]`
    );
    console.log(
      `           B(${usageSummary.by_role.B.model || 'qwen3.8-max-preview'}):   ` +
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

  // latest.json 指针：driver 结束时更新（标记停止原因，Dashboard 不再显示"运行中"）
  updateLatestPointer(runDir, {
    round: actualRounds,
    totalRounds: args.maxRounds,
    stopReason,
    counts: finalCounts,
  });

  console.log('\n✅ fresh-eyes-loop 完成\n');
}

main().catch(err => {
  console.error(`\n💥 致命错误: ${err.message}`);
  console.error(err.stack);
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

  process.exit(1);
});
