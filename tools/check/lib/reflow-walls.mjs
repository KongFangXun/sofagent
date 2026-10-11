#!/usr/bin/env node
// ============================================================
// reflow-walls.mjs · 墙式行折行器（一次性治理工具，非门禁）
// ------------------------------------------------------------
// 用途：把围栏外 >300 字符的非表格行在标点/空格处折成多行，内容零删减。
//       列表项续行缩进两空格；引用续行带 `>`。
// 限制：跳过围栏代码块、表格行（| 开头——折断破坏表格）、标题。
//       折不断（无标点）的行原样保留并计入 unsplit。
//
// 口径纪律（改判据先改本注释）：
//   - 折行阈值 300 字符 = lib/readability-count.mjs 的「墙式行」定义（单一口径，勿另立）。
//   - 引用续行前缀固定为 `>`（**无空格**）：`>正文` 是本仓**既有风格**（实测 sofagent 自身
//     168 行，含 CHANGELOG / FDE / FORGE 的作者手笔），GFM 下 `>正文` 与 `> 正文` 渲染等价。
//     此处若自作主张加空格，等于在治理批里混入一次全仓风格漂移——风格统一不是本工具的职责。
//   - 本工具**必须幂等**：f(f(x)) === f(x)，且**不得凭空造行**（见下）。
//
// 两条结构性保证（--selftest 逐条断言）：
//   ① 切口上限取 `len - 2`（不是 `len - 1`）：若允许切在行末，尾段为空串，`rest = prefix + r[1]`
//      就退化成「只有前缀」的一行（`>` 或两空格）——表现为引用块里凭空多出空 `>` 行。
//   ② 主循环对空尾段再加一道守卫（防御纵深）。
//
// 用法：node tools/check/lib/reflow-walls.mjs <file> [--write]
//       node tools/check/lib/reflow-walls.mjs --selftest     # 幂等 / 守恒 / 不造行 / 豁免 自检
// ============================================================
import fs from 'node:fs';

const LIMIT = 300;
const args = process.argv.slice(2);

/** 在 [140, LIMIT] 区间从右往左找断点：CJK 句读优先，其次空格。
 *  ⚠️ 切口上限取 `len - 2`——**结构上**排除「尾段为空 → 产出只有前缀的行」（头部保证 ①）。 */
function splitLine(line) {
  if (line.length <= LIMIT) return [line];
  const hi = Math.min(line.length - 2, LIMIT);
  let cut = -1;
  for (let i = hi; i >= 140; i--) {
    const c = line[i];
    if ('。；！？'.includes(c)) { cut = i + 1; break; }
    if (c === '，' || c === '、') { if (cut < 0) cut = i + 1; continue; }
  }
  if (cut < 0) {
    for (let i = hi; i >= 140; i--) {
      if (line[i] === ' ') { cut = i + 1; break; }
    }
  }
  if (cut < 0) return null; // 折不断
  return [line.slice(0, cut).trimEnd(), line.slice(cut).trimStart()];
}

/** 续行前缀：列表缩进两空格；引用带 `>`（无空格，理由见头部口径） */
function prefixOf(line) {
  if (line.startsWith('- ') || line.startsWith('* ')) return '  ';
  if (/^\d+\. /.test(line)) return '  ';
  if (/^>/.test(line)) return '>';
  return '';
}

/** 纯函数：折行。刻意**不导出**——自检在本文件内闭环；导出即构成「无生产消费者的新导出」，
 *  会撞 check-unwired-exports（纸面接线）。需要复用时再显式登记消费者。 */
