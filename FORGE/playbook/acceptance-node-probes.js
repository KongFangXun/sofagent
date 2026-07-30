#!/usr/bin/env node
// ============================================================
// acceptance-node-probes.js · acceptance-test.sh 的 node -e 公共探针库
// v1.2.1 工程债瘦身：把验收脚本里大块内联 node -e 探针抽取为公共函数，
// shell 侧每个场景只保留 1 行调用 + 1 行结果断言。
//
// 用法:
//   ENV_VAR=... node acceptance-node-probes.js <case-name>
//
// 契约（与内联 node -e 时代完全一致）：
//   - 成功：stdout 打印以 "OK" 开头的行，exit 0
//   - 失败：stdout 打印失败原因，exit 1
//   - 模块路径一律经环境变量传入（process.env.XXX_DIR）
// ============================================================
'use strict';

// ── S102 · v1.1.8 安全层——ECDH 配对路径 B（token 带外交换）──
async function s102() {
  const { createPairingSession, pairByToken, computeTokenTag, MIN_TOKEN_LENGTH } = require(process.env.PAIRING_DIR + '/pairing.js');
  const { deriveSharedKey } = require(process.env.PAIRING_DIR + '/ecdh.js');
  const initiator = createPairingSession();
  const responder = createPairingSession();
  const token = 'a'.repeat(MIN_TOKEN_LENGTH + 8);
  const initiatorTag = computeTokenTag(token, initiator.publicKey);
  try {
    const paired = await pairByToken(token, responder.privateKey, initiator.publicKey, initiatorTag);
    if (!paired.peerId || paired.peerId.length < 8) {
      console.log('配对失败或 peerId 异常: ' + paired.peerId); process.exit(1);
    }
    if (!paired.sharedKey || paired.sharedKey.length !== 32) {
      console.log('sharedKey 非 32 字节'); process.exit(1);
    }
    if (paired.via !== 'token') {
      console.log('via 应为 token, 实际 ' + paired.via); process.exit(1);
    }
    const initiatorShared = deriveSharedKey(initiator.privateKey, responder.publicKey);
    if (!paired.sharedKey.equals(initiatorShared)) {
      console.log('配对后共享密钥不一致'); process.exit(1);
    }
    console.log('OK');
  } catch (e) {
    console.log('异常: ' + e.message); process.exit(1);
  }
}

// ── S106 · v1.1.8 编排引擎——compose DAG 调度（detectFileConflicts 同文件冲突检测）──
function s106() {
  const { detectFileConflicts } = require(process.env.ORCH_DIR + '/dag-runner.js');
  const conflictParsed = {
    nodes: [
      { id: 'n1', task: 'write to `src/output.ts` for feature A' },
      { id: 'n2', task: 'update `src/output.ts` for feature B' }
    ]
  };
  const conflicts = detectFileConflicts(conflictParsed);
  if (!conflicts || conflicts.length === 0) {
    console.log('同文件冲突未检出'); process.exit(1);
  }
  if (!conflicts.some(c => c.includes('output.ts'))) {
    console.log('冲突报告不含文件名: ' + JSON.stringify(conflicts)); process.exit(1);
  }
  const cleanParsed = {
    nodes: [
      { id: 'n1', task: 'write to `src/a.ts`' },
      { id: 'n2', task: 'write to `src/b.ts`' }
    ]
  };
  const cleanConflicts = detectFileConflicts(cleanParsed);
  if (cleanConflicts.length > 0) {
    console.log('无冲突场景误报: ' + JSON.stringify(cleanConflicts)); process.exit(1);
  }
  console.log('OK');
}

