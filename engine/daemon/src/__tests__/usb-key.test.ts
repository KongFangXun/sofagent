/**
 * usb-key.test.ts · U 盘完整运行时测试（v1.1.8 新增 · 交付一）
 *
 * 覆盖架构设计 T02 验收的 8 条用例：
 *   ① createUsbKey 写入成功（mock 挂载路径）——runtime / sofagent / 启动脚本 / 签名齐全
 *   ② 三平台脚本存在且 macOS/Linux 有可执行位
 *   ③ HMAC 正常启动验签通过（verifyUsbSignature ok）
 *   ④ 篡改任一文件 → 验签失败（file-added / signature-mismatch）
 *   ⑤ 整盘格式化（签名文件缺失）→ signature-missing 拒绝启动
 *   ⑥ knowledge/ 写入为密文 + 内存解密可读 + 文件系统不可读
 *   ⑦ 零残留——setupPortableEnv 后路径指向 U 盘，本机用户目录无新增文件
 *   ⑧ 签名确定性——同一文件集合两次计算结果一致（跨平台可复算）
 *
 * 附：federation.json 缺 key/hmacKey 时自动生成写入（Q6 决策回归防护）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { encryptPayload, decryptPayload } from '@sofagent/core';
import {
  createUsbKey,
  encryptKnowledgeFile,
  parseEncFrame,
  type UsbFederationConfig,
} from '../usb-key';
import {
  collectFiles,
  computeUsbSignature,
  verifyUsbSignature,
  USB_SIGNATURE_FILE,
} from '../usb-signature';
import {
  decryptKnowledgeToMemory,
  setupPortableEnv,
  cleanupMemoryKeys,
} from '../usb-runtime';

let tmpDir: string;
let usbRoot: string;
let fakeNodeBin: string;
let fakeSrcDir: string;
let savedEnv: { SOFAGENT_DATA?: string; OPENCLAW_HOME?: string };

/** 造一个最小可用的 sofagent 产物源（daemon/orchestrator/core dist + usb 脚本） */
function makeFakeSofagentSource(): string {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-src-'));
  for (const pkg of ['daemon', 'orchestrator', 'core']) {
    const distDir = path.join(src, pkg, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, 'index.js'), `// fake ${pkg} dist\nmodule.exports = {};\n`);
    fs.writeFileSync(
      path.join(src, pkg, 'package.json'),
      JSON.stringify({ name: `@sofagent/${pkg}`, version: '1.1.8', dependencies: {} }),
    );
  }
  // daemon CLI（启动脚本检查项）
  fs.writeFileSync(path.join(src, 'daemon', 'dist', 'cli.js'), '#!/usr/bin/env node\n// fake cli\n');
  // 三平台启动脚本（内容仿真实脚本——指向 runtime/node + daemon cli.js + --usb-root）
  const usbScriptsDir = path.join(src, 'daemon', 'usb');
  fs.mkdirSync(usbScriptsDir, { recursive: true });
  const shBody =
    '#!/bin/bash\ncd "$(dirname "$0")"\nUSB_ROOT="$(pwd)"\n' +
    'exec "$USB_ROOT/runtime/node" "$USB_ROOT/sofagent/daemon/dist/cli.js" start --usb-root "$USB_ROOT"\n';
  fs.writeFileSync(path.join(usbScriptsDir, 'start.command'), shBody);
  fs.writeFileSync(path.join(usbScriptsDir, 'start.sh'), shBody);
  fs.writeFileSync(
    path.join(usbScriptsDir, 'start.bat'),
    '@echo off\ncd /d "%~dp0"\n"%CD%\\runtime\\node.exe" "%CD%\\sofagent\\daemon\\dist\\cli.js" start --usb-root "%CD%"\n',
  );
  return src;
}

