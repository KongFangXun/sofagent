// decision-dataset-schema.ts · 判定数据集三元组格式 + 概率目标 + 校验（fail-closed）
// ============================================================
// 定位：v1.6.0 判定底座阶段一——数据集契约。(state, questions, answers)
// 三元组与第一章三原语类型同构（零格式分叉）；概率目标三形态可表达
// （choice 分布 / score 区间 / noul 真值概率）——只有硬标签的数据集训不出
// 校准，格式层必须预留。加载校验 fail-closed：不合规即拒绝整批。
//
// 关键纪律（写成字段/加载断言，不靠流程纪律——流程纪律会腐烂，字段约束不会）：
//   ① 删句样本不入训练集（「缺失 ≠ 为假」）
//   ② 对比样本标 no-probability-target 且不进校准集
//   ③ 家族级切分（同源家族不跨训练/评测集）
//   ④ 评测基准隔离（benchmark 标记——构建期拒绝）
//   ⑤ 租户隔离（enterpriseId 分区）
//   ⑥ 血缘锚点（样本→轨迹/PR/HITL 可反向追溯）
// ============================================================

// ── 三元组类型 ──────────────────────────────────────────

/** 标注来源三档（与 v1.5.8 域验证器口径一致） */
export type LabelSource = 'deterministic' | 'model-judge' | 'human-only';

/** 事实命题三态（「未知」与「为假」必须可分） */
export type FactStatus = 'supported' | 'refuted' | 'unknown';

/** 事实命题证书（对比样本四态快照随行） */
export interface FactProposition {
  /** 事实命题文本 */
  statement: string;
  status: FactStatus;
}

/** 证据证书：基线/反事实/删左/删右四组三态（对比样本必齐） */
export interface EvidenceCertificate {
  baseline: FactProposition[];
  counterfactual: FactProposition[];
  deletedLeft: FactProposition[];
  deletedRight: FactProposition[];
}

/** 判定问句（数据集侧——与 decision-primitives 的 DecisionQuestion 同构但不 import 运行时） */
export interface DatasetQuestion {
  kind: 'choice' | 'score' | 'noul';
  id: string;
  question: string;
  /** choice 全候选（含兜底）；score 2-10 级；noul 无 */
  options?: string[];
  scale?: string[];
}

/** 判定答案（含概率目标——分布/区间/真值概率三形态） */
export interface DatasetAnswer {
  kind: 'choice' | 'score' | 'noul';
  questionId: string;
  /** choice：选中项 */
  selected?: string;
  /** choice：全候选概率分布（概率目标形态一） */
  distribution?: Record<string, number>;
  /** score：分值 */
  value?: number;
  /** score：区间（概率目标形态二） */
  interval?: { lower: number; upper: number };
  uncertainty?: number;
  /** noul：真值概率（概率目标形态三） */
  probability?: number;
  /** 兜底/弃权留痕（choice） */
  fallbackSelected?: boolean;
  abstained?: boolean;
}

/** 对比样本标记（硬标签——不进校准集） */
export interface ContrastivePairMeta {
  isContrastive: true;
  /** 焦点翻转对的家族 id（家族级切分单元） */
  familyId: string;
  /** 焦点事实（改动即翻转的那一处） */
  focusFact: string;
  /** 改动词数（≤8——机械局部性检查，非单点改动证明） */
  changedWords: number;
  /** 证据证书（四组三态） */
  evidenceCertificate: EvidenceCertificate;
  /** 删句形态标记（true=删句样本——只校验不入训练） */
  isDeletionVariant?: boolean;
}

/** 血缘锚点（反向追溯三通道——至少其一） */
export interface ProvenanceAnchor {
  traceId?: string;
  prNumber?: number;
  hitlSessionId?: string;
}

