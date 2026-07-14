import { describe, it, expect } from 'vitest';
import { listTemplates } from '../hub-list';

describe('listTemplates', () => {
  it('返回数组', () => {
    const result = listTemplates();
    expect(Array.isArray(result)).toBe(true);
  });
});
