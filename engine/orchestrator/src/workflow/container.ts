// ============================================================
// workflow/container.ts · Workflow 运行容器（v1.3.6 交付 ①）
// ============================================================
//
// 外部提交通道——模型层生成的 workflow 从这里进入约束层：
//   提交（YAML/JSON 文本）→ schema 校验（单一事实源 workflow.schema.json）
//   → parser 解析（DAG/节点/审阅协议字段）→ dag-runner 加载执行
//
// 设计约束：
// - 非法 workflow 返回结构化错误（WorkflowSubmitError），绝不 crash
// - merge_criteria / approver 校验在此收口（schema 结构校验 + 语义校验）
// - 🔴 v1.3.7 沙箱宿主位：执行入口经 ContainerDeps.runner 注入——
//   本版默认 runDAG（主仓执行），v1.3.7 换沙箱 runner 零改动容器接口
// - 运行容器整体可作为 DSH ctx.workflowEngine 的提供方插件（见 dsh-seam.ts）
// ============================================================

import { validateAgainstSchema, type JsonSchema } from '../ontology/schema/index';
import workflowSchemaJson from './schema/workflow.schema.json';
import {
  parseWorkflowYaml,
  WorkflowParseError,
  type ParsedWorkflow,
} from '../workflow-parser';
import type { MergeCriterion, WorkflowApprover } from '../workflow-parser';
import { createDshSeamConverter, type DshSeamConverter } from './dsh-seam';

/** workflow JSON Schema（单一事实源——外部按此生成，容器按此校验） */
export const WORKFLOW_SCHEMA = workflowSchemaJson as JsonSchema;

/** 容器结构化错误（非法提交不 crash，返回可机读的错误清单） */
export class WorkflowSubmitError extends Error {
  /** 逐项错误（schema 违规 + 语义违规，含 JSON 路径） */
  readonly issues: string[];

  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = 'WorkflowSubmitError';
    this.issues = issues.length > 0 ? issues : [message];
  }
}

/** 容器提交入参 */
export interface WorkflowSubmitInput {
  /** workflow 文本（YAML 或 JSON——YAML 是 JSON 超集，统一走 YAML 解析） */
  workflow: string;
  /**
   * 执行器注入（v1.3.7 沙箱宿主位）。
   * 缺省走 runDAG（主仓执行）；沙箱版容器传入沙箱 runner 即可，
   * 容器接口不变——「外部 workflow 届时在沙箱内执行」的宿主位。
   */
  runner?: (parsed: ParsedWorkflow, taskDesc: string) => Promise<unknown>;
}

/** 容器提交句柄——校验/解析已完成，run() 才真正执行 */
export interface WorkflowContainerHandle {
  /** 解析后的 workflow（含审阅协议字段） */
  parsed: ParsedWorkflow;
  /** merge_criteria 校验结论（空数组 = 无条件或全部合法） */
  criteriaIssues: string[];
  /** 执行 workflow（经注入 runner 或默认 runDAG） */
  run: (taskDesc: string) => Promise<unknown>;
  /** DSH workflow seam 转换器契约位（真实互转等 DSH 正式版） */
  seam: DshSeamConverter;
}

/**
 * 对 merge_criteria 做语义校验（schema 只校结构，语义约束在此）。
 *
 * @param criteria merge_criteria 数组（缺省视为无条件——合法）
 * @returns 违规项列表（空数组 = 通过）
 */
export function validateMergeCriteria(criteria: unknown): string[] {
  const issues: string[] = [];
  if (criteria === undefined || criteria === null) return issues;
  if (!Array.isArray(criteria)) {
    issues.push('merge_criteria: 必须是数组（可组合验收条件列表）');
    return issues;
  }
  criteria.forEach((c, idx) => {
    const criterion = c as Partial<MergeCriterion> | null;
    if (typeof criterion !== 'object' || criterion === null) {
      issues.push(`merge_criteria[${idx}]: 不是对象`);
      return;
    }
    const kind = criterion.kind;
    // kind 专属必填字段（Benchmark 判定引擎结构对齐）
    if (kind === 'grep_absent' && typeof criterion.pattern !== 'string') {
      issues.push(`merge_criteria[${idx}] (grep_absent): 缺少 pattern（不得出现的模式）`);
    }
    if (kind === 'schema_valid' && typeof criterion.schema_ref !== 'string') {
      issues.push(`merge_criteria[${idx}] (schema_valid): 缺少 schema_ref（校验目标 Schema）`);
    }
    if (
      (kind === 'business_approval' || kind === 'data_compliance') &&
      typeof criterion.approver_role !== 'string'
    ) {
      issues.push(
        `merge_criteria[${idx}] (${kind}): 缺少 approver_role（业务审批/数据合规必须声明审批角色，对齐 promote_ab 人审语义）`,
      );
    }
  });
  return issues;
}

