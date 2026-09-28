#!/usr/bin/env node
// ============================================================
// reflow-walls.mjs · 墙式行折行器（一次性治理工具，非门禁）
// ------------------------------------------------------------
// 用途：把围栏外 >300 字符的非表格行在标点/空格处折成多行，
//       内容零删减。列表项续行缩进两空格；blockquote 续行带 >。
// 限制：跳过围栏代码块、表格行（| 开头——折断破坏表格）、标题。
//       折不断（无标点）的行原样保留并在 stderr 报告。
// 用法：node tools/check/lib/reflow-walls.mjs <file> [--write]
// ============================================================
import fs from 'node:fs';

const file = process.argv[2];
const write = process.argv.includes('--write');
if (!file || !fs.existsSync(file)) { console.error('usage: reflow-walls.mjs <file> [--write]'); process.exit(2); }

const LIMIT = 300;
const lines = fs.readFileSync(file, 'utf8').split('\n');
const out = [];
let inFence = false;
let unsplit = 0;

function splitLine(line) {
  // 在 [140, LIMIT] 区间从右往左找断点：CJK 句读优先，其次空格
  if (line.length <= LIMIT) return [line];
  let cut = -1;
  for (let i = Math.min(line.length - 1, LIMIT); i >= 140; i--) {
    const c = line[i];
    if ('。；！？'.includes(c)) { cut = i + 1; break; }
    if (c === '，' || c === '、') { if (cut < 0) cut = i + 1; continue; }
  }
  if (cut < 0) { // 英文/混合：找最后一个空格
    for (let i = Math.min(line.length - 1, LIMIT); i >= 140; i--) {
      if (line[i] === ' ') { cut = i + 1; break; }
    }
  }
  if (cut < 0) return null; // 折不断
  return [line.slice(0, cut).trimEnd(), line.slice(cut).trimStart()];
}

function prefixOf(line) {
  if (line.startsWith('- ') || line.startsWith('* ')) return '  ';
  if (/^\d+\. /.test(line)) return '  ';
  if (line.startsWith('>')) return '>';
  return '';
}

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
    rest = prefix + r[1];
  }
  if (rest) pieces.push(rest);
  out.push(...pieces);
}

if (write) fs.writeFileSync(file, out.join('\n'), 'utf8');
console.log(`${file}: 折行完成${write ? '（已写回）' : '（dry-run）'}，折不断 ${unsplit} 行`);
