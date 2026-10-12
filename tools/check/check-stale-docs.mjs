#!/usr/bin/env node
// ============================================================
// check-stale-docs.mjs · 过时内容检测器（陈旧 ≠ 考古）
// ============================================================
// 动机：doc-score D6 管「出身考古」（vX.Y 新增 / 日期标签），但没人管
//   「现状失真」——文档声称的状态 vs 仓的实际状态不符。人眼实例：
//   ROADMAP 头部残留「v1.5.4 已发版」行而 v1.5.6 已发（跳版残留，肉眼发现）。
//   本脚本把三类可机械判定的「陈旧」收口成断言：
//
//   A. 状态滞后：文档写「📋 规划中」的版本已发版（tag 存在）——ROADMAP/README 最常见
//   B. 叙述性脚本引用失效：正文提及 tools/xxx.sh 或 tools/xxx.mjs 但文件不存在
//      （check-anchors 管 markdown 链接，不管「运行 bash tools/…」这类叙述性引用）
//   C. 陈旧版本头：文档头部「当前 vX.Y」声明 ≠ package.json 实值（多文档漂移源）
//
// 用法：
//   node tools/check/check-stale-docs.mjs          # 全部三类
//   node tools/check/check-stale-docs.mjs --json   # 机读
//
// 退出码：0 = 无陈旧；1 = 有（逐条修内容即可，无需登记）。
// 定性：**文档收尾自检工具**（加入收尾套餐的候选面）——非考古（那是标签问题），
//   非死链（那是链接问题），专管「字面还在说昨天的世界」。
// ============================================================

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
process.chdir(ROOT);
const JSON_MODE = process.argv.includes('--json');

function sh(cmd, args) {
  try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (e) { return `${e.stdout ?? ''}`; }
}

// ── 判据素材 ──
const tagList = sh('git', ['tag', '--list']).split('\n').filter(Boolean);
// tag 名兼容两种形态：v1.5.7（带 v 前缀）与 1.5.7（裸版本）
const tagSet = new Set([...tagList, ...tagList.map((t) => t.replace(/^v/, ''))]);
const pkgVersion = (() => {
  try { return JSON.parse(fs.readFileSync('package.json', 'utf8')).version; } catch { return null; }
})();

// 扫描面：非冻结活文档（与 doc-score 的非冻结面同口径）
// FORGE/ 加入排除：LEDGER 与 lessons 是留痕历史（描述「当时的检查命令为何误报」会
// 引述旧状态词，如「grep 'v1.5.2|规划中' 命中过宽」——那是历史教训的引述语境，
// 不是活文档的状态声明，扫它必误报（首跑实测 2 处即此类）。
const FROZEN = /^(docs\/changelog\/(?!releasing)|docs\/archive|docs\/evidence|playbook\/vendor|FORGE\/)/;
const mdFiles = sh('git', ['ls-files', '*.md'])
  .split('\n').filter(Boolean)
  .filter((f) => !FROZEN.test(f));

const issues = [];

// ── A. 状态滞后：「📋 规划中」的版本已有 tag ──
for (const f of mdFiles) {
  const text = fs.readFileSync(f, 'utf8');
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 形态：| **v1.5.7** | 📋 规划中 |（版本行状态列）
    const m = line.match(/\|\s*\*{0,2}(v\d+\.\d+(?:\.\d+)?)\*{0,2}\s*\|[^|]*📋\s*规划中/);
    if (m && tagSet.has(m[1])) {
      issues.push({ kind: 'A-状态滞后', file: f, line: i + 1, detail: `${m[1]} 标记「规划中」但 tag 已存在（已发版）——状态列该前移`, excerpt: line.slice(0, 100) });
    }
    // 形态：行内「vX.Y 规划中/vX.Y 排期中」且该 tag 存在
    const m2 = line.match(/(v\d+\.\d+(?:\.\d+)?)[^\n]{0,12}(规划中|排期中)/);
    if (m2 && tagSet.has(m2[1]) && !line.includes('📋 规划中 |')) {
      issues.push({ kind: 'A-状态滞后', file: f, line: i + 1, detail: `「${m2[1]} ${m2[2]}」但该版已发版（tag 存在）`, excerpt: line.slice(0, 100) });
    }
  }
}

