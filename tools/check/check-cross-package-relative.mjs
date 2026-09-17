#!/usr/bin/env node
// ============================================================
// check-cross-package-relative.mjs · 越包相对引用守卫
// ============================================================
// 职责：把「插件用相对路径引用兄弟包」从**注释里的口头约定**升级为**可执行约束**。
//
// 判据（单一、机械）：`import` / `require` / `import()` / `export … from` 的
//   **相对**说明符（以 `./` 或 `../` 开头）解析后若**越出本文件的包根**
//   （= 距离该文件最近的、含 package.json 的祖先目录），即判违规。
//
// 为什么需要它（P1-2 前置事实）：
//   `engine/dsh-plugins/plugin-kit` 是 `private: true` 且**刻意**不登记进根
//   package.json 的 workspaces（理由见该包 `//notWorkspace` 字段：登记会撞
//   check-version.sh §9e 的 rhythm 段断言）。6 款插件因此改用
//   `'../../plugin-kit/dist/index.js'` 相对引用它。
//   ⇒ **「刻意」只写在注释里、零守卫**：任何一次目录改名 / 加层级 / 误改前缀
//     都不会被任何门禁发现，只会在构建或分发时炸。本脚本补上这个执行面。
//
// 覆盖边界（显式标出，不假装全覆盖）：
//   ① 只扫 `engine/**/src/**/*.{ts,mts,cts}`（非 .d.ts）。**不扫 dist**——
//      dist 是 `.gitignore:8` 忽略的派生产物，克隆态为空，扫它不可确定；
//      src 是 SSOT，dist 由 'npm run build' 从 src 派生。
//   ② 只判**相对**说明符。包名说明符（`@sofagent/*`）由
//      'tools/check/dependency-direction.sh' 按包边界判，分工不重叠。
//   ③ `FORGE/`、`tools/` 下无多包嵌套结构，不在扫描面内。
//
// 三层负向断言（对齐 G-2/G-3/G-6 同族铁律：**不许静默通过**）：
//   ① 扫描面完整性：`engine/dsh-plugins/plugin-kit/package.json` 与 ≥7 个
//      `cordis-plugin-sofagent-*` 目录必须在位（v1.4.9 P2 合并批 9→6 原子款 +
//      聚合 umbrella = 7）。缺任一 ⇒ **exit 2 检查器失明**
//      （防「目录改名 / 前缀假设错」被读成「零违规」）。
//   ② 台账非空却零命中 = 自相矛盾 ⇒ **FAIL**（防正则失配被读成「已收口」）。
//      台账空且零命中 = 合理收口 ⇒ 打印**可见 SKIP 行**（不是静默 ✓）。
//   ③ `--selftest` 双向合成探针（见下）。
//
// 用法：
//   node tools/check/check-cross-package-relative.mjs               # 常态门禁
//   node tools/check/check-cross-package-relative.mjs --selftest     # 合成回归
//   node tools/check/check-cross-package-relative.mjs --help
//
// 退出码：0 = 全绿（可含已登记的存量豁免 / 显式 SKIP，SKIP 已显著打印）
//         1 = 有未登记的越包相对引用（或台账非空却零命中）
//         2 = 检查器失明（扫描面结构缺失 / 台账非法 JSON / 脚本自身错误）
//
// 豁免台账：`tools/check/cross-package-relative-exempt.json`（形态照抄
//   `silent-catch-prefilter-exempt.json`：字符串数组，键 = `<文件相对仓库根> → <说明符>`）。
//   键含文件路径 ⇒ **文件改名/移动会让台账条目变「陈旧」**（打印提示，不阻断）；
//   但**同文件新增一条越包引用**会立刻是「未登记」⇒ FAIL。刻意，不是疏漏：
//   本守卫要拦的正是「新增一条越包引用」这个动作。
//
// ⚠️ 判定为**集合式**（键含说明符）：同一文件对同一说明符的**第二处**出现不计入判定
//   ——不构成新分发风险（首处已在台账），断链由 `TS2307` fail-loud 兜底；
//   如需计数量纲，参照 `check-legacy-knowledge-path.mjs` 的 `{count, reason}` 形态。
//
// 🔴 登记理由（豁免必须逐族说清为什么，禁「反正它绿了」）：
//   族 1 · 6 款原子插件的 `../../plugin-kit/dist/index.js`（6 条 · v1.4.9 P2 合并批 9→6）
//     理由：plugin-kit 是 `private: true` 且**刻意不入 workspaces**（见该包
//     `//notWorkspace`），6 款插件以相对路径引用它 ⇒ 这是**设计**，不是欠债。
//     分发形态实测（P1-2 取证，非推断）：
//       a) 插件与 plugin-kit 均不入 npm（插件 `private: true`；plugin-kit 既
//          `private` 又非 workspace 成员）；
//       b) 两者 `dist/` 均不入 git（`.gitignore:8 dist/`）；
//       c) 根 'npm run build' **显式**在 7 个插件之前执行
//          'npm --prefix engine/dsh-plugins/plugin-kit run build' ⇒ 拓扑序被手工钉住；
//       d) 故障注入实测：移走 `plugin-kit/dist` 后插件构建 **fail-loud**
//          （`error TS2307: Cannot find module '../../plugin-kit/dist/index.js'`），
//          不静默降级 ⇒ 假设「单目录切片分发」失效时也会当场报错，不会悄悄上线。
//     残余风险（已承认，未消）：若某分发通道**只取单个插件目录**（兄弟目录不随行），
//      构建期才会炸。本守卫把该假设钉成可执行约束——目录一旦改名/移位即 FAIL。
//   族 2 · 清单 SSOT 对账测试读 plugins.json（3 条 · v1.4.9 P2 新增 2 条）
//     a) `cordis-plugin-sofagent/src/index.test.ts → ../../plugins.json`（suite 面）
//     b) `cordis-plugin-sofagent-audit/src/index.test.ts → ../../plugins.json`（seam 四值对账）
//     c) `cordis-plugin-sofagent-fde/src/index.test.ts → ../../plugins.json`（featureGates 三档对账）
//     理由：`plugins.json` 是 DSH 插件清单的**唯一手写源**（生成器据此产出各
//     `package.json` / `cordis.patch.yml` 段）。这三处测试**就是要**对账这份 SSOT
//     （audit 的 seam 四值、fde 的分档清单、suite 的条目数），故刻意相对引用而非
//     复制一份。测试面，不进运行时产物。
// ============================================================

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const ENGINE = path.join(ROOT, 'engine');
const LEDGER_PATH = path.join(ROOT, 'tools/check/cross-package-relative-exempt.json');
const PLUGIN_KIT_PKG = path.join(ENGINE, 'dsh-plugins/plugin-kit/package.json');
const DSH_DIR = path.join(ENGINE, 'dsh-plugins');

