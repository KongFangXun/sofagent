// ruler-change.test.ts · v1.7.0 §七 · 尺子变更事件 schema + 同链写入 + 版本接续测试
// ============================================================
// 覆盖：六 aspect 全可表达；delta 缺 before/after 拒载；trigger=override
// 时 refs 必填；kind 向后兼容（既有条目可读）；同链（prevHash 相接 +
// HMAC 可验）；版本可接续断言（fixture 两次变更）；unversioned 降级口径。
// ============================================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import {
  RulerChangeEventSchema,
  validateRulerChange,
  assertVersionContinuable,
  RulerChangeSchemaError,
  type RulerChangeEvent,
} from './ruler-change-schema';
import { appendRulerChange, emitDecision } from './decision-log';
import { checkDecisionChainDetailed } from './decision-chain';
import { getDecisionLogPath } from '@sofagent/core';

function tmpDir(): string {
  const dir = join(tmpdir(), `sofagent-ruler-test-${Date.now()}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 合法变更事件母本（modify 态——before/after 齐） */
function makeEvent(overrides: Partial<RulerChangeEvent> = {}): RulerChangeEvent {
  return validateRulerChange({
    ts: '2026-10-20T00:00:00.000Z',
    agentId: 'engineer',
    sessionId: 'sess-rc',
    aspect: 'criterion',
    targetId: 'A1-1',
    version: { from: 'v1', to: 'v2' },
    delta: { op: 'modify', before: { question: '旧问句', weight: 1 }, after: { question: '新问句', weight: 2 } },
    actor: { id: 'user-1', role: 'author' },
    rationale: { trigger: 'override', refs: ['2026-10-19T10:00:00.000Z'], note: '人对机器的判定不服' },
    ...overrides,
  });
}

describe('ruler-change-schema · 六 aspect 与 delta 校验', () => {
  it('test_ruler_六aspect全可表达', () => {
    // 六载体逐一构造——每个 aspect 均可通过 schema
    for (const aspect of ['criterion', 'question', 'threshold', 'cost', 'domain', 'evidence'] as const) {
      const e = makeEvent({ aspect, targetId: `${aspect}-id` });
      expect(e.aspect).toBe(aspect);
    }
  });

  it('test_ruler_delta缺before或after拒载', () => {
    // modify 缺 before（只有 add 可缺前态）——拒载并列出缺失项
    expect(() => validateRulerChange({ ...makeEvent(), delta: { op: 'modify', after: { q: '新' } } })).toThrow(RulerChangeSchemaError);
    // modify 缺 after——拒载
    expect(() => validateRulerChange({ ...makeEvent(), delta: { op: 'modify', before: { q: '旧' } } })).toThrow(RulerChangeSchemaError);
    // disable 缺 before——拒载（disable 与 modify 同须两态齐）
    expect(() => validateRulerChange({ ...makeEvent(), delta: { op: 'disable', after: { enabled: false } } })).toThrow(RulerChangeSchemaError);
    // add 可缺 before / remove 可缺 after（合法边界——不拒）
    expect(validateRulerChange({ ...makeEvent(), delta: { op: 'add', after: { q: '新' } } }).delta.op).toBe('add');
    expect(validateRulerChange({ ...makeEvent(), delta: { op: 'remove', before: { q: '旧' } } }).delta.op).toBe('remove');
  });

  it('test_ruler_trigger为override时refs必填', () => {
    // 人否机器却指不出是哪几条——写侧校验不静默放过
    expect(() =>
      validateRulerChange({ ...makeEvent(), rationale: { trigger: 'override', refs: [], note: '不服' } }),
    ).toThrow(RulerChangeSchemaError);
    // 非 override trigger 空 refs 合法（incident 等非人否机器触发可无回指）
    expect(
      validateRulerChange({ ...makeEvent(), rationale: { trigger: 'incident', refs: [] } }).rationale.trigger,
    ).toBe('incident');
  });

  it('test_ruler_校验失败显式列出缺失项（不静默丢弃）', () => {
    try {
      validateRulerChange({ ...makeEvent(), delta: { op: 'modify' } });
      expect.unreachable('modify 缺前后态应拒载');
    } catch (err) {
      expect(err).toBeInstanceOf(RulerChangeSchemaError);
      const e = err as RulerChangeSchemaError;
      expect(e.issues.length).toBeGreaterThan(0);
      expect(e.issues.join(' ')).toContain('before');
      expect(e.issues.join(' ')).toContain('after');
    }
  });

  it('test_ruler_version可空与unversioned显式标记（降级口径）', () => {
    // 判据版本化未就位：version 缺席（undefined）合法——只落「有变更 + delta」
    const noVersion = validateRulerChange({ ...makeEvent(), version: undefined });
    expect(noVersion.version).toBeUndefined();
    // 显式 unversioned 标记合法
    const unv = validateRulerChange({ ...makeEvent(), version: { unversioned: true } });
    expect(unv.version).toEqual({ unversioned: true });
    // from/to 至少一项非空（全空版本锚 = 无从接续——拒载）
    expect(() => validateRulerChange({ ...makeEvent(), version: { from: undefined, to: undefined } })).toThrow();
  });

  it('test_ruler_非法aspect与非法trigger拒载', () => {
    expect(() => validateRulerChange({ ...makeEvent(), aspect: 'nonexistent' as never })).toThrow(RulerChangeSchemaError);
    expect(() => validateRulerChange({ ...makeEvent(), rationale: { trigger: 'mood' as never, refs: [] } })).toThrow(RulerChangeSchemaError);
  });
});

describe('ruler-change · 版本可接续断言（schema 级）', () => {
  it('test_ruler_同criterionId版本链可接续_fixture两次变更', () => {
    // fixture：第一次变更 v1→v2，第二次变更 v2→v3——to 能被下次 from 接上
    const first = makeEvent({ version: { from: 'v1', to: 'v2' } });
    const second = makeEvent({ version: { from: 'v2', to: 'v3' }, delta: { op: 'modify', before: { q: '新问句' }, after: { q: '更新问句' } } });
    expect(() => assertVersionContinuable(first, second)).not.toThrow();
  });

  it('test_ruler_版本链断裂即断言失败', () => {
    const first = makeEvent({ version: { from: 'v1', to: 'v2' } });
    const broken = makeEvent({ version: { from: 'v9', to: 'v10' } }); // from ≠ 前 to
    expect(() => assertVersionContinuable(first, broken)).toThrow(RulerChangeSchemaError);
  });

  it('test_ruler_不同targetId不可接续_unversioned无接续义务', () => {
    const first = makeEvent({ targetId: 'A1-1', version: { from: 'v1', to: 'v2' } });
    const other = makeEvent({ targetId: 'B2-2', version: { from: 'v2', to: 'v3' } });
    expect(() => assertVersionContinuable(first, other)).toThrow(/targetId 不一致/);
    // unversioned / 缺席版本锚——无接续义务（降级口径下只落「有变更」）
    const unv = makeEvent({ version: { unversioned: true } });
    expect(() => assertVersionContinuable(first, unv)).not.toThrow();
    expect(() => assertVersionContinuable(unv, first)).not.toThrow();
  });
});

describe('appendRulerChange · 同链写入（prevHash 相接 + HMAC 可验）', () => {
  let testDir: string;
  let savedKeyPath: string | undefined;

  beforeEach(() => {
    testDir = tmpDir();
    savedKeyPath = process.env.SOFAGENT_KEY_PATH;
    writeFileSync(join(testDir, 'test-hmac-key'), 'test-hmac-key-0123456789abcdef');
    process.env.SOFAGENT_KEY_PATH = join(testDir, 'test-hmac-key');
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* */ }
    if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
    else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
  });

  it('test_ruler_落decision_log同链_prevHash相接_HMAC可验', () => {
    // 先写一条既有 kind 条目，再写尺子变更——两条共用同一条链
    emitDecision(
      { agentId: 'engineer', sessionId: 'sess-rc', kind: 'TOOL_GATE', moment: 'ACT', why: { text: '前置判定条目' } },
      testDir,
    );
    const entry = appendRulerChange(makeEvent(), testDir);
    const filePath = getDecisionLogPath(testDir);
    expect(existsSync(filePath)).toBe(true);
    const lines = readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
    expect(lines.length).toBe(2);
    const first = JSON.parse(lines[0]!) as { prevHash?: string; hmacSig?: string };
    const second = JSON.parse(lines[1]!) as { prevHash?: string; hmacSig?: string; kind: string; rulerChange?: RulerChangeEvent };
    // 第二条（尺子变更）prevHash 与前条相接（非 genesis）
    expect(second.prevHash).not.toBe('genesis');
    expect(second.kind).toBe('RULER_CHANGE');
    expect(second.hmacSig).toBeTruthy();
    // 结构化事件体随链落盘（机器消费面读 rulerChange 本体）
    expect(second.rulerChange?.targetId).toBe('A1-1');
    // 验链（同链可验签——与既有条目共用 checkDecisionChainDetailed）
    const chain = checkDecisionChainDetailed(filePath, testDir);
    expect(['ok', 'insufficient']).toContain(chain.status);
    expect(chain.status).not.toBe('tampered');
  });

  it('test_ruler_事件体非法即拒载不写文件', () => {
    // delta 缺 before/after——schema 校验先于写盘（fail-closed）
    expect(() =>
      appendRulerChange({ ...makeEvent(), delta: { op: 'modify' } }, testDir),
    ).toThrow(RulerChangeSchemaError);
    expect(existsSync(getDecisionLogPath(testDir))).toBe(false);
  });

  it('test_ruler_既有kind条目可读_kind扩容向后兼容', () => {
    // schema 演进不破历史：写入 RULER_CHANGE 后既有 kind（TOOL_GATE）条目照常落链可读
    emitDecision(
      { agentId: 'engineer', sessionId: 's1', kind: 'SPEC_CHANGE', moment: 'INDUC', why: { text: '历史形态条目' } },
      testDir,
    );
    appendRulerChange(makeEvent(), testDir);
    emitDecision(
      { agentId: 'engineer', sessionId: 's2', kind: 'SPEC_CHANGE', moment: 'INDUC', why: { text: '第二条历史形态' } },
      testDir,
    );
    const lines = readFileSync(getDecisionLogPath(testDir), 'utf-8').split('\n').filter(Boolean);
    expect(lines.length).toBe(3);
    const kinds = lines.map((l) => (JSON.parse(l) as { kind: string }).kind);
    expect(kinds).toEqual(['SPEC_CHANGE', 'RULER_CHANGE', 'SPEC_CHANGE']);
    const chain = checkDecisionChainDetailed(getDecisionLogPath(testDir), testDir);
    expect(chain.status).not.toBe('tampered');
  });

  it('test_ruler_ts缺省由写入侧生成', () => {
    const { ts: _ts, ...rest } = makeEvent();
    const entry = appendRulerChange(rest, testDir);
    expect(entry.rulerChange.ts).toBeTruthy(); // ISO 串非空
  });
});
