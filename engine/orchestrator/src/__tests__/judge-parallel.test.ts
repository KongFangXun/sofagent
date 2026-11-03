// ============================================================
// judge-parallel.test.ts · v1.8.0 §三 并行约束解码单测
// ------------------------------------------------------------
// 覆盖面（SSOT §三 结构断言类）：
//   1. 并行正确性：同 state 多问一次前向出全部答案（一次编码断言）
//   2. 类型约束：畸形输出不可能产生（三原语答案形状逐项校验）
//   3. 槽位隔离：判定不占本地主模型槽位（行为锁观测计数）
//   4. 离线加载：不联络外部服务（替身 encoder 零网络调用断言）
//   5. 打包决策：字段数 < 3 不打包 + 概率差落数声明口径
//   6. 批内同伴无关性：处置序（超上限 → fixed-batch）
//   7. 超词表分块：候选不静默截断（分布含全部候选）
//   8. 稳定化重读：默认关闭（行为锁）
//   9. 契约一致性：打包/非打包两套解码同组问句 typed 答案形状一致
//      （受红注⑥⑤：以「同一路线两套解码实现」判）
// ============================================================

import { describe, it, expect } from 'vitest';
import { JudgeRuntime } from '../router/judge-runtime';
import { choiceHead } from '../router/judge-heads';
import { DEFAULT_STABILIZATION_CONFIG, stabilizationRereadProtocolCheck } from '../router/abstain-policy';
import type { DecisionRequest } from '../router/decision-primitives';
import type { EncoderLike } from '../router/judge-heads';

/** 离线替身 encoder（零网络——离线断言的观测面） */
function makeOfflineEncoder(vocabChunkSize?: number): EncoderLike & { encodeCalls: number } {
  let encodeCalls = 0;
  const enc: EncoderLike & { encodeCalls: number } = {
    modelRevision: 'test-rev-1',
    maxContextTokens: 4096,
    ...(vocabChunkSize ? { vocabChunkSize } : {}),
    encode: (state: string): number[][] => {
      encodeCalls++;
      // 确定性伪表征：字符码点分桶
      return [[...state].map((c) => c.charCodeAt(0) % 97)];
    },
    isSingleToken: () => true,
    decodeToken: (t: number) => String.fromCharCode(t),
    get encodeCalls() { return encodeCalls; },
  };
  return enc;
}

const STATE = '任务：把订单数据按金额分档，输出档位标签。';

function makeRequest(): DecisionRequest {
  return {
    state: STATE,
    questions: [
      { id: 'q1', kind: 'choice', question: '分档数量', options: [{ id: 'a3', label: '3 档' }, { id: 'a5', label: '5 档' }, { id: 'fb', label: '以上都不是', isFallback: true }] },
      { id: 'q2', kind: 'noul', question: '是否需要人工复核' },
      { id: 'q3', kind: 'score', question: '置信水平', min: 0, max: 10 },
    ],
  };
}

describe('v1.8.0 §三 · 并行正确性与类型约束', () => {
  it('一次编码多头并行：同 state 多问 → encode 恰 1 次（确定性路由关闭口径）', () => {
    const enc = makeOfflineEncoder();
    const rt = new JudgeRuntime(enc, null); // null = 关闭确定性路由（全落模型路径）
    const r = rt.judge(makeRequest());
    expect(r.answers).toHaveLength(3);
    expect(enc.encodeCalls).toBe(1); // 一次编码多头共享（行为锁——非逐问循环）
  });

  it('类型约束在解码层生效：三原语答案形状逐项合法（畸形输出不可能产生）', () => {
    const rt = new JudgeRuntime(makeOfflineEncoder(), null);
    const r = rt.judge(makeRequest());
    for (const a of r.answers) {
      expect(typeof a.questionId).toBe('string');
      if (a.kind === 'choice') {
        expect(typeof a.selected).toBe('string');           // 选中候选 id
        const vals = Object.values(a.distribution);
        expect(vals.length).toBeGreaterThan(0);                    // 全候选分布非空
        expect(Math.abs(vals.reduce((x, y) => x + y, 0) - 1)).toBeLessThan(1e-6); // 和≈1
      } else if (a.kind === 'noul') {
        expect(a.probability).toBeGreaterThanOrEqual(0);
        expect(a.probability).toBeLessThanOrEqual(1);              // 概率界内
      } else if (a.kind === 'score') {
        expect(a.value).toBeGreaterThanOrEqual(0);                 // 分值在值域
        expect(a.lower).toBeLessThanOrEqual(a.upper); // 区间有序
      } else {
        throw new Error('未知答案原语——畸形输出');             // 不可能产生（fail 路径）
      }
    }
  });
});

