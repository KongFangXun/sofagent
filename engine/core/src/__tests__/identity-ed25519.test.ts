// ============================================================
// identity-ed25519.test.ts · Agent 身份码 Ed25519 完整版测试（v1.3.2 交付 6）
//
// 覆盖：
//   - Ed25519 签发（generateEd25519KeyPair / generateAgentIdentity 升级）
//   - 签名验证（verifyAgentIdentity）
//   - 篡改检测（委托人/约束版本/责任声明/签名被改 → 验证失败）
//   - identity-store 注册/查询/撤销（register/get/list/revoke）
//
// 测试隔离：SOFAGENT_HOME 指向临时目录，绝不污染真实 ~/.sofagent。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  generateAgentIdentity,
  generateEd25519KeyPair,
  buildSignaturePayload,
  signIdentityPayload,
  verifyAgentIdentity,
} from '../agent-identity';
import type { AgentIdentity } from '../agent-identity';
import {
  registerIdentity,
  getIdentity,
  listIdentities,
  revokeIdentity,
  getIdentityStorePath,
} from '../identity-store';

let homeDir: string;
let savedHome: string | undefined;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), 'sofagent-identity-'));
  savedHome = process.env.SOFAGENT_HOME;
  process.env.SOFAGENT_HOME = homeDir;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.SOFAGENT_HOME;
  else process.env.SOFAGENT_HOME = savedHome;
  try { rmSync(homeDir, { recursive: true, force: true }); } catch { /* #9 shim 加固 */ }
});

