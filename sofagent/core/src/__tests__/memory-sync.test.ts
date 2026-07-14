// ============================================================
// memory-sync.test.ts · 内存同步测试
// v1.1.0 新增
// ============================================================

import { describe, it, expect } from 'vitest';
import { getPersonaContent } from '../filesystem/memory-sync';

describe('getPersonaContent', () => {
  it('返回 string 或 null', () => {
    const content = getPersonaContent();
    expect(content === null || typeof content === 'string').toBe(true);
  });

  it('函数可调用不抛错', () => {
    expect(() => getPersonaContent()).not.toThrow();
  });
});
