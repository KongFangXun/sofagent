// ============================================================
// loop-agent/diff-report.ts · L2 差异报告格式（v1.3.7 交付 1）
// ============================================================
//
// 节点实际输出 → 结构化提取 → 与 Ontology 预期对比 → 差异报告。
// DiffReport 是 L3 定位器的输入（差异 + 上下文 → LLM 推理定位错误源）。
//
// 三类 mismatch（严格按 dev-prompt interface）：
//   field_missing  预期有某字段但实际缺了
//   value_error    字段有但值不对
//   relation_broken 实体间关系断了（该连的没连上）
// ============================================================

/** 单条差异（三类 union——严格按 dev-prompt interface 定义） */
export type DiffMismatch =
  | { type: 'field_missing'; field: string; expected: string; severity: 'error' | 'warn' }
  | { type: 'value_error'; field: string; expected: string; actual: string; severity: 'error' | 'warn' }
  | { type: 'relation_broken'; fromEntity: string; relation: string; toEntity: string; severity: 'error' | 'warn' };

/** L2 差异报告（给 L3 定位器用） */
export interface DiffReport {
  /** 关联任务 ID */
  taskId: string;
  /** ISO 8601 时间戳 */
  timestamp: string;
  /** 对比的 Ontology 预期来源（entity/concept 名） */
  expectedSource: string;
  /** 差异列表 */
  mismatches: DiffMismatch[];
}

/** 构造空差异报告（L2 判通过时用） */
export function emptyDiffReport(taskId: string, expectedSource: string): DiffReport {
  return {
    taskId,
    timestamp: new Date().toISOString(),
    expectedSource,
    mismatches: [],
  };
}

/** 判断差异报告是否通过（无 error 级别 mismatch） */
export function isDiffPass(report: DiffReport): boolean {
  return report.mismatches.length === 0;
}

/** 判断差异报告是否有 error 级别 mismatch */
export function hasErrorMismatch(report: DiffReport): boolean {
  return report.mismatches.some((m) => m.severity === 'error');
}

/** 统计差异报告摘要（调试/日志用） */
export function summarizeDiff(report: DiffReport): string {
  if (report.mismatches.length === 0) {
    return `DiffReport（${report.expectedSource}）：无差异`;
  }
  const errors = report.mismatches.filter((m) => m.severity === 'error').length;
  const warns = report.mismatches.filter((m) => m.severity === 'warn').length;
  return `DiffReport（${report.expectedSource}）：${report.mismatches.length} 条差异（${errors} error / ${warns} warn）`;
}
