// rlcd-train.test.ts · v1.7.0 §一 · RLCD 训练回路单测（冒烟收敛 + 三防线 + 概率目标 + 加权配比 + 自检单 + 保留对照）
import { describe, it, expect } from 'vitest';
import {
  buildShortcutAuditReport,
  ShortcutAuditError,
  type ShortcutFeatureSample,
} from '../rlcd/shortcut-audit';
import {
  buildRetentionReport,
  RetentionReportError,
  type CapabilityReading,
} from '../rlcd/retention-report';
import {
  rlooBaseline,
  groupMeanBaseline,
  klAnchorLoss,
  klDivergence,
  resolveDownweight,
  selectOptimizationPath,
  buildRlcdConfig,
  policyStepLoss,
  POLICY_GRADIENT_DOWNWEIGHT,
  POLICY_GRADIENT_DOWNWEIGHT_MIN,
  POLICY_GRADIENT_DOWNWEIGHT_MAX,
  PolicyGradientError,
} from '../rlcd/policy-gradient';
import {
  preTrainCheck,
  runRlcdTraining,
  runSmokeLoop,
  assertProbabilityTarget,
  checkCoverage,
  checkRlcdBudget,
  resolveLabelSourceWeights,
  resolveTaskMixWeights,
  buildReproducibilityManifest,
  submitRlcdViaChannel,
  DEFAULT_LABEL_SOURCE_WEIGHTS,
  RLCD_TRAIN_BUDGET,
  type RlcdTrainSample,
  type TrainChannel,
} from '../rlcd/train-rlcd';
import type { TrainChannel as ChannelIface } from '../rlcd/../train-channel';

/** 造一条概率目标完备的 noul 样本（outcome 缺省真发生——奖励 = log p 单调于报法） */
function makeNoulSample(criterionId: string, language: 'zh' | 'en', p = 0.7): RlcdTrainSample {
  return {
    key: { criterionId, language },
    labelSource: 'deterministic',
    probabilityTarget: { noulReported: p, noulOutcome: true },
    realizedOutcome: { noulReported: p, noulOutcome: true },
  };
}

/** 造一条硬标签样本（缺概率目标——应被拒载） */
function makeHardLabelSample(criterionId: string, language: 'zh' | 'en'): RlcdTrainSample {
  return {
    key: { criterionId, language },
    labelSource: 'human',
    probabilityTarget: {},
    realizedOutcome: { noulReported: 1, noulOutcome: true },
  };
}

/** mock 通道（内存态——零真实网络） */
function makeMockChannel(): ChannelIface & { submitted: string[] } {
  const submitted: string[] = [];
  return {
    name: 'mock-rlcd',
    submitted,
    async submit(jobDir: string) {
      submitted.push(jobDir);
      return { remoteJobId: 'rlcd-mock-1', accepted: true };
    },
    async status() {
      return { status: 'succeeded', rawStatus: 'mock', recentEvents: [] };
    },
    async artifacts() {
      return [];
    },
    async cancel() {
      return { status: 'cancelled', rawStatus: 'mock', recentEvents: [] };
    },
  };
}

describe('§一 RLOO 基线（非组均值）', () => {
  it('test_rlooBaseline_留一均值_不含本样本', () => {
    const r = rlooBaseline([[1, 2, 3]]);
    // 留一均值：b0=(2+3)/2=2.5, b1=(1+3)/2=2, b2=(1+2)/2=1.5
    expect(r.baselines).toEqual([2.5, 2, 1.5]);
    expect(r.baselineMethod).toBe('rloo');
  });

  it('test_rlooBaseline_与组均值不同_可断言区分', () => {
    const groups = [[1, 2, 3]];
    const gm = groupMeanBaseline(groups);
    // 组均值恒 = 2（含本样本）；RLOO 逐样本偏离——两者不同（除非奖励全同）
    expect(rlooBaseline(groups).baselines).not.toEqual(gm);
    // 奖励全同时两者退化为同值（无偏性平凡的边界——合法）
    expect(rlooBaseline([[5, 5, 5]]).baselines).toEqual(groupMeanBaseline([[5, 5, 5]]));
  });

  it('test_rlooBaseline_组容量1_基线0并显式计数', () => {
    const r = rlooBaseline([[3], [1, 2]]);
    expect(r.baselines).toEqual([0, 2, 1]);
    expect(r.singleSampleGroups).toBe(1);
  });

  it('test_rlooBaseline_空组拒载', () => {
    expect(() => rlooBaseline([])).toThrow(PolicyGradientError);
    expect(() => rlooBaseline([[]])).toThrow(PolicyGradientError);
  });
});

