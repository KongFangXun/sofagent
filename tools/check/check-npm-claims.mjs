#!/usr/bin/env node
// ============================================================
// check-npm-claims.mjs · registry 实测声称对账守卫
// ============================================================
// 门禁目的：README / docs 里所有「实测 npm view <pkg> dist-tags …」形态的
//   对外声称，在发版动作（publish / tag）后必然失真，却靠人肉记忆保鲜。
//   修一处只治标；本守卫把「文档声称值 vs registry 在线真值」的比对前移，
//   让失真在推前 / PR 当场红（A-5 根因的机制化收口）。
//
// 扫描面：活文档面 = 根 README.md / README.en.md + docs/ 下全部 .md
//   （排除 docs/changelog/ 历史区——历史记述按纪律原样保留）。
//
// 判定形态（三分，只抓「值声称」，不误伤命令提示）：
//   一行含 dist-tags 时——
//     ① 且解析出 latest 值 + 包名 ⇒ 一条值声称（对账）
//        pkg 解析优先级：npm view <pkg> dist-tags 里的 <pkg>；无 npm view 时
//        回退到行内被引用包名（@sofagent/<name> 或裸名 sofagent，带词边界）——
//        覆盖「dist-tags 当前为 …」无 npm view 形态。
//     ② 无 latest 值 ⇒ 命令提示 / 策略叙述，非值声称（可见跳过）
//     ③ 有 latest 值但解析不出包名 ⇒ 盲区（不可判定 ⇒ main 判 exit 2，拒绝假绿）
//
// 真值来源：npm view <pkg> dist-tags --prefer-online（≥3 轮重试；超时走
//   Node child_process 的 timeout 选项——macOS 无 timeout 命令，故不用它）。
//
// 三态退出码（对齐 check 系家族）：
//   0 = 全部通过（可含可见 SKIP：registry 不可达）
//   1 = 文档声称值与 registry 真值失配
//   2 = 检查器失明 / 豁免台账非法 / 存在无法判定包名的值声称——拒绝假绿
//
// 已知债豁免：tools/check/npm-claims-exempt.json（形态照 archaeology-exempt.json
//   的 exemptAnchors：{file, anchor, reason}；锚须文件内唯一且当前仍是命中行）。
//   ⚠️ 当前登记的唯一已知债 = README.md 与 README.en.md 各一段过期 npm 通道声称
//   （A-5 待拍板：npm 通道策略未定，声称暂不改为最新真值）。A-5 一旦落地、锚串
//   不再命中 ⇒ 本守卫 exit 2（债自动过期，不留永久口子）——不许静默。
//
// 用法：
//   node tools/check/check-npm-claims.mjs                # 常规对账
//   node tools/check/check-npm-claims.mjs --selftest     # 检测器自检（合成样本）
//   node tools/check/check-npm-claims.mjs --list-exempt  # 附列豁免放行明细
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXEMPT_FILE = path.join(ROOT, 'tools', 'check', 'npm-claims-exempt.json');
const SCRIPT_NAME = 'check-npm-claims';
const REGISTRY_ATTEMPTS = 3;
const REGISTRY_TIMEOUT_MS = 20000;

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  console.log('check-npm-claims.mjs — npm 实测声称对账守卫');
  console.log('  (无参数)       常规对账：文档声称值 vs registry 在线真值');
  console.log('  --selftest     检测器自检（合成样本，验证规则未失效）');
  console.log('  --list-exempt  附列被豁免放行的声称明细');
  process.exit(0);
}
const SELFTEST = argv.includes('--selftest');
const LIST_EXEMPT = argv.includes('--list-exempt');

