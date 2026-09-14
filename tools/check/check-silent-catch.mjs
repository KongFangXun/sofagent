#!/usr/bin/env node
// ============================================================
// check-silent-catch.mjs · 静默吞错门禁（v1.4.8 F-10 门禁前移）
// ============================================================
// 用法: node tools/check/check-silent-catch.mjs [--update-baseline] [--update-prefilter-exempt]
//                                       [--migrate-baseline-key-format]
//
// 扫描 engine 各子包 src 下的「catch 后空块或仅注释块」，且所在文件
// 含 audit / persist / notice / daemon / history / write / snapshot
// 关键词（关键持久化路径）的，输出 ❌ 清单。
// 扫描面（v1.4.8 起）：engine/ 一级包 src **＋** engine/dsh-plugins/*/src 与
// engine/openclaw-plugins/*/src（嵌套二级插件，此前为覆盖盲区）——共 28 个包。
//
// 实现说明：仓库 typescript 为 6.x（package exports 只开 ./lib/version.cjs
// 与 unstable API 面，无经典 createSourceFile 走线）——正则轻扫替代 AST：
// catch 子句的空块形态语法固定（catch (e) { } / catch { /* 注释 */ }），
// 「} 或 {」配平在同行内判定；跨行空块由「catch 行后紧跟的下一个非空行
// 是 }」覆盖。误报面：字符串字面量含 catch 字样——由关键路径文件预筛
// 收窄，且基线机制兜底。
//
// 🔴 已知误报类显式登记（下次碰撞时按已知类处理，勿当新增）：
//   类 A · TS 模板字符串内嵌 shell/文本 —— 字符串里的 catch 字样被正则扫到，
//          实际不是 TS 控制流。样例行：engine/core/src/config-template.ts:135
//          （模板字面量内的 shell 片段）。判据：命中行位于反引号模板内、
//          且不属「关键持久化路径」语义面 ⇒ 误报。
//   处置：新增命中若属此类，**勿改判定逻辑**（会削弱真命中），改为在基线登记并注明类 A。
//
// 存量豁免：首跑产出基线清单 tools/check/silent-catch-baseline.json，
// 门禁只拦**新增**空 catch（存量按节奏消化）。--update-baseline 重生成。
//
// 🔴 基线键格式：**内容级**（v1.4.9 G-7 迁移，原为行号级）
//   键 = `<文件相对仓库根>::#<同文件同子句内 1-based 出现序号>::<归一化 catch 子句>`
//   例：`engine/audit/src/cli/conflict-check.ts::#1::catch { // skip }`
//   归一化：子句自 `catch` 关键字起、到本 catch 块闭合 `}` 止（跨行空块含其间的注释行），
//           所有空白串折叠为单个空格后 trim。
//
//   为何从行号键迁走——行号键的两个实测后果（G-7 立案依据）：
//     (a) **行号平移即假阳性**：在既有 catch 上方插一行（空行/注释）⇒ 键变孤儿、
//         原键被读成「新增」⇒ 红。v1.4.9 批三续行时就发生过（304 条里 7 条位移假阳性，
//         靠**定向重定键**救回）。内容级键下平移**必然 0 假阳性**（键里没有行号）。
//     (b) **基线腐化**：行号键无法自证指向的是 catch——历史上曾出现 17/304 条指向
//         `try {` / `if (!commitMsg) {` / `}` / 注释行。内容级键自带「这是哪个 catch」，
//         指向漂移在构造上不可能。
//
//   为何必须带**出现序号**（要求 2）：同一文件内**子句完全相同**的静默 catch 不止一处——
//     实测 304 站点里有 **15 组共 34 个站点**是同文件同子句重复（如
//     `engine/audit/src/commands/init.ts` 的 `catch { // 读不了就当不存在 }` 出现 **3 次**）。
//     若键只含 `<文件>::<子句>`，34 个站点会塌缩为 15 个键 ⇒ **19 个站点不可见**（去重吞掉）。
//     带序号后：同文件同子句的第 N 处各有独立键；新增第 N+1 处 ⇒ 新键 ⇒ 必红；
//     删掉其中一处 ⇒ 少一个键 ⇒ 旧键变「陈旧」并**可见打印**（不是静默）。
//
//   键格式自证（供旧/新格式判别）：内容级键**必定含 `::#`**。运行时若发现基线里存在
//   不含 `::#` 的条目 ⇒ 判为旧行号键（或混格式），打印迁移指引并 **exit 1**（不静默、
//   也不把整批既有站点误读成「新增」刷屏）。
//
//   迁移（一次性，**格式迁移不是 `--update-baseline` 全量重建**）：
//     node tools/check/check-silent-catch.mjs --migrate-baseline-key-format
//     该模式**只做 1:1 重键**：要求「旧键逐条对应当前实测站点」且「新键数 == 旧键数」
//     且「无新键缺旧键 / 无旧键对多新键」，任一不成立 ⇒ 打印 ❌ 且**不写盘**，exit 1。
//     ⇒ 它**不能**被用来洗白新增静默 catch（新增站点没有旧键 ⇒ 计数不等 ⇒ 拒绝）。
//       （仓内铁律仍适用：禁 `--update-baseline` 全量重建。）
//
//   陈旧条目（stale）可见化：基线里已不再被实测命中的键（如某处 catch 已被修好、
//     或子句被改写）**每次运行打印计数与样例**，不阻断退出码——让基线**不能悄悄烂掉**。
//
//
// 前置过滤豁免登记（v1.4.9 G-2① · 「门禁绿 = 增量为零 ≠ 债清零」第三层稀释修复）：
//   本脚本 :81 起有两道文件级前置过滤——**文件名/路径**不含关键路径关键词
//   （audit|persist|notice|daemon|history|snapshot|write|crypto|hmac）且**前 2000 字符**
//   也不含时，整个文件被 `continue` 跳过，其 catch 子句从不经本门禁判定。
//   实测（v1.4.9 复现，与第 3 份审查报告数字逐字吻合）：扫描面 617 个 .ts →
//   实际判定 450 个 / **前置过滤跳过 167 个（27.1%）**，其中 83 个文件含
//   **177 个 catch 子句零覆盖**（含 engine/ab-test/src/ab-runner.ts 4 处——正是 P1-5
//   「静默降级链」所在文件，恰是滤网制造的真实盲区，非理论风险）。
//   修复口径：被过滤文件**清单落盘**（tools/check/silent-catch-prefilter-exempt.json），
//   每次运行显式打印「豁免 N 个 / 其中含 catch 子句 M 个 / K 处」，并检测登记表漂移
//   （新出现的未登记跳过 / 已登记但不再跳过）。**不再静默跳过**。
//   ⚠️ 语义边界（诚实标注，勿误读为已修）：落盘的是「已知覆盖盲区」的显式承认，
//   不是「已检查」——登记表只让盲区可见可审计，把盲区收窄需逐文件把关键词纳入判定面
//   或改前置过滤为内容级判据（属门禁演进，不在 v1.4.9 批）。因此 K>0 不阻断退出码，
//   但必须打印（发版 SOP「SKIP 数逐条裁决」步骤逐条裁定）。
//   为何不阻断新跳过：前置过滤是**误报抑制**启发式（非关键路径文件默认不判），
//   任何新增非持久化文件都会合法落此名单——阻断会制造持续噪音并诱导 `--update-*`
//   一键消音，反而稀释门禁。故取「可见 + 需显式登记」而非「默认阻断」。
//
// 退出码: 0 = 无新增静默吞错 / 1 = 有新增 **或** 基线键格式非内容级 / 检查器失明 /
//            迁移被拒（后三者均为「拒绝假绿」路径，无需区分——stderr 文案已明示原因）
// ============================================================

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const ENGINE = path.join(ROOT, 'engine');
const BASELINE = path.join(ROOT, 'tools/check/silent-catch-baseline.json');
// 前置过滤豁免登记表（v1.4.9 G-2①）：被文件级前置过滤跳过的文件清单，清单落盘不再静默跳过
const PREFILTER_EXEMPT = path.join(ROOT, 'tools/check/silent-catch-prefilter-exempt.json');
const UPDATE = process.argv.includes('--update-baseline');
const UPDATE_EXEMPT = process.argv.includes('--update-prefilter-exempt');
// 格式迁移（v1.4.9 G-7）：旧行号键 → 新内容键。**不是** `--update-baseline` 全量重建。
const MIGRATE = process.argv.includes('--migrate-baseline-key-format');

