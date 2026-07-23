import { describe, it, expect } from 'vitest';
import { evalCase } from '../eval-scorer';

describe('evalCase', () => {
  it('空 expected 返回满分', () => {
    const result = evalCase({}, {});
    expect(result).toHaveProperty('exactMatch');
    expect(result).toHaveProperty('semanticSimilarity');
    expect(result).toHaveProperty('ruleCompliance');
    expect(result).toHaveProperty('overall');
    // 空 expected 对空 actual：exactMatch 返回 1.0
    expect(result.exactMatch).toBe(1.0);
    expect(result.overall).toBeGreaterThanOrEqual(0);
  });

  it('字段不匹配返回低分', () => {
    const result = evalCase({ result: 'wrong' }, { result: 'expected' });
    expect(result.exactMatch).toBeLessThan(1.0);
  });
});
