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
//        pkg 解析优先级：npm view 形态的包名 > scoped 包名 @sofagent/<name> >
//        裸名 sofagent。优先 scoped 是为防散文词 sofagent 劫持同行的
//        @sofagent/audit 归属；裸名不接 . / - 字母数字（故 sofagent.config.yml、
//        sofagent/config.yml 这类文件名/路径不认、mysofagent / sofagent-cli
//        也不认），避免把文件名或近似词当包名产生误报。
//     ② 无 latest 值 ⇒ 命令提示 / 策略叙述，非值声称（可见跳过）
//     ③ 有 latest 值但解析不出包名 ⇒ 盲区（不可判定 ⇒ main 判 exit 2，拒绝假绿）
//
// 值形态的识别面（覆盖常见书写变体——「写法一变换就静默漏检」是假门禁）：
//   key 可带引号（"latest" / 'latest' / latest），但 key 前不接 / 或 -（排除 URL
//   路径 .../latest: 与 not-latest 这类非声称位）；分隔符可 ASCII 冒号、全角冒号
//   或中文「为」；值前导可带引号·反引号·花括号·等号，且**须形如 数字.数字**
//   （至少一段小数点分隔——据此排除 latest: 2024 这类「是数字但不是版本」的
//   误报），值可带引号可不带引号；值尾的 ASCII 句点会被剥掉（防「无引号值 +
//   句末句号」误红）。
//
// ── 明示的残余盲区（诚实披露，勿当已覆盖）──
//   · 值与其 dist-tags 上下文**分处两行**（逐行判定，不做跨行合并）不检出；
//   · 无冒号也无「为」的散文式表述（如 latest 指向 2.0）不检出。
//   · 文档引用的包名在 registry 上不存在（E404）判 **exit 1**——「包不存在」不是
//     「环境限制」，不得混入离线 SKIP 通道产出误导性绿。
//
// 真值来源：npm view <pkg> dist-tags --prefer-online（≥3 轮重试；超时走
//   Node child_process 的 timeout 选项——macOS 无 timeout 命令，故不用它）。
//
// 三态退出码（对齐 check 系家族）：
//   0 = 全部通过（可含可见 SKIP：registry 不可达）
//   1 = 文档声称值与 registry 真值失配（含文档引用了 registry 上不存在的包名）
//   2 = 检查器失明 / 豁免台账非法 / 存在无法判定包名的值声称——拒绝假绿
//
// 已知债豁免：tools/check/npm-claims-exempt.json（形态照 archaeology-exempt.json
//   的 exemptAnchors：{file, anchor, reason}）。三条硬校验（任一不成立即 exit 2）：
//   ① anchor 在文件内唯一；② 锚行当前仍是值声称命中行（债一变即过期）；
//   ③ reason 须能说清「为何现在不能改为真值」（空理由 / 占位词一律拒绝）。
//   本表设计为**可清空**——当前为空即「无豁免债」的正常态；新增一条必须能在理由栏
//   说清为何不能直接改成真值，否则不进本表（能改的直接改，那才是真绿）。
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
const PKG_SCOPED_RE = /@sofagent\/[a-z0-9][a-z0-9-]*/;
const PKG_BARE_RE = /(?<![\w/@.-])sofagent(?![-\w./])/;
const LATEST_RE = /(?<![/\w-])["']?\blatest\b["']?\s*(?:[:：]|为)[\s`"'={]*v?([0-9][0-9A-Za-z+_-]*\.[0-9][0-9A-Za-z.+_-]*)/;

function detectClaim(line) {
  // F-13（B1 收口）：钉扎版本声称形态——`@sofagent/xxx@1.2.3`（npm 装机语义的
  // 版本钉扎是可对账值声称；撤策后 dist-tags 值形态被有意从文档摘除，本形态
  // 保证门禁 asserts 恒 ≥ 文档真实钉扎数——防「修文档顺带摘钩子」再空转）。
  const mpv = line.match(/@(sofagent(?:\/[a-z0-9-]+)?)@v?([0-9]+\.[0-9]+\.[0-9]+)/);
  if (mpv) {
    const pkg = mpv[1] === 'sofagent' ? 'sofagent' : '@' + mpv[1];
    return { pkg, claimed: mpv[2], pkgFrom: 'pinned' };
  }
  if (!line.includes('dist-tags')) return null;
  const ml = line.match(LATEST_RE);
  if (!ml) {
    const mp = line.match(PKG_RE);
    return { pkg: mp ? mp[1] : null, claimed: null, pkgFrom: mp ? 'npm-view' : null };
  }
  const mp = line.match(PKG_RE);
  const ms = mp ? null : line.match(PKG_SCOPED_RE);
  const mb = (mp || ms) ? null : line.match(PKG_BARE_RE);
  return {
    pkg: mp ? mp[1] : (ms ? ms[0] : (mb ? mb[0] : null)),
    claimed: ml[1].replace(/\.+$/, ''),
    pkgFrom: mp ? 'npm-view' : (ms ? 'scoped' : (mb ? 'bare' : null)),
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
        if (rel === 'docs/archive') continue; // 历史冻结区（pinned 旧版是当时真值——F-13 扫描面修正）
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
// 三条硬校验（任一不成立即 exit 2，宁可失声不假绿）：
//   ① anchor 在 file 内必须恰好命中 1 行；
//   ② anchor 解析出的行必须当前仍是「值声称」命中行（债一变，锚必须重新核对）；
//   ③ reason 必须能说清「为何现在不能改为真值」——空理由/占位词等于给门禁开一个无法审计的口子。
const REASON_MIN_LEN = 10;
const REASON_PLACEHOLDER = /(TODO|TBD|FIXME|待补|占位)/i;

function validateReason(reason) {
  const r = String(reason == null ? '' : reason).trim();
  if (r.length < REASON_MIN_LEN) {
    return `reason 为空或过短（${r.length} < ${REASON_MIN_LEN} 字）——须写清「为何现在不能改为真值」`;
  }
  if (REASON_PLACEHOLDER.test(r)) {
    return `reason 含占位词（「${r}」）——请写实质理由`;
  }
  return null;
}

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
    const reasonErr = validateReason(a.reason);
    if (reasonErr) {
      errors.push(`豁免理由不可用：${a.file} 的「${a.anchor}」${reasonErr}`);
      continue;
    }
    entries.push({
      file: a.file, line: idx[0], anchor: a.anchor,
      reason: String(a.reason).trim(), pkg: d.pkg, claimed: d.claimed,
    });
  }
  return { entries, errors };
}

// ── registry 真值 ─────────────────────────────────────────
function parseTags(out) {
  // registry 输出非纯 JSON 时降级到下面的宽松正则解析；两条失败路径都有显式兜底
  // （最终返回 null → 上游判「真值不可得」并可见 SKIP），故静默是安全的。
  try { return JSON.parse(out); } catch { /* 为何可静默：落到宽松解析，兜底见上 */ }
  const m = out.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* 为何可静默：放弃→null，兜底见上 */ } }
  return null;
}