describe('§一 KL 锚与降权（防 System-One 坍缩 / 防淹没 readout）', () => {
  it('test_klAnchorLoss_在位且随偏离增大', () => {
    const uniform = [0.5, 0.5];
    const near = klAnchorLoss([0.55, 0.45], uniform, { coefficient: 0.05 });
    const far = klAnchorLoss([0.99, 0.01], uniform, { coefficient: 0.05, budgetThreshold: 0.5 });
    expect(near.readout.anchor).toBe(true);
    expect(near.loss).toBeGreaterThan(0);
    expect(far.loss).toBeGreaterThan(near.loss);
    // 超锚预算只提示不阻断（far KL≈0.637 > 0.5 阈）
    expect(far.readout.overBudgetHint).toBe(true);
    expect(near.readout.overBudgetHint).toBe(false); // near KL≈0.005 未超默认阈 1.0
  });

  it('test_klDivergence_对称性与手算值', () => {
    expect(klDivergence([0.5, 0.5], [0.5, 0.5])).toBe(0);
    // KL([0.7,0.3]‖[0.5,0.5]) = 0.7·log1.4 + 0.3·log0.6
    const expected = 0.7 * Math.log(1.4) + 0.3 * Math.log(0.6);
    expect(klDivergence([0.7, 0.3], [0.5, 0.5])).toBeCloseTo(expected, 12);
    // 零概率承载：p=0 项贡献 0（0·log0=0 约定）
    expect(klDivergence([0, 1], [0.5, 0.5])).toBeCloseTo(Math.log(2), 12);
  });

  it('test_resolveDownweight_缺省0p1_区间外拒载', () => {
    expect(resolveDownweight().coefficient).toBe(POLICY_GRADIENT_DOWNWEIGHT);
    expect(resolveDownweight(0.15).coefficient).toBe(0.15);
    // 依据读数（7–12× 梯度比——注释同源）
    expect(resolveDownweight().basis).toBe('policy-gradient-to-readout-gradient-ratio-7-12x');
    expect(() => resolveDownweight(0.5)).toThrow(PolicyGradientError);
    expect(() => resolveDownweight(0.01)).toThrow(PolicyGradientError);
    expect(POLICY_GRADIENT_DOWNWEIGHT_MIN).toBeLessThan(POLICY_GRADIENT_DOWNWEIGHT);
    expect(POLICY_GRADIENT_DOWNWEIGHT_MAX).toBeGreaterThan(POLICY_GRADIENT_DOWNWEIGHT);
  });
});

describe('§一 路径选择器（supervised-first）', () => {
  it('test_selectPath_直接评分场景_监督优先', () => {
    const r = selectOptimizationPath({ hasTrajectory: false, delayedLabels: false, distributionDependentSampling: false });
    expect(r.path).toBe('supervised-first');
    expect(r.mode).toBe('supervised-first');
  });

  it('test_selectPath_轨迹或延迟标签或分布依赖采样_RL必要', () => {
    for (const f of [
      { hasTrajectory: true, delayedLabels: false, distributionDependentSampling: false },
      { hasTrajectory: false, delayedLabels: true, distributionDependentSampling: false },
      { hasTrajectory: false, delayedLabels: false, distributionDependentSampling: true },
    ]) {
      expect(selectOptimizationPath(f).path).toBe('rl');
    }
  });

  it('test_selectPath_强制RL须留理由', () => {
    expect(() =>
      selectOptimizationPath(
        { hasTrajectory: false, delayedLabels: false, distributionDependentSampling: false },
        { forcePath: 'rl' },
      ),
    ).toThrow(PolicyGradientError);
    const ok = selectOptimizationPath(
      { hasTrajectory: false, delayedLabels: false, distributionDependentSampling: false },
      { forcePath: 'rl', rlOverrideReason: '实验对照需要' },
    );
    expect(ok.path).toBe('rl');
  });
});

