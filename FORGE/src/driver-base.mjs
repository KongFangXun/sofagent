// ============================================================
// FORGE/src/driver-base.mjs · FORGE driver 公共编排层
// v1.2.7 新建 · 功能 ⑤
//
// 提取 fresh-eyes-driver 和 release-gate-driver 的 13 项公共逻辑：
//   1. parseDriverArgs()      — CLI 参数解析
//   2. resolvePaths()         — 路径常量
//   3. createModelFromConfig() — 模型创建
//   4. spawnWorkerStep()      — Worker spawn
//   5. buildWorkerSystemPrompt() — systemPrompt 构建
//   6. initVisibility()       — 可见性
//   7. initProgress()         — 进度中间件
//   8. createCircuitBreaker() — 三层熔断
//   9. appendLedger()         — LEDGER 追加
//  10. recordTokenUsage()     — usage 统计
//  11. truncateToolOutput()   — 工具输出截断
//  12. updateLatestPointer()  — latest.json 指针
//  13. resolveVisibleFiles()  — 文件可见性控制
//
// ⚠️ 抽象边界（已定稿）：
//   base 只提取公共工具函数，不提取 main() 框架。
//   各 driver 的 main() 仍独立。这样抽象成本最低。
//
// 各 driver 提供 config（steps / stepOrder / circuitBreaker values / roleMode /
// stopCondition），公共逻辑全部在 base 中实现。
// ============================================================

import { spawn } from 'child_process';
import { createRequire } from 'module';
import {
  readFileSync, writeFileSync, mkdirSync, existsSync,
  appendFileSync, readdirSync,
} from 'fs';
import { join, resolve, dirname, relative, sep } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

import { createVisibility, EVENTS } from './visibility.mjs';
import { createProgressMiddleware } from './progress-middleware.mjs';

// ─── 工厂函数 ────────────────────────────────────────────────

/**
 * 创建 FORGE driver 公共编排层。
 *
 * @param {Object} config - driver 配置
 * @param {string} config.driverName - driver 名称（'fresh-eyes' / 'release-gate'）
 * @param {string} config.loopDir - loop 目录路径
 * @param {string} config.repoRoot - 仓库根目录
 * @param {Object} config.modelConfigs - 模型配置（resolveConfigs 结果）
 * @param {Object} config.modelPricing - 模型定价
 * @returns {Object} 公共工具集（13 项函数）
 */
