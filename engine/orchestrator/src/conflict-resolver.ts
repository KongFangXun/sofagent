// ============================================================
// conflict-resolver.ts · worktree 合并冲突仲裁（v1.3.4 · 交付一）
//
// git merge 文本冲突（不是 audit FAIL）的仲裁器。
// 仲裁不修改 SubAgent 的原始 diff——只决定用谁的结果。
//
// 仲裁优先级（从高到低）：
//   1. 节点职责域优先：每个 SubAgent 有 responsibilityScope。
//      写到自己 scope 内的文件 → 该 SubAgent 赢；声明了 scope 却
//      写到 scope 外 → 让步
//   2. 无 scope 声明：后提交者让步（先到先得，按 committedAt 判定）
//   3. 双方 scope 都覆盖同一文件（scope 重叠）→ 标记 conflict，
//      暂停走人工确认（HITL）
//
// 冲突记录写入 <repoRoot>/data/audit/worktree-conflicts.jsonl。
// ============================================================

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';

/** 冲突记录默认路径（相对 repoRoot） */
export const WORKTREE_CONFLICTS_REL = 'data/audit/worktree-conflicts.jsonl';

// ────────────────────────────────
// 类型
// ────────────────────────────────

/** 冲突一方 */
export interface ConflictParty {
  /** SubAgent 标识（主分支侧约定为 'main'） */
  agentId: string;
  /** 分支名 */
  branch: string;
  /** 职责域——目录/文件前缀列表（如 ['engine/orchestrator/']） */
  responsibilityScope?: string[];
  /** 该方最新提交时间（ISO 8601，先到先得判定依据） */
  committedAt: string;
}

/** 仲裁入参 */
export interface MergeConflictInput {
  /** git merge 产生文本冲突的文件列表 */
  files: string[];
  /** 当前合并进来的方（通常是后提交者） */
  incoming: ConflictParty;
  /** 已在主分支上的方（通常是先提交者） */
  incumbent: ConflictParty;
}

/** 单文件赢家 */
export type ConflictWinner = 'incoming' | 'incumbent' | 'hitl';

/** 仲裁规则命中标记 */
export type ConflictRule =
  | 'scope-incoming'         // 文件在 incoming scope 内 → incoming 赢
  | 'scope-incumbent'        // 文件在 incumbent scope 内 → incumbent 赢
  | 'out-of-scope-incoming'  // incoming 声明了 scope 但越界写入 → 让步
  | 'out-of-scope-incumbent' // incumbent 声明了 scope 但越界写入 → 让步
  | 'out-of-scope-both'      // 双方都声明 scope 但文件均不在各自域内 → HITL
  | 'first-commit'           // 双方均未声明 scope → 先到先得
  | 'scope-overlap';         // 双方 scope 重叠 → HITL

/** 单文件裁决 */
export interface ConflictFileVerdict {
  file: string;
  winner: ConflictWinner;
  rule: ConflictRule;
}

/** 整体裁决结果 */
export interface ConflictResolution {
  /**
   * 整体裁决：
   * - incoming-wins：合并进来的方全赢（merge -X theirs 完成合并）
   * - incumbent-wins：主分支侧全赢（abort，后提交者让步重试）
   * - hitl：升级人工确认（scope 重叠 / 多文件赢家不一致）
   */
  resolution: 'incoming-wins' | 'incumbent-wins' | 'hitl';
  reason: string;
  perFile: ConflictFileVerdict[];
}

/** 冲突记录（jsonl 一行） */
export interface ConflictRecord {
  /** ISO 8601 时间戳 */
  ts: string;
  /** 冲突文件列表 */
  files: string[];
  incoming: ConflictParty;
  incumbent: ConflictParty;
  resolution: ConflictResolution['resolution'];
  reason: string;
  /** resolved=已自动裁决；pending-hitl=等待人工确认 */
  status: 'resolved' | 'pending-hitl';
}

// ────────────────────────────────
// scope 匹配
// ────────────────────────────────

/**
 * scope 匹配——前缀语义：
 * - 条目 'engine/orchestrator/' 覆盖其下所有文件
 * - 条目无尾斜杠按目录处理（'src' 覆盖 'src/a.ts'）
 * - 条目与文件全等则精确匹配（'README.md' 只覆盖 README.md 本身）
 */
export function fileInScope(file: string, scope?: readonly string[]): boolean {
  if (!scope || scope.length === 0) return false;
  return scope.some((entry) => {
    const normalized = entry.replace(/\\/g, '/');
    if (file === normalized) return true;
    const prefix = normalized.endsWith('/') ? normalized : `${normalized}/`;
    return file.startsWith(prefix);
  });
}

// ────────────────────────────────
// 仲裁
// ────────────────────────────────

/**
 * 仲裁一次 merge 冲突。
 *
 * 逐文件仲裁后收敛整体裁决：
 * - 任一文件 hitl → 整体 hitl
 * - 多文件赢家不一致 → 整体 hitl（仲裁不拆 diff，无法整体选边时保守升级人工）
 * - 全部文件同一赢家 → 该方赢
 */
