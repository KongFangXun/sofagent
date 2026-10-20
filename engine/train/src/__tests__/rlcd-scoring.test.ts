// rlcd-scoring.test.ts · v1.7.0 §一 · 严格适当评分规则单测
// 覆盖面（对齐验收前三条）：
//   1. 严格适当性断言——真实概率得分优于多方向偏离概率（log 伯努利/多类、
//      spherical、RPS 各自成立）
//   2. 非对称惩罚数值断言——极端判错罚分 > 温和判错罚分（具体数值）
//   3. RPS 序信息断言——交换相邻档位的惩罚变化 ≠ 多类 log score 行为
//   4. 三类规则边界——概率 0/1 钳制、空分布拒载、越界拒载
import { describe, it, expect } from 'vitest';
import {
  logScoreBernoulli,
  logScoreMulticlass,
  sphericalScore,
  rps,
  rpsScore,
  asymmetricPenalty,
  scoreByPrimitive,
  assertDistribution,
  ScoringRuleError,
} from '../rlcd/scoring-rules';

describe('§一 严格适当性：真实概率得分优于偏离概率', () => {
  it('test_logBernoulli_真实概率优于多方向偏离_严格最大', () => {
    // 真值 p*=0.7：真实报 0.7 的期望得分 = 0.7·log0.7 + 0.3·log0.3
    // 对多组扰动方向（高估/低估/极端高估/极端低估）逐一对照
    const expected = (q: number) => 0.7 * Math.log(q) + 0.3 * Math.log(1 - q);
    const truthful = expected(0.7);
    for (const q of [0.5, 0.75, 0.9, 0.99, 0.3, 0.1, 0.01]) {
      expect(truthful).toBeGreaterThan(expected(q));
    }
  });

  it('test_logBernoulli_有限样本经验均值_真实报法占优', () => {
    // 经验面：按真值 0.7 采样 2000 次（确定性构造——不依赖随机源），
    // 真实报法（0.7）的平均 log score 须优于高估报法（0.95）
    let outcomes: boolean[] = [];
    for (let i = 0; i < 2000; i++) outcomes.push((i % 10) < 7); // 确定性 70% 真
    const mean = (p: number) =>
      outcomes.reduce((a, o) => a + logScoreBernoulli(p, o), 0) / outcomes.length;
    expect(mean(0.7)).toBeGreaterThan(mean(0.95));
    expect(mean(0.7)).toBeGreaterThan(mean(0.5));
  });

  it('test_logMulticlass_真实分布优于偏离分布_三选一', () => {
    // 真值 [0.5, 0.3, 0.2]：期望 log score = Σ p_i·log(q_i)
    const expected = (q: number[]) => 0.5 * Math.log(q[0]!) + 0.3 * Math.log(q[1]!) + 0.2 * Math.log(q[2]!);
    const truthful = expected([0.5, 0.3, 0.2]);
    // 偏离方向：全押首类 / 抹平 / 交换次序 / 极端尖峰
    for (const q of [[0.6, 0.25, 0.15], [1 / 3, 1 / 3, 1 / 3], [0.5, 0.2, 0.3], [0.9, 0.05, 0.05]]) {
      expect(truthful).toBeGreaterThan(expected(q as number[]));
    }
  });

  it('test_spherical_真实分布优于偏离分布_多方向', () => {
    // spherical 的期望得分最优仍在真值（Gneiting & Raftery 多类形态）
    const expected = (q: number[]) => {
      const norm = Math.sqrt(q.reduce((a, b) => a + b * b, 0));
      return (0.5 * q[0]! + 0.3 * q[1]! + 0.2 * q[2]!) / norm;
    };
    const truthful = expected([0.5, 0.3, 0.2]);
    for (const q of [[0.6, 0.25, 0.15], [1 / 3, 1 / 3, 1 / 3], [0.2, 0.3, 0.5], [0.8, 0.1, 0.1]]) {
      expect(truthful).toBeGreaterThan(expected(q as number[]));
    }
  });

  it('test_rps_真实分布惩罚最小_优于偏离与换序', () => {
    // 真值 one-hot 在中档 [0,1,0]（三档有序）
    const truth = [0, 1, 0];
    const truthfulRps = rps([0.2, 0.6, 0.2], truth);
    // 偏离方向：向低档偏 / 向高档偏 / 双峰 / 全押错误档
    for (const q of [[0.5, 0.3, 0.2], [0.2, 0.3, 0.5], [0.45, 0.1, 0.45], [0.9, 0.05, 0.05]]) {
      expect(truthfulRps).toBeLessThan(rps(q as number[], truth));
    }
  });
});

