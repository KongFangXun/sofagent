// ============================================================
// trace-cache.ts · DSH trace 解析缓存（v1.5.3 章八）
// ============================================================
//
// 动机：A7 等同步路径要读 DSH session 证据面，但真实 ~/.dsh/sessions/
// 有 936 个文件、183MB——逐个 zstd 解压 ~600ms/文件，全量扫要 10 分钟
// 级（实测 30 文件 25.8s）。审计规则是同步短路径，不能承担这个成本。
//
// 方案：mtime 缓存——解析过的 session 按文件 mtime+size 缓存为 JSON
// （{dataDir}/cache/trace/），未变更的 session 直接读缓存。二次运行
// 毫秒级。缓存条目带 schemaVersion（章八纪律）。
//
// 边界：缓存与源文件一致性由 mtime+size 双键保证（zstd 产物确定性，
// 同输入同输出）；缓存损坏按 miss 处理。
// ============================================================

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } from 'fs';
import { join } from 'path';
import { type TraceModelExport, TRACE_MODEL_SCHEMA_VERSION } from './trace-model';
import { type DecompressFn, parseDshSession, dshSessionsRoot } from './dsh-adapter';

/** 缓存 schema 版本 */
export const TRACE_CACHE_SCHEMA_VERSION = 'v1' as const;

interface CacheEntry {
  schemaVersion: typeof TRACE_CACHE_SCHEMA_VERSION;
  sourceFile: string;
  mtimeMs: number;
  size: number;
  model: TraceModelExport | null;
}

interface CacheFile {
  schemaVersion: typeof TRACE_CACHE_SCHEMA_VERSION;
  entries: Record<string, CacheEntry>;
}

/** 缓存文件路径（{dataDir}/cache/trace/dsh.json） */
export function traceCachePath(dataDir: string): string {
  return join(dataDir, 'cache', 'trace', 'dsh.json');
}

function loadCache(path: string): CacheFile {
  if (!existsSync(path)) return { schemaVersion: TRACE_CACHE_SCHEMA_VERSION, entries: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as CacheFile;
    if (parsed.schemaVersion !== TRACE_CACHE_SCHEMA_VERSION) {
      return { schemaVersion: TRACE_CACHE_SCHEMA_VERSION, entries: {} }; // 版本不符按空
    }
    return parsed;
  } catch {
    return { schemaVersion: TRACE_CACHE_SCHEMA_VERSION, entries: {} };
  }
}

/**
 * 扫描并解析 DSH sessions（带 mtime 缓存）。
 *
 * @param options.dataDir 缓存落盘根（缺省不缓存——纯解析）
 * @param options.dshHome / cwdFilter / limit / decompressFn 同 loadDshSessions
 */
export function loadDshSessionsCached(
  options: {
    dataDir?: string;
    dshHome?: string;
    cwdFilter?: string;
    limit?: number;
    decompressFn?: DecompressFn;
  } = {},
): TraceModelExport[] {
  const root = dshSessionsRoot(options.dshHome);
  if (!existsSync(root)) return [];

  const cachePath = options.dataDir ? traceCachePath(options.dataDir) : null;
  const cache = cachePath ? loadCache(cachePath) : { schemaVersion: TRACE_CACHE_SCHEMA_VERSION, entries: {} as Record<string, CacheEntry> };
  const limit = options.limit ?? 50;
  const results: TraceModelExport[] = [];
  let cacheDirty = false;

  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const sessionDir of readdirSync(join(root, dir.name), { withFileTypes: true })) {
      if (!sessionDir.isDirectory()) continue;
      const file = join(root, dir.name, sessionDir.name, 'session.jsonl.zstd');
      if (!existsSync(file)) continue;

      const stat = statSync(file);
      const key = file;
      const hit = cache.entries[key];

      let model: TraceModelExport | null;
      if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) {
        model = hit.model; // 缓存命中（含 null——解析失败也缓存，避免反复撞坏文件）
      } else {
        try {
          model = parseDshSession(file, options.decompressFn);
        } catch {
          model = null;
        }
        cache.entries[key] = {
          schemaVersion: TRACE_CACHE_SCHEMA_VERSION,
          sourceFile: file,
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          model,
        };
        cacheDirty = true;
      }

      if (model && options.cwdFilter && !(model.cwd ?? '').startsWith(options.cwdFilter)) continue;
      if (model) results.push(model);
      if (results.length >= limit) break;
    }
    if (results.length >= limit) break;
  }

  if (cachePath && cacheDirty) {
    try {
      mkdirSync(join(options.dataDir!, 'cache', 'trace'), { recursive: true, mode: 0o700 });
      writeFileSync(cachePath, JSON.stringify(cache), 'utf-8');
    } catch {
      // 缓存写失败不阻断——降级为无缓存直读
    }
  }

  return results;
}
