// ============================================================
// session-ingest.test.ts · v1.4.9 T7 · session 承接单测
// ============================================================
//
// 覆盖面（第七章验收 ①②③ + 五元组扩展）：
//   1. exporter schema 校验（合法通过 / 坏格式拒绝——fail-closed）
//   2. 多轮展开（切窗 / 角色映射 / system 头复带）
//   3. 会话续接五元组（全匹配续接 / 任一不匹配摘要交接三要素——注入双向断言）
//   4. usage 入 cost 台账 + key 维度四件（计量聚合 / 异常检测 / 处置建议）
//   5. 蒸馏偏好对（同 prompt 双响应 → DPO / 版本台账衔接形态）
//   6. router-exporter 伴生（签名/验签/schema 前置拒绝）
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  validateRouterSession,
  windowMessages,
  mapRoles,
  decideContinuation,
  buildHandoffSummary,
  expandSessionToRecords,
  usageToCostEntry,
  aggregateByKeyUsage,
  detectKeyAnomalies,
  formatKeyDisposition,
  type RouterSessionPayload,
  type SessionScope,
  type CostLedgerEntry,
} from '../session-ingest';
import { RouterExporter, exporterProtocolSpec } from '../router-exporter';
import { buildDistillPairs, distillPairsToRecords } from '../distill-pairs';

// ══════════════════════════════════════
// fixture 构造
// ══════════════════════════════════════

function mkPayload(overrides: Partial<RouterSessionPayload> = {}): RouterSessionPayload {
  return {
    sessionId: 'sess-001',
    enterpriseId: 'ent-001',
    source: 'router-instance-a',
    messages: [
      { role: 'system', content: '你是企业助手' },
      { role: 'user', content: '查一下电芯检测线-3号今日产能' },
      { role: 'assistant', content: '今日产能 12,400 件，良率 98.2%。' },
      { role: 'user', content: '昨天呢？' },
      { role: 'assistant', content: '昨日产能 11,800 件，良率 97.9%。' },
    ],
    usage: { inputTokens: 500, outputTokens: 200, model: 'qwen2.5-7b', pricePerKUsd: 0.001 },
    route: { targetModel: 'qwen2.5-7b', fallbackChain: ['qwen2.5-7b', 'deepseek-v3'], reason: '本地优先' },
    ...overrides,
  };
}

const SCOPE_A: SessionScope = {
  executor: 'exec-node-1',
  workerId: 'agent-emp-042',
  model: 'qwen2.5-7b',
  workDir: '/srv/line3',
  runtime: 'node20-sandbox',
};

// ══════════════════════════════════════

describe('session-ingest · schema 校验（T7 验收① fail-closed）', () => {
  it('合法 payload 通过', () => {
    const v = validateRouterSession(mkPayload());
    expect(v.valid).toBe(true);
    expect(v.payload!.sessionId).toBe('sess-001');
  });

  it('缺必填字段拒绝（messages 空 / usage 缺失）', () => {
    expect(validateRouterSession({ ...mkPayload(), messages: [] }).valid).toBe(false);
    const noUsage = { ...mkPayload() } as Partial<RouterSessionPayload>;
    delete noUsage.usage;
    expect(validateRouterSession(noUsage).valid).toBe(false);
  });

  it('未知字段拒绝（.strict()——多余字段 fail-closed）', () => {
    const extra = { ...mkPayload(), sneakyField: 'x' };
    const v = validateRouterSession(extra);
    expect(v.valid).toBe(false);
    expect(v.issues!.join('; ')).toContain('sneakyField');
  });

  it('坏类型拒绝（role 非枚举 / token 负数）', () => {
    expect(validateRouterSession({ ...mkPayload(), messages: [{ role: ' hacker', content: 'x' }] }).valid).toBe(false);
    expect(
      validateRouterSession({ ...mkPayload(), usage: { inputTokens: -1, outputTokens: 0, model: 'm' } }).valid,
    ).toBe(false);
  });
});

