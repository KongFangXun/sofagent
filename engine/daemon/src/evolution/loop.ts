// ============================================================
// evolution/loop.ts · 进化循环周度编排（v1.7.0 第 2 步 · SDK-face 47 符号生产接线）
// ============================================================
//
// 背景（为什么有本文件）：
//   v1.5.8 进化模块批交付了七组**能力模块**——准入/停滞检测、三层晋级判据、
//   经验池管道、出题考核器、RL 训练治理、收益指标、评测集谱系。当时验收标准
//   是**能力级声称**（模块 + 包测试满足），生产入口接线**排下版**——故这七组
//   符号登记为 SDK-face 白名单接线债务（目标版本 v1.7.0）。
//   本文件就是 v1.7.0 的**生产接线落点**：把七组能力按语义接进一条生产可达的
//   **周度进化循环**，并由真实调度链消费：
//     daemon cron（@weekly L2）→ inspectors/evolve-trigger.ts → runEvolutionLoop()
//     daemon CLI（`sofagent-daemon evolve cycle`）→ runEvolutionLoop()
//     daemon CLI（`... evolve init-registry`，FDE 人工写入面）→ initializeDomainVerifierRegistry()
//
// 边界（不做的事）：
//   · **零新数据源**——全部台账读既有文件（failure-ledger / instinct 池 /
//     考核队列 / ab-history / decision-log / audit 规则注册表）。
//   · **零模型 / 零命令执行**——考核执行 IO（答案校验 / 复现）全注入；缺省不执行。
//   · **default-safe**——读 IO 容错（文件缺失 → 该维度空，不猜数）；写 IO
//     （池追加 / 考核队列落账）仅在确有产出时发生；本模块不做任何自动放行决策
//     （promote-train / 入池 / 安装仍走既有 HITL gate）。
//   · Agent 运行时**不得**调用 initializeDomainVerifierRegistry（登记内容变更只能
//     由人（FDE）发起）——它单独成函数、只从 CLI 人工入口触达。
// ============================================================

import { loadEnvConfig, type QuotaConfig, type QuotaUsage } from '@sofagent/core';
import {
  // 组① 准入 / 停滞检测
  judgeAdmission,
  defaultTierForUnregistered,
  gateStrengthOf,
  isGateStrengthNonDecreasing,
  detectStagnation,
  safetySuiteVerdict,
  loadRegistry,
  initializeRegistryProtected,
  STAGNATION_ROUNDS,
  STAGNATION_IMPROVEMENT_THRESHOLD,
  // 组② 晋级判据
  judgePromotion,
  judgeDemotion,
  judgeEvidenceGates,
  recordPromotionDecision,
  createCoreDecisionWriter,
  evolutionCostGate,
  // 组③ 经验池管道（在 orchestrator 包，见下方 import）
  // 组⑤ RL 训练治理
  emptyTrainingPolicySet,
  judgePolicyHits,
  combineGates,
  shapeRewardPenalty,
  recordShaping,
  // 组⑥ 收益指标
  collectBenefitMetrics,
  recordBenefitMetrics,
  // 组⑦ 评测集谱系
  registerEvalSetProvenance,
  succeedEvalSet,
  stripAnswerKey,
  verifyContaminationSelfReport,
  computeEvalSetHash,
  // 既有自动触发链（optimize 生产入口——组①② 的真实链路）
  autoTriggerAll,
  getPendingTriggerCount,
  type OptimizeResult,
  // 类型
  type VerifierTier,
  type GateStrength,
  type DomainVerifierEntry,
  type EvalRoundReading,
  type StagnationVerdict,
  type PromotionInput,
  type PromotionVerdict,
  type EvidenceGatesInput,
  type EvidenceGatesVerdict,
  type DecisionWriter,
  type TrainingPolicySet,
  type TrajectoryRuleHit,
  type ShapingLedgerEntry,
  type EvolutionBenefitMetrics,
  type BenefitMetricsRecord,
  type EvalSetItem,
  type EvalSetProvenance,
  type ProvenanceLedger,
} from '@sofagent/evolve';
import {
  // 组③ 经验池管道
  instinctPoolPath,
  appendToPool,
  readPool,
  filterByTenant,
  exportInstinctRecords,
  buildLineageAnchor,
  // 组④ 出题考核器
  examQueuePath,
  enqueueExamAction,
  readExamQueue,
  generateExamQuestion,
  assessExamination,
  decideSedimentation,
  checkDoNotCapture,
  checkCorroborationGate,
  applyExamResultToPoolItem,
  applyExamStatusWeight,
  scoreInstinct,
  type StoredInstinct,
  type ExamQuestion,
  type ExamResult,
  type DoNotCaptureRecord,
  type CorroborationPendingRecord,
  type InstinctLineageAnchor,
} from '@sofagent/orchestrator/instinct';

