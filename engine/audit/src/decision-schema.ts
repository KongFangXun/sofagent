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

/** 决策种类（15 类）——覆盖 Agent 生命周期内所有可问责决策
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
 *
 * v1.5.2 新增 INVALIDATION（结论失效标记）：
 *   - INVALIDATION：宣告「某条既有审计结论不再可作为依据」的**只追加标记条目**。
 *     decision-log 是 append-only HMAC 链，已签名条目一律不得改写——故失效
 *     不是回头涂改原条目，而是追加一条 kind=INVALIDATION 的新条目：
 *     `causedBy` 指向被失效结论的 ts、`causalType='influenced'`、
 *     `invalidationReason` 记失效原因（见 InvalidationReason）。
 *     原文留痕（HMAC 链完整）+ 失效可见（新条目可查）= 「失效是标记不是抹除」。
 *
 *   为何新增枚举值而不是复用既有 kind（对齐 COST = v1.4.0 交付三、
 *   COVERAGE = v1.5.0 章八两次成例：新决策语义 → 新 kind）：
 *     ① 唯一识别面——标记条目须能被 KPI / 查询读数一眼区分（否则标记混入
 *        CONFIG_CHANGE / KNOWLEDGE_DISTILL 口径，还得另造一套排除逻辑）；
 *     ② 语义不勉强——三类触发（授权变更 / 压缩不兼容 / 风险升级）没有一个
 *        既有 kind 能同时覆盖，硬塞即污染该 kind 的 KPI 口径；
 *     ③ 兼容成本低——本 union 属 `@public`，新增成员对消费方向后兼容
 *        （`COST` 与 `COVERAGE` 两次新增即同款先例）。
 *   注：标记是**元记录**，不是 Agent 决策——下游读数（治理 KPI / 决策查询
 *   聚合）须以 `isInvalidationMarker` 把标记条目排除在决策计数之外。
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
  | 'COST'              // 成本告警（v1.4.0 交付三 · budget 超支 WARN，queryByKind('COST') 可追溯）
  | 'COVERAGE'          // 对账覆盖动作（v1.5.0 章八 · trace 三源对账结果入 decision-log——说的和干的差在哪）
  | 'INVALIDATION';      // 结论失效标记（v1.5.2 章四 · append-only 追加的「失效是标记不是抹除」条目）

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

/**
 * 决策因果边类型（Semantica 的 CAUSED / INFLUENCED / PRECEDENT_FOR 三种
 * 因果边映射）：
 *   - caused        直接导致（拦截决策引用触发它的路由决策）
 *   - influenced    影响（HITL 决策引用待审的上游决策）
 *   - precedent_for 先例（本决策为后续同类决策提供先例）
 */
export type CausalType = 'caused' | 'influenced' | 'precedent_for';

/**
 * 审计结论失效原因词汇表（v1.5.2 章四 · Codex Guardian 启发 · 语义取子集）。
 *
 * 背景：审计结论（decision-log 条目）一经产生即被视为永久有效，下游消费方
 * 无法判断「这条结论还能不能信」。本词汇表给结论定义一套**失效条件**——
 * 每个取值对应本仓一个可观测事件，事件发生时由 invalidation.ts 追加
 * kind=INVALIDATION 的标记条目（原文不改写、链不破坏）。
 *
 * 对齐 Guardian `GuardianReviewReason` 六原因（源码核验：codex-rs
 * `core/src/guardian`）取**五项子集**，逐项映射如下：
 *
 * | 本仓取值                | Guardian reason       | 本仓真实触发点 |
 * |------------------------|-----------------------|----------------|
 * | authorization-changed  | AuthorizationChanged  | config.yml 关闭规则（`index.ts` ALL_RULE_KEYS 检出段）／`permission.local.json` 覆盖全局规则（`permission/loader.ts`）／`policy.yml` plugin_sources 白名单变更 |
 * | incompatible-compaction| IncompatibleCompaction| L2 工具输出总结（`FORGE/src/tool-output-budget.mjs`）／加载链压缩（`engine/hooks/sofagent-load-chain`）／`compactIfNeeded`（`engine/inject`）——压缩后既有结论的上下文前提不再可核 |
 * | elevated-risk          | ElevatedRisk          | 同一对象（文件/artifactRef）后续轮次被更严规则命中（FAIL）——先前宽松结论失效 |
 * | stale-score            | StaleScore            | 带分数的结论（Benchmark/BoundaryScore 等）超出时效窗口——分数过期不等于仍成立 |
 * | fresh-required         | FreshRequired         | 消费方显式要求新鲜结论（发版闸门/预推送校验等）——旧结论不得当依据 |
 *
 * 未取 Guardian 的 `ScoringFailure`（评分失败）——那是「本次评分不成立」的
 * 过程故障，不是「既有结论失效」的语义，本仓由降级梯队（degradation.ts）覆盖。
 *
 * 可选字段语义：**缺省 = 有效**。老日志无此字段照常解析/校验（向后兼容）。
 */
export type InvalidationReason =
  | 'authorization-changed'    // 授权或白名单配置变更（Guardian: AuthorizationChanged）
  | 'incompatible-compaction'  // 压缩/摘要事件使既有结论前提失效（Guardian: IncompatibleCompaction）
  | 'elevated-risk'            // 同一对象后续被更严规则命中（风险升级 · Guardian: ElevatedRisk）
  | 'stale-score'              // 分数过期（Guardian: StaleScore）
  | 'fresh-required';          // 需新鲜结论（Guardian: FreshRequired）

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
  /**
   * 因果边——引用前序决策（Semantica「决策不是日志行，是一等公民图节点」）。
   *
   * 写入时由触发链路带上：拦截决策引用触发它的路由决策（caused）、
   * HITL 决策引用待审的上游决策（influenced）。值为目标条目的 ts
   * （决策日志以 ts 为条目标识——traceBack 同语义）。
   * 老日志无此字段照常校验（向后兼容）。
   */
  causedBy?: string[];
  /** 因果边类型（causedBy 存在时通常有值） */
  causalType?: CausalType;
  /**
   * 审计结论失效原因（v1.5.2 章四）——**仅出现在 kind=INVALIDATION 的标记条目上**。
   *
   * 语义：本条目宣告「`causedBy` 指向的那些既有结论自此刻起失效」。
   * 可选字段——**缺省 = 有效**；老日志无此字段照常解析与验链（HMAC 只依赖
   * 链字段，新增业务字段天然向后兼容）。失效是标记不是抹除：原条目字节不变。
   */
  invalidationReason?: InvalidationReason;
  /** 决策发生时刻 */
  moment: LoopPhase;
  /** 决策理由（已脱敏） */
  why: DecisionWhy;
  /** 关联规格引用（如 FDE 交付物中的 spec ref） */
  specRef?: string;
  /** 关联产物引用（文件路径 / commitSha） */
  artifactRef?: string;
  /**
   * 双时态快照：决策引用本体实体时，记录当时的 validFrom/validTo 区间——
   * 「当时依据的版本」不再靠 git snapshot 反推（v1.5.0 第二章审计回溯联动）。
   * 键 = 实体名，值 = 决策时刻的时间区间（undefined 字段语义同 schema：未填 = 永久/仍有效）。
   */
  entityValidity?: Record<string, { validFrom?: string; validTo?: string }>;
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
  /** 决策记录来源标识（缺省 'sofagent-audit'） */
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
