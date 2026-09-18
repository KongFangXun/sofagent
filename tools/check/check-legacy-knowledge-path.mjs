#!/usr/bin/env node
// ============================================================
// tools/check/check-legacy-knowledge-path.mjs · 知识库旧路径残留守卫（v1.4.9 P1-14）
// ============================================================
//
// ── 背景 ──
// v1.2.1「数据目录重构」把知识库从 `.sofagent/knowledge/` 迁到 `data/knowledge/`
// （见 docs/changelog/v1.2/v1.2.1.md 迁移映射表；真值 SSOT = engine/core/src/data-paths.ts
// 的 `resolveKnowledgeDir()` → `{SOFAGENT_HOME}/data/knowledge`）。该次重构**收口漏网**：
// 多处引擎代码仍按旧路径手拼字符串 ⇒ 生产环境（调用方传 process.cwd()）恒读不到真实知识库，
// knowledge 相关巡检（conflict-check / knowledge-health / knowledge-freshness /
// ontology-coverage / knowledge-status）长期静默哑火——「机制在跑、结果永远 info」。
//
// ── 本守卫要杀的形态 ──
// 旧路径有**两种书写形态**，只查第一种就是本仓反复出现的「语义盲区」缺陷：
//   ① 连写形态：`join(cwd, '.sofagent/knowledge')` / 文档里的 `.sofagent/knowledge/`
//   ② 分离形态：`join(cwd, '.sofagent', 'knowledge')`——行内两个独立字符串字面量
//      首扫（`grep '\.sofagent/knowledge'`）对形态 ② **零命中**（P1-14 实测：漏 12 处）。
// 两种形态必须同面覆盖，否则盲区在门禁里原样重演。
//
// ── 三条判据（为什么这样设计）──
//   ① 扫描面 = `git ls-files`（**tracked 文件**），而非工作区遍历。
//      理由：`.sofagent/`（含 .git-shadow/snapshots.json 快照）与 `.workbuddy/` 是
//      git-ignored 的本地运行时/会话产物，不是仓库内容——工作区遍历会把 snapshot 里
//      被快照的历史文本读成「活区命中」（P1-14 实测：单 snapshots.json 就产生 32 处噪声）。
//      以 tracked 为面，噪声按定义消失，且与「仓库门禁只对仓库内容负责」一致。
//   ② 派生产物 `dist/` 排除——dist 不入 git（实测 tracked dist 文件 0 个），
//      已由判据 ① 天然排除；仍显式保留过滤，防未来有人把 dist 入库后噪声回归。
//   ③ 历史冻结区（docs/changelog/**、docs/archive/**、*/evidence/**）豁免——
//      它们是**历史事实**（旧路径在当时就是真值），改了等于篡改历史记录。
//
// ── 双面判定 ──
//   【Face 1 · 阻塞面】非注释行命中（活代码的路径构造 + 活文档的用户可见路径）。
//     集合必须与豁免台账 tools/check/knowledge-legacy-path-exempt.json **逐文件逐计数相等**：
//       · 台账外的新命中 ⇒ FAIL（新增旧路径引用被拦）
//       · 计数变化 ⇒ FAIL（新增/删除命中都须重新登记，禁止悄悄放宽）
//       · 台账里已归零的条目 ⇒ FAIL（陈旧豁免 = 橡皮章）
//   【Face 2 · 注释面】注释行命中（源码里引述旧路径的历史说明）。
//     **不阻塞**，但**必须逐条打印**（ℹ️ 行）——理由：注释无法与「陈旧断言」机械区分
//     （「本处原按旧路径读」和「本处按旧路径读」字面同形），若阻塞会逼迫作者改写
//     合法的历史沿革注释；若不打印则成为隐形豁免。故取「可见但非阻塞」。
//     ⚠️ 这是**已知的、明示的**残余盲区：新增一条**陈旧注释**不会被本守卫拦下。
//        它不是本守卫的职责面（本守卫管「代码/文档是否还指向旧路径」，
//        不管「注释措辞是否已过时」——后者属人工/文档审查面）。
//
// ── 装置面（本守卫自身的两个文件 · 明示且受约束）──
// 本守卫**必须**引用它要禁止的那个字面量：① 脚本里要写模式定义、selftest 探针样本与
// 提示文案；② 台账里要写「豁免的是哪条旧路径」——理由不说清引用对象就没有审查价值。
// 「在不写出该字面量的前提下禁止该字面量」不可实现，故单立一面：
//   · 不计入 Face 1 / Face 2，**但每次运行都打印实际处数**（不是隐形豁免）；
//   · 由 N5 断言刚性约束：恰 2 条、必须在 `tools/check/` 下、必须 git tracked 存在、
//     不得与豁免台账重复记账 —— 任一不成立 ⇒ exit 2（拒绝假绿）；
//   · selftest P10/P11 证明它是**按路径精确**判定，而不是按内容放宽：
//     同一段文本放在 `engine/**` 下必须仍进 Face 1。
//   ⚠️ 明示承认的残余盲区：往这 2 个装置文件里写**真正的**路径构造，本守卫不拦
//      （这两个文件的职责是定义/记账，不是构造路径；越界风险由 N5 的路径前缀约束兜住）。
//
// ── 负向断言（不许静默通过）──
//   N1 扫描面完整性：tracked 文件数为 0、或 SSOT（data-paths.ts）缺失、
//      或其中已无 `resolveKnowledgeDir` 导出 ⇒ 检查器失明 ⇒ exit 2（拒绝假绿）。
//      含**形态 ③ 能力探针**：合成锚点样本（跨行分离）必须被 `matchCrossLine` 识别，
//      识别不到 ⇒ 该形态判定静默归零 ⇒ exit 2（提取为空不许静默，v1.4.9 G-9 并入）。
//   N2 自相矛盾：台账非空却零命中 ⇒ FAIL（豁免清单在为一个不存在的命中背书）。
//   N3 台账空 + 零命中 ⇒ 打印可见 SKIP 行（不是静默绿）。
//   N4 `--selftest`：双向合成探针——把「应该判违规」和「应该判合规」的样本喂给同一
//      判定函数逐条比对（见 selftest()）
//   N5 装置面不变量：见上节（缺失/越界/重复记账/条数异常 ⇒ exit 2）
//
// ── 退出码（三态，对齐 check-seam-contract / check-cross-package-relative）──
//   0 = 绿（可含可见 SKIP）
//   1 = 有未登记命中 / 台账漂移 / 陈旧豁免
//   2 = 检查器失明（扫描面或 SSOT 结构缺失、装置面不变量被打破
//       ——拒绝把「读不到」当成「零违规」）
//
// 用法：
//   node tools/check/check-legacy-knowledge-path.mjs             # 正常检查
//   node tools/check/check-legacy-knowledge-path.mjs --selftest  # 判定逻辑自测
// ============================================================

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SELF_DIR, '..', '..');
const LEDGER_REL = 'tools/check/knowledge-legacy-path-exempt.json';
const SSOT_REL = 'engine/core/src/data-paths.ts';

