// ============================================================
// router-slot.test.ts · 路由决策链单测（v1.5.4 第一章 + 第二章）
//
// 覆盖验收标准：
//   ① 三级任务路由（规划→云端强档 / 执行→本地执行档 / 管道→本地管道档）
//   ② 敏感数据强制本地（fail-closed，配置错误时拒绝执行 → block）
//   ③ 每次路由附 routeReason
//   ④ 云端不可用自动降级本地
//   ⑤ 本地槽位上限可配 + 超限排队（FIFO + 优先级）+ 前台可见位置/预估等待
//   ⑥ 排队超时达阈值按合规升级云端（或全封场景继续等待）
//   ⑦ 判定三层链（L0 命中零模型调用 / L1 分类 / L2 兜底）
//   ⑧ 判定链不占本地主模型槽位（行为锁：判定期间主模型授予数恒为 0）
//   ⑨ DecisionChannel 契约（三原语问句校验 / 档位 / 校准分桶 / 审计挂链 stateDigest）
//   ⑩ 决策下达 schema 校验 fail-closed（坏格式拒绝下达）+ HMAC 挂链
//   ⑪ 本地端点注册（执行档 / 管道档）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  SlotManager,
  SlotManagerConfigError,
  type SlotManagerState,
} from '../router/slot-manager';
import {
  PolicyEngine,
  slotLaneOf,
  resolveTargetModel,
  taskClassForTriageTarget,
  type PolicyDecision,
} from '../router/policy-engine';
import {
  IntentTriage,
  type L0MappingEntry,
} from '../router/intent-triage';
import {
  validateQuestions,
  computeEscalationThreshold,
  gradeOf,
  tempBucketKey,
  toAuditRecord,
  createUnconfiguredDecisionChannel,
  validateEvidenceReadiness,
  evaluateCalibration,
  CalibrationRegistry,
  DEFAULT_CALIBRATION_POLICY,
  type DecisionAnswer,
  type DecisionChannel,
  type DecisionQuestion,
  type DecisionState,
} from '../router/decision-channel';
import {
  DecisionDispatcher,
  RouteDispositionSchema,
  DISPOSITION_SCHEMA_FAMILY,
  type RouteDisposition,
} from '../router/decision-dispatch';
import {
  registerLocalEndpoint,
  readLocalEndpoints,
} from '../model-registry';
import { DEFAULT_ROUTER_CONFIG } from '../model-router-config';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-router-slot-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

// ────────────────────────────────────────────────
// 第一章 · 任务×敏感度双维路由
// ────────────────────────────────────────────────

