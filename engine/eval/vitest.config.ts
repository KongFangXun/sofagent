// ============================================================
// vitest.config.ts · eval 包测试隔离（v1.4.5 T10）
// ============================================================
//
// 问题：eval 测试直接污染生产数据——persistResult 写 EVAL_DIR/
// EVAL_LATEST/EVAL_HISTORY（@sofagent/core 模块加载期常量，走
// SOFAGENT_HOME 链）。eval 的测试在 beforeEach 才设 SOFAGENT_HOME
// 太晚：@sofagent/core 在 import 时已解析 DATA_DIR 为真实
// ~/.sofagent/data——测试产物落生产目录。
//
// 方案：包内 setup 文件（setupFiles 在测试模块 import 前执行）预置
// SOFAGENT_HOME 到 tmpdir + SOFAGENT_HOME_ALLOWED_PREFIXES 豁免
// （sanitizeSofagentHome 白名单默认只含用户 home + /opt 等——tmpdir
// 不在名单，不豁免会被强制回退真实 home，隔离失效）。
//
// 注意：不共用 tools/check/vitest-setup.mjs（它注入 SOFAGENT_DATA——
// 对 EVAL_* 常量无效，那是 SOFAGENT_HOME 链）；tools/ 属并行工作面禁改。
// ============================================================

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // v1.4.5 T10：进程级预置 SOFAGENT_HOME（在所有测试模块 import 前生效——
    // @sofagent/core 的 DATA_DIR/EVAL_DIR 常量据此解析到 tmp 隔离目录）
    setupFiles: ['./src/__tests__/setup-isolation.mjs'],
    testTimeout: 30_000,
  },
});
