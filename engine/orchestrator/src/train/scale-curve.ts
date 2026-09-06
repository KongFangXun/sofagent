// scale-curve.ts · v1.4.5 章五 · 缩放律拟合（零依赖 sigmoid 拟合 + 外推 + 置信区间）
//
// 定位：算力-性能遵循 sigmoid 缩放律（ScaleRL，arxiv 2510.13786——
// 论文公开可复现）。用几个小规模 pilot run 的（算力, 性能）数据点拟合
// 曲线，即可外推大规模 run 的性能天花板与算力需求——把训练预算控制
// 从「超了暂停」（v1.4.1 事后）升级为「投之前先算」（事前）。
//
// 零依赖纪律：不引入 ml 库——sigmoid 参数拟合用手写
// Levenberg-Marquardt 风格阻尼梯度下降（数值微分雅可比 + 阻尼步长
// 自适应），收敛即停；数据点 < 3 时降级为线性外推并明示置信低
// （devlog 验收口径：不硬报）。
//
// 模型：performance(x) = L / (1 + exp(-k * (x - x0)))
//   L  = 性能天花板（渐近线）
//   k  = 增长速率（单位算力的性能增益）
//   x0 = 拐点（收益减半的算力规模）
//
// 复用来源：
//   - 无外部依赖（对齐 data-ingest 手写解析器纪律）
//   - 置信区间口径对齐 DEFAULT_EVAL_THRESHOLDS 的「缺省显式常量」风格

// ══════════════════════════════════════
// 数据模型
// ══════════════════════════════════════

/** 单个 pilot run 的（算力, 性能）数据点 */
export interface ScaleCurvePoint {
  /** 算力投入（归一化单位：GPU 小时 / NPU 小时 / FLOPs 等——点间同单位即可） */
  compute: number;
  /** 性能（eval 分 0..100——与 Benchmark 协议化评分同口径） */
  performance: number;
}

/** sigmoid 拟合参数 */
export interface SigmoidParams {
  /** 性能天花板 L（> 0） */
  L: number;
  /** 增长速率 k（> 0） */
  k: number;
  /** 拐点 x0 */
  x0: number;
}

/** 拟合质量 */
export interface FitQuality {
  /** 均方根误差 RMSE（与 performance 同单位） */
  rmse: number;
  /** 决定系数 R²（1 = 完美拟合；负值 = 比均值还差） */
  r2: number;
  /** 迭代收敛次数（达到上限 = 未收敛） */
  iterations: number;
  /** 是否收敛 */
  converged: boolean;
}

/** 拟合结果 */
export interface FitResult {
  params: SigmoidParams | null;
  quality: FitQuality | null;
  /** 降级原因（params=null 时给——数据点不足/全常数/拟合发散） */
  degradedReason?: string;
}

/** 外推结果 */
export interface Extrapolation {
  /** 目标算力规模 */
  targetCompute: number;
  /** 外推性能（模型预测——params=null 时为线性外推或 null） */
  projectedPerformance: number | null;
  /** 性能天花板（sigmoid L；线性外推时 null） */
  ceiling: number | null;
  /** 置信水平 */
  confidence: 'high' | 'medium' | 'low';
  /** 置信说明（人读——决策面消费） */
  confidenceNote: string;
  /** 预测区间（±band——数据点少/未收敛时放宽） */
  band: { lower: number | null; upper: number | null };
}

// ══════════════════════════════════════
// sigmoid 数学核心（纯函数）
// ══════════════════════════════════════

/** sigmoid(x; L, k, x0)——数值安全版（防 exp 溢出） */
export function sigmoid(x: number, params: SigmoidParams): number {
  const z = params.k * (x - params.x0);
  // exp 溢出防护：|z| > 60 时用近似（sigmoid(z) ≈ 0 或 L）
  const e = z > 60 ? Number.POSITIVE_INFINITY : z < -60 ? 0 : Math.exp(-z);
  return params.L / (1 + e);
}