/** 判定样本（三元组） */
export interface DecisionSample {
  /** 状态（非结构化输入快照） */
  state: string;
  /** 问句集（限定原语类型） */
  questions: DatasetQuestion[];
  /** 类型化答案（含概率目标） */
  answers: DatasetAnswer[];
  /** 标注来源（随样本持久化——训练侧按档加权） */
  label: { source: LabelSource };
  /** 血缘锚点 */
  provenance: ProvenanceAnchor;
  /** 租户（跨企业混入默认禁止） */
  enterpriseId: string;
  /** 评测基准标记（构建期拒绝——带标记者不进训练语料） */
  benchmark?: string[];
  /** 语言（中英占比分列落数的分区键） */
  lang: 'zh' | 'en';
  /** 对比样本元数据（有=对比对成员） */
  contrastive?: ContrastivePairMeta;
}

/** 数据集切分（三集分工 + 校验桶） */
export interface DatasetSplit {
  train: DecisionSample[];
  eval: DecisionSample[];
  /** 校准集（只有能表达概率目标的样本） */
  calibration: DecisionSample[];
  /** 删句校验桶（只作必要性校验——不入任何训练/评测/校准面） */
  deletionChecks: DecisionSample[];
}

// ── 校验错误 ────────────────────────────────────────────

export class DatasetSchemaError extends Error {
  constructor(message: string) {
    super(`[decision-dataset] ${message}`);
    this.name = 'DatasetSchemaError';
  }
}

const DIST_TOL = 1e-6;

// ── 概率目标三形态构造器与校验 ─────────────────────────

export function makeDistribution(target: Record<string, number>): Record<string, number> {
  const vals = Object.values(target);
  if (vals.some((v) => v < 0)) throw new DatasetSchemaError('分布含负概率');
  const sum = vals.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > DIST_TOL) throw new DatasetSchemaError(`分布和=${sum}（须≈1）`);
  return target;
}

export function makeInterval(lower: number, upper: number): { lower: number; upper: number } {
  if (lower > upper) throw new DatasetSchemaError('区间下界>上界');
  return { lower, upper };
}

export function makeProbability(p: number): number {
  if (p < 0 || p > 1) throw new DatasetSchemaError(`概率 ${p} 越界 [0,1]`);
  return p;
}

// ── 单样本校验 ──────────────────────────────────────────

export function validateSample(s: DecisionSample): string[] {
  const errs: string[] = [];
  const at = (m: string) => errs.push(m);
  if (!s.state || s.state.trim().length === 0) at('state 为空');
  if (!Array.isArray(s.questions) || s.questions.length === 0) at('questions 为空');
  if (!Array.isArray(s.answers) || s.answers.length === 0) at('answers 为空');
  if (!s.enterpriseId) at('enterpriseId 缺失（租户隔离）');
  if (!s.lang || !['zh', 'en'].includes(s.lang)) at('lang 须 zh|en（中英占比分列落数）');
  // 血缘锚点至少其一
  const p = s.provenance ?? {};
  if (!p.traceId && p.prNumber === undefined && !p.hitlSessionId) {
    at('血缘锚点缺失（traceId/prNumber/hitlSessionId 至少其一）');
  }
  // 问句-答案配对（类型匹配 + 无缺问）
  const qById = new Map((s.questions ?? []).map((q) => [q.id, q] as const));
  const answered = new Set<string>();
  for (const a of s.answers ?? []) {
    const q = qById.get(a.questionId);
    if (!q) { at(`答案 ${a.questionId} 无对应问句`); continue; }
    if (a.kind !== q.kind) at(`问句 ${q.id} 类型 ${q.kind} 与答案 ${a.kind} 不符`);
    if (answered.has(a.questionId)) at(`问句 ${q.id} 重复作答`);
    answered.add(a.questionId);
    // 概率目标形态校验（按原语）
    if (a.kind === 'choice' && a.distribution) {
      const vals = Object.values(a.distribution);
      const sum = vals.reduce((x, y) => x + y, 0);
      if (vals.some((v) => v < 0) || Math.abs(sum - 1) > DIST_TOL) {
        at(`问句 ${q.id} 分布非法（负概率或和=${sum.toFixed(4)}）`);
      }
    }
    if (a.kind === 'score' && a.interval && a.interval.lower > a.interval.upper) {
      at(`问句 ${q.id} 区间乱序`);
    }
    if (a.kind === 'noul' && a.probability !== undefined && (a.probability < 0 || a.probability > 1)) {
      at(`问句 ${q.id} 概率越界`);
    }
  }
  for (const q of s.questions ?? []) {
    if (!answered.has(q.id)) at(`问句 ${q.id} 缺答案`);
  }
  // 对比样本纪律
  if (s.contrastive) {
    const c = s.contrastive;
    if (!c.familyId) at('对比样本缺 familyId（家族级切分单元）');
    if (c.changedWords > 8) at(`对比样本改动 ${c.changedWords} 词超 8（机械局部性检查上限）`);
    const cert = c.evidenceCertificate;
    if (!cert || !cert.baseline || !cert.counterfactual || !cert.deletedLeft || !cert.deletedRight) {
      at('对比样本证据证书四组不齐（基线/反事实/删左/删右）');
    } else {
      // 删句必要性：删左/删右后焦点事实须变 unknown（否则删句样本对被拒）
      const focusIn = (arr: FactProposition[]) =>
        arr.some((f) => f.statement === c.focusFact && f.status !== 'unknown');
      const deletedSideKeeps = (focusIn(cert.deletedLeft) ? 'left' : '') + (focusIn(cert.deletedRight) ? 'right' : '');
      if (!c.isDeletionVariant && deletedSideKeeps) {
        at(`删句必要性检查失败：删${deletedSideKeeps}后焦点事实未变未知（冗余不冒充必需证据）`);
      }
    }
  }
  return errs;
}

