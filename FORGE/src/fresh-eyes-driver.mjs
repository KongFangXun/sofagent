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
// 异构模型（孔老师 2026-07-25 定稿）：
//   A（审查者）= GLM-5.2     baseURL https://open.bigmodel.cn/api/coding/paas/v4/ (Coding Plan 端点)  temp=1.0
//   B（工程师）= DeepSeek V4  baseURL https://api.deepseek.com/             thinking+reasoning_effort=high
// ============================================================

import { spawn } from 'child_process';
import { createRequire } from 'module';
import {
  readFileSync, writeFileSync, mkdirSync, existsSync,
  appendFileSync, readdirSync,
} from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = resolve(__dirname, '../..');

// CJS interop — dist 产物是 CommonJS，.mjs 里用 createRequire 导入
const require = createRequire(import.meta.url);

// ─── 路径常量 ────────────────────────────────────────────────
const LOOP_DIR    = join(REPO_ROOT, 'FORGE/SKILL/fresh-eyes-loop');
const PROMPTS_DIR = join(LOOP_DIR, 'prompts');
const RUNS_DIR    = join(LOOP_DIR, 'runs');
const LEDGER_PATH = join(REPO_ROOT, 'FORGE/LEDGER.md');
const AGENTS_DIR  = join(REPO_ROOT, 'SKILL/agents');

// ─── 异构模型配置 ────────────────────────────────────────────
const MODEL_CONFIGS = {
  A: {
    baseURL:         'https://open.bigmodel.cn/api/coding/paas/v4/',
    model:           'glm-5.2',
    temperature:     1.0,
    maxTokens:       16000,  // 限制输出 token，防止 thinking 模式无限消耗
    apiKeyEnv:       'SOFAGENT_LLM_A_API_KEY',
    specEnv:         'SOFAGENT_LLM_A',
    agentSkillPath:  join(AGENTS_DIR, 'reviewer/SKILL.md'),
    toolsKey:        'REVIEWER_TOOLS',
    billing:         'subscription',   // Coding Plan 订阅制，不按 token 扣费
  },
  B: {
    baseURL:         'https://api.deepseek.com/',
    model:           'deepseek-v4-pro',
    thinking:        { type: 'enabled' },
    reasoningEffort: 'high',
    apiKeyEnv:       'SOFAGENT_LLM_B_API_KEY',
    specEnv:         'SOFAGENT_LLM_B',
    agentSkillPath:  join(AGENTS_DIR, 'engineer/SKILL.md'),
    toolsKey:        'ENGINEER_TOOLS',
    billing:         'pay-as-you-go',  // 按量计费
  },
};

// ─── 模型定价（usage.jsonl 成本估算基础）─────────────────────
// 单位：CNY per 1M tokens（百万 token 计价）
// 数据来源：各厂商官方定价页（2026-07-25 查证）
//
// ⚠️ 计费模式区分（2026-07-25 确认）：
//   A (glm-5.2) = Coding Plan 订阅制 → cost_cny 记 null，不适用本表计价
//   B (deepseek-v4-pro) = 按量计费 → 适用本表计价
// 本表仅用于 B 的成本估算。A 的真实成��见 Coding Plan 后台额度消耗。
//
// ⚠️ 这是「估算」不是「账单」：
//   官方标价 ≠ 实际扣费。缓存命中率、账号促销、套餐折扣都会影响最终费用。
//   driver 算出的 cost_cny 仅供成本感知（「这轮大概花了多少」），
//   真实账单请到各厂商 API 后台查看。
//
// GLM-5.2（智谱 2026-06 旗舰，744B MoE，1M 上下文）：
//   https://open.bigmodel.cn/pricing
//   input 8元 / output 28元 / 缓存命中 input 2元
//
// DeepSeek V4 Pro（DeepSeek 2026-07 旗舰，1.6T MoE，1M 上下文）：
//   https://api-docs.deepseek.com/quick_start/pricing
//   input 3元（缓存未命中）/ output 6元 / 缓存命中 input 0.025元
//   注：DeepSeek 官方定价页未提及峰谷定价（截至 2026-07-25）。
//   峰谷定价曾有新闻提及但未正式实施，若后续上线需更新本表。
//   → 本表按「缓存未命中」计价（成本上界，缓存命中时实际账单更低）
const MODEL_PRICING = {
  'glm-5.2': {
    input: 8,
    output: 28,
    currency: 'CNY',
    source: 'https://open.bigmodel.cn/pricing',
    note: '缓存命中 input 2元/M。官方标价，实际账单以 API 后台为准',
    billing: 'subscription',   // Coding Plan 订阅制，本表定价仅供参考
  },
  'deepseek-v4-pro': {
    input: 3,
    output: 6,
    currency: 'CNY',
    source: 'https://api-docs.deepseek.com/quick_start/pricing',
    note: '缓存命中 input 0.025元/M（120x 价差）。本表按未命中算（成本上界）',
  },
};

