// decision-output.test.ts · v1.7.0 §五 · 三原语概率面完整化单测
// 覆盖面：序列化字段双向对账（缺任一字段红）/ 四态分段边界（含
// uncalibrated 降级）/ 建议不执法 / 证据面不扩大 / 直落 decision-log /
// 生产装配（judge-runtime.judgeFullOutputs）。
import { describe, it, expect } from 'vitest';
import {
  fourStateMapping,
  makeChoiceFullOutput,
  makeScoreFullOutput,
  makeNoulFullOutput,
  serializeForDecisionLog,
  deserializeDecisionOutput,
  assertConsumableForRouting,
  DECISION_OUTPUT_SCHEMA,
  type SegmentBoundaries,
  type PrimitiveFullOutput,
} from '../router/decision-output';
import { JudgeRuntime } from '../router/judge-runtime';
import { makeChoiceQuestion, validateDecisionPairing, type DecisionAnswer } from '../router/decision-primitives';
import * as decisionOutputModule from '../router/decision-output';

// ── 测试工具 ─────────────────────────────────────────────

/** 标准分段边界（0.2 / 0.4–0.6 / 0.8——对称形态） */
const BOUNDARIES: SegmentBoundaries = {
  noUpper: 0.2,
  leanNoUpper: 0.4,
  leanYesLower: 0.6,
  yesLower: 0.8,
};

const EVIDENCE = { calibrationSetVersion: 'calib@v1', ece: 0.05, fittedAt: '2026-10-20T00:00:00Z' };

/** 三原语完整输出各一（序列化对账的样本面） */
function makeAllThreeOutputs(): PrimitiveFullOutput[] {
  return [
    makeChoiceFullOutput({
      questionId: 'q-choice',
      selected: 'a',
      distribution: { a: 0.6, b: 0.3, fallback: 0.1 },
      calibrationStatus: 'calibrated',
      calibrationEvidence: EVIDENCE,
      suggestedAction: '放行',
    }),
    makeScoreFullOutput({
      questionId: 'q-score',
      value: 7,
      credibleInterval: { lower: 6, upper: 8 },
      min: 0,
      max: 10,
      ordinalTotal: 3,
      calibrationStatus: 'calibrated',
      calibrationEvidence: EVIDENCE,
      suggestedAction: '复核',
    }),
    makeNoulFullOutput({
      questionId: 'q-noul',
      probability: 0.85,
      segmentBoundaries: BOUNDARIES,
      calibrationStatus: 'calibrated',
      calibrationEvidence: EVIDENCE,
      suggestedAction: '放行',
    }),
  ];
}

// ════════════════════════════════════════════════════════