// ── B. 叙述性脚本引用失效 ──
const SCRIPT_RE = /(?:bash|node|sh|npm run)\s+(tools\/[\w./-]+\.(?:sh|mjs|js))/g;
for (const f of mdFiles) {
  const text = fs.readFileSync(f, 'utf8');
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(SCRIPT_RE)) {
      const p = m[1];
      if (!fs.existsSync(p)) {
        issues.push({ kind: 'B-脚本引用失效', file: f, line: i + 1, detail: `提及 ${p} 但文件不存在（改名/删除后叙述未随动）`, excerpt: lines[i].slice(0, 100) });
      }
    }
  }
}

// ── C. 陈旧版本头（仅核心文档头部 30 行内的「当前 vX.Y」类声明）──
if (pkgVersion) {
  for (const f of mdFiles) {
    const text = fs.readFileSync(f, 'utf8');
    const lines = text.split('\n');
    const head = lines.slice(0, 30);
    // 「既往发版记录」声明行之后的行属历史滚动记录（合法形态），不再判滞后——
    // 只要求声明行之前存在一个等于 pkgVersion 的「当前发版」行（首条即当前）。
    const historyMarkerIdx = head.findIndex(l => l.includes('既往发版记录'));
    // 「首条即当前」（2026-10-11 按 ROADMAP 头部现状重对）：头部常以「当前版摘要 +
    //   历史滚动摘要」两段并置（如 ROADMAP 的 v1.5.8 摘要 + v1.5.7/v1.5.6 压缩行）。
    //   版本头滞后只可能出在**首条**声明上，其后同段内的旧版声明天然是历史记录——
    //   故只判首个命中行，其后命中行按历史滚动跳过（无需依赖「既往发版记录」标记行，
    //   使无标记的既有两级头部形态也判得干净）。
    let firstDeclSeen = false;
    for (let i = 0; i < head.length; i++) {
      if (historyMarkerIdx >= 0 && i > historyMarkerIdx) continue; // 历史区跳过
      const m = head[i].match(/(?:当前发版\s*)?(?:当前|现在)?v?(\d+\.\d+\.\d+)(?:（[^）]*）|\s*·?\s*(?:✅\s*)?)\s*已发版|(?:当前发版)\s*v?(\d+\.\d+\.\d+)/);
      const hitV = m && (m[1] || m[2]);
      if (!hitV) continue;
      if (firstDeclSeen) continue; // 首条之后的版本声明属历史滚动，不判
      firstDeclSeen = true;
      if (hitV !== pkgVersion) {
        issues.push({ kind: 'C-版本头滞后', file: f, line: i + 1, detail: `头部首条版本声明 v${hitV} 已发版，package.json 实值 ${pkgVersion}——需前移`, excerpt: head[i].slice(0, 100) });
      }
    }
  }
}

// ── 输出 ──
if (JSON_MODE) {
  console.log(JSON.stringify({ pkgVersion, issues }, null, 2));
} else {
  console.log(`═══ 过时内容检测（非冻结 ${mdFiles.length} 文档 · 三类判据）═══`);
  console.log('');
  if (issues.length === 0) {
    console.log('  ✓ 无状态滞后 / 无失效脚本引用 / 无版本头漂移');
  } else {
    const byKind = {};
    for (const it of issues) (byKind[it.kind] ??= []).push(it);
    for (const [kind, list] of Object.entries(byKind)) {
      console.log(`  ✗ ${kind} ${list.length} 处：`);
      for (const it of list) {
        console.log(`     ${it.file}:${it.line}  ${it.detail}`);
        console.log(`       「${it.excerpt}」`);
      }
      console.log('');
    }
    console.log('  修法：A 类改状态列（已发版版本从「规划中」前移）；B 类改叙述引用为现状脚本或删；');
    console.log('  C 类核 package.json 后前移版本头（若属刻意的「上一版记录」则改措辞避免「当前」歧义）。');
  }
}
process.exit(issues.length > 0 ? 1 : 0);