describe('第一章 · 路由策略引擎（任务×敏感度双维）', () => {
  it('三级任务路由：规划→cloud-strong / 执行→local-executor / 管道→local-pipeline', () => {
    const engine = new PolicyEngine();
    expect(engine.decide({ taskClass: 'planning', sensitivity: 'public' }).target).toBe('cloud-strong');
    expect(engine.decide({ taskClass: 'execution', sensitivity: 'public' }).target).toBe('local-executor');
    expect(engine.decide({ taskClass: 'pipeline', sensitivity: 'public' }).target).toBe('local-pipeline');
  });

  it('每次路由附 routeReason', () => {
    const engine = new PolicyEngine();
    const d = engine.decide({ taskClass: 'planning', sensitivity: 'internal' });
    expect(d.reason).toBe('complex-reasoning');
    expect(d.taskClass).toBe('planning');
    expect(d.decisionId).toMatch(/^pd-/);
  });

  it('敏感数据强制本地（restricted/confidential 恒本地档 + routeReason=sensitive-data）', () => {
    const engine = new PolicyEngine();
    const r = engine.decide({ taskClass: 'planning', sensitivity: 'restricted' });
    expect(r.target).toBe('local-executor');
    expect(r.reason).toBe('sensitive-data');
    const c = engine.decide({ taskClass: 'pipeline', sensitivity: 'confidential' });
    expect(c.target).toBe('local-pipeline');
  });

  it('敏感数据 + 本地不可用 → fail-closed block（绝不 fallback 云端）', () => {
    const engine = new PolicyEngine();
    const d = engine.decide({ taskClass: 'execution', sensitivity: 'confidential', localAvailable: false });
    expect(d.target).toBe('block');
    expect(d.failClosed).toBe(true);
    expect(d.blockReason).toContain('fail-closed');
  });

  it('云端不可用 → 非敏感降级本地承接', () => {
    const engine = new PolicyEngine();
    const d = engine.decide({ taskClass: 'planning', sensitivity: 'public', cloudAvailable: false });
    expect(d.target).toBe('local-executor');
    expect(d.reason).toBe('workflow-execution');
  });

  it('配置 fail-closed：敏感降级策略被改为云端 → block（拒绝执行）', () => {
    const badConfig = JSON.parse(JSON.stringify(DEFAULT_ROUTER_CONFIG)) as typeof DEFAULT_ROUTER_CONFIG;
    // 人为篡改（schema 层禁止，但内存注入须被引擎 fail-closed 拦住）
    (badConfig.policy.fallbackOnLocalFailure as { restricted: string }).restricted = 'cloud-strong';
    const engine = new PolicyEngine({ config: badConfig });
    const d = engine.decide({ taskClass: 'planning', sensitivity: 'public' });
    expect(d.target).toBe('block');
    expect(d.failClosed).toBe(true);
    expect(engine.configIssues().length).toBeGreaterThan(0);
  });

  it('toDisposition：本地档带 slotLane，云端/block 不带', () => {
    const engine = new PolicyEngine();
    expect(slotLaneOf('local-executor')).toBe('executor');
    expect(slotLaneOf('local-pipeline')).toBe('pipeline');
    expect(slotLaneOf('cloud-strong')).toBeUndefined();
    const disp = engine.toDisposition(engine.decide({ taskClass: 'execution', sensitivity: 'public' }));
    expect(disp.slotLane).toBe('executor');
    expect(disp.targetModel).toBe(resolveTargetModel(DEFAULT_ROUTER_CONFIG, 'local-executor'));
    expect(disp.decisionId).toMatch(/^pd-/);
    expect(RouteDispositionSchema.safeParse(disp).success).toBe(true);
  });
});

// ────────────────────────────────────────────────
// 第二章 · 本地槽位信号量
// ────────────────────────────────────────────────

