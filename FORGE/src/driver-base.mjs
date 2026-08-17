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
//      tools/forge-smoke-test.sh 用 $(node driver --dry-run) 命令替换调用
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

  // ── ③ 模型 API 可达 [HALT]（同 baseURL 只探测一次，3s 超时）──
  const fetchImpl = __inject.fetchImpl || globalThis.fetch;
  if (modelConfigs && Object.keys(modelConfigs).length > 0 && fetchImpl) {
    const targetRoles = roles || Object.keys(modelConfigs);
    const probed = new Map(); // baseURL -> ok(boolean)
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
        record(makeCheck('api', `API 可达 [${role}]`, 'HALT', 'PASS', cfg.baseURL));
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
