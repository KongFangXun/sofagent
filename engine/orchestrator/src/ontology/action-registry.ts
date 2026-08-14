// ============================================================
// action-registry.ts · Ontology Action 注册表（v1.3.4 交付 1）
//
// Ontology Action → 工具映射的单一事实源。
// LLM 调用必须经过 Ontology 层定义的 Action 执行，无法绕过——
// validator.ts 消费本注册表判定「工具是否有 Action 定义」。
//
// 类型复用 @sofagent/ontology 的 OntologyAction（铁律：不重定义）。
// ============================================================
import type { OntologyAction } from '@sofagent/ontology';

/** Action 注册元数据——在 OntologyAction 基础上叠加运行时映射字段 */
export interface ActionRegistration {
  /** Ontology Action 定义（name/nodeId/description/constraints/source） */
  action: OntologyAction;
  /** 映射到的工具名（Action 的执行载体，如 'sf_write' / 'update_entity'） */
  toolName: string;
  /** 工具权限标记（与交付 10 审批模式同源：'r' 只读 / 'rw' 读写） */
  permission: 'r' | 'rw';
  /** 注册时间（ISO 8601） */
  registeredAt: string;
}

/** Action 注册表——actionName → 注册项 */
export class ActionRegistry {
  private readonly byAction = new Map<string, ActionRegistration>();
  private readonly byTool = new Map<string, ActionRegistration>();

  /**
   * 注册 Action → 工具映射。
   *
   * 同一 actionName 重复注册 → 覆盖（幂等）。
   *
   * @param actionName Action 名称（Ontology Action 唯一标识）
   * @param toolName 映射的工具名
   * @param meta 元数据：action 定义体 + permission（默认 'rw' 保守）
   */
  registerAction(
    actionName: string,
    toolName: string,
    meta: { action?: Partial<OntologyAction>; permission?: 'r' | 'rw' } = {},
  ): ActionRegistration {
    const registration: ActionRegistration = {
      action: {
        name: actionName,
        nodeId: meta.action?.nodeId ?? '',
        ...(meta.action?.description !== undefined ? { description: meta.action.description } : {}),
        ...(meta.action?.constraints !== undefined ? { constraints: meta.action.constraints } : {}),
        source: meta.action?.source ?? 'action-registry',
      },
      toolName,
      permission: meta.permission ?? 'rw',
      registeredAt: new Date().toISOString(),
    };
    this.byAction.set(actionName, registration);
    this.byTool.set(toolName, registration);
    return registration;
  }

  /**
   * 按 Action 名解析注册项。
   * @param actionName Action 名称
   * @returns 注册项；未注册返回 undefined
   */
  resolveAction(actionName: string): ActionRegistration | undefined {
    return this.byAction.get(actionName);
  }

  /**
   * 工具反查——该工具是否有 Ontology Action 定义。
   * @param toolName 工具名
   * @returns 注册项；工具无 Action 定义返回 undefined
   */
  actionForTool(toolName: string): ActionRegistration | undefined {
    return this.byTool.get(toolName);
  }

  /**
   * 列出全部注册项（按 actionName 字典序，输出稳定）。
   * @returns 注册项数组
   */
  listActions(): ActionRegistration[] {
    return [...this.byAction.keys()].sort().map((name) => this.byAction.get(name) as ActionRegistration);
  }

  /** 已注册 Action 数量 */
  get size(): number {
    return this.byAction.size;
  }

  /** 清空注册表（仅测试用） */
  clear(): void {
    this.byAction.clear();
    this.byTool.clear();
  }
}

/** 模块级默认注册表（orchestrator 全局共享；测试可 new 独立实例隔离） */
export const globalActionRegistry = new ActionRegistry();
