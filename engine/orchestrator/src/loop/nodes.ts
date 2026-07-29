// ============================================================
// loop/nodes.ts · LOOP StateGraph 节点实现
// v1.2.0 新增：engineer / audit / reviewer / human_confirm 四节点
// v1.2.0 升级：工具注入路径 + maxTurns + WARN 写入 history + 三态全记录
//
// 设计：
// - 节点通过 LoopGraphDeps 依赖注入——默认实现走 launcher.ts 的
//   Sub Agent 启动机制（engineer/reviewer）+ @sofagent/audit 程序化
//   调用（audit）+ stdin readline（human_confirm）；测试注入 mock
// - 节点间数据只通过 state.artifacts 流转，不依赖外部全局变量
// - 重试语义（统一计数）：audit FAIL 或 HITL 驳回都递增 retryCount；
//   retryCount < maxRetries(3) → 回 engineer 重试；
//   已达上限仍未过 → finalStatus='blocked' 终态 + 写入 audit history
// ============================================================

import { execSync } from 'child_process';
import { createInterface } from 'readline';
import { ENGINEER_AGENT, REVIEWER_AGENT } from '../builtin-agents';
import { spawnSubAgent } from '../launcher';
import { ENGINEER_TOOLS, REVIEWER_TOOLS, createToolGate, wrapToolsWithGate, convertToLangGraphTools, type ExecutableTool } from '../tools';
import { buildConstrainedSystemPrompt } from '@sofagent/harness';
import { loadConfig, loadEnvConfig } from '@sofagent/core';
import type { AuditHistoryEntry } from '@sofagent/audit';
import type { AuditVerdict, LoopArtifacts, LoopGraphState } from './state';
import type { FileCheckpointer } from '../graph/checkpoint';
import { HITL_OPTIONS, shouldUseAsyncHITL, writeHITLRequest } from '../hitl';
import { ModelRouter } from '../model-router';
import { DataSovereigntyMiddleware } from '../middleware/data-sovereignty-mw';
import { ProgressMiddleware } from '../middleware/progress-mw';
import { writeGraphState } from './plan-node';
import { engineerDecide, defaultDecideCallLLM } from './engineer-decide';
import { engineerExecute } from './engineer-execute';

/** 重试上限：第 3 轮重试后仍未过 → blocked 终态 */
export const DEFAULT_MAX_RETRIES = 3;

/** Agent 最大轮次默认值（v1.1.4 硬编码 20 → v1.1.5 可配置）
 * 配置位置：.sofagent/config.yml 的 loop.maxTurns.{engineer,reviewer}
 * config 不存在 → fallback 到此处默认值 */
export const DEFAULT_ENGINEER_MAX_TURNS = 20;
export const DEFAULT_REVIEWER_MAX_TURNS = 15;

/**
 * v1.1.5: 按角色解析 maxTurns
 * 优先级：config.yml loop.maxTurns.{role} > 默认值
 * @param role 'engineer' | 'reviewer'
 * @param cwd 项目根目录（用于定位 .sofagent/config.yml）
 */
export function resolveMaxTurns(role: 'engineer' | 'reviewer', cwd?: string): number {
  const fallback = role === 'engineer' ? DEFAULT_ENGINEER_MAX_TURNS : DEFAULT_REVIEWER_MAX_TURNS;
  try {
    const config = loadConfig(cwd, false);
    const roleMax = config.loop?.maxTurns?.[role];
    if (typeof roleMax === 'number' && roleMax > 0) {
      return roleMax;
    }
    return fallback;
  } catch (err) {
    console.warn('[sofagent] loadConfig 解析 maxTurns 失败，使用默认值:', err instanceof Error ? err.message : String(err));
    return fallback;
  }
}

// ════════════════════════════════════════
// LLM Provider 解析（v1.1.4 · v1.1.5 通用化）
// 通过 SOFAGENT_LLM=provider:modelName 指定模型。
//
// 支持两种 provider：
//   1. 预置 provider: glm / kimi / deepseek（走 OpenAI 兼容 API）
//   2. custom: 任意 OpenAI 兼容 API
//      SOFAGENT_LLM=custom:<模型名>
//      SOFAGENT_LLM_BASE_URL=https://your-endpoint/v1/
//      SOFAGENT_LLM_API_KEY=sk-xxx
//
// API key 优先级（按角色解析）：
//   SOFAGENT_LLM_{ROLE}_API_KEY > SOFAGENT_LLM_API_KEY > OPENAI_API_KEY（兜底）
//   例：engineer 用 SOFAGENT_LLM_ENGINEER_API_KEY；reviewer 用 SOFAGENT_LLM_REVIEWER_API_KEY
//   如果没设角色 key，退到通用 SOFAGENT_LLM_API_KEY；再退到 OPENAI_API_KEY
//
// 未设置 SOFAGENT_LLM → 返回 null → 降级到 spawnSubAgent [降级运行]。
// ════════════════════════════════════════

interface LLMProviderConfig {
  baseURL: string;
  defaultModel: string;
}

const LLM_PROVIDERS: Record<string, LLMProviderConfig> = {
  glm:      { baseURL: 'https://open.bigmodel.cn/api/paas/v4/', defaultModel: 'glm-4-flash' },
  kimi:     { baseURL: 'https://api.moonshot.cn/v1/',         defaultModel: 'moonshot-v1-8k' },
  deepseek: { baseURL: 'https://api.deepseek.com/v1/',         defaultModel: 'deepseek-chat' },
};

/**
 * 按角色解析 API key（v1.1.5）。
 * 三级回退：SOFAGENT_LLM_{ROLE}_API_KEY > SOFAGENT_LLM_API_KEY > OPENAI_API_KEY
 */