export function createForgeDriverBase(config = {}) {
  const {
    driverName = 'unknown',
    loopDir = '',
    repoRoot = process.cwd(),
    modelConfigs = {},
    modelPricing = {},
  } = config;

  const PROMPTS_DIR = join(loopDir, 'prompts');
  const AGENTS_DIR = join(repoRoot, 'SKILL', 'agents');
  const SOFAGENT_HOME = process.env.SOFAGENT_HOME || join(os.homedir(), '.sofagent');
  const RUNS_DIR = join(SOFAGENT_HOME, 'data', 'forge-runs');
  const LEDGER_PATH = join(repoRoot, 'FORGE', 'LEDGER.md');

  // ── 1. parseDriverArgs ──────────────────────────────

  /**
   * CLI 参数解析——提取公共参数模式。
   * 各 driver 可在此基础上扩展自身参数。
   *
   * @param {string[]} argv - process.argv.slice(2)
   * @returns {Object} 解析后的参数
   */
  function parseDriverArgs(argv) {
    const args = { target: null, dryRun: false, worker: false, step: null, runDir: null, maxRounds: 10, help: false, extra: {} };

    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a === '--target' || a === '-t') { args.target = argv[++i]; continue; }
      if (a === '--dry-run') { args.dryRun = true; continue; }
      if (a === '--worker') { args.worker = true; continue; }
      if (a === '--step') { args.step = argv[++i]; continue; }
      if (a === '--run-dir') { args.runDir = argv[++i]; continue; }
      if (a === '--max-rounds') { args.maxRounds = parseInt(argv[++i], 10) || 10; continue; }
      if (a === '--help' || a === '-h') { args.help = true; continue; }
      // 其余参数存入 extra（各 driver 特有参数）
      if (a.startsWith('--')) {
        const key = a.slice(2);
        const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
        args.extra[key] = val;
      }
    }

    return args;
  }

  // ── 2. resolvePaths ──────────────────────────────

  /**
   * 解析公共路径常量。
   */
  function resolvePaths() {
    return {
      repoRoot,
      loopDir,
      promptsDir: PROMPTS_DIR,
      agentsDir: AGENTS_DIR,
      runsDir: RUNS_DIR,
      ledgerPath: LEDGER_PATH,
      sofagentHome: SOFAGENT_HOME,
    };
  }

  // ── 3. createModelFromConfig ──────────────────────────────

  /**
   * 根据角色配置创建模型实例。
   *
   * @param {string} role - 角色名（'A' / 'B' / 'V'）
   * @param {number} maxTokensOverride - 步骤级 maxTokens 覆盖
   * @returns {Object|null} 模型实例，或 null（配置不可用）
   */
  function createModelFromConfig(role, maxTokensOverride = null) {
    const cfg = modelConfigs[role];
    if (!cfg) return null;

    const apiKey = process.env[`SOFAGENT_LLM_${role}_API_KEY`]
      || process.env.SOFAGENT_LLM_API_KEY
      || process.env.OPENAI_API_KEY;
    if (!apiKey) return null;

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { ChatOpenAI } = require('@langchain/openai');
      const maxTokens = maxTokensOverride ?? cfg.maxTokens ?? 16000;
      return new ChatOpenAI({
        modelName: cfg.model,
        configuration: { baseURL: cfg.baseURL },
        openAIApiKey: apiKey,
        maxTokens,
      });
    } catch {
      return null;
    }
  }

  // ── 4. spawnWorkerStep ──────────────────────────────

  /**
   * spawn worker 子进程执行单个步骤。
   *
   * @param {string} scriptPath - driver 脚本路径
   * @param {Object} opts - { step, runDir, target, extraArgs }
   * @returns {Promise<number>} 退出码
   */
  function spawnWorkerStep(scriptPath, opts = {}) {
    const { step, runDir, target, extraArgs = [] } = opts;
    const workerArgs = ['--worker', '--step', step, '--run-dir', runDir, '--target', target, ...extraArgs];

    return new Promise((resolvePromise) => {
      const child = spawn('node', [scriptPath, ...workerArgs], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      let stdout = '', stderr = '';
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('close', (code) => {
        if (stdout.trim()) console.log(stdout.trim());
        if (stderr.trim() && code !== 0) console.error(stderr.trim());
        resolvePromise(code ?? 0);
      });
      child.on('error', () => resolvePromise(1));
    });
  }

  // ── 5. buildWorkerSystemPrompt ──────────────────────────────

  /**
   * 构建 worker 的 system prompt。
   *
   * @param {string} skillPath - prompt 文件路径
   * @param {Object} context - 额外上下文（target / step / round 等）
   * @returns {string} system prompt
   */
  function buildWorkerSystemPrompt(skillPath, context = {}) {
    let prompt = '';
    if (existsSync(skillPath)) {
      prompt = readFileSync(skillPath, 'utf-8');
    }

    // 注入通用上下文
    const contextLines = [
      `\n# 运行上下文`,
      `- driver: ${driverName}`,
    ];
    if (context.target) contextLines.push(`- target: ${context.target}`);
    if (context.step) contextLines.push(`- step: ${context.step}`);
    if (context.round != null) contextLines.push(`- round: ${context.round}`);

    return prompt + '\n' + contextLines.join('\n');
  }

  // ── 6. initVisibility ──────────────────────────────

  /**
   * 初始化可见性追踪。
   *
   * @param {string} runDir - 运行目录
   * @returns {Object} visibility 实例
   */
  function initVisibility(runDir) {
    return createVisibility({
      runDir,
      driverName,
      events: EVENTS,
    });
  }

  // ── 7. initProgress ──────────────────────────────

  /**
   * 初始化进度中间件。
   *
   * @returns {Object} progress middleware 实例
   */
  function initProgress() {
    return createProgressMiddleware();
  }

  // ── 8. createCircuitBreaker ──────────────────────────────

  /**
   * 创建三层熔断器。
   *
   * @param {Object} cbConfig - { softLimit, hardLimit, graceSteps }
   * @returns {Object} 熔断器控制对象
   */
  function createCircuitBreaker(cbConfig = {}) {
    const {
      softLimit = 50,
      hardLimit = 60,
      graceSteps = 5,
    } = cbConfig;

    return {
      softLimit,
      hardLimit,
      graceSteps,
      /** 检查是否触发软熔断 */
      shouldSoftBreak(toolCount) { return toolCount >= softLimit; },
      /** 检查是否触发硬熔断 */
      shouldHardBreak(toolCount) { return toolCount >= hardLimit; },
      /** 构建软熔断 HumanMessage */
      buildSoftBreakMessage() {
        return { type: 'human', content: '工具调用次数已达上限，请立即写报告并输出结论。' };
      },
    };
  }

  // ── 9. appendLedger ──────────────────────────────

  /**
   * 向 LEDGER.md 追加一行。
   *
   * @param {string} dateStr - 日期
   * @param {string} runId - 运行 ID
   * @param {Object} summary - 运行摘要
   * @param {string} stopReason - 停止原因
   * @param {string} runDir - 运行目录
   */
  function appendLedger(dateStr, runId, summary, stopReason, runDir) {
    const line = [
      dateStr,
      runId,
      driverName,
      summary.rounds ?? summary.steps ?? '?',
      summary.p0 ?? 0,
      summary.p1 ?? 0,
      summary.p2 ?? 0,
      stopReason,
      relativeRunDir(runDir),
    ].join(' | ') + '\n';

    if (!existsSync(dirname(LEDGER_PATH))) mkdirSync(dirname(LEDGER_PATH), { recursive: true });
    appendFileSync(LEDGER_PATH, line);
  }

  // ── 10. recordTokenUsage ──────────────────────────────

  /**
   * 记录 token 使用量。
   *
   * @param {string} runDir - 运行目录
   * @param {string} step - 步骤名
   * @param {number} round - 轮次
   * @param {string} role - 角色
   * @param {string} model - 模型名
   * @param {Object} result - agent 结果（含 usage）
   * @param {number} latencyMs - 延迟
   * @param {string} target - 目标版本
   */
  function recordTokenUsage(runDir, step, round, role, model, result, latencyMs, target) {
    const usage = extractUsage(result);
    const pricing = modelPricing[model];
    let costCny = null;

    if (pricing && pricing.billing !== 'subscription') {
      const inputCost = (usage.promptTokens / 1_000_000) * (pricing.input ?? 0);
      const outputCost = (usage.completionTokens / 1_000_000) * (pricing.output ?? 0);
      costCny = inputCost + outputCost;
    }

    const entry = [
      JSON.stringify({
        timestamp: new Date().toISOString(),
        step, round: round ?? null, role, model, target,
        ...usage,
        latencyMs,
        costCny,
        billing: pricing?.billing ?? 'unknown',
      }),
    ].join('\n') + '\n';

    const usagePath = join(runDir, 'usage.jsonl');
    appendFileSync(usagePath, entry);
  }

  /** 从 agent 结果中提取 usage */
  function extractUsage(result) {
    if (!result || typeof result !== 'object') return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    const usage = result.usage_metadata || result.usage || {};
    return {
      promptTokens: usage.input_tokens || usage.prompt_tokens || 0,
      completionTokens: usage.output_tokens || usage.completion_tokens || 0,
      totalTokens: usage.total_tokens || (usage.input_tokens || 0) + (usage.output_tokens || 0),
    };
  }

  // ── 11. truncateToolOutput ──────────────────────────────

  /** 工具输出最大行数 */
  const TOOL_OUTPUT_MAX_LINES = 200;

  /**
   * 截断工具输出（防止超长输出撑爆上下文）。
   *
   * @param {string} text - 原始输出
   * @param {number} maxLines - 最大行数
   * @returns {string} 截断后的输出
   */
  function truncateToolOutput(text, maxLines = TOOL_OUTPUT_MAX_LINES) {
    if (!text || typeof text !== 'string') return '';
    const lines = text.split('\n');
    if (lines.length <= maxLines) return text;
    return lines.slice(0, maxLines).join('\n') + `\n... (truncated ${lines.length - maxLines} lines)`;
  }

  // ── 12. updateLatestPointer ──────────────────────────────

  /**
   * 更新 latest.json 指针文件。
   *
   * @param {string} runDir - 运行目录
   * @param {Object} opts - { stopReason, totalRounds, counts }
   */
  function updateLatestPointer(runDir, opts = {}) {
    const { stopReason = null, totalRounds = 0, counts = {} } = opts;
    const pointerDir = dirname(runDir);
    const pointerPath = join(pointerDir, 'latest.json');
    if (!existsSync(pointerDir)) mkdirSync(pointerDir, { recursive: true });
    const pointer = {
      runDir: relativeRunDir(runDir),
      driver: driverName,
      stopReason,
      totalRounds,
      counts,
      timestamp: new Date().toISOString(),
    };
    writeFileSync(pointerPath, JSON.stringify(pointer, null, 2) + '\n');
  }

  // ── 13. resolveVisibleFiles ──────────────────────────────

  /**
   * 解析步骤可见文件列表。
   *
   * @param {string} stepName - 步骤名
   * @param {Object} stepConfig - 步骤配置（含 inputs/outputs）
   * @returns {string[]} 可见文件列表
   */
  function resolveVisibleFiles(stepName, stepConfig = {}) {
    const visible = new Set();
    // 步骤产出文件
    for (const out of stepConfig.outputs ?? []) visible.add(out);
    // 步骤输入文件
    for (const inp of stepConfig.inputs ?? []) visible.add(inp);
    return Array.from(visible);
  }

  // ── 辅助 ──────────────────────────────

  /** 相对化运行目录路径（用于 LEDGER 展示） */
  function relativeRunDir(runDir) {
    try {
      return relative(repoRoot, runDir);
    } catch {
      return runDir;
    }
  }

  /** 从 agent 结果中提取文本 */
  function extractAgentText(result) {
    if (typeof result === 'string') return result;
    if (result && typeof result === 'object') {
      if (typeof result.content === 'string') return result.content;
      if (Array.isArray(result.messages)) {
        for (let i = result.messages.length - 1; i >= 0; i--) {
          const msg = result.messages[i];
          if ((msg.role === 'assistant' || msg.type === 'ai') && typeof msg.content === 'string') {
            return msg.content;
          }
        }
      }
    }
    return String(result ?? '');
  }

  return {
    // 13 项公共工具函数
    parseDriverArgs,
    resolvePaths,
    createModelFromConfig,
    spawnWorkerStep,
    buildWorkerSystemPrompt,
    initVisibility,
    initProgress,
    createCircuitBreaker,
    appendLedger,
    recordTokenUsage,
    truncateToolOutput,
    updateLatestPointer,
    resolveVisibleFiles,
    // 辅助函数
    extractUsage,
    extractAgentText,
    relativeRunDir,
    // 常量
    PROMPTS_DIR,
    AGENTS_DIR,
    RUNS_DIR,
    LEDGER_PATH,
    SOFAGENT_HOME,
    TOOL_OUTPUT_MAX_LINES,
  };
}
