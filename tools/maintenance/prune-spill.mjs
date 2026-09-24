#!/usr/bin/env node
/**
 * v1.5.2 修复 P1-10：spill 临时文件回收（docs/LIMITATIONS.md「>5MB diff 残余缝隙」披露的落盘残留）。
 *
 * spill 目录中的 diff-*.diff（engine/core/src/diff-parser.ts spillDiffToLines 产出，
 * 可能含密钥类 diff 内容）在 git 成功路径上永久保留（仅失败时清理），长期运行无界增长。
 * 本脚本按 mtime 回收超期文件：默认保留 30 天，SOFAGENT_SPILL_TTL_DAYS 可覆盖。
 *
 * 目录解析与引擎 getDataDir() 同链（见 diff-parser.ts resolveSpillDir 注释）：
 * 显式 --dir > SOFAGENT_DATA/data > SOFAGENT_HOME/data > ~/.sofagent/data，恒拼 spill 子目录。
 *
 * 用法：node tools/maintenance/prune-spill.mjs [--dir <spill 目录>]
 * 输出：deleted N file(s) / kept M file(s)；目录不存在时提示并 exit 0（无目录 = 无残留）。
 */
import { readdirSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const dirFlag = args.indexOf('--dir');
const explicit = dirFlag !== -1 ? args[dirFlag + 1] : undefined;
const spillDir = explicit
  ?? (process.env.SOFAGENT_DATA ? join(process.env.SOFAGENT_DATA, 'spill') : undefined)
  ?? (process.env.SOFAGENT_HOME ? join(process.env.SOFAGENT_HOME, 'data', 'spill') : undefined)
  ?? join(homedir(), '.sofagent', 'data', 'spill');

const ttlDaysRaw = Number.parseInt(process.env.SOFAGENT_SPILL_TTL_DAYS ?? '30', 10);
const ttlDays = Number.isFinite(ttlDaysRaw) && ttlDaysRaw >= 0 ? ttlDaysRaw : 30;
const cutoffMs = Date.now() - ttlDays * 24 * 60 * 60 * 1000;

let entries;
try {
  entries = readdirSync(spillDir);
} catch (err) {
  if (err?.code === 'ENOENT') {
    console.log(`[sofagent] spill 目录不存在（${spillDir}）——无残留可回收`);
    process.exit(0);
  }
  // fail-closed（对齐引擎学说）：目录读不了 ≠ 无残留——报告后以非零退出，不伪装成功
  console.error(`[sofagent] ⚠️ 无法读取 spill 目录 ${spillDir}（${err?.message ?? err}）`);
  process.exit(1);
}

let deleted = 0;
let kept = 0;
for (const name of entries) {
  // 只回收引擎 spill 命名（diff-parser.ts：diff-<sha256 前 16 位>.diff），不碰其他文件
  if (!/^diff-[0-9a-f]{16}\.diff$/.test(name)) continue;
  const fullPath = join(spillDir, name);
  try {
    if (statSync(fullPath).mtimeMs <= cutoffMs) {
      rmSync(fullPath, { force: true });
      deleted++;
    } else {
      kept++;
    }
  } catch (err) {
    // 为何可跳过：单个文件 stat/rm 失败不掩盖其余文件回收，也不掩盖脚本整体结果——计入 kept 留待下次
    console.error(`[sofagent] ⚠️ 跳过 ${name}（${err?.message ?? err}）`);
    kept++;
  }
}

console.log(`deleted ${deleted} file(s) / kept ${kept} file(s)`);
