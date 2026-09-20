// ============================================================
// error-bus.test.ts · 第三章「AI 异常处理总线」验收测试（v1.5.1）
// ============================================================
//
// 覆盖任务书第三章四条验收：
//   1. 三类异常（可重试/需人工/需回滚）各自路由到对应处理器
//   2. 异常处理决策挂因果边入 decision-log（可追溯）
//   3. **三类异常在 decision-log 中可区分**：三条记录 kind 互不相同 +
//      why 分别带 retryable / needs-human / needs-rollback 标签
//   4. （入口纪律）异常入口复用第一章死信通道——不新建第二套死信机制
//
// 🔴 第 3 条是**防静默退化**断言：若施工方图省事让三类共用一个 kind，
//    集合大小断言会红——不是「路由跑通」就算过。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { emitDecision, type DecisionLogEntry } from '@sofagent/audit';
import { getDecisionLogPath } from '@sofagent/core';

import { EventBus } from '../events/bus';
import { AnomalyBus, classifyAnomaly, ANOMALY_DECISION_KIND, ANOMALY_WHY_TAG } from '../events/error-bus';
import { EVENT_TYPES } from '../events/types';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-anomaly-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** 读 decision-log（受控写的读取侧——测试直接按行解析） */
function readDecisions(dataDir: string): DecisionLogEntry[] {
  const file = getDecisionLogPath(dataDir);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as DecisionLogEntry);
}

/** 造一个真实的因果边锚点（上游决策 ts） */
function makeUpstreamDecisionTs(): string {
  const entry = emitDecision(
    {
      agentId: 'orchestrator:events',
      sessionId: 'chain-root',
      kind: 'ORCHESTRATION',
      category: 'route',
      moment: 'ACT',
      why: { text: '事件派发：webhook.form.submitted → 1 个订阅者', tags: ['event-dispatch'], confidence: 'high' },
    },
    tmpDir,
  );
  return entry.ts;
}

/** 造异常总线（回滚 / HITL 写入可注入） */
function makeAnomalyBus(rollback?: (input: { projectDir: string; snapshotSha?: string }) => { attempted: boolean; executed: boolean; snapshotSha?: string; restoredFiles?: number; error?: string }) {
  const bus = new EventBus({ dataDir: tmpDir, sleep: async () => {} });
  return {
    bus,
    anomalies: new AnomalyBus({
      bus,
      dataDir: tmpDir,
      ...(rollback !== undefined ? { rollback } : {}),
    }),
  };
}

// ════════════════════════════════════════
// 一、三分类判定
// ════════════════════════════════════════

describe('第三章 · 三分类判定（复用 v1.3.1 stop_reason 分类）', () => {
  it('可重试类：timeout/malformed/failed 且未耗尽重试余额', () => {
    expect(classifyAnomaly({ error: new Error('请求超时') })).toBe('retryable');
    expect(classifyAnomaly({ error: new Error('解析失败：unexpected token') })).toBe('retryable');
    expect(classifyAnomaly({ error: new Error('未知故障（stop_reason=failed）'), stopReason: 'failed' })).toBe('retryable');
  });

  it('需人工类：凭证被拒 / 用户中断 / 重试耗尽', () => {
    expect(classifyAnomaly({ error: new Error('返回错误 401') })).toBe('needs-human');
    expect(classifyAnomaly({ error: new Error('用户中断') })).toBe('needs-human');
    expect(classifyAnomaly({ error: new Error('请求超时'), attempts: 9, maxRetries: 5 })).toBe('needs-human');
  });

  it('需回滚类：副作用已落地（不可重试或带脏写都不盲重试）', () => {
    expect(classifyAnomaly({ error: new Error('请求超时'), sideEffectsApplied: true })).toBe('needs-rollback');
    expect(classifyAnomaly({ error: new Error('返回错误 401'), sideEffectsApplied: true })).toBe('needs-rollback');
    expect(classifyAnomaly({ error: new Error('x'), requiresRollback: true })).toBe('needs-rollback');
  });
});

// ════════════════════════════════════════
// 二、三类异常各自路由到对应处理器
// ════════════════════════════════════════

