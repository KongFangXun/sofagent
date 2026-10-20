// calibration-registry.ts · v1.7.0 §三 · 校准判据纪律落地（置信度登记表 + 门禁 + 漂移监测 + 四件套锚点）
// ============================================================
// 定位：把「未校准的置信度是误导性输出」从文档纪律变成机制——引擎内任何
// 被消费的置信度/概率阈值，须携带校准依据标注（校准集版本/ECE/拟合时间）
// 或显式标 uncalibrated；决策路径上的未校准阈值 → 断言失败（门禁不靠
// 自觉）。四件面：
//
//   1. 登记表 registerConfidenceClaim({id, path, statistic, calibStatus,
//      evidence?})——calibStatus='calibrated' 须带 evidence（校准集版本/
//      ECE/拟合时间三件齐——少一件即拒载：出厂 [1,1,1] 温度 + 头版挂
//      「拟合后 ECE 0.081」的反例，防的就是证据与参数脱钩）；
//   2. 决策路径门禁 claimsInDecisionPath() / assertNoUncalibratedInDecisionPath()
//      ——路径上标 uncalibrated 即 throw（fail-closed）；
//   3. 漂移监测 recordDrift(sample) + checkDrift()——校准后 ECE 时间漂移
//      超阈**只提示不阻断**（对齐 v1.5.9 验证器老化检测同族纪律：
//      提示是观测不是执法——阻断会把「提示修校准」变成「服务不可用」）；
//   4. 四件套锚点 judgmentAnchor({weightsV, questionsV, criteriaV,
//      thresholdV})——一次判定由权重/问句集/判据集/阈值·评测集四件制品
//      共同决定，任一件变更即旧锚点 comparable:false（跨版本 ECE 对照
//      不退化成跨口径比数）。
//
// 与既有 decision-channel.CalibrationRegistry 的分界（防双 SSOT）：
// 那是 v1.5.4 判定通道的**分桶可用性读出面**（bucketKey → ECE 记录，
// isUsable 门控）；本文件是 §三的**纪律登记面**（决策路径上每个置信度/
// 阈值常量的校准状态声明）——一个登记「分桶校没校准」，一个登记「引擎
// 里每个被消费的数字有没有校准依据」。生产接线：intent-triage /
// policy-engine 消费（读 uncalibrated 状态转人审提示）。
// ============================================================

/** 校准判据纪律错误（fail-closed 载体） */
export class CalibrationRegistryError extends Error {
  constructor(message: string) {
    super(`[calibration-registry] ${message}`);
    this.name = 'CalibrationRegistryError';
  }
}

/** 校准状态两态（未标注来源的数字不得出现在决策路径上） */
export type CalibStatus = 'calibrated' | 'uncalibrated';

/** 校准依据三件（calibStatus='calibrated' 时必齐——少一件即拒载） */
export interface CalibrationEvidence {
  /** 校准集版本（拟合所用的独立校准集标识——ECE 达标的分母出处） */
  calibrationSetVersion: string;
  /** 拟合时 ECE（达阈读数——与冻结线 0.10 对照口径） */
  ece: number;
  /** 拟合时间（ISO 8601——校准依据的时效面） */
  fittedAt: string;
}

/** 置信度声明（登记单元——引擎内一个被消费的置信度/概率阈值） */
export interface ConfidenceClaim {
  /** 声明 id（唯一——重复登记同 id 覆盖） */
  id: string;
  /** 消费点路径（源码定位——如 engine/orchestrator/src/router/decision-channel.ts:DEFAULT_GRADE_THRESHOLDS） */
  path: string;
  /** 消费的置信度统计量（max-prob / normalized-entropy / margin——统计量一致性对账锚） */
  statistic: string;
  /** 校准状态（calibrated 须带 evidence） */
  calibStatus: CalibStatus;
  /** 校准依据（calibStatus='calibrated' 必填） */
  evidence?: CalibrationEvidence;
  /** 是否在决策路径上（分流/门控/执法消费——true 时 uncalibrated 即门禁红） */
  inDecisionPath: boolean;
  /** 登记注记（自由文本——人读） */
  note?: string;
}