// ── 数据集加载校验（fail-closed 整批）──────────────────

/**
 * 家族键（家族级切分单元）：对比样本取 `contrastive.familyId`，否则取血缘锚点键
 * （轨迹粒度——同一轨迹/会话/PR 视为同源家族，整体留同侧）。两条口径同源，
 * 均保证「同源不跨训练/评测集」。
 */
function familyKeyOf(s: DecisionSample): string {
  return (
    s.contrastive?.familyId
    ?? s.provenance.traceId
    ?? s.provenance.hitlSessionId
    ?? `pr-${s.provenance.prNumber ?? 'x'}`
  );
}

export function loadDataset(samples: DecisionSample[]): DatasetSplit {
  const errs: string[] = [];
  const train: DecisionSample[] = [];
  const evalSet: DecisionSample[] = [];
  const calibration: DecisionSample[] = [];
  const deletionChecks: DecisionSample[] = [];

  // 家族级切分（同源家族不跨训练/评测集，纪律③）：家族键 → 侧，**首见定侧**
  //（%4===3 → eval，≈25% 评测侧——复用 collectors/index.ts 既有「轨迹粒度切分 +
  // hash 轮转近似均衡」纪律，不另造规则）。同家族后续样本一律沿用首见侧。
  const familySide = new Map<string, 'train' | 'eval'>();
  let toggle = 0;
  const assignSide = (fam: string): 'train' | 'eval' => {
    let side = familySide.get(fam);
    if (side === undefined) {
      side = toggle % 4 === 3 ? 'eval' : 'train';
      toggle += 1;
      familySide.set(fam, side);
    }
    return side;
  };

  samples.forEach((s, i) => {
    const sampleErrs = validateSample(s);
    for (const e of sampleErrs) errs.push(`样本[${i}]：${e}`);

    // ① 删句样本不入训练集（「缺失 ≠ 为假」——加载期断言）；只作必要性校验，
    //    不属训练/评测任一侧（家族级切分按训练/评测两侧计）。
    if (s.contrastive?.isDeletionVariant) {
      deletionChecks.push(s); // 只作必要性校验
      return;
    }
    // ② benchmark 标记——构建期拒绝进训练（对照面 = 评测侧）
    if (s.benchmark && s.benchmark.length > 0) {
      evalSet.push(s); // 对照面可用
      return;
    }
    // ③ 家族级切分：同家族整体留同侧（家族键 = familyId，否则轨迹粒度键）
    const side = assignSide(familyKeyOf(s));
    // ④ 对比样本 no-probability-target 不进校准集（门四联动）
    const hasProbTarget = s.answers.some((a) =>
      (a.kind === 'choice' && a.distribution) ||
      (a.kind === 'score' && a.interval) ||
      (a.kind === 'noul' && a.probability !== undefined),
    );
    if (hasProbTarget && !s.contrastive) {
      calibration.push(s);
    }
    (side === 'train' ? train : evalSet).push(s);
  });

  // ⑤ 家族级泄漏检查：同一家族键同时出现在训练与评测集 → 拒载（fail-closed）。
  //    按**实际落集**对账（而非仅记侧），故 benchmark 携带与训练家族同 familyId 时
  //    亦被拦下——真断言，不回落到恒真。
  const trainFamilies = new Set(train.map(familyKeyOf));
  const reportedLeak = new Set<string>();
  for (const s of evalSet) {
    const fam = familyKeyOf(s);
    if (trainFamilies.has(fam) && !reportedLeak.has(fam)) {
      reportedLeak.add(fam);
      errs.push(`家族级泄漏：familyId=${fam} 同时出现在训练与评测集`);
    }
  }

  if (errs.length > 0) {
    throw new DatasetSchemaError(`数据集加载被拒（${errs.length} 处，fail-closed）：\n  ${errs.slice(0, 20).join('\n  ')}${errs.length > 20 ? `\n  …共 ${errs.length} 处` : ''}`);
  }
  return { train, eval: evalSet, calibration, deletionChecks };
}

