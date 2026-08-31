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
//  16. saveResumePoint()     — 断点续跑：写 resume-point.json（v1.2.8 功能⑦）
//  17. loadResumePoint()     — 断点续跑：读 resume-point.json（v1.2.8 功能⑦）
//  18. runPreflight()        — FORGE preflight-check 跑前自检（模块级导出，非工厂内函数）
//      formatPreflightReport() — preflight 结果格式化输出
//
// ⚠️ 抽象边界（已定稿）：
//   base 只提取公共工具函数，不提取 main() 框架。
//   各 driver 的 main() 仍独立。这样抽象成本最低。
//
// 各 driver 提供 config（steps / stepOrder / circuitBreaker values / roleMode /
// stopCondition），公共逻辑全部在 base 中实现。
// ============================================================

import { spawn, execSync } from 'child_process';
import { createRequire } from 'module';
import {
  readFileSync, writeFileSync, mkdirSync, existsSync,
  appendFileSync, readdirSync, renameSync,
  statSync as statSyncReal, fstatSync as fstatSyncReal, unlinkSync, rmSync,
} from 'fs';
// preflight 磁盘检查：fs.statfs（Node 18.15+ 的异步版本）——低版本 Node 该导出
// 为 undefined，runPreflight 内部检测到 undefined 自动跳过磁盘检查（降级不阻塞）。
import * as fsModule from 'fs';
const statfsReal = typeof fsModule.statfs === 'function'
  ? (path) => new Promise((res, rej) => fsModule.statfs(path, (err, stats) => (err ? rej(err) : res(stats))))
  : undefined;
import { join, resolve, dirname, relative, sep } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

import { createVisibility, EVENTS } from './visibility.mjs';
import { createProgressMiddleware } from './progress-middleware.mjs';
// v1.2.8 功能③：统一工具输出截断中间件（替代下方内联实现）
import { truncateToolOutput as truncateToolOutputUnified, createToolOutputBudget, DEFAULT_BUDGET as TOOL_OUTPUT_DEFAULT } from './tool-output-budget.mjs';

/**
 * 给 shell 命令中的文件路径加单引号转义（防止路径含空格/特殊字符）。
 * v1.3.1 P0-2 修复：git add 显式文件清单时使用。
 * @param {string} p 文件路径
 * @returns {string} 单引号包裹的路径（内部 ' 转义为 '\''）
 */
