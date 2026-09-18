// ============================================================
// reconcile.ts · 三源对账引擎（v1.5.0 章八）
// ============================================================
//
// 三层证据对齐：
//   Agent 自述（trace：DSH/OpenClaw 统一模型——说的）
//   vs 独立事实（git diff 文件集——干的）
//   vs 声明面（task/logs——宣称的）
//
// 四态判定：
//   consistent 一致：三方吻合
//   omitted    漏报：diff 有、trace 无（干了没说）
//   hallucinated 幻觉动作：trace 有 write、diff 无且无 delete 回滚（说了没干）
//   misreported 瞒报：logs 声明与 diff 不符（宣称与实际不符）
//
// 模型层回溯（traceModelLayer）：llm-calls 推理记录 → 模型版本 →
// train_job → datasetHash——生产推理异常时全链定责。
// ============================================================

import type { TraceModelExport, TraceEvent } from './trace-model';
import { TRACE_MODEL_SCHEMA_VERSION } from './trace-model';

/** 对账差异四态 */
export type ReconcileVerdict = 'consistent' | 'omitted' | 'hallucinated' | 'misreported';

/** 单文件级差异项 */
export interface ReconcileDiscrepancy {
  verdict: ReconcileVerdict;
  /** 文件路径（相对仓库根） */
  path: string;
  /** 证据描述（哪个源有、哪个源无） */
  evidence: string;
}

/** 对账报告 */
export interface ReconcileReport {
  /** 报告 schema 版本（落盘首字段） */
  schemaVersion: typeof TRACE_MODEL_SCHEMA_VERSION;
  generatedAt: string;
  /** 对账窗口内 trace 源（dsh/openclaw）session 数 */
  sessionsReconciled: number;
  /** trace 自述的 write 文件集（绝对路径归一到仓库相对） */
  traceWriteSet: string[];
  /** git diff 实际变更集 */
  diffSet: string[];
  /** 差异清单（空数组 = 全一致） */
  discrepancies: ReconcileDiscrepancy[];
  /** 一致率（1 - 差异文件数/对齐文件总数；空集时 1） */
  consistencyRate: number;
}

/** 模型层回溯链节点 */
export interface ModelLayerTraceLink {
  /** llm-calls 记录时间（ISO） */
  ts: string;
  /** 推理模型标识（provider/model） */
  model: string;
  /** train job 标识（无训练链路时 undefined） */
  trainJobId?: string;
  /** 训练指纹（datasetHash + 环境快照摘要——HMAC 验签结果） */
  fingerprint?: {
    trainJobId: string;
    datasetHash: string;
    datasetVersion: string;
    hmacVerified: boolean;
  };
}

/** 对账输入——三源 + 对齐参数 */
export interface ReconcileInput {
  /** 统一 trace 模型（一个或多个 session） */
  traces: TraceModelExport[];
  /** git diff 变更文件集（仓库相对路径） */
  diffFiles: string[];
  /** diff 中的删除文件集（幻觉判定的回滚豁免依据） */
  deletedFiles?: string[];
  /** task/logs 声明的变更文件集（瞒报判定源；缺省跳过瞒报维度） */
  declaredFiles?: string[];
  /** 仓库根（trace 绝对路径归一；缺省不归一） */
  repoRoot?: string;
}

/** 路径归一：绝对 → 仓库相对（不在仓库内则原样） */
function normalizePath(p: string, repoRoot?: string): string {
  if (!repoRoot) return p;
  if (p.startsWith(repoRoot + '/')) return p.slice(repoRoot.length + 1);
  return p;
}

/** trace 事件流 → write 文件集（去重 + 归一） */
export function collectTraceWriteSet(traces: TraceModelExport[], repoRoot?: string): string[] {
  const set = new Set<string>();
  for (const trace of traces) {
    for (const ev of trace.events) {
      if (ev.type === 'file-op' && ev.fileOp === 'write' && ev.filePath) {
        set.add(normalizePath(ev.filePath, repoRoot));
      }
    }
  }
  return [...set].sort();
}

/** trace 事件流 → read 文件集（A7 证据面） */
export function collectTraceReadSet(traces: TraceModelExport[], repoRoot?: string): string[] {
  const set = new Set<string>();
  for (const trace of traces) {
    for (const ev of trace.events) {
      if (ev.type === 'file-op' && ev.fileOp === 'read' && ev.filePath) {
        set.add(normalizePath(ev.filePath, repoRoot));
      }
    }
  }
  return [...set].sort();
}

