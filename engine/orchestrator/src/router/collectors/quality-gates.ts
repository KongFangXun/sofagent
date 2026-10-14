// collectors/quality-gates.ts · 四道质量门（fail-closed，拒收原因可查）
// ============================================================
// 门一来源真实性 / 门二跨集泄漏（轨迹级切分+私有哈希+零交集+防回放泄漏）/
// 门三标签噪声对账（冲突进复核不投票）/ 门四校准标注（概率目标门槛）。
// ============================================================
import type { DecisionSample } from '../decision-dataset-schema';
import { createHash } from 'node:crypto';

/** 样本私有哈希（门二——与公开基准零交集的锚定基础） */
export function privateSampleHash(s: DecisionSample): string {
  const key = JSON.stringify([s.state, s.questions.map((q) => [q.id, q.kind]), s.lang]);
  return createHash('sha256').update(key).digest('hex').slice(0, 24);
}

/** 门三复核队列条目（deterministic 与 human 冲突——不取多数票静默裁决） */
export interface ReviewQueueEntry {
  sampleHash: string;
  deterministicLabel: string;
  humanLabel: string;
}

export interface QualityGateReport {
  passed: DecisionSample[];
  rejected: Array<{ sample: DecisionSample; gate: string; reason: string }>;
  /** 门三复核队列 */
  reviewQueue: ReviewQueueEntry[];
  /** 门四：no-probability-target 样本（进训练不进校准） */
  noProbabilityTarget: DecisionSample[];
  /** 门四：可进校准集样本 */
  calibrationEligible: DecisionSample[];
}

/** 公开基准哈希集（门二零交集——调用方注入已知公开样本哈希） */
export type PublicBenchmarkHashes = Set<string>;

/** 切分点定义（门二防回放泄漏——切分点之后产生的信息不得进入之前的输入） */
export interface SplitPoint {
  /** 切分点时刻（ISO） */
  at: string;
}

export interface QualityGatesOptions {
  publicBenchmarkHashes?: PublicBenchmarkHashes;
  splitPoint?: SplitPoint;
  /** 同一样本的多档标签（键=私有哈希；值=各档标签）——门三对账输入 */
  multiSourceLabels?: Map<string, Array<{ source: string; label: string }>>;
}

export function runQualityGates(samples: DecisionSample[], opts: QualityGatesOptions = {}): QualityGateReport {
  const passed: DecisionSample[] = [];
  const rejected: QualityGateReport['rejected'] = [];
  const reviewQueue: ReviewQueueEntry[] = [];
  const noProbabilityTarget: DecisionSample[] = [];
  const calibrationEligible: DecisionSample[] = [];

  for (const s of samples) {
    const hash = privateSampleHash(s);
    // ── 门一 来源真实性 ──
    if ((s as { origin?: string }).origin === 'synthetic' || (s as { origin?: string }).origin === 'agent-self-report') {
      rejected.push({ sample: s, gate: 'gate-1-provenance', reason: '合成/自述来源默认拒收' });
      continue;
    }
    if (!s.provenance.traceId && !s.provenance.hitlSessionId && s.provenance.prNumber === undefined) {
      rejected.push({ sample: s, gate: 'gate-1-provenance', reason: '未建链（无血缘锚点）' });
      continue;
    }
    // ── 门二 跨集泄漏 ──
    if (opts.publicBenchmarkHashes?.has(hash)) {
      rejected.push({ sample: s, gate: 'gate-2-leakage', reason: '与公开基准/厂商评测集交集非空（测到记忆非能力）' });
      continue;
    }
    // 回放泄漏：切分点之后产生的信息进入之前输入——按 provenance 时序近似（带 postSplit 标记者拒）
    if ((s as { postSplitInfo?: boolean }).postSplitInfo) {
      rejected.push({ sample: s, gate: 'gate-2-leakage', reason: '回放泄漏：切分点后信息进入切分点前输入' });
      continue;
    }
    // ── 门三 标签噪声对账（冲突进复核队列——不投票） ──
    const labels = opts.multiSourceLabels?.get(hash);
    if (labels) {
      const det = labels.find((l) => l.source === 'deterministic');
      const hum = labels.find((l) => l.source === 'human-only');
      if (det && hum && det.label !== hum.label) {
        reviewQueue.push({ sampleHash: hash, deterministicLabel: det.label, humanLabel: hum.label });
        // 冲突样本不弃——进复核（passed 继续走，标记由调用方消费 reviewQueue 处置）
      }
    }
    // ── 门四 校准标注 ──
    // 判据（fresh-eyes run-01 项 9 对齐）：只有能表达**概率目标**的样本进校准集
    // （choice 分布 / score 区间 / noul 真值概率）——且概率语义须真实：采集器
    // 标 calibrationEligible=false（硬 disposition 映射出的合成概率——映射常数
    // 非概率目标）同判豁免。
    const hasProbTarget = s.answers.some((a) =>
      (a.kind === 'choice' && a.distribution) ||
      (a.kind === 'score' && a.interval) ||
      (a.kind === 'noul' && a.probability !== undefined),
    );
    if (hasProbTarget && s.calibrationEligible !== false) {
      calibrationEligible.push(s);
    } else if (!hasProbTarget) {
      noProbabilityTarget.push(s); // 硬标签：标 no-probability-target 不进校准
    }
    passed.push(s);
  }
  return { passed, rejected, reviewQueue, noProbabilityTarget, calibrationEligible };
}

/** 候选集冻结态（分数只能降不能升——无追加路径） */
export class FrozenCandidateSet {
  private readonly hashes: string[];
  private frozenScores: Map<string, number>;
  readonly frozenAt: string;
  constructor(samples: DecisionSample[], scores: Map<string, number>, frozenAt = new Date().toISOString()) {
    this.hashes = samples.map(privateSampleHash);
    this.frozenScores = new Map(scores);
    this.frozenAt = frozenAt;
  }
  /** 冻结后分数只能降（试图升即拒绝——堵「偷塞简单样本抬分」） */
  updateScore(hash: string, newScore: number): { ok: true } | { ok: false; reason: string } {
    const cur = this.frozenScores.get(hash);
    if (cur === undefined) return { ok: false, reason: '样本不在冻结集内（冻结后无追加路径——增补走新建集）' };
    if (newScore > cur) return { ok: false, reason: `冻结集分数只能降（${cur} → ${newScore} 试图上升）` };
    this.frozenScores.set(hash, newScore);
    return { ok: true };
  }
  get size(): number {
    return this.hashes.length;
  }
}

/** 门槛重标触发器（换基座/数据漂移——门槛绑定分布非任务名） */
export function shouldRecalibrateThresholds(event: { baseModelChanged?: boolean; driftDetected?: boolean }): boolean {
  return Boolean(event.baseModelChanged || event.driftDetected);
}
