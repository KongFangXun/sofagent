// dsh-backend.ts · v1.3.7 交付⑤ · DSH Cordis 运行时适配器（对照真实 API 重写）
//
// 契约依据（2026-08 核实，不再猜测 API）：
// 1. @deepseek-ai/cordis@4.0.1 解包核实：真实入口是 `new Context()`——
//    没有 createCordisRuntime 导出（v1.3.4 骨架按 PR 描述猜的名字，已废弃）。
// 2. DSH 官方 cordis-tutorial 七章（github.com/deepseek-ai/deepseek-harness）：
//    - 插件签名：apply(ctx) 函数，可返回 cleanup
//    - 事件五模式：emit（fire-and-forget）/ parallel（并发）/ serial（顺序）/
//      bail（先到先得）/ waterfall（顺序管道）
//    - 🔴 waterfall 纪律：观察型监听器 (data, next) 必须调 next(data) 透传，
//      否则无声吞掉下游默认行为——plugin 实现头号坑
//    - ToolDefinition 三段式：define 段（模型可见 name/description/parameters）
//      与宿主私有段（execute/output.schema/output.render）严格分离
//    - 事件域：tools/pre-execute、tools/result、fs/write-intent、agent/* 生命周期
//
// 版本守卫链（rc 期拦截，正式版自动放开）：
// - 层 1（execution-backend.ts）：模块守卫——cordis 包可 import 且 Context 导出存在，
//   且配套 DSH agent 插件包（@deepseek-ai/dsh）非 rc 版本。
// - 层 2（本文件 runCordisAgent）：能力守卫——探测 ctx 上的 agent 驱动服务，
//   DSH agent-loop 插件缺失时抛 DshCapabilityMissingError → 工厂层 fallback LangGraph。
//   裸 cordis 框架包没有 agent 循环——两层守卫保证「不装全套 DSH 绝不硬跑」。

import type { ExecutionBackend, ExecutionTask, ExecutionResult } from '../execution-backend.js';
import { createTrajectoryCollector, type TrajectoryCollector } from './trajectory.js';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';

// CJS 编译目标下 import.meta 不可用——用 __filename（@types/node 提供）
const require_ = createRequire(__filename);

// ════════════════════════════════════════
// Cordis 真实契约类型（duck-typing 最小面）
// ════════════════════════════════════════

/**
 * Cordis 插件——对照官方教程 01-first-plugin 契约：
 * 一个接收 ctx 的函数，可选返回 cleanup（插件卸载时回调）。
 */
export type CordisPlugin = (
  ctx: CordisRuntime,
) => void | (() => void) | Promise<void | (() => void)>;

/**
 * Cordis 运行时上下文（duck-typing 最小契约——真实类是 cordis.Context）。
 * 只声明 sofagent 用到的面；多余能力（Computed/Effect/服务注入等）不进契约。
 */
export interface CordisRuntime {
  /** 挂载插件（apply(ctx) 模式） */
  plugin(plugin: CordisPlugin): unknown;
  /** 订阅事件（emit/parallel 观察面；返回取消订阅函数） */
  on(event: string, listener: (...args: unknown[]) => void): () => void;
  /**
   * waterfall 模式订阅（顺序管道监听）。
   * 🔴 纪律：监听器 (data, next) 必须调 next(data) 透传，否则吞掉下游默认行为。
   */
  waterfall?(
    event: string,
    listener: (data: unknown, next: (data: unknown) => void) => void,
  ): () => void;
  /** 服务获取（DSH agent-loop 等插件注册的服务面） */
  get?(key: string): unknown;
  /** 服务提供（boot 前置注入 cmdlineArgs/appExit 等服务） */
  provide?(key: string, value: unknown): unknown;
  /** 运行时销毁（释放资源） */
  dispose?(): void | Promise<void>;
}

/**
 * DSH tools 服务最小契约（rc.2 dsh-tools ToolsService 实测面）。
 * register() 返回 disposer（unregister）——driver 每任务一个 ctx，任务结束
 * dispose 整棵树，disposer 无需单独保存（生命周期与 ctx 同寿）。
 */
export interface DshToolsService {
  /**
   * 注册工具（全局层或调用方 scope——prepare 回调内调用即全局）。
   * 契约（assertSupportedJsonSchema 强校验）：name 非保留字（run_code）、
   * output.schema 必须是受支持 JSON Schema 子集、output.render 必须是函数。
   */
  register(definition: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
    output: { schema: Record<string, unknown>; render: (args: unknown, value: unknown) => string };
    execute: (args: Record<string, unknown>, exec: unknown) => unknown;
  }): () => void;
}

/** Cordis 模块契约——cordis@4.0.1 真实导出（解包核实） */
export interface CordisModule {
  /** 根上下文构造器：new Context(config?) */
  Context: new (config?: Record<string, unknown>) => CordisRuntime;
}

