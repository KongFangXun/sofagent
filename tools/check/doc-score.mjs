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
// 两种模式（判据不同，不可混用）：
//   · 全量模式（默认）：六维 27 项全跑，含全仓外部门禁——**每版一次**，约 6 分钟
//     （实测耗时分布：check-test-count 287s + check-claims 65s 占 96%，文档扫描 <1s）。
//   · 增量模式（--changed）：只跑 12 项**文档形态机械项**，跳过全仓外部门禁与人工项
//     （由 pre-push-check 同链串接 / Face 5·6·7 / fresh-eyes 覆盖），**秒级**。
//     判据 = 变更文档的工作区版本 **对照 HEAD 版本**的命中数差：
//       差值 > 0 → 新增缺陷（阻断）；= 0 → 存量（信息位，不拦）；< 0 → 改善。
//     为什么对照 HEAD 而不是「只看新增行」：本面 12 项全是**整文件属性**
//     （>200 行有无目录 / H3 碎片率 / 括号配对…），无法从新增行单独判定；
//     用「同文件 HEAD 版本」做基线才能真正做到存量不拦。
//
// 用法：
//   node tools/check/doc-score.mjs             # 全量评分（读本版 devlog 留痕）
//   node tools/check/doc-score.mjs --changed   # 增量快检（串 doc-discipline.sh Face 13）
//   node tools/check/doc-score.mjs --self-test # 增量分类四条分支自检（合成命中，不动 git）
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
const readTextRaw = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
// OVERRIDE：增量模式对照 HEAD 版本时注入的内容覆写（只含 .md，不影响 JSON 读取）
let OVERRIDE = null;
const readText = (f) => (OVERRIDE && OVERRIDE.has(f) ? OVERRIDE.get(f) : readTextRaw(f));
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
let ACTIVE_DOCS = Object.keys(charRatchet).filter((k) => k !== '_meta');
// FULL_DOCS = 恒定的全量面（21 份核心活文档）。跨文件聚合项（D3-2 编号体系 / D4-1 分隔行写法）
// **必须**在全量面上判——判据是「与主流写法比较」，收窄到变更文档会失去参照系
// （一份新文档用了异类编号，只扫它自己反而查不出）。逐文件项则用 ACTIVE_DOCS（可被 --changed 收窄）。
const FULL_DOCS = [...ACTIVE_DOCS];

