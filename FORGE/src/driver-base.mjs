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
  appendFileSync, readdirSync, renameSync,
} from 'fs';
import { join, resolve, dirname, relative, sep } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

import { createVisibility, EVENTS } from './visibility.mjs';
import { createProgressMiddleware } from './progress-middleware.mjs';
// v1.2.8 功能③：统一工具输出截断中间件（替代下方内联实现）
import { truncateToolOutput as truncateToolOutputUnified, createToolOutputBudget, DEFAULT_BUDGET as TOOL_OUTPUT_DEFAULT } from './tool-output-budget.mjs';

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
   *   1. B/F 步骤执行完毕后，driver 自动 git add -A && git commit
   *   2. 跑 node engine/audit/dist/index.js --diff HEAD~1..HEAD --silent
   *   3. exit 0 → passed=true（全过）
   *   4. exit 1 → passed=true（有警告，不阻塞）
   *   5. exit 2 → passed=false（有违规，打回重修）
   *   6. 输出写到 runDir/audit-result.md
   *
   * @param {string} runDir - 当前 run 目录
   * @param {string} stepName - 当前步骤名（如 'b-fix', 'f-fix'）
   * @param {number} round - 当前轮次
   * @returns {Promise<{passed: boolean, exitCode: number, output: string}>}
   */
  async function runAuditGate(runDir, stepName = 'unknown', round = 1) {
    const auditResultPath = join(runDir, 'audit-result.md');

    // 1. auto-commit B/F 的改动
    const commitMsg = `FORGE auto-commit: ${stepName} round-${round}`;
    try {
      const { execSync } = await import('child_process');
      execSync('git add -A', { cwd: repoRoot, encoding: 'utf-8', timeout: 30_000 });
      execSync(`git commit -m "${commitMsg}"`, { cwd: repoRoot, encoding: 'utf-8', timeout: 30_000 });
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
    try {
      const { execSync } = await import('child_process');
      const auditCmd = `node ${join(repoRoot, 'engine', 'audit', 'dist', 'index.js')} --diff HEAD~1..HEAD --silent --task "FORGE audit gate: ${stepName} round-${round}"`;
      let auditOutput = '';
      let exitCode = 0;
      try {
        auditOutput = execSync(auditCmd, {
          cwd: repoRoot,
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
   * @param {string} runDir - run 根目录
   * @returns {Object|null} 断点状态（含 round / completed / timestamp），无效时返回 null
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

    // 字段校验：round 必须是 number，completed 必须是 boolean
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.round !== 'number') return null;
    if (typeof parsed.completed !== 'boolean') return null;
    return parsed;
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
