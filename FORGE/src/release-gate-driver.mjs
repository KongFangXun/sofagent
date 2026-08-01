#!/usr/bin/env node
// ============================================================
// FORGE/src/release-gate-driver.mjs · FORGE release-gate-loop Driver
//
// 发版闸门循环编排层：5 步串行线性验证，跑完即出 PASS/FAIL。
// 单角色 V（验证者），纯只读，不修改任何代码或文档。
//
// 用法：
//   node FORGE/src/release-gate-driver.mjs --target v1.2.1 [--dry-run] [--skip-acceptance]
//   node FORGE/src/release-gate-driver.mjs --step acceptance --target v1.2.1 [--run-dir <dir>]
//   node FORGE/src/release-gate-driver.mjs --help
//
// 自 forks 为 worker：
//   node FORGE/src/release-gate-driver.mjs --worker --step <step> --run-dir <abs> --target <ver>
//
// 模型配置（单角色 V）：
//   V（验证者）= Qwen3.8-max-preview  阿里百炼 Token Plan 订阅制（OpenAI 兼容接口）
//   thinking-only 模型——始终思考、无需（也不应传）thinking/reasoningEffort 参数
//
// 与 fresh-eyes-driver 的差异：
//   - 单角色 V（无 A/B 双角色）
//   - 单轮线性（无 round 层级，无多轮收敛）
//   - 纯只读（REVIEWER_TOOLS，无写工具）
//   - 5 步：acceptance / regression / coverage / consolidate / verdict
// ============================================================

import { spawn } from 'child_process';
import { createRequire } from 'module';
import {
  readFileSync, writeFileSync, mkdirSync, existsSync,
  appendFileSync, readdirSync, copyFileSync, createWriteStream,
} from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

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

// ─── 单角色模型配置（V = 验证者）────────────────────────────
// V 用 Qwen3.8-max-preview：阿里百炼 Token Plan 订阅制，thinking-only 模型。
// 始终思考、无法关闭，不需要（也不应传）thinking/reasoningEffort 参数——
// Qwen 也没有 reasoningEffort（那是 DeepSeek 专属）。maxTokens 保留以限制输出。
// toolsKey 仍为 REVIEWER_TOOLS（纯只读）。
const MODEL_CONFIGS = {
  V: {
    baseURL:         'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    model:           'qwen3.8-max-preview',
    maxTokens:       16000,  // 限制输出 token，防止 thinking 模式无限消耗
    apiKeyEnv:       'SOFAGENT_LLM_B_API_KEY',
    specEnv:         'SOFAGENT_LLM_B',
    agentSkillPath:  join(AGENTS_DIR, 'reviewer/SKILL.md'),
    toolsKey:        'REVIEWER_TOOLS',
    billing:         'subscription',  // Token Plan 订阅制
  },
};

// ─── 模型定价（usage.jsonl 成本估算基础）─────────────────────
// 单位：CNY per 1M tokens（百万 token 计价）
// V 用 Qwen3.8-max-preview = 阿里百炼 Token Plan 订阅制 → 不按 token 计价。
// 订阅制按周期固定付费，与 token 消耗无关，MODEL_PRICING 的成本估算对
// 订阅账号意义有限，仅供参考（recordUsage 的 subscription 分支输出 cost_cny = null）。
// DeepSeek V4 Flash 条目保留做历史参考（V 曾按量计费使用：
//   input 0.5元/M（缓存未命中）、output 8元/M
//   https://api-docs.deepseek.com/quick_start/pricing）。
const MODEL_PRICING = {
  'qwen3.8-max-preview': {
    input: 0,
    output: 0,
    currency: 'CNY',
    source: 'https://help.aliyun.com/zh/model-studio/deep-thinking',
    note: 'Token Plan 订阅制，不按量计价，此处置 0；成本估算对订阅账号不适用',
    billing: 'subscription',
  },
  'deepseek-v4-flash': {
    input: 0.5,
    output: 8,
    currency: 'CNY',
    source: 'https://api-docs.deepseek.com/quick_start/pricing',
    note: 'Flash 版定价（缓存未命中）。缓存命中 input 0.025元/M',
    billing: 'pay-as-you-go',
  },
};