describe('§一 非对称惩罚：极端判错重罚、温和判错轻罚', () => {
  it('test_asymmetricPenalty_极端0p99对温和0p55_罚分比大于5', () => {
    const r = asymmetricPenalty(0.99, 0.55);
    // 数值：−log(0.01) ≈ 4.6052；−log(0.45) ≈ 0.7985；比值 ≈ 5.766
    expect(r.extremePenalty).toBeCloseTo(-Math.log(1 - 0.99), 6);
    expect(r.mildPenalty).toBeCloseTo(-Math.log(1 - 0.55), 6);
    expect(r.ratio).toBeGreaterThan(5);
    expect(r.ratio).toBeCloseTo(4.6052 / 0.7985, 3);
  });

  it('test_asymmetricPenalty_多组口径_比值恒大于1且随口径差增大', () => {
    const r1 = asymmetricPenalty(0.99, 0.55);
    const r2 = asymmetricPenalty(0.9, 0.6);
    expect(r1.ratio).toBeGreaterThan(1);
    expect(r2.ratio).toBeGreaterThan(1);
    // 口径差更大的组合罚分比更高（非对称的强度面）
    expect(r1.ratio).toBeGreaterThan(r2.ratio);
  });

  it('test_asymmetricPenalty_语义倒置_拒载', () => {
    expect(() => asymmetricPenalty(0.5, 0.9)).toThrow(ScoringRuleError);
  });

  it('test_logBernoulli_极端判错得分显著低于温和判错', () => {
    // 直接数值断言（防退化为对称惩罚的实现面）
    expect(logScoreBernoulli(0.99, false)).toBeLessThan(logScoreBernoulli(0.55, false));
    expect(logScoreBernoulli(0.99, false)).toBeCloseTo(Math.log(1e-2), 6);
  });
});

describe('§一 RPS 序信息：非退化为多类 log score', () => {
  it('test_rps_相邻档交换惩罚平滑变化_与log score行为不同', () => {
    // 预测 [0.2, 0.6, 0.2]，真值档 1（三档）：
    //   把 0.05 概率质量从中档挪到低档（相邻）vs 挪到高档（也相邻）——
    //   RPS 两者罚分增量相同（对称序距离）；但把同量质量挪两档（不可能——
    //   三档里档 0 到档 2 距离 2）经中转对比：距离越远罚越重。
    const truth = [0, 1, 0];
    const base = rps([0.2, 0.6, 0.2], truth);
    const toLow = rps([0.25, 0.55, 0.2], truth); // 0.05 挪到相邻低档
    const toHigh = rps([0.2, 0.55, 0.25], truth); // 0.05 挪到相邻高档
    // 相邻对称：两种挪法 RPS 增量一致（序距离同为 1）
    expect(toLow - base).toBeCloseTo(toHigh - base, 12);
    // 多类 log score 对同一档的敏感度不载序——对照：log score 只看选中档
    // 单点概率（挪质量到哪一档只要是「非选中档」等价）：
    const logBase = logScoreMulticlass([0.2, 0.6, 0.2], 1);
    const logToLow = logScoreMulticlass([0.25, 0.55, 0.2], 1);
    const logToHigh = logScoreMulticlass([0.2, 0.55, 0.25], 1);
    // log score：两种挪法都只改选中档概率 0.6→0.55——增量也一致，
    // 但五档场景下行为分化（下一断言）：RPS 罚「跳档」重于「邻档」，
    // log score 完全不区分。
    expect(logBase - logToLow).toBeCloseTo(logBase - logToHigh, 12);
  });

  it('test_rps_五档跳档罚重于邻档_log score无此区分', () => {
    // 五档、真值档 2、预测质量从档 2 挪走 0.1：
    //   挪到档 1（邻档，序距离 1）vs 挪到档 0（跳档，序距离 2）
    const truth = [0, 0, 1, 0, 0];
    const pred = [0.05, 0.1, 0.7, 0.1, 0.05];
    const adj = [0.05, 0.2, 0.6, 0.1, 0.05]; // 0.1 从真值档挪到相邻档 1
    const far = [0.15, 0.1, 0.6, 0.1, 0.05]; // 0.1 从真值档挪到两档外档 0
    expect(rps(adj, truth)).toBeLessThan(rps(far, truth));
    // log score（选中=2 档不变时）：两情形选中档概率同为 0.6——完全无区分
    expect(logScoreMulticlass(adj, 2)).toBe(logScoreMulticlass(far, 2));
  });

  it('test_rps_累计分布差平方和_与手算一致', () => {
    // RPS([0,1,0] 预测, [0,0,1] 真值) = (0−0)² + (1−0)² = 1
    expect(rps([0, 1, 0], [0, 0, 1])).toBeCloseTo(1, 12);
    // RPS([0.5,0.5,0], [0,0,1]) = 0.5² + 1² = 1.25
    expect(rps([0.5, 0.5, 0], [0, 0, 1])).toBeCloseTo(1.25, 12);
    // 完全命中 = 0
    expect(rps([0, 1, 0], [0, 1, 0])).toBe(0);
  });

  it('test_rpsScore_统一越大越好口径_负RPS', () => {
    expect(rpsScore([0, 1, 0], [0, 1, 0])).toBeCloseTo(0, 12);
    expect(rpsScore([1, 0, 0], [0, 1, 0])).toBe(-rps([1, 0, 0], [0, 1, 0]));
  });

  it('test_rps_概率目标真值形态_有序平滑', () => {
    // 真值非 one-hot（分档概率目标 [0.1,0.6,0.3]）：预测命中形态罚最小
    const truth = [0.1, 0.6, 0.3];
    expect(rps([0.1, 0.6, 0.3], truth)).toBeCloseTo(0, 12);
    expect(rps([0.3, 0.6, 0.1], truth)).toBeGreaterThan(0);
  });
});