// ════════════════════════════════════════
// ToolDefinition 三段式（官方格式）
// ════════════════════════════════════════

/**
 * Cordis 官方 ToolDefinition 三段式（对照教程 tools 子系统文档）：
 *
 * 1. define 段（模型可见）——LLM 看到的工具签名：
 *    name / description / parameters（JSON Schema）
 * 2. execute 段（宿主私有）——实际执行体：
 *    execute(args)（sofagent 侧原样引用传入工具的 func/invoke，保 wrapper）
 * 3. output 段（宿主私有渲染）——结果消费格式：
 *    output.schema（结果 JSON Schema）/ output.render（人类可读渲染）
 */
export interface CordisToolDefinition {
  // ── define 段（模型可见）──
  name: string;
  description: string;
  /** 参数 JSON Schema（ExecutableTool.schema / LangGraph ToolSchema 直传） */
  parameters: Record<string, unknown>;
  // ── execute 段（宿主私有）──
  execute: (args: Record<string, unknown>, ctx?: unknown) => unknown;
  // ── output 段（宿主私有）──
  output?: {
    schema?: Record<string, unknown>;
    render?: (result: unknown) => string;
  };
}

/**
 * 把 CordisToolDefinition 注册进 DSH tools 服务（v1.4.1 工具注入接线）。
 *
 * 通道（实测 rc.2）：boot(dsh-base) 后 ctx.get('tools') → ToolsService.register()。
 * 注册时机在 boot 的 prepare 回调内 = 全局层——dsh-base 会话内所有 agent 可见。
 *
 * 防御式边界（rc 期 API 无生产承诺，缺面降级不崩）：
 * - tools 服务缺失 → 返回 0 并 WARN（agent 仍可用 DSH 自带 fs/bash）
 * - 单工具注册失败（schema 不合子集等）→ 跳过该工具 WARN，不中断其余注册
 *
 * @returns 实际注册成功的工具数
 */
export function registerSofagentTools(
  ctx: CordisRuntime,
  tools: CordisToolDefinition[],
): number {
  const svc = ctx.get?.('tools') as DshToolsService | undefined;
  if (!svc || typeof svc.register !== 'function') {
    console.warn(
      '[dsh-backend] DSH tools 服务面缺失（rc 形态变化？）——sofagent 自定义工具未注入，' +
        'agent 回落 DSH 自带 fs/bash 工具链',
    );
    return 0;
  }
  let registered = 0;
  for (const t of tools) {
    try {
      svc.register({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
        // output 双字段补全（register 强校验：schema + render 都必须可调用/合法）
        output: {
          schema: t.output?.schema ?? { type: 'string' },
          render: (_args: unknown, value: unknown) =>
            t.output?.render ? String(t.output.render(value)) : safeRender(value),
        },
        execute: (args: unknown) => t.execute(args as Record<string, unknown>, undefined),
      });
      registered++;
    } catch (err) {
      console.warn(`[dsh-backend] 工具 ${t.name} 注册失败（跳过，不中断其余）：${(err as Error).message}`);
    }
  }
  return registered;
}

/** render 兜底——字符串直出，对象 JSON 化（截断防超大输出进 prompt） */
function safeRender(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    const s = JSON.stringify(value);
    return s && s.length > 4000 ? s.slice(0, 4000) + '…(截断)' : (s ?? '');
  } catch {
    return String(value);
  }
}

/**
 * 工具格式转换：LangGraph ToolInterface / ExecutableTool → Cordis ToolDefinition 三段式。
 *
 * 🔴 只适配协议（字段名映射），不替换工具实现——task.tools 可能已被
 * audit/progress tool wrapper 包裹，execute 段原样引用 func/invoke，
 * 保住运行时审计能力（ExecutionBackend 契约强制义务）。
 */
export function convertTools(tools: unknown[]): CordisToolDefinition[] {
  const out: CordisToolDefinition[] = [];
  for (const t of tools) {
    const tool = t as {
      name?: string;
      description?: string;
      schema?: unknown;
      parameters?: unknown;
      func?: (input: Record<string, unknown>) => unknown;
      invoke?: (input: Record<string, unknown>) => unknown;
    };
    if (!tool || typeof tool.name !== 'string') continue; // 无名工具不注册（防御）

    const invoker =
      typeof tool.func === 'function' ? tool.func : typeof tool.invoke === 'function' ? tool.invoke : null;
    if (!invoker) continue; // 无执行体不注册（防御——不可执行的工具进 Cordis 只会报错）

    out.push({
      // ── define 段（模型可见）：名字/描述/参数 schema 三件套 ──
      name: tool.name,
      description: tool.description ?? '',
      parameters: normalizeParameters(tool.schema ?? tool.parameters),
      // ── execute 段（宿主私有）：原样引用，保 wrapper ──
      execute: (args) => invoker(args),
      // ── output 段（宿主私有）：schema 兜底 string（tools.register 强校验要求
      //    output.schema 必填——受支持子集；sofagent 工具返回统一字符串化 JSON）──
      output: {
        schema: { type: 'string' },
        render: (result) => (typeof result === 'string' ? result : JSON.stringify(result)),
      },
    });
  }
  return out;
}

