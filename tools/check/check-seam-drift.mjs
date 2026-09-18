#!/usr/bin/env node
// ============================================================
// check-seam-drift · 宿主 hook 词表漂移巡检（只提示不阻断）
// ============================================================
// 为什么需要：宿主（OpenClaw / DSH）是**破坏性升级常态**的外部依赖——官方明说
// 「核心代码更新 → 插件可能成片失效」。SEAMS.md 的词汇表是 sofagent 侧的登记本，
// 一旦宿主新增/改名/废弃事件，登记本就静默过期：词表看起来仍然自洽（check-seam-contract
// 只对账「咱们四载体之间一致」），但**宿主那侧已经不是同一个世界了**。
// 本脚本做的是「登记本 vs 宿主实测」的差集，把漂移在升级当天暴露出来，而不是等插件成片失效。
//
// 判定口径（三面）：
//   ① 宿主有、词表未登记 → DRIFT（宿主新增，或我们漏登）
//   ② 词表登记、宿主没有 → DRIFT（宿主改名/移除——这类会让插件 seam 失效，最危险）
//   ③ 宿主标记 deprecated 而词表未标注 → DRIFT（该 seam 不该用于新插件）
//
// 只提示不阻断：默认 exit 0（漂移是信息，不是本仓的错）。--strict 时漂移 → exit 2。
// 宿主不在场（未安装）→ 打印 SKIP 并说明原因，exit 0（**绝不静默通过**）。
//
// 用法：
//   node tools/check/check-seam-drift.mjs            # 报告
//   node tools/check/check-seam-drift.mjs --strict   # 漂移即失败（供 CI/巡检用）
//   OPENCLAW_DIR=/path/to/openclaw node ...          # 显式指定宿主包目录
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SEAMS = path.join(REPO, 'engine/dsh-plugins/SEAMS.md');
const STRICT = process.argv.includes('--strict');

const drifts = [];
const skips = [];

/** 从一段文本里按 `| \`名字\` |` 首列形态取登记名（锚定行首，避免抓到宿主包列） */
function documentedRows(section) {
  return [...section.matchAll(/^\| `([A-Za-z0-9_:/.-]+)` \|/gm)].map((m) => m[1]);
}

/**
 * 枚举本机 OpenClaw 宿主副本。
 *
 * 🔴 为什么必须枚举而不是取第一个：本机常有**多份**副本（不同 node 版本各自全局装一份），
 *    版本不同 → hook union 不同（实测 2026.5.20=37 个 / 2026.6.1=39 个）。取到旧副本
 *    会把「新副本才有的 hook」误报成词表漏登。故按 SEAMS.md 记录的版本优先，其次取最高版本。
 */
function findOpenClawCopies() {
  const candidates = [];
  if (process.env.OPENCLAW_DIR) candidates.push(process.env.OPENCLAW_DIR);
  try {
    const gRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
    candidates.push(path.join(gRoot, 'openclaw'));
  } catch {
    // npm 不在 PATH：跳过该候选（后面还有别的候选）
  }
  const managed = path.join(process.env.HOME ?? '', '.workbuddy/binaries/node/versions');
  if (fs.existsSync(managed)) {
    for (const v of fs.readdirSync(managed)) candidates.push(path.join(managed, v, 'lib/node_modules/openclaw'));
  }
  candidates.push('/usr/local/lib/node_modules/openclaw', '/opt/homebrew/lib/node_modules/openclaw');

  const copies = [];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(path.join(p, 'dist'))) continue;
      if (!fs.readdirSync(path.join(p, 'dist')).some((f) => f.startsWith('hook-types-'))) continue;
      const version = JSON.parse(fs.readFileSync(path.join(p, 'package.json'), 'utf8')).version ?? '0.0.0';
      if (!copies.some((c) => c.dir === p)) copies.push({ dir: p, version });
    } catch {
      // 单个候选目录不可读不致命（还有别的副本）——不打印，避免噪声
    }
  }
  return copies;
}

/** 版本比较（形如 2026.6.1 的日历版本号） */
const newer = (a, b) => a.split('.').map(Number).join('.') > b.split('.').map(Number).join('.');