function resolveApiKey(role: 'engineer' | 'reviewer' | null = null): string | undefined {
  if (role) {
    const roleKey = process.env[`SOFAGENT_LLM_${role.toUpperCase()}_API_KEY`];
    if (roleKey) return roleKey;
  }
  return process.env.SOFAGENT_LLM_API_KEY ?? process.env.OPENAI_API_KEY;
}

export async function resolveLLMModel(role: 'engineer' | 'reviewer' | null = null): Promise<Record<string, unknown> | null> {
  const llmEnv = process.env.SOFAGENT_LLM;
  if (!llmEnv) return null;

  const [provider, modelName] = llmEnv.split(':');
  const providerKey = provider ?? '';

  // 解析 baseURL：custom 走 env，预置 provider 走查表
  let baseURL: string;
  if (providerKey === 'custom') {
    baseURL = process.env.SOFAGENT_LLM_BASE_URL ?? '';
    if (!baseURL) {
      console.warn('[sofagent] custom provider 需要 SOFAGENT_LLM_BASE_URL 环境变量');
      return null;
    }
  } else {
    const config = LLM_PROVIDERS[providerKey];
    if (!config) {
      console.warn(`[sofagent] 未知的 LLM provider: ${providerKey || '(空)'}。支持: glm, kimi, deepseek, custom。custom 需配合 SOFAGENT_LLM_BASE_URL 使用`);
      return null;
    }
    baseURL = config.baseURL;
  }

  // 解析 API key（v1.1.5 三级回退）
  const apiKey = resolveApiKey(role);
  if (!apiKey) {
    console.warn(`[sofagent] 未找到 API key。请设置以下任一环境变量（按优先级）：${role ? `\n  SOFAGENT_LLM_${role.toUpperCase()}_API_KEY（推荐：${role} 专用）` : ''}\n  SOFAGENT_LLM_API_KEY（通用）\n  OPENAI_API_KEY（兜底）`);
    return null;
  }

  try {
    const { ChatOpenAI } = await import('@langchain/openai');
    const model = new ChatOpenAI({
      modelName: modelName || LLM_PROVIDERS[providerKey]?.defaultModel || 'gpt-4o-mini',
      configuration: { baseURL },
      openAIApiKey: apiKey,
    });
    return { model };
  } catch {
    console.warn('[sofagent] @langchain/openai 初始化失败，降级到零工具路径');    return null;
  }
}

/**
 * 按角色解析 LLM 模型（v1.1.4 双模型支持 · v1.1.5 通用化）。
 * 优先级：SOFAGENT_LLM_{ROLE} > SOFAGENT_LLM（兜底）。
 * 模型选择建议（厂商无关）：engineer 用性价比模型，reviewer 用推理能力更强的模型。
 */
async function resolveLLMModelFor(role: 'engineer' | 'reviewer'): Promise<Record<string, unknown> | null> {
  const envKey = `SOFAGENT_LLM_${role.toUpperCase()}`;
  const roleEnv = process.env[envKey];
  if (roleEnv) {
    const saved = process.env.SOFAGENT_LLM;
    process.env.SOFAGENT_LLM = roleEnv;
    const result = await resolveLLMModel(role);
    process.env.SOFAGENT_LLM = saved ?? '';
    if (result) return result;
    console.warn(`[sofagent] ${envKey}=${roleEnv} 解析失败，尝试 SOFAGENT_LLM 兜底`);
  }
  return resolveLLMModel(role);
}

/** audit 节点产出 */
export interface AuditOutcome {
  verdict: AuditVerdict;
  report: string;
}

/** HITL 确认结果：y=通过 / n=驳回 / abort=中断（stdin 关闭等） */
export type HumanDecision = 'y' | 'n' | 'abort';

/**
 * 节点依赖注入接口——默认实现见 defaultDeps()，测试可整体替换
 */
export interface LoopGraphDeps {
  /** engineer 执行：输入任务 + 上一轮反馈，输出产出摘要（diff/代码） */
  runEngineer: (task: string, feedback: string) => Promise<string>;
  /** audit 执行：输入 engineer 产出，输出 PASS/WARN/FAIL + 报告 */
  runAudit: (artifacts: LoopArtifacts) => Promise<AuditOutcome>;
  /** reviewer 执行：输入 engineer 产出 + audit 报告，输出审查报告 */
  runReviewer: (artifacts: LoopArtifacts) => Promise<string>;
  /** HITL 确认：展示审查报告，等待人工 y/n（不限时） */
  confirmHuman: (reviewReport: string) => Promise<HumanDecision>;
  /** blocked 终态回写 audit history（终态可追溯，不无限循环） */
  recordBlocked: (state: LoopGraphState) => Promise<void>;
  /** checkpoint 存储 */
  checkpointer: FileCheckpointer;
  /** 重试上限（默认 3） */
  maxRetries: number;
  /** 日志输出 */
  log: (msg: string) => void;
  /**
   * 数据目录（v1.2.2 P3b）——HITL 异步模式检测与请求/响应文件读写根路径。
   * 不设置时按 defaultDeps() 注入的 loadEnvConfig().dataDir 解析。
   */
  dataDir?: string;
  /**
   * Planner LLM decide 调用（v1.2.2 P4）——plan 节点任务分解。
   * 不设置时 buildLoopGraph 内部 fallback 到 defaultRunPlannerDecide。
   */
  runPlannerDecide?: (task: string) => Promise<string>;
  /**
   * 降级路由链开关（v1.2.2 P4）。
   * true：audit FAIL 按 0→1→2 推进 degradationLevel（降级链语义）；
   * false/缺省：保持 v1.2.1 纯 retry→blocked 语义（老测试/老调用方兼容）。
   * runLoopGraph 默认开启。
   */
  degradationChainEnabled?: boolean;
}

// ────────────────────────────────
// 默认依赖实现
// ────────────────────────────────