/** 参数 schema 归一化——zod / JSON Schema / 缺失三态防御 */
function normalizeParameters(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') {
    return { type: 'object', properties: {} };
  }
  const s = schema as Record<string, unknown>;
  // 🔴 zod schema 优先检测（v1.4.1 判断层 run-01 根因修复）：
  // zod 对象自带 type 属性（值 'object'），下方 `'type' in s` 会被骗过——整个 zod
  // 对象（含 toJSONSchema/parse/def 等方法）透传给 tools.register 后，DSH 组装
  // LLM 请求序列化含函数的 parameters 失败 → turn 立即 end、零 LLM 调用、静默空返回。
  // zod v4 起有 toJSONSchema()——先检测再转换，产物为纯 JSON Schema。
  if (typeof (s as { toJSONSchema?: unknown }).toJSONSchema === 'function') {
    try {
      const jsonSchema = (s as { toJSONSchema: () => unknown }).toJSONSchema();
      if (jsonSchema && typeof jsonSchema === 'object') {
        return jsonSchema as Record<string, unknown>;
      }
    } catch {
      // toJSONSchema() 抛错（zod 版本差异）——落空对象签名兜底，绝不透传 zod 对象
    }
    return { type: 'object', properties: {} };
  }
  // zod v3 老形态（带 _def/shape 无 toJSONSchema）——提取太重，给空对象签名
  // （LangGraph 侧 convertToLangGraphTools 已做过 zod 适配，到这里的一般是 JSON Schema）
  if ('type' in s || 'properties' in s) {
    return s;
  }
  return { type: 'object', properties: {} };
}

// ════════════════════════════════════════
// 预算软熔断（waterfall next() 纪律）
// ════════════════════════════════════════

/** 预算守卫判定：ok / soft（注入收尾指令）/ hard（物理中断） */
export type BudgetVerdict = 'ok' | 'soft' | 'hard';

/** 工具预算守卫（行为对齐 LangGraph stateModifier 软熔断语义） */
export interface BudgetGuard {
  /** 每次工具执行前判定（计数递增在内） */
  check(): BudgetVerdict;
  /** 当前工具调用计数 */
  count(): number;
}

export function createBudgetGuard(budget?: { softLimit: number; hardLimit: number }): BudgetGuard {
  let calls = 0;
  if (!budget) {
    return { check: () => 'ok' as const, count: () => 0 };
  }
  return {
    check() {
      calls++;
      if (calls >= budget.hardLimit) return 'hard' as const;
      if (calls >= budget.softLimit) return 'soft' as const;
      return 'ok' as const;
    },
    count: () => calls,
  };
}

/** 工具预算耗尽（hard 熔断）——runCordisAgent 捕获后物理中断 */
export class ToolBudgetExhaustedError extends Error {
  constructor(public readonly toolCallCount: number) {
    super(`[dsh-backend] 工具预算硬熔断：${toolCallCount} 次调用撞 hardLimit`);
    this.name = 'ToolBudgetExhaustedError';
  }
}

/**
 * 预算软熔断 Cordis 插件——订阅 tools/pre-execute（waterfall 模式）。
 *
 * 🔴 waterfall next() 纪律（官方教程头号坑）：观察型监听器必须调 next(data)
 * 透传原始数据，否则无声吞掉下游（含 DSH 默认行为）——预算插件只做判定
 * 与中断，不改写 data，透传语义严格保持。
 *
 * - soft：回调通知调用方（runCordisAgent 注入收尾指令——Cordis 等价
 *   LangGraph 的 stateModifier HumanMessage 注入）
 * - hard：抛 ToolBudgetExhaustedError 物理中断（next 未调即抛=链条断裂，
 *   这是中断的唯一合法姿势——waterfall 里抛错会终止整条管道）
 */
