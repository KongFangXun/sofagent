import { defineConfig } from 'vitest/config';

// 8GB 慢机实测：audit 包 support-bundle 测试每次 readFileSync 全量读真实
// ~/.sofagent/data/audit/audit-history.jsonl（48MB 级随使用增长，7-13s/次）、
// ast-ruleset.integration 走完整审计管线（spawn + AST，10s+），撞穿 vitest
// 默认 5s 假红。包级 testTimeout 60s 上限不拖慢正常用例（919 测试绝大多数
// 毫秒级）。
export default defineConfig({
  test: {
    testTimeout: 60_000,
  },
});
