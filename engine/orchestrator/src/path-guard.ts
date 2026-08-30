// ============================================================
// path-guard.ts · LLM 产出路径的统一守卫原语
// ============================================================
//
// 定位：凡是「路径字符串由 LLM 产出」的地方，都必须先过本文件的守卫，
// 再落到 fs / child_process。守卫只有一句话——**LLM 给的路径永远出不了
// 调用方指定的根目录，也永远进不了 shell 的语法层**。
//
// 为什么单独一个文件（而不是塞进某个业务模块）：
//   loop/（engineer 循环）与 loop-agent/（onboard L2-L5 自优化循环）是
//   并列的两个子系统，各自都会把 LLM 返回的 file/target 直接交给 fs 或
//   git。守卫寄居在任一方的业务文件里，另一方就得反向 import 业务模块
//   （-decide.ts 这类文件带 prompt 与 schema，语义上不该被当工具库依赖）。
//   故提取到顶层中立位置，两边共用同一份实现。
//
// 与 train/isolation-guard.ts 的分工：
//   那边守的是**企业数据分区**的边界（enterpriseId/jobId 作为路径段）；
//   本文件守的是**LLM 产出路径**的边界。两者判据不同，不互相替代——
//   锚定判定可复用那边的 isPathInside，本文件不重复实现。
//
// 纯函数 + 零外部依赖（仅 node path）——单测直测。

import { resolve, sep } from 'path';

/** 相对路径长度上限（超长路径通常是构造攻击或 LLM 失控输出） */
export const MAX_RELATIVE_PATH_LENGTH = 512;

/**
 * 判断一个相对路径是否「安全」——可安全追加到根目录之后。
 *
 * 拒绝清单（每条都对应一种真实攻击或事故）：
 * - 非字符串 / 空 / 纯空白：LLM 漏填字段时的静默写入根因
 * - 超长：构造攻击与失控输出
 * - 控制字符（含 \n \r \0 \x7f）：截断命令行，让后续命令脱离引号
 * - 绝对路径（POSIX 根 / Windows 盘符 / UNC）：直接跳出根目录
 * - 反斜杠：POSIX 上是合法文件名字符，但会让路径语义跨平台分裂
 * - `$` 与反引号：即便不进 shell 也拒绝——深度防御，防止下游改动时误拼字符串
 * - `.` / `..` / 空段：路径穿越与「解析后指向目录本身」
 *
 * 允许：多级目录、文件名含空格与点、前导 `./`（可重复）。
 *
 * @param p 待校验的相对路径
 * @returns true 表示可安全追加到根目录后使用
 */
