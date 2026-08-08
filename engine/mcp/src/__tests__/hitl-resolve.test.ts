// ============================================================
// hitl-resolve.test.ts · hitl_resolve tool 测试
// v1.2.9 新增
// ============================================================

import { describe, it, expect } from 'vitest';
import { hitlResolve } from '../tools/hitl-resolve';

describe('hitl_resolve tool（v1.2.6）', () => {
  // 用例：缺少 checkpoint_id 参数 → 返回错误
  it('缺少 checkpoint_id → 返回 ok=false', async () => {
    const result = await hitlResolve({
      checkpoint_id: '',
      decision: 'approve',
    });
    expect(result.data.ok).toBe(false);
    expect(result.text).toMatch(/^\[sofagent\]/);
  });

  // 用例：无效 decision → 返回错误
  it('无效 decision → 返回 ok=false', async () => {
    const result = await hitlResolve({
      checkpoint_id: 'test-checkpoint',
      decision: 'invalid' as 'approve',
    });
    expect(result.data.ok).toBe(false);
    expect(result.text).toMatch(/approve.*reject.*aborted|decision/);
  });

  // 用例：checkpointId 不存在 → 返回错误
  it('checkpointId 在 pending/ 不存在 → 返回 ok=false', async () => {
    const result = await hitlResolve({
      checkpoint_id: 'nonexistent-checkpoint-id',
      decision: 'approve',
    });
    // 可能因 orchestrator 不可用先失败，也可能到 checkpoint 校验失败
    expect(result.data.ok).toBe(false);
    expect(result.text).toMatch(/^\[sofagent\]/);
  });

  // 用例：返回结构始终包含 [sofagent] 前缀
  it('text 首行以 [sofagent] 开头', async () => {
    const result = await hitlResolve({
      checkpoint_id: 'test',
      decision: 'approve',
    });
    expect(result.text.startsWith('[sofagent]')).toBe(true);
  });
});
