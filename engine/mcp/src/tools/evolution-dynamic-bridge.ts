// ============================================================
// evolution-dynamic-bridge.ts · L4 进化工具动态面桥（v1.4.5 第七章三）
//
// MCP 侧消费 orchestrator 的 L4 工具进化台账（tool-evolution.ts）：
//   1. registerEvolvedTools()：读注册态候选 → 注册进 getDynamicTools()
//      动态面（复用 v1.3.0 MA1 动态注册基建——不另起注册表）
//   2. invokeEvolvedTool()：按工具名调用生成器（commons_invoke 的
//      L4 分发出口——动态工具面被 commons_invoke 命中时走这里）
//
// 🔴 工具数口径（v1.4.5 第七章三验收铁律）：
//   - 静态计数 = tool-registry.ts TOOLS 顶层 name 数 = 83（本版
//     +train_serve/train_compliance/train_deliverable 三件）；
//   - L4 进化工具**不进 83 静态计数**——check-version.sh 只数
//     tool-registry.ts 顶层 name，动态面天然不在其守卫面内；
//   - tools/list 实际返回数 = 83 + 动态注册数（getDynamicTools
//     合并 memory_backends 与 L4 进化两个来源）；
//   - 本文件不写死任何计数——一切以 TOOLS.length 与动态表实时值为准。
//
// 缺省语义：台账无注册态候选 → 注册零个（动态面默认空）——L4 是
// 运行时进化能力，出厂态不新增任何工具面。
// ============================================================

import { registerDynamicTool, getDynamicTool, clearDynamicTools } from './memory-backend';

// ────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────

/** L4 进化工具调用结果 */
export interface EvolvedToolInvokeResult {
  ok: boolean;
  toolName: string;
  output?: unknown;
  error?: string;
}

// ────────────────────────────────────────────────────────────
// 注册：台账 → 动态面
// ────────────────────────────────────────────────────────────

/** L4 进化工具生成器解析表（注册桥装配——toolName → 生成器路径；handler 递归防护） */
const generatorRegistry = new Map<string, { modulePath: string; exportName: string }>();

/**
 * 读取 L4 注册态候选并注册进动态工具面。
 *
 * 幂等：同名覆盖（registerDynamicTool 语义）；MCP server 启动时
 * 调一次 + 每次注册态变更后可重调。
 *
 * 依赖注入：getTools 由调用方传入（避免 mcp → orchestrator 的
 * 编译期强耦合——测试注入 mock，生产注入 orchestrator 导出）。
 *
 * @param deps.getTools 取注册态候选（生产：orchestrator 的 getApprovedEvolvedTools）
 * @param deps.loadGenerator 加载生成器模块（生产：require；测试注入 mock）
 * @returns 注册的工具名数组
 */
export function registerEvolvedTools(
  deps: {
    getTools: () => Array<{
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
      generatorModule: string;
      generatorExport: string;
      candidateId: string;
    }>;
    loadGenerator: (modulePath: string) => unknown;
  },
): string[] {
  const registered: string[] = [];
  for (const tool of deps.getTools()) {
    // 生成器解析表先行（invokeEvolvedTool 直调生成器——防 handler 壳层递归）
    generatorRegistry.set(tool.name, { modulePath: tool.generatorModule, exportName: tool.generatorExport });
    registerDynamicTool({
      name: tool.name,
      description: `L4 进化工具（人审注册）: ${tool.description}`,
      inputSchema: {
        type: 'object',
        properties: {},
        ...(tool.inputSchema && typeof tool.inputSchema === 'object'
          ? (tool.inputSchema as { properties?: Record<string, unknown> })
          : {}),
      },
      handler: async (args) => {
        const r = await invokeEvolvedTool(tool.name, args, {
          loadGenerator: deps.loadGenerator,
          generatorResolver: (n) => generatorRegistry.get(n),
        });
        if (!r.ok) throw new Error(r.error);
        return r.output;
      },
    });
    registered.push(tool.name);
  }
  return registered;
}

// ────────────────────────────────────────────────────────────
// 调用：动态面 handler 出口（commons_invoke 可调）
// ────────────────────────────────────────────────────────────

/**
 * 按名调用一个 L4 进化工具（动态注册的生成器）。
 *
 * 分发优先级说明：mcp-server 的 tools/call 已是「动态工具优先路由」
 * （getDynamicTool 先于静态 switch）——commons_invoke 侧命中 L4 工具名
 * 时同样经此出口执行生成器。生成器签名：
 *   export default async function generator(input: unknown): Promise<unknown>
 *
 * 双层出口（防递归）：commons_invoke 的动态命中分支会先调
 * dynamicTool.handler —— handler 本身即生成器执行（注册时装配），
 * 因此 handler 内部不得再调 invokeEvolvedTool（会套一层结果壳）。
 * handler 直调（deps.loadGenerator(generatorModule)）执行生成器本体。
 *
 * @param toolName 动态工具名
 * @param args 调用入参
 * @param deps.loadGenerator 加载生成器（注入）
 * @param deps.generatorResolver 可选——由注册桥提供「toolName→生成器路径」
 *        解析（缺省走动态表 handler——兼容外部直接调用）
 */
export async function invokeEvolvedTool(
  toolName: string,
  args: Record<string, unknown>,
  deps: {
    loadGenerator: (modulePath: string) => unknown;
    generatorResolver?: (name: string) => { modulePath: string; exportName: string } | undefined;
  },
): Promise<EvolvedToolInvokeResult> {
  // 优先走注册桥装配的生成器直调（避免 handler 壳层递归）
  const resolved = deps.generatorResolver?.(toolName);
  if (resolved) {
    try {
      const mod = deps.loadGenerator(resolved.modulePath) as Record<string, unknown> | undefined;
      const gen = mod?.[resolved.exportName];
      if (typeof gen !== 'function') {
        return { ok: false, toolName, error: `生成器导出 ${resolved.exportName} 不是函数（模块 ${resolved.modulePath}）` };
      }
      const output = await (gen as (input: unknown) => Promise<unknown>)(args);
      return { ok: true, toolName, output };
    } catch (err) {
      return { ok: false, toolName, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // 回退：查动态面注册表（含 memory_backends 动态工具——执行其 handler）
  const dynamicTool = getDynamicTool(toolName);
  if (!dynamicTool) {
    return { ok: false, toolName, error: `动态工具「${toolName}」未注册（先经 L4 管线注册）` };
  }
  try {
    const output = await dynamicTool.handler(args);
    return { ok: true, toolName, output };
  } catch (err) {
    return { ok: false, toolName, error: err instanceof Error ? err.message : String(err) };
  }
}

// ────────────────────────────────────────────────────────────
// 测试辅助（测试隔离用——生产代码不调）
// ────────────────────────────────────────────────────────────

/** 清空动态面（测试隔离——与 memory-backend 的 clearDynamicTools 同源） */
export function resetEvolvedTools(): void {
  clearDynamicTools();
  generatorRegistry.clear();
}