/**
 * 为 LOOP 节点角色构建 gate 包装后的工具集（v1.2.1 · 公共接线入口）。
 *
 * 每个节点独立调用 createToolGate() 创建 gate 实例——agentName + taskDesc
 * 决定规则上下文，节点间不共享 gate；再经 wrapToolsWithGate() 包装工具集，
 * 保证每个 tool call 执行前过 @sofagent/rules 检查。
 *
 * defaultRunEngineer / defaultRunReviewer 内联同一模式（各自显式接线）；
 * 未来新增 LOOP 节点（v1.3.0 DAG 并行 planner/fixer 等）必须走本函数，
 * 避免 v1.2.0「gate 只 export 不接线」的半闭环复发。
 *
 * 接线模式（与本文件两处内联接线一致）：
 *   const gate = createToolGate({ agentName, taskDesc });
 *   const gatedTools = wrapToolsWithGate(tools, gate);
 *
 * @param tools 角色原始工具集（ENGINEER_TOOLS / REVIEWER_TOOLS 等）
 * @param agentName 节点角色名（写入规则上下文）
 * @param taskDesc 当前任务描述（截断 500 字符）
 * @returns gate 包装后的新工具集（不改原数组）
 */
export function gateToolsForRole(
  tools: ExecutableTool[],
  agentName: 'engineer' | 'reviewer',
  taskDesc: string,
): ExecutableTool[] {
  const gate = createToolGate({ agentName, taskDesc: taskDesc.slice(0, 500) });
  return wrapToolsWithGate(tools, gate);
}

// ════════════════════════════════════════
// v1.2.2 P1：ModelRouter + 数据主权 middleware 接线
// ════════════════════════════════════════

/** 节点级共享实例（lazy init，测试可通过 setLoopRouterForTest 替换） */
let sharedRouter: ModelRouter | null = null;
let sharedSovereigntyMw: DataSovereigntyMiddleware | null = null;
/** v1.2.2 P2b：SubAgent 进度遥测 middleware 共享实例 */
let sharedProgressMw: ProgressMiddleware | null = null;

/** 获取/初始化 ModelRouter 单例 */
export function getLoopRouter(): ModelRouter {
  if (!sharedRouter) sharedRouter = new ModelRouter();
  return sharedRouter;
}

/** 获取/初始化数据主权 middleware 单例 */
export function getLoopSovereigntyMw(): DataSovereigntyMiddleware {
  if (!sharedSovereigntyMw) sharedSovereigntyMw = new DataSovereigntyMiddleware();
  return sharedSovereigntyMw;
}

/** 获取/初始化进度遥测 middleware 单例（v1.2.2 P2b） */
export function getLoopProgressMw(): ProgressMiddleware {
  if (!sharedProgressMw) sharedProgressMw = new ProgressMiddleware();
  return sharedProgressMw;
}

/** 测试注入：替换 router/mw（用 null 重置） */
export function setLoopRouterForTest(router: ModelRouter | null): void {
  sharedRouter = router;
}
export function setLoopSovereigntyMwForTest(mw: DataSovereigntyMiddleware | null): void {
  sharedSovereigntyMw = mw;
}
export function setLoopProgressMwForTest(mw: ProgressMiddleware | null): void {
  sharedProgressMw = mw;
}

/**
 * 通过 ModelRouter 评估任务路由 + 敏感度。
 * 路由决策写日志（不阻断）；敏感度用于 middleware 上下文注入。
 */
function routeAndLog(role: 'engineer' | 'reviewer', task: string): {
  sensitivity: 'public' | 'internal' | 'restricted' | 'confidential';
  routeSummary: string;
} {
  try {
    const router = getLoopRouter();
    const route = router.route(task, { agentRole: role, userIntent: task.slice(0, 200) });
    return {
      sensitivity: route.sensitivity,
      routeSummary: `[router] target=${route.target} reason=${route.reason} sensitivity=${route.sensitivity}`,
    };
  } catch (err) {
    // P1-21: 数据流向/安全降级必须有 warn——router 失败时降级为 internal（可上云），
    // 如果本该走 restricted（本地）的数据被降级，用户需要知道
    console.warn('[sofagent] router 路由评估失败，降级 sensitivity=internal:', err instanceof Error ? err.message : String(err));
    return { sensitivity: 'internal', routeSummary: '[router] 路由评估失败，降级 internal' };
  }
}

/**
 * 默认 engineer 实现——v1.1.4 升级为工具注入路径：
 * 用 createReactAgent + ENGINEER_TOOLS（6 个工具）启动，
 * engineer 节点从"零工具只能说话"升级为"能读写文件、跑测试、改代码"。
 *
 * 约束通过工具 description 内嵌（A1-A17 边界），不做 hook 拦截。
 * systemPrompt = 四层约束链 + ENGINEER_AGENT.systemPrompt。
 *
 * v1.2.2 P4 decide/execute 分层：在 createReactAgent 路径之前先跑
 *   decide（LLM 结构化决策）→ execute（确定性文件编辑/git）。
 *   decide 成功时其产出作为补充上下文拼入 systemPrompt；
 *   decide 失败（schema 校验失败/LLM 不可用）→ 静默跳过，走原有工具注入路径
 *   （降级链由 audit 节点按 degradationLevel 推进，不在此处阻断）。
 *
 * 降级兜底：如果 createReactAgent import 失败，降级回 spawnSubAgent
 * （composer 零工具路径），并在输出前加 `[降级运行] ` 标注。
 */