describe('§一 配置三件显式可查（baseline=rloo / klAnchor / 模式）', () => {
  it('test_buildRlcdConfig_三件齐备且显式', () => {
    const c = buildRlcdConfig({ seed: 42, learningRate: 5e-5 });
    expect(c.baselineMethod).toBe('rloo');
    expect(c.klAnchor.enabled).toBe(true);
    expect(typeof c.klAnchor.coefficient).toBe('number');
    expect(c.mode).toBe('supervised-first'); // 缺省场景特征 = 直接评分
    expect(c.policyGradientDownweight).toBe(POLICY_GRADIENT_DOWNWEIGHT);
    expect(c.seed).toBe(42);
  });

  it('test_policyStepLoss_分解读数_RLOO基线在损失内生效', () => {
    const c = buildRlcdConfig({ seed: 1, learningRate: 0.01 });
    const loss = policyStepLoss(c, {
      rewards: [1, 2, 3],
      logProbs: [Math.log(0.5), Math.log(0.3), Math.log(0.2)],
      policyDistribution: [0.5, 0.3, 0.2],
      anchorDistribution: [1 / 3, 1 / 3, 1 / 3],
    });
    // RLOO 基线在位（非组均值）：b=[2.5,2,1.5]
    expect(loss.rloo.baselines).toEqual([2.5, 2, 1.5]);
    // KL 锚项在位（>0——policy 偏离均匀锚）
    expect(loss.klAnchorTerm).toBeGreaterThan(0);
    expect(loss.klAnchor.anchor).toBe(true);
    // 降权在位（主项已乘系数——手算对照）
    const manual =
      -POLICY_GRADIENT_DOWNWEIGHT *
      (((1 - 2.5) * Math.log(0.5) + (2 - 2) * Math.log(0.3) + (3 - 1.5) * Math.log(0.2)) / 3);
    expect(loss.reinforceTerm).toBeCloseTo(manual, 12);
    expect(loss.total).toBeCloseTo(loss.reinforceTerm + loss.klAnchorTerm, 12);
    expect(loss.downweight.coefficient).toBe(POLICY_GRADIENT_DOWNWEIGHT);
  });

  it('test_policyStepLoss_长度不一致与空批拒载', () => {
    const c = buildRlcdConfig({ seed: 1, learningRate: 0.01 });
    expect(() =>
      policyStepLoss(c, {
        rewards: [1, 2],
        logProbs: [0],
        policyDistribution: [0.5, 0.5],
        anchorDistribution: [0.5, 0.5],
      }),
    ).toThrow(PolicyGradientError);
    expect(() =>
      policyStepLoss(c, {
        rewards: [],
        logProbs: [],
        policyDistribution: [0.5, 0.5],
        anchorDistribution: [0.5, 0.5],
      }),
    ).toThrow(PolicyGradientError);
  });
});

describe('§一 冒烟回路收敛（固定种子损失序列 + 末段斜率 < 0）', () => {
  it('test_runSmokeLoop_固定种子_损失序列可复现且末段斜率为负', () => {
    const config = buildRlcdConfig({ seed: 42, learningRate: 0.05 });
    const samples = [
      makeNoulSample('c:a', 'zh', 0.9),
      makeNoulSample('c:b', 'zh', 0.8),
      makeNoulSample('c:c', 'en', 0.7),
      makeNoulSample('c:d', 'en', 0.6),
    ];
    const r1 = runSmokeLoop({ config, samples, steps: 300 });
    const r2 = runSmokeLoop({ config, samples, steps: 300 });
    // 可复现：同入参同序列（逐项全等）
    expect(r2.lossSeries).toEqual(r1.lossSeries);
    // 损失序列落盘件非空且有限
    expect(r1.lossSeries.length).toBe(300);
    for (const s of r1.lossSeries) expect(Number.isFinite(s.loss)).toBe(true);
    // 末段期望损失斜率 < −1e-9（收敛方向——KL 锚平台下总斜率含微小上漂，
    // 收敛断言面在期望主项 tailScoreSlope 上；负向容差 −1e-9：收敛平台期的
    // 浮点噪声（|斜率|≤1e-9）不算收敛证据也不假红——见复核第 1 轮浮点噪声面）
    expect(r1.tailScoreSlope).toBeLessThan(-1e-9);
    // 策略确实向高奖励样本集中（toy 策略的可读收敛面：argmax(policy) = argmax(rewards)）
    const rewards = samples.map((s) => Math.log(s.probabilityTarget.noulReported as number));
    const maxIdx = r1.finalPolicy.indexOf(Math.max(...r1.finalPolicy));
    expect(maxIdx).toBe(rewards.indexOf(Math.max(...rewards)));
  });

  it('test_runSmokeLoop_不同种子序列不同_种子确实驱动随机性', () => {
    const samples = [
      makeNoulSample('c:a', 'zh', 0.9),
      makeNoulSample('c:b', 'en', 0.6),
    ];
    const r1 = runSmokeLoop({ config: buildRlcdConfig({ seed: 1, learningRate: 0.05 }), samples, steps: 50 });
    const r2 = runSmokeLoop({ config: buildRlcdConfig({ seed: 2, learningRate: 0.05 }), samples, steps: 50 });
    expect(r1.lossSeries).not.toEqual(r2.lossSeries);
  });

  it('test_runSmokeLoop_单样本k1拒载_单点策略收敛读数失义', () => {
    // 复核第 1 轮退化面：k=1 时 softmax 恒 [1.0]、KL 单点退化——
    // 「收敛」是数据退化不是训练成效，fail-closed 拒载
    expect(() =>
      runSmokeLoop({
        config: buildRlcdConfig({ seed: 1, learningRate: 0.05 }),
        samples: [makeNoulSample('c:a', 'zh', 0.9)],
        steps: 10,
      }),
    ).toThrow(/k=1/);
  });
});

