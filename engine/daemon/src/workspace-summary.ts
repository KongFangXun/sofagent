// ============================================================
// workspace-summary.ts · Workspace 变更摘要（v1.2.3 · 交付五）
//
// daemon 在编排引擎运行结束后，自动记录创建/修改/删除的文件清单，
// 写入 data/dashboard/workspace-changes.jsonl（只记文件路径列表，
// 不记 diff 内容；保留最近 100 条）。
//
// 触发点（架构决策 AD-6）：daemon 巡检链 + checkpoint 联动——
// 发现新 checkpoint 才记一条，runId = checkpointId。
// 判定方式：比较 checkpoint 目录最新文件中的 checkpointId 与状态文件
// 里上次处理的 checkpointId，不同才记录（幂等——重复巡检不重复记）。
//
// 约束：
// - git 调用走 execFileSync（无 shell，无注入面）
// - 非 git 环境不 throw——记录空清单（runId 追溯性保留）
// - 全部写操作失败静默（观测通道，不阻断巡检主流程）
// ============================================================

import { execFileSync } from 'child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'fs';
import { dirname, join } from 'path';
import { DASHBOARD_DIR, loadEnvConfig } from '@sofagent/core';

/** workspace-changes.jsonl 最大保留条数 */
export const WORKSPACE_CHANGES_MAX_ENTRIES = 100;

/** 单条 workspace 变更记录（jsonl 一行） */
export interface WorkspaceChangeRecord {
  /** ISO 8601 时间戳 */
  timestamp: string;
  /** 运行标识 = checkpointId（一次 LOOP 运行一个） */
  runId: string;
  /** 新建文件路径列表（相对仓库根） */
  created: string[];
  /** 修改文件路径列表 */
  modified: string[];
  /** 删除文件路径列表 */
  deleted: string[];
}

/** runWorkspaceSummary 入参 */
export interface WorkspaceSummaryOptions {
  /** 项目根目录（git 仓库根，默认 process.cwd()） */
  projectDir?: string;
  /** checkpoint 目录（默认 {SOFAGENT_DATA}/checkpoint，与 orchestrator resolveCheckpointDir 一致） */
  checkpointDir?: string;
  /** jsonl 输出路径（默认 $SOFAGENT_HOME/data/dashboard/workspace-changes.jsonl） */
  outputPath?: string;
  /** 触发状态文件路径（默认 outputPath 同目录 workspace-summary-state.json） */
  statePath?: string;
}

/** 触发状态文件内容（上次处理的 checkpointId） */
interface WorkspaceSummaryState {
  lastCheckpointId: string;
  updatedAt: string;
}

// ────────────────────────────────
// 路径解析
// ────────────────────────────────

/** 解析 jsonl 输出路径 */
export function resolveWorkspaceChangesPath(outputPath?: string): string {
  return outputPath ?? join(DASHBOARD_DIR, 'workspace-changes.jsonl');
}

/** 解析触发状态文件路径 */
function resolveStatePath(opts: WorkspaceSummaryOptions): string {
  return opts.statePath ?? join(dirname(resolveWorkspaceChangesPath(opts.outputPath)), 'workspace-summary-state.json');
}

/** 解析 checkpoint 目录（与 orchestrator resolveCheckpointDir 同一事实来源） */
function resolveCheckpointDir(opts: WorkspaceSummaryOptions): string {
  return opts.checkpointDir ?? join(loadEnvConfig().dataDir, 'checkpoint');
}

// ────────────────────────────────
// workspace 变更采集（git status --porcelain）
// ────────────────────────────────

/**
 * 采集当前 workspace 的文件变更清单。
 *
 * 数据源：git status --porcelain（未提交的工作区/暂存区状态）——
 * 编排引擎运行结束后 SubAgent 留下的全部未提交痕迹。
 * core.quotepath=false：CJK 文件名不转义（保持可读路径）。
 *
 * 分类映射：
 * - created：?? 未跟踪 / A 新增 / R·C 的目标路径
 * - modified：M / T / U（任一列）
 * - deleted：D / R 的源路径
 *
 * @param projectDir git 仓库根
 * @returns 三个去重排序后的路径数组
 */
