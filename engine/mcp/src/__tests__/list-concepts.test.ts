// ============================================================
// list-concepts.test.ts · list_concepts tool 测试
// v1.2.6 新增
// ============================================================

import { describe, it, expect } from 'vitest';
import { listConcepts } from '../tools/list-concepts';

describe('list_concepts tool（v1.2.6）', () => {
  // 用例：返回结构正确
  it('返回结构包含 [sofagent] 前缀和 text/data 字段', () => {
    const result = listConcepts();
    expect(result).toHaveProperty('text');
    expect(result).toHaveProperty('data');
    expect(result.text).toMatch(/^\[sofagent\]/);
    expect(result.data).toHaveProperty('concepts');
    expect(result.data).toHaveProperty('count');
    expect(Array.isArray(result.data.concepts)).toBe(true);
  });

  // 用例：text 首行包含 [sofagent] 前缀
  it('text 首行以 [sofagent] 开头', () => {
    const result = listConcepts();
    expect(result.text.startsWith('[sofagent]')).toBe(true);
  });

  // 用例：count 与 concepts 数组长度一致
  it('count = concepts.length', () => {
    const result = listConcepts();
    expect(result.data.count).toBe(result.data.concepts.length);
  });
});