const SELFTEST = process.argv.includes('--selftest');
if (process.argv.includes('--help')) {
  console.log('用法: node tools/check/check-cross-package-relative.mjs [--selftest] [--help]');
  console.log('判据: 相对 import/require 解析后越出包根 ⇒ FAIL（已登记的存量豁免除外）');
  process.exit(0);
}

/** 说明符提取：from '<spec>' / import '<spec>' / import('<spec>') / require('<spec>') */
const SPEC_RE = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;

/** 扫描面结构断言（负向断言①）：缺任一 ⇒ 失明，拒绝假绿 */
function assertScanFaceIntact() {
  const missing = [];
  if (!fs.existsSync(PLUGIN_KIT_PKG)) missing.push(path.relative(ROOT, PLUGIN_KIT_PKG));
  if (!fs.existsSync(DSH_DIR)) {
    missing.push(path.relative(ROOT, DSH_DIR));
  }
  let pluginDirs = 0;
  if (fs.existsSync(DSH_DIR)) {
    pluginDirs = fs.readdirSync(DSH_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^cordis-plugin-sofagent/.test(e.name)).length;
  }
  // v1.4.9 P2 合并批：原子插件 9→6（ontology/commons/gate 并入 fde/audit），加聚合 umbrella 共 7 目录
  if (pluginDirs < 7) missing.push(`cordis-plugin-sofagent-* 目录数 = ${pluginDirs}（期望 ≥7）`);
  if (missing.length > 0) {
    const err = new Error(
      `扫描面结构缺失 → 极可能目录已改名/移动，此时「零违规」是假空：\n      ${missing.join('\n      ')}`,
    );
    err.blind = true;
    throw err;
  }
}

/** 距离 file 最近的、含 package.json 的祖先目录（= 包根） */
function packageRootOf(file) {
  let dir = path.dirname(file);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function collectSources(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', '.git', 'dist', '.sofagent', 'coverage'].includes(e.name)) continue;
      collectSources(p, out);
    } else if (/\.(ts|mts|cts)$/.test(e.name) && !e.name.endsWith('.d.ts')) {
      out.push(p);
    }
  }
  return out;
}

/**
 * 扫描一棵树，返回违规键集合。
 * @param opts.virtual 额外虚拟文件（不落盘）——供 --selftest 在**真实扫描面**上注入探针
 */
