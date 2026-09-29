#!/usr/bin/env node
// ============================================================
// doc-score.mjs · 文档质量六维评分器（每版必跑 · 各维 ≥8 才放行）
// ============================================================
// 定位：把「文档质量」从印象分升级为**可复算、可门禁化、只许升不许降**的量化分。
//
// 设计原则（与发版 SOP 06-doc-finalize「文档质量六维评分」节同源）：
//   ① 分数 = 通过项 / 总项 × 10，**不用人打分**——印象分不可复算、必然自欺。
//   ② 六维 27 项里，约 15 项**机械可判**（调既有门禁或直接判定）；其余 ~12 项
//      **本质是判断题**（什么算重复 / 身份冲突 / 排期混入）——机器判不准。
//   ③ 对判断题**不装假装的门禁**，而是走「人工复核 + 留痕」：评分器标为
//      `需人工确认`，**未确认即按不通过计（fail-closed）**——留痕可审计，
//      不做口头承诺。留痕落在**本版 devlog 的「文档质量评分」节**（逐项写结论+依据）。
//
// 判据来源（能复用现成门禁的绝不重造——见每项 `src` 字段）：
//   check-test-count.sh / check-docs.sh §1b / check-claims.mjs / check-readme-parity.sh
//   doc-discipline.sh（Face 5 可读性棘轮 / Face 6 字数棘轮 / Face 7 抬头块闸）
//   check-archaeology.sh（规则文档禁考古）/ check-table-shape.mjs（表格形状）
//
// 扫描面（口径见每项 `scope` 字段）：
//   · ACTIVE_DOCS = tools/check/doc-char-ratchet.json 的键（21 份核心活文档）——
//     D3/D4/D5 的文档级结构/排版/可读性判据在此面上判（与 charset 棘轮同域）。
//   · 非冻结全仓面 = git ls-files '*.md' 减去冻结区（docs/changelog · docs/archive ·
//     docs/evidence · playbook/vendor）——D1-4 悬空版本号在此面上判。
//
// 退出码：0 = 全绿（各维 ≥8 且 ≥ 基线）；1 = 有维 <8 或低于基线（不可放行）
//
// 用法：
//   node tools/check/doc-score.mjs             # 评分（读本版 devlog 留痕）
//   node tools/check/doc-score.mjs --json      # 机读输出（供 SOP 记录）
//   node tools/check/doc-score.mjs --write-baseline  # 用当前实测写基线（发版治具）
// ============================================================

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SELF_DIR, '..', '..');
process.chdir(ROOT);

const BASELINE_PATH = 'tools/check/doc-score-baseline.json';
const CHAR_RATCHET_PATH = 'tools/check/doc-char-ratchet.json';
const FLOOR = 8; // 绝对下限：任一维 < 此值即不可放行