describe('第二章 · 本地槽位信号量 + 排队 + 优先级 + 超时升级', () => {
  it('withdraw 撤回排队：只清队列位不动池（转云端升级的队列卫生）', () => {
    const m = new SlotManager({ maxSlots: 1, avgServiceMs: 1000 });
    expect('granted' in m.acquire({ requestId: 'a' })).toBe(true);
    const q = m.acquire({ requestId: 'b' });
    expect('queued' in q).toBe(true);
    // 撤回命中 · 队列清空 · 判定链计数未被误触
    expect(m.withdraw('b')).toBe(true);
    expect(m.snapshot().queueDepth).toBe(0);
    expect(m.snapshot().decisionInFlight).toBe(0);
    // 幂等：重复撤回返回 false；未排队 id 撤回也返回 false
    expect(m.withdraw('b')).toBe(false);
    expect(m.withdraw('never-queued')).toBe(false);
    // 已获槽的 id 不受 withdraw 影响（仍在 inUse——release 才是它的出口）
    expect(m.withdraw('a')).toBe(false);
    expect('granted' in m.acquire({ requestId: 'a' })).toBe(true); // 幂等重取仍 granted
  });

  it('槽位上限可配；超限排队（前台可见位置与预估等待）', () => {
    const m = new SlotManager({ maxSlots: 2, avgServiceMs: 1000 });
    expect('granted' in m.acquire({ requestId: 'a' })).toBe(true);
    expect('granted' in m.acquire({ requestId: 'b' })).toBe(true);
    const c = m.acquire({ requestId: 'c' });
    expect('queued' in c).toBe(true);
    if ('queued' in c) {
      expect(c.queued.position).toBe(1);
      expect(c.queued.estimatedWaitMs).toBe(1000); // ceil(1/2)*1000
    }
    expect(m.snapshot().queueDepth).toBe(1);
  });

  it('排队顺序：同优先级 FIFO；高优先级插队在前', () => {
    const m = new SlotManager({ maxSlots: 1 });
    m.acquire({ requestId: 'running' });
    m.acquire({ requestId: 'n1', priority: 'normal' });
    m.acquire({ requestId: 'n2', priority: 'normal' });
    m.acquire({ requestId: 'h1', priority: 'high' });
    const snap = m.snapshot();
    expect(snap.queued.map((q) => q.requestId)).toEqual(['h1', 'n1', 'n2']);
    expect(m.positionOf('n2')).toBe(3);
  });

  it('release 释放槽位并提升队首（按优先级）', () => {
    const m = new SlotManager({ maxSlots: 1 });
    m.acquire({ requestId: 'running' });
    m.acquire({ requestId: 'n1' });
    m.acquire({ requestId: 'h1', priority: 'high' });
    m.release('running');
    expect(m.justPromoted?.requestId).toBe('h1');
    expect(m.snapshot().inUse).toBe(1);
  });

  it('超时升级：达阈值 + 合规允许 → escalate-cloud；信创全封 → 继续等待', () => {
    let t = 0;
    const m = new SlotManager({ maxSlots: 1, queueTimeoutMs: 1000, now: () => t });
    m.acquire({ requestId: 'running' });
    m.acquire({ requestId: 'waiter' });
    t = 500;
    expect(m.evaluateWait('waiter', { complianceAllowsCloud: true }).action).toBe('wait');
    t = 1500;
    const esc = m.evaluateWait('waiter', { complianceAllowsCloud: true });
    expect(esc.action).toBe('escalate-cloud');
    expect(esc.reason).toContain('合规允许出门');
    t = 1500;
    const sealed = m.evaluateWait('waiter', { complianceAllowsCloud: false });
    expect(sealed.action).toBe('wait');
    expect(sealed.reason).toContain('信创全封');
  });

  it('🔒 行为锁：判定链（kind=decision）不占本地主模型槽', () => {
    const m = new SlotManager({ maxSlots: 1 });
    m.acquire({ requestId: 'main1' }); // 占满唯一主模型槽
    const d = m.acquire({ requestId: 'judge', kind: 'decision' });
    expect('granted' in d).toBe(true); // 判定链直接授予——不排队、不占主模型槽
    const snap = m.snapshot();
    expect(snap.inUse).toBe(1); // 主模型槽占用仍为 1
    expect(snap.decisionInFlight).toBe(1);
    expect(snap.counters.mainModelGrants).toBe(1); // 判定链未增加主模型授予
    expect(snap.counters.decisionGrants).toBe(1);
    m.release('judge');
    expect(m.snapshot().decisionInFlight).toBe(0);
    expect(m.snapshot().inUse).toBe(1); // 判定链释放不动主模型槽
  });

  it('配置 fail-closed：非法槽位上限拒绝运行', () => {
    expect(() => new SlotManager({ maxSlots: 0 })).toThrow(SlotManagerConfigError);
    expect(() => new SlotManager({ maxSlots: 2.5 })).toThrow(SlotManagerConfigError);
  });

  it('状态序列化往返（持久化观测面）', () => {
    const m = new SlotManager({ maxSlots: 2 });
    m.acquire({ requestId: 'a' });
    m.acquire({ requestId: 'b' });
    m.acquire({ requestId: 'c', priority: 'high' });
    const state: SlotManagerState = m.toState();
    const restored = SlotManager.fromState(state);
    const snap = restored.snapshot();
    expect(snap.maxSlots).toBe(2);
    expect(snap.inUse).toBe(2);
    expect(snap.queueDepth).toBe(1);
    expect(snap.queued[0]!.requestId).toBe('c');
  });
});

// ────────────────────────────────────────────────
// 第二章 · 判定分层编排 L0/L1/L2
// ────────────────────────────────────────────────

class FakeChannel implements DecisionChannel {
  readonly name = 'fake';
  calls = 0;
  constructor(private readonly answers: DecisionAnswer[]) {}
  async judge(_state: DecisionState, _questions: DecisionQuestion[]) {
    this.calls += 1;
    return { answers: this.answers, modelVersion: 'test-v1', tempBucket: 'choice×2', latencyMs: 1 };
  }
}

const choiceQ = (): DecisionQuestion[] => [
  { id: 'route', primitive: 'choice', options: ['local', 'cloud'], fallback: 'local' },
];
const state = (refs?: string[]): DecisionState => ({ text: '把这段需求落到工作流', ...(refs ? { refs } : {}), evidenceReadiness: 'structural' });

