import { defineConfig } from 'vitest/config';

// v1.3.7 阶段五新增：本包测试含外部命令探测（detectTools which/git/docker 多工具 × version 查询）
// 与真实文件系统扫描（doctor 全段检查），全量并行跑时与其他 11 包争用 IO/进程表会偶发超时
// （单跑稳定绿——非代码回归，资源竞争型）。包级 testTimeout 20s。
export default defineConfig({
  test: {
    // D-4 (v1.4.4)：全局测试隔离——SOFAGENT_DATA 预置到 tmp，防测试写真实 HOME
    setupFiles: ['../../tools/check/vitest-setup.mjs'],
    testTimeout: 20000,
  },
});