// ── S107 · v1.1.8 主动通知——pushKnowledgeSummary（material 收集 + summary 构建 + 推送）──
async function s107() {
  const fs = require('fs');
  const { pushKnowledgeSummary, collectSummaryMaterial, buildSummary, NO_DATA_TEXT } = require(process.env.NOTIFY);
  const os = require('os'); const path = require('path');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-s107-'));
  fs.mkdirSync(path.join(tmpDir, '.sofagent', 'knowledge'), { recursive: true });
  const material = collectSummaryMaterial(tmpDir);
  const summary = buildSummary(material);
  if (!summary || summary.length < 5) {
    console.log('summary 构建异常: 长度' + summary.length); process.exit(1);
  }
  let pushedTarget = '';
  let pushedTitle = '';
  const mockPush = async (opts) => {
    pushedTarget = opts.target; pushedTitle = opts.title;
    return true;
  };
  const result = await pushKnowledgeSummary(tmpDir, mockPush);
  if (!result) { console.log('pushKnowledgeSummary 返回 false'); process.exit(1); }
  if (!pushedTarget || !pushedTitle) {
    console.log('mock pushFn 未被正确调用'); process.exit(1);
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('OK ' + pushedTarget);
}

// ── S108 · v1.1.9 USB 签名——HMAC 确定性算法验证（collectFiles + computeUsbSignature 跨平台一致）──
function s108() {
  const { collectFiles, computeUsbSignature } = require(process.env.USB_SIG);
  const crypto = require('crypto'), fs = require('fs'), os = require('os'), path = require('path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 's108-'));
  fs.writeFileSync(path.join(tmp, 'a.txt'), 'hello');
  fs.mkdirSync(path.join(tmp, 'sub'));
  fs.writeFileSync(path.join(tmp, 'sub', 'b.md'), 'world');
  const files = collectFiles(tmp);
  if (files.length !== 2) { console.log('文件数错误: ' + files.length); process.exit(1); }
  if (files[0].relativePath !== 'a.txt' || files[1].relativePath !== 'sub/b.md') {
    console.log('排序或路径错误: ' + JSON.stringify(files.map(f=>f.relativePath))); process.exit(1);
  }
  const key = crypto.randomBytes(32);
  const sig1 = computeUsbSignature(files, key);
  const sig2 = computeUsbSignature(files.slice().reverse(), key);
  if (sig1 !== sig2) { console.log('确定性失败: 顺序不同签名不同'); process.exit(1); }
  if (sig1.length !== 64) { console.log('签名长度错误: ' + sig1.length); process.exit(1); }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('OK ' + sig1.slice(0, 8));
}

// ── S109 · v1.1.9 USB 签名——verifyUsbSignature fail-closed（篡改+缺失+多余+签名缺失）──
function s109() {
  const { collectFiles, writeSignatureManifest, verifyUsbSignature } = require(process.env.USB_SIG);
  const crypto = require('crypto'), fs = require('fs'), os = require('os'), path = require('path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 's109-'));
  fs.writeFileSync(path.join(tmp, 'config.yml'), 'original');
  const key = crypto.randomBytes(32);
  writeSignatureManifest(tmp, key);
  if (!verifyUsbSignature(tmp, key).ok) { console.log('正常验签应通过'); process.exit(1); }
  fs.writeFileSync(path.join(tmp, 'config.yml'), 'tampered');
  const r1 = verifyUsbSignature(tmp, key);
  if (r1.ok || r1.reason !== 'signature-mismatch') { console.log('篡改检测失败: ' + JSON.stringify(r1)); process.exit(1); }
  fs.unlinkSync(path.join(tmp, 'config.yml'));
  const r2 = verifyUsbSignature(tmp, key);
  if (r2.ok || r2.reason !== 'file-missing') { console.log('缺失检测失败: ' + JSON.stringify(r2)); process.exit(1); }
  fs.writeFileSync(path.join(tmp, 'config.yml'), 'original');
  fs.writeFileSync(path.join(tmp, 'extra.txt'), 'unauthorized');
  const r3 = verifyUsbSignature(tmp, key);
  if (r3.ok || r3.reason !== 'file-added') { console.log('多余检测失败: ' + JSON.stringify(r3)); process.exit(1); }
  fs.unlinkSync(path.join(tmp, 'extra.txt'));
  fs.unlinkSync(path.join(tmp, '.sofagent-signature'));
  const r4 = verifyUsbSignature(tmp, key);
  if (r4.ok || r4.reason !== 'signature-missing') { console.log('签名缺失检测失败: ' + JSON.stringify(r4)); process.exit(1); }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('OK all-fail-closed-passed');
}

// ── S111 · v1.1.9 USB knowledge 加密——AES-256-GCM 密文落盘验证（.enc 不含明文）──
function s111() {
  const { encryptKnowledgeFile, parseEncFrame, ENC_FRAME_MAGIC } = require(process.env.USB_KEY);
  const crypto = require('crypto');
  const aesKey = crypto.randomBytes(32);
  const plaintext = Buffer.from('SECRET-DATA-12345 机密内容', 'utf-8');
  const enc = encryptKnowledgeFile(aesKey, plaintext);
  if (!enc.subarray(0, 4).equals(ENC_FRAME_MAGIC)) { console.log('magic 不匹配'); process.exit(1); }
  if (enc.includes(plaintext)) { console.log('密文含明文'); process.exit(1); }
  const parsed = parseEncFrame(enc);
  if (!parsed) { console.log('parseEncFrame 返回 null'); process.exit(1); }
  const { decryptPayload } = require(process.env.PROJECT_ROOT + '/engine/core/dist/index.js');
  const decrypted = decryptPayload(aesKey, parsed.iv, parsed.ciphertext, parsed.tag);
  if (!decrypted.equals(plaintext)) { console.log('解密失败'); process.exit(1); }
  console.log('OK enc=' + enc.length + 'B');
}

// ── S115 · v1.1.9 ab-scheduler judgeAndPromote——候选胜出 promote 逻辑──
async function s115() {
  const { initialState, judgeAndPromote, DEFAULT_PROMOTE_THRESHOLD } = require(process.env.AB_SCH);
  const fs = require('fs'), os = require('os'), path = require('path');
  const tmpHist = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 's115-')), 'ab-history.jsonl');
  const writeMock = (plan, passRate, count) => {
    const lines = [];
    for (let i = 0; i < count; i++) lines.push(JSON.stringify({ plan, task: 't', timestamp: new Date().toISOString(), passed: passRate ? 8 : 2, failed: passRate ? 2 : 8, duration: 100, qualityScore: passRate ? 80 : 20 }));
    fs.writeFileSync(tmpHist, lines.join('\n') + '\n');
  };
  writeMock('A-step-by-step', false, 5);
  writeMock('B-domain', true, 5);
  let s = initialState({ threshold: 5 });
  s = { ...s, candidatePlan: 'B-domain', candidateRunCount: 5, currentRunCount: 5 };
  s = await judgeAndPromote(s, tmpHist, { writeGraphState: () => '/tmp/mock' });
  if (s.consecutiveWins !== 1) { console.log('首次胜出 consecutiveWins 应=1: ' + s.consecutiveWins); process.exit(1); }
  writeMock('B-domain', true, 5);
  s = { ...s, candidatePlan: 'B-domain', candidateRunCount: 5 };
  s = await judgeAndPromote(s, tmpHist, { writeGraphState: () => '/tmp/mock' });
  if (s.currentPlan !== 'B-domain' || s.candidatePlan !== null) { console.log('promote 失败: currentPlan=' + s.currentPlan); process.exit(1); }
  fs.rmSync(path.dirname(tmpHist), { recursive: true, force: true });
  console.log('OK promoted-to=' + s.currentPlan);
}

// ── 调度器 ──────────────────────────────────────────────────
const CASES = { s102, s106, s107, s108, s109, s111, s115 };

async function main() {
  const name = process.argv[2];
  const fn = CASES[name];
  if (!fn) {
    console.log(`未知探针: ${name}（可用: ${Object.keys(CASES).join(', ')}）`);
    process.exit(1);
  }
  await fn();
}

main().catch((e) => {
  console.log('异常: ' + (e && e.message ? e.message : e));
  process.exit(1);
});
