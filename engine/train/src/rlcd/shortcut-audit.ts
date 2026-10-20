// shortcut-audit.ts · v1.7.0 §一 · 数据清洗三捷径自检单（answer-length / answer-letter / option-count）
// ============================================================
// 定位：判定训练数据的捷径泄漏自查（Jeff 一手蒸馏 v1.2 三捷径清单照抄——
// SSOT §一交付表「adapter-first 训练次序与数据清洗三捷径」②）。三类捷径：
//   - answer-length：正确答案与错误答案的**长度**系统性不同（模型学长度不学语义）
//   - answer-letter：正确答案的**选项字母/位置**有系统性偏置（如总在 B）
//   - option-count：**候选数量**与正确与否相关（模型数选项数猜答案）
// 外部实证：清洗后基准反降 79.1→78.7 且「更诚实不是更聪明」⇒ 验收读数
// **预留「清洗前后」双列**（只许如实，不许回填）——本文件的读数结构把
// 双列做成类型约束（before/after 成对缺一不可），不是文档建议。
//
// 纯函数层：输入样本快照（清洗前后各一），输出自检单读数。检测器按
// 「捷径相关性」给指标：与捷径特征的相关越强，泄漏风险越高。
// ============================================================

/** 捷径自检单错误（fail-closed 载体） */
export class ShortcutAuditError extends Error {
  constructor(message: string) {
    super(`[shortcut-audit] ${message}`);
    this.name = 'ShortcutAuditError';
  }
}

/** 三类捷径（闭合枚举——照抄外部清单，不增删） */
export type ShortcutKind = 'answer-length' | 'answer-letter' | 'option-count';

/** 全部捷径清单（审计面：三类全覆盖的自查依据） */
export const SHORTCUT_KINDS: readonly ShortcutKind[] = [
  'answer-length',
  'answer-letter',
  'option-count',
];

/** 单条训练样本的捷径特征快照（采集面——由数据管道喂数） */
export interface ShortcutFeatureSample {
  /** 正确答案文本长度（字符数——answer-length 特征） */
  correctAnswerLength: number;
  /** 错误答案平均文本长度（同上） */
  wrongAnswerAvgLength: number;
  /** 正确答案的选项字母/位置索引（0-based——answer-letter 特征） */
  correctOptionIndex: number;
  /** 该题候选数量（option-count 特征） */
  optionCount: number;
  /** 是否判对（相关性的结果变量——捷径特征与「判对」的相关即泄漏强度） */
  correct: boolean;
}

/**
 * 三类捷径的分离度读数（单列口径——清洗前 or 清洗后各算一次）：
 * 每项 ∈ [0, 1]：0 = 无捷径可学（特征与结果零相关），1 = 完全可学（特征
 * 完全决定结果）。检测统计量（可复算）：
 *   - answer-length：正确/错误答案长度差与判对的 |Pearson|（长度差不解释
 *     判对 ⇒ 0）
 *   - answer-letter：正确项位置索引的 |变异系数贡献|——用「最常见正确位置
 *     的占比 vs 均匀基线 1/k」的超额（位置偏置强度）
 *   - option-count：候选数与判对的 |Pearson|
 */
export interface ShortcutSeparationReadout {
  kind: ShortcutKind;
  /** 捷径强度 ∈ [0,1]（越大越可被模型走捷径） */
  leakage: number;
  /** 读数依据（人可读——审计对账） */
  basis: string;
}

/** 单列读数（三类齐备） */
export interface ShortcutAuditColumn {
  answerLength: ShortcutSeparationReadout;
  answerLetter: ShortcutSeparationReadout;
  optionCount: ShortcutSeparationReadout;
}

/** Pearson 相关系数（样本协方差/标准差——n<2 或零方差返回 0：不可算即无相关证据） */
function pearson(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (xs[i] as number) - mx;
    const dy = (ys[i] as number) - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx === 0 || vy === 0) return 0;
  return cov / Math.sqrt(vx * vy);
}

/** 对单列样本快照算三类捷径分离度（清洗前/清洗后各调一次） */
export function auditShortcutColumn(samples: readonly ShortcutFeatureSample[]): ShortcutAuditColumn {
  if (samples.length === 0) {
    throw new ShortcutAuditError('样本为空（无可自检读数——fail-closed 拒载，不产 0 假读数）');
  }
  const ys = samples.map((s) => (s.correct ? 1 : 0));

  // answer-length：长度差与判对的 |Pearson|
  const lengthDiffs = samples.map((s) => s.correctAnswerLength - s.wrongAnswerAvgLength);
  const lengthCorr = Math.abs(pearson(lengthDiffs, ys));

  // answer-letter：最常见正确位置的超额占比（相对均匀基线）
  // 均匀基线取**候选位宽**（optionCount 的最大值——数据面上出现过的选项位宽），
  // 不是「样本中出现过的位置数」：全落在 B 时出现位置数 = 1，若按出现位置数
  // 取基线会把「恒在 B」误判为零泄漏（基线被泄漏本身污染——自指错误）。
  const byIndex = new Map<number, number>();
  let maxOptionCount = 0;
  for (const s of samples) {
    byIndex.set(s.correctOptionIndex, (byIndex.get(s.correctOptionIndex) ?? 0) + 1);
    if (s.optionCount > maxOptionCount) maxOptionCount = s.optionCount;
  }
  let maxCount = 0;
  let maxK = 0;
  for (const [k, c] of byIndex) {
    if (c > maxCount) {
      maxCount = c;
      maxK = k;
    }
  }
  const uniform = 1 / Math.max(maxOptionCount, 1);
  const letterLeakage = Math.max(0, maxCount / samples.length - uniform);

  // option-count：候选数与判对的 |Pearson|
  const counts = samples.map((s) => s.optionCount);
  const countCorr = Math.abs(pearson(counts, ys));

  return {
    answerLength: {
      kind: 'answer-length',
      leakage: lengthCorr,
      basis: '|Pearson(正确−错误答案长度差, 判对)|',
    },
    answerLetter: {
      kind: 'answer-letter',
      leakage: letterLeakage,
      basis: `最常见正确位置 ${maxK} 占比 − 均匀基线 ${uniform.toFixed(3)}（位宽 ${maxOptionCount}，n=${samples.length}）`,
    },
    optionCount: {
      kind: 'option-count',
      leakage: countCorr,
      basis: '|Pearson(候选数, 判对)|',
    },
  };
}

/** 双列自检单读数（验收面：清洗前后成对——类型层保证双列齐备） */
export interface ShortcutAuditReport {
  /** 清洗前读数（如实——不回填） */
  before: ShortcutAuditColumn;
  /** 清洗后读数（如实——不回填；未清洗时与 before 同值并显式标注） */
  after: ShortcutAuditColumn;
  /** 清洗是否已执行（false = after 沿用 before 读数——审计可查） */
  cleaningApplied: boolean;
}

/**
 * 产双列自检单：清洗前后各一列（读数双列的验收载体）。
 * afterSamples 缺省（清洗未做）时 after = before 且 cleaningApplied=false——
// 只许如实：没有清洗就没有 after 读数，不造数。
 */
export function buildShortcutAuditReport(
  beforeSamples: readonly ShortcutFeatureSample[],
  afterSamples?: readonly ShortcutFeatureSample[],
): ShortcutAuditReport {
  const before = auditShortcutColumn(beforeSamples);
  if (afterSamples === undefined) {
    return { before, after: before, cleaningApplied: false };
  }
  return { before, after: auditShortcutColumn(afterSamples), cleaningApplied: true };
}
