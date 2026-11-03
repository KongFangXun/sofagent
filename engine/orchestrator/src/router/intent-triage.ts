// ============================================================
// intent-triage.ts · 判定分层编排 L0/L1/L2（v1.5.4 · 第二章）
// ============================================================
//
// 定位：**默认不用本地主模型做判定**（占槽 / 循环依赖 / 判定延迟放大 / 判错
// 路由错下游放大四问题）。三层编排：
//
//   L0 声明式映射——请求来自已定义 workflow 的 Agent 节点，直接查节点级
//      modelPreference 映射（复用 v1.4.8 已交付 schema，**零模型成本**）；
//   L1 语义分类——自由文本走 embedding 相似度分类 / DecisionChannel 判定
//      （复用已部署的本地 embedding 模型服务——与 daemon dream-cycle 的 embed
//      同形态的 Ollama 兼容端点，复用的是**模型服务**不是 daemon 代码，
//      不引入 orchestrator→daemon 反向依赖；**零新增组件，不占本地推理槽**）；
//   L2 难例兜底——置信度低于阈值时按配置分流（判定特征走云端强 API /
//      信创场景本地低峰复核）。
//
// 🔴 行为锁（可测）：判定全程**零本地主模型推理请求**——经 SlotManager 取用
// 时一律 kind='decision'（不占主模型槽池）；判定期间主模型授予数恒为 0。
//
// fail-closed：L1 通道不可用 / 超时 ⇒ 降级 L0 规则面兜底，**不得静默放行**。
// 判据门控（本版实装）：证据未就绪（`state.evidenceReadiness='none'` 而判据声明需证据）
//   或未校准（无记录 / 未达阈）⇒ **拒绝启用该判据**（rejected，非静默降级）。
// ============================================================

import type { RouteTarget } from '../model-router';
import { emitDecision } from '@sofagent/audit';

/** 判定留痕 sink（v1.8.0 §一 接线纪律①——回执五件落 decision-log） */
export type JudgeAuditSink = (receipt: {
  stateDigest: string;
  evidenceRefs: string[];
  modelIdentity: string;
  probabilities: number[];
  deterministicBaseline: string;
  routeReason: string;
  dataDir?: string;
  /** §二 同源对账四件（可选——meta 在位时由调用方随判定传入） */
  provenance?: {
    payload_sha256: string;
    stateConstructorVersion: string;
    redactionVersion: string;
    criteriaVersion: string;
  };
}) => void;

/** 生产 sink：回执五件 + 四态/routeReason 落 decision-log（kind=ORCHESTRATION） */
export function createJudgeAuditSink(dataDir?: string): JudgeAuditSink {
  return (r) => {
    emitDecision({
      agentId: 'intent-triage',
      sessionId: 'judge',
      kind: 'ORCHESTRATION',
      category: 'route',
      moment: 'ACT',
      why: { text: 'L1 判定留痕（回执五件 + routeReason）', tags: ['judge'] },
      judgeReceipt: {
        stateDigest: r.stateDigest,
        evidenceRefs: r.evidenceRefs,
        modelIdentity: r.modelIdentity,
        probabilities: r.probabilities,
        deterministicBaseline: r.deterministicBaseline,
      },
      content: false,
      evidence: ['routeReason=' + r.routeReason],
    }, r.dataDir ?? dataDir);
  };
}
import {
  DEFAULT_CALIBRATION_POLICY,
  DEFAULT_GRADE_THRESHOLDS,
  DecisionChannelUnavailableError,
  computeEscalationThreshold,
  createUnconfiguredDecisionChannel,
  evaluateCalibration,
  gradeOf,
  tempBucketKey,
  toAuditRecord,
  validateEvidenceReadiness,
  validateQuestions,
  type CalibrationPolicy,
  type CalibrationRegistry,
  type CalibrationVerdict,
  type DecisionAnswer,
  type DecisionAuditRecord,
  type DecisionChannel,
  type DecisionGrade,
  type DecisionQuestion,
  type DecisionState,
} from './decision-channel';
// §三 校准判据纪律（v1.7.0）：决策路径置信度校准状态查询——registry 单例
// 读面（@sofagent/core 公共导出；orchestrator 已依赖 core）
import {
  calibrationClaimRegistry,
  registerLegacyConfidenceClaims,
  ol,
} from '@sofagent/core';
import type { SlotManager } from './slot-manager';

