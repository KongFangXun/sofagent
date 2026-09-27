// ============================================================
// mandate-credential-reconcile.test.ts · v1.5.4 章七 · 授权面 × 凭证面对账单测
// ============================================================
//
// 覆盖面（逐条对 §九 验收标准 / 判据）：
//   1. 范围 / 时效 / 缺授权三类错位均可判定为越权风险
//   2. 错位进 decision-log 且挂 HMAC 链可举证
//   3. 两侧记录只读取用（对账不改 mandate / Vault 落盘 schema）
//   4. 对账面默认关（L1）⇒ 零判定零记录，行为与今日一致（无半开状态）
//   5. 下游读数边界：新 kind 计入决策统计、未被 isInvalidationMarker 误排除
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getDecisionLogPath } from '@sofagent/core';
import { issueMandate, reconcileCredentialScope, type MandateGrant } from '../mandate-store';
import {
  reconcileCredentialLedger,
  evaluateCredentialReconcile,
  type ReconcileFinding,
} from '../mandate-credential-reconcile';
import { isInvalidationMarker } from '../invalidation';
import { emitDecision } from '../decision-log';
import type { DecisionKind } from '../decision-schema';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'sofagent-reconcile-'));
}

/** 一张合法授权（范围含 sf_write + api.github.com） */
function seedMandate(dir: string): MandateGrant {
  return issueMandate(
    {
      id: 'mg-1',
      subject: 'agent-eng',
      scope: { tools: ['sf_write'], hosts: ['api.github.com'] },
      validity: { validFrom: '2026-09-01T00:00:00.000Z', validTo: '2026-12-31T00:00:00.000Z' },
      approver: 'alice@sec',
    },
    dir,
  );
}