// ─── 步骤定义（prompt / output / inputs / maxTokens）─────────────────────
// 单角色 V，无 role 字段。5 步全串行。
// maxTokens：步骤级输出 token 上限覆盖。未定义时回退到 MODEL_CONFIGS[role].maxTokens。
// consolidate 需合并 acceptance/regression/coverage 三份完整报告为单份 stage6-report，输出超长，
// 单独调高到 32000，避免顶格 16000 被截断生成不了合法报告（整轮降级根因）。
const STEPS = {
  'acceptance':  { prompt: 'acceptance.md',  outputs: ['acceptance.md'],  inputs: [] },
  'regression':  { prompt: 'regression.md',  outputs: ['regression.md'],  inputs: [] },
  'coverage':    { prompt: 'coverage.md',    outputs: ['coverage.md'],    inputs: ['acceptance.md'] },
  'consolidate': { prompt: 'consolidate.md', outputs: ['stage6-report.md'], inputs: ['acceptance.md', 'regression.md', 'coverage.md'], maxTokens: 32000 },
  'verdict':     { prompt: 'verdict.md',     outputs: ['verdict.md'],     inputs: ['stage6-report.md'] },
};

// 步骤执行顺序（driver 按此顺序串行执行）
const STEP_ORDER = ['acceptance', 'regression', 'coverage', 'consolidate', 'verdict'];

// 每步的 recursionLimit
// regression 调到 250：46 维度 × 批量执行(每维度1次tool call) ≈ 53 calls × 2 = 106
// 留余量给环境验证轮询 + agent 思考轮次
const STEP_RECURSION_LIMITS = {
  'acceptance':  100,
  'regression':  400,
  'coverage':    100,
  'consolidate': 80,
  'verdict':     50,
};

// ═══════════════════════════════════════════════════════════
//  CLI 参数解析
// ═══════════════════════════════════════════════════════════
function parseArgs(argv) {
  const args = { target: null, dryRun: false,
                 worker: false, step: null, runDir: null,
                 skipAcceptance: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help             = true;
    else if (a === '--target')           args.target         = argv[++i];
    else if (a === '--dry-run')     args.dryRun         = true;
    else if (a === '--worker')      args.worker         = true;
    else if (a === '--step')        args.step           = argv[++i];
    else if (a === '--run-dir')     args.runDir         = argv[++i];
    else if (a === '--skip-acceptance') args.skipAcceptance = true;
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
 * Qwen3.8-max-preview：阿里百炼 Token Plan（OpenAI 兼容接口）。thinking-only
 *   模型，不需要传 thinking/reasoningEffort——MODEL_CONFIGS 未定义这两个字段，
 *   下方条件注入分支（cfg.thinking / cfg.reasoningEffort）与退化逻辑永不触发
 *   （无害保留）。
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
    if (cfg.thinking) {
      // 退化：去掉 thinking 再试（reasoning_effort 大概率被支持）
      console.warn(`[release-gate] ChatOpenAI 不接受 thinking 参数，退化仅用 reasoningEffort: ${err.message}`);
      delete ctorArgs.modelKwargs;
      return new ChatOpenAI(ctorArgs);
    }
    throw err;
  }
}

// ─── 工具输出截断（v1.2.5 性能优化）────────────────────────────
// Agent 跑一次 run_bash（如 npm test）输出可能 2000+ 行，完整输出被追加到
// messages 列表后每一次 LLM 调用都要重新处理它。截断到头尾各 100 行，
// 砍掉中间重复内容，可将单步 prompt_tokens 从 100k+ 降到 30-40k。
const TOOL_OUTPUT_MAX_LINES = 200;

function truncateToolOutput(text, maxLines = TOOL_OUTPUT_MAX_LINES) {
  const str = String(text);
  const lines = str.split('\n');
  if (lines.length <= maxLines) return str;
  const half = maxLines / 2;
  return [
    ...lines.slice(0, half),
    `\n... [${lines.length - maxLines} lines truncated by FORGE driver — head ${half} + tail ${half}] ...\n`,
    ...lines.slice(-half),
  ].join('\n');
}

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
 * Worker 主逻辑：读 prompt → 建 model+tools → invoke → 写产物。
 */