/** 漂移监测样本（校准后运行期读数——时间漂移的观测面） */
export interface DriftSample {
  /** 观测时窗口标识（如小时桶 ISO 串） */
  window: string;
  /** 窗口内实测 ECE（校准后读数——对照拟合时 evidence.ece） */
  ece: number;
  /** 窗口样本量 */
  sampleCount: number;
}

/** 漂移提示对象（超阈返回——只提示不阻断） */
export interface DriftHint {
  /** 是否超阈（true = 提示——不是阻断） */
  exceeded: boolean;
  /** 超阈明细（逐条：窗口 ECE vs 拟合时 ECE + 阈差） */
  details: string[];
  /** 处置建议（重拟合提示——运维面） */
  action: 'refit-suggested' | 'none';
  /** 显式声明：只提示不阻断（纪律口径读数） */
  enforcement: 'hint-only';
}

/** 四件套锚点（一次判定的联合版本锚） */
export interface JudgmentAnchor {
  /** 权重制品版本（含校准参数） */
  weightsV: string;
  /** 问句集版本（随代码包走——锚点使其可追溯） */
  questionsV: string;
  /** 判据集版本 */
  criteriaV: string;
  /** 阈值/评测集版本 */
  thresholdV: string;
}

/** 可比性判定读数（锚点变更 → 旧记录不可比） */
export interface AnchorComparability {
  /** 新旧锚点是否可比（四件全同才可比） */
  comparable: boolean;
  /** 变更件清单（comparable=false 时非空） */
  changedComponents: string[];
}

// ════════════════════════════════════════
// 登记表
// ════════════════════════════════════════

/**
 * 校准依据声明登记表。
 *
 * 静态声明面（模块级单例）+ 可注入实例面（测试/多租户隔离）双形态：
 * 默认走单例（引擎内一处登记面），测试用 new CalibrationClaimRegistry()
 * 造独立实例防串扰。
 */
export class CalibrationClaimRegistry {
  private readonly claims = new Map<string, ConfidenceClaim>();
  private readonly driftSamples: DriftSample[] = [];

  /**
   * 登记置信度声明：
   *   - calibStatus='calibrated' 须带 evidence 且三件齐（校准集版本/ECE/
   *     拟合时间——少一件拒载：证据与参数脱钩 = 出厂零校准挂拟合后读数）；
   *   - evidence.ece 越界 [0,1] 拒载（ECE 是概率尺度误差）；
   *   - 同 id 再登记 = 覆盖（登记面幂等——最新声明生效）。
   */
  registerConfidenceClaim(claim: ConfidenceClaim): void {
    if (!claim.id || claim.id.trim() === '') {
      throw new CalibrationRegistryError('声明 id 为空（登记单元须可指认）');
    }
    if (!claim.path || claim.path.trim() === '') {
      throw new CalibrationRegistryError(`声明 ${claim.id} 缺 path（消费点源码定位）`);
    }
    if (!claim.statistic || claim.statistic.trim() === '') {
      throw new CalibrationRegistryError(`声明 ${claim.id} 缺 statistic（统计量一致性对账锚）`);
    }
    if (claim.calibStatus === 'calibrated') {
      const e = claim.evidence;
      if (!e) {
        throw new CalibrationRegistryError(
          `声明 ${claim.id} 标 calibrated 但缺 evidence（校准依据三件：校准集版本/ECE/拟合时间）`,
        );
      }
      if (!e.calibrationSetVersion || e.calibrationSetVersion.trim() === '') {
        throw new CalibrationRegistryError(`声明 ${claim.id} evidence 缺校准集版本`);
      }
      if (typeof e.ece !== 'number' || !Number.isFinite(e.ece) || e.ece < 0 || e.ece > 1) {
        throw new CalibrationRegistryError(`声明 ${claim.id} evidence.ece=${String(e.ece)} 非法（须 ∈ [0,1]）`);
      }
      if (!e.fittedAt || e.fittedAt.trim() === '') {
        throw new CalibrationRegistryError(`声明 ${claim.id} evidence 缺拟合时间`);
      }
    }
    this.claims.set(claim.id, { ...claim });
  }