describe('第二章 · 判定分层编排（L0/L1/L2）', () => {
  it('L0 命中零模型调用（judge 不被调用）', async () => {
    const channel = new FakeChannel([]);
    const mappings: L0MappingEntry[] = [{ refs: ['node-1'], target: 'local-pipeline', reason: '节点级 modelPreference 映射' }];
    const triage = new IntentTriage({ channel, config: { l0Mappings: mappings, l1MinConfidence: 0.75, l2Policy: 'local-offpeak', cloudAllowed: false } });
    const out = await triage.triage(state(['node-1']), choiceQ());
    expect(out.layer).toBe('L0');
    expect(out.target).toBe('local-pipeline');
    expect(channel.calls).toBe(0); // 零模型调用
  });

  it('L1 语义分类命中（一次提交全部问句——批量纪律）', async () => {
    const channel = new FakeChannel([{ id: 'route', value: 'local', probability: 0.9, distribution: { local: 0.9, cloud: 0.1 }, status: 'answered' }]);
    const triage = new IntentTriage({ channel });
    const questions: DecisionQuestion[] = [
      { id: 'route', primitive: 'choice', options: ['local', 'cloud'], fallback: 'local' },
      { id: 'confidence', primitive: 'score', range: { min: 0, max: 1 } },
    ];
    const out = await triage.triage(state(), questions);
    expect(out.layer).toBe('L1');
    expect(out.grade).toBe('ALLOW');
    expect(out.confidence).toBeCloseTo(0.9);
    expect(channel.calls).toBe(1); // 批量：一次调用
    expect(out.audit?.stateDigest).toMatch(/^[0-9a-f]{64}$/); // stateDigest 非原文
    expect(JSON.stringify(out.audit)).not.toContain(state().text); // 不落原文
  });

  it('🔒 判定链不占主模型槽位（行为锁——主模型授予数恒 0）', async () => {
    const channel = new FakeChannel([{ id: 'route', value: 'local', probability: 0.95, distribution: { local: 0.95, cloud: 0.05 }, status: 'answered' }]);
    const slotManager = new SlotManager({ maxSlots: 1 });
    const triage = new IntentTriage({ channel, slotManager });
    await triage.triage(state(), choiceQ());
    const snap = slotManager.snapshot();
    expect(snap.counters.mainModelGrants).toBe(0); // 判定期间零本地主模型推理请求
    expect(snap.inUse).toBe(0);
    expect(snap.decisionInFlight).toBe(0); // 判定链取用后已释放
  });

  it('通道不可用 → fail-closed 降级 L0 规则面兜底（不静默放行）', async () => {
    const triage = new IntentTriage({ channel: createUnconfiguredDecisionChannel() });
    const out = await triage.triage(state(), choiceQ());
    expect(out.layer).toBe('L0');
    expect(out.grade).toBe('ASK'); // 保守：需人审，不静默放行
    expect(out.routeReason).toContain('fail-closed');
  });

  it('低置信 → L2 难例兜底（按配置分流）', async () => {
    const channel = new FakeChannel([{ id: 'route', value: 'local', probability: 0.3, distribution: { local: 0.3, cloud: 0.7 }, status: 'answered' }]);
    const cloudTriage = new IntentTriage({ channel, config: { l2Policy: 'cloud-strong', cloudAllowed: true } });
    const out = await cloudTriage.triage(state(), choiceQ());
    expect(out.layer).toBe('L2');
    expect(out.fallback).toBe('cloud-strong');
    expect(out.target).toBe('cloud-strong');

    const sealedTriage = new IntentTriage({ channel, config: { l2Policy: 'cloud-strong', cloudAllowed: false } });
    const sealed = await sealedTriage.triage(state(), choiceQ());
    expect(sealed.fallback).toBe('local-offpeak');
    expect(sealed.target).toBe('local-executor');
  });
});

// ────────────────────────────────────────────────
// 第二章 · DecisionChannel 契约
// ────────────────────────────────────────────────

