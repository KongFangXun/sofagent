import { defineConfig } from 'vitest/config';

// v1.3.5 阶段五新增：本包测试含大量 tmpdir IO（market 五环 / instinct / 激活链 / checkpoint），
// 全量并行跑时与其他 11 包争用 IO 会偶发超时（单跑稳定绿——非代码回归，资源竞争型）。
// 包级 testTimeout 20s + 并发 worker 限 2（8GB 机器均衡点，FORGE run-07 同款结论）。
export default defineConfig({
  test: {
    testTimeout: 20000,
    maxConcurrency: 2,
  },
});
