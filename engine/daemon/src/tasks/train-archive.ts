// ============================================================
// train-archive.ts · v1.4.5 第五章 · daemon 定时归档任务（@weekly）
//
// 保留策略的调度面：engine/orchestrator retention-policy.ts 的
// archiveExpired（归档冷存）+ purgeExpiredArchives（90 天覆写销毁）+
// checkDiskPressure（空间预警）三动作由本任务按 @weekly 周期驱动。
//
// 对齐模式：decision-memory @daily（cron.ts 任务分支 + 延迟 import
// orchestrator 包）；本任务注册为 watch.yml `train-archive:` 段
// （缺省 @weekly 启用——企业级磁盘治理默认开，显式 enabled: false 关闭）。
//
// 语义边界（devlog 第五章交付表）：
//   - 归档不删除：checkpoint/旧训练集 → data/train/archive/ 压缩冷存
//   - 覆写销毁只打归档包：超 90 天的 zip 过 train cleanup 覆写标准
//   - 活数据永不覆写：保留集（最近 N checkpoint + 生产权重 + 基线 + 回滚点）
//     只进 keep 集，purge 只消费 archive-ledger 登记的归档包
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { load as yamlLoad } from 'js-yaml';

/** train-archive 调度配置（watch.yml `train-archive:` 段） */
export interface TrainArchiveConfig {
  /** 总开关；缺省 true——磁盘治理默认开（企业级标配） */
  enabled: boolean;
  /** cron 频率；缺省 @weekly（devlog 第五章交付表） */
  schedule: '@daily' | '@weekly' | '@monthly';
  /** 是否顺带跑过期清理（超 90 天归档包覆写销毁；缺省 true） */
  purge: boolean;
  /** 是否顺带跑空间预警检查（缺省 true——告警打 daemon 日志） */
  diskCheck: boolean;
}

/** 缺省配置（@weekly + 清理 + 预警全开） */
export const DEFAULT_TRAIN_ARCHIVE_CONFIG: TrainArchiveConfig = {
  enabled: true,
  schedule: '@weekly',
  purge: true,
  diskCheck: true,
};

/** watch.yml 顶层结构（本段视角——与 cron.ts WatchConfig 同源不同段） */
interface WatchConfigTrainArchive {
  'train-archive'?: unknown;
}

/**
 * 读取 watch.yml `train-archive:` 段。
 *
 * 语义（对齐 loadDreamCycleConfig）：段缺失 → 默认 @weekly 启用；
 * 显式 enabled: false 关闭；坏 YAML fail-open 返回默认启用。
 */
export function loadTrainArchiveConfig(projectDir: string): TrainArchiveConfig {
  const watchYml = join(projectDir, '.sofagent', 'watch.yml');
  if (!existsSync(watchYml)) return { ...DEFAULT_TRAIN_ARCHIVE_CONFIG };
  try {
    const raw = yamlLoad(readFileSync(watchYml, 'utf-8')) as WatchConfigTrainArchive | null;
    const section = raw?.['train-archive'];
    if (!section || typeof section !== 'object') return { ...DEFAULT_TRAIN_ARCHIVE_CONFIG };
    const s = section as Record<string, unknown>;
    return {
      enabled: s.enabled === false ? false : true,
      schedule:
        s.schedule === '@daily' || s.schedule === '@monthly'
          ? s.schedule
          : '@weekly',
      purge: s.purge === false ? false : true,
      diskCheck: s.diskCheck === false ? false : true,
    };
  } catch {
    return { ...DEFAULT_TRAIN_ARCHIVE_CONFIG };
  }
}

/** 单次归档轮次结果（runTrainArchiveTask 输出——daemon 日志与测试消费） */
export interface TrainArchiveTaskResult {
  /** 扫描的企业分区数（data/train/ 下全部企业目录——治理无差别覆盖） */
  enterprises: string[];
  /** 逐企业归档摘要 */
  archives: Array<{
    enterpriseId: string;
    archived: number;
    failures: number;
  }>;
  /** 逐企业清理摘要 */
  purges: Array<{
    enterpriseId: string;
    purged: number;
    failures: number;
  }>;
  /** 空间预警（全数据盘一份——不按企业分盘） */
  diskWarning: { warning: boolean; usedRatio: number | null; message: string | null };
  /** 执行时间戳 */
  ranAt: string;
}

