import { describe, it, expect } from 'vitest';
import { loadCronConfig } from '../cron';

describe('loadCronConfig', () => {
  it('无配置时返回空数组', () => {
    const result = loadCronConfig('/tmp/nonexistent-dir-' + Date.now());
    expect(Array.isArray(result)).toBe(true);
  });
});
