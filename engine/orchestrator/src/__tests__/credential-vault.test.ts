// ============================================================
// credential-vault.test.ts · v1.5.4 章三 · 凭证隔离 Vault 单测
// ============================================================
//
// 覆盖面（逐条对 §五 验收标准）：
//   1. 凭证不出 Vault——Agent 代码 / 审计事件零明文（沙箱 HTTP 出口动态注入请求头）
//   2. 轮换（定时 / 事件）+ 单凭证吊销（泄露响应）
//   3. 范围声明三件（申请范围 + 实际签发范围 + 比对结果）——挂链经 ch7 对账（默认关零记录）
//   4. 设计约束：控制面只认数据面事实（身份 / 能力两职拆开；吊销后不再注入）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getDecisionLogPath } from '@sofagent/core';
import {
  createCredentialVault,
  CredentialVaultError,
  type CredentialStoreInput,
} from '../vault/credential-vault';
import { createCredentialRotator } from '../vault/credential-rotation';
import {
  compareRequestedIssued,
  produceScopeDeclaration,
  declareAndReconcile,
} from '../vault/scope-declaration';
import { wrapTools } from '../harness-sdk';
import type { ExecutableTool } from '../tools';

const VK = 'vk-' + 'a'.repeat(32);
// 合成假密钥：拆串拼接（避免以连续 sk- 明文形态入库——对齐既有测试对 A2 密钥规则的口径）
const SECRET = ['sk-REALSECRET-', 'abcdef0123456789'].join('');

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'sofagent-vault-'));
}

function baseCredential(overrides: Partial<CredentialStoreInput> = {}): CredentialStoreInput {
  return {
    id: 'cred-1',
    virtualKey: VK,
    secret: SECRET,
    mandateId: 'mg-1',
    scope: { tools: ['sf_write'], hosts: ['api.example.com'] },
    inject: { header: 'Authorization', scheme: 'Bearer' },
    issuedBy: 'vault',
    issuedAt: '2026-09-02T00:00:00.000Z',
    ...overrides,
  };
}

/** 造一个网络类工具（func 记录实际收到的入参） */
function netTool(seen: Record<string, unknown>[]): ExecutableTool {
  return {
    name: 'http_fetch',
    description: 'fetch a url',
    schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    func: (input: Record<string, unknown>): string => {
      seen.push(input);
      return 'ok';
    },
  };
}

describe('credential-vault · 托管与脱敏（代码层取不到 token）', () => {
  it('登记成功；脱敏视图零明文 secret', () => {
    const vault = createCredentialVault();
    const view = vault.store(baseCredential());
    expect(view.id).toBe('cred-1');
    expect(view.status).toBe('active');
    expect(view.mandateId).toBe('mg-1');
    // 脱敏视图 / 快照一律零明文
    expect(JSON.stringify(view)).not.toContain(SECRET);
    expect(JSON.stringify(vault.snapshot())).not.toContain(SECRET);
    // 虚拟 key 掩码（前 6 位 + ***）
    expect(view.virtualKeyMasked).toBe('vk-aaa***');
    expect(view.virtualKeyMasked).not.toContain(VK);
  });

  it('id 重复 / virtualKey 重复 / secret 缺失 ⇒ 拒绝登记', () => {
    const vault = createCredentialVault();
    vault.store(baseCredential());
    expect(() => vault.store(baseCredential())).toThrow(CredentialVaultError);
    expect(() => vault.store(baseCredential({ id: 'cred-2' }))).toThrow(CredentialVaultError);
    expect(() => vault.store(baseCredential({ id: 'cred-3', virtualKey: 'vk-' + 'b'.repeat(32), secret: '' }))).toThrow(
      CredentialVaultError,
    );
  });

  it('redact 工具把 secret 明文与虚拟 key 一律打码', () => {
    const vault = createCredentialVault();
    vault.store(baseCredential());
    const redacted = vault.redact(`leaked=${SECRET} key=${VK} done`);
    expect(redacted).not.toContain(SECRET);
    expect(redacted).not.toContain(VK);
    expect(redacted).toContain('[REDACTED]');
  });

  it('注入器把凭证写入**出站副本**；Agent 原入参不变', () => {
    const vault = createCredentialVault();
    vault.store(baseCredential());
    const req: Record<string, unknown> = { url: 'https://api.example.com/x', headers: { 'x-trace': 't1' } };
    const original = JSON.parse(JSON.stringify(req));
    const out = vault.createInjector()({ toolName: 'http_fetch', input: req, virtualKey: VK });
    expect(out.injected).toBe(true);
    expect(out.credentialId).toBe('cred-1');
    expect(out.mandateId).toBe('mg-1');
    const headers = out.input.headers as Record<string, unknown>;
    expect(headers.Authorization).toBe(`Bearer ${SECRET}`);
    expect(headers['x-trace']).toBe('t1');
    // 原入参对象逐字不变（Agent 代码碰不到 token）
    expect(req).toEqual(original);
    expect(JSON.stringify(req)).not.toContain(SECRET);
  });

  it('无虚拟 key / 未登记 / 已吊销 ⇒ 不注入（可观测理由，不静默）', () => {
    const vault = createCredentialVault();
    vault.store(baseCredential());
    const inject = vault.createInjector();
    expect(inject({ toolName: 'http_fetch', input: {}, virtualKey: undefined }).injected).toBe(false);
    expect(inject({ toolName: 'http_fetch', input: {}, virtualKey: 'vk-' + 'c'.repeat(32) }).injected).toBe(false);
    vault.revoke('cred-1');
    const afterRevoke = inject({ toolName: 'http_fetch', input: {}, virtualKey: VK });
    expect(afterRevoke.injected).toBe(false);
    expect(afterRevoke.reason).toContain('吊销');
  });
});

