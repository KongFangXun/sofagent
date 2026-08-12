// ============================================================
// workflow-parser.test.ts · workflow YAML → SubAgent 映射测试
// v1.1.8 新增 · v1.1.9 补 schema 校验测试（F-36）
//
// 覆盖用例（共 12 case）：
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
//  10. F-36：节点数超上限（>20）→ WorkflowParseError
//  11. F-36：task 字段超长（>2000 字符）→ 截断 + WARN
//  12. F-36：正常 5 节点 → 不触发截断/不抛错（回归验证）
// ============================================================

import { describe, it, expect } from 'vitest';

import {
  parseWorkflowYaml,
  toSubAgentConfigs,
  parseWorkflowToSubAgents,
  mapAgentType,
  resolveAgent,
  WorkflowParseError,
} from '../workflow-parser';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

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

describe('workflow-parser · F-36 schema 校验（v1.1.9）', () => {
  // 用例 10：节点数超上限（21 节点）
  it('21 个节点 → WorkflowParseError（超上限 20）', () => {
    const lines: string[] = ['workflow:', '  name: too-many-nodes', '  nodes:'];
    for (let i = 1; i <= 21; i++) {
      lines.push(`    - { id: n${i}, agent: developer, task: task-${i} }`);
    }
    expect(() => parseWorkflowYaml(lines.join('\n'))).toThrow(WorkflowParseError);
    expect(() => parseWorkflowYaml(lines.join('\n'))).toThrow(/超过上限/);
  });

  // 用例 11：task 字段超长（3000 字符）→ 截断至 2000
  it('task 字段 3000 字符 → 截断至 2000', () => {
    const longTask = 'A'.repeat(3000);
    const yaml = `workflow:\n  nodes:\n    - { id: a, agent: developer, task: "${longTask}" }`;
    const parsed = parseWorkflowYaml(yaml);
    expect(parsed.nodes[0]!.task.length).toBe(2000);
    expect(parsed.nodes[0]!.task).toBe('A'.repeat(2000));
  });

  // 用例 12：正常 5 节点 → 不触发截断/不抛错（回归验证）
  it('正常 5 节点 YAML → 不触发截断/不抛错', () => {
    const lines: string[] = ['workflow:', '  name: normal-five', '  nodes:'];
    for (let i = 1; i <= 5; i++) {
      lines.push(`    - { id: n${i}, agent: developer, task: task-${i} }`);
    }
    const parsed = parseWorkflowYaml(lines.join('\n'));
    expect(parsed.nodes.length).toBe(5);
    for (const n of parsed.nodes) {
      expect(n.task.length).toBeLessThan(2000);
    }
  });
});

// ============================================================
// v1.2.6 新增：enterprise agent 映射 + 嵌套/平铺格式兼容
// ============================================================

describe('workflow-parser · enterprise agent（v1.2.6）', () => {
  // 用例：enterprise agent 已注册 → resolveAgent 找到
  it('enterprise agent 已注册 → resolveAgent 返回该 Agent 定义', () => {
    // 创建临时 dataDir，写入 mock subagent YML
    const tmpDir = join(tmpdir(), `wf-parser-test-${Date.now()}`);
    const subagentsDir = join(tmpDir, 'subagents');
    mkdirSync(subagentsDir, { recursive: true });
    writeFileSync(
      join(subagentsDir, 'customer-intake.yml'),
      [
        'name: customer-intake',
        'type: enterprise',
        'description: 客户接单 Agent',
        'tools: [Read, Write]',
        'systemPrompt: 你是客户接单 Agent',
        'modelName: null',
        'hitl: false',
        'knowledgeDomain: 客户域',
      ].join('\n'),
    );

    const node = { id: 'customer-intake', agent: 'enterprise', task: '接单', depends_on: [] };
    const result = resolveAgent(node, tmpDir);
    expect(result.fallback).toBe(false);
    expect(result.definition.name).toBe('customer-intake');
    expect(result.definition.type).toBe('enterprise');
    expect(result.definition.hitl).toBe(false);
    expect(result.definition.knowledgeDomain).toBe('客户域');

    // 清理
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* #9 shim 加固 */ }
  });

  // 用例：enterprise agent 未注册 → 抛错
  it('enterprise agent 未注册 → resolveAgent 抛错（不静默降级）', () => {
    const tmpDir = join(tmpdir(), `wf-parser-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    const node = { id: 'unknown-agent', agent: 'enterprise', task: '未知任务', depends_on: [] };
    expect(() => resolveAgent(node, tmpDir)).toThrow(/未注册/);

    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* #9 shim 加固 */ }
  });

  // 用例：toSubAgentConfigs 传入 dataDir 后 enterprise 节点解析成功
  it('toSubAgentConfigs + dataDir → enterprise 节点解析为企业 Agent', () => {
    const tmpDir = join(tmpdir(), `wf-parser-test-${Date.now()}`);
    const subagentsDir = join(tmpDir, 'subagents');
    mkdirSync(subagentsDir, { recursive: true });
    writeFileSync(
      join(subagentsDir, 'data-entry.yml'),
      [
        'name: data-entry',
        'type: enterprise',
        'description: 数据录入',
        'tools: [Read, Write]',
        'systemPrompt: 你是数据录入 Agent',
        'modelName: null',
      ].join('\n'),
    );

    const yaml = `
workflow:
  nodes:
    - { id: data-entry, agent: enterprise, task: 录入数据 }
`;
    const parsed = parseWorkflowYaml(yaml);
    const configs = toSubAgentConfigs(parsed, tmpDir);
    expect(configs[0]!.name).toBe('data-entry');
    expect(configs[0]!.description).toBe('数据录入');

    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* #9 shim 加固 */ }
  });
});

describe('workflow-parser · 嵌套/平铺格式兼容（v1.2.6 2A）', () => {
  // 用例：嵌套格式（标准）
  it('嵌套格式（workflow: 根节点）正常解析', () => {
    const nested = `
workflow:
  name: 嵌套测试
  description: 嵌套格式
  nodes:
    - id: a
      agent: developer
      task: 任务A
`;
    const parsed = parseWorkflowYaml(nested);
    expect(parsed.name).toBe('嵌套测试');
    expect(parsed.nodes[0]!.id).toBe('a');
  });

  // 用例：平铺格式（旧版兼容——parseWorkflowYaml 的 root.workflow 检查已保证嵌套）
  // 此测试验证 toSubAgentConfigs 不传 dataDir 时内置 agent 仍正常
  it('内置 agent 无 dataDir 时正常解析（向后兼容）', () => {
    const yaml = `
workflow:
  nodes:
    - { id: impl, agent: developer, task: 实现 }
`;
    const configs = toSubAgentConfigs(parseWorkflowYaml(yaml));
    expect(configs[0]!.name).toBe('engineer');
  });
});
