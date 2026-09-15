#!/usr/bin/env node
// ============================================================
// check-seam-contract.mjs · 插件适配层 seam 契约门禁
// ============================================================
// 职责：把「seam 只是意向声明」升级为**可校验的机器契约**。四个方向都查：
//
//   ① 正向（无条件可运行）：每个插件声明的 seam ∈ SEAMS.md 词汇表。
//      —— 词汇表 = 宿主真实事件名（*-HOST 表） ∪ 已登记的非 seam 接入形态（*-FORM 表）。
//      —— 不依赖宿主体在场：工作区里没有宿主也能跑（CI 上是常态）。
//
//   ② 三处一致（DSH 侧）：src/index.ts 的 pluginMeta.seam · package.json 的
//      sofagent.seam · cordis.patch.yml 的 config.seam **逐条一致**；
//      且 package.json.description 必须含 `seam: <值>`（描述滞后 = 同一次挂载
//      在不同消费面看到不同的「挂在哪」，本批修的就是这个病）。
//
//   ③ 反向（宿主在场实跑，缺席可见 SKIP）：词汇表 *-HOST 每条的三要素
//      （宿主包 + 宿主路径 glob + 事件名）都能在**真实宿主**里 grep 到定义处。
//      🔴 CI 上没有 ~/.dsh / openclaw —— 宿主缺席时**打印 SKIP 并说明原因**，
//         exit 0 但**绝不静默通过**（SKIP 必须可见，对齐 check-storefront 三态语义）。
//
//   ④ 双向对账（漏写 seam 拦截）：文件系统里的每个插件都必须在词表登记；
//      词表登记的每个插件都必须在文件系统里存在。
//
//   ⑤ 规划中承载：插件 description / pluginMeta 出现「规划中 / 待实现 / 未实现」时，
//      同行必须带版本号（vX.Y.Z）承载 —— 不允许「无版本承载的规划中」。
//
//   ⑥ SKILL.md 反向对账（v1.4.8 A5）：SKILL.md 是**第四处手写 seam 面**（不在生成器
//      产物之列），文本里带 `（seam: <值>）` 字面量 → 改它不改另三处会**静默漂移**。
//      🔴 判据是**反向约束**：「**若** SKILL.md 出现 seam 字面量，则**每一处**都必须与
//         src/index.ts 的 pluginMeta.seam 逐字一致」——**不是**「必须有」。
//      依据：SKILL.md 是面向 SkillHub 消费端的人类描述文档，非契约载体；把「必须提及
//        seam」写成硬要求 = 给所有新插件新增一条任务书里没有的硬要求，且合法不写者会
//        被判假红。机器真值已在三处，SKILL.md 只是「可能漂移的第四面」。
//      已知残余缺口（显式标出，不假装覆盖）：反向约束**不覆盖**「SKILL.md 悄悄删掉
//        seam 字样」这一形态——是否把 SKILL.md 升格为契约面属产品决策，不在本脚本内裁。
//      载体形态（实测 10/10 一致）：YAML frontmatter 的 `description: >` 折叠标量（行 7）
//        + 正文同文重复行（行 12），均写作 `（seam: <值>）`（全角括号）。
//
// 用法：
//   node tools/check/check-seam-contract.mjs             # 常态门禁
//   node tools/check/check-seam-contract.mjs --selftest  # 合成回归（注入漂移 → 必报红）
//   node tools/check/check-seam-contract.mjs --help
//
// 退出码：0 = 全绿（可含 SKIP，SKIP 已显著打印）/ 1 = 有 FAIL /
//         2 = 检查器失明（SEAMS.md 缺失 / 词汇表解析为空 / 脚本自身错误）
//
// 依赖：仅 node 内置模块（fs/os/path/child_process）——不 import 仓内 dist，无需先 build。
// ============================================================

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const REAL_ROOT = path.resolve(import.meta.dirname, '../..');
const SEAMS_MD = 'engine/dsh-plugins/SEAMS.md';
const DSH_PLUGINS_DIR = 'engine/dsh-plugins';
const OPENCLAW_PLUGINS_DIR = 'engine/openclaw-plugins';
const ROADMAP_CANDIDATES = ['docs/ROADMAP.md', 'ROADMAP.md'];
const PLANNED_RE = /规划中|待实现|未实现/;
const VERSION_RE = /v\d+\.\d+\.\d+/;

const ARGV = process.argv.slice(2);
if (ARGV.includes('--help') || ARGV.includes('-h')) {
  console.log('check-seam-contract.mjs — 插件适配层 seam 契约门禁');
  console.log('  (无参数)    常态门禁：正向 / 三处一致 / 反向（宿主缺席 SKIP）/ 双向对账 / 规划中承载 / SKILL.md 反向对账');
  console.log('  --verbose   连同反向检查的全部命中明细一并打印（取证用）');
  console.log('  --selftest  合成回归：注入五类漂移（幽灵 seam / 三处不一致 / 漏写 / 无承载规划中 / SKILL.md 漂移）→ 必报红');
  console.log('  --help      显示帮助');
  console.log('');
  console.log('环境变量（反向检查宿主根，缺席则打印 SKIP）：');
  console.log('  SEAM_DSH_HOST_ROOT     默认 ~/.dsh/profiles/node_modules');
  console.log('  SEAM_OPENCLAW_ROOT     默认自动探测（workbuddy 内置 binaries / ~/.openclaw）');
  process.exit(0);
}
const SELFTEST = ARGV.includes('--selftest');
const VERBOSE = ARGV.includes('--verbose');

