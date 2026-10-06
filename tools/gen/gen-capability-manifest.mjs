#!/usr/bin/env node
// ============================================================
// gen-capability-manifest.mjs · 主干能力清单校验器（v1.5.7 章五）
// ============================================================
// 唯一手写源：engine/capabilities.json
//
// 本脚本与 gen-plugin-manifests.mjs 不同：capabilities.json 不产出生成物
// （无 cordis.patch.yml / package.json 段要写），它是**纯断言器**——
// 校验清单自身的结构完备性与跨清单一致性，违规即 exit 2 具名报错。
//
// 断言族（编号即断言名，全部 exit 2 具名到条目与档位）：
//   C1 幽灵名        ① dependsOn 引用了不存在的能力 id
//                    ② 载体包名不在 engine/dsh-plugins/plugins.json 的
//                       bridgePkg/bridges.pkg 全集内（装配面陷阱①：写错
//                       插件 id / 包名不再静默——干跑断言，引用即对账）
//   C2 遗漏级联      A dependsOn B 且 B 声明 disabled（default=false）时，
//                    A 未声明处置（cascadeNote 缺失）⇒ 拒绝——「声明某能力
//                    可拔但依赖项未标级联」是装配面陷阱②的清单侧形态
//   C3 档位归属二义  同一 gate.name 被两个能力单元声明 ⇒ 二义（消费端
//                    无从分辨关哪个档）
//   C4 结构完备      每能力单元必填 id/domain/carrier/gate.name/gate.default/
//                    dependsOn/disabledImpact；shim 必填 id/carrier/cli/
//                    source/trigger/action；id 全局唯一（含 shim 前缀空间）
//   C5 域封闭        domain ∈ {注入·审计·回溯·沉淀·进化·执行}（六域口径——
//                    前五 = 约束层五能力，执行 = FORGE 内部面，见清单头注）
//   C6 env 一致      声明了 env 的条目，env 形如 SOFAGENT_*（防手滑写错
//                    前缀）；空串 = 该档位无环境变量形态（settings 档位）
//   C7 shim 台账     shims 恰好 12 条（v1.5.6 章一 SSOT 名单）、source
//                    路径在仓内真实存在、cli 名以 sofagent- 开头
//
// 用法：
//   node tools/gen/gen-capability-manifest.mjs           # 校验（无副作用）
//   node tools/gen/gen-capability-manifest.mjs --help
//
// 退出码：0 = 全部断言通过；2 = 清单违规 / 失明（清单缺失 / 不是合法 JSON /
//         plugins.json 侧读不到——校验器拒绝在失明状态下输出假绿）
//
// 依赖：仅 node 内置模块（fs/path）。
// ============================================================

import fs from 'fs';
import path from 'path';

const REAL_ROOT = path.resolve(import.meta.dirname, '../..');
const CAPABILITIES = 'engine/capabilities.json';
const PLUGINS_MANIFEST = 'engine/dsh-plugins/plugins.json';

const ARGV = process.argv.slice(2);
if (ARGV.includes('--help') || ARGV.includes('-h')) {
  console.log('gen-capability-manifest.mjs — 主干能力清单校验器（纯断言，无生成物）');
  console.log('  (无参数)   校验 engine/capabilities.json：幽灵名 / 遗漏级联 / 档位归属二义 + 装配面两陷阱');
  console.log('  --help     显示帮助');
  process.exit(0);
}

/** 六域封闭枚举（前五 = 约束层五能力，执行 = FORGE 内部面——见清单头注） */
const DOMAINS = ['注入', '审计', '回溯', '沉淀', '进化', '执行'];

/** 约束层五能力域（「执行」是内部工具面，不计五能力叙事） */
const FIVE_CAPABILITY_DOMAINS = ['注入', '审计', '回溯', '沉淀', '进化'];

/** v1.5.6 章一附录 SSOT：12 个旧命令 shim 名单（顺序即源文件清单顺序） */
const SHIM_CLI_SSOT = [
  'sofagent-audit', 'sofagent-audit-full', 'sofagent-core', 'sofagent-daemon',
  'sofagent-evolve', 'sofagent-ontology', 'sofagent-orchestrator',
  'sofagent-orchestrator-compare', 'sofagent-think', 'sofagent-ab-test',
  'sofagent-mcp', 'sofagent-eval',
];

/** 逐条收集违规（同类聚合后一次性报，不逐条中断——一次跑完看全貌） */
const violations = [];
const push = (assert, message) => violations.push(`[${assert}] ${message}`);

// ── 载入与失明自检 ──────────────────────────────────────────
function loadJson(rel) {
  const p = path.join(REAL_ROOT, rel);
  if (!fs.existsSync(p)) {
    console.error(`[失明] ${rel} 不存在——校验器拒绝在清单缺席时输出假绿`);
    process.exit(2);
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error(`[失明] ${rel} 不是合法 JSON：${e.message}`);
    process.exit(2);
  }
}