export function isSafeRelativePath(p: string): boolean {
  if (typeof p !== 'string' || p.trim() === '') return false;
  if (p.length > MAX_RELATIVE_PATH_LENGTH) return false;
  // NUL 与控制字符（含换行/回车——可截断命令行）
  for (let k = 0; k < p.length; k++) {
    const code = p.charCodeAt(k);
    if (code < 0x20 || code === 0x7f) return false;
  }
  // 绝对路径：POSIX 根 / Windows 盘符 / UNC
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.startsWith('\\\\')) return false;
  // 反斜杠：POSIX 上是合法文件名字符，但会让路径语义跨平台分裂
  if (p.includes('\\')) return false;
  // shell 元字符
  if (/[$`]/.test(p)) return false;

  const segments = p.split('/');
  let i = 0;
  // 允许前导 "./"（可重复），其后必须全是实心段
  while (i < segments.length && segments[i] === '.') i++;
  if (i >= segments.length) return false; // 全是 "." 或空段 → 无实心路径
  for (; i < segments.length; i++) {
    const seg = segments[i];
    if (seg === '' || seg === '.' || seg === '..') return false;
  }
  return true;
}

/** 路径锚定失败的原因码 */
export type PathAnchorRejection =
  /** 未通过 isSafeRelativePath 形态校验 */
  | 'UNSAFE_RELATIVE_PATH'
  /** 解析后的绝对路径落在根目录之外（纵深防御——形态校验之外再兜一次） */
  | 'ESCAPES_ROOT';

/** 锚定结果：成功携带绝对路径，失败携带原因码 */
export type PathAnchorResult =
  | { ok: true; absPath: string }
  | { ok: false; reason: PathAnchorRejection };

/**
 * 把 LLM 产出的相对路径锚定到根目录内——通过才返回可安全使用的绝对路径。
 *
 * 两层判据：
 *   一、形态校验（isSafeRelativePath）：拒绝绝对路径、穿越段、shell 元字符等；
 *   二、解析后前缀锚定（resolve + 分隔符边界比对）：即便形态校验被绕过或未来
 *       放宽，`..` 解析后的落点仍必须在根目录内。
 *
 * ⚠️ 第二层的可达性（变异测试实测结论，勿删）：
 *   在当前形态校验之下，ESCAPES_ROOT 分支**不可达**——把该分支改成恒不触发，
 *   回归测试仍全绿。它不是死代码，是纵深防御：一旦将来 isSafeRelativePath
 *   被放宽（例如业务需要支持 `../shared/`），第二层立刻成为唯一防线。
 *   保留它，但不要误以为它已被测试覆盖。
 *
 * 前缀比对带分隔符边界（`root + sep`），避免 `/home/proj` 误放行
 * `/home/project-evil` 这类同前缀的兄弟目录。
 *
 * @param rootDir 允许写入的根目录（绝对路径或可 resolve 的相对路径）
 * @param relPath LLM 产出的相对路径
 * @returns 锚定结果——ok 时 absPath 可安全交给 fs / execFile 参数数组
 */
export function resolveWithinRoot(rootDir: string, relPath: string): PathAnchorResult {
  if (!isSafeRelativePath(relPath)) {
    return { ok: false, reason: 'UNSAFE_RELATIVE_PATH' };
  }
  const root = resolve(rootDir);
  const absPath = resolve(root, relPath);
  // 与根自身相等 → 指向目录本身，不是文件，按逃逸处理
  if (absPath === root) {
    return { ok: false, reason: 'ESCAPES_ROOT' };
  }
  if (!absPath.startsWith(root.endsWith(sep) ? root : root + sep)) {
    return { ok: false, reason: 'ESCAPES_ROOT' };
  }
  return { ok: true, absPath };
}

/** 锚定失败原因的人读说明（写 violations / 日志用） */
export const PATH_ANCHOR_REASON_TEXT: Record<PathAnchorRejection, string> = {
  UNSAFE_RELATIVE_PATH:
    'target 必须是仓库内相对文件路径（禁绝对路径、../ 逃逸、控制字符、$ 与反引号、目录形态）',
  ESCAPES_ROOT: 'target 解析后落在允许根目录之外（路径穿越）',
};

/**
 * 判断一个**已拼接的路径**（相对或绝对）解析后是否落在根目录内。
 *
 * 与 resolveWithinRoot 的分工：
 *   resolveWithinRoot 面向 LLM 直接产出的相对路径，判据严格（禁绝对路径、
 *   禁 `$`/反引号、禁目录形态）；本函数面向调用方已 join 过的路径
 *   （如 `join(agentDir, 'think.md')`），只守最后一道——解析后不得出界。
 *
 * 仍拒绝控制字符：即便不进 shell，含换行的路径也会污染日志与审计报告。
 *
 * @param candidate 待校验路径（相对或绝对）
 * @param rootDir 允许落点的根目录
 * @returns true 表示解析后落在根目录内且不是根目录本身
 */
export function isPathWithinRoot(candidate: string, rootDir: string): boolean {
  if (typeof candidate !== 'string' || candidate.trim() === '') return false;
  if (candidate.length > MAX_RELATIVE_PATH_LENGTH) return false;
  for (let k = 0; k < candidate.length; k++) {
    const code = candidate.charCodeAt(k);
    if (code < 0x20 || code === 0x7f) return false;
  }
  const root = resolve(rootDir);
  const abs = resolve(root, candidate);
  if (abs === root) return false; // 指向目录本身，不是文件
  return abs.startsWith(root.endsWith(sep) ? root : root + sep);
}
