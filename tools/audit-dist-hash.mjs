#!/usr/bin/env node
// ============================================================
// audit-dist-hash.mjs · 审计引擎 dist「多入口聚合哈希」计算器
// ============================================================
// 用途：为 P1-A2 影子审计器防线提供「dist 是否变了」这个信号。
//
// 为什么不用 dist/index.js 单文件哈希：
//   dist 里有多个可执行入口（index.js 与 cli-quick.js 都是 bin，
//   agent-shield.js / cli/agent-shield.js 各自独立），而 index.js 的 import 图
//   覆盖不到 cli-quick 等入口（实测从 index.js 出发的可达集 17 个模块，不含这三个）。
//   于是「只改 cli-quick.ts 后重建」时 index.js 逐字节不变，单文件哈希观测不到
//   这次真实发生的重建——hook 会误报「源码已变更但 dist 未重建」；反过来，攻击者
//   只覆写 cli-quick.js 也不会被单文件哈希发现，防线等于只守住了 index.js 一个入口。
//
// 解法：把 dist 下全部 .js 按相对路径排序后逐个取内容哈希，再聚合为一个哈希。
//   任一入口变化都会被观测到；排序保证同一份 dist 在任何机器上算出同一个值。
//   只收 .js（真正被执行的代码），不含 .js.map / .d.ts——它们不影响运行时行为，
//   收进来只会让哈希对「不影响执行的改动」敏感，制造噪音。
//
// 设计约束：
//   - 必须由 dist 之外的代码计算。若交给 dist/index.js 算，dist 已被篡改时
//     指纹也可被伪造，防线 self-defeating。故 hook 直接调用本脚本。
//   - 单一实现。hook（bash）与信任锚同步脚本共用本文件，避免两份算法漂移。
//   - 零依赖，纯 node 内置模块。
//
// 用法:
//   node tools/audit-dist-hash.mjs [repoRoot]
//   不传 repoRoot 时用 process.cwd()
// 输出: 64 位小写 sha256（stdout，无换行）；dist 不存在时输出空串（调用方走降级）
// ============================================================

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/** 递归收集 dist 下的 .js 文件（深度优先） */
function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      walk(p, out);
    } else if (e.isFile() && e.name.endsWith('.js')) {
      out.push(p);
    }
  }
  return out;
}

const root = resolve(process.argv[2] || process.cwd());
const distRoot = join(root, 'engine/audit/dist');

if (!existsSync(distRoot) || !statSync(distRoot).isDirectory()) {
  process.stdout.write('');
  process.exit(0);
}

const files = walk(distRoot)
  .map((f) => ({ rel: relative(distRoot, f).split(sep).join('/'), abs: f }))
  .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

if (files.length === 0) {
  process.stdout.write('');
  process.exit(0);
}

// 每个文件贡献「相对路径 + 内容哈希」：只聚合内容哈希会让「两个文件互换内容」
// 这类改动逃逸，带上路径可锁住拓扑。用 \u0000 分隔避免路径含分隔符时被拼接歧义。
const inputs = files.map(
  (f) => f.rel + '\u0000' + createHash('sha256').update(readFileSync(f.abs)).digest('hex')
);

process.stdout.write(createHash('sha256').update(inputs.join('\u0001'), 'utf8').digest('hex'));