const doc = loadJson(CAPABILITIES);
const pluginsDoc = loadJson(PLUGINS_MANIFEST);

const capabilities = Array.isArray(doc.capabilities) ? doc.capabilities : null;
const shims = Array.isArray(doc.shims) ? doc.shims : null;
if (!capabilities || capabilities.length === 0) {
  console.error('[失明] capabilities.json 的 capabilities 为空或缺失——拒绝校验空清单');
  process.exit(2);
}
if (!shims || shims.length === 0) {
  console.error('[失明] capabilities.json 的 shims 为空或缺失——12 shim 台账缺席');
  process.exit(2);
}

// ── C4 结构完备 + id 唯一 ───────────────────────────────────
const idSet = new Set();
for (const [i, c] of capabilities.entries()) {
  const label = `capabilities[${i}]（${c && c.id ? c.id : '?' }）`;
  if (!c || typeof c !== 'object') {
    push('C4', `${label} 非对象`);
    continue;
  }
  for (const k of ['id', 'domain', 'carrier', 'disabledImpact']) {
    if (typeof c[k] !== 'string' || c[k].trim() === '') {
      push('C4', `${label} 缺字段或为空：${k}`);
    }
  }
  if (!c.gate || typeof c.gate.name !== 'string' || c.gate.name.trim() === '' || typeof c.gate.default !== 'boolean') {
    push('C4', `${label} 的 gate 须为 { name: 非空字符串, default: boolean }`);
  }
  if (!Array.isArray(c.dependsOn)) {
    push('C4', `${label} 的 dependsOn 须为数组（无依赖 = []）`);
  }
  if (idSet.has(c.id)) push('C4', `id 重复：${c.id}`);
  idSet.add(c.id);
}
for (const [i, s] of shims.entries()) {
  const label = `shims[${i}]（${s && s.id ? s.id : '?'}）`;
  if (!s || typeof s !== 'object') {
    push('C4', `${label} 非对象`);
    continue;
  }
  for (const k of ['id', 'carrier', 'cli', 'source', 'trigger', 'action']) {
    if (typeof s[k] !== 'string' || s[k].trim() === '') {
      push('C4', `${label} 缺字段或为空：${k}`);
    }
  }
  if (idSet.has(s.id)) push('C4', `id 重复（shim 与能力单元共享前缀空间）：${s.id}`);
  idSet.add(s.id);
}

// ── C5 域封闭 ───────────────────────────────────────────────
for (const c of capabilities) {
  if (c && typeof c === 'object' && !DOMAINS.includes(c.domain)) {
    push('C5', `${c.id} 的 domain "${c.domain}" 不在六域封闭枚举 {${DOMAINS.join('·')}} 内`);
  }
}

// ── C6 env 形态 ─────────────────────────────────────────────
for (const c of capabilities) {
  if (c && typeof c === 'object' && c.env !== undefined && c.env !== '') {
    if (typeof c.env !== 'string' || !/^SOFAGENT_[A-Z0-9_]+$/.test(c.env)) {
      push('C6', `${c.id} 的 env "${c.env}" 不匹配 SOFAGENT_* 形态（无环境变量形态请留空串）`);
    }
  }
}

// ── C3 档位归属二义 ─────────────────────────────────────────
const gateOwners = new Map();
for (const c of capabilities) {
  if (!c || typeof c !== 'object' || !c.gate || typeof c.gate.name !== 'string') continue;
  const key = `${c.carrier}::${c.gate.name}`;
  if (gateOwners.has(key)) {
    push('C3', `档位归属二义：${key} 同时被 ${gateOwners.get(key)} 与 ${c.id} 声明——消费端无从分辨关哪个档`);
  } else {
    gateOwners.set(key, c.id);
  }
}

