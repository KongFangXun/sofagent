// ============================================================
// audit-query.test.ts · MCP audit_query tool 测试（v1.5.2 章一）
// ============================================================
//
// 覆盖：
// - 三维过滤各一例：时间 / 规则 / exitCode
// - 组合过滤一例（时间 + 规则 + exitCode）
// - causedBy 因果链查询一例（决策条目 + 因果边，消费 v1.4.4 causedBy）
// - 空结果一例
// - 非法入参各一例（时间 / exitCode / source / history+causedBy 冲突）
// - 🔴 只读断言：查询前后 history.jsonl 字节级一致（sha256 双算相等）
//
// 数据构造：history.jsonl 直接落盘（精确控制 timestamp/exitCode/ruleResults）；
// 决策条目经真实 emitDecision 写入（覆盖 causedBy schema 往返）。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';

import { auditQuery } from '../tools/audit-query';
import { emitDecision, type EmitDecisionInput, type DecisionLogEntry } from '@sofagent/audit';

// ── 数据构造辅助 ─────────────────────────────────────────────

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-mcp-audit-query-'));
}

/** history 条目 fixture（默认 PASS，无规则命中） */
function historyEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    timestamp: '2026-09-20T00:00:00.000Z',
    diffRange: 'HEAD~1..HEAD',
    exitCode: 0,
    ruleResults: [],
    diffFileCount: 1,
    ...overrides,
  };
}

/** 规则命中 fixture */
function ruleHit(id: string, status: 'PASS' | 'WARN' | 'FAIL' | 'SKIPPED', number = 1) {
  return { id, name: `${id} 示例规则`, number, status, details: [] };
}

/** 直接落盘 history.jsonl（精确控制字段——loadHistory 只解析 JSON） */
function writeHistory(dir: string, entries: Array<Record<string, unknown>>): void {
  const p = path.join(dir, 'audit', 'history.jsonl');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, entries.map((e) => `${JSON.stringify(e)}\n`).join(''), 'utf-8');
}

/** 决策输入 fixture */
function makeInput(overrides: Partial<EmitDecisionInput> = {}): EmitDecisionInput {
  return {
    agentId: 'engineer',
    sessionId: 'sess-1',
    kind: 'TOOL_GATE',
    moment: 'ACT',
    why: { text: '示例决策', tags: ['demo'] },
    ...overrides,
  };
}

