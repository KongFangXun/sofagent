import { defineConfig } from 'vitest/config';

// v1.3.7 阶段五新增：本包测试含大量 tmpdir IO（commons 五环 / instinct / 激活链 / checkpoint），
// 全量并行跑时与其他 11 包争用 IO 会偶发超时（单跑稳定绿——非代码回归，资源竞争型）。
// 包级 testTimeout 20s + 并发 worker 限 2（8GB 机器均衡点，FORGE run-07 同款结论）。
// v1.4.3 B14: ① retry 1——test 级只重试失败用例（IO 争用超时自动重跑一次，通过用例零影响；
//   根因是资源竞争非代码回归，注释化处理而非裸 retry 掩盖）② cacheDir 独立——根除与并发
//   build/其他包 vitest 的缓存竞争（fresh-eyes 实测：并发干扰下本包测试文件被漏收集，
//   746→563 且 FAILED=0 假绿——门禁结果不确定性的又一来源）。
export default defineConfig({
  test: {
    // D-4 (v1.4.4)：全局测试隔离——SOFAGENT_DATA 预置到 tmp，防测试写真实 HOME
    setupFiles: ['../../tools/vitest-setup.mjs'],
    // testTimeout 20s→60s：8GB 慢机全量串行实测仍有 audit spawn 链测试 40-50s
    //（HITL 多次驳回/graph 五环等，spawn audit 5-8s/次 ×N 轮），20s+retry 也不够。
    // 60s 上限不拖慢正常用例（绝大多数毫秒级）。retry 1 保留。
    testTimeout: 60000,
    maxConcurrency: 2,
    retry: 1,
    cacheDir: 'node_modules/.vitest-orchestrator',
  },
});
