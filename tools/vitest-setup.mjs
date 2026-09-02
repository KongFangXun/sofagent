// ============================================================
// vitest-setup.mjs · 全局测试隔离（D-4 v1.4.4，P-2 拍板项）
//
// 目的：任何测试若意外写真实 HOME（~/.sofagent/data/），
// 预置的 SOFAGENT_DATA 让写入落到 tmp 目录——天然隔离，防再犯。
// 背景：daemon-errors.jsonl 曾累积 4635 条测试 fixture（436KB）
// 污染真实用户数据目录（v1.2.5 开发中间态遗留）。
//
// 挂载点：engine 下 5 个既有 vitest.config.ts（audit/core/mcp/
// daemon/orchestrator）各 1 行 setupFiles 引用本文件。
// 其余 7 包（harness/eval/think/skillopt/ontology/rules/ab-test）
// 经查无 SOFAGENT_DATA/DATA_DIR 写入面或测试已自带 mkdtemp 隔离。
//
// 语义：仅当测试未显式设置 SOFAGENT_DATA 时才预置（beforeEach 检查），
// 不干扰既有的显式隔离测试。afterAll 清理 tmp 目录（best-effort）。
// ============================================================

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const __viteTestSetupTmpDirs = [];

// vitest 无全局 beforeAll/afterAll hook 文件级 API 时，
// 用 setupFiles 每文件执行一次的语义：进程级预置 + 逐文件追踪
if (!process.env.SOFAGENT_DATA) {
  const dir = mkdtempSync(join(tmpdir(), 'sofagent-vitest-iso-'));
  process.env.SOFAGENT_DATA = dir;
  __viteTestSetupTmpDirs.push(dir);
}

// worker 进程退出时清理（best-effort——泄漏的 tmp 目录不阻塞测试）
process.on('exit', () => {
  for (const dir of __viteTestSetupTmpDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});