describe('§一 概率目标消费断言（硬标签拒载）', () => {
  it('test_assertProbabilityTarget_概率目标在位_通过', () => {
    expect(() => makeNoulSample('c', 'zh')).not.toThrow();
    const choiceSample: RlcdTrainSample = {
      key: { criterionId: 'c', language: 'en' },
      labelSource: 'model-judge',
      probabilityTarget: { choiceDistribution: [0.5, 0.3, 0.2], choiceSelected: 0 },
      realizedOutcome: { choiceDistribution: [0.5, 0.3, 0.2], choiceSelected: 0 },
    };
    expect(() => assertProbabilityTarget(choiceSample)).not.toThrow();
  });

  it('test_assertProbabilityTarget_硬标签样本_拒载no_probability_target', () => {
    expect(() => assertProbabilityTarget(makeHardLabelSample('c', 'zh'))).toThrow(/no-probability-target/);
  });

  it('test_preTrainCheck_混合喂入_拒载数显式计数不静默', () => {
    const readout = preTrainCheck({
      criterionIds: ['c1', 'c2'],
      samples: [
        makeNoulSample('c1', 'zh'),
        makeNoulSample('c1', 'en'),
        makeHardLabelSample('c2', 'zh'), // 拒载——c2/en 无样本 → not-measured
      ],
      evaluatorVersion: 'eval-v0',
      seed: 7,
      learningRate: 5e-5,
      learningRateDocumented: '5e-5（配方文档）',
    });
    expect(readout.probabilityTargetPassed).toBe(2);
    expect(readout.rejectedHardLabelCount).toBe(1);
    // c2/en 覆盖档 not-measured（不硬凑）
    expect(readout.coverage.notMeasuredCount).toBeGreaterThanOrEqual(1);
  });

  it('test_preTrainCheck_全硬标签_整体拒载', () => {
    expect(() =>
      preTrainCheck({
        criterionIds: ['c1'],
        samples: [makeHardLabelSample('c1', 'zh')],
        evaluatorVersion: 'eval-v0',
        seed: 7,
        learningRate: 5e-5,
        learningRateDocumented: '5e-5',
      }),
    ).toThrow(/no-probability-target/);
  });

  it('test_preTrainCheck_空数据集_整体拒载（0样本通过0条即无效操作）', () => {
    // 复核第 1 轮漏报面：空数组曾因 guard 带 samples.length>0 前置而全绿放行
    expect(() =>
      preTrainCheck({
        criterionIds: ['c1'],
        samples: [],
        evaluatorVersion: 'eval-v0',
        seed: 7,
        learningRate: 5e-5,
        learningRateDocumented: '5e-5',
      }),
    ).toThrow(/数据集为空/);
  });
});