describe('credential-vault · 轮换与吊销（泄露响应）', () => {
  it('轮换替换 secret（注入器改用新值）；吊销后不再注入', () => {
    const vault = createCredentialVault();
    vault.store(baseCredential());
    const newSecret = ['sk-NEW', 'SECRET'].join('');
    const view = vault.rotate('cred-1', newSecret);
    expect(view?.rotatedAt).toBeDefined();
    const out = vault.createInjector()({ toolName: 'http_fetch', input: {}, virtualKey: VK });
    expect((out.input.headers as Record<string, unknown>).Authorization).toBe(`Bearer ${newSecret}`);
    expect(vault.revoke('cred-1')).toBe(true);
    expect(vault.isActive('cred-1')).toBe(false);
    // 未命中吊销不抛（防泄露响应路径被异常打断）
    expect(vault.revoke('cred-nope')).toBe(false);
  });

  it('定时轮换判定只读数据面（status / rotatedAt / issuedAt）', () => {
    const vault = createCredentialVault();
    vault.store(baseCredential({ issuedAt: '2026-09-02T00:00:00.000Z' }));
    const rotator = createCredentialRotator(vault, { policy: { maxAgeMs: 1000 } });
    // now 远晚于 issuedAt ⇒ 到期
    const due = rotator.dueForRotation(new Date('2026-09-02T00:01:00.000Z'));
    expect(due.map((v) => v.id)).toEqual(['cred-1']);
    // now 早于 issuedAt ⇒ 未到期
    expect(rotator.dueForRotation(new Date('2026-09-01T23:59:00.000Z'))).toHaveLength(0);
  });

  it('批量轮换：产出为空则跳过（不静默轮换成空值）', () => {
    const vault = createCredentialVault();
    vault.store(baseCredential({ id: 'c1', virtualKey: 'vk-' + '1'.repeat(32), issuedAt: '2026-01-01T00:00:00.000Z' }));
    vault.store(baseCredential({ id: 'c2', virtualKey: 'vk-' + '2'.repeat(32), issuedAt: '2026-01-01T00:00:00.000Z' }));
    const rotator = createCredentialRotator(vault, { policy: { maxAgeMs: 1 } });
    const outcome = rotator.rotateDue((v) => (v.id === 'c1' ? ['sk-new-', 'c1'].join('') : ''), new Date('2026-06-01T00:00:00.000Z'));
    expect(outcome.rotated).toEqual(['c1']);
    expect(outcome.skipped).toEqual(['c2']);
  });

  it('泄露响应：吊销并留痕（可举证谁在何时吊销了哪条）', () => {
    const vault = createCredentialVault();
    vault.store(baseCredential());
    const rotator = createCredentialRotator(vault, { policy: { maxAgeMs: 1000 }, now: () => new Date('2026-09-03T00:00:00.000Z') });
    const record = rotator.reportLeak(VK, '检测到泄漏');
    expect(record.revoked).toBe(true);
    expect(record.credentialId).toBe('cred-1');
    expect(record.mandateId).toBe('mg-1');
    expect(record.ts).toBe('2026-09-03T00:00:00.000Z');
    expect(vault.isActive('cred-1')).toBe(false);
  });
});