// 关键路径关键词（命中任一即视为「失败不可无痕」域）
const CRITICAL_FILE_HINTS = /audit|persist|notice|daemon|history|snapshot|write|crypto|hmac/i;

// 同行空 catch：catch (...) { } 或 catch { } 或 catch (...) { /* 仅注释 */ }
const SAME_LINE_EMPTY = /catch\s*(\([^)]*\))?\s*\{[\s]*(?:\/\*[^*]*\*\/|\/\/[^\n]*)?[\s]*\}/;

// catch 子句（用于量化被前置过滤跳过的文件的覆盖盲区规模）
const CATCH_CLAUSE = /catch\s*(\([^)]*\))?\s*\{/g;

// 子句归一化（v1.4.9 G-7 内容级键）：空白串（含换行）折叠为单空格后 trim。
// 目的：让「重排格式 / 改缩进 / 改注释换行」不产生新键，而「改子句内容」产生新键。
function normalizeClause(raw) {
  return String(raw).replace(/\s+/g, ' ').trim();
}

// 覆盖度行（v1.4.9 G-2②）：与 tools/check/lib/coverage-line.sh 逐字段同格式同语义。
//   asserts = 真正做出判定的断言数（本脚本 v1.4.9 G-7 起 3 条：
//             ① 新增空 catch 判定 ② 基线键格式自证（不含 `::#` ⇒ 拒绝在旧格式上比对）
//             ③ 失明自检（扫描 0 站点但基线非空 ⇒ 拒绝假绿））
//   covered = 实际进入判定的文件数 · skipped = 被前置过滤跳过的文件数
function emitCoverage(asserts, covered, skipped) {
  console.log(`[check:coverage] script=check-silent-catch asserts=${asserts} covered=${covered} skipped=${skipped}`);
}

function collectSources(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['dist', 'node_modules', '__tests__'].includes(e.name)) continue;
      collectSources(p, out);
    } else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts') && !e.name.endsWith('.test.ts')) {
      out.push(p);
    }
  }
  return out;
}