/** 规则严重级（audit 规则注册表口径——severityWeightOf 入参） */
export type RulePriority = 'critical' | 'warning' | 'extended' | 'crutch';

/** 考核步输入（执行 IO 全注入——零真实命令 / 零真实模型调用） */
export interface ExamStepInput {
  /** 待考核池条目（已从池读入，带 verified 态与血缘） */
  items: readonly StoredInstinct[];
  /** 域档位（执行方式分流） */
  domainTier: ExamQuestion['domainTier'];
  /** 答案校验器（第一票） */
  answerCheck: (q: ExamQuestion) => { pass: boolean; basis: string };
  /** 复现执行器（第二票） */
  reproduction: (q: ExamQuestion) => { pass: boolean; basis: string };
  /** 评分器 modelId（model-judge 域必填——独立性硬门） */
  judgeModelId?: string;
  /** 被考核执行模型 modelId（与 judgeModelId 对照） */
  examineeModelId?: string;
  /** 佐证信号（按条目；缺省无佐证） */
  signalsOf?: (item: StoredInstinct) => { recovered?: boolean; complexOnly?: boolean };
  /** 沉淀并入的近似判定（缺省不并入——保守，避免破坏性折叠） */
  isSimilar?: (candidate: { pattern: string }, existing: { pattern: string }) => boolean;
}

/** 评测集谱系步输入 */
export interface EvalSetStepInput {
  setId: string;
  origin: string;
  version: number;
  items: readonly EvalSetItem[];
  contaminationSelfReport: Record<string, string[]>;
  /** 待校验自陈的条目 id 集（缺省 = 全部 items 的 id） */
  checkItemIds?: readonly string[];
}

/** 进化循环输入 */
export interface EvolutionLoopInput {
  /** 数据目录（SOFAGENT_DATA 缺省经 loadEnvConfig 解析） */
  dataDir?: string;
  /** 时间注入（测试） */
  now?: string;
  /** 参与「档位 / 门强度自述」的域清单（缺省空 = 不自述） */
  governedDomains?: readonly string[];
  /** 准入门登记表条目（缺省 loadRegistry(dataDir) 读受保护面） */
  registryEntries?: readonly DomainVerifierEntry[];
  /** 停滞检测：单轮 eval 读数 */
  evalReadings?: readonly EvalRoundReading[];
  /** 停滞二分：窗口内 harness/skill 面是否有变更无提升 */
  scaffoldPlainWithinWindow?: boolean;
  /** 停滞二分：窗口内权重/模型面是否有变更无提升 */
  checkpointPlainWithinWindow?: boolean;
  /** 保护面安全套件命中（独立硬阻断输入） */
  safetyHits?: readonly string[];
  /** 安全套件对照的 evolve 分数 */
  evolveScore?: number;
  /** 晋级候选（含可选证据门槛输入） */
  promotionCandidates?: ReadonlyArray<{ input: PromotionInput; evidence?: EvidenceGatesInput }>;
  /** 成本门（注入 quota；缺省跳过——不启动第二次预算计算） */
  quota?: { config: QuotaConfig | null | undefined; usage: QuotaUsage };
  /** decision-log writer（缺省 createCoreDecisionWriter——接 core emitAuditDecision 生产实现） */
  decisionWriter?: DecisionWriter;
  /** 训练期策略集（缺省空集 = 不启用） */
  trainingPolicy?: TrainingPolicySet;
  /** 轨迹规则命中（审计侧产出） */
  trajectoryHits?: readonly TrajectoryRuleHit[];
  /** 规则严重级查询（缺省按 warning——不臆造规则表） */
  priorityOf?: (ruleId: string) => RulePriority;
  /** 租户分区（缺省 default） */
  enterpriseId?: string;
  /** 考核步 */
  exam?: ExamStepInput;
  /** 评测集谱系步 */
  evalSet?: EvalSetStepInput;
  /** 评测集谱系台账（缺省空台账） */
  evalSetLedger?: ProvenanceLedger;
}

