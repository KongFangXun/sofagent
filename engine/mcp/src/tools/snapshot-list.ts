// ============================================================
// snapshot-list.ts · MCP tool：快照时间线查询（v1.3.7 交付 2）
// ============================================================
//
// 列出审计快照时间线（只读查询——daemon 进程控制类操作不 MCP 化，
// snapshot_list 是 changelog 安全边界第 2 条允许的只读面）。
//
// 🔴 import 铁律：从 '@sofagent/core' import（不是 @sofagent/daemon）——
//   daemon 在 mcp 的 optionalDependencies，静态 import 可选依赖会在
//   daemon 安装失败的环境直接炸；core 是 mcp 正式依赖且函数本体就在
//   core/src/snapshot-helpers.ts。
// ============================================================

import { listAllSnapshots, type SnapshotInfo } from '@sofagent/core';

// ============================================================
// 类型定义
// ============================================================

export interface SnapshotListArgs {
  /** 项目根目录（可选——默认 process.cwd()） */
  project_dir?: string;
  /** 返回最近 N 条（默认 10，0 = 全量） */
  limit?: number;
}

export interface SnapshotListResult {
  /** 首行必须 [sofagent] 前缀 */
  text: string;
  /** 结构化数据 */
  data: {
    isError: boolean;
    projectDir: string;
    total: number;
    snapshots: Array<{
      sha: string;
      shortSha: string;
      timestamp: string;
      fileCount: number;
    }>;
    message?: string;
  };
}

// ============================================================
// 主函数
// ============================================================

/**
 * 列出审计快照时间线（SHA + 时间 + 文件数）。
 *
 * @param args 查询参数
 * @returns 结构化结果（text + data）
 */
export function snapshotList(args: SnapshotListArgs): SnapshotListResult {
  const projectDir = args.project_dir ?? process.cwd();
  const limit = args.limit ?? 10;

  let snapshots: SnapshotInfo[];
  try {
    snapshots = listAllSnapshots(projectDir);
  } catch (err) {
    return {
      text: `[sofagent] 快照列表查询失败: ${err instanceof Error ? err.message : String(err)}`,
      data: {
        isError: true,
        projectDir,
        total: 0,
        snapshots: [],
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }

  // 按时间倒序（最新在前）+ limit 截断
  const sorted = [...snapshots].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  const selected = limit > 0 ? sorted.slice(0, limit) : sorted;

  const lines: string[] = [];
  lines.push(`[sofagent] 快照时间线（${projectDir}，共 ${snapshots.length} 个${limit > 0 ? `，显示最近 ${selected.length} 个` : ''}）:`);
  if (selected.length === 0) {
    lines.push('  （无快照——审计通过后会自动创建；也可先运行 sofagent-audit --init 初始化）');
  } else {
    for (const s of selected) {
      lines.push(`  - ${s.shortSha} · ${s.timestamp} · ${s.fileCount} 文件（完整 SHA: ${s.sha}）`);
    }
    lines.push('  恢复到指定快照: snapshot_restore（需人工确认）');
  }

  return {
    text: lines.join('\n'),
    data: {
      isError: false,
      projectDir,
      total: snapshots.length,
      snapshots: selected.map((s) => ({
        sha: s.sha,
        shortSha: s.shortSha,
        timestamp: s.timestamp,
        fileCount: s.fileCount,
      })),
    },
  };
}