// 站点（v1.4.9 G-7）：内容级键的原料，也是本轮命中的**唯一**真源（原 `findings`
// 的 `文件:行` 由它派生 —— 单一真源，避免两套清单漂移）。
// `line` 保留用于：①迁移时旧行号键→新内容键的 1:1 映射 ②人读输出定位。
const sites = []; // { rel, line, clause, seq, key }
// 前置过滤统计（v1.4.9 G-2①）：被 continue 跳过的文件**逐个登记**，不再静默
const prefilterSkipped = [];
const skippedWithCatch = new Map(); // rel -> catch 子句数（>0 才是真覆盖盲区）
const scannedFiles = [];
// v1.4.8 补面：原实现只取 engine/ 一级（`engine/<pkg>/src`），dsh-plugins/ 与
// openclaw-plugins/ 下的插件 src **完全不经此门禁**（覆盖盲区，见审查报告 6.2）。
// 现补扫这两族的嵌套二级目录——注意 `.map(e => e.name)` 与下方 `pkgName` 的成对改动。
const packages = fs.readdirSync(ENGINE, { withFileTypes: true })
  .filter(e => e.isDirectory() && fs.existsSync(path.join(ENGINE, e.name, 'src')))
  .map(e => e.name);
for (const nested of ['dsh-plugins', 'openclaw-plugins']) {
  const nestedDir = path.join(ENGINE, nested);
  if (!fs.existsSync(nestedDir)) continue;
  for (const e of fs.readdirSync(nestedDir, { withFileTypes: true })) {
    const relDir = `${nested}/${e.name}`;
    if (e.isDirectory() && fs.existsSync(path.join(ENGINE, relDir, 'src'))) packages.push(relDir);
  }
}

