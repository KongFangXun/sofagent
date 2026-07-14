// ============================================================
// run-fs-audit.ts · 文件系统审计执行器（daemon 复用）
// v1.0.9 修复(F1)：把 "文件变更 → 跑审计规则 → 写历史" 抽成独立函数，
// 供 index.ts 的 --daemon start 回调调用，使 A16/A17 在文件系统模式下真正生效。
//
// 设计要点：
// - daemon 无法区分增/删/改，统一按 'modified' 处理；A16/A17 只用 path/length。
// - 配置加载采用三级 fallback，配置损坏不阻断监控（catch 后降级为 DEFAULT_CONFIG）。
// - daemon 文件系统模式专属：强制启用 extendedRules + A17（DEFAULT_CONFIG 默认关闭
//   且无 A17 段，否则 A17 永远不进规则集，F1 在默认配置下空跑）。仅影响 daemon 入口。
// - 审计结果写入审计历史，供下次 A17 窗口聚合 + 根因分析使用。
// - 不调用 process.exit（会杀掉 daemon）。
// - 控制台输出交由调用方（daemon 回调同模块内调用 printResults）负责，
//   以便复用 index.ts 既有的 printResults 可视化渲染，避免重复实现/循环依赖。
// ============================================================

import type { DiffFile } from '../diff-parser';
import type { AuditHistoryEntry } from '../audit-history';
import { runRules, type AuditResult } from '../rules/runner';
import { loadHistory, appendHistory } from '../audit-history';
import { loadConfig, DEFAULT_CONFIG, type AuditConfig } from '../config-loader';

/**
 * 对一组发生变更的文件路径执行文件系统审计。
 *
 * @param changedFiles 发生变更的文件路径数组（daemon fs-watch 回调传入）
 * @param projectDir 被监控的项目根目录（用于 history.diffRange 标记）
 * @returns 审计结果（与 runRules 返回结构一致）
 */
export function runFilesystemAudit(changedFiles: string[], projectDir: string): AuditResult {
  const time = new Date().toISOString();

  // 1. 构造 DiffFile[]（daemon 只给路径，无法区分增删改）
  const diffFiles: DiffFile[] = changedFiles.map((p) => ({
    path: p,
    status: 'modified',
    lines: [],
  }));

  // 2. 加载配置（三级 fallback，配置损坏不阻断监控）
  let config: AuditConfig;
  try {
    config = loadConfig(undefined, false);
  } catch {
    // 配置损坏时降级为默认配置（而非 undefined），确保下方强制 spread 不会丢失默认字段
    config = { ...DEFAULT_CONFIG };
  }

  // 2.1 daemon 文件系统模式专属：A16/A17 是文件系统审计规则，必须在扩展规则中启用。
  //     DEFAULT_CONFIG 默认关闭 extendedRulesEnabled 且无 A17 段，否则 A17 永远不进规则集，
  //     F1 的「使 A17 在文件系统模式下真正生效」在默认配置下会变成空跑。
  //     仅作用于 daemon 入口，不改变 git-diff 默认行为（--init 模板由用户配置决定）。
  config = {
    ...config,
    extendedRulesEnabled: true,
    A17: config.A17 ?? { enabled: true, bulk_threshold: 50, bulk_window_ms: 300000 },
  };

  // 3. 真正跑审计（关键修复：原 daemon 回调漏了这步）。
  //    显式传入 loadHistory()，使 A17 能跨审计聚合历史变更。
  const results = runRules(
    diffFiles, [], undefined, false, false, undefined, config, loadHistory()
  );

  // 4. 写入审计历史（供下次 A17 窗口聚合 + 根因分析）
  try {
    const historyEntry: AuditHistoryEntry = {
      timestamp: time,
      diffRange: `daemon:${projectDir}`,
      task: undefined,
      exitCode: results.exitCode,
      ruleResults: results.rules,
      diffFileCount: diffFiles.length,
      commitMsg: undefined,
      commitSha: undefined,
    };
    appendHistory(historyEntry);
  } catch {
    /* 历史写入失败不影响监控 */
  }

  // 5. 控制台输出由调用方负责（见 index.ts daemon 回调的 printResults 调用）
  return results;
}
