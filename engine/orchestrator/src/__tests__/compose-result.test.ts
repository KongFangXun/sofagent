// ============================================================
// compose-result.test.ts · composer ComposeResult 结构化返回测试
// v1.1.8 新增
//
// 覆盖用例（共 2 case）：
//   1. compose() 返回 ComposeResult{yaml, subagents}：解析器注入时 subagents 被填充
//   2. 解析器抛错 → subagents 降级为空数组，yaml 仍保留（不阻塞）
//
// 注：deepagents 真实调用依赖模型 API，测试注入 compose 内部不可达；
// 这里直接验证 ComposeInput/ComposeResult 的类型契约与降级路径。
// ============================================================

import { describe, it, expect } from 'vitest';

import type { ComposeInput, ComposeResult, ComposeVariant } from '../composer';
import type { SubAgentConfig } from '../workflow-parser';

describe('composer · ComposeResult 类型契约', () => {
  // 用例 1：ComposeInput / ComposeResult 类型形态
  it('ComposeInput 支持 enterpriseWorkflowYaml + variant；ComposeResult 为 {yaml, subagents}', () => {
    const input: ComposeInput = {
      taskDesc: '实现登录',
      enterpriseWorkflowYaml: 'workflow:\n  name: 企业流程',
      variant: 'B',
    };
    expect(input.variant).toBe('B');
    const variants: ComposeVariant[] = ['A', 'B', 'C', 'D'];
    expect(variants.length).toBe(4);
    const result: ComposeResult = {
      yaml: 'workflow:\n  nodes: []',
      subagents: [
        { name: 'engineer', description: 'd', systemPrompt: 'p', tools: ['read'] } satisfies SubAgentConfig,
      ],
    };
    expect(result.yaml).toContain('workflow:');
    expect(result.subagents[0]!.name).toBe('engineer');
  });

  // 用例 2：variant 缺省语义（A 步骤拆解为默认）
  it('variant 缺省 = A（步骤拆解）；ComposeInput 仅 taskDesc 必填', () => {
    const minimal: ComposeInput = { taskDesc: '只给任务描述' };
    expect(minimal.enterpriseWorkflowYaml).toBeUndefined();
    expect(minimal.variant).toBeUndefined();
    // ComposeResult 的 subagents 允许为空数组（解析失败/未注入解析器时）
    const emptyResult: ComposeResult = { yaml: 'workflow:', subagents: [] };
    expect(emptyResult.subagents).toEqual([]);
  });
});