describe('§一 36 判据 × 中英覆盖检查（not-measured）', () => {
  it('test_checkCoverage_空档标not_measured_有样本即measured', () => {
    const readout = checkCoverage(
      ['c1', 'c2'],
      [makeNoulSample('c1', 'zh'), makeNoulSample('c1', 'zh'), makeNoulSample('c2', 'en')],
    );
    // 2 判据 × 2 语言 = 4 格；c1/en、c2/zh 空 → not-measured
    expect(readout.cells).toHaveLength(4);
    expect(readout.notMeasuredCount).toBe(2);
    const c1zh = readout.cells.find((c) => c.criterionId === 'c1' && c.language === 'zh')!;
    expect(c1zh.sampleCount).toBe(2);
    expect(c1zh.status).toBe('measured');
  });

  it('test_checkCoverage_36判据全集_72格全落', () => {
    const ids = Array.from({ length: 36 }, (_, i) => `crit-${i + 1}`);
    const readout = checkCoverage(ids, []);
    expect(readout.cells).toHaveLength(72);
    expect(readout.notMeasuredCount).toBe(72); // 空样本：全部 not-measured（不虚构）
  });
});

describe('§一 label.source 加权与任务配比落数', () => {
  it('test_resolveLabelSourceWeights_缺省档位序_human最高', () => {
    const w = resolveLabelSourceWeights();
    expect(w.human).toBeGreaterThan(w.deterministic);
    expect(w.deterministic).toBeGreaterThan(w['model-judge']);
    expect(w).toEqual({ ...DEFAULT_LABEL_SOURCE_WEIGHTS });
  });

  it('test_resolveLabelSourceWeights_档位序破坏拒载', () => {
    expect(() => resolveLabelSourceWeights({ human: 0.1 })).toThrow(/档位序破坏/);
    expect(() => resolveLabelSourceWeights({ deterministic: 1.5 })).toThrow(/档位序破坏/);
  });

  it('test_resolveTaskMixWeights_配比须归一且显式落数', () => {
    // NanoJev 同构：四任务 1/3+1/3+1/6+1/6
    const w = resolveTaskMixWeights({ a: 1 / 3, b: 1 / 3, c: 1 / 6, d: 1 / 6 });
    expect(w).toEqual({ a: 1 / 3, b: 1 / 3, c: 1 / 6, d: 1 / 6 });
    expect(() => resolveTaskMixWeights({ a: 0.5, b: 0.6 })).toThrow(/归一/);
    expect(() => resolveTaskMixWeights({})).toThrow(/空/);
  });

  it('test_preTrainCheck_加权与配比进读数_可审计', () => {
    const readout = preTrainCheck({
      criterionIds: ['a:1', 'b:1'],
      samples: [makeNoulSample('a:1', 'zh'), makeNoulSample('b:1', 'en')],
      evaluatorVersion: 'eval-v0',
      seed: 1,
      learningRate: 5e-5,
      learningRateDocumented: '5e-5',
      taskMixWeights: { a: 0.5, b: 0.5 },
      labelSourceWeights: { human: 1.2, deterministic: 0.9, 'model-judge': 0.4 },
    });
    expect(readout.labelSourceWeights).toEqual({ human: 1.2, deterministic: 0.9, 'model-judge': 0.4 });
    expect(readout.taskMixWeights).toEqual({ a: 0.5, b: 0.5 });
  });
});

describe('§一 可复现清单（快照双值）', () => {
  it('test_buildManifest_四件齐备_超参双列', () => {
    const m = buildReproducibilityManifest({
      samples: [makeNoulSample('c', 'zh')],
      evaluatorVersion: 'judge-eval@v1.7.0',
      seed: 42,
      hyperparams: [
        { name: 'learningRate', documentedValue: '5e-5（文档）', effectiveValue: 5e-5 },
        { name: 'loraR', documentedValue: 16, effectiveValue: 16 },
      ],
    });
    expect(m.datasetVersion).toMatch(/^[0-9a-f]{16}$/);
    expect(m.evaluatorVersion).toBe('judge-eval@v1.7.0');
    expect(m.seed).toBe(42);
    const lr = m.hyperparams.find((h) => h.name === 'learningRate')!;
    expect(lr.documentedValue).toContain('文档');
    expect(lr.effectiveValue).toBe(5e-5);
  });

  it('test_buildManifest_缺件拒载', () => {
    expect(() =>
      buildReproducibilityManifest({ samples: [], evaluatorVersion: '', seed: 1, hyperparams: [] }),
    ).toThrow(/评测器版本为空/);
  });

  it('test_preTrainCheck_同数据同种子_数据版本稳定', () => {
    const base = {
      criterionIds: ['c'],
      evaluatorVersion: 'e',
      learningRate: 1e-4,
      learningRateDocumented: 1e-4,
    } as const;
    const a = preTrainCheck({ ...base, seed: 1, samples: [makeNoulSample('c', 'zh')] });
    const b = preTrainCheck({ ...base, seed: 1, samples: [makeNoulSample('c', 'zh')] });
    const c = preTrainCheck({ ...base, seed: 2, samples: [makeNoulSample('c', 'zh')] });
    expect(a.reproducibility.datasetVersion).toBe(b.reproducibility.datasetVersion);
    expect(a.reproducibility.seed).not.toBe(c.reproducibility.seed);
  });
});

