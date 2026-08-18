// ============================================================
// gb48000.ts · 国标对齐 GB/T 48000.3-2026（v1.3.7 交付 2）
// ============================================================
//
// 将 GB/T 48000.3-2026《标准数字化 第 3 部分:本体建模要求》作为
// 审计层 / Ontology 层的**合规参考基线**（reference baseline）——
// 不是认证声明，是映射清单 + 覆盖度报告。
//
// 合规口径（铁律：无权威出处不虚构条款号）：
//   - 本模块不引用具体国标条款原文编号（无权威文本在手），
//     按「本体建模要求类别」映射到 sofagent Ontology 元模型——
//     与 v1.3.2 交付 1 的 CORE-OBJ/ACT/LNK/STM 四类内核契约一一对应。
//   - 状态标注：已对齐 / 部分对齐 / 不适用（opt-in 审计维度，默认关闭）。
//
// 审计报告「国标对齐」维度（opt-in 默认 false）：
//   runRules(..., gb48000=true) → 追加一条 GB48000 信息条目
//   （ruleClass='国标对齐'，不计 exitCode——不影响默认审计行为）。
// ============================================================

import type { AuditContext } from './rules/types';
import type { RuleCheck } from './rules/types';

/** 国标对齐状态 */
export type Gb48000Status = '已对齐' | '部分对齐' | '不适用';

/** 国标条款映射条目 */
export interface Gb48000ClauseMapping {
  /** 条款标识（类别级——不虚构国标编号） */
  clause: string;
  /** 条款标题（本体建模要求类别） */
  title: string;
  /** sofagent 落地映射（元模型字段/模块） */
  mappedTo: string;
  /** 对齐状态 */
  status: Gb48000Status;
  /** 说明 */
  note: string;
}

/** 国标条款映射清单（单一事实源——文档与审计维度共用） */
export const GB48000_CLAUSE_MAP: readonly Gb48000ClauseMapping[] = [
  {
    clause: 'OBJ-01',
    title: '对象建模要求（实体/概念定义）',
    mappedTo: 'CORE-OBJ · ontology/schema/entity.schema.json + concept.schema.json',
    status: '已对齐',
    note: 'entity/concept frontmatter 强制 name/created_at/updated_at（entity 另含 domain），Schema 定稿为机器可读 JSON Schema（v1.3.1 交付 1）',
  },
  {
    clause: 'LNK-01',
    title: '关系建模要求（关联方向与基数）',
    mappedTo: 'CORE-LNK · ontology/schema/relations.schema.json',
    status: '已对齐',
    note: 'relations 声明 direction（outgoing/incoming/bidirectional）+ cardinality（one-to-one/…/many-to-many），CORE-LNK 链接契约',
  },
  {
    clause: 'ACT-01',
    title: '动作/行为建模要求（动作→载体映射）',
    mappedTo: 'CORE-ACT · ontology/action-registry.ts（Action → 工具映射）',
    status: '已对齐',
    note: 'Ontology Action 注册表 + validator 三态校验（PASS/WARN/strict-FAIL），LLM 工具调用经 Ontology 层不可绕过',
  },
  {
    clause: 'STM-01',
    title: '状态建模要求（生命周期状态迁移）',
    mappedTo: 'CORE-STM · ontology/contracts.ts 状态机契约',
    status: '部分对齐',
    note: '状态机契约注册/查询 + 骨架校验（initialState/transitions ∈ states）已落地；完整迁移执行引擎（迁移前钩子/审计/非法迁移拦截）留 v1.4.0',
  },
  {
    clause: 'META-01',
    title: '元数据/标识要求（对象标识与时间戳）',
    mappedTo: 'frontmatter name + created_at/updated_at（D4 格式一致性规则）',
    status: '已对齐',
    note: 'entity/concept 必填 name/created_at/updated_at；D1-D5 数据规则审计强约束',
  },
  {
    clause: 'VAL-01',
    title: '一致性/校验要求（模型约束校验）',
    mappedTo: 'validateAgainstSchema 最小 JSON Schema 校验器 + 审计 A/D 规则',
    status: '已对齐',
    note: 'schema 校验零第三方依赖（不引 ajv）；数据变更审计 D1-D5 事中拦截',
  },
  {
    clause: 'VER-01',
    title: '版本/演进要求（模型版本与演化）',
    mappedTo: 'Benchmark revision freeze（交付 9）+ Durable checkpoint（交付 4）',
    status: '部分对齐',
    note: '题库 revision 冻结 + 评测日志 HMAC 链已对齐；Ontology Schema 版本迁移（migrateCheckpoint）覆盖 checkpoint 但本体 schema 版本迁移机制待 v1.3.6 注册接口补全',
  },
  {
    clause: 'ITF-01',
    title: '互操作/标准化导出要求',
    mappedTo: 'v1.3.6 Ontology 注册接口（规划）',
    status: '不适用',
    note: 'v1.3.1 已定稿 Schema 格式（避免 v2.0 返工），对外注册接口/标准导出在 v1.3.6 实现——当前不适用',
  },
];

/** 国标对齐覆盖度评估结果 */
export interface Gb48000Coverage {
  /** 逐条映射（含状态） */
  clauses: Gb48000ClauseMapping[];
  /** 已对齐数 */
  aligned: number;
  /** 部分对齐数 */
  partial: number;
  /** 不适用数 */
  notApplicable: number;
  /** 一句话汇总 */
  summary: string;
}

/**
 * 评估国标对齐覆盖度（纯函数——基于映射清单，不依赖运行上下文）。
 *
 * @param ctx 审计上下文（本版不参与判定——保留签名供未来按 diff 文件动态评估）
 * @returns Gb48000Coverage
 */
export function assessGb48000Coverage(ctx?: AuditContext): Gb48000Coverage {
  void ctx; // 保留参数：未来按 diff 涉及的本体文件动态评估
  const clauses = [...GB48000_CLAUSE_MAP];
  const aligned = clauses.filter((c) => c.status === '已对齐').length;
  const partial = clauses.filter((c) => c.status === '部分对齐').length;
  const notApplicable = clauses.filter((c) => c.status === '不适用').length;
  return {
    clauses,
    aligned,
    partial,
    notApplicable,
    summary: `GB/T 48000.3-2026 本体建模要求映射：${aligned} 已对齐 / ${partial} 部分对齐 / ${notApplicable} 不适用（合规参考基线，非认证声明）`,
  };
}

/**
 * 生成「国标对齐」审计条目（opt-in——计入结果但 ruleClass='工程规范'，
 * 且 runner 按 name==='GB48000' 排除 exitCode 计算，不影响默认审计行为）。
 *
 * @param coverage 覆盖度评估
 * @returns RuleCheck 条目（name=GB48000）
 */
export function buildGb48000RuleCheck(coverage: Gb48000Coverage): RuleCheck {
  const partialDetails = coverage.clauses
    .filter((c) => c.status !== '已对齐')
    .map((c) => `[${c.clause} ${c.status}] ${c.title} → ${c.note}`);
  return {
    name: 'GB48000',
    number: 0,
    status: partialDetails.length > 0 ? 'WARN' : 'PASS',
    ruleClass: '工程规范',
    details: [coverage.summary, ...partialDetails],
  };
}
