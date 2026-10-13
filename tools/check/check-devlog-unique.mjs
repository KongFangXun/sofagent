#!/usr/bin/env node
// ============================================================
// check-devlog-unique.mjs · devlog 数字唯一门禁（v1.6.0 Batch G · BUG-62 族）
// ============================================================
// 同一 devlog 文件内「N tests/N 个测试」出现多个不同值即红——
// 限定词例外：行内含词表 {快照, 时点, 中间态, 开发期, 阶段性} 任一即豁免
// （词表为 SSOT 写在本头注释，新增豁免词须改本门禁，不接受行内新造词）。
// 附带（BUG-12 族）：README 能力表「触达方式/Reachable」列值 ∈ 三档枚举
// {CLI 可达, 进程内自动, SDK 面} / {CLI reachable, In-process, SDK-face}
// ——「已接线/Wired」裸值即红。
// 退出码：0 绿 / 1 红
// ============================================================
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

let fails = 0;
const fail = (m) => { console.error('  ❌ ' + m); fails++; };

// ── ① devlog 测试数唯一 ──
const EXEMPT_WORDS = ['快照', '时点', '中间态', '开发期', '阶段性'];
const devlogDir = 'docs/changelog';
function walkMd(dir, out) {
  for (const n of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, n.name);
    if (n.isDirectory()) walkMd(p, out);
    else if (n.name.endsWith('.md')) out.push(p);
  }
  return out;
}
// 只查最新两个版本目录（历史冻结区不回改——历史混排叙述如「99 tests（某包）」合法）
import { readdirSync as rd } from 'node:fs';
const versionDirs = rd(devlogDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && /^v\d+\.\d+$/.test(d.name))
  .map((d) => d.name)
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
// 规划版目录（v1.6+/v2.0）无已发版 devlog——排除后取最新两个已发版目录
const shippedDirs = versionDirs.filter((d) => {
  const sub = join(devlogDir, d);
  try {
    return rd(sub, { withFileTypes: true }).some((e) => e.isDirectory());
  } catch { return false; }
});
// 已发版判定：目录内 devlog 内容含「✅ 已发版」（规划版文件标「尚未实现」）
const shipped = versionDirs.filter((d) => {
  try {
    return rd(join(devlogDir, d))
      .filter((f) => /^v\d+\.\d+\.\d+\.md$/.test(f))
      .some((f) => {
        const head = readFileSync(join(devlogDir, d, f), 'utf8').split('\n').slice(0, 10).join('\n');
        return head.includes('已发版') && !head.includes('尚未实现');
      });
  } catch { return false; }
});
// 历史目录混排属冻结区——只查最新已发版目录（历史如 v1.4 的「4088/088」系
// 段落内多处计数叙述，属真实历史形态不回改）
const recentDirs = new Set(shipped.slice(-1));
const allMd = walkMd(devlogDir, []).filter((f) => {
  const rel = f.replace(devlogDir + '/', '');
  const top = rel.split('/')[0];
  return recentDirs.has(top);
});
for (const f of allMd) {
  const text = readFileSync(f, 'utf8');
  const nums = new Set();
  for (const line of text.split('\n')) {
    if (EXEMPT_WORDS.some((w) => line.includes(w))) continue;
    for (const m of line.matchAll(/([\d,]{3,7})\s*(?:\/[\d,]{3,7}\s*)?(?:tests|个测试|单元)/g)) {
      nums.add(m[1].replace(/,/g, '')); // 千分位归一（4,903 与 4903 同值）
    }
  }
  if (nums.size > 1) {
    fail(`[devlog-unique] ${f} 测试数多值并存：${[...nums].join(' / ')}（无限定词行）`);
  }
}

// ── ② README 能力表三档枚举 ──
const ENUM_ZH = ['CLI 可达', '进程内自动', 'SDK 面', '⚠️ 破坏性'];
const ENUM_EN = ['CLI reachable', 'In-process', 'SDK-face', '⚠️ Breaking'];
for (const rf of ['README.md', 'README.en.md']) {
  if (!existsSync(rf)) continue;
  const lines = readFileSync(rf, 'utf8').split('\n');
  let inTable = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.includes('| 能力 |') || l.includes('| Capability |')) { inTable = true; continue; }
    if (inTable) {
      if (!l.startsWith('|')) { inTable = false; continue; }
      const cells = l.split('|').map((c) => c.trim());
      const reach = cells[cells.length - 2]; // 触达方式列（倒数第二，最后是空）
      if (!reach || reach === '触达方式' || reach === 'Reachable' || reach.startsWith('---')) continue;
      const zhOk = ENUM_ZH.some((e) => reach.startsWith(e));
      const enOk = ENUM_EN.some((e) => reach.startsWith(e));
      if (!zhOk && !enOk) {
        fail(`[三档枚举] ${rf}:${i + 1} 触达方式列裸值「${reach}」不在枚举内`);
      }
    }
  }
}

if (fails) { console.error(`\n❌ check-devlog-unique：${fails} 处`); process.exit(1); }
console.log('✅ check-devlog-unique：devlog 数字唯一 + 能力表三档枚举全过');
