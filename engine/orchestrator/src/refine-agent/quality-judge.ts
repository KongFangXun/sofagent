// ============================================================
// refine-agent/quality-judge.ts · L2 质量判定器（v1.3.6 交付 T04）
// ============================================================
//
// Refine Agent 的 L2 判定器——接口对齐 loop-agent/diff-report.ts 的 DiffReport，
// 这样 Refine 可以无缝复用 loop-agent 的 L3 定位 / L4 修复 / L5 收敛（它们都吃 DiffReport）。
//
// 核心差异（与 ontology-comparator 对比）：
//   - ontology-comparator：对比实际输出 vs Ontology 预期 → field_missing / value_error / relation_broken
//   - quality-judge：对节点输出跑质量规则集 → 转译为 DiffReport 的三类 mismatch
//
// 语义映射（quality → DiffReport）：
//   - has_example 失败     → field_missing（缺示例字段）
//   - max_length 失败      → value_error（值超限）
//   - min_few_shot 失败    → field_missing（缺 few-shot）
//   - required_keyword 失败 → value_error（值缺关键词）
//   - forbidden_pattern 命中 → value_error（值含禁止模式）
//   - json_valid 失败      → value_error（值非合法 JSON）
//
// 这样 L3 error-localizer 可以基于 DiffReport 继续工作，无需修改。
// ============================================================

import type { DiffReport, DiffMismatch } from '../loop-agent/diff-report';
import type { OnboardRunOutcome } from '../loop-agent/driver';
import type { JudgeVerdict } from '../loop-agent/judge';
import { extractStructuredOutput, type LlmExtractOptions } from '../loop-agent/output-extractor';
import type {
  QualityRuleSet,
  QualityCheckResult,
  QualityRule,
} from './quality-rule-set';
import { matchQualityRules, summarizeQualityResults } from './quality-rule-set';

/** 质量判定器的输入字段名集合（质量规则会检查这些字段） */
export const QUALITY_TARGET_FIELDS = [
  'output',
  'skill_description',
  'skill_few_shot',
] as const;

/** 质量判定器选项 */
export interface QualityJudgeOptions {
  /** taskId（写入 DiffReport） */
  taskId: string;
  /** 质量规则集（缺省加载内置三规则） */
  ruleSet?: QualityRuleSet;
  /** LLM 辅助提取选项（可选——用于从非结构化输出中提取字段） */
  llmOptions?: LlmExtractOptions;
}

/**
 * L2 质量判定——对节点输出跑质量规则集，生成 DiffReport。
 *
 * 流程：
 *   1. 从运行产出提取目标字段（output / skill_description / skill_few_shot）
 *   2. 对字段跑质量规则集（matchQualityRules）
 *   3. 把质量检查结果转译为 DiffReport 的三类 mismatch
 *   4. 汇总为 DiffReport（给 L3 定位器用——复用 loop-agent 引擎）
 *
 * 接口对齐 loop-agent/ontology-comparator 的 compareWithOntology，
 * 输出统一为 DiffReport，这样 Refine 的 L3-L5 可以直接复用 loop-agent 引擎。
 *
 * @param outcome 运行产出（取 outcome.output 作为主要检查对象）
 * @param taskId 任务 ID（可从 outcome 传入，也可单独传）
 * @param options 判定选项（ruleSet / llmOptions）
 * @returns DiffReport
 */