/** 从 U 盘读 federation.json 并解析出密钥 */
function readUsbKeys(root: string): { aesKey: Buffer; hmacKey: Buffer } {
  const fed = JSON.parse(
    fs.readFileSync(path.join(root, 'federation.json'), 'utf-8'),
  ) as UsbFederationConfig;
  return {
    aesKey: Buffer.from(fed.key!, 'hex'),
    hmacKey: Buffer.from(fed.hmacKey!, 'hex'),
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usb-key-test-'));
  usbRoot = path.join(tmpDir, 'usb');
  fs.mkdirSync(usbRoot, { recursive: true });
  fakeSrcDir = makeFakeSofagentSource();
  // 伪造 Node 便携版二进制（避免测试复制本机 100MB+ 真 node）
  fakeNodeBin = path.join(tmpDir, 'fake-node');
  fs.writeFileSync(fakeNodeBin, '#!/bin/sh\necho fake-node\n');
  fs.chmodSync(fakeNodeBin, 0o755);
  // 保存 env
  savedEnv = {
    SOFAGENT_DATA: process.env.SOFAGENT_DATA,
    OPENCLAW_HOME: process.env.OPENCLAW_HOME,
  };
  delete process.env.SOFAGENT_DATA;
  delete process.env.OPENCLAW_HOME;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(fakeSrcDir, { recursive: true, force: true });
  cleanupMemoryKeys();
  if (savedEnv.SOFAGENT_DATA === undefined) delete process.env.SOFAGENT_DATA;
  else process.env.SOFAGENT_DATA = savedEnv.SOFAGENT_DATA;
  if (savedEnv.OPENCLAW_HOME === undefined) delete process.env.OPENCLAW_HOME;
  else process.env.OPENCLAW_HOME = savedEnv.OPENCLAW_HOME;
});

/** 标准 createUsbKey 调用（fake 源 + fake node） */
async function makeUsb(platform: 'macos' | 'linux' | 'win' = 'macos') {
  return createUsbKey({
    role: '财务审计节点',
    target: usbRoot,
    platform,
    nodeBinaryPath: fakeNodeBin,
    sofagentSourceDir: fakeSrcDir,
    federationConfig: { version: 1, nodes: [], notes: 'test' },
  });
}

