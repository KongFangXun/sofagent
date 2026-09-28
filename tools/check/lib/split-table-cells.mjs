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
// 用法：node tools/check/lib/split-table-cells.mjs <file> [--write] [--max 200]
// ============================================================
import fs from 'node:fs';

const file = process.argv[2];
const write = process.argv.includes('--write');
const MAX = parseInt((process.argv.find((a) => a.startsWith('--max')) || '--max200').slice(5), 10);
if (!file || !fs.existsSync(file)) {
  console.error('usage: split-table-cells.mjs <file> [--write] [--max N]');
  process.exit(2);
}

/** 切口候选句读符：切口落在这里才说明句子闭合（半角分号/叹问同号） */
const CUT_CHARS = ['。', '；', '！', '？', ';', '!', '?'];

const lines = fs.readFileSync(file, 'utf8').split('\n');
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
  if (/^(```|~~~)/.test(line)) {
    inFence = !inFence;
    out.push(line);
    continue;
  }
  if (inFence) {
    out.push(line);
    continue;
  }

  const isTableRow = line.trim().startsWith('|') && line.includes('|', 1);
  if (isTableRow) {
    inTable = true;
    const cells = line.split('|');
    // 表头/分隔行不处理
    if (cells.slice(1, -1).every((c) => /^\s*:?-{2,}:?\s*$/.test(c))) {
      out.push(line);
      continue;
    }
    const newCells = cells.map((c, idx) => {
      if (idx === 0 || idx === cells.length - 1) return c;
      const t = c.trim();
      if (t.length <= MAX) return c;
      // 切口 = 窗口内**最后一个**句读符（取最后而非第一个：首句常极短，拆出来没有信息量）
      const cut = Math.max(...CUT_CHARS.map((ch) => t.lastIndexOf(ch, MAX)));
      const tail = cut > 0 ? t.slice(cut + 1).trim() : '';
      if (!tail) {
        skipped++;
        return c; // 无句读切口 ⇒ 整格不拆
      }
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

if (write) fs.writeFileSync(file, out.join('\n'), 'utf8');
console.log(
  `${file}: 拆出 ${noteId} 条注 · 跳过 ${skipped} 格（无句读切口，留长格交棘轮）${write ? '（已写回）' : '（dry-run）'}`,
);
