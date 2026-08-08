// ============================================================
// list-agents.test.ts · list_agents tool 测试
// v1.2.9 新增
// ============================================================

import { describe, it, expect } from 'vitest';
import { listAgentsTool } from '../tools/list-agents';

describe('list_agents tool（v1.2.6）', () => {
  // 用例：返回结构正确
  it('返回结构包含 [sofagent] 前缀和 text/data 字段', async () => {
    const result = await listAgentsTool();
    expect(result).toHaveProperty('text');
    expect(result).toHaveProperty('data');
    expect(result.text).toMatch(/^\[sofagent\]/);
    expect(result.data).toHaveProperty('agents');
    expect(result.data).toHaveProperty('count');
    expect(result.data).toHaveProperty('builtinCount');
    expect(result.data).toHaveProperty('enterpriseCount');
  });

  // 用例：text 首行包含 [sofagent] 前缀
  it('text 首行以 [sofagent] 开头', async () => {
    const result = await listAgentsTool();
    expect(result.text.startsWith('[sofagent]')).toBe(true);
  });

  // 用例：count = builtinCount + enterpriseCount
  it('count = builtinCount + enterpriseCount', async () => {
    const result = await listAgentsTool();
    expect(result.data.count).toBe(result.data.builtinCount + result.data.enterpriseCount);
  });
});
