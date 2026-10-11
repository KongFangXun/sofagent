#!/usr/bin/env node
// ============================================================
// split-table-cells.mjs · 超长表格格拆注工具（一次性治理，非门禁）
// ------------------------------------------------------------
// 把 >MAX 字符的表格单元格拆为「主句 + 注」：格内留到**句读符**为止的首句，
// 其余内容移到该表格下方「> 注-N：」引用行。表结构（列数）不变，GFM 渲染安全。
//
// 🔴 产出契约（被 check-table-shape.mjs 的 ③ 悬空注标 / ④ 断句格 两条断言机械对账，
//   改本工具须同步改那两条判据）：
//   ① 标记形态 = `（详→注-N）`（全角括号 + 右箭头，与仓内既有约定一致）；
//   ② 同文件内必有 `> 注-N：` 定义行——不许「只发标记、不发注」；
//   ③ 格内切口必落在句读符上。**找不到句读切口就不拆该格**：宁可留长格让可读性棘轮
//      （`doc-discipline.sh` Face 5）把它报出来交人裁定，也不硬切。硬切的代价实测过——
//      格尾留下 `git-diff 24` / `enterp` / 未闭合 `（` 这类半截片段，句子被腰斩、语义悬空，
//      而这三类痕迹**行数预算、锚点对账、docs 预算全部看不见**。
//
// 💡 为什么不做「放宽切口」（允许在 `，、）空格` 处硬切）：外仓治理批实测过——产出注行从
//   半截符号开始（`注-4：**对外统一表述…**）+ 集成…`），且**循环不收敛**（连跑 4 轮仍在
//   重复拆同一格）。**本工具「切不动就不切」的保守设计是对的**，勿为"多清几格"牺牲语义。
//
// 用法：node tools/check/lib/split-table-cells.mjs <file> [--write] [--max 200]
//       node tools/check/lib/split-table-cells.mjs --selftest
// ============================================================
import fs from 'node:fs';

/** 切口候选句读符：切口落在这里才说明句子闭合（半角分号/叹问同号） */
const CUT_CHARS = ['。', '；', '！', '？', ';', '!', '?'];

