#!/usr/bin/env node
// ============================================================
// check-loop-bare-return.mjs · 循环体内裸 return 守卫
// ------------------------------------------------------------
// 判据：`for` / `for...of` / `for...in` / `while` 循环体内出现**裸 `return;`**（无返回值）→ 报红。
//
// 为什么：这类 `return` 的意图几乎总是「跳过本项」（该用 `continue`），实际却**退出整个函数**。
//   根因实证（run82 复核轮）：一次目录遍历扫描器在 `for...of` 体内用 `return` 表达「跳过本项」，
//   结果**退出整个目录遍历**，把「1094 篇含 FM date」误报成「14 篇」——**10 倍级误差，且全程无报错、
//   数字表面自洽**。凡「自报扫描数」类脚本踩此坑，产出的是**看起来像真的假数字**，比崩溃更坏。
//
// 判定法：对每个候选行，**由内向外**找「最近的外层开括号行」（缩进更小且以 `{` 结尾）并分类：
//   循环头 → 命中；函数 / 箭头回调 → 停（那里 `return` 是合法的「跳过本项」）；普通块（`if` / 裸 `{`）
//   → 继续向外找。此法比「有状态缩进追踪」稳——首版用后者，把 3 处 `forEach` 回调误判成循环内。
//
// 不判什么（边界，防误报）：
//   - 函数末尾 / 顶层的早退 `return;`（不在循环体内）
//   - `forEach` / `map` / `filter` 回调里的 `return;`——那里它**就是**「跳过本项」，正确写法
//   - `return <值>;`（只管无返回值的裸 return）
//   - 同一行内含 `=>` 的行（内联箭头回调，如 `xs.forEach((x) => { if (!x) return; })`）
//   - 围栏代码块内的行
//
// 逃生口：确属「命中即该退出整个函数」的循环内早退，行尾加 `// loop-return-ok: <理由>` 豁免。
//
// 用法：node tools/check/check-loop-bare-return.mjs [--quiet] | --selftest
// 退出码：0 全绿 / 1 有命中 / 2 用法错或扫描面异常（失明，拒假绿）
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SELF_DIR, '..', '..');

const LOOP_HEAD = /^\s*(for\s*\(|for\s+await\s*\(|for\s+(const|let|var)\s|while\s*\()/;
const FUNC_HEAD = /=>|function\b|\bclass\b/;
/** 候选行：以 `return;` 结尾（可带收尾 `}` 与尾注释），且**不含 `=>`**（内联箭头回调另有语义） */
const CAND = /return;\s*\}*\s*(\/\/.*)?$/;

/** 纯函数：给定源码文本，返回命中列表（行号 1-based + 行内容） */
function scan(src) {
  const lines = src.split('\n');
  const indentOf = (l) => (l.trim() ? l.search(/\S/) : Infinity);
  const hits = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*(```|~~~)/.test(l)) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (!CAND.test(l) || /loop-return-ok:/.test(l) || /=>/.test(l)) continue;

    // 由内向外找「最近的外层开括号行」
    let verdict = null;
    let cursor = indentOf(l);              // 有效层级：随向外查找逐步收紧
    for (let j = i - 1; j >= 0; j--) {
      const p = lines[j];
      if (!p.trim() || /^\s*(\/\/|#|\*)/.test(p)) continue;
      const pi = indentOf(p);
      if (pi >= cursor) continue;          // 只找更外层
      if (!/\{\s*$/.test(p.trimEnd())) { cursor = pi + 0.5; continue; }  // 非开括号行也不阻断，但要收紧
      if (LOOP_HEAD.test(p)) { verdict = 'loop'; break; }
      if (FUNC_HEAD.test(p)) { verdict = 'func'; break; }
      cursor = pi;                          // 普通块（if / 裸 {）：继续向外
    }
    if (verdict === 'loop') hits.push({ line: i + 1, text: l.trim() });
  }
  return hits;
}

function selfTest() {
  const cases = [
    ['正例：for...of 体内 if 守卫裸 return', 'for (const x of xs) {\n  if (!x) return;\n  use(x);\n}\n', 1],
    ['正例：for(;;) 体内裸 return', 'for (let i = 0; i < n; i++) {\n  if (bad(i)) return;\n}\n', 1],
    ['正例：while 体内裸 return', 'while (q.length) {\n  if (done()) return;\n}\n', 1],
    ['正例：循环 → if 块内裸 return（跨层仍命中）', 'for (const x of xs) {\n  if (x) {\n    return;\n  }\n}\n', 1],
    ['反例：for...of 体内 continue', 'for (const x of xs) {\n  if (!x) continue;\n}\n', 0],
    ['反例：函数末尾早退（不在循环内）', 'function f(a) {\n  if (!a) return;\n  return 1;\n}\n', 0],
    ['反例：forEach 回调内 return（合法「跳过本项」）', 'xs.forEach((x) => {\n  if (!x) return;\n  use(x);\n});\n', 0],
    ['反例：带返回值', 'for (const x of xs) {\n  if (x) return x;\n}\n', 0],
    ['反例：内联箭头回调同一行', 'const f = () => { for (const y of ys) { if (y) return; } };\n', 0],
    ['反例：带豁免标记', 'for (const x of xs) {\n  if (abort) return; // loop-return-ok: 命中即该退出整个函数\n}\n', 0],
  ];
  let ok = true;
  for (const [name, src, want] of cases) {
    const n = scan(src).length;
    if (n !== want) { ok = false; console.error(`  \u2717 ${name}（期望 ${want} 实得 ${n}）`); }
    else console.log(`  \u2713 ${name}`);
  }
  if (!ok) { console.error('  自检失败'); process.exit(1); }
  console.log('  自检全过（4 正例必红 \u00b7 6 反例必绿：continue / 函数末尾早退 / forEach 回调 / 带返回值 / 内联箭头 / 豁免标记）');
}

if (process.argv.includes('--selftest')) { selfTest(); process.exit(0); }
const quiet = process.argv.includes('--quiet');

const tracked = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files',
  'tools/**/*.mjs', 'tools/**/*.js', 'tools/**/*.ts'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(Boolean).filter((f) => !/node_modules|dist|\.min\./.test(f));

if (tracked.length < 5) {   // 失明自检（依本仓自己的纪律：扫描面过小 → 拒假绿）
  console.error(`\u274c 扫描面仅 ${tracked.length} 个文件——低于下限 5，判失明（拒绝假绿）`);
  process.exit(2);
}

const all = [];
for (const f of tracked) {
  for (const h of scan(fs.readFileSync(path.join(ROOT, f), 'utf8'))) all.push(`${f}:${h.line}  ${h.text}`);
}

if (!all.length) {
  if (!quiet) console.log(`\u2713 循环体内零裸 return（扫 ${tracked.length} 个 tools/**/*.{mjs,js,ts}）——跳过本项请用 continue`);
  process.exit(0);
}
console.error(`\u274c ${all.length} 处循环体内裸 return（意图几乎总是「跳过本项」→ 请改 \`continue\`；确需退出整个函数请加 \`// loop-return-ok: <理由>\`）：`);
for (const x of all) console.error(`  ${x}`);
process.exit(1);
