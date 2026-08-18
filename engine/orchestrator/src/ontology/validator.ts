// ============================================================
// validator.ts · Ontology 执行前校验（v1.3.7 交付 1）
//
// 「LLM 工具调用必须经 Ontology 层」的落地点：
// 工具执行前查 ActionRegistry——
//   有 Action 定义 → PASS（verdict 携带 actionType 供审计报告引用）
//   无 Action 定义 → 按策略：默认 WARN「未注册 Action」（不破坏既有行为）；
//                    strict 模式 → FAIL 拦截（opt-in，默认 false）
//
// 消费方：tools.ts wrapToolsWithGate 的可选 ontologyValidator 参数——
// gate 判定通过后、工具执行前再过一道 Ontology Action 校验。
// ============================================================

import type { ActionRegistry } from './action-registry';

/** Ontology 校验判定三态 */
export type OntologyVerdictStatus = 'PASS' | 'WARN' | 'FAIL';

/** Ontology 校验判定结果 */
export interface OntologyVerdict {
  /** 判定状态：PASS（有 Action 定义）/ WARN（未注册，非 strict）/ FAIL（未注册，strict） */
  status: OntologyVerdictStatus;
  /** 审计引用名（gate verdict 的 ruleName 用此值——审计报告天然引用 Ontology Action 定义） */
  ruleName: 'ontology-action';
  /** Action 类型/名称（有定义时；供审计报告引用） */
  actionType?: string;
  /** 工具权限标记（有定义时，继承注册项） */
  permission?: 'r' | 'rw';
  /** 人类可读判定理由（gate details 引用） */
  reason: string;
}

/** 校验策略选项 */
export interface OntologyValidatorOptions {
  /**
   * 严格模式：未注册 Action 的工具调用直接 FAIL 拦截。
   * 默认 false —— 非 strict 时未注册仅 WARN，不破坏既有行为（铁律：不破坏）。
   */
  strict?: boolean;
}

/**
 * 校验一次工具调用是否具备 Ontology Action 定义。
 *
 * @param toolName 被调用的工具名
 * @param args 工具调用参数（本版不参与判定，保留签名供未来参数级约束扩展）
 * @param registry Action 注册表（Ontology Action → 工具映射单一事实源）
 * @param options 校验策略（strict 默认 false）
 * @returns OntologyVerdict
 */
export function validateToolCall(
  toolName: string,
  args: Record<string, unknown>,
  registry: ActionRegistry,
  options: OntologyValidatorOptions = {},
): OntologyVerdict {
  void args; // 保留参数：未来按参数做 Action 级约束（v1.4.0）
  const strict = options.strict === true;

  const registration = registry.actionForTool(toolName);
  if (registration) {
    return {
      status: 'PASS',
      ruleName: 'ontology-action',
      actionType: registration.action.name,
      permission: registration.permission,
      reason: `Action "${registration.action.name}" 已注册（工具 ${toolName}，权限 ${registration.permission}）`,
    };
  }

  // 无 Action 定义——按策略决定 WARN / FAIL
  const reason = `工具 ${toolName} 未在 Ontology Action 注册表登记${strict ? '（strict 模式拦截）' : '（未注册 Action）'}`;
  return {
    status: strict ? 'FAIL' : 'WARN',
    ruleName: 'ontology-action',
    reason,
  };
}

/** Ontology 校验器——绑定 registry + 策略的闭包（供 wrapToolsWithGate 消费） */
export type OntologyValidator = (
  toolName: string,
  args: Record<string, unknown>,
) => OntologyVerdict;

/**
 * 创建绑定注册表与策略的校验器闭包。
 *
 * @param registry Action 注册表
 * @param options 校验策略（strict 默认 false）
 * @returns OntologyValidator 闭包
 */
export function createOntologyValidator(
  registry: ActionRegistry,
  options: OntologyValidatorOptions = {},
): OntologyValidator {
  return (toolName: string, args: Record<string, unknown>) =>
    validateToolCall(toolName, args, registry, options);
}