export function createBudgetPlugin(guard: BudgetGuard, onSoft?: (count: number) => void): CordisPlugin {
  return (ctx: CordisRuntime) => {
    const listen = (event: string): (() => void) | undefined => {
      try {
        const unregister = ctx.waterfall?.(event, (data, next) => {
          const verdict = guard.check();
          if (verdict === 'hard') {
            // hard 熔断：抛错终止管道（next 不调——中断即目的）
            throw new ToolBudgetExhaustedError(guard.count());
          }
          if (verdict === 'soft' && onSoft) {
            onSoft(guard.count());
          }
          // 🔴 纪律：非中断路径必须 next(data) 透传
          next(data);
        });
        return unregister;
      } catch {
        // waterfall 通道不存在（事件名与正式版有出入）——退化为 on 计数观察
        try {
          return ctx.on(event, () => {
            const verdict = guard.check();
            if (verdict === 'hard') {
              throw new ToolBudgetExhaustedError(guard.count());
            }
            if (verdict === 'soft' && onSoft) onSoft(guard.count());
          });
        } catch {
          return undefined;
        }
      }
    };
    const offs = [listen('tools/pre-execute')].filter(Boolean) as Array<() => void>;
    return () => {
      for (const off of offs) {
        try {
          off();
        } catch {
          /* 取消订阅失败——runtime dispose 时统一清理 */
        }
      }
    };
  };
}

// ════════════════════════════════════════
// DSH 能力缺失（层 2 守卫）
// ════════════════════════════════════════

/** DSH agent 驱动能力缺失——工厂层捕获后 fallback LangGraph */
export class DshCapabilityMissingError extends Error {
  constructor(detail: string) {
    super(
      `[dsh-backend] Cordis 运行时缺少 agent 驱动服务（${detail}）。` +
        '裸 cordis 框架包不含 agent 循环——需安装 DSH agent-loop 插件（@deepseek-ai/dsh 正式版）。' +
        '此错误由层 2 能力守卫抛出，工厂层将 fallback LangGraph。',
    );
    this.name = 'DshCapabilityMissingError';
  }
}

// ════════════════════════════════════════
// runCordisAgent（对照真实 Cordis API 重写）
// ════════════════════════════════════════

/** runCordisAgent 入参 */
export interface RunCordisAgentOptions {
  systemPrompt: string;
  task: string;
  tools: CordisToolDefinition[];
  modelConfig?: Record<string, unknown>;
  recursionLimit?: number;
  budgetGuard: BudgetGuard;
  /** Trajectory 采集器（Trajectory PoC 接线点） */
  trajectory?: TrajectoryCollector;
  /** DSH agent-loop 插件（注册 agent 驱动服务——缺失时层 2 守卫兜底探测） */
  agentPlugin?: CordisPlugin;
}

/** agent 驱动服务最小契约（rc.2 实际 API——dsh-agent AgentRegistry + dsh-agent-loop 驱动面，实测核实） */
interface AgentDriver {
  /**
   * 投递用户消息并驱动一轮执行，返回最终 assistant 文本。
   * rc.2 契约（对照官方 dsh-headless runner 源码）：
   *   agents.create({sessionId, meta, agentOptions, setup}) → agent
   *   agent.whenIdle() → agent.followup(createUserMessage(...)) → agent.whenIdle()
   *   → sessions.flush → 从 session.events 提取 assistant/message 文本
   */
  deliver(message: string): Promise<unknown> | unknown;
}

/**
 * 调用 Cordis 运行时执行 agent（rc.2 真实 API 重写）。
 *
 * 执行链：boot(dsh-base bundle + cmdlineArgs/appExit 注入) → agents.create →
 * followup 投递 → whenIdle 等待 → session.events 提取最终 assistant 文本。
 *
 * 🔴 v1.4.0（2026-08-24）修正：此前用裸 new Context() + resolveAgentDriver 探测
 * deliver/followup 方法——但 rc.2 的 agents 是 AgentRegistry（create/resume/register），
 * 无 deliver/followup；真正驱动面是 agent.followup + whenIdle。对照官方
 * dsh-headless/lib/index.js 的 run() 源码重写（该 runner 是权威范例）。
 */
async function runCordisAgent(
  cordis: CordisModule,
  opts: RunCordisAgentOptions,
): Promise<{ output: string; rounds: number; hitRecursionLimit: boolean }> {
  // 1. 构造驱动（boot dsh-base + 注入 cmdlineArgs/appExit + 复刻 headless run 逻辑）
  const deliver = await createCordisDriver(opts);

  // 2. 投递任务（systemPrompt 前置拼接——对齐 langgraph-backend 的 SystemMessage 注入语义）
  const fullMessage = opts.systemPrompt
    ? `${opts.systemPrompt}\n\n---\n\n${opts.task}`
    : opts.task;

  let raw: unknown;
  try {
    raw = await deliver(fullMessage);
  } catch (err) {
    if (err instanceof ToolBudgetExhaustedError) {
      return {
        output: '',
        rounds: opts.budgetGuard.count(),
        hitRecursionLimit: true,
      };
    }
    throw err;
  }

  // 3. 提取输出（防御式）
  const output = extractDriverOutput(raw);
  const rounds = Math.max(opts.budgetGuard.count(), 1);
  return { output, rounds, hitRecursionLimit: false };
}

