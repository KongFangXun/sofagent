// ============================================================
// sandbox-egress-credential.test.ts · v1.5.4 章三/章七 · 沙箱 HTTP 出口凭证注入接线
// ============================================================
//
// 覆盖（生产路径可达自证——非仅导出/类型）：
//   ① createSandboxHandle 装配出口时**构造 Vault（含轮换器）**
//   ② 凭证签发处（issueCredential）→ store + 产出范围声明（交章七对账）
//   ③ 沙箱层④出口注入：加签真实凭证到**出站副本**；审计事件 args 零明文
//   ④ 宿主注入的 credentialVault 被复用（外部签发场景）
//   ⑤ 轮换器随出口构造——到期策略 / 泄露响应可用
//   ⑥ 对账开档（credentialReconcile:true）⇒ 结论进 decision-log（kind=CREDENTIAL_RECONCILE）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getDecisionLogPath } from '@sofagent/core';
import { createSandboxHandle, wrapTools } from '../harness-sdk/wrap';
import { createCredentialVault } from '../vault';
import type { ExecutableTool } from '../tools';
import type { HarnessToolCallEvent } from '../harness-sdk/types';

// 合成假密钥：拆串拼接（避免以连续 sk- 明文形态入库——对齐既有测试对 A2 密钥规则的口径）
const SECRET = ['sk-super-', 'secret'].join('');

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sofagent-egress-cred-'));
});
afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

/** 构造测试网络工具（ExecutableTool 最小形态；可捕获出站入参） */
function httpTool(name = 'http_fetch', sink?: (input: Record<string, unknown>) => void): ExecutableTool {
  return {
    name,
    description: `测试网络工具 ${name}`,
    schema: { type: 'object', properties: {} },
    func: (input: Record<string, unknown>) => {
      sink?.(input);
      return `${name} 执行结果`;
    },
  } as ExecutableTool;
}