async function defaultRunEngineer(task: string, feedback: string): Promise<string> {
  const fullTask = [
    '# LOOP 任务',
    task,
    '',
    '# 执行纪律',
    '1. 先读再改：修改前先 Read 目标文件',
    '2. 最小变更：只触碰任务要求的内容',
    '3. 验证再继续：完成后确认 build 通过',
    ...(feedback
      ? ['', '# 上一轮反馈（audit/review 未通过原因，只修复标记的问题）', feedback.slice(0, 2000)]
      : []),
  ].join('\n');

  // v1.2.2 P1：ModelRouter 路由 + 敏感度评估
  const { sensitivity, routeSummary } = routeAndLog('engineer', task);
  const sovereigntyMw = getLoopSovereigntyMw();
  // v1.2.2 P2b：进度遥测——node-start（失败静默，不阻断 LOOP）
  const progressMw = getLoopProgressMw();
  const nodeStartedAt = Date.now();
  progressMw.nodeStart('engineer', task.slice(0, 120));

  // v1.2.2 P4：decide/execute 分层——decide（LLM 决策）→ execute（确定性执行）
  // decide 成功：决策摘要拼入 agent 上下文；decide 失败：静默跳过走原路径
  let decideSummary = '';
  try {
    const decideResult = await engineerDecide(
      { task, feedback: feedback || undefined },
      { callLLM: defaultDecideCallLLM, router: getLoopRouter(), log: () => {} },
    );
    if (decideResult) {
      decideSummary = [
        '[decide] 结构化决策（经 ModelRouter 路由）：',
        `rationale: ${decideResult.decide.rationale.slice(0, 200)}`,
        ...decideResult.decide.changes.map((c) => `- ${c.action} ${c.file}: ${c.description.slice(0, 60)}`),
      ].join('\n');
      // execute 层：dryRun=false 真实执行（git 不可用时内部降级，不 throw）
      const execResult = await engineerExecute(decideResult.decide, {
        cwd: process.cwd(),
        dryRun: false,
        log: () => {},
      });
      decideSummary += `\n[execute] ${execResult.summary.split('\n')[0] ?? ''}`;
    }
  } catch (err) {
    // P1-21: decide/execute 异常时降级走 createReactAgent 路径——工具可用性降级需 warn
    console.warn('[sofagent] engineer decide/execute 失败，降级走 createReactAgent:', err instanceof Error ? err.message : String(err));
  }

  // v1.1.4：工具注入路径——createReactAgent + ENGINEER_TOOLS
  // SOFAGENT_LLM 未设置或解析失败时自动降级到 spawnSubAgent 零工具路径
  try {
    const resolved = await resolveLLMModelFor('engineer');
    if (!resolved || !resolved.model) throw new Error('SOFAGENT_LLM 未设置，无法确定模型 provider');

    // @ts-ignore — @langchain/langgraph/prebuilt 子路径导出在 moduleResolution: node 下无法解析类型
    const { createReactAgent } = await import('@langchain/langgraph/prebuilt');
    const constrainedPrompt = buildConstrainedSystemPrompt(process.cwd());
    const systemPrompt = `${constrainedPrompt}\n\n${ENGINEER_AGENT.systemPrompt}\n\n${routeSummary}${decideSummary ? `\n\n${decideSummary}` : ''}`;
    // v1.2.0: ToolGate 事前拦截——每个 tool call 前过 @sofagent/rules 检查
    const gate = createToolGate({ agentName: 'engineer', taskDesc: task.slice(0, 500) });
    const gatedTools = wrapToolsWithGate(ENGINEER_TOOLS, gate);
    const langGraphTools = convertToLangGraphTools(gatedTools);
    const agent = (createReactAgent as unknown as (params: {
      llm: unknown;
      tools: unknown[];
      prompt: string;
    }) => { invoke: (input: unknown, config?: { recursionLimit?: number }) => Promise<unknown> })({
      llm: resolved.model,
      tools: langGraphTools,
      prompt: systemPrompt,
    });
    // v1.2.2 P2b：LLM 调用期间发心跳（3s 节流，Dashboard 心跳检测数据源）
    progressMw.heartbeat('engineer');
    // v1.2.2 P0：数据主权 middleware 包裹模型调用
    const result = await sovereigntyMw.wrapModelCall(
      {
        provider: process.env.SOFAGENT_LLM?.split(':')[0] ?? 'unknown',
        model: process.env.SOFAGENT_LLM?.split(':')[1] ?? 'unknown',
        endpoint: 'loop-engineer',
        purpose: 'engineer-loop',
      },
      () => agent.invoke(
        { messages: [{ role: 'user', content: fullTask }] },
        { recursionLimit: resolveMaxTurns('engineer') * 2 },
      ),
      { agentRole: 'engineer', userIntent: task.slice(0, 200), sensitivity },
    );
    const output = extractAgentText(result);
    progressMw.nodeEnd('engineer', { durationMs: Date.now() - nodeStartedAt, success: true });
    return output || '[降级运行] createReactAgent 未返回内容，已回退';
  } catch (err) {
    // P1-21: 模型解析失败/createReactAgent import 失败 → spawnSubAgent 零工具路径（工具可用性降级）
    console.warn('[sofagent] engineer createReactAgent 失败，降级到 spawnSubAgent:', err instanceof Error ? err.message : String(err));
    progressMw.nodeEnd('engineer', { durationMs: Date.now() - nodeStartedAt, success: false });
    const fallback = await spawnSubAgent(ENGINEER_AGENT, fullTask);
    return `[降级运行] ${fallback}`;
  }
}

/**
 * 默认 audit 实现——程序化调用 @sofagent/audit（比 CLI 子进程侵入更小：
 * 无需假设二进制安装路径，且类型安全）。
 *
 * 流程：git diff HEAD（工作区未提交变更）→ parseDiff → runRules。
 * 审计引擎不可用（如 git 环境缺失）时降级 WARN 并在报告注明——
 * 不直接 FAIL 以免烧穿重试次数，由 reviewer + human_confirm 兜底把关。
 */
