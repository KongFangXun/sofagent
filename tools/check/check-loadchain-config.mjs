#!/usr/bin/env node
// ============================================================
// tools/check/check-loadchain-config.mjs · 加载链配置面门禁（v1.5.9 章三）
// ============================================================
//
// ── 职责 ──
// 把「加载链四层配置字段 SSOT」（engine/core/src/loadchain-schema.ts 的标记块）与
// 「加载链实现的真实引用」做**双向对账**，杜绝配置面无死角被悄悄打破：
//
//   ① 正向（schema → 实现）：schema 登记的每个字段，其 implRef 锚点必须仍在声明的
//      实现文件里命中。锚点消失＝实现改了读取点而 schema 未同步（漂移），报红。
//   ② 反向（实现 → schema）：扫描加载链实现里的 `process.env.SOFAGENT_*` 配置引用，
//      任一**未在 schema 登记** ⇒ 报红（实现私接了一个没人审计的配置开关）。
//   ③ 结构（schema 自身）：字段名归属唯一（同名字段不得两层声明）+ 四层全覆盖
//      （SKILL.md / fde.md / think.md / knowledge 每层至少一个字段）。
//
// ── 为什么是双向 ──
// 单向（只查 schema→实现）会漏「实现加了新配置开关但 schema 不知道」；单向（只查
// 实现→schema）会漏「schema 登记了实现已删除的字段」（死登记）。两面同时跑才叫对账。
//
// ── 退出码（三态，对齐本仓 check-* 家族）──
//   0 = 绿
//   1 = 有违规（归属冲突 / 四层缺层 / 锚点漂移 / 未登记实现引用 / implRef 越界扫描面）
//   2 = 检查器失明（SSOT 块缺失或解析为空 / schema 文件缺失 / 实现文件全不可读 /
//       反向扫描面为空——拒绝把「读不到」当「零违规」）
//
// ── 负向探针（不许静默通过）──
//   `--selftest`：对纯判定函数喂合成样本，逐条断言「注入违规 ⇒ 必被判红」：
//     · 归属冲突（同名字段两层声明）→ 必判
//     · 四层缺层 → 必判
//     · 未登记实现引用（env 开关）→ 必判
//     · 锚点漂移（needle 不在文本）→ 必判
//     · 干净样本 → 必判绿（防「红不了」与「一律红」两种装饰品）
//
// 用法：
//   node tools/check/check-loadchain-config.mjs             # 常态门禁
//   node tools/check/check-loadchain-config.mjs --selftest  # 判定逻辑自测
//
// 依赖：仅 node 内置模块——不 import 仓内 dist，无需先 build。
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
/**
 * 仓库根。默认按脚本位置推导；`LOADCHAIN_CHECK_ROOT` 可显式覆盖——
 * 用途：负向探针（在临时镜像里注入未登记字段，验证门禁必报红）不污染真实工作树。
 */
const ROOT = process.env.LOADCHAIN_CHECK_ROOT
  ? path.resolve(process.env.LOADCHAIN_CHECK_ROOT)
  : path.resolve(SELF_DIR, '..', '..');

/** SSOT 载体（本门禁与 TS 模块读同一段字节） */
const SCHEMA_REL = 'engine/core/src/loadchain-schema.ts';
/** 标记行（改提取约定必须同步改 loadchain-schema.ts 头注） */
const SSOT_BEGIN = 'LOADCHAIN-CONFIG-SSOT:BEGIN';
const SSOT_END = 'LOADCHAIN-CONFIG-SSOT:END';

/** 四层（顺序即注入顺序） */
const LAYERS = ['SKILL.md', 'fde.md', 'think.md', 'knowledge'];

/**
 * 加载链实现的扫描面（反向 env 对账 + implRef 归属校验的白名单）。
 * 只有这些文件里的配置引用参与对账——面外的文件即使出现配置引用也不影响本门禁
 * （implRef 若指向面外文件，按「越过扫描面＝失明」处理，见下）。
 */
const IMPL_FILES = [
  'engine/inject/src/index.ts',
  'engine/inject/src/knowledge-index.ts',
  'engine/inject/src/load-chain/budget.ts',
  'engine/inject/src/load-chain/compactor.ts',
  'engine/hooks/sofagent-load-chain/src/handler.ts',
  'engine/core/src/memory-contract.ts',
];

// ============================================================
// 纯判定函数（可注入样本 → --selftest 复用同一逻辑）
// ============================================================

/**
 * 从 schema 源码文本提取 SSOT 块并解析为字段数组。
 * 标记按**整行锚定**匹配（`^// LOADCHAIN-CONFIG-SSOT:BEGIN$`）——schema 头注里会以行内
 * 反引号形式提到标记名，若用 indexOf 会命中头注而非真标记。
 * @returns {{ok:true, fields:Array}|{ok:false, reason:string}}
 */
