#!/usr/bin/env node
// ============================================================
// check-interface-roadmap.mjs · 接口编号承载对账门禁
// (interface-id ↔ roadmap version coverage gate)
// ============================================================
// 职责：把「商业机制文档拟定的接口编号（G1-G14）」与「开源路线图 / 开发日志的
// 真实承载版本」做一次机器对账，堵住逐版对账暴露的那类漂移——
// **编号标了版本，版本却没承载它**（G1/G5b 曾标 v1.4.7 / v1.4.8，逐版核对发现
// 两条均未随所标版本落地、已掉出版本序列，需整体迁入后续版本）。
//
// 五项机械判定（C1-C5 FAIL，C6 WARN）：
//
//   C1 编号-版本绑定：spec 表每一行必须给出 ≥1 个 `vX.Y.Z` 承载版本。
//      禁「待定 / TBD / 无版本」——无版本承载的接口不算排期。
//
//   C2 承载版本存在：该版本必须在开源 ROADMAP 有版本行（迭代历程表 或 规划版本表）
//      **或**存在对应开发日志文件 `docs/changelog/v<大>.<小>/v<X.Y.Z>.md`。
//
//   C3 承载版本须提及编号：证据 = ROADMAP 该版本行 ∪ 该版本开发日志。
//      · 子号（G5a）允许以基号（G5）命中——spec 自身声明「G5 拆 a/b」，
//        强求子号字面命中会误报。
//      · ⚠️ 本项只证明「该版本那边提到过这个编号」，**不证明真实交付**——
//        交付真伪由 C4（tag）与人工审阅把关；不做「否证词」文本猜测，
//        行级启发式在长中文行上误伤率高于命中率。
//
//   C4 幽灵交付：spec 标 ✅（已交付 / 已覆盖）的版本号必须真实存在于 git tag。
//      标了 ✅ 却没有这个 tag = 把「计划」写成了「已交付」。
//
//   C5 编号双向完整：spec 表编号集合 ↔ 开源侧出现编号集合（ROADMAP + 相关版本
//      开发日志），双向差集报红。防「商业文档引了开源不认的编号」与
//      「开源引了商业未定义的编号」。
//
//   C6 交接口径冲突（WARN 不阻断）：spec 声明的承载版本之外，开源侧还有**别的版本
//      声称已交付**该编号 → 打印清单。同一编号只有一处能是真的：要么 spec 的排期
//      错了，要么开源侧的旧交付声明没跟着改（G1 实测即此形态——v1.4.7 开发日志仍写
//      「G1 已由 v1.4.4 覆盖」，而 spec 已把 G1 迁入 v1.4.9）。只认「已交付 / 已覆盖 /
//      已发版」语境，跨版本的普通前向引用不计——否则 WARN 会变成没人看的噪音。
//
// 🔴 脱敏硬约束：本脚本**不得硬编码商业文档路径**——spec 路径一律经 `--spec` 注入，
//    商业文档不进开源仓。未提供 `--spec` 时打印 SKIP 并以 0 退出（开源仓独立可跑）；
//    提供了就必须跑通：解析不到任何编号行 = FAIL（**绝不静默通过**）。
//
// 用法：
//   node tools/check/check-interface-roadmap.mjs --spec <商业机制文档路径>
//   node tools/check/check-interface-roadmap.mjs --spec <...> --roadmap docs/ROADMAP.md
//   node tools/check/check-interface-roadmap.mjs --selftest   # 合成回归（注入漂移 → 必报红）
//   node tools/check/check-interface-roadmap.mjs --help
//
// 退出码：0 = 全绿（可含 SKIP，SKIP 已显著打印）/ 1 = 有 FAIL / 2 = 用法错误

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ARGV = process.argv.slice(2);
const SELFTEST = ARGV.includes('--selftest');
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// 行首格匹配：spec 的编号行 / ROADMAP 的版本行
const RE_SPEC_ROW = /^\|\s*\*\*(G\d+[a-z]?)\*\*\s*\|/;
const RE_VERSION_ROW = /^\|\s*\*\*(v\d+\.\d+\.\d+)\*\*\s*\|/;
// 编号词元：先长后短，保证 G5b 不被截成 G5（`\b` 在字母后失败）
const RE_GID = /\bG(?:1[0-4]|[1-9])[a-z]?\b/g;
const RE_VERSION = /v\d+\.\d+\.\d+/g;
// 交付声称语境（C6 用）：只有这类行才构成「某版本已交付该编号」的口径
const DELIVERY_RE = /已.{0,4}覆盖|已.{0,4}交付|已发版|✅/;

