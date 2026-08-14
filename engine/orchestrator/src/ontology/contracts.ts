// ============================================================
// contracts.ts · Ontology 内核契约四类（v1.3.4 交付 1）
//
// 设计来源：Palantir §3.5 启发——四类不可省的建模骨架：
//   CORE-OBJ  对象契约：entity/concept 是什么（name/type/properties/required）
//   CORE-ACT  动作契约：能对对象做什么（Action → 工具映射 + 约束）
//   CORE-LNK  链接契约：对象之间如何关联（direction + cardinality 基数）
//   CORE-STM  状态机契约：对象生命周期状态迁移（本版只到框架）
//
// 四类契约是所有 Ontology 校验的骨架约束源：
//   - schema/*.json（JSON Schema）是 CORE-OBJ / CORE-LNK 的机器可读形态
//   - action-registry 是 CORE-ACT 的运行时形态
//   - CORE-STM 本版提供类型定义 + 注册接口，完整状态机引擎留 v1.4.0
// ============================================================

/** 内核契约四类标识 */
export type CoreContract = 'CORE-OBJ' | 'CORE-ACT' | 'CORE-LNK' | 'CORE-STM';

/** 契约元数据——契约名 + 一句话语义（供审计/文档引用） */
export interface ContractMeta {
  /** 契约标识 */
  id: CoreContract;
  /** 契约名称 */
  title: string;
  /** 一句话语义说明 */
  description: string;
}

/** 内核契约四类清单（单一事实源——顺序即标准枚举序） */
export const CORE_CONTRACTS: readonly ContractMeta[] = [
  {
    id: 'CORE-OBJ',
    title: '对象契约',
    description: '对象必须有 name + type，属性声明须含 properties/required——对应 entity.schema.json / concept.schema.json',
  },
  {
    id: 'CORE-ACT',
    title: '动作契约',
    description: '动作必须映射到具体工具并声明约束——对应 action-registry.ts（Action → 工具映射）',
  },
  {
    id: 'CORE-LNK',
    title: '链接契约',
    description: '链接必须声明 direction（方向）+ cardinality（基数）——对应 relations.schema.json',
  },
  {
    id: 'CORE-STM',
    title: '状态机契约',
    description: '对象生命周期状态迁移须有明确的合法状态集合与迁移规则——本版仅框架（v1.4.0 补全状态机引擎）',
  },
] as const;

/** 关系方向（CORE-LNK：链接必须有方向） */
export type RelationDirection = 'outgoing' | 'incoming' | 'bidirectional';

/** 关系基数（CORE-LNK：链接必须有基数约束） */
export type RelationCardinality = 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';

/** 状态机定义（CORE-STM 框架——类型骨架，完整引擎 v1.4.0） */
export interface StateMachineContract {
  /** 契约归属对象类型（如 'entity'） */
  objectType: string;
  /** 合法状态集合（如 ['draft', 'active', 'archived']） */
  states: string[];
  /** 初始状态（必须 ∈ states） */
  initialState: string;
  /** 合法迁移规则：from → 可达的 to 集合 */
  transitions: Record<string, string[]>;
}

/** 状态机注册表——CORE-STM 本版只提供注册/查询接口，不实现迁移执行引擎 */
const stateMachineRegistry = new Map<string, StateMachineContract>();

/**
 * 注册一个状态机契约（CORE-STM 框架）。
 *
 * 校验最小骨架约束：initialState 必须 ∈ states；transitions 的 from/to 必须 ∈ states。
 * 完整迁移执行引擎（迁移前钩子 / 审计 / 非法迁移拦截）留 v1.4.0 补全。
 *
 * @param contract 状态机契约定义
 * @throws 骨架约束校验失败（initialState/transitions 引用未知状态）
 */
export function registerStateMachine(contract: StateMachineContract): void {
  const stateSet = new Set(contract.states);
  if (!stateSet.has(contract.initialState)) {
    throw new Error(
      `CORE-STM 契约校验失败：initialState "${contract.initialState}" 不在 states 集合中（objectType=${contract.objectType}）`,
    );
  }
  for (const [from, targets] of Object.entries(contract.transitions)) {
    if (!stateSet.has(from)) {
      throw new Error(`CORE-STM 契约校验失败：迁移起点 "${from}" 不在 states 集合中（objectType=${contract.objectType}）`);
    }
    for (const to of targets) {
      if (!stateSet.has(to)) {
        throw new Error(`CORE-STM 契约校验失败：迁移终点 "${to}" 不在 states 集合中（objectType=${contract.objectType}）`);
      }
    }
  }
  stateMachineRegistry.set(contract.objectType, contract);
}

/**
 * 查询某对象类型的状态机契约。
 * @param objectType 对象类型
 * @returns 状态机契约；未注册返回 undefined
 */
export function getStateMachine(objectType: string): StateMachineContract | undefined {
  return stateMachineRegistry.get(objectType);
}

/** 清空状态机注册表（仅测试用） */
export function clearStateMachineRegistry(): void {
  stateMachineRegistry.clear();
}
