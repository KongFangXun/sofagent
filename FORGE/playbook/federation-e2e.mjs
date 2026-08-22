#!/usr/bin/env node
// ============================================================
// federation-e2e.mjs · sofagent 联邦查询跨进程 E2E 测试
// ============================================================
// 覆盖的缺口（现有 federation.test.ts 是"同进程 mock channel 直投"单测）：
//   ✅ 真实跨进程互联（两个独立 Node 进程，loopback TCP 传输）
//   ✅ 配对协商全流程（createPairingSession + pairByCode 双端确认）
//   ✅ 帧加密传输（AES-256-GCM，channel 只搬密文——与生产架构一致）
//   ✅ 篡改检测（密文改 1 字节 → 解密失败）
//   ✅ 离线降级（对端进程终止 → fetch 返回 null / withOfflineFallback 落本地）
//
// 运行方式（在 sofagent 仓库根目录）：
//   node FORGE/playbook/federation-e2e.mjs
// 或：
//   SOFAGENT_REPO=/Users/kongfangxun/WorkBuddy/sofagent node FORGE/playbook/federation-e2e.mjs
//
// 判定：全部场景 PASS → exit 0；任一 FAIL → exit 1。
// 已被 acceptance-test.sh 场景 320 调用（v1.4.0 纳入验收体系）。
// ============================================================

import net from 'node:net';
import { fork } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 定位 sofagent 仓库（cwd 或 SOFAGENT_REPO 或向上探测）────────────────
function findRepo(start) {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        if (Array.isArray(j.workspaces)) return dir;
      } catch {}
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}
const REPO = process.env.SOFAGENT_REPO || findRepo(process.cwd());
if (!REPO) {
  console.error('❌ 未找到 sofagent 仓库（package.json 含 workspaces）。请在仓库根目录运行，或设 SOFAGENT_REPO 环境变量。');
  process.exit(2);
}

const CORE = require(path.join(REPO, 'engine/core/dist/index.js'));
const FED = require(path.join(REPO, 'engine/daemon/dist/federation/index.js'));
const { encodeFrame, decodeFrame, fetchFromPeer, withOfflineFallback, validateRemoteResult } = FED;
const { createPairingSession, pairByCode, generateKeyPair, deriveSharedKey } = CORE;

// ── 简易断言 ──────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function assert(cond, name, detail = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

// ── 设备 B（子进程）：监听 TCP，解密帧 → 本地检索 → 加密返回 ────────
function runPeerServer() {
  const port = parseInt(process.env.PEER_PORT, 10);
  const key = Buffer.from(process.env.PEER_KEY, 'hex');
  const knowledgeDir = process.env.PEER_KNOWLEDGE;
  const server = net.createServer((socket) => {
    const chunks = [];
    socket.on('data', (c) => chunks.push(c));
    socket.on('end', () => {
      try {
        const frame = Buffer.concat(chunks);
        const req = decodeFrame(key, frame);
        // 本地检索：knowledge/ 目录内 .md 文件做关键词匹配
        const results = [];
        if (fs.existsSync(knowledgeDir)) {
          for (const f of fs.readdirSync(knowledgeDir)) {
            if (!f.endsWith('.md')) continue;
            const content = fs.readFileSync(path.join(knowledgeDir, f), 'utf8');
            if (content.includes(req.text)) {
              results.push({
                id: f.replace(/\.md$/, ''),
                title: f.replace(/\.md$/, ''),
                content: content.slice(0, 200),
                sensitivity: 'internal',
                trust: 'internal',
                mtime: Date.now(),
              });
            }
          }
        }
        const resp = encodeFrame(key, { results });
        socket.write(resp);
        socket.end();
      } catch (e) {
        // 解密失败：回一个特殊标记帧（改一字节的失败帧）
        try { socket.write(Buffer.from('E2E_DECODE_FAIL')); } catch {}
        socket.end();
      }
    });
    socket.on('error', () => {});
  });
  server.listen(port, '127.0.0.1', () => {
    process.send?.({ type: 'ready' });
  });
}

