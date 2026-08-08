// ============================================================
// decision-query.test.ts · 决策审计查询层测试（v1.3.0 交付 6 T04）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, writeFileSync, rmSync, mkdirSync, readFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { emitDecision, type EmitDecisionInput } from './decision-log';
import { queryByKind, getKindSummary, traceBack, traceFromBehavior } from './decision-query';
import { appendHistory, type AuditHistoryEntry } from './audit-history';

function tmpDir(): string {
  const dir = join(tmpdir(), `sofagent-decision-query-${Date.now()}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeInput(overrides: Partial<EmitDecisionInput> = {}): EmitDecisionInput {
  return {
    agentId: 'engineer',
    sessionId: 'sess-1',
    kind: 'TOOL_GATE',
    moment: 'ACT',
    why: { text: '拦截写 .env', tags: ['a1', 'sensitive'] },
    ...overrides,
  };
}

describe('decision-query', () => {
  let testDir: string;
  let savedKeyPath: string | undefined;

  beforeEach(() => {
    testDir = tmpDir();
    savedKeyPath = process.env.SOFAGENT_KEY_PATH;
    const KEY_PATH = join(testDir, 'test-hmac-key');
    writeFileSync(KEY_PATH, 'test-hmac-key-0123456789abcdef');
    process.env.SOFAGENT_KEY_PATH = KEY_PATH;
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* */ }
    if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
    else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
  });

  it('queryByKind 按种类过滤 + limit', () => {
    emitDecision(makeInput({ kind: 'TOOL_GATE', sessionId: 's1' }), testDir);
    emitDecision(makeInput({ kind: 'ARTIFACT_EDIT', sessionId: 's2' }), testDir);
    emitDecision(makeInput({ kind: 'TOOL_GATE', sessionId: 's3' }), testDir);

    const gates = queryByKind('TOOL_GATE', {}, testDir);
    expect(gates.length).toBe(2);
    expect(gates.every((e) => e.kind === 'TOOL_GATE')).toBe(true);

    const limited = queryByKind('TOOL_GATE', { limit: 1 }, testDir);
    expect(limited.length).toBe(1);
  });

  it('queryByKind since/until 过滤', () => {
    const e1 = emitDecision(makeInput({ sessionId: 's1' }), testDir);
    const e2 = emitDecision(makeInput({ sessionId: 's2' }), testDir);

    const result = queryByKind('TOOL_GATE', { since: e1.ts, until: e2.ts }, testDir);
    expect(result.length).toBe(2);
    // 严格早于 e2
    const before = queryByKind('TOOL_GATE', { until: new Date(new Date(e1.ts).getTime() - 1).toISOString() }, testDir);
    expect(before.length).toBe(0);
  });

  it('getKindSummary 聚合 count + topTags', () => {
    emitDecision(makeInput({ sessionId: 's1', why: { text: 'x', tags: ['a1'] } }), testDir);
    emitDecision(makeInput({ sessionId: 's2', why: { text: 'x', tags: ['a1'] } }), testDir);
    emitDecision(makeInput({ sessionId: 's3', why: { text: 'x', tags: ['a9'] } }), testDir);

    const summary = getKindSummary('TOOL_GATE', testDir);
    expect(summary.kind).toBe('TOOL_GATE');
    expect(summary.count).toBe(3);
    expect(summary.topTags[0]).toEqual({ tag: 'a1', count: 2 });
    expect(summary.latestTs).toBeDefined();
  });

  it('traceBack 解析 specRef + artifactRef(commitSha) + join 行为记录', () => {
    // 先写一条决策，带 specRef + artifactRef=commitSha
    const commitSha = 'abc1234def5678';
    const decision = emitDecision(makeInput({
      sessionId: 's1',
      specRef: 'docs/spec.md',
      artifactRef: commitSha,
    }), testDir);

    // 写一条 history 行为记录，commitSha 与之匹配
    const historyEntry: AuditHistoryEntry = {
      timestamp: new Date().toISOString(),
      diffRange: 'HEAD~1..HEAD',
      exitCode: 1,
      ruleResults: [
        { name: 'A1 不碰敏感', number: 1, status: 'WARN', details: ['x'] },
      ],
      diffFileCount: 1,
      commitSha,
    };
    appendHistory(historyEntry, testDir);

    const trace = traceBack(decision.ts, testDir);
    expect(trace).toBeDefined();
    expect(trace!.spec).toEqual({ ref: 'docs/spec.md', file: 'docs/spec.md', ok: true });
    expect(trace!.artifact).toEqual({ ref: commitSha, commitSha, ok: true });
    expect(trace!.behaviorRecords).toBeDefined();
    expect(trace!.behaviorRecords!.length).toBe(1);
    expect(trace!.behaviorRecords![0]!.commitSha).toBe(commitSha);
  });

  it('traceBack 不存在的 entryId → undefined', () => {
    expect(traceBack('nonexistent-ts', testDir)).toBeUndefined();
  });

  it('traceBack 无 artifactRef → 不 join 行为记录', () => {
    const decision = emitDecision(makeInput({ sessionId: 's1', specRef: 'SPEC-1' }), testDir);
    const trace = traceBack(decision.ts, testDir);
    expect(trace!.artifact).toBeUndefined();
    expect(trace!.behaviorRecords).toBeUndefined();
  });

  it('traceFromBehavior 反向找决策', () => {
    const commitSha = 'deadbeef1234567';
    emitDecision(makeInput({ sessionId: 's1', artifactRef: commitSha }), testDir);
    emitDecision(makeInput({ sessionId: 's2' }), testDir);

    const found = traceFromBehavior(commitSha, testDir);
    expect(found.length).toBe(1);
    expect(found[0]!.artifactRef).toBe(commitSha);
  });
});