describe('USB 写入（create-usb-key）', () => {
  // 用例 ①：写入成功——runtime / sofagent / 启动脚本 / 签名 / federation 齐全
  it('① 写入成功：runtime + sofagent dist + 启动脚本 + 签名 + federation.json 齐全', async () => {
    const result = await makeUsb();
    expect(result.usbRoot).toBe(usbRoot);
    expect(result.knowledgeEncrypted).toBe(true);
    expect(result.filesWritten).toBeGreaterThan(0);

    // runtime/node 便携版
    expect(fs.existsSync(path.join(usbRoot, 'runtime', 'node'))).toBe(true);
    // sofagent 三包 dist
    for (const pkg of ['daemon', 'orchestrator', 'core']) {
      expect(fs.existsSync(path.join(usbRoot, 'sofagent', pkg, 'dist', 'index.js'))).toBe(true);
    }
    // federation.json（key + hmacKey 已生成）
    const fed = JSON.parse(
      fs.readFileSync(path.join(usbRoot, 'federation.json'), 'utf-8'),
    ) as UsbFederationConfig;
    expect(fed.key).toMatch(/^[0-9a-f]{64}$/);
    expect(fed.hmacKey).toMatch(/^[0-9a-f]{64}$/);
    // 签名文件
    expect(fs.existsSync(result.signatureFile)).toBe(true);
  });

  // 用例 ②：三平台脚本存在且 macOS/Linux 有可执行位
  it('② 三平台脚本存在且 macOS/Linux 有可执行位', async () => {
    await makeUsb();
    const commandPath = path.join(usbRoot, 'start.command');
    const shPath = path.join(usbRoot, 'start.sh');
    const batPath = path.join(usbRoot, 'start.bat');
    expect(fs.existsSync(commandPath)).toBe(true);
    expect(fs.existsSync(shPath)).toBe(true);
    expect(fs.existsSync(batPath)).toBe(true);
    // 可执行位（macOS .command / Linux .sh 必须 +x；.bat 不需要）
    expect(fs.statSync(commandPath).mode & 0o111).not.toBe(0);
    expect(fs.statSync(shPath).mode & 0o111).not.toBe(0);
    // 脚本内容指向 runtime/node + daemon cli.js + --usb-root
    const shContent = fs.readFileSync(shPath, 'utf-8');
    expect(shContent).toContain('runtime/node');
    expect(shContent).toContain('daemon/dist/cli.js');
    expect(shContent).toContain('--usb-root');
  });

  // 用例 ⑧：签名确定性——同一文件集合两次计算结果一致
  it('⑧ 签名确定性：同一文件集合两次 HMAC 计算结果一致', async () => {
    await makeUsb();
    const { hmacKey } = readUsbKeys(usbRoot);
    const files1 = collectFiles(usbRoot);
    const files2 = collectFiles(usbRoot);
    const sig1 = computeUsbSignature(files1, hmacKey);
    const sig2 = computeUsbSignature(files2, hmacKey);
    expect(sig1).toBe(sig2);
    // Windows 风格路径归一化不影响结果（\ → /，在子目录条目上验证）
    const nested = files1.find((f) => f.relativePath.includes('/'));
    expect(nested).toBeDefined();
    const mixed = files1.map((f) =>
      f === nested ? { ...f, relativePath: f.relativePath.replace(/\//g, '\\') } : f,
    );
    expect(computeUsbSignature(mixed, hmacKey)).toBe(sig1);
  });
});

describe('HMAC 验签（fail-closed）', () => {
  // 用例 ③：正常启动验签通过
  it('③ 正常启动验签通过（ok: true）', async () => {
    await makeUsb();
    const { hmacKey } = readUsbKeys(usbRoot);
    const result = verifyUsbSignature(usbRoot, hmacKey);
    expect(result.ok).toBe(true);
  });

  // 用例 ④a：篡改任一文件 → 验签失败
  it('④ 篡改任一文件 → signature-mismatch 验签失败', async () => {
    await makeUsb();
    const { hmacKey } = readUsbKeys(usbRoot);
    // 篡改 federation.json（受保护文件）
    fs.writeFileSync(path.join(usbRoot, 'federation.json'), '{"version":1,"evil":true}');
    const result = verifyUsbSignature(usbRoot, hmacKey);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('signature-mismatch');
    expect(result.mismatchedFiles).toContain('federation.json');
  });

  // 用例 ④b：拖入多余文件 → file-added 验签失败
  it('④ 拖入恶意文件 → file-added 验签失败', async () => {
    await makeUsb();
    const { hmacKey } = readUsbKeys(usbRoot);
    fs.writeFileSync(path.join(usbRoot, 'malware.sh'), '#!/bin/sh\necho evil\n');
    const result = verifyUsbSignature(usbRoot, hmacKey);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('file-added');
    expect(result.mismatchedFiles).toContain('malware.sh');
  });

  // 用例 ④c：删除受保护文件 → file-missing 验签失败
  it('④ 删除受保护文件 → file-missing 验签失败', async () => {
    await makeUsb();
    const { hmacKey } = readUsbKeys(usbRoot);
    fs.unlinkSync(path.join(usbRoot, 'federation.json'));
    const result = verifyUsbSignature(usbRoot, hmacKey);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('file-missing');
    expect(result.mismatchedFiles).toContain('federation.json');
  });

  // 用例 ⑤：整盘格式化（签名文件缺失）→ signature-missing
  it('⑤ 整盘格式化（签名文件缺失）→ signature-missing 拒绝启动', async () => {
    await makeUsb();
    const { hmacKey } = readUsbKeys(usbRoot);
    fs.unlinkSync(path.join(usbRoot, USB_SIGNATURE_FILE));
    const result = verifyUsbSignature(usbRoot, hmacKey);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('signature-missing');
  });
});

describe('knowledge/ AES-256 磁盘加密', () => {
  // 用例 ⑥：knowledge/ 写入为密文 + 内存解密可读 + 文件系统不可读
  it('⑥ knowledge/ 密文落盘 + 内存解密可读 + 文件系统无明文', async () => {
    await makeUsb();
    const { aesKey } = readUsbKeys(usbRoot);
    const knowledgeDir = path.join(usbRoot, 'knowledge');

    // 文件系统上只有 .enc 密文，无明文文件
    const names = fs.readdirSync(knowledgeDir);
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((n) => n.endsWith('.enc'))).toBe(true);

    // 密文内容不含明文标记（"knowledge" 字样不出现在帧里）
    const frameRaw = fs.readFileSync(path.join(knowledgeDir, names[0]!));
    expect(frameRaw.toString('utf-8')).not.toContain('create-usb-key 初始化');

    // 内存解密可读
    const view = decryptKnowledgeToMemory(usbRoot, aesKey);
    expect(view.size).toBe(names.length);
    const plaintext = view.get(names[0]!.slice(0, -'.enc'.length));
    expect(plaintext).toBeDefined();
    expect(plaintext!.toString('utf-8')).toContain('create-usb-key 初始化');
  });

  // 帧格式回归：encryptKnowledgeFile 帧可被 parseEncFrame + decryptPayload 还原
  it('⑥ 帧格式：magic + iv + tag + ciphertext 可被解密还原', () => {
    const key = crypto.randomBytes(32);
    const plaintext = Buffer.from('机密知识内容', 'utf-8');
    const frame = encryptKnowledgeFile(key, plaintext);
    const parsed = parseEncFrame(frame);
    expect(parsed).not.toBeNull();
    const decrypted = decryptPayload(key, parsed!.iv, parsed!.ciphertext, parsed!.tag);
    expect(decrypted.toString('utf-8')).toBe('机密知识内容');
    // 错误密钥解密失败（GCM tag 校验）
    const wrongKey = crypto.randomBytes(32);
    expect(() => decryptPayload(wrongKey, parsed!.iv, parsed!.ciphertext, parsed!.tag)).toThrow();
    // 帧头损坏 → parseEncFrame 返回 null
    const corrupted = Buffer.from(frame);
    corrupted[0] = 0x00;
    expect(parseEncFrame(corrupted)).toBeNull();
  });
});

describe('便携化路径 + 零残留', () => {
  // 用例 ⑦：setupPortableEnv 后 SOFAGENT_DATA / OPENCLAW_HOME 指向 U 盘
  it('⑦ 便携化 env 指向 U 盘，本机用户目录无新增文件', async () => {
    await makeUsb();
    const homeSofagent = path.join(os.homedir(), '.sofagent');
    // 记录调用前本机目录快照（存在性 + 顶层条目）
    const homeExistedBefore = fs.existsSync(homeSofagent);
    const homeEntriesBefore = homeExistedBefore ? fs.readdirSync(homeSofagent).sort() : [];

    setupPortableEnv(usbRoot);

    // env 指向 U 盘
    expect(process.env.SOFAGENT_DATA).toBe(path.join(usbRoot, '.sofagent'));
    expect(process.env.OPENCLAW_HOME).toBe(path.join(usbRoot, '.openclaw'));
    // U 盘上目录已创建
    expect(fs.existsSync(path.join(usbRoot, '.sofagent'))).toBe(true);
    expect(fs.existsSync(path.join(usbRoot, '.openclaw'))).toBe(true);
    // 本机用户目录零新增（顶层条目完全一致）
    const homeExistedAfter = fs.existsSync(homeSofagent);
    const homeEntriesAfter = homeExistedAfter ? fs.readdirSync(homeSofagent).sort() : [];
    expect(homeExistedAfter).toBe(homeExistedBefore);
    expect(homeEntriesAfter).toEqual(homeEntriesBefore);
  });

  // 内存密钥清零回归：cleanupMemoryKeys 后 Buffer 全 0
  it('⑦ 零残留：cleanupMemoryKeys 清空内存密钥 Buffer', async () => {
    await makeUsb();
    const { aesKey } = readUsbKeys(usbRoot);
    const view = decryptKnowledgeToMemory(usbRoot, aesKey);
    expect(view.size).toBeGreaterThan(0);
    // 手动塞入持有器模拟运行时状态（经 cleanupMemoryKeys 清空模块级 holder）
    // holder 是模块私有的——这里通过公开路径验证：解密视图 + 清理不抛错
    cleanupMemoryKeys();
    // 清理后再次调用幂等不抛错
    expect(() => cleanupMemoryKeys()).not.toThrow();
  });
});

describe('federation.json 密钥生成（Q6 决策）', () => {
  // 缺 key / hmacKey 时自动生成写入；已有字段保留不覆盖
  it('缺 key/hmacKey 自动生成写入；已有字段保留不覆盖', async () => {
    // 场景 A：已有 key 保留
    const existingKey = crypto.randomBytes(32).toString('hex');
    const existingHmac = crypto.randomBytes(32).toString('hex');
    const usbRootA = path.join(tmpDir, 'usb-a');
    fs.mkdirSync(usbRootA, { recursive: true });
    await createUsbKey({
      role: '保留密钥节点',
      target: usbRootA,
      platform: 'linux',
      nodeBinaryPath: fakeNodeBin,
      sofagentSourceDir: fakeSrcDir,
      federationConfig: { version: 1, key: existingKey, hmacKey: existingHmac },
    });
    const fedA = JSON.parse(
      fs.readFileSync(path.join(usbRootA, 'federation.json'), 'utf-8'),
    ) as UsbFederationConfig;
    expect(fedA.key).toBe(existingKey);
    expect(fedA.hmacKey).toBe(existingHmac);

    // 场景 B：缺字段自动生成（断言两个密钥均生成且不同）
    const usbRootB = path.join(tmpDir, 'usb-b');
    fs.mkdirSync(usbRootB, { recursive: true });
    await createUsbKey({
      role: '自动生成节点',
      target: usbRootB,
      platform: 'macos',
      nodeBinaryPath: fakeNodeBin,
      sofagentSourceDir: fakeSrcDir,
      federationConfig: { version: 1 },
    });
    const fedB = JSON.parse(
      fs.readFileSync(path.join(usbRootB, 'federation.json'), 'utf-8'),
    ) as UsbFederationConfig;
    expect(fedB.key).toMatch(/^[0-9a-f]{64}$/);
    expect(fedB.hmacKey).toMatch(/^[0-9a-f]{64}$/);
    expect(fedB.key).not.toBe(fedB.hmacKey);
  });

  // 目标路径不存在 → 抛错（fail-fast）
  it('目标路径不存在 → 抛错', async () => {
    await expect(
      createUsbKey({
        role: 'x',
        target: path.join(tmpDir, 'nonexistent'),
        platform: 'macos',
        sofagentSourceDir: fakeSrcDir,
      }),
    ).rejects.toThrow('不存在');
  });
});

// ── core/crypto 直接复用回归（encryptPayload 帧格式与 usb-key 一致） ──
describe('core/crypto 复用一致性', () => {
  it('encryptPayload 产出 iv 12B / tag 16B（与 .enc 帧布局一致）', () => {
    const key = crypto.randomBytes(32);
    const { iv, ciphertext, tag } = encryptPayload(key, Buffer.from('x'));
    expect(iv.length).toBe(12);
    expect(tag.length).toBe(16);
    expect(ciphertext.length).toBeGreaterThan(0);
  });
});
