#!/usr/bin/env node
// fake-probability-census.mjs · F6.2「既有置信度数值逐条登记」的普查器
// ------------------------------------------------------------
// 为什么要脚本：v1.9.0 §二 的验收条要求「逐条登记（位置 / 值 / 性质 / 处置），
// 数量如实落数，不概括为若干处」。手抄清单必然与代码漂移，且无法被 S2 重算。
//
// 口径（**引用本脚本时须连这段一起引**，否则计数不可比）：
//   · 范围 = `git ls-files` 的**全量受控文件**，目录限定 `engine/`、`tools/`（不含 node_modules、
//     不含 /dist/、不含 docs/ 与 FORWARD 文档）；测试文件（`*.test.ts`/`*.spec.ts`）**单列**，
//     不与产品代码混算。
//   · 匹配 = 行内出现 `(confidence|probability|prob|likelihood)` 开头的标识符，且其后
//     8 个字符内出现 `:` 或 `=`。**大小写敏感**（`Confidence` 类型名不算值）。
//   · 分类（机械可判，见 classify）：
//       literal  —— 右侧是数字字面量
//       enum     —— 右侧是字符/条件表达式（枚举或映射）
//       computed —— 右侧是 sigmoid/softmax/exp 等概率计算
//       type     —— 类型声明位（接口/类型别名首行）
//       comment  —— 注释行
//       ref      —— 其余（读取、透传、比较）
//   · 每条再给 `semantics`：按 v1.9.0 §二 三类（heuristic-weight / ordinal-level / probability）
//     或 `unknown`（需人工判）；分类表是**唯一人工判断处**，见 SEMANTICS。
//
// 用法：node tools/audit/fake-probability-census.mjs [--tsv] [--json]

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const wantTsv = args.includes('--tsv');
const wantJson = args.includes('--json');

// ── 语义判定：**看代码里有没有包装函数**，不读任何登记表 ──
// 这是本普查器的关键设计：若从 `confidence-semantics.ts` 的登记表取数，
// 「代码没标记」与「登记表没写」会互相掩护（自证）。故只看源码：
//   hw(...)   ⇒ heuristic-weight（启发式权重）
//   ol(...)   ⇒ ordinal-level（序数等级）
//   prob(...) ⇒ probability（概率）
//   裸数字    ⇒ untagged（未标记——验收条「缺失按不可信处理」即此列）
function semanticsOf(line) {
  if (/\bhw\(/.test(line)) return 'heuristic-weight';
  if (/\bol\(/.test(line)) return 'ordinal-level';
  if (/\bprob\(/.test(line)) return 'probability';
  return 'untagged';
}

const files = execFileSync('git', ['ls-files', 'engine/**/*.ts', 'tools/**/*.mjs', 'tools/**/*.ts'], {
  encoding: 'utf-8',
})
  .trim()
  .split('\n')
  .filter((f) => f && !f.includes('/dist/') && !/\.(test|spec)\.ts$/.test(f));

const ID = /(confidence|probability|prob|likelihood)[A-Za-z]*\s*[:=]/;

function classify(line, m) {
  const trimmed = line.trim();
  if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return 'comment';
  const after = line.slice(m.index + m[0].length);
  // 已标记的数值（hw(0.7) / ol(1.0) / prob(expr)）单列一类，与裸字面量区分
  if (/^\s*(hw|ol|prob)\(/.test(after)) return 'tagged';
  if (/^-?\d/.test(after.trimStart())) return 'literal';
  if (/(Math\.exp|sigmoid|softmax|Math\.log)/.test(after)) return 'computed';
  if (/['"]/.test(after.trimStart()[0] ?? '')) return 'enum';
  if (/\?:|&&|\|\|/.test(after)) return 'enum';
  if (/;\s*$/.test(trimmed) && /:\s*(number|string|boolean|'[a-z|]+'|"[a-z|]+")/.test(trimmed)) return 'type';
  return 'ref';
}

const rows = [];
for (const f of files) {
  const text = readFileSync(f, 'utf-8');
  text.split('\n').forEach((line, i) => {
    const m = line.match(ID);
    if (!m) return;
    rows.push({
      file: f,
      line: i + 1,
      kind: classify(line, m),
      semantics: semanticsOf(line),
      snippet: line.trim().slice(0, 90),
    });
  });
}

const byKind = {};
for (const r of rows) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
const bySem = {};
for (const r of rows) bySem[r.semantics] = (bySem[r.semantics] ?? 0) + 1;

if (wantJson) {
  console.log(JSON.stringify({ scope: { files: files.length, dirs: ['engine/', 'tools/'] }, rows }, null, 2));
  process.exit(0);
}
if (wantTsv) {
  console.log('file\tline\tkind\tsemantics\tsnippet');
  for (const r of rows) console.log(`${r.file}\t${r.line}\t${r.kind}\t${r.semantics}\t${r.snippet}`);
  process.exit(0);
}

console.log(`文件 ${files.length}（git 全量受控 · engine/ + tools/ · 排除 dist 与测试）`);
console.log(`命中 ${rows.length} · 按形态 ${JSON.stringify(byKind)} · 按语义 ${JSON.stringify(bySem)}`);
console.log('');
console.log('| 文件:行 | 形态 | 语义 | 片段 |');
console.log('|---|---|---|---|');
for (const r of rows.filter((x) => x.kind !== 'comment' && x.kind !== 'ref')) {
  console.log(`| ${r.file}:${r.line} | ${r.kind} | ${r.semantics} | ${r.snippet.replace(/\|/g, '\\|')} |`);
}
const unknown = rows.filter((r) => r.semantics === 'untagged' && (r.kind === 'literal' || r.kind === 'computed' || r.kind === 'tagged'));
if (unknown.length) {
  console.error(`\n⚠️ 未标记的数值字面量 ${unknown.length} 条：`);
  for (const r of unknown) console.error(`  ${r.file}:${r.line} [${r.kind}] ${r.snippet}`);
}
