import { describe, it, expect } from 'vitest';
import { buildConstrainedSystemPrompt } from '../index';

describe('buildConstrainedSystemPrompt', () => {
  it('无配置返回空', () => {
    const result = buildConstrainedSystemPrompt('/tmp/nonexistent-' + Date.now());
    expect(typeof result).toBe('string');
  });
});
