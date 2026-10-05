// ============================================================
// maintenance-daily.ts · 数据维护日检四步（批D 巡检合并施工 · v1.5.7）
// ============================================================
// 四步一次施工（任务书执行协调注记：F5/F30/F48-⑤/F51-① 同一巡检序列，
// 避免四批各改一次互相覆盖）：
//   ① F5  memory 归档：data/memory/ 文件数超 MEMORY_DIR_FILE_WARN（10000，
//        全仓唯一份共享常量）→ createMemoryStore().archive()（30 天冷数据移
//        归档区）+ 结果留痕。
//   ② F30 think 归档：compress-memory 接回调度——archiveOldEntries()（60 天前
//        反思条目移 think.archive.md）+ rotateBackups()（备份轮转 3 份）。
//        think.md append-only 契约保持（归档是授权的生命周期运维，不就地改写）。
//   ③ F48-⑤ prune-spill 接入：spill 临时文件 TTL 回收（>5MB diff 落盘的密钥类
//        内容按保留期清理）——复用 tools/maintenance/prune-spill.mjs 语义的
//        进程内实现（目录解析与 getDataDir 同链；SOFAGENT_SPILL_TTL_DAYS 可覆盖，
//        缺省 30 天）。
//   ④ F51-① persona 同步：syncPersona()（三级源解析 → 质量检查 → 落
//        knowledge/entities/persona.md）。
// 各步独立 try/catch——单步失败降级 warning 不阻断其余步（维护步彼此无依赖）。
// 调度：L1 @daily（注册表 inspectors/registry.ts 'maintenance-daily' 条目）。
// ============================================================

import type { InspectorResult } from './types';

/** spill 文件 TTL 缺省天数（SOFAGENT_SPILL_TTL_DAYS 可覆盖——与 prune-spill.mjs 同口径） */
const SPILL_TTL_DEFAULT_DAYS = 30;

/**
 * ③ F48-⑤：spill 目录 TTL 回收（进程内实现——prune-spill.mjs 的语义内化，
 * 免子进程开销；目录解析与引擎 getDataDir() 同链）。
 * 返回 { deleted, kept }；目录不存在 = 无残留 { deleted: 0, kept: 0 }。
 */
function pruneSpillDir(): { deleted: number; kept: number } {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const os = require('os') as typeof import('os');
  const spillDir = process.env.SOFAGENT_DATA
    ? path.join(process.env.SOFAGENT_DATA, 'spill')
    : process.env.SOFAGENT_HOME
      ? path.join(process.env.SOFAGENT_HOME, 'data', 'spill')
      : path.join(os.homedir(), '.sofagent', 'data', 'spill');

  const ttlRaw = Number.parseInt(process.env.SOFAGENT_SPILL_TTL_DAYS ?? '', 10);
  const ttlDays = Number.isFinite(ttlRaw) && ttlRaw >= 0 ? ttlRaw : SPILL_TTL_DEFAULT_DAYS;
  const cutoffMs = Date.now() - ttlDays * 24 * 60 * 60 * 1000;

  let entries: string[];
  try {
    entries = fs.readdirSync(spillDir);
  } catch {
    return { deleted: 0, kept: 0 }; // 目录不存在 = 无残留（ENOENT 语义）
  }
  let deleted = 0;
  let kept = 0;
  for (const name of entries) {
    const full = path.join(spillDir, name);
    try {
      const st = fs.statSync(full);
      // TTL=0 语义 = 立即过期（mtime <= cutoff 含等号——刚落盘文件也可被显式清空）
      if (st.isFile() && st.mtimeMs <= cutoffMs) {
        fs.rmSync(full, { force: true });
        deleted++;
      } else {
        kept++;
      }
    } catch {
      kept++; // 单文件 stat 失败按保留处理（fail-safe：误删比漏删严重）
    }
  }
  return { deleted, kept };
}

/**
 * 数据维护日检四步（F5 / F30 / F48-⑤ / F51-①）。
 */
