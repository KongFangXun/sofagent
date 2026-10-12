#!/usr/bin/env node
// ============================================================
// check-sdk-waiver-progress.mjs · SDK-face 白名单清偿进度读数（v1.5.9 第 2 步）
// ============================================================
// 为什么必须单列一件：`check-unwired-exports.sh` 的 SDK-face 白名单自审只在
// **到期态**（目标版本 ≤ 当前 SSOT）才报红，而开发期内 SSOT（package.json.version）
// = 1.5.8 < 目标 1.5.9 ⇒ **到期判据恒假**，47 条债务的「清偿进度」在门禁输出里
// **完全不可见**（`--since` 的「豁免」计数对 47 旧符号恒为 0——它们注册于
// v1.5.8 之前，永不进 --since 管道，实测 `--since v1.5.8` 从第 1 组摘到第 7 组
// 都是同一组读数）。⇒ 清偿过程需要一件**对开发期也生效**的机械读数。
//
// 本件职责（唯一）：把「v1.5.9 到期条目数 / 已摘除数」两个值从
// `check-unwired-exports.sh` 的 `SDK_FACE_WAIVER` 赋值串里**精确**读出来。
// 判据不放松、不改动任何白名单条目——只读。
//
// 🔴 正则必须容忍尾随的 `"`：47 条里最后一条 `succeedEvalSet:...:v1.5.9"`
//    的闭合引号落在**末条**上（赋值串跨 154–205 行）。写成 `:v1\.5\.9$` 只会
//    数到 46，漏掉最后一条——故本件按「逐行取末段 = 目标版本」解析，不靠行尾锚。
//
// 判据同源：与任务书第 2 步的
//   awk '/^SDK_FACE_WAIVER=/,/^"$/' tools/check/check-unwired-exports.sh \
//     | grep -cE ':v1\.5\.9"?$'
// 同为「v1.5.9 到期条目」计数；本件额外把「已摘除数」算出来（= 登记基线 − 现存）。
//
// 用法：
//   node tools/check/check-sdk-waiver-progress.mjs                # 读数（exit 0）
//   node tools/check/check-sdk-waiver-progress.mjs --require-zero # 未清零即 exit 1（发版闸门用）
//   node tools/check/check-sdk-waiver-progress.mjs --json         # 机器可读
//
// 退出码：0=读数成功（未加 --require-zero 时恒退出 0）/ 1=--require-zero 且未清零 /
//         2=解析失败（白名单串读不到，拒绝静默假读）。
// ============================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const WAIVER_SH = resolve(REPO_ROOT, 'tools/check/check-unwired-exports.sh');

// v1.5.8 进化模块批登记基线（7 组 47 符号 · 目标版本 v1.5.9）——
// 见 check-unwired-exports.sh 的 SDK_FACE_WAIVER 块头注释。清偿进度 = 基线 − 现存。
const V159_REGISTERED_TOTAL = 47;
const DUE_VERSION = 'v1.5.9';
// 备案（本版不转红、不处置）：另有 5 条 v1.6.0 到期项。读数里单列，防误判为漏项。
const FUTURE_VERSIONS = new Set(['v1.6.0']);

/** 提取 SDK_FACE_WAIVER="…" 的赋值串内容（多行；容忍末条尾随引号）。 */
function extractWaiverEntries(src) {
  const lines = src.split('\n');
  const startIdx = lines.findIndex((l) => /^SDK_FACE_WAIVER="/.test(l));
  if (startIdx === -1) return null;
  const entries = [];
  // 第一行：剥掉 `SDK_FACE_WAIVER="` 前缀
  let first = lines[startIdx].replace(/^SDK_FACE_WAIVER="/, '');
  if (first.endsWith('"')) {
    entries.push(first.slice(0, -1));
    return entries;
  }
  entries.push(first);
  for (let j = startIdx + 1; j < lines.length; j++) {
    const l = lines[j];
    if (l.endsWith('"')) {
      entries.push(l.slice(0, -1));
      return entries;
    }
    entries.push(l);
  }
  return null; // 未找到闭合引号 ⇒ 串被截断，拒绝静默假读
}

/** 解析单条白名单条目（格式 符号:reason:目标版本，reason 内禁冒号）。 */
function parseEntry(raw) {
  const entry = raw.trim();
  if (entry === '') return null;
  const parts = entry.split(':');
  if (parts.length < 3) return { sym: parts[0], target: null };
  const sym = parts[0];
  const target = parts[parts.length - 1].trim();
  return { sym, target };
}

function main() {
  const args = process.argv.slice(2);
  const requireZero = args.includes('--require-zero');
  const asJson = args.includes('--json');

  let src;
  try {
    src = readFileSync(WAIVER_SH, 'utf8');
  } catch (err) {
    process.stderr.write(`✗ 读不到白名单门禁脚本 ${WAIVER_SH}：${err.message}\n`);
    process.exit(2);
  }

  const rawEntries = extractWaiverEntries(src);
  if (rawEntries === null) {
    process.stderr.write(
      '✗ 解析失败：SDK_FACE_WAIVER 赋值串读不到/未闭合——拒绝把解析故障伪装成「已清零」\n',
    );
    process.exit(2);
  }

  let due = 0;
  let future = 0;
  const dueSymbols = [];
  const futureSymbols = [];
  const malformed = [];
  for (const raw of rawEntries) {
    const e = parseEntry(raw);
    if (!e) continue;
    if (e.target === null) {
      malformed.push(e.sym);
      continue;
    }
    if (e.target === DUE_VERSION) {
      due += 1;
      dueSymbols.push(e.sym);
    } else if (FUTURE_VERSIONS.has(e.target)) {
      future += 1;
      futureSymbols.push(e.sym);
    }
  }

  if (malformed.length > 0) {
    process.stderr.write(
      `✗ 解析失败：${malformed.length} 条缺目标版本（格式 符号:reason:目标版本）：${malformed.join(', ')}\n`,
    );
    process.exit(2);
  }

  const removed = V159_REGISTERED_TOTAL - due;

  if (asJson) {
    process.stdout.write(
      JSON.stringify(
        {
          dueVersion: DUE_VERSION,
          due,
          removed,
          baseline: V159_REGISTERED_TOTAL,
          futureDue: future,
          futureVersions: [...FUTURE_VERSIONS],
          dueSymbols,
          futureSymbols,
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    process.stdout.write(
      `SDK-face 清偿进度：${DUE_VERSION} 到期条目数 / 已摘除数 = ${due} / ${removed}（登记基线 ${V159_REGISTERED_TOTAL}）\n`,
    );
    process.stdout.write(
      `  备案（本版不转红、不处置）：${future} 条未来版本到期（${[...FUTURE_VERSIONS].join('/')}）——勿误判为漏项\n`,
    );
    if (due > 0) {
      process.stdout.write(
        `  待清偿 ${due} 条：${dueSymbols.join(', ')}\n`,
      );
    } else {
      process.stdout.write(`  ✅ ${DUE_VERSION} 到期债务已全部清偿（0 条剩余）\n`);
    }
  }

  if (due > V159_REGISTERED_TOTAL) {
    process.stderr.write(
      `✗ 异常：现存到期条目（${due}）多于登记基线（${V159_REGISTERED_TOTAL}）——白名单被新增了 ${DUE_VERSION} 条目？\n`,
    );
    process.exit(2);
  }

  if (requireZero && due > 0) {
    process.stderr.write(`✗ --require-zero：仍有 ${due} 条 ${DUE_VERSION} 到期债务未清偿\n`);
    process.exit(1);
  }
  process.exit(0);
}

main();