/** 判定层标识 */
export type TriageLayer = 'L0' | 'L1' | 'L2';

/**
 * L0 声明式映射条目（节点级 modelPreference 的编排形态）。
 * refs 命中任一 → 直查 target，零模型调用。
 */
export interface L0MappingEntry {
  /** 命中的 ref 集（workflow 节点 id / 规则编号） */
  refs: string[];
  /** 映射目标 */
  target: RouteTarget;
  /** 映射理由（留痕） */
  reason: string;
}

/** embedding 分类结果（L1 兜底实现形态——本地 embedding 服务） */
export interface EmbeddingClassifyResult {
  /** 分类标签 */
  label: string;
  /** 置信度 [0,1] */
  confidence: number;
}

/** 判定分层配置（外部化——企业按场景覆盖） */
export interface IntentTriageConfig {
  /** L0 声明式映射表 */
  l0Mappings: L0MappingEntry[];
  /** L1 语义分类置信阈值（低于此 → L2 兜底） */
  l1MinConfidence: number;
  /** L2 兜底去向：cloud-strong 云端强 API / local-offpeak 本地低峰复核 */
  l2Policy: 'cloud-strong' | 'local-offpeak';
  /** 合规是否允许出门（云端 opt-in——信创全封场景 false） */
  cloudAllowed: boolean;
}

/** 缺省配置（保守起步——无映射、阈值偏高、信创不出门） */
export const DEFAULT_TRIAGE_CONFIG: IntentTriageConfig = {
  l0Mappings: [],
  l1MinConfidence: 0.75,
  l2Policy: 'local-offpeak',
  cloudAllowed: false,
};

/** 判定分层结果 */
export interface TriageOutcome {
  /** 命中的层 */
  layer: TriageLayer;
  /** 去向决策 */
  target: RouteTarget;
  /** 档位（五态 → 执行面） */
  grade: DecisionGrade;
  /** 置信度 */
  confidence: number;
  /** 路由理由（routeReason 可解释） */
  routeReason: string;
  /** L2 兜底去向说明（layer=L2 时） */
  fallback?: string;
  /** 审计挂链记录（L1/L2 带——留痕可查） */
  audit?: DecisionAuditRecord;
  /** 判据拒绝启用标记（证据未就绪 / 未校准时——fail-closed，**非静默降级**） */
  rejected?: { reason: string };
}

/** 校准门控装配（注入式——未注入即不开门控，刻度面留 v1.8.0 与默认实现同批） */
export interface CalibrationGate {
  /** 校准记录注册表（读出面） */
  registry: CalibrationRegistry;
  /** 校准策略覆盖（缺省 DEFAULT_CALIBRATION_POLICY） */
  policy?: CalibrationPolicy;
}

/**
 * §三 校准判据纪律查询（v1.7.0 生产接线）：读 calibration-registry 的
 * 决策路径校准状态——门禁只查不拦截（运行期提示面；硬拦截归
 * assertNoUncalibratedInDecisionPath 门禁脚本/装配期断言）。返回
 * uncalibrated 消费点清单供 routeReason 留痕（「这一跳用的阈值有没有
 * 校准依据」在判定留痕里可查）。
 */
export function uncalibratedDecisionPathClaims(): string[] {
  registerLegacyConfidenceClaimsOnce();
  return calibrationClaimRegistry
    .claimsInDecisionPath()
    .filter((c) => c.calibStatus === 'uncalibrated')
    .map((c) => c.id);
}

/** 普查登记幂等守卫（进程内一次——静态声明面） */
let legacyRegistered = false;
function registerLegacyConfidenceClaimsOnce(): void {
  if (legacyRegistered) return;
  registerLegacyConfidenceClaims(calibrationClaimRegistry);
  legacyRegistered = true;
}

