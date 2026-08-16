// ============================================================
// dream-cycle/types.ts · Dream Cycle 6 阶段流水线共享类型
// v1.3.5 新增
//
// Dream Cycle 是 gbrain 21 阶段的精简版——对约束沉淀真正有用的前半段：
//   extract_facts → extract_atoms → cluster_patterns
//                → synthesize_concepts（喂 @sofagent/ontology）
//                → skillopt_backfill（回灌自进化）
//                → embed（向量化，供未来检索）
//
// 数据流：
//   think.md（Ledger）+ audit history.jsonl
//     → Fact（原始事实）→ Atom（原子知识点）→ Pattern（聚类模式）
//     → Concept（合成概念，写 knowledge/entities/）
//     → backfill（回灌 fde.md 优化钩子）→ Embedding（向量产出）
// ============================================================

/** 6 个 stage 的有序枚举（数组顺序即执行顺序） */
export const DREAM_CYCLE_STAGES = [
  'extract_facts',
  'extract_atoms',
  'cluster_patterns',
  'synthesize_concepts',
  'skillopt_backfill',
  'embed',
] as const;

/** Stage 名（union 类型） */
export type Stage = (typeof DREAM_CYCLE_STAGES)[number];

/** Dream Cycle 输入：Ledger 层原始数据（think.md + audit history） */
export interface Ledger {
  /** think.md 全文（可能为空字符串） */
  thinkContent: string;
  /** audit history.jsonl 解析出的条目（可能为空数组） */
  auditEntries: AuditEntry[];
}

/** audit history.jsonl 单条记录（最小字段集，宽松解析） */
export interface AuditEntry {
  /** ISO 时间戳 */
  timestamp?: string;
  /** 触发规则名 */
  rule?: string;
  /** 审计结论 */
  status?: string;
  /** 附言/详情 */
  message?: string;
  /** 其他字段原样保留 */
  [key: string]: unknown;
}

/** extract_facts 产物：从 Ledger 提取的原始事实 */
export interface Fact {
  /** 稳定 ID（基于内容 hash） */
  id: string;
  /** 事实文本 */
  text: string;
  /** 来源（think.md / audit:<rule>） */
  source: string;
}

/** extract_atoms 产物：原子知识点（事实的最小可复用单元） */
export interface Atom {
  /** 稳定 ID */
  id: string;
  /** 原子知识点文本 */
  text: string;
  /** 来自哪个 fact */
  factId: string;
}

/** cluster_patterns 产物：聚类后的模式（M < N） */
export interface Pattern {
  /** 稳定 ID */
  id: string;
  /** 模式名（聚类标签） */
  label: string;
  /** 归入本模式的 atom id 列表 */
  atomIds: string[];
}

/** synthesize_concepts 产物：概念（写入 knowledge/entities/） */
export interface Concept {
  /** slug（文件名去扩展名） */
  slug: string;
  /** 概念标题 */
  title: string;
  /** 概念正文（markdown） */
  body: string;
  /** 来源回指（frontmatter source: 字段） */
  source: string;
  /** 敏感性分级（缺省 internal） */
  sensitivity?: 'public' | 'internal' | 'restricted';
}

/** embed 产物：向量（本版只产出，检索服务见 v1.1.8+） */
export interface Embedding {
  /** 对应 concept slug */
  slug: string;
  /** 向量（mock 为定长数组） */
  vector: number[];
}

/**
 * LLM Provider 接口——Dream Cycle 各 stage 唯一允许的 LLM 入口。
 *
 * 铁律：任何 stage 不直接调 LLM SDK，必须经 LLMProvider。
 * v1.1.6 只提供 MockLLM（确定性输出，开发期验证 pipeline 串接）；
 * RealLLM 只写类型签名，构造器抛用户可读错（v1.1.8 接入）。
 */
export interface LLMProvider {
  /** 从文本提取事实（think.md 段落 / audit 条目 → fact 文本列表） */
  extract(input: string): Promise<string[]>;
  /** 聚类（atom 文本列表 → 聚类标签列表，与输入等长） */
  cluster(inputs: string[]): Promise<string[]>;
  /** 合成（同组 atom 文本 → concept 标题 + 正文） */
  synthesize(inputs: string[]): Promise<{ title: string; body: string }>;
  /** 向量化（文本 → 定长向量） */
  embed(input: string): Promise<number[]>;
}

/** state.md 持久化的断点游标 */
export interface DreamCycleState {
  /** 已完成的 stage（按序） */
  completedStages: Stage[];
  /** 失败标记（形如 failed:<stage>），无失败为 null */
  failed: string | null;
  /** cycle_complete 标志 */
  cycleComplete: boolean;
  /** 上次运行 ISO 时间戳 */
  lastRunAt: string | null;
}

/** runDreamCycle 返回结果 */
export interface DreamCycleResult {
  /** 本轮是否完整跑完 6 阶段 */
  cycleComplete: boolean;
  /** 本轮完成的 stage 列表 */
  completedStages: Stage[];
  /** 失败 stage（无失败为 null） */
  failedAt: Stage | null;
  /** 各阶段产出计数 */
  counts: {
    facts: number;
    atoms: number;
    patterns: number;
    concepts: number;
    embeddings: number;
  };
  /** 输入 Ledger 规模（audit history 条数，供周报） */
  auditEntryCount: number;
  /** 错误信息（失败时填充） */
  error?: string;
}
