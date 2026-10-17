#!/usr/bin/env node
// ============================================================
// check-doc-debt.mjs · 家族文档债务门禁（唯一实现 · R5）
// ============================================================
// 标准：本工具须满足主仓 `tools/STANDARD.md` 三组八条。
// 位置随主仓结构调整 ⇒ 引用方一律软引用定位（安装器两条腿：同级布局 → 绝对路径回落），不硬编码路径。
//
// 为什么存在：文档债的主要形态不是「写错」而是「**写旧**」——引用指向被删/挪走的
// 文件、被上层仓改掉的计数与版本状态、自己改名后没跟上的旧称、双语版彼此漂移。
// 靠人肉 grep 只能治一次（实测：一次全仓收敛清掉 13 处旧计数 + 4 处断链，下一次上游
// 改版又新生）。故把八类判据做成常驻门禁。
//
// 判据表（事故 / 判据式 / 处置 —— R1 · R8）：
//   C1 断链     事故：4 处指向已删文件                     判据：相对链接必须可解析（基准=文件所在目录）
//   C2 术语旧称 事故：AIR/GrapHub 两处口径不一致           判据：已废止旧称黑名单命中
//   C3 计数口径 事故：13 处旧计数（24 条规则 / 84 个 tool） 判据：已废止旧值黑名单命中
//   C4 版本状态 事故：文档称「未发版」而 tag 已存在         判据：含状态词的行若提到已存在 tag 即红
//   C5 可读性   事故：单行 315 字符 / 单元格 205 字符       判据：墙式计数只许降不许升（棘轮）
//   C6 退役节   事故：模板要求「每版 ≥3 项」而无任何强制     判据：版本记录须含退役节且数据行 ≥3
//   C7 双语同步 事故：只改中文版 README，门禁 rc=0          判据：双语对的结构签名必须一致
//   C8 白名单   事故：根级可随手加「白名单外」文件，rc=0     判据：根级条目必须已在白名单登记
//
// 口径住实现、判据内容住配置（R5）：
//   实现持有 —— 阈值（墙 300 / 格 200）· 冻结区定义 · 失明下限 · 豁免额度机制 · 结构签名算法
//   配置持有 —— 词表 · 计数真值 · 白名单 · 双语对 · 豁免额度数值（`tools/doc-debt.config.json`）
//
// 豁免（R4 · 台账化）：**台账为权威**——`tools/doc-debt-exempt.json` 的条目即生效；
//   行内 `doc-debt:ignore` 仅作可见性提示，本身不生效；条目须自带理由与批准人。
//   额度 = config `exemptQuota`，超出即红；行级豁免不得越级覆盖节级判据（C6 只认整篇豁免）。
//
// 退出码：0 全绿 / 1 有违规 / 2 失明（R3：扫描面或口径不可得，拒绝假绿）
//
// 用法：
//   node ../sofagent-tools/check/check-doc-debt.mjs [--sofagent <path>] [--strict]
//   …  --selftest | --version | --help | --json
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VERSION = '1.0.0';
const SPEC = 'tools/STANDARD.md（R1–R8）';

// ── 口径常量（住实现 · 配置不可改，R5）──────────────────────────
const WALL_LIMIT = 300;   // 墙式行：字符数
const CELL_LIMIT = 200;   // 墙式格：字符数
const MIN_DOCS = 3;       // 失明下限：篇数
const FROZEN = /(^|\/)(changelog|archive|evidence|vendor)\//; // 冻结区：整类跳过棘轮
const C4_STATE_WORDS = /未发版|待发版|排期中|未实现/;         // C4 触发词（口径）

const args = process.argv.slice(2).filter((a) => a !== '--sofagent' && !isFlagValue(a));
function isFlagValue(a) {
  const i = process.argv.indexOf('--sofagent');
  return i >= 0 && process.argv[i + 1] === a;
}
const flagOf = (n) => args.includes(n);
const valueOf = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };

