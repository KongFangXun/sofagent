// ============================================================
// ontology/types.ts · Ontology 统一层类型定义
// v1.3.1 从 sofagent/audit/src/ontology/types.ts 迁出
// ============================================================

/**
 * Ontology 对象——来自 entities/ 页面的 frontmatter relations
 */
export interface OntologyObject {
  /** 对象名称（如 "FDE Sub Agent"） */
  name: string;
  /** 对象类型（如 "agent" / "node" / "skill"） */
  type: string;
  /** frontmatter relations 字段 */
  relations: {
    has_many?: string[];
    belongs_to?: string[];
    depends_on?: string[];
    produces?: string[];
    consumes?: string[];
  };
  /** 来源文件路径 */
  source: string;
}

/**
 * Ontology 动作——来自 Workflow 节点的 actions 声明
 */
export interface OntologyAction {
  /** 动作名称（如 "approve" / "reject"） */
  name: string;
  /** 所属节点 ID */
  nodeId: string;
  /** 动作描述 */
  description?: string;
  /** 约束条件 */
  constraints?: Record<string, unknown>;
  /** 来源文件路径 */
  source: string;
}

/**
 * Ontology 约束——来自 A15 约束验证
 */
export interface OntologyConstraint {
  /** 约束类型 */
  type: 'allowed_action' | 'domain_access' | 'rate_limit' | 'custom';
  /** 约束目标 */
  target: string;
  /** 约束规则描述 */
  rule: string;
  /** 严重程度 */
  severity: 'error' | 'warn' | 'info';
  /** 来源 */
  source: string;
}

/**
 * 合并后的完整 Ontology
 */
export interface MergedOntology {
  /** 合并时间戳 */
  mergedAt: string;
  /** 版本信息 */
  version: string;
  /** 对象列表 */
  objects: OntologyObject[];
  /** 动作列表 */
  actions: OntologyAction[];
  /** 约束列表 */
  constraints: OntologyConstraint[];
  /** 合并统计 */
  stats: {
    totalObjects: number;
    totalActions: number;
    totalConstraints: number;
    sources: string[];
  };
}