  /** 读回单条（无则 undefined） */
  get(id: string): ConfidenceClaim | undefined {
    return this.claims.get(id);
  }

  /** 全部声明（普查读出面——VALIDATION.md 汇总表数据源） */
  all(): ConfidenceClaim[] {
    return [...this.claims.values()];
  }

  /** 登记数（合计数量落数面） */
  get size(): number {
    return this.claims.size;
  }

  /**
   * 决策路径上的声明（inDecisionPath=true 的子集——门禁的扫描面）。
   */
  claimsInDecisionPath(): ConfidenceClaim[] {
    return this.all().filter((c) => c.inDecisionPath);
  }

  /**
   * 门禁断言：决策路径上不得有 uncalibrated 声明——
   * 有即 throw（fail-closed：新增阈值走不通，除非先补校准依据）。
   * 「把纪律变成机制，不靠自觉」的执行点。
   */
  assertNoUncalibratedInDecisionPath(): void {
    const violating = this.claimsInDecisionPath().filter((c) => c.calibStatus === 'uncalibrated');
    if (violating.length > 0) {
      const list = violating.map((c) => `${c.id}（${c.path}）`).join('、');
      throw new CalibrationRegistryError(
        `决策路径上存在未校准置信度/阈值：${list}——未标注校准依据的数字不得出现在决策路径上（fail-closed）`,
      );
    }
  }

  // ── 漂移监测（只提示不阻断）────────────────

  /** 记录漂移观测样本（校准后运行期 ECE 读数——时间窗累积） */
  recordDrift(sample: DriftSample): void {
    if (typeof sample.ece !== 'number' || !Number.isFinite(sample.ece) || sample.ece < 0 || sample.ece > 1) {
      throw new CalibrationRegistryError(`漂移样本 ece=${String(sample.ece)} 非法（须 ∈ [0,1]）`);
    }
    if (!Number.isInteger(sample.sampleCount) || sample.sampleCount < 0) {
      throw new CalibrationRegistryError(`漂移样本 sampleCount=${String(sample.sampleCount)} 非法`);
    }
    this.driftSamples.push({ ...sample });
  }

  /**
   * 漂移检查：各窗口 ECE 对照基线（拟合时 evidence.ece——取登记面首条
   * calibrated 声明的读数；无 calibrated 声明时无基线可对照，返回未超阈
   * + details 说明）。超阈**只提示不阻断**（enforcement='hint-only'——
   * 与 v1.5.9 验证器老化检测同族：提示是观测不是执法）。
   */
  checkDrift(thresholdDelta = 0.05): DriftHint {
    const calibrated = this.all().find((c) => c.calibStatus === 'calibrated' && c.evidence);
    const details: string[] = [];
    if (!calibrated) {
      return {
        exceeded: false,
        details: ['无 calibrated 声明——漂移监测无基线可对照（登记面先补校准依据）'],
        action: 'none',
        enforcement: 'hint-only',
      };
    }
    const baseline = (calibrated.evidence as CalibrationEvidence).ece;
    for (const s of this.driftSamples) {
      if (s.ece - baseline > thresholdDelta) {
        details.push(`窗口 ${s.window}：ECE ${s.ece.toFixed(4)} 超基线 ${baseline.toFixed(4)} + ${thresholdDelta}（样本 ${s.sampleCount}）`);
      }
    }
    return {
      exceeded: details.length > 0,
      details: details.length > 0 ? details : ['各窗口 ECE 均在漂移阈内'],
      action: details.length > 0 ? 'refit-suggested' : 'none',
      enforcement: 'hint-only',
    };
  }
}

