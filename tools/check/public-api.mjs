#!/usr/bin/env node
// ============================================================
// public-api.mjs · public API 变更检测门禁（v1.3.9 四）
// ============================================================
// 原理：每个 engine 包入口的 `/* @public */` 导出符号集 = 公开 API 面
// （semver 锁定）。与基线（tools/check/public-api-baseline.json）比对：
//   - 符号集变化 + 包版本未 bump → FAIL（阻断提交）
//   - 符号集变化 + 版本已 bump → PASS（提示发版时更新基线）
//   - 符号集无变化 → PASS
//
// 语义解析复用官方 AST 规则引擎（v1.3.9 一 同版交付降本验证）：
//   extractExports() 走 TS 编译器语法树提取 export 符号；
//   AST 不可用时回退正则（CI 无 typescript 环境的兜底）。
//
// 用法：node tools/check/public-api.mjs [--update-baseline]
//   --update-baseline：以当前符号集 + 当前包版本重建基线（发版时用）
// ============================================================
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASELINE = join(ROOT, 'tools', 'check', 'public-api-baseline.json');
const UPDATE = process.argv.includes('--update-baseline');

// 包清单：[目录, 入口源文件]
const PACKAGES = [
  ['@sofagent/harness', 'engine/harness/src/index.ts'],
  ['@sofagent/ontology', 'engine/ontology/src/index.ts'],
  ['@sofagent/core', 'engine/core/src/index.ts'],
  ['@sofagent/rules', 'engine/rules/src/index.ts'],
  ['@sofagent/think', 'engine/think/src/index.ts'],
  ['@sofagent/audit', 'engine/audit/src/public-api.ts'],
  ['@sofagent/eval', 'engine/eval/src/index.ts'],
  ['@sofagent/skillopt', 'engine/skillopt/src/index.ts'],
  ['@sofagent/orchestrator', 'engine/orchestrator/src/index.ts'],
  ['@sofagent/daemon', 'engine/daemon/src/index.ts'],
  ['@sofagent/ab-test', 'engine/ab-test/src/index.ts'],
  ['@sofagent/load-chain', 'engine/hooks/sofagent-load-chain/src/handler.ts'],
  // @sofagent/mcp 是 bin 入口（无 JS 导出面）——API 面=MCP 协议，
  // 协议变更由 check-version 的工具数校验与 CHANGELOG 把关，不入本基线
];

// ── AST 语义解析（复用官方 AST 规则引擎；不可用回退正则）──

let astEngine = null;
function getAstEngine() {
  if (astEngine !== null) return astEngine;
  try {
    // 优先 dist（CI 环境）；失败则回退正则模式
    const { AstRuleEngine } = require(join(ROOT, 'engine/rules/dist/ast/engine.js'));
    const e = new AstRuleEngine();
    // 冒烟：解析不出符号说明 TS server 不可用
    const smoke = e.extractExports('smoke.ts', 'export const x = 1;');
    if (smoke.length === 0) { e.close(); astEngine = false; return false; }
    astEngine = e;
    return e;
  } catch {
    astEngine = false;
    return false;
  }
}

