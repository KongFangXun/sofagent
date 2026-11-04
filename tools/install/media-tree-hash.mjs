#!/usr/bin/env node
// ============================================================
// media-tree-hash.mjs · 介质载荷「树聚合指纹」（F6.7 D-2 ③）
// ============================================================
// 为什么需要它：逐件 sha256 只能证明「列出的文件没被改」，证明不了
// 「有没有多塞/漏塞文件」——介质自签清单可以被整体重写，所以清单本身
// 必须由权威源产出并钉住指纹（见 tools/install/manifest-pin.txt）。
// 树聚合把「文件集合 + 每个文件的哈希」压成一个值：
//   多一个文件、少一个文件、改一个字节 ⇒ 聚合值必然变。
//
// 聚合口径（必须与 pack-media.sh 完全一致，否则验不过）：
//   1. 递归枚举 <dir> 下所有**普通文件**（跟随符号链接到文件，跳过目录链接）
//   2. 相对路径按 LC_ALL=C 字节序升序排列
//   3. 对每个文件拼一行：`<sha256>  <相对路径>\n`（两个空格，与 sha256sum 同形）
//   4. 聚合 = sha256(以上全部行拼接)
// 用法：media-tree-hash.mjs <dir>
// 输出：`<files> <bytes> <aggregateSha256>`（单行，便于 shell 取值）
// 退出：0 正常 · 2 目录不存在/不可读
// ============================================================

import { createHash } from 'node:crypto';
import { createReadStream, lstatSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('用法: media-tree-hash.mjs <dir>');
  process.exit(2);
}
try {
  if (!statSync(dir).isDirectory()) throw new Error('not dir');
} catch {
  console.error(`❌ 目录不存在或不可读：${dir}`);
  process.exit(2);
}

// 枚举普通文件（不跟随目录软链，避免环）
function walk(root, cur = root, out = []) {
  for (const name of readdirSync(cur)) {
    const p = join(cur, name);
    let st;
    try {
      st = lstatSync(p);
    } catch {
      continue; // 竞态删除：跳过，由聚合值变化暴露
    }
    if (st.isSymbolicLink()) {
      // 链接到文件按内容计入；链接到目录跳过（不展开，避免跨介质逃逸与环）
      try {
        if (statSync(p).isFile()) out.push(p);
      } catch {
        /* 断链：忽略，缺失会由聚合值暴露 */
      }
      continue;
    }
    if (st.isDirectory()) walk(root, p, out);
    else if (st.isFile()) out.push(p);
  }
  return out;
}

const sha256 = (p) =>
  new Promise((res, rej) => {
    const h = createHash('sha256');
    createReadStream(p)
      .on('data', (c) => h.update(c))
      .on('error', rej)
      .on('end', () => res(h.digest('hex')));
  });

const files = walk(dir)
  .map((p) => ({ abs: p, rel: relative(dir, p).split('\\').join('/') }))
  // LC_ALL=C 字节序：直接按 UTF-8 字节比较，与 GNU sort 在 C locale 下等价
  .sort((a, b) => Buffer.compare(Buffer.from(a.rel, 'utf8'), Buffer.from(b.rel, 'utf8')));

const agg = createHash('sha256');
let bytes = 0;
for (const f of files) {
  const h = await sha256(f.abs);
  bytes += statSync(f.abs).size;
  agg.update(`${h}  ${f.rel}\n`);
}

console.log(`${files.length} ${bytes} ${agg.digest('hex')}`);
