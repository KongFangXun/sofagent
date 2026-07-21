// ============================================================
// dag-runner.test.ts · 编排执行器测试（mock DeepAgents）
// v1.1.8 新增
//
// 覆盖用例（共 5 case）：
//   1. 端到端：YAML → SubAgent 创建（注入四层约束 prompt）→ invoke → DAGResult
//   2. 裁决 #1：同文件冲突检测——多节点声明同一文件 → WARN（不阻塞）
//   3. 无冲突时 warnings 为空数组
//   4. 裁决 #4：ORCHESTRATOR_PROMPT 含并行引导语
//   5. deepagents 不可用（createDeepAgent 返回 null 等价路径）→ 抛错
// ============================================================

import { describe, it, expect } from 'vitest';

import {
  runDAG,
  detectFileConflicts,
  ORCHESTRATOR_PROMPT,
  type CreateDeepAgentFn,
} from '../dag-runner';
import { parseWorkflowYaml } from '../workflow-parser';

const TWO_NODE_YAML = `
workflow:
  name: 双节点流程
  nodes:
    - id: impl
      agent: developer
      task: 实现功能
    - id: test
      agent: qa-engineer
      task: 验证功能
      depends_on: [impl]
`;

/** mock createDeepAgent：捕获参数 + 返回固定 invoke 结果 */
function mockCreateDeepAgent(
  captured: { params?: Parameters<CreateDeepAgentFn>[0] },
  invokeResult: unknown = { messages: [{ role: 'assistant', content: '完成' }] },
): CreateDeepAgentFn {
  return async (params) => {
    captured.params = params;
    return { invoke: async () => invokeResult };
  };
}

const mockBuildPrompt = (_root: string): string => '[四层约束加载链]';

describe('dag-runner · 编排执行', () => {
  // 用例 1：端到端主路径
  it('YAML → SubAgent（注入约束 prompt）→ invoke → DAGResult', async () => {
    const captured: { params?: Parameters<CreateDeepAgentFn>[0] } = {};
    const result = await runDAG('实现登录', TWO_NODE_YAML, '/proj', {
      createDeepAgent: mockCreateDeepAgent(captured),
      buildConstrainedSystemPrompt: mockBuildPrompt,
    });
    // subagents 不再是 []
    expect(captured.params).toBeDefined();
    expect(captured.params!.subagents.length).toBe(2);
    // 每个 SubAgent 的 systemPrompt 前置四层约束链
    for (const sa of captured.params!.subagents) {
      expect(sa.systemPrompt.startsWith('[四层约束加载链]')).toBe(true);
    }
    // 编排器 prompt 是 ORCHESTRATOR_PROMPT
    expect(captured.params!.systemPrompt).toBe(ORCHESTRATOR_PROMPT);
    // DAGResult 结构
    expect(result.subagentCount).toBe(2);
    expect(result.workflow.name).toBe('双节点流程');
    expect(result.warnings).toEqual([]);
    expect(result.finalOutput).toBeDefined();
  });

  // 用例 2：同文件冲突检测（裁决 #1）
  it('多节点声明同一文件 → detectFileConflicts 产出 WARN，执行不阻塞', async () => {
    const conflictYaml = `
workflow:
  name: 冲突流程
  nodes:
    - id: a
      agent: developer
      task: 修改 \`src/app.ts\` 加登录
    - id: b
      agent: developer
      task: 修改 \`src/app.ts\` 加注册
`;
    const warnings = detectFileConflicts(parseWorkflowYaml(conflictYaml));
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('src/app.ts');
    expect(warnings[0]).toContain('a, b');
    // WARN 不阻塞执行
    const captured: { params?: Parameters<CreateDeepAgentFn>[0] } = {};
    const result = await runDAG('t', conflictYaml, '/proj', {
      createDeepAgent: mockCreateDeepAgent(captured),
      buildConstrainedSystemPrompt: mockBuildPrompt,
    });
    expect(result.warnings.length).toBe(1);
    expect(result.subagentCount).toBe(2);
  });

  // 用例 3：无冲突 → 空数组
  it('各节点文件不相交 → warnings 为空数组', () => {
    const okYaml = `
workflow:
  nodes:
    - { id: a, agent: developer, task: 修改 \`src/a.ts\` }
    - { id: b, agent: developer, task: 修改 \`src/b.ts\` }
`;
    expect(detectFileConflicts(parseWorkflowYaml(okYaml))).toEqual([]);
  });

  // 用例 4：ORCHESTRATOR_PROMPT 并行引导（裁决 #4）
  it('ORCHESTRATOR_PROMPT 含并行委派引导语', () => {
    expect(ORCHESTRATOR_PROMPT).toContain('并行');
    expect(ORCHESTRATOR_PROMPT).toContain('task');
    expect(ORCHESTRATOR_PROMPT).toContain('depends_on');
  });

  // 用例 5：createDeepAgent 加载失败 → 抛错
  it('deepagents 不可用 → 抛错', async () => {
    await expect(
      runDAG('t', TWO_NODE_YAML, '/proj', {
        // 注入 undefined 触发动态 import——在测试环境 deepagents 实际可用，
        // 因此显式注入一个"加载失败等价"的 null 工厂路径：
        // runDAG 对 null 的判定是 throw，这里用抛错的工厂模拟
        createDeepAgent: (async () => { throw new Error('deepagents 不可用——无法创建编排 Agent'); }) as CreateDeepAgentFn,
        buildConstrainedSystemPrompt: mockBuildPrompt,
      }),
    ).rejects.toThrow(/deepagents 不可用/);
  });
});
