#!/usr/bin/env node
// ============================================================
// check-standards.mjs · 家族标准层一致性（standards/ 唯一源 ↔ 各仓产物）
// ============================================================
// 事故（R1）：建仓 24 小时内 changelog 模板已分叉两处——rsi 那份被 markdown
//   formatter 重排（表格对齐符 / 行尾空格），changelog/README 写死仓数（三仓写
//   「四仓」、rsi 写「五仓」）。四份手抄副本，没有任何东西告诉人「漂了」。
//
// 判据式（R2，对应 standards/README 的 S1 / S2）：
//   S1 源唯一：除 standards/ 与 manifest 登记的落点外，全家族不得出现第三份同名模板；
//              且 standards/ 下每个分发文件都必须在 manifest 登记（漏登 = 分发面空白）
//   S2 只由机器写：每个登记落点与源逐字节相等（不等即被人手改过）
//
// 处置（R8 第三列）：
//   非有意 → 用源覆盖：cp standards/<路径> <仓>/<路径>
//   有意   → 先改源（standards/ 下），再重渲染全部落点，同批提交
//
// 扫描面（诚实披露，R3）：只扫主仓 + manifest.repos 列出的仓。不做全盘 find——
//   全家族根目录还有其他项目，扫进去既不相关也不稳定。
//   主仓将来自己纳入标准时，把 "sofagent" 加进 manifest.repos 即可，无需改代码。
//
// 用法：
//   node tools/check/check-standards.mjs              # 默认家族根 = 主仓的上一级
//   node tools/check/check-standards.mjs --root DIR   # 指定家族根
//   node tools/check/check-standards.mjs --quiet      # 只输出结论行
//   node tools/check/check-standards.mjs --selftest   # 自检（正向 + 负向四例）
//   node tools/check/check-standards.mjs --version | --help
//
// 退出码：0 绿 / 1 有漂移 / 2 自身失明（源或仓不可得、manifest 坏）
// ============================================================
import { readFileSync, existsSync, readdirSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const VERSION = 'v1.0.0';
const MAIN = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const SKIP_DIRS = new Set(['node_modules', '.git', '.sofagent', '.workbuddy']);

const HELP = `check-standards.mjs ${VERSION} — 家族标准层一致性
用法: node tools/check/check-standards.mjs [--root DIR] [--quiet] [--selftest] [--version] [--help]
判据: S1 源唯一（无第三份副本 + 源文件全部登记）· S2 落点与源逐字节相等
退出: 0 绿 / 1 漂移 / 2 自身失明
`;

class Blind extends Error {}

function readManifest(mainRoot) {
  const p = join(mainRoot, 'standards', '_manifest.json');
  if (!existsSync(p)) throw new Blind(`manifest 不可得：${p}`);
  let m;
  try { m = JSON.parse(readFileSync(p, 'utf8')); } catch (e) { throw new Blind(`manifest 非法 JSON：${e.message}`); }
  const okRepos = Array.isArray(m.repos) && m.repos.length > 0 && m.repos.every((r) => typeof r === 'string' && r);
  const okFiles = Array.isArray(m.files) && m.files.length > 0 && m.files.every((f) => typeof f === 'string' && f);
  if (!okRepos || !okFiles) throw new Blind('manifest 形态不合规：repos / files 须为非空字符串数组');
  return m;
}

function walk(dir, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(join(dir, e.name), out);
    } else out.push(join(dir, e.name));
  }
  return out;
}

// 核心：给定主仓与家族根，返回违规清单（纯函数，selftest 直接调用）
function check(mainRoot, familyRoot) {
  const m = readManifest(mainRoot);
  const srcRoot = join(mainRoot, 'standards');
  const v = [];

  for (const repo of m.repos) {
    if (!existsSync(join(familyRoot, repo))) throw new Blind(`仓不可得：${join(familyRoot, repo)}`);
  }
  const registered = new Set(m.repos.flatMap((r) => m.files.map((f) => `${r}:${f}`)));

  // S2：逐落点比字节
  let compared = 0;
  for (const f of m.files) {
    const src = join(srcRoot, f);
    if (!existsSync(src)) throw new Blind(`源不可得：${src}`);
    const a = readFileSync(src);
    for (const repo of m.repos) {
      const tgt = join(familyRoot, repo, f);
      if (!existsSync(tgt)) { v.push(`S2 缺落点 ${repo}/${f}（源有、该仓没有）`); continue; }
      compared++;
      if (!a.equals(readFileSync(tgt))) v.push(`S2 与源不一致 ${repo}/${f}（人手改过，或源改了没重渲染）`);
    }
  }

  // S1a：源里的分发文件必须全部登记
  for (const p of walk(srcRoot, [])) {
    const rel = relative(srcRoot, p).split('\\').join('/');
    if (rel === 'README.md' || rel === '_manifest.json') continue;
    if (!m.files.includes(rel)) v.push(`S1 源文件未登记 ${rel}（分发面漏登，不会被渲染到任何仓）`);
  }

  // S1b：不得出现第三份同名模板
  const govRoots = [mainRoot, ...m.repos.map((r) => join(familyRoot, r))];
  let scanned = 0;
  for (const root of govRoots) {
    if (!existsSync(root)) continue;
    for (const p of walk(root, [])) {
      // 只认「独立模板文件」：basename 必须整体形如 _TEMPLATE.md / _TEMPLATE.xx.md。
      // 不能按后缀匹配——.github/ISSUE_TEMPLATE.md 会被后缀误判成模板（实测假红 2 处）。
      const base = p.slice(p.lastIndexOf('/') + 1);
      if (!/^_TEMPLATE(\.[a-z-]+)?\.md$/.test(base)) continue;
      scanned++;
      const rel = relative(root, p).split('\\').join('/');
      if (root === mainRoot && rel.startsWith('standards/')) continue;
      const repo = relative(familyRoot, root).split('\\').join('/');
      if (registered.has(`${repo}:${rel}`)) continue;
      v.push(`S1 发现第三份副本 ${repo}/${rel}（不在 manifest 登记面内）`);
    }
  }
  return { v, compared, scanned, repos: m.repos.length, files: m.files.length };
}

