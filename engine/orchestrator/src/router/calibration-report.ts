// calibration-report.ts · 分桶可靠图 + ECE 计算（阶段二复用同件）
// ============================================================
// 口径纪律：「校准已验证」与「校准是设计目标」显式分档——ECE 落数前
// 对外只允许后一种表述；概率数值含义校验另行落数（不以 ECE 达标当
//「概率可用」的充分证据——构造已知题集归阶段二前置输入）。
//
// 位置说明（fresh-eyes run-01 项 15 登记）：本文件与 judge-eval 同族
//（评测产物——judge-eval 逐判据统计消费本件的分桶/ECE），router/ 为判定
// 底座统一落点（本版既成事实，不物理移动——移动会破 import 面与 SDK 台账；
// v1.7.0 复审归位）。
// ============================================================

/** 单条判定概率记录（评测样本的预测-真值对） */
export interface CalibrationRecord {
  /** 预测概率（判定头输出） */
  predicted: number;
  /** 真值（1=成立 / 0=不成立；分数目标按阈值二值化或另行处理） */
  actual: 0 | 1;
  /** 语言分区键（中英分列落数——不合并） */
  lang: 'zh' | 'en';
}

/** 分桶统计 */
export interface CalibrationBucket {
  /** 桶下界（含） */
  lower: number;
  /** 桶上界（不含末桶含） */
  upper: number;
  /** 样本数 */
  count: number;
  /** 桶内平均预测概率 */
  avgPredicted: number;
  /** 桶内真值频率 */
  avgActual: number;
}

export interface CalibrationReport {
  buckets: CalibrationBucket[];
  /** 期望校准误差（加权 |avgPredicted - avgActual|） */
  ece: number;
  /** 语言分列（zh/en 各自 ECE——不合并单一数字） */
  eceByLang: { zh: number; en: number };
  /** 样本量 */
  total: number;
  /** 表述档位（对外口径——ECE 落数前只允许 design-goal） */
  claimLevel: 'design-goal' | 'verified';
}

/** ECE 计算（nBuckets 等宽分桶——[0,0.1)...[0.9,1.0]） */
export function computeCalibration(
  records: CalibrationRecord[],
  opts?: { nBuckets?: number },
): CalibrationReport {
  const nBuckets = opts?.nBuckets ?? 10;
  const width = 1 / nBuckets;
  const byLang = { zh: [] as CalibrationRecord[], en: [] as CalibrationRecord[] };
  for (const r of records) byLang[r.lang].push(r);

  const bucketize = (recs: CalibrationRecord[]): { buckets: CalibrationBucket[]; ece: number } => {
    const buckets: CalibrationBucket[] = [];
    for (let i = 0; i < nBuckets; i++) {
      const lower = i * width;
      const upper = (i + 1) * width;
      const inBucket = recs.filter((r) =>
        i === nBuckets - 1 ? r.predicted >= lower && r.predicted <= upper : r.predicted >= lower && r.predicted < upper,
      );
      const count = inBucket.length;
      const avgPredicted = count === 0 ? 0 : inBucket.reduce((a, r) => a + r.predicted, 0) / count;
      const avgActual = count === 0 ? 0 : inBucket.reduce((a, r) => a + r.actual, 0) / count;
      buckets.push({ lower, upper, count, avgPredicted, avgActual });
    }
    const total = recs.length;
    const ece = total === 0 ? 0 : buckets.reduce((acc, b) => acc + (b.count / total) * Math.abs(b.avgPredicted - b.avgActual), 0);
    return { buckets, ece };
  };

  const all = bucketize(records);
  const zh = bucketize(byLang.zh);
  const en = bucketize(byLang.en);
  return {
    buckets: all.buckets,
    ece: all.ece,
    eceByLang: { zh: zh.ece, en: en.ece },
    total: records.length,
    // 设计目标档：本版零样本不宣称 verified（verified 须阶段二构造已知题集复算后才可标）
    claimLevel: 'design-goal',
  };
}
