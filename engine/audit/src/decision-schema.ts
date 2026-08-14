// ============================================================
// decision-schema.ts · 决策审计 schema（v1.3.4 交付 6 T01）
//
// 意图层审计 MVP——把 A1-A19 的「行为问责（扫 git diff）」升级为
// 「意图问责（运行时记决策理由链）」。Agent 每次关键决策（改规格 /
// 改产物 / 触发规则 / 降级等）经 emitDecision 落盘 decision-log.jsonl。
//
// ⚠️ 铁律：先脱敏再签名——HMAC 基于【已脱敏的 why】计算，
// 否则含敏感词的条目 HMAC 永远与读侧不匹配 → 误报篡改。
// ============================================================

import { REDACTION_PATTERNS } from '@sofagent/core';

/** 决策种类（12 类）——覆盖 Agent 生命周期内所有可问责决策
 *
 * v1.3.3 新增 EVOLUTION（进化动作）+ TEAM（团队协作动作）：
 *   - EVOLUTION：优化器修改经验层（think.md / knowledge）、Benchmark 评估 accept/reject、
 *     git snapshot 回滚等——每次必附 evidence 留痕（触发证据链）
 *   - TEAM：团队协作动作（冲突消解裁决、意图广播、反馈放大写入、自动入队等）
 *
 * v1.3.4 新增 MARKET（市场能力动作）：
 *   - MARKET：组织能力市场的发布/调用/评分/退役等动作（L3 能力市场）
 *     evidence 字段记能力名 + 调用结果 + 评分 + 扫描判定。
 *     与 ORCHESTRATION（编排委派）/ EVOLUTION（经验层进化）语义区分——
 *     市场是能力流转层，既非编排也非进化。
 */
export type DecisionKind =
  | 'SPEC_CHANGE'       // 改变需求/规格（范围变更）
  | 'ARTIFACT_EDIT'     // 编辑产物文件（代码/文档/配置）
  | 'TOOL_GATE'         // 触发工具门禁（拦截/放行/告警）
  | 'RULE_TOGGLE'       // 启用/停用审计规则
  | 'ESCALATE_REPORT'   // 上报问题/升级人工
  | 'FALLBACK_DEGRADE'  // 降级执行（LLM 不可用等）
  | 'CONFIG_CHANGE'     // 修改运行时配置
  | 'KNOWLEDGE_DISTILL' // 知识蒸馏/沉淀
  | 'ORCHESTRATION'     // 编排决策（子 Agent 委派/图路由）
  | 'EVOLUTION'         // 进化动作（优化器改经验层 / Benchmark accept-reject / 回滚）
  | 'TEAM'              // 团队协作动作（冲突消解 / 意图广播 / 反馈放大 / 自动入队）
  | 'MARKET';           // 市场能力动作（能力发布 / 调用 / 评分 / 退役 / SkillScan）

/** 决策发生时刻（7 阶段）——对齐 FORGE loop / 激活链生命周期 */
export type LoopPhase =
  | 'OBSERVE'      // 观察（读上下文）
  | 'ELICIT'       // 深挖（澄清需求）
  | 'INDUC'        // 归纳（形成方案）
  | 'ACT'          // 行动（执行工具/写产物）
  | 'EVOLVE'       // 进化（反思/蒸馏）
  | 'DEPLOY'       // 部署（交付/激活）
  | 'ATTRIBUTION'; // 归因（审计/追责）

/** 决策理由结构 */
export interface DecisionWhy {
  /** 决策理由文本（写入前经 sanitizeWhy 脱敏） */
  text: string;
  /** 可选的标签（用于 kind-wise back 聚合） */
  tags?: string[];
  /** 决策置信度 */
  confidence?: 'high' | 'med' | 'low';
  /** 触发该决策的规则名（TOOL_GATE / RULE_TOGGLE 时通常有值） */
  triggeredRule?: string;
}

/** 决策日志完整条目 schema */
export interface DecisionLogEntry {
  /** ISO 8601 UTC 时间戳 */
  ts: string;
  /** Agent 标识 */
  agentId: string;
  /** 会话标识 */
  sessionId: string;
  /** 决策种类 */
  kind: DecisionKind;
  /** 决策发生时刻 */
  moment: LoopPhase;
  /** 决策理由（已脱敏） */
  why: DecisionWhy;
  /** 关联规格引用（如 FDE 交付物中的 spec ref） */
  specRef?: string;
  /** 关联产物引用（文件路径 / commitSha） */
  artifactRef?: string;
  // ── 防篡改链字段（复用 audit-history.ts 同套） ──
  /** 前一条记录的 hash（链完整性校验用） */
  prevHash?: string;
  /** hash 算法版本（2 = 环境指纹） */
  hashVersion?: number;
  /** HMAC-SHA256 签名（有密钥时） */
  hmacSig?: string;
  /** 写入侧签名算法标记（'stable' = stableStringify 签名） */
  hmacAlgo?: 'stable';
  /** ⚠️ 必加——读侧 checkDecisionChainDetailed 靠它区分「真篡改 vs 环境漂移」 */
  envFingerprint?: string;
  /** 决策引擎标识（缺省 'sofagent-audit'） */
  engine?: string;
  /** 触发证据链（字符串数组，可空）—— v1.3.3 新增
   *
   * 进化动作（kind=EVOLUTION）必附：记录触发该决策的证据来源
   * （如 Benchmark 评分、审计规则命中、git snapshot commit 等）。
   * 团队动作（kind=TEAM）可选附。其余 kind 不强制。
   *
   * 格式：字符串数组，每项为一条证据描述（自由文本，如文件路径 / commitSha / 评分值）。
   */
  evidence?: string[];
}

/**
 * 对 DecisionWhy 做脱敏处理——铁律：先脱敏再签名。
 *
 * 对标 audit-history.ts 的 sanitizeRuleResult()（L57）：扫描 why.text 中的
 * 密钥模式（REDACTION_PATTERNS：sk- / AKIA / 手机号 / GitHub token），
 * 命中则替换为脱敏占位。tags 数组同样逐项脱敏（防止标签携带密钥）。
 * 若 text 被完全打码为空，保留脱敏占位而非空串（避免链签名输入缺失）。
 *
 * @param why 原始决策理由
 * @returns 脱敏后的决策理由（不修改入参）
 */
export function sanitizeWhy(why: DecisionWhy): DecisionWhy {
  let text = why.text;
  for (const { pattern, replacement } of REDACTION_PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  // 兜底：若脱敏后为空（原本就是纯密钥串），写占位——保证 HMAC 输入非空稳定
  if (text.trim() === '') {
    text = '[REDACTED]';
  }

  const tags = why.tags?.map((tag) => {
    let safe = tag;
    for (const { pattern, replacement } of REDACTION_PATTERNS) {
      safe = safe.replace(pattern, replacement);
    }
    return safe;
  });

  return {
    ...why,
    text,
    ...(tags ? { tags } : {}),
  };
}
