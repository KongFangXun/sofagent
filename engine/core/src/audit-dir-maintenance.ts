// ============================================================
// audit-dir-maintenance.ts · 审计目录维护（v1.5.6 章二）
//
// 能力：接管 <dataDir>/audit/ 下历史遗留的备份文件——`*.bak-*` / `*.bak` /
// `*.broken-*` / `*.broken`，按 30 天上限清理。清理**全程审计留痕**：
// 每删一个文件写一条 decision-log 记录（kind=LEGACY_CLEANUP，moment=ACT，
// 证据含被删文件名 + 大小 + 原因）。留痕复用 core 软依赖收口
// （audit-decision-writer.ts），与 doctor --refresh 同一写入路径，非第二份实现。
//
// 目录推导：<getDataDir(dataDir)>/audit（与全仓 SSOT 一致，禁手拼 join(home,'data')）。
// 幂等：dryRun=true 只统计不删（不写 decision-log）；重复运行至多把「尚存的超龄
// 遗留备份」删净，无副作用累积。
// ============================================================

import { existsSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { getDataDir } from './data-paths';
import { emitAuditDecision } from './audit-decision-writer';

/** cleanupLegacyArtifacts 结果统计 */
export interface LegacyCleanupResult {
  /** 扫描到的目录项总数 */
  scanned: number;
  /** 被判为超龄删除的**文件绝对路径**列表（dryRun 时为「将删除」列表） */
  deleted: string[];
  /** 匹配遗留模式但仍在保留期内的文件数 */
  kept: number;
  /** 删除释放的字节数（dryRun 时为「将释放」字节数） */
  freedBytes: number;
}

/**
 * 文件名是否命中遗留备份模式：
 *   - 含 `.bak-`（如 `history.jsonl.bak-20260101`）
 *   - 以 `.bak` 结尾
 *   - 含 `.broken-`（如 `x.broken-1`）
 *   - 以 `.broken` 结尾
 */
function isLegacyArtifact(name: string): boolean {
  return (
    name.includes('.bak-') ||
    name.endsWith('.bak') ||
    name.includes('.broken-') ||
    name.endsWith('.broken')
  );
}

/**
 * 清理审计目录下的历史遗留备份（v1.5.6 章二 · 遗留备份接管）。
 *
 * @param options.dataDir 数据目录覆盖（测试隔离用；目录 = <dataDir>/audit/）
 * @param options.maxAgeDays 保留期（天，默认 30）——mtime 早于 now - maxAgeDays*86400_000 即删
 * @param options.now 参考时刻（默认当前时间；测试固定时钟用）
 * @param options.dryRun true = 只统计不删（deleted 列为将删项，不写 decision-log）
 * @returns 统计（见 {@link LegacyCleanupResult}）
 */
export function cleanupLegacyArtifacts(options: {
  dataDir?: string;
  maxAgeDays?: number;
  now?: Date;
  dryRun?: boolean;
} = {}): LegacyCleanupResult {
  const maxAgeDays = options.maxAgeDays ?? 30;
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;
  const auditDir = join(getDataDir(options.dataDir), 'audit');

  const result: LegacyCleanupResult = { scanned: 0, deleted: [], kept: 0, freedBytes: 0 };
  if (!existsSync(auditDir)) return result;

  let names: string[];
  try {
    names = readdirSync(auditDir);
  } catch {
    // 为何可静默：目录不可读时无可清理对象——返回空统计（治理动作非关键路径）
    return result;
  }
  result.scanned = names.length;

  const cutoff = now.getTime() - maxAgeDays * 86_400_000;

  for (const name of names) {
    if (!isLegacyArtifact(name)) continue;
    const full = join(auditDir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;

    if (st.mtimeMs >= cutoff) {
      result.kept += 1;
      continue;
    }

    result.deleted.push(full);
    result.freedBytes += st.size;

    if (dryRun) continue;

    try {
      unlinkSync(full);
    } catch {
      // 删除失败（权限/占用）：如实回退统计——不谎报「已删」
      result.deleted.pop();
      result.freedBytes -= st.size;
      continue;
    }

    // 每个删除动作写一条 decision-log（受控写唯一入口，复用 doctor 同款路径）。
    // 留痕失败（返回 null）不阻断清理（与 doctor --refresh 同容错铁律）。
    emitAuditDecision(
      {
        agentId: 'sofagent-audit-maintenance',
        sessionId: `legacy-cleanup-${now.toISOString()}`,
        kind: 'LEGACY_CLEANUP',
        moment: 'ACT',
        why: `遗留备份接管清理：超 ${maxAgeDays} 天备份删除`,
        evidence: [`file=${name}`, `size=${st.size}`, `reason=超 ${maxAgeDays} 天遗留备份`],
      },
      options.dataDir,
    );
  }

  return result;
}
