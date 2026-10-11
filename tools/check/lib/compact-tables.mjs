#!/usr/bin/env node
// ============================================================
// compact-tables.mjs · 表格瘦身器（去列对齐填充 + 分隔行短横线归一）
// ------------------------------------------------------------
// 为什么需要：`doc-postcheck` 报的「墙式行」（>300 字符）**多数不是内容密度**，而是
// **表格列对齐填充**把行撑长——实测一批外仓文档里 `| 类 | 用在哪 | 枚举 |` 一行 **278 字符、
// 可见文字仅 15 字符**（其余全是对齐空格）。GFM **不需要**对齐填充（渲染结果不变），
// 故这是零内容风险的体积治理。治理批实测：一仓 24 篇去填充省 **64179 字符（≈64KB）**。
//
// 做什么（两项，均**不改内容**）：
//   ① 单元格首尾空白去掉：`|  a  |   b   |` → `| a | b |`
//   ② 分隔行短横线归一：`|---------|:-------:|` → `|---|:---:|`（**冒号对齐标记逐一保留**）
//
// 不做什么（边界）：
//   - **不动短横线的语义**（`:---:` 的冒号位置保持原样；只缩长度）
//   - 不动围栏代码块内的文本
//   - 不动非表格行、不动单元格内容（含 `\|` 转义）
//
// 守恒纪律：写回前做**字符多重集**比对；**分隔行豁免**——短横线数是纯装饰、不承载内容，
//   若一并纳入守恒校验会导致「改了格式就报守恒失败」，反而挡住这个安全的治理动作。
//
// 用法：node tools/check/lib/compact-tables.mjs <file> [--write]
//       node tools/check/lib/compact-tables.mjs --selftest
// ============================================================
import fs from 'node:fs';

const args = process.argv.slice(2);
const isSep = (cells) => cells.every((c) => /^:?-+:?$/.test(c));

/** 纯函数：表格瘦身。刻意**不导出**（自检在本文件内闭环；导出即构成无消费者的新导出，会撞 check-unwired-exports）。
 *  `frozen` = 该文件是否在历史冻结区——由**调用方按文件路径**判定（函数本身拿不到路径）。
 *  冻结区整篇跳过：历史区的排版是**历史事实的一部分**，治理不得回改
 *  （判据同 check-doc-discipline Face 4 的豁免面：docs/changelog · docs/archive · docs/evidence · vendor）。 */