// ── 模式状态 ──────────────────────────────────────────────
// SKIP_EXTERNAL：增量模式置真 —— 跳过全仓外部门禁（占全量 96% 耗时，且 pre-push-check 同链已串接）
let SKIP_EXTERNAL = false;
// 增量模式下**只跑这 12 项文档形态机械项**：纯本地文本扫描，秒级，判据可归属到文件。
// 其余 15 项（全仓门禁项 D1-1/1-2/1-3/1-5、Face 项 D2-3/D5-1/D5-2、D6-1、人工项 ×8）
// 在增量模式下**跳过且不进分母**——已在 pre-push-check 同链覆盖或属人工判断面。
const MECH_INCREMENTAL = new Set(['D3-1', 'D3-2', 'D3-3', 'D3-4', 'D3-5', 'D4-1', 'D4-2', 'D4-3', 'D4-4', 'D5-3', 'D5-4', 'D6-3']);
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
  // 判据 = 退出码 0 且输出含独立 OK 行（--quiet 模式下 OK 之后仍有场景守卫输出行，
  // 原 endsWith('OK') 恒假 → rc=0 也被判未绿。判行不判尾，与 check-claims 同款修法）。
  const ok = r.rc === 0 && /^OK$/m.test(r.out);
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
  return { pass: miss.length === 0, hits: miss, detail: miss.length === 0 ? '>200 行活文档均有「## 目录」' : `缺目录：${miss.join(' / ')}` };
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
  const sysOwner = new Map(); // 文件 → 其 H2 编号体系（供少数派逐文件归属）
  const sysCount = new Map(); // 体系 → 采用该体系的文件数（供取主流）
  for (const f of FULL_DOCS) {
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
    if (systems.size >= 1) {
      // 记「文件 → 体系」：跨文件 minority 判定需要可归属到文件（增量模式按文件比对 HEAD）
      const s = [...systems][0];
      sysOwner.set(f, systems.size > 1 ? `mixed:${[...systems].join('+')}` : s);
      if (systems.size === 1) sysCount.set(s, (sysCount.get(s) || 0) + 1);
    }
  }
  // 少数派体系（文件数少于主流）逐文件列出，而不是抛一条无归属的全局串——
  // 无归属的命中在增量模式下无法与 HEAD 比对，只能降级为信息位（等于该判据被架空）。
  let cross = [];
  if (globalSystems.size > 1) {
    const major = [...sysCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (major) for (const [f, s] of sysOwner) if (s !== major) cross.push(`${f} H2 体系「${s}」异于主流「${major}」`);
  }
  const bad = [...mixed, ...cross];
  return {
    pass: bad.length === 0,
    hits: bad,
    detail: bad.length === 0 ? `H2 编号体系同类文档内一致（${[...globalSystems].join(',') || '无章节型'}）` : bad.slice(0, 3).join(' / ') + (bad.length > 3 ? ` …(${bad.length} 处)` : ''),
  };
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
  return { pass: bad.length === 0, hits: bad, detail: bad.length === 0 ? '无同文件同名标题' : `同名标题 ${bad.length} 处：${bad.slice(0, 3).join(' / ')}` };
}
function d3_4() {
  // 豁免（**条目型体例**文档 · 与 d3_2 的 EXEMPT 同源，但**仅限本项**）。两条豁免的实测碎片率
  //   口径 = 「H3 下全部非空行（**围栏计入**）、遇 H1–H3 标题截断（H4+ 子树计入）」：
  //     · `docs/LIMITATIONS.md` 37/62 = 60%（登记型：一条局限 = 一个 H3 + 图标）
  //     · `docs/DEVELOPMENT.md` 22/51 = 43%（速查/手册型：单主题速查条目）
  //   thin 样例：DEVELOPMENT 的 `行业背景` / `开发铁律` / `Windows 开发踩坑` / `为什么选 DeepSeek` /
  //   `收敛约束`——语义彼此独立的单主题条目；LIMITATIONS 的 thin 全是 `📦`/`💥`/`🐚` 图标前缀的单条登记。
  //   不改成「合并降 H3」的四条理由：
  //     ① 合并须自造语义组名（上述标题无同族）；
  //     ② 合并会破坏锚点（本仓 497 个锚点，每条 thin 都是可被单独引用的题）；
  //     ③ 两者均为条目型体例（把「哪些文档按条目体例呈现」写成可审名单，优于把阈值调到几乎无牙）；
  //     ④ 双向探针（清空本表）实测两文件复现超限 ⇒ 守卫未被架空，豁免只是按体例放行 2 份。
  //   其余 19 份文档仍受 ≤40% 约束；豁免仅逐条登记、必须写明理由。
  const FRAG_EXEMPT = new Map([
    ['docs/LIMITATIONS.md', '登记型：一条局限 = 一个 H3 + 图标（37/62=60%）'],
    ['docs/DEVELOPMENT.md', '速查/手册型：单主题速查条目（22/51=43%）'],
  ]);
  const bad = [];
  for (const f of ACTIVE_DOCS) {
    if (FRAG_EXEMPT.has(f)) continue;
    const { body } = docLines(f);
    const h3 = [];
    let cur = null;
    let inF = false;
    for (const { line } of body) {
      // 计数口径（对齐声明口径）：H3 下**全部非空行**计入正文——**围栏（代码块）内容计入**；
      // 且**只截断于 H1–H3**——H4+ 子树属其父 H3 的内容，不作为截断点。
      // 旧口径（围栏排除 + 任意标题截断）有两处**假阳性**：① 只有一段代码、没有散文的 H3 被判 thin；
      // ② 「H3 带若干 H4 子节」被判 thin。
      // ⚠️ 标题判定**仍须围栏感知**：围栏内的 `### …` 是代码不是标题，不得据此新起 H3。
      if (isFence(line)) { inF = !inF; if (cur && line.trim()) cur.n++; continue; }
      if (inF) { if (cur && line.trim()) cur.n++; continue; }
      if (isHeading(line)) {
        if (/^#{1,3}\s/.test(line)) {
          if (cur) h3.push(cur);
          cur = /^###\s/.test(line) ? { n: 0 } : null; // 非 H3 的 H1/H2 结束上一节且自身不计
          continue;
        }
        // H4+ 标题：不截断，落入下方计为父 H3 的正文
      }
      if (cur && line.trim()) cur.n++;
    }
    if (cur) h3.push(cur);
    if (h3.length < 3) continue;
    const frag = h3.filter((x) => x.n < 4).length;
    const rate = frag / h3.length;
    if (rate > 0.4) bad.push(`${f} ${frag}/${h3.length}=${Math.round(rate * 100)}%`);
  }
  const checked = ACTIVE_DOCS.length - FRAG_EXEMPT.size;
  return {
    pass: bad.length === 0,
    hits: bad,
    detail: bad.length === 0
      ? `H3 碎片率全部 ≤40%（受检 ${checked} 份；豁免 ${FRAG_EXEMPT.size} 份登记/速查型：${[...FRAG_EXEMPT.keys()].join(' / ')}）`
      : `H3 碎片率超限：${bad.join(' / ')}`,
  };
}
function d3_5() {
  const bad = [];
  for (const f of ACTIVE_DOCS) {
    const { all } = docLines(f);
    for (const l of all) {
      const m = l.match(/^#{2,3}\s+(.*)$/);
      if (m && cps(m[1].trim()) > 80) bad.push(`${f}：${cps(m[1].trim())} 码点`);
    }
  }
  return { pass: bad.length === 0, hits: bad, detail: bad.length === 0 ? 'H2/H3 均 ≤80 码点' : `超长标题 ${bad.length} 处：${bad.slice(0, 3).join(' / ')}` };
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
  for (const f of FULL_DOCS) {
    for (const l of readText(f).split('\n')) {
      if (isFence(l)) continue;
      if (l.includes('|') && isSep(l)) {
        const cols = sepCells(l).length;
        const form = l.trim().replace(/\s+/g, ' ');
        if (!byCols.has(cols)) byCols.set(cols, new Map());
        const fm = byCols.get(cols);
        if (!fm.has(form)) fm.set(form, { n: 0, files: [] });
        const rec = fm.get(form);
        rec.n++;
        if (!rec.files.includes(f)) rec.files.push(f);
      }
    }
  }
  // 少数派写法（出现次数少于主流）逐文件列出——理由同 d3_2：无归属命中在增量模式下不可比对。
  const bad = [];
  for (const [cols, forms] of [...byCols].sort((a, b) => a[0] - b[0])) {
    if (forms.size <= 1) continue;
    const major = [...forms.entries()].sort((a, b) => b[1].n - a[1].n)[0];
    for (const [form, rec] of forms) {
      if (form === major[0]) continue;
      for (const f of rec.files) bad.push(`${f} 表格分隔行写法异于主流（${cols} 列 · ${rec.n} 处）`);
    }
  }
  return {
    pass: bad.length === 0,
    hits: bad,
    detail: bad.length === 0 ? '各列数下分隔行写法唯一' : `${bad.length} 处：${bad.slice(0, 3).join(' / ')}`,
  };
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
  return { pass: bad.length === 0, hits: bad, detail: bad.length === 0 ? '无切页横线（正文→---→标题 0 处）' : `切页横线 ${bad.length} 处：${bad.slice(0, 3).join(' / ')}` };
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
  return { pass: bad.length === 0, hits: bad, detail: bad.length === 0 ? '代码围栏全部标语言' : `裸围栏 ${bad.length} 处：${bad.slice(0, 3).join(' / ')}` };
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
  return { pass: bad.length === 0, hits: bad, detail: bad.length === 0 ? '无空表' : `空表 ${bad.length} 处：${bad.slice(0, 3).join(' / ')}` };
}

// ============================================================
// D5 可读（5 项 · 4 机械 + 1 人工 · 扫描面 = ACTIVE_DOCS）
// ============================================================
function d5_3() {
  // 无超长纯正文段落（「段落」= 围栏外、块级相邻的连续正文行；按**字数**（Unicode 码点）判，不按行数）
  // 字数上限取 600（与 D5-1 抬头块 600 字同口径）——纯正文段落超此即判「大段」。
  const THRESHOLD = 600;
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
    let cur = null;
    const flush = () => { if (cur && cur.chars > THRESHOLD) bad.push(`${f}:${cur.start}（${cur.chars} 字）`); cur = null; };
    body.forEach(({ line, no }) => {
      if (isFence(line)) { inF = !inF; flush(); return; }
      if (inF) { flush(); return; }
      if (isBody(line)) { if (!cur) cur = { start: no, chars: 0 }; cur.chars += cps(line.trim()); } else flush();
    });
    flush();
  }
  return { pass: bad.length === 0, hits: bad, detail: bad.length === 0 ? `无 >${THRESHOLD} 字纯正文段落` : `超长正文段落 ${bad.length} 处：${bad.slice(0, 3).join(' / ')}` };
}
function d5_4() {
  // 无加粗过载行（单行 `**` 超过 4 对 = 8 个标记）
  const bad = [];
  for (const f of ACTIVE_DOCS) {
    const { body } = docLines(f);
    let inF = false;
    for (const { line, no } of body) {
      if (isFence(line)) { inF = !inF; continue; }
      if (inF) continue;
      const occ = (line.match(/\*\*/g) || []).length;
      if (occ > 8) bad.push(`${f}:${no}（${occ / 2} 对）`);
    }
  }
  return { pass: bad.length === 0, hits: bad, detail: bad.length === 0 ? '无加粗过载行' : `加粗过载 ${bad.length} 处：${bad.slice(0, 3).join(' / ')}` };
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
const RE_TAG_STD = /(?<!来源\*{0,2}[（(])（实录）|[（(【](?:已机制化|固化)[）)】]/g; // 「来源（实录）/**来源**（实录）」是溯源标注非出身标签，负向断言豁免（容许 ** 间隔）
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
  // E2 前置：来源行标准形态（「来源（实录）/**来源**（实录）」= 溯源类型标注，非出身标签）整段摘除
  w = w.replace(/\*{0,2}来源\*{0,2}[（(]实录[）)]/g, '来源○');
  // E2 补：能力门槛的宽松邻接形态（门禁版 token 与「起」之间隔着标点/空格；「引入版本：」整句是门槛声明）
  w = w.replace(/引入版本[：:][ \t]*v\d+\.\d+\.\d+/g, '引入版本：X.Y.Z');
  w = w.replace(/v\d+\.\d+\.\d+[ \t]*[，,、][ \t]*(?:起|以后|及以上)/g, 'X.Y.Z');
  w = w.replace(/（v\d+\.\d+\.\d+[ \t]*(?:开发前置核实|定稿|交付核查|核实|验证)）/g, '（X.Y.Z）');
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
  if (/内部工具文件|内部状态记录|append-only|历史归档|历史档案|台账|存档|永久索引/.test(head)) return true;
  // 运行日志形态：正文节标题大量呈「## YYYY-MM-DD run-N」（日期/run 号是内容本体，非考古标签）
  const L = readText(f).split('\n');
  const h2 = L.filter((l) => /^## /.test(l));
  return h2.length >= 3 && h2.filter((l) => /^## 20\d\d-\d\d-\d\d/.test(l)).length / h2.length >= 0.6;
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
      // 格式示例豁免：`run-01`（反引号内）或路径/序号语境（run-NN/ 目录、当日序号说明）不属出身考古
      const rEff = w.replace(/`[^`]*`/g, '').replace(/run-\d+\//g, '').replace(/（当日序号）/g, '');
      const rReal = countMatches(rEff, RE_RUN);
      const t = countMatches(w, RE_TAG_REF) + countMatches(w, RE_TAG_STD);
      if (v || d || rReal || t) {
        byKind.V += v; byKind.D += d; byKind.R += rReal; byKind.T += t;
        hits.push(`${f}:${ln}${v ? ' V' : ''}${d ? ' D' : ''}${rReal ? ' R' : ''}${t ? ' T' : ''}`);
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
  // 括号配对（**注单位**口径 · 口径校准）：含 `（详→注-N）` 标记的块，与其后定义该 N 的 `> 注-N：` 注块
  //   **合并为一个单位**再配 `（）`。为什么必须合并：拆注工具 `lib/split-table-cells.mjs` 把长格切成
  //   「格尾标记 + 表格下方注行」，切口落在句读符上 ⇒ 括号必然跨切（格内 `（` / 注行首 `）`）——
  //   按块单独配会把这一对判成两处不配对（实锤：API.md 注-3）。
  // ⚠️ 注定义正则必须用 **ASCII 括号分组** `(（续）)?`：写成 `（续）?` 时 `?` 只绑定全角 `）`，
  //   `（续）` 整段变成**必填**，`> 注-N：` 定义行会全部漏检（与 check-table-shape 同一坑）。
  const MARKER_RE = /（详→?注-(\d+)）/g;
  const NOTE_DEF_RE = /^>\s*注-(\d+)(（续）)?\s*[：:]/;
  const applyUnit = (arr) => {
    let o = 0; let c = 0;
    for (const s0 of arr) {
      const s = s0.replace(/`[^`]*`/g, '').replace(/\([^)]*\]/g, ''); // 去代码壳 + 半开区间 (0, 0.2]
      o += (s.match(/（/g) || []).length;
      c += (s.match(/）/g) || []).length;
    }
    return o - c;
  };
  for (const f of ACTIVE_DOCS) {
    const L = readText(f).split('\n');
    const blocks = [];
    let cur = null;
    L.forEach((l, i) => {
      if (l.trim() === '') { if (cur) { blocks.push(cur); cur = null; } return; }
      if (!cur) cur = { lines: [], start: i + 1 };
      cur.lines.push(l);
    });
    if (cur) blocks.push(cur);
    const owner = new Map(); // 注号 N → 持有该标记的块下标
    const absorbed = new Set(); // 已并入他块的注块（不再单独判）
    blocks.forEach((b, bi) => {
      const defNums = new Set();
      for (const l of b.lines) { const m = l.match(NOTE_DEF_RE); if (m) defNums.add(Number(m[1])); }
      const owned = [...defNums].filter((n) => owner.has(n));
      if (owned.length) {
        const tgt = Math.min(...owned.map((n) => owner.get(n))); // 并入最早持有其标记的块
        blocks[tgt].lines.push(...b.lines);
        absorbed.add(bi);
        return;
      }
      for (const l of b.lines) for (const m of l.matchAll(MARKER_RE)) { const n = Number(m[1]); if (!owner.has(n)) owner.set(n, bi); }
    });
    for (let bi = 0; bi < blocks.length; bi++) {
      if (absorbed.has(bi)) continue;
      if (applyUnit(blocks[bi].lines) !== 0) bad.push(`${f}:${blocks[bi].start} 括号不配对`);
    }
  }
  // 孤立表格分隔行 / 表格形状（全仓门禁——增量模式跳过：pre-push-check 同链已串接 check-table-shape）
  if (!SKIP_EXTERNAL) {
    const ts = run('node', ['tools/check/check-table-shape.mjs']);
    if (ts.rc !== 0) bad.push('check-table-shape 有违规（孤立分隔行/超列/孤儿行等）');
  }
  return { pass: bad.length === 0, hits: bad, detail: bad.length === 0 ? '无残句 / 括号配对 / 无孤立分隔行' : bad.slice(0, 3).join(' / ') };
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
  // ⚠️ 留痕节载体 = 版本 devlog（docs/changelog/ 下）——它整体属 FROZEN_RE 冻结面，
  // 从 LIVE_MD 过滤会**恒空**（实测：留痕节写了也报「未找到」）。留痕读取不受冻结限制，
  // 故从 LS_ALL 取 devlog 候选；「取最新」语义不变。
  const devlogs = LS_ALL.filter((f) => /^docs\/changelog\/v\d+\.\d+\/v\d+\.\d+\.\d+\.md$/.test(f))
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
      { id: 'D3-5', name: '标题 ≤80 码点（H2/H3）', kind: 'mech', src: '机械（ACTIVE_DOCS）', fn: d3_5 },
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
      { id: 'D5-3', name: '无 >600 字纯正文段落', kind: 'mech', src: '机械（ACTIVE_DOCS）', fn: d5_3 },
      { id: 'D5-4', name: '无加粗过载行（单行 ** >4 对）', kind: 'mech', src: '机械（ACTIVE_DOCS）', fn: d5_4 },
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
  // ⚠️ 增量模式**不得**调用：doc-discipline.sh 的 Face 13 会反向串接本脚本 —— 调回去即无限递归。
  //    且 Face 5/6/7 在同一次 doc-discipline 运行中已判过，重复调用无信息增量。
  const dd = SKIP_EXTERNAL ? { rc: 0, out: '' } : run('bash', ['tools/check/doc-discipline.sh']);
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
      if (SKIP_EXTERNAL && !MECH_INCREMENTAL.has(it.id)) {
        items.push({
          ...it,
          skipped: true,
          pass: null,
          detail: it.kind === 'human' ? '人工判断项（增量模式不计分，由 fresh-eyes 承担）' : '全仓门禁/face 项（增量模式跳过，由 pre-push-check 同链覆盖）',
        });
        continue;
      }
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
    const scored = items.filter((x) => !x.skipped);
    const passed = scored.filter((x) => x.pass).length;
    // 整维被跳过（如 D1/D2/D6 在增量模式下无机械项）→ score = null（不参与评分与基线比较，不静默记 0）
    const scoreVal = scored.length ? Math.round((passed / scored.length) * 100) / 10 : null;
    results.push({ id: dim.id, name: dim.name, passed, total: scored.length, skipped: items.length - scored.length, score: scoreVal, items });
  }
  return { results, attestationFile: att.file, docDisciplineRc: dd.rc };
}

