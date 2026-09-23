// ============================================================
// mandate-gate-mw.test.ts · v1.5.2 章七 · 事前授权补环 middleware 测试
// ============================================================
//
// 覆盖面（逐条对 §七 验收标准）：
//   1. 越范围 / 超时效 / 无授权 ⇒ 执行前拒绝：断言 **next() 未被调用**（真断言）
//   2. 拒绝已挂链留痕：真读回 decision-log 断言条目 + kind/category/tags
//   3. 关闭（L1）后行为与今日一致：断言直通、**零留痕**
//   4. 复用章三骨架：mandate 判定挂进 should-run 的 human-gate 一问（不新建第二套）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, rmSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { getDecisionLogPath } from '@sofagent/core';
import type { DecisionLogEntry } from '@sofagent/audit';
import {
  MandateGateMiddleware,
  createMandateShouldRunGate,
  mandateShouldRunProbe,
  type MandateCoverageQuery,
  type MandateCoverageVerdict,
} from '../mandate-gate-mw';
import type { SofagentEvent } from '../../events/types';

function tmpDir(): string {
  const dir = join(tmpdir(), `sofagent-mandate-gate-${Date.now()}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 受控查询面（fake——不依赖 audit 实现，测试自洽） */
function fakeQuery(verdict: MandateCoverageVerdict): MandateCoverageQuery {
  return { covers: () => verdict };
}

const COVERED: MandateCoverageVerdict = {
  verdict: 'covered',
  covered: true,
  reason: '授权 mg-1 覆盖该动作（审批人：alice@sec）',
  grantId: 'mg-1',
  approver: 'alice@sec',
};

/** 读回 decision-log 全部条目 */
function readDecisions(dataDir: string): DecisionLogEntry[] {
  const filePath = getDecisionLogPath(dataDir);
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as DecisionLogEntry);
}

describe('MandateGateMiddleware · 执行前拦截（越界 next() 不被调用）', () => {
  let testDir: string;
  let savedKeyPath: string | undefined;

  beforeEach(() => {
    testDir = tmpDir();
    savedKeyPath = process.env.SOFAGENT_KEY_PATH;
    writeFileSync(join(testDir, 'test-hmac-key'), 'test-hmac-key-0123456789abcdef');
    process.env.SOFAGENT_KEY_PATH = join(testDir, 'test-hmac-key');
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      /* */
    }
    if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
    else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
  });

  it('范围内 ⇒ 执行 next() 并返回其结果', async () => {
    const gate = new MandateGateMiddleware({
      enabled: true,
      query: fakeQuery(COVERED),
      subject: 'agent-eng',
      dataDir: testDir,
    });
    let called = false;
    const result = await gate.wrapToolCall(
      { toolName: 'sf_write', args: { path: 'src/a.ts' } },
      async () => {
        called = true;
        return '写入成功';
      },
    );
    expect(called).toBe(true);
    expect(result).toBe('写入成功');
  });

  it('越范围 ⇒ 执行前拒绝：next() **未被调用** + 返回拒绝信息', async () => {
    const gate = new MandateGateMiddleware({
      enabled: true,
      query: fakeQuery({ verdict: 'out-of-scope', covered: false, reason: '动作不在授权范围内' }),
      subject: 'agent-eng',
      dataDir: testDir,
    });
    let called = false;
    const result = await gate.wrapToolCall({ toolName: 'sf_exec', args: {} }, async () => {
      called = true;
      return 'should-not-run';
    });
    expect(called).toBe(false); // 真断言：越界时 next() 未被调用
    expect(typeof result).toBe('string');
    expect(result as string).toContain('执行前拒绝');
  });

  it('超时效 ⇒ 执行前拒绝：next() **未被调用**', async () => {
    const gate = new MandateGateMiddleware({
      enabled: true,
      query: fakeQuery({ verdict: 'expired', covered: false, reason: '授权已超时效' }),
      subject: 'agent-eng',
      dataDir: testDir,
    });
    let called = false;
    await gate.wrapToolCall({ toolName: 'sf_write', args: {} }, async () => {
      called = true;
      return 'x';
    });
    expect(called).toBe(false);
  });

  it('无授权 ⇒ 执行前拒绝：next() **未被调用**', async () => {
    const gate = new MandateGateMiddleware({
      enabled: true,
      query: fakeQuery({ verdict: 'no-mandate', covered: false, reason: '主体「agent-eng」无任何授权' }),
      subject: 'agent-eng',
      dataDir: testDir,
    });
    let called = false;
    await gate.wrapToolCall({ toolName: 'sf_write', args: {} }, async () => {
      called = true;
      return 'x';
    });
    expect(called).toBe(false);
  });

  it('同步 check()（生产工具执行点）与 wrapToolCall 同判定', () => {
    const denyGate = new MandateGateMiddleware({
      enabled: true,
      query: fakeQuery({ verdict: 'out-of-scope', covered: false, reason: '越范围' }),
      subject: 'agent-eng',
      dataDir: testDir,
    });
    const decision = denyGate.check({ toolName: 'sf_exec', args: {} });
    expect(decision.allow).toBe(false);
    expect(decision.message).toContain('执行前拒绝');
  });
});

describe('MandateGateMiddleware · 拒绝挂链留痕（对齐章五裁决形态）', () => {
  let testDir: string;
  let savedKeyPath: string | undefined;

  beforeEach(() => {
    testDir = tmpDir();
    savedKeyPath = process.env.SOFAGENT_KEY_PATH;
    writeFileSync(join(testDir, 'test-hmac-key'), 'test-hmac-key-0123456789abcdef');
    process.env.SOFAGENT_KEY_PATH = join(testDir, 'test-hmac-key');
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      /* */
    }
    if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
    else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
  });

  it('越界拒绝落 decision-log（kind=TOOL_GATE + category=skip + tags 含 mandate/deny）', async () => {
    const gate = new MandateGateMiddleware({
      enabled: true,
      query: fakeQuery({ verdict: 'out-of-scope', covered: false, reason: '动作不在授权范围内' }),
      subject: 'agent-eng',
      dataDir: testDir,
    });
    await gate.wrapToolCall({ toolName: 'sf_exec', args: {} }, async () => 'x');

    const entries = readDecisions(testDir);
    expect(entries).toHaveLength(1);
    const e = entries[0]!;
    expect(e.kind).toBe('TOOL_GATE');
    expect(e.moment).toBe('ACT');
    expect(e.category).toBe('skip'); // 越范围 ⇒ 明确不覆盖，跳过
    expect(e.why.tags).toEqual(['mandate', 'deny', 'out-of-scope']);
    expect(e.why.text).toContain('授权越界拒绝');
    expect(e.evidence).toContain('subject=agent-eng');
    expect(e.evidence).toContain('action=sf_exec');
    expect(e.evidence).toContain('verdict=deny');
    expect(typeof e.hmacSig).toBe('string');
    expect(e.hashVersion).toBe(2);
  });

  it('无授权拒绝 category=escalate（需人审授权）', async () => {
    const gate = new MandateGateMiddleware({
      enabled: true,
      query: fakeQuery({ verdict: 'no-mandate', covered: false, reason: '无任何授权' }),
      subject: 'agent-eng',
      dataDir: testDir,
    });
    await gate.wrapToolCall({ toolName: 'sf_write', args: {} }, async () => 'x');
    const e = readDecisions(testDir)[0]!;
    expect(e.category).toBe('escalate');
    expect(e.why.tags).toEqual(['mandate', 'deny', 'no-mandate']);
  });

  it('放行裁决也留痕（category=select——对齐章五 Allow 亦留痕）', async () => {
    const gate = new MandateGateMiddleware({
      enabled: true,
      query: fakeQuery(COVERED),
      subject: 'agent-eng',
      dataDir: testDir,
    });
    await gate.wrapToolCall({ toolName: 'sf_write', args: { path: 'src/a.ts' } }, async () => 'ok');
    const e = readDecisions(testDir)[0]!;
    expect(e.category).toBe('select');
    expect(e.why.tags).toEqual(['mandate', 'allow', 'covered']);
    expect(e.evidence).toContain('grantId=mg-1');
    expect(e.evidence).toContain('approver=alice@sec');
  });
});

describe('MandateGateMiddleware · 可拔契约（L1 默认关——零行为变化）', () => {
  let testDir: string;
  let savedKeyPath: string | undefined;

  beforeEach(() => {
    testDir = tmpDir();
    savedKeyPath = process.env.SOFAGENT_KEY_PATH;
    writeFileSync(join(testDir, 'test-hmac-key'), 'test-hmac-key-0123456789abcdef');
    process.env.SOFAGENT_KEY_PATH = join(testDir, 'test-hmac-key');
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      /* */
    }
    if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
    else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
  });

  it('默认构造（未启用）⇒ check 直通 {allow:true}', () => {
    const gate = new MandateGateMiddleware();
    expect(gate.isEnabled()).toBe(false);
    expect(gate.check({ toolName: 'sf_exec', args: {} })).toEqual({ allow: true });
  });

  it('未启用 ⇒ wrapToolCall 原样直通（next() 调用 + 结果逐字返回）且零留痕', async () => {
    const gate = new MandateGateMiddleware({ dataDir: testDir }); // 无 query、无 enabled
    let called = false;
    const result = await gate.wrapToolCall({ toolName: 'sf_write', args: { path: 'src/a.ts' } }, async () => {
      called = true;
      return '逐字结果';
    });
    expect(called).toBe(true);
    expect(result).toBe('逐字结果');
    // 零留痕：decision-log 文件不存在
    expect(existsSync(getDecisionLogPath(testDir))).toBe(false);
  });

  it('未启用 ⇒ 判定计数不增长（未触发任何判定路径）', async () => {
    const gate = new MandateGateMiddleware({ dataDir: testDir });
    await gate.wrapToolCall({ toolName: 'sf_write', args: {} }, async () => 'ok');
    expect(gate.getEvaluatedCount()).toBe(0);
    expect(gate.getDeniedCount()).toBe(0);
  });
});

describe('MandateGateMiddleware · 复用章三 should-run 骨架（不新建第二套）', () => {
  it('mandate 判定挂进 human-gate 一问：createMandateShouldRunGate 不通过时 question=human-gate', async () => {
    const gate = createMandateShouldRunGate(
      fakeQuery({ verdict: 'no-mandate', covered: false, reason: '无授权' }),
    );
    const event: SofagentEvent = {
      id: 'evt-1',
      type: 'workflow.node.completed',
      source: 'node-output',
      ts: new Date().toISOString(),
      payload: {},
      correlationId: 'corr-1',
      targetNodeId: 'agent-eng',
      metadata: { agentId: 'agent-eng', toolName: 'sf_write' },
    };
    const result = await gate(event);
    expect(result.run).toBe(false);
    expect(result.suspended?.question).toBe('human-gate'); // 复用骨架的 human-gate 问
    expect(result.suspended?.reason).toContain('授权越界');
  });

  it('mandate 覆盖 ⇒ gate 放行（run=true）', async () => {
    const gate = createMandateShouldRunGate(fakeQuery(COVERED), { subject: 'agent-eng' });
    const event: SofagentEvent = {
      id: 'evt-2',
      type: 'workflow.node.completed',
      source: 'node-output',
      ts: new Date().toISOString(),
      payload: {},
      correlationId: 'corr-2',
      metadata: { agentId: 'agent-eng', toolName: 'sf_write' },
    };
    const result = await gate(event);
    expect(result.run).toBe(true);
  });

  it('降级纪律：查询面抛错 ⇒ 判通过（绝不因缺数据拦住执行）', async () => {
    const throwing: MandateCoverageQuery = {
      covers: () => {
        throw new Error('台账不可读');
      },
    };
    const gate = new MandateGateMiddleware({
      enabled: true,
      query: throwing,
      subject: 'agent-eng',
    });
    const decision = gate.check({ toolName: 'sf_write', args: {} });
    expect(decision.allow).toBe(true); // 降级为通过（permissiveProbe 同款纪律）

    // 探针路径亦降级：probe 抛错经 permissiveCheck 收敛
    const probe = mandateShouldRunProbe(throwing, { subject: 'agent-eng' });
    const event: SofagentEvent = {
      id: 'evt-3',
      type: 'workflow.node.completed',
      source: 'node-output',
      ts: new Date().toISOString(),
      payload: {},
      correlationId: 'corr-3',
      metadata: { agentId: 'agent-eng', toolName: 'sf_write' },
    };
    expect(() => probe(event)).toThrow(); // 探针本身抛错（由 gate 侧 permissiveCheck 收敛）
    const gate2 = createMandateShouldRunGate(throwing);
    const result = await gate2(event);
    expect(result.run).toBe(true);
  });
});