describe('第三章 · 三类异常路由到对应处理器', () => {
  it('可重试 → 重试队列（复用第一章死信通道，含退避延时）', () => {
    const { bus, anomalies } = makeAnomalyBus();
    const result = anomalies.report({ error: new Error('请求超时'), nodeId: 'worker-a' });

    expect(result.anomalyClass).toBe('retryable');
    expect(result.routed.retry).not.toBeNull();
    expect(result.routed.retry!.deadLetterId).toBe(result.deadLetterId);
    expect(result.routed.retry!.nextRetryDelayMs).toBe(2000);

    // 入口 = 第一章死信通道（同一条队列）
    const retryQueue = anomalies.listRetryQueue();
    expect(retryQueue.map((r) => r.deadLetterId)).toContain(result.deadLetterId);
    const entry = bus.getDeadLetter(result.deadLetterId)!;
    expect(entry.anomalyClass).toBe('retryable');
    expect(entry.decisionTs).toBe(result.decisionTs);
    expect(bus.listDeliveries({ eventId: entry.event.id }).some((d) => d.kind === 'DEAD_LETTER')).toBe(true);
  });

  it('需人工 → HITL 审批队列（pending 文件落盘，复用 hitl-channel）', () => {
    const { anomalies } = makeAnomalyBus();
    const result = anomalies.report({ error: new Error('返回错误 401'), nodeId: 'worker-b' });

    expect(result.anomalyClass).toBe('needs-human');
    expect(result.routed.hitl).not.toBeNull();
    const pending = result.routed.hitl!.pendingPath;
    expect(fs.existsSync(pending)).toBe(true);
    const request = JSON.parse(fs.readFileSync(pending, 'utf-8')) as {
      checkpointId: string;
      auditResult: string;
      options: string[];
      reviewReport: string;
    };
    expect(request.checkpointId).toBe(result.routed.hitl!.checkpointId);
    expect(request.auditResult).toBe('auth');
    expect(request.options).toEqual(['approve', 'reject', 'aborted']);
    expect(request.reviewReport).toContain('needs-human');
  });

  it('需回滚 → 回溯能力（snapshot_restore 同原语，注入执行器可断言调用）', () => {
    const calls: Array<{ projectDir: string; snapshotSha?: string }> = [];
    const { anomalies } = makeAnomalyBus((input) => {
      calls.push(input);
      return { attempted: true, executed: true, snapshotSha: 'abc1234', restoredFiles: 3 };
    });
    const result = anomalies.report({
      error: new Error('请求超时'),
      nodeId: 'worker-c',
      sideEffectsApplied: true,
      rollback: { projectDir: '/tmp/fake-project', snapshotSha: 'abc1234' },
    });

    expect(result.anomalyClass).toBe('needs-rollback');
    expect(calls).toEqual([{ projectDir: '/tmp/fake-project', snapshotSha: 'abc1234' }]);
    expect(result.routed.rollback).toEqual({
      attempted: true,
      executed: true,
      snapshotSha: 'abc1234',
      restoredFiles: 3,
    });
    expect(result.routed.hitl).toBeNull();
  });

  it('回滚不可执行（无可用快照）→ 同时进人工队列，不静默留在自动路径', () => {
    const { anomalies } = makeAnomalyBus(() => ({
      attempted: true,
      executed: false,
      error: '没有可用的快照（先运行审计创建快照）',
    }));
    const result = anomalies.report({ error: new Error('请求超时'), nodeId: 'worker-d', sideEffectsApplied: true });
    expect(result.anomalyClass).toBe('needs-rollback');
    expect(result.routed.rollback!.executed).toBe(false);
    expect(result.routed.hitl).not.toBeNull();
    expect(fs.existsSync(result.routed.hitl!.pendingPath)).toBe(true);
  });
});

// ════════════════════════════════════════
// 三、因果边入 decision-log
// ════════════════════════════════════════