/** 参与扫描的文本类扩展名（二进制/资源文件不扫） */
const SCAN_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.md', '.mdc', '.sh', '.bash',
  '.yml', '.yaml', '.txt', '.html', '.css',
]);

/** 历史冻结区（旧路径在当时为真值，豁免；改之 = 篡改历史） */
const HISTORICAL_RES = [
  /^docs\/changelog\//,
  /^docs\/archive\//,
  /(^|\/)evidence\//,
  /^\.workbuddy\//, // 本地会话归档（git-ignored，此处为防御性保留）
  /^\.sofagent\//, // 本地运行时产物（git-ignored，同上）
];

/** 派生产物（不入 git；已由 tracked 扫描面天然排除，此处为防御性保留） */
const DERIVED_RES = [/(^|\/)dist\//, /(^|\/)node_modules\//];

/**
 * 装置面：本守卫**自身**、必须引用被禁字面量的两个文件（见文件头「装置面」）。
 * 只允许列 `tools/check/` 下的路径——否则业务文件可被塞进来洗白（N5 断言）。
 */
const APPARATUS_RELS = [
  'tools/check/check-legacy-knowledge-path.mjs', // 模式定义 + selftest 探针样本 + 提示文案
  'tools/check/knowledge-legacy-path-exempt.json', // 豁免理由（必须点名豁免的是哪条旧路径）
];
const APPARATUS_SET = new Set(APPARATUS_RELS);
const APPARATUS_DIR_PREFIX = 'tools/check/';
const APPARATUS_EXPECTED_LEN = 2;

/** 判定「注释行」的语言集合——只有这些扩展名才做注释分类 */
const COMMENT_AWARE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.sh', '.bash', '.yml', '.yaml', '.css']);

/** 旧路径形态 ① ：连写（`.sofagent/knowledge` 或反斜杠变体） */
const PAT_CONNECTED = /\.sofagent[\/\\]knowledge/;
/** 旧路径形态 ② ：分离字面量（同一行出现带引号的 '.sofagent' 与 'knowledge'） */
const PAT_ANCHOR = /['"`]\.sofagent['"`]/;
const PAT_KNOWLEDGE = /['"`]knowledge['"`]/;

// ── 旧路径形态 ③ ：跨行分离（v1.4.9 G-9 并入）──────────────────
// 形态 ①② 都是**行内**判定，于是漏掉了最隐蔽也最真实的一类：
//     const skillDir = path.join(projectRoot, '.sofagent');   ← 锚点行（无 knowledge）
//     const knowledgeDir = path.join(skillDir, 'knowledge');   ← 使用行（无 .sofagent）
// 两行各自都不命中，**整条旧路径却成立**——这正是 P1-14「收口漏网」的第三形态。
// 实测（加入前）：全仓 3 文件 4 处全部不可见，含 engine/core 一处**真残留**。
// 判定规则（**同文件内两步**，不做跨文件推断——避免把「碰巧同名」算成旧路径）：
//   ① 收集本文件里「赋值右侧含 `'.sofagent'` 字面量」的变量名（锚点变量）
//   ② 找 `join(<锚点变量>, 'knowledge')` 的调用行
// 保守性：只认 join(...) 形态 + 变量名精确匹配 ⇒ 不会把 `join(x, 'knowledge')`（x 无锚点）误判。
const ANCHOR_DEF = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=[^\n]*['"`]\.sofagent['"`]/;

/**
 * 形态 ③ 判定：返回该文件里 `join(<锚点变量>, 'knowledge')` 的所有命中行。
 * @param {string} rel 相对路径（供注释行判定）
 * @param {string} text 文件内容
 * @returns {Array<{rel:string,line:number,text:string,forms:string[]}>}
 */
export function matchCrossLine(rel, text) {
  const lines = text.split('\n');
  const anchored = new Set();
  for (const line of lines) {
    const m = line.match(ANCHOR_DEF);
    if (m) anchored.add(m[1]);
  }
  if (anchored.size === 0) return [];
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentLine(rel, line)) continue; // 注释面的同类命中留给形态 ①② 的注释面打印
    for (const v of anchored) {
      const re = new RegExp(`\\bjoin\\(\\s*${v.replace(/\$/g, '\\$')}\\s*,\\s*['"\`]knowledge['"\`]`);
      if (re.test(line)) {
        out.push({ rel, line: i + 1, text: line.trim().slice(0, 160), forms: ['cross-line'] });
        break; // 一行只记一次（多锚点变量命中同一行不重复计数）
      }
    }
  }
  return out;
}

/** 行首注释标记 */
const COMMENT_RE = /^\s*(\/\/|#|\*|\/\*|<!--)/;

const isHistorical = (rel) => HISTORICAL_RES.some((re) => re.test(rel));
const isDerived = (rel) => DERIVED_RES.some((re) => re.test(rel));
/** 装置面是按**路径精确**判定（内容不得成为放宽依据——selftest P10/P11 锁此性质） */
const isApparatus = (rel) => APPARATUS_SET.has(rel);
const extOf = (rel) => path.extname(rel).toLowerCase();

/**
 * 判定单行是否同时命中两种旧路径形态。
 * @returns {{hit: boolean, forms: string[]}}
 */
export function matchLine(line) {
  const forms = [];
  if (PAT_CONNECTED.test(line)) forms.push('connected');
  if (PAT_ANCHOR.test(line) && PAT_KNOWLEDGE.test(line)) forms.push('separated');
  return { hit: forms.length > 0, forms };
}

/** 判定该行是否为注释行（仅对支持注释的语言生效） */
export function isCommentLine(rel, line) {
  if (!COMMENT_AWARE_EXTS.has(extOf(rel))) return false;
  return COMMENT_RE.test(line);
}

/**
 * 装置面不变量（N5）：可注入校验，供 selftest 用合成样本比对。
 * @param {Set<string>} trackedRels 扫描面内实际存在的文件
 * @param {Set<string>} ledgerRels 豁免台账键集合
 * @param {string[]} list 待校验的装置面清单
 * @returns {string[]} 违规原因（空数组 = 合规）
 */
export function apparatusViolations(trackedRels, ledgerRels, list = APPARATUS_RELS) {
  const out = [];
  if (list.length !== APPARATUS_EXPECTED_LEN) {
    out.push(`装置面应恰 ${APPARATUS_EXPECTED_LEN} 条，实测 ${list.length} 条`);
  }
  for (const rel of list) {
    if (!rel.startsWith(APPARATUS_DIR_PREFIX)) {
      out.push(`装置面越界：${rel} 不在 ${APPARATUS_DIR_PREFIX} 下（禁止把业务文件塞进装置面）`);
    }
    if (!trackedRels.has(rel)) {
      out.push(`装置面文件缺失或未被 git tracked：${rel}`);
    }
    if (ledgerRels.has(rel)) {
      out.push(`装置面文件同时出现在豁免台账中（重复记账）：${rel}`);
    }
  }
  return out;
}

/**
 * 对「文件 → 内容」映射做分类扫描（可注入，供 selftest 用内存样本）。
 * 四个桶互斥：apparatus（装置面）> historical（历史冻结）> derived（派生，直接跳过）
 * 优先级不影响结果，但 apparatus 必须先判，否则装置面会被算进 code。
 * @returns {{code: Array, comment: Array, historical: Array, apparatus: Array, scanned: number}}
 */
export function scanContent(entries) {
  const code = [];
  const comment = [];
  const historical = [];
  const apparatus = [];
  let scanned = 0;
  for (const [rel, text] of entries) {
    if (isDerived(rel)) continue;
    if (isApparatus(rel)) {
      // 装置面：逐条计数供可见化打印，但不进任何判定面
      let n = 0;
      for (const line of text.split('\n')) if (matchLine(line).hit) n++;
      if (n > 0) apparatus.push({ rel, count: n });
      continue;
    }
    if (isHistorical(rel)) {
      // 历史区仍计数（供报告用），但不参与判定
      let n = 0;
      for (const line of text.split('\n')) if (matchLine(line).hit) n++;
      if (n > 0) historical.push({ rel, count: n });
      continue;
    }
    scanned++;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = matchLine(line);
      if (!m.hit) continue;
      const rec = { rel, line: i + 1, text: line.trim().slice(0, 160), forms: m.forms };
      if (isCommentLine(rel, line)) comment.push(rec);
      else code.push(rec);
    }
    // 形态 ③（跨行分离）：锚点行与使用行各自不命中，须在**文件级**补判（v1.4.9 G-9 并入）
    for (const rec of matchCrossLine(rel, text)) code.push(rec);
  }
  return { code, comment, historical, apparatus, scanned };
}

/** 汇总「文件 → 命中计数」 */
function countByFile(hits) {
  const out = new Map();
  for (const h of hits) out.set(h.rel, (out.get(h.rel) ?? 0) + 1);
  return out;
}

/** 读取台账 */
function loadLedger() {
  const abs = path.join(ROOT, LEDGER_REL);
  if (!fs.existsSync(abs)) return { ok: false, reason: `台账缺失：${LEDGER_REL}` };
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (err) {
    return { ok: false, reason: `台账不可解析：${LEDGER_REL}（${err instanceof Error ? err.message : String(err)}）` };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: `台账结构应为「文件路径 → {count, reason}」对象：${LEDGER_REL}` };
  }
  const entries = new Map();
  for (const [rel, val] of Object.entries(raw)) {
    if (val === null || typeof val !== 'object' || typeof val.count !== 'number' || typeof val.reason !== 'string') {
      return { ok: false, reason: `台账条目格式非法（需 {count:number, reason:string}）：${rel}` };
    }
    entries.set(rel, val);
  }
  return { ok: true, entries };
}

/** 读取 tracked 扫描面 */
function loadTrackedEntries() {
  const out = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  const entries = [];
  for (const rel of out) {
    if (!SCAN_EXTS.has(extOf(rel))) continue;
    if (isDerived(rel)) continue;
    const abs = path.join(ROOT, rel);
    let text;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      continue; // 不可读文件跳过（下次仍会被扫，不构成静默豁免）
    }
    entries.push([rel, text]);
  }
  return { totalTracked: out.length, entries };
}