describe('§一 预算检查（THRESHOLDS.md 冻结值）', () => {
  it('test_checkBudget_上限在位_冻结值可查', () => {
    expect(RLCD_TRAIN_BUDGET.maxWallClockMinutes).toBe(120);
    expect(RLCD_TRAIN_BUDGET.maxPeakRssGB).toBe(16);
    expect(RLCD_TRAIN_BUDGET.memoryTier).toBe('unified-memory-mps');
    expect(checkRlcdBudget({}).downgrade).toBe('none');
  });

  it('test_checkBudget_超限标inconclusive_不缩评测集', () => {
    const r = checkRlcdBudget({ wallClockMinutes: 121, peakRssGB: 17 });
    expect(r.exceeded).toBe(true);
    expect(r.downgrade).toBe('inconclusive-handover');
    expect(r.violations).toHaveLength(2);
    // 单项超限同样 inconclusive
    expect(checkRlcdBudget({ wallClockMinutes: 200 }).exceeded).toBe(true);
  });
});

describe('§一 捷径自检单双列', () => {
  /** 造捷径特征：answer-length 有泄漏（判对的样本正确答案恒更长——特征与结果强相关） */
  function leakySamples(n: number) {
    return Array.from({ length: n }, (_, i) => {
      const correct = i % 2 === 0;
      return {
        correctAnswerLength: correct ? 60 : 20, // 判对 ⇒ 长答案（可学的长度捷径）
        wrongAnswerAvgLength: 25,
        correctOptionIndex: i % 4, // 位置均匀（单独看无泄漏——泄漏在长度维度）
        optionCount: 4,
        correct,
      };
    });
  }
  /** 判据位置泄漏样本（正确项恒在 B——answer-letter 维度） */
  function letterLeakySamples(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      correctAnswerLength: 30,
      wrongAnswerAvgLength: 30,
      correctOptionIndex: 1, // 全在 B
      optionCount: 4,
      correct: i % 2 === 0,
    }));
  }
  /** 干净特征：长度/位置/候选数与判对零相关 */
  function cleanSamples(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      correctAnswerLength: 20,
      wrongAnswerAvgLength: 20,
      correctOptionIndex: i % 4,
      optionCount: 4,
      correct: i % 2 === 0,
    }));
  }

  it('test_shortcutAudit_双列结构_清洗前后成对落数', () => {
    const r = (function () {
      // 经 runRlcdTraining 装配（自检单在总读数内）
      const config = buildRlcdConfig({ seed: 1, learningRate: 0.01 });
      const result = runRlcdTraining({
        config,
        samples: [makeNoulSample('c', 'zh'), makeNoulSample('c', 'en')],
        steps: 5,
        shortcutFeaturesBefore: leakySamples(40),
        shortcutFeaturesAfter: cleanSamples(40),
        targetCapabilities: [{ name: 'judge-agreement', before: 0.6, after: 0.8 }],
        retainedCapabilities: [{ name: 'zero-shot-readout', before: 0.7, after: 0.69 }],
      });
      return result;
    })();
    expect(r.shortcutAudit.cleaningApplied).toBe(true);
    // 双列齐备：before/after 各含三类捷径读数
    for (const col of [r.shortcutAudit.before, r.shortcutAudit.after]) {
      expect(col.answerLength.kind).toBe('answer-length');
      expect(col.answerLetter.kind).toBe('answer-letter');
      expect(col.optionCount.kind).toBe('option-count');
    }
    // 清洗前 answer-length 有泄漏、清洗后趋零（只许如实：读数来自构造样本）
    expect(r.shortcutAudit.before.answerLength.leakage).toBeGreaterThan(0.3);
    expect(r.shortcutAudit.after.answerLength.leakage).toBeLessThan(0.1);
    // answer-letter 维度独立验证：位置泄漏样本超额 > 0、均匀位置超额 = 0
    const letterLeak = buildShortcutAuditReport(letterLeakySamples(40));
    expect(letterLeak.before.answerLetter.leakage).toBeGreaterThan(0);
    expect(r.shortcutAudit.after.answerLetter.leakage).toBe(0);
  });

  it('test_shortcutAudit_未清洗_after沿用before且显式标注', () => {
    const r = buildShortcutAuditReport(leakySamples(20));
    expect(r.cleaningApplied).toBe(false);
    expect(r.after).toEqual(r.before);
  });

  it('test_shortcutAudit_空样本拒载_不产假读数', () => {
    expect(() => buildShortcutAuditReport([])).toThrow(ShortcutAuditError);
  });

  it('test_shortcutAudit_全单候选拒载_optionCount_1无选择面失义', () => {
    // 复核第 1 轮退化失效面：10×{optionCount:1} 曾静默产全 0 读数
    //（answerLetter 基线退化 1/1、Pearson 零方差恒 0）——单候选无选择面，
    // 「无捷径」是数据退化不是清洗成效，error 面拒载
    const singleOption: ShortcutFeatureSample[] = Array.from({ length: 10 }, () => ({
      correctAnswerLength: 10,
      wrongAnswerAvgLength: 10,
      correctOptionIndex: 0,
      optionCount: 1,
      correct: Math.random() > 0.5,
    }));
    expect(() => buildShortcutAuditReport(singleOption)).toThrow(/optionCount=1/);
    expect(() => buildShortcutAuditReport(singleOption)).toThrow(ShortcutAuditError);
  });

  it('test_shortcutAudit_混含多候选时单候选样本不触发拒载', () => {
    // 只要有实质选择面（≥1 样本 optionCount≥2）即正常出读数
    const mixed: ShortcutFeatureSample[] = [
      { correctAnswerLength: 10, wrongAnswerAvgLength: 10, correctOptionIndex: 0, optionCount: 1, correct: true },
      { correctAnswerLength: 12, wrongAnswerAvgLength: 8, correctOptionIndex: 1, optionCount: 3, correct: false },
      { correctAnswerLength: 14, wrongAnswerAvgLength: 6, correctOptionIndex: 2, optionCount: 3, correct: true },
    ];
    const r = buildShortcutAuditReport(mixed);
    expect(r.before.answerLetter.kind).toBe('answer-letter');
    expect(r.before.optionCount.leakage).toBeGreaterThanOrEqual(0);
  });
});