// ── TCP Channel（实现 FederationChannel 接口：send/ping）─────────────
function makeTcpChannel(port) {
  return {
    async send(message, timeoutMs = 5000) {
      return new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1');
        const timer = setTimeout(() => { socket.destroy(); reject(new Error('send timeout')); }, timeoutMs);
        const chunks = [];
        socket.on('data', (c) => chunks.push(c));
        socket.on('end', () => {
          clearTimeout(timer);
          const buf = Buffer.concat(chunks);
          if (buf.toString() === 'E2E_DECODE_FAIL') { reject(new Error('peer 解密失败')); return; }
          resolve(buf);
        });
        socket.on('error', (e) => { clearTimeout(timer); reject(e); });
        socket.write(message.frame);
        socket.end();
      });
    },
    async ping(_peerId, timeoutMs = 2000) {
      return new Promise((resolve) => {
        const socket = net.connect(port, '127.0.0.1');
        const timer = setTimeout(() => { socket.destroy(); resolve(false); }, timeoutMs);
        socket.on('connect', () => { clearTimeout(timer); socket.end(); resolve(true); });
        socket.on('error', () => { clearTimeout(timer); resolve(false); });
      });
    },
  };
}

// ── 设备 A 本地知识（用于离线降级验证）───────────────────────────────
function localSearch(knowledgeDir, text) {
  const results = [];
  if (!fs.existsSync(knowledgeDir)) return results;
  for (const f of fs.readdirSync(knowledgeDir)) {
    if (!f.endsWith('.md')) continue;
    const content = fs.readFileSync(path.join(knowledgeDir, f), 'utf8');
    if (content.includes(text)) {
      results.push({
        id: 'local-' + f.replace(/\.md$/, ''),
        title: f.replace(/\.md$/, ''),
        content: content.slice(0, 200),
        sensitivity: 'internal', trust: 'internal', mtime: Date.now(),
      });
    }
  }
  return results;
}