function emitCoverage(asserts, covered, skipped) {
  console.log(`[check:coverage] script=check-legacy-knowledge-path asserts=${asserts} covered=${covered} skipped=${skipped}`);
}

const SKIP_TOKEN = '\u23ed\ufe0f'; // ⏭️

/** 正常检查 */
function main() {
  let asserts = 0;
  let skipped = 0;

  const tracked = loadTrackedEntries();

  // ── N1 扫描面完整性（失明 ⇒ exit 2，拒绝假绿）──
  const ssotAbs = path.join(ROOT, SSOT_REL);
  const ssotText = fs.existsSync(ssotAbs) ? fs.readFileSync(ssotAbs, 'utf8') : '';
  const blindReasons = [];
  if (tracked.totalTracked === 0) blindReasons.push('git ls-files 返回 0 个 tracked 文件（扫描面为空）');
  if (tracked.entries.length === 0) blindReasons.push('扫描面内无任何可读文本文件');
  if (!fs.existsSync(ssotAbs)) blindReasons.push(`SSOT 缺失：${SSOT_REL}`);
  else if (!/export\s+function\s+resolveKnowledgeDir\s*\(/.test(ssotText)) {
    blindReasons.push(`${SSOT_REL} 中已无 resolveKnowledgeDir 导出（本守卫的判定前提失效）`);
  }
  // ── 形态 ③ 能力自检（提取为空 ⇒ FAIL，不许静默）──
  // 形态 ③（跨行分离）完全依赖 ANCHOR_DEF 能识别锚点变量。若该正则被改坏/删除，
  // 形态 ③ 会**静默退回 0 命中**：已登记的「仅形态 ③ 可见」条目虽会变成陈旧豁免，
  // 但那依赖台账恰好含此类条目——是**被动**发现。此处做**主动能力探针**：
  // 合成样本必须被识别，否则判定能力已失明 ⇒ exit 2（拒绝假绿）。
  const PROBE_ANCHOR_REL = 'probe-cross-line.ts';
  const PROBE_ANCHOR_TEXT = [
    "const probeSkillDir = path.join(root, '.sofagent');",
    "const probeKnowledgeDir = path.join(probeSkillDir, 'knowledge');",
  ].join('\n');
  if (matchCrossLine(PROBE_ANCHOR_REL, PROBE_ANCHOR_TEXT).length === 0) {
    blindReasons.push(
      '形态 ③（跨行分离）能力探针失效：合成锚点样本未被识别（ANCHOR_DEF 已被改坏/删除 ⇒ 该形态判定静默归零）',
    );
  }

  if (blindReasons.length > 0) {
    console.log('❌ check-legacy-knowledge-path 检查器失明（拒绝假绿）：');
    for (const r of blindReasons) console.log(`    · ${r}`);
    emitCoverage(asserts, 0, skipped);
    process.exit(2);
  }

  const ledger = loadLedger();
  if (!ledger.ok) {
    console.log(`❌ check-legacy-knowledge-path 台账不可用（拒绝假绿）：${ledger.reason}`);
    emitCoverage(asserts, tracked.entries.length, skipped);
    process.exit(2);
  }

  // ── N5 装置面不变量（豁免装置自身必须可见、可证、不可扩张）──
  const apparatusBlind = apparatusViolations(
    new Set(tracked.entries.map(([rel]) => rel)),
    new Set(ledger.entries.keys()),
  );
  if (apparatusBlind.length > 0) {
    console.log('❌ check-legacy-knowledge-path 装置面不变量被打破（拒绝假绿）：');
    for (const r of apparatusBlind) console.log(`    · ${r}`);
    emitCoverage(asserts, 0, skipped);
    process.exit(2);
  }

  const { code, comment, historical, apparatus, scanned } = scanContent(tracked.entries);
  const codeByFile = countByFile(code);

  // ── N3 台账空 + 零命中 ⇒ 可见 SKIP（不静默绿）──
  if (ledger.entries.size === 0 && codeByFile.size === 0) {
    asserts += 1;
    console.log(`${SKIP_TOKEN} 旧路径零命中且豁免台账为空——无非注释面命中可判定（台账工具当前为空）`);
    skipped += 1;
    emitCoverage(asserts, scanned, skipped);
    process.exit(0);
  }

  // ── N2 自相矛盾：台账非空却零命中 ⇒ FAIL ──
  if (ledger.entries.size > 0 && codeByFile.size === 0) {
    asserts += 1;
    console.log(`❌ 自相矛盾：豁免台账非空（${ledger.entries.size} 条）但非注释面**零命中**——`);
    console.log('    台账在为一个不存在的命中背书（豁免清单已成橡皮章）。');
    console.log('    处置：确认代码已全部收口后，把知识库旧路径台账条目清空，再复跑本守卫。');
    for (const [rel, v] of ledger.entries) console.log(`    · 陈旧豁免：${rel}（登记 count=${v.count}，实测 0）`);
    emitCoverage(asserts, scanned, skipped);
    process.exit(1);
  }

  // ── Face 1：非注释面集合必须与台账逐文件逐计数相等 ──
  const unregistered = [];
  const drifted = [];
  for (const [rel, n] of codeByFile) {
    const reg = ledger.entries.get(rel);
    if (!reg) unregistered.push({ rel, n });
    else if (reg.count !== n) drifted.push({ rel, n, reg });
  }
  const stale = [];
  for (const [rel, v] of ledger.entries) {
    if (!codeByFile.has(rel)) stale.push({ rel, v });
  }

  if (unregistered.length === 0 && drifted.length === 0 && stale.length === 0) {
    asserts += 1;
    console.log(`  ✓ 旧路径非注释面命中 ${codeByFile.size} 个文件全部在豁免台账内且计数一致（扫描面 ${scanned} 个 tracked 文本文件）`);
  } else {
    asserts += 1;
    console.log('❌ 知识库旧路径（`.sofagent/knowledge`）非注释面命中与豁免台账不一致：');
    for (const u of unregistered) {
      console.log(`    · 未登记命中：${u.rel}（${u.n} 处）`);
    }
    for (const d of drifted) {
      console.log(`    · 计数漂移：${d.rel}（台账 ${d.reg.count} / 实测 ${d.n}）`);
    }
    for (const s of stale) {
      console.log(`    · 陈旧豁免：${s.rel}（台账 ${s.v.count} / 实测 0）`);
    }
    console.log('    处置：① 真收口 → 删除对应台账条目；② 确属合法豁免（用户可见路径示例/待修）');
    console.log(`         → 在 ${LEDGER_REL} 更新条目并写明理由。`);
    console.log('    ⚠️ 严禁为了变绿而改台账计数而不收口——台账逐条承重由本守卫的集合相等判定保证。');
    for (const u of unregistered.slice(0, 10)) console.log(`      ${u.rel}:${''} 首现于扫描（含连写与分离两种形态）`);
    emitCoverage(asserts, scanned, skipped);
    process.exit(1);
  }

  // ── Face 2：注释面（可见、不阻塞——口径见文件头「双面判定」）──
  if (comment.length > 0) {
    const cbf = countByFile(comment);
    console.log(`  ℹ️ 注释面命中 ${comment.length} 行 / ${cbf.size} 文件（历史沿革说明，不阻塞；逐条列出供审查）：`);
    for (const [rel, n] of [...cbf].sort()) console.log(`      · ${rel}（${n} 行）`);
  } else {
    console.log('  ℹ️ 注释面无旧路径命中');
  }

  // ── 装置面可见化（豁免不是隐形的：逐次打印实际处数，并由 N5 刚性约束）──
  const appTotal = apparatus.reduce((a, x) => a + x.count, 0);
  if (appTotal > 0) {
    console.log(`  ℹ️ 装置面（不做判定，仅可见）命中 ${appTotal} 处 / ${apparatus.length} 文件：`);
    for (const a of apparatus) console.log(`      · ${a.rel}（${a.count} 处）`);
    console.log('      理由：模式定义与台账理由必须引用被禁字面量本身，否则本守卫无法定义它要禁的东西。');
    console.log(`      约束：装置面仅允许 ${APPARATUS_DIR_PREFIX} 下的这 ${APPARATUS_EXPECTED_LEN} 个文件；`);
    console.log('           缺失 / 越界 / 与台账重复记账 ⇒ exit 2（N5）。');
  } else {
    console.log('  ℹ️ 装置面零命中（模式定义可能已改为拼接构造）——判定面不受影响，台账承重由 N2 单独把关');
  }

  // ── 排除面可见化（证明豁免不是隐形的）──
  const histTotal = historical.reduce((a, h) => a + h.count, 0);
  console.log(`  ℹ️ 历史冻结区命中 ${histTotal} 处 / ${historical.length} 文件（docs/changelog、docs/archive、evidence —— 历史事实，豁免）`);

  emitCoverage(asserts, scanned, skipped);
  process.exit(0);
}

// ============================================================
// --selftest：双向合成探针
// ============================================================
function selftest() {
  const results = [];
  const ok = (name, cond) => results.push({ name, pass: !!cond });

  // 探针 1：连写形态（代码）→ 必须判 NON-COMMENT 命中
  {
    const { code, comment } = scanContent([
      ['src/a.ts', `const knowledgeDir = join(dir, '.sofagent/knowledge');`],
    ]);
    ok('P1 连写形态（代码）被判非注释面命中', code.length === 1 && comment.length === 0);
    ok('P1 命中形态标记含 connected', code[0]?.forms.includes('connected') === true);
  }

  // 探针 2：分离形态（代码）→ 必须判 NON-COMMENT 命中（首扫盲区形态）
  {
    const { code, comment } = scanContent([
      ['src/b.ts', `const knowledgeDir = join(projectDir, '.sofagent', 'knowledge');`],
    ]);
    ok('P2 分离形态（代码）被判非注释面命中', code.length === 1 && comment.length === 0);
    ok('P2 命中形态标记含 separated', code[0]?.forms.includes('separated') === true);
  }

  // 探针 3：注释行 → 必须归入注释面（不阻塞），不得混入非注释面
  {
    const { code, comment } = scanContent([
      ['src/c.ts', `  // 本处原按 .sofagent/knowledge 读取，v1.2.1 后迁至 data/knowledge`],
    ]);
    ok('P3 注释行归入注释面', comment.length === 1 && code.length === 0);
  }

  // 探针 4：历史冻结区 → 既不进非注释面也不进注释面
  {
    const { code, comment, historical } = scanContent([
      ['docs/changelog/v1.2/v1.2.1.md', '| `.sofagent/knowledge/` | `data/knowledge/` | 知识库 |'],
    ]);
    ok('P4 历史冻结区不计入判定面', code.length === 0 && comment.length === 0 && historical.length === 1);
  }

  // 探针 5：派生产物 → 跳过
  {
    const { code, scanned } = scanContent([
      ['engine/core/dist/federation.js', `const knowledgeDir = join(dir, '.sofagent', 'knowledge');`],
      ['src/ok.ts', 'const x = 1;'],
    ]);
    ok('P5 dist 派生产物被排除', code.length === 0 && scanned === 1);
  }

  // 探针 6：文档（.md）无注释豁免概念 → 命中必须计入非注释面
  {
    const { code, comment } = scanContent([
      ['docs/guides/x.md', '> 读写 `~/.sofagent/knowledge/` 目录'],
    ]);
    ok('P6 .md 命中计入非注释面（无注释豁免）', code.length === 1 && comment.length === 0);
  }

  // 探针 7：注释标记在 .md 中不生效（# 是标题不是注释）
  {
    const { code } = scanContent([
      ['docs/guides/y.md', '# 关于 .sofagent/knowledge 的说明'],
    ]);
    ok('P7 .md 行首 # 不当作注释', code.length === 1);
  }

  // 探针 8：集合相等判定承重——未登记 / 计数漂移 / 陈旧豁免三态各自可判
  {
    const detect = (hits, entries) => {
      const byFile = countByFile(hits);
      const unregistered = [];
      const drifted = [];
      const stale = [];
      for (const [rel, n] of byFile) {
        const reg = entries.get(rel);
        if (!reg) unregistered.push(rel);
        else if (reg.count !== n) drifted.push(rel);
      }
      for (const rel of entries.keys()) if (!byFile.has(rel)) stale.push(rel);
      return { unregistered, drifted, stale };
    };
    const hit = (rel) => ({ rel, line: 1, text: '', forms: ['connected'] });
    const d1 = detect([hit('a.ts')], new Map());
    const d2 = detect([hit('a.ts'), hit('a.ts')], new Map([['a.ts', { count: 1, reason: 'x' }]]));
    const d3 = detect([hit('a.ts')], new Map([['a.ts', { count: 1, reason: 'x' }], ['gone.ts', { count: 2, reason: 'y' }]]));
    ok('P8a 未登记命中可判', d1.unregistered.length === 1 && d1.drifted.length === 0 && d1.stale.length === 0);
    ok('P8b 计数漂移可判', d2.drifted.length === 1 && d2.unregistered.length === 0);
    ok('P8c 陈旧豁免可判', d3.stale.length === 1 && d3.unregistered.length === 0 && d3.drifted.length === 0);
  }

  // 探针 9：台账条目结构校验拒绝非法形态
  {
    const bad = [];
    const validate = (raw) => {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return false;
      for (const [, v] of Object.entries(raw)) {
        if (v === null || typeof v !== 'object' || typeof v.count !== 'number' || typeof v.reason !== 'string') return false;
      }
      return true;
    };
    bad.push(validate([]) === false);
    bad.push(validate({ 'a.ts': { count: 1 } }) === false);
    bad.push(validate({ 'a.ts': { count: 1, reason: 'r' } }) === true);
    ok('P9 台账结构校验（拒数组 / 拒缺 reason / 收合法）', bad.every(Boolean));
  }

  // 探针 10/11：装置面必须**按路径精确**，不得变成内容级放宽（本批新增）
  {
    const body = `const knowledgeDir = join(dir, '.sofagent/knowledge');`;
    const onApparatus = scanContent([[APPARATUS_RELS[0], body]]);
    const onBusiness = scanContent([['engine/core/src/whatever.ts', body]]);
    ok(
      'P10 同内容放在装置面路径 → 计入 apparatus、不进 code',
      onApparatus.apparatus.length === 1 && onApparatus.apparatus[0].count === 1 && onApparatus.code.length === 0,
    );
    ok(
      'P11 同内容放在业务路径 → 必须进 code（装置面不放宽内容）',
      onBusiness.code.length === 1 && onBusiness.apparatus.length === 0,
    );
  }

  // 探针 12：装置面不变量（N5）自身可判——合规 / 缺失 / 重复记账 / 越界 / 条数异常
  {
    const list = ['tools/check/a.mjs', 'tools/check/b.json'];
    const vOk = apparatusViolations(new Set(list), new Set(), list);
    const vMissing = apparatusViolations(new Set([list[0]]), new Set(), list);
    const vDup = apparatusViolations(new Set(list), new Set([list[1]]), list);
    const vOut = apparatusViolations(new Set(list), new Set(), ['engine/dsh-plugins/a/marker.json', list[1]]);
    const vLen = apparatusViolations(new Set(list), new Set(), [list[0]]);
    ok('P12a 合规装置面 → 零违规', vOk.length === 0);
    ok('P12b 装置面文件缺失/未 tracked 可判', vMissing.length === 1 && vMissing[0].includes('缺失'));
    ok('P12c 装置面与台账重复记账可判', vDup.some((r) => r.includes('重复记账')));
    ok('P12d 装置面越界（非 tools/check/ 路径）可判', vOut.some((r) => r.includes('越界')));
    ok('P12e 装置面条数异常可判', vLen.some((r) => r.includes('恰 2 条')));
  }

  // 探针 13：形态 ③ 跨行分离（v1.4.9 G-9 并入）——锚点行与使用行各自不命中，须文件级补判
  {
    const pos = scanContent([
      [
        'engine/inject/src/index.ts',
        `const skillDir = path.join(projectRoot, opts?.skillDir ?? '.sofagent');\n` +
          `const knowledgeDir = path.join(skillDir, 'knowledge');`,
      ],
    ]);
    ok('P13a 跨行分离（锚点行 + 使用行）被判非注释面命中', pos.code.length === 1 && pos.comment.length === 0);
    ok('P13b 命中形态标记含 cross-line', pos.code[0]?.forms.includes('cross-line') === true);
  }
  {
    // 反向：只有 join(var, 'knowledge') 而无锚点 ⇒ **不得**命中（防「碰巧同名」误判）
    const neg = scanContent([
      ['src/n.ts', `const base = '.sofagent/data';\nconst knowledgeDir = path.join(base, 'knowledge');`],
    ]);
    ok('P13c 无 .sofagent 锚点变量 ⇒ 不命中（不误判 join(<任意>, knowledge)）', neg.code.length === 0);
  }
  {
    // 反向：锚点在**另一文件** ⇒ 不跨文件推断
    const neg2 = scanContent([
      ['src/a.ts', `const dirA = path.join(root, '.sofagent');`],
      ['src/b.ts', `const knowledgeDir = path.join(dirA, 'knowledge');`],
    ]);
    ok('P13d 锚点在另一文件 ⇒ 不跨文件推断（只认同文件两步）', neg2.code.length === 0);
  }
  {
    // 正向边界：锚点行与使用行同文件但中间隔了别的语句 ⇒ 仍应命中
    const mid = scanContent([
      [
        'src/m.ts',
        `const d = join(root, '.sofagent');\nconst other = 1;\nconst kd = join(d, 'knowledge');`,
      ],
    ]);
    ok('P13e 锚点与使用行不同行/不相邻 ⇒ 仍命中', mid.code.length === 1);
  }

  let failed = 0;
  for (const r of results) {
    console.log(`  ${r.pass ? '✓' : '❌'} ${r.name}`);
    if (!r.pass) failed++;
  }
  console.log(`\n--selftest: ${results.length - failed} 通过 / ${failed} 失败（共 ${results.length} 项）`);
  emitCoverage(results.length, results.length, 0);
  process.exit(failed === 0 ? 0 : 1);
}

// ============================================================
// 入口（仅直接执行时跑判定；被 import 时不产生副作用）
// ============================================================
const isDirectRun =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  try {
    if (process.argv.includes('--selftest')) selftest();
    else main();
  } catch (err) {
    // 任何未预期异常 ⇒ 检查器失明（exit 2），绝不静默降级为「零违规」
    console.log('❌ check-legacy-knowledge-path 检查器异常（拒绝假绿）：');
    console.log(`    ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    emitCoverage(0, 0, 0);
    process.exit(2);
  }
}