// ── 自检：正向一例 + 负向三例（R6 要求负向必在）──
function selftest() {
  const tmp = mkdtempSync(join(tmpdir(), 'std-'));
  // 夹具形态与实物一致：家族根下主仓与各仓平级，不是同一层
  const mk = (root) => {
    const main = join(root, 'sofagent');
    mkdirSync(join(main, 'standards', 'changelog'), { recursive: true });
    mkdirSync(join(root, 'repoA', 'changelog'), { recursive: true });
    writeFileSync(join(main, 'standards', '_manifest.json'),
      JSON.stringify({ repos: ['repoA'], files: ['changelog/_TEMPLATE.md'] }));
    writeFileSync(join(main, 'standards', 'changelog', '_TEMPLATE.md'), 'HELLO\n');
    writeFileSync(join(root, 'repoA', 'changelog', '_TEMPLATE.md'), 'HELLO\n');
  };
  const cases = [];
  const run = (name, mutate, want) => {
    const root = join(tmp, name);
    mk(root);
    mutate(root);
    let got;
    try { got = check(join(root, 'sofagent'), root).v.length; } catch (e) { got = `ERR:${e.message}`; }
    const ok = want === '>0' ? (typeof got === 'number' && got > 0) : got === want;
    cases.push({ name, want, got, ok });
  };
  run('positive-同源同落点-应绿', () => {}, 0);
  run('negative-改一字节-应红',
    (r) => writeFileSync(join(r, 'repoA', 'changelog', '_TEMPLATE.md'), 'HELLO!\n'), '>0');
  run('negative-删落点-应红', (r) => rmSync(join(r, 'repoA', 'changelog', '_TEMPLATE.md')), '>0');
  run('negative-第三份副本-应红', (r) => writeFileSync(join(r, 'repoA', 'changelog', '_TEMPLATE.copy.md'), ''),
    '>0');
  run('negative-源未登记-应红', (r) => {
    writeFileSync(join(r, 'sofagent', 'standards', 'changelog', 'EXTRA.md'), 'x');
  }, '>0');
  rmSync(tmp, { recursive: true, force: true });
  let bad = 0;
  for (const c of cases) {
    console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}（期望 ${c.want} · 实得 ${c.got}）`);
    if (!c.ok) bad++;
  }
  console.log(bad === 0 ? '  --selftest: 5/5 符合预期' : `  --selftest: ${bad} 例不符合预期`);
  return bad === 0 ? 0 : 1;
}

// ── CLI ──
const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) { process.stdout.write(HELP); process.exit(0); }
if (argv.includes('--version')) { console.log(`check-standards.mjs ${VERSION}`); process.exit(0); }
if (argv.includes('--selftest')) process.exit(selftest());

const quiet = argv.includes('--quiet');
const ri = argv.indexOf('--root');
const si = argv.indexOf('--sofagent');
// --sofagent <主仓路径>：从主仓路径反推家族根（上一级），供在任意 cwd 自助接线
// familyRoot 三级解析：CLI --family > CLI --sofagent/.. > env SOFAGENT_FAMILY_ROOT > MAIN/..
// env 级为 worktree 场景设（MAIN/.. 在 worktree 下指向 Worktrees 目录、家族仓不在彼）；
// 主仓根运行时 MAIN/.. 保持缺省正确。缺省不可得时脚本自身 exit 2 fail-loud（不假绿）。
const familyRoot = ri >= 0 && argv[ri + 1] ? resolve(argv[ri + 1])
  : si >= 0 && argv[si + 1] ? resolve(argv[si + 1], '..')
  : process.env.SOFAGENT_FAMILY_ROOT ? resolve(process.env.SOFAGENT_FAMILY_ROOT)
  : resolve(MAIN, '..');

const BLIND_USAGE = '用法：check-standards.mjs --sofagent <家族主仓路径>（或于主仓根运行）';
try {
  const r = check(MAIN, familyRoot);
  if (!quiet) {
    console.log(`  扫描面：主仓 + ${r.repos} 仓 · ${r.files} 源文件 · 比对 ${r.compared} 落点 · 模板候选 ${r.scanned}`);
  }
  if (r.v.length) {
    for (const x of r.v) console.error(`  ❌ ${x}`);
    console.error(`  漂移 ${r.v.length} 处。处置：非有意→用源覆盖；有意→先改源再重渲染全部落点。`);
    process.exit(1);
  }
  console.log(`  ✓ 标准层一致：${r.files} 源 / ${r.compared} 落点逐字节相等，无第三份副本`);
  process.exit(0);
} catch (e) {
  if (e instanceof Blind) { console.error(`  ❌ 失明：${e.message}`); console.error(`  ${BLIND_USAGE}`); process.exit(2); }
  console.error(`  ❌ 失明：未预期异常 ${e.message}`); console.error(`  ${BLIND_USAGE}`); process.exit(2);
}