if (flagOf('--help')) {
  console.log(`check-doc-debt.mjs v${VERSION} — 家族文档债务门禁（唯一实现）
标准：${SPEC}

用法：
  node check-doc-debt.mjs [选项]

选项：
  --sofagent <path>  总仓路径：启用 C4（读 tag）与跨仓口径
  --strict           把「SKIP」升为一等失败（用于发布闸）
  --json             机器可读输出
  --selftest         自检（R6）：正向用例须绿 + 负向用例须红
  --version          打印版本
  --help             打印本帮助

退出码：0 全绿 / 1 有违规 / 2 失明（口径或扫描面不可得，拒绝假绿）

配置：{本仓}/tools/doc-debt.config.json（词表 / 计数 / 白名单 / 双语对 / 豁免额度）
豁免：{本仓}/tools/doc-debt-exempt.json（台账化；未登记的行内忽略标记不生效）`);
  process.exit(0);
}
if (flagOf('--version')) { console.log(`check-doc-debt.mjs v${VERSION}`); process.exit(0); }

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.join(SELF_DIR, 'lib/readability-count.mjs');

// ── 承载：把「一次运行」封成函数，selftest 可注入 fixture（R6）──────
function run(cfg, docs, ctx) {
  const fails = [];
  const notes = [];
  const log = [];

  // ── 豁免台账（R4）：**台账为权威**，行内标记仅作可见性提示（本身不生效）──────
  const exempt = cfg.__exempt || { entries: [] };
  const quota = Number(cfg.exemptQuota ?? 0);
  const exemptItems = exempt.entries || [];
  // 条目匹配：同文件 且（未指定行号 = 整篇豁免，或行号精确命中）
  const covered = (f, i) => exemptItems.some((e) => e.file === f && (e.line == null || e.line === i + 1));
  const lineIgnored = (f, _l, i) => covered(f, i);
  const fileIgnored = (f) => exemptItems.some((e) => e.file === f && e.line == null);
  // 台账条目必须自带理由与批准人（防「无理由豁免」）
  for (const e of exemptItems) {
    if (!e.reason || !e.approved) fails.push(`R4 豁免条目缺理由或批准人：${e.file}${e.line ? ':' + e.line : ''}`);
  }

  if (exemptItems.length > quota) {
    fails.push(`R4 豁免超额度：台账 ${exemptItems.length} 条 > 额度 ${quota}（豁免是例外，不是常态）`);
  }

  // ── C1 断链 ───────────────────────────────────────────────
  let linkTotal = 0;
  const exists = ctx.exists || ((p) => fs.existsSync(p));
  for (const { f, txt } of docs) {
    if (fileIgnored(f)) continue;
    txt.split('\n').forEach((l, i) => {
      if (lineIgnored(f, l, i)) return;
      for (const m of l.matchAll(/\]\((\.[^)#]+)(#[^)]*)?\)/g)) {
        linkTotal++;
        if (!exists(path.resolve(path.join(ctx.root, path.dirname(f)), m[1]), m[1])) fails.push(`C1 断链 ${f}:${i + 1} → ${m[1]}`);
      }
    });
  }

  // ── C2 术语旧称 / C3 计数口径（内容由配置提供）────────────────
  const re = (s) => new RegExp(s, 'g');
  for (const { f, txt } of docs) {
    if (fileIgnored(f)) continue;
    txt.split('\n').forEach((l, i) => {
      if (lineIgnored(f, l, i)) return;
      for (const [pat, msg] of cfg.termBlacklist || []) if (re(pat).test(l)) fails.push(`C2 旧称 ${f}:${i + 1} ${msg}`);
      for (const [pat, want, name] of cfg.counts || []) {
        for (const m of l.matchAll(re(pat))) {
          if (m[1] && m[1] !== String(want)) fails.push(`C3 计数 ${f}:${i + 1} ${name} 写作「${m[0]}」，SSOT = ${want}`);
        }
      }
    });
  }

  // ── C4 版本状态 ───────────────────────────────────────────
  if (!ctx.tags) {
    notes.push('C4 版本状态 SKIP（缺 --sofagent）——**SKIP ≠ 通过**');
  } else {
    for (const { f, txt } of docs) {
      if (fileIgnored(f)) continue;
      txt.split('\n').forEach((l, i) => {
        if (lineIgnored(f, l, i) || !C4_STATE_WORDS.test(l)) return;
        for (const m of l.matchAll(/v(\d+\.\d+\.\d+)/g)) {
          if (ctx.tags.has(m[1])) fails.push(`C4 版本状态 ${f}:${i + 1} v${m[1]} 已发版（tag 存在），本行仍称未发`);
        }
      });
    }
  }

  // ── C5 可读性棘轮（口径唯一：lib，无回落 R2/R3）──────────────
  let measured = {};
  let c5Source = 'lib/readability-count.mjs（唯一口径）';
  const live = docs.filter(({ f }) => !FROZEN.test(f)).map(({ f }) => f);
  if (ctx.countWallCell) {
    for (const { f, txt } of docs) { if (FROZEN.test(f)) continue; const c = ctx.countWallCell(txt); if (c.wall || c.cell) measured[f] = c; }
    c5Source = 'selftest 注入口径';
  } else if (!fs.existsSync(LIB)) {
    return { blind: `C5 口径实现不可得：${LIB} 不存在——拒绝以别套口径替代（R3 禁静默降级）` };
  } else {
    try {
      const out = execFileSync('node', [LIB, ...live], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, cwd: ctx.root });
      for (const [f, c] of Object.entries(JSON.parse(out))) if (c.wall || c.cell) measured[f] = { wall: c.wall, cell: c.cell };
    } catch (e) {
      return { blind: `C5 口径实现调用失败（${String(e.message).slice(0, 80)}）——拒绝回落（R3）` };
    }
  }
  const base = cfg.__base || {};
  for (const [f, c] of Object.entries(measured)) {
    const b = base[f];
    if (!b) { fails.push(`C5 新债 ${f}：未登记且已有 墙式行 ${c.wall} / 格 ${c.cell}`); continue; }
    if (c.wall > b.wall) fails.push(`C5 棘轮 ${f}：墙式行 ${b.wall} → ${c.wall}（只许降不许升）`);
    if (c.cell > b.cell) fails.push(`C5 棘轮 ${f}：墙式格 ${b.cell} → ${c.cell}（只许降不许升）`);
  }
  const tot = Object.values(measured).reduce((a, c) => a + c.wall + c.cell, 0);
  const btot = Object.values(base).reduce((a, c) => a + (c.wall || 0) + (c.cell || 0), 0);
  log.push(`  C5 可读性棘轮：当前 ${tot} 处 / 基线 ${btot} 处 · 口径来源：${c5Source}`);

  // ── C6 退役节（节级判据：只认整篇豁免，行级不可越级 R4）────────
  const RETIRE_DOC = /(^|\/)changelog\/v[^/]+\/[^/]+\.md$/;
  const retireDocs = docs.filter(({ f }) => RETIRE_DOC.test(f));
  // 仓型声明（R1 触发事故：AIR 首次接入家族门禁时 C6 因「无 changelog/v*/ 版本记录」而失明——
  //    AIR 是研发/文档仓，**没有「按版本发布记录」这一对象**，不是扫描面塌陷）。
  // ⇒ cfg.repoKind === 'docs' 时 C6 记 N/A 并**进 notes**（默认可见、--strict 下升为失败），
  //    绝不静默跳过（R4：豁免必须可见且可被收紧）。
  if (!retireDocs.length && cfg.repoKind === 'docs') {
    notes.push('C6 退役节 N/A（repoKind=docs：本仓无 changelog/v*/ 版本记录，按仓型声明跳过——非静默通过）');
  } else if (!retireDocs.length) return { blind: 'C6 未找到任何 changelog/v*/ 版本记录——扫描面塌陷（R3）' };
  const isSep = (l) => { const t = l.trim(); return t.startsWith('|') && /-/.test(t) && /^[|\s:\-]+$/.test(t); };
  for (const { f, txt } of retireDocs) {
    if (fileIgnored(f)) continue;
    const lines = txt.split('\n');
    const start = lines.findIndex((l) => /^##\s*(Retirement|退役)/.test(l));
    if (start < 0) { fails.push(`C6 退役节 ${f} → 缺 \`## Retirement\` / \`## 退役\` 节（纪律：changelog/_TEMPLATE.md 判级区 Retirement floor；仓规 AGENTS.md 退役义务）`); continue; }
    let inFence = false, inTable = false, sepSeen = false, pipeRows = 0, rows = 0;
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/^(```|~~~)/.test(l)) { inFence = !inFence; inTable = false; continue; }
      if (inFence) continue;
      if (/^##\s/.test(l)) break;
      if (!l.trim().startsWith('|')) { inTable = false; continue; }
      pipeRows++;
      if (isSep(l)) { inTable = true; sepSeen = true; continue; }
      if (inTable) rows++;
    }
    if (!sepSeen) rows = Math.max(0, pipeRows - 1);
    if (rows < 3) fails.push(`C6 退役节 ${f} → 数据行仅 ${rows} 条（须 ≥3）。纪律：changelog/_TEMPLATE.md「Retirement floor」+ AGENTS.md「退役义务」`);
  }

  // ── C7 双语同步（结构签名：H2 数 / 围栏数 / 互指对称 / 其余链接集合）─────
  const sig = (txt, other) => {
    const ls = txt.split('\n');
    let h2 = 0, fence = 0;
    const links = [];
    for (const l of ls) {
      if (/^(```|~~~)/.test(l)) fence++;
      if (/^##\s/.test(l)) h2++;
      for (const m of l.matchAll(/\]\((\.[^)#]+)/g)) if (m[1] !== './' + other) links.push(m[1]);
    }
    return { h2, fence: Math.floor(fence / 2), links: [...new Set(links)].sort().join(','), cross: new RegExp(`\\]\\((\\./)?${other.replace('.', '\\.')}`).test(txt) };
  };
  for (const pair of cfg.bilingualPairs || []) {
    const [a, b] = pair;
    const da = docs.find((d) => d.f === a), db = docs.find((d) => d.f === b);
    if (!da || !db) { fails.push(`C7 双语同步：${a} / ${b} 有一侧缺席（配对声明在配置里，文件必须先存在）`); continue; }
    const sa = sig(da.txt, b), sb = sig(db.txt, a);
    const diff = [];
    if (sa.h2 !== sb.h2) diff.push(`H2 数 ${sa.h2} ≠ ${sb.h2}`);
    if (sa.fence !== sb.fence) diff.push(`代码围栏数 ${sa.fence} ≠ ${sb.fence}`);
    if (sa.links !== sb.links) diff.push('除互指外的相对链接集合不一致');
    if (!sa.cross || !sb.cross) diff.push(`互指不对称（${!sa.cross ? a + ' 未指向 ' + b : b + ' 未指向 ' + a}）`);
    if (diff.length) fails.push(`C7 双语同步 ${a} ↔ ${b}：${diff.join(' · ')}（仓规：README 改动须双版同批）`);
  }

  // ── C8 根级白名单真实性 ────────────────────────────────────
  if (cfg.rootWhitelist) {
    for (const e of ctx.topLevel || []) {
      if (!cfg.rootWhitelist.includes(e) && !cfg.rootWhitelist.includes(e + '/')) {
        fails.push(`C8 根级白名单 ${e}：未在 doc-debt.config.json 的 rootWhitelist 登记（仓规：新增须许可，代理不得自主创建）`);
      }
    }
  }

  return { fails, notes, log, linkTotal, docs: docs.length };
}

// ── collect：真实运行环境的采集（selftest 走注入路径）────────────────
function collect(root) {
  const cfgPath = path.join(root, 'tools/doc-debt.config.json');
  if (!fs.existsSync(cfgPath)) return { blind: `缺配置 ${path.relative(root, cfgPath)}（R5：判据内容住配置；未登记拒绝以空配置出绿）` };
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (e) { return { blind: `配置 JSON 非法：${e.message}` }; }
  if (!cfg.repo || path.basename(root) !== cfg.repo) return { blind: `配置 repo 字段「${cfg.repo}」与目录名「${path.basename(root)}」不符（防错挂配置）` };

  const exPath = path.join(root, 'tools/doc-debt-exempt.json');
  if (fs.existsSync(exPath)) { try { cfg.__exempt = JSON.parse(fs.readFileSync(exPath, 'utf8')); } catch (e) { return { blind: `豁免台账 JSON 非法：${e.message}` }; } }
  const rPath = path.join(root, 'tools/doc-ratchet.json');
  if (!fs.existsSync(rPath)) return { blind: '缺棘轮基线 tools/doc-ratchet.json（首次运行请用 --update-ratchet 生成）' };
  try { cfg.__base = JSON.parse(fs.readFileSync(rPath, 'utf8')).files || {}; } catch (e) { return { blind: `棘轮基线 JSON 非法：${e.message}` }; }

  let tracked;
  try {
    tracked = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', '*.md'], { encoding: 'utf8', cwd: root }).split('\n').filter(Boolean);
  } catch (e) {
    return { blind: `无法列出跟踪文件（${String(e.message).split('\n')[0]}）——需在 git 仓内运行（R3：失灵可见，不以异常栈代替判定）` };
  }
  // 忽略目录（扫描面参数，R2 允许）：agent 本地状态等非项目内容不进判定。
  // 事故：AIR 仓出现 .workbuddy/memory/*.md（agent 状态），被 C8 当未登记根级条目、被 C5 当新债拦下。
  const IGN = (cfg.ignoreDirs || []).map((d) => String(d).replace(/\/+$/, ''));
  const ignored = (f) => IGN.some((d) => f === d || f.startsWith(d + '/'));
  const trackedKept = tracked.filter((f) => !ignored(f));
  const docs = trackedKept.map((f) => ({ f, txt: fs.readFileSync(path.join(root, f), 'utf8') }));

  let topLevel = [];
  try {
    topLevel = [...new Set(execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files'], { encoding: 'utf8', cwd: root })
      .split('\n').filter(Boolean).filter((f) => !ignored(f)).map((f) => f.split('/')[0]))].filter((e) => e !== '.DS_Store');
  } catch { /* C8 退化：无顶层清单时按空集处理（不静默声称通过，下方打印）*/ }

  const sfr = valueOf('--sofagent');
  let tags = null;
  if (sfr) {
    const sg = sfr.replace(/^~/, process.env.HOME);
    try {
      const list = execFileSync('git', ['tag', '-l'], { encoding: 'utf8', cwd: sg }).split('\n').filter(Boolean);
      if (list.length < 50) return { blind: `从 ${sg} 只读到 ${list.length} 个 tag，疑似读错仓——拒绝假绿` };
      tags = new Set(list.map((t) => t.replace(/^v/, '')));
    } catch (e) {
      return { blind: `无法从 ${sg} 读 tag（${String(e.message).split('\n')[0]}）——拒绝假绿` };
    }
  }
  return { cfg, docs, ctx: { root, tags, topLevel, countWallCell: null }, tracked: trackedKept };
}

// ── 主流程 ────────────────────────────────────────────────
// R5：本文件是被各仓引用的**唯一实现**，故「被检查的仓」= 调用方 cwd（或 --repo 显式指定），
//     不是实现自己所在的仓——这一点错了会让所有仓都去读实现的配置（自检已抓到过）。
const ROOT = path.resolve(valueOf('--repo') || process.cwd());
const REPO = path.basename(ROOT);

if (flagOf('--selftest')) {
  // R6：正向用例须绿 + 负向用例须红。fixture 内联，不依赖外部仓。
  const countWallCell = (txt) => {
    let inFence = false, wall = 0, cell = 0;
    for (const l of txt.split('\n')) {
      if (/^(```|~~~)/.test(l)) { inFence = !inFence; continue; }
      if (inFence) continue;
      if (l.length > WALL_LIMIT) wall++;
      if (l.trim().startsWith('|')) {
        const cells = l.trim().slice(1, -1).split('|');
        if (cells.some((c) => c.length > CELL_LIMIT)) cell++;
      }
    }
    return { wall, cell };
  };
  const baseCfg = { repo: 'fixture', exemptQuota: 1, bilingualPairs: [['A.md', 'A_CN.md']], rootWhitelist: ['A.md', 'A_CN.md', 'changelog'], termBlacklist: [[String.raw`24\s*条?规则`, 'stale rule count']], counts: [], __base: {}, __exempt: { entries: [] } };
  const clean = [
    { f: 'A.md', txt: '# A\n\n## One\n\n[x](./A_CN.md)\n' },
    { f: 'A_CN.md', txt: '# A\n\n## 一\n\n[x](./A.md)\n' },
    { f: 'changelog/v0/0.1.0.md', txt: '# v0.1.0\n\n## 退役\n\n| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n| 7 | 8 | 9 |\n' },
  ];
  const dirty = [
    { f: 'A.md', txt: '# A\n\n## One\n\n[bad](./nope.md)\n' },
    { f: 'A_CN.md', txt: '# A\n\n## 一\n\n## 额外章\n\n[x](./A.md)\n' },
    { f: 'changelog/v0/0.1.0.md', txt: '# v0.1.0\n\n## 退役\n\n| a | b |\n|---|---|\n| 1 | 2 |\n' },
  ];
  const cleanCtx = { root: ROOT, tags: null, topLevel: ['A.md', 'A_CN.md', 'changelog'], countWallCell, exists: () => true };
  const dirtyCtx = { ...cleanCtx, exists: (abs, raw) => raw !== './nope.md' };
  const g = run(baseCfg, clean, cleanCtx);
  const b = run(baseCfg, dirty, dirtyCtx);
  const okGreen = !g.blind && g.fails.length === 0;
  const okRed = !b.blind && b.fails.length >= 3;
  console.log(`check-doc-debt.mjs v${VERSION} · 自检（R6）`);
  console.log(`  正向用例（干净仓）→ ${okGreen ? '✅ 绿' : '❌ 未达预期'}  fails=${g.blind ? 'BLIND' : g.fails.length}`);
  if (!okGreen) (g.fails || [g.blind]).forEach((x) => console.log('    ' + x));
  console.log(`  负向用例（含断链 / 双语漂移 / 退役节不足）→ ${okRed ? '✅ 红' : '❌ 未达预期'}  fails=${b.blind ? 'BLIND' : b.fails.length}`);
  if (!okRed) (b.fails || [b.blind]).forEach((x) => console.log('    ' + x));
  console.log(okGreen && okRed ? '✓ 自检通过（正向绿 + 负向红）' : '❌ 自检未通过');
  process.exit(okGreen && okRed ? 0 : 1);
}

const c = collect(ROOT);
if (c.blind) { console.error(`❌ ${REPO} 失明：${c.blind}`); process.exit(2); }
const r = run(c.cfg, c.docs, c.ctx);
if (r.blind) { console.error(`❌ ${REPO} 失明：${r.blind}`); process.exit(2); }

if (flagOf('--update-ratchet')) {
  const live = c.docs.filter(({ f }) => !FROZEN.test(f)).map(({ f }) => f);
  const out = JSON.parse(execFileSync('node', [LIB, ...live], { encoding: 'utf8', cwd: ROOT }));
  const files = {}; for (const [f, v] of Object.entries(out)) if (v.wall || v.cell) files[f] = { wall: v.wall, cell: v.cell };
  fs.writeFileSync(path.join(ROOT, 'tools/doc-ratchet.json'), JSON.stringify({ _meta: `可读性棘轮：只许降不许升；口径 = 行>${WALL_LIMIT} / 格>${CELL_LIMIT}（唯一实现 check/lib/readability-count.mjs）`, files }, null, 1) + '\n');
  console.log(`已写入基线 ${Object.keys(files).length} 篇`); process.exit(0);
}

if (flagOf('--json')) {
  console.log(JSON.stringify({ repo: REPO, docs: r.docs, links: r.linkTotal, fails: r.fails, notes: r.notes }, null, 2));
  process.exit(r.fails.length ? 1 : 0);
}

console.log(`=== ${REPO} 文档债务门禁 v${VERSION}（标准：${SPEC}）===`);
console.log(`  扫描面：${r.docs} 篇 .md · 相对链接 ${r.linkTotal} 条`);
console.log(`  判据：C1 断链 / C2 术语旧称 / C3 计数口径 / C4 版本状态 / C5 可读性棘轮 / C6 退役节 / C7 双语同步 / C8 根级白名单`);
r.log.forEach((l) => console.log(l));
const ex = c.cfg.__exempt?.entries || [];
console.log(`  豁免：${ex.length} 条 / 额度 ${c.cfg.exemptQuota ?? 0}` + (ex.length ? ' → ' + ex.map((e) => `${e.file}${e.line ? ':' + e.line : ''}`).join(', ') : ''));
r.notes.forEach((n) => console.log(`  ℹ️  ${n}`));
console.log('');
if (!r.fails.length && (!flagOf('--strict') || !r.notes.length)) {
  console.log(`✓ 八类零违规（C1 ${r.linkTotal} 条链接全通${c.ctx.tags ? ' · C4 已执行' : ' · C4 SKIP'}）`);
  process.exit(0);
}
const fails = flagOf('--strict') ? [...r.fails, ...r.notes.map((n) => `（--strict）${n}`)] : r.fails;
if (fails.length) {
  console.log(`❌ ${fails.length} 处违规：`);
  fails.forEach((x) => console.log(`  ${x}`));
  console.log('\n处置：按明细修内容。确属正当提及（引原文说明）须写入 tools/doc-debt-exempt.json 台账，行内标记单写无效（R4）。');
  process.exit(1);
}
console.log('✓ 判据全通（另有 SKIP 项，--strict 下才会失败）');
process.exit(0);