async function defaultRunAudit(artifacts: LoopArtifacts): Promise<AuditOutcome> {
  try {
    const audit = await import('@sofagent/audit');
    const rawDiff = execSync('git diff HEAD', {
      encoding: 'utf-8',
      maxBuffer: 16 * 1024 * 1024,
    });
    if (!rawDiff.trim()) {
      const emptyWarnOutcome: AuditOutcome = {
        verdict: 'WARN',
        report: '审计提示：git diff HEAD 无变更——engineer 可能未产生文件修改，请人工复核。',
      };
      recordLoopAuditHistory(audit, emptyWarnOutcome, artifacts.task);
      return emptyWarnOutcome;
    }
    const diffFiles = audit.parseDiff('HEAD');
    const result = audit.runRules(diffFiles, [], artifacts.task, false, true);
    const verdict: AuditVerdict =
      result.exitCode === 0 ? 'PASS' : result.exitCode === 1 ? 'WARN' : 'FAIL';
    const lines = result.rules
      .filter((r) => r.status !== 'SKIPPED')
      .map((r) => `- [${r.status}] #${r.number} ${r.name}${r.details.length ? `：${r.details.join('；')}` : ''}`);
    const outcome: AuditOutcome = {
      verdict,
      report: [`审计判定: ${verdict}（exitCode=${result.exitCode}）`, ...lines].join('\n'),
    };
    recordLoopAuditHistory(audit, outcome, artifacts.task, {
      ruleResults: result.rules,
      diffFileCount: diffFiles.length,
    });
    return outcome;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const degradedOutcome: AuditOutcome = {
      verdict: 'WARN',
      report: `审计提示：审计引擎不可用（${msg}）——降级 WARN，由 reviewer 与人工确认兜底。`,
    };
    // 审计引擎不可用时也尝试写 history（engine 字段标 loop-graph-degraded 便于追溯）
    try {
      const audit = await import('@sofagent/audit');
      recordLoopAuditHistory(audit, degradedOutcome, artifacts.task, { engine: 'loop-graph-degraded' });
    } catch {
      // 连 import 都失败——忽略，history 写入失败不阻塞 LOOP 流程
    }
    return degradedOutcome;
  }
}

/**
 * 将 LOOP 内的审计判定写入 audit history。
 * 三态都写——这是 warn-accumulator 判定「WARN 之后是否有 PASS 清理」的前提。
 * 写入失败不抛异常（history 是辅助追溯，不阻塞 LOOP 主流程）。
 */
function recordLoopAuditHistory(
  audit: typeof import('@sofagent/audit'),
  outcome: AuditOutcome,
  task: string,
  extra?: { ruleResults?: unknown[]; diffFileCount?: number; engine?: string },
): void {
  try {
    audit.appendHistory({
      timestamp: new Date().toISOString(),
      diffRange: 'HEAD',
      task: task.slice(0, 500),
      exitCode: outcome.verdict === 'PASS' ? 0 : outcome.verdict === 'WARN' ? 1 : 2,
      ruleResults: (extra?.ruleResults as AuditHistoryEntry['ruleResults']) ?? [],
      diffFileCount: extra?.diffFileCount ?? 0,
      commitMsg: `[LOOP audit] verdict=${outcome.verdict}`,
      engine: extra?.engine ?? 'loop-graph',
    });
  } catch {
    // history 写入失败不阻塞 LOOP 主流程
  }
}

/**
 * 默认 reviewer 实现——v1.1.4 升级为工具注入路径：
 * 用 createReactAgent + REVIEWER_TOOLS（只读 3 个工具）启动。
 *
 * 审查员工具子集：sf_read, search_code, run_bash（只读不写）。
 * systemPrompt = 四层约束链 + REVIEWER_AGENT.systemPrompt。
 *
 * 降级兜底：同 engineer，失败时降级回 spawnSubAgent。
 */
async function defaultRunReviewer(artifacts: LoopArtifacts): Promise<string> {
  const reviewTask = [
    '# 审查任务',
    '审查以下 Engineer 的产出：',
    '',
    '```',
    artifacts.engineerOutput.slice(0, 4000),
    '```',
    '',
    '# 审计报告（供参考）',
    artifacts.auditReport.slice(0, 2000),
    '',
    '# 审查要求',
    '1. 按 🔴🟡💭 分级标注问题',
    '2. 检查是否满足原始任务要求',
    '3. 检查是否有范围蔓延（做了任务不需要的改动）',
    '4. 输出判定：IS_PASS: YES 或 IS_PASS: NO',
  ].join('\n');

  // v1.2.2 P1：ModelRouter 路由 + 敏感度评估
  const { sensitivity, routeSummary } = routeAndLog('reviewer', reviewTask);
  const sovereigntyMw = getLoopSovereigntyMw();
  // v1.2.2 P2b：进度遥测——node-start（失败静默，不阻断 LOOP）
  const progressMw = getLoopProgressMw();
  const nodeStartedAt = Date.now();
  progressMw.nodeStart('reviewer', 'code review');

  // v1.1.4：工具注入路径——createReactAgent + REVIEWER_TOOLS
  // SOFAGENT_LLM 未设置或解析失败时自动降级到 spawnSubAgent 零工具路径
  try {
    const resolved = await resolveLLMModelFor('reviewer');
    if (!resolved || !resolved.model) throw new Error('SOFAGENT_LLM 未设置，无法确定模型 provider');

    // @ts-ignore — @langchain/langgraph/prebuilt 子路径导出在 moduleResolution: node 下无法解析类型
    const { createReactAgent } = await import('@langchain/langgraph/prebuilt');
    const constrainedPrompt = buildConstrainedSystemPrompt(process.cwd());
    const systemPrompt = `${constrainedPrompt}\n\n${REVIEWER_AGENT.systemPrompt}\n\n${routeSummary}`;
    // v1.2.0: ToolGate 事前拦截——reviewer 工具也过 gate（只读工具通常 PASS，但保持一致性）
    const gate = createToolGate({ agentName: 'reviewer', taskDesc: 'code review'.slice(0, 500) });
    const gatedTools = wrapToolsWithGate(REVIEWER_TOOLS, gate);
    const langGraphTools = convertToLangGraphTools(gatedTools);
    const agent = (createReactAgent as unknown as (params: {
      llm: unknown;
      tools: unknown[];
      prompt: string;
    }) => { invoke: (input: unknown, config?: { recursionLimit?: number }) => Promise<unknown> })({
      llm: resolved.model,
      tools: langGraphTools,
      prompt: systemPrompt,
    });
    // v1.2.2 P2b：LLM 调用期间发心跳（3s 节流，Dashboard 心跳检测数据源）
    progressMw.heartbeat('reviewer');
    // v1.2.2 P0：数据主权 middleware 包裹模型调用
    const result = await sovereigntyMw.wrapModelCall(
      {
        provider: process.env.SOFAGENT_LLM?.split(':')[0] ?? 'unknown',
        model: process.env.SOFAGENT_LLM?.split(':')[1] ?? 'unknown',
        endpoint: 'loop-reviewer',
        purpose: 'reviewer-loop',
      },
      () => agent.invoke(
        { messages: [{ role: 'user', content: reviewTask }] },
        { recursionLimit: resolveMaxTurns('reviewer') * 2 },
      ),
      { agentRole: 'reviewer', userIntent: reviewTask.slice(0, 200), sensitivity },
    );
    const output = extractAgentText(result);
    progressMw.nodeEnd('reviewer', { durationMs: Date.now() - nodeStartedAt, success: true });
    return output || '[降级运行] createReactAgent 未返回内容，已回退';
  } catch (err) {
    // P1-21: reviewer 模型解析失败/createReactAgent import 失败 → spawnSubAgent 零工具路径
    console.warn('[sofagent] reviewer createReactAgent 失败，降级到 spawnSubAgent:', err instanceof Error ? err.message : String(err));
    progressMw.nodeEnd('reviewer', { durationMs: Date.now() - nodeStartedAt, success: false });
    const fallback = await spawnSubAgent(REVIEWER_AGENT, reviewTask);
    return `[降级运行] ${fallback}`;
  }
}

