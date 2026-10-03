#!/usr/bin/env node
// ============================================================
// check-table-shape.mjs · 表格形态门禁（形状 + 注引用）
// ============================================================
// 门禁目的：把四类「写时无感、读时才见」的表格缺陷变成机械拦截。
//   ① **超列**（单元格数多于表头列数）：GFM 规范下超出的单元格**直接忽略不渲染**
//      ——内容静默消失。实锤：LIMITATIONS Key Limitations 表第 4 行的「边界注」
//      原是第 4 格（表头 3 列）⇒ 诚实披露在 GitHub 页面上不可见、仅源码可读。
//   ② **孤儿行**（含 `|` 的行不归属任何已识别表格）：渲染为裸管道文本。
//      实锤：v1.5.4 devlog 第七章交付表被 🔴 存量承接 blockquote 拦腰截断，其后三行
//      `|` 行失去表头归属 ⇒ 渲染成裸文本。① 的「超列」判据**抓不到它**（断裂行根本
//      不被识别为表格行）——两类是独立缺陷，故本脚本两条断言同权交付。
//   ③ **悬空注标**（`（详→注-N）` 标记在本文件无对应「大于号起头的注标定义」）：被指向的明细
//      从未落盘 ⇒ 读者看到「详注-N」却无处可查。实锤：ROADMAP 一次「表格拆注」治理
//      批产出 36 处标记，实际只落了 3 条注（注-1/注-16/注-27），另 33 处的正文被整套
//      删除——**单元格变短**（躲过可读性棘轮）、**标记是纯文本**（躲过锚点对账）、
//      **被删正文无跨文档归属**（躲过 docs 预算）⇒ 三道门禁全不可见。
//   ④ **断句格**（拆注格切口未落在句读符上）：拆注工具 `lib/split-table-cells.mjs`
//      的契约是「截到第一个句号（保留）」，而它在 10<n<200 的窗口里找不到 `。` 时
//      **硬切 80 字符**（`t.slice(0, 80)`）⇒ 格尾留下半截词（实锤：`git-diff 24` /
//      `2026-0` / `enterp` / 未闭合的 `（`）。③ 的判据抓不到它——标记本身有定义，
//      坏的是切口位置。
//
// 🔴 为什么必须机械拦截：这四类缺陷既躲过行数预算（check-docs）、也躲过锚点对账
//   （check-anchors）——它吃掉的是**内容本身**（尤其诚实披露与安全边界注）。
//
// ── 口径（四项，跨人核对必读）────────────────────────────────
//   ① 表格识别：一行**含** `|` 且其**下一行**是分隔线（`^[\s|:-]+$` 且含 ≥2 个 `-`）
//      ⇒ 判为表头；表头之后**连续**（中间无空行/无其他行）的含 `|` 行为数据行。
//   ② 注释/围栏：``` 或 ~~~ 围栏内的行**一律跳过**（代码块里的 `|` 不是表格）；
//      行首为 `>`（引用块）的行不参与表格归属——**这正是孤儿行缺陷的成因**，故不豁免。
//   ③ 单元格数：行内**未转义**的 `|` 切段数 − 首尾空段（`\|` 转义管道不计、不切段）。
//   ④ 扫描面与形态边界：`git ls-files '*.md'`（tracked 才查，与 check-docs §22 同惯例）；
//      **孤儿行判定只收「首字符为 `|`」的行**——正文里出现的裸管道（如 `A | B` 叙述、
//      行内代码里的管道）不判。理由：只有首列带 `|` 的形态才真的会被渲染器尝试成表格行，
//      收宽了只会制造假红（判据边界已在此显式声明，改口径须同批改本注）。
//   ⑤ 表头形态边界：**不覆盖省略首尾管道的表格**（`a | b` / `--|--` 写法）——仓内无此形态，
//      收进来只扩大假红面。命中为空即视为「扫描面内无违规」（不做「零命中=守卫空转」推断，
//      因为本门禁的正确稳态就是零命中；空转由下方 SELF-TEST 计数兜底）。
//   ⑥ 注标形态（③）：标记 = `（详→注-N）` / `（详注-N）`（箭头可省，兼容拆注工具的产出
//      形态）；定义 = 行首 `>` + `注-N：` / `注-N（续）：`（冒号全半角均可）。**同文件内**
//      配对——跨文件引用不判（拆注产物天然同文件）。
//   ⑦ 断句格判据（④）：只判「标记收在**表格格尾**」的拆注形态（标记后到格尾只剩空白），
//      取格内标记前的文本 → 剥掉收尾的加粗/反引号/空白 → **末字符须属句读符 ∪ 收尾符**
//      `。！？…；：）」』】》])`。不在句读符上即判红——这是工具契约的直接反向断言，
//      不依赖对工具实现的转述。**已知不覆盖**：① 「注在、标记丢」的反向孤儿注（未观察到
//      实锤，且注释性注行本身合法，收进来只扩大假红面）② 标记收在格中（非格尾）时不判切口。
//
// 退出码：0 = 通过；1 = 有违规（四类之一）；2 = 用法误用
// ============================================================