describe('第二章 · DecisionChannel 契约（问句校验 / 档位 / 校准分桶）', () => {
  it('choice 缺兜底 / 选项超限 / score 量程非法均报错', () => {
    expect(validateQuestions([{ id: 'q', primitive: 'choice', options: ['a', 'b'] }]).some((s) => s.includes('兜底'))).toBe(true);
    expect(validateQuestions([{ id: 'q', primitive: 'choice', options: ['a', 'b', 'c', 'd', 'e', 'f'], fallback: 'a' }]).some((s) => s.includes('超上限'))).toBe(true);
    expect(validateQuestions([{ id: 'q', primitive: 'score', range: { min: 1, max: 1 } }]).some((s) => s.includes('量程'))).toBe(true);
    expect(validateQuestions([{ id: 'q', primitive: 'choice', options: ['a', 'b'], fallback: 'a' }])).toEqual([]);
  });

  it('分桶键 = 原语 × 选项数', () => {
    expect(tempBucketKey('choice', 3)).toBe('choice×3');
    expect(tempBucketKey('noul')).toBe('noul×0');
  });

  it('升档阈值由代价反推', () => {
    expect(computeEscalationThreshold(1, 10)).toBeCloseTo(0.9);
    expect(computeEscalationThreshold(0, 10)).toBe(1);
    expect(computeEscalationThreshold(20, 10)).toBe(0); // 成本高于代价 → 无升档依据
    expect(computeEscalationThreshold(1, 0)).toBe(0); // 无代价 → 0
  });

  it('档位优先级：DENY > SKIP > ABSTAIN > ASK > ALLOW', () => {
    const ans: DecisionAnswer = { id: 'q', value: 'x', probability: 0.99, status: 'answered' };
    expect(gradeOf(ans, { allowMinConfidence: 0.8, askMinConfidence: 0.5, redlineHit: true })).toBe('DENY');
    expect(gradeOf(ans, { allowMinConfidence: 0.8, askMinConfidence: 0.5, inDomain: false })).toBe('SKIP');
    expect(gradeOf({ ...ans, status: 'abstained', abstainReason: 'out-of-domain' }, { allowMinConfidence: 0.8, askMinConfidence: 0.5 })).toBe('ABSTAIN');
    expect(gradeOf(ans, { allowMinConfidence: 0.8, askMinConfidence: 0.5, criticalNode: true })).toBe('ASK');
    expect(gradeOf(ans, { allowMinConfidence: 0.8, askMinConfidence: 0.5 })).toBe('ALLOW');
    expect(gradeOf({ ...ans, probability: 0.6 }, { allowMinConfidence: 0.8, askMinConfidence: 0.5 })).toBe('ASK');
  });
});

// ────────────────────────────────────────────────
// 第二章 · 决策下达协议
// ────────────────────────────────────────────────

describe('第二章 · 决策下达（schema fail-closed + HMAC 挂链）', () => {
  it('合法去向决策 → 下达 + HMAC 签名 + 审计留痕', async () => {
    const audit: string[] = [];
    const dispatcher = new DecisionDispatcher({ hmacKey: 'k', auditAppend: (l) => audit.push(l), now: () => '2026-09-28T00:00:00.000Z' });
    const disposition: RouteDisposition = { decisionId: 'pd-1', targetModel: 'qwen2.5-7b', slotLane: 'executor', reason: 'workflow-execution' };
    const res = await dispatcher.dispatch(disposition);
    expect(res.ok).toBe(true);
    expect(res.dispatched).toBe(true);
    expect(res.signature).toBeTruthy();
    expect(dispatcher.verify(disposition, res.signature!)).toBe(true);
    expect(audit.length).toBe(1);
    expect(audit[0]).toContain('hmacSig');
  });

  it('坏格式拒绝下达（fail-closed——不静默放行）', async () => {
    const dispatcher = new DecisionDispatcher({ hmacKey: 'k' });
    // 缺 targetModel
    const r1 = await dispatcher.dispatch({ decisionId: 'pd-1' });
    expect(r1.ok).toBe(false);
    expect(r1.schemaValid).toBe(false);
    expect(r1.dispatched).toBe(false);
    // 未知字段（strict）
    const r2 = await dispatcher.dispatch({ decisionId: 'pd-1', targetModel: 'm', bogus: 1 });
    expect(r2.dispatched).toBe(false);
    expect(r2.issues.some((s) => s.includes('bogus') || s.includes('Unrecognized') || s.includes('unrecognized') || s.length > 0)).toBe(true);
  });

  it('下达 schema 家族自洽（字段集与 zod 键一致）', () => {
    expect([...DISPOSITION_SCHEMA_FAMILY.fields]).toEqual(Object.keys(RouteDispositionSchema.shape));
    expect(DISPOSITION_SCHEMA_FAMILY.version).toBe(1);
    expect(DISPOSITION_SCHEMA_FAMILY.direction).toBe('engine→router');
  });
});