function compact(src, frozen = false) {
  if (frozen) return { text: src, touched: 0 };
  const lines = src.split('\n');
  let inFence = false;
  let touched = 0;
  const out = lines.map((l) => {
    if (/^(```|~~~)/.test(l)) { inFence = !inFence; return l; }
    if (inFence) return l;
    const t = l.trim();
    if (!t.startsWith('|') || !t.endsWith('|')) return l;
    const cells = t.slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim());
    if (isSep(cells) && cells.length) {
      const neu = '|' + cells.map((c) => `${c.startsWith(':') ? ':' : ''}---${c.endsWith(':') ? ':' : ''}`).join('|') + '|';
      // 硬约束同下：`|:--:|`（5 字符）→ `|:---:|`（6）会**加字**，故同样只减不增
      if (neu.length > l.length) return l;
      if (neu !== l) touched++;
      return neu;
    }
    const neu = '| ' + cells.join(' | ') + ' |';
    // 🔴 硬约束：**输出永不比原行更长**。`|a|b|`（本就紧凑）若被规范成 `| a | b |` 会**加字**，
    // 撞 host 仓的「字数棘轮只许降不许升」（实测 +1~+14 字/篇，11 篇超基线）——瘦身器只该减，不该增。
    if (neu.length > l.length) return l;
    if (neu !== l) touched++;
    return neu;
  });
  return { text: out.join('\n'), touched };
}

/** 冻结区判据（与 check-doc-discipline Face 4 同口径） */
const isFrozenPath = (p) => /(^|\/)(changelog|archive|evidence|vendor)\//.test(p);

/** 守恒：**豁免分隔行**（短横线数为装饰），其余去空白后逐字多重集一致 */
function conserve(src, dst) {
  const norm = (t) => t.split('\n').filter((l) => {
    const q = l.trim();
    if (!q.startsWith('|') || !q.endsWith('|')) return true;
    return !isSep(q.slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim()));
  }).join('\n').replace(/\s+/g, '');
  return [...norm(src)].sort().join('') === [...norm(dst)].sort().join('');
}

function selfTest() {
  const cases = [
    ['去填充', '|  a  |   b   |\n|---|---|\n|  1  |  2  |\n', '| a | b |\n|---|---|\n| 1 | 2 |\n'],
    ['分隔行归一', '| a | b |\n|---------|:-------:|\n| 1 | 2 |\n', '| a | b |\n|---|:---:|\n| 1 | 2 |\n'],
    ['冒号标记保留', '| a | b |\n|:---|----:|\n', '| a | b |\n|:---|---:|\n'],
    ['围栏内不动', '```\n|  a  |   b   |\n```\n', '```\n|  a  |   b   |\n```\n'],
    ['非表格行不动', '普通  段落   保持原样。\n', '普通  段落   保持原样。\n'],
    ['紧凑表不被撑大（只减不增）', '|a|b|\n|---|---|\n|1|2|\n', '|a|b|\n|---|---|\n|1|2|\n'],
  ];
  let ok = true;
  for (const [name, src, want] of cases) {
    const { text } = compact(src);
    if (text !== want) { ok = false; console.error(`  ✗ ${name}\n     期望 ${JSON.stringify(want)}\n     实得 ${JSON.stringify(text)}`); }
    else if (!conserve(src, text)) { ok = false; console.error(`  ✗ ${name}：守恒校验失败`); }
    else console.log(`  ✓ ${name}`);
  }
  // 幂等：第二趟零改动
  const s = '|  a  |   b   |\n|------|------|\n';
  const one = compact(s).text;
  if (compact(one).touched !== 0) { ok = false; console.error('  ✗ 非幂等（第二趟仍有改动）'); }
  else console.log('  ✓ 幂等（第二趟零改动）');
  // 转义管道不被误切
  const esc = '| a\\|b | c |\n';
  if (compact(esc).text.split('|').length !== esc.split('|').length) { ok = false; console.error('  ✗ 转义管道 \\| 被误切'); }
  else console.log('  ✓ 转义管道 \\| 不被误切');
  // 冻结区整篇跳过（历史事实区排版不得回改）
  const froz = '|  a  |   b   |\n|------|------|\n';
  if (compact(froz, true).text !== froz || compact(froz, true).touched !== 0) { ok = false; console.error('  ✗ 冻结区未被跳过'); }
  else console.log('  ✓ 冻结区整篇跳过（docs/changelog·archive·evidence·vendor）');
  // 冻结区判据本身
  if (!isFrozenPath('docs/archive/x/y.md') || !isFrozenPath('docs/changelog/v1.5/v1.5.8.md')
      || !isFrozenPath('changelog/v0/0.1.0.md')   // 新仓模板用**顶层** changelog/
      || isFrozenPath('docs/HANDBOOK.md') || isFrozenPath('devlog/_TEMPLATE.md')) {
    ok = false; console.error('  ✗ isFrozenPath 判据错误');
  } else console.log('  ✓ 冻结区判据（archive/changelog 命中，普通文档不命中）');

  if (!ok) { console.error('  自检失败'); process.exit(1); }
  console.log('  自检全过（去填充 / 分隔行归一 / 冒号保留 / 围栏豁免 / 只减不增 / 幂等 / 转义管道 / 冻结区豁免）');
}

if (args.includes('--selftest')) { selfTest(); process.exit(0); }

const files = args.filter((a) => !a.startsWith('--'));
const write = args.includes('--write');
if (!files.length) { console.error('usage: compact-tables.mjs <file...> [--write] | --selftest'); process.exit(2); }
const missing = files.filter((f) => !fs.existsSync(f));
if (missing.length) { console.error(`❌ 文件不存在：${missing.join(', ')}`); process.exit(2); }

let nChanged = 0, nFrozen = 0, nLines = 0, refused = 0;
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const frozen = isFrozenPath(file);
  if (frozen) { nFrozen++; console.log(`${file}: ⏭ 冻结区跳过`); continue; }
  const { text, touched } = compact(src, false);
  if (text !== src && !conserve(src, text)) { console.error(`❌ ${file}: 守恒校验失败——拒绝写回`); refused++; continue; }
  if (write && text !== src) fs.writeFileSync(file, text, 'utf8');
  if (text !== src) { nChanged++; nLines += touched; }
  console.log(`${file}: 表格瘦身${write ? (text !== src ? '（已写回）' : '（无变化）') : '（dry-run）'}，改动 ${touched} 行`);
}
if (files.length > 1 || nFrozen) {
  console.log(`—— 合计：${files.length} 个目标 · ${nChanged} 个有改动 / 共 ${nLines} 行 · 冻结区跳过 ${nFrozen}${refused ? ` · 守恒拒绝 ${refused}` : ''}`);
}
if (refused) process.exit(1);