// ── 通用工具 ──────────────────────────────────────────────
/** 跑一条外部命令，恒返回 {rc, out}（不抛）。 */
function run(cmd, args) {
  try {
    const out = execFileSync(cmd, args, { encoding: 'utf8', cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    return { rc: 0, out };
  } catch (e) {
    const out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    return { rc: typeof e.status === 'number' ? e.status : 1, out };
  }
}
const readText = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const readJson = (f) => JSON.parse(readText(f));
const cps = (s) => [...s].length; // Unicode 码点数（单一口径，同 charset 棘轮）
const isFence = (s) => /^\s*(?:>\s*)*(```|~~~)/.test(s); // 含 blockquote 内围栏（`> ```bash`）
const stripCode = (line) => line.replace(/`[^`]*`/g, '');
const isHeading = (s) => /^#{1,6}\s/.test(s);
const trackedMd = () =>
  execFileSync('git', ['ls-files', '*.md'], { encoding: 'utf8', cwd: ROOT })
    .split('\n')
    .filter(Boolean);

// ── 扫描面 ────────────────────────────────────────────────
const charRatchet = readJson(CHAR_RATCHET_PATH);
const ACTIVE_DOCS = Object.keys(charRatchet).filter((k) => k !== '_meta');
const FROZEN_RE = /^(docs\/(changelog|archive|evidence)\/|playbook\/vendor\/|node_modules\/)/;
const isFrozen = (f) => FROZEN_RE.test(f);
const LS_ALL = trackedMd();
const LIVE_MD = LS_ALL.filter((f) => !isFrozen(f));

/** 逐文件行（含 frontmatter 标记剥离，供结构判定）。 */
function docLines(f) {
  const raw = readText(f).split('\n');
  let start = 0;
  if (raw[0] !== undefined && raw[0].trim() === '---') {
    let j = 1;
    while (j < raw.length && raw[j].trim() !== '---') j++;
    start = j + 1; // frontmatter 结束（含闭合行）
  }
  return { all: raw, body: raw.slice(start).map((l, i) => ({ line: l, no: start + i + 1 })) };
}

// ============================================================
// D1 准确（5 项 · 全机械）
// ============================================================
function d1_1() {
  const r = run('bash', ['tools/check/check-test-count.sh', '--quiet']);
  const ok = r.out.trim().endsWith('OK');
  return { pass: ok, detail: ok ? '文档声称测试数 == 实测（SSOT）' : `check-test-count 未绿（rc=${r.rc}）` };
}
function d1_2() {
  const r = run('bash', ['tools/check/check-docs.sh']);
  const m = r.out.match(/全仓相对路径死链:\s*(\d+)/);
  if (!m) return { pass: false, detail: 'check-docs §1b 输出提取失败（检查器失明——拒绝假绿）' };
  const n = Number(m[1]);
  return { pass: n === 0, detail: n === 0 ? '失效相对引用 0 处' : `失效相对引用 ${n} 处（check-docs §1b）` };
}
function d1_3() {
  const r = run('node', ['tools/check/check-claims.mjs']);
  return { pass: r.rc === 0, detail: r.rc === 0 ? '无被推翻的「未实现/未接线」断言（check-claims 三组通过）' : `check-claims rc=${r.rc}` };
}
function d1_4() {
  // 指向不明的版本号：`（vX.Y …）` 内出现「补口/待定/另定/待补/另议」等无对象词
  const RE = /（v\d\.\d[^）]*）/g;
  const BAD = /补口|待定|另定|待补|另议|待落/;
  const hits = [];
  for (const f of LIVE_MD) {
    readText(f)
      .split('\n')
      .forEach((l, i) => {
        for (const m of l.matchAll(RE)) if (BAD.test(m[0])) hits.push(`${f}:${i + 1} ${m[0]}`);
      });
  }
  return {
    pass: hits.length === 0,
    detail: hits.length === 0 ? '悬空版本指代 0 处' : `悬空版本指代 ${hits.length} 处：${hits.slice(0, 3).join(' / ')}`,
  };
}
function d1_5() {
  const r = run('bash', ['tools/check/check-readme-parity.sh']);
  return { pass: r.rc === 0, detail: r.rc === 0 ? '双语 README 关键数字集合一致' : `check-readme-parity rc=${r.rc}` };
}

// ============================================================
// D3 结构（5 项 · 全机械 · 扫描面 = ACTIVE_DOCS）
// ============================================================
/** 从已生成的 doc-discipline 输出里切出某个 Face 段（供 D2-3/D5-1/D5-2 复用）。 */
function faceSection(out, tag) {
  const lines = out.split('\n');
  const start = lines.findIndex((l) => l.includes(tag));
  if (start < 0) return null;
  const rest = lines.slice(start);
  const end = rest.findIndex((l, i) => i > 0 && /^\[Face \d/.test(l));
  return (end > 0 ? rest.slice(0, end) : rest).join('\n');
}
function d3_1() {
  const miss = [];
  for (const f of ACTIVE_DOCS) {
    const { all } = docLines(f);
    if (all.length <= 200) continue;
    const hasToc = all.some((l) => /^##\s*(目录|Table of Contents)\s*$/i.test(l));
    if (!hasToc) miss.push(`${f}（${all.length} 行）`);
  }
  return { pass: miss.length === 0, detail: miss.length === 0 ? '>200 行活文档均有「## 目录」' : `缺目录：${miss.join(' / ')}` };
}
function d3_2() {
  // 豁免（明示为非章节型）
  const EXEMPT = new Set([
    'README.md', 'README.en.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'docs/COMMUNITY.md',
    'docs/THANKS.md', 'docs/HANDBOOK.md', 'FDE/README.md', 'SKILL/SKILL.md', 'SKILL/AGENTS.md', 'tools/README.md',
  ]);
  const sysOf = (title) => {
    if (/^[一二三四五六七八九十]+、/.test(title)) return 'cjk';
    if (/^第[一二三四五六七八九十百零\d]+[章篇]/.test(title)) return 'chapter';
    if (/^\d+[\.、]/.test(title)) return 'num';
    return null; // 无编号（尾部小节：现在在哪/依赖/待明确事项…属合法）
  };
  const mixed = [];
  const globalSystems = new Set();
  for (const f of ACTIVE_DOCS) {
    if (EXEMPT.has(f)) continue;
    const { all } = docLines(f);
    const systems = new Set();
    for (const l of all) {
      const m = l.match(/^##\s+(.*)$/);
      if (!m) continue;
      const s = sysOf(stripCode(m[1]).trim());
      if (s) systems.add(s);
    }
    if (systems.size > 1) mixed.push(`${f} 混用 ${[...systems].join('+')}`);
    if (systems.size >= 1) systems.forEach((s) => globalSystems.add(s));
  }
  const cross = globalSystems.size > 1 ? `章节型文档体系不一致：${[...globalSystems].join(' vs ')}` : '';
  const bad = [mixed.join(' / '), cross].filter(Boolean);
  return { pass: bad.length === 0, detail: bad.length === 0 ? `H2 编号体系同类文档内一致（${[...globalSystems].join(',') || '无章节型'}）` : bad.join('；') };
}
function d3_3() {
  const slug = (s) => s.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-');
  const bad = [];
  for (const f of ACTIVE_DOCS) {
    const { all } = docLines(f);
    const seen = new Set();
    for (const l of all) {
      const m = l.match(/^#{1,6}\s+(.*)$/);
      if (!m) continue;
      const s = slug(m[1]);
      if (seen.has(s)) bad.push(`${f}：${m[1].slice(0, 24)}`);
      seen.add(s);
    }
  }
  return { pass: bad.length === 0, detail: bad.length === 0 ? '无同文件同名标题' : `同名标题 ${bad.length} 处：${bad.slice(0, 3).join(' / ')}` };
}
function d3_4() {
  const bad = [];
  for (const f of ACTIVE_DOCS) {
    const { body } = docLines(f);
    let inF = false;
    const h3 = [];
    let cur = null;
    for (const { line } of body) {
      if (isFence(line)) { inF = !inF; continue; }
      if (inF) continue;
      if (isHeading(line)) {
        if (cur) h3.push(cur);
        cur = /^###\s/.test(line) ? { n: 0 } : null; // 非 H3 标题结束上一节且自身不计
        continue;
      }
      if (cur && line.trim()) cur.n++;
    }
    if (cur) h3.push(cur);
    if (h3.length < 3) continue;
    const frag = h3.filter((x) => x.n < 4).length;
    const rate = frag / h3.length;
    if (rate > 0.4) bad.push(`${f} ${frag}/${h3.length}=${Math.round(rate * 100)}%`);
  }
  return { pass: bad.length === 0, detail: bad.length === 0 ? 'H3 碎片率全部 ≤40%' : `H3 碎片率超限：${bad.join(' / ')}` };
}
function d3_5() {
  const bad = [];
  for (const f of ACTIVE_DOCS) {
    const { all } = docLines(f);
    for (const l of all) {
      const m = l.match(/^#{2,3}\s+(.*)$/);
      if (m && cps(m[1].trim()) > 60) bad.push(`${f}：${cps(m[1].trim())} 码点`);
    }
  }
  return { pass: bad.length === 0, detail: bad.length === 0 ? 'H2/H3 均 ≤60 码点' : `超长标题 ${bad.length} 处：${bad.slice(0, 3).join(' / ')}` };
}

// ============================================================
// D4 排版（4 项 · 全机械 · 扫描面 = ACTIVE_DOCS）
// ============================================================
const isSep = (s) => /^[\s|:-]+$/.test(s) && (s.match(/-/g) || []).length >= 2;
function sepCells(line) {
  const t = line.trim();
  const parts = t.split(/(?<!\\)\|/);
  if (parts.length && parts[0].trim() === '') parts.shift();
  if (parts.length && parts[parts.length - 1].trim() === '') parts.pop();
  return parts;
}
function d4_1() {
  // 全局（活文档面）：同一列数下分隔行写法唯一
  const byCols = new Map();
  for (const f of ACTIVE_DOCS) {
    for (const l of readText(f).split('\n')) {
      if (isFence(l)) continue;
      if (l.includes('|') && isSep(l)) {
        const cols = sepCells(l).length;
        const form = l.trim().replace(/\s+/g, ' ');
        if (!byCols.has(cols)) byCols.set(cols, new Map());
        byCols.get(cols).set(form, (byCols.get(cols).get(form) || 0) + 1);
      }
    }
  }
  const bad = [];
  for (const [cols, forms] of [...byCols].sort((a, b) => a[0] - b[0])) {
    if (forms.size > 1) bad.push(`${cols} 列 ${forms.size} 种写法`);
  }
  return { pass: bad.length === 0, detail: bad.length === 0 ? '各列数下分隔行写法唯一' : `分隔行写法不唯一：${bad.join(' / ')}` };
}
function d4_2() {
  // 「正文 → --- → 标题」切页横线。结构位横线（标题后 / 目录后 / 表格·引用·列表后的章节分隔 / 文末）不算。
  const isPlainBody = (s) => {
    const t = s.trim();
    if (!t) return false;
    return !isHeading(t) && !t.startsWith('|') && !t.startsWith('>') && !/^\s*[-*+]\s/.test(s) &&
      !/^\s*\d+[\.)]\s/.test(s) && !/^-{3,}\s*$/.test(t) && !t.startsWith('<') &&
      !t.startsWith('```') && !t.startsWith('~~~') && !t.startsWith('![') && !t.startsWith('[![');
  };
  const bad = [];
  for (const f of ACTIVE_DOCS) {
    const L = readText(f).split('\n');
    let inF = false;
    for (let i = 0; i < L.length; i++) {
      if (isFence(L[i])) { inF = !inF; continue; }
      if (inF) continue;
      if (!/^-{3,}\s*$/.test(L[i])) continue;
      let p = i - 1;
      while (p >= 0 && !L[p].trim()) p--;
      let q = i + 1;
      while (q < L.length && !L[q].trim()) q++;
      if (p >= 0 && isPlainBody(L[p]) && q < L.length && isHeading(L[q])) bad.push(`${f}:${i + 1}`);
    }
  }
  return { pass: bad.length === 0, detail: bad.length === 0 ? '无切页横线（正文→---→标题 0 处）' : `切页横线 ${bad.length} 处：${bad.slice(0, 3).join(' / ')}` };
}
function d4_3() {
  const bad = [];
  for (const f of ACTIVE_DOCS) {
    const L = readText(f).split('\n');
    let inF = false;
    for (let i = 0; i < L.length; i++) {
      const m = L[i].match(/^\s*(?:>\s*)*(```|~~~)(.*)$/);
      if (!m) continue;
      if (!inF) {
        // 开围栏：信息串（语言）必须非空
        if (m[2].trim() === '') bad.push(`${f}:${i + 1}`);
        inF = true;
      } else {
        inF = false; // 闭围栏（允许 ``` 后无内容）
      }
    }
  }
  return { pass: bad.length === 0, detail: bad.length === 0 ? '代码围栏全部标语言' : `裸围栏 ${bad.length} 处：${bad.slice(0, 3).join(' / ')}` };
}
function d4_4() {
  // 空表（仅表头+分隔线、零数据行）。「≥6 列宽表是否有说明」为**人工确认**附注（见下 humanAdjunct）
  const bad = [];
  for (const f of ACTIVE_DOCS) {
    const L = readText(f).split('\n');
    let inF = false;
    for (let i = 0; i < L.length - 1; i++) {
      if (isFence(L[i])) { inF = !inF; continue; }
      if (inF) continue;
      if (L[i].includes('|') && isSep(L[i + 1])) {
        const nxt = L[i + 2];
        if (!nxt || !nxt.includes('|') || isFence(nxt)) bad.push(`${f}:${i + 1}`);
      }
    }
  }
  return { pass: bad.length === 0, detail: bad.length === 0 ? '无空表' : `空表 ${bad.length} 处：${bad.slice(0, 3).join(' / ')}` };
}

// ============================================================
// D5 可读（5 项 · 4 机械 + 1 人工 · 扫描面 = ACTIVE_DOCS）
// ============================================================
function d5_3() {
  // 无 ≥6 行连续纯正文大段（围栏内不计；frontmatter / 徽章 / 结构行不算「正文」）
  const isBody = (l) => {
    const t = l.trim();
    if (t === '') return false;
    if (isHeading(l)) return false;
    if (/^\s*[-*+]\s/.test(l)) return false;
    if (/^\s*\d+[\.)]\s/.test(l)) return false;
    if (t.startsWith('|') || t.startsWith('>')) return false;
    if (/^-{3,}$/.test(t)) return false;
    if (t.startsWith('<')) return false;
    if (/^\[!?\[/.test(t) || /^!\[/.test(t)) return false; // 徽章/图片行
    if (t.startsWith('```') || t.startsWith('~~~')) return false;
    return true;
  };
  const bad = [];
  for (const f of ACTIVE_DOCS) {
    const { body } = docLines(f);
    let inF = false;
    let runStart = 0;
    let run = 0;
    const flush = () => { if (run >= 6) bad.push(`${f}:${runStart}（${run} 行）`); run = 0; };
    body.forEach(({ line, no }) => {
      if (isFence(line)) { inF = !inF; flush(); return; }
      if (inF) { flush(); return; }
      if (isBody(line)) { if (run === 0) runStart = no; run++; } else flush();
    });
    flush();
  }
  return { pass: bad.length === 0, detail: bad.length === 0 ? '无 ≥6 行连续纯正文大段' : `正文大段 ${bad.length} 处：${bad.slice(0, 3).join(' / ')}` };
}
function d5_4() {
  // 无加粗过载行（单行 `**` 超过 3 对 = 6 个标记）
  const bad = [];
  for (const f of ACTIVE_DOCS) {
    const { body } = docLines(f);
    let inF = false;
    for (const { line, no } of body) {
      if (isFence(line)) { inF = !inF; continue; }
      if (inF) continue;
      const occ = (line.match(/\*\*/g) || []).length;
      if (occ > 6) bad.push(`${f}:${no}（${occ / 2} 对）`);
    }
  }
  return { pass: bad.length === 0, detail: bad.length === 0 ? '无加粗过载行' : `加粗过载 ${bad.length} 处：${bad.slice(0, 3).join(' / ')}` };
}

// ============================================================
// D6 淘汰（4 项 · 2 机械 + 2 人工）
// ============================================================
// —— 禁考古判据（四类）在**盲区面**上的机械实现 ——
// check-archaeology.sh 的扫描面 = docs/ + FDE/ + SKILL/ + playbook/。它**不含**
// engine/**、FORGE/** 与仓根 README/SECURITY/CONTRIBUTING——本评分器按同一套四类判据
// （版本号出身 / 日期 / 跑批编号 / 出身标签）对这三个面补扫，命中即不通过。
// 豁免口径（与 check-archaeology 同源，缺一即整面假红）：
//   · E1 台账/档案路径豁免——自述为「内部状态记录 / 台账 / append-only / 历史归档」的文件
//     （如 FORGE/LEDGER.md：其 run-N + 日期就是台账正文，同 CHANGELOG 待遇）。
//   · E2 能力版本门槛（`vX.Y.Z+` / `vX.Y.Z 起` / `低于 vX.Y.Z` / `达到 vX.Y.Z`）。
//   · E3 文件头版本标识（前 5 行 H1 / 头部版本状态 blockquote）。
//   · E5 机器注释（`<!-- …`）。
//   · E6 机器字面量（引号 / 命令替换 / `|| echo vX.Y.Z` 内的版本号——逐处摘除）。
//   · E7 产品/代码文档台账形态（版本沿革 / 证据日期 / 第三方生态版本——决策动词邻近者仍判）。
const RE_VERSION = /v\d+\.\d+\.\d+/g;
const RE_DATE = /\d{4}-\d{2}-\d{2}|\d{4}年\d{1,2}月\d{1,2}日/g;
const RE_RUN = /run-\d+|第\d+轮|Round[ \t]+\d+/g;
const RE_TAG_REF = /[（(][^）)]{0,60}?(?:v\d+\.\d+\.\d+|run-\d+|第\d+轮|[A-Z]{1,3}-\d+|\d{4}-\d{2}-\d{2})[^）)]{0,25}?(?:新增|实录|已机制化|定谳|拍板|固化|实锤|吸收|教训|实证)[）)]/g;
const RE_TAG_STD = /[（(【](?:已机制化|实录|固化)[）)】]/g;
const RE_THRESHOLD = /(?:低于|达到)[ \t]*`?v\d+\.\d+\.\d+`?|`?v\d+\.\d+\.\d+`?(?:\+|`?[ \t]*(?:起|以后|及以上))/g;
const RE_E7_DECISION = /拍板|定谳|明确|收编|定型|核正|核实|决定|勘误|补充/;

function countMatches(s, re) {
  re.lastIndex = 0;
  let n = 0;
  while (re.exec(s)) n++;
  return n;
}
/** E2 门槛 + E3 头标识 + E5 注释 + E6 机器字面量 摘除 */
function stripExempt(line, ln, isHead) {
  let w = line;
  if (/^\s*<!--/.test(line)) return null; // E5 整行豁免
  w = w.replace(RE_THRESHOLD, ''); // E2
  if (isHead) w = w.replace(RE_VERSION, 'X.Y.Z'); // E3
  // E6：命令里的版本号逐处摘除
  w = w.replace(/(\|\|[ \t]*echo[ \t]+)v\d+\.\d+\.\d+/g, '$1X.Y.Z');
  w = w.replace(/"[^"\n]*?v\d+\.\d+\.\d+[^"\n]*?"/g, (m) => m.replace(RE_VERSION, 'X.Y.Z'));
  w = w.replace(/\$\([^)\n]*?v\d+\.\d+\.\d+[^)\n]*?\)/g, (m) => m.replace(RE_VERSION, 'X.Y.Z'));
  if (/^[ \t]*(?:grep|echo|test|\[|git[ \t]+describe|awk|sed|node[ \t]+-e)[ \t]|\|[ \t]*(?:grep|echo|awk|sed|node|head|tail|sort)/.test(line)) {
    w = w.replace(/'[^'\n]*?v\d+\.\d+\.\d+[^'\n]*?'/g, (m) => m.replace(RE_VERSION, 'X.Y.Z'));
  }
  return w;
}
/** E7：产品/代码文档台账形态——token 前后 22 字内无决策动词才摘除 */
function stripE7(w) {
  const RE_TOKEN = /v\d+\.\d+\.\d+|\d{4}-\d{2}-\d{2}|\d{4}年\d{1,2}月\d{1,2}日/g;
  let out = '';
  let last = 0;
  let m;
  RE_TOKEN.lastIndex = 0;
  while ((m = RE_TOKEN.exec(w))) {
    const start = m.index;
    const pre = w.slice(Math.max(0, start - 22), start);
    const post = w.slice(start + m[0].length, start + m[0].length + 22);
    out += w.slice(last, start);
    out += RE_E7_DECISION.test(pre) || RE_E7_DECISION.test(post) ? m[0] : 'X.Y.Z';
    last = start + m[0].length;
  }
  out += w.slice(last);
  return out;
}
/** 自述台账/档案 → E1 路径豁免 */
function selfDeclaredLedger(f) {
  const head = readText(f).split('\n').slice(0, 15).join('\n');
  return /内部工具文件|内部状态记录|append-only|历史归档|历史档案|台账|存档|永久索引/.test(head);
}
function archBlindScan() {
  const rootFiles = new Set(['README.md', 'README.en.md', 'SECURITY.md', 'CONTRIBUTING.md']);
  const files = LIVE_MD.filter((f) => /^engine\/.*\.md$/.test(f) || /^FORGE\/.*\.md$/.test(f) || rootFiles.has(f));
  const hits = [];
  const byKind = { V: 0, D: 0, R: 0, T: 0 };
  for (const f of files) {
    if (selfDeclaredLedger(f)) continue; // E1 台账/档案豁免
    const L = readText(f).split('\n');
    L.forEach((line, i) => {
      const ln = i + 1;
      const isHead = ln <= 5 && (/^# /.test(line) || /^>[ \t]*(?:版本[：:][ \t]*)?v\d/.test(line));
      let w = stripExempt(line, ln, isHead);
      if (w === null) return;
      w = stripE7(w);
      const v = countMatches(w, RE_VERSION);
      const d = countMatches(w, RE_DATE);
      const r = countMatches(w, RE_RUN);
      const t = countMatches(w, RE_TAG_REF) + countMatches(w, RE_TAG_STD);
      if (v || d || r || t) {
        byKind.V += v; byKind.D += d; byKind.R += r; byKind.T += t;
        hits.push(`${f}:${ln}${v ? ' V' : ''}${d ? ' D' : ''}${r ? ' R' : ''}${t ? ' T' : ''}`);
      }
    });
  }
  return { files: files.length, hits, total: byKind.V + byKind.D + byKind.R + byKind.T, byKind };
}
function d6_1() {
  const r = run('bash', ['tools/check/check-archaeology.sh']);
  const blind = archBlindScan();
  const okGate = r.rc === 0;
  const okBlind = blind.total === 0;
  const blindMsg = okBlind
    ? `盲区面（engine/FORGE/根 README·SECURITY·CONTRIBUTING，${blind.files} 文件）0 命中`
    : `盲区面命中 ${blind.total} 处（V${blind.byKind.V}/D${blind.byKind.D}/R${blind.byKind.R}/T${blind.byKind.T}）：${blind.hits.slice(0, 3).join(' / ')}`;
  return {
    pass: okGate && okBlind,
    detail: `${okGate ? 'check-archaeology 绿' : `check-archaeology rc=${r.rc}`}；${blindMsg}`,
  };
}
function d6_3() {
  // 无残句（段首截头）/ 括号不配对（块级配对，排除半开区间）/ 孤立表格分隔行
  const bad = [];
  // 段首截头：行首为收尾标点
  for (const f of ACTIVE_DOCS) {
    const { body } = docLines(f);
    for (const { line, no } of body) {
      if (/^[。，、；：）】」』]/.test(line.trim())) bad.push(`${f}:${no} 段首截头`);
    }
  }
  // 括号块级配对（连续引用/表格行合并成块后配 （）；半开区间 (0, 0.2] 形态整体排除）
  const apply = (arr) => {
    let o = 0; let c = 0;
    for (const s0 of arr) {
      const s = s0.replace(/`[^`]*`/g, '').replace(/\([^)]*\]/g, ''); // 去代码壳 + 半开区间
      o += (s.match(/（/g) || []).length;
      c += (s.match(/）/g) || []).length;
    }
    return o - c;
  };
  for (const f of ACTIVE_DOCS) {
    const L = readText(f).split('\n');
    let block = [];
    let startNo = 0;
    const flush = () => {
      if (block.length && apply(block) !== 0) bad.push(`${f}:${startNo} 括号不配对`);
      block = [];
    };
    L.forEach((l, i) => {
      if (l.trim() === '') { flush(); return; }
      if (block.length === 0) startNo = i + 1;
      block.push(l);
    });
    flush();
  }
  // 孤立表格分隔行 / 表格形状
  const ts = run('node', ['tools/check/check-table-shape.mjs']);
  const tsOk = ts.rc === 0;
  if (!tsOk) bad.push('check-table-shape 有违规（孤立分隔行/超列/孤儿行等）');
  return { pass: bad.length === 0, detail: bad.length === 0 ? '无残句 / 括号配对 / 无孤立分隔行' : bad.slice(0, 3).join(' / ') };
}

// ============================================================
// 人工确认留痕解析（本版 devlog 的「文档质量评分」节）
// ============================================================
function versionKey(f) {
  const m = f.match(/v(\d+)\.(\d+)\.(\d+)\.md$/);
  return m ? [+m[1], +m[2], +m[3]] : null;
}
function cmpVer(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
/**
 * 解析留痕：取**最新**一份含「文档质量评分」节的版本 devlog。
 * 节体里逐项写 `| D2-1 | 精简 | 通过/不通过 | 依据 |` 或 `- D2-1 通过：依据`。
 * 返回 Map<itemId, 'pass'|'fail'|'unknown'>（未列出即 unknown，按不通过计）。
 */
function readAttestations() {
  const devlogs = LIVE_MD.filter((f) => /^docs\/changelog\/v\d+\.\d+\/v\d+\.\d+\.\d+\.md$/.test(f))
    .map((f) => ({ f, v: versionKey(f) }))
    .filter((x) => x.v)
    .sort((a, b) => cmpVer(b.v, a.v));
  for (const { f } of devlogs) {
    const L = readText(f).split('\n');
    const idx = L.findIndex((l) => /^#{2,4}\s*文档质量评分/.test(l));
    if (idx < 0) continue;
    const level = L[idx].match(/^#+/)[0].length;
    const section = [];
    for (let i = idx + 1; i < L.length; i++) {
      const h = L[i].match(/^(#+)\s/);
      if (h && h[1].length <= level) break;
      section.push(L[i]);
    }
    const map = new Map();
    for (const line of section) {
      const id = line.match(/\b(D[1-6]-\d)\b/);
      if (!id) continue;
      let verdict = null;
      if (/不通过|未通过|✗|❌|不合格/.test(line)) verdict = 'fail';
      else if (/通过|合格|✅|✓/.test(line)) verdict = 'pass';
      if (verdict) map.set(id[1], verdict);
    }
    return { file: f, map };
  }
  return { file: null, map: new Map() };
}

// ============================================================
// 维度 / 项 定义
// ============================================================
const DIMENSIONS = [
  {
    id: 'D1', name: '准确', items: [
      { id: 'D1-1', name: '全仓读数与 SSOT 一致', kind: 'mech', src: 'check-test-count.sh', fn: d1_1 },
      { id: 'D1-2', name: '无失效相对引用', kind: 'mech', src: 'check-docs.sh §1b', fn: d1_2 },
      { id: 'D1-3', name: '无被推翻的「未实现/未接线」断言', kind: 'mech', src: 'check-claims.mjs', fn: d1_3 },
      { id: 'D1-4', name: '无指向不明的版本号', kind: 'mech', src: '机械（全仓面）', fn: d1_4 },
      { id: 'D1-5', name: '双语 README 关键数字集合一致', kind: 'mech', src: 'check-readme-parity.sh', fn: d1_5 },
    ],
  },
  {
    id: 'D2', name: '精简', items: [
      { id: 'D2-1', name: '无非强制的完整副本（排除门禁强制的交叉校验副本）', kind: 'human' },
      { id: 'D2-2', name: '无叙事重复（同一事实 ≥3 处不同措辞）', kind: 'human' },
      { id: 'D2-3', name: '各文档字数 ≤ 基线', kind: 'mech', src: 'doc-discipline.sh Face 6', face: '[Face 6]' },
      { id: 'D2-4', name: '无同文档两表讲同一批对象', kind: 'human' },
    ],
  },
  {
    id: 'D3', name: '结构', items: [
      { id: 'D3-1', name: '>200 行活文档均有「## 目录」', kind: 'mech', src: '机械（ACTIVE_DOCS）', fn: d3_1 },
      { id: 'D3-2', name: 'H2 编号体系同类文档内一致', kind: 'mech', src: '机械（ACTIVE_DOCS）', fn: d3_2 },
      { id: 'D3-3', name: '无同文件同名标题', kind: 'mech', src: '机械（ACTIVE_DOCS）', fn: d3_3 },
      { id: 'D3-4', name: 'H3 碎片率 ≤40%', kind: 'mech', src: '机械（ACTIVE_DOCS）', fn: d3_4 },
      { id: 'D3-5', name: '标题 ≤60 码点（H2/H3）', kind: 'mech', src: '机械（ACTIVE_DOCS）', fn: d3_5 },
    ],
  },
  {
    id: 'D4', name: '排版', items: [
      { id: 'D4-1', name: '表格分隔行各列数下唯一写法', kind: 'mech', src: '机械（ACTIVE_DOCS）', fn: d4_1 },
      { id: 'D4-2', name: '无「正文 → --- → 标题」切页横线', kind: 'mech', src: '机械（ACTIVE_DOCS）', fn: d4_2 },
      { id: 'D4-3', name: '代码围栏全部标语言', kind: 'mech', src: '机械（ACTIVE_DOCS）', fn: d4_3 },
      { id: 'D4-4', name: '无空表（≥6 列宽表说明见人工确认）', kind: 'mech', src: '机械（ACTIVE_DOCS）', fn: d4_4 },
    ],
  },
  {
    id: 'D5', name: '可读', items: [
      { id: 'D5-1', name: '抬头块 ≤600 字', kind: 'mech', src: 'doc-discipline.sh Face 7', face: '[Face 7]' },
      { id: 'D5-2', name: '无 >300 墙式行且 wall ≤ 基线', kind: 'mech', src: 'doc-discipline.sh Face 5', face: '[Face 5]' },
      { id: 'D5-3', name: '无 ≥6 行连续纯正文大段', kind: 'mech', src: '机械（ACTIVE_DOCS）', fn: d5_3 },
      { id: 'D5-4', name: '无加粗过载行（单行 ** >3 对）', kind: 'mech', src: '机械（ACTIVE_DOCS）', fn: d5_4 },
      { id: 'D5-5', name: '首屏 3 行内可读到「这是什么」', kind: 'human' },
    ],
  },
  {
    id: 'D6', name: '淘汰', items: [
      { id: 'D6-1', name: '无出身考古标签（含盲区面补扫）', kind: 'mech', src: 'check-archaeology.sh + 盲区面', fn: d6_1 },
      { id: 'D6-2', name: '无排期内容混入交付叙事', kind: 'human' },
      { id: 'D6-3', name: '无残句 / 括号不配对 / 孤立分隔行', kind: 'mech', src: '机械 + check-table-shape.mjs', fn: d6_3 },
      { id: 'D6-4', name: '无指向已发版版本的失效排期指针', kind: 'human' },
    ],
  },
];

// ============================================================
// 评分
// ============================================================
function score() {
  // 复用一次 doc-discipline 输出（供 D2-3 / D5-1 / D5-2 三个 face 项）
  const dd = run('bash', ['tools/check/doc-discipline.sh']);
  const facePass = (tag) => {
    const seg = faceSection(dd.out, tag);
    if (seg === null) return { pass: false, detail: `${tag} 段提取失败（检查器失明）` };
    const ok = /✓/.test(seg) && !/❌/.test(seg);
    const line = seg.split('\n').find((l) => /✓|❌/.test(l)) || '';
    return { pass: ok, detail: line.replace(/^\s*/, '').slice(0, 110) };
  };
  const att = readAttestations();

  const results = [];
  for (const dim of DIMENSIONS) {
    const items = [];
    for (const it of dim.items) {
      let r;
      if (it.kind === 'human') {
        const v = att.map.get(it.id) || 'unknown';
        if (v === 'pass') r = { pass: true, detail: `人工确认：通过（留痕 ${att.file}）` };
        else if (v === 'fail') r = { pass: false, detail: `人工确认：不通过（留痕 ${att.file}）` };
        else r = { pass: false, pending: true, detail: att.file ? `待人工确认（留痕未列出 ${it.id}，按不通过计）` : '待人工确认（无「文档质量评分」留痕，按不通过计）' };
      } else if (it.face) {
        r = facePass(it.face);
      } else {
        r = it.fn();
      }
      items.push({ ...it, ...r });
    }
    const passed = items.filter((x) => x.pass).length;
    const scoreVal = Math.round((passed / items.length) * 100) / 10;
    results.push({ id: dim.id, name: dim.name, passed, total: items.length, score: scoreVal, items });
  }
  return { results, attestationFile: att.file, docDisciplineRc: dd.rc };
}

// ============================================================
// 主流程
// ============================================================
function grade(s) {
  return `${s.toFixed(1)}/10`;
}
function statusOf(scoreVal, baseline) {
  const belowFloor = scoreVal < FLOOR;
  const belowBase = baseline !== undefined && scoreVal < baseline;
  if (belowFloor && belowBase) return { tag: '✗', why: `<8 且 <基线(${baseline})` };
  if (belowFloor) return { tag: '✗', why: '<8（绝对下限）' };
  if (belowBase) return { tag: '✗', why: `<基线(${baseline})` };
  return { tag: '✓', why: '' };
}

const args = process.argv.slice(2);
const { results, attestationFile, docDisciplineRc } = score();
const totalScore = Math.round((results.reduce((a, r) => a + r.score, 0) / results.length) * 10) / 10;

let baseline = null;
if (fs.existsSync(path.join(ROOT, BASELINE_PATH))) {
  try { baseline = readJson(BASELINE_PATH); } catch { baseline = null; }
}

if (args.includes('--write-baseline')) {
  const dims = {};
  for (const r of results) dims[r.id] = r.score;
  const doc = {
    $schema: '文档质量六维评分基线（tools/check/doc-score.mjs 消费）——只许升不许降；阈值 8 为绝对下限',
    usage: 'node tools/check/doc-score.mjs [--json|--write-baseline]',
    rule: '实测分 < 基线 = 红（回退）；任一维 < 8 = 红（绝对下限）。基线只许上调：清理/补留痕后请改大本台账，让 diff 记录「分上升」。',
    floor: FLOOR,
    counter: 'score = 通过项 / 总项 × 10；机械项机器判，人工项读本版 devlog「文档质量评分」留痕（未确认即按不通过计，fail-closed）',
    date: new Date().toISOString().slice(0, 10),
    dimensions: dims,
  };
  fs.writeFileSync(path.join(ROOT, BASELINE_PATH), JSON.stringify(doc, null, 2) + '\n');
  console.log(`  已写入基线 ${results.length} 维 → ${BASELINE_PATH}`);
  for (const r of results) console.log(`    ${r.id} ${r.name}  ${grade(r.score)}`);
  process.exit(0);
}

if (args.includes('--json')) {
  console.log(JSON.stringify({ total: totalScore, dimensions: results, attestationFile, baseline: baseline?.dimensions ?? null }, null, 2));
  process.exit(0);
}

console.log('=== doc-score · 文档质量六维评分（每版必跑 · 各维 ≥8 才放行）===');
console.log(`  扫描面：核心活文档 ${ACTIVE_DOCS.length} 份（doc-char-ratchet 键） · 非冻结界 ${LIVE_MD.length} 份 .md`);
console.log(`  留痕来源：${attestationFile ? attestationFile : '（未找到「文档质量评分」节——人工项按不通过计）'}`);
console.log('');
console.log('  维度         得分     判定');
console.log('  ─────────────────────────────────────────────');
for (const r of results) {
  const base = baseline?.dimensions?.[r.id];
  const st = statusOf(r.score, base);
  console.log(`  ${r.id} ${r.name}    ${grade(r.score).padStart(7)}   ${st.tag}${st.why ? ' ' + st.why : ''}${base !== undefined ? `（基线 ${base}）` : ''}`);
}
console.log('  ─────────────────────────────────────────────');
console.log(`  总分（六维均值）  ${grade(totalScore)}`);
console.log('');

// 未通过项 + 待人工确认项
const failed = [];
const pendings = [];
for (const r of results) for (const it of r.items) {
  if (it.pending) pendings.push(`${it.id} ${it.name}`);
  else if (!it.pass) failed.push(`${it.id} ${it.name} —— ${it.detail}`);
}
console.log(`未通过项（${failed.length}）：`);
if (failed.length === 0) console.log('  （无）');
for (const x of failed) console.log(`  ✗ ${x}`);
console.log('');
console.log(`待人工确认项（${pendings.length}，未确认即按不通过计）：`);
if (pendings.length === 0) console.log('  （无）');
for (const x of pendings) console.log(`  ⏳ ${x}`);

// 退出码判定
const reds = results.filter((r) => {
  const base = baseline?.dimensions?.[r.id];
  return r.score < FLOOR || (base !== undefined && r.score < base);
});
console.log('');
console.log('════════════════════════════════════════════════════');
if (reds.length > 0) {
  console.log(`✗ 文档质量未达标：${reds.map((r) => `${r.id}=${grade(r.score)}`).join(' · ')}`);
  console.log(`  口径：任一维 <${FLOOR} 或低于基线即不可放行（fail-closed）。`);
  console.log('  处置：① 机械项 → 按 detail 修内容；② 人工项 → 在本版 devlog「文档质量评分」节逐项补留痕后复跑。');
  process.exit(1);
}
console.log(`✓ 六维全部 ≥${FLOOR} 且不低于基线 —— 文档质量评分通过`);
void docDisciplineRc;
process.exit(0);