export async function judgeQuality(
  outcome: OnboardRunOutcome,
  taskId: string,
  options: QualityJudgeOptions,
): Promise<DiffReport> {
  const outputText = outcome.output ?? outcome.stdout ?? '';
  const fieldNames = [...QUALITY_TARGET_FIELDS];

  // 1. 从产出提取目标字段
  const extraction = await extractStructuredOutput(outputText, fieldNames, options.llmOptions);

  // 把提取结果统一为 string（quality-rule-set 需要 NodeOutputFields = Record<string, string>）
  const fields: Record<string, string> = {};
  for (const name of fieldNames) {
    const val = extraction.fields[name];
    if (typeof val === 'string') {
      fields[name] = val;
    } else if (val !== undefined && val !== null) {
      fields[name] = JSON.stringify(val);
    } else {
      fields[name] = '';
    }
  }

  // 如果提取到额外字段也保留（用于自定义规则）
  for (const [k, v] of Object.entries(extraction.fields)) {
    if (!fields[k]) {
      fields[k] = typeof v === 'string' ? v : v != null ? JSON.stringify(v) : '';
    }
  }

  // output 字段兜底：如果没有提取到 output，用原始输出文本
  if (!fields['output'] && outputText) {
    fields['output'] = outputText;
  }

  // 2. 对字段跑质量规则集
  const ruleSet = options.ruleSet;
  if (!ruleSet) {
    // 无规则集 → 空差异报告（通过）
    return {
      taskId: options.taskId ?? taskId,
      timestamp: new Date().toISOString(),
      expectedSource: 'quality-rule-set(empty)',
      mismatches: [],
    };
  }

  const results = matchQualityRules(fields, ruleSet);

  // 3. 把质量检查结果转译为 DiffReport mismatch
  const mismatches: DiffMismatch[] = [];
  for (const result of results) {
    if (!result.passed) {
      const rule = findRuleById(ruleSet, result.ruleId);
      const mismatch = qualityResultToDiffMismatch(result, rule);
      mismatches.push(mismatch);
    }
  }

  return {
    taskId: options.taskId ?? taskId,
    timestamp: new Date().toISOString(),
    expectedSource: `quality-rule-set(${summarizeQualityResults(results)})`,
    mismatches,
  };
}

/**
 * 把质量检查结果转译为 DiffReport mismatch。
 *
 * 语义映射：
 *   - has_example / min_few_shot 失败 → field_missing（缺字段）
 *   - 其他失败 → value_error（值不对）
 *
 * @param result 质量检查结果（失败）
 * @param rule 关联的质量规则
 * @returns DiffMismatch
 */
export function qualityResultToDiffMismatch(
  result: QualityCheckResult,
  rule: QualityRule | undefined,
): DiffMismatch {
  const severity = result.severity;
  const field = result.targetField;

  // has_example / min_few_shot → field_missing（字段缺失语义）
  if (result.check === 'has_example' || result.check === 'min_few_shot') {
    const expected = rule?.params.minCount != null
      ? `few-shot ≥ ${rule.params.minCount}`
      : 'example / 示例';
    return {
      type: 'field_missing',
      field,
      expected,
      severity,
    };
  }

  // 其他检查 → value_error（值错误语义）
  return {
    type: 'value_error',
    field,
    expected: rule?.description ?? result.check,
    actual: result.detail,
    severity,
  };
}

/** 在规则集中按 ID 查找规则 */
function findRuleById(ruleSet: QualityRuleSet, ruleId: string): QualityRule | undefined {
  return ruleSet.rules.find((r) => r.id === ruleId);
}

/**
 * 从质量判定结果生成 L1 修复反馈文本。
 *
 * Refine 的 L2 判定结果需要反馈给 Agent 修复——与 Onboard 的 fixer 类似，
 * 但反馈内容是质量规则违反的描述（而非 crash/error 的工程信息）。
 *
 * @param diffReport 质量判定产生的 DiffReport
 * @param verdict L1 判定结果（passed/error/crash/timeout）
 * @returns 修复反馈文本
 */
export function qualityFeedbackText(
  diffReport: DiffReport,
  verdict: JudgeVerdict,
): string {
  if (diffReport.mismatches.length === 0) {
    // 无质量差异 → 不需要反馈
    return '';
  }

  const lines: string[] = [
    `## 质量修复指引（L1=${verdict.state}）`,
    '以下质量规则未通过，请针对性改进：',
    '',
  ];

  for (const m of diffReport.mismatches) {
    switch (m.type) {
      case 'field_missing':
        lines.push(`- [质量] 字段「${m.field}」缺失预期：${m.expected} [${m.severity}]`);
        break;
      case 'value_error':
        lines.push(`- [质量] 字段「${m.field}」值不符：预期「${m.expected}」，实际「${m.actual}」 [${m.severity}]`);
        break;
      case 'relation_broken':
        lines.push(`- [质量] ${m.fromEntity} →${m.relation}→ ${m.toEntity} 关系断裂 [${m.severity}]`);
        break;
    }
  }

  return lines.join('\n');
}