/**
 * 从 reviewer 审查报告中提取 IS_PASS 判定。
 * reviewer 被要求在报告中输出 "IS_PASS: YES" 或 "IS_PASS: NO"。
 */
export function parseReviewerPass(reviewReport: string): boolean | null {
  const match = reviewReport.match(/\bIS_PASS\s*:\s*(YES|NO)\b/i);
  if (!match) return null;
  return match[1]!.toUpperCase() === 'YES';
}

/**
 * 自动确认——LOOP_AUTO=1 时根据 reviewer 的 IS_PASS 自动判定。
 * IS_PASS: YES → y（通过）
 * IS_PASS: NO  → n（驳回回 engineer）
 * 无法解析      → n（保守默认驳回）
 */
function autoConfirmHuman(reviewReport: string): HumanDecision {
  const isPass = parseReviewerPass(reviewReport);
  if (isPass === true) return 'y';
  if (isPass === false) return 'n';
  // 无法解析 IS_PASS——保守默认驳回
  console.log('[sofagent] 自动模式：无法从 review 报告中解析 IS_PASS，默认驳回');
  return 'n';
}

/**
 * 默认 HITL 实现。
 * LOOP_AUTO=1 时：自动根据 reviewer 的 IS_PASS 判定（不等待人工）。
 * LOOP_AUTO 未设时：stdin readline 等待人工 y/n（不限时）。
 */
function defaultConfirmHuman(reviewReport: string): Promise<HumanDecision> {
  // v1.1.4：LOOP_AUTO=1 时自动判定，不走 stdin readline
  if (process.env.LOOP_AUTO === '1') {
    const autoDecision = autoConfirmHuman(reviewReport);
    console.log(`\n🤖 自动模式判定: ${autoDecision === 'y' ? '✅ 通过 (IS_PASS: YES)' : '🔄 驳回 (IS_PASS: NO)'}`);
    return Promise.resolve(autoDecision);
  }

  // HITL 模式——stdin readline
  console.log('');
  console.log('══════════ 审查报告（HITL 确认） ══════════');
  console.log(reviewReport);
  console.log('═══════════════════════════════════════════');

  return new Promise<HumanDecision>((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let settled = false;
    const settle = (decision: HumanDecision) => {
      if (settled) return;
      settled = true;
      rl.close();
      resolve(decision);
    };

    const ask = () => {
      // readline 无超时——等待不限时
      rl.question('确认通过？(y=通过 / n=驳回回 engineer 修复): ', (answer) => {
        const a = answer.trim().toLowerCase();
        if (a === 'y' || a === 'yes') return settle('y');
        if (a === 'n' || a === 'no') return settle('n');
        console.log('请输入 y 或 n');
        ask();
      });
    };
    ask();

    // stdin 关闭（EOF/非交互环境）：视为中断而非通过/驳回——
    // checkpoint 已保存，可用 loop --resume 恢复到本确认节点
    rl.on('close', () => settle('abort'));
  });
}

/**
 * 从 createReactAgent invoke 结果中提取文本内容
 * 兼容 string / { content } / { messages: [...] } 多种返回格式
 */
function extractAgentText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    if (typeof obj.content === 'string') return obj.content;
    if (typeof obj.text === 'string') return obj.text;
    if (Array.isArray(obj.messages)) {
      for (let i = obj.messages.length - 1; i >= 0; i--) {
        const msg = obj.messages[i] as Record<string, unknown>;
        if ((msg.role === 'assistant' || msg.type === 'ai') && typeof msg.content === 'string') {
          return msg.content;
        }
      }
    }
  }
  return String(result ?? '');
}

/**
 * 默认 blocked 回写实现——追加 audit history（engine 标记 loop-graph），
 * blocked 作为终态可被 audit-root-cause / 周报追溯。
 */
