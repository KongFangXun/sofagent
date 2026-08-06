// ============================================================
// node-executor.test.ts · 企业节点执行器测试（v1.2.8 功能④）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { executeNode, checkHITL, resolveEnterpriseAgent, type NodeExecutionContext } from '../node-executor';
import type { WorkflowNode, SubAgentConfig } from '../workflow-parser';

function tmpDir(): string {
  const dir = join(tmpdir(), `sofagent-node-exec-${Date.now()}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('node-executor', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = tmpDir();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('checkHITL', () => {
    it('非 enterprise 节点不检查 HITL', () => {
      const node: WorkflowNode = {
        id: 'test-node',
        agent: 'engineer',
        task: 'do something',
        depends_on: [],
      };
      // 不应抛异常
      expect(() => checkHITL(node, testDir)).not.toThrow();
    });

    it('enterprise 节点未注册时不抛 HITL 错误（resolveAgent 自己会报错）', () => {
      const node: WorkflowNode = {
        id: 'unregistered-agent',
        agent: 'enterprise',
        task: 'do something',
        depends_on: [],
      };
      // 没有注册任何 agent，所以 listAgents 返回内置列表，
      // 找不到匹配的 → def 为 undefined → 不抛 HITL 错误（resolveEnterpriseAgent 会报未注册）
      expect(() => checkHITL(node, testDir)).not.toThrow();
    });
  });

  describe('executeNode - 降级模式', () => {
    it('LLM 不可用时降级执行并返回模拟输出', async () => {
      const node: WorkflowNode = {
        id: 'test-node',
        agent: 'engineer',
        task: '写一个 hello world',
        depends_on: [],
      };

      const agentConfig: SubAgentConfig = {
        name: 'test-agent',
        description: '测试 Agent',
        systemPrompt: '你是一个测试 Agent',
        tools: [],
        modelName: null,
        hitl: false,
      };

      const ctx: NodeExecutionContext = {
        agentName: 'test-agent',
        agentConfig,
        node,
        dataDir: testDir,
        projectRoot: testDir,
      };

      // 不提供 createReactAgent / resolveModel → 降级模式
      const result = await executeNode(ctx);

      expect(result.success).toBe(true);
      expect(result.output).toContain('降级执行');
      expect(result.agentName).toBe('test-agent');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('executeNode - mock LLM', () => {
    it('注入 mock createReactAgent 后正常执行', async () => {
      const node: WorkflowNode = {
        id: 'mock-node',
        agent: 'engineer',
        task: '测试任务',
        depends_on: [],
      };

      const agentConfig: SubAgentConfig = {
        name: 'mock-agent',
        description: 'Mock Agent',
        systemPrompt: '你是 Mock Agent',
        tools: [],
        modelName: null,
        hitl: false,
      };

      const ctx: NodeExecutionContext = {
        agentName: 'mock-agent',
        agentConfig,
        node,
        dataDir: testDir,
        projectRoot: testDir,
      };

      const mockCreateReactAgent = async () => ({
        invoke: async () => ({
          messages: [
            { role: 'assistant', type: 'ai', content: 'Mock 执行完成' },
          ],
        }),
      });

      const result = await executeNode(ctx, {
        createReactAgent: mockCreateReactAgent,
        resolveModel: async () => ({}),
        buildSystemPrompt: (_root, cfg) => cfg.systemPrompt,
      });

      expect(result.success).toBe(true);
      expect(result.output).toBe('Mock 执行完成');
    });

    it('LLM 抛异常时返回 failure', async () => {
      const node: WorkflowNode = {
        id: 'err-node',
        agent: 'engineer',
        task: '会失败的任务',
        depends_on: [],
      };

      const agentConfig: SubAgentConfig = {
        name: 'err-agent',
        description: 'Error Agent',
        systemPrompt: '你会失败',
        tools: [],
        modelName: null,
        hitl: false,
      };

      const ctx: NodeExecutionContext = {
        agentName: 'err-agent',
        agentConfig,
        node,
        dataDir: testDir,
        projectRoot: testDir,
      };

      const mockCreateReactAgent = async () => ({
        invoke: async () => {
          throw new Error('LLM 超时');
        },
      });

      const result = await executeNode(ctx, {
        createReactAgent: mockCreateReactAgent,
        resolveModel: async () => ({}),
        buildSystemPrompt: (_root, cfg) => cfg.systemPrompt,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('LLM 超时');
    });
  });
});
