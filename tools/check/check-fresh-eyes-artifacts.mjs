#!/usr/bin/env node
// ============================================================
// check-fresh-eyes-artifacts.mjs · fresh-eyes 产物契约守闸
// 对应协议：FORGE/SKILL/fresh-eyes-loop/loop.md「执行形态」节（harness 注入形态）
//
// 定位：编排者「判定停止条件」的等价机械面——
//   循环状态全在 runs/ 文件里（文件即状态），本脚本对给定 runDir 校验
//   产物契约（存在性 + schema + 计数一致性）。排障工具，非 CI 门禁。
//
// 校验项（fail-closed，违反项逐条列出）：
//   1. runDir 目录名匹配 run-NN 且存在
//   2. status.md 单行现态：`round-NN · <phase> · P0=<n>/P1=<n>`
//      （phase ∈ reviewing|fixing|verifying|done）
//   3. 至少一个 round-NN 子目录，且含 status 声明的最高轮
//   4. 最高轮 findings.md 存在且非空
//   5. 计数一致性：最高轮 findings.md 的 P0/P1 token 计数 == status.md 声明值
//   6. result.md 条件必需：最高轮 findings 含 P0 或 P1 ⇒ result.md 存在且非空
//   7. verdict.md 条件必需：phase=done ⇒ verdict.md 存在且非空
//
// 用法：
//   node tools/check/check-fresh-eyes-artifacts.mjs --runDir <path>
//   node tools/check/check-fresh-eyes-artifacts.mjs --self-test
//
// 退出码：0 = 契约满足 · 1 = 契约违反 · 2 = 用法错误
// ============================================================

import fs from 'fs';
import os from 'os';
import path from 'path';

const STATUS_RE = /^round-(\d+) · (reviewing|fixing|verifying|done) · P0=(\d+)\/P1=(\d+)$/;
const RUN_DIR_RE = /^run-\d{2,}$/;

/** 非空文件判定：存在且 trim 后长度 > 0 */
function isNonEmptyFile(p) {
  if (!fs.existsSync(p)) return false;
  const st = fs.statSync(p);
  if (!st.isFile()) return false;
  return fs.readFileSync(p, 'utf8').trim().length > 0;
}

/** 统计文本内 P0/P1 token 出现次数（词边界） */
function countPriority(text) {
  return {
    p0: (text.match(/\bP0\b/g) || []).length,
    p1: (text.match(/\bP1\b/g) || []).length,
  };
}

/** 核心校验：返回违反项字符串数组（空数组 = 契约满足） */
export function validateRunDir(runDir) {
  const failures = [];
  const base = path.basename(runDir);

  if (!RUN_DIR_RE.test(base)) {
    failures.push(`runDir 目录名须匹配 run-NN，实为「${base}」`);
    return failures;
  }
  if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
    failures.push(`runDir 不存在或不是目录：${runDir}`);
    return failures;
  }

  const statusPath = path.join(runDir, 'status.md');
  if (!isNonEmptyFile(statusPath)) {
    failures.push('status.md 缺失或为空——现态锚是断点续跑与外部监督的唯一依据（文件即状态纪律）');
    return failures;
  }
  const statusLine = fs.readFileSync(statusPath, 'utf8').trim().split('\n')[0].trim();
  const m = STATUS_RE.exec(statusLine);
  if (!m) {
    failures.push(`status.md 首行不符合现态格式「round-NN · <phase> · P0=<n>/P1=<n>」（phase ∈ reviewing|fixing|verifying|done）：「${statusLine}」`);
    return failures;
  }
  const declaredRound = Number(m[1]);
  const phase = m[2];
  const declaredP0 = Number(m[3]);
  const declaredP1 = Number(m[4]);

  const roundDirs = fs.readdirSync(runDir).filter((n) => /^round-\d{2,}$/.test(n)).sort();
  if (roundDirs.length === 0) {
    failures.push('runDir 内零 round-NN 子目录——至少一个审查轮的产物必须在盘');
    return failures;
  }

  const latestName = `round-${String(declaredRound).padStart(2, '0')}`;
  if (!roundDirs.includes(latestName)) {
    failures.push(`status.md 声明 round-${declaredRound}，但 runDir 内无对应目录 ${latestName}（现态与产物脱节）`);
    return failures;
  }
  const latestDir = path.join(runDir, latestName);

  const findingsPath = path.join(latestDir, 'findings.md');
  if (!isNonEmptyFile(findingsPath)) {
    failures.push(`${latestName}/findings.md 缺失或为空——每轮必须落盘统一问题清单（产物 Schema）`);
    return failures;
  }
  const findingsText = fs.readFileSync(findingsPath, 'utf8');
  const actual = countPriority(findingsText);
  if (actual.p0 !== declaredP0 || actual.p1 !== declaredP1) {
    failures.push(`计数不一致（硬事实）：status.md 声明 P0=${declaredP0}/P1=${declaredP1}，${latestName}/findings.md 实测 P0=${actual.p0}/P1=${actual.p1}`);
  }

  if (declaredP0 > 0 || declaredP1 > 0) {
    const resultPath = path.join(latestDir, 'result.md');
    if (!isNonEmptyFile(resultPath)) {
      failures.push(`${latestName} 存在 P0/P1 但 result.md 缺失或为空——修复指令（精确路径 + 期望行为）必须落盘给修复角色`);
    }
  }

  if (phase === 'done' && !isNonEmptyFile(path.join(runDir, 'verdict.md'))) {
    failures.push('status phase=done 但 verdict.md 缺失或为空——终态判定必须落盘（收口可核）');
  }

  return failures;
}

