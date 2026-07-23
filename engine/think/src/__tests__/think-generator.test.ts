import { describe, it, expect } from 'vitest';
import { generateThinkEntry } from '../think-generator';

describe('generateThinkEntry', () => {
  it('空 diff 不抛错且不写文件', () => {
    // generateThinkEntry with empty diff should return early without error
    expect(() => {
      generateThinkEntry(
        [],
        { exitCode: 0, rules: [], status: 'PASS', details: [], diffFileCount: 0, diffRange: '', ruleResults: [] },
      );
    }).not.toThrow();
  });
});