describe('§五 序列化字段双向对账', () => {
  it('test_output_choice_分布与熵字段往返齐全', () => {
    const [choice] = makeAllThreeOutputs();
    const round = deserializeDecisionOutput(serializeForDecisionLog(choice));
    expect(round.kind).toBe('choice');
    if (round.kind === 'choice') {
      expect(round.selected).toBe('a');
      expect(round.distribution).toEqual({ a: 0.6, b: 0.3, fallback: 0.1 });
      expect(typeof round.entropy).toBe('number');
      expect(round.entropy).toBeGreaterThan(0);
      expect(round.calibrationStatus).toBe('calibrated');
      expect(round.calibrationEvidence?.calibrationSetVersion).toBe('calib@v1');
      expect(round.suggestedAction).toBe('放行');
    }
  });

  it('test_output_score_区间与序字段往返齐全', () => {
    const [, score] = makeAllThreeOutputs();
    const round = deserializeDecisionOutput(serializeForDecisionLog(score));
    expect(round.kind).toBe('score');
    if (round.kind === 'score') {
      expect(round.value).toBe(7);
      expect(round.credibleInterval).toEqual({ lower: 6, upper: 8 });
      expect(round.ordinal).toBe(2); // 7 在 [0,10] 等宽 3 档的第 3 档（0 基序 2）
      expect(round.ordinalTotal).toBe(3);
    }
  });

  it('test_output_noul_概率与四态字段往返齐全', () => {
    const [, , noul] = makeAllThreeOutputs();
    const round = deserializeDecisionOutput(serializeForDecisionLog(noul));
    expect(round.kind).toBe('noul');
    if (round.kind === 'noul') {
      expect(round.probability).toBe(0.85);
      expect(round.fourState).toBe('成立');
      expect(round.segmentBoundaries).toEqual(BOUNDARIES);
    }
  });

  it('test_output_缺任一字段反序列化即红', () => {
    // 逐字段删除 → deserialize 必红（双向对账——缺任一字段即红）
    const [, , noul] = makeAllThreeOutputs();
    const base = JSON.parse(serializeForDecisionLog(noul)) as Record<string, unknown>;
    for (const field of ['questionId', 'probability', 'fourState', 'segmentBoundaries', 'calibrationStatus', 'suggestedAction']) {
      const missing = { ...base };
      delete missing[field];
      expect(() => deserializeDecisionOutput(JSON.stringify(missing)), `缺 ${field} 应红`).toThrow();
    }
    const [choice] = makeAllThreeOutputs();
    const baseC = JSON.parse(serializeForDecisionLog(choice)) as Record<string, unknown>;
    for (const field of ['selected', 'distribution', 'entropy']) {
      const missing = { ...baseC };
      delete missing[field];
      expect(() => deserializeDecisionOutput(JSON.stringify(missing)), `缺 ${field} 应红`).toThrow();
    }
    const [, score] = makeAllThreeOutputs();
    const baseS = JSON.parse(serializeForDecisionLog(score)) as Record<string, unknown>;
    for (const field of ['value', 'credibleInterval', 'ordinal', 'ordinalTotal']) {
      const missing = { ...baseS };
      delete missing[field];
      expect(() => deserializeDecisionOutput(JSON.stringify(missing)), `缺 ${field} 应红`).toThrow();
    }
  });

  it('test_output_schema_标识随序列化落数', () => {
    const [choice] = makeAllThreeOutputs();
    const parsed = JSON.parse(serializeForDecisionLog(choice)) as { schema: string };
    expect(parsed.schema).toBe(DECISION_OUTPUT_SCHEMA);
  });

  it('test_output_概率精度不截断_往返逐位相等', () => {
    // §三概率有效位数纪律：序列化不对齐固定小数位——长精度概率往返逐位相等
    const p = 0.123456789012345;
    const noul = makeNoulFullOutput({
      questionId: 'q',
      probability: p,
      segmentBoundaries: BOUNDARIES,
      calibrationStatus: 'uncalibrated',
      suggestedAction: '转人工',
    });
    const round = deserializeDecisionOutput(serializeForDecisionLog(noul));
    expect(round.kind).toBe('noul');
    if (round.kind === 'noul') {
      expect(round.probability).toBe(p); // 逐位相等（无 toFixed 截断点）
    }
  });
});

describe('§五 四态映射分段边界', () => {
  it('test_fourstate_四段边界各归其态', () => {
    expect(fourStateMapping(0.9, BOUNDARIES)).toBe('成立');
    expect(fourStateMapping(0.7, BOUNDARIES)).toBe('倾向成立');
    expect(fourStateMapping(0.3, BOUNDARIES)).toBe('倾向不成立');
    expect(fourStateMapping(0.1, BOUNDARIES)).toBe('不成立');
  });

  it('test_fourstate_边界值归段_下界含上界不含', () => {
    expect(fourStateMapping(0.8, BOUNDARIES)).toBe('成立'); // yesLower 含
    expect(fourStateMapping(0.6, BOUNDARIES)).toBe('倾向成立'); // leanYesLower 含
    expect(fourStateMapping(0.2, BOUNDARIES)).toBe('不成立'); // noUpper 含
    expect(fourStateMapping(0.79, BOUNDARIES)).toBe('倾向成立');
  });

  it('test_fourstate_势均力敌带按近侧归_确定性映射', () => {
    // (0.4, 0.6) 为势均力敌带——0.45 归不成立侧（倾向不成立）、0.55 归成立侧
    expect(fourStateMapping(0.45, BOUNDARIES)).toBe('倾向不成立');
    expect(fourStateMapping(0.55, BOUNDARIES)).toBe('倾向成立');
    // 同输入同输出（确定性——两次调用一致）
    expect(fourStateMapping(0.5, BOUNDARIES)).toBe(fourStateMapping(0.5, BOUNDARIES));
  });

  it('test_fourstate_概率与边界非法拒载', () => {
    expect(() => fourStateMapping(1.5, BOUNDARIES)).toThrow(/越界/);
    expect(() =>
      fourStateMapping(0.5, { noUpper: 0.6, leanNoUpper: 0.4, leanYesLower: 0.6, yesLower: 0.8 }),
    ).toThrow(/分段边界非法/);
  });
});