import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';

const files = execFileSync('git', ['ls-files', '*.md'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

/** 围栏行判定（``` 或 ~~~） */
const isFence = (s) => /^\s*(```|~~~)/.test(s);
/** 分隔线判定：仅由空格/|/:/ - 组成，且含 ≥2 个连字符 */
const isSep = (s) => /^[\s|:-]+$/.test(s) && (s.match(/-/g) || []).length >= 2;
/** 单元格切分：未转义 `|` 切段 → 去首尾空段 */
function cells(line) {
  const t = line.trim();
  const parts = t.split(/(?<!\\)\|/);
  // 首/尾段来自行首行尾的管道，是空段（若行不以 | 开头/结尾则首/尾段非空、保留）
  if (parts.length && parts[0].trim() === '') parts.shift();
  if (parts.length && parts[parts.length - 1].trim() === '') parts.pop();
  return parts.length;
}

const violations = [];
let tablesSeen = 0;
/**
 * 行签名（用于基线匹配）
 *   ① **不用行号**：行号随任何编辑漂移，漂移即静默放行；
 *   ② **存哈希不存原文**：表格单元格常含正则/安全词汇（如仓内注入检测表本身），
 *      落原文会（a）触发 A9 注入检测自指告警、（b）把敏感词复制进新文件。
 *      哈希 = 归一化（trim + 折叠空白）后 sha256 前 16 位；文件+kind 已足以定位。
 */
const sig = (s) => createHash('sha256').update(s.trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 16);

// ── 存量基线（只拦新增）────────────────────────────────────────
// 与 check-silent-catch.mjs 同款纪律：存量缺陷逐条登记（含理由）后豁免，只拦**新增**。
// 登记纪律（宁缺毋滥）：只有「已存在、且本轮不修」的条目才进基线——凡「该修且能修」的
// 一律不进基线，那是真实待清项。
const BASELINE_PATH = 'tools/check/table-shape-baseline.json';
let baseline = [];
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).entries ?? [];
} catch {
  baseline = [];
}
const baselineKeys = new Set(baseline.map((e) => `${e.file} ~ ${e.kind} ~ ${e.signature}`));

for (const file of files) {
  let src;
  try {
    src = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const lines = src.split('\n');
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isFence(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const next = lines[i + 1] ?? '';
    const isHeader = line.includes('|') && !isFence(next) && isSep(next);

    if (isHeader) {
      tablesSeen++;
      const headerCells = cells(line);
      let j = i + 2;
      // 连续数据行（含 `|`；空行/其他行即终止本表）
      while (j < lines.length && lines[j].includes('|') && !isFence(lines[j])) {
        const c = cells(lines[j]);
        if (c > headerCells) {
          violations.push({
            file, line: j + 1, kind: '超列', signature: sig(lines[j]),
            detail: `单元格 ${c} > 表头 ${headerCells}（超出的单元格 GFM 不渲染——内容静默消失）`,
            excerpt: lines[j].trim().slice(0, 90),
          });
        }
        j++;
      }
      i = j - 1; // 跳过已消费的数据行
      continue;
    }

    // 孤儿行：首字符为 `|` 但不是任何已识别表格的表头/分隔线/数据行
    if (line.trimStart().startsWith('|') && !isSep(line)) {
      violations.push({
        file, line: i + 1, kind: '孤儿行', signature: sig(line),
        detail: '含 `|` 但上方无「表头 + 分隔线」归属（被空行/引用块等切断）——渲染为裸管道文本',
        excerpt: line.trim().slice(0, 90),
      });
    }
  }
}

// ── 注引用面（③ 悬空注标 · ④ 断句格）────────────────────────────
// 与上方形状面共用扫描面与 `sig()` 基线登记纪律，但**判据独立**——同一行可同时命中两面
// （签名相同、kind 不同，故基线键不冲突）。
const MARKER_RE = /（详→?注-(\d+)）/g;
/** 注定义行：行首引用块 + `注-N：` / `注-N（续）：`（冒号全半角均可；续行与首行同号）
 *  ⚠️ 分组必须用 **ASCII** 括号 `(（续）)?`——写成 `（续）?` 时 `?` 只绑定到全角 `）`，
 *  `（续）` 整段变成**必填**，注释性定义行会**全部漏检**（自检负样本实锤）。 */
const NOTE_DEF_RE = /^>\s*注-(\d+)(（续）)?\s*[：:]/;
/** 拆注格可接受的收尾字符：句读符 ∪ 收尾符——切口落在这里才说明句子是闭合的 */
const CUT_OK = /[。！？…；：）」』】》\])]/;

/**
 * 扫描单份文本 → `{ found, markers, defs }`
 *   抽成函数是为了让**仓库扫描与 SELF-TEST 走同一份判据实现**（自检才有意义：它验的是
 *   真判据，不是探针另写的一份近似）。
 */
function scanNoteRefs(md) {
  const ls = md.split('\n');
  const found = [];
  const defs = new Set();
  const marks = [];
  let fence = false;
  for (let i = 0; i < ls.length; i++) {
    const line = ls[i];
    if (isFence(line)) { fence = !fence; continue; }
    if (fence) continue;
    const dm = line.match(NOTE_DEF_RE);
    if (dm) defs.add(Number(dm[1]));
    for (const m of line.matchAll(MARKER_RE)) marks.push({ n: Number(m[1]), line: i + 1, text: line });
  }
  // ③ 悬空注标：标记所指的注在本文件不存在
  for (const mk of marks) {
    if (defs.has(mk.n)) continue;
    found.push({
      line: mk.line, kind: '悬空注标', signature: sig(mk.text),
      detail: `指向「注-${mk.n}」但本文件无「> 注-${mk.n}：」定义——被指向的明细从未落盘`,
      excerpt: mk.text.trim().slice(0, 90),
    });
  }
  // ④ 断句格：拆注格切口未落句读符（硬切痕迹）
  fence = false;
  for (let i = 0; i < ls.length; i++) {
    if (isFence(ls[i])) { fence = !fence; continue; }
    if (fence) continue;
    const t = ls[i].trim();
    if (!t.startsWith('|')) continue;
    const segs = t.split(/(?<!\\)\|/);
    const lo = segs[0].trim() === '' ? 1 : 0;
    const hi = segs[segs.length - 1].trim() === '' ? segs.length - 1 : segs.length;
    for (let k = lo; k < hi; k++) {
      const tail = segs[k].match(/（详→?注-\d+）\s*$/);
      if (!tail) continue;
      const pre = segs[k].slice(0, tail.index).replace(/[\s*`]+$/, '');
      if (pre && !CUT_OK.test(pre.slice(-1)))
        found.push({
          line: i + 1, kind: '断句格', signature: sig(ls[i]),
          detail: `拆注格切口落在「${pre.slice(-1)}」——非句读符 ⇒ 硬切痕迹（原句被截断、语义悬空）`,
          excerpt: pre.slice(-70) + tail[0],
        });
    }
  }
  return { found, markers: marks.length, defs: defs.size };
}

