// ============================================================
// memory-contract-sensitivity.test.ts · sensitivity 分级契约测试
// v1.1.6 新增
//
// 覆盖用例（共 5 case，门禁 ≥3）：
//   1. 缺省：frontmatter 缺 sensitivity → 按 internal 处理
//   2. 非法值：大小写异常/拼写错误/注入串 → 回落 internal（safe-by-default）
//   3. 合法值：public / internal / restricted 原样解析
//   4. 可见性全序：public ≤ internal ≤ restricted，restricted 不向 internal 泄露
//   5. 过滤语义：默认 viewer（internal）只可见 public+internal，restricted 被过滤
// ============================================================

import { describe, it, expect } from 'vitest';

import {
  DEFAULT_SENSITIVITY,
  resolveSensitivity,
  isSensitivityVisible,
} from '../memory-contract';

describe('resolveSensitivity · 缺省/非法值解析', () => {
  // 用例 1：缺省 → internal
  it('frontmatter 缺 sensitivity → 默认 internal（safe-by-default）', () => {
    expect(resolveSensitivity({})).toBe('internal');
    expect(resolveSensitivity(null)).toBe('internal');
    expect(resolveSensitivity(undefined)).toBe('internal');
    expect(resolveSensitivity({ domain: 'user' })).toBe('internal');
    expect(DEFAULT_SENSITIVITY).toBe('internal');
  });

  // 用例 2：非法值 → 回落 internal
  it('非法 sensitivity（拼写错误/注入串/非字符串类型）→ 回落 internal', () => {
    expect(resolveSensitivity({ sensitivity: 'publ1c' })).toBe('internal');
    expect(resolveSensitivity({ sensitivity: 'secret' })).toBe('internal');
    expect(resolveSensitivity({ sensitivity: 'restricted; DROP TABLE' })).toBe('internal');
    expect(resolveSensitivity({ sensitivity: 123 })).toBe('internal');
    expect(resolveSensitivity({ sensitivity: ['public'] })).toBe('internal');
  });

  // 用例 3：合法值原样解析
  it('合法值 public / internal / restricted 原样解析', () => {
    expect(resolveSensitivity({ sensitivity: 'public' })).toBe('public');
    expect(resolveSensitivity({ sensitivity: 'internal' })).toBe('internal');
    expect(resolveSensitivity({ sensitivity: 'restricted' })).toBe('restricted');
  });
});

describe('isSensitivityVisible · 可见性全序', () => {
  // 用例 4：全序 public ≤ internal ≤ restricted
  it('全序 public ≤ internal ≤ restricted，restricted 不向低级别泄露', () => {
    // public viewer 只能看 public
    expect(isSensitivityVisible('public', 'public')).toBe(true);
    expect(isSensitivityVisible('internal', 'public')).toBe(false);
    expect(isSensitivityVisible('restricted', 'public')).toBe(false);
    // internal viewer 能看 public + internal，看不了 restricted
    expect(isSensitivityVisible('public', 'internal')).toBe(true);
    expect(isSensitivityVisible('internal', 'internal')).toBe(true);
    expect(isSensitivityVisible('restricted', 'internal')).toBe(false);
    // restricted viewer 全能看
    expect(isSensitivityVisible('public', 'restricted')).toBe(true);
    expect(isSensitivityVisible('internal', 'restricted')).toBe(true);
    expect(isSensitivityVisible('restricted', 'restricted')).toBe(true);
  });

  // 用例 5：过滤语义——默认 viewer 只可见 public+internal
  it('默认 viewer（internal）过滤：restricted 条目被过滤，public+internal 可见', () => {
    const entries = [
      { sensitivity: 'public' as const, title: '公开条目' },
      { sensitivity: 'internal' as const, title: '内部条目' },
      { sensitivity: 'restricted' as const, title: '受限条目-绝不泄露' },
    ];
    const visible = entries.filter((e) => isSensitivityVisible(e.sensitivity));
    expect(visible.length).toBe(2);
    expect(visible.map((e) => e.title)).not.toContain('受限条目-绝不泄露');
    expect(visible.every((e) => e.sensitivity !== 'restricted')).toBe(true);
  });
});
