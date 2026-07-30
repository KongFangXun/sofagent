// ============================================================
// pairing.test.ts · 三条配对路径契约测试
// v1.1.8 新增
//
// 覆盖用例（共 8 case）：
//   1. 路径 A：6 位码格式 + 会话创建
//   2. 路径 A：指纹 y/N 确认（y → 协商成功且双方 key 一致；N → 抛错）
//   3. 路径 B：token 配对成功（双方 HMAC 标签互认，key 一致）
//   4. 路径 B：token 缺失/过短 → 抛错；标签被调包 → 抛错
//   5. 路径 C：federation.json + 合法 .sig → 验签通过信任
//   6. 路径 C：.sig 缺失 → 拒绝
//   7. 路径 C：.sig 篡改 / 内容篡改 → 拒绝
//   8. 路径 C：非法 JSON → 拒绝
// ============================================================

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import crypto from 'node:crypto';

import {
  generatePairingCode,
  createPairingSession,
  pairByCode,
  pairByToken,
  computeTokenTag,
  pairByFederationFile,
  FEDERATION_TOKEN_PATH,
  MIN_TOKEN_LENGTH,
  PAIRING_CODE_LENGTH,
} from '../pairing';
import { generateKeyPair, deriveSharedKey } from '../ecdh';

// ── 路径 C 的 HMAC 验签辅助（与 daemon/usb-detect.ts 同范式，测试内自实现避免跨包依赖）──
const TEST_SECRET = crypto.randomBytes(32);
const sign = (content: string, key: Buffer): string =>
  crypto.createHmac('sha256', key).update(content, 'utf-8').digest('hex');
const verify = (content: string, signature: string, key: Buffer): boolean => {
  const expected = sign(content, key);
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, 'utf-8'), Buffer.from(signature, 'utf-8'));
};
const loadKey = (): Buffer => TEST_SECRET;

/** 测试用长 token（≥ MIN_TOKEN_LENGTH） */
const TEST_TOKEN = 'tok-' + crypto.randomBytes(32).toString('hex');