// ============================================================
// 增量模式（--changed）：变更文档形态机械面 · 对照 HEAD · 存量不拦
// ============================================================
/** 变更文档集：工作区 diff + 已 stage + 未跟踪新文档（git diff 看不见未跟踪，而新文档恰恰最该检）。 */
function changedMd() {
  const g = (a) => {
    const r = run('git', a);
    return r.rc === 0 ? r.out.split('\n').filter(Boolean) : [];
  };
  const set = new Set([
    ...g(['diff', '--name-only', 'HEAD', '--', '*.md']),
    ...g(['diff', '--name-only', '--cached', '--', '*.md']),
    ...g(['ls-files', '--others', '--exclude-standard', '--', '*.md']),
  ]);
  return [...set].filter((f) => !isFrozen(f) && fs.existsSync(path.join(ROOT, f))).sort();
}
/** HEAD 版本内容（新文件在 HEAD 不存在 → 空串，其全部命中按新增计）。 */
function headContent(f) {
  const r = run('git', ['show', `HEAD:${f}`]);
  return r.rc === 0 ? r.out : '';
}
/** 命中串归属到文件（命中形如 `f:12` / `f：…` / `f（…）`）。 */
const ownerOf = (hit, files) =>
  files.find((f) => hit === f || hit.startsWith(`${f}:`) || hit.startsWith(`${f}：`) || hit.startsWith(`${f}（`));