/** 引擎级单例（静态声明面——check-calibration-claims.sh 与运行时门禁共读） */
export const calibrationClaimRegistry = new CalibrationClaimRegistry();

// ════════════════════════════════════════
// 既有置信度普查（§三交付表「既有置信度普查」行——登记不改造）
// ════════════════════════════════════════

/**
 * 既有置信度普查登记（v1.7.0 落册——多数 uncalibrated，实际收敛归
 * v1.9.0；逐条对应源码消费点，汇总表落 docs/VALIDATION.md §校准判据纪律）。
 * 幂等：重复调用覆盖同 id 声明。
 */
export function registerLegacyConfidenceClaims(
  registry: CalibrationClaimRegistry = calibrationClaimRegistry,
): void {
  const claims: ConfidenceClaim[] = [
    {
      id: 'decision-channel/default-grade-thresholds/allow',
      path: 'engine/orchestrator/src/router/decision-channel.ts:152',
      statistic: 'max-prob',
      calibStatus: 'uncalibrated',
      inDecisionPath: true,
      note: 'ALLOW 档最低置信 0.8（DEFAULT_GRADE_THRESHOLDS.allowMinConfidence）——三段门控高自动段边界，未在独立校准集上拟合',
    },
    {
      id: 'decision-channel/default-grade-thresholds/ask',
      path: 'engine/orchestrator/src/router/decision-channel.ts:153',
      statistic: 'max-prob',
      calibStatus: 'uncalibrated',
      inDecisionPath: true,
      note: 'ASK 档最低置信 0.5（DEFAULT_GRADE_THRESHOLDS.askMinConfidence）——三段门控中复核段边界，未实测重标',
    },
    {
      id: 'intent-triage/l1-min-confidence',
      path: 'engine/orchestrator/src/router/intent-triage.ts:89',
      statistic: 'max-prob',
      calibStatus: 'uncalibrated',
      inDecisionPath: true,
      note: 'L1 语义分类置信阈 0.75（DEFAULT_TRIAGE_CONFIG.l1MinConfidence）——embedding 分类置信度未校准',
    },
    {
      id: 'decision-channel/default-calibration-policy/max-ece',
      path: 'engine/orchestrator/src/router/decision-channel.ts:288',
      statistic: 'max-prob',
      calibStatus: 'uncalibrated',
      inDecisionPath: true,
      note: '判定通道分桶门控 ECE 线 0.05（DEFAULT_CALIBRATION_POLICY.maxEce）——门控参数自身无校准集读数（v1.8.0 拟合面产出前为占位）',
    },
    {
      id: 'instinct-exporter/confidence-gate',
      path: 'engine/orchestrator/src/instinct/exporter.ts:79',
      statistic: 'max-prob',
      calibStatus: 'uncalibrated',
      inDecisionPath: false,
      note: 'instinct 导出置信门 0.7（DEFAULT_CONFIDENCE_THRESHOLD）——非分流决策路径（导出过滤面），登记不改造',
    },
    {
      id: 'instinct-scorer/confidence-threshold',
      path: 'engine/orchestrator/src/instinct/scorer.ts:21',
      statistic: 'max-prob',
      calibStatus: 'uncalibrated',
      inDecisionPath: false,
      note: 'instinct 打分置信门 0.7（DEFAULT_CONFIDENCE_THRESHOLD 定义处——exporter.ts 消费的常量本体），打分头输出非概率口径，登记不改造',
    },
    {
      id: 'route-request/match-threshold',
      path: 'engine/orchestrator/src/route/route-request.ts:163',
      statistic: 'similarity-score',
      calibStatus: 'uncalibrated',
      inDecisionPath: true,
      note: 'workflow 节点匹配阈 0.2（MATCH_THRESHOLD）——相似度得分非概率口径，路由决策路径消费',
    },
    {
      id: 'audit-decision-schema/confidence-tier',
      path: 'engine/audit/src/decision-schema.ts:130',
      statistic: 'ordinal-tier',
      calibStatus: 'uncalibrated',
      inDecisionPath: false,
      note: "decision-log 置信度三档 'high'|'med'|'low'——序数档位非概率（留痕面非门控面）",
    },
    {
      id: 'calibration-report/design-goal-claim',
      path: 'engine/orchestrator/src/router/calibration-report.ts:86',
      statistic: 'max-prob',
      calibStatus: 'uncalibrated',
      inDecisionPath: false,
      note: "v1.6.0 零样本校准报告 claimLevel='design-goal'（ECE 落数前只允许该表述——未宣称 verified）",
    },
    {
      id: 'train-calibration/ece-hard-line',
      path: 'engine/train/src/rlcd/calibration.ts:ECE_HARD_LINE',
      statistic: 'max-prob',
      calibStatus: 'calibrated',
      inDecisionPath: false,
      evidence: {
        calibrationSetVersion: 'THRESHOLDS.md@v1.7.0-frozen',
        ece: 0.1,
        fittedAt: '2026-10-20T00:00:00.000Z',
      },
      note: 'ECE 硬线 0.10——动工前冻结值（THRESHOLDS.md），取值依据 = 良校准件 0.04–0.08 与失校准件 0.13–0.37 分界档；非模型输出阈值（验收线本身）',
    },
    {
      id: 'train-calibration/statistic-name',
      path: 'engine/train/src/rlcd/calibration.ts:STATISTIC_NAME',
      statistic: 'max-prob',
      calibStatus: 'calibrated',
      inDecisionPath: false,
      evidence: {
        calibrationSetVersion: 'engine/train/src/rlcd/calibration.ts@v1.7.0',
        ece: 0,
        fittedAt: '2026-10-20T00:00:00.000Z',
      },
      note: 'ECE 拟合置信度统计量名 max-prob——统计量一致性对账锚（决策路径消费的统计量 == ECE 拟合所用统计量）',
    },
  ];
  for (const c of claims) registry.registerConfidenceClaim(c);
}