/** 初始参数估计（矩估计——数据驱动的合理起点） */
function initialGuess(points: readonly ScaleCurvePoint[]): SigmoidParams {
  const perf = points.map((p) => p.performance);
  const L = Math.max(...perf) * 1.15 + 1; // 天花板略高于观测最大值
  const minX = Math.min(...points.map((p) => p.compute));
  const maxX = Math.max(...points.map((p) => p.compute));
  const x0 = (minX + maxX) / 2; // 拐点取观测中位
  const range = Math.max(maxX - minX, 1);
  const k = 4 / range; // 观测区间内走完大半 sigmoid
  return { L, k, x0 };
}

/** 残差平方和（最小化目标） */
function sse(points: readonly ScaleCurvePoint[], params: SigmoidParams): number {
  let total = 0;
  for (const p of points) {
    const d = sigmoid(p.compute, params) - p.performance;
    total += d * d;
  }
  return total;
}

/**
 * 拟合 sigmoid 参数：Levenberg-Marquardt（数值微分雅可比 + 阻尼正规方程）。
 *
 * LM 每步解 3×3 线性方程组 (JᵀJ + λ·diag(JᵀJ))·δ = -Jᵀr——梯度尺度
 * 差异大（L 的梯度远大于 k/x0）也能稳定收敛（纯梯度下降在此地形会停滞）。
 * SSE 未改善 → λ×3 保守重试；改善 → λ×0.3 放大步长。
 * 参数越界（L≤0 / k≤0）钳制回正域——sigmoid 语义约束。
 */
export function fitSigmoid(
  points: readonly ScaleCurvePoint[],
  options: { maxIterations?: number } = {},
): FitResult {
  const maxIter = options.maxIterations ?? 200;
  if (points.length < 3) {
    return {
      params: null,
      quality: null,
      degradedReason: `数据点仅 ${points.length} 个（< 3）——sigmoid 三参数拟合至少需 3 点，降级处理`,
    };
  }
  // 性能全常数 → 无法拟合形状（L/k 不可辨识）
  const perfValues = new Set(points.map((p) => p.performance));
  if (perfValues.size === 1) {
    return {
      params: null,
      quality: null,
      degradedReason: '所有数据点性能相同——曲线形状不可辨识（可能是 pilot 规模差太小）',
    };
  }

  /** 残差向量 r_i = sigmoid(x_i) − y_i */
  const residuals = (params: SigmoidParams): number[] =>
    points.map((p) => sigmoid(p.compute, params) - p.performance);

  /** 数值微分雅可比 J[i][j]（中心差分——j: 0=L 1=k 2=x0） */
  const jacobian = (params: SigmoidParams): number[][] => {
    const eps = 1e-6;
    const keys = ['L', 'k', 'x0'] as const;
    return points.map((p) => {
      const row: number[] = [];
      for (const key of keys) {
        const plus: SigmoidParams = { ...params, [key]: (params[key] as number) + eps };
        const minus: SigmoidParams = { ...params, [key]: (params[key] as number) - eps };
        row.push((sigmoid(p.compute, plus) - sigmoid(p.compute, minus)) / (2 * eps));
      }
      return row;
    });
  };

  const sseOf = (r: number[]): number => r.reduce((s, d) => s + d * d, 0);

  let params = initialGuess(points);
  let r = residuals(params);
  let currentSse = sseOf(r);
  let lambda = 0.001;
  let iterations = 0;
  let converged = false;

  for (let iter = 0; iter < maxIter; iter++) {
    iterations = iter + 1;
    const J = jacobian(params);

    // JᵀJ（3×3）与 Jᵀr（3）
    const JtJ: number[][] = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const Jtr: number[] = [0, 0, 0];
    for (let i = 0; i < J.length; i++) {
      const row = J[i] as number[];
      const ri = r[i] as number;
      for (let a = 0; a < 3; a++) {
        Jtr[a] = (Jtr[a] as number) + (row[a] as number) * ri;
        for (let b = 0; b < 3; b++) {
          const jtjRow = JtJ[a] as number[];
          jtjRow[b] = (jtjRow[b] as number) + (row[a] as number) * (row[b] as number);
        }
      }
    }

    let accepted = false;
    for (let attempt = 0; attempt < 25; attempt++) {
      // 阻尼正规方程 (JᵀJ + λ·diag)·δ = −Jᵀr——高斯消元解 3×3
      const M: number[][] = [
        [...(JtJ[0] as number[]), -(Jtr[0] as number)],
        [...(JtJ[1] as number[]), -(Jtr[1] as number)],
        [...(JtJ[2] as number[]), -(Jtr[2] as number)],
      ];
      for (let a = 0; a < 3; a++) {
        const row = M[a] as number[];
        const jtjRow = JtJ[a] as number[];
        row[a] = (row[a] as number) + lambda * Math.max(jtjRow[a] as number, 1e-12);
      }
      const delta = solveLinear3(M);
      const d0 = delta?.[0] ?? 0;
      const d1 = delta?.[1] ?? 0;
      const d2 = delta?.[2] ?? 0;
      if (delta !== null && [d0, d1, d2].every((d) => Number.isFinite(d))) {
        const trial: SigmoidParams = {
          L: Math.max(1e-6, params.L + d0),
          k: Math.max(1e-6, params.k + d1),
          x0: params.x0 + d2,
        };
        const trialR = residuals(trial);
        const trialSse = sseOf(trialR);
        if (trialSse < currentSse) {
          const improvement = (currentSse - trialSse) / Math.max(currentSse, 1e-12);
          params = trial;
          r = trialR;
          currentSse = trialSse;
          lambda = Math.max(lambda * 0.3, 1e-9);
          accepted = true;
          if (improvement < 1e-12) converged = true;
          break;
        }
      }
      lambda = lambda < 1e12 ? lambda * 3 : lambda; // 失败 → 加大阻尼保守重试
      if (lambda >= 1e12) break;
    }
    if (converged) break;
    if (!accepted) {
      converged = iterations > 3; // 阻尼到极限仍无改善——已到局部最优
      break;
    }
  }

  // 拟合质量：RMSE + R²
  const n = points.length;
  const meanPerf = points.reduce((s, p) => s + p.performance, 0) / n;
  const ssTot = points.reduce((s, p) => s + (p.performance - meanPerf) ** 2, 0);
  const rmse = Math.sqrt(currentSse / n);
  const r2 = ssTot > 0 ? 1 - currentSse / ssTot : 0;

  return {
    params,
    quality: { rmse, r2, iterations, converged },
  };
}