/**
 * 构造 Cordis agent 驱动（rc.2 实际 API——对照官方 dsh-headless runner）。
 *
 * 关键：DSH 是插件架构，正确内嵌姿势是 boot() + loadProfile()（非裸 new Context()），
 * 且必须前置注入 cmdlineArgs（带 get() 方法）+ appExit 两个服务——缺失时插件树 pending。
 *
 * 驱动面：ctx.get('agents')（AgentRegistry）+ ctx.get('agentDefaultModel') +
 * ctx.get('sessions')——agents.create() 产出 agent，agent.followup() 投递，
 * agent.whenIdle() 等待，session.events 提取最终 assistant 文本。
 */
async function createCordisDriver(
  opts: RunCordisAgentOptions,
): Promise<(message: string) => Promise<string>> {
  // 运行时动态 import DSH 插件包（避免 orchestrator 硬依赖这些包）
  // ts-ignore：DSH 第三方包类型实例化过深（TS2589）且无 duck-typing 价值——运行时
  // 已实测验证（createCordisDriver 对照官方 headless runner 源码），宽松断言到 any
  const { boot, loadProfile } = await import('@deepseek-ai/dsh-app-boot');
  const { createUserMessage } = await import('@deepseek-ai/dsh-llm');
  const { SessionId } = await import('@deepseek-ai/dsh-session');
  const { installModelSelection } = await import('@deepseek-ai/dsh-agent');
  const { resolveDshHome } = await import('@deepseek-ai/dsh-home-paths');
  const { randomUUID } = await import('node:crypto');
  const bootFn = boot as unknown as (
    bin: string,
    configPath: string,
    patches: unknown[],
    prepare: (ctx: unknown) => void | Promise<void>,
    baseUrl?: string,
  ) => Promise<unknown>;
  const loadProfileFn = loadProfile as unknown as (
    bin: string,
    name: string,
    installAnchor: string,
    home: string,
    options?: unknown,
  ) => Promise<{ dir?: string; layers?: Array<{ packageName?: string; patches?: unknown[] }> }>;
  const installModelSelectionFn = installModelSelection as unknown as (
    ctx: unknown,
    selection: { current?: unknown; assembled?: unknown },
  ) => unknown;

  // 1. 解析 headless profile 的插件树（dsh-base 是 bundle 非 profile，经 headless profile 取 layers）
  //    home 必须用 DSH 的 resolveDshHome()（返回 ~/.dsh），不是 node:os homedir()（返回 ~）——
  //    否则 configPath 解析到 ~/profiles/headless（缺 .dsh）导致 boot「config file not found」
  const dshHome = resolveDshHome();
  const dshPkgDir = resolveDshPkgDir();
  const profile = await loadProfileFn('dsh', 'headless', dshPkgDir, dshHome);

  // 2. 只取 dsh-base bundle 的 patches（跳过 dsh-headless——避免 headless-runner 自动 exit）
  const basePatches = (profile.layers ?? [])
    .filter((l: { packageName?: string }) => l.packageName === '@deepseek-ai/dsh-base')
    .flatMap((l: { patches?: unknown[] }) => (l.patches ?? []) as unknown[]);

  // 3. boot 的 config 路径（headless profile 的 cordis.yml——空 entry list，靠 patches 组合）
  const configPath = join(dshHome, 'profiles', 'headless', 'cordis.yml');

  return async (message: string): Promise<string> => {
    // 每次投递创建全新 ctx（对齐 headless runner 一次性语义——避免跨 session 串扰）
    // 🔴 argv[1] 守卫覆盖 boot + agent 驱动全程（createArgv1Guard 见其 JSDoc——
    // cordis-plugin-hmr 对无主脚本宿主的兼容，node -e / REPL 场景）
    const restoreArgv1 = createArgv1Guard(__filename);
    try {
    const ctx = await bootFn('dsh', configPath, basePatches, (c) => {
      const rc = c as CordisRuntime;
      rc.provide?.('cmdlineArgs', { get: () => [] });
      rc.provide?.('appExit', async () => { /* 内嵌不退出进程，appExit 空实现 */ });
    }, undefined);

    try {
      // 等 loader 完成
      const get = (ctx as { get?: (k: string) => unknown }).get?.bind(ctx);
      const loader = get?.('loader');
      if (loader && typeof (loader as { await?: () => Promise<void> }).await === 'function') {
        await (loader as { await: () => Promise<void> }).await();
      }

      // v1.4.1 工具注入：loader 完成后 tools 服务就绪——把 sofagent 自定义工具
      // （gate-tools / FORGE worker 工具面）注册进 DSH 会话。注册在 ctx 全局层，
      // 后续 agents.create 的 agent 即可调用。防御式：tools 面缺失/单项失败降级不崩。
      if (opts.tools && opts.tools.length > 0) {
        const n = registerSofagentTools(ctx as CordisRuntime, opts.tools);
        if (n > 0) {
          console.log(`[dsh-backend] sofagent 工具注入：${n}/${opts.tools.length} 个已注册进 DSH 会话`);
        }
      }

      const agents = get?.('agents') as {
        create?: (o: unknown) => Promise<{ agent: AgentHandle }>;
      } | undefined;
      const defaultModel = get?.('agentDefaultModel') as {
        currentSelection?: () => { provider: string; model: string };
      } | undefined;
      const sessions = get?.('sessions') as {
        flush?: (s: unknown) => Promise<unknown>;
      } | undefined;

      if (!agents || typeof agents.create !== 'function') {
        throw new DshCapabilityMissingError('agents 服务面无 create 方法（rc.2 AgentRegistry 契约）');
      }

      const selection = defaultModel?.currentSelection?.() ?? { provider: 'deepseek', model: '' };
      const { agent } = await agents.create({
        sessionId: SessionId(`session-${randomUUID()}`),
        meta: { cwd: process.cwd() },
        agentOptions: { provider: selection.provider, model: selection.model },
        setup: (agentCtx: unknown) => {
          installModelSelectionFn(agentCtx, { current: selection, assembled: undefined });
        },
      });

      await agent.whenIdle();
      const firstSeq = agent.session.seq;
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: message }],
        source: { kind: 'user' },
      }));
      await agent.whenIdle();
      await sessions?.flush?.(agent.session);

      return summarizeSession(agent.session.events, firstSeq);
    } finally {
      await (ctx as { fiber?: { dispose?: () => Promise<void> } }).fiber?.dispose?.().catch(() => {});
    }
    } finally {
      // argv[1] 守卫恢复（覆盖 boot + agent 驱动全程）
      restoreArgv1();
    }
  };
}

