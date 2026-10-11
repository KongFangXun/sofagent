#!/usr/bin/env node
// ============================================================
// readability-count.mjs · 核心文档可读性计数器（单一口径）
// ------------------------------------------------------------
// 口径（计数纪律——改口径先改本注释，再同步 doc-ratchet.json _meta）：
//   wall = 围栏代码块之外、长度 > 300 字符的行（墙式段落）
//   cell = 围栏代码块之外、表格行内 > 200 字符的单元格（墙式单元格）
//   围栏 = ``` 或 ~~~ 开头的行，成对切换（GFM 口径）
// 消费方：doc-discipline.sh Face 5（棘轮门禁）与基线生成。
// 用法：node tools/check/lib/readability-count.mjs <file...>   → JSON 到 stdout
// ============================================================
import fs from 'node:fs';

const files = process.argv.slice(2);
const out = {};
for (const f of files) {
  if (!fs.existsSync(f)) {
    // 🔴 缺失文件**必须显式**：原先 `continue` 是静默跳过——JSON 里没有该键，消费方读 `o[f].wall`
    //    拿到 undefined，算式（如 Math.min）静默变 NaN 并写进台账（实测过：doc-ratchet.json 被写坏）。
    //    故改为「显式条目 + stderr 告警」：让缺失**可见**，且消费方取到的是数字而非 undefined。
    process.stderr.write(`⚠️ readability-count: 文件不存在，按 0 计并标注 missing：${f}\n`);
    out[f] = { wall: 0, cell: 0, missing: true };
    continue;
  }
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  let inFence = false, wall = 0, cell = 0;
  for (const line of lines) {
    if (/^(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (line.length > 300) wall++;
    const t = line.trim();
    if (t.startsWith('|')) {
      for (const c of line.split('|').slice(1, -1)) if (c.length > 200) cell++;
    }
  }
  out[f] = { wall, cell };
}
console.log(JSON.stringify(out));