/**
 * 归档轮次主入口（daemon @weekly setInterval 回调直接调用）。
 *
 * 流程（三步——devlog 第五章交付表顺序）：
 *   一、逐企业 archiveExpired（超保留期 checkpoint/旧训练集 → zip 冷存）
 *   二、逐企业 purgeExpiredArchives（归档超 90 天 → 覆写销毁；配置 purge=true）
 *   三、checkDiskPressure（磁盘超 80% 告警——配置 diskCheck=true）
 *
 * orchestrator 依赖走延迟 import（对齐 decision-memory 模式：daemon 启动
 * 不拖重，且打包裁剪场景缺 orchestrator 时本任务优雅降级跳过不 crash）。
 */
export async function runTrainArchiveTask(
  dataDir: string,
  opts: { config?: TrainArchiveConfig; now?: Date } = {},
): Promise<TrainArchiveTaskResult> {
  const config = opts.config ?? DEFAULT_TRAIN_ARCHIVE_CONFIG;
  const ranAt = (opts.now ?? new Date()).toISOString();
  const result: TrainArchiveTaskResult = {
    enterprises: [],
    archives: [],
    purges: [],
    diskWarning: { warning: false, usedRatio: null, message: null },
    ranAt,
  };

  if (!config.enabled) return result;

  // 延迟 import（daemon→orchestrator ✓ 依赖方向；缺包降级空跑）
  let orch: typeof import('@sofagent/orchestrator');
  try {
    orch = (await import('@sofagent/orchestrator')) as typeof import('@sofagent/orchestrator');
  } catch {
    console.warn('[train-archive] @sofagent/orchestrator 不可用——本轮归档跳过（裁剪安装形态）');
    return result;
  }

  // ── 企业分区枚举（data/train/ 下全部目录——治理无差别）──
  const trainRoot = join(dataDir, 'train');
  const enterprises = existsSync(trainRoot)
    ? (() => {
        try {
          return require('fs')
            .readdirSync(trainRoot, { withFileTypes: true })
            .filter((e: { isDirectory: () => boolean }) => e.isDirectory())
            .map((e: { name: string }) => e.name)
            .filter((name: string) => name !== 'archive'); // 归档区本身不是企业分区
        } catch {
          return [];
        }
      })()
    : [];
  result.enterprises = enterprises;

  // ── 一、归档 + 二、清理（逐企业）──
  for (const enterpriseId of enterprises) {
    try {
      const archiveReport = orch.archiveExpired(
        dataDir,
        enterpriseId,
        ...(opts.now !== undefined ? [{ now: opts.now }] : []),
      );
      result.archives.push({
        enterpriseId,
        archived: archiveReport.archived.length,
        failures: archiveReport.failures.length,
      });
    } catch (e) {
      console.error(`[train-archive] 企业 ${enterpriseId} 归档失败:`, (e as Error).message);
      result.archives.push({ enterpriseId, archived: 0, failures: 1 });
    }
    if (config.purge) {
      try {
        const purgeReport = orch.purgeExpiredArchives(
          dataDir,
          enterpriseId,
          ...(opts.now !== undefined ? [{ now: opts.now }] : []),
        );
        result.purges.push({
          enterpriseId,
          purged: purgeReport.purged.length,
          failures: purgeReport.failures.length,
        });
      } catch (e) {
        console.error(`[train-archive] 企业 ${enterpriseId} 过期清理失败:`, (e as Error).message);
        result.purges.push({ enterpriseId, purged: 0, failures: 1 });
      }
    }
  }

  // ── 三、空间预警（数据盘整体一份）──
  if (config.diskCheck) {
    try {
      const pressure = orch.checkDiskPressure(dataDir);
      result.diskWarning = {
        warning: pressure.warning,
        usedRatio: pressure.usedRatio,
        message: pressure.message,
      };
      if (pressure.warning) {
        const top = (pressure.suggestions[0]?.path) ?? '（无企业分区可建议——查大盘上其他占用）';
        console.warn(
          `[train-archive] ⚠ 磁盘空间预警：${pressure.message ?? ''}——最大可归档项：${top}`,
        );
      }
    } catch (e) {
      console.error('[train-archive] 空间预警检查失败:', (e as Error).message);
    }
  }

  return result;
}
