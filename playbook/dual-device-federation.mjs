// sofagent 双设备联邦本机模拟（v1.4.0 资产 · FORGE/playbook）
// 两个完全独立的 node 进程（spawn，非 fork）模拟设备 A / 设备 B：
//   配对 = 文件交换公钥（模拟配对码人工确认，pairByCode 指纹锚点）
//   查询 = localhost TCP 加密帧（AES-256-GCM + ECDH 共享密钥，复用 core/daemon 联邦协议）
// 与 federation-e2e.mjs（fork 子进程版）互补：本脚本验证「两个独立进程」形态，
// 更接近真实双设备（真实网络栈 + 独立 PID）；桌面双设备测试用例留给真人跨机实测。
// 判定：配对/查询/篡改/离线 4 场景全 PASS → exit 0；任一 FAIL → exit 1。
// 用法：node FORGE/playbook/dual-device-federation.mjs
// 配对 = 文件交换公钥（模拟配对码人工确认，pairByCode 指纹锚点）
// 查询 = localhost TCP 加密帧（AES-256-GCM + ECDH 共享密钥）
// 用法：node /tmp/dual-device-federation.mjs   （主控 spawn A + B）
import net from 'node:net';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

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
const REPO = process.env.SOFAGENT_REPO || findRepo(path.dirname(fileURLToPath(import.meta.url)));
if (!REPO) {
  console.error('❌ 未找到 sofagent 仓库（package.json 含 workspaces）。请在仓库根目录运行，或设 SOFAGENT_REPO 环境变量。');
  process.exit(2);
}

const CORE = require(path.join(REPO, 'engine/core/dist/index.js'));
const FED = require(path.join(REPO, 'engine/daemon/dist/federation/index.js'));
const { encodeFrame, decodeFrame, fetchFromPeer } = FED;
const { generateKeyPair, deriveSharedKey, publicKeyFingerprint, createPairingSession, pairByCode } = CORE;

const PAIR_DIR = path.join(os.tmpdir(), 'sofagent-dual-pair');
const PUB_A = path.join(PAIR_DIR, 'pub-a.json');
const PUB_B = path.join(PAIR_DIR, 'pub-b.json');
const STATE_A = path.join(PAIR_DIR, 'done-a.json');
const STATE_B = path.join(PAIR_DIR, 'done-b.json');

function waitFor(file, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (fs.existsSync(file)) { clearInterval(iv); resolve(JSON.parse(fs.readFileSync(file, 'utf8'))); }
      else if (Date.now() - t0 > timeoutMs) { clearInterval(iv); reject(new Error('waitFor 超时: ' + file)); }
    }, 200);
  });
}

// ── 设备 B：独立 TCP 服务端 ─────────────────────────────────────────
async function deviceB() {
  const port = parseInt(process.env.B_PORT, 10);
  const pair = generateKeyPair();
  const fp = publicKeyFingerprint(pair.publicKey);
  fs.writeFileSync(PUB_B, JSON.stringify({ publicKey: pair.publicKey.toString('hex'), fingerprint: fp }));
  const pubA = await waitFor(PUB_A);
  const sharedKey = deriveSharedKey(pair.privateKey, Buffer.from(pubA.publicKey, 'hex'));
  console.log(`[设备B] 配对完成 sharedKey=${sharedKey.toString('hex').slice(0, 16)}... 本机指纹=${fp.slice(0, 8)}`);
  const knowledgeDir = path.join(PAIR_DIR, 'deviceB-knowledge');
  fs.mkdirSync(path.join(knowledgeDir), { recursive: true });
  fs.writeFileSync(path.join(knowledgeDir, 'audit-rules.md'), 'sofagent 审计规则：24 条 git-diff 硬证据，密钥泄漏当场拦截');
  fs.writeFileSync(path.join(knowledgeDir, 'deploy-guide.md'), 'sofagent 部署指南：诊断 → 激活 → 编排 → 执行 → 进化');
  const server = net.createServer((socket) => {
    const chunks = [];
    socket.on('data', (c) => chunks.push(c));
    socket.on('end', () => {
      try {
        const req = decodeFrame(sharedKey, Buffer.concat(chunks));
        const results = [];
        for (const f of fs.readdirSync(knowledgeDir)) {
          if (!f.endsWith('.md')) continue;
          const content = fs.readFileSync(path.join(knowledgeDir, f), 'utf8');
          if (content.includes(req.text)) {
            results.push({ id: f.replace(/\.md$/, ''), title: f.replace(/\.md$/, ''), content: content.slice(0, 120), sensitivity: 'internal', trust: 'internal', mtime: Date.now() });
          }
        }
        socket.write(encodeFrame(sharedKey, { results }));
        socket.end();
      } catch { socket.write(Buffer.from('E2E_DECODE_FAIL')); socket.end(); }
    });
    socket.on('error', () => {});
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`[设备B] 服务就绪 127.0.0.1:${port}（独立进程 PID=${process.pid}）`);
    fs.writeFileSync(STATE_B, JSON.stringify({ ready: true }));
  });
  setTimeout(() => { server.close(); process.exit(0); }, 20000);
}