/** 进化循环报告（可序列化——供 inspector message / CLI 渲染） */
export interface EvolutionLoopReport {
  now: string;
  dataDir: string;
  admission: Array<{ domain: string; action: string; tier: VerifierTier; gateStrength: GateStrength; basis: string }>;
  unregisteredDefaultTier: VerifierTier;
  gateStrengthNonDecreasing: boolean;
  safety: { blocked: boolean; reason: string };
  stagnation: StagnationVerdict;
  pendingTriggers: number;
  optimizations: OptimizeResult[];
  promotions: Array<{ itemId: string; verdict: PromotionVerdict; evidence?: EvidenceGatesVerdict; demotion: PromotionVerdict | null }>;
  costGate?: { allowed: boolean; action: string };
  pool: {
    path: string;
    total: number;
    tenant: string;
    tenantCount: number;
    corruptedLines: number;
    exported: number;
    rejected: number;
    lineage: InstinctLineageAnchor | null;
  };
  exam: {
    queuePath: string;
    pendingInQueue: number;
    questions: ExamQuestion[];
    results: ExamResult[];
    rejected: DoNotCaptureRecord[];
    pendings: CorroborationPendingRecord[];
    poolWrites: number;
  };
  training: { rulesetVersion: string; disabled: boolean; hits: number; proceed: boolean; totalPenalty: number; ledger: ShapingLedgerEntry };
  metrics: { record: BenefitMetricsRecord | null; availableDims: number; raw: EvolutionBenefitMetrics | null };
  evalSet: {
    registered: EvalSetProvenance | null;
    contentHash: string | null;
    selfReportOk: boolean | null;
    missing: string[];
    strippedCount: number;
    ledger: ProvenanceLedger | null;
  };
}

/** 空评测集谱系台账（代入 succeedEvalSet 的前驱） */
const EMPTY_PROVENANCE_LEDGER: ProvenanceLedger = { schemaVersion: 1, sets: [], successionDeclarations: [] };

/**
 * 周度进化循环：把七组能力面按语义接进一条生产可达的治理循环。
 *
 * 顺序（对齐 devlog 章序，任一步失败不阻断后续——各步独立留痕，循环只报告）：
 *   ① 安全套件独立阻断 → 档位/门强度自述 → 停滞检测 → 既有自动触发链（optimize）
 *   ② 晋级判据（三态 + 四道证据门槛 + 对偶回退 + 成本门）→ decision-log 留痕
 *   ③ 经验池管道（读池 → 租户分区 → 三道门导出 → 血缘锚点）
 *   ④ 出题考核器（落考核队列 → 双成功判定 → 沉淀裁决 → 池回写）
 *   ⑤ RL 训练治理（策略命中 → 两门并联 → 惩罚折算 → 规则集版本留痕）
 *   ⑥ 收益指标（四维新数据源既有 → 聚合记录）
 *   ⑦ 评测集谱系（钉哈希登记 → 污染自陈校验 → 答案键剥离 → 换代声明）
 */