export function collectWorkspaceChanges(projectDir: string): {
  created: string[];
  modified: string[];
  deleted: string[];
} {
  const out = execFileSync('git', ['-c', 'core.quotepath=false', 'status', '--porcelain'], {
    cwd: projectDir,
    encoding: 'utf-8',
    maxBuffer: 16 * 1024 * 1024,
  });

  const created = new Set<string>();
  const modified = new Set<string>();
  const deleted = new Set<string>();

  for (const line of out.split('\n')) {
    if (line.length < 4) continue;
    const x = line[0]!;
    const y = line[1]!;
    const rest = line.slice(3);

    // 重命名/复制：'orig -> new'
    let filePath = rest;
    let origPath: string | null = null;
    const arrowIdx = rest.indexOf(' -> ');
    if (arrowIdx > 0) {
      origPath = rest.slice(0, arrowIdx);
      filePath = rest.slice(arrowIdx + 4);
    }
    // porcelain 对含特殊字符的路径加引号——剥离
    filePath = filePath.replace(/^"|"$/g, '');
    if (origPath) origPath = origPath.replace(/^"|"$/g, '');

    const status = `${x}${y}`;
    if (status === '??') {
      created.add(filePath);
      continue;
    }
    if (x === 'A' || y === 'A') created.add(filePath);
    if (x === 'M' || y === 'M' || x === 'T' || y === 'T' || x === 'U' || y === 'U') {
      modified.add(filePath);
    }
    if (x === 'D' || y === 'D') deleted.add(filePath);
    if (x === 'R' || x === 'C') {
      // 重命名 = 源删除 + 目标新建；复制 = 目标新建
      if (x === 'R' && origPath) deleted.add(origPath);
      created.add(filePath);
    }
  }

  return {
    created: [...created].sort(),
    modified: [...modified].sort(),
    deleted: [...deleted].sort(),
  };
}

// ────────────────────────────────
// jsonl 读写（含 100 条保留策略）
// ────────────────────────────────