// ── C1 幽灵名 ───────────────────────────────────────────────
// ① dependsOn 幽灵
for (const c of capabilities) {
  if (!c || typeof c !== 'object' || !Array.isArray(c.dependsOn)) continue;
  for (const dep of c.dependsOn) {
    if (!idSet.has(dep)) {
      push('C1', `${c.id} 的 dependsOn 引用了不存在的能力 id：${dep}（幽灵名）`);
    }
  }
}
// ② 载体包幽灵：carrier 必须是 engine/ 下真实存在的 workspace 包名
//    （干跑实测——以 engine/*/package.json 的 name 字段为对账面，不以声明为准；
//     evolve/mcp/eval/ab-test 是真实包但未被 DSH 插件桥接，故对账面取 workspace
//     全集而非 plugins.json 桥接子集）
const workspacePkgs = new Set();
for (const entry of fs.readdirSync(path.join(REAL_ROOT, 'engine'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const pkgJson = path.join(REAL_ROOT, 'engine', entry.name, 'package.json');
  if (!fs.existsSync(pkgJson)) continue;
  try {
    const name = JSON.parse(fs.readFileSync(pkgJson, 'utf8')).name;
    if (typeof name === 'string' && name !== '') workspacePkgs.add(name);
  } catch {
    // 坏 package.json 不中断——该目录名兜底进不了集合，引用它的条目会红
  }
}
for (const c of capabilities) {
  if (c && typeof c === 'object' && !workspacePkgs.has(c.carrier)) {
    push('C1', `${c.id} 的载体包 ${c.carrier} 不是 engine/ 下任何 workspace 包（装配面陷阱①：id/包名写错不再静默——干跑实测 engine/*/package.json 全集）`);
  }
}
for (const s of shims) {
  if (s && typeof s === 'object' && !workspacePkgs.has(s.carrier)) {
    push('C1', `${s.id} 的载体包 ${s.carrier} 不是 engine/ 下任何 workspace 包`);
  }
}
// ③ 装配面陷阱①的插件 id 对账：声明了 pluginId 的能力单元，其值必须真实存在于
//    plugins.json（capabilities 引用插件 id 写错即拒——不静默「照常运行」）
const pluginIds = new Set((pluginsDoc.plugins ?? []).map((p) => p.id).filter(Boolean));
for (const c of capabilities) {
  if (c && typeof c === 'object' && c.pluginId !== undefined) {
    if (typeof c.pluginId !== 'string' || !pluginIds.has(c.pluginId)) {
      push('C1', `${c.id} 的 pluginId "${c.pluginId}" 不在 plugins.json 插件 id 集内（幽灵插件——你要禁的照常运行）`);
    }
  }
}

// ── C2 遗漏级联 ─────────────────────────────────────────────
// A dependsOn B 且 B 默认关档（default=false，即「可声明 disabled」的清单侧形态）时，
// A 必须声明 cascadeNote（处置面）——否则「拔 B 连带影响 A」这件事在清单上不可见。
const byId = new Map(capabilities.filter((c) => c && c.id).map((c) => [c.id, c]));
for (const c of capabilities) {
  if (!c || typeof c !== 'object' || !Array.isArray(c.dependsOn)) continue;
  for (const dep of c.dependsOn) {
    const target = byId.get(dep);
    if (!target || !target.gate) continue;
    if (target.gate.default === false && (c.cascadeNote === undefined || String(c.cascadeNote).trim() === '')) {
      push('C2', `${c.id} dependsOn ${dep}（${dep} 默认关档/default=false），但 ${c.id} 未声明 cascadeNote 处置——禁用未级联被拒（装配面陷阱②）`);
    }
  }
}

// ── C7 shim 台账 ────────────────────────────────────────────
const shimClis = shims.filter((s) => s && typeof s.cli === 'string').map((s) => s.cli);
for (const cli of SHIM_CLI_SSOT) {
  if (!shimClis.includes(cli)) {
    push('C7', `shim 台账缺 v1.5.6 章一 SSOT 名单成员：${cli}`);
  }
}
for (const s of shims) {
  if (!s || typeof s !== 'object' || typeof s.cli !== 'string') continue;
  if (!SHIM_CLI_SSOT.includes(s.cli)) {
    push('C7', `shim ${s.id} 的 cli "${s.cli}" 不在 v1.5.6 章一 SSOT 名单内（名单以章一附录为唯一源）`);
  }
  if (!/^shim-/.test(s.id)) {
    push('C7', `shim ${s.id} 的 id 未用 shim-* 前缀（与能力单元 id 空间区分）`);
  }
  if (typeof s.source === 'string' && s.source.trim() !== '' && !fs.existsSync(path.join(REAL_ROOT, s.source))) {
    push('C7', `shim ${s.id} 的 source 路径 ${s.source} 在仓内不存在`);
  }
}

// ── 汇总输出 ────────────────────────────────────────────────
const fiveDomainCount = capabilities.filter(
  (c) => c && FIVE_CAPABILITY_DOMAINS.includes(c.domain),
).length;
if (violations.length > 0) {
  console.error(`capabilities.json 校验失败——${violations.length} 处违规：`);
  for (const v of violations) console.error(`  ${v}`);
  process.exit(2);
}
console.log(`✓ capabilities.json 全部断言通过：${capabilities.length} 能力单元（五能力域 ${fiveDomainCount} + 执行域 ${capabilities.length - fiveDomainCount}）+ ${shims.length} shim 台账；幽灵名 / 遗漏级联 / 档位归属二义 / 装配面两陷阱（插件包名存在性 + 禁用未级联）零违规`);