/**
 * 三源对账主入口。
 *
 * 判定规则：
 *   对齐集 = traceWriteSet ∪ diffFiles
 *   - path ∈ diffFiles 且 ∈ traceWriteSet → consistent
 *   - path ∈ diffFiles 且 ∉ traceWriteSet → omitted（漏报——干了没说）
 *   - path ∉ diffFiles 且 ∈ traceWriteSet
 *       且 ∉ deletedFiles（无回滚记录）→ hallucinated（幻觉——说了没干）
 *       且 ∈ deletedFiles → consistent（写了又删——回滚闭环）
 *   - declaredFiles 给定时：path ∈ declaredFiles 但 ∉ diffFiles → misreported
 *   - hallucinated 且 ∈ declaredFiles → misreported（幻觉 + 瞒报并存按瞒报计）
 */
export function reconcileTraces(input: ReconcileInput): ReconcileReport {
  const traceWriteSet = collectTraceWriteSet(input.traces, input.repoRoot);
  const diffSet = [...new Set(input.diffFiles)].sort();
  const deleted = new Set(input.deletedFiles ?? []);
  const declared = input.declaredFiles ? new Set(input.declaredFiles) : null;

  // 对齐集 = trace 写集 ∪ diff 集 ∪ logs 声明集（瞒报维度：声明面独有的
  // 文件也要进对齐——「logs 声明但 diff 无且 trace 无」是纯瞒报态）
  const union = [...new Set([...traceWriteSet, ...diffSet, ...(input.declaredFiles ?? [])])].sort();
  const discrepancies: ReconcileDiscrepancy[] = [];

  for (const path of union) {
    const inTrace = traceWriteSet.includes(path);
    const inDiff = diffSet.includes(path);
    const inDeclared = declared?.has(path) ?? false;

    if (inDiff && inTrace) {
      if (declared && !inDeclared) {
        discrepancies.push({ verdict: 'misreported', path, evidence: 'diff 有变更但 logs 未声明（干了没报）' });
      }
      continue;
    }
    if (inDiff && !inTrace) {
      discrepancies.push({ verdict: 'omitted', path, evidence: 'git diff 有变更，trace 无对应 write 工具调用' });
      continue;
    }
    if (!inDiff && inTrace) {
      if (deleted.has(path)) continue; // 写后删除——回滚闭环，不计幻觉
      if (inDeclared) {
        discrepancies.push({ verdict: 'misreported', path, evidence: 'logs 声明修改，git diff 无变更且 trace 有 write——声明与事实不符' });
      } else {
        discrepancies.push({ verdict: 'hallucinated', path, evidence: 'trace 有 write 工具调用，git diff 无变更且无回滚记录' });
      }
      continue;
    }
    // 纯声明面：logs 有、diff 无、trace 无 → 瞒报
    if (!inDiff && !inTrace && inDeclared) {
      discrepancies.push({ verdict: 'misreported', path, evidence: 'logs 声明了变更，git diff 与 trace 均无记录（宣称与实际不符）' });
    }
  }

  const consistencyRate = union.length === 0 ? 1 : 1 - discrepancies.length / union.length;

  return {
    schemaVersion: TRACE_MODEL_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    sessionsReconciled: input.traces.length,
    traceWriteSet,
    diffSet,
    discrepancies,
    consistencyRate: Math.round(consistencyRate * 1000) / 1000,
  };
}

/**
 * 模型层回溯链：推理记录 → 模型 → train_job → datasetHash。
 *
 * @param llmCalls llm-calls.jsonl 记录（provider/model/ts——已有链）
 * @param fingerprints train fingerprint 数组（含 HMAC 验签结果——train 包
 *   verifyTrainFingerprint 产物；core 不依赖 train，由调用方组装传入）
 */
export function buildModelLayerTrace(
  llmCalls: Array<{ ts: string; provider: string; model: string }>,
  fingerprints: Array<{
    trainJobId: string;
    datasetHash: string;
    datasetVersion: string;
    hmacVerified: boolean;
    timestamp: string;
  }>,
): ModelLayerTraceLink[] {
  // 指纹按时间倒序——回溯取「不晚于推理时刻的最新训练」
  const sorted = [...fingerprints].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return llmCalls.map((call) => {
    const match = sorted.find((fp) => fp.timestamp <= call.ts);
    const link: ModelLayerTraceLink = {
      ts: call.ts,
      model: `${call.provider}/${call.model}`,
    };
    if (match) {
      link.trainJobId = match.trainJobId;
      link.fingerprint = {
        trainJobId: match.trainJobId,
        datasetHash: match.datasetHash,
        datasetVersion: match.datasetVersion,
        hmacVerified: match.hmacVerified,
      };
    }
    return link;
  });
}