describe('credential-vault · 范围声明（申请 + 签发 + 比对）', () => {
  it('compareRequestedIssued：签发 ⊆ 申请 = 最小授权；签发超出申请 = 非最小授权', () => {
    const ok = compareRequestedIssued({ tools: ['a', 'b'] }, { tools: ['a'] });
    expect(ok.consistent).toBe(true);
    const over = compareRequestedIssued({ tools: ['a'] }, { tools: ['a', 'b'], hosts: ['api.x'] });
    expect(over.consistent).toBe(false);
    expect(over.overIssued.map((o) => o.dim).sort()).toEqual(['hosts', 'tools']);
  });

  it('produceScopeDeclaration 产出三件（申请 / 签发 / 比对）+ 声明（含归属与时效）', () => {
    const vault = createCredentialVault();
    vault.store(
      baseCredential({
        scope: { tools: ['sf_write', 'sf_exec'], hosts: ['api.example.com'] },
        validity: { validFrom: '2026-09-02T00:00:00.000Z', validTo: '2026-12-31T00:00:00.000Z' },
      }),
    );
    const produced = produceScopeDeclaration(vault, VK, { requested: { tools: ['sf_write'] } });
    expect(produced).toBeDefined();
    expect(produced!.requested).toEqual({ tools: ['sf_write'] });
    expect(produced!.issued).toEqual({ tools: ['sf_write', 'sf_exec'], hosts: ['api.example.com'] });
    expect(produced!.comparison.consistent).toBe(false); // 签发超出申请
    expect(produced!.declaration.mandateId).toBe('mg-1');
    expect(produced!.declaration.scope).toEqual(produced!.issued);
    expect(produced!.declaration.validity?.validTo).toBe('2026-12-31T00:00:00.000Z');
    // 未登记凭证 ⇒ undefined
    expect(produceScopeDeclaration(vault, 'nope', { requested: {} })).toBeUndefined();
  });
});

describe('credential-vault · 沙箱 HTTP 出口接线（端到端）', () => {
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

  it('出站前动态注入凭证；工具收到真值，Agent 原入参 + 审计事件零明文', () => {
    const vault = createCredentialVault();
    vault.store(baseCredential());
    const seen: Record<string, unknown>[] = [];
    const events: { args: Record<string, unknown> }[] = [];
    const wrapped = wrapTools([netTool(seen)], {
      sandbox: true,
      dataDir: testDir,
      sandboxAllowHosts: ['api.example.com'],
      credentialVault: vault,
      credentialVirtualKey: VK,
      onToolCall: (e) => events.push({ args: e.args }),
    });
    const agentInput: Record<string, unknown> = { url: 'https://api.example.com/x' };
    const agentInputCopy = JSON.parse(JSON.stringify(agentInput));

    wrapped[0]!.func(agentInput);

    // 工具（出站 transport 面）收到真值凭证
    expect((seen[0]!.headers as Record<string, unknown>).Authorization).toBe(`Bearer ${SECRET}`);
    // Agent 原入参逐字不变——代码层拿不到 token
    expect(agentInput).toEqual(agentInputCopy);
    expect(JSON.stringify(agentInput)).not.toContain(SECRET);
    // 审计事件（Agent / 日志 / 审计面）零明文
    expect(JSON.stringify(events[0])).not.toContain(SECRET);
  });

  it('未接线 Vault ⇒ 行为与今日一致（不注入）', () => {
    const seen: Record<string, unknown>[] = [];
    const wrapped = wrapTools([netTool(seen)], {
      sandbox: true,
      dataDir: testDir,
      sandboxAllowHosts: ['api.example.com'],
    });
    wrapped[0]!.func({ url: 'https://api.example.com/x' });
    expect(seen[0]!.headers).toBeUndefined();
  });

  it('declareAndReconcile：对账面默认关（L1）⇒ 零判定零记录（不留半开）', () => {
    const vault = createCredentialVault();
    vault.store(baseCredential({ scope: { tools: ['sf_write'] } }));
    const out = declareAndReconcile(vault, VK, { requested: { tools: ['sf_write'] } }, { dataDir: testDir });
    expect(out).toBeDefined();
    expect(out!.report.enabled).toBe(false);
    expect(out!.report.findings).toHaveLength(0);
    expect(out!.report.mismatches).toBe(0);
    // 关闭 ⇒ 不产生任何 decision-log 记录（半开状态禁止）
    expect(existsSync(getDecisionLogPath(testDir))).toBe(false);
  });

  it('declareAndReconcile：对账面开 ⇒ 无对应授权记录判越权并挂链', () => {
    const vault = createCredentialVault();
    vault.store(baseCredential({ scope: { tools: ['sf_write'] } }));
    const out = declareAndReconcile(
      vault,
      VK,
      { requested: { tools: ['sf_write'] } },
      { enabled: true, dataDir: testDir },
    );
    expect(out!.report.enabled).toBe(true);
    expect(out!.report.mismatches).toBe(1);
    expect(out!.report.findings[0]!.mismatch).toBe('no-mandate-record');
    // 结论进 decision-log 挂链
    const logPath = getDecisionLogPath(testDir);
    expect(existsSync(logPath)).toBe(true);
    const lines = readFileSync(logPath, 'utf-8').trim().split('\n');
    const entry = JSON.parse(lines[lines.length - 1]!);
    expect(entry.kind).toBe('CREDENTIAL_RECONCILE');
  });
});