/** agent 句柄最小契约（rc.2 dsh-agent-loop AgentHandle 面） */
interface AgentHandle {
  whenIdle(): Promise<unknown>;
  followup(msg: unknown): unknown;
  session: {
    seq: number;
    events: Array<{
      seq: number;
      type: string;
      data?: unknown;
    }>;
  };
}

/** 从 session 事件流聚合最终 assistant 文本（对照 dsh-headless summarize） */
function summarizeSession(events: AgentHandle['session']['events'], firstSeq: number): string {
  let started = false;
  let text = '';
  for (const event of events) {
    if (event.seq < firstSeq) continue;
    if (event.type === 'turn/start') { started = true; continue; }
    if (!started) continue;
    if (event.type === 'assistant/message') {
      const data = event.data as { message?: { content?: Array<{ type: string; text?: string }> } } | undefined;
      const blocks = data?.message?.content ?? [];
      const joined = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
      if (joined !== '') text = joined;
    }
  }
  return text;
}

/** 解析 @deepseek-ai/dsh 包目录（loadProfile 的 installAnchor） */
function resolveDshPkgDir(): string {
  const pkgJson = require_.resolve('@deepseek-ai/dsh/package.json');
  return dirname(pkgJson);
}

/** 提取 agent 驱动输出（防御式——兼容 string / {output} / {result} / {text}） */
function extractDriverOutput(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object') {
    const r = raw as { output?: unknown; result?: unknown; text?: unknown; content?: unknown };    for (const key of ['output', 'result', 'text', 'content'] as const) {
      const v = r[key];
      if (typeof v === 'string' && v.length > 0) return v;
    }
  }
  return JSON.stringify(raw);
}

// ════════════════════════════════════════
// 工厂：createDshBackend（对齐 execution-backend.ts 层 1 守卫的新契约）
// ════════════════════════════════════════

/**
 * 🔴 argv[1] 守卫（cordis-plugin-hmr 兼容）——node -e / REPL 等无主脚本宿主下
 * argv[1] 是 undefined，hmr 插件的 [cordis.init] resolve(process.argv[1]) 会炸
 * 「paths[0] must be of type string」→ 整棵插件树挂载失败（内嵌静默降级 CLI）。
 *
 * 宿主语义对齐官方 runner（dsh CLI 的 argv[1] = dsh bin）：内嵌宿主主脚本 = fallback 值。
 *
 * @param fallback 主脚本占位路径（内嵌场景传 __filename）
 * @returns 恢复函数——boot 全程结束后调用（undefined 时 delete 保持稀疏数组原状）
 */
export function createArgv1Guard(fallback: string): () => void {
  const saved: string | undefined = process.argv[1];
  if (typeof saved === 'string' && saved !== '') return () => {}; // 有主脚本无需守卫
  process.argv[1] = fallback;
  return () => {
    if (saved === undefined) delete process.argv[1];
    else process.argv[1] = saved;
  };
}