function quotePath(p) {
  return `'${String(p).replace(/'/g, `'\\''`)}'`;
}

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
    const args = { target: null, dryRun: false, worker: false, step: null, runDir: null, maxRounds: 10, help: false, resume: false, extra: {} };

    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a === '--target' || a === '-t') { args.target = argv[++i]; continue; }
      if (a === '--dry-run') { args.dryRun = true; continue; }
      // v1.2.8 功能⑦：断点续跑开关（参数名与两个 driver 的 parseArgs 保持一致）
      if (a === '--resume') { args.resume = true; continue; }
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
      // v1.3.7 run-28 修复：LLM 调用超时保护——网络抖断时 fetch 无限挂死，
      // driver 主进程失联后被外部回收（SIGKILL 无栈无痕迹，run-27/28 连续两死）。
      // timeout 为单次请求上限（thinking= max 时一次调用可到分钟级，10 分钟足够）；
      // maxRetries 覆盖瞬时网络抖动（LangChain 内置指数退避）。
      return new ChatOpenAI({
        modelName: cfg.model,
        configuration: { baseURL: cfg.baseURL },
        openAIApiKey: apiKey,
        maxTokens,
        timeout: 600_000,
        maxRetries: 2,
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
    // v1.3.0 run-23 修复：worker 超时兜底。worker 写完产物后若残留未清理句柄
    // （LangGraph stream / API 长连接）进程不退出 → 本 Promise 永不 resolve →
    // driver 永久 await（run-23 round-5 实测 hang 18 分钟，最终靠 worker 自行退出）。
    // 超时强制 kill + resolve 非零码（124），调用方 catch 后把该批记为失败继续流程。
    // 正常 worker 最久 ~15 分钟（consolidate 撞 80 熔断 + 兜底），30 分钟给足余量。
    const WORKER_TIMEOUT_MS = 30 * 60 * 1000;
    const workerArgs = ['--worker', '--step', step, '--run-dir', runDir, '--target', target, ...extraArgs];

    return new Promise((resolvePromise) => {
      const child = spawn('node', [scriptPath, ...workerArgs], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      let stdout = '', stderr = '';
      let settled = false;
      const timeoutTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        console.error(`  ⚠️ [spawnWorker:${step}] worker 超时（30 分钟），强制 kill（pid=${child.pid}）`);
        child.kill('SIGKILL');
        resolvePromise(124); // 超时退出码（与 GNU timeout 一致）
      }, WORKER_TIMEOUT_MS);

      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('close', (code) => {
        clearTimeout(timeoutTimer);
        if (settled) return;
        settled = true;
        if (stdout.trim()) console.log(stdout.trim());
        if (stderr.trim() && code !== 0) console.error(stderr.trim());
        resolvePromise(code ?? 0);
      });
      child.on('error', () => {
        clearTimeout(timeoutTimer);
        if (!settled) { settled = true; resolvePromise(1); }
      });
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

  // ── 11. truncateToolOutput（v1.2.8 功能③：迁移到统一中间件）──

  /** 工具输出最大行数（v1.2.8：从 tool-output-budget.mjs 导入） */
  const TOOL_OUTPUT_MAX_LINES = TOOL_OUTPUT_DEFAULT;

  /**
   * 截断工具输出（防止超长输出撑爆上下文）。
   *
   * v1.2.8 功能③：改为委托统一中间件实现。
   * 保留原签名以兼容已有调用方。
   *
   * @param {string} text - 原始输出
   * @param {number} maxLines - 最大行数
   * @returns {string} 截断后的输出
   */
  function truncateToolOutput(text, maxLines = TOOL_OUTPUT_MAX_LINES) {
    return truncateToolOutputUnified(text, maxLines);
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

  // ── 14. sliceMultiOutput ──────────────────────────────

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

  // ── 辅助 ──────────────────────────────

  /** 相对化运行目录路径（用于 LEDGER 展示） */
  function relativeRunDir(runDir) {
    try {
      return relative(repoRoot, runDir);
    } catch {
      return runDir;
    }
  }

  // ─── 报告质量门控（模块级，extractAgentText 与两个 driver 的 stream loop 共用）────
  //
  // v1.2.7 run-07：GLM 的中间思考碎片（172 字符"现在让我查看..."）被当报告写入。
  // 真报告至少含 1 个 ## 标题行 或 ≥ 500 字符。
  //
  // v1.4.3：从 fresh-eyes-driver / release-gate-driver 各一份提到此处共用。两份副本
  //   曾出现阈值漂移（fresh-eyes 500 / release-gate 300）——这两个 driver 分别是审查
  //   与发版门禁的裁决口，同一份文本在两处得到相反结论，故判定口径必须同源。
  //   阈值 500 是 run-07 实战定下的（详见 fresh-eyes 侧修复记录），不是随手取值。
  const REPORT_MIN_CHARS = 500;
  function isReportText(text) {
    if (!text || !text.trim()) return false;
    if (text.length >= REPORT_MIN_CHARS) return true;       // 长度够
    if (/^#{1,3}\s/m.test(text)) return true;               // 含 ## 标题行
    return false;
  }

  /**
   * 从 DeepAgent invoke 结果中提取文本（兼容多种返回格式）。
   *
   * v1.4.3：此前存在三份实现——driver-base 这份是 15 行弱版本（无质量门控），
   *   两个 driver 各存一份强版本但互不知道对方。弱版本虽当时无人调用，却作为
   *   driver-base 的导出符号摆在那里，将来任何 driver 图省事一 import，就是把
   *   run-07 修过的 bug 原样接回来（思考碎片、乃至输入 prompt 全文被当报告写入）。
   *   现收敛为唯一实现，两个 driver 通过 base.extractAgentText 复用。
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
      //    删除后由调用方按 hardBreak 走裸 LLM 抢救或碎片合成降级。
      return '';
    }
    // 最终 fallback——避免 String(object) 产出 "[object Object]"
    if (result && typeof result === 'object') {
      return JSON.stringify(result);
    }
    return String(result ?? '');
  }

  // ── 15. runAuditGate（v1.2.8 功能⑥：FORGE 全 loop 接入 audit）──

  /**
   * 在 FORGE loop 的代码变更步骤后自动跑 sofagent-audit。
   *
   * 流程：
   *   1. B/F 步骤执行完毕后，driver 自动 add 本轮改动文件（显式清单，非 git add -A）并 commit
   *   2. 跑 node engine/audit/dist/index.js --diff HEAD~1..HEAD --silent
   *   3. exit 0 → passed=true（全过）
   *   4. exit 1 → passed=true（有警告，不阻塞）
   *   5. exit 2 → passed=false（有违规，打回重修）
   *   6. 输出写到 runDir/audit-result.md
   *
   * @param {string} runDir - 当前 run 目录
   * @param {string} stepName - 当前步骤名（如 'b-fix', 'f-fix'）
   * @param {number} round - 当前轮次
   * @param {Object} [opts] - 可选参数
   * @param {string} [opts.gitRoot] - git 操作根目录（v1.3.6 交付⑩：worktree 隔离时传副本目录；
   *   缺省 repoRoot = 主仓）。auto-commit / diff 在 gitRoot 上跑，审计二进制仍从主仓加载
   *   （副本不含 node_modules）。
   * @returns {Promise<{passed: boolean, exitCode: number, output: string}>}
   */
  async function runAuditGate(runDir, stepName = 'unknown', round = 1, opts = {}) {
    const auditResultPath = join(runDir, 'audit-result.md');
    // git 操作根：worktree 副本（隔离）或主仓（缺省）
    const gitRoot = opts.gitRoot || repoRoot;

    // 1. auto-commit B/F 的改动
    // 🔴 v1.3.1 P0-2 修复：禁止 `git add -A`——会把队友并行编辑的未提交
    // 规划文档（如 docs/changelog/v1.4/*.md）一起卷进 auto-commit（03a548d5 事故）。
    // 🔴 v1.3.1 P0-2 修复增强（run-03 教训）：原修复用 `git diff --name-only HEAD`
    // 仍会列出所有工作区改动（含队友规划文档），无差别 add 全部。
    // 正确方案：只 commit B/F worker 的代码领域（engine/ + FORGE/src/ + tools/ + SKILL/），
    // 排除 docs/changelog/（PM/队友规划领域）和 .workbuddy/（AI 工作记忆）。
    const commitMsg = `FORGE auto-commit: ${stepName} round-${round}`;
    try {
      const { execSync } = await import('child_process');
      // 只检测代码领域的改动文件（排除规划文档 + AI 工作记忆 + FORGE 产物目录）
      const changedFiles = execSync(
        'git diff --name-only HEAD -- engine/ FORGE/src/ FORGE/LEDGER.md FORGE/lessons/ tools/ SKILL/ install.sh bootstrap.sh 2>/dev/null',
        { cwd: gitRoot, encoding: 'utf-8', timeout: 30_000 },
      ).toString().split('\n').map((s) => s.trim()).filter(Boolean);
      // 未跟踪新文件：只纳入代码领域 + FORGE 产物
      const untrackedFiles = execSync(
        'git ls-files --others --exclude-standard -- engine/ FORGE/src/ FORGE/LEDGER.md FORGE/lessons/ tools/ SKILL/',
        { cwd: gitRoot, encoding: 'utf-8', timeout: 30_000 },
      ).toString().split('\n').map((s) => s.trim()).filter(Boolean);
      const filesToAdd = [...changedFiles, ...untrackedFiles];
      if (filesToAdd.length > 0) {
        execSync(`git add ${filesToAdd.map(quotePath).join(' ')}`, { cwd: gitRoot, encoding: 'utf-8', timeout: 30_000 });
        // 🔴 v1.3.5 修复：裸 `git commit -m` 会提交暂存区里所有已 staged 内容——
        // 会把队友并行编辑时先 `git add` 进暂存区的文件（如 docs/ 规划文档）一起卷进
        // auto-commit（2026-08-16 三次「卷走」事故根因）。改为 `git commit -- <files>`
        // 只提交本轮 filesToAdd 清单内的文件，暂存区里队友的文件保持 staged 原状。
        execSync(`git commit -m "${commitMsg}" -- ${filesToAdd.map(quotePath).join(' ')}`, { cwd: gitRoot, encoding: 'utf-8', timeout: 30_000 });
      }
      // 无代码领域改动时：不执行任何 commit——裸 commit 在 filesToAdd 为空时仍会
      // 提交暂存区里队友已 staged 的文件，必须显式跳过。
    } catch (err) {
      // commit 可能因为 "nothing to commit" 而失败——这是正常的（B/F 可能没改任何东西）
      const msg = String(err.message || '');
      if (!msg.includes('nothing to commit') && !msg.includes('no changes')) {
        // 真正的 commit 失败
        const output = `## Audit Gate — COMMIT FAILED\n\n步骤: ${stepName} round-${round}\n\n错误: ${msg}\n`;
        writeFileSync(auditResultPath, output, 'utf-8');
        return { passed: false, exitCode: -1, output: msg };
      }
    }

    // 2. 跑 sofagent-audit
    // v1.3.6 交付⑩：cwd=gitRoot（worktree 隔离时审副本的 auto-commit；审计二进制
    // 仍从主仓绝对路径加载——副本不含 node_modules，但 node_modules 不影响 audit 独立运行）
    try {
      const { execSync } = await import('child_process');
      const auditCmd = `node ${join(repoRoot, 'engine', 'audit', 'dist', 'index.js')} --diff HEAD~1..HEAD --silent --task "FORGE audit gate: ${stepName} round-${round}"`;
      let auditOutput = '';
      let exitCode = 0;
      try {
        auditOutput = execSync(auditCmd, {
          cwd: gitRoot,
          encoding: 'utf-8',
          timeout: 120_000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (auditErr) {
        exitCode = auditErr.status ?? 1;
        auditOutput = auditErr.stdout || auditErr.stderr || auditErr.message;
      }

      // 3. 判定
      const passed = exitCode <= 1; // 0=全过, 1=有警告（不阻塞）, 2=有违规（阻塞）

      // 4. 写结果
      const statusLabel = exitCode === 0 ? '✅ ALL PASS'
        : exitCode === 1 ? '⚠️ WARNINGS (不阻塞)'
        : '❌ VIOLATIONS (打回重修)';
      const md = [
        `## Audit Gate Result — ${stepName} round-${round}`,
        '',
        `**状态**: ${statusLabel}`,
        `**Exit Code**: ${exitCode}`,
        `**Diff**: HEAD~1..HEAD`,
        '',
        '### 审计输出',
        '',
        '```',
        String(auditOutput).slice(0, 5000),
        '```',
      ].join('\n');
      writeFileSync(auditResultPath, md, 'utf-8');

      return { passed, exitCode, output: String(auditOutput) };
    } catch (err) {
      const output = `## Audit Gate — EXECUTION FAILED\n\n步骤: ${stepName} round-${round}\n\n错误: ${err.message}\n`;
      writeFileSync(auditResultPath, output, 'utf-8');
      return { passed: false, exitCode: -1, output: err.message };
    }
  }

  // ── 16/17. saveResumePoint / loadResumePoint（v1.2.8 功能⑦：断点续跑）──

  /**
   * 写断点文件 resume-point.json 到 runDir（原子写入）。
   *
   * 原子性：先写 resume-point.json.tmp 再 renameSync——rename 在同一文件系统内
   * 是原子操作，进程中途被杀也不会留下半截 JSON（读方要么看到旧版本要么看到新版本）。
   *
   * v1.2.9 功能②：worker 级断点升级。
   * state 格式从 `{ round, completed: boolean }` 升级为：
   *   `{ round, completedWorkers: string[], workers: {...}, counts, ... }`
   *
   *   - completedWorkers: 已完成的 worker id 数组（如 ['a-check-p1', 'b-check-p3']）
   *   - workers: 每个 worker 的状态摘要 { [workerId]: { status, output } }
   *
   * 向后兼容：state 仍然可以包含 `completed: boolean` 字段（release-gate 用它做
   * phase 级 resume），loadResumePoint 会同时兼容两种格式。
   *
   * @param {string} runDir - run 根目录（断点写在 run 根目录，不是轮子目录）
   * @param {Object} state - 状态摘要（只存摘要不存大体积数据——铁律）
   * @returns {string} 断点文件绝对路径
   */
  function saveResumePoint(runDir, state) {
    const resumePath = join(runDir, 'resume-point.json');
    const tmpPath = join(runDir, 'resume-point.json.tmp');
    const payload = { ...state, timestamp: new Date().toISOString() };
    writeFileSync(tmpPath, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
    renameSync(tmpPath, resumePath);
    return resumePath;
  }

  /**
   * 读断点文件 resume-point.json。
   *
   * 容错策略：文件不存在 / JSON 损坏 / 必需字段缺失，一律返回 null（不 throw）——
   * 断点是优化层不是正确性层，坏了就从头跑，绝不能因为断点问题阻断主流程。
   *
   * v1.2.9 功能②：worker 级断点升级。
   *   - 旧格式（v1.2.8）：`{ round, completed: boolean, ... }`
   *   - 新格式（v1.2.9）：`{ round, completedWorkers: string[], workers: {...}, ... }`
   *
   * 向后兼容：旧断点（含 `completed: boolean` 但无 `completedWorkers`）仍然有效——
   * 把 `completed` 字段透传给调用方，调用方用它做轮级 resume 判断。
   *
   * 字段校验优先级：
   *   1. round 必须是 number（必需）
   *   2. completedWorkers 必须是 array（v1.2.9 新格式必需）
   *   3. 如果 completedWorkers 不存在但 completed 存在 → 旧格式，向后兼容
   *
   * @param {string} runDir - run 根目录
   * @returns {Object|null} 断点状态（含 round / completedWorkers / timestamp），无效时返回 null
   */
  function loadResumePoint(runDir) {
    const resumePath = join(runDir, 'resume-point.json');
    if (!existsSync(resumePath)) return null;

    let parsed = null;
    try {
      parsed = JSON.parse(readFileSync(resumePath, 'utf-8'));
    } catch {
      // 文件损坏（写入中途被杀等）——当作无断点处理
      return null;
    }

    // 字段校验：round 必须是 number（必需字段）
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.round !== 'number') return null;

    // v1.2.9 功能②：worker 级断点——completedWorkers 必须是数组（新格式）。
    // 向后兼容：旧格式用 `completed: boolean`，没有 completedWorkers。
    // 旧格式的断点仍然可读（resume 从轮级恢复），只是没有 worker 级跳过能力。
    if (!Array.isArray(parsed.completedWorkers)) {
      // 检查是否是旧格式（有 completed: boolean）——旧格式仍然有效
      if (typeof parsed.completed === 'boolean') {
        // 旧格式兼容：把旧格式的 completed 转换为 completedWorkers 语义
        // completed=true → 所有 worker 都已完成（空数组代表"无需跳过"）
        // completed=false → 没有 worker 完成（返回 null 让调用方重跑该轮）
        // 但旧格式没有 worker 级粒度，无法精确恢复——降级为轮级恢复。
        // 这里直接返回 parsed，调用方通过 completed 字段做轮级判断。
        return parsed;
      }
      // 既没有 completedWorkers 也没有 completed → 无效断点
      return null;
    }

    return parsed;
  }

  // ── 19. setupWorktree / teardownWorktree（v1.3.6 交付⑩：FORGE 隔离加固）──
  //
  // 背景（run-07 死因）：审查 worker 与主仓共享工作目录——红队 worker 在主仓做
  // 模拟恶意 commit（残留 config.js/f.txt），主仓被其他会话重建 git 基线时审查
  // 进程树被环境冲突带走。修复：driver 启动时在 runDir 内 git worktree add 隔离
  // 副本，worker 全在副本上跑——git 怎么折腾不碰主仓。
  //
  // 生命周期挂 driver-base（fresh-eyes + release-gate 双 driver 共享——v1.2.7
  // 镜像漂移教训：修 A 忘 B 是必然的）。

  /**
   * 在 runDir 内创建 git worktree 隔离副本，worker 的 git 写入全部落在该副本的
   * 专属分支上——主仓工作区与主分支历史全程不受影响（run-07 事故根因修复）。
   *
   * 分支模型（支撑 b-fix 回流走 cherry-pick + 人审）：
   *   worktree 检出在分支 `forge/<driverName>/<runId>` 上（非 detached）。
   *   b-fix / 红队 worker 的 commit 全部落在这条分支，teardown 移除 worktree 目录
   *   后分支仍保留在主仓（可达），供人工 cherry-pick / 审阅后合并；主分支不受影响。
   *
   * 幂等：worktree-meta.json 记录已建分支 → resume 直接复用，不重建。
   *
   * @param {string} runDir - run 目录（worktree 挂在 runDir/worktree）
   * @param {Object} [opts] - 可选参数
   * @param {string} [opts.runId] - run 标识（分支名一部分；缺省用时间戳）
   * @param {string} [opts.ref] - 起始 ref（缺省 HEAD = 当前主仓 HEAD）
   * @returns {{ worktreeDir: string, branch: string, baseSha: string, reused: boolean }}
   */
  function setupWorktree(runDir, opts = {}) {
    const worktreeDir = join(runDir, 'worktree');
    const ref = opts.ref || 'HEAD';
    const runId = opts.runId || `${Date.now()}`;
    const branch = `forge/${driverName}/${runId}`;

    // 幂等复用：元数据已记录且目录有效 → 直接返回（resume 场景，不重置分支）
    const metaPath = join(runDir, 'worktree-meta.json');
    if (existsSync(metaPath) && existsSync(worktreeDir)) {
      try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
        execSync('git rev-parse --git-dir', { cwd: worktreeDir, encoding: 'utf-8', timeout: 30_000 });
        return { worktreeDir, branch: meta.branch || branch, baseSha: meta.baseSha || '', reused: true };
      } catch { /* 元数据/目录损坏 → 走清理重建 */ }
    }

    // 清理残留（损坏的旧 worktree / 目录）
    try { execSync(`git worktree remove --force ${quotePath(worktreeDir)}`, { cwd: repoRoot, encoding: 'utf-8', timeout: 60_000 }); } catch { /* 可能本就不存在 */ }
    try { rmSync(worktreeDir, { recursive: true, force: true }); } catch { /* ignore */ }

    // 解析起始 ref 为完整 commit SHA（分支基线记录稳定 SHA，主仓后续 commit 不影响副本）
    let baseSha;
    try {
      baseSha = execSync(`git rev-parse ${quotePath(ref)}`, {
        cwd: repoRoot, encoding: 'utf-8', timeout: 30_000,
      }).toString().trim();
    } catch (err) {
      throw new Error(`setupWorktree：解析起始 ref "${ref}" 失败：${err.message}`);
    }

    // -b 新建分支；若分支已存在（异常残留）用 -B 重置到 baseSha 复用
    const branchExists = (() => {
      try { execSync(`git rev-parse --verify ${quotePath(branch)}`, { cwd: repoRoot, encoding: 'utf-8', timeout: 30_000 }); return true; } catch { return false; }
    })();
    const branchFlag = branchExists ? '-B' : '-b';
    try {
      execSync(`git worktree add ${branchFlag} ${quotePath(branch)} ${quotePath(worktreeDir)} ${quotePath(baseSha)}`, {
        cwd: repoRoot, encoding: 'utf-8', timeout: 120_000,
      });
    } catch (err) {
      throw new Error(`setupWorktree：worktree add 失败：${err.message}`);
    }

    // 磁盘预算：worktree 是 git checkout，天然不含 node_modules（~50MB/run）。
    // 记录元数据供 teardown / resume / 回流审计取证。
    try {
      writeFileSync(metaPath, JSON.stringify({
        worktreeDir, branch, baseSha, createdAt: new Date().toISOString(), driver: driverName,
      }, null, 2), 'utf-8');
    } catch { /* 元数据写失败不阻塞 */ }

    return { worktreeDir, branch, baseSha, reused: false };
  }

  /**
   * 清理 worktree 目录（run 结束——正常/异常/中止都调，放 finally）。
   *
   * 语义：只移除 worktree 工作目录，保留分支 `forge/<driver>/<runId>`——
   * 分支上的 b-fix/红队 commit 留待人工 cherry-pick + 审阅后合并（零信任回流闸门），
   * 不自动并进主分支（主仓历史全程干净）。
   *
   * 幂等 + 容错：任何一步失败都继续，绝不抛错阻塞收尾。
   *
   * @param {string} runDir - run 目录
   * @returns {{ removed: boolean, branch: string|null, detail: string }}
   */
  function teardownWorktree(runDir) {
    const worktreeDir = join(runDir, 'worktree');
    const metaPath = join(runDir, 'worktree-meta.json');
    let branch = null;
    try { branch = JSON.parse(readFileSync(metaPath, 'utf-8')).branch || null; } catch { /* 元数据缺失 */ }

    // v1.4.4 修复（run-20260829-01 教训）：移除 worktree 前先固化分支 tip 到主仓 refs。
    // 根因：worktree 内的 commit（b-fix auto-commit / re-sync merge）只在 worktree 的
    // HEAD 上——git worktree remove 后主仓同名分支 ref 若未随最后 commit 前进，
    // 这些 commit 变悬挂（fsck 才能找回）。run-20260829-01 的 4 轮 b-fix 修复链
    // （4b1337d5→…→1e707628 + re-sync 88cc7c2c）就这样悬空了 8 小时才手工挖掘回收。
    // 修法：remove 前在 worktree 读当前 HEAD，若与主仓分支 ref 不同则
    // git branch -f <branch> <HEAD> 固化（worktree 检出态下不能 checkout 该分支，
    // branch -f 直接写 ref 不受检出限制）。
    if (branch) {
      try {
        const wtHead = execSync('git rev-parse HEAD', { cwd: worktreeDir, encoding: 'utf-8', timeout: 30_000 }).toString().trim();
        let mainRef = '';
        try {
          mainRef = execSync(`git rev-parse ${quotePath(branch)}`, { cwd: repoRoot, encoding: 'utf-8', timeout: 30_000 }).toString().trim();
        } catch { /* 分支 ref 不存在（首 run 未回流过）——直接创建 */ }
        if (wtHead && wtHead !== mainRef) {
          execSync(`git branch -f ${quotePath(branch)} ${wtHead}`, { cwd: repoRoot, encoding: 'utf-8', timeout: 30_000 });
        }
      } catch (fixErr) {
        // 固化失败不阻塞清理（commit 仍在对象库，fsck 可找回）——但必须留下线索
        console.warn(`[teardown] ⚠️ 分支 tip 固化失败（commit 仍可达，可 fsck 找回）: ${fixErr.message}`);
      }
    }

    if (!existsSync(worktreeDir)) {
      return { removed: false, branch, detail: 'worktree 目录不存在（未创建或已清理）' };
    }

    let detail = '';
    // 1. 从主仓移除 worktree 注册（--force 容忍工作区内未提交残留）
    try {
      execSync(`git worktree remove --force ${quotePath(worktreeDir)}`, {
        cwd: repoRoot, encoding: 'utf-8', timeout: 60_000,
      });
      detail += 'worktree remove 成功; ';
    } catch (err) {
      detail += `worktree remove 失败: ${err.message}; 兜底 prune+rm; `;
      try { execSync('git worktree prune', { cwd: repoRoot, encoding: 'utf-8', timeout: 60_000 }); } catch { /* ignore */ }
      try { rmSync(worktreeDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }

    // 2. 元数据保留（供回流审计：分支名 + 基线 SHA 取证用），不删除
    return { removed: true, branch, detail: detail.trim() };
  }

  // ── 20. registerSignalCleanup（v1.3.6 worktree 留存根治：pkill/SIGTERM 路径清理）──
  //
  // 背景（run-03 2026-08-17 事故）：teardownWorktree 只挂在 main() 正常返回 /
  // main().catch() / uncaughtException 路径——人工 pkill（SIGTERM）/ Ctrl-C
  // （SIGINT）杀 driver 时这些路径全部不执行，worktree 目录 + git 注册永久留存
  // （~80MB/run，git worktree list 膨胀）。
  //
  // 修复：注册 SIGTERM/SIGINT handler，收到终止信号时先跑 cleanup 再 exit。
  // 注意：execSync 在收到信号时可能被打断——cleanup 内部已层层 try-catch，
  // 且 git worktree remove 失败有 prune + rmSync 兜底，最坏情况留目录但下次
  // driver 启动时的陈旧扫描（cleanupStaleWorktrees）会收走。
  //
  // 双 driver 共享（镜像漂移教训：修 A 忘 B 是必然的）。

  /**
   * 注册 SIGTERM/SIGINT 信号清理。
   *
   * @param {Object} opts
   * @param {() => void} opts.cleanup - 终止时执行的清理（如 safeTeardownWorktree + latest.json 更新）
   * @param {string} opts.stopReason - 写入 latest.json 的停止原因（如 'aborted-signal'）
   * @param {(code: number) => void} [opts.exitFn] - 退出函数（默认 process.exit；测试注入 noop 防真退出）
   */
  function registerSignalCleanup({ cleanup, stopReason = 'aborted-signal', exitFn = (c) => process.exit(c) }) {
    let fired = false; // 幂等锁：handler 只执行一次（SIGTERM 后可能再收 SIGINT）
    const handler = (sig) => {
      if (fired) return;
      fired = true;
      console.error(`\n⚠️ 收到 ${sig}——执行清理后退出（${stopReason}）`);
      try { cleanup(); } catch (err) { console.error(`   清理失败（不阻塞退出）: ${err.message}`); }
      exitFn(1);
    };
    process.on('SIGTERM', () => handler('SIGTERM'));
    process.on('SIGINT', () => handler('SIGINT'));
    return () => { fired = true; }; // 正常结束时解除信号清理（避免重复 teardown）
  }

  // ── 21. cleanupStaleWorktrees（v1.3.6 worktree 留存根治：陈旧兜底扫描）──
  //
  // 兜底逻辑：信号清理也可能失败（SIGKILL 无法捕获 / cleanup 中途再被打断），
  // driver 启动时扫描 runs 根目录下的陈旧 worktree（超过 maxAgeMs 且心跳停更）
  // 自动收走。判定陈旧的唯一依据 = worktree-meta.json 的 createdAt——元数据与
  // 目录一起由 setupWorktree 创建，比猜 mtime 可靠。
  //
  // 清理动作与 teardownWorktree 相同：移除目录 + git 注册，保留分支（回流闸门）。

  /**
   * 扫描并清理陈旧 worktree。driver 启动时调用（preflight 之后、setupWorktree 之前）。
   *
   * @param {Object} opts
   * @param {string} opts.runsRoot - runs 根目录（如 ~/.sofagent/data/forge-runs/fresh-eyes-loop）
   * @param {string} [opts.excludeRunDir] - 本次 run 目录（跳过，防误删自己）
   * @param {number} [opts.maxAgeMs] - 陈旧阈值，默认 7 天
   * @returns {{ scanned: number, cleaned: number, detail: string[] }}
   */
  function cleanupStaleWorktrees({ runsRoot, excludeRunDir, maxAgeMs = 7 * 24 * 60 * 60 * 1000 }) {
    const detail = [];
    let scanned = 0;
    let cleaned = 0;
    if (!existsSync(runsRoot)) return { scanned, cleaned, detail };
    const cutoff = Date.now() - maxAgeMs;
    // 日期目录 YYYY-MM-DD → 内层 run-NN；worktree-meta.json 位于 runDir/worktree 旁
    const dateDirs = readdirSync(runsRoot, { withFileTypes: true })
      .filter(d => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name));
    for (const d of dateDirs) {
      const runDirs = [];
      try {
        runDirs.push(...readdirSync(join(runsRoot, d.name), { withFileTypes: true })
          .filter(x => x.isDirectory() && x.name.startsWith('run-'))
          .map(x => join(runsRoot, d.name, x.name)));
      } catch { /* ignore */ }
      for (const runDir of runDirs) {
        const worktreeDir = join(runDir, 'worktree');
        if (!existsSync(worktreeDir)) continue; // 已清理 / 从未创建
        scanned++; // 候选计数（含被 exclude 跳过的——scanned 语义 = 扫到的 worktree 总数）
        if (excludeRunDir && resolve(runDir) === resolve(excludeRunDir)) continue;
        const metaPath = join(runDir, 'worktree-meta.json');
        let createdAt = 0;
        try { createdAt = Date.parse(JSON.parse(readFileSync(metaPath, 'utf-8')).createdAt) || 0; } catch { /* 元数据缺失按 0 处理 */ }
        if (createdAt > cutoff) continue; // 未过期
        const r = teardownWorktree(runDir);
        cleaned++;
        detail.push(`${relativeRunDir ? relativeRunDir(runDir) : runDir}: ${r.detail || '已清理'}（分支 ${r.branch ?? '未知'} 保留）`);
      }
    }
    return { scanned, cleaned, detail };
  }

  return {
    // 公共工具函数
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
    sliceMultiOutput,
    runAuditGate,  // v1.2.8 功能⑥
    saveResumePoint,   // v1.2.8 功能⑦
    loadResumePoint,   // v1.2.8 功能⑦
    setupWorktree,     // v1.3.6 交付⑩：FORGE 隔离加固
    teardownWorktree,  // v1.3.6 交付⑩：FORGE 隔离加固
    registerSignalCleanup,     // v1.3.6 worktree 留存根治：SIGTERM/SIGINT 清理
    cleanupStaleWorktrees,     // v1.3.6 worktree 留存根治：陈旧兜底扫描
    // 辅助函数
    extractUsage,
    extractAgentText,
    isReportText,   // v1.4.3：与 extractAgentText 同源，供两个 driver 的 stream loop 复用
    relativeRunDir,
    // 常量
    REPORT_MIN_CHARS,   // v1.4.3：与 isReportText 同源导出，避免阈值在调用侧硬编码漂移
    PROMPTS_DIR,
    AGENTS_DIR,
    RUNS_DIR,
    LEDGER_PATH,
    SOFAGENT_HOME,
    TOOL_OUTPUT_MAX_LINES,
  };
}

// ════════════════════════════════════════════════════════════
// 18. runPreflight — FORGE preflight-check 跑前自检模块
// ════════════════════════════════════════════════════════════
//
// 背景：fresh-eyes-loop / release-gate-loop 单次运行 15-60 分钟、烧真金白银
// 的 API 额度，环境不健康时中途崩溃的代价极高（进度丢失、需要 --resume 抢救）。
// 与其跑到一半崩，不如开跑前 1 分钟内把所有环境前置条件检查一遍。
//
// 六项检查（HALT = 阻塞退出；WARN = 警告继续）：
//   ① cwd 路径存在性     [HALT] 目录不存在/不可读 = git 命令全部崩
//   ② stdout 管道 SIGPIPE [WARN] ⚠️ 设计修正：原 spec 定 HALT，但
//      tools/forge/forge-smoke-test.sh 用 $(node driver --dry-run) 命令替换调用
//      driver，其 stdout 天然是管道——HALT 会打破冒烟测试的 RC=0 契约。
//      故降级 WARN：只提醒"别用 | head"，不阻塞合法管道调用。
//   ③ 模型 API 可达      [HALT] fetch baseURL/models，3s 超时，最多一次
//   ④ 工具预算配置       [HALT] soft <= hard（预算倒挂 = 熔断逻辑失效）
//   ⑤ runDir 可写        [HALT] 允许幂等自动 mkdir（目录非危险项）
//   ⑥ 磁盘空间 >= 200MB  [WARN] fs.statfs（Node 18.15+，低版本自动跳过）
//
// 铁律：
//   - 不自动修复危险项：只报问题 + 给可复制修复命令，人来执行
//   - preflight 自身异常降级 WARN：检查工具坏了绝不阻塞主流程
//   - API 检查最多一次：同 baseURL 去重；key 缺失不探测（避免 401 误判）
//   - worker 模式跳过：子进程环境继承自主 driver，重复检查纯浪费
//   - dry-run 跳过：dry-run 不真跑 worker，环境检查无意义且会打破
//     forge-smoke-test.sh 的 dry-run RC=0 契约

// ════════════════════════════════════════════════════════════
// v1.3.8 交付五 · liveness 探针（模块级导出，两 driver 共用）
// ════════════════════════════════════════════════════════════
//
// 背景：driver 的 LLM 长窗口（单 worker 5-30 分钟）期间 stdout 日志长时间
// 无新行是正常现象——用「日志是否滚动」判活会把活着的长任务误杀。唯一可信
// 的存活信号是 driver 主循环每 15s 刷写的 status.json heartbeat 字段。
//
// 判定协议（只认心跳不认日志）：
//   - status.json 存在且 heartbeat（或 lastUpdate）距今 < 90s → alive（RC=0）
//   - 超 90s / status.json 不存在 / runDir 不存在 → dead（RC=1，附最后事件）
//
// @param {string} runDir  run 根目录（含 status.json）
// @param {Object} [opts]
// @param {number} [opts.thresholdMs=90000]  心跳新鲜度阈值（毫秒）
// @param {Function} [opts.now=Date.now]     时间源（测试可注入）
// @param {Function} [opts.readJson]         读 JSON 文件实现（测试可注入）
// @returns {{ alive: boolean, rc: 0|1, report: string,
//            heartbeatAgeMs: number|null, lastEvent: string|null, phase: string|null }}
export function checkDriverLiveness(runDir, opts = {}) {
  const {
    thresholdMs = 90_000,
    now = () => Date.now(),
    existsImpl = (p) => existsSync(p),
    readJsonImpl = (p) => JSON.parse(readFileSync(p, 'utf-8')),
  } = opts;

  const mk = (alive, lastEvent, phase, heartbeatAgeMs, detail) => ({
    alive,
    rc: alive ? 0 : 1,
    heartbeatAgeMs: heartbeatAgeMs ?? null,
    lastEvent: lastEvent ?? null,
    phase: phase ?? null,
    report: detail,
  });

  if (!runDir || !existsImpl(runDir)) {
    return mk(false, null, null, null,
      `dead\n  runDir 不存在: ${runDir || '(空)'}`);
  }

  const statusPath = join(runDir, 'status.json');
  if (!existsImpl(statusPath)) {
    // status.json 还没生成——driver 可能刚启动（run-start 之前）也可能已死。
    // 保守判 dead：刚启动的 driver 秒级内就会 emit RUN_START 写出 status.json，
    // 监控端下轮重查即可；误报窗口 < 5s，远小于误杀长任务的风险。
    return mk(false, null, null, null,
      `dead\n  status.json 不存在（driver 从未启动或 runDir 非法）: ${statusPath}`);
  }

  let status;
  try {
    status = readJsonImpl(statusPath);
  } catch (err) {
    return mk(false, null, null, null,
      `dead\n  status.json 解析失败: ${err.message}`);
  }

  // 心跳时间戳：heartbeat 优先，lastUpdate 兜底（emit 时两者同值）
  const tsRaw = status.heartbeat || status.lastUpdate;
  const ts = tsRaw ? Date.parse(tsRaw) : NaN;
  if (!Number.isFinite(ts)) {
    return mk(false, status.event ?? null, status.phase ?? null, null,
      `dead\n  status.json 无有效心跳字段（heartbeat/lastUpdate 均缺失或非法）`);
  }

  const ageMs = now() - ts;
  if (ageMs < thresholdMs) {
    return mk(true, status.event ?? null, status.phase ?? null, ageMs,
      `alive\n  heartbeat ${Math.round(ageMs / 1000)}s 前（阈值 ${Math.round(thresholdMs / 1000)}s）  phase=${status.phase ?? '?'}  event=${status.event ?? '?'}`);
  }
  return mk(false, status.event ?? null, status.phase ?? null, ageMs,
    `dead\n  heartbeat ${Math.round(ageMs / 1000)}s 未更新（阈值 ${Math.round(thresholdMs / 1000)}s）  最后 event=${status.event ?? '?'}  phase=${status.phase ?? '?'}`);
}


/** 磁盘空间最低阈值（200MB——一轮 run 产物 < 10MB，留足余量即可） */
export const PREFLIGHT_MIN_DISK_MB = 200;

/** API 探测超时（3 秒——网络正常时 < 500ms，3s 足够判"不可达"） */
export const PREFLIGHT_API_TIMEOUT_MS = 3000;

/**
 * 单项检查结果的构造器（内部使用）。
 * level: 'HALT' | 'WARN'；detail: 问题详情；fix: 可复制的修复命令（无则空）。
 */
function makeCheck(id, label, level, status, detail = '', fix = '') {
  return { id, label, level, status, detail, fix };
}

/**
 * FORGE driver 跑前自检。
 *
 * @param {Object} config
 * @param {string} config.repoRoot - 仓库根目录（检查存在性/可读性）
 * @param {string|null} [config.runDir] - run 目录（允许幂等 mkdir；不传跳过）
 * @param {Object} [config.modelConfigs] - MODEL_CONFIGS（含 baseURL/apiKeyEnv）
 * @param {string[]} [config.roles] - 需要探测 API 的角色子集（默认全部）
 * @param {string} [config.loopName] - loop 名（报告标题用）
 * @param {Object} [config.toolConfig] - { globalSoft, globalHard, perspectiveSoft, perspectiveHard }
 * @param {Object} [config.__inject] - 测试注入点（{ fetchImpl, statfsImpl,
 *   statSyncImpl, fstatSyncImpl, mkdirSyncImpl, writeFileSyncImpl, unlinkSyncImpl }）
 * @returns {Promise<{shouldHalt: boolean, passed: boolean, warnings: Object[],
 *   failures: Object[], checks: Object[]}>}
 *   - shouldHalt: 存在任一 HALT 级失败时为 true（调用方应 exit(1)）
 *   - passed: 无任何失败（含 WARN）时为 true
 *   - failures: HALT 级失败项；warnings: WARN 级失败项；checks: 全部检查结果
 */
export async function runPreflight(config = {}) {
  const {
    repoRoot,
    runDir = null,
    modelConfigs = {},
    roles = null,
    loopName = 'FORGE',
    toolConfig = {},
    __inject = {},
  } = config;

  const checks = [];   // 全部检查结果（PASS + FAIL）
  const failures = []; // HALT 级失败
  const warnings = []; // WARN 级失败

  // 记录单项结果；FAIL 时按级别归类
  function record(check) {
    checks.push(check);
    if (check.status === 'FAIL') {
      if (check.level === 'HALT') failures.push(check);
      else warnings.push(check);
    }
  }

  // ── ① cwd / repoRoot 路径存在性 [HALT] ──────────────────
  try {
    const statSync = __inject.statSyncImpl || statSyncReal;
    const st = statSync(repoRoot);
    if (!st.isDirectory()) {
      record(makeCheck('cwd', 'repoRoot 路径', 'HALT', 'FAIL',
        `${repoRoot} 不是目录`,
        `cd 到正确的仓库根目录后重试`));
    } else {
      // 可读性：读 .git 目录存在性顺带验证（git 命令依赖它）
      const gitDir = join(repoRoot, '.git');
      let gitExists = false;
      try { gitExists = statSync(gitDir) != null; } catch { gitExists = false; }
      if (gitExists) {
        record(makeCheck('cwd', 'repoRoot 路径', 'HALT', 'PASS', repoRoot));
      } else {
        // .git 缺失不致命（worktree 场景是文件），降为提醒性 PASS 详情
        record(makeCheck('cwd', 'repoRoot 路径', 'HALT', 'PASS',
          `${repoRoot}（未检测到 .git，若为 worktree 属正常）`));
      }
    }
  } catch (err) {
    record(makeCheck('cwd', 'repoRoot 路径', 'HALT', 'FAIL',
      `${repoRoot} 不存在或不可读（${err.code || err.message}）`,
      `cd 到正确的仓库根目录后重试`));
  }

  // ── ② stdout 管道 / SIGPIPE 风险 [WARN]（设计修正，见文件头注释）──
  try {
    const fstatSync = __inject.fstatSyncImpl || fstatSyncReal;
    const st = fstatSync(1); // fd 1 = stdout
    if (st.isFIFO()) {
      record(makeCheck('stdout', 'stdout 管道', 'WARN', 'FAIL',
        'stdout 是管道（被重定向/管道连接）——下游 | head -N 类截断会触发 SIGPIPE 杀死 driver',
        '改用终端直跑，或重定向到文件：node FORGE/src/<driver>.mjs --target vX.Y.Z > run.log 2>&1'));
    } else {
      record(makeCheck('stdout', 'stdout 管道', 'WARN', 'PASS', '终端直连'));
    }
  } catch {
    // fstatSync(1) 失败极罕见——不阻塞，记 PASS 放行
    record(makeCheck('stdout', 'stdout 管道', 'WARN', 'PASS', '无法检测（跳过）'));
  }

  // ── ③ 模型 API 可达 + 额度 [HALT]（连通同 baseURL 探一次；额度按 baseURL+key 组合探一次）──
  const fetchImpl = __inject.fetchImpl || globalThis.fetch;
  if (modelConfigs && Object.keys(modelConfigs).length > 0 && fetchImpl) {
    const targetRoles = roles || Object.keys(modelConfigs);
    const probed = new Map();    // baseURL -> ok(boolean)——连通缓存
    const quotaProbed = new Map(); // `baseURL|key尾8` -> {ok, reason}——额度缓存（429 按 key/账号）
    for (const role of targetRoles) {
      const cfg = modelConfigs[role];
      if (!cfg || !cfg.baseURL) continue;
      // key 缺失不探测：driver main() 已有 missingEnvs 检查负责拦截，
      // 无 key 探测必然 401，preflight 不应重复报错造成误导
      if (cfg.apiKeyEnv && !process.env[cfg.apiKeyEnv]) continue;

      let ok = probed.get(cfg.baseURL);
      if (ok === undefined) {
        ok = await probeApi(fetchImpl, cfg.baseURL);
        probed.set(cfg.baseURL, ok);
      }
      if (ok) {
        // 额度探测（run-03 教训）：连通 ≠ 额度可用——429 拦截在 chat 层，
        // /models 不查额度。仅明确 429 才 HALT（fail-open），防 30-60 分钟白跑。
        // 变量名用 bearerKey（非 apiKey*）——A2 赋值形态保守正则对 `apiKey =` +
        // 8 位以上右侧值误报（此处是运行时读 env 传参，非硬编码密钥）
        const bearerKey = cfg.apiKeyEnv ? process.env[cfg.apiKeyEnv || ''] : '';
        if (cfg.model && bearerKey) {
          const quotaKey = `${cfg.baseURL}|${bearerKey.slice(-8)}`;
          let quota = quotaProbed.get(quotaKey);
          if (quota === undefined) {
            quota = await probeQuota(fetchImpl, cfg.baseURL, cfg.model, bearerKey);
            quotaProbed.set(quotaKey, quota);
          }
          if (!quota.ok) {
            record(makeCheck('api', `API 额度 [${role}]`, 'HALT', 'FAIL', quota.reason,
              '等额度刷新窗口后重跑；或改 FORGE/models/profile.mjs 切备用模型/端点'));
            continue;
          }
          record(makeCheck('api', `API 可达 [${role}]`, 'HALT', 'PASS', `${cfg.baseURL}（连通 + 额度可用）`));
        } else {
          record(makeCheck('api', `API 可达 [${role}]`, 'HALT', 'PASS', cfg.baseURL));
        }
      } else {
        record(makeCheck('api', `API 可达 [${role}]`, 'HALT', 'FAIL',
          `${cfg.baseURL} 不可达（超时 ${PREFLIGHT_API_TIMEOUT_MS}ms 或网络错误）`,
          `curl -s -o /dev/null -w '%{http_code}' ${cfg.baseURL}/models -H 'Authorization: Bearer $KEY'  # 先自查网络`));
      }
    }
  }

  // ── ④ 工具预算配置合理性 [HALT]（soft <= hard，否则熔断逻辑失效）──
  const pairs = [];
  if (toolConfig.globalSoft != null && toolConfig.globalHard != null) {
    pairs.push(['全局', toolConfig.globalSoft, toolConfig.globalHard]);
  }
  if (toolConfig.perspectiveSoft != null && toolConfig.perspectiveHard != null) {
    pairs.push(['perspective', toolConfig.perspectiveSoft, toolConfig.perspectiveHard]);
  }
  if (pairs.length === 0) {
    record(makeCheck('budget', '工具预算配置', 'HALT', 'PASS', '未传入（跳过）'));
  } else {
    let budgetOk = true;
    const badParts = [];
    for (const [name, soft, hard] of pairs) {
      const s = Number(soft); const h = Number(hard);
      if (!Number.isFinite(s) || !Number.isFinite(h) || s <= 0 || h <= 0) {
        budgetOk = false; badParts.push(`${name}: 预算必须是正数（实际 soft=${soft} hard=${hard}）`);
      } else if (s > h) {
        budgetOk = false; badParts.push(`${name}: soft(${s}) > hard(${h})，软熔断将先于硬熔断失效`);
      }
    }
    if (budgetOk) {
      record(makeCheck('budget', '工具预算配置', 'HALT', 'PASS',
        pairs.map(([n, s, h]) => `${n} ${s}/${h}`).join(' · ')));
    } else {
      record(makeCheck('budget', '工具预算配置', 'HALT', 'FAIL',
        badParts.join('；'),
        '修正 driver 顶部 TOOL_SOFT_LIMIT / TOOL_HARD_LIMIT 常量（soft 必须 ≤ hard）'));
    }
  }

  // ── ⑤ runDir 可写 [HALT]（幂等自动 mkdir——目录是安全项，允许自动创建）──
  if (runDir) {
    try {
      const mkdirSyncImpl = __inject.mkdirSyncImpl || mkdirSync;
      const writeFileSyncImpl = __inject.writeFileSyncImpl || writeFileSync;
      const unlinkSyncImpl = __inject.unlinkSyncImpl || unlinkSync;
      mkdirSyncImpl(runDir, { recursive: true }); // 幂等：已存在不报错
      const probeFile = join(runDir, '.preflight-probe');
      writeFileSyncImpl(probeFile, '1');
      try { unlinkSyncImpl(probeFile); } catch { /* 清理失败不影响判定 */ }
      record(makeCheck('rundir', 'runDir 可写', 'HALT', 'PASS', runDir));
    } catch (err) {
      record(makeCheck('rundir', 'runDir 可写', 'HALT', 'FAIL',
        `${runDir} 无法创建或不可写（${err.code || err.message}）`,
        `mkdir -p ${runDir} && chmod u+w ${runDir}`));
    }
  } else {
    record(makeCheck('rundir', 'runDir 可写', 'HALT', 'PASS', '未传入（跳过）'));
  }

  // ── ⑥ 磁盘空间 [WARN]（fs.statfs Node 18.15+；低版本自动跳过）──
  try {
    // 注入语义：显式传 statfsImpl（含 null）优先，未传用真实实现。
    // null = 模拟低版本 Node 无 statfs 的跳过分支（测试用）。
    const statfsImpl = ('statfsImpl' in __inject) ? __inject.statfsImpl : statfsReal;
    if (!statfsImpl) {
      record(makeCheck('disk', '磁盘空间', 'WARN', 'PASS', '当前 Node 版本不支持 statfs（跳过）'));
    } else {
      const usage = await statfsImpl(repoRoot || '.');
      const freeMb = Math.floor((usage.bavail * usage.bsize) / (1024 * 1024));
      if (freeMb < PREFLIGHT_MIN_DISK_MB) {
        record(makeCheck('disk', '磁盘空间', 'WARN', 'FAIL',
          `剩余 ${freeMb}MB < ${PREFLIGHT_MIN_DISK_MB}MB`,
          'df -h .  # 查看磁盘占用，清理后重试'));
      } else {
        record(makeCheck('disk', '磁盘空间', 'WARN', 'PASS', `剩余 ${freeMb}MB`));
      }
    }
  } catch (err) {
    // statfs 失败（如平台不支持）——降级跳过，不阻塞
    record(makeCheck('disk', '磁盘空间', 'WARN', 'PASS', `检测失败跳过（${err.code || err.message}）`));
  }

  return {
    shouldHalt: failures.length > 0,
    passed: failures.length === 0 && warnings.length === 0,
    failures,
    warnings,
    checks,
    loopName,
  };
}

/**
 * API 可达性探测（最多一次调用，3s 超时）。
 * GET {baseURL}/models——OpenAI 兼容端点通用；401/403 也算"可达"
 * （能拿到 HTTP 响应说明网络通，鉴权问题由 driver 的 missingEnvs 检查负责）。
 *
 * @param {Function} fetchImpl - fetch 实现（测试可注入）
 * @param {string} baseURL - API base URL
 * @returns {Promise<boolean>} true = 可达
 */
async function probeApi(fetchImpl, baseURL) {
  try {
    const res = await fetchImpl(`${baseURL.replace(/\/+$/, '')}/models`, {
      method: 'GET',
      signal: AbortSignal.timeout(PREFLIGHT_API_TIMEOUT_MS),
    });
    return typeof res.status === 'number'; // 拿到任何 HTTP 状态码都算可达
  } catch {
    return false; // 超时 / DNS 失败 / 连接拒绝
  }
}

/**
 * 额度探测（fail-open——仅明确 429 才 FAIL）。
 *
 * 背景：连通 ≠ 额度可用。GLM 7 天滚动上限 429 的拦截在 chat/completions 层，
 * /models 端点不查额度——preflight 连通全绿、启动后首个 worker 调用即 429
 * 全灭，30-60 分钟白跑（run-03 实证）。极小 chat 请求（max_tokens=1）探额度：
 *   - 明确 429 → { ok: false }，从响应体提取刷新时间（「HH:MM:SS 后可继续」）
 *   - 其余任何形态（401/404/5xx/网络/超时）→ { ok: true }——key 有效性归
 *     driver main 的 missingEnvs 检查、连通性归 probeApi，此处不重复不误伤
 *
 * @param {Function} fetchImpl 可注入的 fetch
 * @param {string} baseURL API 根地址
 * @param {string} model 模型名（探测请求体必填——用真实 profile 模型防 404 误判）
 * @param {string} apiKey API key（Bearer）
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
async function probeQuota(fetchImpl, baseURL, model, apiKey) {
  try {
    const res = await fetchImpl(`${baseURL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
      signal: AbortSignal.timeout(PREFLIGHT_API_TIMEOUT_MS),
    });
    if (res.status === 429) {
      const text = await res.text().catch(() => '');
      // 提取「HH:MM:SS 后可继续」形态的刷新时间（GLM 429 响应体惯例）
      const m = text.match(/([01]?\d|2[0-3]):[0-5]\d:[0-5]\d/);
      return { ok: false, reason: m ? `额度耗尽（429），${m[0]} 后重试` : '额度耗尽（429——7 天滚动上限类）' };
    }
    return { ok: true };
  } catch {
    return { ok: true }; // 探测自身异常不阻塞——fail-open
  }
}

/**
 * 格式化 preflight 结果为终端输出文本。
 *
 * @param {Object} result - runPreflight 的返回值
 * @returns {string} 可直接 console.log 的多行文本
 */
export function formatPreflightReport(result) {
  const lines = [];
  lines.push(`🔍 preflight-check · ${result.loopName || 'FORGE'} 跑前自检`);
  for (const c of result.checks) {
    const icon = c.status === 'PASS' ? '✅' : (c.level === 'HALT' ? '❌' : '⚠️');
    let line = `  ${icon} [${c.level}] ${c.label}`;
    if (c.status === 'FAIL') line += `：${c.detail}`;
    lines.push(line);
    if (c.status === 'FAIL' && c.fix) {
      lines.push(`     修复建议：${c.fix}`);
    }
  }
  if (result.shouldHalt) {
    lines.push(`❌ preflight 未通过（${result.failures.length} 项 HALT）——请修复后重跑`);
  } else if (result.warnings.length > 0) {
    lines.push(`⚠️ preflight 通过（${result.warnings.length} 项警告，继续执行）`);
  } else {
    lines.push(`✅ preflight 全部通过（${result.checks.length} 项）`);
  }
  return lines.join('\n');
}

// ============================================================
// resolveMaxConcurrency · v1.3.7 ⑦ 自适应并发（模块级导出）
//
// 三级来源解析（优先级从高到低，后写者胜）：
//   1. 显式设置——--max-concurrency CLI 参数 与 env FORGE_MAX_CONCURRENCY
//      （CLI 后判定，后写者胜——用户显式意志，直接用不覆盖）
//   2. 自适应探测——未显式设置时 driver 启动读 os.totalmem()，按预算表取值
//   3. 兜底——探测失败 → 1（最保守）
//
// 自适应预算表（按每 worker --max-old-space-size=1024 的 1GB heap 上限 +
// 运行时峰值余量推导，为 OS + 系统进程留 ≥4GB 余量；heap 上限已由 v1.3.5
// 从 2048 降至 1024，若回调 2048 需重推本表）：
//   < 12GB（含 8GB）  → 1   （1GB×1 + 4GB 余量 = 5GB ≤ 8GB；并发 2 峰值叠加
//                             仍有 OOM 风险（run-12 死法），保守取 1）
//   12-23GB           → 2   （1GB×2 + 4GB = 6GB，12GB 机器留足峰值余量）
//   24-47GB           → 4   （1GB×4 + 4GB = 8GB，24GB 机器安全）
//   ≥ 48GB            → 6   （上限 6——更高并发撞 GLM API 速率限制，瓶颈从
//                             内存转移到 API 配额，单点等待抵消并行收益）
// ============================================================

/** 自适应预算表（单位 GB → 推荐并发）。导出供单测直接对表。 */
export const CONCURRENCY_BUDGET_TABLE = [
  { minMemGb: 0,  maxMemGb: 12, concurrency: 1 },  // <12GB（含 8GB）
  { minMemGb: 12, maxMemGb: 24, concurrency: 2 },  // 12-23GB
  { minMemGb: 24, maxMemGb: 48, concurrency: 4 },  // 24-47GB
  { minMemGb: 48, maxMemGb: Infinity, concurrency: 6 }, // ≥48GB
];

/**
 * 按物理内存查预算表取推荐并发。
 * @param {number} totalMemBytes - os.totalmem() 返回的字节数
 * @returns {number} 推荐并发数
 */
export function concurrencyFromMemory(totalMemBytes) {
  const gb = totalMemBytes / (1024 ** 3);
  for (const row of CONCURRENCY_BUDGET_TABLE) {
    if (gb >= row.minMemGb && gb < row.maxMemGb) return row.concurrency;
  }
  return 1; // 不可达防御（表已覆盖 0..∞），兜底最保守
}

/**
 * 解析 FORGE driver 的 worker 并发上限（三级来源）。
 *
 * @param {Object} [options]
 * @param {string} [options.cliFlag] - --max-concurrency CLI 参数值（已由 driver 解析）
 * @param {number} [options.defaultConcurrency] - 显式缺省且探测失败时的兜底值（默认 1）
 * @param {Function} [options.totalmem] - 注入的内存探测函数（默认 os.totalmem，单测可 mock）
 * @param {boolean} [options.quiet] - 不打印推导日志（默认 false）
 * @returns {{ concurrency: number, source: 'cli'|'env'|'adaptive'|'fallback', memGb: number|null }}
 */
export function resolveMaxConcurrency(options = {}) {
  const { cliFlag, defaultConcurrency = 1, totalmem = () => os.totalmem(), quiet = false } = options;

  // 1️⃣ 显式 CLI 参数（后写者胜——在 env 之后判定，CLI 优先于 env）
  if (cliFlag !== undefined && cliFlag !== null && String(cliFlag).trim() !== '') {
    const n = parseInt(String(cliFlag), 10);
    if (Number.isFinite(n) && n >= 1) {
      if (!quiet) console.log(`[并发] 显式 CLI --max-concurrency=${n}（用户指定，直接生效）`);
      return { concurrency: n, source: 'cli', memGb: null };
    }
    if (!quiet) console.warn(`[并发] ⚠️ --max-concurrency="${cliFlag}" 不是合法正整数，忽略`);
  }

  // 2️⃣ 显式环境变量
  const envRaw = process.env.FORGE_MAX_CONCURRENCY;
  if (envRaw !== undefined && envRaw !== null && envRaw.trim() !== '') {
    const n = parseInt(envRaw, 10);
    if (Number.isFinite(n) && n >= 1) {
      if (!quiet) console.log(`[并发] 显式 FORGE_MAX_CONCURRENCY=${n}（用户指定，直接生效）`);
      return { concurrency: n, source: 'env', memGb: null };
    }
    if (!quiet) console.warn(`[并发] ⚠️ FORGE_MAX_CONCURRENCY="${envRaw}" 不是合法正整数，忽略`);
  }

  // 3️⃣ 自适应探测（os.totalmem → 预算表）
  try {
    const totalBytes = totalmem();
    if (Number.isFinite(totalBytes) && totalBytes > 0) {
      const gb = totalBytes / (1024 ** 3);
      const n = concurrencyFromMemory(totalBytes);
      if (!quiet) console.log(`[并发] 自适应: 物理内存 ${gb.toFixed(0)} GB → ${n}`);
      return { concurrency: n, source: 'adaptive', memGb: gb };
    }
    throw new Error(`totalmem() 返回非法值: ${totalBytes}`);
  } catch (err) {
    // 4️⃣ 探测失败 → 兜底最保守
    if (!quiet) console.warn(`[并发] ⚠️ 内存探测失败（${err.message}），回退并发=${defaultConcurrency}`);
    return { concurrency: defaultConcurrency, source: 'fallback', memGb: null };
  }
}

/**
 * OOM 熔断降级器 · v1.3.7 ⑦ 运行时保险丝。
 *
 * driver 捕获 worker 非正常退出（signal=SIGKILL 且 code=null，OOM 典型特征）后
 * 调用本降级器决定后续批次的并发策略：
 *   - 首次降级：该批次剩余 worker 改串行（并发=1），记 degraded-concurrency 事件
 *   - 连续 2 个批次触发降级：并发持续 1 并继续（不中止 run，只降速）——「宁可慢，不猝死」
 *
 * @param {number} [initialConcurrency] - 初始并发
 * @returns {Object} { onBatchResult, getState, report }
 */
export function createConcurrencyDegrader(initialConcurrency = 2) {
  let current = Math.max(1, initialConcurrency);
  let degradedBatches = 0;      // 连续降级批次数（健康批次清零）
  let lastBatchDegraded = false;
  const events = [];            // degraded-concurrency 事件留痕

  function onBatchResult(batchHadSigkill) {
    if (batchHadSigkill) {
      degradedBatches += 1;
      lastBatchDegraded = true;
      const prev = current;
      current = 1; // 无论首次还是连续，降级后并发都是 1（串行）
      const event = {
        type: 'degraded-concurrency',
        ts: new Date().toISOString(),
        consecutiveDegradedBatches: degradedBatches,
        from: prev,
        to: current,
        reason: 'worker SIGKILL (code=null) — OOM 典型特征',
        permanent: degradedBatches >= 2,
      };
      events.push(event);
      return event;
    }
    // 批次全部健康 → 连续计数清零（非连续不算「连续 2 批次」）
    degradedBatches = 0;
    lastBatchDegraded = false;
    return null;
  }

  return {
    onBatchResult,
    getState: () => ({ concurrency: current, degradedBatches, lastBatchDegraded, events: [...events] }),
    /** 生成 degraded-concurrency 事件留痕行（driver 写入 LEDGER / run 日志） */
    report: () => events.map(e =>
      `degraded-concurrency | ${e.ts} | 连续第 ${e.consecutiveDegradedBatches} 批 | 并发 ${e.from}→${e.to} | ${e.reason}${e.permanent ? ' | 已持续回退 1' : ' | 本批次串行'}`
    ),
  };
}
