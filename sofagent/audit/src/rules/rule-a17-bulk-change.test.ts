// ============================================================
// rule-a17-bulk-change.test.ts · A17 异常批量变更测试
// v1.0.9 新增
// ============================================================

import { describe, it, expect } from 'vitest';
import { checkRuleA17 } from './rule-a17-bulk-change';
import { makeDiffFile, makeCtx } from '../test-utils';

const defaultConfig = {
  A17: {
    enabled: true,
    bulk_threshold: 50,
    bulk_window_ms: 300000,
  },
};

describe('A17 异常批量变更', () => {
  it('少量变更 → PASS', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/a.ts', ['+a']), makeDiffFile('src/b.ts', ['+b'])],
      { config: defaultConfig as any }
    );
    const result = checkRuleA17(ctx);
    expect(result.status).toBe('PASS');
  });

  it('超过阈值变更 → WARN', () => {
    const files = Array.from({ length: 55 }, (_, i) =>
      makeDiffFile(`src/file${i}.ts`, [`+line`])
    );
    const ctx = makeCtx(files, { config: defaultConfig as any });
    const result = checkRuleA17(ctx);
    expect(result.status).toBe('WARN');
  });

  it('规则 disabled → PASS', () => {
    const files = Array.from({ length: 60 }, (_, i) =>
      makeDiffFile(`src/file${i}.ts`, [`+line`])
    );
    const ctx = makeCtx(files, { config: { A17: { enabled: false } } as any });
    const result = checkRuleA17(ctx);
    expect(result.status).toBe('PASS');
  });

  it('evidenceMode 标注为 filesystem', () => {
    const ctx = makeCtx(
      [makeDiffFile('src/index.ts', ['+console.log(1);'])],
      { config: defaultConfig as any }
    );
    const result = checkRuleA17(ctx);
    expect(result.evidenceMode).toBe('filesystem');
  });

  it('历史累加超阈值 → WARN', () => {
    const now = new Date();
    const history = Array.from({ length: 3 }, (_, i) => ({
      timestamp: new Date(now.getTime() - (i + 1) * 60000).toISOString(),
      diffFileCount: 20,
    }));
    const files = Array.from({ length: 5 }, (_, i) =>
      makeDiffFile(`src/file${i}.ts`, [`+line`])
    );
    const ctx = makeCtx(files, { config: defaultConfig as any, history });
    const result = checkRuleA17(ctx);
    // 5 (current) + 60 (history) = 65 >= 50 → WARN
    expect(result.status).toBe('WARN');
  });

  it('历史过期不累加 → PASS', () => {
    const now = new Date();
    const history = [
      {
        timestamp: new Date(now.getTime() - 400000).toISOString(),
        diffFileCount: 60,
      },
    ];
    const files = Array.from({ length: 5 }, (_, i) =>
      makeDiffFile(`src/file${i}.ts`, [`+line`])
    );
    const ctx = makeCtx(files, { config: defaultConfig as any, history });
    const result = checkRuleA17(ctx);
    expect(result.status).toBe('PASS');
  });
});