/** 纯函数：拆注。刻意**不导出**（自检在本文件内闭环；导出即构成无消费者的新导出，会撞 check-unwired-exports）。 */
function splitCells(src, MAX = 200) {
  const lines = src.split('\n');
  const out = [];
  let inFence = false;
  let noteId = 0;
  let skipped = 0;
  let pendingNotes = [];
  let inTable = false;

  const flush = () => {
    if (!pendingNotes.length) return;
    out.push('');
    for (const n of pendingNotes) out.push(n);
    pendingNotes = [];
  };

  for (const line of lines) {
    if (/^(```|~~~)/.test(line)) { inFence = !inFence; out.push(line); continue; }
    if (inFence) { out.push(line); continue; }

    const isTableRow = line.trim().startsWith('|') && line.includes('|', 1);
    if (isTableRow) {
      inTable = true;
      const cells = line.split('|');
      // 表头/分隔行不处理
      if (cells.slice(1, -1).every((c) => /^\s*:?-{2,}:?\s*$/.test(c))) { out.push(line); continue; }
      const newCells = cells.map((c, idx) => {
        if (idx === 0 || idx === cells.length - 1) return c;
        const t = c.trim();
        if (t.length <= MAX) return c;
        // 🔴 已拆过的格不再拆（幂等硬保证）：否则「主句 + 标记」若仍 >MAX，第二趟会二次拆注、
        //    产出嵌套注链（自检的幂等断言实测抓出过这一形态）。
        if (/（详→注-\d+）/.test(t)) return c;
        // 🔴 切口窗口预留标记长度：产出 = 主句(≤cut) + 「（详→注-N）」(约 10~12 字符)，若不预留，
        //    临界长度下产出会恰好越过 MAX → 下一趟又被拆（同上）。
        const budget = MAX - 12;
        // 切口 = 窗口内**最后一个**句读符（取最后而非第一个：首句常极短，拆出来没有信息量）
        const cut = Math.max(...CUT_CHARS.map((ch) => t.lastIndexOf(ch, budget)));
        const tail = cut > 0 ? t.slice(cut + 1).trim() : '';
        if (!tail) { skipped++; return c; }   // 无句读切口 ⇒ 整格不拆（契约 ③）
        noteId++;
        pendingNotes.push(`> 注-${noteId}：${tail}`);
        return ' ' + t.slice(0, cut + 1) + `（详→注-${noteId}） `;
      });
      out.push(newCells.join('|'));
      continue;
    }

    if (inTable) flush(); // 离开表格先冲刷注
    inTable = false;
    out.push(line);
  }
  if (inTable) flush();
  return { text: out.join('\n'), notes: noteId, skipped };
}

/** 自检：把契约 ①②③ + 幂等 + 守恒 + 围栏豁免逐条钉死 */
function selfTest() {
  const strip = (s) => s.replace(/（详→注-\d+）/g, '').replace(/^>\s*注-\d+：/gm, '').replace(/\s+/g, '');
  const bag = (s) => [...strip(s)].sort().join('');
  const ok = [];
  let bad = 0;
  const check = (name, cond, detail = '') => {
    if (cond) { ok.push(name); }
    else { bad++; console.error(`  ✗ ${name}${detail ? '：' + detail : ''}`); }
  };

  // 契约 ① + ②：长格拆出「（详→注-N）」+ 必有对应「> 注-N：」定义行，编号成对
  // 注意：格内容须**严格超过** MAX(200) 才会被拆——第一版用 repeat(20)（恰好 200 字符）导致
  // 合成用例根本不触发拆注，自检「假绿」；此处留足余量。
  const long = '| h1 | h2 |\n|---|---|\n| 短 | ' + '这是一句很长的说明。'.repeat(26) + ' |\n';
  const r1 = splitCells(long, 200);
  const marks = [...r1.text.matchAll(/（详→注-(\d+)）/g)].map((m) => m[1]);
  const defs = [...r1.text.matchAll(/^>\s*注-(\d+)：/gm)].map((m) => m[1]);
  check('① 标记形态 + ② 注定义行成对（无悬空注标）',
    marks.length > 0 && marks.length === defs.length && marks.every((m) => defs.includes(m)),
    `marks=${marks.length} defs=${defs.length}`);

  // 契约 ③：切口必落在句读符上——注行首字符不得是半截标点/残词
  const firstNotes = [...r1.text.matchAll(/^>\s*注-\d+：(.{0,1})/gm)].map((m) => m[1]);
  check('③ 注行首字符不是紧邻标点（切口落在句读符）',
    firstNotes.every((c) => !['，', '、', '）', '】', '」', '；', '。'].includes(c)),
    `首字符：${firstNotes.join(' ')}`);

  // 内容守恒（剥标记与空白后字符多重集一致）
  check('内容守恒（剥标记后逐字多重集一致）', bag(long) === bag(r1.text));

  // 表结构：列数不变
  const colsBefore = long.split('\n').map((l) => l.split('|').length);
  const colsAfter = r1.text.split('\n').filter((l) => l.trim().startsWith('|')).map((l) => l.split('|').length);
  check('表结构不变（列数）', colsAfter.every((c) => c === colsBefore[0]), `${colsBefore[0]} vs ${colsAfter.join(',')}`);

  // 幂等：第二趟对该文件零改动（注行已短，不再被拆）
  const r2 = splitCells(r1.text, 200);
  check('幂等（第二趟零改动）', r2.notes === 0 && r2.text === r1.text);

  // 无句读切口 ⇒ 整格不拆（宁可留长格）
  const noCut = '| h1 | h2 |\n|---|---|\n| 短 | ' + '无标点的长串'.repeat(40) + ' |\n';
  const r3 = splitCells(noCut, 200);
  check('无句读切口时整格不拆（skipped 计数如实）', r3.notes === 0 && r3.skipped === 1 && r3.text === noCut, `notes=${r3.notes} skipped=${r3.skipped}`);

  // 围栏内不动
  const fenced = '```\n| h | ' + 'x'.repeat(300) + ' |\n```\n';
  check('围栏内不动', splitCells(fenced, 200).text === fenced);

  // 分隔行 / 短格不动
  const plain = '| h1 | h2 |\n|---|---|\n| a | b |\n';
  check('短格与分隔行不动', splitCells(plain, 200).text === plain);

  if (bad) { console.error(`  自检失败（${bad} 项）`); process.exit(1); }
  console.log(`  ✓ ${ok.length} 项：${ok.join(' / ')}`);
  console.log('  自检全过（标记与注成对 / 只切句读符 / 守恒 / 列数不变 / 幂等 / 无切口不拆 / 围栏豁免）');
}

const args = process.argv.slice(2);
if (args.includes('--selftest')) { selfTest(); process.exit(0); }

const file = args.find((a) => !a.startsWith('--'));
const write = args.includes('--write');
const MAX = parseInt((args.find((a) => a.startsWith('--max')) || '--max200').slice(5), 10);
if (!file || !fs.existsSync(file)) { console.error('usage: split-table-cells.mjs <file> [--write] [--max N] | --selftest'); process.exit(2); }

const src = fs.readFileSync(file, 'utf8');
const { text, notes, skipped } = splitCells(src, MAX);
if (write && text !== src) fs.writeFileSync(file, text, 'utf8');
console.log(`${file}: 拆出 ${notes} 条注 · 跳过 ${skipped} 格（无句读切口，留长格交棘轮）${write ? (text !== src ? '（已写回）' : '（无变化）') : '（dry-run）'}`);
