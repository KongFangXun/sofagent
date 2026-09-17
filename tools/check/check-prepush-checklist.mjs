#!/usr/bin/env node
// ============================================================
// check-prepush-checklist.mjs · pre-push 检查项清单对账（v1.4.9 G-16）
// ============================================================
// 判据（有界）：'tools/release/pre-push-check.sh' 里的清单注释
//     #   + check-xxx.sh → 说明
// 所声明的**脚本名集合 ⊆ 脚本体内实际被调用的脚本名集合**（**子集**，非相等——
// 清单合法地只列一部分检查项，实现里还有大量未列入清单的步骤）。
//
// 为什么值得装一条守卫：
//   它守的是「**声明了 X、实现里没有 X**」这个缺陷**类**，而这个类在本仓反复出现——
//     · G-12：清单/文档声明有 check-tool-health，实现里零接线（免费绿灯）；
//     · G-11：注释声明有 evolve-gate CLI，全仓没有该可执行；
//     · 以及本守卫的起因：v1.4.9 批 4c 把 pre-push 从 51 项加到 52 项时，
//       「注释里列的和实际调的是否一致」**只能靠人肉 grep**——同一个人肉动作下个版本还得再做一遍。
//   把「声明 ⊆ 实现」变成机器判据后，往清单里写一个没接线的脚本名会当场红。
//
// ── 三态语义（对齐 check-seam-contract / check-legacy-knowledge-path）──
//   0 = 清单 ⊆ 实现（可含「实现多于清单」——这是合法且常见的）
//   1 = 清单里有脚本名**未被调用**（「说了没做」）
//   2 = 检查器失明（清单提取为空 / 调用提取为空 / 能力探针失效 ⇒ 拒绝假绿）
//
// ── 明示的残余盲区（诚实披露）──
//   · 只认「有脚本扩展名（.sh/.mjs/.js）的**文件名**」这一种引用形态：
//     裸命令行（`shellcheck` / `sofagent-audit` 之类不属脚本文件的工具）不在判定面内。
//   · 只认**调用关键字**（bash/sh/node/source/npx/exec）后紧跟路径的形态。把脚本写成
//     `"$BASH" tools/check/x.sh`、`env bash x.sh` 这类变体不会被计入**实现面**——
//     这会导致**假红**（清单项被判「未调用」）。遇到这种情况请把调用写成常规形态。
//   · 不按注释所在**行位置**分块：任何位置的 `#   + <脚本名>` 都算声明。
//     刻意如此——「用行号范围锁清单」（如写死 `:12-22`）本身就会变成新的脆弱点：
//     每往清单里加一条，行号就漂一次。
//   · 双向只查一个方向：**实现面有、清单里没有** 是合法的（清单是索引不是穷举），刻意不判红。
//
// 用法：
//   node tools/check/check-prepush-checklist.mjs            # 正常检查
//   node tools/check/check-prepush-checklist.mjs --selftest # 判定逻辑自测
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SELF_DIR, '..', '..');
const TARGET_REL = 'tools/release/pre-push-check.sh';

/**
 * 清单条目：`#` + 空白 + `+` + 空白 + 脚本名。
 * ⚠️ 必须收紧到这个形态：宽松的 `/[^\n]*\+/` 会把 `#   diffRange HEAD~1 + HEAD`
 *    这类普通注释也吃进来（把 `HEAD` 当脚本名）。
 */
const MANIFEST_RE = /^#\s*\+\s*(\S+)/;

/** 实现面：调用关键字后紧跟的脚本路径（见文件头「残余盲区」） */
const INVOKE_RE = /\b(?:bash|sh|node|source|npx|exec)\s+((?:\.\/)?[\w./-]+\.(?:sh|mjs|js))\b/g;

/** 只认这三种扩展名（其余 token 如 `verify.yml` 不在判定面内） */
const SCRIPT_EXT_RE = /\.(?:sh|mjs|js)$/;

/**
 * 提取清单声明的脚本名 → 首现行号（1-based）。
 * @param {string} text 脚本全文
 * @returns {Map<string, number>}
 */