// ════════════════════════════════════════
// 四件套锚点（判定制品联合版本锚）
// ════════════════════════════════════════

/**
 * 构建四件套锚点（单次判定记录落四件版本号——权重/问句集/判据集/阈值·
 * 评测集）。四件全非空（缺一即拒载：锚点残缺 = 「这批判定用的哪四件」
 * 不可从制品读出，联合锚点失去意义）。
 */
export function judgmentAnchor(input: JudgmentAnchor): JudgmentAnchor & { schema: 'judgment-anchor/v1' } {
  for (const [k, v] of Object.entries(input)) {
    if (typeof v !== 'string' || v.trim() === '') {
      throw new CalibrationRegistryError(`锚点 ${k} 缺版本号（四件齐才可锚定——联合锚点不残缺）`);
    }
  }
  return { schema: 'judgment-anchor/v1', ...input };
}

/**
 * 锚点可比性判定：四件全同 → comparable；任一件变更 → comparable:false +
 * changedComponents 列名（旧记录仍可回答「当时用的是哪四件」，但新旧
 * ECE 读数不可对照——跨版本对照须同锚点）。
 */
export function anchorComparability(
  oldAnchor: JudgmentAnchor,
  newAnchor: JudgmentAnchor,
): AnchorComparability {
  const keys: Array<keyof JudgmentAnchor> = ['weightsV', 'questionsV', 'criteriaV', 'thresholdV'];
  const changedComponents = keys.filter((k) => oldAnchor[k] !== newAnchor[k]);
  return {
    comparable: changedComponents.length === 0,
    changedComponents,
  };
}
