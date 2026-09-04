// ============================================================
// node-executor.test.ts · 企业节点执行器测试（v1.2.9 功能④）
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
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* #9 shim 加固 */ }
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
    // v1.3.2 P2-33: 显式 testTimeout（20s）——全量并行负载下 5s 默认超时偶发失败（单跑通过）。
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
      // v1.4.5 T6：降级必须显式声明——degraded=true（调用方可区分
      // 真执行成功 vs LLM 缺席的模拟成功；原实现只写 entity 内部字段，
      // NodeExecutionResult 层面调用方不可见）
      expect(result.degraded).toBe(true);
    }, 20000);
  });

  describe('executeNode - mock LLM', () => {
    // v1.3.2 P2-33: 显式 testTimeout（20s）——全量并行负载下 5s 默认超时偶发失败（单跑通过）。
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
      // v1.4.5 T6：真执行成功 → degraded=false（非降级路径显式可判）
      expect(result.degraded).toBe(false);
    }, 20000);

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
    }, 20000);
  });
});


// ════════════════════════════════════════════════════════════
// v1.4.5 T6：降级路径显式化（degraded:true + 上层 WARN）
// ════════════════════════════════════════════════════════════

describe('executeNode - 降级显式化（v1.4.5 T6）', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = tmpDir();
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* #9 shim 加固 */ }
  });

  it('test_executeNode_降级结果_degraded字段为true且output含降级说明', async () => {
    // 原问题：降级路径返回 success:true 无 degraded 字段——上层把
    // 「LLM 缺席的模拟成功」当真成功消费，节点级静默降级不可观测。
    const ctx: NodeExecutionContext = {
      agentName: 'test-agent',
      agentConfig: {
        name: 'test-agent',
        description: '测试',
        systemPrompt: 'test',
        tools: [],
        modelName: null,
        hitl: false,
      },
      node: { id: 'n1', agent: 'engineer', task: 't', depends_on: [] },
      dataDir: testDir,
      projectRoot: testDir,
    };
    // 不注入 createReactAgent / resolveModel → 降级
    const result = await executeNode(ctx);
    expect(result.success).toBe(true);
    expect(result.degraded).toBe(true);
    expect(result.output).toContain('LLM 不可用');
  }, 20000);

  it('test_executeNode_失败路径_degraded字段为false', async () => {
    // 失败不是降级——degraded 只描述「成功但是模拟」这一态
    const ctx: NodeExecutionContext = {
      agentName: 'err-agent',
      agentConfig: {
        name: 'err-agent',
        description: '测试',
        systemPrompt: 'test',
        tools: [],
        modelName: null,
        hitl: false,
      },
      node: { id: 'n1', agent: 'engineer', task: 't', depends_on: [] },
      dataDir: testDir,
      projectRoot: testDir,
    };
    const mockCreateReactAgent = async () => ({
      invoke: async () => { throw new Error('LLM 超时'); },
    });
    const result = await executeNode(ctx, {
      createReactAgent: mockCreateReactAgent as never,
      resolveModel: async () => ({}),
    });
    expect(result.success).toBe(false);
    expect(result.degraded).toBe(false);
  }, 20000);
});