for (const pkgName of packages) {
  const srcDir = path.join(ENGINE, pkgName, 'src');
  for (const file of collectSources(srcDir)) {
    const rel = path.relative(ROOT, file);
    const content = fs.readFileSync(file, 'utf8');
    if (!CRITICAL_FILE_HINTS.test(rel) && !CRITICAL_FILE_HINTS.test(content.slice(0, 2000))) {
      // 文件级前置过滤命中：本文件整体不进 catch 判定——**登记盲区**（v1.4.9 G-2①）
      prefilterSkipped.push(rel);
      const clauses = (content.match(CATCH_CLAUSE) || []).length;
      if (clauses > 0) skippedWithCatch.set(rel, clauses);
      else skippedWithCatch.set(rel, 0);
      continue;
    }
    scannedFiles.push(rel);
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.includes('catch')) continue;
      // 豁免：注释里写明「为何可静默」
      const ctx = lines.slice(i, i + 4).join('\n');
      if (/为何可静默/.test(ctx)) continue;
      // 子句文本起点（v1.4.9 G-7）：自本行首个 `catch` 起——判定仍在本行上做（行为不变），
      // 仅取键原料时剥掉 catch 之前的前缀（如 `} else {`）。
      const ci = line.indexOf('catch');
      const head = ci >= 0 ? line.slice(ci) : line;
      // 形态一：同行空块
      if (SAME_LINE_EMPTY.test(line)) {
        // 子句文本：自首个 catch 起到本 catch 块闭合 }。
        // 用「切片后重匹配」与本行判定同源（判定在整行上做，子句只取 catch 起的那一段，
        // 避免把行首 `} else {` 之类前缀带进键）。
        const m = head.match(SAME_LINE_EMPTY);
        sites.push({ rel, line: i + 1, clause: normalizeClause(m ? m[0] : head) });
        continue;
      }
      // 形态二：catch 行只有 {，下一非空行是 }（跨行空块，可含注释行）
      if (/catch\s*(\([^)]*\))?\s*\{\s*$/.test(line)) {
        let j = i + 1;
        while (j < lines.length && (lines[j].trim() === '' || lines[j].trim().startsWith('//') || lines[j].trim().startsWith('/*') || lines[j].trim().startsWith('*'))) j++;
        if (j < lines.length && lines[j].trim().startsWith('}')) {
          // 子句 = catch 头行 + 其间注释/空行 + 闭合行到 }。空白折叠后即「catch … { …注释… }」
          const mid = lines.slice(i + 1, j).join('\n');
          const close = lines[j].slice(0, lines[j].indexOf('}') + 1);
          sites.push({ rel, line: i + 1, clause: normalizeClause(`${head}\n${mid}\n${close}`) });
        }
      }
    }
  }
}

// ── 内容级键生成（v1.4.9 G-7）────────────────────────────────
//   <rel>::#<同文件同子句内 1-based 出现序号>::<归一化子句>
//   ⚠️ 序号**必需**：实测 304 站点里有 15 组共 34 个站点是同文件同子句重复
//      （最多 3 次）——只含 `<rel>::<clause>` 会因去重把 34 塌缩成 15 ⇒ 19 个站点不可见。
const clauseSeq = new Map(); // `<rel>::<clause>` -> 已见次数
for (const s of sites) {
  const gk = `${s.rel}::${s.clause}`;
  const n = (clauseSeq.get(gk) || 0) + 1;
  clauseSeq.set(gk, n);
  s.seq = n;
  s.key = `${s.rel}::#${n}::${s.clause}`;
}
const contentKeys = sites.map(s => s.key);
// 旧行号键 `<rel>:<line>` → 新内容键（迁移 1:1 映射用；同一行至多一个站点，构造上单射）
const lineToKey = new Map(sites.map(s => [`${s.rel}:${s.line}`, s.key]));
// 内容键 → 首个 `文件:行`（人读输出/定位用）
const keyToLoc = new Map();
for (const s of sites) if (!keyToLoc.has(s.key)) keyToLoc.set(s.key, `${s.rel}:${s.line}`);

let baseline = [];
if (fs.existsSync(BASELINE)) {
  baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
}

// ── 键格式自证（v1.4.9 G-7）────────────────────────────────────
// 内容级键**必定含 `::#`**。基线里存在不含 `::#` 的条目 ⇒ 旧行号键（或混格式）⇒
// 打印迁移指引并 exit 1：既不静默，也不把整批既有站点误读成「新增」而刷屏。
const legacyKeys = baseline.filter(k => !String(k).includes('::#'));