export function resolveWorktreeConflict(input: MergeConflictInput): ConflictResolution {
  const perFile = input.files.map((file) => arbitrateFile(file, input.incoming, input.incumbent));

  if (perFile.length === 0) {
    return { resolution: 'incumbent-wins', reason: '无冲突文件，主分支保持不变', perFile };
  }

  const winners = new Set(perFile.map((v) => v.winner));

  if (winners.has('hitl')) {
    const overlapped = perFile.filter((v) => v.rule === 'scope-overlap').map((v) => v.file);
    const bothOut = perFile.filter((v) => v.rule === 'out-of-scope-both').map((v) => v.file);
    const detail = overlapped.length > 0
      ? `职责域重叠：${overlapped.join(', ')} 同时在 ${input.incoming.agentId} 与 ${input.incumbent.agentId} 的 scope 内`
      : `双方均越出各自职责域：${bothOut.join(', ')}`;
    return {
      resolution: 'hitl',
      reason: `${detail}，暂停走人工确认`,
      perFile,
    };
  }

  if (winners.size > 1) {
    return {
      resolution: 'hitl',
      reason: '冲突文件分属不同赢家，无法在不修改原始 diff 的前提下整体裁决，升级人工确认',
      perFile,
    };
  }

  const only = perFile[0]!;
  return {
    resolution: only.winner === 'incoming' ? 'incoming-wins' : 'incumbent-wins',
    reason: summarizeReason(only.rule, input),
    perFile,
  };
}

/** 单文件仲裁——按优先级匹配规则 */
function arbitrateFile(
  file: string,
  incoming: ConflictParty,
  incumbent: ConflictParty,
): ConflictFileVerdict {
  const hasIncomingScope = (incoming.responsibilityScope?.length ?? 0) > 0;
  const hasIncumbentScope = (incumbent.responsibilityScope?.length ?? 0) > 0;
  const inIncoming = fileInScope(file, incoming.responsibilityScope);
  const inIncumbent = fileInScope(file, incumbent.responsibilityScope);

  // 规则3：双方 scope 都覆盖该文件 → 重叠 → HITL
  if (inIncoming && inIncumbent) return { file, winner: 'hitl', rule: 'scope-overlap' };
  // 规则1：写到自己 scope 内 → 赢；对方 scope 覆盖 → 让步
  if (inIncoming) return { file, winner: 'incoming', rule: 'scope-incoming' };
  if (inIncumbent) return { file, winner: 'incumbent', rule: 'scope-incumbent' };
  // 双方 scope 均未覆盖该文件
  if (hasIncomingScope && hasIncumbentScope) return { file, winner: 'hitl', rule: 'out-of-scope-both' };
  // 规则1 补：声明了 scope 却写到 scope 外 → 让步
  if (hasIncomingScope) return { file, winner: 'incumbent', rule: 'out-of-scope-incoming' };
  if (hasIncumbentScope) return { file, winner: 'incoming', rule: 'out-of-scope-incumbent' };
  // 规则2：双方均未声明 scope → 先到先得（后提交者让步）
  const incomingFirst = incoming.committedAt <= incumbent.committedAt;
  return { file, winner: incomingFirst ? 'incoming' : 'incumbent', rule: 'first-commit' };
}

/** 生成人类可读裁决理由 */
function summarizeReason(rule: ConflictRule, input: MergeConflictInput): string {
  switch (rule) {
    case 'scope-incoming':
      return `${input.incoming.agentId} 写到自己职责域内，采用其结果`;
    case 'scope-incumbent':
      return `冲突文件属 ${input.incumbent.agentId} 职责域，${input.incoming.agentId} 让步`;
    case 'out-of-scope-incoming':
      return `${input.incoming.agentId} 声明职责域但越界写入，让步`;
    case 'out-of-scope-incumbent':
      return `${input.incumbent.agentId} 声明职责域但越界写入，让步`;
    case 'out-of-scope-both':
      return '双方均越出各自职责域，升级人工确认';
    case 'first-commit':
      return `双方均未声明职责域，先到先得——后提交者 ${input.incoming.agentId} 让步`;
    case 'scope-overlap':
      return '职责域重叠，升级人工确认';
  }
}

// ────────────────────────────────
// 冲突记录（jsonl，append-only）
// ────────────────────────────────

/** 解析冲突记录路径（默认 <repoRoot>/data/audit/worktree-conflicts.jsonl） */
export function resolveConflictsPath(repoRoot: string, conflictsPath?: string): string {
  return conflictsPath ? resolve(conflictsPath) : join(repoRoot, WORKTREE_CONFLICTS_REL);
}

/**
 * 追加一行冲突记录。
 * 写入失败不阻断主流程——记录是辅助追溯，仲裁结果已同步返回。
 */
export function appendConflictRecord(conflictsPath: string, record: ConflictRecord): void {
  try {
    mkdirSync(dirname(conflictsPath), { recursive: true });
    appendFileSync(conflictsPath, `${JSON.stringify(record)}\n`);
  } catch {
    // 记录写入失败静默
  }
}

/** 读取全部冲突记录（坏行跳过） */
export function readConflictRecords(conflictsPath: string): ConflictRecord[] {
  if (!existsSync(conflictsPath)) return [];
  const records: ConflictRecord[] = [];
  for (const line of readFileSync(conflictsPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as ConflictRecord);
    } catch {
      // 跳过坏行
    }
  }
  return records;
}