describe('沙箱 HTTP 出口凭证注入（v1.5.4 章三）', () => {
  it('① 装配出口即构造 Vault（含轮换器）——credentialVault / credentialRotator 可用', () => {
    const handle = createSandboxHandle({ sandbox: true, dataDir });
    expect(handle.credentialVault).toBeDefined();
    expect(handle.credentialRotator).toBeDefined();
    expect(handle.credentialVault.list()).toHaveLength(0);
  });

  it('② 凭证签发处：issueCredential → Vault 登记 + 脱敏视图（零 secret）', () => {
    const handle = createSandboxHandle({ sandbox: true, dataDir });
    const view = handle.issueCredential({
      id: 'cred-1',
      virtualKey: 'vk-agent-1',
      secret: SECRET,
      mandateId: 'mg-1',
      scope: { tools: ['http_fetch'], hosts: ['api.github.com'] },
      inject: { header: 'Authorization', scheme: 'Bearer' },
    });
    expect(view.id).toBe('cred-1');
    expect(view.status).toBe('active');
    expect(JSON.stringify(view)).not.toContain(SECRET); // 脱敏视图零明文
    expect(handle.credentialVault.isActive('cred-1')).toBe(true);
  });

  it('③ 出口注入：出站副本加签真实凭证；审计事件 args 零明文', () => {
    const events: HarnessToolCallEvent[] = [];
    let egressSeen: Record<string, unknown> | undefined;
    const handle = createSandboxHandle({ sandbox: true, dataDir, sandboxAllowHosts: ['api.github.com'] });
    const vk = 'vk-agent-1';
    handle.issueCredential({
      id: 'cred-1',
      virtualKey: vk,
      secret: SECRET,
      mandateId: 'mg-1',
      scope: { tools: ['http_fetch'], hosts: ['api.github.com'] },
      inject: { header: 'Authorization', scheme: 'Bearer' },
    });

    const wrapped = wrapTools(
      [httpTool('http_fetch', (i) => { egressSeen = i; })],
      {
        sandbox: true,
        sandboxHandle: handle,
        credentialVault: handle.credentialVault,
        credentialVirtualKey: vk,
        onToolCall: (e) => events.push(e),
      },
    );

    const out = wrapped[0]!.func({ url: 'https://api.github.com/repos' });
    expect(out).toContain('http_fetch 执行结果');
    // 出站副本（新对象）带真实凭证——只进 transport 面
    expect(egressSeen?.headers).toEqual({ Authorization: `Bearer ${SECRET}` });
    // 审计事件 args（= Agent 原入参）零明文（只改副本，不改原入参）
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0]!.args)).not.toContain(SECRET);
  });

  it('③b 未携带虚拟 key ⇒ 不注入（行为与今日一致）', () => {
    const handle = createSandboxHandle({ sandbox: true, dataDir, sandboxAllowHosts: ['api.github.com'] });
    let egressSeen: Record<string, unknown> | undefined;
    const wrapped = wrapTools(
      [httpTool('http_fetch', (i) => { egressSeen = i; })],
      { sandbox: true, sandboxHandle: handle, credentialVault: handle.credentialVault },
    );
    wrapped[0]!.func({ url: 'https://api.github.com/x' });
    expect(egressSeen?.headers).toBeUndefined();
  });

  it('④ 宿主注入的 credentialVault 被复用（外部签发场景）', () => {
    const hostVault = createCredentialVault();
    hostVault.store({
      id: 'host-1',
      virtualKey: 'vk-host',
      secret: 'sk-host',
      mandateId: 'mg-host',
      scope: {},
      inject: { header: 'x-api-key' },
    });
    const handle = createSandboxHandle({ sandbox: true, dataDir, credentialVault: hostVault });
    expect(handle.credentialVault).toBe(hostVault);
    expect(handle.credentialVault.describe('host-1')).toBeDefined();
  });

  it('⑤ 轮换器随出口构造——到期策略 / 泄露响应可用', () => {
    const handle = createSandboxHandle({ sandbox: true, dataDir });
    handle.issueCredential({
      id: 'cred-1',
      virtualKey: 'vk-1',
      secret: 'sk-1',
      mandateId: 'mg-1',
      scope: {},
      inject: { header: 'Authorization' },
    });
    expect(handle.credentialRotator.policyOf().maxAgeMs).toBeGreaterThan(0);
    // 泄露响应 → 立即吊销（此后注入器不再注入）
    const leak = handle.credentialRotator.reportLeak('cred-1', '测试泄露响应');
    expect(leak.revoked).toBe(true);
    expect(handle.credentialVault.isActive('cred-1')).toBe(false);
  });

  it('⑥ 签发处对账开档（credentialReconcile:true）⇒ 结论进 decision-log（kind=CREDENTIAL_RECONCILE）', () => {
    const saved = process.env.SOFAGENT_KEY_PATH;
    writeFileSync(join(dataDir, 'hmac-key'), 'test-hmac-key-0123456789abcdef');
    process.env.SOFAGENT_KEY_PATH = join(dataDir, 'hmac-key');
    try {
      const handle = createSandboxHandle({ sandbox: true, dataDir, credentialReconcile: true });
      handle.issueCredential({
        id: 'cred-x',
        virtualKey: 'vk-x',
        secret: 'sk-x',
        mandateId: 'mg-missing',
        scope: {},
        inject: { header: 'Authorization' },
      });
      const p = getDecisionLogPath(dataDir);
      expect(existsSync(p)).toBe(true);
      const kinds = readFileSync(p, 'utf-8')
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((l) => JSON.parse(l) as Record<string, unknown>)
        .map((d) => d.kind);
      expect(kinds).toContain('CREDENTIAL_RECONCILE');
    } finally {
      if (saved === undefined) delete process.env.SOFAGENT_KEY_PATH;
      else process.env.SOFAGENT_KEY_PATH = saved;
    }
  });
});
