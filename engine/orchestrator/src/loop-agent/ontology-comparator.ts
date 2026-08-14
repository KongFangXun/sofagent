// ============================================================
// loop-agent/ontology-comparator.ts · L2 Ontology 对比器（v1.3.4 交付 1）
// ============================================================
//
// 节点实际输出（结构化提取后）→ 与 Ontology 预期输出对比 → DiffReport。
//
// 对比逻辑是纯规则驱动（不用 LLM）：
//   - field_missing：Ontology 预期有某字段但实际缺了
//   - value_error：字段有但值不对（预期 vs 实际）
//   - relation_broken：实体间关系断了（该连的没连上）
//
// 输入：提取后的结构化字段 + Ontology 预期定义
// 输出：DiffReport（给 L3 定位器用）
// ============================================================

import type { DiffReport, DiffMismatch } from './diff-report';
import { emptyDiffReport } from './diff-report';
import { extractStructuredOutput, type ExtractionResult, type LlmExtractOptions } from './output-extractor';

/** Ontology 预期输出定义（单个 Action 的预期结构） */
export interface OntologyExpectedOutput {
  /** 预期来源标识（entity/concept 名，写进 DiffReport.expectedSource） */
  source: string;
  /** 预期字段定义（字段名 → 预期值/类型/约束） */
  fields: Record<string, OntologyFieldExpectation>;
  /** 预期实体关系（该有的关系没断——relation_broken 检测用） */
  relations?: OntologyExpectedRelation[];
}

/** 单个字段的预期（类型/枚举/正则约束） */
export interface OntologyFieldExpectation {
  /** 预期类型（'string' | 'number' | 'boolean' | 'object' | 'array'） */
  type?: string;
  /** 预期具体值（精确匹配——值不对 = value_error） */
  value?: unknown;
  /** 预期枚举值（actual 必须在枚举内） */
  enum?: string[];
  /** 预期正则约束（actual 必须匹配） */
  pattern?: string;
  /** 严重程度（默认 error） */
  severity?: 'error' | 'warn';
  /** 是否必需（默认 true——缺失 = field_missing） */
  required?: boolean;
}

/** 预期实体关系（relation_broken 检测用） */
export interface OntologyExpectedRelation {
  /** 起始实体 */
  fromEntity: string;
  /** 关系类型（has_many / belongs_to / depends_on / produces / consumes） */
  relation: string;
  /** 目标实体 */
  toEntity: string;
}

/** 对比器选项 */
export interface ComparatorOptions {
  /** taskId（写入 DiffReport） */
  taskId: string;
  /** LLM 辅助提取选项（传给 output-extractor） */
  llmOptions?: LlmExtractOptions;
}

/**
 * 对比节点实际输出与 Ontology 预期——生成 DiffReport。
 *
 * 流程：
 *   1. extractStructuredOutput：实际输出 → 结构化字段
 *   2. 逐字段对比 Ontology 预期 → field_missing / value_error
 *   3. 关系完整性检查 → relation_broken
 *   4. 汇总为 DiffReport
 *
 * @param actualOutput 节点原始输出文本
 * @param expected Ontology 预期输出定义
 * @param options 对比器选项
 * @returns DiffReport
 */
export async function compareWithOntology(
  actualOutput: string,
  expected: OntologyExpectedOutput,
  options: ComparatorOptions,
): Promise<DiffReport> {
  // 1. 提取结构化字段
  const expectedFieldNames = Object.keys(expected.fields);
  const extraction: ExtractionResult = await extractStructuredOutput(
    actualOutput,
    expectedFieldNames,
    options.llmOptions,
  );

  const mismatches: DiffMismatch[] = [];

  // 2. 逐字段对比
  for (const [fieldName, expectation] of Object.entries(expected.fields)) {
    const actualValue = extraction.fields[fieldName];
    const severity = expectation.severity ?? 'error';
    const required = expectation.required ?? true;

    // field_missing：必需字段缺失
    if (actualValue === undefined || actualValue === null) {
      if (required) {
        mismatches.push({
          type: 'field_missing',
          field: fieldName,
          expected: expectation.type ?? String(expectation.value ?? 'required'),
          severity,
        });
      }
      continue;
    }

    // value_error：值不对
    const valueMismatch = checkFieldValue(fieldName, actualValue, expectation);
    if (valueMismatch !== null) {
      mismatches.push(valueMismatch);
    }
  }

  // 3. 关系完整性检查
  if (expected.relations) {
    for (const rel of expected.relations) {
      // 检查提取的字段中是否有关联证据
      const hasRelation = checkRelation(rel, extraction.fields);
      if (!hasRelation) {
        mismatches.push({
          type: 'relation_broken',
          fromEntity: rel.fromEntity,
          relation: rel.relation,
          toEntity: rel.toEntity,
          severity: 'error',
        });
      }
    }
  }

  return {
    taskId: options.taskId,
    timestamp: new Date().toISOString(),
    expectedSource: expected.source,
    mismatches,
  };
}

