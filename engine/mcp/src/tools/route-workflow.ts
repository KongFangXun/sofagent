// ============================================================
// route-workflow.ts · MCP tool: route_workflow（v1.3.6 新增）
//
// 入口路由 tool——传入用户请求，匹配 workflow 节点，返回路由结果。
// 匹配判定记 audit decision（kind=ORCHESTRATION），保证路由决策可审计。
//
// ⚠️ type 修饰符不可运行时解构（v1.3.6 fde-compose 踩过的坑）：
//   正确：顶层 import type { RouteResult } + 运行时只解构 routeRequest 值
//   错误：const { routeRequest, type RouteResult } = require(...) → build 失败
// ============================================================

// 运行时值导入（routeRequest 是函数，运行时需要）
import { routeRequest } from '@sofagent/orchestrator';
// 类型导入（RouteResult / ParsedWorkflow 是类型，仅编译期——不可运行时解构）
import type { RouteResult, ParsedWorkflow } from '@sofagent/orchestrator';
// 审计写入（emitDecision 是函数，运行时需要）
import { emitDecision } from '@sofagent/audit';
// 类型导入（RouteReason 是类型，仅编译期——v1.3.6 交付⑧）
import type { RouteReason } from '@sofagent/audit';

// ============================================================
// 类型定义
// ============================================================

/** route_workflow tool 的入参 */
export interface RouteWorkflowArgs {
  /** 用户请求文本（自然语言） */
  task: string;
  /** 已解析的 workflow JSON（ParsedWorkflow 结构，含 nodes） */
  workflow: ParsedWorkflow;
}

/** route_workflow tool 的结构化结果 */
export interface RouteWorkflowToolResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  /** 结构化数据 */
  data: {
    route: 'workflow' | 'fallback';
    /** 命中的节点（route=workflow 时有值） */
    node?: { id: string; agent: string; task: string; type: string };
    /** 匹配得分（route=workflow 时有值） */
    score?: number;
    /** fallback 原因（route=fallback 时有值） */
    reason?: string;
  };
  isError?: boolean;
}

// ============================================================
// 主函数
// ============================================================

/**
 * 入口路由 tool——把请求路由到 workflow 节点或 fallback 直答。
 *
 * 流程：
 *   1. 调用 orchestrator.routeRequest 做语义匹配 + type 校验
 *   2. 匹配判定记 audit decision（kind=ORCHESTRATION, moment=ACT）
 *      —— 路由决策可审计：命中哪个节点 / 为什么 fallback
 *
 * @param args 路由入参（task + workflow）
 * @returns RouteWorkflowToolResult
 */
export function routeWorkflowTool(args: RouteWorkflowArgs): RouteWorkflowToolResult {
  const { task, workflow } = args;

  if (!task || typeof task !== 'string' || task.trim() === '') {
    return {
      text: '[sofagent] 路由失败：请求文本（task）为空',
      data: { route: 'fallback', reason: '请求文本为空' },
      isError: true,
    };
  }

  if (!workflow || typeof workflow !== 'object') {
    return {
      text: '[sofagent] 路由失败：workflow 参数缺失或非对象',
      data: { route: 'fallback', reason: 'workflow 参数缺失' },
      isError: true,
    };
  }

  // ── 调用 orchestrator 路由 ──
  let result: RouteResult;
  try {
    result = routeRequest({ task, workflow });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // 路由异常记审计
    safeEmitDecision({
      agentId: 'mcp-router',
      sessionId: 'route-workflow',
      kind: 'ORCHESTRATION',
      moment: 'ACT',
      category: 'route',
      why: `入口路由异常：${errMsg}`,
    });
    return {
      text: `[sofagent] 路由异常：${errMsg}`,
      data: { route: 'fallback', reason: errMsg },
      isError: true,
    };
  }

  // ── 匹配判定记审计（kind=ORCHESTRATION）──
  if (result.route === 'workflow') {
    // v1.3.6 交付⑧：routeReason 结构化理由链——入口路由命中哪个节点、得分多少
    // policy='preference'（按节点 task 描述偏好匹配），matchedEndpoint=节点 id
    safeEmitDecision({
      agentId: 'mcp-router',
      sessionId: 'route-workflow',
      kind: 'ORCHESTRATION',
      moment: 'ACT',
      category: 'route',
      why: `入口路由命中 workflow 节点「${result.node.id}」（得分 ${result.score}）`,
      tags: ['route', 'workflow', result.node.id],
      routeReason: {
        policy: 'preference',
        matchedEndpoint: result.node.id,
        decisionScore: result.score,
      },
    });
    return {
      text: `[sofagent] 路由命中 workflow 节点「${result.node.id}」（agent: ${result.node.agent}，得分: ${result.score}）`,
      data: {
        route: 'workflow',
        node: {
          id: result.node.id,
          agent: result.node.agent,
          task: result.node.task,
          type: result.node.type,
        },
        score: result.score,
      },
    };
  }

  // fallback —— v1.3.6 交付⑧：routeReason 记 policy='default'（无匹配节点，走默认直答）
  safeEmitDecision({
    agentId: 'mcp-router',
    sessionId: 'route-workflow',
    kind: 'ORCHESTRATION',
    moment: 'ACT',
    category: 'route',
    why: `入口路由 fallback：${result.reason}`,
    tags: ['route', 'fallback'],
    routeReason: { policy: 'default' },
  });
  return {
    text: `[sofagent] 路由 fallback：${result.reason}`,
    data: {
      route: 'fallback',
      reason: result.reason,
    },
  };
}

// ============================================================
// 安全审计写入（emitDecision 失败不阻断路由主流程）
// ============================================================

/**
 * 安全写入 audit decision——emitDecision 抛错时仅记 stderr，不阻断路由。
 *
 * 路由是编排前置步骤，审计写入失败不应导致请求无法路由。
 * （与 mcp-server.ts 的 webhook 推送 same-philosophy：non-fatal）
 */
function safeEmitDecision(input: {
  agentId: string;
  sessionId: string;
  kind: 'ORCHESTRATION';
  moment: 'ACT';
  why: string;
  tags?: string[];
  /** v1.3.6 交付⑧：路由决策结构化理由链（Artifacts 增强） */
  routeReason?: RouteReason;
  /** v1.3.6 交付⑮：判断时刻分类（路由决策固定 'route'） */
  category?: 'route';
}): void {
  try {
    // tags + routeReason 放入 why 对象（EmitDecisionInput 的 why: DecisionWhy 均接受）
    emitDecision({
      agentId: input.agentId,
      sessionId: input.sessionId,
      kind: input.kind,
      moment: input.moment,
      // v1.3.6 交付⑮：category 落盘（decisions.jsonl 完整版——判断时刻分类）
      ...(input.category !== undefined ? { category: input.category } : {}),
      why: {
        text: input.why,
        ...(input.tags ? { tags: input.tags } : {}),
        ...(input.routeReason ? { routeReason: input.routeReason } : {}),
      },
    });
  } catch (err) {
    process.stderr.write(
      `[route-workflow] 审计写入失败（不阻断路由）: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}