/** 编排依赖（均可注入——测试零真实网络） */
export interface IntentTriageDeps {
  /** 判定通道（缺省未配置通道——judge 抛不可用） */
  channel?: DecisionChannel;
  /** 槽位管理器（行为锁断言面——判定链取 kind='decision'） */
  slotManager?: SlotManager;
  /** 校准门控（注入即启用 fail-closed 硬线；未注入 = 刻度面未接线，留 v1.8.0） */
  calibration?: CalibrationGate;
  /** 配置覆盖 */
  config?: Partial<IntentTriageConfig>;
  /** 升档阈值参数（代价反推；缺省 escalateCost=1, mistakeCost=10 → 阈值 0.9） */
  escalationCosts?: { escalateCost: number; mistakeCost: number };
  /**
   * 判定留痕 sink（v1.8.0 §一 接线纪律①）——L1 判定结果经回执五件落 decision-log。
   * 注入即启用；未注入 = 留痕面未接线（测试/无审计环境）。留痕失败不阻断判定
   * （try/catch 兜住，console.error 可见）——对齐 ai-node-governance sink 先例。
   */
  auditSink?: JudgeAuditSink;
}

/**
 * 判定分层编排。
 *
 * `triage` 返回单次去向下达前的判定结果；L1 判定经 DecisionChannel 一次提交
 * 全部问句（批量纪律），全程不占本地主模型槽位。
 */
export class IntentTriage {
  private readonly config: IntentTriageConfig;
  private readonly channel: DecisionChannel;
  private readonly slotManager?: SlotManager;
  private readonly calibration?: CalibrationGate;
  private readonly auditSink?: JudgeAuditSink;
  private readonly escalationThreshold: number;

  constructor(deps: IntentTriageDeps = {}) {
    this.config = { ...DEFAULT_TRIAGE_CONFIG, ...(deps.config ?? {}) };
    this.channel = deps.channel ?? createUnconfiguredDecisionChannel();
    if (deps.slotManager) this.slotManager = deps.slotManager;
    if (deps.auditSink) this.auditSink = deps.auditSink;
    if (deps.calibration) this.calibration = deps.calibration;
    const costs = deps.escalationCosts ?? { escalateCost: 1, mistakeCost: 10 };
    this.escalationThreshold = computeEscalationThreshold(costs.escalateCost, costs.mistakeCost);
  }