/** 读取全部变更记录（坏行跳过） */
export function readWorkspaceChanges(outputPath?: string): WorkspaceChangeRecord[] {
  const filePath = resolveWorkspaceChangesPath(outputPath);
  if (!existsSync(filePath)) return [];
  const records: WorkspaceChangeRecord[] = [];
  for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as WorkspaceChangeRecord);
    } catch (err) {
      process.stderr.write(`[sofagent-daemon] warn: 跳过无法解析的 workspace-changes 行: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
  return records;
}

/**
 * 追加一条变更记录，并把文件截断到最近 100 条。
 * 原子写：tmp + rename（与 checkpoint.ts 同一范式）。
 */
export function appendWorkspaceChange(record: WorkspaceChangeRecord, outputPath?: string): void {
  const filePath = resolveWorkspaceChangesPath(outputPath);
  mkdirSync(dirname(filePath), { recursive: true });
  appendFileSync(filePath, `${JSON.stringify(record)}\n`);

  const all = readWorkspaceChanges(filePath);
  if (all.length <= WORKSPACE_CHANGES_MAX_ENTRIES) return;
  const kept = all.slice(-WORKSPACE_CHANGES_MAX_ENTRIES);
  const tmp = `${filePath}.tmp.${process.pid}`;
  writeFileSync(tmp, kept.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf-8');
  renameSync(tmp, filePath);
}

// ────────────────────────────────
// checkpoint 联动（AD-6）
// ────────────────────────────────

/**
 * 读取最新 checkpoint 文件中的 checkpointId。
 * 文件名 = checkpoint-{ISO时间戳}-{随机}.json，字典序最大即最新。
 * 目录不存在 / 无文件 / 文件损坏 → null。
 */
export function readLatestCheckpointId(checkpointDir: string): string | null {
  if (!existsSync(checkpointDir)) return null;
  let files: string[];
  try {
    files = readdirSync(checkpointDir)
      .filter((f) => f.startsWith('checkpoint-') && f.endsWith('.json'))
      .sort();
  } catch (err) {
    process.stderr.write(`[sofagent-daemon] warn: 读取 checkpoint 目录失败 ${checkpointDir}: ${err instanceof Error ? err.message : String(err)}\n`);
    return null;
  }
  const latest = files[files.length - 1];
  if (!latest) return null;
  try {
    const record = JSON.parse(readFileSync(join(checkpointDir, latest), 'utf-8')) as { checkpointId?: unknown };
    return typeof record.checkpointId === 'string' && record.checkpointId ? record.checkpointId : null;
  } catch (err) {
    process.stderr.write(`[sofagent-daemon] warn: 解析 checkpoint 文件失败 ${latest}: ${err instanceof Error ? err.message : String(err)}\n`);
    return null;
  }
}

/** 读取触发状态（上次处理的 checkpointId；无状态文件 → null） */
function readSummaryState(statePath: string): WorkspaceSummaryState | null {
  if (!existsSync(statePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(statePath, 'utf-8')) as Partial<WorkspaceSummaryState>;
    return typeof parsed.lastCheckpointId === 'string' ? (parsed as WorkspaceSummaryState) : null;
  } catch (err) {
    process.stderr.write(`[sofagent-daemon] warn: 读取 workspace-summary 状态文件失败 ${statePath}: ${err instanceof Error ? err.message : String(err)}\n`);
    return null;
  }
}

/** 写触发状态（失败静默） */
function writeSummaryState(statePath: string, checkpointId: string): void {
  try {
    mkdirSync(dirname(statePath), { recursive: true });
    const state: WorkspaceSummaryState = { lastCheckpointId: checkpointId, updatedAt: new Date().toISOString() };
    writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    // 状态写入失败不阻断——下次巡检会重复判定一次（幂等，不丢数据）
    process.stderr.write(`[sofagent-daemon] warn: workspace-summary 状态写入失败 ${statePath}: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

/**
 * 巡检触发入口：发现新 checkpoint 才记录一条 workspace 变更摘要。
 *
 * 流程：
 * 1. 读最新 checkpoint 的 checkpointId（无 → 返回 null）
 * 2. 与状态文件比对——相同（已处理过）→ 返回 null（幂等，不重复记）
 * 3. 采集 workspace 变更清单 → 追加 jsonl（100 条保留）→ 更新状态文件
 *
 * @returns 新写入的记录；无新 checkpoint 时返回 null
 */
export function runWorkspaceSummary(opts: WorkspaceSummaryOptions = {}): WorkspaceChangeRecord | null {
  const checkpointDir = resolveCheckpointDir(opts);
  const latestId = readLatestCheckpointId(checkpointDir);
  if (!latestId) return null;

  const statePath = resolveStatePath(opts);
  const lastProcessed = readSummaryState(statePath)?.lastCheckpointId;
  if (lastProcessed === latestId) return null; // 无新 checkpoint——幂等跳过

  const projectDir = opts.projectDir ?? process.cwd();
  let changes = { created: [] as string[], modified: [] as string[], deleted: [] as string[] };
  try {
    changes = collectWorkspaceChanges(projectDir);
  } catch (err) {
    // 非 git 环境——记录空清单（runId 追溯性保留），不 throw
    process.stderr.write(`[sofagent-daemon] warn: workspace 变更采集失败（非 git 环境？）: ${err instanceof Error ? err.message : String(err)}\n`);
  }

  const record: WorkspaceChangeRecord = {
    timestamp: new Date().toISOString(),
    runId: latestId,
    ...changes,
  };

  try {
    appendWorkspaceChange(record, resolveWorkspaceChangesPath(opts.outputPath));
  } catch (err) {
    // jsonl 写入失败不阻断——观测通道不阻断巡检
    process.stderr.write(`[sofagent-daemon] warn: workspace-changes.jsonl 写入失败: ${err instanceof Error ? err.message : String(err)}\n`);
    return null;
  }
  writeSummaryState(statePath, latestId);
  return record;
}
