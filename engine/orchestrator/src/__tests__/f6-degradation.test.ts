// ============================================================
// f6-degradation.test.ts · F6.1 收尾点②「补概率 #4 降级路径专项回归」
// ------------------------------------------------------------
// 要证的命题只有一句：**判定底座不可用时，引擎的行为与今日（F5 交付态）一致**。
//
// 「一致」拆成四条可证伪的断言（不是「看起来没变」）：
//   D1 健康通道 ⇒ L1 · ALLOW —— 这是「今日基线」，后面的降级读数必须与它可区分
//   D2 通道不可用（DecisionChannelUnavailableError）⇒ L0 · ASK · 本地执行档
//   D3 其它异常（协议污染/超时/未注入）⇒ **同 D2 逐字段相同**（不按错误类型漂移）
//   D4 降级目标**绝不出门**：即便配置允许云端（cloudAllowed=true）+ 声明了云端兜底，
//      通道不可用也不得改走 cloud-strong（fail-closed 的真义是「不发」而不是「换个地方发」）
//
// 不证的部分（写死防越界解读）：不证「判定准确率」，不证 L2 云端链路的可用性。
// ============================================================

import { describe, expect, it } from 'vitest';
import {
  DecisionChannelUnavailableError,
  type DecisionChannel,
} from '../router/decision-channel';
import { IntentTriage, type IntentTriageConfig } from '../router/intent-triage';

const QUESTION = {
  id: 'q1',
  primitive: 'choice' as const,
  options: ['continue', 'human_review'],
  fallback: 'human_review',
};

const STATE = { text: '{"agent":"ops","action":"list /tmp"}', evidenceReadiness: 'none' as const };

/** 健康通道：固定 0.9 ⇒ L1 ALLOW（今日基线） */
const healthy: DecisionChannel = {
  name: 'stub-healthy',
  judge: async () => ({
    answers: [{ id: 'q1', value: 'continue', probability: 0.95, status: 'answered' as const }], // 0.95 ≥ allow(0.94, E-7)
    modelVersion: 'stub@1',
    tempBucket: 'choice×2',
    latencyMs: 1,
  }),
};

/** 不可用通道：抛真类（权重缺失 / 进程退出走这条） */
const unavailable: DecisionChannel = {
  name: 'stub-unavailable',
  judge: async () => {
    throw new DecisionChannelUnavailableError('权重目录缺失');
  },
};

/** 低置信通道：0.4 ⇒ ABSTAIN（用来证明「云端那条路确实通」，否则 D4 是空转） */
const lowConfidence: DecisionChannel = {
  name: 'stub-low',
  judge: async () => ({
    answers: [{ id: 'q1', value: 'continue', probability: 0.4, status: 'answered' as const }],
    modelVersion: 'stub@1',
    tempBucket: 'choice×2',
    latencyMs: 1,
  }),
};

/** 其它异常：协议污染 / 超时等（不得因错误类型不同而换一套降级行为） */
const polluted: DecisionChannel = {
  name: 'stub-polluted',
  judge: async () => {
    throw new TypeError('判定件输出不是合法 JSON');
  },
};

/** 配置：允许云端 + 有云端兜底声明——用来验「降级不借机出门」 */
const cloudOn: IntentTriageConfig = {
  l0Mappings: [],
  l1MinConfidence: 0.75,
  l2Policy: 'cloud-strong',
  cloudAllowed: true,
};

const pick = (o: Awaited<ReturnType<IntentTriage['triage']>>) => ({
  layer: o.layer,
  target: o.target,
  grade: o.grade,
  confidence: o.confidence,
});

describe('F6.1 #4 降级路径专项回归（底座不可用 ⇒ 行为与今日一致）', () => {
  it('D1 健康通道 ⇒ L1 · ALLOW（今日基线，必须与降级读数可区分）', async () => {
    const t = new IntentTriage({ channel: healthy, config: cloudOn });
    const out = await t.triage(STATE, [QUESTION]);
    expect(out.layer).toBe('L1');
    expect(out.grade).toBe('ALLOW');
    expect(out.target).not.toBe('local-executor');
  });

  it('D2 通道不可用 ⇒ L0 · ASK · 本地执行档（不外发、不静默放行）', async () => {
    const t = new IntentTriage({ channel: unavailable, config: cloudOn });
    const out = await t.triage(STATE, [QUESTION]);
    expect(out.layer).toBe('L0');
    expect(out.grade).toBe('ASK'); // 不是 ALLOW：不得静默放行
    expect(out.target).toBe('local-executor');
    expect(out.routeReason).toContain('通道不可用');
    expect(out.routeReason).toContain('L0');
  });

  it('D3 其它异常 ⇒ 与 D2 逐字段相同（不按错误类型漂移）', async () => {
    const a = await new IntentTriage({ channel: unavailable, config: cloudOn }).triage(STATE, [QUESTION]);
    const b = await new IntentTriage({ channel: polluted, config: cloudOn }).triage(STATE, [QUESTION]);
    expect(pick(b)).toEqual(pick(a)); // layer/target/grade/confidence 全等
    expect(b.routeReason).toContain('L0'); // 理由文案可不同，落点必须同
  });

  it('D4 降级绝不出门：cloudAllowed=true + l2Policy=cloud-strong 也不得改走云端', async () => {
    const t = new IntentTriage({ channel: unavailable, config: cloudOn });
    const out = await t.triage(STATE, [QUESTION]);
    // 云端两档都不许出现（l2Policy 的 cloud-strong 与云端兜底都不得被降级路径消费）
    expect(out.target).not.toContain('cloud');
    expect(out.target).toBe('local-executor');
    // 反向锚：同一配置 + **低置信**（0.4 ⇒ ABSTAIN）时 L2 那条路确实**能**出门——
    // 证明 D4 不是「云端功能没接」，而是「降级路径不走它」。
    // 注：ALLOW/ASK 在 L1 就早返回（target=local-pipeline），l1MinConfidence 只对
    //     DENY/ABSTAIN/SKIP 起作用——这是既有语义，见 intent-triage.ts:252-268。
    const low = await new IntentTriage({ channel: lowConfidence, config: cloudOn }).triage(STATE, [QUESTION]);
    expect(low.layer).toBe('L2');
    expect(low.target).toBe('cloud-strong');
  });

  it('D5 降级不抛错且 confidence=0（显式「无置信」，不是假概率 0.9）', async () => {
    const t = new IntentTriage({ channel: unavailable, config: cloudOn });
    await expect(t.triage(STATE, [QUESTION])).resolves.toBeTruthy();
    const out = await t.triage(STATE, [QUESTION]);
    expect(out.confidence).toBe(0);
  });
});