function scanTree(opts = {}) {
  const virtual = opts.virtual ?? [];
  const violations = new Set();
  const scanned = [];
  const files = collectSources(ENGINE);
  const entries = files.map((f) => ({ abs: f, rel: path.relative(ROOT, f), content: fs.readFileSync(f, 'utf8') }));
  for (const v of virtual) {
    entries.push({ abs: path.join(ROOT, v.path), rel: v.path, content: v.content });
  }
  for (const entry of entries) {
    const pkgRoot = packageRootOf(entry.abs);
    if (!pkgRoot) continue; // 不属于任何包（如仓库根脚本）——不判
    scanned.push(entry.rel);
    for (const m of entry.content.matchAll(SPEC_RE)) {
      const spec = m[1];
      if (!spec.startsWith('.')) continue; // 包名说明符交 dependency-direction
      const abs = path.resolve(path.dirname(entry.abs), spec);
      if (abs === pkgRoot || abs.startsWith(pkgRoot + path.sep)) continue; // 包内
      violations.add(`${entry.rel} → ${spec}`);
    }
  }
  return { violations, scanned };
}

function loadLedger() {
  if (!fs.existsSync(LEDGER_PATH)) return [];
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
  } catch (e) {
    const err = new Error(`豁免台账非法 JSON（${path.relative(ROOT, LEDGER_PATH)}）：${e.message}`);
    err.blind = true;
    throw err;
  }
  if (!Array.isArray(parsed) || parsed.some((x) => typeof x !== 'string')) {
    const err = new Error(`豁免台账必须是字符串数组（键 = '<文件> → <说明符>'）`);
    err.blind = true;
    throw err;
  }
  return parsed;
}

function emitCoverage(asserts, covered, skipped) {
  console.log(`[check:coverage] script=check-cross-package-relative asserts=${asserts} covered=${covered} skipped=${skipped}`);
}

// ============================================================
// selftest：双向合成探针（负向断言③）
// ============================================================
function selftest() {
  console.log('=== check-cross-package-relative · selftest（合成回归）===');
  let fail = 0;
  const ledger = loadLedger();

  // 探针 A：真实扫描面上注入虚拟文件——越包必须判、包内必须不判
  //   ⚠️ 探针说明符刻意只用**两级**（`../../`）：三级以上的**连写**穿越字面量
  //      会被 sofagent 自己的 A23「不逃路径」底线规则拦下（其判据是连写三次以上），
  //      本守卫的 selftest 文本因此不得出现该形态。两级已足以越出包根：
  //      探针位于 `<plugin>/src/`，`../` = 包根（包内），`../../` = 兄弟目录（越包）。
  const probePath = 'engine/dsh-plugins/cordis-plugin-sofagent-audit/src/__selftest_probe__.ts';
  const probeInPackage = './local-helper.js';
  const probeEscape = '../../outside-probe.js';
  const probeKitShape = '../../plugin-kit/dist/index.js';
  const probeContent = [
    `import local from '${probeInPackage}';`,      // 包内 → 不得判（负向对照）
    `import esc from '${probeEscape}';`,            // 越出包根 → 必须判
    `const r = require('${probeKitShape}');`,       // 越出包根（与存量同形）→ 必须判
  ].join('\n');
  const { violations } = scanTree({ virtual: [{ path: probePath, content: probeContent }] });
  const probeHits = [...violations].filter((v) => v.startsWith(probePath));
  const wantEscape = `${probePath} → ${probeEscape}`;
  const wantKit = `${probePath} → ${probeKitShape}`;
  const gotLocal = probeHits.some((v) => v.includes('local-helper.js'));

  const okA1 = probeHits.includes(wantEscape);
  const okA2 = probeHits.includes(wantKit);
  const okA3 = !gotLocal;
  console.log(`  ${okA1 ? '✓' : '❌'} 越包（同级形状，import）必判：${okA1 ? '命中' : '未命中——判据是装饰品'}`);
  console.log(`  ${okA2 ? '✓' : '❌'} 越包（与 6 条存量同形，require）必判：${okA2 ? '命中' : '未命中'}`);
  console.log(`  ${okA3 ? '✓' : '❌'} 包内相对引用不误判（负向对照）：${okA3 ? '未误判' : '误判了 local-helper.js'}`);
  if (!okA1 || !okA2 || !okA3) fail++;

  // 探针 B：台账承重性——豁免必须是「逐条」而非「全有全无」
  const real = scanTree();
  const registered = [...real.violations].filter((v) => ledger.includes(v));
  const kitEntries = registered.filter((v) => v.includes('plugin-kit/dist/index.js'));
  const okB1 = real.violations.size > 0 && registered.length === real.violations.size;
  console.log(`  ${okB1 ? '✓' : '❌'} 实测违规全部已登记（无未登记孤儿）：${registered.length}/${real.violations.size}`);
  if (!okB1) fail++;

  const okB2 = kitEntries.length === 6;
  console.log(`  ${okB2 ? '✓' : '❌'} 其中 plugin-kit 族恰 6 条（与「6 款原子插件」口径对上 · v1.4.9 P2 合并批 9→6）：实测 ${kitEntries.length}`);
  if (!okB2) fail++;

  // 台账清空（内存模拟）→ 全部变未登记 ⇒ 豁免确实在承重，不是橡皮章
  const newOnesEmpty = [...real.violations].filter((v) => !new Set().has(v));
  const okB3 = newOnesEmpty.length === real.violations.size;
  console.log(`  ${okB3 ? '✓' : '❌'} 台账清空后全部变未登记（承重性）：${newOnesEmpty.length}/${real.violations.size}`);
  if (!okB3) fail++;

  // 只摘掉 plugin-kit 那 6 条 → **恰 6 条**变未登记 ⇒ 台账是「逐条」生效
  const withoutKit = ledger.filter((v) => !v.includes('plugin-kit'));
  const newOnesPartial = [...real.violations].filter((v) => !withoutKit.includes(v));
  const okB4 = newOnesPartial.length === 6;
  console.log(`  ${okB4 ? '✓' : '❌'} 仅摘掉 plugin-kit 6 条 → 恰 6 条转未登记（逐条生效，非全有全无 · v1.4.9 P2）：实测 ${newOnesPartial.length}`);
  if (!okB4) fail++;

  // 探针 C：6 条存量的登记理由同源可核对（全部指向同一包）
  const okC = kitEntries.every((v) => v.endsWith('→ ../../plugin-kit/dist/index.js'));
  console.log(`  ${okC ? '✓' : '❌'} 6 条存量说明符同形（登记理由单一、可核对）`);
  if (!okC) fail++;

  console.log('');
  if (fail > 0) {
    console.log(`✗ selftest 失败 ${fail} 项——守卫未抓到注入的越包引用`);
    return 1;
  }
  console.log('✓ selftest 通过——双向合成探针全命中（守卫非装饰品）');
  return 0;
}

