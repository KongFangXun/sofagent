// execution-backend.ts · v1.3.6 增量 · 编排层与执行层分离
//
// 设计来源：DeepSeek Harness（DSH）「一切皆插件」Cordis 运行时 +
//           sofagent「确定性审计依赖显式图结构」铁律的融合。
//
// 边界规则：
// - 编排层（LangGraph StateGraph）永远不换——24 条 git diff 规则 + HMAC 链 +
//   DAG 波次审计 + decision-log 全部依赖显式图结构。
// - 执行层可换——只要实现 ExecutionBackend 接口，任何框架都能挂载
//   （DSH Cordis / LangGraph createReactAgent / 未来其他框架）。
// - execute 是唯一必须实现的方法——审计（git diff）和回溯（git snapshot）
//   不是执行后端的事，是编排层在 execute 前后做的。执行后端只管「给我任务，
//   给我结果」。但 toolBudget 软熔断和工具 wrapper 透传是所有后端的强制义务。
//
// 接入门禁结论（2026-08-14 核实更新）：@deepseek-ai/cordis@4.0.1 + @deepseek-ai/dsh@0.1.0-rc.6
// 均已 public（PR #2519 合并）。候选列表优先试 cordis（2 依赖轻量），再试 dsh（61 依赖兜底）。
// 当前仍走 fallback LangGraph——因为 rc 版本被版本守卫拦截 + runCordisAgent 是骨架。
// rc 转正式版 + 骨架补全（v1.3.6）后自动切换，无需改代码。

/**
 * 执行后端契约——编排层通过这个接口调用执行层。
 * 任何实现这个接口的后端都能挂载：DSH Cordis / LangGraph createReactAgent / 未来其他框架。
 */
export interface ExecutionBackend {
  /** 后端名称（用于日志/审计记录） */
  readonly name: 'dsh' | 'langgraph' | string;

  /**
   * 执行一个 agent 任务。
   * 编排层在调用 execute 前后做审计/回溯——execute 本身只管「跑 agent 拿结果」。
   *
   * ⚠️ 工具 wrapper 透传：task.tools 可能已被 tool wrapper 包裹
   * （audit-middleware 运行时审计 / progress-middleware 进度监控，v1.3.0 模式），
   * 后端必须原样透传调用，禁止重包装或替换工具实现，否则运行时审计能力丢失。
   *
   * ⚠️ 工具预算软熔断：所有后端强制实现——超 softLimit 注入「立即收尾」指令，
   * 撞 hardLimit 立即中断。run-01 教训：1119 次工具调用零产出。
   */
  execute(task: ExecutionTask): Promise<ExecutionResult>;

  /** 优雅关闭（释放资源） */
  close?(): Promise<void>;
}

/**
 * 执行任务入参
 */
export interface ExecutionTask {
  /** 系统提示词（从 SKILL.md 四层加载链注入） */
  systemPrompt: string;
  /** 用户任务描述 */
  task: string;
  /**
   * 可用工具列表（MCP tools / sf_read / sf_write / run_bash 等）。
   * ⚠️ 工具可能已被 tool wrapper 包裹（audit-middleware 运行时审计 /
   * progress-middleware 进度监控，v1.3.0 模式）——后端必须原样透传调用，
   * 禁止重包装或替换工具实现，否则运行时审计能力丢失。
   */
  tools: unknown[];
  /** 模型名称（可选，缺省用后端默认） */
  modelName?: string;
  /**
   * 模型配置（可选）——承载 FORGE profile 体系：temperature、
   * 步骤级 maxTokens 覆盖、max-old-space-size 等（FORGE/models/profile.mjs）。
   */
  modelConfig?: Record<string, unknown>;
  /**
   * 工具预算（所有后端强制实现）——超 softLimit 注入「立即收尾」指令，
   * 撞 hardLimit 立即中断。run-01 教训：1119 次工具调用零产出。
   * LangGraph 后端经 stateModifier 注入 HumanMessage 实现；
   * DSH 后端须实现等价机制（机制自选，行为必须对齐）。
   */
  toolBudget?: { softLimit: number; hardLimit: number };
  /** 递归限制（防 worker 跑飞） */
  recursionLimit?: number;
  /**
   * LangGraph 后端专用：自定义 stateModifier 工厂函数。
   *
   * 为什么这个 LangGraph 专属字段出现在通用接口里：
   * FORGE driver 的 stateModifier 逻辑极其精细（消息裁剪 + tool_calls 配对清洗 +
   * 工具预算软熔断 + 写报告窗口），沉淀了 run-01 到 run-12 的全部教训。
   * 把这段逻辑搬进 langgraph-backend 会导致：
   *   ① 改动巨大（~200 行精细逻辑迁移），回归风险极高
   *   ② FORGE driver 失去对 stateModifier 的直接控制（调试困难）
   *   ③ DSH 后端不需要 stateModifier（它有自己的消息管理），搬进去是死代码
   *
   * 折中方案：langgraph-backend 接收可选的 stateModifierFactory，
   * FORGE driver 把现有 stateModifier 构造作为回调传入（零改动）。
   * 不提供时 langgraph-backend 用默认的 SystemMessage 注入。
   *
   * ⚠️ 此字段仅 LangGraph 后端读取；DSH / 其他后端忽略。
   */
  stateModifierFactory?: (opts: {
    systemPrompt: string;
    toolBudget?: { softLimit: number; hardLimit: number };
  }) => unknown;  // 返回 stateModifier 函数（LangGraph 类型，这里用 unknown 避免硬依赖 @langchain）
  /**
   * LangGraph 后端专用：stream chunk 处理回调。
   *
   * FORGE 的 stream 处理逻辑（写报告窗口 / 硬熔断 / 报告质量门控）同样极其精细，
   * 作为回调传入。langgraph-backend 负责跑 stream，把原始 chunk 喂给回调，
   * 回调返回 { hardBreak, gotReport } 控制中断行为。
   *
   * ⚠️ 此字段仅 LangGraph 后端读取；DSH / 其他后端忽略。
   */
  streamHandler?: (chunk: unknown) => {
    hardBreak?: boolean;
    gotReport?: boolean;
  };
}

