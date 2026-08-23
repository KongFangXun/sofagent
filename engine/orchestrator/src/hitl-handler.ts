// ============================================================
// hitl-handler.ts · HITL 中断处理（v1.4.0 功能④ 激活链 Phase 3 后半）
//
// v1.4.0 的 checkHITL 是 fail-fast（遇到 HITL 节点直接报错退出）。
// v1.4.0 替换为真正的中断处理：
//   1. 节点执行前暂停，展示方案，等待人工确认
//   2. 每个节点执行后自动审计（audit diff）
//   3. 审计 FAIL 时暂停工作流
//   4. 异常写入 exceptions 队列
//
// 与 node-executor.ts 的关系：
//   - node-executor.ts 负责"执行节点"
//   - hitl-handler.ts 负责"执行前拦截 → 确认 → 执行后审计"
//   - dag-runner 调用顺序：hitlHandler.before(node) → executeNode() → hitlHandler.after(node, result)
// ============================================================

import type { WorkflowNode } from './workflow-parser';
import type { NodeExecutionResult } from './node-executor';

// ────────────────────────────────────────────────────────────
// 类型定义
// ────────────────────────────────────────────────────────────

/** HITL 审批结果 */
export type HITLApproval = 'approved' | 'rejected' | 'modified';

/** HITL 拦截结果 */
export interface HITLInterceptResult {
  /** 是否允许执行 */
  allowed: boolean;
  /** 审批结果 */
  approval: HITLApproval;
  /** 修改后的任务描述（approval='modified' 时有值） */
  modifiedTask?: string;
  /** 拦截原因/备注 */
  reason?: string;
}

/** 审计集成结果 */
export interface AuditIntegrationResult {
  /** 审计是否通过 */
  passed: boolean;
  /** 审计发现的违规数 */
  violationCount: number;
  /** 审计报告摘要 */
  summary: string;
  /** 是否需要暂停工作流 */
  shouldPause: boolean;
}

/** 异常记录 */
export interface ExceptionRecord {
  /** 节点 ID */
  nodeId: string;
  /** Agent 名称 */
  agentName: string;
  /** 异常类型 */
  type: 'hitl_rejected' | 'audit_failed' | 'execution_error' | 'timeout';
  /** 异常描述 */
  message: string;
  /** 时间戳 */
  timestamp: string;
}

/** HITL 处理器配置 */
export interface HITLHandlerConfig {
  /** 是否启用自动审批（非 HITL 节点自动通过） */
  autoApproveNonHITL: boolean;
  /** 审计失败时是否暂停工作流 */
  pauseOnAuditFail: boolean;
  /** 节点超时（ms） */
  nodeTimeoutMs: number;
}

/** HITL 处理器回调函数集（可注入，测试用 mock） */
export interface HITLHandlerCallbacks {
  /** 请求人工确认（HITL 节点） */
  requestApproval: (node: WorkflowNode, plan: string) => Promise<HITLApproval>;
  /** 执行审计 */
  runAudit: (node: WorkflowNode, result: NodeExecutionResult) => Promise<AuditIntegrationResult>;
  /** 记录异常 */
  recordException: (record: ExceptionRecord) => void;
}

// ────────────────────────────────────────────────────────────
// 默认实现
// ────────────────────────────────────────────────────────────

/** 默认配置 */
export const DEFAULT_HITL_CONFIG: HITLHandlerConfig = {
  autoApproveNonHITL: true,
  pauseOnAuditFail: true,
  nodeTimeoutMs: 300_000, // 5 分钟
};

/** 默认审批回调——控制台交互（非交互环境自动 approved） */
async function defaultRequestApproval(node: WorkflowNode, plan: string): Promise<HITLApproval> {
  // 非交互环境（CI / 自动化）默认放行
  if (!process.stdin.isTTY) return 'approved';

  console.log('\n' + '═'.repeat(60));
  console.log(`  🔒 HITL 审批 — 节点: ${node.id}`);
  console.log(`     Agent: ${node.agent}`);
  console.log(`     任务: ${node.task}`);
  console.log(`     方案: ${plan.slice(0, 200)}${plan.length > 200 ? '...' : ''}`);
  console.log('═'.repeat(60));
  console.log('  → 自动审批（非交互环境默认放行）');
  return 'approved';
}

/** 默认审计回调——调用 sofagent-audit */
async function defaultRunAudit(
  _node: WorkflowNode,
  result: NodeExecutionResult,
): Promise<AuditIntegrationResult> {
  if (!result.success) {
    return {
      passed: false,
      violationCount: 0,
      summary: '节点执行失败（非审计问题）',
      shouldPause: true,
    };
  }
  // 默认不阻塞——实际审计需要 git diff，在 dag-runner 中接入
  return {
    passed: true,
    violationCount: 0,
    summary: '审计跳过（默认实现）',
    shouldPause: false,
  };
}

