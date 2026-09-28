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
  if (!fs.existsSync(f)) continue; // 新建/改名中的文件由门禁侧单独报
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