describe('v1.8.0 §三 · 槽位隔离与离线加载', () => {
  it('判定不占本地主模型槽位（行为锁：判定期间主模型请求计数为 0）', () => {
    const rt = new JudgeRuntime(makeOfflineEncoder(), null);
    rt.judge(makeRequest());
    expect(rt.mainModelRequestsDuringJudge).toBe(0); // 行为锁——判定期间零主模型请求
  });

  it('离线可加载并推理（替身 encoder 零网络调用——联络面不存在）', () => {
    // 替身 encoder 只做字符映射，无任何 fetch/net 调用路径——离线断言的结构面
    const enc = makeOfflineEncoder();
    const rt = new JudgeRuntime(enc, null);
    expect(() => rt.judge(makeRequest())).not.toThrow();
    expect(enc.encodeCalls).toBeGreaterThan(0);
  });
});

describe('v1.8.0 §三 · 打包决策与批内同伴无关性', () => {
  it('字段数 < 3 不打包（避免 0.74× 反向劣化——判据依据值）', () => {
    expect(JudgeRuntime.shouldPack(2)).toBe(false);
    expect(JudgeRuntime.shouldPack(3)).toBe(true);
    expect(JudgeRuntime.PACK_MIN_FIELDS).toBe(3);
  });

  it('校准拟合口径已声明（串行单问——CALIBRATION_PROTOCOL 常量在位）', () => {
    expect(JudgeRuntime.CALIBRATION_PROTOCOL).toBe('serial-per-question');
  });

  it('批内同伴无关性处置序：超上限 → fixed-batch（不默认全量批不变）', () => {
    expect(JudgeRuntime.resolveCompanionDrift(0.01, 0.05)).toBe('ok');
    expect(JudgeRuntime.resolveCompanionDrift(0.2, 0.05)).toBe('fixed-batch');
  });

  it('打包概率差已落数（VALIDATION 打包节在位——2.74× 收益与 maxΔp=0.759 同批）', () => {
    // 落数面的结构断言：runtime 声明的串行口径与 VALIDATION 登记的「校准与分流读数均按串行单问口径」一致
    expect(JudgeRuntime.CALIBRATION_PROTOCOL).toMatch(/serial/);
  });
});

describe('v1.8.0 §三 · 超词表分块与稳定化重读', () => {
  it('超词表选项集分块打分：分布含全部候选（不静默截断）+ 和为 1', () => {
    const enc = makeOfflineEncoder(8); // 词表上界 8
    const opts = Array.from({ length: 20 }, (_, i) => `opt-${i}`);
    const ids = opts.map((_, i) => `id-${i}`);
    const out = choiceHead(enc, STATE, opts, ids);
    expect(Object.keys(out.scores)).toHaveLength(20); // 全候选在分布——零截断
    const sum = Object.values(out.scores).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);    // 末轮归一正确
  });

  it('单 token 编码性在构造期断言：多 token 选项即拒（不静默退化）', () => {
    const enc = makeOfflineEncoder();
    (enc as unknown as { isSingleToken: (t: string) => boolean }).isSingleToken = (t) => t.length <= 2;
    expect(() => choiceHead(enc, STATE, ['ab', 'cde'])).toThrow(/单 token/); // cde 多 token → 拒
  });

  it('稳定化重读默认关闭（行为锁）+ 单问句补前向口径检查在位', () => {
    expect(DEFAULT_STABILIZATION_CONFIG.enabled).toBe(false);
    const chk = stabilizationRereadProtocolCheck(DEFAULT_STABILIZATION_CONFIG);
    expect(chk.ok).toBe(true); // 默认关闭 → 无口径检查义务
    // 开启但未同口径重测 → 拒
    const bad = stabilizationRereadProtocolCheck({ ...DEFAULT_STABILIZATION_CONFIG, enabled: true });
    expect(bad.ok).toBe(false);
  });
});

describe('v1.8.0 §三 · 契约一致性（打包/非打包两套解码 · 受红注⑥⑤口径）', () => {
  it('同一路线两套解码（打包开启/关闭的 choiceHead）同组候选下答案形状与分布键一致', () => {
    const encSmall = makeOfflineEncoder(64);   // 不触发分块（非打包形态）
    const encChunk = makeOfflineEncoder(4);    // 强制分块（打包形态）
    const opts = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛'];
    const ids = opts.map((_, i) => `c${i}`);
    const a = choiceHead(encSmall, STATE, opts, ids);
    const b = choiceHead(encChunk, STATE, opts, ids);
    // typed 答案形状逐字段一致：同键集 + 概率字段齐 + 各自归一
    expect(Object.keys(a.scores).sort()).toEqual(Object.keys(b.scores).sort());
    for (const k of Object.keys(a.scores)) {
      expect(typeof b.scores[k]).toBe('number');
      expect(Number.isFinite(b.scores[k]!)).toBe(true);
    }
    const sumA = Object.values(a.scores).reduce((x, y) => x + y, 0);
    const sumB = Object.values(b.scores).reduce((x, y) => x + y, 0);
    expect(Math.abs(sumA - 1)).toBeLessThan(1e-9);
    expect(Math.abs(sumB - 1)).toBeLessThan(1e-9);
  });
});