describe('第三章 · 异常决策挂因果边入 decision-log', () => {
  it('异常决策带 causedBy 因果边（指向上游事件路由决策 ts）', () => {
    const upstreamTs = makeUpstreamDecisionTs();
    const { anomalies } = makeAnomalyBus();
    const result = anomalies.report({
      error: new Error('请求超时'),
      nodeId: 'worker-e',
      causedBy: [upstreamTs],
    });

    const entries = readDecisions(tmpDir);
    const anomaly = entries.find((e) => e.ts === result.decisionTs)!;
    expect(anomaly).toBeDefined();
    expect(anomaly.causedBy).toEqual([upstreamTs]);
    expect(anomaly.causalType).toBe('caused');
    expect(anomaly.moment).toBe('ATTRIBUTION');
    // 因果边指向的条目真实存在（可追溯，不是悬空 ts）
    expect(entries.some((e) => e.ts === upstreamTs)).toBe(true);
  });

  it('从死信条目上报——因果边自动取死信上的决策 ts（复用第一章通道的正规路径）', async () => {
    const { bus, anomalies } = makeAnomalyBus();
    // 第一章：一次投递失败 → 死信条目（带事件路由决策 ts）
    const publishResult = await bus.publish({
      type: EVENT_TYPES.WEBHOOK_IM,
      source: 'webhook',
      payload: { kind: 'im', body: {} },
    });
    expect(publishResult.decisionTs).toBeDefined();

    const deadId = bus.sendToDeadLetter(publishResult.event, {
      nodeId: 'worker-f',
      error: '请求超时',
      decisionTs: publishResult.decisionTs,
    });
    const reported = anomalies.reportFromDeadLetter(deadId)!;
    expect(reported).not.toBeNull();

    const anomaly = readDecisions(tmpDir).find((e) => e.ts === reported.decisionTs)!;
    expect(anomaly.causedBy).toEqual([publishResult.decisionTs]);
  });
});

// ════════════════════════════════════════
// 四、三类异常在 decision-log 中可区分（防静默退化）
// ════════════════════════════════════════

describe('第三章 · 三类异常在 decision-log 中可区分', () => {
  it('三条记录 kind 互不相同且 why 分别带三个标签', () => {
    const upstreamTs = makeUpstreamDecisionTs();
    const { anomalies } = makeAnomalyBus(() => ({ attempted: true, executed: true, snapshotSha: 'sha-1', restoredFiles: 1 }));

    const retryable = anomalies.report({
      error: new Error('请求超时'),
      nodeId: 'n-retry',
      causedBy: [upstreamTs],
    });
    const needsHuman = anomalies.report({
      error: new Error('返回错误 401'),
      nodeId: 'n-human',
      causedBy: [upstreamTs],
    });
    const needsRollback = anomalies.report({
      error: new Error('请求超时'),
      nodeId: 'n-rollback',
      sideEffectsApplied: true,
      causedBy: [upstreamTs],
    });

    const entries = readDecisions(tmpDir);
    const pick = (ts: string) => entries.find((e) => e.ts === ts)!;
    const three = [pick(retryable.decisionTs), pick(needsHuman.decisionTs), pick(needsRollback.decisionTs)];

    // ① kind 互不相同——三类共用同一 kind 时本断言变红（静默退化的机械拦截）
    const kinds = three.map((e) => e.kind);
    expect(new Set(kinds).size).toBe(3);
    expect(kinds).toEqual(['FALLBACK_DEGRADE', 'ESCALATE_REPORT', 'EVOLUTION']);

    // ② why 分别带三个标签
    const tags = three.map((e) => e.why.tags ?? []);
    expect(tags[0]).toContain('retryable');
    expect(tags[1]).toContain('needs-human');
    expect(tags[2]).toContain('needs-rollback');
    expect(new Set(tags.map((t) => t.find((x) => x.includes('needs-') || x === 'retryable'))).size).toBe(3);

    // ③ 三条都挂同一上游因果边（同一条触发链上的三种处置）
    for (const e of three) {
      expect(e.causedBy).toEqual([upstreamTs]);
    }

    // ④ 映射表与实现一致（防止实现与常量表脱钩）
    expect(ANOMALY_DECISION_KIND.retryable).toBe('FALLBACK_DEGRADE');
    expect(ANOMALY_DECISION_KIND['needs-human']).toBe('ESCALATE_REPORT');
    expect(ANOMALY_DECISION_KIND['needs-rollback']).toBe('EVOLUTION');

    // ⑤ category 不得乱标——五分类（route/select/skip/retry/escalate）里**没有 rollback 档**，
    //    故 needs-rollback 一律不传 category。原实现把它落成 'retry'，读 decision-log 的人
    //    会以为这条异常在重试，而它其实该走 snapshot_restore。缺失比标错诚实。
    expect(three[0]!.category).toBe('retry');
    expect(three[1]!.category).toBe('escalate');
    expect(three[2]!.category).toBeUndefined();
    expect(Object.values(ANOMALY_WHY_TAG)).toEqual(['retryable', 'needs-human', 'needs-rollback']);
  });
});