describe('§一 保留能力双键结构', () => {
  const config = buildRlcdConfig({ seed: 3, learningRate: 0.01 });

  it('test_retentionReport_两非空键分列_跌幅5pp内converged', () => {
    const r = runRlcdTraining({
      config,
      // 冒烟样本 ≥2（k=1 单点策略拒载——复核第 1 轮后新增断言面）
      samples: [makeNoulSample('c', 'zh'), makeNoulSample('c', 'en')],
      steps: 3,
      shortcutFeaturesBefore: [{ correctAnswerLength: 10, wrongAnswerAvgLength: 10, correctOptionIndex: 0, optionCount: 3, correct: true }],
      targetCapabilities: [{ name: 'judge-agreement', before: 0.66, after: 0.72 }],
      retainedCapabilities: [
        { name: 'zero-shot-mmlu', before: 0.688, after: 0.66 }, // −2.8pp
        { name: 'zero-shot-paws', before: 0.787, after: 0.76 }, // −2.7pp
      ],
    });
    const rep = r.retention;
    expect(rep.targetCapabilities).toHaveLength(1);
    expect(rep.retainedCapabilities).toHaveLength(2);
    expect(rep.recipeConvergence).toBe('converged');
    expect(rep.maxRetentionDropPP).toBeCloseTo(2.8, 6);
    expect(rep.dropThresholdPP).toBe(5);
  });

  it('test_retentionReport_跌幅超5pp_recipe_not_converged', () => {
    const r = runRlcdTraining({
      config,
      // 冒烟样本 ≥2（k=1 单点策略拒载——复核第 1 轮后新增断言面）
      samples: [makeNoulSample('c', 'zh'), makeNoulSample('c', 'en')],
      steps: 3,
      shortcutFeaturesBefore: [{ correctAnswerLength: 10, wrongAnswerAvgLength: 10, correctOptionIndex: 0, optionCount: 3, correct: true }],
      targetCapabilities: [{ name: 'judge-agreement', before: 0.66, after: 0.9 }],
      retainedCapabilities: [{ name: 'zero-shot-mmlu', before: 0.688, after: 0.6 }], // −8.8pp
    });
    expect(r.retention.recipeConvergence).toBe('recipe-not-converged');
    expect(r.retention.maxRetentionDropPP).toBeCloseTo(8.8, 6);
  });

  it('test_retentionReport_空键拒载_阈值只许收紧', () => {
    const ok = {
      targetCapabilities: [{ name: 't', before: 0.5, after: 0.6 }],
      retainedCapabilities: [{ name: 'r', before: 0.5, after: 0.5 }],
    };
    // 空键拒载（合并即失败——两键缺一不可）
    expect(() => buildRetentionReport({ ...ok, targetCapabilities: [] })).toThrow(RetentionReportError);
    expect(() => buildRetentionReport({ ...ok, retainedCapabilities: [] })).toThrow(RetentionReportError);
    // 阈值放宽方向拒载 / 收紧方向合法
    expect(() => buildRetentionReport({ ...ok, dropThresholdPP: 6 })).toThrow(/只许收紧/);
    expect(buildRetentionReport({ ...ok, dropThresholdPP: 3 }).dropThresholdPP).toBe(3);
  });
});

