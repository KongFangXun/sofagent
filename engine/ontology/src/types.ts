// ============================================================
// ontology/types.ts · Ontology 统一层类型定义
// v1.3.7 从 sofagent/audit/src/ontology/types.ts 迁出
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
  /** v1.3.6 · v1.3.7 开发⑥：资产生命周期——trunk（已审阅合并进组织基线，稳定可复用）/ branch（试验中，待审阅）。缺省 branch（新实体默认试验态，不默认可复用） */
  lifecycle?: 'trunk' | 'branch';
  /** v1.3.6 · v1.3.7 开发⑥ OKF ②：信任状态（OKF §5.4——draft/stable/deprecated） */
  status?: 'draft' | 'stable' | 'deprecated';
  /** v1.3.6 · v1.3.7 开发⑥ OKF ②：时效——绝对日期，today ≥ stale_after 即过期（注意：spec 原文是 stale_after，不是 valid_after） */
  stale_after?: string;
  /** v1.3.6 · v1.3.7 开发⑥ OKF ②：验证记录（OKF §5.2 三级信任 human > process > unverified；actor 复用 Ed25519 身份码三态 human:/process:/agent） */
  verified?: Array<{ by: string; at: string }>;
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