// ─── 步骤定义（role / prompt / output / extraInputs）────────
const STEPS = {
  'a-check':       { role: 'A', prompt: 'a-check.md',       outputs: ['check-a.md'],             inputs: [] },
  'b-check':       { role: 'B', prompt: 'b-check.md',       outputs: ['check-b.md'],             inputs: [] },
  'a-consolidate': { role: 'A', prompt: 'a-consolidate.md', outputs: ['findings.md','result.md'],inputs: ['check-a.md','check-b.md'] },
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
  return header + '\n\n' + body;
}

/**
 * 为指定角色创建 LLM 模型实例。
 *
 * GLM (A)：标准 ChatOpenAI，temperature=1.0。
 * DeepSeek (B)：ChatOpenAI + reasoningEffort='high'；thinking 参数通过
 *   modelKwargs 注入——若 @langchain/openai 版本不支持 modelKwargs，
 *   会走 catch 分支退到原生 fetch（仅影响 B，不影响 A）。
 */
async function createModel(role) {
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
  if (cfg.maxTokens) {
    ctorArgs.maxTokens = cfg.maxTokens;
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
function loadTools(role) {
  const cfg = MODEL_CONFIGS[role];
  const toolsModule = require('../../engine/orchestrator/dist/tools.js');
  const tools = toolsModule[cfg.toolsKey];
  if (!tools) {
    throw new Error(`工具集 ${cfg.toolsKey} 未在 dist/tools.js 中找到`);
  }
  return tools;
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
 * @param {string} model      模型名（如 'glm-5.2'）
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
  const inputPaths = stepDef.inputs.map(f => `  - ${join(roundDir, f)}`).join('\n');
  const outputPaths = stepDef.outputs.map(f => `  - ${join(roundDir, f)}`).join('\n');

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
  const model = await createModel(role);
  const tools = loadTools(role);

  const { createDeepAgent } = await import('deepagents');
  const { DiskBackend } = await import('./disk-backend.mjs');
  const agent = await createDeepAgent({
    model,
    tools,
    systemPrompt,
    backend: (config) => new DiskBackend(config),
  });

  // 5. invoke（计时）
  console.log(`[worker:${step}] 开始执行（role=${role}, model=${cfg.model}）`);
  const t0 = Date.now();
  const result = await agent.invoke({
    messages: [{ role: 'user', content: userMessage }],
  });
  const latencyMs = Date.now() - t0;

  // 5b. 记录 usage（try/catch 包住——usage 记录失败不能中断主流程）
  try {
    // 从 roundDir 推导 runDir（roundDir = runDir/round-NN）
    const runDir = resolve(roundDir, '..');
    recordUsage(runDir, step, round, role, cfg.model, result, latencyMs, target);
  } catch (usageErr) {
    console.warn(`[worker:${step}] usage 记录失败（不影响主流程）: ${usageErr.message}`);
  }

  // 6. 提取文本输出
  const text = extractAgentText(result);
  if (!text) {
    throw new Error(`[worker:${step}] DeepAgent 未返回内容`);
  }

  // 7. 写产物
  //    单输出：直接写。
  //    多输出（如 a-consolidate 产 findings.md + result.md）：
  //      约定 agent 返回文本用 `===FILE: <filename>===` 分隔多产物，
  //      driver 按分隔符切片分别写入对应文件。
  //      若找不到分隔符，fallback 把整个文本写入第一个产物（不丢内容）。
  if (stepDef.outputs.length === 1) {
    const outPath = join(roundDir, stepDef.outputs[0]);
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
  if (result?.content) return typeof result.content === 'string'
    ? result.content
    : Array.isArray(result.content)
      ? result.content.map(c => typeof c === 'string' ? c : c?.text ?? '').join('')
      : String(result.content);
  if (result?.messages) {
    const last = result.messages[result.messages.length - 1];
    if (typeof last?.content === 'string') return last.content;
    if (Array.isArray(last?.content)) {
      return last.content.map(c => typeof c === 'string' ? c : c?.text ?? '').join('');
    }
  }
  return String(result ?? '');
}

// ═══════════════════════════════════════════════════════════
//  Driver 模式 — 编排循环
// ═══════════════════════════════════════════════════════════

/**
 * 生成 run 目录路径：runs/YYYY/MM/DD/run-NN/
 * 同日多次跑 = run-01, run-02 ...
 */
function resolveRunDir() {
  const now = new Date();
  const y  = String(now.getFullYear());
  const m  = String(now.getMonth() + 1).padStart(2, '0');
  const d  = String(now.getDate()).padStart(2, '0');
  const dateDir = join(RUNS_DIR, y, m, d);

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
 * @param {string} roundDir  本轮目录绝对路径
 * @param {string} target    审查目标版本号
 * @param {number} round     轮次号（通过 FORGE_ROUND 环境变量传给 worker）
 */
function spawnWorker(step, roundDir, target, round) {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(process.execPath, [
      __filename,
      '--worker',
      '--step', step,
      '--round-dir', roundDir,
      '--target', target,
    ], {
      cwd: REPO_ROOT,
      stdio: ['pipe', 'inherit', 'inherit'],
      env: { ...process.env, FORGE_ROUND: String(round) },  // 继承环境变量 + 注入轮次号
    });

    child.on('close', (code) => {
      if (code === 0) resolveP();
      else rejectP(new Error(`worker ${step} 退出码 ${code}`));
    });
    child.on('error', rejectP);
  });
}

/**
 * 并行起两个 worker（用于步骤 ①② 双盲独立审查）。
 *
 * @param {Array<[string,string,string]>} workers  [step, roundDir, target] 元组数组
 * @param {number} round  轮次号（透传给 spawnWorker）
 */
function spawnParallel(workers, round) {
  return Promise.all(workers.map(([step, roundDir, target]) => spawnWorker(step, roundDir, target, round)));
}

/**
 * 解析停止条件——driver 唯一做判断的地方。
 *
 * 读 findings.md 数 P0/P1 标记；读 result.md verify 列数 FAIL。
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

  // 干净轮 = 无 P0 无 P1 且无 FAIL
  const isClean = (p0 === 0 && p1 === 0 && !hasFail);

  return { p0, p1, p2, hasFail, isClean };
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
    try { rec = JSON.parse(line); } catch { continue; }
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

  const totalTokens = byRole.A.total_tokens + byRole.B.total_tokens;
  const totalCost   = byRole.A.cost_cny + byRole.B.cost_cny;

  const summary = {
    _summary:       true,
    total_tokens:   totalTokens,
    total_cost_cny: Number(totalCost.toFixed(6)),
    rounds:         rounds,
    by_role:        byRole,
    a_billing:      'subscription',  // A (glm-5.2) = Coding Plan 订阅制，cost_cny 不适用
  };

  appendFileSync(usagePath, JSON.stringify(summary) + '\n', 'utf-8');
  return summary;
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
    console.log('    ⑤ a-verify  (A 验证)        → result.md 回填 verify');
    const counts = parseStopCondition(roundDir);
    return { roundDir, counts, isClean: true };
  }

  // 步骤 ①② 双盲��立审查——并行
  console.log('\n  [步骤 ①②] A/B 双盲独立审查（并行）...');
  await spawnParallel([
    ['a-check', roundDir, target],
    ['b-check', roundDir, target],
  ], roundNum);

  // 步骤 ③ A 合并
  console.log('\n  [步骤 ③] A 合并 check-a + check-b → findings + result...');
  await spawnWorker('a-consolidate', roundDir, target, roundNum);

  // 步骤 ④ B 修复
  console.log('\n  [步骤 ④] B 按 result.md 修复...');
  await spawnWorker('b-fix', roundDir, target, roundNum);

  // 步骤 ⑤ A 验证
  console.log('\n  [步骤 ⑤] A 验证修复，回填 verify 列...');
  await spawnWorker('a-verify', roundDir, target, roundNum);

  // 判定停止条件
  const counts = parseStopCondition(roundDir);
  console.log(`\n  [停止判定] P0=${counts.p0} P1=${counts.p1} P2=${counts.p2} FAIL=${counts.hasFail} → ${counts.isClean ? 'CLEAN' : 'NOT-CLEAN'}`);

  // 打印本轮成本摘要
  const costSummary = summarizeRoundCost(runDir, roundNum);
  const aModel = costSummary.A.model || 'glm-5.2';
  const bModel = costSummary.B.model || 'deepseek-v4-pro';
  console.log(
    `  [Round ${roundNum} 成本] A(${aModel}): ${costSummary.A.tokens.toLocaleString()} tokens / ¥${costSummary.A.cost.toFixed(4)}  |  ` +
    `B(${bModel}): ${costSummary.B.tokens.toLocaleString()} tokens / ¥${costSummary.B.cost.toFixed(4)}  |  ` +
    `合计: ¥${(costSummary.A.cost + costSummary.B.cost).toFixed(4)}`
  );

  return { roundDir, counts, isClean: counts.isClean };
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
      process.exit(1);
    }
    return;
  }

  // ─── Driver 模式 ───
  if (!args.target) {
    console.error('用法: node FORGE/src/fresh-eyes-driver.mjs --target vX.Y.Z [--max-rounds N] [--dry-run]');
    process.exit(1);
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
  console.log(`\n🔍 fresh-eyes-loop 启动`);
  console.log(`   target    = sofagent ${args.target}`);
  console.log(`   max-rounds = ${args.maxRounds}`);
  console.log(`   run-dir    = ${runDir}`);
  console.log(`   dry-run    = ${args.dryRun}`);
  console.log(`   A          = GLM-5.2 (${MODEL_CONFIGS.A.baseURL})`);
  console.log(`   B          = DeepSeek V4 Pro (${MODEL_CONFIGS.B.baseURL})`);

  let cleanStreak   = 0;
  let stopReason    = 'max-rounds';
  let actualRounds  = 0;
  let finalCounts   = { p0: 0, p1: 0, p2: 0 };

  for (let round = 1; round <= args.maxRounds; round++) {
    actualRounds = round;
    const { roundDir, counts, isClean } = await runRound(round, runDir, args.target, args.dryRun);
    finalCounts = counts;

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
      console.log(`\n  ❌ 本轮有 P0/P1/FAIL，进入下一轮`);
    }
  }

  // usage.jsonl 全量摘要（非 dry-run）
  if (!args.dryRun) {
    const usageSummary = appendUsageSummary(runDir, actualRounds);
    // token 为主的展示格式——A 标订阅制（不硬凑成本），B 标按量
    console.log(
      `\n  [总用量] tokens: ${usageSummary.total_tokens.toLocaleString()}  ` +
      `(A 订阅 + B 按量 ¥${usageSummary.total_cost_cny.toFixed(4)})`
    );
    console.log(
      `           A(${usageSummary.by_role.A.model || 'glm-5.2'}):       ` +
      `${usageSummary.by_role.A.total_tokens.toLocaleString()} tokens  [Coding Plan 订阅额度]`
    );
    console.log(
      `           B(${usageSummary.by_role.B.model || 'deepseek-v4-pro'}):   ` +
      `${usageSummary.by_role.B.total_tokens.toLocaleString()} tokens  ` +
      `¥${usageSummary.by_role.B.cost_cny.toFixed(4)} [按量计费]`
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

  console.log('\n✅ fresh-eyes-loop 完成\n');
}

main().catch(err => {
  console.error(`\n💥 致命错误: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
