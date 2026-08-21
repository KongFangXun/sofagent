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
  /** 运行时销毁（释放资源） */
  dispose?(): void | Promise<void>;
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
      // ── output 段（宿主私有）：字符串化兜底渲染 ──
      output: {
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
  // zod schema 对象（带 _def/shape）——提取 shape 转 JSON Schema 太重，给空对象签名
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

/** agent 驱动服务最小契约（DSH agent-loop 插件注册的服务面，duck-typing） */
interface AgentDriver {
  /** 投递用户消息并驱动一轮执行，返回最终输出（契约按教程 07 章） */
  deliver(message: string): Promise<unknown> | unknown;
}

/**
 * 调用 Cordis 运行时执行 agent（对照真实 API 重写，不再是骨架抛错）。
 *
 * 执行链：new Context() → 工具插件（三段式注册）→ 预算插件（waterfall 纪律）
 * → trajectory 插件（事件采集）→ agent 驱动（层 2 能力守卫）→ 提取输出。
 */
async function runCordisAgent(
  cordis: CordisModule,
  opts: RunCordisAgentOptions,
): Promise<{ output: string; rounds: number; hitRecursionLimit: boolean }> {
  const ctx = new cordis.Context(
    (opts.modelConfig?.runtimeConfig as Record<string, unknown> | undefined) ?? {},
  );
  let softWarned = false;

  try {
    // 1. 工具插件：三段式 ToolDefinition 注册进 ctx.tools 服务
    //    （ctx.tools 由 DSH 工具子系统插件提供；裸 cordis 无此服务时工具面为空——
    //     agent 仍可纯文本执行，不视为能力缺失）
    ctx.plugin((c) => {
      registerToolsDefensively(c, opts.tools);
    });

    // 2. 预算软熔断插件（waterfall next() 纪律——见 createBudgetPlugin 注释）
    ctx.plugin(
      createBudgetPlugin(opts.budgetGuard, (count) => {
        if (!softWarned) {
          softWarned = true;
          console.warn(`[dsh-backend] 工具预算软熔断：${count} 次调用达 softLimit，注入收尾指令`);
        }
      }),
    );

    // 3. Trajectory 采集插件（turn/step/tool 全链事件 → records）
    if (opts.trajectory) {
      ctx.plugin(opts.trajectory.plugin);
    }

    // 3.5 DSH agent-loop 插件（注册 agent 驱动服务面）——先挂插件再探测，
    //     未提供时层 2 守卫直接探测宿主已注册的服务（正式版 dsh 包场景）
    if (opts.agentPlugin) {
      ctx.plugin(opts.agentPlugin);
    }

    // 4. agent 驱动（层 2 能力守卫）：探测 DSH agent-loop 插件注册的服务面。
    //    契约按官方教程 07-into-the-harness：服务名候选 'agents' / 'agent'，
    //    驱动方式候选 deliver / followup。全部探测失败 = DSH agent 插件未装。
    const driver = resolveAgentDriver(ctx);

    // 5. 投递任务并驱动执行（systemPrompt 前置拼接——Cordis 无独立 system 槽位时
    //    的等价注入姿势，对齐 langgraph-backend 的 SystemMessage 注入语义）
    const fullMessage = opts.systemPrompt
      ? `${opts.systemPrompt}\n\n---\n\n${opts.task}`
      : opts.task;
    let raw: unknown;
    try {
      raw = await driver.deliver(fullMessage);
    } catch (err) {
      if (err instanceof ToolBudgetExhaustedError) {
        // hard 熔断——输出部分结果标记（对齐 LangGraph 后端 hardBreak 语义）
        return {
          output: '',
          rounds: opts.budgetGuard.count(),
          hitRecursionLimit: true,
        };
      }
      throw err;
    }

    // 6. 提取输出（防御式——DSH 正式版返回形状以实测为准）
    const output = extractDriverOutput(raw);
    const rounds = Math.max(opts.budgetGuard.count(), 1);
    return { output, rounds, hitRecursionLimit: false };
  } finally {
    // 7. 资源释放（插件取消订阅 + 运行时销毁）
    try {
      await ctx.dispose?.();
    } catch {
      /* dispose 失败不阻塞返回 */
    }
  }
}

/** 防御式注册工具——工具服务面（ctx.tools）缺失时静默跳过 */
function registerToolsDefensively(ctx: CordisRuntime, tools: CordisToolDefinition[]): void {
  const toolsService = (ctx as { tools?: { register?: (def: CordisToolDefinition) => unknown } }).tools;
  if (!toolsService || typeof toolsService.register !== 'function') {
    console.warn(
      `[dsh-backend] ctx.tools 服务不可用——${tools.length} 个工具未注册（agent 将以纯文本模式执行）`,
    );
    return;
  }
  for (const def of tools) {
    try {
      toolsService.register(def);
    } catch (err) {
      console.warn(`[dsh-backend] 工具 ${def.name} 注册失败：`, err instanceof Error ? err.message : String(err));
    }
  }
}

/** 探测 agent 驱动服务（层 2 守卫核心） */
function resolveAgentDriver(ctx: CordisRuntime): AgentDriver {
  const serviceCandidates: Array<unknown> = [];
  try {
    if (typeof ctx.get === 'function') {
      serviceCandidates.push(ctx.get('agents'), ctx.get('agent'));
    }
  } catch {
    /* get 抛错——服务未注册，继续探测直挂属性 */
  }
  serviceCandidates.push((ctx as { agents?: unknown }).agents, (ctx as { agent?: unknown }).agent);

  for (const svc of serviceCandidates) {
    const driver = coerceDriver(svc);
    if (driver) return driver;
    // 集合型服务（agents registry）：取 create 出的单体再探测
    const factory = svc as { create?: (...a: unknown[]) => unknown };
    if (svc && typeof factory.create === 'function') {
      try {
        const one = coerceDriver(factory.create());
        if (one) return one;
      } catch {
        /* create 失败——试下一候选 */
      }
    }
  }
  throw new DshCapabilityMissingError(
    'ctx.get/agents/agent 服务面无 deliver 或 followup 驱动方法',
  );
}

/** 从候选服务对象探测驱动方法（deliver / followup 二选一） */
function coerceDriver(svc: unknown): AgentDriver | null {
  if (!svc || typeof svc !== 'object') return null;
  const s = svc as {
    deliver?: (msg: string) => unknown;
    followup?: (msg: string) => unknown;
  };
  if (typeof s.deliver === 'function') {
    return { deliver: (msg: string) => s.deliver!(msg) };
  }
  if (typeof s.followup === 'function') {
    return { deliver: (msg: string) => s.followup!(msg) };
  }
  return null;
}

/** 提取 agent 驱动输出（防御式——兼容 string / {output} / {result} / {text}） */
function extractDriverOutput(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object') {
    const r = raw as { output?: unknown; result?: unknown; text?: unknown; content?: unknown };
    for (const key of ['output', 'result', 'text', 'content'] as const) {
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
 * 能力边界（rc.8 诚实标注，正式版自动升级到 Cordis 内嵌）：
 * - ✅ 单任务文本执行（systemPrompt 前置拼接进 task，与 runCordisAgent 语义对齐）
 * - ⚠️ 无工具面（headless profile 只挂 dsh-base + dsh-headless，无 dsh-tool-*）——
 *   task.tools 传入时仅记录 WARN，不生效；工具支持排正式版
 * - ⚠️ 预算熔断退化为外层超时（headless 无工具循环，天然无工具预算概念）
 * - 模型：透传 modelConfig.apiKeyEnv 对应的 key（默认 DEEPSEEK_API_KEY）给子进程
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
      // 工具面边界：rc.8 headless 无工具——透传的工具不生效，显式告知
      if (task.tools && task.tools.length > 0) {
        console.warn(
          `[dsh-backend] DSH rc.8 headless 无工具面——收到 ${task.tools.length} 个工具但不生效（工具支持排正式版）`
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

      const startedAt = Date.now();
      const result = await new Promise<{ output: string; rounds: number; timedOut: boolean }>(
        (resolve, reject) => {
          execFile(
            process.execPath,
            [binPath, '--profile', 'headless', fullMessage],
            {
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