/**
 * 对 approver 做语义校验（对齐 v1.3.5 promote_ab 强制人审语义）。
 *
 * @param approver approver 对象（缺省视为默认强制人审——合法）
 * @returns 违规项列表（空数组 = 通过）
 */
export function validateApprover(approver: unknown): string[] {
  const issues: string[] = [];
  if (approver === undefined || approver === null) return issues;
  if (typeof approver !== 'object' || Array.isArray(approver)) {
    issues.push('approver: 必须是对象（{ id, kind?, required?, note? }）');
    return issues;
  }
  const ap = approver as Partial<WorkflowApprover>;
  if (typeof ap.id !== 'string' || ap.id.trim() === '') {
    issues.push('approver.id: 必填且非空（审阅批准者标识）');
  }
  return issues;
}

/**
 * 运行容器——外部提交 → schema 校验 → parser 解析 →（run 时）dag-runner 执行。
 *
 * @param input 提交入参（workflow 文本 + 可选 runner 注入）
 * @returns 容器句柄
 * @throws WorkflowSubmitError 非法 workflow（结构化错误清单，不 crash）
 */
export function submitWorkflow(input: WorkflowSubmitInput): WorkflowContainerHandle {
  if (typeof input.workflow !== 'string' || input.workflow.trim() === '') {
    throw new WorkflowSubmitError('workflow 提交内容为空');
  }

  // 1. schema 校验（单一事实源）——先于 parser 的结构校验，
  //    让外部提交方拿到 JSON Schema 路径级错误（机器可机读）
  const schemaIssues: string[] = [];
  try {
    const parsedForSchema = parseWorkflowYaml(input.workflow);
    const schemaDoc = parsedToSchemaDoc(parsedForSchema);
    const schemaResult = validateAgainstSchema(schemaDoc, WORKFLOW_SCHEMA);
    schemaIssues.push(...schemaResult.errors);
  } catch (err) {
    if (err instanceof WorkflowParseError) {
      throw new WorkflowSubmitError(`workflow 结构非法：${err.message}`, [err.message]);
    }
    throw new WorkflowSubmitError(
      `workflow 解析失败：${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 2. parser 解析（含审阅协议字段提取）
  let parsed: ParsedWorkflow;
  try {
    parsed = parseWorkflowYaml(input.workflow);
  } catch (err) {
    throw new WorkflowSubmitError(
      `workflow 解析失败：${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 3. 审阅协议语义校验（merge_criteria / approver）
  const criteriaIssues = validateMergeCriteria(parsed.mergeCriteria);
  const approverIssues = validateApprover(parsed.approver);

  const allIssues = [...schemaIssues, ...criteriaIssues, ...approverIssues];
  if (allIssues.length > 0) {
    throw new WorkflowSubmitError(
      `workflow 校验未通过（${allIssues.length} 项）：${allIssues[0]}`,
      allIssues,
    );
  }

  // 4. 构造句柄——run() 延迟到调用时才真正执行
  const runner = input.runner;
  return {
    parsed,
    criteriaIssues,
    run: async (taskDesc: string) => {
      if (runner) {
        // 注入 runner（v1.3.7 沙箱宿主位）
        return runner(parsed, taskDesc);
      }
      // 默认执行路径：dag-runner（runDAG 内部重新走 parseWorkflowYaml——
      // 同一文本同一事实源，零行为差异）
      const { runDAG } = await import('../dag-runner');
      return runDAG(taskDesc, input.workflow);
    },
    seam: createDshSeamConverter(parsed),
  };
}

/**
 * ParsedWorkflow → schema 校验文档（把解析结果还原为 schema 可校验形态）。
 * mergeCriteria / approver 原样保留（parser 透传原始结构）。
 */
function parsedToSchemaDoc(parsed: ParsedWorkflow): Record<string, unknown> {
  return {
    workflow: {
      name: parsed.name,
      description: parsed.description,
      nodes: parsed.nodes.map((n) => ({
        id: n.id,
        agent: n.agent,
        task: n.task,
        ...(n.depends_on.length > 0 ? { depends_on: n.depends_on } : {}),
        type: n.type,
        ...(n.hitl !== undefined ? { hitl: n.hitl } : {}),
      })),
      ...(parsed.mergeCriteria !== undefined ? { merge_criteria: parsed.mergeCriteria } : {}),
      ...(parsed.approver !== undefined ? { approver: parsed.approver } : {}),
    },
  };
}

export type { MergeCriterion, WorkflowApprover };