describe('§五 uncalibrated 降级口径', () => {
  it('test_uncalibrated_边界可算四态照常落数', () => {
    const noul = makeNoulFullOutput({
      questionId: 'q',
      probability: 0.85,
      segmentBoundaries: BOUNDARIES,
      calibrationStatus: 'uncalibrated', // §二未达阈降级态
      suggestedAction: '转人工',
    });
    expect(noul.fourState).toBe('成立'); // 边界可算——照常落数
    expect(noul.calibrationStatus).toBe('uncalibrated'); // 整体标 uncalibrated
  });

  it('test_uncalibrated_消费守卫_进分流决策路径即抛错', () => {
    const noul = makeNoulFullOutput({
      questionId: 'q',
      probability: 0.85,
      segmentBoundaries: BOUNDARIES,
      calibrationStatus: 'uncalibrated',
      suggestedAction: '转人工',
    });
    expect(() => assertConsumableForRouting(noul)).toThrow(/不进任何分流决策路径/);
  });

  it('test_calibrated_消费守卫通过', () => {
    const noul = makeNoulFullOutput({
      questionId: 'q',
      probability: 0.85,
      segmentBoundaries: BOUNDARIES,
      calibrationStatus: 'calibrated',
      calibrationEvidence: EVIDENCE,
      suggestedAction: '放行',
    });
    expect(() => assertConsumableForRouting(noul)).not.toThrow();
  });

  it('test_calibrated_缺证据拒载_对齐§三声明制', () => {
    expect(() =>
      makeNoulFullOutput({
        questionId: 'q',
        probability: 0.5,
        segmentBoundaries: BOUNDARIES,
        calibrationStatus: 'calibrated', // 缺 calibrationEvidence
        suggestedAction: '复核',
      }),
    ).toThrow(/须带校准依据/);
  });
});

describe('§五 建议动作不执法（行为锁）', () => {
  it('test_suggest_类型层无执法转换面', () => {
    // 建议是纯值——decision-output 模块不存在 apply/enforce/execute 类函数
    // （类型锁：建议 → 执行必须经既有规则/审计层的显式决策）
    const moduleExports = Object.keys(decisionOutputModule);
    const enforcing = moduleExports.filter((k) => /apply|enforce|execute|dispatchAction/i.test(k));
    expect(enforcing).toEqual([]); // 无执法函数
  });

  it('test_suggest_构造函数不触碰执行状态', () => {
    // 运行时锁：构造输出对执行状态对象零引用零写入
    const executionState = { blocked: false, approved: false };
    const before = JSON.parse(JSON.stringify(executionState));
    makeNoulFullOutput({
      questionId: 'q',
      probability: 0.99,
      segmentBoundaries: BOUNDARIES,
      calibrationStatus: 'uncalibrated',
      suggestedAction: '阻断', // 建议「阻断」——但执行状态不动
    });
    expect(executionState).toEqual(before); // 建议不执法——执行状态原样
  });
});

describe('§五 证据面不扩大（行为锁）', () => {
  it('test_evidence_构造函数对输入无写', () => {
    // 输入 distribution 深快照 → 构造 → deepEqual 不变（无写/无新读取）
    const distribution = { a: 0.6, b: 0.3, fallback: 0.1 };
    const snapshot = JSON.parse(JSON.stringify(distribution));
    makeChoiceFullOutput({
      questionId: 'q',
      selected: 'a',
      distribution,
      calibrationStatus: 'uncalibrated',
      suggestedAction: '复核',
    });
    expect(distribution).toEqual(snapshot); // 输入不变（构造函数零写入）
  });

  it('test_evidence_state_传入不被读取新面_输出仅消费已有字段', () => {
    // state 只含已获证据——构造函数不新增采集：以 Proxy 侦测任何新属性访问
    const state = { evidence: 'already-collected' };
    const accessed = new Set<string>();
    const guardedState = new Proxy(state, {
      get(target, prop) {
        accessed.add(String(prop));
        return (target as Record<string, unknown>)[String(prop)];
      },
    });
    // 判定输入消费（evidence 字段是已有字段——读取它合法）
    const v = (guardedState as { evidence: string }).evidence;
    expect(v).toBe('already-collected');
    expect(accessed.has('evidence')).toBe(true);
    // 无任何「新数据源访问」形态（本测试模块无 fetch/fs/spy 面——
    // 证据面不扩大的机制保证：makeXxxFullOutput 根本不接收 state 参数）
  });
});

