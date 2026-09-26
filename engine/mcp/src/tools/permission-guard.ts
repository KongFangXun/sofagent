// ============================================================
// tools/permission-guard.ts · tools/call 前置权限守卫（v1.5.3 TASK-26）
//
// 接线 orchestrator permission 三模块（risk-classifier → policy-engine →
// scenario-router 判定链）到 MCP 工具执行前置面：
//   1. 工具名 → (action, domain) 风险画像（tool-risk-profile 表）
//   2. classifyRisk 定级 → policyEngine.decide 判定（allow/deny/human-approval）
//   3. deny/human-approval → 拦截（守卫先于事件分发——DSH 三硬约束之二）
//
// 启用语义（opt-in）：SOFAGENT_PERMISSION_GUARD=1 显式启用；未设/设 0 时
// 守卫直通（zero behavior change——104 工具既有调用链零扰动）。
// 身份来源：SOFAGENT_AGENT_ID（v1.3.1 身份码派生的 agent ID）；缺身份时
// 用 'mcp-anonymous' 占位——policy-engine 对 team/commons 来源 fail-closed，
// task 来源走场景匹配链。
// ============================================================

import type { ToolResult } from './audit-tools';

/** 守卫判定结果 */
export interface GuardVerdict {
  /** 是否放行执行 */
  allowed: boolean;
  /** 拦截时的错误信息（allowed=false 时有） */
  blockReason?: string;
}

/** 工具风险画像（工具名 → 判定链入参）——按 tool-registry 分域粗分 */
interface ToolRiskProfile {
  action: 'read' | 'write' | 'delete' | 'export';
  domain: 'code' | 'config' | 'audit-data' | 'user-data' | 'knowledge' | 'public';
  taskType: 'code-development' | 'data-processing' | 'report-generation' | 'testing' | 'ops' | 'knowledge-management';
}

/**
 * 工具风险画像表（覆盖高危面；未列工具缺省 read/public 低风险直通——
 * 判定链仍走 policy-engine，仅画像温和）。
 */
const TOOL_RISK_PROFILES: Record<string, ToolRiskProfile> = {
  // 审计数据面（防篡改——写/删一律 critical）
  run_audit: { action: 'write', domain: 'audit-data', taskType: 'ops' },
  audit_file: { action: 'write', domain: 'audit-data', taskType: 'ops' },
  // v1.5.2 章二：规则集导出——导出物落盘 + 写一条 HMAC 挂链审计留痕（audit-data 非读动作 → critical，
  // 与 run_audit/audit_file 同域；audit_query 为纯只读，不入本表，走缺省 read/public 画像）
  ruleset_export: { action: 'export', domain: 'audit-data', taskType: 'ops' },
  corpus_export: { action: 'export', domain: 'user-data', taskType: 'data-processing' },
  data_sovereignty_report: { action: 'export', domain: 'user-data', taskType: 'data-processing' },
  // 知识/实体写面
  create_entity: { action: 'write', domain: 'knowledge', taskType: 'knowledge-management' },
  update_entity: { action: 'write', domain: 'knowledge', taskType: 'knowledge-management' },
  delete_entity: { action: 'delete', domain: 'knowledge', taskType: 'knowledge-management' },
  create_concept: { action: 'write', domain: 'knowledge', taskType: 'knowledge-management' },
  delete_concept: { action: 'delete', domain: 'knowledge', taskType: 'knowledge-management' },
  // 工作流编排面
  workflow_create: { action: 'write', domain: 'config', taskType: 'ops' },
  workflow_update: { action: 'write', domain: 'config', taskType: 'ops' },
  workflow_submit: { action: 'write', domain: 'config', taskType: 'ops' },
  // 设备/数据推送面
  device_register: { action: 'write', domain: 'config', taskType: 'ops' },
  device_data_push: { action: 'write', domain: 'user-data', taskType: 'data-processing' },
  router_session_push: { action: 'write', domain: 'user-data', taskType: 'data-processing' },
};

/** 缺省画像（未列表工具——读型低风险） */
const DEFAULT_PROFILE: ToolRiskProfile = { action: 'read', domain: 'public', taskType: 'code-development' };

/** 守卫是否启用（SOFAGENT_PERMISSION_GUARD=1 opt-in） */
export function isPermissionGuardEnabled(): boolean {
  return process.env.SOFAGENT_PERMISSION_GUARD === '1';
}

/** policy-engine 单例（启用时惰性装配——动态 import 避免编译期耦合） */
let enginePromise: Promise<unknown> | null = null;
async function getEngine(): Promise<{
  decide(req: Record<string, unknown>): { action: string; reason: string };
} | null> {
  if (!enginePromise) {
    enginePromise = import('@sofagent/orchestrator').then((m) => {
      const create = (m as unknown as { createPolicyEngine?: (o?: unknown) => unknown }).createPolicyEngine;
      if (typeof create !== 'function') return null;
      return create({}) as { decide(req: Record<string, unknown>): { action: string; reason: string } };
    }).catch(() => null);
  }
  return enginePromise as Promise<{ decide(req: Record<string, unknown>): { action: string; reason: string } } | null>;
}

/** 测试隔离出口——清空引擎单例 */
export function resetPermissionGuard(): void {
  enginePromise = null;
}

/**
 * tools/call 前置判定（守卫先于事件分发）。
 *
 * @param toolName 工具名
 * @returns allowed=false 时调用方必须拦截（sendError）不再执行工具
 */
export async function guardToolCall(toolName: string): Promise<GuardVerdict> {
  if (!isPermissionGuardEnabled()) return { allowed: true };
  const engine = await getEngine();
  if (!engine) {
    // orchestrator 不可解析（独立安装 mcp 场景）——守卫降级直通 + stderr 发声
    // （启用态引擎缺失不可静默：检测面死亡必须可感知，但不崩主流程）
    process.stderr.write('[sofagent-mcp] ⚠️ 权限守卫已启用但 policy-engine 不可用（@sofagent/orchestrator 解析失败）——本次直通\n');
    return { allowed: true };
  }
  const profile = TOOL_RISK_PROFILES[toolName] ?? DEFAULT_PROFILE;
  const agentId = process.env.SOFAGENT_AGENT_ID || 'mcp-anonymous';
  const verdict = engine.decide({
    agentId,
    source: 'task',
    taskType: profile.taskType,
    domain: profile.domain,
    action: profile.action,
  });
  if (verdict.action === 'allow') return { allowed: true };
  return {
    allowed: false,
    blockReason: `权限守卫拦截（${verdict.action}）: ${verdict.reason}——工具 ${toolName}（${profile.action}/${profile.domain}）未被放行`,
  };
}

/** 类型锚（消费面形态——sendTool 的 ToolOutcome 分支） */
export type GuardToolResult = ToolResult;
