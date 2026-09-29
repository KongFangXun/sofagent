#!/usr/bin/env node
// ============================================================
// doc-postcheck.mjs · 文档落盘后自检（单文件 · 秒级 · 非门禁）
// ============================================================
// 定位：把发版 SOP 06-doc-finalize「三道闸 / 步骤十大扫除」中**机械可判定**
//   的部分收敛成一个落盘即查的快检入口——文档写完（或 AI 落盘后）立刻跑，
//   秒级反馈；全量门禁（doc-discipline / check-docs / check-anchors /
//   check-table-shape / doc-score）仍在 pre-push 与阶段六收口时跑，不替代。
//
// 判据全部**引用既有口径**（不另立标准——改口径先改宿主，本工具自动跟随）：
//   ① U+FFFD 乱码        ← check-docs.sh §2b 同判据（编码损坏）
//   ② 墙式行 / 墙式格     ← lib/readability-count.mjs 同口径（>300 / >200）
//   ③ 字符数棘轮          ← doc-char-ratchet.json 台账（Unicode 码点，只许降）
//   ④ 抬头块 >600 字      ← doc-char-ratchet.json _meta.opening_cap 同判据
//   ⑤ 标题粘连            ← 「正文。## 标题」同行形态（今日 VALIDATION 实测事故，
//                            三大门禁齐盲——文本都在、锚点全断；判据含行内代码
//                            剥离 + 格式说明豁免，正负样本见 --selftest）
//
// 用法：
//   node tools/check/doc-postcheck.mjs <file.md> [file2.md ...]  # 逐文件五项
//   node tools/check/doc-postcheck.mjs --changed                 # 只查 git 变更中的 .md
//   node tools/check/doc-postcheck.mjs <file> --fix              # 墙式行自动折行（调 lib/reflow-walls）
//   node tools/check/doc-postcheck.mjs --selftest                # 判据正负样本自检
//
// 退出码：0 = 全过；1 = 有违规（含超字符基线）；2 = 用法误用。
// 定性：**排障工具非门禁**（同 resolve-section.sh 口径——不接 check-guards/CI；
//   判定面按参数收敛，扫描面为 0 时静默通过是预期行为，全量防线由宿主门禁承担）。
// ============================================================
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SELF_DIR, '..', '..');
const CHAR_RATCHET_PATH = path.join(ROOT, 'tools/check/doc-char-ratchet.json');

// ── 判据常量（宿主 = 唯一口径源，此处只引用不改写）────────
const WALL_LIMIT = 300;   // lib/readability-count.mjs
const CELL_LIMIT = 200;   // 同上
const OPENING_CAP = 600;  // doc-char-ratchet.json _meta.opening_cap

