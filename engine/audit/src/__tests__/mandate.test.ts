// ============================================================
// mandate.test.ts · v1.5.2 章七 · 事前授权补环（mandate）台账测试
// ============================================================
//
// 覆盖面（逐条对 §七 验收标准）：
//   1. 授权三元素（范围 / 时效 / 审批人）**缺一不受理**（三种缺法各一例 + 不落盘）
//   2. 越范围 / 超时效 / 无授权 ⇒ 判定拒绝（纯函数 evaluateCoverage）
//   3. 授权台账落 HMAC 链（与 decision-log 同级但**独立文件**、且与 decision-log 同悬链内核）
//   4. 凭证范围对账接口留出（本版无真实消费方——只验纯函数契约，如实说明）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes, createHash } from 'crypto';
import { getDecisionLogPath, getEnvFingerprint } from '@sofagent/core';
import {
  issueMandate,
  loadMandateGrants,
  getMandateById,
  getMandatesBySubject,
  evaluateCoverage,
  evaluateMandateRequest,
  isMandateExpired,
  hasAllThreeElements,
  reconcileCredentialScope,
  resolveMandateLogPath,
  MandateSchemaError,
  MANDATE_GRANT_KIND,
  type MandateGrant,
  type MandateGrantInput,
} from '../mandate-store';

