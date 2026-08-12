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
    expect(parsed.engine).toBe('sofagent-audit');
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
});

function chmodSyncRecursive(dir: string): void {
  try {
    const { chmodSync } = require('fs');
    chmodSync(dir, 0o700);
  } catch { /* */ }
}