  /**
   * 判定分层入口。
   *
   * @param state 待判定语义输入
   * @param questions 问句集（L1 一次提交全部——批量纪律）
   * @param opts.criticalNode ⚡ 节点（强制 ASK）
   * @param opts.inDomain 是否在判定域内（false → SKIP，走 L0 兜底）
   */
  async triage(
    state: DecisionState,
    questions: DecisionQuestion[],
    opts: { criticalNode?: boolean; inDomain?: boolean } = {},
  ): Promise<TriageOutcome> {
    // ── L0：声明式映射（零模型成本）──
    const l0 = this.matchL0(state);
    if (l0) {
      return {
        layer: 'L0',
        target: l0.target,
        grade: 'ALLOW',
        // 序数等级（**不是概率**）：L0 是声明式规则命中，1 表示「确定性路由」，
        // 不是「模型有 100% 把握」——两者性质不同，不得混用于概率门槛。
        confidence: ol(1),
        routeReason: `L0 声明式映射命中（${l0.reason}）——零模型调用`,
      };
    }

    // 问句集校验（fail-closed：非法问句集 → 降 L0 兜底，不静默放行）
    const issues = validateQuestions(questions);
    if (issues.length > 0) {
      return this.l0Fallback(state, `问句集非法（${issues.join('；')}）→ L0 规则面兜底`);
    }

    // ── 判据启用门控（fail-closed）──
    // 证据就绪度：未就绪（none）不得启用需要证据的判据——**拒绝启用，非静默降级**
    const evidenceIssues = validateEvidenceReadiness(state, questions);
    if (evidenceIssues.length > 0) {
      return this.rejectUnready(state, `证据就绪度门控——${evidenceIssues.join('；')}`);
    }
    // 校准硬线：未校准（无记录 / 未达阈）不得用于任何分流决策——**拒绝启用**
    if (this.calibration) {
      const verdict = calibrationGateOf(questions, this.calibration);
      if (!verdict.usable) {
        return this.rejectUnready(state, `校准门控——${verdict.reason}`);
      }
    }

    // ── L1：语义分类（判定链——不占本地主模型槽位）──
    // 取用 kind='decision'：判定期间主模型授予数恒为 0（行为锁）
    const lease = this.slotManager?.acquire({ requestId: `triage:${stateDigestShort(state)}`, kind: 'decision' });
    void lease; // 租约对象本身不消费——判定链不占主模型槽的语义由 SlotManager 计数承载
    let primary: DecisionAnswer | undefined;
    try {
      const result = await this.channel.judge(state, questions);
      primary = result.answers[0];
      if (!primary) {
        return this.l0Fallback(state, 'L1 判定无答案 → L0 规则面兜底');
      }
      const grade = gradeOf(primary, {
        allowMinConfidence: DEFAULT_GRADE_THRESHOLDS.allowMinConfidence,
        askMinConfidence: DEFAULT_GRADE_THRESHOLDS.askMinConfidence,
        ...(opts.criticalNode ? { criticalNode: true } : {}),
        ...(opts.inDomain === false ? { inDomain: false } : {}),
      });
      const audit = toAuditRecord(state, questions, result, {
        threshold: this.escalationThreshold,
        escalate: grade !== 'ALLOW',
      });
      // v1.8.0 §一 接线纪律①：判定留痕——回执五件 + routeReason 落 decision-log
      //（留痕失败不阻断判定，console.error 可见——对齐 ai-node-governance sink 先例）。
      if (this.auditSink) {
        try {
          this.auditSink({
            stateDigest: audit.stateDigest,
            evidenceRefs: audit.questionIds,
            modelIdentity: audit.modelVersion,
            probabilities: audit.answers.map((a) => a.probability),
            deterministicBaseline: 'L0 规则面（判定不改规则结论——建议非执法）',
            routeReason: `L1 语义分类（${this.channel.name} · grade=${grade}）`,
            // P2-5（review r2）：provenance 四件随判定喂数（此前 sink 类型有位但调用点没传——
            // stateDigest 即 payload 的 sha256 指纹、构造/脱敏版本锚见 judge-state、判据版本取通道名）
            provenance: {
              payload_sha256: audit.stateDigest,
              stateConstructorVersion: 'judge-state/v1',
              redactionVersion: 'redaction/v1',
              // P2-1（review r3）：判据集版本与通道实例解耦——取判定结果的 modelVersion
              //（同一判据集随代次走，channel.name 是实现名非判据版本）
              criteriaVersion: `criteria@${result.modelVersion}`,
            },
          });
        } catch (sinkErr) {
          console.error(`[intent-triage] 判定留痕失败（不阻断判定）：${sinkErr instanceof Error ? sinkErr.message : String(sinkErr)}`);
        }
      }
      if (grade === 'ALLOW' || grade === 'ASK') {
        return {
          layer: 'L1',
          target: 'local-pipeline', // L1 判定沿用本地档（判定件坐语义兜底层）
          grade,
          confidence: primary.probability,
          routeReason: `L1 语义分类命中（${this.channel.name} · ${result.tempBucket} · p=${primary.probability.toFixed(3)}）`,
          audit,
        };
      }
      // 弃权 / SKIP / 低置信的回落（2026-11-01 T-1 裁定，见 docs/DECISION-POINTS.md §四）：
      //   **默认回落 L0 基线**（ASK + 本地，不外发）——对齐 v1.8.0 §一 七路回落统一口径；
      //   仅当云端**显式开启**（cloudAllowed 且 l2Policy='cloud-strong'）才转 L2 云端强档。
      // 裁定依据（三条实测，非偏好）：
      //   ① 默认配置下 L2(local-offpeak) 与 L0 的产出同为「本地 + ASK」，差别只在 routeReason
      //      —— 属假分流；
      //   ② 本地重试对容量受限题型无增益：main01v6 判 csqa 为本架构容量受限面（训练行自测
      //      仅 0.35/0.43），而 csqa 占语义面漏判 47%（270/575，v17 三 seed 归因）；
      //   ③ cloud-strong 在本仓**从未有实测读数**；且弃权→自动外发重判属「弃权变确定」的
      //      激进方向（论文稿明列不得豁免），故不得作为默认动作。
      const cloudOn = this.config.l2Policy === 'cloud-strong' && this.config.cloudAllowed;
      if (cloudOn) {
        return this.l2Fallback(
          state,
          `L1 置信 ${primary.probability.toFixed(3)} 未达阈值 ${this.config.l1MinConfidence}（${grade}）`,
          audit,
        );
      }
      return this.l0Fallback(
        state,
        `L1 ${grade} 未达阈值且云端未开启 → L0 基线兜底（弃权保守回落，不外发）`,
      );
    } catch (err) {
      // fail-closed：通道不可用 / 超时 ⇒ 降级 L0 规则面兜底
      if (err instanceof DecisionChannelUnavailableError) {
        return this.l0Fallback(state, `L1 通道不可用（${err.message}）→ L0 规则面兜底（fail-closed）`);
      }
      return this.l0Fallback(state, `L1 判定异常（${err instanceof Error ? err.message : String(err)}）→ L0 规则面兜底（fail-closed）`);
    } finally {
      this.slotManager?.release(`triage:${stateDigestShort(state)}`);
    }
  }

