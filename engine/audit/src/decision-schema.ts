// ============================================================
// decision-schema.ts · 决策审计 schema（v1.3.7 交付 6 T01）
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
 * v1.3.4 新增 COMMONS（公地能力动作）：
 *   - COMMONS：组织能力公地的发布/调用/评分/退役等动作（L3 能力公地）
 *     evidence 字段记能力名 + 调用结果 + 评分 + 扫描判定。
 *     与 ORCHESTRATION（编排委派）/ EVOLUTION（经验层进化）语义区分——
 *     公地是能力流转层，既非编排也非进化。
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
  | 'COMMONS'            // 公地能力动作（能力发布 / 调用 / 评分 / 退役 / SkillScan）
  | 'COST';              // 成本告警（v1.4.0 交付三 · budget 超支 WARN，queryByKind('COST') 可追溯）

/**
 * 判断时刻分类（v1.3.6 交付⑮ · decisions.jsonl 完整版 · OpenFDE 启发）。
 *
 * 与 DecisionKind 正交的两个维度：
 *   - kind（DecisionKind）= 可问责决策类型（这是哪一类决策——改规格/触发规则/进化…）
 *   - category（DecisionCategory）= 判断时刻分类（这次选择动作属于哪种——路由/选方案/跳过/重试/升级）
 *
 * v1.3.0 的 emitDecision 只在关键节点（HITL / 审计 FAIL）触发；完整版把意图审计
 * 扩展到「记全部判断时刻」——Agent 每次做选择（走哪条路 / 选哪个方案 / 为什么跳过
 * 某步）都落 category 标注，让决策日志可按判断行为回溯。
 *
 * 可选字段，老日志无此字段不影响查询（向后兼容）。
 */
export type DecisionCategory =
  | 'route'     // 路由决策——走哪条路（入口路由命中节点 / 模型切换）
  | 'select'    // 方案选择——选哪个候选（A/B 晋升 / 能力调用 / 人审续跑）
  | 'skip'      // 跳过决策——为什么不做（能力退役 / 扫描拒绝安装）
  | 'retry'     // 重试决策——回到某个点重来（快照恢复 / checkpoint 续跑）
  | 'escalate'; // 升级人工——交给人判断（超预算等人审 / 可疑安装需确认）

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
  /**
   * 路由决策理由链（v1.3.6 交付⑧ 新增——可选字段，不破坏向后兼容）。
   *
   * 路由决策的可解释性不能外包——"为什么这个任务派给了模型 A 而不是 B"
   * 是审计需求，必须留在约束层。sofagent 只在 model_switch（换模型）和
   * route_workflow（入口路由）两个决策点记结构化理由链（借鉴 role-model
   * Artifacts 构件；实际路由仍由第三方 router 做，此处只记理由）。
   */
  routeReason?: RouteReason;
}

/**
 * 路由决策理由链 schema（v1.3.6 交付⑧）。
 * policy = 命中哪类策略；matchedEndpoint = 命中谁（Profiles 对应）；
 * rejectedEndpoints = 被硬性拒绝的（Policy 对应）；decisionScore = 决胜分。
 */
export interface RouteReason {
  /** 命中的路由策略类别 */
  policy: 'data-sovereignty' | 'cost' | 'latency' | 'capability' | 'preference' | 'default';
  /** 命中的 endpoint（Profiles 对应） */
  matchedEndpoint?: string;
  /** 被规则拒绝的 endpoint（Policy 硬性拒绝对应） */
  rejectedEndpoints?: string[];
  /** 决胜分（Policy 决胜规则对应） */
  decisionScore?: number;
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
  /**
   * 判断时刻分类（v1.3.6 交付⑮ 新增——可选字段，不破坏向后兼容）。
   * 与 kind 正交：kind 记「哪类决策」，category 记「哪种选择动作」。
   * 老日志无此字段，查询接口按 undefined 处理（不参与 category 过滤）。
   */
  category?: DecisionCategory;
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

  // routeReason 内的 endpoint 字符串同样逐项脱敏（endpoint 可能拼在 URL 里带 token）
  let routeReason = why.routeReason;
  if (routeReason) {
    const sanitized: RouteReason = { policy: routeReason.policy };
    if (routeReason.matchedEndpoint !== undefined) {
      let safe = routeReason.matchedEndpoint;
      for (const { pattern, replacement } of REDACTION_PATTERNS) {
        safe = safe.replace(pattern, replacement);
      }
      sanitized.matchedEndpoint = safe;
    }
    if (routeReason.rejectedEndpoints !== undefined) {
      sanitized.rejectedEndpoints = routeReason.rejectedEndpoints.map((ep) => {
        let safe = ep;
        for (const { pattern, replacement } of REDACTION_PATTERNS) {
          safe = safe.replace(pattern, replacement);
        }
        return safe;
      });
    }
    if (routeReason.decisionScore !== undefined) {
      sanitized.decisionScore = routeReason.decisionScore;
    }
    routeReason = sanitized;
  }

  return {
    ...why,
    text,
    ...(tags ? { tags } : {}),
    ...(routeReason ? { routeReason } : {}),
  };
}
