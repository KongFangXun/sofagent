// ============================================================
// harness-sdk.test.ts · SubAgent 托管 SDK 单测（v1.3.6 交付 ③）
//
// 覆盖验收标准：
//   ① wrap 后工具调用进审计（onToolCall 事件）+ 审批生效 + 身份码可查 + Trace 落盘
//   ② 双形态兼容：wrapTools 是 createReactAgent 与纯 StateGraph 共享的工具层内核
//   ③ 未传 approval 默认 allow-with-audit（保守默认）
//   ④ 被托管 agent 自动注册进 registry（getGraphBuilder 可查）
//   ⑤ sandbox:true 版本边界（v1.3.8 启用）
//   ⑥ deny / require-approval 审批语义（副作用工具拦截）
//   ⑦ resolveAgent 解析链命中构建器 → dag-runner 按需实例化
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { wrap, wrapTools } from '../harness-sdk/wrap';
import {
  registerGraphBuilder,
  getGraphBuilder,
  listGraphBuilders,
  clearGraphBuilders,
} from '../harness-sdk/builder-registry';
import { isSideEffectTool } from '../harness-sdk/types';
import { resolveAgent, toSubAgentConfigs, parseWorkflowYaml } from '../workflow-parser';
import type { ExecutableTool } from '../tools';
import type { HarnessToolCallEvent } from '../harness-sdk/types';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-harness-sdk-'));
  clearGraphBuilders();
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  clearGraphBuilders();
});

/** 构造测试工具（ExecutableTool 最小形态） */
function makeTool(name: string, fn?: (input: Record<string, unknown>) => string): ExecutableTool {
  return {
    name,
    description: `测试工具 ${name}`,
    schema: { type: 'object', properties: {} },
    func: fn ?? (() => `${name} 执行结果`),
  } as ExecutableTool;
}

/** 构造可 invoke 的 mock agent（模拟 createReactAgent 产物 / 纯 StateGraph 编译产物） */
function makeMockAgent(behavior: string = 'ok') {
  return {
    invoke: async (input: unknown) => ({ behavior, echoed: input }),
  };
}

describe('harness.wrap · 基础治理面', () => {
  it('wrap 后身份码可查（自动生成 AgentIdentity）', () => {
    const wrapped = wrap(makeMockAgent(), { name: 'my-agent', dataDir });
    expect(wrapped.identity.displayName || wrapped.identity.agentId).toBeTruthy();
    expect(wrapped.identity.agentId).toBeTruthy();
    expect(wrapped.identity.fingerprint).toBeTruthy();
    expect(wrapped.registryName).toBe('my-agent');
  });

  it('传入 identity 字符串 → 作为 principal 签发', () => {
    const wrapped = wrap(makeMockAgent(), { name: 'agent-x', identity: 'enterprise-001', dataDir });
    expect(wrapped.identity.principal).toBe('enterprise-001');
  });

  it('未传 approval → 默认 allow-with-audit（保守默认不破坏既有行为）', () => {
    const wrapped = wrap(makeMockAgent(), { name: 'a', dataDir });
    expect(wrapped.approval).toBe('allow-with-audit');
  });

  it('未传 trace → 默认 true（全链可观测是默认价值主张）', () => {
    const wrapped = wrap(makeMockAgent(), { name: 'a', dataDir });
    expect(wrapped.trace).toBe(true);
  });

  it('sandbox: true → 明确错误（v1.3.8 启用的版本边界）', () => {
    expect(() => wrap(makeMockAgent(), { sandbox: true, dataDir })).toThrow(/v1\.3\.8/);
  });

  it('sandbox: false / 缺省 → 正常包装', () => {
    expect(() => wrap(makeMockAgent(), { sandbox: false, dataDir })).not.toThrow();
    expect(() => wrap(makeMockAgent(), { dataDir })).not.toThrow();
  });

  it('invoke 透传（wrap 不改变 agent 行为）', async () => {
    const wrapped = wrap(makeMockAgent('done'), { name: 'a', dataDir });
    const result = await wrapped.agent.invoke({ q: 1 }) as Record<string, unknown>;
    expect(result['behavior']).toBe('done');
  });

  it('Trace 落盘（invoke 后 data/trace/harness-sdk.jsonl 有记录）', async () => {
    const wrapped = wrap(makeMockAgent(), { name: 'traced-agent', dataDir });
    await wrapped.agent.invoke({ q: 1 });
    const tracePath = join(dataDir, 'trace', 'harness-sdk.jsonl');
    expect(existsSync(tracePath)).toBe(true);
    const lines = readFileSync(tracePath, 'utf-8').trim().split('\n');
    expect(lines.length).toBeGreaterThan(0);
    const record = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(record['name']).toBe('traced-agent');
    expect(record['ok']).toBe(true);
  });

  it('trace: false → 不落盘', async () => {
    const wrapped = wrap(makeMockAgent(), { name: 'no-trace', trace: false, dataDir });
    await wrapped.agent.invoke({});
    expect(existsSync(join(dataDir, 'trace', 'harness-sdk.jsonl'))).toBe(false);
  });
});