// ── 对比样本四步构造（标签由代码导出——可复算）────────

/**
 * 构造焦点翻转对（四步：查规则→造对→双检→出标签）。
 * 标签 = code 用「规则能导出不同答案」的布尔事实导出——不由模型出标签。
 * 返回成对样本（baseline 态 + counterfactual 态），同 familyId。
 */
export function buildContrastivePair(opts: {
  familyId: string;
  state: string;
  counterfactualState: string;
  changedWords: number;
  focusFact: string;
  question: DatasetQuestion;
  /** 代码导出的两端标签（已查规则+已查事实算出——调用方负责可复算性） */
  labels: { baselineAnswer: DatasetAnswer; counterfactualAnswer: DatasetAnswer };
  evidence: {
    baseline: FactProposition[];
    counterfactual: FactProposition[];
    deletedLeft: FactProposition[];
    deletedRight: FactProposition[];
  };
  enterpriseId: string;
  lang: 'zh' | 'en';
  provenance: ProvenanceAnchor;
}): DecisionSample[] {
  const metaBase = {
    isContrastive: true as const,
    familyId: opts.familyId,
    focusFact: opts.focusFact,
    changedWords: opts.changedWords,
  };
  const mk = (
    state: string,
    answer: DatasetAnswer,
    cert: EvidenceCertificate,
    isDeletionVariant?: boolean,
  ): DecisionSample => ({
    state,
    questions: [opts.question],
    answers: [answer],
    label: { source: 'deterministic' as const }, // 标签由代码算——deterministic 档
    provenance: opts.provenance,
    enterpriseId: opts.enterpriseId,
    lang: opts.lang,
    contrastive: { ...metaBase, evidenceCertificate: cert, ...(isDeletionVariant ? { isDeletionVariant: true } : {}) },
  });
  const cert = (): EvidenceCertificate => ({
    baseline: opts.evidence.baseline,
    counterfactual: opts.evidence.counterfactual,
    deletedLeft: opts.evidence.deletedLeft,
    deletedRight: opts.evidence.deletedRight,
  });
  return [
    mk(opts.state, opts.labels.baselineAnswer, cert()),
    mk(opts.counterfactualState, opts.labels.counterfactualAnswer, cert()),
  ];
}