/** 正则兜底：提取入口文件里的导出符号（粗粒度——export {} 块内的名字） */
function extractExportsRegex(src) {
  const names = new Set();
  // export { a, b } from './x' / export type { a } from
  for (const m of src.matchAll(/export\s+(?:type\s+)?\{([^}]+)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  }
  // export const/function/class X / export default
  for (const m of src.matchAll(/^export\s+(?:const|function|class|abstract\s+class|enum|interface|type)\s+([A-Za-z_$][\w$]*)/gm)) {
    names.add(m[1]);
  }
  if (/^export\s+default\s+/m.test(src)) names.add('default');
  return [...names].sort();
}

/**
 * 提取一个包的 @public 符号集。
 * tier 判定：导出语句行带 `/* @public *\/` → public；带 @internal → 排除；
 * 未标记语句视为 public（保守默认）。
 */
function extractPublicSymbols(entryPath) {
  const src = readFileSync(entryPath, 'utf-8');
  const lines = src.split('\n');

  // 行号 → tier 映射（标记在 export 语句同一行行首）
  const tierByLine = new Map();
  lines.forEach((line, i) => {
    if (/\/\*\s*@internal\s*\*\//.test(line)) tierByLine.set(i + 1, 'internal');
    else if (/\/\*\s*@public\s*\*\//.test(line)) tierByLine.set(i + 1, 'public');
  });

  const engine = getAstEngine();
  let exports;
  let basis;
  if (engine) {
    exports = engine.extractExports(entryPath.split('/').pop(), src);
    basis = 'ast';
  } else {
    exports = extractExportsRegex(src).map((name) => ({ name, line: 0 }));
    basis = 'regex';
  }

  const publicNames = new Set();
  for (const { name, line } of exports) {
    if (name === '*') continue; // export * 不构成可数符号
    const tier = tierByLine.get(line);
    if (tier === 'internal') continue;
    publicNames.add(name); // public 或未标记（保守默认 public）
  }
  return { symbols: [...publicNames].sort(), basis, total: exports.length };
}

/** 读包版本（入口在 <pkg>/src/ 下——包根 = 入口目录的父级） */
function readVersion(pkgDir) {
  const pkgJsonPath = /\/src$/.test(pkgDir)
    ? join(pkgDir, '..', 'package.json')
    : join(pkgDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
  return pkg.version;
}

// ── 主流程 ──

function semverGt(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return false;
}

const baseline = existsSync(BASELINE)
  ? JSON.parse(readFileSync(BASELINE, 'utf-8'))
  : { generatedAt: '', packages: {} };

let failures = 0;
const nextBaseline = { generatedAt: new Date().toISOString(), packages: {} };

for (const [pkgName, entry] of PACKAGES) {
  const entryPath = join(ROOT, entry);
  if (!existsSync(entryPath)) { console.log(`⚠ 跳过（入口不存在）：${pkgName}`); continue; }
  const pkgDir = dirname(entry);
  const version = readVersion(pkgDir);
  const { symbols, basis } = extractPublicSymbols(entryPath);
  nextBaseline.packages[pkgName] = { version, symbols };

  const prev = baseline.packages[pkgName];
  if (!UPDATE && prev) {
    const added = symbols.filter((s) => !prev.symbols.includes(s));
    const removed = prev.symbols.filter((s) => !symbols.includes(s));
    if (added.length > 0 || removed.length > 0) {
      const bumped = semverGt(version, prev.version);
      const what = [
        added.length ? `新增 ${added.join(', ')}` : '',
        removed.length ? `移除 ${removed.join(', ')}` : '',
      ].filter(Boolean).join('；');
      if (bumped) {
        console.log(`✅ ${pkgName}：public API 变更（${what}），版本已 bump ${prev.version} → ${version}`);
      } else {
        console.log(`❌ ${pkgName}：public API 变更（${what}）但版本未 bump（仍为 ${version}）`);
        console.log(`   处置：bump ${pkgName} 版本 + CHANGELOG 记录，或改标 /* @internal */`);
        failures++;
      }
    } else {
      console.log(`✅ ${pkgName}：public API 无变化（${symbols.length} 符号，${basis} 解析）`);
    }
  } else if (!UPDATE) {
    console.log(`ℹ ${pkgName}：基线缺失（首次运行）——计入基线`);
  }
}

if (getAstEngine()) getAstEngine().close();

if (UPDATE) {
  writeFileSync(BASELINE, JSON.stringify(nextBaseline, null, 2) + '\n', 'utf-8');
  console.log(`\n基线已更新：${BASELINE}（${Object.keys(nextBaseline.packages).length} 包）`);
  process.exit(0);
}

if (failures > 0) {
  console.error(`\n❌ public API 门禁失败：${failures} 个包未 bump 版本`);
  process.exit(1);
}

// ── 文档声称符号数校验（根治 1449 漂移类问题）──
// 从核心文档提取声称的 @public 符号总数，与 baseline 实际总数比对。
const DOC_FILES = [
  join(ROOT, 'README.md'),
  join(ROOT, 'README.en.md'),
  join(ROOT, 'CHANGELOG.md'),
  join(ROOT, 'docs', 'changelog', 'v1.3', 'v1.3.9.md'),
  join(ROOT, 'docs', 'ROADMAP.md'),
  join(ROOT, 'docs', 'HANDBOOK.md'),
];

function actualTotal() {
  let t = 0;
  for (const v of Object.values(nextBaseline.packages)) {
    t += Array.isArray(v) ? v.length : (v.symbols || []).length;
  }
  return t;
}

function claimedTotals() {
  const claims = new Set();
  const re = /(\d{3,4})\s*(?:个)?\s*(?:符号|symbols)/gi;
  for (const f of DOC_FILES) {
    if (!existsSync(f)) continue;
    const text = readFileSync(f, 'utf-8');
    let m;
    while ((m = re.exec(text)) !== null) {
      const n = parseInt(m[1], 10);
      // 只收集与 @public/@internal 语境接近的声称（800-2000 区间，避开测试数 2903 等）
      if (n >= 800 && n <= 2000) claims.add(n);
    }
  }
  return [...claims];
}

const actual = actualTotal();
const claims = claimedTotals();
let docMismatch = 0;
if (claims.length > 0) {
  console.log(`\n📋 文档声称符号数校验（实际 baseline = ${actual}）`);
  for (const c of claims) {
    if (c === actual) {
      console.log(`  ✅ 文档声称 ${c} 与 baseline 一致`);
    } else {
      console.log(`  ❌ 文档声称 ${c} 与 baseline 实际 ${actual} 不一致（疑似数字漂移，参考问题 20 修复流程）`);
      docMismatch++;
    }
  }
} else {
  console.log(`\n📋 文档声称符号数校验：未提取到声称（跳过，无基线冲突风险）`);
}

if (docMismatch > 0) {
  console.error(`\n❌ 文档声称符号数校验失败：${docMismatch} 处漂移`);
  process.exit(1);
}

console.log('\n✅ public API 门禁通过');