// ============================================================
// 词汇表解析 —— SEAMS.md 的机器可读块
// ============================================================
/** 取 `<!-- SEAM-VOCAB:<key>:BEGIN -->` … `:END` 之间的 Markdown 表格行（单元格文本数组） */
function parseVocabTable(md, key) {
  const begin = `<!-- SEAM-VOCAB:${key}:BEGIN -->`;
  const end = `<!-- SEAM-VOCAB:${key}:END -->`;
  const i = md.indexOf(begin);
  const j = md.indexOf(end);
  if (i < 0 || j < 0 || j < i) {
    const err = new Error(`SEAMS.md 缺少词汇表块 ${key}（${begin} … ${end}）`);
    err.blind = true;
    throw err;
  }
  const rows = [];
  for (const raw of md.slice(i + begin.length, j).split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('|')) continue;
    const cells = line
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim().replace(/`/g, '').trim());
    if (cells.length < 4) continue;
    if (cells[0] === 'seam' || cells[0] === 'form' || cells[0] === 'hook' || cells[0] === 'event') continue; // 表头
    if (/^-{2,}$/.test(cells[1]) || /^-{2,}$/.test(cells[0])) continue; // 分隔行
    rows.push(cells);
  }
  if (rows.length === 0) {
    const err = new Error(`SEAMS.md 词汇表块 ${key} 解析为空（0 条）——检查器失明，拒绝假绿`);
    err.blind = true;
    throw err;
  }
  return rows;
}

/**
 * 解析 SEAMS.md → 四张表。
 * host 条目：{ seam, pkg, dirGlob, semantics, plugins[] }
 * form 条目：{ form, formKind, reason, api, plugins[] }
 */
function loadVocabulary(root) {
  const p = path.join(root, SEAMS_MD);
  if (!fs.existsSync(p)) {
    const err = new Error(`seam 词汇表缺失：${SEAMS_MD}`);
    err.blind = true;
    throw err;
  }
  const md = fs.readFileSync(p, 'utf8');

  const dshHost = parseVocabTable(md, 'DSH-HOST').map((c) => ({
    seam: c[0], pkg: c[1], dirGlob: c[2], semantics: c[3], plugins: splitPlugins(c[4]),
  }));
  const dshForm = parseVocabTable(md, 'DSH-FORM').map((c) => ({
    form: c[0], formKind: c[1], reason: c[2], api: c[3], plugins: splitPlugins(c[4]),
  }));
  const oclHost = parseVocabTable(md, 'OPENCLAW-HOST').map((c) => ({
    seam: c[0], pkg: c[1], dirGlob: c[2], semantics: c[3], plugins: splitPlugins(c[4]),
  }));
  const oclInternal = parseVocabTable(md, 'OPENCLAW-INTERNAL-HOST').map((c) => ({
    seam: c[0], pkg: c[1], dirGlob: c[2], semantics: c[3], plugins: splitPlugins(c[4]),
  }));
  const oclForm = parseVocabTable(md, 'OPENCLAW-FORM').map((c) => ({
    form: c[0], formKind: c[1], reason: c[2], api: c[3], plugins: splitPlugins(c[4]),
  }));

  return { dshHost, dshForm, oclHost, oclInternal, oclForm };
}

function splitPlugins(cell) {
  return (cell || '')
    .split(/[\s,、]+/)
    .map((s) => s.trim())
    .filter((s) => s && s !== '暂无');
}

// ============================================================
// 插件发现 + seam 三处提取
// ============================================================
function discoverDshPlugins(root) {
  const dir = path.join(root, DSH_PLUGINS_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('cordis-plugin-'))
    .filter((e) => fs.existsSync(path.join(dir, e.name, 'package.json')))
    .map((e) => e.name)
    .sort();
}

/**
 * 聚合插件（裸名 cordis-plugin-sofagent）⇄ 角色名（'suite'）双向映射的唯一出处。
 * 剥前缀规则对其余插件成立（cordis-plugin-sofagent-audit → audit），对裸名不成立
 * （剥完为空）——聚合层用**角色名**作词表键，与补丁条目 id sofagent-suite /
 * 服务名 sofagent.suite 同语义。两处消费（正向推导 / 词表反查）都走这里，避免各写各的。
 */
const AGGREGATE_DIR = 'cordis-plugin-sofagent';
const AGGREGATE_ROLE = 'suite';
const shortOfDir = (dir) => (dir === AGGREGATE_DIR ? AGGREGATE_ROLE : dir.replace(/^cordis-plugin-sofagent-/, ''));
const dirOfShort = (short) => (short === AGGREGATE_ROLE ? AGGREGATE_DIR : `cordis-plugin-sofagent-${short}`);

function discoverOpenclawPlugins(root) {
  const dir = path.join(root, OPENCLAW_PLUGINS_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => fs.existsSync(path.join(dir, e.name, 'openclaw.plugin.json')))
    .map((e) => e.name)
    .sort();
}

/** src/index.ts → pluginMeta.seam（首个带引号的 `seam:` 赋值） */
function seamFromTs(text) {
  const m = text.match(/^\s*seam:\s*(['"])([\s\S]*?)\1\s*,?\s*$/m);
  return m ? m[2] : null;
}
/** cordis.patch.yml → config.seam（双引号形态） */
function seamFromPatch(text) {
  const m = text.match(/^\s*seam:\s*"([^"]*)"\s*(?:#.*)?$/m);
  return m ? m[1] : null;
}

/**
 * SKILL.md → 全部 `（seam: <值>）` 字面量（含行号）。
 * 载体形态：全角括号「（seam: …）」/ 半角「(seam: …)」皆可（实测 10/10 用全角）。
 * 值以**首个右括号**收尾——故值内不得含 `）`/`)`（seam 值形如 `tools/result + fs/write-intent`
 * 或 `non-seam:tool-set`，天然不含括号）。
 * 返回 [{ line, value }]；无字面量 → 空数组（反向约束下**不判红**）。
 */
function seamFromSkill(text) {
  const out = [];
  text.split('\n').forEach((lineText, i) => {
    for (const m of lineText.matchAll(/[（(]\s*seam[:：]\s*([^）)]+?)\s*[）)]/g)) {
      out.push({ line: i + 1, value: m[1] });
    }
  });
  return out;
}

/** 归一化：折叠空白，供逐条比对 */
const norm = (s) => (s === null || s === undefined ? null : String(s).replace(/\s+/g, ' ').trim());

// ============================================================
// 宿主根探测（反向检查用）——缺席不报错，只 SKIP
// ============================================================
function resolveDshHostRoot() {
  // 显式覆盖即权威：设了就用它（路径不存在 = 宿主缺席 → SKIP），不再回落探测。
  // 这既是 CI 上强制 SKIP 的开关，也让「宿主缺席」这条分支本机可测（不靠拆环境）。
  const env = process.env.SEAM_DSH_HOST_ROOT;
  if (env !== undefined) return fs.existsSync(env) ? env : null;
  const def = path.join(os.homedir(), '.dsh', 'profiles', 'node_modules');
  return fs.existsSync(def) ? def : null;
}

/**
 * OpenClaw 宿主根探测。
 * 🔴 本机可能装着**多个** openclaw（实测 22.12.0 与 22.19.0 两套，hook 集合不同——
 *    22.12.0 缺 reply_payload_sending）。取「先找到的第一个」会拿到过期宿主，
 *    导致反向检查「找不到」是**版本错配的假红**。故优先级：
 *      ① SEAM_OPENCLAW_ROOT 显式指定
 *      ② PATH 上的 openclaw 真实路径（= 实际在用的那个宿主）
 *      ③ 常见位置 + workbuddy 各 node 版本，按版本号**降序**取最新
 * 返回 { root, version }
 */
function resolveOpenclawRoot() {
  const envRoot = process.env.SEAM_OPENCLAW_ROOT;
  if (envRoot !== undefined) {
    return fs.existsSync(envRoot) ? { root: envRoot, version: readPkgVersion(envRoot) } : { root: null, version: null };
  }

  const candidates = [];
  // ② PATH 上的 openclaw（最可信：就是实际在跑的那个）
  try {
    const which = execFileSync('command', ['-v', 'openclaw'], { encoding: 'utf8', shell: '/bin/sh' }).trim();
    if (which) {
      const real = fs.realpathSync(which);
      let d = path.dirname(real);
      for (let i = 0; i < 4 && d !== path.dirname(d); i++) {
        if (fs.existsSync(path.join(d, 'package.json'))) { candidates.push(d); break; }
        d = path.dirname(d);
      }
    }
  } catch {
    /* PATH 上没有 openclaw —— 回落到常见位置 */
  }
  // ③ 常见位置 + workbuddy 各 node 版本（按版本号降序）
  candidates.push(path.join(os.homedir(), '.openclaw', 'node_modules', 'openclaw'));
  candidates.push(path.join(os.homedir(), '.openclaw', 'openclaw'));
  const wb = path.join(os.homedir(), '.workbuddy', 'binaries', 'node', 'versions');
  if (fs.existsSync(wb)) {
    const versions = fs.readdirSync(wb).sort(compareVersionsDesc);
    for (const v of versions) candidates.push(path.join(wb, v, 'lib', 'node_modules', 'openclaw'));
  }
  const hit = candidates.find((c) => fs.existsSync(path.join(c, 'package.json')));
  return hit ? { root: hit, version: readPkgVersion(hit) } : { root: null, version: null };
}

/** 版本号降序（22.19.0 > 22.12.0） */
function compareVersionsDesc(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return y - x;
  }
  return 0;
}

function readPkgVersion(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * 宿主包根解析。
 * - DSH 侧：root = `.../node_modules`，pkg = `@deepseek-ai/dsh-tools` → `root/@deepseek-ai/dsh-tools`
 * - OpenClaw 侧：root 自身就是包目录，pkg = `openclaw` → 直接用 root（避免拼成 openclaw/openclaw）
 */
function pkgRoot(root, pkg) {
  if (path.basename(root) === pkg) return root;
  return pkg.startsWith('@') ? path.join(root, ...pkg.split('/')) : path.join(root, pkg);
}

/**
 * 在宿主包里按 glob 找文件并 grep 事件名。
 * glob 形态：
 *   `lib/`              —— 目录：递归搜（深度 ≤ 6，跳过 node_modules）
 *   `dist/hook-types-*.d.ts` —— 文件名通配：**只在该目录内非递归**匹配文件名，避免误扫整树
 *   `docs/automation/hooks.md` —— 具体文件
 * 只搜文本类文件（.ts/.d.ts/.js/.mjs/.md）。返回 { hits, searched }
 */
function grepHost(root, pkg, dirGlob, needle) {
  const SEXT = /\.(d\.ts|ts|mts|cts|js|mjs|cjs|md)$/;
  const searched = [];
  const hits = [];
  const probe = (p) => {
    if (!SEXT.test(p)) return;
    searched.push(p);
    if (fs.readFileSync(p, 'utf8').includes(needle)) hits.push(p);
  };
  const rootDir = pkgRoot(root, pkg);
  if (!fs.existsSync(rootDir)) return { hits, searched };

  const segs = dirGlob.split('/').filter(Boolean);
  const last = segs[segs.length - 1] || '';
  const dir = path.join(rootDir, ...segs.slice(0, last.includes('*') ? -1 : segs.length));

  if (last.includes('*')) {
    // 文件名通配 → 该目录内非递归匹配
    if (!fs.existsSync(dir)) return { hits, searched };
    const rx = new RegExp('^' + last.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isFile() && rx.test(e.name)) probe(path.join(dir, e.name));
    }
    return { hits, searched };
  }
  if (dirGlob.endsWith('/')) {
    // 目录 → 递归
    const walk = (p, depth) => {
      if (depth > 6 || !fs.existsSync(p)) return;
      const st = fs.statSync(p);
      if (st.isFile()) return probe(p);
      for (const e of fs.readdirSync(p, { withFileTypes: true })) {
        if (e.name === 'node_modules') continue;
        walk(path.join(p, e.name), depth + 1);
      }
    };
    walk(dir, 0);
    return { hits, searched };
  }
  // 具体文件
  if (fs.existsSync(dir)) probe(dir);
  return { hits, searched };
}

// ============================================================
// 巡检核心（root + 注入点可指定 → --selftest 复用同一判定逻辑）
// ============================================================
function runChecks(root, opts = {}) {
  const inject = opts.inject || {};
  const fails = [];
  const warns = [];
  const skips = [];
  const notes = [];
  /** SKILL.md 反向对账的逐插件覆盖情况（打印用；不参与退出码） */
  const skillNotes = [];
  const N = (id, detail) => fails.push({ id, detail });
  const W = (id, detail) => warns.push({ id, detail });

  const vocab = loadVocabulary(root);
  const dshAllowed = new Set([...vocab.dshHost.map((x) => x.seam), ...vocab.dshForm.map((x) => x.form)]);
  const oclAllowed = new Set([
    ...vocab.oclHost.map((x) => x.seam),
    ...vocab.oclInternal.map((x) => x.seam),
    ...vocab.oclForm.map((x) => x.form),
  ]);

  const vocabDshPlugins = new Set(vocab.dshHost.flatMap((x) => x.plugins).concat(vocab.dshForm.flatMap((x) => x.plugins)));
  // OpenClaw 侧双向对账只覆盖 engine/openclaw-plugins/ 下的 code-plugin；
  // 内建 hook（HOOK.md 机制）的插件在 engine/hooks/ 下，单独校验存在性（见下）。
  const vocabOclPlugins = new Set(
    vocab.oclHost.flatMap((x) => x.plugins).concat(vocab.oclForm.flatMap((x) => x.plugins)),
  );
  const vocabInternalHooks = new Set(vocab.oclInternal.flatMap((x) => x.plugins));

  // ── DSH 侧 ─────────────────────────────────────────────
  const dshPlugins = discoverDshPlugins(root);
  const seenDsh = new Set();
  for (const dir of dshPlugins) {
    const base = path.join(root, DSH_PLUGINS_DIR, dir);
    const short = shortOfDir(dir);
    seenDsh.add(short);

    const tsPath = path.join(base, 'src', 'index.ts');
    const pkgPath = path.join(base, 'package.json');
    const patchPath = path.join(base, 'cordis.patch.yml');

    if (!fs.existsSync(tsPath) || !fs.existsSync(pkgPath) || !fs.existsSync(patchPath)) {
      N(dir, `三处 seam 载体不全：缺 ${['src/index.ts', 'package.json', 'cordis.patch.yml'].filter((f) => !fs.existsSync(path.join(base, f))).join(' / ')}`);
      continue;
    }

    const tsSeam = norm(seamFromTs(fs.readFileSync(tsPath, 'utf8')));
    const patchSeam = norm(seamFromPatch(fs.readFileSync(patchPath, 'utf8')));
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const pkgSeam = norm(pkg?.sofagent?.seam);
    // 注入点（--selftest 用；常态下等于原值本身）
    const tsEff = norm(inject[dir] ?? tsSeam);
    const pkgEff = norm(inject[`pkg:${dir}`] ?? pkgSeam);
    const patchEff = norm(inject[`patch:${dir}`] ?? patchSeam);
    const declared = tsEff;

    // ① 漏写 seam
    for (const [label, v] of [['src/index.ts pluginMeta.seam', tsEff], ['package.json sofagent.seam', pkgEff], ['cordis.patch.yml config.seam', patchEff]]) {
      if (!v) N(dir, `漏写 seam：${label} 缺失或为空（新增插件必须登记 seam，见 SEAMS.md）`);
    }

    // ② 三处逐条一致
    if (tsEff && pkgEff && patchEff && !(tsEff === pkgEff && pkgEff === patchEff)) {
      N(dir, `三处 seam 漂移：src/index.ts=${tsEff} / package.json=${pkgEff} / cordis.patch.yml=${patchEff}`);
    }

    // ③ 正向：∈ 词汇表（按 + 拆分逐段校验）
    if (declared) {
      for (const token of declared.split('+').map((s) => s.trim()).filter(Boolean)) {
        if (!dshAllowed.has(token)) {
          N(dir, `seam 不在词汇表：「${token}」—— 既非宿主真实事件，也未登记为非 seam 接入形态（SEAMS.md）`);
        }
      }
    }

    // ④ description 滞后：package.json.description 必须含 `seam: <值>`
    const desc = norm(pkg?.description) || '';
    if (declared && desc && !desc.includes(`seam: ${declared}`)) {
      N(dir, `description 与 seam 漂移：package.json.description 未含「seam: ${declared}」——描述滞后于契约`);
    }

    // ⑤ 两段式：seam 值 + 语义必须成对（JSON 无注释语法 → 用 seamSemantics 兄弟字段承载）
    const sem = norm(inject[`sem:${dir}`] ?? pkg?.sofagent?.seamSemantics);
    if (declared && !sem) {
      N(dir, `缺语义注释：package.json 的 sofagent.seamSemantics 为空——seam 必须「值 + 语义」成对（见 SEAMS.md §5）`);
    }

    // ⑤ 双向对账
    if (!vocabDshPlugins.has(short)) {
      N(dir, `词表未登记：插件「${short}」不在 SEAMS.md 任何 *-HOST / *-FORM 行的「挂载插件」列`);
    }

    // ⑥ SKILL.md 反向对账：出现 seam 字面量 ⇒ 每一处都必须与 src/index.ts 的 pluginMeta.seam 一致
    const skillPath = path.join(base, 'SKILL.md');
    if (fs.existsSync(skillPath)) {
      const rawHits = seamFromSkill(fs.readFileSync(skillPath, 'utf8'));
      // 注入点（--selftest 用）：用一个值替换全部命中，常态下不生效
      const inj = inject[`skill:${dir}`];
      const hits =
        inj === undefined
          ? rawHits
          : rawHits.length > 0
            ? rawHits.map(() => ({ line: rawHits[0].line, value: inj }))
            : [{ line: 0, value: inj }];
      const skillRel = path.join(DSH_PLUGINS_DIR, dir, 'SKILL.md');
      if (hits.length === 0) {
        skillNotes.push(`${short}：SKILL.md 无 seam 字面量（反向约束下不判红；本插件的第四面不受门禁覆盖）`);
      } else {
        for (const h of hits) {
          if (norm(h.value) !== declared) {
            N(`${skillRel}:${h.line}`, `SKILL.md seam 与契约漂移：SKILL.md=${norm(h.value)} / 契约（src/index.ts pluginMeta.seam）=${declared}`);
          }
        }
        skillNotes.push(`${short}：SKILL.md ${hits.length} 处 seam 字面量（行 ${hits.map((h) => h.line).join('/')}）已纳入对账`);
      }
      // 无论命中与否：提到 seam 但**不是** `（seam: …）` 形态的行 → 未被对账覆盖，必须可见（WARN 不阻断）。
      // 目的：将来有人换一种写法（如去掉括号）时，不会静默变成「门禁看不见的第四面」。
      const parsedLines = new Set(hits.map((h) => h.line));
      fs.readFileSync(skillPath, 'utf8')
        .split('\n')
        .forEach((t, i) => {
          if (/\bseam\b/i.test(t) && !parsedLines.has(i + 1)) {
            W(`${skillRel}:${i + 1}`, `提到「seam」但不是 \`（seam: …）\` 形态——该行未被对账覆盖（仅提示，不阻断）`);
          }
        });
    } else {
      skillNotes.push(`${short}：无 SKILL.md（第四面不存在，不判红）`);
    }
  }
  for (const p of vocabDshPlugins) {
    if (!seenDsh.has(p)) N(SEAMS_MD, `词表登记插件「${p}」在文件系统里不存在（${DSH_PLUGINS_DIR}/${dirOfShort(p)}/）`);
  }

  // ── OpenClaw 侧 ────────────────────────────────────────
  const oclPlugins = discoverOpenclawPlugins(root);
  const seenOcl = new Set();
  for (const dir of oclPlugins) {
    const base = path.join(root, OPENCLAW_PLUGINS_DIR, dir);
    const manifestPath = path.join(base, 'openclaw.plugin.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const declared = norm(inject[`openclaw:${dir}`] ?? manifest?.seam);
    seenOcl.add(dir);

    if (!declared) {
      N(dir, `漏写 seam：openclaw.plugin.json 无 seam 字段（OpenClaw 宿主事件名下划线风格，见 SEAMS.md §3）`);
    } else {
      const sem = norm(inject[`sem:openclaw:${dir}`] ?? manifest?.seamSemantics);
      if (!sem) {
        N(dir, `缺语义注释：openclaw.plugin.json 的 seamSemantics 为空——seam 必须「值 + 语义」成对`);
      }
      for (const token of declared.split('+').map((s) => s.trim()).filter(Boolean)) {
        if (!oclAllowed.has(token)) {
          N(dir, `seam 不在词汇表：「${token}」—— 既非 OpenClaw 宿主真实 hook，也未登记为非 seam 接入形态`);
        }
      }
      // description 提及的 snake_case hook 名必须是真实 host hook（description 滞后拦截）
      const desc = norm(manifest?.description) || '';
      const mentioned = [...desc.matchAll(/\b([a-z]+_[a-z_]+)\b/g)].map((m) => m[1]);
      const KNOWN_NOISE = new Set(['registerTool', 'registerCli', 'sofagent_audit', 'sofagent_evolve', 'sofagent_inject', 'sofagent_rollback']);
      for (const t of new Set(mentioned)) {
        if (KNOWN_NOISE.has(t) || /^sofagent_/.test(t)) continue;
        if (!oclAllowed.has(t) && !vocab.oclHost.some((h) => h.seam === t)) {
          N(dir, `description 提及的 hook「${t}」不是宿主真实事件名（description 滞后，见 SEAMS.md §3）`);
        }
      }
      // 声明 ↔ 代码注册对齐（WARN 非阻断：本批不动运行行为，漂移须可见）
      const tsPath = path.join(base, 'src', 'index.ts');
      if (fs.existsSync(tsPath)) {
        const registered = [...new Set([...fs.readFileSync(tsPath, 'utf8').matchAll(/api\.on\??\.\(\s*'([^']+)'/g)].map((m) => m[1]))];
        if (registered.length > 0 && !registered.includes(declared)) {
          W(dir, `声明 seam=${declared}，但 src/index.ts 注册的是 ${registered.join(' / ')} —— 声明与实现不一致（本批不动运行行为，留待适配层标准化批修复）`);
        }
      }
    }

    if (!vocabOclPlugins.has(dir)) {
      N(dir, `词表未登记：插件「${dir}」不在 SEAMS.md 任何 *-HOST / *-FORM 行的「挂载插件」列`);
    }
  }
  for (const p of vocabOclPlugins) {
    if (!seenOcl.has(p)) N(SEAMS_MD, `词表登记插件「${p}」在文件系统里不存在（${OPENCLAW_PLUGINS_DIR}/${p}/）`);
  }
  // 内建 hook 表登记的插件（engine/hooks/<name>/ 或 engine/openclaw-plugins/<name>/）
  for (const p of vocabInternalHooks) {
    const a = path.join(root, 'engine', 'hooks', p);
    const b = path.join(root, OPENCLAW_PLUGINS_DIR, p);
    if (!fs.existsSync(a) && !fs.existsSync(b)) {
      N(SEAMS_MD, `词表登记的内建 hook 插件「${p}」在文件系统里不存在（engine/hooks/${p}/ 或 ${OPENCLAW_PLUGINS_DIR}/${p}/）`);
    }
  }

  // ── 反向：词汇表 *-HOST 每条能在真实宿主里找到定义处 ────
  const dshRoot = resolveDshHostRoot();
  if (!dshRoot) {
    skips.push(`DSH 反向检查：宿主 @deepseek-ai/* 不存在（SEAM_DSH_HOST_ROOT=${process.env.SEAM_DSH_HOST_ROOT || '默认 ~/.dsh/profiles/node_modules'} 未命中）——CI 上无 ~/.dsh，本项跳过。正向检查已在本地/CI 全量执行，未被跳过。`);
  }
  for (const e of vocab.dshHost) {
    if (!e.pkg || !e.dirGlob || !e.seam) {
      N(SEAMS_MD, `词汇表条目三要素不全：「${e.seam}」缺 pkg / dirGlob / seam`);
      continue;
    }
    if (!dshRoot) continue;
    const { hits, searched } = grepHost(dshRoot, e.pkg, e.dirGlob, e.seam);
    if (searched.length === 0) {
      N(SEAMS_MD, `反向检查搜索面为空：${e.pkg}/${e.dirGlob} 下无可搜文件——检查方式可能假空，拒绝假绿`);
    } else if (hits.length === 0) {
      N(SEAMS_MD, `宿主未定义：${e.pkg}/${e.dirGlob} 里找不到「${e.seam}」（搜了 ${searched.length} 个文件）`);
    } else {
      notes.push(`DSH 反向 ✅ ${e.seam} → ${path.relative(dshRoot, hits[0])}`);
    }
  }

  const { root: oclRoot, version: oclVersion } = resolveOpenclawRoot();
  if (!oclRoot) {
    skips.push('OpenClaw 反向检查：宿主 openclaw 包不存在（SEAM_OPENCLAW_ROOT 未命中，PATH 上无 openclaw，亦未探测到 ~/.openclaw / workbuddy binaries）——本项跳过。');
  } else {
    notes.push(`OpenClaw 反向往宿主版本：${oclVersion}（${oclRoot}）`);
  }
  for (const e of [...vocab.oclHost, ...vocab.oclInternal]) {
    if (!oclRoot) continue;
    const { hits, searched } = grepHost(oclRoot, e.pkg, e.dirGlob, e.seam);
    if (searched.length === 0) {
      N(SEAMS_MD, `反向检查搜索面为空：openclaw/${e.dirGlob} 下无可搜文件——拒绝假绿`);
    } else if (hits.length === 0) {
      N(SEAMS_MD, `宿主未定义：openclaw/${e.dirGlob} 里找不到「${e.seam}」（搜了 ${searched.length} 个文件）`);
    } else {
      notes.push(`OpenClaw 反向 ✅ ${e.seam} → ${path.relative(oclRoot, hits[0])}`);
    }
  }
  if (oclRoot) {
    // 词汇表不得收已废弃事件名
    const DEPRECATED = ['subagent_spawning', 'deactivate'];
    for (const d of DEPRECATED) {
      if (oclAllowed.has(d)) N(SEAMS_MD, `词汇表收录了已废弃的宿主事件「${d}」——宿主 DeprecatedPluginHookName 不得作为 seam`);
    }
  }

  // ── 规划中承载 ─────────────────────────────────────────
  const plannedFiles = trackedFiles(root, [DSH_PLUGINS_DIR, OPENCLAW_PLUGINS_DIR]).filter((f) =>
    /\.(ts|tsx|js|mjs|json|yml|yaml|md)$/.test(f),
  );
  for (const rel of plannedFiles) {
    const abs = path.join(root, rel);
    let lines;
    try {
      lines = fs.readFileSync(abs, 'utf8').split('\n');
    } catch {
      continue;
    }
    lines.forEach((line, i) => {
      if (PLANNED_RE.test(line) && !VERSION_RE.test(line)) {
        // 允许：同行带版本号承载 / 或本行有指向 ROADMAP 的显式锚点
        if (/ROADMAP/i.test(line)) {
          const ok = ROADMAP_CANDIDATES.some((r) => fs.existsSync(path.join(root, r)));
          if (ok) return;
        }
        N(rel, `第 ${i + 1} 行出现「${line.match(PLANNED_RE)[0]}」但无版本号承载——不允许「无版本承载的规划中」（须带 vX.Y.Z，或指到 ROADMAP.md）`);
      }
    });
  }

  return { fails, warns, skips, notes, skillNotes, vocab };
}

/** git 追踪文件清单（排除 dist/ 等构建产物）；git 不可用时退化为目录遍历（排除 dist/node_modules） */
function trackedFiles(root, dirs) {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--', ...dirs], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'], // 临时镜像非 git 仓 → 静默回落目录遍历
    });
    return out.split('\0').filter(Boolean);
  } catch {
    const acc = [];
    const walk = (p) => {
      for (const e of fs.readdirSync(p, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === 'dist') continue;
        const q = path.join(p, e.name);
        if (e.isDirectory()) walk(q);
        else acc.push(path.relative(root, q));
      }
    };
    for (const d of dirs) if (fs.existsSync(path.join(root, d))) walk(path.join(root, d));
    return acc;
  }
}