describe('session-ingest · 多轮切窗（T7 验收②）', () => {
  it('短 session 单窗——system 头复带 + 全消息保留', () => {
    const wins = windowMessages(mkPayload().messages);
    expect(wins).toHaveLength(1);
    expect(wins[0]![0]!.role).toBe('system');
    expect(wins[0]).toHaveLength(5);
  });

  it('长 session 滚动切窗——每窗 ≤ windowTurns 轮 + user 起点对齐', () => {
    const msgs = [
      { role: 'system' as const, content: 'sys' },
      ...Array.from({ length: 20 }, (_, i) => ({
        role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
        content: `msg-${i}`,
      })),
    ];
    const wins = windowMessages(msgs, { windowTurns: 4 });
    expect(wins.length).toBeGreaterThanOrEqual(4); // 10 轮 / 4 轮一窗 ≈ 3-4 窗
    for (const w of wins) {
      const assistantCount = w.filter((m) => m.role === 'assistant').length;
      expect(assistantCount).toBeLessThanOrEqual(4);
      // 窗体首条（system 头除外）是 user（起点对齐）
      const first = w.find((m) => m.role !== 'system');
      expect(first!.role).toBe('user');
    }
    // 每窗都复带 system 头
    expect(wins.every((w) => w[0]!.role === 'system')).toBe(true);
  });

  it('重叠窗（stride < windowTurns）——相邻窗共享消息', () => {
    const msgs = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `m${i}`,
    }));
    const nonOverlap = windowMessages(msgs, { windowTurns: 3 });
    const overlap = windowMessages(msgs, { windowTurns: 3, stride: 2 });
    expect(overlap.length).toBeGreaterThan(nonOverlap.length);
  });

  it('角色映射——tool 消息映射 system 附注', () => {
    const mapped = mapRoles([
      { role: 'user', content: 'q' },
      { role: 'tool', content: '{"rows": 3}' },
      { role: 'assistant', content: 'a' },
    ]);
    expect(mapped[1]!.role).toBe('system');
    expect(mapped[1]!.content).toContain('[tool-result]');
  });
});

describe('session-ingest · 会话续接五元组（T7 扩展验收·注入双向断言）', () => {
  it('五元组全匹配——可续接', () => {
    const d = decideContinuation(SCOPE_A, { ...SCOPE_A });
    expect(d.canContinue).toBe(true);
    expect(d.mode).toBe('continue');
    expect(d.mismatched).toEqual([]);
  });

  it('任一元组不匹配——走摘要交接（五个维度逐一注入断言）', () => {
    const cases: Array<[keyof SessionScope, string]> = [
      ['executor', 'exec-node-2'],
      ['workerId', 'agent-emp-099'],
      ['model', 'deepseek-v3'],
      ['workDir', '/srv/line7'],
      ['runtime', 'node22-bare'],
    ];
    for (const [dim, val] of cases) {
      const mutated = { ...SCOPE_A, [dim]: val };
      const d = decideContinuation(SCOPE_A, mutated);
      expect(d.canContinue).toBe(false);
      expect(d.mode).toBe('handoff');
      expect(d.mismatched).toEqual([dim]);
    }
  });

  it('摘要交接三要素——较早摘要 + 最近消息 + 最新结论', () => {
    const summary = buildHandoffSummary(mkPayload().messages, { recentRounds: 1 });
    expect(summary.earlierSummary).toContain('查一下电芯检测线-3号');
    expect(summary.recentMessages.length).toBeGreaterThanOrEqual(1);
    expect(summary.latestConclusion).toContain('11,800'); // 最后一条 assistant
    expect(summary.recentMessages[summary.recentMessages.length - 1]!.role).toBe('assistant');
  });

  it('空会话摘要不炸（无 assistant 时给占位结论）', () => {
    const s = buildHandoffSummary([{ role: 'user', content: '只有一问' }]);
    expect(s.latestConclusion).toContain('无 assistant');
    expect(s.earlierSummary).toBe('（无前段对话）');
  });
});