/**
 * 创建 DSH 后端。
 *
 * @param cordisMod cordis 模块（真实导出 { Context }，由 execution-backend.ts
 *   层 1 守卫（isCordisModule）验证后传入——不再是猜的 createCordisRuntime）
 * @param agentPlugin 可选的 DSH agent-loop 插件（正式版 @deepseek-ai/dsh 提供；
 *   未提供时层 2 能力守卫会在 execute 时探测，探测不到即抛 DshCapabilityMissingError）
 * @returns ExecutionBackend 实现
 */
export function createDshBackend(
  cordisMod: CordisModule,
  agentPlugin?: { plugin: CordisPlugin },
): ExecutionBackend {
  if (!cordisMod || typeof cordisMod.Context !== 'function') {
    throw new Error('[dsh-backend] cordis 模块无效：缺少 Context 构造器（真实入口 new Context()）');
  }

  const backend: ExecutionBackend = {
    name: 'dsh',

    async execute(task: ExecutionTask): Promise<ExecutionResult> {
      // Trajectory 采集器（每任务一个——agentId 用 modelName+时间戳保证可区分）
      const agentId = `dsh-${task.modelName ?? 'default'}-${Date.now()}`;
      const trajectory = createTrajectoryCollector({ agentId });

      const result = await runCordisAgent(cordisMod, {
        systemPrompt: task.systemPrompt,
        task: task.task,
        tools: convertTools(task.tools),
        modelConfig: task.modelConfig,
        recursionLimit: task.recursionLimit,
        budgetGuard: createBudgetGuard(task.toolBudget),
        trajectory,
        agentPlugin: agentPlugin?.plugin,
      });

      return {
        output: result.output,
        rounds: result.rounds,
        hitRecursionLimit: result.hitRecursionLimit,
        hardBreak: result.hitRecursionLimit,
        debugLogs: trajectory.records.slice(0, 100).map((r) => ({
          agentId,
          action: `${r.kind}:${r.event}`,
          timestamp: r.ts,
        })),
      };
    },

    async close() {
      // Cordis 运行时按任务创建按任务销毁（runCordisAgent finally dispose）——
      // 无进程级资源需要释放
    },
  };

  return backend;
}

// ════════════════════════════════════════
// CLI 桥接后端（rc 期适配路径）· v1.3.9 增量
// ════════════════════════════════════════

/**
 * 解析 @deepseek-ai/dsh 的 CLI 入口（lib/bin.js）。
 * rc.8 是纯 CLI 包（main: undefined / bin: { dsh: lib/bin.js } / 无 exports）——
 * import('@deepseek-ai/dsh') 拿不到库入口，只能定位 bin 文件路径 spawn 子进程。
 */
function resolveDshCliBin(): string {
  // package.json 是文件路径，require.resolve 可解析（无 main 也不影响）
  const pkgJson = require_.resolve('@deepseek-ai/dsh/package.json');
  return join(dirname(pkgJson), 'lib', 'bin.js');
}

/**
 * 创建 DSH CLI 桥接后端（rc.8 形态：纯 CLI + headless profile 单任务执行）。
 *
 * 为什么存在：@deepseek-ai/dsh@0.1.0-rc.8 是纯 CLI 包（无库入口），
 * Cordis 内嵌路线（runCordisAgent）在 rc 期走不通；但 DSH 官方提供
 * `dsh --profile headless "<task>"` —— 单任务执行、打印最终 assistant 文本后退出，
 * 语义与 ExecutionBackend.execute 完全对齐。适配姿势 = spawn 子进程桥接。
 *
 * 能力边界（当前正式形态——DSH 包虽 rc 但执行能力已验证投产，不等正式版）：
 * - ✅ 单任务文本执行（systemPrompt 前置拼接进 task，与 runCordisAgent 语义对齐）
 * - ✅ DSH 自带工具链实测可用：fs（读/写文件）+ bash（受 DSH_PERMISSION_MODE 控制）
 *   ——权限模式环境变量：`DSH_PERMISSION_MODE=danger-full-access` 全权限（macOS 无
 *   sandbox-exec 沙箱后端时 workspace-write 的 bash 会被拒）；sofagent 侧透传
 *   `SOFAGENT_DSH_PERMISSION_MODE`（缺省 workspace-write 安全默认）
 * - ⚠️ sofagent 自定义工具（task.tools）在 CLI 桥接下不生效（子进程无法注入）——
 *   传入时仅记录 WARN；自定义工具注入 = 库内集成（dsh-base 聚合含全套核心服务），
 *   排下版开发项
 * - ⚠️ 预算熔断退化为外层超时（headless 无工具循环，天然无工具预算概念）
 * - 模型：透传 modelConfig.apiKeyEnv 对应的 key（默认 DEEPSEEK_API_KEY）给子进程
 * - 技术升级路径：DSH 包正式版发布后可切 Cordis 内嵌（runCordisAgent），无需改本桥接语义
 */
