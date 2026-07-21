// ============================================================
// workflow-parser.test.ts · workflow YAML → SubAgent 映射测试
// v1.1.7 新增
//
// 覆盖用例（共 9 case）：
//   1. 合法 workflow 解析：name/description/nodes 归一化，depends_on 缺省补 []
//   2. agent 映射表：developer→engineer / qa-engineer→reviewer / researcher→fde(sustain)
//      / technical-writer→内置
//   3. 未知 agent 类型 → 降级 technical-writer 内置定义（fallback 标记）
//   4. 同类型多节点 → 第二个起名字加节点 id 后缀保唯一
//   5. 非法 YAML / 缺 workflow 根 / nodes 为空 → WorkflowParseError
//   6. 节点字段缺失（id/agent/task）→ WorkflowParseError
//   7. depends_on 悬空引用 / 自依赖 → WorkflowParseError
//   8. 环检测：A→B→C→A → WorkflowParseError
//   9. 节点 id 重复 → WorkflowParseError
// ============================================================

import { describe, it, expect } from 'vitest';

import {
  parseWorkflowYaml,
  toSubAgentConfigs,
  parseWorkflowToSubAgents,
  mapAgentType,
  WorkflowParseError,
} from '../workflow-parser';

const VALID_YAML = `
workflow:
  name: 用户登录功能
  description: 实现登录 + 测试 + 文档
  nodes:
    - id: impl
      agent: developer
      task: 实现登录接口
    - id: test
      agent: qa-engineer
      task: 编写登录测试
      depends_on: [impl]
    - id: docs
      agent: technical-writer
      task: 更新 API 文档
      depends_on: [impl]
`;

describe('workflow-parser · YAML 解析', () => {
  // 用例 1：合法 workflow 归一化
  it('合法 workflow：name/description/nodes 解析，depends_on 缺省补 []', () => {
    const parsed = parseWorkflowYaml(VALID_YAML);
    expect(parsed.name).toBe('用户登录功能');
    expect(parsed.description).toBe('实现登录 + 测试 + 文档');
    expect(parsed.nodes.length).toBe(3);
    expect(parsed.nodes[0]).toEqual({ id: 'impl', agent: 'developer', task: '实现登录接口', depends_on: [] });
    expect(parsed.nodes[1]!.depends_on).toEqual(['impl']);
  });

  // 用例 5：结构非法 → WorkflowParseError
  it('非法 YAML / 缺 workflow 根 / nodes 为空 → WorkflowParseError', () => {
    expect(() => parseWorkflowYaml(':\n  - [')).toThrow(WorkflowParseError);
    expect(() => parseWorkflowYaml('foo: bar')).toThrow(/workflow 根节点/);
    expect(() => parseWorkflowYaml('workflow:\n  nodes: []')).toThrow(/为空数组/);
    expect(() => parseWorkflowYaml('workflow:\n  name: x')).toThrow(/nodes/);
  });

  // 用例 6：节点字段缺失
  it('节点缺 id / agent / task → WorkflowParseError', () => {
    expect(() => parseWorkflowYaml('workflow:\n  nodes:\n    - agent: developer\n      task: t'))
      .toThrow(/缺 id/);
    expect(() => parseWorkflowYaml('workflow:\n  nodes:\n    - id: a\n      task: t'))
      .toThrow(/缺 agent/);
    expect(() => parseWorkflowYaml('workflow:\n  nodes:\n    - id: a\n      agent: developer'))
      .toThrow(/缺 task/);
  });

  // 用例 7：depends_on 引用校验
  it('depends_on 悬空引用 / 自依赖 → WorkflowParseError', () => {
    expect(() => parseWorkflowYaml(
      'workflow:\n  nodes:\n    - id: a\n      agent: developer\n      task: t\n      depends_on: [ghost]',
    )).toThrow(/悬空/);
    expect(() => parseWorkflowYaml(
      'workflow:\n  nodes:\n    - id: a\n      agent: developer\n      task: t\n      depends_on: [a]',
    )).toThrow(/自依赖/);
  });

  // 用例 8：环检测
  it('环 A→B→C→A → WorkflowParseError', () => {
    const cyclic = `
workflow:
  nodes:
    - { id: a, agent: developer, task: t, depends_on: [c] }
    - { id: b, agent: developer, task: t, depends_on: [a] }
    - { id: c, agent: developer, task: t, depends_on: [b] }
`;
    expect(() => parseWorkflowYaml(cyclic)).toThrow(/环/);
  });

  // 用例 9：id 重复
  it('节点 id 重复 → WorkflowParseError', () => {
    const dup = `
workflow:
  nodes:
    - { id: a, agent: developer, task: t1 }
    - { id: a, agent: qa-engineer, task: t2 }
`;
    expect(() => parseWorkflowYaml(dup)).toThrow(/重复/);
  });
});

describe('workflow-parser · agent 映射', () => {
  // 用例 2：四种映射各归其位
  it('developer→engineer / qa-engineer→reviewer / researcher→fde(sustain) / technical-writer→内置', () => {
    expect(mapAgentType('developer').definition.name).toBe('engineer');
    expect(mapAgentType('developer').fallback).toBe(false);
    expect(mapAgentType('qa-engineer').definition.name).toBe('reviewer');
    const researcher = mapAgentType('researcher');
    expect(researcher.definition.name).toBe('fde');
    expect(researcher.definition.mode).toBe('sustain');
    const writer = mapAgentType('technical-writer');
    expect(writer.definition.name).toBe('technical-writer');
    expect(writer.fallback).toBe(false);
  });

  // 用例 3：未知类型降级
  it('未知 agent 类型 → 降级 technical-writer 内置定义，fallback=true', () => {
    const { definition, fallback } = mapAgentType('data-scientist');
    expect(definition.name).toBe('technical-writer');
    expect(fallback).toBe(true);
  });

  // 用例 4：同类型多节点去重命名
  it('同 agent 类型多节点 → 第二个起名字加节点 id 后缀', () => {
    const yaml = `
workflow:
  nodes:
    - { id: a, agent: developer, task: 任务一 }
    - { id: b, agent: developer, task: 任务二, depends_on: [a] }
    - { id: c, agent: qa-engineer, task: 验证, depends_on: [b] }
`;
    const configs = toSubAgentConfigs(parseWorkflowYaml(yaml));
    expect(configs.map((c) => c.name)).toEqual(['engineer', 'engineer-b', 'reviewer']);
    // 每个 SubAgent 都带 systemPrompt 与 tools
    for (const c of configs) {
      expect(c.systemPrompt.length).toBeGreaterThan(0);
      expect(Array.isArray(c.tools)).toBe(true);
    }
    // 一站式入口等价
    expect(parseWorkflowToSubAgents(yaml).map((c) => c.name)).toEqual(['engineer', 'engineer-b', 'reviewer']);
  });
});