function argVal(name) {
  const i = ARGV.indexOf(name);
  return i >= 0 && ARGV[i + 1] ? ARGV[i + 1] : null;
}
const baseId = (id) => id.replace(/[a-z]$/, '');
// 见证集合：全号 + （子号时）基号
const witnessIds = (id) => (id === baseId(id) ? [id] : [id, baseId(id)]);
const hitLines = (text, id) =>
  text.split('\n').filter((l) => witnessIds(id).some((w) => new RegExp(`\\b${w}\\b`).test(l)));

function collectGids(text) {
  const out = new Set();
  for (const m of text.matchAll(RE_GID)) out.add(m[0]);
  return out;
}

// 解析 spec：编号行 → { id, cell, versions, delivered }
// 🔴 承载版本提取纪律：排期列里还会出现**依赖版本 / 复用来源版本**（如「依赖 worklog
//    v1.3.9」「自 v1.4.8 迁入」「身份复用 v1.3.1」）——这些不是承载版本。取法是
//    **第一处加粗片段内的首个版本**（`**v1.4.9**` / `**✅ v1.4.7 已交付**`）；
//    无加粗时才退化为整格首个版本。贪婪取全部版本 = 把依赖当成排期（实测 8 处误报）。
function parseSpec(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    if (!RE_SPEC_ROW.test(line)) continue;
    const cols = line.split('|').map((c) => c.trim()).filter((c) => c !== '');
    const cell = cols[cols.length - 1] || '';
    const bold = cell.match(/\*\*(.+?)\*\*/);
    // 加粗段 = 承载声明本身：它里面没有版本号就是「无版本承载」（C1），**不回落**到
    // 格内首个版本——否则「**待定**（依赖 worklog v1.3.9）」会把依赖版本当成排期，
    // C1 漏报（实测：注入「待定」只报出 C3，未报「无承载版本」）。
    const versions = bold
      ? (bold[1].match(RE_VERSION) || []).slice(0, 1)
      : [...new Set(cell.match(RE_VERSION) || [])].slice(0, 1);
    rows.push({
      id: line.match(RE_SPEC_ROW)[1],
      cell,
      versions,
      delivered: /✅/.test(cell),
    });
  }
  return rows;
}

// 解析 ROADMAP：版本 → 该版本各行的合并文本
function parseRoadmap(text) {
  const rows = new Map();
  for (const line of text.split('\n')) {
    const m = line.match(RE_VERSION_ROW);
    if (!m) continue;
    rows.set(m[1], (rows.get(m[1]) || '') + '\n' + line);
  }
  return rows;
}

function changelogPath(version) {
  const m = version.match(/^v(\d+)\.(\d+)\.\d+$/);
  return m ? path.join(REPO, 'docs', 'changelog', `v${m[1]}.${m[2]}`, `${version}.md`) : null;
}

