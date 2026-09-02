// ============================================================
// decision-query.test.ts · 决策审计查询层测试（v1.3.0 交付 6 T04）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, writeFileSync, rmSync, mkdirSync, readFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { emitDecision, type EmitDecisionInput, DecisionSchemaError } from './decision-log';
import { queryByKind, getKindSummary, traceBack, traceFromBehavior, traceDecisionChain, findSimilarDecisions } from './decision-query';
import { appendHistory, type AuditHistoryEntry } from './audit-history';
import { checkDecisionChainDetailed } from './decision-chain';
import { getDecisionLogPath } from '@sofagent/core';

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

// ============================================================
// 因果链查询（决策因果边 + 链回溯 + 先例检索）
// ============================================================

describe('decision causal chain（因果链）', () => {
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

  it('旧条目（无 causedBy）写入与链校验不破坏（向后兼容）', () => {
    // 老格式条目：无 causedBy / causalType
    const e1 = emitDecision(makeInput({ sessionId: 's1' }), testDir);
    const e2 = emitDecision(makeInput({ sessionId: 's2' }), testDir);
    expect(e1.causedBy).toBeUndefined();
    expect(e2.prevHash).not.toBe('genesis');
    // 新字段条目接着老条目写——链连续
    const e3 = emitDecision(makeInput({
      sessionId: 's3',
      causedBy: [e1.ts],
      causalType: 'caused',
    }), testDir);
    expect(e3.causedBy).toEqual([e1.ts]);
    expect(e3.causalType).toBe('caused');
  });

  it('causedBy 非法值写入被拒（schema 校验）', () => {
    expect(() => emitDecision(makeInput({
      sessionId: 's1',
      causedBy: 'not-an-array' as unknown as string[],
    }), testDir)).toThrow(DecisionSchemaError);
    expect(() => emitDecision(makeInput({
      sessionId: 's1',
      causalType: 'invalid' as never,
    }), testDir)).toThrow(DecisionSchemaError);
  });

  it('HMAC 计算涵盖新字段（篡改 causedBy → 链校验红）', () => {
    const e1 = emitDecision(makeInput({ sessionId: 's1' }), testDir);
    const e2 = emitDecision(makeInput({
      sessionId: 's2',
      causedBy: [e1.ts],
      causalType: 'caused',
    }), testDir);
    expect(e2.hmacSig).toBeDefined();

    // 篡改：改 causedBy 指向 → HMAC 失配 → checkDecisionChainDetailed 红
    const logPath = getDecisionLogPath(testDir);
    const raw = readFileSync(logPath, 'utf-8');
    const tampered = raw.replace(
      JSON.stringify([e1.ts]),
      JSON.stringify(['2099-01-01T00:00:00.000Z']),
    );
    expect(tampered).not.toBe(raw); // 确认替换生效
    writeFileSync(logPath, tampered);

    const check = checkDecisionChainDetailed(testDir);
    expect(check.status).toBe('tampered');
  });

  it('traceDecisionChain 多级回溯 + 链式叙事（路由→拦截→上报）', () => {
    // 因果铤：路由决策 → 导致拦截 → 导致上报人工
    const route = emitDecision(makeInput({
      sessionId: 's1', kind: 'ORCHESTRATION', category: 'route',
      why: { text: '任务派给 executor 档', tags: ['route'] },
    }), testDir);
    const block = emitDecision(makeInput({
      sessionId: 's1', kind: 'TOOL_GATE',
      why: { text: '拦截写 .env（A1）', tags: ['a1'], triggeredRule: 'A1' },
      causedBy: [route.ts], causalType: 'caused',
    }), testDir);
    const escalate = emitDecision(makeInput({
      sessionId: 's1', kind: 'ESCALATE_REPORT', category: 'escalate',
      why: { text: '拦截后升级人工复核' },
      causedBy: [block.ts], causalType: 'caused',
    }), testDir);

    const trace = traceDecisionChain(escalate.ts, testDir);
    expect(trace).toBeDefined();
    expect(trace!.chain).toHaveLength(3);
    expect(trace!.chain[0]!.entry.ts).toBe(escalate.ts);   // 起点 depth 0
    expect(trace!.chain[2]!.entry.ts).toBe(route.ts);       // 根因最深
    // 叙事：根因在前 + 因果连接词
    expect(trace!.narrative).toContain('ORCHESTRATION');
    expect(trace!.narrative).toContain('导致了');
    expect(trace!.narrative).toContain('TOOL_GATE');
    expect(trace!.brokenAt).toBeUndefined();
  });

  it('traceDecisionChain 旧条目（无 causedBy）→ 单节点链不报错', () => {
    const e = emitDecision(makeInput({ sessionId: 's1' }), testDir);
    const trace = traceDecisionChain(e.ts, testDir);
    expect(trace).toBeDefined();
    expect(trace!.chain).toHaveLength(1);
  });

  it('traceDecisionChain causedBy 指向不存在条目 → brokenAt 如实标注', () => {
    emitDecision(makeInput({
      sessionId: 's1',
      causedBy: ['2000-01-01T00:00:00.000Z'], // 不存在
      causalType: 'caused',
    }), testDir);
    const entries = queryByKind('TOOL_GATE', {}, testDir);
    const trace = traceDecisionChain(entries[0]!.ts, testDir);
    expect(trace!.brokenAt).toContain('不存在');
  });

  it('findSimilarDecisions 按 tags + triggeredRule 匹配（HITL 先例展示）', () => {
    // 历史先例：两条 A1 拦截 + 一条无关
    emitDecision(makeInput({
      sessionId: 's1',
      why: { text: '拦截写 .env', tags: ['a1', 'sensitive'], triggeredRule: 'A1' },
    }), testDir);
    emitDecision(makeInput({
      sessionId: 's2',
      why: { text: '拦截硬编码 key', tags: ['a1'], triggeredRule: 'A1' },
    }), testDir);
    emitDecision(makeInput({
      sessionId: 's3', kind: 'CONFIG_CHANGE',
      why: { text: '切换模型档位', tags: ['model'] },
    }), testDir);
    // HITL 待审决策（查询条件）
    const hits = findSimilarDecisions(
      { tags: ['a1', 'sensitive'], triggeredRule: 'A1', kind: 'TOOL_GATE' },
      {}, testDir,
    );
    expect(hits.length).toBe(2);
    // 第一条命中 tags×2（a1+sensitive）+ rule + kind = 2*2+3+1 = 8 分
    expect(hits[0]!.score).toBe(8);
    expect(hits[0]!.matchedOn).toContain('rule:A1');
    expect(hits[1]!.score).toBe(6); // a1 + rule + kind
    // 无关条目不进结果
    expect(hits.every((h) => h.entry.sessionId !== 's3')).toBe(true);
  });
});