// ────────────────────────────────────────────────
// 第一章 · 本地端点注册
// ────────────────────────────────────────────────

describe('第一章 · 本地端点注册（执行档 / 管道档）', () => {
  it('注册本地推理端点并绑定执行档（humanConfirmed 才绑档）', () => {
    const pending = registerLocalEndpoint({ name: 'ollama-exec', model: 'qwen2.5-7b', lane: 'executor' }, { dataDir });
    expect(pending.ok).toBe(true);
    expect(pending.awaitingHuman).toBe(true); // 绑档守人审门控

    const bound = registerLocalEndpoint(
      { name: 'ollama-exec', model: 'qwen2.5-7b', lane: 'executor' },
      { dataDir, humanConfirmed: true },
    );
    expect(bound.ok).toBe(true);
    expect(bound.awaitingHuman).toBe(false);

    const endpoints = readLocalEndpoints(dataDir);
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]!.name).toBe('ollama-exec');
    expect(endpoints[0]!.lane).toBe('executor');
    expect(endpoints[0]!.endpoint).toContain('11434'); // 缺省 Ollama 端点
  });
});

// ────────────────────────────────────────────────
// v1.5.4 第2批收口 · 判据启用门控（证据就绪度 + 校准硬线，fail-closed）
// ────────────────────────────────────────────────

describe('第二章 · 判据启用门控（证据就绪度 + 校准硬线）', () => {
  const evidenceQ = (): DecisionQuestion[] => [
    { id: 'trace-judge', primitive: 'choice', options: ['go', 'hold'], fallback: 'hold', evidence: 'trace' },
  ];

  it('证据未就绪（none）+ 需证据判据 ⇒ 拒绝启用（judge 零调用）', async () => {
    const channel = new FakeChannel([{ id: 'trace-judge', value: 'go', probability: 0.99, distribution: { go: 0.99, hold: 0.01 }, status: 'answered' }]);
    const triage = new IntentTriage({ channel });
    const out = await triage.triage({ text: '需要轨迹证据的判定', evidenceReadiness: 'none' }, evidenceQ());
    expect(out.rejected).toBeDefined();
    expect(out.routeReason).toContain('拒绝启用');
    expect(out.grade).toBe('ASK'); // fail-closed：保守转人审，不静默降级为语义判
    expect(channel.calls).toBe(0); // 判据未启用——判定件零调用
    expect(validateEvidenceReadiness({ text: 'x', evidenceReadiness: 'none' }, evidenceQ()).length).toBeGreaterThan(0);
  });

  it('证据就绪（trace）+ 需证据判据 ⇒ 放行进入判定', async () => {
    const channel = new FakeChannel([{ id: 'trace-judge', value: 'go', probability: 0.9, distribution: { go: 0.9, hold: 0.1 }, status: 'answered' }]);
    const triage = new IntentTriage({ channel });
    const out = await triage.triage({ text: '有轨迹证据', evidenceReadiness: 'trace' }, evidenceQ());
    expect(out.rejected).toBeUndefined();
    expect(out.layer).toBe('L1');
    expect(channel.calls).toBe(1);
    expect(validateEvidenceReadiness({ text: 'x', evidenceReadiness: 'trace' }, evidenceQ())).toEqual([]);
  });

  it('校准硬线：未校准分桶 ⇒ 拒绝用于分流决策（fail-closed）', async () => {
    const channel = new FakeChannel([{ id: 'route', value: 'local', probability: 0.99, distribution: { local: 0.99, cloud: 0.01 }, status: 'answered' }]);
    const registry = new CalibrationRegistry(); // 空——无校准记录
    const triage = new IntentTriage({ channel, calibration: { registry } });
    const out = await triage.triage(state(), choiceQ()); // 分桶 choice×2
    expect(out.rejected).toBeDefined();
    expect(out.routeReason).toContain('校准门控');
    expect(channel.calls).toBe(0); // 未校准——判据拒绝启用
    expect(registry.isUsable('choice×2')).toBe(false);
  });

  it('校准硬线：已校准（达阈）分桶 ⇒ 放行判定', async () => {
    const channel = new FakeChannel([{ id: 'route', value: 'local', probability: 0.9, distribution: { local: 0.9, cloud: 0.1 }, status: 'answered' }]);
    const registry = new CalibrationRegistry();
    registry.register({ bucketKey: 'choice×2', ece: 0.01, sampleCount: 200, modelVersion: 'test-v1', fittedAt: '2026-09-28T00:00:00.000Z' });
    const triage = new IntentTriage({ channel, calibration: { registry } });
    const out = await triage.triage(state(), choiceQ());
    expect(out.rejected).toBeUndefined();
    expect(out.layer).toBe('L1');
    expect(registry.isUsable('choice×2')).toBe(true);
  });

  it('校准门控判定：无记录 / 样本不足 / ECE 超阈均不可用，达阈可用', () => {
    const registry = new CalibrationRegistry();
    expect(DEFAULT_CALIBRATION_POLICY.maxEce).toBeCloseTo(0.05);
    expect(evaluateCalibration('choice×2', registry).usable).toBe(false); // 无记录
    registry.register({ bucketKey: 'choice×2', ece: 0.01, sampleCount: 10, modelVersion: 'v', fittedAt: 't' });
    expect(evaluateCalibration('choice×2', registry).usable).toBe(false); // 样本 10 < 100
    registry.register({ bucketKey: 'choice×2', ece: 0.5, sampleCount: 500, modelVersion: 'v', fittedAt: 't' });
    expect(evaluateCalibration('choice×2', registry).usable).toBe(false); // ECE 0.5 > 0.05
    registry.register({ bucketKey: 'choice×2', ece: 0.02, sampleCount: 500, modelVersion: 'v', fittedAt: 't' });
    expect(evaluateCalibration('choice×2', registry).usable).toBe(true); // 达阈
  });
});