// ============================================================
// 常态门禁
// ============================================================
function main() {
  console.log('── 插件适配层 seam 契约门禁 ──');
  console.log('');
  const { fails, warns, skips, notes, skillNotes, vocab } = runChecks(REAL_ROOT);
  console.log(
    `  词汇表：DSH 宿主 ${vocab.dshHost.length} 条 / DSH 非 seam 形态 ${vocab.dshForm.length} 条 / ` +
      `OpenClaw hook ${vocab.oclHost.length} 条 / OpenClaw 内建 hook ${vocab.oclInternal.length} 条 / OpenClaw 非 seam 形态 ${vocab.oclForm.length} 条`,
  );
  console.log(`  正向 + 三处一致 + 双向对账：${fails.length === 0 ? '✅ 全绿' : `❌ ${fails.length} 处 FAIL`}`);
  console.log('');
  for (const s of skips) console.log(`  SKIP: ${s}`);
  if (skips.length > 0) {
    console.log(`  ⏭  SKIP 不影响退出码，但**不算通过**——宿主在场时本项必须实跑（本机若已装宿主，请检查 SEAM_*_ROOT 覆盖值）。`);
  }
  if (skips.length > 0) console.log('');
  const verNotes = notes.filter((n) => /反向往宿主/.test(n));
  const hitNotes = notes.filter((n) => !/反向往宿主/.test(n));
  for (const v of verNotes) console.log(`  ℹ️  ${v}`);
  console.log(`  反向（宿主在场实跑）✅ ${hitNotes.length} 条命中定义处`);
  const shown = VERBOSE ? hitNotes : hitNotes.slice(0, 3);
  for (const n of shown) console.log(`    · ${n}`);
  if (!VERBOSE && hitNotes.length > 3) console.log(`    · …（其余 ${hitNotes.length - 3} 条同类，略——加 --verbose 看全量）`);
  console.log('');
  console.log(`  SKILL.md 反向对账（第四处手写 seam 面）：覆盖 ${skillNotes.filter((s) => /已纳入对账/.test(s)).length} 个插件`);
  for (const s of skillNotes) console.log(`    · ${s}`);
  console.log('');
  for (const w of warns) console.log(`  ⚠️  【WARN】${w.id}：${w.detail}`);
  for (const f of fails) console.log(`  ❌ 【FAIL】${f.id}：${f.detail}`);
  console.log('');
  if (fails.length > 0) {
    console.log(`✗ seam 契约 ${fails.length} 处 FAIL（WARN ${warns.length}）`);
    return 1;
  }
  console.log(`✓ seam 契约全绿（WARN ${warns.length} / SKIP ${skips.length}——SKIP 已显著打印）`);
  return 0;
}