describe('session-ingest · 展开 + cost 台账（T7 验收①⑤）', () => {
  it('expandSessionToRecords——记录形态 + usage 透传 + 路由留痕', () => {
    const r = expandSessionToRecords(mkPayload({ apiKeyId: 'key-7' }));
    expect(r.windows).toBe(1);
    expect(r.records).toHaveLength(1);
    const fields = r.records[0]!.fields;
    expect(fields.sessionId).toBe('sess-001');
    expect(fields.model).toBe('qwen2.5-7b');
    expect(fields.inputTokens).toBe(500);
    expect(fields.outputTokens).toBe(200);
    expect(fields.routeTarget).toBe('qwen2.5-7b');
    expect(fields.apiKeyId).toBe('key-7');
    // messages 字段是合法 JSON（dataset-builder chat 形态消费）
    const parsed = JSON.parse(fields.messages as string) as Array<{ role: string }>;
    expect(parsed[0]!.role).toBe('system');
    // id 溯源形态 <sessionId>#w<窗号>
    expect(r.records[0]!.id).toBe('sess-001#w1');
  });

  it('usageToCostEntry——成本 = (in+out)/1000 × 单价', () => {
    const e = usageToCostEntry(mkPayload(), () => '2026-09-16T00:00:00Z');
    expect(e.model).toBe('qwen2.5-7b');
    expect(e.apiKeyId).toBe('router-anonymous'); // 未带 key 缺省桶
    expect(e.costUsd).toBeCloseTo(0.7 * 0.001); // 700 token / 1000 × 0.001
    expect(e.ts).toBe('2026-09-16T00:00:00Z');
  });

  it('usageToCostEntry——pushedAt 优先于 now（推送时刻为准）', () => {
    const e = usageToCostEntry(mkPayload({ pushedAt: '2026-09-15T08:00:00Z' }), () => '2099-01-01T00:00:00Z');
    expect(e.ts).toBe('2026-09-15T08:00:00Z');
  });
});

