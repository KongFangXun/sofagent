#!/usr/bin/env node
// ============================================================
// check-home-resolution-parity.mjs · 家目录解析口径对照共享守卫（v1.4.9 G-9）
// ============================================================
// 用法: node tools/check/check-home-resolution-parity.mjs
//
// ── 为什么需要这条守卫（「被迫重复 ≠ 允许不可见」）──────────────
// `tools/check/dependency-direction.yml` 把 `harness` 定为 **layer 0 · allow: []**
// （仓内唯一不允许 import 任何 @sofagent 包的包）⇒ harness **不能** import core 的
// `resolveHomeDir`，只能在 `engine/inject/src/index.ts` 本地**重实现**一份
// `resolveEngineHome()`。重复是被依赖方向**逼出来的**，但「被迫重复」不等于
// 「允许两处口径悄悄漂移」——P1-4（写侧落 {SOFAGENT_HOME}/skill/custom、读侧只扫
// 项目级）就是口径漂移的实案。本守卫让**两处口径的差集可见且被钉住**。
//
// ── 两侧怎么探（都不靠静态推断）─────────────────────────────
// core 侧：真实 `require(engine/core/dist/data-paths.js)` 调 `resolveHomeDir()`。
//          （每次调用实时读 `process.env.SOFAGENT_HOME` ⇒ 可在同进程逐行改 env 测矩阵。）
// harness 侧：`resolveEngineHome()` **未导出**（harness 的公开面只有
//          `buildConstrainedSystemPrompt`）⇒ 用**可观测效果**反推：种子
//          `<home>/skill/custom/<name>-overrides.md` 里的哨兵串是否出现在
//          `buildConstrainedSystemPrompt()` 输出中（该函数 `:221` 用
//          `path.join(resolveEngineHome(), 'skill', 'custom')` 读用户级规则）。
//          三份候选家目录（`$HOME/.sofagent` / env 指向 / cwd 相对）各带**不同哨兵**，
//          故 4 路可判别（命中 A / 命中 B / 命中 HOME / 命中相对）。
//          子进程跑且 `HOME` 与 `cwd` 受控 ⇒ **绝不读写真实 `~/.sofagent`**。
//
// ── 判定（三条硬规则，全部 fail-loud）────────────────────────
//   ① 任一侧实现**提取不到**（源码形态变了 / dist 未构建）⇒ FAIL（守卫失明，拒绝假绿）
//   ② 任一行 harness 侧**观测不到**（哨兵一个都没命中）⇒ FAIL（两侧都取不到，不许静默）
//   ③ 除**已登记差异**外，同输入必须同输出（路径行按 `path.resolve` 归一后比对，
//      故「带尾斜杠」只是字符串层不同、语义层相同 ⇒ 判一致并注明）
//
// ── 已登记差异（DIFF_REGISTRY：差异**消失**也判红）────────────────
// 登记差异不是「批准差异」，是「钉住现状 + 强制可见」：任何一侧被改动导致差异消失，
// 本守卫立刻报红并要求同步本表 —— 目的是让「统一」成为一个**显式动作**（配套架构裁定），
// 而不是某次重构的副产品。
//
// 退出码: 0 = 口径与登记表一致 / 1 = 有未登记差异或守卫失明
// ============================================================

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '../..');
const CORE_DIST = path.join(ROOT, 'engine/core/dist/data-paths.js');
const HARNESS_DIST = path.join(ROOT, 'engine/inject/dist/index.js');
const CORE_SRC = path.join(ROOT, 'engine/core/src/data-paths.ts');
const HARNESS_SRC = path.join(ROOT, 'engine/inject/src/index.ts');

const fail = [];
const JUDGED = [];
// 已判定的矩阵行数（供 coverage 行使用）。⚠️ 必须在 `ROWS` 声明**之前**初始化：
// 守卫失明自检会在 `ROWS` 之前提前 exit，若 emitCoverage 直接引用 `ROWS`
// 会抛 TDZ ReferenceError——那样「失明拒绝假绿」就变成一句崩溃堆栈，
// 正是本守卫要防的「报错难读」。（本守卫第一版踩过，注入 I2a 当场暴露。）
let ROWS_JUDGED = 0;
function judge(ok, id, detail) {
  JUDGED.push({ id, ok });
  if (!ok) fail.push(`❌ ${id}：${detail}`);
  return ok;
}