describe('交付 6：Ed25519 签发', () => {
  it('generateEd25519KeyPair 签发 hex 编码密钥对', () => {
    const { publicKey, privateKey } = generateEd25519KeyPair();
    expect(publicKey).toMatch(/^[0-9a-f]+$/);
    expect(privateKey).toMatch(/^[0-9a-f]+$/);
    expect(publicKey.length).toBeGreaterThan(0);
    expect(privateKey.length).toBeGreaterThan(0);
  });

  it('generateAgentIdentity 升级为 Ed25519 完整版（保留旧字段 + 新字段）', () => {
    const identity = generateAgentIdentity('customer-intake', {
      systemPrompt: '你是客户接单 Agent',
      tools: ['Read'],
      constraints: ['允许: 客户信息'],
      principal: 'acme-corp',
    });

    // 旧字段语义不变（向后兼容）
    expect(identity.agentId).toBeTruthy();
    expect(identity.displayName).toBe('customer-intake');
    expect(identity.principal).toBe('acme-corp');
    expect(identity.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(identity.shortCode).toHaveLength(6);
    expect(identity.createdAt).toBeTruthy();

    // v1.3.1 新字段
    expect(identity.publicKey).toMatch(/^[0-9a-f]+$/);
    expect(identity.privateKey).toMatch(/^[0-9a-f]+$/);
    expect(identity.signature).toMatch(/^[0-9a-f]+$/);
    expect(identity.constraintVersion).toBe(1);
    expect(identity.responsibility).toBeTruthy();
  });

  it('签名验证通过（verifyAgentIdentity = true）', () => {
    const identity = generateAgentIdentity('agent-x', { principal: 'corp-a' });
    expect(verifyAgentIdentity(identity)).toBe(true);
  });

  it('签名载荷确定性：相同绑定信息 → 相同载荷', () => {
    const p1 = buildSignaturePayload({ principal: 'corp', constraintVersion: 2, responsibility: 'R' });
    const p2 = buildSignaturePayload({ principal: 'corp', constraintVersion: 2, responsibility: 'R' });
    expect(p1).toBe(p2);
    expect(p1).toContain('principal=corp');
    expect(p1).toContain('constraintVersion=2');
    expect(p1).toContain('responsibility=R');
  });

  it('signIdentityPayload 产物可被 verifyAgentIdentity 复验', () => {
    const { publicKey, privateKey } = generateEd25519KeyPair();
    const identity: AgentIdentity = {
      agentId: 'a1',
      displayName: 'x',
      principal: 'corp',
      constraints: [],
      createdAt: new Date().toISOString(),
      fingerprint: 'f'.repeat(16),
      shortCode: 'abc123',
      publicKey,
      privateKey,
      constraintVersion: 3,
      responsibility: '测试责任声明',
    };
    identity.signature = signIdentityPayload(buildSignaturePayload(identity), privateKey);
    expect(verifyAgentIdentity(identity)).toBe(true);
  });
});

describe('交付 6：篡改检测', () => {
  it('篡改委托人 principal → 验证失败', () => {
    const identity = generateAgentIdentity('agent-y', { principal: 'corp-a' });
    const tampered = { ...identity, principal: 'corp-evil' };
    expect(verifyAgentIdentity(tampered)).toBe(false);
  });

  it('篡改约束版本 constraintVersion → 验证失败', () => {
    const identity = generateAgentIdentity('agent-y');
    const tampered = { ...identity, constraintVersion: 999 };
    expect(verifyAgentIdentity(tampered)).toBe(false);
  });

  it('篡改责任声明 responsibility → 验证失败', () => {
    const identity = generateAgentIdentity('agent-y');
    const tampered = { ...identity, responsibility: '我没有任何约束' };
    expect(verifyAgentIdentity(tampered)).toBe(false);
  });

  it('替换签名 signature → 验证失败', () => {
    const identity = generateAgentIdentity('agent-y');
    const other = generateAgentIdentity('agent-z');
    const tampered = { ...identity, signature: other.signature };
    expect(verifyAgentIdentity(tampered)).toBe(false);
  });

  it('缺少公钥/签名（旧版轻量身份）→ 验证失败（不抛异常）', () => {
    const legacy: AgentIdentity = {
      agentId: 'legacy-1',
      displayName: 'old-agent',
      principal: 'enterprise',
      constraints: [],
      createdAt: new Date().toISOString(),
      fingerprint: '0123456789abcdef',
      shortCode: 'abc123',
    };
    expect(verifyAgentIdentity(legacy)).toBe(false);
  });

  it('非法公钥格式 → 验证失败（不抛异常）', () => {
    const identity = generateAgentIdentity('agent-y');
    expect(verifyAgentIdentity({ ...identity, publicKey: 'not-hex' })).toBe(false);
  });
});

describe('交付 6：identity-store 注册/查询/撤销', () => {
  it('register 写入 data/identity/identities.json', () => {
    const identity = generateAgentIdentity('agent-1');
    registerIdentity(identity);

    const storePath = getIdentityStorePath();
    expect(storePath).toContain(join('data', 'identity'));
    expect(existsSync(storePath)).toBe(true);
    const file = JSON.parse(readFileSync(storePath, 'utf-8'));
    expect(file.records[identity.agentId]).toBeTruthy();
    expect(file.records[identity.agentId].revoked).toBe(false);
  });

  it('get 按 agentId 查询', () => {
    const identity = generateAgentIdentity('agent-1');
    registerIdentity(identity);

    const record = getIdentity(identity.agentId);
    expect(record).not.toBeNull();
    expect(record!.identity.agentId).toBe(identity.agentId);
    expect(record!.revoked).toBe(false);
  });

  it('get 不存在的 agentId → null', () => {
    expect(getIdentity('non-existent-id')).toBeNull();
  });

  it('重复 register 同一 agentId → 幂等覆盖（不产生重复记录）', () => {
    const identity = generateAgentIdentity('agent-1', { principal: 'v1' });
    registerIdentity(identity);
    registerIdentity({ ...identity, principal: 'v2' });

    const all = listIdentities();
    expect(all.length).toBe(1);
    expect(all[0]!.identity.principal).toBe('v2');
  });

  it('list 列出全部身份', () => {
    registerIdentity(generateAgentIdentity('agent-1'));
    registerIdentity(generateAgentIdentity('agent-2'));
    registerIdentity(generateAgentIdentity('agent-3'));
    expect(listIdentities().length).toBe(3);
  });

  it('revoke 撤销标记 revoked:true（保留记录供审计追溯）', () => {
    const identity = generateAgentIdentity('agent-1');
    registerIdentity(identity);

    expect(revokeIdentity(identity.agentId)).toBe(true);
    const record = getIdentity(identity.agentId);
    expect(record!.revoked).toBe(true);
    expect(record!.revokedAt).toBeTruthy();
    // 记录仍存在（不物理删除）
    expect(getIdentity(identity.agentId)).not.toBeNull();
  });

  it('revoke 不存在的 agentId → false', () => {
    expect(revokeIdentity('non-existent')).toBe(false);
  });

  it('list 按撤销状态过滤（includeRevoked: true=仅撤销 / false=仅有效）', () => {
    const id1 = generateAgentIdentity('agent-1');
    const id2 = generateAgentIdentity('agent-2');
    registerIdentity(id1);
    registerIdentity(id2);
    revokeIdentity(id1.agentId);

    expect(listIdentities({ includeRevoked: true }).length).toBe(1);
    expect(listIdentities({ includeRevoked: true })[0]!.identity.agentId).toBe(id1.agentId);
    expect(listIdentities({ includeRevoked: false }).length).toBe(1);
    expect(listIdentities({ includeRevoked: false })[0]!.identity.agentId).toBe(id2.agentId);
    expect(listIdentities().length).toBe(2); // 缺省 = 全部
  });

  it('撤销后重新注册 → 视为重新授权（清除 revoked）', () => {
    const identity = generateAgentIdentity('agent-1');
    registerIdentity(identity);
    revokeIdentity(identity.agentId);
    expect(getIdentity(identity.agentId)!.revoked).toBe(true);

    registerIdentity(identity);
    expect(getIdentity(identity.agentId)!.revoked).toBe(false);
  });
});