describe('session-ingest · key 维度 harness 四件（T7 验收⑥）', () => {
  const entries: CostLedgerEntry[] = [
    { ts: '2026-09-16T01:00:00Z', model: 'qwen2.5-7b', apiKeyId: 'key-a', inputTokens: 100, outputTokens: 50, costUsd: 0.01 },
    { ts: '2026-09-16T02:00:00Z', model: 'deepseek-v3', apiKeyId: 'key-a', inputTokens: 200, outputTokens: 100, costUsd: 0.02 },
    { ts: '2026-09-16T03:00:00Z', model: 'qwen2.5-7b', apiKeyId: 'key-b', inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
  ];

  it('① 计量——按 key 聚合（token/费用/次数/模型分布）', () => {
    const agg = aggregateByKeyUsage(entries);
    const a = agg.get('key-a')!;
    expect(a.totalTokens).toBe(450);
    expect(a.totalCalls).toBe(2);
    expect(a.totalCostUsd).toBeCloseTo(0.03);
    expect(a.byModel['qwen2.5-7b']).toBe(150);
    expect(a.byModel['deepseek-v3']).toBe(300);
    expect(agg.get('key-b')!.totalCalls).toBe(1);
  });

  it('③ 异常检测——日 token 超限（阈值外部化）', () => {
    const today = new Map([
      ['key-x', { apiKeyId: 'key-x', totalTokens: 2_000_000, totalCalls: 10, totalCostUsd: 1, byModel: {} }],
    ]);
    const findings = detectKeyAnomalies(today, new Map(), { maxDailyTokens: 1_000_000, maxDailyCalls: 50_000, spikeRatio: 5 });
    expect(findings.some((f) => f.kind === 'daily-limit-tokens')).toBe(true);
    // 收紧阈值后同数据多检出（外部化生效）
    const tighter = detectKeyAnomalies(today, new Map(), { maxDailyTokens: 100_000, maxDailyCalls: 5, spikeRatio: 5 });
    expect(tighter.length).toBe(2);
  });

  it('③ 异常检测——突增倍率（今日/昨日 > spikeRatio）', () => {
    const yesterday = new Map([
      ['key-y', { apiKeyId: 'key-y', totalTokens: 1_000, totalCalls: 5, totalCostUsd: 0.1, byModel: {} }],
    ]);
    const today = new Map([
      ['key-y', { apiKeyId: 'key-y', totalTokens: 8_000, totalCalls: 40, totalCostUsd: 0.8, byModel: {} }], // 8× > 5×
    ]);
    const findings = detectKeyAnomalies(today, yesterday);
    const spike = findings.find((f) => f.kind === 'token-spike');
    expect(spike).toBeDefined();
    expect(spike!.detail).toContain('8.0×');
  });

  it('④ 处置建议——suspend/throttle/review 三档 + 执行回 router 侧语义', () => {
    const suspendMsg = formatKeyDisposition({ apiKeyId: 'k', kind: 'token-spike', detail: '12× 突增', recommendation: 'suspend' });
    expect(suspendMsg).toContain('建议暂停');
    expect(suspendMsg).toContain('执行回 router 侧');

    const throttleMsg = formatKeyDisposition({ apiKeyId: 'k', kind: 'daily-limit-tokens', detail: '超限', recommendation: 'throttle' });
    expect(throttleMsg).toContain('降配额');

    const reviewMsg = formatKeyDisposition({ apiKeyId: 'k', kind: 'token-spike', detail: '6× 突增', recommendation: 'review' });
    expect(reviewMsg).toContain('人工复核');
  });
});

describe('router-exporter · 伴生参考实现（T7 验收①）', () => {
  it('签名/验签对称——同 payload 同 key 同签', async () => {
    const exporter = new RouterExporter({
      source: 'router-a',
      enterpriseId: 'ent-001',
      hmacKey: 'shared-secret',
    });
    const payload = mkPayload();
    const sig = exporter.signPayload(payload);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(exporter.verifyPayload(payload, sig)).toBe(true);
    // 篡改后验签失败
    const tampered = { ...payload, messages: [...payload.messages, { role: 'user' as const, content: '注入' }] };
    expect(exporter.verifyPayload(tampered, sig)).toBe(false);
  });

  it('exportSession——schema 前置校验 + 传输注入', async () => {
    const received: unknown[] = [];
    const exporter = new RouterExporter({
      source: 'router-a',
      enterpriseId: 'ent-001',
      hmacKey: 'k',
      transport: async (p, sig) => {
        received.push({ p, sig });
        return { ok: true, message: '送达' };
      },
    });
    const ok = await exporter.exportSession({
      sessionId: 'sess-002',
      messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }],
      usage: { inputTokens: 10, outputTokens: 5, model: 'm' },
      route: { targetModel: 'm' },
    });
    expect(ok.ok).toBe(true);
    expect(received).toHaveLength(1);

    // 坏入参前置拒绝（transport 不被调用）
    const bad = await exporter.exportSession({
      sessionId: '',
      messages: [],
      usage: { inputTokens: 0, outputTokens: 0, model: 'm' },
      route: { targetModel: 'm' },
    });
    expect(bad.ok).toBe(false);
    expect(bad.message).toContain('schema 校验失败');
    expect(received).toHaveLength(1);
  });

  it('exporterProtocolSpec——协议文档含字段约定（router 侧任意语言实现的消费规格）', () => {
    const spec = exporterProtocolSpec();
    expect(spec).toContain('sessionId');
    expect(spec).toContain('messages');
    expect(spec).toContain('HMAC-SHA256');
    expect(spec).toContain('fail-closed');
  });
});