async function defaultRecordBlocked(state: LoopGraphState): Promise<void> {
  try {
    const audit = await import('@sofagent/audit');
    audit.appendHistory({
      timestamp: new Date().toISOString(),
      diffRange: 'loop-graph',
      task: `[LOOP blocked] ${state.artifacts.task}`.slice(0, 500),
      exitCode: 2,
      ruleResults: [],
      diffFileCount: 0,
      commitMsg: `checkpointId=${state.checkpointId} retryCount=${state.retryCount}`,
      engine: 'loop-graph',
    });
  } catch {
    // audit history 写入失败不阻塞终态返回——blocked 状态本身已在 checkpoint 落盘
  }
}

/**
 * 构建默认依赖集
 */
export function defaultDeps(checkpointer: FileCheckpointer, silent = false): LoopGraphDeps {
  return {
    runEngineer: defaultRunEngineer,
    runAudit: defaultRunAudit,
    runReviewer: defaultRunReviewer,
    confirmHuman: defaultConfirmHuman,
    recordBlocked: defaultRecordBlocked,
    checkpointer,
    maxRetries: DEFAULT_MAX_RETRIES,
    log: (msg: string) => {
      if (!silent) console.log(msg);
    },
    // v1.2.2 P3b：HITL 异步模式根路径（pending/resolved 均落在此目录下）
    dataDir: loadEnvConfig().dataDir,
  };
}

// ────────────────────────────────
// 节点实现（LangGraph node functions）
// ────────────────────────────────

/**
 * engineer 节点——执行任务（首轮）或按反馈修复（重试轮）。
 *
 * v1.2.2 P4：
 *   - 逐条消费 artifacts.subtasks（pending → done），当前子任务拼入任务描述
 *   - 节点执行后写 graph-state.json（活跃节点 + Work Graph 任务数）
 *   - decide/execute 分层在 defaultRunEngineer 内部顺序调用（图拓扑不变）
 */
export function makeEngineerNode(deps: LoopGraphDeps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (state: LoopGraphState): Promise<any> => {
    deps.log(`👷 engineer 执行中...（第 ${state.retryCount + 1} 轮）`);

    // P4：取当前 pending 子任务（Planner 产出），拼入任务上下文
    const subtasks = state.artifacts.subtasks ?? [];
    const currentSub = subtasks.find((s) => s.status === 'pending');
    const taskWithSub = currentSub
      ? `${state.artifacts.task}\n\n# 当前子任务（${currentSub.id}）\n${currentSub.description}`
      : state.artifacts.task;

    const feedback =
      state.retryCount > 0
        ? [state.artifacts.auditReport, state.artifacts.reviewReport].filter(Boolean).join('\n\n')
        : '';
    const output = await deps.runEngineer(taskWithSub, feedback);

    // P4：当前子任务标记 done
    const updatedSubtasks = currentSub
      ? subtasks.map((s) => (s.id === currentSub.id ? { ...s, status: 'done' as const } : s))
      : subtasks;

    // P4：Graph 状态落盘（Dashboard Graph Engine 区块数据源）
    if (deps.dataDir) {
      writeGraphState(deps.dataDir, 'engineer', updatedSubtasks.length);
    }

    deps.log('✅ engineer 完成');
    return {
      currentNode: 'engineer',
      artifacts: {
        engineerOutput: output,
        engineerOutputs: [...state.artifacts.engineerOutputs, output],
        subtasks: updatedSubtasks,
      },
    };
  };
}

/**
 * audit 节点——审计 engineer 产出。
 *
 * v1.2.2 P4 降级路由链（按 FAIL 累计次数推进，与 routeAfterAudit 五分支一一对应）：
 *   FAIL 第 1 次：degradationLevel=0，retryCount+1 → 回 engineer 重试（现有语义）
 *   FAIL 第 2 次：degradationLevel=0→1，auditReport 头部注入 [降级 L1]
 *         "先做最小可行版本"，retryCount+1 → 回 engineer
 *   FAIL 第 3 次：degradationLevel=1→2，auditReport 头部注入 [降级 L2]
 *         低可信标注，retryCount 不再烧 → routeAfterAudit 放行 reviewer（不 blocked）
 *   超限（degradationLevel=2 仍 FAIL 且 retryCount 已耗尽）：
 *         → routeAfterAudit 路由 human_confirm 人工确认
 *
 * 兼容性：degradationLevel 推进只在 degradationChainEnabled 时生效——
 * 老调用方（deps 未显式开启）保持 v1.2.1 纯 retry→blocked 语义；
 * runLoopGraph 默认开启（见 graph.ts buildDeps）。
 */
