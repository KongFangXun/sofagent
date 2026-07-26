// ============================================================
// smoke.test.ts · 编排器 smoke 测试
// v1.1.3 P1-4: 覆盖 compose / 注册 / 调用主链路
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  composeWithDeepAgents,
  BUILTIN_AGENTS,
  loadDefinition,
  listAgents,
} from '../index';

// ════════════════════════════════════════
// Compose 主链路
// ════════════════════════════════════════

describe('compose — 编排主链路', () => {
  it('composeWithDeepAgents 在无模型环境返回 null（不崩溃）', async () => {
    // 无 SOFAGENT_LLM 环境变量时，模型解析失败，函数优雅降级返回 null
    // smoke 测试验证函数不抛异常、优雅降级
    const result = await composeWithDeepAgents('测试任务：写一个 hello world');
    // 无模型时返回 null，有则返回 YAML 字符串
    expect(result === null || typeof result === 'string').toBe(true);
  });

  it('composeWithDeepAgents 空任务描述不崩溃', async () => {
    const result = await composeWithDeepAgents('');
    expect(result === null || typeof result === 'string').toBe(true);
  });
});

// ════════════════════════════════════════
// 注册主链路
// ════════════════════════════════════════

describe('registration — Agent 注册主链路', () => {
  it('BUILTIN_AGENTS 包含 fde、audit、engineer 和 reviewer', () => {
    const names = BUILTIN_AGENTS.map((a) => a.name);
    expect(names).toContain('fde');
    expect(names).toContain('audit');
    expect(names).toContain('engineer');
    expect(names).toContain('reviewer');
  });

  it('BUILTIN_AGENTS 所有 Agent 有完整定义', () => {
    for (const agent of BUILTIN_AGENTS) {
      expect(agent.name).toBeTruthy();
      expect(agent.type).toBeTruthy();
      expect(agent.description).toBeTruthy();
      expect(Array.isArray(agent.tools)).toBe(true);
      expect(agent.tools.length).toBeGreaterThan(0);
      expect(typeof agent.systemPrompt).toBe('string');
      expect(agent.systemPrompt.length).toBeGreaterThan(0);
    }
  });

  it('loadDefinition 不存在文件返回 null', () => {
    const def = loadDefinition('/nonexistent/path/agent.yml');
    expect(def).toBeNull();
  });

  it('listAgents 返回包含内置 Agent 的数组', () => {
    const agents = listAgents('/tmp');
    expect(Array.isArray(agents)).toBe(true);
    expect(agents.length).toBeGreaterThanOrEqual(4); // fde + audit + engineer + reviewer
  });
});

// ════════════════════════════════════════
// 调用主链路
// ════════════════════════════════════════

describe('invocation — 调用主链路', () => {
  it('composeWithDeepAgents 带 workflowYml 参数不崩溃', async () => {
    const sampleYml = `workflow:
  name: test
  nodes:
    - id: step1
      agent: developer
      task: do something`;
    const result = await composeWithDeepAgents('测试任务', sampleYml);
    expect(result === null || typeof result === 'string').toBe(true);
  });

  it('BUILTIN_AGENTS 中 fde 支持 deploy 模式', () => {
    const fde = BUILTIN_AGENTS.find((a) => a.name === 'fde');
    expect(fde).toBeDefined();
    expect(fde!.mode).toBe('deploy');
  });

  it('BUILTIN_AGENTS 中 audit 有 triggerOn', () => {
    const audit = BUILTIN_AGENTS.find((a) => a.name === 'audit');
    expect(audit).toBeDefined();
    expect(audit!.triggerOn).toBeDefined();
    expect(audit!.triggerOn).toContain('on-commit');
  });
});