/** OpenClaw：从宿主 .d.ts 取 hook union + 废弃表 */
function openclawFacts(dir) {
  const dist = path.join(dir, 'dist');
  const file = fs.readdirSync(dist).filter((f) => f.startsWith('hook-types-') && f.endsWith('.d.ts')).sort().pop();
  const t = fs.readFileSync(path.join(dist, file), 'utf8');
  const union = [...(t.match(/declare const PLUGIN_HOOK_NAMES: readonly \[([\s\S]*?)\]/)?.[1] ?? '').matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  // 废弃名单：同一份 .d.ts 里的联合类型（`type DeprecatedPluginHookName = "a" | "b";`）最稳——
  // 运行时的 DEPRECATED_PLUGIN_HOOK_NAMES 是 Object.keys(DEPRECATED_PLUGIN_HOOKS)，在别的 chunk 里。
  const deprecated = [...(t.match(/type DeprecatedPluginHookName = ([^;]+);/)?.[1] ?? '').matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  return { file, union, deprecated };
}

/** DSH：五类宿主事件族（与 SEAMS.md §1 复核命令同口径） */
function findDshHost() {
  const base = path.join(process.env.HOME ?? '', '.dsh/profiles/node_modules/@deepseek-ai');
  return fs.existsSync(base) ? base : null;
}

function dshFacts(base) {
  const families = {
    'dsh-tools': ['tools/'],
    'dsh-fs': ['fs/'],
    'dsh-agent': ['agent/'],
    // dsh-hook-protocol 的 session/ 与 turn/ 命中的是**载荷类型字面量**（该协议发给
    // 仓外 hook 的事件类型），不是 ctx 订阅点——词汇表按 §1 口径仍把它们登记在
    // 「宿主真实存在的名字」下，故探测面照旧；in-process 订阅点的真实归属见下一行。
    'dsh-hook-protocol': ['hook/', 'session/', 'turn/'],
    // v1.5.0 章十：会话事件流的**真实订阅点**只有 `session/event`（`Session.append`
    // 广播 listener `(session, event)`，宿主观测点 `dsh-session/lib/index.js:1530` 以
    // 位置参数派发该名）。同家族其余 `session/*` 是**会话事件类型**（`append` 的载荷名，
    // 如 `session/title` / `session/flush` / `session/end-seed`），不是 ctx 订阅点——
    // 故此条按**精确名**探测（前缀形态会把载荷名一并当成可挂事件，误报「宿主有、词表未登记」）。
    'dsh-session': ['session/event'],
  };
  // 口径：扫代码/类型面（.js/.mjs/.cjs/.ts/.d.ts），**不扫 .md**——README 是散文，
  // 里面出现的名字可能是「已废弃」「示例」而非可挂载契约（实测 agent/pre-step 的定义
  // 落在 lib/types/runtime-types.d.ts，只扫 .js 会漏，故必须含 .d.ts）。
  const CODE = /\.(js|mjs|cjs|ts)$/;
  // SEAMS.md §1 尾注声明：词汇表**只收插件可挂的生命周期事件**，不追求登记宿主全部内部事件
  // （例：internal/dispatch）——那些不对插件开放，出现即豁免，不算漂移。
  // 🔴 v1.5.0 章十：`session/event` **不再**属豁免面——它是会话事件流的真实订阅点
  //    （evolve 插件据此观察 turn 收尾），已正式登记进词汇表 §1，必须参与双向对账。
  const INTERNAL_NOT_OPEN = new Set(['internal/dispatch']);
  const found = [];
  const exempt = new Set();
  for (const [pkg, prefixes] of Object.entries(families)) {
    const lib = path.join(base, pkg, 'lib');
    if (!fs.existsSync(lib)) continue;
    for (const prefix of prefixes) {
      // 两种探测口径：家族前缀（`tools/` → `"tools/<name>"`）与**精确名**（`session/event`）
      const exact = /^[a-z-]+\/[a-z-]+$/.test(prefix);
      const escaped = prefix.replace('/', '\\/');
      const re = exact
        ? new RegExp(`["']${escaped}["']`, 'g')
        : new RegExp(`["']${escaped}[a-z-]+["']`, 'g');
      const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) walk(p);
          else if (CODE.test(e.name)) for (const m of fs.readFileSync(p, 'utf8').matchAll(re)) {
            if (INTERNAL_NOT_OPEN.has(m[0].slice(1, -1))) exempt.add(m[0].slice(1, -1));
            else found.push(m[0].slice(1, -1));
          }
        }
      };
      walk(lib);
    }
  }
  return { names: [...new Set(found)].sort(), exempt: [...exempt].sort() };
}