/** 跑一遍 12 项机械项，返回 Map<itemId, {name, hits[]}>。 */
function mechHits() {
  const out = new Map();
  for (const dim of DIMENSIONS) {
    for (const it of dim.items) {
      if (!MECH_INCREMENTAL.has(it.id)) continue;
      const r = it.fn();
      out.set(it.id, { name: it.name, hits: Array.isArray(r.hits) ? r.hits : [] });
    }
  }
  return out;
}

/**
 * 分类（纯函数，供 --self-test 直接喂合成命中验证四条分支）：按「项 × 文件」比对命中数。
 *   Δ>0 → 新增缺陷（阻断）；Δ=0 且 >0 → 存量（信息位）；Δ<0 → 改善。
 * 不可归属到变更文件的命中（跨文件聚合项落在未变更文件上）→ 信息位，不拦。
 */
function classify(work, head, files) {
  const blocks = [];
  const infos = [];
  const fixes = [];
  for (const [id, w] of work) {
    const h = head.get(id) || { hits: [] };
    const of = (arr, f) => arr.filter((x) => ownerOf(x, files) === f);
    for (const f of files) {
      const nw = of(w.hits, f).length;
      const nh = of(h.hits, f).length;
      if (nw > nh) blocks.push({ id, name: w.name, file: f, delta: nw - nh, sample: of(w.hits, f).slice(0, 3), text: `${id} ${w.name} · ${f} 新增 ${nw - nh} 处：${of(w.hits, f).slice(0, 3).join(' / ')}` });
      else if (nw < nh) fixes.push({ id, name: w.name, file: f, delta: nw - nh, text: `${id} ${w.name} · ${f} 由 ${nh} 处降至 ${nw} 处` });
      else if (nw > 0) infos.push({ id, text: `${id} ${w.name} · ${f} ${nw} 处（HEAD 同数 = 存量，不拦）` });
    }
    const un = w.hits.filter((x) => !ownerOf(x, files));
    if (un.length) infos.push({ id, text: `${id} ${w.name} · 不可归属 ${un.length} 处（跨文件聚合/未变更文件）：${un.slice(0, 2).join(' / ')}` });
  }
  return { blocks, infos, fixes, workCount: [...work.values()].reduce((a, x) => a + x.hits.length, 0) };
}

