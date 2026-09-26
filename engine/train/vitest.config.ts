import { defineConfig } from 'vitest/config';

// ============================================================
// vitest.config.ts · train 包测试隔离（v1.5.3 第 7 批拆包）
// ============================================================
//
// 本包自 @sofagent/orchestrator 的 src/train/ 整体迁出（51 文件），随迁的测试
// 同 orchestator 原状：大量 tmpdir IO（train-job / train-fingerprint /
// retention-policy / train-serve 的 spawn + 文件系统写入）。
//
// 与 orchestrator 同款三件事：
//   ① setupFiles —— 全局测试隔离（SOFAGENT_DATA 预置到 tmp，防测试写真实 HOME）
//   ② testTimeout 60s —— 慢机全量串行实测有 spawn 链用例 40-50s，20s 不够
//   ③ retry 1 —— 仅重试失败用例（IO 争用超时自动重跑一次，通过用例零影响）
//   ④ cacheDir 独立 —— 根除与并发 build/其他包 vitest 的缓存竞争
// ============================================================

export default defineConfig({
  test: {
    setupFiles: ['../../tools/check/vitest-setup.mjs'],
    testTimeout: 60000,
    maxConcurrency: 2,
    retry: 1,
    cacheDir: 'node_modules/.vitest-train',
  },
});
