// ============================================================
// execution-state/schema.ts · v1.5.8 章一 · 节点状态 schema 注册表
// ============================================================
// SKILL.state 采纳形态（arXiv:2608.26263）：节点执行从「消息历史滚雪球」
// 改为「结构化状态机」——每步只带 P（不可变技能说明）+ Σt（结构化状态）+
// ot（最新观察），模型输出 ΔΣt（状态补丁），运行时代码确定性合并
// Σt+1 = Σt ⊕ ΔΣt，推理轨迹合并后即弃。
//
// 本文件 = 节点类型 → schema 映射注册表（基础六字段 + 领域扩展）。
// schema 是领域资产沉淀进 SKILL/ 设计文档（见 SKILL/state-machine-design.md），
// 非任务级配置——新节点类型注册即用。
// ============================================================

/** 节点类型标识（注册表主键） */
export type NodeKind =
  | 'engineer'
  | 'checker'
  | 'reviewer'
  | 'refine-agent'
  | 'long-task'; // 通用长任务（文档批处理/数据处理等默认形态）

/** 字段规格——注册表条目的原子单元 */
export interface FieldSpec {
  /** 字段名（Σt 顶层键） */
  name: string;
  /** 值类型描述（文档面；运行时校验按 validator） */
  type: 'string[]' | 'object' | 'object[]' | 'record';
  /** 语义说明（进 SKILL/ 设计文档与 prompt 注入） */
  description: string;
  /** 合法性校验（ΔΣt 合并前执行；false = 拒绝该补丁） */
  validator?: (value: unknown) => boolean;
  /** 领域扩展字段（非基础六字段） */
  domain?: boolean;
}

/** 节点 schema——基础六字段 + 领域扩展 */
export interface NodeStateSchema {
  kind: NodeKind;
  /** 基础六字段（全节点通用底座） */
  base: FieldSpec[];
  /** 领域扩展字段（各节点私有） */
  domain: FieldSpec[];
}

// ── 基础六字段（全节点通用，devlog 节点类型表「通用长任务」行 = 仅此六字段）──
const BASE_SIX: FieldSpec[] = [
  {
    name: 'goal',
    type: 'string[]',
    description: '本节点任务目标',
    validator: (v) => typeof v === 'string' || Array.isArray(v),
  },
  {
    name: 'done',
    type: 'string[]',
    description: '已完成步骤（带结果摘要）',
    validator: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string'),
  },
  {
    name: 'todo',
    type: 'string[]',
    description: '待办步骤',
    validator: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string'),
  },
  {
    name: 'facts',
    type: 'string[]',
    description: '工具观察到的关键事实（不含原始输出）',
    validator: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string'),
  },
  {
    name: 'files',
    type: 'string[]',
    description: '已改动文件路径',
    validator: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string'),
  },
  {
    name: 'blockers',
    type: 'string[]',
    description: '阻塞项与绕行决策',
    validator: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string'),
  },
];

const isStringArray = (v: unknown): boolean =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

// ── 领域扩展字段（devlog 节点类型 schema 扩展表）──
const ENGINEER_DOMAIN: FieldSpec[] = [
  {
    name: 'tests',
    type: 'object',
    description: '测试状态 {pass, fail, skipped}',
    domain: true,
    validator: (v) =>
      !!v && typeof v === 'object' &&
      ['pass', 'fail', 'skipped'].every((k) => typeof (v as Record<string, unknown>)[k] === 'number'),
  },
  {
    name: 'reviewComments',
    type: 'object[]',
    description: '审查意见回链 [{file, line, status}]',
    domain: true,
    validator: (v) =>
      Array.isArray(v) && v.every((x) => !!x && typeof x === 'object' && typeof (x as Record<string, unknown>)['file'] === 'string'),
  },
];

const CHECKER_DOMAIN: FieldSpec[] = [
  {
    name: 'checkRuns',
    type: 'object[]',
    description: '规则判定 [{rule, verdict, evidence}]（留状态不留原始日志）',
    domain: true,
    validator: (v) =>
      Array.isArray(v) && v.every((x) => !!x && typeof x === 'object' && typeof (x as Record<string, unknown>)['rule'] === 'string'),
  },
  {
    name: 'falsePositives',
    type: 'string[]',
    description: '误报清单',
    domain: true,
    validator: isStringArray,
  },
];

const REVIEWER_DOMAIN: FieldSpec[] = [
  {
    name: 'issuesBySeverity',
    type: 'object',
    description: '问题分级实时账 {p0, p1, p2}',
    domain: true,
    validator: (v) =>
      !!v && typeof v === 'object' &&
      ['p0', 'p1', 'p2'].every((k) => typeof (v as Record<string, unknown>)[k] === 'number'),
  },
  {
    name: 'coveredFiles',
    type: 'string[]',
    description: '已覆盖文件（覆盖度账）',
    domain: true,
    validator: isStringArray,
  },
];

const REFINE_DOMAIN: FieldSpec[] = [
  {
    name: 'qualityScores',
    type: 'object[]',
    description: '质量分曲线 [{round, score}]',
    domain: true,
    validator: (v) =>
      Array.isArray(v) && v.every((x) => !!x && typeof x === 'object' && typeof (x as Record<string, unknown>)['score'] === 'number'),
  },
  {
    name: 'triedStrategies',
    type: 'string[]',
    description: '已试策略防重复（对齐 failure-ledger 精神）',
    domain: true,
    validator: isStringArray,
  },
];

// ── 注册表本体 ──
const REGISTRY: Record<NodeKind, NodeStateSchema> = {
  engineer: { kind: 'engineer', base: BASE_SIX, domain: ENGINEER_DOMAIN },
  checker: { kind: 'checker', base: BASE_SIX, domain: CHECKER_DOMAIN },
  reviewer: { kind: 'reviewer', base: BASE_SIX, domain: REVIEWER_DOMAIN },
  'refine-agent': { kind: 'refine-agent', base: BASE_SIX, domain: REFINE_DOMAIN },
  'long-task': { kind: 'long-task', base: BASE_SIX, domain: [] },
};

/** 取节点 schema（未注册 kind 抛错——fail-closed，禁静默回退通用形态） */
export function getSchema(kind: NodeKind): NodeStateSchema {
  const schema = REGISTRY[kind];
  if (!schema) throw new Error(`[execution-state] 未注册的节点类型: ${kind}（已注册: ${Object.keys(REGISTRY).join(', ')}）`);
  return schema;
}

/** 全部已注册节点类型（文档/诊断面） */
export function listNodeKinds(): NodeKind[] {
  return Object.keys(REGISTRY) as NodeKind[];
}

/** 初始化某类节点的 Σ0（基础六字段 + 领域字段全空态） */
export function initialState(kind: NodeKind, goal: string): Record<string, unknown> {
  const schema = getSchema(kind);
  const state: Record<string, unknown> = {};
  for (const f of [...schema.base, ...schema.domain]) {
    state[f.name] = f.type === 'string[]' ? [] : f.type === 'object' ? {} : [];
  }
  state['goal'] = goal; // goal 允许字符串形态（单目标直写）
  return state;
}