async function runWorker(step, runDir, target) {
  const stepDef = STEPS[step];
  if (!stepDef) throw new Error(`未知步骤: ${step}`);

  const role = 'V';
  const cfg  = MODEL_CONFIGS[role];

  // 1. 构建 systemPrompt
  const systemPrompt = buildSystemPrompt(cfg.agentSkillPath);

  // 2. 读 prompt 正文
  const promptTemplate = readFileSync(join(PROMPTS_DIR, stepDef.prompt), 'utf-8');

  // 3. 组装 user message：prompt 正文 + 路径注入 + target 注入
  const inputPaths = stepDef.inputs.map(f => `  - ${join(runDir, f)}`).join('\n');
  const outputPaths = stepDef.outputs.map(f => `  - ${join(runDir, f)}`).join('\n');

  // 注入 changelog 路径（步骤③ coverage 需要）
  const changelogPath = `docs/changelog/${target}.md`;

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
  const { SystemMessage } = await import('@langchain/core/messages');

  // v1.2.5 性能优化：stateModifier 同时实现「system prompt 注入」+「上下文裁剪」。
  // prompt 和 stateModifier 互斥（LangGraph 源码 _getPrompt 强校验），
  // 所以把 systemPrompt 移到 stateModifier 内部以 SystemMessage 形式注入。
  // 上下文裁剪：保留 system + 第一条 user + 最后 30 条，中间旧消息裁掉。
  const MAX_CONTEXT_MESSAGES = 30;
  const systemMsg = new SystemMessage(systemPrompt);
  const agent = createReactAgent({
    llm: model,
    tools,
    stateModifier: (state) => {
      const messages = state.messages ?? [];
      if (messages.length <= MAX_CONTEXT_MESSAGES + 1) {
        return [systemMsg, ...messages];
      }
      const first = messages[0];
      const recent = messages.slice(-MAX_CONTEXT_MESSAGES);
      return [systemMsg, first, ...recent];
    },
  });

  // 5. stream（计时）—— v1.2.5 改为流式输出
  console.log(`[worker:${step}] 开始执行（role=V, model=${cfg.model}）`);
  const t0 = Date.now();

  const recursionLimit = STEP_RECURSION_LIMITS[step] ?? 50;

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
    for await (const chunk of stream) {
      for (const [, delta] of Object.entries(chunk)) {
        const msgs = delta?.messages;
        if (!Array.isArray(msgs)) continue;
        for (const msg of msgs) {
          allMessages.push(msg);
          if (msg?._getType?.() === 'ai' && msg.tool_calls?.length > 0) {
            for (const tc of msg.tool_calls) {
              toolCallCount++;
              console.log(`  → [${step}#V] tool #${toolCallCount}: ${tc.name}`);
            }
          }
        }
      }
    }
    return { messages: allMessages };
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
  const text = extractAgentText(result);
  if (!text) {
    throw new Error(`[worker:${step}] Agent 未返回内容`);
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
 * 与 fresh-eyes-driver 完全一致的逻辑。
 */
function sliceMultiOutput(text, outputs) {
  const SEPARATOR_RE = /^===FILE:\s*(.+?)\s*===\s*$/gm;
  const slices = {};

  const marks = [];
  let m;
  while ((m = SEPARATOR_RE.exec(text)) !== null) {
    const filename = m[1].trim();
    const contentStart = SEPARATOR_RE.lastIndex;
    marks.push({ filename, contentStart });
  }

  if (marks.length === 0) {
    slices[outputs[0]] = text;
    for (let i = 1; i < outputs.length; i++) {
      slices[outputs[i]] = `<!-- 未检测到 ===FILE: 分隔符，此产物为空。请检查 agent 输出。 -->\n`;
    }
    return slices;
  }

  for (let i = 0; i < marks.length; i++) {
    const contentEnd = (i + 1 < marks.length)
      ? text.lastIndexOf('===FILE:', marks[i + 1].contentStart)
      : text.length;
    const raw = text.slice(marks[i].contentStart, contentEnd).trim();
    slices[marks[i].filename] = raw;
  }

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
    // 从后往前找最后一条 AI 消息（跳过 tool/human 消息）
    for (let i = result.messages.length - 1; i >= 0; i--) {
      const msg = result.messages[i];
      const isAI = msg?._getType?.() === 'ai' || (msg?.tool_calls !== undefined && msg?.content !== undefined);
      if (!isAI) continue;

      const content = msg?.content;
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

  return {
    acceptance:  extractResult('acceptance.md'),
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
  if (args.skipAcceptance && !existsSync(preRunLog)) {
    console.log('  [driver] --skip-acceptance 已指定，跳过预跑');
    console.log('  [driver] 请确保 acceptance-raw.log 存在（手动预跑：bash FORGE/playbook/acceptance-test.sh > runDir/acceptance-raw.log 2>&1）');
    writeFileSync(preRunLog,
      '--skip-acceptance 模式：未预跑 acceptance-test.sh。\n' +
      '请手动预跑后把日志放到此文件，或去掉 --skip-acceptance 参数让 driver 自动预跑。\n',
      'utf-8');
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
  if (!args.target) {
    console.error('用法: node FORGE/src/release-gate-driver.mjs --target vX.Y.Z [--dry-run] [--skip-acceptance]');
    console.error('      node FORGE/src/release-gate-driver.mjs --step <acceptance|regression|coverage|consolidate|verdict> --target vX.Y.Z');
    console.error('      node FORGE/src/release-gate-driver.mjs --help');
    process.exit(1);
  }

  // 验证环境变量（dry-run 跳过）
  const missingEnvs = [];
  for (const role of ['V']) {
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
  if (args.step && !args.worker) {
    if (!STEP_ORDER.includes(args.step)) {
      console.error(`未知步骤: ${args.step}，可选: ${STEP_ORDER.join(', ')}`);
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
    if (args.step === 'acceptance') {
      await ensureAcceptancePreRun(args, stepRunDir);
    }

    try {
      await runWorker(args.step, stepRunDir, args.target);
      console.log(`[driver] STEP_DONE: ${args.step} EXIT_CODE=0`);
      process.exit(0);
    } catch (err) {
      console.error(`[driver] STEP_DONE: ${args.step} EXIT_CODE=1 ERROR=${err.message}`);
      process.exit(1);
    }
  }

  // 建 run 目录
  const { runDir, runId, dateStr } = resolveRunDir();

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
  console.log(`   V          = ${MODEL_CONFIGS.V.model} (${MODEL_CONFIGS.V.baseURL})`);

  if (args.dryRun) {
    console.log(`\n  [dry-run] 将执行以下 5 步：`);
    console.log(args.skipAcceptance
      ? '    ① acceptance  (--skip-acceptance，跳过预跑)  → acceptance.md'
      : '    ① acceptance  (跑 acceptance-test.sh)     → acceptance.md');
    console.log('    ② regression  (跑 regression-checklist)   → regression.md');
    console.log('    ③ coverage    (覆盖率交叉检查)             → coverage.md');
    console.log('    ④ consolidate (合并三份结果)               → stage6-report.md');
    console.log('    ⑤ verdict     (PASS/FAIL 裁决)             → verdict.md');
    console.log('\n  ✅ dry-run 完成（未实际执行）\n');

    visibility.emit(EVENTS.LOOP_END, {
      verdict: 'DRY-RUN',
      stopReason: 'dry-run',
    });
    return;
  }

  // ─── 5 步串行执行 ───
  let completedSteps = 0;
  let stopReason = 'completed';
  const stepErrors = [];

  for (const step of STEP_ORDER) {
    const stepIndex = STEP_ORDER.indexOf(step) + 1;
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  步骤 ${stepIndex}/5 — ${step}`);
    console.log(`${'═'.repeat(60)}`);

    // acceptance 特殊处理：driver 先预跑脚本，worker 只解读日志
    if (step === 'acceptance') {
      await ensureAcceptancePreRun(args, runDir);
    }

    try {
      await spawnWorker(step, runDir, args.target);
      completedSteps++;

      // 可见性：步骤完成事件
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

      // 可见性：步骤失败也写事件
      visibility.emit(EVENTS.STEP_DONE, {
        step,
        stepIndex,
        totalSteps: STEP_ORDER.length,
        error: stepErr.message,
      });

      stopReason = 'step-error';
    }
  }

  // ─── 解析最终结果 ───
  const results = parseStepResults(runDir);
  const { verdict, reason } = parseVerdict(runDir);

  // usage.jsonl 全量摘要
  const usageSummary = appendUsageSummary(runDir, completedSteps);
  console.log(
    `\n  [总用量] tokens: ${usageSummary.total_tokens.toLocaleString()}  ` +
    `(V 订阅制)`
  );

  // 写 LEDGER
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  循环结束 — 停止原因: ${stopReason}`);
  console.log(`  完成步数: ${completedSteps}/5`);
  console.log(`  验证结果: acceptance=${results.acceptance} regression=${results.regression} coverage=${results.coverage}`);
  console.log(`  最终裁决: ${verdict} (${reason})`);
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
