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
//      非 test / 非 index 的源文件，若其**全部**导出符号在全仓（排除自身/测试/dist）
//      零消费 ⇒ 列 ◇ 候选供维护者裁定。**不阻断**（存量已知，#29 六文件待裁定）。
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
const zeroConsumerFiles = [];
for (const f of srcFiles) {
  const src = readFileSync(join(root, f), 'utf8');
  const names = [...src.matchAll(/^export\s+(?:async\s+)?(?:const|function|class|interface|type|enum)\s+([A-Za-z0-9_]+)/gm)].map((m) => m[1]);
  if (names.length === 0) continue;
  const base = f.split("/").pop();
  if (binBases.has(base)) continue; // bin 入口：由 CLI 直接执行，非「被 import 消费」
  const consumed = names.some((n) => {
    const hits = sh('git', ['grep', '-l', '-w', n, '--', 'engine', 'tools', 'playbook']).split('\n').filter(Boolean);
    return hits.some(
      (h) => h !== f && !h.includes('__tests__') && !h.endsWith('.test.ts') && !h.includes('/dist/') && !h.includes('.map'),
    );
  });
  if (!consumed) zeroConsumerFiles.push(`${f}（导出 ${names.length} 个符号，全仓零生产消费）`);
}
console.log(`=== A. 整文件零生产消费者（信息位 · 不阻断）===`);
if (zeroConsumerFiles.length === 0) ok('零命中');
else {
  console.log(`  ◇ 候选 ${zeroConsumerFiles.length} 个（**不阻断**——接线 / 登记 SDK 面 / 退役由维护者裁定）：`);
  for (const z of zeroConsumerFiles.slice(0, 20)) console.log(`      ${z}`);
  if (zeroConsumerFiles.length > 20) console.log(`      …另有 ${zeroConsumerFiles.length - 20} 个`);
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
console.log(`✓ check-claims：B/C 两组断言通过（A 组为信息位）`);
process.exit(0);