export function createDshCliBackend(): ExecutionBackend {
  let binPath: string;
  try {
    binPath = resolveDshCliBin();
  } catch {
    throw new Error(
      '[dsh-backend] @deepseek-ai/dsh 未安装，无法启用 DSH CLI 桥接。' +
      '安装：cd <repo> && pnpm add @deepseek-ai/dsh@0.1.0-rc.8（8GB 机器 npm install 会 OOM，用 pnpm）'
    );
  }

  const backend: ExecutionBackend = {
    name: 'dsh',

    async execute(task: ExecutionTask): Promise<ExecutionResult> {
      // sofagent 自定义工具边界：CLI 子进程无法注入 task.tools——
      // DSH 自带 bash/fs 工具链可用；自定义工具注入已在内嵌路径交付
      // （registerSofagentTools——cordis 内嵌形态，rc 守卫放行后生效）
      if (task.tools && task.tools.length > 0) {
        console.warn(
          `[dsh-backend] DSH CLI 桥接下 sofagent 自定义工具（${task.tools.length} 个）不生效——` +
          `DSH 自带 bash/fs 工具链可用；自定义工具注入走内嵌路径（registerSofagentTools）`
        );
      }

      // systemPrompt 前置拼接（对齐 runCordisAgent 的 fullMessage 构造语义）
      const fullMessage = task.systemPrompt
        ? `${task.systemPrompt}\n\n---\n\n${task.task}`
        : task.task;

      // API key 透传：优先 modelConfig.apiKeyEnv，缺省 DEEPSEEK_API_KEY
      const keyEnv = String(task.modelConfig?.apiKeyEnv ?? 'DEEPSEEK_API_KEY');
      const apiKey = process.env[keyEnv] ?? process.env.DEEPSEEK_API_KEY ?? '';
      const env: NodeJS.ProcessEnv = { ...process.env };
      if (apiKey) env.DEEPSEEK_API_KEY = apiKey;

      // DSH 权限模式透传：SOFAGENT_DSH_PERMISSION_MODE（缺省 workspace-write 安全默认）。
      // danger-full-access = bash/fs 全权限（macOS 无 sandbox-exec 时 bash 需要它）
      const dshPermMode = process.env.SOFAGENT_DSH_PERMISSION_MODE ?? 'workspace-write';
      if (dshPermMode) env.DSH_PERMISSION_MODE = dshPermMode;

      const startedAt = Date.now();
      const result = await new Promise<{ output: string; rounds: number; timedOut: boolean }>(
        (resolve, reject) => {
          execFile(
            process.execPath,
            [binPath, '--profile', 'headless', fullMessage],
            {
              // FORGE 步零（b-fix workspace 对准 worktree）：spawnWorker 已把
              // FORGE_WORKTREE_ROOT 注入 worker env，此前 execFile 不传 cwd——
              // DSH 子进程落在父进程 cwd（FORGE 主仓），bash/fs 相对路径全部
              // 打到主仓工作区（run-01 b-fix 产物落主仓根因）。
              // worktree 隔离时 DSH 子进程 cwd 对准副本；未设则 undefined（继承）。
              cwd: process.env.FORGE_WORKTREE_ROOT || undefined,
              env,
              timeout: task.recursionLimit ? Math.max(60_000, task.recursionLimit * 1000) : 120_000,
              maxBuffer: 4 * 1024 * 1024,
            },
            (err, stdout, stderr) => {
              if (err && !(err as { killed?: boolean }).killed) {
                reject(
                  new Error(
                    `[dsh-backend] headless 执行失败：${(err as Error).message}` +
                    (stderr ? `\nstderr: ${stderr.slice(0, 800)}` : '')
                  )
                );
                return;
              }
              const timedOut = Boolean((err as { killed?: boolean })?.killed);
              // headless 打印最终 assistant 文本到 stdout；err.killed 是超时截断
              resolve({
                output: stdout.trim(),
                rounds: 1,
                timedOut,
              });
            },
          );
        },
      );

      return {
        output: result.output,
        rounds: result.rounds,
        hitRecursionLimit: result.timedOut,
        hardBreak: result.timedOut,
        debugLogs: [
          {
            agentId: `dsh-cli-${Date.now()}`,
            action: `headless:${result.timedOut ? 'timeout' : 'ok'}`,
            timestamp: new Date(startedAt).toISOString(),
          },
        ],
      };
    },

    async close() {
      // 无进程级资源（execFile 子进程随回调结束回收）
    },
  };

  return backend;
}