describe('distill-pairs · 蒸馏偏好对（T7 验收③）', () => {
  it('同 prompt 双响应 → DPO 对（chosen=教师 / rejected=本地——方向固定）', () => {
    const r = buildDistillPairs([
      { promptId: 'p1', prompt: '解释良率计算', response: '良率 = 合格品 / 总投入 × 100%……', origin: 'teacher', qualityScore: 0.95 },
      { promptId: 'p1', prompt: '解释良率计算', response: '良率就是合格率。', origin: 'local', qualityScore: 0.5 },
    ]);
    expect(r.paired).toBe(1);
    expect(r.pairs[0]!.chosen).toContain('合格品');
    expect(r.pairs[0]!.rejected).toBe('良率就是合格率。');
    expect(r.pairs[0]!.meta.chosenOrigin).toBe('teacher');
  });

  it('缺一源跳过（教师缺 / 本地缺）——skipReasons 登记', () => {
    const r = buildDistillPairs([
      { promptId: 'only-teacher', prompt: 'q', response: 'a'.repeat(20), origin: 'teacher' },
      { promptId: 'only-local', prompt: 'q2', response: 'b'.repeat(20), origin: 'local' },
    ]);
    expect(r.paired).toBe(0);
    expect(r.skipReasons['缺教师响应（promptId=only-local）']).toBe(1);
    expect(r.skipReasons['缺本地响应（promptId=only-teacher）']).toBe(1);
  });

  it('教师响应过短跳过（弱教师样本不入 chosen 面）', () => {
    const r = buildDistillPairs([
      { promptId: 'p', prompt: 'q', response: '短', origin: 'teacher' },
      { promptId: 'p', prompt: 'q', response: 'x'.repeat(50), origin: 'local' },
    ]);
    expect(r.paired).toBe(0);
    expect(Object.keys(r.skipReasons)[0]).toContain('过短');
  });

  it('质量差不足跳过 + 多源取最优', () => {
    const r = buildDistillPairs(
      [
        { promptId: 'p', prompt: 'q', response: 'a'.repeat(30), origin: 'teacher', qualityScore: 0.55 },
        { promptId: 'p', prompt: 'q', response: 'b'.repeat(30), origin: 'teacher', qualityScore: 0.6 }, // 最优教师
        { promptId: 'p', prompt: 'q', response: 'c'.repeat(30), origin: 'local', qualityScore: 0.58 },
      ],
      { minQualityGap: 0.05 },
    );
    expect(r.paired).toBe(0); // gap 0.6-0.58=0.02 < 0.05——偏好信号弱跳过
    expect(Object.keys(r.skipReasons)[0]).toContain('质量差不足');
  });

  it('maxPairs 采样控制', () => {
    const responses = Array.from({ length: 10 }, (_, i) => ({
      promptId: `p${i}`,
      prompt: `q${i}`,
      response: `teacher-answer-${i}-`.repeat(3),
      origin: 'teacher' as const,
    })).concat(
      Array.from({ length: 10 }, (_, i) => ({
        promptId: `p${i}`,
        prompt: `q${i}`,
        response: `local-${i}`,
        origin: 'local' as const,
      })),
    );
    const r = buildDistillPairs(responses, { maxPairs: 3 });
    expect(r.paired).toBe(3);
  });

  it('distillPairsToRecords——dpo 列映射形态（buildAndPersistDataset algorithm=dpo 可直入）', () => {
    const records = distillPairsToRecords([
      {
        prompt: '解释良率',
        chosen: '教师答案',
        rejected: '本地答案',
        meta: { promptId: 'p1', chosenOrigin: 'teacher', rejectedOrigin: 'local', qualityGap: 0.4 },
      },
    ]);
    expect(records[0]!.fields.prompt).toBe('解释良率');
    expect(records[0]!.fields.chosen).toBe('教师答案');
    expect(records[0]!.fields.rejected).toBe('本地答案');
    expect(records[0]!.id).toBe('distill:p1#1');
    // 列名与 inferColumnMapping 的 dpo 约定对齐（prompt/chosen/rejected）
    expect(['prompt', 'chosen', 'rejected'].every((c) => c in records[0]!.fields)).toBe(true);
  });
});