describe('§一 TrainChannel 提交（既有接口零改动）', () => {
  it('test_submitViaChannel_通道受理_事件语义走既有面', async () => {
    const ch = makeMockChannel();
    const manifestHash = 'a'.repeat(16);
    const result = await submitRlcdViaChannel(ch, '/tmp/jobdir', {
      jobId: 'rlcd-1',
      jobJsonSha256: 'b'.repeat(64),
      mode: 'rl',
      reproducibilityManifestHash: manifestHash,
    });
    expect(result.accepted).toBe(true);
    expect(result.remoteJobId).toBe('rlcd-mock-1');
    expect(ch.submitted).toEqual(['/tmp/jobdir']);
    // 状态轮询走通道既有语义（零改动面）
    const st = await ch.status(result.remoteJobId);
    expect(st.status).toBe('succeeded');
  });

  it('test_submitViaChannel_非法模式拒载', async () => {
    const ch = makeMockChannel();
    await expect(
      submitRlcdViaChannel(ch, '/tmp', {
        jobId: 'x',
        jobJsonSha256: 'b'.repeat(64),
        mode: 'nonsense' as never,
        reproducibilityManifestHash: 'a'.repeat(16),
      }),
    ).rejects.toThrow(/非法模式/);
  });
});

describe('§一 训练前检查总装配（预算快照 + 配置三件 + 覆盖 + 加权）', () => {
  it('test_preTrainCheck_全套读数齐备', () => {
    const readout = preTrainCheck({
      criterionIds: ['c1', 'c2'],
      samples: [makeNoulSample('c1', 'zh'), makeNoulSample('c2', 'en')],
      evaluatorVersion: 'judge-eval@v1.7.0',
      seed: 42,
      learningRate: 5e-5,
      learningRateDocumented: '5e-5',
    });
    // 配置三件
    expect(readout.config.baselineMethod).toBe('rloo');
    expect(readout.config.klAnchor.enabled).toBe(true);
    expect(readout.config.mode).toBe('supervised-first');
    // 预算快照（THRESHOLDS 冻结值随读数落数）
    expect(readout.budget.maxWallClockMinutes).toBe(120);
    // 可复现清单四件
    expect(readout.reproducibility.hyperparams.length).toBeGreaterThanOrEqual(3);
    const lr = readout.reproducibility.hyperparams.find((h) => h.name === 'learningRate')!;
    expect(lr.documentedValue).toBe('5e-5');
    expect(lr.effectiveValue).toBe(5e-5);
  });
});