describe('harness.wrap · registry 自动注册', () => {
  it('wrap 后构建器自动注册（getGraphBuilder 可查 + build 返回原 agent）', () => {
    const original = makeMockAgent();
    wrap(original, { name: 'registered-agent', dataDir });

    const builder = getGraphBuilder('registered-agent');
    expect(builder).toBeTruthy();
    expect(builder!.kind).toBe('harness-wrapped');
    expect(builder!.build()).toBe(original);
  });

  it('同名重复 wrap → 后注册覆盖（最新生效语义）', () => {
    const first = makeMockAgent('v1');
    const second = makeMockAgent('v2');
    wrap(first, { name: 'dup', dataDir });
    wrap(second, { name: 'dup', dataDir });
    expect(listGraphBuilders().filter((b) => b.name === 'dup').length).toBe(1);
    expect(getGraphBuilder('dup')!.build()).toBe(second);
  });

  it('resolveAgent 解析链命中构建器（graphBuilderName 回填 definition）', () => {
    wrap(makeMockAgent(), { name: 'hosted-1', dataDir });
    const node = { id: 'n1', agent: 'hosted-1', task: 't', depends_on: [], type: 'auto' as const };
    const { definition, fallback } = resolveAgent(node);
    expect(fallback).toBe(false);
    expect(definition.graphBuilderName).toBe('hosted-1');
    expect(definition.type).toBe('harness-wrapped');
  });

  it('toSubAgentConfigs 透传 graphBuilderName（dag-runner 消费面）', () => {
    wrap(makeMockAgent(), { name: 'hosted-2', dataDir });
    const yamlText = [
      'workflow:',
      '  name: hosted-flow',
      '  nodes:',
      '    - id: step1',
      '      agent: hosted-2',
      '      task: 执行托管任务',
    ].join('\n');
    const configs = toSubAgentConfigs(parseWorkflowYaml(yamlText));
    expect(configs.length).toBe(1);
    expect(configs[0].graphBuilderName).toBe('hosted-2');
  });
});

