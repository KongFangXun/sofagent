// ============================================================
// dir-arg-guard.ts · v1.5.7 批 20 · MCP 工具目录类入参统一校验
//
// 背景（实测落点）：`corpus_export` / `ruleset_export` 的 outDir / dataDir
// 直进文件系统写入面，此前无类型与边界校验——调用方给出非字符串、空串、
// 含 NUL/换行或落在系统关键目录内的路径，都会一路走到写入。本模块提供
// 统一校验实现，两处工具调用同一份（单一实现，不各写一份）。
//
// 判据（三项，全部可机械判定）：
//   ① 类型与形态：必须是 string、非空、不含 NUL / 换行（防参数走私与日志注入）
//   ② 存在性与可写性：目标存在则须为可写目录；不存在则取**最近的已存在祖先**
//      须可写（允许调用方按需创建多层目录，不因「父目录未建」误拦）
//   ③ 越界：解析为绝对路径后不得指向文件系统根，不得落在受保护系统目录内
// ============================================================
import * as fs from 'fs';
import * as path from 'path';

/** 受保护系统目录——目录类入参落在其中即拒（写入面越界） */
const PROTECTED_ROOTS = ['/etc', '/usr', '/bin', '/sbin', '/boot', '/System', '/Library', '/var/root'];

export interface DirArgVerdict {
  ok: boolean;
  reason?: string;
}

/**
 * 校验目录类入参。`undefined` 视为合法（可选入参缺省即走调用方默认值）。
 * 返回 `{ ok:false, reason }` 时调用方必须**报错返回、不得进入写入**。
 */
export function checkDirArg(value: unknown, argName: string): DirArgVerdict {
  if (value === undefined) return { ok: true };
  if (typeof value !== 'string') {
    return { ok: false, reason: `${argName} 必须是字符串（收到 ${typeof value}）` };
  }
  const raw = value.trim();
  if (raw === '') return { ok: false, reason: `${argName} 不能为空字符串` };
  if (/[\u0000\r\n]/.test(raw)) return { ok: false, reason: `${argName} 含非法字符（NUL / 换行）` };

  const abs = path.resolve(raw);
  if (abs === path.parse(abs).root) {
    return { ok: false, reason: `${argName} 不得指向文件系统根（${abs}）` };
  }
  for (const root of PROTECTED_ROOTS) {
    if (abs === root || abs.startsWith(root + path.sep)) {
      return { ok: false, reason: `${argName} 落在受保护系统目录内（${abs}）` };
    }
  }

  let probe = abs;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) return { ok: false, reason: `${argName} 路径无可用祖先目录（${abs}）` };
    probe = parent;
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(probe);
  } catch {
    return { ok: false, reason: `${argName} 无法读取（${probe}）` };
  }
  if (!stat.isDirectory()) {
    return { ok: false, reason: `${argName} 的最近已存在祖先不是目录（${probe}）` };
  }
  try {
    fs.accessSync(probe, fs.constants.W_OK);
  } catch {
    return { ok: false, reason: `${argName} 的最近已存在祖先不可写（${probe}）` };
  }
  return { ok: true };
}
