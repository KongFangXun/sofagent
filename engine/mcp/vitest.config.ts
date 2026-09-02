import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // D-4 (v1.4.4)：全局测试隔离——SOFAGENT_DATA 预置到 tmp，防测试写真实 HOME
    setupFiles: ['../../tools/vitest-setup.mjs'],
    globals: true,
    // hookTimeout/testTimeout 30s：多个测试文件的 beforeEach 与测试体走
    // vi.resetModules() + 动态 import('./mcp-server')（全模块重载，含
    // tool-registry 80 tools 的完整注册链）或真实 spawn 子进程跑 mcp server，
    // 8GB 本机实测 10-15s/次，分别撞穿 vitest 默认 hookTimeout/testTimeout
    // 10s/5s 假红（9 文件 9 失败 + 二层 8 失败，串行也复现——非并行资源问题，
    // 是重型集成测试在慢机的天然耗时）。断言本身毫秒级。testTimeout 影响
    // 全包 154 测试（绝大多数毫秒级），30s 上限只是天花板不拖慢正常跑。
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