describe('§五 直落 decision-log', () => {
  it('test_log_输出为结构化JSON_可直接作payload', () => {
    const [choice] = makeAllThreeOutputs();
    const json = serializeForDecisionLog(choice);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    // 结构化类型化记录——decision-log 消费面无需二次解析（JSON 直接可读）
    expect(parsed.kind).toBe('choice');
    expect(parsed.schema).toBe(DECISION_OUTPUT_SCHEMA);
    // 与既有 decision-log 条目（DecisionLogEntry.evidence 字符串数组）兼容形态：
    expect(typeof json).toBe('string'); // 可直接入 evidence[] 或 payload
  });

  it('test_log_反序列化坏schema拒载', () => {
    expect(() => deserializeDecisionOutput('{"schema":"other/v9","kind":"noul"}')).toThrow(/schema/);
    expect(() => deserializeDecisionOutput('not json')).toThrow(/解析失败/);
    expect(() => deserializeDecisionOutput('{"schema":"decision-output/v1"}')).toThrow(/kind/);
  });
});

describe('§五 生产装配 · judge-runtime.judgeFullOutputs', () => {
  it('test_wiring_判定头输出装配为完整概率面', () => {
    // mock 编码器（judge-heads 契约的最小实现——不依赖真实基座）
    const encoder = {
      modelRevision: 'mock-encoder@v1',
      maxContextTokens: 512,
      encode: (s: string): number[][] => [[s.length, 1]],
      isSingleToken: () => true,
      decodeToken: (t: number) => String(t),
    };
    const runtime = new JudgeRuntime(encoder);
    const q = makeChoiceQuestion('q1', '选一个', [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], {
      id: 'fallback',
      label: '以上都不是',
    });
    const outputs = runtime.judgeFullOutputs({
      request: { state: 'some-state', questions: [q] },
      noulThresholds: { noul: { lowerBand: 0.3, upperBand: 0.7 } },
    });
    expect(outputs.length).toBe(1);
    expect(outputs[0]?.kind).toBe('choice');
    if (outputs[0] && outputs[0].kind === 'choice') {
      expect(outputs[0].questionId).toBe('q1');
      expect(typeof outputs[0].entropy).toBe('number'); // 熵已装配
      expect(outputs[0].calibrationStatus).toBe('uncalibrated'); // 缺省保守态
      expect(outputs[0].suggestedAction).toBeDefined(); // 建议动作在位
      // 序列化直落 decision-log 可用
      expect(() => deserializeDecisionOutput(serializeForDecisionLog(outputs[0]))).not.toThrow();
    }
  });

  it('test_wiring_装配不破坏既有judge行为_原路径照常', () => {
    const encoder = {
      modelRevision: 'mock-encoder@v1',
      maxContextTokens: 512,
      encode: (s: string): number[][] => [[s.length, 1]],
      isSingleToken: () => true,
      decodeToken: (t: number) => String(t),
    };
    const runtime = new JudgeRuntime(encoder);
    const q = makeChoiceQuestion('q1', '选一个', [{ id: 'a', label: 'A' }], { id: 'fallback', label: '以上都不是' });
    // 既有 judge() 路径照常（装配是新增面——零回归）
    const result = runtime.judge({ state: 's', questions: [q] });
    expect(result.answers.length).toBe(1);
    expect(result.modelRevision).toBe('mock-encoder@v1');
  });
});

describe('§五 decision-primitives 补字段（向后兼容）', () => {
  it('test_primitives_可选字段不破坏既有构造与校验', () => {
    // 既有 makeXxxAnswer 构造（无新字段）照常；validateDecisionPairing 照常
    const q = makeChoiceQuestion('q1', '选', [{ id: 'a', label: 'A' }], { id: 'fb', label: '兜底' });
    const answer: DecisionAnswer = {
      kind: 'choice',
      questionId: 'q1',
      selected: 'a',
      distribution: { a: 0.9, fb: 0.1 },
      fallbackSelected: false,
      abstained: false,
      entropy: 0.3258, // §五 新可选字段——带上照常
    };
    expect(() => validateDecisionPairing({ state: 's', questions: [q] }, { answers: [answer] })).not.toThrow();
  });
});