  /** L0 声明式映射匹配（refs 命中任一即返回） */
  private matchL0(state: DecisionState): L0MappingEntry | null {
    if (!state.refs || state.refs.length === 0) return null;
    for (const mapping of this.config.l0Mappings) {
      const hit = mapping.refs.find((r) => state.refs!.includes(r));
      if (hit) return mapping;
    }
    return null;
  }

  /** L2 难例兜底（按配置分流：云端强 API / 本地低峰复核） */
  private l2Fallback(state: DecisionState, why: string, audit?: DecisionAuditRecord): TriageOutcome {
    const useCloud = this.config.l2Policy === 'cloud-strong' && this.config.cloudAllowed;
    const fallback = useCloud ? 'cloud-strong' : 'local-offpeak';
    const target: RouteTarget = useCloud ? 'cloud-strong' : 'local-executor';
    return {
      layer: 'L2',
      target,
      grade: 'ASK',
      confidence: 0,
      routeReason: `L2 难例兜底（${why}）→ ${fallback}`,
      fallback,
      ...(audit ? { audit } : {}),
    };
  }

  /** L0 规则面兜底（fail-closed 降级路径——不静默放行） */
  private l0Fallback(state: DecisionState, why: string): TriageOutcome {
    // L0 兜底：无声明式映射可用时保守回本地执行档（不出门），并标注需人审
    const first = this.config.l0Mappings[0];
    const target: RouteTarget = first ? first.target : 'local-executor';
    void state;
    return {
      layer: 'L0',
      target,
      grade: 'ASK',
      confidence: 0,
      routeReason: `L0 规则面兜底（${why}）`,
    };
  }

  /**
   * 判据拒绝启用（fail-closed——证据未就绪 / 未校准时）。
   *
   * **不静默降级**为语义判定：直接把该次判定标为 rejected、保守回本地执行档并转人审，
   * 使「判据不可用」在返回值显式可见（调用方据此举证 / 报警，而非拿到一个悄悄降级的假判）。
   */
  private rejectUnready(state: DecisionState, why: string): TriageOutcome {
    void state;
    return {
      layer: 'L0',
      target: 'local-executor',
      grade: 'ASK',
      confidence: 0,
      routeReason: `判据拒绝启用（fail-closed）：${why}`,
      rejected: { reason: why },
    };
  }
}

/**
 * 校准门控：逐问句按其分桶键（原语 × 选项数）判定可用性。
 * 任一分桶未校准 ⇒ 整体拒绝（fail-closed——不得部分用未校准判据）。
 */
function calibrationGateOf(questions: readonly DecisionQuestion[], gate: CalibrationGate): CalibrationVerdict {
  const policy = gate.policy ?? DEFAULT_CALIBRATION_POLICY;
  for (const q of questions) {
    const key = tempBucketKey(q.primitive, q.primitive === 'choice' ? (q.options?.length ?? 0) : 0);
    const verdict = evaluateCalibration(key, gate.registry, policy);
    if (!verdict.usable) return verdict;
  }
  return { usable: true, reason: '全部分桶已校准' };
}

/** state 摘要短键（判定链取用 requestId 用——非审计用途，审计走 stateDigest） */
function stateDigestShort(state: DecisionState): string {
  // 简单稳定键：text 长度 + 首尾片段（免额外哈希开销；审计链仍用完整 sha256）
  const t = state.text;
  return `${t.length}:${t.slice(0, 8)}`;
}
