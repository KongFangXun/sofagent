// ============================================================
// egress-audit.test.ts · v1.5.2 章五 · 出站裁决 HMAC 挂链测试
// ============================================================
//
// 覆盖面：
//   1. 裁决事件落 decision-log.jsonl（与 G10 读取审计**同链**——验收 ②）
//   2. Allow / Deny 两态均落链，kind/moment/category 语义正确
//   3. HMAC 链完整（checkDecisionChainDetailed === 'ok'）+ 追加不破坏既有链
//   4. 裁决事件契约可导出（schema 稳定 · 构造器产出与契约一致——验收 ④）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes, createHash } from 'crypto';
import { getDecisionLogPath, getEnvFingerprint } from '@sofagent/core';
import {
  buildEgressDecisionEvent,
  exportEgressDecisionContract,
  recordEgressDecision,
  EGRESS_DECISION_CONTRACT_VERSION,
} from '../egress-audit';
import { checkDecisionChainDetailed } from '../decision-chain';
import type { DecisionLogEntry } from '../decision-schema';

function tmpDir(): string {
  const dir = join(tmpdir(), `sofagent-egress-audit-${Date.now()}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 一条放行裁决入参 */
function allowInput(): Parameters<typeof recordEgressDecision>[0] {
  return {
    subject: 'wf-42',
    request: { host: 'api.github.com', port: 443, protocol: 'https' },
    decision: {
      verdict: 'Allow',
      reason: 'allowed',
      message: '白名单放行：api.github.com 命中声明「api.github.com」',
      host: 'api.github.com',
      matchedRule: 'api.github.com',
    },
    agentId: 'eng-ch5',
    sessionId: 'sess-egress-1',
  };
}

/** 一条拒绝裁决入参 */
function denyInput(): Parameters<typeof recordEgressDecision>[0] {
  return {
    subject: 'wf-42',
    request: { host: 'exfil.example.com', port: 443, protocol: 'https' },
    decision: {
      verdict: 'Deny',
      reason: 'host-not-allowed',
      message: 'host 不在出站白名单内：exfil.example.com（声明 1 条）',
      host: 'exfil.example.com',
    },
    agentId: 'eng-ch5',
    sessionId: 'sess-egress-1',
  };
}

describe('recordEgressDecision（出站裁决进审计链）', () => {
  let testDir: string;
  let savedKeyPath: string | undefined;

  beforeEach(() => {
    testDir = tmpDir();
    // 用 SOFAGENT_KEY_PATH 指向临时密钥——绝不触碰真实 ~/.sofagent-key
    savedKeyPath = process.env.SOFAGENT_KEY_PATH;
    writeFileSync(join(testDir, 'test-hmac-key'), 'test-hmac-key-0123456789abcdef');
    process.env.SOFAGENT_KEY_PATH = join(testDir, 'test-hmac-key');
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      /* 清理失败不影响断言 */
    }
    if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
    else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
  });

  it('落盘到决策日志（data/audit/decision-log.jsonl——与 G10 读取审计同链同文件）', () => {
    recordEgressDecision(allowInput(), testDir);
    const filePath = getDecisionLogPath(testDir);
    expect(existsSync(filePath)).toBe(true);
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as DecisionLogEntry;
    expect(parsed.kind).toBe('TOOL_GATE');
    expect(parsed.moment).toBe('ACT');
    expect(parsed.category).toBe('select');
    expect(parsed.agentId).toBe('eng-ch5');
    expect(parsed.artifactRef).toBe('egress/wf-42/api.github.com');
    expect(parsed.why.text).toContain('出站裁决 Allow：api.github.com');
    expect(parsed.why.tags).toEqual(['egress', 'Allow', 'allowed']);
    expect(parsed.evidence).toContain('host=api.github.com');
    expect(parsed.evidence).toContain('port=443');
    expect(parsed.evidence).toContain('protocol=https');
    expect(parsed.evidence).toContain('matchedRule=api.github.com');
    expect(typeof parsed.hmacSig).toBe('string');
    expect(parsed.hashVersion).toBe(2);
  });

  it('Deny 裁决落链且 category=skip（拒绝语义显式化）', () => {
    const entry = recordEgressDecision(denyInput(), testDir);
    expect(entry.category).toBe('skip');
    expect(entry.why.text).toContain('出站裁决 Deny：exfil.example.com');
    expect(entry.evidence).toContain('reason=host-not-allowed');
    expect(entry.evidence).not.toContain('matchedRule=undefined');
  });

  it('两条裁决追加后 HMAC 链完整（ok）+ 逐条 prevHash 相扣（只追加不破坏链）', () => {
    recordEgressDecision(allowInput(), testDir);
    recordEgressDecision(denyInput(), testDir);

    // 从落盘行复算链公式（chain-kernel：sha256(去链字段记录 + '|' + 指纹) 前 16 hex）
    const lines = readFileSync(getDecisionLogPath(testDir), 'utf-8').trim().split('\n');
    const first = JSON.parse(lines[0]!) as DecisionLogEntry;
    const second = JSON.parse(lines[1]!) as DecisionLogEntry;
    expect(second.prevHash).not.toBe('genesis');
    expect(second.prevHash).toBe(computeExpectedPrevHash(first, testDir));

    const check = checkDecisionChainDetailed(testDir);
    expect(check.status).toBe('ok');
  });

  it('追加裁决不改写既有条目（留痕只追加）', () => {
    recordEgressDecision(allowInput(), testDir);
    const filePath = getDecisionLogPath(testDir);
    const before = readFileSync(filePath, 'utf-8').trim().split('\n');
    recordEgressDecision(denyInput(), testDir);
    const after = readFileSync(filePath, 'utf-8').trim().split('\n');
    expect(after).toHaveLength(2);
    expect(after[0]).toBe(before[0]);
  });
});

describe('裁决事件契约可导出（schema 稳定 · 消费方无需读源码）', () => {
  it('exportEgressDecisionContract 返回稳定 schema（版本 + required + 枚举）', () => {
    const contract = exportEgressDecisionContract();
    expect(contract.schemaVersion).toBe(EGRESS_DECISION_CONTRACT_VERSION);
    expect(contract.type).toBe('object');
    expect(contract.required).toContain('host');
    expect(contract.required).toContain('verdict');
    expect(contract.required).toContain('reason');
    expect(contract.properties.verdict!.enum).toEqual(['Allow', 'Deny']);
    // 可序列化（可被判定底座 / AI 节点消费）
    expect(() => JSON.stringify(contract)).not.toThrow();
  });

  it('buildEgressDecisionEvent 产出与契约一致（required 全在 + 类型相符）', () => {
    const contract = exportEgressDecisionContract();
    const event = buildEgressDecisionEvent(allowInput(), new Date('2026-09-23T00:00:00.000Z'));
    const eventRecord = event as unknown as Record<string, unknown>;
    for (const key of contract.required) {
      expect(eventRecord[key], `契约 required 字段缺失：${key}`).toBeDefined();
    }
    expect(event.schemaVersion).toBe('v1');
    expect(event.ts).toBe('2026-09-23T00:00:00.000Z');
    expect(event.verdict).toBe('Allow');
    expect(event.matchedRule).toBe('api.github.com');
    // 事件键集 ⊆ 契约 properties 键集（无契约外字段泄漏）
    for (const key of Object.keys(event)) {
      expect(Object.keys(contract.properties)).toContain(key);
    }
  });

  it('可选字段缺省时不落 undefined 键（契约干净）', () => {
    const event = buildEgressDecisionEvent({
      subject: 'node-7',
      request: { host: 'internal.corp' },
      decision: { verdict: 'Deny', reason: 'empty-policy', message: '白名单为空' },
    });
    expect('port' in event).toBe(false);
    expect('protocol' in event).toBe(false);
    expect('matchedRule' in event).toBe(false);
    expect(event.host).toBe('internal.corp');
    expect(event.agentId).toBe('egress-guard');
    expect(event.sessionId.startsWith('egress-node-7-')).toBe(true);
  });
});

/** 复算 chain-kernel 的 prevHash（sha256(去链字段记录 + '|' + 指纹) 前 16 hex） */
function computeExpectedPrevHash(entry: DecisionLogEntry, dataDir: string): string {
  const { prevHash: _prev, hashVersion: _hv, ...recordForHash } = entry;
  return createHash('sha256')
    .update(JSON.stringify(recordForHash) + '|' + getEnvFingerprint(dataDir))
    .digest('hex')
    .slice(0, 16);
}