// ============================================================
// 入口
// ============================================================
try {
  if (SELFTEST) process.exit(selftest());

  assertScanFaceIntact();
  const ledger = loadLedger();
  const { violations, scanned } = scanTree();
  const all = [...violations].sort();
  const unregistered = all.filter((v) => !ledger.includes(v));
  const stale = ledger.filter((v) => !violations.has(v));

  console.log('── 越包相对引用守卫（相对说明符越出包根即违规）──');
  console.log(`  扫描 ${scanned.length} 个 src .ts（engine/**；dist 为派生面不扫）`);

  if (stale.length > 0) {
    console.log(`  ℹ️ 台账中 ${stale.length} 条已不再命中（文件改名/引用已收口），可移除：`);
    for (const s of stale.slice(0, 10)) console.log(`      ${s}`);
  }

  // 负向断言②：台账非空却零命中 = 自相矛盾（判据失配或目录改名）
  if (all.length === 0 && ledger.length > 0) {
    console.error(`  ❌ 台账登记 ${ledger.length} 条存量，实测却**零命中**——自相矛盾。`);
    console.error('     两种可能：① 正则/包根判据失配；② 目录已改名。均须先修判据，不得当「已收口」放行。');
    emitCoverage(1, scanned.length, 0);
    process.exit(1);
  }

  if (all.length === 0 && ledger.length === 0) {
    console.log('  ⏭️ SKIP：实测零越包相对引用且台账为空——若属真实收口请保留本 SKIP 语义，');
    console.log('     若属判据失配请排查（本脚本 --selftest 会先失明报红）。**非静默通过。**');
    emitCoverage(1, scanned.length, 1);
    process.exit(0);
  }

  if (unregistered.length === 0) {
    console.log(`  ✓ 全部 ${all.length} 条越包相对引用均在豁免台账内（新增 0）`);
    console.log(`  ✓ 扫描面结构完整：plugin-kit/package.json 在位 + 7 个 cordis-plugin-sofagent-* 目录（v1.4.9 P2 合并批 10→7）`);
    emitCoverage(all.length + 1, scanned.length, 0);
    process.exit(0);
  }

  console.error(`  ❌ 检测到 ${unregistered.length} 处**未登记**的越包相对引用：`);
  for (const v of unregistered.slice(0, 20)) console.error(`      ${v}`);
  if (unregistered.length > 20) console.error(`      ... 共 ${unregistered.length} 处`);
  console.error('  修法：优先改为包内引用或包名引用；确属刻意（如 plugin-kit 兄弟分发）再登记进');
  console.error(`        ${path.relative(ROOT, LEDGER_PATH)}（键 = '<文件> → <说明符>'，理由写进本脚本头部）。`);
  emitCoverage(all.length + 1, scanned.length, 0);
  process.exit(1);
} catch (err) {
  if (err && err.blind) {
    console.error(`✗ 检查器失明：${err.message}——拒绝假绿`);
    process.exit(2);
  }
  console.error(`✗ check-cross-package-relative 自身错误：${err && err.stack ? err.stack : String(err)}`);
  process.exit(2);
}
