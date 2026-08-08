// hitl-handler.test.ts · v1.2.9 功能④ 激活链 Phase 3 后半——HITL 处理器测试

import { describe, it, expect, vi } from 'vitest';
import { createHITLHandler, type HITLApproval, type ExceptionRecord } from '../hitl-handler';
import type { WorkflowNode } from '../workflow-parser';
import type { NodeExecutionResult } from '../node-executor';

// ────────────────────────────────────────────────────────────
// 测试数据工厂
// ────────────────────────────────────────────────────────────

function makeNode(overrides: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id: 'test-node',
    agent: 'enterprise',
    task: '测试任务',
    ...overrides,
  } as WorkflowNode;
}

function makeSuccessResult(overrides: Partial<NodeExecutionResult> = {}): NodeExecutionResult {
  return {
    agentName: 'test-agent',
    output: '执行成功',
    success: true,
    entitiesWritten: [],
    durationMs: 100,
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────
// 测试
// ────────────────────────────────────────────────────────────

describe('HITL Handler', () => {
  describe('before() — 执行前拦截', () => {
    it('非 enterprise 节点直接放行', async () => {
      const handler = createHITLHandler();
      const node = makeNode({ agent: 'builtin' });
      const result = await handler.before(node);
      expect(result.allowed).toBe(true);
      expect(result.approval).toBe('approved');
    });

    it('HITL 节点——用户审批通过', async () => {
      const handler = createHITLHandler({
        callbacks: {
          requestApproval: async () => 'approved' as HITLApproval,
        },
      });
      const node = makeNode({ hitl: true } as unknown as WorkflowNode);
      const result = await handler.before(node);
      expect(result.allowed).toBe(true);
      expect(result.approval).toBe('approved');
    });

    it('HITL 节点——用户拒绝执行', async () => {
      const exceptions: ExceptionRecord[] = [];
      const handler = createHITLHandler({
        callbacks: {
          requestApproval: async () => 'rejected' as HITLApproval,
          recordException: (r) => exceptions.push(r),
        },
      });
      const node = makeNode({ id: 'hitl-node', hitl: true } as unknown as WorkflowNode);
      const result = await handler.before(node);
      expect(result.allowed).toBe(false);
      expect(result.approval).toBe('rejected');
      expect(exceptions).toHaveLength(1);
      expect(exceptions[0].type).toBe('hitl_rejected');
      expect(exceptions[0].nodeId).toBe('hitl-node');
    });

    it('HITL 节点——用户修改任务后通过', async () => {
      const handler = createHITLHandler({
        callbacks: {
          requestApproval: async () => 'modified' as HITLApproval,
        },
      });
      const node = makeNode({ hitl: true } as unknown as WorkflowNode);
      const result = await handler.before(node, '修改后的方案');
      expect(result.allowed).toBe(true);
      expect(result.approval).toBe('modified');
      expect(result.modifiedTask).toBe('修改后的方案');
    });

    it('autoApproveNonHITL=false 时，非 HITL 节点也需审批', async () => {
      let approvalCalled = false;
      const handler = createHITLHandler({
        config: { autoApproveNonHITL: false },
        callbacks: {
          requestApproval: async () => {
            approvalCalled = true;
            return 'approved';
          },
        },
      });
      const node = makeNode(); // 没有 hitl 字段
      const result = await handler.before(node);
      // autoApproveNonHITL=false 时，即使没有 hitl 标记也走审批流程
      expect(result.allowed).toBe(true);
      expect(approvalCalled).toBe(true);
    });
  });

  describe('after() — 执行后审计', () => {
    it('审计通过时不暂停', async () => {
      const handler = createHITLHandler({
        callbacks: {
          runAudit: async () => ({
            passed: true,
            violationCount: 0,
            summary: '无违规',
            shouldPause: false,
          }),
        },
      });
      const node = makeNode();
      const result = makeSuccessResult();
      const audit = await handler.after(node, result);
      expect(audit.passed).toBe(true);
      expect(audit.shouldPause).toBe(false);
    });

    it('审计失败 + pauseOnAuditFail=true 时暂停', async () => {
      const exceptions: ExceptionRecord[] = [];
      const handler = createHITLHandler({
        callbacks: {
          runAudit: async () => ({
            passed: false,
            violationCount: 2,
            summary: 'A1 敏感文件违规',
            shouldPause: true,
          }),
          recordException: (r) => exceptions.push(r),
        },
      });
      const node = makeNode({ id: 'audit-fail-node' });
      const result = makeSuccessResult();
      const audit = await handler.after(node, result);
      expect(audit.passed).toBe(false);
      expect(audit.shouldPause).toBe(true);
      expect(exceptions).toHaveLength(1);
      expect(exceptions[0].type).toBe('audit_failed');
      expect(exceptions[0].nodeId).toBe('audit-fail-node');
    });

    it('审计失败 + pauseOnAuditFail=false 时不暂停', async () => {
      const handler = createHITLHandler({
        config: { pauseOnAuditFail: false },
        callbacks: {
          runAudit: async () => ({
            passed: false,
            violationCount: 1,
            summary: 'WARN 级别',
            shouldPause: false,
          }),
        },
      });
      const node = makeNode();
      const result = makeSuccessResult();
      const audit = await handler.after(node, result);
      expect(audit.passed).toBe(false);
      expect(audit.shouldPause).toBe(false);
    });

    it('节点执行失败时审计结果 shouldPause=true', async () => {
      const handler = createHITLHandler();
      const node = makeNode();
      const result = makeSuccessResult({ success: false, error: '超时' });
      const audit = await handler.after(node, result);
      expect(audit.passed).toBe(false);
      expect(audit.shouldPause).toBe(true);
    });
  });

  describe('异常管理', () => {
    it('getExceptions 返回已记录的异常', async () => {
      const handler = createHITLHandler({
        callbacks: {
          requestApproval: async () => 'rejected',
        },
      });
      const node = makeNode({ id: 'rejected-node', hitl: true } as unknown as WorkflowNode);
      await handler.before(node);
      expect(handler.getExceptions()).toHaveLength(1);
    });

    it('clearExceptions 清空异常列表', async () => {
      const handler = createHITLHandler({
        callbacks: {
          requestApproval: async () => 'rejected',
        },
      });
      const node = makeNode({ id: 'rejected-node', hitl: true } as unknown as WorkflowNode);
      await handler.before(node);
      expect(handler.getExceptions()).toHaveLength(1);
      handler.clearExceptions();
      expect(handler.getExceptions()).toHaveLength(0);
    });
  });
});
