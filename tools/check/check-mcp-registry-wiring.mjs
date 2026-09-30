#!/usr/bin/env node
// ============================================================
// check-mcp-registry-wiring.mjs · MCP 注册表接线守卫（v1.5.5 批 10）
// ============================================================
// 门禁目的：`engine/mcp/src/tool-registry.ts` 的 TOOLS 注册表与**执行面**之间此前无机械
//   校验——工具登记了但没有 handler（或 handler 指向的函数根本没 import）时，只有运行时
//   调用该工具才会暴露，属「注册漂移无门禁可查」。
//
// 两条断言：
//   ① 每条注册都必须带 `handler:`（查表分发目标在位，不依赖 mcp-server 的 switch 兜底）；
//   ② 每条 handler 的可调用目标至少要命中一个**本文件 import 进来的符号**——
//      防「handler 写了个没 import 的函数名」（编译期可能因 any/结构而漏报）。
//
// 退出码：0 = 全过；1 = 有违规。
// ============================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REGISTRY = join(ROOT, 'engine/mcp/src/tool-registry.ts');

const src = readFileSync(REGISTRY, 'utf-8');

/** 取 TOOLS 数组体（括号配对，避免被嵌套数组/对象截断） */
function toolsBody(text) {
  const start = text.indexOf('export const TOOLS');
  if (start < 0) throw new Error('未找到 `export const TOOLS`');
  const arrStart = text.indexOf('[', text.indexOf('=', start));
  let depth = 0;
  for (let i = arrStart; i < text.length; i++) {
    if (text[i] === '[') depth++;
    else if (text[i] === ']') {
      depth--;
      if (depth === 0) return text.slice(arrStart + 1, i);
    }
  }
  throw new Error('TOOLS 数组未闭合');
}

/** 本文件 import 进来的标识符集合 */
function importedNames(text) {
  const names = new Set();
  for (const m of text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from/g)) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop().trim();
      if (name) names.add(name);
    }
  }
  return names;
}

const body = toolsBody(src);
const imported = importedNames(src);

// 按 `name: '<tool>'` 切条目——每条的边界是下一个 `name:` 起
const hits = [];
for (const m of body.matchAll(/name: *'([a-z_0-9]+)'/g)) {
  hits.push({ name: m[1], idx: m.index });
}

const failures = [];
const seen = new Set();

for (let i = 0; i < hits.length; i++) {
  const { name, idx } = hits[i];
  const seg = body.slice(idx, i + 1 < hits.length ? hits[i + 1].idx : body.length);

  if (seen.has(name)) failures.push(`工具名重复登记：${name}`);
  seen.add(name);

  const hIdx = seg.search(/\bhandler:/);
  if (hIdx < 0) {
    failures.push(`未带 handler：${name}（查表分发目标缺失）`);
    continue;
  }
  const handlerSeg = seg.slice(hIdx);
  // handler 段里被调用的标识符（`foo(` 形态）
  const called = [...handlerSeg.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)].map((x) => x[1]);
  const skip = new Set(['async', 'await', 'if', 'for', 'while', 'return', 'typeof', 'new', 'JSON', 'String', 'Number', 'Boolean', 'Array', 'Object', 'Promise', 'require']);
  const resolved = called.filter((c) => imported.has(c));
  if (resolved.length === 0) {
    // 没有命中任何已 import 的符号——要么 handler 是裸函数引用（另判），要么指向未导入的名字
    const bare = handlerSeg.match(/handler:\s*(?:async\s*)?([A-Za-z_$][\w$]*)\s*[,\n}]/);
    const bareName = bare ? bare[1] : null;
    if (bareName && imported.has(bareName)) continue;
    const candidates = [...new Set(called.filter((c) => !skip.has(c)))].slice(0, 5).join(', ') || '(无)';
    failures.push(`handler 未解析到已导入的执行目标：${name}——调用名候选 [${candidates}]，均不在本文件 import 面内`);
  }
}

console.log('=== check-mcp-registry-wiring · MCP 注册表接线守卫 ===');
console.log(`  工具数 ${hits.length} · 导入面 ${imported.size} 个符号`);
if (failures.length === 0) {
  console.log('  ✓ 全部注册均带 handler 且执行目标在导入面内');
  console.log('✓ MCP 注册表接线守卫通过');
  process.exit(0);
}
for (const f of failures) console.log(`  ✗ ${f}`);
console.log(`✗ MCP 注册表接线守卫失败：${failures.length} 项`);
process.exit(1);