// ── 主流程 ──────────────────────────────────────────────
const doc = fs.readFileSync(SEAMS, 'utf8');
const dshSec = doc.split('## 1. DSH 侧')[1]?.split('## 2. DSH 侧')[0] ?? '';
const ocSec = (doc.split('## 3. OpenClaw 侧')[1] ?? '').split(/^### 3b\.|^## 4\. /m)[0] ?? ''; // 排除 §3b（内建 HOOK.md 机制，colon 风格，不属插件 hook 面）
const dshDoc = documentedRows(dshSec);
const ocDoc = documentedRows(ocSec);

console.log('=== seam 词表漂移巡检（SEAMS.md 登记本 vs 宿主实测）===');
console.log(`  词表登记：DSH ${dshDoc.length} 条 / OpenClaw ${ocDoc.length} 条`);

// ① OpenClaw
const copies = findOpenClawCopies();
const ocDirVersion = (ocSec.match(/本机\s*`([0-9.]+)`/) ?? [])[1]; // SEAMS.md §3 记录的宿主版本
const chosen = copies.find((c) => c.version === ocDirVersion)
  ?? copies.slice().sort((a, b) => (newer(a.version, b.version) ? -1 : 1))[0];
if (!chosen) {
  skips.push('OpenClaw 宿主未找到（可设 OPENCLAW_DIR 指定）');
} else {
  if (ocDirVersion && chosen.version !== ocDirVersion) {
    drifts.push(`[OpenClaw] 词表记录的宿主版本 ${ocDirVersion} 不在场，实际比对 ${chosen.version}（词表的复核基准需更新）`);
  }
  const others = copies.filter((c) => c.dir !== chosen.dir);
  if (others.length) console.log(`  ℹ 本机另有 ${others.length} 份副本（版本不同 → hook union 不同，未参与比对）：${others.map((c) => c.version).join(' / ')}`);
  const { file, union, deprecated } = openclawFacts(chosen.dir);
  console.log(`  宿主 OpenClaw：${chosen.version} · ${file} · union ${union.length} 个 / 废弃 ${deprecated.length} 个`);
  for (const n of union.filter((x) => !ocDoc.includes(x))) drifts.push(`[OpenClaw] 宿主有、词表未登记：${n}${deprecated.includes(n) ? '（宿主已标废弃）' : ''}`);
  for (const n of ocDoc.filter((x) => !union.includes(x))) drifts.push(`[OpenClaw] 词表登记、宿主没有：${n}（该 seam 已失效，挂它的插件会静默不生效）`);
  for (const n of union.filter((x) => deprecated.includes(x) && ocDoc.includes(x))) drifts.push(`[OpenClaw] 词表登记了宿主已废弃的 hook：${n}`);
}

// ② DSH
const dshBase = findDshHost();
if (!dshBase) {
  skips.push('DSH 宿主未找到（~/.dsh/profiles/node_modules/@deepseek-ai 不存在）');
} else {
  const { names, exempt } = dshFacts(dshBase);
  console.log(`  宿主 DSH：@deepseek-ai · 实测事件 ${names.length} 个${exempt.length ? `（另有 ${exempt.length} 个内部事件按 SEAMS.md §1 尾注豁免：${exempt.join(", ")}）` : ""}`);
  for (const n2 of names.filter((x) => !dshDoc.includes(x))) drifts.push(`[DSH] 宿主有、词表未登记：${n2}`);
  for (const n2 of dshDoc.filter((x) => !names.includes(x))) drifts.push(`[DSH] 词表登记、宿主没有：${n2}`);
}

// ── 输出 ────────────────────────────────────────────────
for (const s of skips) console.log(`  SKIP: ${s}`);
if (drifts.length === 0 && skips.length === 0) {
  console.log('  ✓ 零漂移：词表与两侧宿主实测一致');
} else if (drifts.length === 0) {
  console.log('  ✓ 已到场宿主零漂移（有 SKIP，见上）');
} else {
  console.log(`  ⚠ 漂移 ${drifts.length} 处（只提示不阻断——请更新 SEAMS.md 或核实宿主升级）：`);
  for (const d of drifts) console.log(`    · ${d}`);
}
console.log(STRICT && drifts.length > 0 ? '\n✗ --strict：存在漂移，退出 2' : '\n（漂移是信息不是失败：默认 exit 0；--strict 供 CI 用）');
process.exit(STRICT && drifts.length > 0 ? 2 : 0);