export function runMaintenanceDaily(_projectDir: string): InspectorResult {
  const parts: string[] = [];

  // ── ① F5：memory 归档（超阈值 → archive() 冷数据移归档区）──
  try {
    const { existsSync, readdirSync } = require('fs') as typeof import('fs');
    const { join } = require('path') as typeof import('path');
    const { getDataDir, createMemoryStore, MEMORY_DIR_FILE_WARN } = require('@sofagent/core') as {
      getDataDir: () => string;
      createMemoryStore: typeof import('@sofagent/core').createMemoryStore;
      MEMORY_DIR_FILE_WARN: number;
    };
    const dataDir = getDataDir();
    const memoryDir = join(dataDir, 'memory');
    let fileCount = 0;
    if (existsSync(memoryDir)) {
      const countFiles = (p: string, depth: number): number => {
        if (depth > 6) return 0;
        let n = 0;
        try {
          for (const e of readdirSync(p, { withFileTypes: true })) {
            if (e.name.startsWith('.')) continue;
            const child = join(p, e.name);
            if (e.isDirectory()) n += countFiles(child, depth + 1);
            else if (e.isFile()) n++;
          }
        } catch {
          // 读失败按 0 计（为何可静默：下面有文件数>0 的门——目录不可读时按空处理，
          // 下游判据仍会拒绝「空目录冒充有货」，失败可被该门兜住）
        }
        return n;
      };
      fileCount = countFiles(memoryDir, 0);
    }
    if (fileCount > MEMORY_DIR_FILE_WARN) {
      const store = createMemoryStore(dataDir);
      const moved = store.archive(); // 30 天冷数据（memory-store archive 缺省）
      parts.push(`memory 归档：文件数 ${fileCount} > ${MEMORY_DIR_FILE_WARN}，已归档 ${moved} 条冷数据`);
    } else {
      parts.push(`memory 健康：${fileCount}/${MEMORY_DIR_FILE_WARN} 文件`);
    }
  } catch (err) {
    parts.push(`memory 归档步骤失败（降级不阻断）：${(err as Error).message}`);
  }

  // ── ② F30：think 归档（compress-memory 接回调度）──
  try {
    const { archiveOldEntries, rotateBackups } = require('@sofagent/core') as {
      archiveOldEntries: (dataBase?: string) => number;
      rotateBackups: (dataBase?: string) => string | null;
    };
    const { getDataDir } = require('@sofagent/core') as { getDataDir: () => string };
    const dataDir = getDataDir();
    const moved = archiveOldEntries(dataDir);
    const backup = rotateBackups(dataDir);
    parts.push(`think 归档：${moved} 条 60 天前条目${moved > 0 ? ' → think.archive.md' : ''}${backup ? ` · 备份轮转 ✓` : ''}`);
  } catch (err) {
    parts.push(`think 归档步骤失败（降级不阻断）：${(err as Error).message}`);
  }

  // ── ③ F48-⑤：prune-spill（TTL 回收）──
  try {
    const { deleted, kept } = pruneSpillDir();
    parts.push(`spill 回收：清理 ${deleted} · 保留 ${kept}`);
  } catch (err) {
    parts.push(`spill 回收步骤失败（降级不阻断）：${(err as Error).message}`);
  }

  // ── ④ F51-①：persona 同步 ──
  try {
    const { syncPersona, getDataDir } = require('@sofagent/core') as {
      syncPersona: (dataDir?: string) => { synced: boolean; sourcePath?: string; reason?: string };
      getDataDir: () => string;
    };
    const r = syncPersona(getDataDir());
    parts.push(r.synced ? `persona 同步 ✓（${r.sourcePath}）` : `persona 跳过（${r.reason}）`);
  } catch (err) {
    parts.push(`persona 同步步骤失败（降级不阻断）：${(err as Error).message}`);
  }

  return {
    name: 'maintenance-daily',
    triggered: true,
    message: parts.join(' · '),
    severity: 'info',
  };
}