function sha256OfFile(p: string): string {
  return createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

/** history 面结果形状（断言用） */
interface HistoryBlock {
  matched: number;
  returned: number;
  records: Array<{ timestamp: string; exitCode: number }>;
}

/** decision 面结果形状（断言用） */
interface DecisionBlock {
  matched: number;
  returned: number;
  records: Array<{ ts: string; kind: string; causedBy?: string[]; causalType?: string }>;
  chain?: { root: string; length: number; narrative: string; brokenAt?: string };
}

// ── 测试 ─────────────────────────────────────────────────────

describe('audit_query · history 面三维过滤（v1.5.2 章一）', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = tmpDir();
  });

  afterEach(() => {
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('时间过滤：since/until 闭区间 + [sofagent] 前缀', async () => {
    writeHistory(testDir, [
      historyEntry({ timestamp: '2026-09-20T01:00:00.000Z' }),
      historyEntry({ timestamp: '2026-09-20T02:00:00.000Z' }),
      historyEntry({ timestamp: '2026-09-20T03:00:00.000Z' }),
    ]);

    const result = await auditQuery({
      since: '2026-09-20T02:00:00.000Z',
      until: '2026-09-20T03:00:00.000Z',
      dataDir: testDir,
    });
    const h = result.data.history as HistoryBlock;
    expect(result.data.isError).toBe(false);
    expect(result.text.split('\n')[0]!.startsWith('[sofagent]')).toBe(true);
    expect(h.matched).toBe(2);
    expect(h.records.map((r) => r.timestamp)).toEqual([
      '2026-09-20T03:00:00.000Z', // 时间倒序
      '2026-09-20T02:00:00.000Z',
    ]);
  });

  it('规则过滤：rule 命中 ruleResults 中的 id', async () => {
    writeHistory(testDir, [
      historyEntry({ timestamp: '2026-09-20T01:00:00.000Z', ruleResults: [ruleHit('A1', 'PASS')] }),
      historyEntry({ timestamp: '2026-09-20T02:00:00.000Z', ruleResults: [ruleHit('E1', 'WARN', 5)] }),
      historyEntry({ timestamp: '2026-09-20T03:00:00.000Z', ruleResults: [ruleHit('A1', 'FAIL'), ruleHit('E1', 'PASS')] }),
    ]);

    const result = await auditQuery({ rule: 'A1', dataDir: testDir });
    const h = result.data.history as HistoryBlock;
    expect(h.matched).toBe(2);
  });

  it('规则过滤：兼容旧条目无 id（按名称前缀兜底）', async () => {
    writeHistory(testDir, [
      // 旧路径：无 id，name 带 "A1 " 前缀
      historyEntry({ timestamp: '2026-09-20T01:00:00.000Z', ruleResults: [{ name: 'A1 不碰敏感', number: 1, status: 'WARN', details: [] }] }),
      historyEntry({ timestamp: '2026-09-20T02:00:00.000Z', ruleResults: [{ name: 'E1 示例', number: 5, status: 'PASS', details: [] }] }),
    ]);

    const result = await auditQuery({ rule: 'A1', dataDir: testDir });
    expect((result.data.history as HistoryBlock).matched).toBe(1);
  });

  it('exitCode 过滤：仅命中指定退出码', async () => {
    writeHistory(testDir, [
      historyEntry({ timestamp: '2026-09-20T01:00:00.000Z', exitCode: 0 }),
      historyEntry({ timestamp: '2026-09-20T02:00:00.000Z', exitCode: 1 }),
      historyEntry({ timestamp: '2026-09-20T03:00:00.000Z', exitCode: 2 }),
      historyEntry({ timestamp: '2026-09-20T04:00:00.000Z', exitCode: 2 }),
    ]);

    const result = await auditQuery({ exitCode: 2, dataDir: testDir });
    const h = result.data.history as HistoryBlock;
    expect(h.matched).toBe(2);
    expect(h.records.every((r) => r.exitCode === 2)).toBe(true);
  });

  it('组合过滤：时间 + 规则 + exitCode（AND）', async () => {
    writeHistory(testDir, [
      // 命中：时间∈区间 + A1 + exitCode=2
      historyEntry({ timestamp: '2026-09-20T02:00:00.000Z', exitCode: 2, ruleResults: [ruleHit('A1', 'FAIL')] }),
      // 时间早于 since
      historyEntry({ timestamp: '2026-09-20T01:00:00.000Z', exitCode: 2, ruleResults: [ruleHit('A1', 'FAIL')] }),
      // exitCode 不符
      historyEntry({ timestamp: '2026-09-20T02:30:00.000Z', exitCode: 0, ruleResults: [ruleHit('A1', 'PASS')] }),
      // 规则不符
      historyEntry({ timestamp: '2026-09-20T02:40:00.000Z', exitCode: 2, ruleResults: [ruleHit('E1', 'FAIL', 5)] }),
    ]);

    const result = await auditQuery({
      since: '2026-09-20T01:30:00.000Z',
      until: '2026-09-20T03:00:00.000Z',
      rule: 'A1',
      exitCode: 2,
      dataDir: testDir,
    });
    const h = result.data.history as HistoryBlock;
    expect(h.matched).toBe(1);
    expect(h.records[0]!.timestamp).toBe('2026-09-20T02:00:00.000Z');
  });

  it('空结果：明确文案（非空串）', async () => {
    writeHistory(testDir, [historyEntry({ timestamp: '2026-09-20T01:00:00.000Z', exitCode: 0 })]);

    const result = await auditQuery({ exitCode: 2, dataDir: testDir });
    const h = result.data.history as HistoryBlock;
    expect(result.data.isError).toBe(false);
    expect(h.matched).toBe(0);
    expect(result.text).toContain('无匹配记录');
  });
});

describe('audit_query · decision 面因果链', () => {
  let testDir: string;
  let savedKeyPath: string | undefined;

  beforeEach(() => {
    testDir = tmpDir();
    savedKeyPath = process.env.SOFAGENT_KEY_PATH;
    const keyPath = path.join(testDir, 'test-hmac-key');
    fs.writeFileSync(keyPath, 'test-hmac-key-0123456789abcdef');
    process.env.SOFAGENT_KEY_PATH = keyPath;
  });

  afterEach(() => {
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch { /* */ }
    if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
    else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
  });

  it('causedBy：查以该 ts 为因果上游的后继决策 + 上溯链叙事', async () => {
    // 因果链：route → caused → block → caused → escalate
    const route = emitDecision(makeInput({
      sessionId: 's1', kind: 'ORCHESTRATION', category: 'route',
      why: { text: '任务派给 executor 档', tags: ['route'] },
    }), testDir) as DecisionLogEntry;
    const block = emitDecision(makeInput({
      sessionId: 's1', kind: 'TOOL_GATE',
      why: { text: '拦截写 .env（A1）', tags: ['a1'], triggeredRule: 'A1' },
      causedBy: [route.ts], causalType: 'caused',
    }), testDir) as DecisionLogEntry;
    const escalate = emitDecision(makeInput({
      sessionId: 's1', kind: 'ESCALATE_REPORT', category: 'escalate',
      why: { text: '拦截后升级人工复核' },
      causedBy: [block.ts], causalType: 'caused',
    }), testDir) as DecisionLogEntry;

    // 源推断：带 causedBy → decision 面；以 block.ts 为因果上游
    const result = await auditQuery({ causedBy: block.ts, dataDir: testDir });
    expect(result.data.source).toBe('decision');
    const d = result.data.decision as DecisionBlock;
    // 后继（下游）决策 = escalate
    expect(d.matched).toBe(1);
    expect(d.records[0]!.ts).toBe(escalate.ts);
    expect(d.records[0]!.causedBy).toContain(block.ts);
    // 上溯链（以 block 为起点）：block(depth0) → route(depth1) = 2 节点
    expect(d.chain).toBeDefined();
    expect(d.chain!.root).toBe(block.ts);
    expect(d.chain!.length).toBe(2);
    expect(d.chain!.narrative).toContain('导致了');
  });

  it('decision 时间过滤（无 causedBy → 列时间窗内决策）', async () => {
    const e1 = emitDecision(makeInput({ sessionId: 's1' }), testDir) as DecisionLogEntry;
    const e2 = emitDecision(makeInput({ sessionId: 's2' }), testDir) as DecisionLogEntry;

    const result = await auditQuery({ source: 'decision', since: e1.ts, until: e2.ts, dataDir: testDir });
    const d = result.data.decision as DecisionBlock;
    expect(d.matched).toBe(2);
  });
});