// 核心判定（依赖全部外部注入 → --selftest 复用同一判定逻辑）
function analyze({ specText, roadmapText, tags, readChangelog }) {
  const fails = [];
  const warns = [];
  const rows = parseSpec(specText);
  const roadmapRows = parseRoadmap(roadmapText);
  const tagSet = new Set(tags);

  if (rows.length === 0) {
    fails.push({ id: 'C0', detail: 'spec 中解析不到任何编号行（形如 `| **G1** | …`）——路径给错或表格格式变了，拒绝静默通过' });
    return { fails, warns, rows };
  }

  // 开源侧出现的全部编号（ROADMAP + spec 相关版本开发日志）
  const clCache = new Map();
  const readCl = (v) => {
    if (!clCache.has(v)) clCache.set(v, readChangelog(v));
    return clCache.get(v);
  };
  const openSideIds = new Set(collectGids(roadmapText));
  for (const row of rows) for (const v of row.versions) for (const id of collectGids(readCl(v))) openSideIds.add(id);

  for (const row of rows) {
    // C1
    if (row.versions.length === 0) {
      fails.push({ id: 'C1', detail: `${row.id} 未给出承载版本（禁「待定 / 无版本」）——排期列原文：${row.cell.slice(0, 60)}` });
      continue;
    }
    for (const ver of row.versions) {
      const cl = readCl(ver);
      // C2
      if (!roadmapRows.has(ver) && cl === '') {
        fails.push({ id: 'C2', detail: `${row.id} 标承载版本 ${ver}，但 ROADMAP 无该版本行、也无 ${ver} 开发日志` });
        continue;
      }
      // C3
      if (hitLines(roadmapRows.get(ver) || '', row.id).length === 0 && hitLines(cl, row.id).length === 0) {
        fails.push({ id: 'C3', detail: `${row.id} 标承载版本 ${ver}，但该版本行与开发日志均未提及该编号（含基号）` });
      }
      // C4
      if (row.delivered && !tagSet.has(ver)) {
        fails.push({ id: 'C4', detail: `${row.id} 标 ${ver} 为 ✅ 已交付，但 git tag 中无 ${ver}——计划被写成了已交付` });
      }
    }
    // C6 交接口径冲突（WARN）：spec 声明的承载版本之外，开源侧还有谁**声称已交付**该编号。
    // 三条归因纪律（每条都压掉一类实测误报）：
    //   ① 只认**精确编号**，不认基号——G5b（连接器注册）不能拿 G5（数据源接入）的交付
    //      声称顶包，否则子号永远背着父号的历史。
    //   ② 只认**行内写了版本号**的行。行内无版本 = 无版本主张（实测形态：v1.4.7 日志
    //      写「cost_query（G3 已交付）」只是复述事实），按文件所在版本归因必然误报。
    //   ③ 行内版本号与 spec 声明**有交集即视为一致**——一条交付声称常写成
    //      「v1.4.0/v1.4.2/v1.4.4 已分别覆盖 G3 / G5 / G1」的合并句，逐号归因会错。
    const conflicts = new Set();
    const reId = new RegExp(`\\b${row.id}\\b`);
    for (const v of roadmapRows.keys()) {
      if (row.versions.includes(v)) continue;
      for (const text of [roadmapRows.get(v), readCl(v)]) {
        for (const line of text.split('\n')) {
          if (!DELIVERY_RE.test(line) || !reId.test(line)) continue;
          const lv = line.match(RE_VERSION) || [];
          if (lv.length === 0) continue;
          if (lv.some((x) => row.versions.includes(x))) continue;
          conflicts.add(v);
        }
      }
    }
    if (conflicts.size) {
      warns.push(`${row.id} spec 声明承载 ${row.versions.join('/')}，但开源侧 ${[...conflicts].sort().join(' / ')} 也声称已交付该编号——两处口径必须有一处改`);
    }
  }

  // C5 编号双向完整
  const specIds = new Set(rows.map((r) => r.id));
  const specWitness = new Set();
  for (const id of specIds) for (const w of witnessIds(id)) specWitness.add(w);
  for (const id of specIds) {
    if (!witnessIds(id).some((w) => openSideIds.has(w))) {
      fails.push({ id: 'C5', detail: `spec 定义了 ${id}，但开源侧从未出现该编号或其基号——单边定义` });
    }
  }
  for (const id of openSideIds) {
    if (!specWitness.has(id)) {
      fails.push({ id: 'C5', detail: `开源侧引用了 ${id}，但 spec 表中无此编号定义——开放编号缺定义（可能是 renumber 残留）` });
    }
  }

  return { fails, warns, rows };
}

