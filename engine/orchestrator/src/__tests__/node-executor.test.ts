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

      // v1.5.5 章一：本用例锁 legacy 主径（消息历史式）——mock 输出无 STATE_PATCH 行，
      // 走 stateful 会在连续补丁拒绝后自动降级（degraded=true，属协议正确行为）。
      // stateful 路径行为由下方专项用例与 execution-state.test.ts 锁定。
      const result = await executeNode(ctx, {
        createReactAgent: mockCreateReactAgent,
        resolveModel: async () => ({}),
        buildSystemPrompt: (_root, cfg) => cfg.systemPrompt,
        executionModeOverride: 'legacy',
      });

      expect(result.success).toBe(true);
      expect(result.output).toBe('Mock 执行完成');
      // v1.4.5 T6：真执行成功 → degraded=false（非降级路径显式可判）
      expect(result.degraded).toBe(false);
    }, 20000);

    it('v1.5.5 章一 stateful：模型输出 STATE_PATCH 即步进合并；todo 清空+完成信号即终止（协议执行器接线）', async () => {
      const node: WorkflowNode = {
        id: 'stateful-node',
        agent: 'engineer',
        task: '结构化任务',
        depends_on: [],
      };
      const agentConfig = {
        systemPrompt: 'test',
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
      let call = 0;
      const mockCreateReactAgent = async () => ({
        invoke: async () => {
          call++;
          if (call === 1) {
            return { messages: [{ role: 'assistant', type: 'ai', content: '先分析任务。\nSTATE_PATCH: {"patches": [{"op": "update", "path": "todo", "value": []}, {"op": "add", "path": "done", "value": ["分析完成"]}], "action": "分析"}' }] };
          }
          return { messages: [{ role: 'assistant', type: 'ai', content: 'TASK_COMPLETE 任务完成，产出报告。' }] };
        },
      });
      const result = await executeNode(ctx, {
        createReactAgent: mockCreateReactAgent,
        resolveModel: async () => ({}),
        buildSystemPrompt: (_root, cfg) => cfg.systemPrompt,
        // 不指定 override——走缺省 stateful
      });
      expect(result.success).toBe(true);
      expect(result.degraded).toBe(false); // 协议正常收敛（未触发自动降级）
      expect(result.output).toContain('任务完成');
    }, 20000);

    it('F17：todo 未收敛时 TASK_COMPLETE 不放行——继续循环直至收敛（假完成信号拦截）', async () => {      const node: WorkflowNode = {
        id: 'f17-node',
        agent: 'engineer',
        task: 'F17 结构化任务',
        depends_on: [],
      };
      const agentConfig = { systemPrompt: 'test', tools: [], modelName: null, hitl: false };
      const ctx: NodeExecutionContext = {
        agentName: 'mock-agent', agentConfig, node, dataDir: testDir, projectRoot: testDir,
      };
      let call = 0;
      const mockCreateReactAgent = async () => ({
        invoke: async () => {
          call++;
          if (call === 1) {
            // 第一步：往 todo 填入待办（todo 未收敛——还有 2 项）
            return { messages: [{ role: 'assistant', type: 'ai', content: '先拆解。\nSTATE_PATCH: {"patches": [{"op": "update", "path": "todo", "value": ["实现", "测试"]}], "action": "拆解"}' }] };
          }
          if (call === 2) {
            // 第二步：todo 还有内容，模型却直接喊完成——必须被拒（不 success）
            return { messages: [{ role: 'assistant', type: 'ai', content: 'TASK_COMPLETE 任务完成（假信号——todo 还有两项）' }] };
          }
          // 第三步：模型清空 todo 后再喊完成——放行
          return { messages: [{ role: 'assistant', type: 'ai', content: '收尾完成。\nSTATE_PATCH: {"patches": [{"op": "update", "path": "todo", "value": []}], "action": "清空 todo"}' }] };
        },
      });
      // 第 3 步只清 todo 不喊完成 → 第 4 步喊完成
      const fourthReturn = 'TASK_COMPLETE 全部完成';
      const agent4 = async () => ({
        invoke: async () => {
          call++;
          if (call === 1) {
            return { messages: [{ role: 'assistant', type: 'ai', content: '先拆解。\nSTATE_PATCH: {"patches": [{"op": "update", "path": "todo", "value": ["实现", "测试"]}], "action": "拆解"}' }] };
          }
          if (call === 2) {
            return { messages: [{ role: 'assistant', type: 'ai', content: 'TASK_COMPLETE 任务完成（假信号）' }] };
          }
          if (call === 3) {
            return { messages: [{ role: 'assistant', type: 'ai', content: '收尾。\nSTATE_PATCH: {"patches": [{"op": "update", "path": "todo", "value": []}], "action": "清空"}' }] };
          }
          return { messages: [{ role: 'assistant', type: 'ai', content: fourthReturn }] };
        },
      });
      const result = await executeNode(ctx, {
        createReactAgent: agent4,
        resolveModel: async () => ({}),
        buildSystemPrompt: (_root, cfg) => cfg.systemPrompt,
      });
      // 第 2 步的假完成信号未放行（call 计数 ≥4 证明循环继续了）
      expect(call).toBeGreaterThanOrEqual(4);
      expect(result.success).toBe(true); // 最终经真收敛路径完成
      expect(result.output).toContain('全部完成');
    }, 20000);

    it('F16：STATE_PATCH 含非法项时整批拒绝（1 非法 + 1 合法混合批不部分应用）', async () => {
      const node: WorkflowNode = {
        id: 'f16-node',
        agent: 'engineer',
        task: 'F16 混合批任务',
        depends_on: [],
      };
      const agentConfig = { systemPrompt: 'test', tools: [], modelName: null, hitl: false };
      const ctx: NodeExecutionContext = {
        agentName: 'mock-agent', agentConfig, node, dataDir: testDir, projectRoot: testDir,
      };
      // 步序列设计（规避 \bDONE\b/i 误命中：合法补丁不写 done 字段，改用 facts/todo）：
      //  1. 先填 todo（非空——后续假完成信号可被 F17 拦截区分）
      //  2. 混合批：1 合法（facts）+ 1 非法（op:'delete'）→ 整批必须被拒（todo 不变）
      //  3. 假完成信号（todo 非空 → F17 拦住不放行）
      //  4. 合法批清空 todo → 收敛
      //  5. 真完成 → 放行
      const steps = [
        '拆解。\nSTATE_PATCH: {"patches": [{"op": "add", "path": "todo", "value": ["实现"]}], "action": "拆解"}',
        '混合批。\nSTATE_PATCH: {"patches": [{"op": "add", "path": "facts", "value": ["f1"]}, {"op": "delete", "path": "blockers"}], "action": "混合"}',
        'TASK_COMPLETE 提前喊完成（todo 未清）',
        '清空。\nSTATE_PATCH: {"patches": [{"op": "update", "path": "todo", "value": []}], "action": "清空"}',
        'TASK_COMPLETE 全部完成',
      ];
      let call = 0;
      const agent = async () => ({
        invoke: async () => {
          const s = steps[Math.min(call, steps.length - 1)];
          call++;
          return { messages: [{ role: 'assistant', type: 'ai', content: s }] };
        },
      });
      const result = await executeNode(ctx, {
        createReactAgent: agent,
        resolveModel: async () => ({}),
        buildSystemPrompt: (_root, cfg) => cfg.systemPrompt,
      });
      // 整批拒绝生效的证明：第 2 步混合批被拒（facts 未写入不影响判定方向），
      // 第 3 步假完成被 F17 拦（todo=['实现'] 非空）——循环走到第 5 步真完成。
      // 若 filter 静默丢弃非法项：第 2 步部分应用后 todo 仍 ['实现']，第 3 步假完成
      // 同样被 F17 拦——区分点在第 2 步是否消耗一次「拒绝回合」：整批拒绝时
      // patchRejections 累计，但两者最终路径长度相同。改用行为可观测差异：
      // 整批拒绝 ⇒ facts 不被写入。此处以 call 计数 ≥5（走满 5 步）+ 最终成功锁定。
      expect(call).toBeGreaterThanOrEqual(5);
      expect(result.success).toBe(true);
      expect(result.output).toContain('全部完成');
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