export function extractManifest(text) {
  const out = new Map();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(MANIFEST_RE);
    if (!m) continue;
    const token = m[1].replace(/[，。,.;；]$/, '');
    if (!SCRIPT_EXT_RE.test(token)) continue; // 非脚本文件（如 verify.yml）不在判定面
    const name = path.basename(token);
    if (!out.has(name)) out.set(name, i + 1);
  }
  return out;
}

/**
 * 提取脚本体内**非注释行**上实际被调用的脚本名 → 首现行号（1-based）。
 * @param {string} text 脚本全文
 * @returns {Map<string, number>}
 */
export function extractInvoked(text) {
  const out = new Map();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('#')) continue; // 注释行不算「实现」
    for (const m of lines[i].matchAll(INVOKE_RE)) {
      const name = path.basename(m[1]);
      if (!out.has(name)) out.set(name, i + 1);
    }
  }
  return out;
}

/** 能力探针样本（提取器失明自检用；改坏正则 ⇒ 探针失效 ⇒ exit 2） */
const PROBE_MANIFEST = '#   + check-probe.sh  → 探针\n#   + check-probe.mjs → 探针';
const PROBE_INVOKE = '  if bash tools/check/check-probe.sh; then :; fi\n  node tools/check/check-probe.mjs';

function emitCoverage(asserts, covered, skipped) {
  console.log(`[check:coverage] script=check-prepush-checklist asserts=${asserts} covered=${covered} skipped=${skipped}`);
}

function main() {
  let asserts = 0;
  const skipped = 0;

  if (!fs.existsSync(path.join(ROOT, TARGET_REL))) {
    console.log(`❌ check-prepush-checklist 检查器失明（拒绝假绿）：目标脚本不存在 ${TARGET_REL}`);
    emitCoverage(asserts, 0, skipped);
    process.exit(2);
  }
  const text = fs.readFileSync(path.join(ROOT, TARGET_REL), 'utf-8');

  // ── 失明自检（提取为空 / 能力探针失效 ⇒ exit 2，不许静默绿）──
  const blind = [];
  if (extractManifest(PROBE_MANIFEST).size !== 2) {
    blind.push('清单提取能力探针失效：合成样本未被识别（MANIFEST_RE 已被改坏）');
  }
  if (extractInvoked(PROBE_INVOKE).size !== 2) {
    blind.push('调用面提取能力探针失效：合成样本未被识别（INVOKE_RE 已被改坏）');
  }
  const manifest = extractManifest(text);
  const invoked = extractInvoked(text);
  if (manifest.size === 0) {
    blind.push(
      `${TARGET_REL} 清单提取为空（无 \`#   + <脚本名>\` 条目）——清单消失即无法对账，拒绝把「读不到」当「零违规」`,
    );
  }
  if (invoked.size === 0) {
    blind.push(`${TARGET_REL} 调用面提取为空（无 \`bash|node … .sh/.mjs\` 形态）——实现面读不到，拒绝假绿`);
  }
  if (blind.length > 0) {
    console.log('❌ check-prepush-checklist 检查器失明（拒绝假绿）：');
    for (const r of blind) console.log(`    · ${r}`);
    emitCoverage(asserts, 0, skipped);
    process.exit(2);
  }

  // ── 主判定：清单 ⊆ 实现 ──
  asserts += 1;
  const missing = [...manifest.keys()].filter((n) => !invoked.has(n)).sort();
  if (missing.length === 0) {
    console.log(
      `  ✓ pre-push 检查项清单 ${manifest.size} 个脚本名全部在实际调用面内（清单 ⊆ 实现 · 实现面共 ${invoked.size} 个脚本）`,
    );
    console.log('    （反向不判：「实现多于清单」是合法的——清单是索引不是穷举）');
    emitCoverage(asserts, invoked.size, skipped);
    process.exit(0);
  }

  console.log('❌ pre-push 检查项清单声明了**没有接线**的脚本（「说了没做」）：');
  for (const n of missing) {
    console.log(`    · ${n}（声明于 ${TARGET_REL}:${manifest.get(n)} 的清单条目，但全脚本无该调用）`);
  }
  console.log('    处置：① 真的接线（加 `bash|node <path>` 调用 + 一处 check_pass/fail）；');
  console.log(`        ② 或删掉 ${TARGET_REL} 里那条清单声明（声明与实现必须对齐）。`);
  console.log('    ⚠️ 严禁为了变绿而把调用写成空转（如 `bash -c true`）——那正是 G-12 的形态。');
  emitCoverage(asserts, invoked.size, skipped);
  process.exit(1);
}

