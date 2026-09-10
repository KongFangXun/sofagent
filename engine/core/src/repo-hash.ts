// ============================================================
// repo-hash.ts · 仓库标识 hash（运行时审计 repo-hash 隔离）
// ============================================================
//
// 语义逐条对齐 FORGE/src/audit-middleware.mjs computeRepoHash：
//   1. 优先 `git rev-parse --show-toplevel`（仓库根路径）→ sha256 前 12 位；
//   2. 非 git 目录 / git 不可用 / 超时 → 'nogit-' + sha256(cwd) 前 12 位
//      （避免所有非 git 运行混到同一个目录）；
//   3. 3s 超时（execSync timeout 超时抛错，走 catch 回退）；
//   4. 静默降级不刷屏——非 git 是正常 fallback 非错误，每次审计日志
//      写入都会走到这里，warn 会随每条工具调用刷屏；真异常（git 已装
//      但 rev-parse 报错）由上层写入失败告警兜底。
//
// 缓存：模块级 per-cwd Map——llm-calls.jsonl 每次模型调用都解析路径，
// execSync 高频不可接受；cwd → 仓库根在进程生命周期内稳定，缓存安全。
// 显式注入 execFn（测试用）时绕过缓存，保证 fake 注入零污染。
// ============================================================

import { execSync } from 'child_process';
import { createHash } from 'crypto';

/**
 * 仓库标识 hash 目录名形态：
 * git 仓 = 12 位 hex；非 git 回退 = nogit-<12 位 hex>
 */
export const REPO_HASH_PATTERN = /^(?:[0-9a-f]{12}|nogit-[0-9a-f]{12})$/;

/** exec 函数形态（测试注入 fake 用——签名对齐 execSync 子集） */
export type RepoHashExecFn = (
  command: string,
  opts: { cwd: string; encoding: 'utf-8'; stdio: ['ignore', 'pipe', 'ignore']; timeout: number },
) => string;

/** 进程内缓存（cwd → repo-hash）——git 根进程内稳定 */
const repoHashCache = new Map<string, string>();

/** nogit 回退 hash：'nogit-' + sha256(cwd) 前 12 位 */
function nogitHash(cwd: string): string {
  return 'nogit-' + createHash('sha256').update(cwd).digest('hex').slice(0, 12);
}

/**
 * 计算 git 仓库标识 hash——运行时审计日志（llm-calls.jsonl /
 * data-sovereignty 日志）按仓库隔离的目录段。
 *
 * @param cwd 工作目录（默认 process.cwd()）
 * @param execFn 可注入 exec（测试 fake；缺省 execSync）
 * @returns 12 位 hex（git 仓）或 'nogit-' + 12 位 hex（非 git 回退）
 */
export function computeRepoHash(cwd = process.cwd(), execFn?: RepoHashExecFn): string {
  // 注入 execFn 的调用（测试）不读不写缓存——保证 fake 零污染
  if (execFn === undefined && repoHashCache.has(cwd)) {
    return repoHashCache.get(cwd)!;
  }

  let hash: string;
  try {
    const exec = execFn ?? ((cmd: string, opts: Parameters<RepoHashExecFn>[1]) =>
      execSync(cmd, opts) as string);
    const root = exec('git rev-parse --show-toplevel', {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim();
    hash = root
      ? createHash('sha256').update(root).digest('hex').slice(0, 12)
      : nogitHash(cwd);
  } catch {
    // 有意静默：非 git 目录 / git 不可用 / 超时均为正常 fallback（非错误）
    hash = nogitHash(cwd);
  }

  if (execFn === undefined) {
    repoHashCache.set(cwd, hash);
  }
  return hash;
}

/** 清空进程内缓存（测试辅助——生产代码不应调用） */
export function clearRepoHashCache(): void {
  repoHashCache.clear();
}