/**
 * 执行结果
 */
export interface ExecutionResult {
  /** agent 最终输出文本 */
  output: string;
  /** 执行轮次（用于收敛判定） */
  rounds: number;
  /** 是否因递归限制终止 */
  hitRecursionLimit: boolean;
  /** 调试记录（带 agentId，用于跨设备审计聚合） */
  debugLogs?: Array<{ agentId?: string; action: string; timestamp: string }>;
  /**
   * LangGraph 后端专用：原始消息数组（供 FORGE driver 的 extractAgentText /
   * extractUsage / synthesizeReportFromMessages 等下游消费）。
   *
   * 为什么保留原始消息：FORGE 的报告提取逻辑（extractAgentText）需要从消息数组
   * 里从后往前找第一条非空 content——这步必须在 driver 侧做（依赖 driver 的
   * isReportText 质量门控 + generateReportWithoutTools 裸 LLM 抢救）。
   * langgraph-backend 不做报告提取（那是 FORGE 编排层的事），只返回原始消息。
   *
   * ⚠️ 非 LangGraph 后端可不填充此字段。
   */
  rawMessages?: unknown[];
  /** 是否硬熔断（工具预算耗尽被物理中断） */
  hardBreak?: boolean;
}

/**
 * 执行后端工厂函数——优先尝试 DSH，fallback 到 LangGraph。
 *
 * 接入门禁结论（2026-08-14）：DSH 候选包名全部 404，
 * 当前 DSH 后端加载必失败，自动降级 LangGraph。
 * DSH 上架后无需改代码——dsh-backend 的动态 import 会成功。
 */
export async function createExecutionBackend(): Promise<ExecutionBackend> {
  // 1. 优先尝试 DSH Cordis 运行时
  const dsh = await tryLoadDshBackend();
  if (dsh) {
    console.log('[sofagent] 执行后端：DSH Cordis 运行时');
    return dsh;
  }

  // 2. Fallback：LangGraph createReactAgent
  const langgraph = await tryLoadLangGraphBackend();
  if (langgraph) {
    console.log('[sofagent] 执行后端：LangGraph createReactAgent（fallback）');
    return langgraph;
  }

  // 3. 两者都不可用——硬错误（编排层无法工作）
  throw new Error(
    '[sofagent] 无可用执行后端：DSH 未安装 + @langchain/langgraph 未安装。' +
    '请 npm install @langchain/langgraph 启用执行层。'
  );
}

/**
 * 尝试加载 DSH/Cordis 执行后端（动态 import + try-catch）。
 *
 * 2026-08-14 核实：@deepseek-ai/cordis@4.0.1（2 依赖，239KB）+ @deepseek-ai/dsh@0.1.0-rc.6
 * 均已 public。sofagent 需要的是 Cordis 运行时（createCordisRuntime），不是 dsh CLI 壳。
 * 候选顺序：cordis 优先（轻量 2 依赖）→ dsh 兜底（61 依赖但含 cordis re-export）。
 *
 * 版本守卫：rc/beta/alpha/pre 版本不加载——骨架未补全，加载了会 throw。
 * 等 DSH/Cordis 正式版发布后自动通过守卫。
 */
async function tryLoadDshBackend(): Promise<ExecutionBackend | null> {
  // Cordis 运行时候选包名（按优先级排序）。
  // cordis = 轻量框架包（2 依赖）；dsh = CLI 壳（61 依赖，re-export cordis）。
  const candidates = [
    '@deepseek-ai/cordis',  // ✅ 首选：轻量 Cordis 框架（4.0.1，2 依赖，239KB）
    '@deepseek-ai/dsh',     // 备选：DSH CLI 壳（0.1.0-rc.6，61 依赖，re-export cordis）
  ];
  for (const pkg of candidates) {
    try {
      // @ts-ignore — Cordis/DSH 类型未安装（不进 dependencies，运行时动态 import）
      const mod = await import(pkg);
      if (mod && typeof mod.createCordisRuntime === 'function') {
        // 版本守卫：rc / beta / alpha / pre 版本不加载——骨架未补全，加载了会 throw。
        // 等 Cordis/DSH 正式版发布（无 prerelease tag）后自动通过。
        const version = mod.version ?? mod.VERSION ?? '';
        if (/rc|beta|alpha|pre/i.test(version)) {
          // rc 版本 API 不稳定，跳过，继续试下一个候选或 fallback
          continue;
        }
        const { createDshBackend } = await import('./execution-backends/dsh-backend.js');
        return createDshBackend(mod);
      }
    } catch {
      // 候选包名未安装或导出不匹配，试下一个
    }
  }
  return null;
}

/**
 * 尝试加载 LangGraph 后端。
 */
async function tryLoadLangGraphBackend(): Promise<ExecutionBackend | null> {
  try {
    // 先确认 @langchain/langgraph 可加载
    // @ts-ignore — prebuilt 子路径导出在 moduleResolution: node 下无法解析类型
    await import('@langchain/langgraph/prebuilt');
    const { createLangGraphBackend } = await import('./execution-backends/langgraph-backend.js');
    return createLangGraphBackend();
  } catch {
    return null;
  }
}
