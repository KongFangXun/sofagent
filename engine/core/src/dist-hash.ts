// ============================================================
// dist-hash.ts · dist 多入口聚合哈希（信任锚计算单一 TS 实现）
// ============================================================
// 用途：为「影子审计器防线」（P1-A2）计算 engine/audit/dist 的**多入口聚合哈希**
//   ——单文件 index.js 哈希覆盖不到 cli-quick.js / agent-shield.js 等独立入口
//   （实测从 index.js 出发可达 17 个模块，均不含它们），故聚合全部 dist/**/*.js。
//
// 🔴 算法与 `engine/audit/hooks/commit-msg` 内联的 bash 版**逐字一致**（该内联版不可
//   删：hook 必须在**不执行任何被审仓代码**的前提下自证，故自带实现）。
//   两处一致性由 `engine/core/src/__tests__/dist-hash.test.ts` 的**同结果断言**守护
//   ——同一 dist 下 TS 版输出 == hook 内联版输出，任一处漂移即红。
//
// 算法（逐字）：
//   walk dist/**/*.js → 相对路径（posix 分隔）排序（字符串序）→ 每项 `${rel}\0${sha256(内容)}`
//   → `\u0001` 连接 → sha256 → hex。
//   dist 不存在或为空 → null（调用方须按「算不出 ≠ 一致」处理，禁静默放行）。
// ============================================================

import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * 计算 dist 目录的多入口聚合哈希。
 * @param distRoot dist 目录绝对路径
 * @returns 64 位 hex 聚合哈希；dist 不存在 / 非目录 / 无 .js 文件时返回 null
 */
export function computeDistAggregateHash(distRoot: string): string | null {
  let isDir = false;
  try {
    isDir = statSync(distRoot).isDirectory();
  } catch {
    /* 不存在 → 返回 null（与内联版 process.exit(0) 同义） */
  }
  if (!isDir) return null;

  const out: string[] = [];
  (function walk(d: string): void {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith('.js')) out.push(p);
    }
  })(distRoot);

  if (out.length === 0) return null;

  const inputs = out
    .map((f) => ({ rel: relative(distRoot, f).split(sep).join('/'), abs: f }))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
    .map((f) => `${f.rel}\u0000${createHash('sha256').update(readFileSync(f.abs)).digest('hex')}`);

  return createHash('sha256').update(inputs.join('\u0001'), 'utf8').digest('hex');
}

/**
 * 解析**全局安装**的 `@sofagent/audit` 的 dist 目录（v1.5.4 #14）。
 * 与 `engine/audit/hooks/commit-msg` 的全局分支**同源解析**：只走显式全局根
 * （execPath 推导 `lib/node_modules` + `npm root -g`），**不走 PATH**、不含被审仓
 * node_modules（防投放冒牌包）。解析不到 → null。
 */
export function resolveGlobalAuditDistRoot(): string | null {
  try {
    const out = execFileSync(
      'node',
      [
        '-e',
        [
          "const p=require('path');let e=null;",
          "const r=[p.resolve(p.dirname(process.execPath),'..','lib','node_modules')];",
          "try{r.push(require('child_process').execSync('npm root -g',{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim())}catch(x){}",
          "for(const q of r){try{e=require.resolve('@sofagent/audit',{paths:[q]});break}catch(x){}}",
          "if(e)process.stdout.write(p.join(p.dirname(p.dirname(e)),'dist'))",
        ].join(''),
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    return out || null;
  } catch {
    return null;
  }
}