// ── 前置过滤豁免登记（v1.4.9 G-2①）────────────────────────────
// 被过滤文件名/内容特征的文件整体跳过 catch 判定——清单落盘 + 每次运行显式打印。
// 登记表为「已承认的覆盖盲区」台账：新跳过未登记 = 台账漂移（打印告警）；
// 已登记但不再跳过 = 滤网条件变了（打印提示，可安全从台账移除）。
const skippedList = [...new Set(prefilterSkipped)].sort();
const skippedCatchFiles = skippedList.filter(f => (skippedWithCatch.get(f) || 0) > 0);
const skippedCatchClauses = skippedCatchFiles.reduce((a, f) => a + (skippedWithCatch.get(f) || 0), 0);

let exemptBaseline = [];
let exemptFileExists = fs.existsSync(PREFILTER_EXEMPT);
if (exemptFileExists) {
  exemptBaseline = JSON.parse(fs.readFileSync(PREFILTER_EXEMPT, 'utf8'));
}

if (UPDATE_EXEMPT) {
  fs.writeFileSync(PREFILTER_EXEMPT, JSON.stringify(skippedList, null, 2) + '\n');
  console.log(
    `前置过滤豁免表已更新：${skippedList.length} 个文件（其中含 catch 子句 ${skippedCatchFiles.length} 个 / ${skippedCatchClauses} 处）` +
      ` → ${path.relative(ROOT, PREFILTER_EXEMPT)}`,
  );
  process.exit(0);
}

const newlySkipped = skippedList.filter(f => !exemptBaseline.includes(f));
const staleExempt = exemptBaseline.filter(f => !skippedList.includes(f));

function reportPrefilterExemption() {
  console.log(
    `📊 前置过滤豁免（显式登记 · 不再静默跳过）：跳过 ${skippedList.length} 个 / 实际判定 ${scannedFiles.length} 个` +
      `（扫描面 ${skippedList.length + scannedFiles.length} 个 .ts）`,
  );
  console.log(
    `   ⚠️ 其中 ${skippedCatchFiles.length} 个文件含 ${skippedCatchClauses} 处 catch 子句**零覆盖**——本门禁从不判定它们（已知覆盖盲区，非「已检查」）`,
  );
  if (!exemptFileExists) {
    console.log(
      `   ⚠️ 豁免登记表缺失（${path.relative(ROOT, PREFILTER_EXEMPT)}）——本次视为全部未登记，` +
        `请跑 node tools/check/check-silent-catch.mjs --update-prefilter-exempt 建立台账`,
    );
  } else if (newlySkipped.length > 0) {
    console.log(`   ⚠️ 新出现的未登记跳过文件 ${newlySkipped.length} 个——台账漂移，请复核后收编：`);
    for (const f of newlySkipped.slice(0, 10)) {
      console.log(`      ${f}（catch 子句 ${skippedWithCatch.get(f) || 0} 处）`);
    }
    if (newlySkipped.length > 10) console.log(`      ... 共 ${newlySkipped.length} 个`);
  } else if (staleExempt.length > 0) {
    console.log(`   ℹ️ 台账中 ${staleExempt.length} 个文件已不再被过滤（滤网条件变或文件已删），可移除：`);
    for (const f of staleExempt.slice(0, 10)) console.log(`      ${f}`);
    if (staleExempt.length > 10) console.log(`      ... 共 ${staleExempt.length} 个`);
  } else {
    console.log(`   ✓ 豁免台账与实测一致（${skippedList.length}/${skippedList.length}，登记表 ${path.relative(ROOT, PREFILTER_EXEMPT)}）`);
  }
}

