// ============================================================
// verify.test.ts · 装后验证测试
// v1.1.0 新增
// ============================================================

import { describe, it, expect } from 'vitest';
import { Verifier } from '../verify/verifier';

describe('Verifier', () => {
  it('初始化后检查计数为 0', () => {
    const v = new Verifier(false, false);
    const result = v.getResult();
    expect(result.total).toBe(0);
  });

  it('checkPass 添加通过记录', () => {
    const v = new Verifier(false, false);
    v.checkPass('test passed');
    const result = v.getResult();
    expect(result.pass).toBe(1);
    expect(result.checks[0]!.status).toBe('pass');
  });

  it('checkFail 添加失败记录', () => {
    const v = new Verifier(false, false);
    v.checkFail('[EXPECTED FAILURE] test failed');
    const result = v.getResult();
    expect(result.fail).toBe(1);
    expect(result.checks[0]!.status).toBe('fail');
  });

  it('checkWarn 添加警告记录', () => {
    const v = new Verifier(false, false);
    v.checkWarn('test warning');
    const result = v.getResult();
    expect(result.warn).toBe(1);
    expect(result.checks[0]!.status).toBe('warn');
  });

  it('getResult 汇总所有检查', () => {
    const v = new Verifier(false, false);
    v.checkPass('item 1');
    v.checkWarn('item 2');
    v.checkFail('item 3');
    const result = v.getResult();
    expect(result.pass).toBe(1);
    expect(result.warn).toBe(1);
    expect(result.fail).toBe(1);
    expect(result.total).toBe(3);
  });
});