// ── 自检：正反探针（门禁必须测失败路径——只跑正常路径是假绿温床）──────
function runSelfTest() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sfea-selftest-'));
  const probes = [];
  const expect = (label, failures, wantPass) => {
    const pass = wantPass ? failures.length === 0 : failures.length > 0;
    probes.push({ label, pass, detail: pass ? '' : `wantPass=${wantPass} got=${JSON.stringify(failures)}` });
  };

  // 正向夹具：合法 run（round-01，P0=1/P1=1，result 在位，未 done）
  const runDir = path.join(tmpRoot, 'run-01');
  const r1 = path.join(runDir, 'round-01');
  fs.mkdirSync(r1, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'status.md'), 'round-01 · verifying · P0=1/P1=1\n', 'utf8');
  fs.writeFileSync(path.join(r1, 'findings.md'), '- 视角1 / src/a.ts:12 / 示例 P0 问题\n- 视角2 / src/b.ts:3 / 示例 P1 问题\n', 'utf8');
  fs.writeFileSync(path.join(r1, 'result.md'), '- src/a.ts:12 → 删除越界写入\n- src/b.ts:3 → 补判空\n', 'utf8');
  expect('正向：合法 run 契约满足', validateRunDir(runDir), true);

  // 反探针 1：status.md 缺失
  fs.rmSync(path.join(runDir, 'status.md'));
  expect('反探针1：status.md 缺失判红', validateRunDir(runDir), false);
  fs.writeFileSync(path.join(runDir, 'status.md'), 'round-01 · verifying · P0=1/P1=1\n', 'utf8');

  // 反探针 2：计数不一致（status 声明 P0=2，findings 实有 1）
  fs.writeFileSync(path.join(runDir, 'status.md'), 'round-01 · verifying · P0=2/P1=1\n', 'utf8');
  expect('反探针2：P0 计数与 findings 不符判红', validateRunDir(runDir), false);
  fs.writeFileSync(path.join(runDir, 'status.md'), 'round-01 · verifying · P0=1/P1=1\n', 'utf8');

  // 反探针 3：有 P0/P1 但 result.md 缺失
  fs.rmSync(path.join(r1, 'result.md'));
  expect('反探针3：P0/P1 在而修复指令缺失判红', validateRunDir(runDir), false);
  fs.writeFileSync(path.join(r1, 'result.md'), '- src/a.ts:12 → 删除越界写入\n- src/b.ts:3 → 补判空\n', 'utf8');

  // 反探针 4：phase=done 而 verdict.md 缺失
  fs.writeFileSync(path.join(runDir, 'status.md'), 'round-01 · done · P0=1/P1=1\n', 'utf8');
  expect('反探针4：done 无 verdict 判红', validateRunDir(runDir), false);
  fs.writeFileSync(path.join(runDir, 'status.md'), 'round-01 · verifying · P0=1/P1=1\n', 'utf8');

  // 反探针 5：status 格式非法
  const badRun = path.join(tmpRoot, 'runX');
  fs.mkdirSync(badRun, { recursive: true });
  fs.writeFileSync(path.join(badRun, 'status.md'), '随便写的\n', 'utf8');
  expect('反探针5：runDir 名与 status 格式双非法判红', validateRunDir(badRun), false);

  // 反探针 6：done 且 verdict 在位 → 正向收口形态
  fs.writeFileSync(path.join(runDir, 'verdict.md'), '终态：无 P0/P1 残留\n', 'utf8');
  fs.writeFileSync(path.join(runDir, 'status.md'), 'round-01 · done · P0=1/P1=1\n', 'utf8');
  expect('正向：done + verdict 在位契约满足', validateRunDir(runDir), true);

  let failed = 0;
  for (const p of probes) {
    if (p.pass) console.log(`  ✓ ${p.label}`);
    else { console.error(`  ❌ ${p.label}——${p.detail}`); failed += 1; }
  }

  let cleanupErr = null;
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch (e) {
    // 清理失败不掩盖探针结论，但必须可见（shim 环境可能拦截 rmSync）
    cleanupErr = e instanceof Error ? e.message : String(e);
  }
  if (cleanupErr) console.warn(`  ⚠️ 自检夹具清理失败（不影响判定）：${cleanupErr}`);

  if (failed > 0) {
    console.error(`❌ 自检 ${failed}/${probes.length} 探针未过——校验器自身失效`);
    return 1;
  }
  console.log(`✓ 产物契约校验器自检全过（${probes.length} 探针：2 正向 + 5 反向）`);
  return 0;
}

// ── CLI 入口 ───────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.includes('--self-test')) {
  process.exit(runSelfTest());
}
const runDirIdx = args.indexOf('--runDir');
const runDirArg = runDirIdx >= 0 ? args[runDirIdx + 1] : null;
if (!runDirArg) {
  console.error('用法：node tools/check/check-fresh-eyes-artifacts.mjs --runDir <path> | --self-test');
  process.exit(2);
}
const runDir = path.resolve(runDirArg);
const failures = validateRunDir(runDir);
if (failures.length === 0) {
  console.log(`✓ 产物契约满足：${runDir}`);
  process.exit(0);
}
for (const f of failures) console.error(`  ❌ ${f}`);
console.error(`❌ 产物契约违反 ${failures.length} 项：${runDir}`);
process.exit(1);