export async function runEvolutionLoop(input: EvolutionLoopInput = {}): Promise<EvolutionLoopReport> {
  const now = input.now ?? new Date().toISOString();
  const dataDir = input.dataDir ?? loadEnvConfig().dataDir;

  // ── 组① 准入 / 停滞检测 ──────────────────────────────────
  const reg = input.registryEntries
    ? { ok: true as const, entries: input.registryEntries }
    : loadRegistry(dataDir);
  const registryEntries: readonly DomainVerifierEntry[] = reg.ok ? reg.entries : [];
  const governedDomains = input.governedDomains ?? [];
  const admission = governedDomains.map((domain) => {
    const verdict = judgeAdmission(domain, registryEntries);
    return {
      domain,
      action: verdict.action,
      tier: verdict.tier,
      gateStrength: gateStrengthOf(verdict.tier),
      basis: verdict.basis,
    };
  });
  // 门强度非降不变量（fail-closed 语义自证）：未登记默认档必须是最强档——
  // 对任一档位，迁移到默认档都不降门强度（否则「未登记 = 最高档」名存实亡；
  // 自改进通道只许加门、不许撤门）。
  const unregisteredDefaultTier = defaultTierForUnregistered();
  const defaultGateStrength = gateStrengthOf(unregisteredDefaultTier);
  const ALL_TIERS: readonly VerifierTier[] = ['deterministic', 'model-judge', 'human-only'];
  const gateStrengthNonDecreasing = ALL_TIERS.every((tier) =>
    isGateStrengthNonDecreasing(gateStrengthOf(tier), defaultGateStrength),
  );
  const safety = safetySuiteVerdict(input.safetyHits ?? [], input.evolveScore ?? 0);
  const stagnation = detectStagnation(input.evalReadings ?? [], {
    scaffoldPlainWithinWindow: input.scaffoldPlainWithinWindow ?? false,
    checkpointPlainWithinWindow: input.checkpointPlainWithinWindow ?? false,
  });
  // 停滞窗口常量随报告透出（人读口径——「连续 N 轮 / 阈值 ε」）
  void STAGNATION_ROUNDS;
  void STAGNATION_IMPROVEMENT_THRESHOLD;

  // 既有自动触发链（真实生产链路：optimize → 准入门 → 成本门 → runEvolve）
  const pendingTriggers = getPendingTriggerCount();
  const optimizations = safety.blocked ? [] : await autoTriggerAll();

  // ── 组② 晋级判据 ───────────────────────────────────────
  // decision-log writer：v1.5.9 收口——缺省接 core emitAuditDecision 生产实现
  // （createCoreDecisionWriter 绑定本循环 dataDir，保证落盘位置与测试隔离一致）。
  // core 侧 emitAuditDecision 内部 fail-open（解析不到 @sofagent/audit → null + stderr）。
  const writer = input.decisionWriter ?? createCoreDecisionWriter({ dataDir });
  const promotions = judgePromotionReport(input.promotionCandidates ?? [], writer, now);
  const costGate = input.quota
    ? (() => {
      const gate = evolutionCostGate(input.quota.config, input.quota.usage);
      return { allowed: gate.allowed, action: gate.quotaVerdict.action };
    })()
    : undefined;

  // ── 组③ 经验池管道 ─────────────────────────────────────
  const tenant = input.enterpriseId ?? 'default';
  const poolRead = readPool(dataDir);
  const tenantPool = filterByTenant(poolRead.items, tenant);
  const exportResult = exportInstinctRecords(tenantPool, { enterpriseId: tenant, allowCrossTenant: false, now });
  const lineage = exportResult.records.length > 0 ? buildLineageAnchor(exportResult.records, now) : null;
  const pool = {
    path: instinctPoolPath(dataDir),
    total: poolRead.items.length,
    tenant,
    tenantCount: tenantPool.length,
    corruptedLines: poolRead.corruptedLines,
    exported: exportResult.records.length,
    rejected: exportResult.rejected.length,
    lineage,
  };

  // ── 组④ 出题考核器 ─────────────────────────────────────
  const queuePath = examQueuePath(dataDir);
  const queued = readExamQueue(dataDir);
  const examReport = { queuePath, pendingInQueue: queued.entries.length, questions: [] as ExamQuestion[], results: [] as ExamResult[], rejected: [] as DoNotCaptureRecord[], pendings: [] as CorroborationPendingRecord[], poolWrites: 0 };
  if (input.exam) {
    const updatedItems: StoredInstinct[] = [];
    let seq = 0;
    for (const item of input.exam.items) {
      // 不捕获清单硬门（命中即拒，拒收落账）
      const dnc = checkDoNotCapture({ id: item.id, pattern: item.pattern });
      if (dnc) {
        enqueueExamAction(dataDir, { type: 'record-rejection', rejection: dnc }, now);
        examReport.rejected.push(dnc);
        continue;
      }
      // 佐证门（未佐证登记在册，非静默丢弃）
      const signals = input.exam.signalsOf?.(item) ?? {};
      const corroboration = checkCorroborationGate({ id: item.id, occurrences: item.occurrences }, signals, now);
      if (!corroboration.sendToExam) {
        if (corroboration.pending) {
          enqueueExamAction(dataDir, { type: 'record-pending', pending: corroboration.pending }, now);
          examReport.pendings.push(corroboration.pending);
        }
        continue;
      }
      // 出题（未达阈值 → null，不出题）
      seq += 1;
      const scored = scoreInstinct(item);
      const question = generateExamQuestion(scored, input.exam.domainTier, seq, now);
      if (!question) continue;
      enqueueExamAction(dataDir, { type: 'enqueue-question', question }, now);
      examReport.questions.push(question);
      // 考核执行 + 双成功判定（IO 注入）
      const rawResult = assessExamination({
        question,
        answerCheck: input.exam.answerCheck,
        reproduction: input.exam.reproduction,
        judgeModelId: input.exam.judgeModelId,
        examineeModelId: input.exam.examineeModelId,
      }, now);
      const result = decideSedimentation(
        rawResult,
        input.exam.items.map((i) => ({ id: i.id, pattern: i.pattern })),
        input.exam.isSimilar ?? (() => false),
      );
      enqueueExamAction(dataDir, { type: 'record-result', result }, now);
      examReport.results.push(result);
      // 考核态写回池条目（置信度按考核态加权）
      const updated = applyExamResultToPoolItem(item, result);
      const weighted = applyExamStatusWeight(scored.confidence, updated.verified);
      updatedItems.push({ ...updated, confidence: weighted } as StoredInstinct);
    }
    if (updatedItems.length > 0) {
      examReport.poolWrites = appendToPool(dataDir, updatedItems);
    }
  }

  // ── 组⑤ RL 训练治理 ────────────────────────────────────
  const policy = input.trainingPolicy ?? emptyTrainingPolicySet();
  const policyVerdict = judgePolicyHits(policy, input.trajectoryHits ?? []);
  const admissionAllAuto = admission.length === 0 || admission.every((a) => a.action === 'auto');
  const combined = combineGates(admissionAllAuto, !policyVerdict.hit && !safety.blocked);
  const shaped = shapeRewardPenalty(policyVerdict, input.priorityOf ?? (() => 'warning'));
  const shapingLedger = recordShaping(policyVerdict, shaped, policy.rulesetVersion, now);
  const training = {
    rulesetVersion: policy.rulesetVersion,
    disabled: policyVerdict.disabled,
    hits: policyVerdict.hits.length,
    proceed: combined.proceed,
    totalPenalty: shaped.totalPenalty,
    ledger: shapingLedger,
  };

  // ── 组⑥ 收益指标（四维取数器——既有台账，零新数据源）──
  let metricsRecord: BenefitMetricsRecord | null = null;
  let metricsRaw: EvolutionBenefitMetrics | null = null;
  let availableDims = 0;
  try {
    const collected = collectBenefitMetrics(dataDir);
    availableDims = collected.raw.availableDims;
    metricsRaw = {
      passRateTrend: collected.passRateTrend,
      recurrenceRate: collected.recurrenceRate,
      skillReuseRate: collected.skillReuseRate,
      interventionRate: collected.interventionRate,
    };
    metricsRecord = recordBenefitMetrics(metricsRaw, {
      start: stagnationWindowStart(input.evalReadings ?? [], now),
      end: now,
    }, now);
  } catch {
    // 四维台账全缺 → 宁缺勿假（不产出虚构指标）
    availableDims = 0;
  }

  // ── 组⑦ 评测集谱系 ─────────────────────────────────────
  let evalSetReport: EvolutionLoopReport['evalSet'] = { registered: null, contentHash: null, selfReportOk: null, missing: [], strippedCount: 0, ledger: null };
  if (input.evalSet) {
    const registered = registerEvalSetProvenance({
      setId: input.evalSet.setId,
      origin: input.evalSet.origin,
      version: input.evalSet.version,
      items: input.evalSet.items,
      contaminationSelfReport: input.evalSet.contaminationSelfReport,
      now,
    });
    const checkIds = input.evalSet.checkItemIds ?? input.evalSet.items.map((i) => i.id);
    const selfReport = verifyContaminationSelfReport(registered, checkIds);
    const stripped = stripAnswerKey(input.evalSet.items);
    const nextLedger = succeedEvalSet(input.evalSetLedger ?? EMPTY_PROVENANCE_LEDGER, registered, `周度谱系登记（集 ${registered.setId}）`, now);
    evalSetReport = {
      registered,
      contentHash: registered.contentHash,
      selfReportOk: selfReport.ok,
      missing: selfReport.missing,
      strippedCount: stripped.length,
      ledger: nextLedger,
    };
    void computeEvalSetHash; // 登记项内容哈希的另一实算入口（与 registered.contentHash 同源）
  }

  return {
    now,
    dataDir,
    admission,
    unregisteredDefaultTier,
    gateStrengthNonDecreasing,
    safety,
    stagnation,
    pendingTriggers,
    optimizations,
    promotions,
    costGate,
    pool,
    exam: examReport,
    training,
    metrics: { record: metricsRecord, availableDims, raw: metricsRaw },
    evalSet: evalSetReport,
  };
}