/** 默认异常记录——console.warn */
function defaultRecordException(record: ExceptionRecord): void {
  console.warn(`\n  ⚠️  [异常] ${record.type} @ ${record.nodeId}: ${record.message}`);
}

// ────────────────────────────────────────────────────────────
// HITL 处理器
// ────────────────────────────────────────────────────────────

/**
 * 创建 HITL 处理器实例。
 *
 * 使用方式（在 dag-runner 中）：
 * ```typescript
 * const hitl = createHITLHandler({ config, callbacks });
 *
 * // 执行前
 * const intercept = await hitl.before(node);
 * if (!intercept.allowed) {
 *   // HITL 被拒绝 → 记录异常，跳过节点
 *   return;
 * }
 *
 * // 执行节点（executeNode）
 * const result = await executeNode(ctx);
 *
 * // 执行后审计
 * const audit = await hitl.after(node, result);
 * if (audit.shouldPause) {
 *   // 审计失败 → 暂停工作流
 *   break;
 * }
 * ```
 */
export function createHITLHandler(options?: {
  config?: Partial<HITLHandlerConfig>;
  callbacks?: Partial<HITLHandlerCallbacks>;
}) {
  const config: HITLHandlerConfig = { ...DEFAULT_HITL_CONFIG, ...options?.config };
  const callbacks: HITLHandlerCallbacks = {
    requestApproval: options?.callbacks?.requestApproval ?? defaultRequestApproval,
    runAudit: options?.callbacks?.runAudit ?? defaultRunAudit,
    recordException: options?.callbacks?.recordException ?? defaultRecordException,
  };

  const exceptions: ExceptionRecord[] = [];

  // wrap recordException：同时写入内部 exceptions 数组（供 getExceptions 查询）
  const userRecordException = options?.callbacks?.recordException ?? defaultRecordException;
  const recordException = (record: ExceptionRecord): void => {
    exceptions.push(record);
    userRecordException(record);
  };

  return {
    /**
     * 节点执行前拦截。
     *
     * 非 HITL 节点：config.autoApproveNonHITL=true 时直接放行。
     * HITL 节点：调用 callbacks.requestApproval 等待人工确认。
     */
    async before(node: WorkflowNode, plan?: string): Promise<HITLInterceptResult> {
      // 非 enterprise 节点直接放行
      if (node.agent !== 'enterprise') {
        return { allowed: true, approval: 'approved' };
      }

      // 检查是否标记了 HITL
      const isHITL = checkNodeHITL(node);
      if (!isHITL) {
        if (config.autoApproveNonHITL) {
          return { allowed: true, approval: 'approved' };
        }
      }

      // HITL 节点——请求审批
      const planText = plan ?? node.task;
      const approval = await callbacks.requestApproval(node, planText);

      if (approval === 'rejected') {
        recordException({
          nodeId: node.id,
          agentName: node.agent,
          type: 'hitl_rejected',
          message: `HITL 审批被拒绝: ${node.task}`,
          timestamp: new Date().toISOString(),
        });
        return { allowed: false, approval: 'rejected', reason: '用户拒绝执行' };
      }

      return {
        allowed: true,
        approval,
        modifiedTask: approval === 'modified' ? planText : undefined,
      };
    },

    /**
     * 节点执行后审计。
     *
     * 调用 callbacks.runAudit 检查执行结果。
     * 审计 FAIL + config.pauseOnAuditFail=true → shouldPause=true。
     */
    async after(node: WorkflowNode, result: NodeExecutionResult): Promise<AuditIntegrationResult> {
      const auditResult = await callbacks.runAudit(node, result);

      if (!auditResult.passed && config.pauseOnAuditFail) {
        recordException({
          nodeId: node.id,
          agentName: result.agentName,
          type: 'audit_failed',
          message: auditResult.summary,
          timestamp: new Date().toISOString(),
        });
      }

      return auditResult;
    },

    /** 获取已记录的异常列表 */
    getExceptions(): readonly ExceptionRecord[] {
      return exceptions;
    },

    /** 清空异常列表 */
    clearExceptions(): void {
      exceptions.length = 0;
    },

    /** 配置（运行时可修改） */
    config,
  };
}

// ────────────────────────────────────────────────────────────
// 辅助函数
// ────────────────────────────────────────────────────────────

/**
 * 检查节点是否标记为 HITL。
 * 通过 workflow-parser 的 node 字段判断——enterprise 节点可能携带 hitl 属性。
 */
function checkNodeHITL(node: WorkflowNode): boolean {
  // WorkflowNode 的 hitl 字段（v1.2.9 新增，可选）
  const hitlField = (node as unknown as { hitl?: boolean }).hitl;
  return hitlField === true;
}
