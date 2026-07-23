// ============================================================
// memory-contract-trust.test.ts · trust 可信分级契约测试
// v1.1.8 新增
//
// 覆盖用例（共 4 case）：
//   1. 缺省：frontmatter 缺 trust → 按 internal 处理（safe-by-default）
//   2. 非法值：大小写异常/拼写错误/注入串/非字符串 → 回落 internal
//   3. 合法值：official / internal / user / web 原样解析（含大小写与空白归一化）
//   4. 全序权重：official > internal > user > web
// ============================================================

import { describe, it, expect } from 'vitest';

import {
  DEFAULT_TRUST,
  TRUST_ORDER,
  resolveTrust,
} from '../memory-contract';

describe('resolveTrust · 缺省/非法值解析', () => {
  // 用例 1：缺省 → internal
  it('frontmatter 缺 trust → 默认 internal（safe-by-default）', () => {
    expect(resolveTrust({})).toBe('internal');
    expect(resolveTrust(null)).toBe('internal');
    expect(resolveTrust(undefined)).toBe('internal');
    expect(resolveTrust({ domain: 'user' })).toBe('internal');
    expect(DEFAULT_TRUST).toBe('internal');
  });

  // 用例 2：非法值 → 回落 internal
  it('非法 trust（拼写错误/注入串/非字符串类型）→ 回落 internal', () => {
    expect(resolveTrust({ trust: 'offical' })).toBe('internal'); // 拼写错误
    expect(resolveTrust({ trust: 'trusted' })).toBe('internal');
    expect(resolveTrust({ trust: 'web; DROP TABLE' })).toBe('internal');
    expect(resolveTrust({ trust: 123 })).toBe('internal');
    expect(resolveTrust({ trust: ['web'] })).toBe('internal');
    expect(resolveTrust({ trust: { level: 'web' } })).toBe('internal');
  });

  // 用例 3：合法值原样解析（含归一化）
  it('合法值 official / internal / user / web 原样解析，大小写与空白归一化', () => {
    expect(resolveTrust({ trust: 'official' })).toBe('official');
    expect(resolveTrust({ trust: 'internal' })).toBe('internal');
    expect(resolveTrust({ trust: 'user' })).toBe('user');
    expect(resolveTrust({ trust: 'web' })).toBe('web');
    // 归一化：trim + lowercase（与 resolveSensitivity 同范式）
    expect(resolveTrust({ trust: ' Official ' })).toBe('official');
    expect(resolveTrust({ trust: 'WEB' })).toBe('web');
  });
});

describe('TRUST_ORDER · 可信全序', () => {
  // 用例 4：official > internal > user > web
  it('全序权重：official(3) > internal(2) > user(1) > web(0)', () => {
    expect(TRUST_ORDER.official).toBeGreaterThan(TRUST_ORDER.internal);
    expect(TRUST_ORDER.internal).toBeGreaterThan(TRUST_ORDER.user);
    expect(TRUST_ORDER.user).toBeGreaterThan(TRUST_ORDER.web);
    expect(TRUST_ORDER).toEqual({ official: 3, internal: 2, user: 1, web: 0 });
  });
});