function incrementalScan(files) {
  const prevDocs = ACTIVE_DOCS;
  ACTIVE_DOCS = files;
  SKIP_EXTERNAL = true;
  const work = mechHits();
  OVERRIDE = new Map(files.map((f) => [f, headContent(f)]));
  const head = mechHits();
  OVERRIDE = null;
  ACTIVE_DOCS = prevDocs;
  SKIP_EXTERNAL = false;
  return classify(work, head, files);
}

/**
 * 自检（--self-test）：用**合成命中**验证四条分类分支，不动 git、不落临时文件。
 * 为什么必须自检：Δ 四条分支里「存量同数」与「不可归属」在日常全绿仓里**永远不会自然触发**
 * （仓内无存量违规 ⇒ 没有可跑的样本），不自检就是未验证的死分支——死分支一旦写错就是假红，
 * 而假红会把整个 Face 变成被绕过的噪音门禁。
 */
function selfTest() {
  const mk = (hits) => new Map([['D4-3', { name: '代码围栏全部标语言', hits }]]);
  const cases = [
    { name: '新增缺陷 → 阻断', files: ['a.md'], work: mk(['a.md:10']), head: mk([]), exp: [1, 0, 0] },
    { name: '增量多于存量（2 vs 1）→ 只算净新增', files: ['a.md'], work: mk(['a.md:10', 'a.md:20']), head: mk(['a.md:10']), exp: [1, 0, 0] },
    { name: '存量同数 → 信息位不拦', files: ['a.md'], work: mk(['a.md:10']), head: mk(['a.md:10']), exp: [0, 1, 0] },
    { name: '改善（命中变少）→ 不算阻断', files: ['a.md'], work: mk([]), head: mk(['a.md:10']), exp: [0, 0, 1] },
    { name: '不可归属命中 → 信息位不拦', files: ['a.md'], work: mk(['b.md:7']), head: mk([]), exp: [0, 1, 0] },
    { name: '干净变更 → 全绿', files: ['a.md'], work: mk([]), head: mk([]), exp: [0, 0, 0] },
  ];
  let ok = true;
  for (const c of cases) {
    const r = classify(c.work, c.head, c.files);
    const got = [r.blocks.length, r.infos.length, r.fixes.length];
    const pass = got[0] === c.exp[0] && got[1] === c.exp[1] && got[2] === c.exp[2];
    if (!pass) ok = false;
    console.log(`  ${pass ? '✓' : '✗'} ${c.name}（期望 阻断/信息/改善 = ${c.exp.join('/')} · 实得 ${got.join('/')}）`);
  }
  // 反向探针：把对照源置空（模拟 git show 失败）不应静默放行——空基线会让全部命中变「新增」，
  // 属**偏严**而非假绿，故此处只断言「命中数守恒」，并提示空基线风险。
  const emptyBase = classify(mk(['a.md:1']), new Map(), ['a.md']);
  console.log(`  ${emptyBase.blocks.length === 1 ? '✓' : '✗'} 空对照基线 → 命中全部计为新增（偏严，fail-closed 方向正确）`);
  if (emptyBase.blocks.length !== 1) ok = false;
  if (!ok) process.exit(1);
  console.log('  自检全过');
}

