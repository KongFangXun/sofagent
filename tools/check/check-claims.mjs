#!/usr/bin/env node
// ============================================================
// check-claims.mjs · 三组「声称 ↔ 实测」断言（v1.5.4 #36 + #28 守门）
// ============================================================
// 动机（四轮审查元发现）：审查产出的最大去向是门禁——「门禁覆盖半径 < 声称半径」
//   是本轮主要矛盾。本脚本把三处**正则可判定**的声称收口成断言：
//
//   A. **整文件零生产消费者**（#36A，信息位不阻断）
//      check-unwired-exports.sh 的现有视锥 = @public 导出 + 桶文件；源文件级
//      「整文件无人消费（测试是唯一观众）」在视锥之外。本组扫描 engine/*/src 下
//      非 test / 非 index 的源文件，分两档报（均**不阻断**，供维护者裁定）：
//        ① **零生产消费**：全部导出符号在「生产面」零消费；
//        ② **仅验证面引用**：只被 playbook/（acceptance-test.sh · regression-checklist.md
//           等行为锁）引用——验证面**不是**生产消费（#29 口径裁定，2026-09-27）：
//           行为锁等价于测试，「只被行为锁引用」恰是「测试是唯一观众」的同一类断链，
//           若把 playbook 计入消费面，这一整类候选永久隐形。
//      生产面口径 = `engine`（生产代码）+ `tools`（工具面：真实执行脚本）；
//      排除面 = 自身 / __tests__ / *.test.ts / dist / *.map。⚠️ 桶文件 re-export 在本次
//      扫描中**算消费**——「被导出但无人使用」不属于本组视锥，由 check-unwired-exports.sh
//      的 ◇ SDK 面候选覆盖（两者互补，不重复）。
//
//   B. **SECURITY 测绘数字断言**（#36C，阻断）
//      SECURITY.md 的「N 图标 / N 处 uses:」是测绘型计数（无 SSOT 反查）——
//      实测「有门禁的数字全绿、没门禁的测绘数全漂」。本组把两者钉到实测值：
//        · 图标数 ↔ dashboard.html 的 `.bi-*::before` 去重计数
//        · uses: 数 ↔ .github/workflows/*.yml + 根 action.yml 的 uses 引用数
//          （口径 = 正则 `^\s*(?:-\s+)?uses:\s*(\S+)`，**排除注释行**——直接 grep
//           会把 pr-check.yml 里含该词的注释多算 1 处）
//      提取为空 ⇒ 判红（防守卫空转）。
//
//   C. **hook 信任根断言**（#28 守门，阻断）
//      hook 内**不得**把变量指到被审仓 `tools/` 下（原病：`FP_SCRIPT="tools/…"` /
//      `"$REPO_ROOT/tools/…"` ⇒ 被审仓投放同名脚本即任意代码执行）。可信源只有两类：
//      ① `$SOFAGENT_HOME/internal/` 落地副本 ② 本仓 `engine/audit/hooks/`（自审/注入）。
//      ⚠️ 断言形态取「**变量赋值指向 tools/**」，不取 'node.*tools/' ——后者修前即
//      零命中（真实形态是变量间接），立成假绿（原卡已修正）。
//
// 退出码：0 = 通过（A 组候选仅提示）；1 = B/C 组命中
// ============================================================

import { execFileSync } from 'child_process';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const sh = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], cwd: root });
  } catch {
    return '';
  }
};
const tracked = sh('git', ['ls-files']).split('\n').filter(Boolean);

let fails = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => {
  console.log(`  ❌ ${m}`);
  fails++;
};

