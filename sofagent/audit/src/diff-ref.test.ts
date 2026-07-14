// ============================================================
// diff-ref.test.ts · resolveDiffEndpoint 单元测试
// v1.1.0 新增（T02 回归测试：--diff range 取终点 commit）
// ============================================================

import { describe, it, expect } from 'vitest';
import { resolveDiffEndpoint } from './diff-ref';

describe('resolveDiffEndpoint (T02: --diff range 取终点)', () => {
  it('含 .. 的范围取最后一个片段（终点）', () => {
    expect(resolveDiffEndpoint('HEAD~3..HEAD~1')).toBe('HEAD~1');
  });

  it('HEAD~1..HEAD 取 HEAD', () => {
    expect(resolveDiffEndpoint('HEAD~1..HEAD')).toBe('HEAD');
  });

  it('多段范围取最后一段', () => {
    expect(resolveDiffEndpoint('abc..def..ghi')).toBe('ghi');
  });

  it('无范围回退 HEAD', () => {
    expect(resolveDiffEndpoint(undefined)).toBe('HEAD');
    expect(resolveDiffEndpoint('')).toBe('HEAD');
    expect(resolveDiffEndpoint('HEAD')).toBe('HEAD');
  });

  it('无 .. 的普通 ref 原样返回', () => {
    expect(resolveDiffEndpoint('main')).toBe('main');
  });
});