export function parseSsot(text) {
  const markerRe = (token) =>
    new RegExp(`^//\\s*${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm');
  const bm = markerRe(SSOT_BEGIN).exec(text);
  const em = markerRe(SSOT_END).exec(text);
  if (!bm || !em || em.index < bm.index) {
    return { ok: false, reason: `未找到 SSOT 标记块（${SSOT_BEGIN} … ${SSOT_END}，须整行独占）` };
  }
  const seg = text.slice(bm.index + bm[0].length, em.index);
  const m = seg.match(/`([\s\S]*)`/); // 标记块内恰一个模板字符串承载 JSON
  if (!m) {
    return { ok: false, reason: 'SSOT 标记块内未找到承载 JSON 的模板字符串' };
  }
  let fields;
  try {
    fields = JSON.parse(m[1]);
  } catch (err) {
    return { ok: false, reason: `SSOT JSON 解析失败：${err instanceof Error ? err.message : String(err)}` };
  }
  if (!Array.isArray(fields) || fields.length === 0) {
    return { ok: false, reason: 'SSOT 字段表为空（0 条）——检查器失明，拒绝假绿' };
  }
  for (const f of fields) {
    if (
      !f || typeof f !== 'object' ||
      typeof f.key !== 'string' || !f.key ||
      typeof f.layer !== 'string' || !f.layer ||
      typeof f.type !== 'string' || !f.type ||
      !f.implRef || typeof f.implRef.file !== 'string' || typeof f.implRef.needle !== 'string'
    ) {
      return { ok: false, reason: `SSOT 字段条目结构非法（需 key/layer/type/implRef{file,needle}）：${JSON.stringify(f)}` };
    }
  }
  return { ok: true, fields };
}

/** ① 结构面：归属唯一（同名字段两层声明） */
export function ownershipViolations(fields) {
  const out = [];
  const byKey = new Map();
  for (const f of fields) {
    if (!LAYERS.includes(f.layer)) {
      out.push(`字段「${f.key}」归属层非法：「${f.layer}」不在四层 [${LAYERS.join(', ')}] 内`);
    }
    const owners = byKey.get(f.key) ?? [];
    owners.push(f.layer);
    byKey.set(f.key, owners);
  }
  for (const [key, owners] of byKey) {
    if (owners.length > 1) {
      out.push(`归属不唯一：字段「${key}」被 ${owners.length} 处声明，归属层 [${owners.join(', ')}]——同一字段只能归一层`);
    }
  }
  return out;
}

/** ① 结构面：四层全覆盖（每层至少一个字段） */
export function layerCoverageViolations(fields) {
  const present = new Set(fields.map((f) => f.layer));
  const missing = LAYERS.filter((l) => !present.has(l));
  if (missing.length === 0) return [];
  return [`四层配置面缺层：${missing.map((l) => `「${l}」`).join('、')}未登记任何字段——四层配置字段必须全部登记`];
}

/** 从一段源码文本提取 `process.env.SOFAGENT_*` 引用名 */
export function envRefsInText(text) {
  const out = new Set();
  const re = /process\.env(?:\.([A-Z][A-Z0-9_]*)|\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\])/g;
  for (const m of text.matchAll(re)) {
    const name = m[1] ?? m[2];
    if (name && name.startsWith('SOFAGENT_')) out.add(name);
  }
  return out;
}

/** ② 反向：实现引用的配置字段必须已登记 */
export function reverseViolations(referencedKeys, fields) {
  const registered = new Set(fields.map((f) => f.key));
  const un = [...new Set(referencedKeys)].filter((k) => !registered.has(k));
  if (un.length === 0) return [];
  return [`实现引用了未登记配置字段：${un.map((k) => `「${k}」`).join('、')}——配置面无死角，实现引用的字段必须先在 schema 登记`];
}

/**
 * ③ 正向：schema 登记的每字段，implRef 锚点必须在声明文件里命中；且 implRef 不得越过扫描面。
 * @param fields 字段表
 * @param readImpl (rel) => string|null  读取实现文件（相对 ROOT）
 */
export function forwardViolations(fields, readImpl) {
  const out = [];
  for (const f of fields) {
    const rel = f.implRef.file;
    if (!IMPL_FILES.includes(rel)) {
      out.push(`implRef 越界扫描面：字段「${f.key}」指向 ${rel}，不在加载链实现白名单内——检查器对该文件失明`);
      continue;
    }
    const text = readImpl(rel);
    if (text === null) {
      out.push(`实现文件不可读：字段「${f.key}」的 implRef 文件缺失——${rel}`);
      continue;
    }
    if (!text.includes(f.implRef.needle)) {
      out.push(`锚点漂移：字段「${f.key}」的 implRef 锚点未命中——${rel} 中已无「${f.implRef.needle}」（实现改了读取点而 schema 未同步）`);
    }
  }
  return out;
}

function emitCoverage(asserts, covered, skipped) {
  console.log(`[check:coverage] script=check-loadchain-config asserts=${asserts} covered=${covered} skipped=${skipped}`);
}

// ============================================================
// 常态门禁
// ============================================================
function main() {
  let asserts = 0;

  // ── 读取 SSOT 载体 ──
  const schemaAbs = path.join(ROOT, SCHEMA_REL);
  if (!fs.existsSync(schemaAbs)) {
    console.log(`❌ check-loadchain-config 检查器失明（拒绝假绿）：SSOT 载体缺失 ${SCHEMA_REL}`);
    emitCoverage(0, 0, 0);
    return 2;
  }
  const parsed = parseSsot(fs.readFileSync(schemaAbs, 'utf8'));
  if (!parsed.ok) {
    console.log(`❌ check-loadchain-config 检查器失明（拒绝假绿）：${parsed.reason}`);
    emitCoverage(0, 0, 0);
    return 2;
  }
  const fields = parsed.fields;

  // ── 读实现扫描面（全不可读 ⇒ 失明）──
  const implText = new Map();
  for (const rel of IMPL_FILES) {
    const abs = path.join(ROOT, rel);
    try {
      implText.set(rel, fs.readFileSync(abs, 'utf8'));
    } catch {
      implText.set(rel, null);
    }
  }
  const readable = [...implText.values()].filter((t) => t !== null).length;
  if (readable === 0) {
    console.log('❌ check-loadchain-config 检查器失明（拒绝假绿）：加载链实现文件全部不可读（扫描面为空）');
    emitCoverage(0, 0, 0);
    return 2;
  }

  // ── 反向扫描：实现里的 SOFAGENT_* 配置引用 ──
  const envRefs = new Set();
  for (const t of implText.values()) {
    if (t === null) continue;
    for (const r of envRefsInText(t)) envRefs.add(r);
  }
  if (envRefs.size === 0) {
    console.log('❌ check-loadchain-config 检查器失明（拒绝假绿）：反向扫描面零配置引用（提取器失明或配置面已迁移）');
    emitCoverage(0, 0, 0);
    return 2;
  }

  console.log('── 加载链配置面门禁（四层字段 SSOT ⇄ 实现 双向对账）──');
  console.log(`  扫描面：schema ${SCHEMA_REL} · 实现 ${readable}/${IMPL_FILES.length} 文件可读`);
  console.log(`  登记字段 ${fields.length} 条 / 反向捕获 env 引用 ${envRefs.size} 条`);
  console.log('');

  const readImpl = (rel) => (implText.has(rel) ? implText.get(rel) : null);

  const failGroups = [
    ['① 结构·归属唯一', ownershipViolations(fields)],
    ['① 结构·四层全覆盖', layerCoverageViolations(fields)],
    ['③ 正向·implRef 锚点仍在', forwardViolations(fields, readImpl)],
    ['② 反向·实现引用已登记', reverseViolations([...envRefs], fields)],
  ];

  let total = 0;
  for (const [label, vs] of failGroups) {
    asserts += 1;
    if (vs.length === 0) {
      console.log(`  ✓ ${label}`);
    } else {
      console.log(`  ❌ ${label}（${vs.length} 处）：`);
      for (const v of vs) console.log(`      · ${v}`);
      total += vs.length;
    }
  }

  console.log('');
  if (total > 0) {
    console.log(`✗ 加载链配置面 ${total} 处违规——配置面无死角被打破`);
    emitCoverage(asserts, fields.length, 0);
    return 1;
  }
  console.log(`✓ 加载链配置面全绿（登记 ${fields.length} 字段 / 四层 / 双向对账一致）`);
  emitCoverage(asserts, fields.length, 0);
  return 0;
}

// ============================================================
// --selftest：合成探针（红不了 / 一律红 两种装饰品都拦）
// ============================================================
function selftest() {
  const results = [];
  const ok = (name, cond) => results.push({ name, pass: !!cond });

  const goodField = (key, layer, file = IMPL_FILES[0], needle = `NEEDLE_${key}`) => ({
    key, layer, type: 'string', default: '', implRef: { file, needle },
  });
  const goodFields = [
    goodField('a', 'SKILL.md'),
    goodField('b', 'fde.md'),
    goodField('c', 'think.md'),
    goodField('d', 'knowledge'),
  ];
  const readAll = (rel) => (IMPL_FILES.includes(rel) ? goodFields.map((f) => f.implRef.needle).join('\n') : null);
  const readNone = () => '';

  // P1 干净样本 → 必判绿（防「一律红」装饰品）
  {
    const v = [
      ...ownershipViolations(goodFields),
      ...layerCoverageViolations(goodFields),
      ...forwardViolations(goodFields, readAll),
    ];
    ok('P1 干净样本 → 零违规（非「一律红」）', v.length === 0);
  }

  // P2 归属冲突（同名字段两层声明）→ 必具名判红
  {
    const bad = [goodField('dup', 'SKILL.md'), goodField('dup', 'knowledge')];
    const v = ownershipViolations(bad);
    ok('P2 归属冲突判红', v.length === 1 && v[0].includes('dup') && v[0].includes('不唯一'));
  }

  // P3 归属层非法 → 必判红
  {
    const bad = [goodField('x', 'bogus-layer')];
    const v = ownershipViolations(bad);
    ok('P3 归属层非法判红', v.some((m) => m.includes('归属层非法')));
  }

  // P4 四层缺层 → 必具名判红
  {
    const bad = [goodField('a', 'SKILL.md'), goodField('b', 'fde.md'), goodField('c', 'think.md')];
    const v = layerCoverageViolations(bad);
    ok('P4 四层缺层判红（点名 knowledge）', v.length === 1 && v[0].includes('knowledge'));
  }

  // P5 未登记实现引用（env 开关）→ 必具名判红
  {
    const refs = [...envRefsInText("process.env.SOFAGENT_KNOWN; process.env.SOFAGENT_UNKNOWN_KNOB;")]
      .concat([...envRefsInText("process.env['SOFAGENT_BRACKET']")]);
    ok('P5a env 提取含点号与方括号两种形态', refs.includes('SOFAGENT_UNKNOWN_KNOB') && refs.includes('SOFAGENT_BRACKET'));
    const v = reverseViolations(refs, [goodField('SOFAGENT_KNOWN', 'SKILL.md')]);
    ok('P5b 未登记实现引用判红（点名 SOFAGENT_UNKNOWN_KNOB）', v.length === 1 && v[0].includes('SOFAGENT_UNKNOWN_KNOB'));
  }

  // P6 非 SOFAGENT_ 前缀的 env 不计入（防噪声：HOME/OPENCLAW_STATE_DIR 属 OS 面）
  {
    const refs = [...envRefsInText('process.env.HOME; process.env.OPENCLAW_STATE_DIR; process.env.SOFAGENT_HOME;')];
    ok('P6 仅收 SOFAGENT_ 命名空间', refs.length === 1 && refs[0] === 'SOFAGENT_HOME');
  }

  // P7 正向锚点漂移 → 必具名判红；implRef 越界扫描面 → 必判红
  {
    const drift = forwardViolations([goodField('a', 'SKILL.md')], readNone);
    ok('P7a 锚点漂移判红', drift.length === 1 && drift[0].includes('锚点漂移'));
    const outOfScope = forwardViolations(
      [{ ...goodField('a', 'SKILL.md'), implRef: { file: 'engine/elsewhere/x.ts', needle: 'z' } }],
      readAll,
    );
    ok('P7b implRef 越界扫描面判红', outOfScope.length === 1 && outOfScope[0].includes('越界扫描面'));
  }

  // P8 SSOT 提取器：标记缺失 / 空表 → 失明；正常块 → 解出字段
  {
    ok('P8a 标记缺失 → 失明', parseSsot('no markers here').ok === false);
    const good = `// ${SSOT_BEGIN}\nconst X = \`[{"key":"a","layer":"SKILL.md","type":"string","implRef":{"file":"${IMPL_FILES[0]}","needle":"n"}}]\`;\n// ${SSOT_END}`;
    const p = parseSsot(good);
    ok('P8b 正常块解出字段', p.ok === true && p.fields.length === 1 && p.fields[0].key === 'a');
    const empty = `// ${SSOT_BEGIN}\n\`[]\`\n// ${SSOT_END}`;
    ok('P8c 空字段表 → 失明', parseSsot(empty).ok === false);
  }

  let failed = 0;
  for (const r of results) {
    console.log(`  ${r.pass ? '✓' : '❌'} ${r.name}`);
    if (!r.pass) failed++;
  }
  console.log(`\n--selftest: ${results.length - failed} 通过 / ${failed} 失败（共 ${results.length} 项）`);
  emitCoverage(results.length, results.length, 0);
  return failed === 0 ? 0 : 1;
}

// ============================================================
// 入口（仅直接执行时跑判定；被 import 时不产生副作用）
// ============================================================
const isDirectRun =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  try {
    process.exit(process.argv.includes('--selftest') ? selftest() : main());
  } catch (err) {
    console.log('❌ check-loadchain-config 检查器异常（拒绝假绿）：');
    console.log(`    ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    emitCoverage(0, 0, 0);
    process.exit(2);
  }
}