// 常态：读真实文档 + 真实 tag
function main() {
  const specPath = argVal('--spec');
  const roadmapPath = argVal('--roadmap') || path.join(REPO, 'docs', 'ROADMAP.md');

  if (!specPath) {
    console.log('⏭  SKIP：未提供 --spec（商业机制文档不进开源仓）——本门禁仅在商业侧对账时生效。');
    console.log('   商业侧用法：node tools/check/check-interface-roadmap.mjs --spec <商业机制文档路径>');
    console.log('   SKIP 不影响退出码，但**不算通过**：对账必须带 spec 实跑一次。');
    return 0;
  }
  if (!existsSync(specPath)) {
    console.log(`✗ 用法错误：--spec 路径不存在：${specPath}`);
    return 2;
  }
  if (!existsSync(roadmapPath)) {
    console.log(`✗ 用法错误：ROADMAP 路径不存在：${roadmapPath}`);
    return 2;
  }

  let tags = [];
  let tagFail = false;
  try {
    tags = execFileSync('git', ['tag'], { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    tagFail = true;
  }

  const { fails, warns, rows } = analyze({
    specText: readFileSync(specPath, 'utf8'),
    roadmapText: readFileSync(roadmapPath, 'utf8'),
    tags,
    readChangelog: (v) => {
      const p = changelogPath(v);
      return p && existsSync(p) ? readFileSync(p, 'utf8') : '';
    },
  });

  console.log('── 接口编号承载对账 ──');
  console.log(`  spec：${specPath}`);
  console.log(`  ROADMAP：${path.relative(REPO, roadmapPath)}  ·  编号行 ${rows.length} 条  ·  git tag ${tags.length} 个`);
  console.log(`  已交付式 ${rows.filter((r) => r.delivered).length} 条 / 排期中 ${rows.filter((r) => !r.delivered).length} 条`);
  if (tagFail) console.log('  ⚠️  git tag 读取失败——C4 幽灵交付判定降级为跳过（本次不做该判定）。');
  console.log(`  C1 编号-版本绑定 / C2 承载版本存在 / C3 版本须提及编号 / C4 幽灵交付 / C5 编号双向完整：${fails.length === 0 ? '✅ 全绿' : `❌ ${fails.length} 处 FAIL`}`);
  for (const w of warns) console.log(`  ⚠️  WARN(C6)：${w}`);

  if (fails.length === 0) {
    console.log(`\n✓ 接口承载对账全绿（WARN ${warns.length}——WARN 不阻断，但需人工裁定后才算收口）`);
    return 0;
  }
  console.log('');
  for (const f of fails) console.log(`  ❌ 【${f.id}】${f.detail}`);
  console.log(`\n✗ 接口承载对账 ${fails.length} 处 FAIL（WARN ${warns.length}）——先修 spec 与本仓排期的一方，再重跑。`);
  return 1;
}

// --selftest 合成回归：注入五类漂移 → 必报红（红不了的门禁是装饰品）
function selftest() {
  console.log('── --selftest 合成回归（注入漂移 → 必报红）──');
  const roadmapText = [
    '| **v1.4.7** | 🔨 开发完成（待发版） | 平台接口 G2 / G4 / G13 | [日志](./changelog/v1.4/v1.4.7.md) |',
    '| **v1.5.1** | 📋 规划中 | 事件驱动（不含任何编号） | [日志](./changelog/v1.5/v1.5.1.md) |',
  ].join('\n');
  const specText = [
    '| **G1** | 正常行 | 承载 | **✅ v1.4.7 已交付** |',
    '| **G2** | 无版本 | 承载 | **待定** |',
    '| **G3** | 幽灵版本 | 承载 | **v9.9.9** |',
    '| **G4** | 版本未提及编号 | 承载 | **v1.5.1** |',
    '| **G5** | 幽灵交付 | 承载 | **✅ v1.5.1 已交付** |',
    '| **G99** | 编号单边定义 | 承载 | **v1.4.7** |',
  ].join('\n');

  const { fails, warns } = analyze({
    specText,
    roadmapText,
    tags: ['v1.4.7'], // 合成 tag 集：v1.5.1 未发版 → G5 的 ✅ 是幽灵
    readChangelog: () => '',
  });

  const expect = [
    ['C1', 'G2 无承载版本'],
    ['C2', 'G3 承载版本 v9.9.9 不存在'],
    ['C3', 'G4 承载版本行未提及编号'],
    ['C4', 'G5 标 ✅ 但 v1.5.1 无 tag'],
    ['C5', 'G99 单边定义（开源侧无此编号）'],
  ];
  let ok = true;
  for (const [id, desc] of expect) {
    const n = fails.filter((f) => f.id === id).length;
    console.log(`  ${n > 0 ? '✓' : '✗'} ${id} 命中 ×${n}：${desc}`);
    if (n === 0) ok = false;
  }
  // C6 反向断言：G13 只在 ROADMAP（不在 spec）→ 必出 C5 反向项，同时不该静默吞掉
  const rev = fails.filter((f) => f.id === 'C5' && /开源侧引用了/.test(f.detail)).length;
  console.log(`  ${rev > 0 ? '✓' : '✗'} C5 反向 ×${rev}：ROADMAP 的 G13 在 spec 中无定义`);
  if (rev === 0) ok = false;
  console.log(`  · C6 WARN ×${warns.length}（不参与断言——WARN 不阻断）`);
  console.log(ok ? '\n✓ 合成回归通过：五类漂移全部报红，门禁具备故障可见性。' : '\n✗ 合成回归失败：存在漏报，门禁不可信。');
  return ok ? 0 : 1;
}

// 入口
if (ARGV.includes('--help') || ARGV.includes('-h')) {
  console.log('接口编号承载对账门禁 —— 校验商业机制文档的接口编号（G1-G14）能否在开源');
  console.log('ROADMAP / 开发日志中找到真实承载版本，堵住「标了版本却未落地」的漂移。');
  console.log('');
  console.log('  --spec <路径>     必填（实际对账时）：商业机制文档路径。不提供则打印 SKIP 并 exit 0。');
  console.log('  --roadmap <路径>  选填：默认 docs/ROADMAP.md');
  console.log('  --selftest        合成回归：注入五类漂移 → 必报红');
  console.log('  --help            本帮助');
  console.log('');
  console.log('判定：C1 编号-版本绑定 / C2 承载版本存在 / C3 版本须提及编号 / C4 幽灵交付 /');
  console.log('      C5 编号双向完整（以上 FAIL）；C6 交接口径冲突（WARN 不阻断）。');
  console.log('退出码：0 = 全绿（含 SKIP）/ 1 = 有 FAIL / 2 = 用法错误');
  process.exit(0);
}
if (SELFTEST) process.exit(selftest());
process.exit(main());