/** 检查单个字段的值是否满足预期 */
function checkFieldValue(
  fieldName: string,
  actualValue: unknown,
  expectation: OntologyFieldExpectation,
): DiffMismatch | null {
  const severity = expectation.severity ?? 'error';
  const actualStr = String(actualValue);

  // 精确值匹配
  if (expectation.value !== undefined) {
    const expectedStr = String(expectation.value);
    if (actualStr !== expectedStr) {
      return {
        type: 'value_error',
        field: fieldName,
        expected: expectedStr,
        actual: actualStr,
        severity,
      };
    }
    return null;
  }

  // 枚举匹配
  if (expectation.enum && expectation.enum.length > 0) {
    if (!expectation.enum.includes(actualStr)) {
      return {
        type: 'value_error',
        field: fieldName,
        expected: `enum[${expectation.enum.join('|')}]`,
        actual: actualStr,
        severity,
      };
    }
    return null;
  }

  // 类型匹配
  if (expectation.type) {
    const actualType = getTypeOf(actualValue);
    if (actualType !== expectation.type) {
      return {
        type: 'value_error',
        field: fieldName,
        expected: expectation.type,
        actual: actualType,
        severity,
      };
    }
    return null;
  }

  // 正则匹配
  if (expectation.pattern) {
    const regex = new RegExp(expectation.pattern);
    if (!regex.test(actualStr)) {
      return {
        type: 'value_error',
        field: fieldName,
        expected: `pattern/${expectation.pattern}/`,
        actual: actualStr,
        severity,
      };
    }
    return null;
  }

  return null;
}

/** 获取值的类型名（简化版 typeof） */
function getTypeOf(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

/** 检查关系是否存在于提取的字段中（简化检查——字段值中包含关联实体名） */
function checkRelation(rel: OntologyExpectedRelation, fields: Record<string, unknown>): boolean {
  // 检查字段中是否有引用 toEntity 的值
  for (const value of Object.values(fields)) {
    const valueStr = String(value);
    if (valueStr.includes(rel.toEntity) || valueStr.includes(rel.fromEntity)) {
      return true;
    }
  }
  // 检查是否有以 relation 命名的字段（如 has_many / depends_on）
  if (fields[rel.relation] !== undefined) {
    return true;
  }
  return false;
}

/** 同步版对比（不调 LLM——仅 JSON 解析 + 启发式提取，用于无法 async 的场景） */
export function compareWithOntologySync(
  actualOutput: string,
  expected: OntologyExpectedOutput,
  taskId: string,
): DiffReport {
  // 同步版只做 JSON 解析 + 启发式（不调 LLM）
  // 重用 compareWithOntology 但传 null llmOptions
  // 由于 extractStructuredOutput 是 async，这里手动内联同步逻辑
  let fields: Record<string, unknown> = {};
  const trimmed = actualOutput.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'object' && parsed !== null) {
        fields = parsed as Record<string, unknown>;
      }
    } catch {
      // JSON 解析失败——字段为空
    }
  } else {
    // 启发式提取
    for (const fieldName of Object.keys(expected.fields)) {
      const patterns = [
        new RegExp(`"${fieldName}"\\s*:\\s*"?([^",\\n}]+)"?`, 'i'),
        new RegExp(`${fieldName}\\s*[:=]\\s*"?([^,\\n;]+)"?`, 'i'),
      ];
      for (const pattern of patterns) {
        const match = actualOutput.match(pattern);
        if (match?.[1]) {
          fields[fieldName] = match[1].trim();
          break;
        }
      }
    }
  }

  const mismatches: DiffMismatch[] = [];
  for (const [fieldName, expectation] of Object.entries(expected.fields)) {
    const actualValue = fields[fieldName];
    const severity = expectation.severity ?? 'error';
    const required = expectation.required ?? true;
    if (actualValue === undefined || actualValue === null) {
      if (required) {
        mismatches.push({
          type: 'field_missing',
          field: fieldName,
          expected: expectation.type ?? String(expectation.value ?? 'required'),
          severity,
        });
      }
      continue;
    }
    const valueMismatch = checkFieldValue(fieldName, actualValue, expectation);
    if (valueMismatch !== null) {
      mismatches.push(valueMismatch);
    }
  }

  return {
    taskId,
    timestamp: new Date().toISOString(),
    expectedSource: expected.source,
    mismatches,
  };
}
