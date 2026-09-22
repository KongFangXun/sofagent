#!/usr/bin/env node
// ============================================================
// bin/sofagent.js · npm 裸名总包（umbrella）CLI 入口
//
// 薄转发，零业务逻辑——逻辑在 @sofagent/audit。
// Thin forwarder, zero business logic — logic lives in @sofagent/audit.
//
// 设计说明 / Design notes:
//   - npm i -g sofagent 后，`sofagent` 命令与 sofagent-audit 行为完全一致
//     （转发到 audit 的 quick CLI——30 秒零配置审计）。
//   - 用 spawn 转发而非 import：总包与实现包之间保持零编译期耦合，
//     audit 可独立升级/替换，总包永不失配。
//   - resolve 路径：@sofagent/audit 的 exports 只映射 "."（子路径被
//     ERR_PACKAGE_PATH_NOT_EXPORTED 封锁），故先 resolve 裸名拿到
//     dist/public-api.js，再推导同目录的 cli-quick.js。
//   - workspace 态与独立安装态路径推导一致（node_modules/@sofagent/audit/dist/）。
// ============================================================

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

// 解析 audit CLI 真实入口 / Resolve the real audit CLI entry
// Resolve bare name (legal "." export) → derive sibling dist/cli-quick.js
let auditCliPath;
try {
  const entry = require.resolve('@sofagent/audit');
  auditCliPath = join(dirname(entry), 'cli-quick.js');
} catch (err) {
  // 依赖未安装或损坏时给出产品化提示，而非裸抛堆栈
  // Productized message instead of a raw stack when deps missing/broken
  console.error('[sofagent] 无法定位 @sofagent/audit CLI 入口：' + (err && err.message ? err.message : err));
  // 场景分支（只影响人类可读提示，退出码 127 契约不变）：
  // 仓库内 clone 但未构建 → 提示构建；全局安装态 → 维持重装建议
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const inRepo = existsSync(join(repoRoot, 'engine', 'audit', 'package.json'));
  console.error(inRepo
    ? '[sofagent] 检测到在仓库内运行且 @sofagent/audit 尚未构建——请先在仓库根执行：npm install && npm run build'
    : '[sofagent] 请尝试重新安装：npm i -g sofagent');
  process.exit(127);
}

// spawn 转发：stdio 全透传，退出码原样回传
// Forward via spawn: inherit stdio, propagate exit code as-is
const result = spawnSync(process.execPath, [auditCliPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
});

// spawn 本身失败（如 node 二进制异常）与子进程非零退出区分处理
// Distinguish spawn failure from child's non-zero exit
if (result.error) {
  console.error('[sofagent] 启动审计 CLI 失败：' + result.error.message);
  process.exit(127);
}
process.exit(result.status === null ? 130 : result.status);