// ────────────────────────────────────────────────
// v1.5.4 第2批收口 · 判定链接入去向下达（IntentTriage 实际调用点）
// ────────────────────────────────────────────────

describe('第二章 · 判定链接入去向下达（PolicyEngine.decideByAdjudication）', () => {
  it('判定去向映射任务分级（cloud→planning / pipeline→pipeline / 其余→execution）', () => {
    expect(taskClassForTriageTarget('cloud-strong')).toBe('planning');
    expect(taskClassForTriageTarget('cloud-fast')).toBe('planning');
    expect(taskClassForTriageTarget('local-pipeline')).toBe('pipeline');
    expect(taskClassForTriageTarget('local-executor')).toBe('execution');
    expect(taskClassForTriageTarget('block')).toBe('execution');
  });

  it('判定链产出 target → 映射分级 → decideAndDispatch 下达（IntentTriage 被实际调用）', async () => {
    const channel = new FakeChannel([{ id: 'route', value: 'local', probability: 0.9, distribution: { local: 0.9, cloud: 0.1 }, status: 'answered' }]);
    const triage = new IntentTriage({ channel });
    const engine = new PolicyEngine({ triage });
    const out = await engine.decideByAdjudication({ state: state(), questions: choiceQ(), sensitivity: 'internal' });
    expect(channel.calls).toBe(1); // 判定链被真实调用
    expect(out.triage.layer).toBe('L1');
    expect(out.decision.taskClass).toBe('pipeline'); // L1 判定件→local-pipeline→pipeline 分级
    expect(out.decision.target).toBe('local-pipeline');
    expect(out.dispatch?.ok).toBe(true);
  });

  it('未注入判定链 ⇒ 拒绝执行（fail-closed，不静默跳过）', async () => {
    const engine = new PolicyEngine();
    await expect(
      engine.decideByAdjudication({ state: state(), questions: choiceQ(), sensitivity: 'public' }),
    ).rejects.toThrow(/IntentTriage/);
  });
});