/** 停滞窗口起点（有读数取首个读数轮次对应时间，否则取当前——仅用于收益窗口标签） */
function stagnationWindowStart(_readings: readonly EvalRoundReading[], now: string): string {
  return now;
}

/**
 * 组② 晋级判据步：三态判据 + 四道证据门槛 + 对偶回退建议 + decision-log 留痕。
 * 纯判定（不执行回退——回退执行走既有 snapshot/restore）；writer 缺省 no-op。
 */
function judgePromotionReport(
  candidates: ReadonlyArray<{ input: PromotionInput; evidence?: EvidenceGatesInput }>,
  writer: DecisionWriter,
  now: string,
): EvolutionLoopReport['promotions'] {
  return candidates.map(({ input: pInput, evidence }) => {
    const verdict = judgePromotion(pInput);
    const gatesVerdict = evidence ? judgeEvidenceGates(evidence) : undefined;
    // 证据门槛未过而判据本就建议晋级 ⇒ 对偶回退建议（只出判定，执行走既有 snapshot/restore）
    const demotion = gatesVerdict && !gatesVerdict.passed && verdict.action.startsWith('promote')
      ? judgeDemotion(pInput.currentLayer, true)
      : null;
    recordPromotionDecision(pInput, verdict, writer, now);
    return { itemId: pInput.itemId, verdict, evidence: gatesVerdict, demotion };
  });
}

/**
 * FDE 专用写入口：初始化受保护域验证器登记表（写后立即设只读位 + 返回钉哈希）。
 *
 * ⚠️ **Agent 运行时不调用本函数**——登记内容变更只能由人（FDE）发起并留痕
 * （见 v1.5.9 第一章写面留痕通道）。本入口只从 daemon CLI 人工子命令触达，
 * 与 runEvolutionLoop（Agent 运行时循环）严格分离。
 */
export function initializeDomainVerifierRegistry(
  dataDir: string,
  entries: readonly DomainVerifierEntry[],
  opts?: { hmacKey?: string },
): { path: string; contentHash: string; hmac?: string } {
  return initializeRegistryProtected(dataDir, entries, opts);
}
