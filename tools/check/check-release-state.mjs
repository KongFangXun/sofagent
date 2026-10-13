#!/usr/bin/env node
// ============================================================
// check-release-state.mjs · 发版状态对账门禁（v1.6.0 Batch G · BUG-16/17/61/68 族）
// ============================================================
// 定位：发版翻牌（ROADMAP/WIKI/changelog 目录）靠手工清单，漏步频发——
// v1.5.9 四处翻牌残缺（主题词串版/迭代表缺行/规划表滞留/WIKI 双日期）皆因此。
// 本门禁把「已发版即翻牌」机械化：
//   ① git tag 存在的版本 ⇒ ROADMAP 迭代历程表必须含该版行
//   ② 已发版版本不得留在 ROADMAP「规划版本」表
//   ③ ROADMAP 版本头主题词 ⊇ CHANGELOG 索引行的主题词（防串版）
//   ④ docs/changelog/README.md 目录状态与实际一致（v1.5.x 不再标「已排期未实现」）
// 退出码：0 绿 / 1 红
// ============================================================
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const fail = (msg) => { console.error(`  ❌ [release-state] ${msg}`); process.exitCode = 1; };

// ── 已发版版本集（git tag）──
const tags = execSync('git tag', { encoding: 'utf8' })
  .split('\n')
  .map((t) => t.trim())
  .filter((t) => /^v\d+\.\d+\.\d+$/.test(t));

const roadmap = existsSync('docs/ROADMAP.md') ? readFileSync('docs/ROADMAP.md', 'utf8') : '';
const changelog = existsSync('CHANGELOG.md') ? readFileSync('CHANGELOG.md', 'utf8') : '';

// ── ① 迭代历程表含已发版行（查最近 5 版防历史表格长期回填爆炸）──
const recentTags = tags.slice(-5);
for (const tag of recentTags) {
  const ver = tag.replace(/^v/, '');
  // 迭代历程段内该版行（| v1.5.9（日期）|）
  const iterSection = roadmap.split('## 迭代历程')[1]?.split('## ')[0] ?? '';
  const rowRe = new RegExp('\\|\\s*v?' + ver.replace(/\./g, '\\.') + '（');
  if (!rowRe.test(iterSection)) {
    fail(`ROADMAP 迭代历程表缺已发版 ${ver} 行（tag 已存在）`);
  }
}

// ── ② 规划版本表不含已发版（查最近 3 版）──
const planSection = roadmap.split('### 规划版本')[1]?.split('## ')[0]
  ?? roadmap.split('## 版本规划')[1]?.split('## ')[0] ?? '';
for (const tag of tags.slice(-3)) {
  const ver = tag.replace(/^v/, '');
  const rowRe = new RegExp(`\\|\\s*\\*{0,2}${ver.replace(/\./g, '\\.')}\\*{0,2}\\s*\\|`);
  if (rowRe.test(planSection)) {
    fail(`ROADMAP 规划版本表仍含已发版 ${ver} 行（应移入迭代历程）`);
  }
}

// ── ③ 版本头主题词与 CHANGELOG 索引一致（当前版）──
const latestTag = tags[tags.length - 1];
if (latestTag) {
  const ver = latestTag.replace(/^v/, '');
  // CHANGELOG 索引行：- **v1.5.9** — 🧬 进化模块·写面审计与元验证——
  const clMatch = changelog.match(new RegExp(`- \\*\\*${ver.replace(/\./g, '\\.')}\\*\\* — (.) ([^—]+)——`));
  // ROADMAP 版本头：> vX.Y.Z · 日期（GMT+8）· ✅ 已发版 · 孔放勋 · <主题>
  const rmMatch = roadmap.match(new RegExp(`> ${ver.replace(/\./g, '\\.')} · [^\\n]*· ✅ 已发版 · [^·]+· ([^。\\n]+)`));
  if (clMatch && rmMatch) {
    const clTheme = clMatch[2].trim().split('·')[0].trim();
    const rmTheme = rmMatch[1].trim().split('·')[0].trim();
    if (clTheme && rmTheme && !rmTheme.includes(clTheme) && !clTheme.includes(rmTheme)) {
      fail(`ROADMAP 版本头主题词「${rmTheme}」与 CHANGELOG「${clTheme}」不一致（疑串版）`);
    }
  }
}

// ── ④ changelog 目录门面状态 ──
const clReadme = existsSync('docs/changelog/README.md') ? readFileSync('docs/changelog/README.md', 'utf8') : '';
if (clReadme) {
  // 最新 tag 的 minor 目录行不得标「已排期未实现」
  if (latestTag) {
    const minor = latestTag.replace(/^v/, '').split('.').slice(0, 2).join('.');
    const rowRe = new RegExp('\\| `v' + minor + '/` \\|[^\\n]*已排期未实现');
    if (rowRe.test(clReadme)) {
      fail(`docs/changelog/README.md 的 v${minor}/ 目录行仍标「已排期未实现」（已发版态）`);
    }
  }
  // 头部版本 = 最新 tag
  if (latestTag && !clReadme.includes(latestTag.replace('v', 'v'))) {
    fail(`docs/changelog/README.md 头部版本未更新到 ${latestTag}`);
  }
}

if (!process.exitCode) {
  console.log('✅ check-release-state：发版翻牌四面对账一致（迭代历程/规划表/主题词/目录状态）');
}