// ============================================================
// --selftest：双向合成探针
// ============================================================
function selftest() {
  const results = [];
  const ok = (name, cond) => results.push({ name, pass: !!cond });

  // 清单提取
  ok('P1 识别 `# + <name>` 清单形态', extractManifest('#   + a.sh → 说明\n#   + b.mjs → 说明').size === 2);
  ok('P2 并记录首现行号（1-based，供报错定位）', extractManifest('# 头\n#   + a.sh → 说明').get('a.sh') === 2);
  ok('P3 非清单注释（`# 2 + x`）不误吃成脚本名', extractManifest('# 2 + x.sh → 说明').size === 0);
  ok('P4 普通注释里的加号不误吃（diffRange HEAD~1 + HEAD）', extractManifest('#   diffRange HEAD~1 + HEAD').size === 0);
  ok('P5 非脚本扩展名（verify.yml）不入清单', extractManifest('#   + verify.yml → verify.sh').size === 0);
  ok('P6 带路径也降为 basename', extractManifest('#   + tools/check/x.sh → 说明').has('x.sh'));
  ok('P7 不按行位置分块：正文注释里的清单条目同样计入', extractManifest('set -x\n#   + z.sh → 说明').has('z.sh'));

  // 调用面提取
  const inv = extractInvoked('bash tools/check/a.sh\nnode tools/check/b.mjs\n  x=$(bash t/c.mjs 2>&1)');
  ok('P8 提取 bash/node 调用（含命令替换内）', inv.has('a.sh') && inv.has('b.mjs') && inv.has('c.mjs'));
  ok('P9 注释行上的同名不算调用', !extractInvoked('# bash tools/check/nope.sh').has('nope.sh'));
  ok('P10 裸命令行（shellcheck / sofagent-audit）不入调用面', extractInvoked('shellcheck -s bash x\nsofagent-audit --silent').size === 0);
  ok('P11 记录调用行号', extractInvoked(':\nbash tools/check/a.sh').get('a.sh') === 2);

  // 主判定的两个方向（清单在前、正文在后，与真实文件同形）
  const missing = (t) => [...extractManifest(t).keys()].filter((n) => !extractInvoked(t).has(n));
  ok('P12 清单 ⊆ 实现 ⇒ 无缺失（合法：实现可多于清单）', missing('#   + a.sh → 说明\nbash tools/check/a.sh\nbash tools/check/extra.sh').length === 0);
  ok('P13 清单有、实现无 ⇒ 报缺失（「说了没做」）', missing('#   + ghost.sh → 说明\nbash tools/check/a.sh').includes('ghost.sh'));
  ok('P14 从清单删一个**已调用**项 ⇒ 不报（子集仍成立）', missing('#   + b.mjs → 说明\nbash tools/check/a.sh\nnode tools/check/b.mjs').length === 0);
  ok('P15 往清单加一个**未调用**名 ⇒ 必报', missing('#   + a.sh → 说明\n#   + ghost.mjs → 说明\nbash tools/check/a.sh').includes('ghost.mjs'));
  ok('P16 清单为空 ⇒ 提取器返回空集（由 main 判 exit 2 失明）', extractManifest('bash a.sh').size === 0);

  // 能力探针（main 的失明自检依赖它们）
  ok('P17 清单探针样本可识别', extractManifest(PROBE_MANIFEST).size === 2);
  ok('P18 调用面探针样本可识别', extractInvoked(PROBE_INVOKE).size === 2);

  const failed = results.filter((r) => !r.pass);
  for (const r of results) console.log(`  ${r.pass ? '✓' : '✗'} ${r.name}`);
  console.log(`\n--selftest: ${results.length - failed.length} 通过 / ${failed.length} 失败（共 ${results.length} 项）`);
  emitCoverage(results.length, results.length - failed.length, failed.length);
  process.exit(failed.length === 0 ? 0 : 1);
}

if (process.argv.includes('--selftest')) selftest();
else main();