function reflowText(src) {
  const lines = src.split('\n');
  const out = [];
  let inFence = false;
  let unsplit = 0;
  for (const line of lines) {
    if (/^(```|~~~)/.test(line)) { inFence = !inFence; out.push(line); continue; }
    if (inFence || line.length <= LIMIT || line.trimStart().startsWith('|') || /^#{1,6} /.test(line)) {
      out.push(line); continue;
    }
    let rest = line;
    const prefix = prefixOf(line);
    const pieces = [];
    let guard = 0;
    while (rest && rest.length > LIMIT && guard++ < 10) {
      const r = splitLine(rest);
      if (!r) { pieces.push(rest); rest = ''; unsplit++; break; }
      pieces.push(r[0]);
      if (!r[1].trim()) { rest = ''; break; }   // 保证 ②：尾段为空则不加前缀，杜绝裸前缀行
      rest = prefix + r[1];
    }
    if (rest && rest.trim()) pieces.push(rest);
    out.push(...pieces);
  }
  return { text: out.join('\n'), unsplit };
}

/** 自检：把「幂等 / 内容守恒 / 不造行 / 无残留超限 / 豁免」五条钉死 */
function selfTest() {
  const strip = (s) => s.split('\n').map((l) => l.replace(/^>\s?/, '')).join('\n').replace(/\s+/g, '');
  const bag = (s) => [...strip(s)].sort().join('');
  const cases = [
    ['长引用行', '> ' + '这是一段用于自检的超长引用文字。'.repeat(20)],
    ['长列表项', '- ' + '这是用于自检的超长长长列表项文字。'.repeat(20)],
    ['长普通段', '普通段落' + '内容用于自检。'.repeat(40)],
    ['长引用-英文', '> ' + 'word '.repeat(80)],
    // 边界：长度恰好 301 且**以句读结尾**——切口若落在行末就会产出裸前缀行（头部保证 ① 的场景）
    ['301 字符以句读结尾', '> ' + '内'.repeat(298) + '。'],
  ];
  let ok = true;
  for (const [name, line] of cases) {
    const src = `# T\n\n${line}\n\n尾段。\n`;
    const { text: one, unsplit } = reflowText(src);
    const two = reflowText(one).text;
    const fail = [];
    if (one !== two) fail.push('非幂等');
    if (bag(src) !== bag(one)) fail.push('内容不守恒');
    const emptyBefore = (src.match(/^>\s*$/gm) || []).length;
    const emptyAfter = (one.match(/^>\s*$/gm) || []).length;
    if (emptyAfter > emptyBefore) fail.push(`空引用行 ${emptyBefore}→${emptyAfter}（凭空造行）`);
    const prefixOnly = one.split('\n').filter((l) => /^(>\s*| {1,2})$/.test(l));
    if (prefixOnly.length) fail.push(`产出只有前缀的行 ×${prefixOnly.length}`);
    const over = one.split('\n').filter((l) => l.length > LIMIT && !l.trimStart().startsWith('|'));
    if (over.length && unsplit === 0) fail.push(`仍有 ${over.length} 行超限且未计入 unsplit`);
    if (fail.length) { ok = false; console.error(`  ✗ ${name}：${fail.join(' · ')}`); }
    else console.log(`  ✓ ${name}（幂等 + 守恒 + 不造行 + 无残留超限）`);
  }
  const keep = `| a | ${'x'.repeat(400)} |\n\n\`\`\`\n${'y'.repeat(400)}\n\`\`\`\n`;
  if (reflowText(keep).text !== keep) { ok = false; console.error('  ✗ 表格行/围栏行被改动'); }
  else console.log('  ✓ 表格行 / 围栏行不动');

  if (!ok) { console.error('  自检失败'); process.exit(1); }
  console.log('  自检全过（幂等 / 内容守恒 / 空行不增 / 无裸前缀行 / 无残留超限 / 表格围栏豁免）');
}

if (args.includes('--selftest')) { selfTest(); process.exit(0); }

const file = args.find((a) => !a.startsWith('--'));
const write = args.includes('--write');
if (!file || !fs.existsSync(file)) { console.error('usage: reflow-walls.mjs <file> [--write] | --selftest'); process.exit(2); }

const src = fs.readFileSync(file, 'utf8');
const { text, unsplit } = reflowText(src);
const changed = text !== src;
if (write && changed) fs.writeFileSync(file, text, 'utf8');
console.log(`${file}: 折行完成${write ? (changed ? '（已写回）' : '（无变化）') : '（dry-run）'}，折不断 ${unsplit} 行`);