function tmpDir(): string {
  const dir = join(tmpdir(), `sofagent-mandate-${Date.now()}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** 一张合法的三元素齐全授权入参 */
function validGrantInput(overrides: Partial<MandateGrantInput> = {}): MandateGrantInput {
  return {
    id: 'mg-1',
    subject: 'agent-eng',
    scope: { tools: ['sf_write', 'sf_edit'], pathPrefixes: ['src/'] },
    validity: { validFrom: '2026-09-01T00:00:00.000Z', validTo: '2026-12-31T00:00:00.000Z' },
    approver: 'alice@sec',
    ...overrides,
  };
}

describe('mandate-store · 授权三元素（缺一不受理）', () => {
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
      /* 清理失败不影响断言 */
    }
    if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
    else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
  });

  it('缺「范围」⇒ 拒绝受理且不落盘', () => {
    expect(() =>
      issueMandate(validGrantInput({ scope: {} }), testDir),
    ).toThrow(MandateSchemaError);
    // 范围维度全空（有对象但无任何非空维度）同样视为缺范围
    expect(() =>
      issueMandate(validGrantInput({ id: 'mg-empty', scope: { tools: [], pathPrefixes: [] } }), testDir),
    ).toThrow(MandateSchemaError);
    expect(existsSync(resolveMandateLogPath(testDir))).toBe(false);
  });

  it('缺「时效」⇒ 拒绝受理且不落盘', () => {
    // @ts-expect-error 故意构造缺时效
    expect(() => issueMandate(validGrantInput({ validity: undefined }), testDir)).toThrow(MandateSchemaError);
    expect(() =>
      issueMandate(validGrantInput({ id: 'mg-2', validity: { validFrom: '' } }), testDir),
    ).toThrow(MandateSchemaError);
    expect(existsSync(resolveMandateLogPath(testDir))).toBe(false);
  });

  it('缺「审批人」⇒ 拒绝受理且不落盘', () => {
    expect(() => issueMandate(validGrantInput({ approver: '   ' }), testDir)).toThrow(MandateSchemaError);
    // @ts-expect-error 故意构造缺审批人
    expect(() => issueMandate(validGrantInput({ id: 'mg-3', approver: undefined }), testDir)).toThrow(
      MandateSchemaError,
    );
    expect(existsSync(resolveMandateLogPath(testDir))).toBe(false);
  });

  it('三元素齐全 ⇒ 签发成功并落盘', () => {
    const grant = issueMandate(validGrantInput(), testDir);
    expect(grant.id).toBe('mg-1');
    expect(grant.approver).toBe('alice@sec');
    expect(hasAllThreeElements(grant)).toBe(true);
    const loaded = loadMandateGrants(testDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.id).toBe('mg-1');
  });

  it('按 id / 主体查询', () => {
    issueMandate(validGrantInput({ id: 'mg-a' }), testDir);
    issueMandate(validGrantInput({ id: 'mg-b' }), testDir);
    issueMandate(validGrantInput({ id: 'mg-c', subject: 'agent-rev' }), testDir);

    expect(getMandateById('mg-b', testDir)?.id).toBe('mg-b');
    expect(getMandateById('nope', testDir)).toBeUndefined();
    expect(getMandatesBySubject('agent-eng', testDir).map((g) => g.id)).toEqual(['mg-a', 'mg-b']);
    expect(getMandatesBySubject('agent-rev', testDir).map((g) => g.id)).toEqual(['mg-c']);
  });
});

describe('mandate-store · 越界判定（纯函数）', () => {
  const now = new Date('2026-10-01T00:00:00.000Z');
  const grant: MandateGrant = {
    id: 'mg-1',
    subject: 'agent-eng',
    scope: { tools: ['sf_write', 'sf_edit'], pathPrefixes: ['src/'] },
    validity: { validFrom: '2026-09-01T00:00:00.000Z', validTo: '2026-12-31T00:00:00.000Z' },
    approver: 'alice@sec',
    issuedAt: '2026-09-01T00:00:00.000Z',
  };

  it('无授权 ⇒ no-mandate（不覆盖）', () => {
    const evalr = evaluateCoverage([], { subject: 'agent-eng', action: 'sf_write' }, now);
    expect(evalr.verdict).toBe('no-mandate');
    expect(evalr.covered).toBe(false);
  });

  it('范围内 ⇒ covered（可追溯审批人）', () => {
    const evalr = evaluateCoverage(
      [grant],
      { subject: 'agent-eng', action: 'sf_write', target: { path: 'src/a.ts' } },
      now,
    );
    expect(evalr.verdict).toBe('covered');
    expect(evalr.covered).toBe(true);
    expect(evalr.grantId).toBe('mg-1');
    expect(evalr.approver).toBe('alice@sec');
  });

  it('越范围（工具未授权）⇒ out-of-scope', () => {
    const evalr = evaluateCoverage([grant], { subject: 'agent-eng', action: 'sf_exec' }, now);
    expect(evalr.verdict).toBe('out-of-scope');
    expect(evalr.covered).toBe(false);
  });

  it('越范围（路径超白名单）⇒ out-of-scope', () => {
    const evalr = evaluateCoverage(
      [grant],
      { subject: 'agent-eng', action: 'sf_write', target: { path: 'docs/a.md' } },
      now,
    );
    expect(evalr.verdict).toBe('out-of-scope');
  });

  it('超时效 ⇒ expired', () => {
    const expired = { ...grant, validity: { validFrom: '2026-01-01T00:00:00.000Z', validTo: '2026-02-01T00:00:00.000Z' } };
    expect(isMandateExpired(expired, now)).toBe(true);
    const evalr = evaluateCoverage(
      [expired],
      { subject: 'agent-eng', action: 'sf_write', target: { path: 'src/a.ts' } },
      now,
    );
    expect(evalr.verdict).toBe('expired');
    expect(evalr.covered).toBe(false);
  });

  it('未生效（now < validFrom）⇒ expired（时效为硬门）', () => {
    const future = { ...grant, validity: { validFrom: '2027-01-01T00:00:00.000Z' } };
    expect(isMandateExpired(future, now)).toBe(true);
  });

  it('主体所持授权三元素残缺 ⇒ invalid-grant（校验时缺一不受理）', () => {
    const broken: MandateGrant = { ...grant, approver: '' };
    const evalr = evaluateCoverage([broken], { subject: 'agent-eng', action: 'sf_write' }, now);
    expect(evalr.verdict).toBe('invalid-grant');
    expect(evalr.covered).toBe(false);
  });

  it('evaluateMandateRequest（读台账版）与纯函数一致', () => {
    const testDir = tmpDir();
    const savedKeyPath = process.env.SOFAGENT_KEY_PATH;
    try {
      writeFileSync(join(testDir, 'k'), 'test-hmac-key-0123456789abcdef');
      process.env.SOFAGENT_KEY_PATH = join(testDir, 'k');
      issueMandate(
        validGrantInput({
          id: 'mg-x',
          validity: { validFrom: '2026-09-01T00:00:00.000Z', validTo: '2026-12-31T00:00:00.000Z' },
        }),
        testDir,
      );
      const covered = evaluateMandateRequest(
        { subject: 'agent-eng', action: 'sf_write', target: { path: 'src/a.ts' } },
        now,
        testDir,
      );
      expect(covered.verdict).toBe('covered');
      const denied = evaluateMandateRequest({ subject: 'agent-eng', action: 'sf_exec' }, now, testDir);
      expect(denied.verdict).toBe('out-of-scope');
    } finally {
      rmSync(testDir, { recursive: true, force: true });
      if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
      else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
    }
  });
});

describe('mandate-store · 授权台账 HMAC 链（可举证 · 独立于 decision-log）', () => {
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

  it('授权台账落独立文件（不污染 decision-log 主链）', () => {
    issueMandate(validGrantInput(), testDir);
    expect(existsSync(resolveMandateLogPath(testDir))).toBe(true);
    expect(resolveMandateLogPath(testDir)).not.toBe(getDecisionLogPath(testDir));
    // decision-log 未被触碰（授权台账不写决策链——语义不同，见文件头）
    expect(existsSync(getDecisionLogPath(testDir))).toBe(false);
  });

  it('逐条 HMAC 签名（hmacSig 在场）+ prevHash 相扣（只追加不破坏链）', () => {
    issueMandate(validGrantInput({ id: 'mg-1' }), testDir);
    issueMandate(validGrantInput({ id: 'mg-2' }), testDir);

    const lines = readFileSync(resolveMandateLogPath(testDir), 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]!) as Record<string, unknown>;
    const second = JSON.parse(lines[1]!) as Record<string, unknown>;

    expect(first.kind).toBe(MANDATE_GRANT_KIND);
    expect(typeof first.hmacSig).toBe('string');
    expect((first.hmacSig as string).length).toBe(32);
    expect(first.hashVersion).toBe(2);
    expect(second.prevHash).not.toBe('genesis');
    expect(second.prevHash).toBe(computeExpectedPrevHash(first, testDir));
  });

  it('只追加不改写（追加第二条不改动第一条字节）', () => {
    issueMandate(validGrantInput({ id: 'mg-1' }), testDir);
    const before = readFileSync(resolveMandateLogPath(testDir), 'utf-8').trim().split('\n');
    issueMandate(validGrantInput({ id: 'mg-2' }), testDir);
    const after = readFileSync(resolveMandateLogPath(testDir), 'utf-8').trim().split('\n');
    expect(after).toHaveLength(2);
    expect(after[0]).toBe(before[0]);
  });
});

describe('mandate-store · 凭证范围对账接口（留出——本版无真实消费方）', () => {
  const grant: MandateGrant = {
    id: 'mg-1',
    subject: 'agent-eng',
    scope: { tools: ['sf_write'], hosts: ['api.github.com'] },
    validity: { validFrom: '2026-09-01T00:00:00.000Z' },
    approver: 'alice@sec',
    issuedAt: '2026-09-01T00:00:00.000Z',
  };

  it('归属一致且范围 ⊆ 授权 ⇒ 对账通过', () => {
    const r = reconcileCredentialScope(grant, {
      mandateId: 'mg-1',
      scope: { tools: ['sf_write'] },
      issuedBy: 'vault',
      issuedAt: '2026-09-02T00:00:00.000Z',
    });
    expect(r.aligned).toBe(true);
  });

  it('凭证范围超出授权 ⇒ 对账不通过（可举证原因）', () => {
    const r = reconcileCredentialScope(grant, {
      mandateId: 'mg-1',
      scope: { tools: ['sf_write', 'sf_exec'] },
      issuedBy: 'vault',
      issuedAt: '2026-09-02T00:00:00.000Z',
    });
    expect(r.aligned).toBe(false);
    expect(r.reason).toContain('超出授权范围');
  });

  it('归属授权不符 ⇒ 对账不通过', () => {
    const r = reconcileCredentialScope(grant, {
      mandateId: 'mg-other',
      scope: { tools: ['sf_write'] },
      issuedBy: 'vault',
      issuedAt: '2026-09-02T00:00:00.000Z',
    });
    expect(r.aligned).toBe(false);
    expect(r.reason).toContain('归属授权');
  });
});

/** 复算 chain-kernel 的 prevHash（sha256(去 prevHash/hashVersion 记录 + '|' + 指纹) 前 16 hex） */
function computeExpectedPrevHash(entry: Record<string, unknown>, dataDir: string): string {
  const { prevHash: _prev, hashVersion: _hv, ...recordForHash } = entry;
  return createHash('sha256')
    .update(JSON.stringify(recordForHash) + '|' + getEnvFingerprint(dataDir))
    .digest('hex')
    .slice(0, 16);
}