// ── 主控流程 ──────────────────────────────────────────────────────────
async function main() {
  const isPeer = process.argv[2] === '--server';
  if (isPeer) { runPeerServer(); return; }

  console.log('══════════════════════════════════════════════════════════');
  console.log(' sofagent 联邦查询跨进程 E2E（仓库: ' + REPO + '）');
  console.log('══════════════════════════════════════════════════════════\n');

  // 临时工作区（两个隔离的"设备数据目录"）
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-e2e-'));
  const dirA = path.join(work, 'deviceA');
  const dirB = path.join(work, 'deviceB');
  fs.mkdirSync(path.join(dirA, 'knowledge'), { recursive: true });
  fs.mkdirSync(path.join(dirB, 'knowledge'), { recursive: true });
  fs.writeFileSync(path.join(dirA, 'knowledge', 'deploy-guide.md'), 'sofagent 部署指南：诊断 → 激活 → 编排 → 执行 → 进化');
  fs.writeFileSync(path.join(dirB, 'knowledge', 'audit-rules.md'), 'sofagent 审计规则：24 条 git-diff 硬证据，密钥泄漏当场拦截');

  // ── 场景一：配对协商（路径 A：配对码 + 指纹人工确认）──────────────
  console.log('── 场景一：配对协商（createPairingSession + pairByCode）──');
  const sessionA = createPairingSession();                       // 设备 A 发起
  const sessionB = createPairingSession();                       // 设备 B 侧也生成己方会话
  const peerA_viewB = await pairByCode(sessionB.privateKey, sessionA.publicKey, async (fp) => {
    console.log(`    [B 确认] 对端 A 指纹 ${fp} —— 自动化确认 y`);
    return true;
  });
  const peerB_viewA = await pairByCode(sessionA.privateKey, sessionB.publicKey, async (fp) => {
    console.log(`    [A 确认] 对端 B 指纹 ${fp} —— 自动化确认 y`);
    return true;
  });
  assert(Buffer.from(peerA_viewB.sharedKey).equals(Buffer.from(peerB_viewA.sharedKey)),
    '配对后双方 ECDH 共享密钥一致');
  assert(peerA_viewB.fingerprint === peerA_viewB.peerId, 'peerId = 指纹（防调包锚点）');
  console.log('');

  // ── 场景二：跨进程加密查询（A → fork 子进程 B，loopback TCP）────────
  console.log('── 场景二：跨进程加密查询（A 发查询 → B 解密检索 → 加密回传）──');
  const bPort = 19000 + crypto.randomInt(0, 1000);
  const child = fork(fileURLToPath(import.meta.url), ['--server'], {
    env: {
      ...process.env,
      PEER_PORT: String(bPort),
      PEER_KEY: Buffer.from(peerA_viewB.sharedKey).toString('hex'),
      PEER_KNOWLEDGE: path.join(dirB, 'knowledge'),
    },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  await new Promise((res, rej) => { child.on('message', (m) => m.type === 'ready' ? res() : null); child.on('error', rej); setTimeout(res, 500); });

  const channel = makeTcpChannel(bPort);
  const query = { text: '审计规则', viewerLevel: 'internal', limit: 10 };
  const peerView = { peerId: peerA_viewB.peerId, sharedKey: peerA_viewB.sharedKey, fingerprint: peerA_viewB.fingerprint, via: 'code' };
  const results = await fetchFromPeer(peerView, query, channel, 5000);
  assert(Array.isArray(results) && results.length === 1 && results[0].id === 'audit-rules',
    '跨进程查询返回 B 设备检索结果（audit-rules）',
    JSON.stringify(results?.map(r => r.id)));
  assert(Buffer.isBuffer(encodeFrame(peerA_viewB.sharedKey, { a: 1 })),
    '帧编解码 API 可用（encodeFrame/decodeFrame）');
  const roundtrip = decodeFrame(peerA_viewB.sharedKey, encodeFrame(peerA_viewB.sharedKey, { a: 42 }));
  assert(roundtrip.a === 42, '帧加解密往返一致');
  console.log('');

  // ── 场景三：篡改检测（密文改 1 字节 → 解密失败）────────────────────
  console.log('── 场景三：篡改检测（中间人改密文 1 字节）──');
  const forgedFrame = encodeFrame(peerA_viewB.sharedKey, { text: '审计规则', viewerLevel: 'internal', limit: 10 });
  forgedFrame[Math.floor(forgedFrame.length / 2)] ^= 0x01;       // 翻转中间 1 字节
  let decodeFailed = false;
  try { decodeFrame(peerA_viewB.sharedKey, forgedFrame); } catch { decodeFailed = true; }
  assert(decodeFailed, '篡改帧解密失败（AES-256-GCM 完整性校验生效）');
  console.log('');

  // ── 场景四：离线降级（终止 B 进程 → fetch 返回 null + 本地降级）────
  console.log('── 场景四：离线降级（kill B → 降级本地知识库）──');
  child.kill('SIGKILL');
  await new Promise((r) => setTimeout(r, 300));
  const offlineResult = await fetchFromPeer(peerView, query, channel, 1000);
  assert(offlineResult === null, 'B 离线后 fetchFromPeer 返回 null（不抛错）');
  const merged = await withOfflineFallback(
    query,
    [peerView],
    () => localSearch(path.join(dirA, 'knowledge'), '部署指南'),
    channel,
  );
  assert(merged && merged.length >= 1 && merged[0].id === 'local-deploy-guide',
    'withOfflineFallback 降级本地知识库（local-deploy-guide）',
    JSON.stringify(merged?.map(r => r.id)));
  console.log('');

  // ── 场景五：validateRemoteResult 本地 trust 白名单 ──────────────────
  // 注意：AKIA 密钥串按 sofagent 规范运行时拼接（A2 fixture secret 铁律）——
  // 完整形态硬编码会被审计引擎 A2 规则静态扫出误报泄漏。
  console.log('── 场景五：trust 白名单（不采信 peer 自报，本地覆盖）──');
  const suspicious = { id: 'x', title: 'x', content: 'secret=AKIA' + 'IOSFODNN7EXAMPLE', sensitivity: 'public', trust: 'internal', mtime: 1 };
  const v = validateRemoteResult(peerView.peerId, suspicious, 'user');
  assert(v.warning !== null, '标 public 但内容含敏感串 → 降权 WARN');
  assert(v.result.trust === 'web' || v.result.trust === 'user', 'trust 来自本地白名单而非 peer 自报');
  console.log('');

  // ── 汇总 ────────────────────────────────────────────────────────────
  fs.rmSync(work, { recursive: true, force: true });
  console.log('══════════════════════════════════════════════════════════');
  console.log(` 结果：${passed} PASS / ${failed} FAIL`);
  console.log('══════════════════════════════════════════════════════════');
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error('❌ E2E 异常:', e); process.exit(1); });