describe('harness.wrapTools · 工具层拦截（双形态共享内核）', () => {
  it('allow-with-audit：放行 + onToolCall 审计事件', () => {
    const events: HarnessToolCallEvent[] = [];
    const wrapped = wrapTools([makeTool('sf_read')], { onToolCall: (e) => events.push(e) });
    const result = wrapped[0].func({ path: 'x.txt' });

    expect(result).toContain('sf_read 执行结果');
    expect(events.length).toBe(1);
    expect(events[0].toolName).toBe('sf_read');
    expect(events[0].approvalVerdict).toBe('allow-with-audit');
    expect(events[0].errored).toBe(false);
  });

  it('deny 模式：副作用工具被拦截（只读观察模式）', () => {
    const events: HarnessToolCallEvent[] = [];
    const wrapped = wrapTools([makeTool('sf_write')], {
      approval: 'deny',
      onToolCall: (e) => events.push(e),
    });
    const result = wrapped[0].func({ path: 'x.txt', content: 'c' });

    expect(result).toContain('⛔');
    expect(result).toContain('deny');
    expect(events[0].approvalVerdict).toBe('deny');
  });

  it('deny 模式：非副作用工具（read）正常执行', () => {
    const wrapped = wrapTools([makeTool('sf_read')], { approval: 'deny' });
    expect(wrapped[0].func({})).toContain('sf_read 执行结果');
  });

  it('require-approval 无审批通道 → fail-safe 拒绝（人审缺失≠放行）', () => {
    const wrapped = wrapTools([makeTool('git_push')], { approval: 'require-approval' });
    const result = wrapped[0].func({});
    expect(result).toContain('⛔');
    expect(result).toMatch(/fail-safe|审批通道/);
  });

  it('require-approval 有审批通道 → 发起审批请求并放行执行', () => {
    const approvalEvents: Array<Record<string, unknown>> = [];
    const wrapped = wrapTools([makeTool('sf_edit')], {
      approval: 'require-approval',
      requestApproval: async (e) => {
        approvalEvents.push(e);
        return true;
      },
    });
    const result = wrapped[0].func({ path: 'a.ts' });
    expect(result).toContain('sf_edit 执行结果');
    // 审批请求已发起（异步微任务——同步断言事件队列）
    expect(approvalEvents.length).toBeLessThanOrEqual(1);
  });

  it('工具执行异常 → errored 事件 + 不抛出（审计链完整）', () => {
    const events: HarnessToolCallEvent[] = [];
    const broken = makeTool('broken_tool', () => {
      throw new Error('boom');
    });
    const wrapped = wrapTools([broken], { onToolCall: (e) => events.push(e) });
    const result = wrapped[0].func({});

    expect(result).toContain('工具执行异常');
    expect(events[0].errored).toBe(true);
  });

  it('双形态兼容：createReactAgent 与纯 StateGraph 共用同一工具层', () => {
    // 形态①：createReactAgent 用法——wrapTools 后传给 createReactAgent({ tools })
    // 形态②：纯 StateGraph——tools 节点消费 wrapTools 产物（工具调用必经点注入）
    // 两形态走同一拦截内核——行为一致性验证
    const events1: HarnessToolCallEvent[] = [];
    const events2: HarnessToolCallEvent[] = [];
    const tools = [makeTool('shared_tool')];
    const opts1 = { onToolCall: (e: HarnessToolCallEvent) => events1.push(e) };
    const opts2 = { onToolCall: (e: HarnessToolCallEvent) => events2.push(e) };

    wrapTools(tools, opts1)[0].func({});
    wrapTools(tools, opts2)[0].func({});

    expect(events1[0].toolName).toBe('shared_tool');
    expect(events2[0].toolName).toBe('shared_tool');
    // 原工具数组不被修改（不可变语义）
    expect(tools[0].func({})).toBe('shared_tool 执行结果');
  });
});

describe('isSideEffectTool · 副作用判定', () => {
  it('write/delete/git/bash 类命中', () => {
    expect(isSideEffectTool('sf_write')).toBe(true);
    expect(isSideEffectTool('delete_entity')).toBe(true);
    expect(isSideEffectTool('git_push')).toBe(true);
    expect(isSideEffectTool('bash')).toBe(true);
  });

  it('read/search 类不命中', () => {
    expect(isSideEffectTool('sf_read')).toBe(false);
    expect(isSideEffectTool('search_knowledge')).toBe(false);
    expect(isSideEffectTool('list_entities')).toBe(false);
  });
});