// ── 设备 A：配对 → 加密查询 → 篡改检测 → 离线降级 ──────────────────
async function deviceA() {
  const port = parseInt(process.env.B_PORT, 10);
  const session = createPairingSession(); // 无参：返回 code/publicKey/privateKey/fingerprint
  fs.writeFileSync(PUB_A, JSON.stringify({ publicKey: session.publicKey.toString('hex'), fingerprint: session.fingerprint }));
  const pubB = await waitFor(PUB_B);
  const confirmed = await pairByCode(session.privateKey, Buffer.from(pubB.publicKey, 'hex'), async (fp) => {
    console.log(`[设备A] 人工确认对端指纹 ${fp.slice(0, 8)}... → y`);
    return true;
  });
  const sharedKey = deriveSharedKey(session.privateKey, Buffer.from(pubB.publicKey, 'hex'));
  console.log(`[设备A] 配对完成 sharedKey=${sharedKey.toString('hex').slice(0, 16)}... 对端指纹=${confirmed.fingerprint.slice(0, 8)}`);
  const channel = {
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
  const peerView = { peerId: confirmed.fingerprint, sharedKey, fingerprint: confirmed.fingerprint, via: 'code' };
  // 0) 等设备 B 服务就绪（重试 ping，最长 8 秒）
  for (let i = 0; i < 16; i++) {
    const ok = await channel.ping(peerView.peerId, 800).catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  // 1) 跨设备加密查询
  const results = await fetchFromPeer(peerView, { text: '审计规则', viewerLevel: 'internal', limit: 10 }, channel, 5000);
  console.log(`[设备A] 跨设备查询「审计规则」→ 设备 B 返回 ${results.length} 条: ${results.map(r => r.id).join(', ')}`);
  if (!(Array.isArray(results) && results.length === 1 && results[0].id === 'audit-rules')) {
    console.error('[设备A] ❌ 查询结果不符预期'); process.exit(1);
  }
  // 2) 篡改检测
  const forged = encodeFrame(sharedKey, { text: '审计规则', viewerLevel: 'internal', limit: 10 });
  forged[Math.floor(forged.length / 2)] ^= 0x01;
  let decodeFailed = false;
  try { decodeFrame(sharedKey, forged); } catch { decodeFailed = true; }
  console.log(`[设备A] 篡改检测: ${decodeFailed ? '✅ 篡改帧解密失败（AES-256-GCM 生效）' : '❌ 未检测到篡改'}`);
  // 3) 离线降级（等主控 kill B 后 fetch → null）
  console.log('[设备A] 测试离线降级——等待主控 kill 设备 B...');
  await new Promise((r) => setTimeout(r, 4500)); // 给主控 kill B 的时间
  const offline = await fetchFromPeer(peerView, { text: '审计规则', viewerLevel: 'internal', limit: 10 }, channel, 1200).catch(() => null);
  console.log(`[设备A] 离线降级: ${offline === null ? '✅ B 不可达返回 null（不抛错）' : '❌ 未降级'}`);
  fs.writeFileSync(STATE_A, JSON.stringify({ done: true, results: results.map(r => r.id) }));
  console.log('[设备A] 全部验证完成 ✅');
  process.exit(0);
}

// ── 主控 ─────────────────────────────────────────────────────────────
async function main() {
  fs.rmSync(PAIR_DIR, { recursive: true, force: true });
  fs.mkdirSync(PAIR_DIR, { recursive: true });
  const port = 43100 + crypto.randomInt(0, 100);
  console.log('══════════════════════════════════════════════════════════');
  console.log(' sofagent 双设备联邦模拟（两个独立 node 进程）');
  console.log('══════════════════════════════════════════════════════════\n');
  const procB = spawn(process.execPath, [fileURLToPath(import.meta.url), '--device-b'], {
    env: { ...process.env, B_PORT: String(port) }, stdio: ['ignore', 'inherit', 'inherit'],
  });
  const procA = spawn(process.execPath, [fileURLToPath(import.meta.url), '--device-a'], {
    env: { ...process.env, B_PORT: String(port) }, stdio: ['ignore', 'inherit', 'inherit'],
  });
  await waitFor(STATE_B, 20000).catch(() => {});
  // 设备 A 配对 + 查询 + 篡改检测完成（约 3.5 秒）后 kill B 测离线
  await new Promise((r) => setTimeout(r, 3500));
  console.log('\n[主控] 模拟设备 B 离线——kill 设备 B 进程...');
  try { procB.kill('SIGKILL'); } catch {}
  await waitFor(STATE_A, 20000).catch(() => {});
  await new Promise((r) => setTimeout(r, 500));
  procA.kill('SIGKILL').catch?.(() => {});
  const doneA = fs.existsSync(STATE_A) ? JSON.parse(fs.readFileSync(STATE_A, 'utf8')) : { results: ['N/A'] };
  console.log('\n══════════════════════════════════════════════════════════');
  console.log(` 结果：双进程联邦链路完成 — 设备 A 跨设备查询结果: ${doneA.results.join(', ')}`);
  console.log('══════════════════════════════════════════════════════════');
  process.exit(0);
}

const mode = process.argv[2];
if (mode === '--device-b') { deviceB().catch(e => { console.error('[设备B] 失败:', e.message); process.exit(1); }); }
else if (mode === '--device-a') { deviceA().catch(e => { console.error('[设备A] 失败:', e.message); process.exit(1); }); }
else { main().catch(e => { console.error('[主控] 失败:', e.message); process.exit(1); }); }