export function makeAuditNode(deps: LoopGraphDeps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (state: LoopGraphState): Promise<any> => {
    deps.log('🛡️ audit 审计中...');
    const outcome = await deps.runAudit(state.artifacts);
    deps.log(`🛡️ audit 判定: ${outcome.verdict}`);

    // v1.1.4：WARN 标注透传——不阻断流转，但标记到 reviewer 输入
    let auditReport = outcome.verdict === 'WARN'
      ? `[审计告警] ${outcome.report}`
      : outcome.report;

    // P4 降级链：FAIL 时按当前 degradationLevel 推进 0→1→2 并注入降级提示
    let degradationLevel = state.degradationLevel;
    if (outcome.verdict === 'FAIL' && deps.degradationChainEnabled) {
      if (degradationLevel === 0 && state.retryCount > 0) {
        // 第 2 次 FAIL（已 retry 过一次仍 FAIL）→ L1 降级任务范围
        degradationLevel = 1;
        auditReport = `[降级 L1] 先做最小可行版本——只实现核心路径，砍掉边缘情况与优化项。\n${auditReport}`;
        deps.log('🔻 audit FAIL · 降级 L1：缩小任务范围（最小可行版本）');
      } else if (degradationLevel === 1) {
        // 第 3 次 FAIL（L1 降级后仍 FAIL）→ L2 低可信，不再烧 retryCount
        degradationLevel = 2;
        auditReport = `[降级 L2] 低可信模式——本产出未经审计背书，请人工重点复核。\n${auditReport}`;
        deps.log('🔻 audit FAIL · 降级 L2：标记低可信，继续流转（不 blocked）');
      }
    }

    const base: Record<string, unknown> = {
      currentNode: 'audit',
      auditResult: outcome.verdict,
      degradationLevel,
      artifacts: {
        auditReport,
        auditReports: [...state.artifacts.auditReports, auditReport],
      },
    };

    if (outcome.verdict !== 'FAIL') {
      return base; // PASS/WARN → 继续流转 reviewer
    }

    // P4：L2 低可信——不再烧 retryCount，路由权交给 routeAfterAudit（→ reviewer）
    if (deps.degradationChainEnabled && degradationLevel >= 2) {
      return base;
    }

    if (state.retryCount < deps.maxRetries) {
      deps.log(`🔄 audit FAIL · 回 engineer 重试（${state.retryCount + 1}/${deps.maxRetries}）`);
      return { ...base, retryCount: state.retryCount + 1 };
    }

    // 重试已达上限仍 FAIL（且未进 L2）→ blocked 终态
    deps.log(`⛔ audit FAIL 且重试已达上限（${deps.maxRetries}）→ blocked`);
    const blockedState: LoopGraphState = { ...state, ...base, finalStatus: 'blocked' } as LoopGraphState;
    await deps.recordBlocked(blockedState);
    return { ...base, finalStatus: 'blocked' };
  };
}

/**
 * reviewer 节点——语义审查 engineer 产出
 */
export function makeReviewerNode(deps: LoopGraphDeps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (state: LoopGraphState): Promise<any> => {
    deps.log('🔍 reviewer 审查中...');
    const report = await deps.runReviewer(state.artifacts);
    deps.log('📝 reviewer 完成');
    return {
      currentNode: 'reviewer',
      artifacts: {
        reviewReport: report,
        reviewReports: [...state.artifacts.reviewReports, report],
      },
    };
  };
}

/**
 * human_confirm 节点——HITL 确认，双模式（v1.2.2 P3b）。
 *
 * 异步模式（{dataDir}/hitl/pending/ 目录存在）：
 *   1. 写 HITL 请求文件到 pending/{checkpointId}.json
 *      （checkpoint 已由 withCheckpoint 包装器在本节点前落盘 phase='before'）
 *   2. 返回 finalStatus='awaiting_human' → routeAfterHuman 路由 END，图挂起
 *   3. 外部信号写 resolved/{checkpointId}.json 后由 resumeLoopGraph() 续跑
 *
 * CLI 同步降级模式（目录不存在）：
 *   保持 readline 阻塞等待 stdin y/n——行为与 v1.2.1 完全一致。
 *   y → completed；n → 递增 retryCount 回 engineer（上限内）或 blocked；
 *   abort → aborted 终态（checkpoint 可续跑）。
 */
export function makeHumanConfirmNode(deps: LoopGraphDeps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (state: LoopGraphState): Promise<any> => {
    // ── 异步模式：存储驱动挂起，不阻塞等待 stdin ──
    const dataDir = deps.dataDir;
    if (dataDir && shouldUseAsyncHITL(dataDir)) {
      writeHITLRequest(dataDir, {
        checkpointId: state.checkpointId,
        createdAt: new Date().toISOString(),
        task: state.artifacts.task,
        reviewReport: state.artifacts.reviewReport,
        auditResult: state.auditResult ?? '',
        retryCount: state.retryCount,
        options: [...HITL_OPTIONS],
      });
      deps.log(
        `⏸️ HITL 异步挂起 · checkpointId=${state.checkpointId}\n` +
          `   等待外部信号：Dashboard POST / daemon 轮询 /\n` +
          `   CLI: sofagent-orchestrator loop --resolve ${state.checkpointId} --decision approve|reject`
      );
      return {
        currentNode: 'human_confirm',
        finalStatus: 'awaiting_human',
      };
    }

    // ── CLI 同步降级模式：readline 阻塞等待（与 v1.2.1 一致）──
    const isAuto = process.env.LOOP_AUTO === '1';
    deps.log(isAuto ? '🤖 自动审核判定中...' : '🙋 等待人工确认（不限时）...');
    const decision = await deps.confirmHuman(state.artifacts.reviewReport);

    if (decision === 'y') {
      deps.log('✅ 人工确认通过');
      return {
        currentNode: 'human_confirm',
        finalStatus: 'completed',
        artifacts: { humanFeedback: 'approved' },
      };
    }

    if (decision === 'abort') {
      deps.log('⏸️ 确认中断（stdin 关闭）——checkpoint 已保存，可 loop --resume 恢复');
      return {
        currentNode: 'human_confirm',
        finalStatus: 'aborted',
        artifacts: { humanFeedback: 'aborted' },
      };
    }

    // n = 驳回
    if (state.retryCount < deps.maxRetries) {
      deps.log(`🔄 人工驳回 · 回 engineer 修复（${state.retryCount + 1}/${deps.maxRetries}）`);
      return {
        currentNode: 'human_confirm',
        retryCount: state.retryCount + 1,
        artifacts: { humanFeedback: 'rejected' },
      };
    }

    deps.log(`⛔ 人工驳回且重试已达上限（${deps.maxRetries}）→ blocked`);
    const blockedState: LoopGraphState = {
      ...state,
      currentNode: 'human_confirm',
      finalStatus: 'blocked',
    } as LoopGraphState;
    await deps.recordBlocked(blockedState);
    return {
      currentNode: 'human_confirm',
      finalStatus: 'blocked',
      artifacts: { humanFeedback: 'rejected' },
    };
  };
}