let noteMarkers = 0;
let noteDefs = 0;
for (const file of files) {
  let src;
  try {
    src = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const r = scanNoteRefs(src);
  noteMarkers += r.markers;
  noteDefs += r.defs;
  for (const v of r.found) violations.push({ file, ...v });
}

// ── 自检：证明本脚本在四类缺陷上都能红（防「守卫空转」静默失明）──
const SELF_TEST = [
  { name: '超列', md: '| a | b |\n|---|---|\n| 1 | 2 | 3 |\n' },
  { name: '孤儿行', md: '| a | b |\n|---|---|\n| 1 | 2 |\n\n> 打断\n| 3 | 4 |\n' },
  { name: '正常表', md: '| a | b |\n|---|---|\n| 1 | 2 |\n' },
];
function scanText(md) {
  const ls = md.split('\n');
  let fence = false;
  let n = 0;
  for (let i = 0; i < ls.length; i++) {
    if (isFence(ls[i])) { fence = !fence; continue; }
    if (fence) continue;
    const nx = ls[i + 1] ?? '';
    if (ls[i].includes('|') && !isFence(nx) && isSep(nx)) {
      const hc = cells(ls[i]);
      let j = i + 2;
      while (j < ls.length && ls[j].includes('|') && !isFence(ls[j])) {
        if (cells(ls[j]) > hc) n++;
        j++;
      }
      i = j - 1;
      continue;
    }
    if (ls[i].trimStart().startsWith('|') && !isSep(ls[i])) n++;
  }
  return n;
}
const selfTestOk = SELF_TEST.every((t) => (t.name === '正常表' ? scanText(t.md) === 0 : scanText(t.md) > 0));

// 注引用面自检：正样本必须命中、负样本必须零命中（want=null 即负样本）
const NOTE_SELF_TEST = [
  { name: '悬空注标', md: '| a |\n|---|\n| 甲。（详→注-1） |\n', want: '悬空注标' },
  { name: '断句格（括号未闭合）', md: '| a |\n|---|\n| 甲（详→注-1） |\n> 注-1：补全\n', want: '断句格' },
  { name: '断句格（半截词）', md: '| a |\n|---|\n| git-diff 24 （详→注-1） |\n> 注-1：x\n', want: '断句格' },
  { name: '正常注（句读收尾）', md: '| a |\n|---|\n| 甲。（详→注-1） |\n> 注-1：补全\n', want: null },
  { name: '正常注（收尾符 + 加粗）', md: '| a |\n|---|\n| **甲」**（详→注-1） |\n> 注-1：补全\n', want: null },
  { name: '正常注（续行同号）', md: '| a |\n|---|\n| 甲：（详→注-2） |\n> 注-2：① 一\n> 注-2（续）：② 二\n', want: null },
  { name: '围栏内不判', md: '```\n| 甲（详→注-9） |\n```\n', want: null },
];
const noteSelfTestOk = NOTE_SELF_TEST.every((t) => {
  const kinds = scanNoteRefs(t.md).found.map((v) => v.kind);
  return t.want === null ? kinds.length === 0 : kinds.includes(t.want);
});

if (!selfTestOk || !noteSelfTestOk) {
  const bad = [
    ...SELF_TEST.filter((t) => (t.name === '正常表' ? scanText(t.md) !== 0 : scanText(t.md) === 0)).map((t) => `形状面/${t.name}`),
    ...NOTE_SELF_TEST.filter((t) => {
      const kinds = scanNoteRefs(t.md).found.map((v) => v.kind);
      return t.want === null ? kinds.length !== 0 : !kinds.includes(t.want);
    }).map((t) => `注引用面/${t.name}`),
  ];
  console.error(`❌ [check-table-shape] 自检失败——判据在已知缺陷样本上未报错（守卫空转，禁止放行）：${bad.join(' · ')}`);
  process.exit(1);
}

if (process.argv.includes('--update-baseline')) {
  // ⚠️ 优先级陷阱（曾实锤）：`'前缀' + cond ? A : B` 会先拼串再做三元判断 ⇒ 恒真 ⇒ **全表取 A**。
  //   理由分类必须显式加括号，否则「在役文档待清」这一档永远写不出来（台账全体误标冻结区）。
  const isFrozen = (f) =>
    f.startsWith('docs/archive/') ||
    f.startsWith('docs/evidence/') ||
    f.startsWith('playbook/vendor/') ||
    /^docs\/changelog\/v[0-9]/.test(f); // 版本日志冻结；`docs/changelog/releasing*`（SOP 本体）**不冻结**
  const entries = violations.map((v) => ({
    file: v.file, kind: v.kind, signature: v.signature,
    reason: '存量（本批未修）——' + (isFrozen(v.file)
      ? '冻结区历史文档（表结构回改须作者裁定）'
      : '在役文档待清（见复查报告「表格形态存量清单」）'),
  }));
  writeFileSync(BASELINE_PATH, JSON.stringify({
    "$schema": "表格形态存量基线（tools/check/check-table-shape.mjs 消费）——只拦新增；登记项逐条带理由。",
    usage: "node tools/check/check-table-shape.mjs [--update-baseline]",
    note: "签名 = 行内容归一化（trim + 折叠空白）后 sha256 前 16 位（不用行号：行号随编辑漂移、漂移即静默放行）",
    entries,
  }, null, 2) + '\n');
  console.log(`  已写入基线 ${entries.length} 条 → ${BASELINE_PATH}`);
  process.exit(0);
}

const TOTAL_SELF_TEST = SELF_TEST.length + NOTE_SELF_TEST.length;
console.log('=== check-table-shape · 表格形态门禁（形状 + 注引用）===');
console.log(`  扫描面：${files.length} 个 tracked .md · 识别表格 ${tablesSeen} 张 · 注标 ${noteMarkers} 处 / 注定义 ${noteDefs} 条 · 自检 ${TOTAL_SELF_TEST}/${TOTAL_SELF_TEST} 通过`);

const exempted = violations.filter((v) => baselineKeys.has(`${v.file} ~ ${v.kind} ~ ${v.signature}`));
const live = violations.filter((v) => !baselineKeys.has(`${v.file} ~ ${v.kind} ~ ${v.signature}`));

console.log(`  存量基线豁免 ${exempted.length} 处（台账 ${BASELINE_PATH}，登记 ${baseline.length} 条）`);
if (live.length === 0) {
  console.log('  ✓ 无新增违规（超列 0 · 孤儿行 0 · 悬空注标 0 · 断句格 0）');
  process.exit(0);
}

console.log('');
for (const v of live) {
  console.log(`  ✗ [${v.kind}] ${v.file}:${v.line} — ${v.detail}`);
  console.log(`      ${v.excerpt}`);
}
console.log('');
console.log(`✗ 表格形态**新增**违规 ${live.length} 处（${['超列', '孤儿行', '悬空注标', '断句格']
  .map((k) => `${k} ${live.filter((v) => v.kind === k).length}`)
  .join(' / ')}）`);
console.log('  处置：超列 ⇒ 把多余内容并回已有单元格（`<br>` 接续）或补表头列；');
console.log('        孤儿行 ⇒ 补回被切断的表头/分隔线，或把该行改为一句话/独立小节；');
console.log('        悬空注标 ⇒ 补回「大于号起头的注标明细行」（**删标记了事 = 内容丢失**，须先找回原文再决定）；');
console.log('        断句格 ⇒ 把切口挪到句读符上（`。`），或另起一条注承接被截断的语义。');
process.exit(1);
