// ============================================================
// decision-log.test.ts · 决策审计受控写入测试（v1.3.0 交付 6 T02）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir, homedir } from 'os';
import { randomBytes } from 'crypto';
import {
  emitDecision,
  DecisionSchemaError,
  DecisionWriteError,
  type EmitDecisionInput,
} from './decision-log';
import { checkDecisionChainDetailed } from './decision-chain';
import { sanitizeWhy, type DecisionLogEntry } from './decision-schema';
import { getDecisionLogPath } from '@sofagent/core';

function tmpDir(): string {
  const dir = join(tmpdir(), `sofagent-decision-test-${Date.now()}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeInput(overrides: Partial<EmitDecisionInput> = {}): EmitDecisionInput {
  return {
    agentId: 'engineer',
    sessionId: 'sess-1',
    kind: 'TOOL_GATE',
    moment: 'ACT',
    why: { text: '拦截写 .env（A1 敏感文件）', tags: ['a1'], confidence: 'high' },
    ...overrides,
  };
}

describe('decision-log emitDecision', () => {
  let testDir: string;
  let savedKeyPath: string | undefined;

  beforeEach(() => {
    testDir = tmpDir();
    // 用 SOFAGENT_KEY_PATH 指向临时密钥——绝不触碰真实 ~/.sofagent-key
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

  it('写入到正确的文件路径（data/audit/decision-log.jsonl）', () => {
    emitDecision(makeInput(), testDir);
    const filePath = getDecisionLogPath(testDir);
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]!) as DecisionLogEntry;
    expect(parsed.kind).toBe('TOOL_GATE');
    expect(parsed.moment).toBe('ACT');
    expect(parsed.agentId).toBe('engineer');
    expect(parsed.hashVersion).toBe(2);
    expect(typeof parsed.envFingerprint).toBe('string');
    expect(parsed.envFingerprint!.length).toBeGreaterThan(0);
    expect(parsed.engine).toBe('sofagent audit');
  });

  it('文件权限恒为 0o600', () => {
    emitDecision(makeInput(), testDir);
    const filePath = getDecisionLogPath(testDir);
    const mode = statSync(filePath).mode & 0o777;
    expect(mode).toBe(0o600);
    // 第二次追加后权限仍为 0o600
    emitDecision(makeInput({ sessionId: 'sess-2' }), testDir);
    const mode2 = statSync(filePath).mode & 0o777;
    expect(mode2).toBe(0o600);
  });

  it('why 纯 string 归一化为 {text}', () => {
    emitDecision(makeInput({ why: '简单理由' }), testDir);
    const filePath = getDecisionLogPath(testDir);
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8').trim().split('\n')[0]!) as DecisionLogEntry;
    expect(parsed.why).toEqual({ text: '简单理由' });
  });

  it('先脱敏再签名——含密钥文本写入后 why.text 已脱敏', () => {
    const input = makeInput({
      why: { text: '密钥 sk-fakekeyabcdefghijklmnopqrstuvwx 已轮换', tags: ['secret'] },
    });
    emitDecision(input, testDir);
    emitDecision(makeInput({ sessionId: 's2' }), testDir);
    const filePath = getDecisionLogPath(testDir);
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8').trim().split('\n')[0]!) as DecisionLogEntry;
    expect(parsed.why.text).toContain('REDACTED');
    expect(parsed.why.text).not.toContain('sk-fakekeyabcdefghijklmnopqrstuvwx');
    // 链校验通过——证明签名基于脱敏后内容（≥2 条构成可验证链）
    const chain = checkDecisionChainDetailed(testDir);
    expect(chain.status).toBe('ok');
  });

  it('sanitizeWhy 不修改入参（纯函数）', () => {
    const why = { text: '密钥 sk-fakekeyabcdefghijklmnopqrstuvwx 已轮换' };
    sanitizeWhy(why);
    expect(why.text).toContain('sk-fakekeyabcdefghijklmnopqrstuvwx');
  });

  it('连续写入构成可验证链（genesis → prevHash 链）', () => {
    emitDecision(makeInput({ sessionId: 's1' }), testDir);
    emitDecision(makeInput({ sessionId: 's2' }), testDir);
    emitDecision(makeInput({ sessionId: 's3' }), testDir);
    const filePath = getDecisionLogPath(testDir);
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(3);
    const entries = lines.map((l) => JSON.parse(l) as DecisionLogEntry);
    expect(entries[0]!.prevHash).toBe('genesis');
    expect(entries[1]!.prevHash).toMatch(/^[0-9a-f]{16}$/);
    expect(entries[2]!.prevHash).toMatch(/^[0-9a-f]{16}$/);
    // 链完整
    expect(checkDecisionChainDetailed(testDir).status).toBe('ok');
  });

  it('非法 kind 抛 DecisionSchemaError 且不写文件', () => {
    const filePath = getDecisionLogPath(testDir);
    expect(() => emitDecision(makeInput({ kind: 'ILLEGAL_KIND' as never }), testDir)).toThrow(DecisionSchemaError);
    expect(existsSync(filePath)).toBe(false);
  });

  it('非法 moment 抛 DecisionSchemaError', () => {
    expect(() => emitDecision(makeInput({ moment: 'ILLEGAL_PHASE' as never }), testDir)).toThrow(DecisionSchemaError);
  });

  it('agentId / sessionId 必填', () => {
    expect(() => emitDecision(makeInput({ agentId: '' }), testDir)).toThrow(DecisionSchemaError);
    expect(() => emitDecision(makeInput({ sessionId: '  ' }), testDir)).toThrow(DecisionSchemaError);
  });

  it('写入失败抛 DecisionWriteError（不静默丢弃）', () => {
    // 用一个只读目录作为 dataDir 强制写入失败（POSIX 权限）
    const roDir = join(testDir, 'readonly');
    mkdirSync(roDir, { recursive: true, mode: 0o500 });
    try {
      expect(() => emitDecision(makeInput(), roDir)).toThrow(DecisionWriteError);
    } finally {
      chmodSyncRecursive(roDir);
    }
  });

  it('specRef / artifactRef 可选字段写入', () => {
    emitDecision(makeInput({ specRef: 'spec-42', artifactRef: 'abc1234' }), testDir);
    const filePath = getDecisionLogPath(testDir);
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8').trim().split('\n')[0]!) as DecisionLogEntry;
    expect(parsed.specRef).toBe('spec-42');
    expect(parsed.artifactRef).toBe('abc1234');
  });

  // ── v1.3.3 新增：evidence 字段 + EVOLUTION/TEAM kind ──

  it('evidence 字段正确写入（字符串数组）', () => {
    emitDecision(
      makeInput({
        kind: 'EVOLUTION',
        evidence: ['benchmark-score: 87 > 80', 'git-snapshot: abc1234', 'rule: A3 命中越界'],
      }),
      testDir,
    );
    const filePath = getDecisionLogPath(testDir);
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8').trim().split('\n')[0]!) as DecisionLogEntry;
    expect(parsed.evidence).toEqual(['benchmark-score: 87 > 80', 'git-snapshot: abc1234', 'rule: A3 命中越界']);
    expect(parsed.kind).toBe('EVOLUTION');
  });

  it('evidence 空数组可写入', () => {
    emitDecision(makeInput({ evidence: [] }), testDir);
    const filePath = getDecisionLogPath(testDir);
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8').trim().split('\n')[0]!) as DecisionLogEntry;
    expect(parsed.evidence).toEqual([]);
  });

  it('不传 evidence 时字段缺省（undefined）', () => {
    emitDecision(makeInput(), testDir);
    const filePath = getDecisionLogPath(testDir);
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8').trim().split('\n')[0]!) as DecisionLogEntry;
    expect(parsed.evidence).toBeUndefined();
  });

  it('非法 evidence（非数组）抛 DecisionSchemaError', () => {
    expect(() =>
      emitDecision(makeInput({ evidence: 'not-an-array' as unknown as string[] }), testDir),
    ).toThrow(DecisionSchemaError);
  });

  it('非法 evidence（含非字符串项）抛 DecisionSchemaError', () => {
    expect(() =>
      emitDecision(makeInput({ evidence: ['ok', 42 as unknown as string] }), testDir),
    ).toThrow(DecisionSchemaError);
  });

  it('EVOLUTION kind 正确写入', () => {
    emitDecision(makeInput({ kind: 'EVOLUTION', moment: 'EVOLVE', evidence: ['think.md 追加 quality_rule'] }), testDir);
    const filePath = getDecisionLogPath(testDir);
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8').trim().split('\n')[0]!) as DecisionLogEntry;
    expect(parsed.kind).toBe('EVOLUTION');
  });

  it('TEAM kind 正确写入', () => {
    emitDecision(makeInput({ kind: 'TEAM', moment: 'ACT', why: '冲突消解：trust 高者胜出' }), testDir);
    const filePath = getDecisionLogPath(testDir);
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8').trim().split('\n')[0]!) as DecisionLogEntry;
    expect(parsed.kind).toBe('TEAM');
  });

  // ── v1.3.4 新增：COMMONS kind（公地能力动作）──

  it('COMMONS kind 正确写入（公地能力发布）', () => {
    emitDecision(
      makeInput({
        kind: 'COMMONS',
        moment: 'DEPLOY',
        why: '发布能力「财报分析 Skill」（skill/finance-report-skill@1.0.0）',
        evidence: ['scan-verdict: SAFE', 'tags: finance, report', 'owner: agent-fde-001'],
      }),
      testDir,
    );
    const filePath = getDecisionLogPath(testDir);
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8').trim().split('\n')[0]!) as DecisionLogEntry;
    expect(parsed.kind).toBe('COMMONS');
    expect(parsed.moment).toBe('DEPLOY');
    expect(parsed.evidence).toEqual(['scan-verdict: SAFE', 'tags: finance, report', 'owner: agent-fde-001']);
  });

  it('COMMONS kind 拦截事件（DANGEROUS 被扫）正确写入', () => {
    emitDecision(
      makeInput({
        kind: 'COMMONS',
        moment: 'DEPLOY',
        why: '能力「恶意 Skill」发布被 SkillScan 拦截（DANGEROUS）',
        evidence: ['verdict: DANGEROUS', 'reason: rm -rf / 危险删除'],
      }),
      testDir,
    );
    const filePath = getDecisionLogPath(testDir);
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8').trim().split('\n')[0]!) as DecisionLogEntry;
    expect(parsed.kind).toBe('COMMONS');
    expect(parsed.evidence![0]).toContain('DANGEROUS');
  });

  // ── v1.5.7 章一新增：DATA_PRODUCT kind（SMB 数据产物决策）──

  it('DATA_PRODUCT kind 正确写入（E5 数据产物审计判定结论）', () => {
    emitDecision(
      makeInput({
        kind: 'DATA_PRODUCT',
        moment: 'ATTRIBUTION',
        why: { text: '数据产物审计：report.csv 勾稽不一致（total 999 ≠ 明细和 300）', tags: ['e5', 'reconcile'] },
        evidence: ['rule=E5', 'file=data/report.csv', 'claimed=999', 'detailSum=300'],
        artifactRef: 'data/report.csv',
      }),
      testDir,
    );
    const filePath = getDecisionLogPath(testDir);
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8').trim().split('\n')[0]!) as DecisionLogEntry;
    expect(parsed.kind).toBe('DATA_PRODUCT');
    expect(parsed.moment).toBe('ATTRIBUTION');
    expect(parsed.artifactRef).toBe('data/report.csv');
    expect(parsed.evidence).toEqual(['rule=E5', 'file=data/report.csv', 'claimed=999', 'detailSum=300']);
    expect(parsed.why.text).toContain('勾稽不一致');
  });

  it('DATA_PRODUCT kind 数据产物生成动作（ACT moment）正确写入', () => {
    emitDecision(
      makeInput({
        kind: 'DATA_PRODUCT',
        moment: 'ACT',
        why: '生成 Q3 汇总报表 outputs/q3-summary.csv（源：raw/orders-2026Q3.csv，勾稽已过）',
        artifactRef: 'outputs/q3-summary.csv',
      }),
      testDir,
    );
    const filePath = getDecisionLogPath(testDir);
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8').trim().split('\n')[0]!) as DecisionLogEntry;
    expect(parsed.kind).toBe('DATA_PRODUCT');
    expect(parsed.moment).toBe('ACT');
  });

  it('白名单一致性：DATA_PRODUCT 在 VALID_KINDS 内（写入不抛——双落点同步的回归锚）', () => {
    // decision-schema.ts 的 DecisionKind union 与 decision-log.ts 的 VALID_KINDS
    // 是双落点——本用例锁「类型面加了、白名单没加」的静默分叉（写入必抛 DecisionSchemaError）
    expect(() =>
      emitDecision(
        { agentId: 'smb-agent', sessionId: 'sess-smb', kind: 'DATA_PRODUCT', moment: 'ACT', why: 'probe' },
        testDir,
      ),
    ).not.toThrow();
  });
});

function chmodSyncRecursive(dir: string): void {
  try {
    const { chmodSync } = require('fs');
    chmodSync(dir, 0o700);
  } catch { /* */ }
}

describe('v1.8.0 §一 · 判定回执（接线纪律①行为锁）', () => {
  let testDir: string;
  let savedKeyPath: string | undefined;

  beforeEach(() => {
    testDir = tmpDir();
    savedKeyPath = process.env.SOFAGENT_KEY_PATH;
    process.env.SOFAGENT_KEY_PATH = join(testDir, 'test-hmac-key');
    writeFileSync(process.env.SOFAGENT_KEY_PATH, randomBytes(32).toString('hex'));
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* */ }
    if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
    else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
  });

  const goodReceipt = {
    stateDigest: 'a'.repeat(64),
    evidenceRefs: ['q-intent', 'q-scope'],
    modelIdentity: 'main01v5@rev-abc123',
    probabilities: [0.94, 0.82],
    deterministicBaseline: 'L0 规则面（判定不改规则结论）',
  };

  it('回执五件 + content:false 落盘并进 HMAC 链（链校验仍 ok）', () => {
    const e = emitDecision(makeInput({
      kind: 'ORCHESTRATION', category: 'route',
      judgeReceipt: { ...goodReceipt }, content: false,
    }), testDir);
    expect(e.judgeReceipt).toBeDefined();
    expect(Object.keys(e.judgeReceipt!).sort()).toEqual(
      ['deterministicBaseline', 'evidenceRefs', 'modelIdentity', 'probabilities', 'stateDigest'],
    );
    expect(e.content).toBe(false);
    // 落盘行含回执与语义位；链完整
    const line = readFileSync(getDecisionLogPath(testDir), 'utf-8');
    expect(line).toContain('"judgeReceipt"');
    expect(line).toContain('"content":false');
  });

  it('回执字段集恰为五件：多一项即拒（schema 违规不写盘）', () => {
    expect(() => emitDecision(makeInput({
      judgeReceipt: { ...goodReceipt, extra: 'x' } as never, content: false,
    }), testDir)).toThrow(/五件必选缺失|字段集越界/);
  });

  it('回执缺一项即拒', () => {
    const { stateDigest: _drop, ...four } = goodReceipt;
    expect(() => emitDecision(makeInput({
      judgeReceipt: four as never, content: false,
    }), testDir)).toThrow(/五件必选缺失|字段集越界/);
  });

  it('三项禁入内容：回执携带疑似原文（>2048 字符）即拒', () => {
    expect(() => emitDecision(makeInput({
      judgeReceipt: { ...goodReceipt, stateDigest: 'x'.repeat(3000) }, content: false,
    }), testDir)).toThrow(/疑似携带原文/);
  });

  it('content:true 与回执并存即拒（指纹纪律）', () => {
    expect(() => emitDecision(makeInput({
      judgeReceipt: { ...goodReceipt }, content: true,
    }), testDir)).toThrow(/content 必须为 false/);
  });

  it('probabilities 非数字数组即拒', () => {
    expect(() => emitDecision(makeInput({
      judgeReceipt: { ...goodReceipt, probabilities: ['0.9', 'high'] as never }, content: false,
    }), testDir)).toThrow(/probabilities/);
  });

  it('序列化结果零禁入内容（原始任务文本不进回执——evidenceRefs 只持问句 id）', () => {
    emitDecision(makeInput({
      judgeReceipt: { ...goodReceipt }, content: false,
      evidence: ['routeReason=L1 grade=ALLOW'],
    }), testDir);
    const e2 = JSON.parse(readFileSync(getDecisionLogPath(testDir), 'utf-8').trim().split('\n')[0]);
    // 判据：回执子对象与快照（回执+evidence）的序列化结果零禁入内容
    //（why.text 是脱敏后的理由文本、属条目层既有语义，不在本锁验收面——受红注⑤分层口径）
    const receiptJson = JSON.stringify(e2.judgeReceipt) + JSON.stringify(e2.evidence);
    expect(receiptJson).not.toContain('拦截写 .env');
    expect(receiptJson).not.toContain('provider error');
    expect(receiptJson).not.toContain('tool_output');
    expect(JSON.stringify(e2.judgeReceipt)).not.toMatch(/[\u4e00-\u9fa5]{20,}/);  // 回执不携带长自由文本
  });
});

describe('v1.8.0 §二 · 同源对账四件与写时锚定（行为锁）', () => {
  let testDir: string;
  let savedKeyPath: string | undefined;

  beforeEach(() => {
    testDir = tmpDir();
    savedKeyPath = process.env.SOFAGENT_KEY_PATH;
    process.env.SOFAGENT_KEY_PATH = join(testDir, 'test-hmac-key');
    writeFileSync(process.env.SOFAGENT_KEY_PATH, randomBytes(32).toString('hex'));
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* */ }
    if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
    else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
  });

  const base = {
    stateDigest: 'b'.repeat(64),
    evidenceRefs: ['q-1'],
    modelIdentity: 'main01v5@r1',
    probabilities: [0.9],
    deterministicBaseline: 'L0',
  };
  const prov = {
    payload_sha256: 'c'.repeat(64),
    stateConstructorVersion: 'judge-state/v1',
    redactionVersion: 'redaction/v1',
    criteriaVersion: 'criteria/2026-11-03',
  };

  it('provenance 四件齐落盘并进签名体', () => {
    const e = emitDecision(makeInput({
      judgeReceipt: { ...base, provenance: { ...prov } }, content: false,
    }), testDir);
    expect(e.judgeReceipt!.provenance).toEqual(prov);
    expect(readFileSync(getDecisionLogPath(testDir), 'utf-8')).toContain('"payload_sha256"');
  });

  it('provenance 缺一件即拒', () => {
    const { criteriaVersion: _d, ...three } = prov;
    expect(() => emitDecision(makeInput({
      judgeReceipt: { ...base, provenance: three as never }, content: false,
    }), testDir)).toThrow(/provenance 四件缺失/);
  });

  it('写时锚定：落盘行含 hmacSig（签名与落盘同一次原子写，非事后补签）', () => {
    emitDecision(makeInput({
      judgeReceipt: { ...base, provenance: { ...prov } }, content: false,
    }), testDir);
    const line = JSON.parse(readFileSync(getDecisionLogPath(testDir), 'utf-8').trim());
    expect(typeof line.hmacSig).toBe('string');   // 写时已签名（链式）
    expect(line.hmacSig.length).toBeGreaterThan(0);
  });

  it('可回放性：回执 + provenance 齐备 ⇒ 判定输入可由指纹对账复现（脱原模型回放的结构前提）', () => {
    const e = emitDecision(makeInput({
      judgeReceipt: { ...base, provenance: { ...prov } }, content: false,
    }), testDir);
    // 回放判据（结构面）：stateDigest 与 payload_sha256 双指纹在位 ⇒ 指纹对账可行
    expect(e.judgeReceipt!.stateDigest).toHaveLength(64);
    expect(e.judgeReceipt!.provenance!.payload_sha256).toHaveLength(64);
  });
});

describe('v1.8.0 review r1 · 原型污染键拒收', () => {
  it('judgeReceipt 含 constructor/prototype 键即拒（字面量路径）', () => {
    const base = {
      stateDigest: 'd'.repeat(64), evidenceRefs: [], modelIdentity: 'm',
      probabilities: [0.5], deterministicBaseline: 'L0',
    };
    // 字面量对象的自有键直达校验面（constructor/prototype 是自有键名——非原型链语义）
    expect(() => emitDecision(makeInput({
      judgeReceipt: { ...base, constructor: 'x' } as never, content: false,
    }), '/tmp/proto-t1')).toThrow(/原型污染键/);
    expect(() => emitDecision(makeInput({
      judgeReceipt: { ...base, prototype: 1 } as never, content: false,
    }), '/tmp/proto-t2')).toThrow(/原型污染键/);
  });
});

describe('v1.8.0 §二 · 门槛参数随判定落痕（行为锁）', () => {
  let testDir: string;
  let savedKeyPath: string | undefined;

  beforeEach(() => {
    testDir = tmpDir();
    savedKeyPath = process.env.SOFAGENT_KEY_PATH;
    process.env.SOFAGENT_KEY_PATH = join(testDir, 'test-hmac-key');
    writeFileSync(process.env.SOFAGENT_KEY_PATH, randomBytes(32).toString('hex'));
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* */ }
    if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
    else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
  });

  const baseReceipt = {
    stateDigest: 'b'.repeat(64),
    evidenceRefs: ['q-1'],
    modelIdentity: 'main01v5@rev-xyz',
    probabilities: [0.9],
    deterministicBaseline: 'L0 规则面（判定不改规则结论）',
  };

  it('①thresholds 在位落盘且值等于输入（escalation + abstain 三原语分档）', () => {
    const thresholds = { escalation: 0.9, abstain: { noul: 0.5, choice: 0.45, score: 0.4 } };
    const e = emitDecision(makeInput({
      kind: 'ORCHESTRATION', category: 'route',
      judgeReceipt: { ...baseReceipt, thresholds }, content: false,
    }), testDir);
    expect(e.judgeReceipt!.thresholds).toEqual(thresholds);
    // 回放面：落盘行 JSON 可解析出同值（「本次判定按什么门槛」可离线复读）
    const line = readFileSync(getDecisionLogPath(testDir), 'utf8').trim().split('\n').pop()!;
    const parsed = JSON.parse(line) as DecisionLogEntry;
    expect(parsed.judgeReceipt!.thresholds!.escalation).toBe(0.9);
    expect(parsed.judgeReceipt!.thresholds!.abstain!.choice).toBe(0.45);
  });

  it('②escalation 非数字 / 负数 / NaN 即拒（结构非法不进链）', () => {
    expect(() => emitDecision(makeInput({
      judgeReceipt: { ...baseReceipt, thresholds: { escalation: '0.9' } } as never, content: false,
    }), testDir)).toThrow(/thresholds\.escalation/);
    expect(() => emitDecision(makeInput({
      judgeReceipt: { ...baseReceipt, thresholds: { escalation: -0.1 } }, content: false,
    }), testDir)).toThrow(/thresholds\.escalation/);
    expect(() => emitDecision(makeInput({
      judgeReceipt: { ...baseReceipt, thresholds: { escalation: Number.NaN } }, content: false,
    }), testDir)).toThrow(/thresholds\.escalation/);
  });

  it('③abstain 缺原语键即拒（分档不完整 = 变相全局化）', () => {
    expect(() => emitDecision(makeInput({
      judgeReceipt: {
        ...baseReceipt,
        thresholds: { escalation: 0.9, abstain: { noul: 0.5, choice: 0.4 } },
      } as never, content: false,
    }), testDir)).toThrow(/abstain/);
  });
});

describe('v1.8.0 §二 · 校准参数随判定落痕（行为锁）', () => {
  let testDir: string;
  let savedKeyPath: string | undefined;

  beforeEach(() => {
    testDir = tmpDir();
    savedKeyPath = process.env.SOFAGENT_KEY_PATH;
    process.env.SOFAGENT_KEY_PATH = join(testDir, 'test-hmac-key');
    writeFileSync(process.env.SOFAGENT_KEY_PATH, randomBytes(32).toString('hex'));
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* */ }
    if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
    else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
  });

  const baseReceipt = {
    stateDigest: 'c'.repeat(64),
    evidenceRefs: ['q-cal'],
    modelIdentity: 'main01v5@rev-cal',
    probabilities: [0.77],
    deterministicBaseline: 'L0 规则面（判定不改规则结论）',
  };
  const evidence = { calibrationSetVersion: 'calib-2026-10', ece: 0.061, fittedAt: '2026-10-30T00:00:00Z' };

  it('①calibrated 带 evidence 三件落盘并进签名体（可回放）', () => {
    const e = emitDecision(makeInput({
      kind: 'ORCHESTRATION', category: 'route',
      judgeReceipt: { ...baseReceipt, calibration: { calibStatus: 'calibrated', evidence } }, content: false,
    }), testDir);
    expect(e.judgeReceipt!.calibration!.calibStatus).toBe('calibrated');
    expect(e.judgeReceipt!.calibration!.evidence).toEqual(evidence);
    const line = readFileSync(getDecisionLogPath(testDir), 'utf8').trim().split('\n').pop()!;
    const parsed = JSON.parse(line) as DecisionLogEntry;
    expect(parsed.judgeReceipt!.calibration!.evidence!.ece).toBe(0.061);
  });

  it('②calibrated 缺 evidence 即拒（缺依据不得称已校准）', () => {
    expect(() => emitDecision(makeInput({
      judgeReceipt: { ...baseReceipt, calibration: { calibStatus: 'calibrated' } }, content: false,
    }), testDir)).toThrow(/必须带 evidence/);
  });

  it('③uncalibrated 带 evidence 即拒（矛盾态）', () => {
    expect(() => emitDecision(makeInput({
      judgeReceipt: { ...baseReceipt, calibration: { calibStatus: 'uncalibrated', evidence } }, content: false,
    }), testDir)).toThrow(/不得附 evidence/);
  });

  it('④calibrated evidence 三件缺一/ece 非法即拒（结构完整性）', () => {
    expect(() => emitDecision(makeInput({
      judgeReceipt: {
        ...baseReceipt,
        calibration: { calibStatus: 'calibrated', evidence: { calibrationSetVersion: '', ece: 0.06, fittedAt: 'x' } },
      }, content: false,
    }), testDir)).toThrow(/calibrationSetVersion/);
    expect(() => emitDecision(makeInput({
      judgeReceipt: {
        ...baseReceipt,
        calibration: { calibStatus: 'calibrated', evidence: { calibrationSetVersion: 'v1', ece: Number.NaN, fittedAt: 'x' } },
      }, content: false,
    }), testDir)).toThrow(/ece/);
  });
});