/** 解 3×3 线性方程组（增广矩阵高斯消元 + 部分主元——奇异返回 null） */
function solveLinear3(aug: number[][]): number[] | null {
  const m: number[][] = aug.map((row) => [...row]);
  for (let col = 0; col < 3; col++) {
    // 部分主元
    let pivot = col;
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs((m[row] as number[])[col] as number) > Math.abs((m[pivot] as number[])[col] as number)) pivot = row;
    }
    if (Math.abs((m[pivot] as number[])[col] as number) < 1e-14) return null;
    if (pivot !== col) {
      const tmp = m[col] as number[];
      m[col] = m[pivot] as number[];
      m[pivot] = tmp;
    }
    for (let row = 0; row < 3; row++) {
      if (row === col) continue;
      const mRow = m[row] as number[];
      const mCol = m[col] as number[];
      const factor = (mRow[col] as number) / (mCol[col] as number);
      for (let k = col; k <= 3; k++) mRow[k] = (mRow[k] as number) - factor * (mCol[k] as number);
    }
  }
  return [0, 1, 2].map((i) => ((m[i] as number[])[3] as number) / ((m[i] as number[])[i] as number));
}

// ══════════════════════════════════════
// 外推（目标规模性能 + 置信区间）
// ══════════════════════════════════════

/**
 * 外推目标算力规模的性能。
 *
 * 置信分级（保守——宁降勿虚高）：
 *   high   = sigmoid 收敛 + R² ≥ 0.9 + ≥ 4 数据点
 *   medium = sigmoid 收敛 + R² ≥ 0.6 + ≥ 3 数据点
 *   low    = 其余（含线性外推兜底——devlog「数据点不足明示不硬报」）
 *
 * band：±bandWidth，sigmoid 时 band = max(RMSE, 5)；线性兜底时
 * band = ±15（拉宽——模型外用外推不可靠性更高）。
 */