function incrementalMain() {
  const files = changedMd();
  console.log('=== doc-score --changed · 文档形态机械面（增量 · 对照 HEAD）===');
  console.log('  变更集口径：git diff --name-only HEAD -- "*.md" ∪ git diff --cached ∪ git ls-files --others（排除冻结区）');
  if (files.length === 0) {
    // 自证：把实测命令与结果条数打出来，避免「零命中」被误读为「扫过了没问题」或「空转」
    console.log('  实测：变更 .md 0 份 → 本面无扫描对象（非空转：上述三条 git 命令已执行，结果为空）');
    console.log('✓ 无变更文档 —— 文档形态机械面不适用');
    process.exit(0);
  }
  console.log(`  变更文档 ${files.length} 份：${files.slice(0, 6).join(' / ')}${files.length > 6 ? ` …(+${files.length - 6})` : ''}`);
  console.log(`  机械项 ${MECH_INCREMENTAL.size} 项 · 跳过 ${27 - MECH_INCREMENTAL.size} 项（全仓门禁/人工项：由 pre-push-check 同链 · Face 5·6·7 · fresh-eyes 覆盖，不进分母）`);
  console.log('');

  const { blocks, infos, fixes, workCount } = incrementalScan(files);

  console.log(`阻断 · 新增缺陷（${blocks.length}）：`);
  if (blocks.length === 0) console.log('  （无）');
  for (const x of blocks) console.log(`  ❌ ${x.text}`);
  console.log('');
  console.log(`信息位 · 存量/不可归属（${infos.length}，不拦）：`);
  if (infos.length === 0) console.log('  （无）');
  for (const x of infos) console.log(`  ⚠️  ${x.text}`);
  if (fixes.length) {
    console.log('');
    console.log(`改善（${fixes.length}）：`);
    for (const x of fixes) console.log(`  ✓ ${x.text}`);
  }
  console.log('');
  console.log(`  自证：本轮扫描命中合计 ${workCount} 处（工作区版本）· 对照 HEAD 版本同口径重扫 1 次`);
  console.log('════════════════════════════════════════════════════');
  if (blocks.length > 0) {
    console.log(`✗ 变更文档引入 ${blocks.length} 处新的形态缺陷 —— 不可放行`);
    console.log('  处置：按上列 文件:行号 修内容（存量不拦：HEAD 已存在的同数命中只作信息位）。');
    process.exit(1);
  }
  console.log('✓ 变更文档形态机械面无新增缺陷 —— 通过');
  process.exit(0);
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

// 自检优先（不依赖 git 状态，可在任何时刻验证判据未被架空）
if (args.includes('--self-test')) {
  console.log('=== doc-score · 增量分类自检（合成命中 · 不动 git）===');
  selfTest();
  process.exit(0);
}

// 增量模式走独立路径（不调用 score()：跳过全仓外部门禁，也不做基线比较——
// 子集得分与全量基线口径不同，比较即为假绿/假红）
if (args.includes('--changed')) {
  if (args.includes('--json')) {
    const files = changedMd();
    const r = files.length ? incrementalScan(files) : { blocks: [], infos: [], fixes: [], workCount: 0 };
    console.log(JSON.stringify({ mode: 'changed', files, ...r }, null, 2));
    process.exit(r.blocks.length ? 1 : 0);
  }
  incrementalMain();
}

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
