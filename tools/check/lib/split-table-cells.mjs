#!/usr/bin/env node
// ============================================================
// split-table-cells.mjs · 墙式表格格拆注工具（一次性治理）
// ------------------------------------------------------------
// 把 >200 字符的表格单元格截为「主句 + 注」：单元格里留首句
// （至第一个。），其余内容移到该表格下方「> 注-N：」引用行。
// 表结构（列数）不变，GFM 渲染安全。
// 用法：node tools/check/lib/split-table-cells.mjs <file> [--write] [--max 200]
// ============================================================
import fs from 'node:fs';

const file = process.argv[2];
const write = process.argv.includes('--write');
const MAX = parseInt((process.argv.find(a => a.startsWith('--max')) || '--max200').slice(5), 10);
if (!file || !fs.existsSync(file)) { console.error('usage: split-table-cells.mjs <file> [--write] [--max N]'); process.exit(2); }

const lines = fs.readFileSync(file, 'utf8').split('\n');
const out = [];
let inFence = false;
let noteId = 0;
let pendingNotes = [];
let inTable = false;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (/^(```|~~~)/.test(line)) { inFence = !inFence; out.push(line); continue; }
  if (inFence) { out.push(line); continue; }

  const isTableRow = line.trim().startsWith('|') && line.includes('|', 1);
  if (isTableRow) {
    inTable = true;
    const cells = line.split('|');
    // 表头/分隔行不处理
    if (cells.slice(1, -1).every(c => /^\s*:?-{2,}:?\s*$/.test(c))) { out.push(line); continue; }
    let rowChanged = false;
    const newCells = cells.map((c, idx) => {
      if (idx === 0 || idx === cells.length - 1) return c;
      const t = c.trim();
      if (t.length <= MAX) return c;
      // 截到第一个句号（保留）
      const dot = t.indexOf('。');
      let head = dot > 10 && dot < 200 ? t.slice(0, dot + 1) : t.slice(0, 80) + '…';
      noteId++;
      pendingNotes.push(`> 注-${noteId}：${t.slice(head === t.slice(0, dot + 1) ? dot + 1 : 80)}`);
      rowChanged = true;
      return ' ' + head + `（详注-${noteId}） `;
    });
    out.push(newCells.join('|'));
    continue;
  }

  // 表格结束（非表格行）——先冲刷注
  if (inTable && pendingNotes.length) {
    out.push('');
    for (const n of pendingNotes) out.push(n);
    pendingNotes = [];
  }
  if (!isTableRow) inTable = false;
  out.push(line);
}
if (pendingNotes.length) { out.push(''); for (const n of pendingNotes) out.push(n); }

if (write) fs.writeFileSync(file, out.join('\n'), 'utf8');
console.log(`${file}: 拆出 ${noteId} 条注${write ? '（已写回）' : '（dry-run）'}`);