// ── 格式迁移（一次性 · v1.4.9 G-7）：旧行号键 → 新内容键 ────────────
// 只做 **1:1 重键**，四条不变量全成立才写盘；任一不成立 ⇒ 打印 ❌ 且**不写盘** exit 1。
// 因此它**不能**被用来洗白新增静默 catch（新增站点无旧键 ⇒ 计数不等 ⇒ 拒绝）。
if (MIGRATE) {
  const oldKeys = [...new Set(baseline)];
  const problems = [];
  // 不变量 ①：基线须为纯旧格式（不得已含内容级键）——否则是重复迁移或格式混用
  const alreadyNew = oldKeys.filter(k => String(k).includes('::#'));
  if (alreadyNew.length > 0) {
    problems.push(`基线里已有 ${alreadyNew.length} 条内容级键（含 ::#）——已迁移过或格式混用，勿重复迁移`);
  }
  // 不变量 ②：每条旧键必须能映射到当前实测站点（旧键 = `<rel>:<line>`）
  const orphanOld = oldKeys.filter(k => !lineToKey.has(k));
  if (orphanOld.length > 0) {
    problems.push(
      `有 ${orphanOld.length} 条旧键在当前实测站点里找不到对应行（孤儿/腐化条目）——不能等价映射`,
    );
  }
  const mappedNew = [...new Set(oldKeys.map(k => lineToKey.get(k)).filter(Boolean))];
  // 不变量 ③：新键唯一数 == 旧键数（无一对多塌缩、无丢键）
  if (mappedNew.length !== oldKeys.length) {
    problems.push(`新键唯一数 ${mappedNew.length} ≠ 旧键数 ${oldKeys.length}（一对多塌缩或丢键）`);
  }
  // 不变量 ④：无「新键缺旧键」——当前实测站点不得有未出现在映射结果里的（= 新增未登记）
  const unmappedSites = contentKeys.filter(k => !mappedNew.includes(k));
  if (unmappedSites.length > 0) {
    problems.push(
      `有 ${unmappedSites.length} 个当前实测站点不在迁移结果里（新增未登记或行号漂移）——不是 1:1 迁移`,
    );
  }
  console.log(
    `迁移映射：旧键 ${oldKeys.length} 条 → 新键 ${mappedNew.length} 条` +
      `（实测站点 ${contentKeys.length} 个 / 格式异常旧键 ${alreadyNew.length} 条 / 孤儿旧键 ${orphanOld.length} 条 / 未覆盖站点 ${unmappedSites.length} 个）`,
  );
  if (problems.length > 0) {
    console.error('❌ 基线键格式迁移被拒绝（**不写盘**，exit 1）：');
    for (const p of problems) console.error(`  · ${p}`);
    console.error('说明：这是 1:1 **格式迁移**，不是 --update-baseline 全量重建——');
    console.error('     新增静默 catch / 基线漂移都不会被本模式吸收。若基线已漂移，请先按');
    console.error('     定向重定键把基线修到与实测逐条对应，再重跑本迁移。');
    process.exit(1);
  }
  fs.writeFileSync(BASELINE, JSON.stringify([...mappedNew].sort(), null, 2) + '\n');
  console.log(
    `✓ 基线键格式迁移完成（1:1 可证）：${oldKeys.length} 条行号键 → ${mappedNew.length} 条内容键 → ${path.relative(ROOT, BASELINE)}`,
  );
  // 迁移后自证：写盘内容必须与新键集合**双向相等**（集合差为空）
  const written = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const setEq =
    written.length === mappedNew.length &&
    written.every(k => mappedNew.includes(k)) &&
    mappedNew.every(k => written.includes(k));
  console.log(
    `  双向集合差为空？ ${setEq ? 'YES' : 'NO'}（写盘 ${written.length} / 期望 ${mappedNew.length}）`,
  );
  if (!setEq) process.exit(1);
  reportPrefilterExemption();
  emitCoverage(3, scannedFiles.length, skippedList.length);
  process.exit(0);
}

if (UPDATE) {
  // 单一格式（v1.4.9 G-7）：`--update-baseline` 也写**内容级键**——避免产出旧行号格式的回退。
  fs.writeFileSync(BASELINE, JSON.stringify([...new Set(contentKeys)].sort(), null, 2) + '\n');
  console.log(`基线已更新：${new Set(contentKeys).size} 条存量记录（内容级键）→ ${path.relative(ROOT, BASELINE)}`);
  reportPrefilterExemption();
  emitCoverage(3, scannedFiles.length, skippedList.length);
  process.exit(0);
}