function fetchLatest(pkg) {
  let sawNotFound = false;
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
    } catch (e) {
      // E404 = registry 上无此包（文档引用了不存在的包名）——这不是环境限制，
      // 不得混入离线 SKIP 通道产出误导性绿；记下后交 main 判 exit 1。
      const msg = String((e && e.stderr) || (e && e.message) || '');
      if (/E404|404 Not Found/.test(msg)) sawNotFound = true;
    }
  }
  return sawNotFound ? { ok: false, notFound: true } : { ok: false };
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
  const s8 = detectClaim('当前 `sofagent` 的 dist-tags 为 `{"latest":"9.9.9"}`');
  chk('变体①：JSON 双引号 key、无空格 检出', !!s8 && s8.claimed === '9.9.9');
  const s9 = detectClaim('当前 `sofagent` 的 dist-tags 为 latest: 9.9.9');
  chk('变体②：值不带引号 检出', !!s9 && s9.claimed === '9.9.9');
  const s10 = detectClaim("当前 `sofagent` 的 dist-tags 为 `{ latest：'9.9.9' }`");
  chk('变体③：全角冒号 检出', !!s10 && s10.claimed === '9.9.9');
  const s11 = detectClaim("当前 `sofagent` 的 dist-tags 如下：latest 为 `9.9.9`");
  chk('变体④：中文「为」分隔 检出', !!s11 && s11.claimed === '9.9.9');
  const s12 = detectClaim("在 sofagent 生态中，`@sofagent/audit` 的 dist-tags 当前为 `{ latest: '9.9.9' }`");
  chk('归属②：scoped 包名优先于散文词 sofagent（防归属劫持）', !!s12 && s12.pkg === '@sofagent/audit');
  const s13 = detectClaim("编辑 sofagent.config.yml 后，dist-tags 当前为 `{ latest: '1.5.0' }`");
  chk('归属③：文件名 sofagent.config.yml 不当包名（→ 盲区）', !!s13 && s13.pkg === null && s13.claimed === '1.5.0');
  const s14 = detectClaim("当前 `mysofagent` 的 dist-tags 为 `{ latest: '1.0.0' }`");
  chk('归属④：近似词 mysofagent 不当包名（→ 盲区）', !!s14 && s14.pkg === null && s14.claimed === '1.0.0');
  const s15 = detectClaim("当前 `sofagent` 的 dist-tags 通道路线图，latest: 2024 年规划");
  chk('误报回归①：latest: 2024（是数字但非版本）不认为值声称', !!s15 && s15.claimed === null);
  const s16 = detectClaim("当前 `sofagent` 的 dist-tags 参考 https://example.com/latest: 9.9.9 说明");
  chk('误报回归②：URL 路径内的 latest: 9.9.9 不认为值声称', !!s16 && s16.claimed === null);
  const s17 = detectClaim("编辑 sofagent/config.yml 后，dist-tags 当前为 `{ latest: '1.5.0' }`");
  chk('误报回归③：路径 sofagent/config.yml 不当包名（→ 盲区）', !!s17 && s17.pkg === null && s17.claimed === '1.5.0');
  const s18 = detectClaim("当前 `sofagent` 的 dist-tags 为 `{ latest: 'v1.5.1' }`");
  chk('漏检回归：带 v 前缀的版本值去掉 v 后仍识别', !!s18 && s18.claimed === '1.5.1');
  const s19 = detectClaim('当前 `sofagent` 的 dist-tags 为 latest: 1.5.1.');
  chk('误报回归④：无引号值 + 句末英文句点 剥尾点后仍识别', !!s19 && s19.claimed === '1.5.1');
  const r1 = validateReason('npm 通道策略待拍板，声称暂不改为最新真值，拍板后锚即过期');
  chk('豁免理由①：实质理由通过（返回 null）', r1 === null);
  const r2 = validateReason('');
  chk('豁免理由②：空理由被拒（返回错误串）', typeof r2 === 'string');
  const r3 = validateReason('    ');
  chk('豁免理由③：纯空白被拒（返回错误串）', typeof r3 === 'string');
  const r4 = validateReason('TODO');
  chk('豁免理由④：占位词被拒（返回错误串）', typeof r4 === 'string');
  const r5 = validateReason('该声称已登记待补，具体原因略');
  chk('豁免理由⑤：占位词「待补」即使长度够也被拒', typeof r5 === 'string');
  if (bad > 0) {
    console.error(`❌ 自检失败 ${bad} 项`);
    process.exit(1);
  }
  console.log('✅ 自检通过（25/25）');
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
  const notFound = new Set();
  let registryDown = false;
  for (const pkg of pkgs) {
    const r = fetchLatest(pkg);
    if (r.ok) truth[pkg] = r.latest;
    else if (r.notFound) notFound.add(pkg);
    else registryDown = true;
  }

  if (pending.length > 0 && registryDown && Object.keys(truth).length === 0 && notFound.size === 0) {
    console.log('');
    console.log('  ⏭️ SKIP：registry 不可达（离线 / 无网络）——环境限制 ≠ 产品缺陷，显式跳过不假绿');
    console.log(`[check:coverage] script=${SCRIPT_NAME} asserts=${asserts} covered=${files.length} skipped=${skipped + pending.length}`);
    console.log('✅ 未发现可判定的失配（SKIP 可见）');
    process.exit(0);
  }

  console.log('');
  let fails = 0;
  for (const c of pending) {
    if (notFound.has(c.pkg)) {
      console.log(`  ❌ ${c.file}:${c.line} 「${c.pkg}」registry 无此包（E404）——文档引用了不存在的包名，非环境限制`);
      fails++;
      continue;
    }
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