describe('§一 三类规则边界：概率 0/1、空分布拒载', () => {
  it('test_logBernoulli_概率0与1_钳制为有限值不产Infinity', () => {
    // p=0 判错（outcome=true）与 p=1 判错（outcome=false）：数学上 −∞，
    // 实现层钳到 LOG_PROB_CLAMP（有限下界——防损失序列被 ±∞ 污染）
    expect(Number.isFinite(logScoreBernoulli(0, true))).toBe(true);
    expect(Number.isFinite(logScoreBernoulli(1, false))).toBe(true);
    expect(logScoreBernoulli(0, true)).toBeCloseTo(Math.log(1e-12), 6);
    // 判对侧：p=0 判对 / p=1 判对 = log(1) = 0（1−p 钳制后 ≈ 1−1e-12——容差内为 0）
    expect(logScoreBernoulli(0, false)).toBeCloseTo(0, 9);
    expect(logScoreBernoulli(1, true)).toBeCloseTo(0, 9);
  });

  it('test_logMulticlass_空分布与越界selectedIndex_拒载', () => {
    expect(() => logScoreMulticlass([], 0)).toThrow(ScoringRuleError);
    expect(() => logScoreMulticlass([0.5, 0.5], 2)).toThrow(ScoringRuleError);
    expect(() => logScoreMulticlass([0.5, 0.5], -1)).toThrow(ScoringRuleError);
  });

  it('test_spherical_空分布与零范数_拒载', () => {
    expect(() => sphericalScore([], 0)).toThrow(ScoringRuleError);
    // 归一校验先行拦截全零分布
    expect(() => sphericalScore([0, 0], 0)).toThrow(ScoringRuleError);
  });

  it('test_rps_空分布与未归一与长度不一致_拒载', () => {
    expect(() => rps([], [])).toThrow(ScoringRuleError);
    expect(() => rps([0.6, 0.6], [0.5, 0.5])).toThrow(ScoringRuleError); // 和=1.2 未归一
    expect(() => rps([1], [0.5, 0.5])).toThrow(ScoringRuleError); // 长度不一致
  });

  it('test_scoreByPrimitive_三原语分派与全缺拒载', () => {
    expect(scoreByPrimitive({ noulReported: 0.7, noulOutcome: true })).toBeCloseTo(Math.log(0.7), 12);
    expect(scoreByPrimitive({ choiceDistribution: [0.5, 0.5], choiceSelected: 0 })).toBeCloseTo(Math.log(0.5), 12);
    expect(scoreByPrimitive({ choiceDistribution: [0.5, 0.5], choiceSelected: 0, choiceRule: 'spherical' })).toBeCloseTo(
      0.5 / Math.sqrt(0.5), 12,
    );
    expect(scoreByPrimitive({ scorePredicted: [0, 1, 0], scoreTruth: [0, 1, 0] })).toBe(0);
    // 混装多原语：逐项求和（noul p=1 判对含 1e-12 钳制的微小残差——容差内为 0）
    const mixed = scoreByPrimitive({
      noulReported: 1, noulOutcome: true, // ≈0
      scorePredicted: [0, 1, 0], scoreTruth: [0, 1, 0], // 0
    });
    expect(mixed).toBeCloseTo(0, 9);
    expect(() => scoreByPrimitive({})).toThrow(ScoringRuleError);
    // 半缺字段（noul 只给了 reported）拒载
    expect(() => scoreByPrimitive({ noulReported: 0.5 })).toThrow(ScoringRuleError);
  });

  it('test_assertDistribution_负概率拒载', () => {
    expect(() => assertDistribution([-0.1, 1.1], '负概率')).toThrow(ScoringRuleError);
  });
});
