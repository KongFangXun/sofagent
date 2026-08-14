// dsh-backend.ts · v1.3.4 增量 · DSH Cordis 运行时适配器
//
// 接入门禁结论（2026-08-14）：
// DSH（DeepSeek Harness）候选包名（deepseek-harness / @deepseek-ai/harness /
// @dsh/core / @deepseek-harness/core）实测全部 404——npm-public PR #2519
// 2026-08-13 刚合并但包尚未实际可安装。
//
// 当前状态：本文件是完整的适配器骨架——一旦 DSH 上架 npm，execution-backend.ts
// 的 tryLoadDshBackend() 动态 import 成功，会调用 createDshBackend(mod) 挂载。
// 上架前 tryLoadDshBackend 返回 null，自动 fallback 到 LangGraph。
//
// DSH Cordis 运行时的工具格式适配：
// ExecutionTask.tools 是通用格式（LangGraph ToolInterface），DSH Cordis 插件
// 需要不同的工具格式。适配器内部做格式转换——只适配协议，不替换工具实现
// （保住 audit/progress tool wrapper）。
//
// 工具预算软熔断对齐：
// LangGraph 后端经 stateModifier 注入 HumanMessage 实现；
// DSH 后端用等价机制（具体取决于 Cordis 运行时的消息注入 API——上架后实测）。

import type { ExecutionBackend, ExecutionTask, ExecutionResult } from '../execution-backend.js';

/**
 * DSH Cordis 运行时模块契约（DSH 上架后确认实际导出名）。
 * 当前基于 npm-public PR #2519 的描述猜测 createCordisRuntime 入口。
 */
export interface DshModule {
  /** 创建 Cordis 运行时（PR #2519 描述的入口） */
  createCordisRuntime: (opts?: Record<string, unknown>) => unknown;
}

/**
 * 创建 DSH 后端。
 *
 * @param dshMod DSH 模块（由 execution-backend.ts 的动态 import 加载后传入）
 * @returns ExecutionBackend 实现
 */
export function createDshBackend(dshMod: DshModule): ExecutionBackend {
  if (!dshMod || typeof dshMod.createCordisRuntime !== 'function') {
    throw new Error('[dsh-backend] DSH 模块无效：缺少 createCordisRuntime');
  }

  // 创建 Cordis 运行时实例（DSH 上架后确认实际 API）
  const runtime = dshMod.createCordisRuntime({
    // DSH 配置（上架后按实际 API 补充）
  });

  const backend: ExecutionBackend = {
    name: 'dsh',

    async execute(task: ExecutionTask): Promise<ExecutionResult> {
      // 1. 工具格式转换：LangGraph ToolInterface → DSH Cordis 插件格式
      //    ⚠️ 只适配协议，不替换工具实现（保住 audit/progress wrapper）
      const dshTools = convertTools(task.tools);

      // 2. 工具预算软熔断（行为对齐 LangGraph stateModifier）
      //    DSH 的消息注入 API 上架后实测确认——当前用等价机制占位
      const budgetGuard = createBudgetGuard(task.toolBudget);

      // 3. 调用 Cordis 运行时执行 agent
      //    ⚠️ 以下是骨架实现——DSH 上架后需对照实际 Cordis API 修正调用方式
      const result = await runCordisAgent(runtime, {
        systemPrompt: task.systemPrompt,
        task: task.task,
        tools: dshTools,
        modelConfig: task.modelConfig,
        recursionLimit: task.recursionLimit,
        budgetGuard,
      });

      return {
        output: result.output,
        rounds: result.rounds,
        hitRecursionLimit: result.hitRecursionLimit,
        hardBreak: result.hitRecursionLimit,
      };
    },

    async close() {
      // Cordis 运行时资源释放（上架后确认实际 API）
      if (runtime && typeof (runtime as { dispose?: () => void }).dispose === 'function') {
        (runtime as { dispose: () => void }).dispose();
      }
    },
  };

  return backend;
}

/**
 * 工具格式转换：LangGraph ToolInterface → DSH Cordis 插件格式。
 * 只适配协议（字段名映射），不替换工具实现——保住 audit/progress wrapper。
 */
function convertTools(tools: unknown[]): unknown[] {
  // ⚠️ DSH 上架后对照 Cordis 插件格式实测确认。
  // 当前占位：原样透传（假设 DSH 接受通用 tool 格式）。
  return tools;
}

/**
 * 创建工具预算软熔断守卫（行为对齐 LangGraph 的 stateModifier 注入）。
 */
function createBudgetGuard(budget?: { softLimit: number; hardLimit: number }): {
  check: (toolCallCount: number) => 'ok' | 'soft' | 'hard';
} {
  if (!budget) {
    return { check: () => 'ok' as const };
  }
  return {
    check: (count: number) => {
      if (count >= budget.hardLimit) return 'hard' as const;
      if (count >= budget.softLimit) return 'soft' as const;
      return 'ok' as const;
    },
  };
}

/**
 * 调用 Cordis 运行时执行 agent（骨架——上架后对照实际 API 修正）。
 */
async function runCordisAgent(
  _runtime: unknown,
  opts: {
    systemPrompt: string;
    task: string;
    tools: unknown[];
    modelConfig?: Record<string, unknown>;
    recursionLimit?: number;
    budgetGuard: { check: (count: number) => 'ok' | 'soft' | 'hard' };
  }
): Promise<{ output: string; rounds: number; hitRecursionLimit: boolean }> {
  // ⚠️ 骨架实现——DSH 上架后对照 Cordis 运行时实际 API 重写。
  // 当前抛错：如果代码走到这里说明 tryLoadDshBackend 误判成功（不该发生）。
  throw new Error(
    '[dsh-backend] runCordisAgent 骨架未实现——DSH 尚未上架（2026-08-14 实测 404）。' +
    '此错误不应出现：tryLoadDshBackend 应在 DSH 上架前返回 null。' +
    '如果看到此错误，请检查 execution-backend.ts 的候选包名列表。'
  );
}
