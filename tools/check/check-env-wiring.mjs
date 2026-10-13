#!/usr/bin/env node
// ============================================================
// check-env-wiring.mjs · env 只写不读门禁（v1.6.0 Batch G · BUG-56 族）
// ============================================================
// 定位：SOFAGENT_SINGLE_ENTRY「写 2 读 0」跨版本存活——退役 commit 删光读者
// 留下写者，全仓无门禁对账。本门禁把「env 键必须读写闭环」机械化：
//   全仓扫 process.env.SOFAGENT_* 的写方（= 赋值）与读方（= 引用）；
//   只有写方无读方的键判红（豁免台账带理由）。
// 退出码：0 绿 / 1 红
// ============================================================
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const exemptPath = 'tools/check/check-env-wiring-exempt.json';
const exemptKeys = new Set();
if (existsSync(exemptPath)) {
  for (const e of JSON.parse(readFileSync(exemptPath, 'utf8')).exempts ?? []) {
    exemptKeys.add(e.key);
  }
}

// 收集 engine/tools 源码（排除 dist/test）
const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (!['dist', '__tests__', 'node_modules', '.git'].includes(name)) walk(p);
    } else if (/\.(ts|js|mjs|sh)$/.test(name) && !/\.test\.|\.d\.ts$/.test(name)) {
      files.push(p);
    }
  }
}
walk('engine');
walk('tools');

const readers = new Map(); // key → Set<file>
const writers = new Map(); // key → Set<file>
const RE = /process\.env\.SOFAGENT_[A-Z0-9_]+/g;

for (const f of files) {
  let content;
  try { content = readFileSync(f, 'utf8'); } catch { continue; }
  // 按行扫：跳过注释行（注释里的历史叙述如「原 X 已删除」不算读写）
  const lines = content.split('\n');
  let inBlockComment = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('/*')) inBlockComment = true;
    if (inBlockComment || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('#')) {
      if (trimmed.endsWith('*/')) inBlockComment = false;
      continue;
    }
    for (const m of line.matchAll(RE)) {
      const key = m[0].replace('process.env.', '');
      // 写方形态：process.env.KEY = / process.env.KEY ??=（行内紧跟赋值符）
      const after = line.slice(m.index + m[0].length, m.index + m[0].length + 4);
      const isWrite = /^\s*=(?!=)/.test(after) || /^\s*\?\?=/.test(after);
      const target = isWrite ? writers : readers;
      if (!target.has(key)) target.set(key, new Set());
      target.get(key).add(f);
    }
  }
}

let fails = 0;
const allKeys = new Set([...writers.keys(), ...readers.keys()]);
for (const key of sorted(allKeys)) {
  if (exemptKeys.has(key)) continue;
  const w = writers.get(key);
  const r = readers.get(key);
  if (w && (!r || r.size === 0)) {
    console.error(`  ❌ [env-wiring] ${key} 只写不读（写方: ${[...w].join(', ')}）`);
    fails++;
  }
}
function sorted(s) { return [...s].sort(); }

if (fails) {
  console.error(`\n❌ check-env-wiring：${fails} 个 SOFAGENT_* 键只写不读`);
  process.exit(1);
}
console.log(`✅ check-env-wiring：${allKeys.size} 个 SOFAGENT_* 键读写闭环（或已豁免）`);