// ── 单文件五项检查 ────────────────────────────────────────
function checkFile(file, ratchet) {
  const rel = path.relative(ROOT, file);
  const s = fs.readFileSync(file, 'utf8');
  const chars = [...s].length;
  const issues = [];
  const lines = s.split('\n');

  // ① U+FFFD（check-docs §2b 同判据）
  const fffdLines = [];
  lines.forEach((l, i) => { if (l.includes('\uFFFD')) fffdLines.push(i + 1); });
  if (fffdLines.length) issues.push(`U+FFFD 乱码 ×${fffdLines.length}（行 ${fffdLines.slice(0, 5).join(',')}）——编码损坏，修复写入端编码`);

  // ② 墙式行 / 墙式格（lib/readability-count 同口径；存量债在 doc-ratchet.json
  //    台账内登记的**不报**——本工具只拦新增，全量对账仍归 doc-discipline Face 5）
  let fence = false, wall = 0, cell = 0;
  const wallLines = [], cellLines = [];
  const debt = (ratchet && ratchet.ratchetDoc && ratchet.ratchetDoc[rel]) || { wall: 0, cell: 0 };
  lines.forEach((l, i) => {
    if (/^(```|~~~)/.test(l)) { fence = !fence; return; }
    if (fence) return;
    if (l.length > WALL_LIMIT) { wall++; wallLines.push(i + 1); }
    if (l.trim().startsWith('|')) {
      for (const c of l.split('|').slice(1, -1)) {
        if (c.length > CELL_LIMIT) { cell++; cellLines.push(i + 1); break; }
      }
    }
  });
  if (wall > debt.wall) issues.push(`墙式行 ${wall} > 台账 ${debt.wall}（行 ${wallLines.slice(0, 5).join(',')}）——加 --fix 自动折行，或手工拆段；确属新债走 doc-ratchet.json 登记`);
  if (cell > debt.cell) issues.push(`墙式格 ${cell} > 台账 ${debt.cell}（行 ${cellLines.slice(0, 5).join(',')}）——用 lib/split-table-cells.mjs 拆注；确属新债走 doc-ratchet.json 登记`);

  // ③ 字符数棘轮（台账内文件才判——台账外文件不受此约束）
  if (ratchet && ratchet[rel] !== undefined) {
    const lim = ratchet[rel];
    if (chars > lim) issues.push(`字符数 ${chars} > 台账基线 ${lim}（+${chars - lim}）——净增须先同文档移出等量字（06 三道闸闸一），再动台账`);
  }

  // ④ 抬头块（H1 到首个 '## ' 之间正文 > 600 字；口径同 Face 7：剔装饰行与 front matter）
  if (ratchet && ratchet[rel] !== undefined) {
    const deco = /^(<[^>]+>|!\[[^\]]*\]\([^)]*\)|\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)|<!--.*-->|-{3,})$/;
    let inFront = lines[0] && lines[0].trim() === '---';
    let opening = 0, sawH1 = false, h2Hit = false;
    for (const l of lines) {
      if (inFront) { if (l.trim() === '---') inFront = false; continue; }
      if (!sawH1) { if (/^# /.test(l)) sawH1 = true; continue; }
      if (/^## /.test(l)) { h2Hit = true; break; }
      if (l.trim() && !deco.test(l.trim())) opening += [...l].length;
    }
    if (sawH1 && h2Hit && opening > OPENING_CAP) issues.push(`抬头块 ${opening} 字 > ${OPENING_CAP}——首个 H2 前正文过长，下沉/精简/淘汰三选一（Face 7 同判据）`);
  }

  // ⑤ 标题粘连：「正文。## 标题」同行——文本都在、锚点全断，三门禁齐盲
  //    （判据：句读符后紧跟 ##；先剥行内代码 span；列表/标题行豁免；含 / 的短
  //    token 序列豁免——那是格式说明如「（格式：## HH:MM …）」，全仓负样本实测）
  fence = false;
  const stuckLines = [];
  lines.forEach((l, i) => {
    if (/^(```|~~~)/.test(l)) { fence = !fence; return; }
    if (fence) return;
    const t = l.trim();
    if (t.startsWith('-') || t.startsWith('#')) return;
    const stripped = l.replace(/`[^`]*`/g, '``');
    const m = stripped.match(/[。；：！？;:!?]\s?(#{1,6}) (.+)/);
    if (!m) return;
    if (/\//.test(m[2].slice(0, 25))) return; // 格式说明豁免
    stuckLines.push(i + 1);
  });
  if (stuckLines.length) {
    issues.push(`标题粘连 ×${stuckLines.length}（行 ${stuckLines.slice(0, 5).join(',')}）——「正文。## 标题」须拆为两行（标题前空行），否则锚点全断、门禁齐盲`);
  }

  return { rel, chars, issues };
}

// ── 正负样本自检（判据被改坏即红——与 check-table-shape SELF_TEST 同纪律）──
function selfTest() {
  const mk = (body) => {
    const f = path.join(ROOT, 'docs', '.postcheck-selftest-tmp.md');
    fs.writeFileSync(f, body);
    return f;
  };
  const rm = (f) => fs.unlinkSync(f);
  const cases = [
    { name: '正常文档零命中', body: '# T\n\n正文一段。\n\n## 小节\n\n内容。\n', expect: 0 },
    { name: 'U+FFFD 命中', body: '# T\n\n坏字符 \uFFFD 在此。\n', expect: 1 },
    { name: '墙式行命中', body: '# T\n\n' + '长'.repeat(301) + '\n', expect: 1 },
    { name: '标题粘连命中', body: '# T\n\n上文结束。## 新章节标题\n', expect: 1 },
    { name: '粘连-格式说明豁免', body: '# T\n\n说明见 `cfg.md`（格式：## HH:MM 任务名 / 模型）。\n', expect: 0 },
    { name: '粘连-列表豁免', body: '# T\n\n- 列表项。## 不报\n', expect: 0 },
  ];
  let ok = true;
  for (const c of cases) {
    const f = mk(c.body);
    const r = checkFile(f, null);
    rm(f);
    const pass = (r.issues.length > 0) === (c.expect > 0);
    if (!pass) { ok = false; console.error(`  ✗ 自检失败：${c.name}（期望 ${c.expect} 实得 ${r.issues.length}）`); }
    else console.log(`  ✓ ${c.name}`);
  }
  if (!ok) process.exit(1);
  console.log('  自检全过');
}

// ── main ──────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.includes('--selftest')) { selfTest(); process.exit(0); }

const fix = args.includes('--fix');
const files = args.filter((a) => !a.startsWith('--'));
let targets = [];
if (args.includes('--changed')) {
  const out = execFileSync('git', ['diff', '--name-only', 'HEAD', '--', '*.md'], { cwd: ROOT, encoding: 'utf8' });
  const staged = execFileSync('git', ['diff', '--name-only', '--cached', '--', '*.md'], { cwd: ROOT, encoding: 'utf8' });
  targets = [...new Set([...out.trim().split('\n'), ...staged.trim().split('\n')])].filter(Boolean).map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f));
} else if (files.length) {
  targets = files.map((f) => path.resolve(f));
} else {
  console.error('usage: doc-postcheck.mjs <file.md>... | --changed [--fix] | --selftest');
  process.exit(2);
}
if (!targets.length) { console.log('无待检文件（--changed 面为空）'); process.exit(0); }

const ratchetRaw = fs.existsSync(CHAR_RATCHET_PATH) ? JSON.parse(fs.readFileSync(CHAR_RATCHET_PATH, 'utf8')) : null;
const ratchetDoc = (() => {
  const p = path.join(ROOT, 'tools/check/doc-ratchet.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
})();
const ratchet = ratchetRaw ? { ...ratchetRaw, ratchetDoc } : null;

// --fix：先调既有 reflow-walls 折行（口径单一来源），再继续检查
if (fix) {
  for (const f of targets) {
    try {
      execFileSync('node', [path.join(SELF_DIR, 'lib/reflow-walls.mjs'), f, '--write'], { cwd: ROOT, stdio: 'pipe' });
    } catch { /* 折不断（无标点）的行保留，由下方检查如实报告 */ }
  }
}

let total = 0;
for (const f of targets) {
  const r = checkFile(f, ratchet);
  total += r.issues.length;
  if (r.issues.length) {
    console.log(`\n✗ ${r.rel}（${r.chars} 字符）`);
    for (const it of r.issues) console.log(`  - ${it}`);
  } else {
    console.log(`✓ ${r.rel}（${r.chars} 字符）五项全过`);
  }
}
console.log(`\n${targets.length} 文件 · ${total} 项待处置`);
process.exit(total ? 1 : 0);