describe('audit_query · 非法入参（不抛未捕获异常）', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = tmpDir();
  });

  afterEach(() => {
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('非法时间格式 → 明确错误', async () => {
    const result = await auditQuery({ since: 'not-a-date', dataDir: testDir });
    expect(result.data.isError).toBe(true);
    expect(result.text).toContain('参数错误');
    expect(result.text).toContain('since');
  });

  it('非法 exitCode → 明确错误', async () => {
    const result = await auditQuery({ exitCode: 9 as unknown as 0 | 1 | 2, dataDir: testDir });
    expect(result.data.isError).toBe(true);
    expect(result.text).toContain('exitCode');
  });

  it('非法 source → 明确错误', async () => {
    const result = await auditQuery({ source: 'bogus' as unknown as 'history', dataDir: testDir });
    expect(result.data.isError).toBe(true);
    expect(result.text).toContain('source');
  });

  it('source=history 与 causedBy 冲突 → 明确错误', async () => {
    const result = await auditQuery({ source: 'history', causedBy: '2026-09-20T00:00:00.000Z', dataDir: testDir });
    expect(result.data.isError).toBe(true);
    expect(result.text).toContain('causedBy');
  });
});

describe('audit_query · 只读断言（history.jsonl 字节级一致）', () => {
  let testDir: string;
  let savedKeyPath: string | undefined;

  beforeEach(() => {
    testDir = tmpDir();
    savedKeyPath = process.env.SOFAGENT_KEY_PATH;
    const keyPath = path.join(testDir, 'test-hmac-key');
    fs.writeFileSync(keyPath, 'test-hmac-key-0123456789abcdef');
    process.env.SOFAGENT_KEY_PATH = keyPath;
  });

  afterEach(() => {
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch { /* */ }
    if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
    else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
  });

  it('查询前后 history.jsonl 字节级一致（sha256 双算相等）+ decision-log 亦不被写', async () => {
    // 造一份真实 history.jsonl + 一份 decision-log.jsonl
    writeHistory(testDir, [
      historyEntry({ timestamp: '2026-09-20T01:00:00.000Z', exitCode: 0, ruleResults: [ruleHit('A1', 'PASS')] }),
      historyEntry({ timestamp: '2026-09-20T02:00:00.000Z', exitCode: 2, ruleResults: [ruleHit('A1', 'FAIL')] }),
      historyEntry({ timestamp: '2026-09-20T03:00:00.000Z', exitCode: 1, ruleResults: [ruleHit('E1', 'WARN', 5)] }),
    ]);
    const anchor = emitDecision(makeInput({ sessionId: 's1' }), testDir) as DecisionLogEntry;

    const historyPath = path.join(testDir, 'audit', 'history.jsonl');
    const decisionPath = path.join(testDir, 'audit', 'decision-log.jsonl');

    const before = sha256OfFile(historyPath);
    const beforeDecision = sha256OfFile(decisionPath);

    // 覆盖 history 面 + decision 面（both）的查询
    const result = await auditQuery({
      source: 'both',
      rule: 'A1',
      exitCode: 2,
      causedBy: anchor.ts,
      dataDir: testDir,
    });
    expect(result.data.isError).toBe(false);

    const after = sha256OfFile(historyPath);
    const afterDecision = sha256OfFile(decisionPath);

    // 🔴 核心只读断言：字节级一致
    expect(after).toBe(before);
    expect(before).toBe(after);
    // 附加：decision 链文件同样零破坏
    expect(afterDecision).toBe(beforeDecision);

    // 留证：打印双次 sha256 供人工核对
    // eslint-disable-next-line no-console
    console.log(`[readonly] history.jsonl sha256 before=${before} after=${after} equal=${after === before}`);
  });
});