function readDecisions(dir: string): Record<string, unknown>[] {
  const p = getDecisionLogPath(dir);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf-8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe('mandate-credential-reconcile · 台账级三类错位（纯判定）', () => {
  const mandate: MandateGrant = {
    id: 'mg-1',
    subject: 'agent-eng',
    scope: { tools: ['sf_write'], hosts: ['api.github.com'] },
    validity: { validFrom: '2026-09-01T00:00:00.000Z', validTo: '2026-12-31T00:00:00.000Z' },
    approver: 'alice@sec',
    issuedAt: '2026-09-01T00:00:00.000Z',
  };

  it('归属一致 · 范围 ⊆ · 时效在内 ⇒ aligned', () => {
    const f = evaluateCredentialReconcile(
      {
        mandateId: 'mg-1',
        scope: { tools: ['sf_write'] },
        issuedBy: 'vault',
        issuedAt: '2026-09-02T00:00:00.000Z',
        validity: { validFrom: '2026-10-01T00:00:00.000Z', validTo: '2026-11-01T00:00:00.000Z' },
      },
      [mandate],
    );
    expect(f.verdict).toBe('aligned');
  });

  it('范围超出授权 ⇒ mismatch(scope-exceeds)', () => {
    const f = evaluateCredentialReconcile(
      {
        mandateId: 'mg-1',
        scope: { tools: ['sf_write', 'sf_exec'] },
        issuedBy: 'vault',
        issuedAt: '2026-09-02T00:00:00.000Z',
      },
      [mandate],
    );
    expect(f.verdict).toBe('mismatch');
    expect(f.mismatch).toBe('scope-exceeds');
  });

  it('凭证时效 > 授权时效 ⇒ mismatch(validity-outlives)（两类：更早生效 / 更晚失效）', () => {
    const earlier = evaluateCredentialReconcile(
      {
        mandateId: 'mg-1',
        scope: { tools: ['sf_write'] },
        issuedBy: 'vault',
        issuedAt: '2026-09-02T00:00:00.000Z',
        validity: { validFrom: '2026-08-01T00:00:00.000Z', validTo: '2026-11-01T00:00:00.000Z' },
      },
      [mandate],
    );
    expect(earlier.mismatch).toBe('validity-outlives');

    const later = evaluateCredentialReconcile(
      {
        mandateId: 'mg-1',
        scope: { tools: ['sf_write'] },
        issuedBy: 'vault',
        issuedAt: '2026-09-02T00:00:00.000Z',
        validity: { validFrom: '2026-10-01T00:00:00.000Z', validTo: '2027-06-01T00:00:00.000Z' },
      },
      [mandate],
    );
    expect(later.mismatch).toBe('validity-outlives');

    // 授权设失效而凭证永不过期（undefined）——同样算超期
    const forever = evaluateCredentialReconcile(
      {
        mandateId: 'mg-1',
        scope: { tools: ['sf_write'] },
        issuedBy: 'vault',
        issuedAt: '2026-09-02T00:00:00.000Z',
        validity: { validFrom: '2026-10-01T00:00:00.000Z' },
      },
      [mandate],
    );
    expect(forever.mismatch).toBe('validity-outlives');
  });

  it('无对应授权记录 ⇒ mismatch(no-mandate-record)', () => {
    const f = evaluateCredentialReconcile(
      {
        mandateId: 'mg-nonexistent',
        scope: { tools: ['sf_write'] },
        issuedBy: 'vault',
        issuedAt: '2026-09-02T00:00:00.000Z',
      },
      [mandate],
    );
    expect(f.mismatch).toBe('no-mandate-record');
  });

  it('🔴 P2：非法日期不得与「无值」同判 ⇒ mismatch(validity-outlives)，不静默放行', () => {
    // 凭证 validFrom 不可解析（有值却非法）——原实现静默 return null 按「不判时效」放行
    const badFrom = evaluateCredentialReconcile(
      {
        mandateId: 'mg-1',
        scope: { tools: ['sf_write'] },
        issuedBy: 'vault',
        issuedAt: '2026-09-02T00:00:00.000Z',
        validity: { validFrom: 'n/a', validTo: '2026-11-01T00:00:00.000Z' },
      },
      [mandate],
    );
    expect(badFrom.verdict).toBe('mismatch');
    expect(badFrom.mismatch).toBe('validity-outlives');
    expect(badFrom.reason).toContain('不可解析');

    // 授权 validFrom 不可解析（另一侧）——同样判错位，不静默放行
    const badMandate: MandateGrant = {
      ...mandate,
      validity: { validFrom: 'not-a-date', validTo: '2026-12-31T00:00:00.000Z' },
    };
    const badMandateHit = evaluateCredentialReconcile(
      {
        mandateId: 'mg-1',
        scope: { tools: ['sf_write'] },
        issuedBy: 'vault',
        issuedAt: '2026-09-02T00:00:00.000Z',
        validity: { validFrom: '2026-10-01T00:00:00.000Z', validTo: '2026-11-01T00:00:00.000Z' },
      },
      [badMandate],
    );
    expect(badMandateHit.mismatch).toBe('validity-outlives');
  });

  it('🔵 P2 反向：合法日期范围内仍 aligned；validTo 缺省（永久）= 有值语义仍为永久', () => {
    // 合法且在范围内 ⇒ aligned（不回退既有语义）
    const ok = evaluateCredentialReconcile(
      {
        mandateId: 'mg-1',
        scope: { tools: ['sf_write'] },
        issuedBy: 'vault',
        issuedAt: '2026-09-02T00:00:00.000Z',
        validity: { validFrom: '2026-10-01T00:00:00.000Z', validTo: '2026-11-01T00:00:00.000Z' },
      },
      [mandate],
    );
    expect(ok.verdict).toBe('aligned');
    // validTo 缺省 = 永久（非非法日期）：不因「有值却不可解析」而误判
    const forever = evaluateCredentialReconcile(
      {
        mandateId: 'mg-1',
        scope: { tools: ['sf_write'] },
        issuedBy: 'vault',
        issuedAt: '2026-09-02T00:00:00.000Z',
        validity: { validFrom: '2026-10-01T00:00:00.000Z' },
      },
      [{ ...mandate, validity: { validFrom: '2026-09-01T00:00:00.000Z' } }],
    );
    expect(forever.verdict).toBe('aligned');
  });
});

describe('mandate-credential-reconcile · 台账级对账 + 挂链 + 开关', () => {
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

  it('关闭（默认 L1）⇒ 零判定零记录，行为与今日一致（无半开状态）', () => {
    seedMandate(testDir);
    const report = reconcileCredentialLedger(
      [{ mandateId: 'mg-1', scope: { tools: ['sf_exec'] }, issuedBy: 'vault', issuedAt: '2026-09-02T00:00:00.000Z' }],
      { dataDir: testDir }, // enabled 缺省 = 关
    );
    expect(report.enabled).toBe(false);
    expect(report.findings).toHaveLength(0);
    expect(report.mismatches).toBe(0);
    // 零记录
    expect(existsSync(getDecisionLogPath(testDir))).toBe(false);
  });

  it('开启 ⇒ 三类错位 + 一致结论均进 decision-log 挂链（kind=CREDENTIAL_RECONCILE）', () => {
    seedMandate(testDir);
    const declarations = [
      { mandateId: 'mg-1', scope: { tools: ['sf_write'] }, issuedBy: 'vault', issuedAt: '2026-09-02T00:00:00.000Z' }, // aligned
      { mandateId: 'mg-1', scope: { tools: ['sf_write', 'sf_exec'] }, issuedBy: 'vault', issuedAt: '2026-09-02T00:00:00.000Z' }, // scope-exceeds
      {
        mandateId: 'mg-1',
        scope: { tools: ['sf_write'] },
        issuedBy: 'vault',
        issuedAt: '2026-09-02T00:00:00.000Z',
        validity: { validFrom: '2026-09-01T00:00:00.000Z', validTo: '2027-06-01T00:00:00.000Z' },
      }, // validity-outlives
      { mandateId: 'mg-missing', scope: { tools: ['sf_write'] }, issuedBy: 'vault', issuedAt: '2026-09-02T00:00:00.000Z' }, // no-mandate-record
    ];
    const report = reconcileCredentialLedger(declarations, { enabled: true, dataDir: testDir });
    expect(report.enabled).toBe(true);
    expect(report.findings.map((f: ReconcileFinding) => f.verdict)).toEqual([
      'aligned',
      'mismatch',
      'mismatch',
      'mismatch',
    ]);
    expect(report.mismatches).toBe(3);

    const decisions = readDecisions(testDir);
    expect(decisions).toHaveLength(4);
    for (const d of decisions) {
      expect(d.kind).toBe('CREDENTIAL_RECONCILE');
      // 挂 HMAC 链（可举证）
      expect(typeof d.hmacSig).toBe('string');
      expect(typeof d.prevHash).toBe('string');
    }
    // 三类错位分类可区分
    const mism = report.findings.filter((f) => f.mismatch).map((f) => f.mismatch);
    expect(mism).toEqual(['scope-exceeds', 'validity-outlives', 'no-mandate-record']);
  });

  it('两侧记录只读取用——对账不改 mandate 落盘（逐字不变）', () => {
    seedMandate(testDir);
    const mandatePath = join(testDir, 'audit', 'mandate-log.jsonl');
    const before = readFileSync(mandatePath, 'utf-8');
    reconcileCredentialLedger(
      [{ mandateId: 'mg-1', scope: { tools: ['sf_write', 'sf_exec'] }, issuedBy: 'vault', issuedAt: '2026-09-02T00:00:00.000Z' }],
      { enabled: true, dataDir: testDir },
    );
    expect(readFileSync(mandatePath, 'utf-8')).toBe(before);
  });

  it('下游读数边界：CREDENTIAL_RECONCILE 是决策（非失效标记），不被 isInvalidationMarker 误排除', () => {
    seedMandate(testDir);
    reconcileCredentialLedger(
      [{ mandateId: 'mg-1', scope: { tools: ['sf_write'] }, issuedBy: 'vault', issuedAt: '2026-09-02T00:00:00.000Z' }],
      { enabled: true, dataDir: testDir },
    );
    const decisions = readDecisions(testDir);
    expect(decisions).toHaveLength(1);
    expect(isInvalidationMarker(decisions[0] as Parameters<typeof isInvalidationMarker>[0])).toBe(false);
  });

  it('既有 reconcileCredentialScope 三条断言语义保持不变（复用未重写）', () => {
    const grant: MandateGrant = {
      id: 'mg-1',
      subject: 'agent-eng',
      scope: { tools: ['sf_write'], hosts: ['api.github.com'] },
      validity: { validFrom: '2026-09-01T00:00:00.000Z' },
      approver: 'alice@sec',
      issuedAt: '2026-09-01T00:00:00.000Z',
    };
    expect(reconcileCredentialScope(grant, { mandateId: 'mg-1', scope: { tools: ['sf_write'] }, issuedBy: 'vault', issuedAt: 'x' }).aligned).toBe(true);
    expect(reconcileCredentialScope(grant, { mandateId: 'mg-1', scope: { tools: ['sf_write', 'sf_exec'] }, issuedBy: 'vault', issuedAt: 'x' }).aligned).toBe(false);
    expect(reconcileCredentialScope(grant, { mandateId: 'mg-other', scope: { tools: ['sf_write'] }, issuedBy: 'vault', issuedAt: 'x' }).aligned).toBe(false);
  });

  it('新 kind 已在 VALID_KINDS 注册（写入不抛 / 非法 kind 抛）', () => {
    // 合法：不抛（证明 CREDENTIAL_RECONCILE 在白名单内）
    expect(() =>
      emitDecision(
        { agentId: 'a', sessionId: 's', kind: 'CREDENTIAL_RECONCILE', moment: 'ATTRIBUTION', why: 'probe' },
        testDir,
      ),
    ).not.toThrow();
    // 非法 kind：抛（白名单仍生效）
    expect(() =>
      emitDecision(
        { agentId: 'a', sessionId: 's', kind: 'NOT_A_KIND' as DecisionKind, moment: 'ATTRIBUTION', why: 'probe' },
        testDir,
      ),
    ).toThrow();
  });
});
