// ============================================================
// dag-runner.test.ts · 编排执行器测试（mock createReactAgent）
// v1.1.8 新增 · v1.2.9 迁移至 createReactAgent（方案 B）
//
// 覆盖用例（共 6 case）：
//   1. 端到端：YAML → SubAgent tools 创建（注入四层约束 prompt）→ invoke → DAGResult
//   2. 裁决 #1：同文件冲突检测——多节点声明同一文件 → WARN（不阻塞）
//   3. 无冲突时 warnings 为空数组
//   4. 裁决 #4：ORCHESTRATOR_PROMPT 含并行引导语
//   5. createReactAgent 不可用 → 抛错
//   6. F-01 回归：SubAgent tools 数组不为空
// ============================================================

import { describe, it, expect } from 'vitest';

import {
  runDAG,
  detectFileConflicts,
  ORCHESTRATOR_PROMPT,
  assertSubAgentsNoEmptyTools,
  type CreateReactAgentFn,
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

/** mock createReactAgent：捕获参数 + 返回固定 invoke 结果 */
function mockCreateReactAgent(
  captured: { params?: Parameters<CreateReactAgentFn>[0] },
  invokeResult: unknown = { messages: [{ role: 'assistant', content: '完成' }] },
): CreateReactAgentFn {
  return async (params) => {
    captured.params = params;
    return { invoke: async () => invokeResult };
  };
}

const mockBuildPrompt = (_root: string): string => '[四层约束加载链]';

const mockResolveModel = async (): Promise<unknown> => ({ mockModel: true });

describe('dag-runner · 编排执行', () => {
  // 用例 1：端到端主路径
  it('YAML → SubAgent tools（注入约束 prompt）→ invoke → DAGResult', async () => {
    const captured: { params?: Parameters<CreateReactAgentFn>[0] } = {};
    const result = await runDAG('实现登录', TWO_NODE_YAML, '/proj', {
      createReactAgent: mockCreateReactAgent(captured),
      buildConstrainedSystemPrompt: mockBuildPrompt,
      resolveModel: mockResolveModel,
    });
    // subagent tools 不为空
    expect(captured.params).toBeDefined();
    expect(captured.params!.tools.length).toBe(2);
    // 编排器 prompt 是 ORCHESTRATOR_PROMPT
    expect(captured.params!.prompt).toBe(ORCHESTRATOR_PROMPT);
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
    const captured: { params?: Parameters<CreateReactAgentFn>[0] } = {};
    const result = await runDAG('t', conflictYaml, '/proj', {
      createReactAgent: mockCreateReactAgent(captured),
      buildConstrainedSystemPrompt: mockBuildPrompt,
      resolveModel: mockResolveModel,
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
    expect(ORCHESTRATOR_PROMPT).toContain('task_');
    expect(ORCHESTRATOR_PROMPT).toContain('depends_on');
  });

  // 用例 5：createReactAgent 加载失败 → 抛错
  it('createReactAgent 不可用 → 抛错', async () => {
    await expect(
      runDAG('t', TWO_NODE_YAML, '/proj', {
        // 注入一个抛错的工厂模拟 createReactAgent 不可用
        createReactAgent: (async () => { throw new Error('createReactAgent 不可用——无法创建编排 Agent'); }) as CreateReactAgentFn,
        buildConstrainedSystemPrompt: mockBuildPrompt,
        resolveModel: mockResolveModel,
      }),
    ).rejects.toThrow(/createReactAgent 不可用/);
  });

  // 用例 6（F-01 回归防护）：SubAgent tools 数组不为空
  it('SubAgent tools 数组不为空（每个 SubAgent 继承默认工具集）', async () => {
    const captured: { params?: Parameters<CreateReactAgentFn>[0] } = {};
    await runDAG('实现登录', TWO_NODE_YAML, '/proj', {
      createReactAgent: mockCreateReactAgent(captured),
      buildConstrainedSystemPrompt: mockBuildPrompt,
      resolveModel: mockResolveModel,
    });
    expect(captured.params).toBeDefined();
    // tools 不应为空数组——每个 task tool 对应一个 SubAgent
    expect(captured.params!.tools.length).toBeGreaterThan(0);
    // 回归防护辅助函数也验证
    expect(() => assertSubAgentsNoEmptyTools(captured.params!.tools)).not.toThrow();
  });
});