// 旧行号键未被迁移 ⇒ 拒绝在旧格式上继续比对（否则整批站点会被误读成「新增」刷屏）
if (legacyKeys.length > 0) {
  console.error(`❌ 基线存在 ${legacyKeys.length} 条非内容级键（不含 ::#，疑为旧行号格式）：`);
  for (const k of legacyKeys.slice(0, 10)) console.error(`  ${k}`);
  if (legacyKeys.length > 10) console.error(`  ... 共 ${legacyKeys.length} 条`);
  console.error('修法：跑一次一次性格式迁移（1:1 重键，非全量重建）：');
  console.error('  node tools/check/check-silent-catch.mjs --migrate-baseline-key-format');
  process.exit(1);
}

// ── 失明自检（v1.4.9 G-7 · 「空值 ⇒ FAIL，不许静默」）──────────────────
// 扫描产出 0 个站点但基线非空 ⇒ 判定面塌了（路径错 / 扫描面全被过滤 / 源码树消失），
// 此时若照常走「新增 0 ⇒ 绿」就是**守卫空转**——必须 FAIL，拒绝假绿。
if (sites.length === 0 && baseline.length > 0) {
  console.error(
    `❌ 静默吞错检查器失明：扫描面产出 0 个站点，但基线有 ${baseline.length} 条存量——判定面塌了（拒绝假绿）`,
  );
  console.error(`   扫描面文件数 ${scannedFiles.length} / 前置过滤跳过 ${skippedList.length}——请核查扫描根与过滤条件`);
  reportPrefilterExemption();
  emitCoverage(3, scannedFiles.length, skippedList.length);
  process.exit(1);
}
// 键唯一性自证（v1.4.9 G-7）：带出现序号后，站点数必须**逐一**对应唯一键。
// 若不等 ⇒ 序号逻辑失效（34 站点塌缩的旧坑复发）⇒ 必须 FAIL 而不是少报。
if (new Set(contentKeys).size !== sites.length) {
  console.error(
    `❌ 内容级键唯一性自证失败：站点 ${sites.length} 个 / 唯一键 ${new Set(contentKeys).size} 条——序号逻辑失效（会少报站点）`,
  );
  emitCoverage(3, scannedFiles.length, skippedList.length);
  process.exit(1);
}

// ── 陈旧条目可见化（v1.4.9 G-7）──────────────────────────────
// 基线里已不再被实测命中的键（某处 catch 已修好 / 子句被改写）⇒ 打印计数与样例，
// **不阻断退出码**——让基线不能悄悄烂掉，但也不制造假红。
const staleKeys = baseline.filter(k => !contentKeys.includes(k));

const newOnes = contentKeys.filter(k => !baseline.includes(k));
if (newOnes.length === 0) {
  console.log(`✓ 静默吞错检查通过（存量 ${baseline.length} 条内容级键按基线豁免，本轮新增 0）`);
  if (staleKeys.length > 0) {
    console.log(`ℹ️ 基线陈旧条目 ${staleKeys.length} 条（已不再命中实测——catch 已修好或子句已改写，可择机收窄）：`);
    for (const k of staleKeys.slice(0, 5)) console.log(`   ${k}`);
    if (staleKeys.length > 5) console.log(`   ... 共 ${staleKeys.length} 条`);
  } else {
    console.log(`   ✓ 基线无陈旧条目（${baseline.length} 条全部命中实测）`);
  }
  reportPrefilterExemption();
  emitCoverage(3, scannedFiles.length, skippedList.length);
  process.exit(0);
}

console.error(`❌ 检测到 ${newOnes.length} 处新增静默吞错（关键路径 catch 空块）：`);
for (const k of newOnes.slice(0, 20)) {
  console.error(`  ${keyToLoc.get(k) || '?'}  →  ${k}`);
}
if (newOnes.length > 20) console.error(`  ... 共 ${newOnes.length} 处`);
if (staleKeys.length > 0) {
  console.log(`ℹ️ 另有基线陈旧条目 ${staleKeys.length} 条（不阻断，可择机收窄）`);
}
console.error('修法：失败时至少走既有 logger 输出一行 warn（降级可见），或注释「为何可静默」豁免标记。');
console.error('存量修复后收窄基线：node tools/check/check-silent-catch.mjs --update-baseline');
reportPrefilterExemption();
emitCoverage(3, scannedFiles.length, skippedList.length);
process.exit(1);