describe('路径 A · 6 位码 + y/N 确认', () => {
  // 用例 1：配对码格式 + 会话创建
  it('配对码为 6 位数字；会话含公钥/私钥/指纹', () => {
    for (let i = 0; i < 20; i++) {
      expect(generatePairingCode()).toMatch(new RegExp(`^\\d{${PAIRING_CODE_LENGTH}}$`));
    }
    const session = createPairingSession();
    expect(session.publicKey.length).toBe(33); // 压缩公钥
    expect(session.privateKey.length).toBe(32);
    expect(session.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });

  // 用例 2：y → 协商成功（双方 key 一致）；N → 抛错
  it('用户确认（y）→ 配对成功且双方 sharedKey 一致；拒绝（N）→ 抛错', async () => {
    const alice = createPairingSession();
    const bob = createPairingSession();
    // Alice 确认 Bob 的指纹（y）
    const peerOfAlice = await pairByCode(alice.privateKey, bob.publicKey, async () => true);
    expect(peerOfAlice.via).toBe('code');
    expect(peerOfAlice.sharedKey).not.toBeNull();
    // Bob 侧独立协商，key 应与 Alice 侧一致
    const bobKey = deriveSharedKey(bob.privateKey, alice.publicKey);
    expect(peerOfAlice.sharedKey!.equals(bobKey)).toBe(true);
    // 用户拒绝（N）→ 抛错
    await expect(pairByCode(alice.privateKey, bob.publicKey, async () => false))
      .rejects.toThrow(/拒绝/);
  });
});

describe('路径 B · token 配对', () => {
  // 用例 3：token 配对成功
  it('双方用同一 token 计算公钥标签，互认后协商出同一把 key', async () => {
    const alice = generateKeyPair();
    const bob = generateKeyPair();
    // Bob 把 公钥+标签 发给 Alice
    const bobTag = computeTokenTag(TEST_TOKEN, bob.publicKey);
    const peer = await pairByToken(TEST_TOKEN, alice.privateKey, bob.publicKey, bobTag);
    expect(peer.via).toBe('token');
    expect(peer.sharedKey).not.toBeNull();
    // 双方 key 一致
    expect(peer.sharedKey!.equals(deriveSharedKey(bob.privateKey, alice.publicKey))).toBe(true);
  });

  // 用例 4：token 缺失/过短/标签调包 → 抛错
  it('token 缺失（文件不存在）/过短/标签不匹配 → 抛错', async () => {
    const alice = generateKeyPair();
    const bob = generateKeyPair();
    const tag = computeTokenTag(TEST_TOKEN, bob.publicKey);
    // token 缺失（显式 undefined 且文件不存在）
    await expect(pairByToken(undefined, alice.privateKey, bob.publicKey, tag))
      .rejects.toThrow(/未提供 token/);
    // token 过短
    expect(MIN_TOKEN_LENGTH).toBeGreaterThan(0);
    await expect(pairByToken('short', alice.privateKey, bob.publicKey, tag))
      .rejects.toThrow(/长度不足/);
    // 标签调包（用错误 token 计算的标签）
    const evilTag = computeTokenTag('evil-' + crypto.randomBytes(32).toString('hex'), bob.publicKey);
    await expect(pairByToken(TEST_TOKEN, alice.privateKey, bob.publicKey, evilTag))
      .rejects.toThrow(/标签不匹配/);
  });
});

describe('路径 C · 预制 federation.json（HMAC 验签）', () => {
  const federationJson = JSON.stringify({
    version: 1,
    nodes: [{ name: 'peer-laptop', platform: 'macos' }],
    notes: 'v1.1.5 USB federation',
  });

  // 用例 5：合法 .sig → 验签通过信任
  it('federation.json + 合法 .sig → 配对成功，peerId 取自 nodes[0].name', async () => {
    const sig = sign(federationJson, TEST_SECRET);
    const peer = await pairByFederationFile(federationJson, sig, verify, loadKey);
    expect(peer.via).toBe('federation-file');
    expect(peer.peerId).toBe('peer-laptop');
    // 路径 C 无 ECDH 协商 → sharedKey 为 null
    expect(peer.sharedKey).toBeNull();
  });

  // 用例 6：.sig 缺失 → 拒绝
  it('.sig 缺失（signature=null）→ 拒绝', async () => {
    await expect(pairByFederationFile(federationJson, null, verify, loadKey))
      .rejects.toThrow(/缺失/);
  });

  // 用例 7：.sig 篡改 / 内容篡改 → 拒绝
  it('.sig 篡改或文件内容篡改 → 验签不通过拒绝', async () => {
    const sig = sign(federationJson, TEST_SECRET);
    // 签名本身篡改
    const badSig = sig.slice(0, -2) + (sig.endsWith('00') ? 'ff' : '00');
    await expect(pairByFederationFile(federationJson, badSig, verify, loadKey))
      .rejects.toThrow(/验签不通过/);
    // 内容篡改（签名是对原文算的）
    const tampered = federationJson.replace('peer-laptop', 'evil-laptop');
    await expect(pairByFederationFile(tampered, sig, verify, loadKey))
      .rejects.toThrow(/验签不通过/);
    // 密钥不匹配（另一把 key 验签）
    const wrongVerify = (c: string, s: string): boolean =>
      verify(c, s, crypto.randomBytes(32));
    await expect(pairByFederationFile(federationJson, sig, wrongVerify, loadKey))
      .rejects.toThrow(/验签不通过/);
  });

  // 用例 8：非法 JSON → 拒绝
  it('验签通过但内容不是合法 JSON → 拒绝', async () => {
    const notJson = 'this is not json {';
    const sig = sign(notJson, TEST_SECRET);
    await expect(pairByFederationFile(notJson, sig, verify, loadKey))
      .rejects.toThrow(/JSON/);
  });
});
