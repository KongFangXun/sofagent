import { defineConfig } from 'vitest/config';

// 8GB 慢机实测：daemon 包多个测试走真实 daemon 数据链（workspace-summary 的
// O(N) 保留策略 6.6s、inspector-layers 的 L1 全量巡检 9s+），撞穿 vitest 默认
// 5s 假红（单跑也复现——非并行资源问题，是测试天然重）。包级 testTimeout
// 30s 上限不拖慢正常用例（274 测试绝大多数毫秒级）。
export default defineConfig({
  test: {
    testTimeout: 30_000,
  },
});
