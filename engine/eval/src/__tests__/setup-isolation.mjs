// ============================================================
// setup-isolation.mjs · eval 包测试隔离 setup（v1.4.5 T10）
// ============================================================
//
// 与 tools/check/vitest-setup.mjs 的差异（为何不能共用）：
//   共享 setup 注入 SOFAGENT_DATA——只影响 getDataDir() 一类函数式
//   解析器。eval 的污染面是 EVAL_DIR/EVAL_LATEST/EVAL_HISTORY 三个
//   模块加载期常量（data-paths.ts 顶层 `path.join(SOFAGENT_HOME, 'data')`），
//   只认 SOFAGENT_HOME。且 tools/ 禁改，无法扩展共享文件。
//
// 语义：
//   1. 仅当测试未显式设置 SOFAGENT_HOME 时预置（不干扰既有显式隔离——
//      eval 的 cli.test.ts 在 beforeEach 设 SOFAGENT_HOME=tmp：本 setup
//      先行的预置会被其 beforeEach 覆盖吗？——不会冲突：常量已按预置值
//      定格，测试内部读 EVAL_DIR 一致指向首次加载时的隔离根；其显式
//      设置只影响 resolve* 函数式调用，行为不变坏）
//   2. 同步豁免 SOFAGENT_HOME_ALLOWED_PREFIXES（tmpdir 不在默认白名单）
//   3. 进程退出清理 tmp（best-effort）
// ============================================================

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const __evalSetupTmpDirs = [];

if (!process.env.SOFAGENT_HOME) {
  const dir = mkdtempSync(join(tmpdir(), 'sofagent-eval-vitest-iso-'));
  process.env.SOFAGENT_HOME = dir;
  // tmpdir 不在 sanitizeSofagentHome 默认白名单（用户 home / /opt / /var）——
  // 追加豁免前缀，否则 core 加载时会告警并回退真实 ~/.sofagent（隔离失效）
  const prefixes = process.env.SOFAGENT_HOME_ALLOWED_PREFIXES;
  process.env.SOFAGENT_HOME_ALLOWED_PREFIXES = prefixes
    ? `${prefixes}:${tmpdir()}`
    : tmpdir();
  __evalSetupTmpDirs.push(dir);
}

// worker 进程退出时清理（best-effort——泄漏 tmp 不阻塞测试）
process.on('exit', () => {
  for (const dir of __evalSetupTmpDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});