export function extrapolate(
  points: readonly ScaleCurvePoint[],
  targetCompute: number,
  fit: FitResult = fitSigmoid(points),
): Extrapolation {
  const maxObserved = Math.max(...points.map((p) => p.compute));

  if (fit.params && fit.quality) {
    const predicted = sigmoid(targetCompute, fit.params);
    let confidence: Extrapolation['confidence'] = 'low';
    let note = '';
    if (fit.quality.converged && fit.quality.r2 >= 0.9 && points.length >= 4) {
      confidence = 'high';
      note = `sigmoid 拟合收敛（R²=${fit.quality.r2.toFixed(3)}，${points.length} 点）`;
    } else if (fit.quality.converged && fit.quality.r2 >= 0.6 && points.length >= 3) {
      confidence = 'medium';
      note = `sigmoid 拟合可用（R²=${fit.quality.r2.toFixed(3)}）——建议补 pilot 数据点提升置信`;
    } else {
      note = `拟合质量弱（R²=${fit.quality.r2.toFixed(3)}${fit.quality.converged ? '' : '，未收敛'}）——外推置信低，仅供参考`;
    }
    if (targetCompute > maxObserved * 10) {
      // 远超观测域的外推降一级置信（10 倍外风险自负）
      confidence = confidence === 'high' ? 'medium' : 'low';
      note += '；目标规模超观测域 10 倍+——外推置信降级';
    }
    const bandWidth = Math.max(fit.quality.rmse, 5);
    return {
      targetCompute,
      projectedPerformance: Math.round(predicted * 10) / 10,
      ceiling: Math.round(fit.params.L * 10) / 10,
      confidence,
      confidenceNote: note,
      band: {
        lower: Math.max(0, Math.round((predicted - bandWidth) * 10) / 10),
        upper: Math.min(100, Math.round((predicted + bandWidth) * 10) / 10),
      },
    };
  }

  // ── 兜底：≥2 点线性外推（明示置信低）；1 点 / 0 点 → null ──
  if (points.length === 2) {
    const first = points[0] as ScaleCurvePoint;
    const second = points[1] as ScaleCurvePoint;
    const [a, b] = first.compute <= second.compute ? [first, second] : [second, first];
    const slope = (b.performance - a.performance) / (b.compute - a.compute || 1);
    const intercept = a.performance - slope * a.compute;
    const predicted = Math.max(0, Math.min(100, slope * targetCompute + intercept));
    return {
      targetCompute,
      projectedPerformance: Math.round(predicted * 10) / 10,
      ceiling: null,
      confidence: 'low',
      confidenceNote: `数据点仅 2 个——sigmoid 不可拟合，线性外推兜底（置信低，不反映收益递减${fit.degradedReason ? `；${fit.degradedReason}` : ''}）`,
      band: {
        lower: Math.max(0, Math.round((predicted - 15) * 10) / 10),
        upper: Math.min(100, Math.round((predicted + 15) * 10) / 10),
      },
    };
  }
  return {
    targetCompute,
    projectedPerformance: null,
    ceiling: null,
    confidence: 'low',
    confidenceNote: `数据点仅 ${points.length} 个——无法外推（≥ 2 点走线性兜底、≥ 3 点拟合 sigmoid）`,
    band: { lower: null, upper: null },
  };
}

/** 建议下一个 pilot 规模（观测域中点加密——提升拟合置信的最优采样） */
export function suggestNextPilotCompute(points: readonly ScaleCurvePoint[]): number | null {
  if (points.length === 0) return 1; // 从最小规模起
  const sorted = [...points].sort((a, b) => a.compute - b.compute);
  // 最大的观测间隙中点（信息增益最大处）
  let maxGap = 0;
  const last = sorted[sorted.length - 1] as ScaleCurvePoint;
  let mid = last.compute * 2;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1] as ScaleCurvePoint;
    const curr = sorted[i] as ScaleCurvePoint;
    const gap = curr.compute - prev.compute;
    if (gap > maxGap) {
      maxGap = gap;
      mid = (curr.compute + prev.compute) / 2;
    }
  }
  // 所有间隙都近零（规模没拉开）→ 建议翻倍
  if (maxGap < 1e-9) return last.compute * 2;
  return mid;
}