// ── A. 整文件零生产消费者（信息位）──────────────────────────────
const srcFiles = tracked.filter(
  (f) => /^engine\/[^/]+\/src\/.*\.ts$/.test(f) && !f.endsWith('.d.ts') && !/\.test\.ts$/.test(f) && !f.includes('__tests__') && !/\/index\.ts$/.test(f),
);
const binBases = new Set();
for (const pj of tracked.filter((f) => /^engine\/[^/]+\/package\.json$/.test(f))) {
  try {
    const p = JSON.parse(readFileSync(join(root, pj), "utf8"));
    for (const v of Object.values(p.bin ?? {})) binBases.add(String(v).replace(/^dist\//, "").replace(/\.js$/, ".ts"));
  } catch { /* 为何可静默：坏 package.json 只影响 A 组（信息位）的 bin 排除精度，不影响 B/C 阻断面 */ }
}
// 包 tsconfig 显式 exclude 的文件 = 该包已声明「非发布物」（例：engine/audit/src/test-utils.ts
// 被 tsconfig exclude —— 刻意置于 src 供测试相对导入、不进 dist）⇒ 不计入候选。
// 口径裁定 2026-09-27：此类文件是「已声明非生产」而非「断链」，避免把声明的测试辅助当尸骸。
const excludedByPkg = new Map(); // pkgDir → 相对路径集合
for (const tj of tracked.filter((f) => /^engine\/[^/]+\/tsconfig\.json$/.test(f))) {
  const pkgDir = tj.replace(/\/tsconfig\.json$/, "");
  try {
    const raw = readFileSync(join(root, tj), "utf8").replace(/^\s*\/\/.*$/gm, "");
    const cfg = JSON.parse(raw);
    const set = new Set();
    for (const e of cfg.exclude ?? []) if (/\.ts$/.test(String(e))) set.add(String(e));
    excludedByPkg.set(pkgDir, set);
  } catch { /* 为何可静默：tsconfig 解析失败只少一层「已声明非发布物」排除（多报候选），不影响 B/C 阻断面 */ }
}
const isPkgExcluded = (f) => {
  for (const [pkgDir, set] of excludedByPkg) {
    if (!f.startsWith(pkgDir + "/")) continue;
    const rel = f.slice(pkgDir.length + 1);
    for (const pat of set) {
      const re = new RegExp("^" + pat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "§§").replace(/\*/g, "[^/]*").replace(/§§/g, ".*") + "$");
      if (re.test(rel)) return true;
    }
  }
  return false;
};
const zeroConsumerFiles = [];
const playbookOnlyFiles = [];
const newZeroConsumerFiles = []; // 🔴 新增件零消费（阻断面 · v1.5.4 复核裁定）
const refFilter = (f) => (h) =>
  h !== f && !h.includes('__tests__') && !h.endsWith('.test.ts') && !h.includes('/dist/') && !h.includes('.map');
for (const f of srcFiles) {
  const src = readFileSync(join(root, f), 'utf8');
  const names = [...src.matchAll(/^export\s+(?:async\s+)?(?:const|function|class|interface|type|enum)\s+([A-Za-z0-9_]+)/gm)].map((m) => m[1]);
  if (names.length === 0) continue;
  const base = f.split("/").pop();
  if (binBases.has(base)) continue; // bin 入口：由 CLI 直接执行，非「被 import 消费」
  if (isPkgExcluded(f)) continue; // 包 tsconfig 显式 exclude = 已声明非发布物（如测试辅助）
  const hitIn = (scope) =>
    names.some((n) =>
      sh('git', ['grep', '-l', '-w', n, '--', ...scope])
        .split('\n')
        .filter(Boolean)
        .some(refFilter(f)),
    );
  const label = `${f}（导出 ${names.length} 个符号）`;
  if (hitIn(['engine', 'tools'])) continue; // 生产面有消费 ⇒ 非本组候选
  // 🔴 A 组升级（v1.5.4 复核裁定 · 治第四条盲区）：**新增件零消费 ⇒ 阻断**——
  // 本版 ch5 六模块曾以「孤儿 + 门禁不扫」溜过（纸面接线第 4 次复发的逃逸路径）。
  // 判据：文件在上一 tag（取 git describe --abbrev=0）之后有改动 ⇒ 视为新增件；
  // 存量孤儿仍走信息位（历史裁定通道不变）。豁免：登记 SDK 面（tools/check/claims-sdk-ledger.json）。
  // 新增判据（双通道，探针实测补全）：
  //   ① 已提交面：文件在上一 tag 之后有任何提交（含未提交到 tag 间的历史）
  //   ② 工作树面：intent-to-add / 本轮暂存的新文件（git log 对未提交内容返回空 ⇒ 单靠①漏判）
  const lastTag = sh('git', ['describe', '--abbrev=0']).trim();
  const committedNew = lastTag
    ? sh('git', ['log', '--oneline', `${lastTag}..HEAD`, '--', f]).trim().length > 0
    : false;
  const stagedNew = sh('git', ['status', '--porcelain', '--', f]).trim().startsWith('A ');
  const isNew = committedNew || stagedNew;
  if (hitIn(['playbook'])) playbookOnlyFiles.push(label); // 仅验证面引用（行为锁/回归清单）
  else zeroConsumerFiles.push(label);
  if (isNew) {
    const ledgerPath = join(root, 'tools/check/claims-sdk-ledger.json');
    let ledger = {};
    try { ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')).exempt ?? {}; } catch { /* 台账缺失=无豁免 */ }
    if (!ledger[f]) newZeroConsumerFiles.push(label);
  }
}
console.log(`=== A. 整文件零生产消费者（信息位 · 不阻断）===`);
// 🔴 新增件零消费 = 阻断（豁免须登记 SDK 面台账并逐条带理由）
if (newZeroConsumerFiles.length > 0) {
  bad(`🔴 新增件零生产消费 ${newZeroConsumerFiles.length} 个（阻断——接线 / 登记 SDK 面台账 / 退役，三选一后复跑）：`);
  for (const z of newZeroConsumerFiles) console.log(`      ${z}`);
  console.log('      豁免通道：tools/check/claims-sdk-ledger.json 的 exempt 表（逐条带理由，变更进 review）');
} else if (zeroConsumerFiles.length === 0 && playbookOnlyFiles.length === 0) ok('零命中');
if (zeroConsumerFiles.length > 0 || playbookOnlyFiles.length > 0) {
  console.log(`  ◇ 零生产消费候选 ${zeroConsumerFiles.length} 个（**不阻断**——接线 / 登记 SDK 面 / 退役由维护者裁定）：`);
  for (const z of zeroConsumerFiles.slice(0, 20)) console.log(`      ${z}`);
  console.log(`  ◇ 仅验证面引用候选 ${playbookOnlyFiles.length} 个（只被 playbook 行为锁/回归清单引用——验证面≠生产消费，同列候选）：`);
  for (const z of playbookOnlyFiles.slice(0, 20)) console.log(`      ${z}`);
  if (zeroConsumerFiles.length + playbookOnlyFiles.length > 40) console.log('      …');
}

// ── B. SECURITY 测绘数字（阻断）────────────────────────────────
console.log(`\n=== B. SECURITY 测绘数字 ↔ 实测 ===`);
const sec = existsSync(join(root, 'SECURITY.md')) ? readFileSync(join(root, 'SECURITY.md'), 'utf8') : '';
const dashPath = join(root, 'tools/dashboard/dashboard.html');
const dash = existsSync(dashPath) ? readFileSync(dashPath, 'utf8') : '';
const iconReal = new Set([...dash.matchAll(/\.(bi-[a-z0-9-]+)::before/g)].map((m) => m[1])).size;
const mIcon = sec.match(/([0-9]+)\s*图标 SVG 内嵌/);
if (!mIcon) bad('SECURITY 未找到「N 图标 SVG 内嵌」声称（提取为空——拒绝空转）');
else if (Number(mIcon[1]) !== iconReal) bad(`图标数声称 ${mIcon[1]} ≠ 实测 ${iconReal}（dashboard.html ::before 去重）`);
else ok(`图标数 ${mIcon[1]} == 实测 ${iconReal}`);

const wfDir = join(root, '.github/workflows');
const wfFiles = existsSync(wfDir) ? readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f)).map((f) => join(wfDir, f)) : [];
if (existsSync(join(root, 'action.yml'))) wfFiles.push(join(root, 'action.yml'));
let usesReal = 0;
let usesWf = 0;
for (const f of wfFiles) {
  const isAction = f.endsWith("action.yml");
  for (const l of readFileSync(f, 'utf8').split('\n')) {
    if (/^\s*(?:-\s+)?uses:\s*(\S+)(?:\s+#\s*(\S+))?/.test(l)) { usesReal++; if (!isAction) usesWf++; }
  }
}
const mUses = sec.match(/([0-9]+)\s*处\s*`?uses:/);
const wfReal = wfFiles.length - (existsSync(join(root, 'action.yml')) ? 1 : 0);
if (!mUses) bad('SECURITY 未找到「N 处 uses:」声称（提取为空——拒绝空转）');
else if (Number(mUses[1]) !== usesWf) {
  bad(`uses 声称 ${mUses[1]} ≠ 实测 workflow 面 ${usesWf}（口径：正则 ^\\s*(?:-\\s+)?uses: 排除注释行；工作流 ${wfReal} 个 + 根 action.yml ${usesReal - usesWf} 处）`);
} else ok(`uses 数 ${mUses[1]} == workflow 面实测 ${usesWf}（另根 action.yml ${usesReal - usesWf} 处；口径：正则排除注释行）`);

// ── C. hook 信任根（阻断）──────────────────────────────────────
console.log(`\n=== C. hook 信任根（不得指向被审仓 tools/）===`);
const hookFiles = tracked.filter((f) => /^engine\/audit\/hooks\//.test(f) || /^tools\/hooks\/.*\.sh$/.test(f));
let trustViolations = 0;
for (const f of hookFiles) {
  const lines = readFileSync(join(root, f), 'utf8').split('\n');
  lines.forEach((l, i) => {
    // 只看赋值形态；注释行跳过（`# …`）
    if (/^\s*#/.test(l)) return;
    const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=[^#]*tools\//);
    if (!m) return;
    // 白名单：落地副本（$SOFAGENT_HOME/internal）与显式「本仓 engine/audit/hooks」引用
    if (/_FP_LANDED|SOFAGENT_HOME/.test(l)) return;
    console.log(`      ${f}:${i + 1} ${l.trim().slice(0, 100)}`);
    trustViolations++;
  });
}
if (trustViolations === 0) ok(`零命中（扫描 ${hookFiles.length} 个 hook 文件；断言形态 = 变量赋值指向 tools/）`);
else bad(`hook 内 ${trustViolations} 处变量指向被审仓 tools/ —— 被审仓可投毒该路径实现任意代码执行`);

console.log('');
if (fails > 0) {
  console.log(`✗ check-claims：${fails} 组断言未通过`);
  process.exit(1);
}
console.log(`✓ check-claims：B/C 两组断言通过（A 组存量件为信息位 · 新增件零消费已阻断）`);
process.exit(0);