// ── ① 守卫失明自检：两侧实现必须都能提取到 ─────────────────────
function extractBody(file, anchorRe, span = 12) {
  if (!fs.existsSync(file)) return null;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const i = lines.findIndex((l) => anchorRe.test(l));
  if (i < 0) return null;
  return lines.slice(i, i + span).join('\n');
}

const coreBody = extractBody(CORE_SRC, /^export function resolveHomeDir\(/);
const harnessBody = extractBody(HARNESS_SRC, /^function resolveEngineHome\(\)/);

judge(
  coreBody !== null && coreBody.includes('SOFAGENT_HOME'),
  'extract/core',
  '提取不到 core/src/data-paths.ts 的 resolveHomeDir（源码形态变了？守卫可能已失明）',
);
judge(
  harnessBody !== null && harnessBody.includes('SOFAGENT_HOME'),
  'extract/harness',
  '提取不到 harness/src/index.ts 的 resolveEngineHome（源码形态变了？守卫可能已失明）',
);
judge(
  fs.existsSync(CORE_DIST),
  'dist/core',
  `缺 ${path.relative(ROOT, CORE_DIST)} ⇒ harness/core 侧无法真实调用（先 npm run build）`,
);
judge(
  fs.existsSync(HARNESS_DIST),
  'dist/harness',
  `缺 ${path.relative(ROOT, HARNESS_DIST)} ⇒ harness 侧无法真实调用（先 npm run build）`,
);

if (fail.length > 0) {
  for (const f of fail) console.error(f);
  console.error('⇒ 守卫失明，拒绝在此状态下给出「口径一致」结论。');
  emitCoverage();
  process.exit(1);
}

// ── 沙箱（全部落在 mkdtemp 临时目录；HOME 与 cwd 受控 ⇒ 不碰真实 ~/.sofagent）──
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-homeparity-'));
const USER_HOME = path.join(SANDBOX, 'userhome'); // 扮演 $HOME
const ENV_HOME = path.join(SANDBOX, 'envhome'); // env 指向（绝对路径）
const REL_PROJ = path.join(SANDBOX, 'relproj'); // cwd 相对行的 cwd
const PROJ = path.join(SANDBOX, 'proj'); // 被测项目根（项目级 custom 留空）
const OUTSIDE = path.join(os.tmpdir(), 'sofagent-homeparity-outside'); // 越界（不在 $HOME 前缀内）

const MARK = { ENV: 'MARK_ENV_9a1', USERHOME: 'MARK_USERHOME_9b2', REL: 'MARK_REL_9c3' };

function seedSkillCustom(home, mark) {
  fs.mkdirSync(path.join(home, 'skill', 'custom'), { recursive: true });
  fs.writeFileSync(path.join(home, 'skill', 'custom', 'parity-overrides.md'), mark + '\n');
}
seedSkillCustom(ENV_HOME, MARK.ENV);
// ⚠️ 回落目标是 `$HOME/.sofagent`（不是 `$HOME`）——哨兵必须种在**回落家目录**下，
//    否则 unset/empty 两行会「观测不到」而误报失明（本行曾踩过：种错一层 ⇒ 2 行假红）。
seedSkillCustom(path.join(USER_HOME, '.sofagent'), MARK.USERHOME);
seedSkillCustom(REL_PROJ, MARK.REL); // 相对行：'<cwd>/skill/custom'
fs.mkdirSync(path.join(PROJ, '.sofagent', 'custom'), { recursive: true }); // 项目级留空（不干扰）
fs.mkdirSync(OUTSIDE, { recursive: true });
seedSkillCustom(OUTSIDE, MARK.ENV); // 越界行也用 ENV 哨兵（观测「是否真读了越界目录」）

const USER_HOME_FALLBACK = path.join(USER_HOME, '.sofagent');

// ── 探针子进程（**两侧都在同一个受控 $HOME / cwd 里跑**）──────────
// 🔴 为什么不把 core 侧放在守卫主进程里：core 的**回落值**是模块加载期快照
//    （`const SOFAGENT_HOME = sanitizeSofagentHome(env)`），主进程的 `$HOME` 是真实的
//    ⇒ 主进程算 core、子进程算 harness，`unset` 行会拿「真实 ~/.sofagent」去比
//    「受控 $HOME/.sofagent」而假红（本守卫第一版就是这么错的）。两侧同进程同 env ⇒ 可比。
// 另：必须 **先 require 再改 env**——老 env 若指向越界路径，core 的 sanitize 会在
//    加载期直接抛（exitCode 3）而让本守卫自身崩掉。
const CHILD = path.join(SANDBOX, 'probe-child.mjs');
fs.writeFileSync(
  CHILD,
  `import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const CORE = ${JSON.stringify(CORE_DIST)};
const HARNESS = ${JSON.stringify(HARNESS_DIST)};
const PROJ = ${JSON.stringify(PROJ)};
const M = ${JSON.stringify(MARK)};
const UNSET = '__UNSET__';

const core = require(CORE);            // 先加载（模块常量按「未设」快照，避免越界抛错）
const { buildConstrainedSystemPrompt } = require(HARNESS);

const raw = process.argv[2];
if (raw === UNSET) delete process.env.SOFAGENT_HOME;
else process.env.SOFAGENT_HOME = raw;

const coreOut = core.resolveHomeDir();                       // 每次调用实时读 env
const out = buildConstrainedSystemPrompt(PROJ);              // 经 resolveEngineHome() 读用户级 custom
const hit = Object.entries(M).find(([, v]) => out.includes(v));
process.stdout.write(JSON.stringify({ coreOut, hit: hit ? hit[0] : null }));
`,
);

const UNSET = '__UNSET__';

/**
 * 在一个受控 $HOME + cwd 的子进程里，同时取 core 与 harness 两边的结果。
 * @returns {{ coreOut: string, harnessOut: string|null }}
 *   `harnessOut === null` ⇒ 哨兵一个都没命中 = **观测不到**（规则 ② 判红，不许静默）
 */
function probe(inputHome, cwd) {
  const env = { ...process.env, HOME: USER_HOME };
  const arg = inputHome === undefined ? UNSET : String(inputHome);
  const stdout = execFileSync(process.execPath, [CHILD, arg], {
    env,
    cwd,
    encoding: 'utf-8',
    timeout: 60_000,
  });
  const { coreOut, hit } = JSON.parse(stdout);
  let harnessOut = null;
  if (hit === 'ENV') harnessOut = inputHome; // 命中 env 指向目录（原样返回）
  else if (hit === 'USERHOME') harnessOut = USER_HOME_FALLBACK; // 回落 $HOME/.sofagent
  else if (hit === 'REL') harnessOut = inputHome; // 相对路径原样返回（读取落在 cwd 下）
  return { coreOut, harnessOut };
}

// ── 差异登记表（差异**消失**同样判红——统一必须是显式动作）────────
const DIFF_REGISTRY = {
  empty: {
    label: '空串 `SOFAGENT_HOME=`',
    why:
      'core.resolveHomeDir 用 `??`（只拦 null/undefined）⇒ 空串被**原样返回**，家目录解析成 `""`' +
      '（falsy ⇒ 下游拼接退化成 cwd 相对路径）；harness 用 `fromEnv !== undefined && fromEnv !== \'\'` ' +
      '⇒ 显式拦空串并回落 `$HOME/.sofagent`。**同一输入、两个不同家目录**——这正是本守卫要钉住的差集。',
    coreExpect: '',
    harnessExpect: () => USER_HOME_FALLBACK,
  },
};

// ── 口径对照矩阵 ───────────────────────────────────────────
// kind: 'same' = 必须一致（路径行按 path.resolve 归一）；'diff' = 已登记差异
const ROWS = [
  { id: 'unset', label: '未设（undefined）', input: undefined, kind: 'same', cwd: PROJ },
  { id: 'empty', label: '空串 ""', input: '', kind: 'diff', cwd: PROJ },
  { id: 'abs', label: '绝对路径（$HOME 前缀内）', input: ENV_HOME, kind: 'same', cwd: PROJ },
  { id: 'abs-trailing', label: '带尾斜杠', input: ENV_HOME + path.sep, kind: 'same', cwd: PROJ },
  { id: 'relative', label: '相对路径 "."', input: '.', kind: 'same', cwd: REL_PROJ },
  { id: 'out-of-prefix', label: '越界绝对路径（不在 $HOME 前缀内）', input: OUTSIDE, kind: 'same', cwd: PROJ },
];

console.log('── 家目录解析口径对照（core.resolveHomeDir ↔ harness.resolveEngineHome）──');
console.log(`   沙箱 ${SANDBOX}`);
console.log(`   $HOME(受控) = ${USER_HOME}`);
console.log('');
console.log('   行 | core 侧实得 | harness 侧实得（哨兵反推）| 判定');
console.log('   ---|-------------|--------------------------------|------');
ROWS_JUDGED = ROWS.length;

for (const row of ROWS) {
  const { coreOut, harnessOut } = probe(row.input, row.cwd);

  // 规则 ②：harness 观测不到 ⇒ 不许静默（哪怕 core 侧看起来正常）
  if (harnessOut === null) {
    judge(false, `row/${row.id}`, `harness 侧观测不到任何哨兵（两侧都取不到 ⇒ 守卫不能给结论）`);
    console.log(`   ${row.id} | \`${String(coreOut)}\` | (观测不到) | ❌ FAIL`);
    continue;
  }

  if (row.kind === 'same') {
    const a = path.resolve(coreOut || '.');
    const b = path.resolve(harnessOut || '.');
    const ok = a === b;
    judge(ok, `row/${row.id}`, `同输入不同输出：core=\`${coreOut}\` / harness=\`${harnessOut}\``);
    const note = coreOut !== harnessOut ? '（字符串层不同、语义层相同——已归一比对）' : '';
    console.log(`   ${row.id} | \`${coreOut}\` | \`${harnessOut}\` | ${ok ? '✅' : '❌ FAIL'} ${note}`);
  } else {
    const reg = DIFF_REGISTRY[row.id];
    const expCore = reg.coreExpect;
    const expHarness = reg.harnessExpect();
    const ok =
      String(coreOut) === String(expCore) &&
      path.resolve(harnessOut) === path.resolve(expHarness);
    judge(
      ok,
      `row/${row.id}`,
      `已登记差异的形状变了（core 期望 \`${expCore}\` 实得 \`${coreOut}\`；` +
        `harness 期望 \`${expHarness}\` 实得 \`${harnessOut}\`）——**若两处已统一，请同步更新 DIFF_REGISTRY**`,
    );
    console.log(`   ${row.id} | \`${coreOut}\` | \`${harnessOut}\` | ${ok ? '✅ 已登记差异' : '❌ FAIL'}`);
  }
}

// ── 差异登记表完整性：每条都要有可读理由 + 必须仍在矩阵里 ──────────
for (const [id, reg] of Object.entries(DIFF_REGISTRY)) {
  judge(
    ROWS.some((r) => r.id === id && r.kind === 'diff'),
    `registry/${id}`,
    'DIFF_REGISTRY 里的条目在矩阵中找不到对应的 diff 行（登记表与矩阵脱钩）',
  );
  judge(
    typeof reg.why === 'string' && reg.why.length >= 30,
    `registry/${id}/why`,
    '登记差异必须写明「为什么不同」（≥30 字）——没有理由的差异等于没登记',
  );
}

// ── 已登记差异可见打印（不阻断，但必须每跑必现）───────────────
console.log('');
console.log('── 已登记差异（钉住现状，待架构裁定；差异消失会判红）──');
for (const [id, reg] of Object.entries(DIFF_REGISTRY)) {
  console.log(`   ⚠️ ${id} · ${reg.label}`);
  console.log(`      ${reg.why}`);
}

// ── 附注：两条调用路径**都不经** core 的越界消毒（可见但不阻断）────
console.log('');
console.log('── 附注（非阻断，登记为已知面）──');
console.log(
  `   ℹ️ 越界路径（如 \`${path.relative(os.tmpdir(), OUTSIDE)}\`）在 \`resolveHomeDir()\` 与 ` +
    '`resolveEngineHome()` **两条路径上都不做消毒**；core 的 `sanitizeSofagentHome`（模块常量面）' +
    '才会 fail-loud（exitCode 3）。⇒ 这两条路径的越界**只影响读**，但读的是「约束链注入源」，' +
    '故登记于此供审查。',
);

// ── 汇总 ─────────────────────────────────────────────────
const passed = JUDGED.filter((j) => j.ok).length;
const total = JUDGED.length;
console.log('');
if (fail.length > 0) {
  for (const f of fail) console.error(f);
  console.error(`❌ 家目录口径对照 FAIL：${passed}/${total} 项通过，${fail.length} 项不通过`);
  emitCoverage();
  process.exit(1);
}
console.log(`✓ 家目录口径对照通过：${passed}/${total} 项（矩阵 ${ROWS.length} 行 + 登记表完整性）`);
console.log('   说明：比对的是**真实调用结果**（core 侧 require dist；harness 侧哨兵反推），非静态推断。');
emitCoverage();
process.exit(0);

function emitCoverage() {
  // 与 tools/check/lib/coverage-line.sh 同格式同语义（asserts/covered/skipped）
  console.log(
    `[check:coverage] script=check-home-resolution-parity asserts=${JUDGED.length} covered=${ROWS_JUDGED} skipped=0`,
  );
}