// ── 检测核心 ──────────────────────────────────────────────
// 行含 dist-tags 才进入判定；三分见文件头「判定形态」。
const PKG_RE = /npm view\s+([^\s`'"|]+)\s+dist-tags/;
const PKG_CITED_RE = /(@sofagent\/[a-z0-9][a-z0-9-]*|(?<![\w/@-])sofagent(?![-\w]))/;
const LATEST_RE = /latest:\s*['"]([^'"]+)['"]/;

function detectClaim(line) {
  if (!line.includes('dist-tags')) return null;
  const ml = line.match(LATEST_RE);
  if (!ml) {
    const mp = line.match(PKG_RE);
    return { pkg: mp ? mp[1] : null, claimed: null, pkgFrom: mp ? 'npm-view' : null };
  }
  const mp = line.match(PKG_RE);
  const mc = mp ? null : line.match(PKG_CITED_RE);
  return {
    pkg: mp ? mp[1] : (mc ? mc[1] : null),
    claimed: ml[1],
    pkgFrom: mp ? 'npm-view' : (mc ? 'cited' : null),
  };
}

// 检测器存活样本——正则失效时本样本不再命中 ⇒ exit 2（失明必须失声）
const SAMPLE_LINE = "实测 `npm view @sofagent/audit dist-tags` 当前为 `{ latest: '1.2.3' }`";
function detectorSelfCheck() {
  const d = detectClaim(SAMPLE_LINE);
  return !!(d && d.pkg === '@sofagent/audit' && d.claimed === '1.2.3');
}

// ── 扫描面收集 ────────────────────────────────────────────
function collectLiveDocs() {
  const files = [];
  for (const f of ['README.md', 'README.en.md']) {
    const p = path.join(ROOT, f);
    if (fs.existsSync(p)) files.push(p);
  }
  const docsDir = path.join(ROOT, 'docs');
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      const rel = path.relative(ROOT, p);
      if (e.isDirectory()) {
        if (rel === 'docs/changelog') continue; // 历史区（历史记述原样保留）
        if (['node_modules', '.git'].includes(e.name)) continue;
        walk(p);
      } else if (e.name.endsWith('.md')) {
        files.push(p);
      }
    }
  };
  if (fs.existsSync(docsDir)) walk(docsDir);
  return files;
}

function scanClaims(files) {
  const claims = [];
  const unparsed = [];
  const blind = [];
  for (const f of files) {
    const rel = path.relative(ROOT, f);
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((l, i) => {
      const d = detectClaim(l);
      if (!d) return;
      if (!d.claimed) {
        unparsed.push({ file: rel, line: i + 1 });
        return;
      }
      if (!d.pkg) {
        blind.push({ file: rel, line: i + 1, claimed: d.claimed });
        return;
      }
      claims.push({ file: rel, line: i + 1, pkg: d.pkg, claimed: d.claimed, pkgFrom: d.pkgFrom });
    });
  }
  return { claims, unparsed, blind };
}

// ── 豁免台账（形态照 archaeology-exempt.json 的 exemptAnchors）──
// 两条硬校验（任一不成立即 exit 2，宁可失声不假绿）：
//   ① anchor 在 file 内必须恰好命中 1 行；
//   ② anchor 解析出的行必须当前仍是「值声称」命中行（债一变，锚必须重新核对）。
function loadExempt() {
  if (!fs.existsSync(EXEMPT_FILE)) {
    return { entries: [], errors: [`豁免台账缺失：${path.relative(ROOT, EXEMPT_FILE)}`] };
  }
  let j;
  try {
    j = JSON.parse(fs.readFileSync(EXEMPT_FILE, 'utf8'));
  } catch (e) {
    return { entries: [], errors: [`豁免台账 JSON 解析失败：${e.message}`] };
  }
  const entries = [];
  const errors = [];
  for (const a of (j.exemptAnchors || [])) {
    const fp = path.join(ROOT, a.file);
    let text;
    try {
      text = fs.readFileSync(fp, 'utf8');
    } catch {
      errors.push(`锚所在文件不可读：${a.file}`);
      continue;
    }
    const lines = text.split('\n');
    const idx = [];
    for (let i = 0; i < lines.length; i++) if (lines[i].includes(a.anchor)) idx.push(i + 1);
    if (idx.length === 0) {
      errors.push(`锚失效：${a.file} 内「${a.anchor}」命中 0 处（被豁免的声称已变——A-5 可能已落地，锚须重新核对）`);
      continue;
    }
    if (idx.length > 1) {
      errors.push(`锚不唯一：${a.file} 内「${a.anchor}」命中 ${idx.length} 处（要求恰好 1）`);
      continue;
    }
    const d = detectClaim(lines[idx[0] - 1]);
    if (!d || !d.claimed) {
      errors.push(`锚失效：${a.file}:${idx[0]} 当前不再是命中行（A-5 可能已落地——锚须重新核对）`);
      continue;
    }
    entries.push({
      file: a.file, line: idx[0], anchor: a.anchor,
      reason: a.reason || '', pkg: d.pkg, claimed: d.claimed,
    });
  }
  return { entries, errors };
}

// ── registry 真值 ─────────────────────────────────────────
function parseTags(out) {
  try { return JSON.parse(out); } catch { /* 落到宽松解析 */ }
  const m = out.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* 放弃 */ } }
  return null;
}

function fetchLatest(pkg) {
  for (let i = 0; i < REGISTRY_ATTEMPTS; i++) {
    try {
      const out = execFileSync('npm', ['view', pkg, 'dist-tags', '--prefer-online', '--json'], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: REGISTRY_TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const j = parseTags(out);
      if (j && typeof j === 'object' && typeof j.latest === 'string') return { ok: true, latest: j.latest };
    } catch { /* 重试 */ }
  }
  return { ok: false };
}

// ── 自检 ──────────────────────────────────────────────────
function runSelftest() {
  console.log('🧪 check-npm-claims 自检（合成样本 + 规则负例）');
  let bad = 0;
  const chk = (name, cond) => {
    if (cond) console.log(`  ✓ ${name}`);
    else { console.error(`  ❌ ${name}`); bad++; }
  };
  const s1 = detectClaim("实测 `npm view @sofagent/audit dist-tags` 当前为 `{ latest: '1.5.0' }`");
  chk('正例：dist-tags 值声称被检出（pkg + latest）', !!s1 && s1.pkg === '@sofagent/audit' && s1.claimed === '1.5.0');
  const s2 = detectClaim('npm view @sofagent/audit version   # 查版本命令提示');
  chk('负例：无 dist-tags 的命令提示不误判', s2 === null);
  const s3 = detectClaim('npm view @sofagent/audit dist-tags --prefer-online');
  chk('负例：含 dist-tags 但无值 → 待解析（pkg 有 / claimed 无）', !!s3 && s3.pkg === '@sofagent/audit' && s3.claimed === null);
  const s4 = detectClaim('纯文本行，无 npm view');
  chk('负例：无关行不误判', s4 === null);
  chk('存活性：检测器自检样本命中', detectorSelfCheck());
  const s5 = detectClaim("当前 `sofagent` 的 dist-tags 为 `{ latest: '1.6.0' }`");
  chk('正例②：无 npm view 的「dist-tags 当前为」形态（回退行内被引用包名）', !!s5 && s5.pkg === 'sofagent' && s5.claimed === '1.6.0');
  const s6 = detectClaim("`npm view @sofagent/audit dist-tags` → `{ latest: '1.5.1' }`");
  chk('正例③：英文「→」形态同样命中', !!s6 && s6.pkg === '@sofagent/audit' && s6.claimed === '1.5.1');
  const s7 = detectClaim("当前 dist-tags 为 `{ latest: '1.6.0' }`");
  chk('盲例：有值无包名 ⇒ 归盲区（pkg null / claimed 有）', !!s7 && s7.pkg === null && s7.claimed === '1.6.0');
  if (bad > 0) {
    console.error(`❌ 自检失败 ${bad} 项`);
    process.exit(1);
  }
  console.log('✅ 自检通过（8/8）');
  process.exit(0);
}

// ── 主流程 ────────────────────────────────────────────────
function main() {
  if (SELFTEST) return runSelftest();

  console.log('🔍 npm 实测声称对账（文档声称值 × registry 在线真值）');
  console.log('════════════════════════════════════════════════════════════');

  if (!detectorSelfCheck()) {
    console.error('❌ 检测器失明：合成样本未被检出（正则失效）——拒绝假绿');
    console.log(`[check:coverage] script=${SCRIPT_NAME} asserts=0 covered=0 skipped=0`);
    process.exit(2);
  }

  const files = collectLiveDocs();
  if (files.length === 0) {
    console.error('❌ 扫描面为空（活文档面 0 文件）——目录重组或遍历失效，拒绝假绿');
    console.log(`[check:coverage] script=${SCRIPT_NAME} asserts=0 covered=0 skipped=0`);
    process.exit(2);
  }

  const { claims, unparsed, blind } = scanClaims(files);
  const { entries: exempt, errors: exemptErrors } = loadExempt();
  if (exemptErrors.length > 0) {
    console.error('❌ 豁免台账校验失败（锚不唯一 / 锚失效 / 文件不可读 / JSON 解析错误）：');
    for (const e of exemptErrors) console.error(`    · ${e}`);
    console.log(`[check:coverage] script=${SCRIPT_NAME} asserts=0 covered=${files.length} skipped=0`);
    process.exit(2);
  }

  if (blind.length > 0) {
    console.error('❌ 无法判定包名的值声称（dist-tags 有值但行内无包名）——请显式写 `npm view <pkg> dist-tags`：');
    for (const b of blind) console.error(`    · ${b.file}:${b.line} 声称 latest=${b.claimed}`);
    console.log(`[check:coverage] script=${SCRIPT_NAME} asserts=0 covered=${files.length} skipped=0`);
    process.exit(2);
  }

  const exemptKeys = new Set(exempt.map((e) => `${e.file}:${e.line}`));
  const pending = claims.filter((c) => !exemptKeys.has(`${c.file}:${c.line}`));
  const asserts = claims.length;
  let skipped = unparsed.length;

  console.log(`  扫描面：${files.length} 个 .md（根 README 双语 + docs/ 非 changelog 区）`);
  console.log(`  引擎：检测器自检 ${detectorSelfCheck() ? '✓ 命中样本' : '✗ 失明'}`);
  console.log(`  声称：${claims.length} 条 · 豁免 ${exempt.length} 条 · 待验 ${pending.length} 条`);
  console.log(`  dist-tags 候选行 = 值声称 ${claims.length} + 无值跳过 ${unparsed.length} + 盲区 ${blind.length}`);
  console.log('');

  for (const e of exempt) {
    console.log(`  ⏭️ 豁免 ${e.file}:${e.line} 「${e.pkg}」声称 latest=${e.claimed} —— ${e.reason}`);
  }
  for (const u of unparsed) {
    console.log(`  ⚠️ 跳过 ${u.file}:${u.line} 含 dist-tags 但无 latest 值（命令提示 / 策略叙述，非值声称）`);
  }

  // registry 真值（仅对待验声称涉及的去重包名取一次）
  const pkgs = [...new Set(pending.map((c) => c.pkg))];
  const truth = {};
  let registryDown = false;
  for (const pkg of pkgs) {
    const r = fetchLatest(pkg);
    if (r.ok) truth[pkg] = r.latest;
    else registryDown = true;
  }

  if (pending.length > 0 && registryDown && Object.keys(truth).length === 0) {
    console.log('');
    console.log('  ⏭️ SKIP：registry 不可达（离线 / 无网络）——环境限制 ≠ 产品缺陷，显式跳过不假绿');
    console.log(`[check:coverage] script=${SCRIPT_NAME} asserts=${asserts} covered=${files.length} skipped=${skipped + pending.length}`);
    console.log('✅ 未发现可判定的失配（SKIP 可见）');
    process.exit(0);
  }

  console.log('');
  let fails = 0;
  for (const c of pending) {
    if (!(c.pkg in truth)) {
      console.log(`  ⏭️ SKIP ${c.file}:${c.line} 「${c.pkg}」registry 真值不可得`);
      skipped++;
      continue;
    }
    if (c.claimed === truth[c.pkg]) {
      console.log(`  ✓ ${c.file}:${c.line} 「${c.pkg}」声称 latest=${c.claimed} = registry 真值`);
    } else {
      console.log(`  ❌ ${c.file}:${c.line} 失配：文档声称值 latest=${c.claimed} / registry 真值 latest=${truth[c.pkg]}「${c.pkg}」`);
      fails++;
    }
  }

  if (LIST_EXEMPT) {
    console.log('');
    console.log('──── 豁免放行明细（--list-exempt）────');
    for (const e of exempt) console.log(`  [exempt] ${e.file}:${e.line} 「${e.pkg}」latest=${e.claimed} —— ${e.reason}`);
  }

  console.log('');
  console.log(`[check:coverage] script=${SCRIPT_NAME} asserts=${asserts} covered=${files.length} skipped=${skipped}`);
  if (fails > 0) {
    console.error(`❌ ${fails} 条声称与 registry 真值失配——改文档为真值，或登记进 npm-claims-exempt.json 并写理由`);
    process.exit(1);
  }
  console.log('✅ 全部声称与 registry 真值一致（或已登记豁免 / 显式 SKIP）');
  process.exit(0);
}

main();