// ============================================================
// --selftest 合成回归：注入五类漂移 → 必报红（红不了的门禁是装饰品）
// ============================================================
function selftest() {
  console.log('── --selftest 合成回归（注入漂移 → 必报红）──');
  const cases = [
    ['幽灵 seam（不在词汇表）', { inject: { 'cordis-plugin-sofagent-audit': 'tools/zzz-phantom' } }, (r) => r.fails.some((f) => f.detail.includes('tools/zzz-phantom') && f.detail.includes('不在词汇表'))],
    ['三处漂移（只改 src 侧）', { inject: { 'cordis-plugin-sofagent-evolve': 'tools/result' } }, (r) => r.fails.some((f) => f.detail.includes('三处 seam 漂移'))],
    // v1.4.9 P2：-gate/-ontology/-commons 已并入 -audit/-fde（合并批），注入载体换存活插件
    ['漏写 seam（清空声明）', { inject: { 'cordis-plugin-sofagent-daemon': ' ' } }, (r) => r.fails.some((f) => f.detail.includes('漏写 seam'))],
    ['OpenClaw description 幽灵 hook', { inject: null }, null],
    // ⑥ SKILL.md 反向对账：注入「词表内合法值」制造 SKILL.md 与契约不一致 → 必须点到 SKILL.md:行
    ['SKILL.md 与契约漂移（词表内值）', { inject: { 'skill:cordis-plugin-sofagent-daemon': 'tools/result' } }, (r) => r.fails.some((f) => String(f.id).endsWith('SKILL.md:7') && f.detail.includes('SKILL.md seam 与契约漂移'))],
  ];
  let fail = 0;
  for (const [label, opts, assert] of cases.filter((c) => c[2])) {
    const r = runChecks(REAL_ROOT, opts);
    const ok = assert(r);
    console.log(`  ${ok ? '✓' : '❌'} ${label}：${ok ? '必命中' : '未命中——守卫是装饰品'}`);
    if (!ok) fail++;
  }
  // 第 4 类：规划中无版本承载 —— 临时镜像注入
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seam-selftest-'));
  try {
    const probeDir = path.join(tmp, DSH_PLUGINS_DIR, 'cordis-plugin-sofagent-probe');
    fs.mkdirSync(path.join(probeDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(probeDir, 'package.json'),
      JSON.stringify({ name: 'cordis-plugin-sofagent-probe', version: '0.0.0', description: '探针（规划中，无版本承载）（seam: tools/result）', sofagent: { seam: 'tools/result' } }, null, 2),
    );
    fs.writeFileSync(path.join(probeDir, 'src', 'index.ts'), "export const pluginMeta = {\n  seam: 'tools/result',\n} as const;\n");
    fs.writeFileSync(path.join(probeDir, 'cordis.patch.yml'), 'config:\n  seam: "tools/result"\n');
    // 需要一个 SEAMS.md 与 openclaw 目录以让词汇表加载不失明
    fs.writeFileSync(path.join(tmp, SEAMS_MD), fs.readFileSync(path.join(REAL_ROOT, SEAMS_MD), 'utf8'));
    fs.mkdirSync(path.join(tmp, OPENCLAW_PLUGINS_DIR), { recursive: true });
    const r = runChecks(tmp, {});
    const hit = r.fails.some((f) => f.detail.includes('规划中') && f.detail.includes('无版本号承载'));
    console.log(`  ${hit ? '✓' : '❌'} 规划中无版本承载：${hit ? '必命中' : '未命中——守卫是装饰品'}`);
    if (!hit) fail++;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log('');
  if (fail > 0) {
    console.log(`✗ selftest 失败 ${fail} 项——守卫未抓到注入漂移`);
    return 1;
  }
  console.log('✓ selftest 通过——五类合成漂移全命中（守卫非装饰品）');
  return 0;
}

// ============================================================
// 入口
// ============================================================
try {
  if (SELFTEST) process.exit(selftest());
  process.exit(main());
} catch (err) {
  if (err && err.blind) {
    console.error(`✗ 检查器失明：${err.message}——拒绝假绿`);
    process.exit(2);
  }
  console.error(`✗ check-seam-contract 自身错误：${err && err.stack ? err.stack : String(err)}`);
  process.exit(2);
}
