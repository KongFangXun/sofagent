// ============================================================
// loop/middleware-registry.ts · LOOP 节点级共享中间件注册表（v1.4.9 深模块条目 4）
// ============================================================
// 从 nodes.ts 迁出（原位 295-382 行）：gate 包装入口 + ModelRouter /
// 数据主权 / 进度遥测三个 lazy 单例 + 路由评估。与节点工厂解耦——
// defaultDeps 与节点实现共享同一实例注册表，跨文件不重复构造。
//
// nodes.ts 原样 re-export 本文件符号（progress-mw.test 从 ../loop/nodes 导入）。
// ============================================================
import { wrapToolsWithGate, createToolGate, type ExecutableTool } from '../tools';
import { ModelRouter } from '../model-router';
import { DataSovereigntyMiddleware } from '../middleware/data-sovereignty-mw';
import { ProgressMiddleware } from '../middleware/progress-mw';
import { MandateGateMiddleware } from '../middleware/mandate-gate-mw';

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

/** 节点级共享实例（lazy init；测试改经 AgentRunnerDeps 注入，不再用全局 setter） */
let sharedRouter: ModelRouter | null = null;
let sharedSovereigntyMw: DataSovereigntyMiddleware | null = null;
/** v1.2.2 P2b：SubAgent 进度遥测 middleware 共享实例 */
let sharedProgressMw: ProgressMiddleware | null = null;
/**
 * v1.5.2 章七：事前授权补环 middleware 共享实例。
 * **默认关（L1）**——new MandateGateMiddleware() 不带 enabled，check 直通、
 * 零留痕、输出逐字不变（不复现 v1.2.0「只 export 不接线」的半闭环）。
 */
let sharedMandateGateMw: MandateGateMiddleware | null = null;

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

/**
 * 获取/初始化事前授权补环 middleware 单例（v1.5.2 章七）。
 *
 * **默认关（L1）**——整环可拔：关档时 gate 直通、零留痕（与今日一致，不留半开）。
 * 启用需宿主用 enabled + query 显式构造替换本单例（setLoopMandateGateMwForTest
 * 或后续注入面）。生产接线点：deps-defaults.defaultDeps → agent-runner 的
 * wrapToolsWithGate 第 4 参。
 */
export function getLoopMandateGateMw(): MandateGateMiddleware {
  if (!sharedMandateGateMw) sharedMandateGateMw = new MandateGateMiddleware();
  return sharedMandateGateMw;
}

/** 测试/宿主注入：事前授权补环 mw（默认关的实例由本 setter 替换） */
export function setLoopMandateGateMwForTest(mw: MandateGateMiddleware | null): void {
  sharedMandateGateMw = mw;
}

/** 测试注入：进度遥测 mw（progress-mw.test 消费——保留）；router/sovereignty 的 setter 已随条目 4 删除（零消费者，测试改注入式 AgentRunnerDeps） */
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
    // 数据流向/安全降级必须有 warn——router 失败时降级为 internal（可上云），
    // 如果本该走 restricted（本地）的数据被降级，用户需要知道
    console.warn('[sofagent] router 路由评估失败，降级 sensitivity=internal:', err instanceof Error ? err.message : String(err));
    return { sensitivity: 'internal', routeSummary: '[router] 路由评估失败，降级 internal' };
  }
}
