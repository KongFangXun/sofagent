#!/usr/bin/env node
// ============================================================
// mcp-tool-count.mjs · MCP 工具数单一 extractor（v1.8.0 Q26 收敛批）
// ------------------------------------------------------------
// 背景：全仓 6 个门禁脚本各自用独立正则数 tool-registry.ts 的工具数（104），
// 合法代码形态变化（紧凑单行 + 数字命名）可让 5 个同时全绿而运行时已变——
// 六份拷贝债务。本文件是唯一实现：解析 tool-registry.ts 的 TOOLS 数组顶层
// name 字段计数，stdout 输出纯数字（供 shell source/调用消费）。
//
// 用法：
//   node tools/check/lib/mcp-tool-count.mjs          # → 104（纯数字）
//   --names                                           # → 逐行输出全部工具名
//
// 口径（与 check-version.sh §12 原口径一致）：
//   只数 TOOLS 数组顶层的 `name: 'xxx'`（4 空格缩进开头，避免嵌套 schema 字段
//   误计）；不含 resources.ts（资源不是工具）；去重（重名由 tool-registry.ts
//   的 fail-loud 断言在运行时拦截，此处计数语义按唯一名）。
// ============================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const registry = join(here, '..', '..', '..', 'engine', 'mcp', 'src', 'tool-registry.ts');

const src = readFileSync(registry, 'utf8');
const start = src.indexOf('export const TOOLS');
if (start < 0) {
  console.error('mcp-tool-count: tool-registry.ts 中未找到 TOOLS 数组');
  process.exit(1);
}
const end = src.indexOf('\n];', start);
const body = src.slice(start, end);

// 顶层 name = 4 空格缩进开头（嵌套 schema 字段是 6+ 空格或内联）
const names = [...body.matchAll(/\n {4}name: '([a-z0-9_]+)'/g)].map((m) => m[1]);
const unique = [...new Set(names)];

if (process.argv.includes('--names')) {
  console.log(unique.join('\n'));
} else {
  console.log(unique.length);
}
