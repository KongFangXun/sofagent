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

// ── S101 · v1.1.8 安全层——AES-GCM 往返 + ECDH 共享密钥 + fingerprint 确定性──
function s101() {
  const { encryptPayload, decryptPayload } = require(process.env.PROJECT_ROOT + '/engine/core/dist/crypto/aes-gcm.js');
  const { generateKeyPair, deriveSharedKey, publicKeyFingerprint } = require(process.env.PROJECT_ROOT + '/engine/core/dist/crypto/ecdh.js');
  const key = require('crypto').randomBytes(32);
  const pt = Buffer.from('sofagent v1.1.8 secret payload', 'utf8');
  const enc = encryptPayload(key, pt);
  const dec = decryptPayload(key, enc.iv, enc.ciphertext, enc.tag);
  if (dec.toString('utf8') !== pt.toString('utf8')) { console.log('AES 往返失败'); process.exit(1); }
  const alice = generateKeyPair();
  const bob = generateKeyPair();
  const aliceShared = deriveSharedKey(alice.privateKey, bob.publicKey);
  const bobShared = deriveSharedKey(bob.privateKey, alice.publicKey);
  if (!aliceShared.equals(bobShared)) { console.log('ECDH 双方共享密钥不一致'); process.exit(1); }
  const fp1 = publicKeyFingerprint(alice.publicKey);
  const fp2 = publicKeyFingerprint(alice.publicKey);
  if (fp1 !== fp2 || fp1.length < 8) { console.log('fingerprint 非确定性或过短'); process.exit(1); }
  console.log('OK');
}

// ── S103 · v1.1.8 安全层——联邦 trustWeightOf sensitivity 过滤（restricted 零权重 / public 正权重）──
function s103() {
  const { trustWeightOf } = require(process.env.PROJECT_ROOT + '/engine/daemon/dist/federation/query-router.js');
  const restrictedItem = { content: 'restricted-secret', sensitivity: 'restricted', trust: 'federation', source: 'peer-a' };
  const publicItem = { content: 'public-info', sensitivity: 'public', trust: 'official', source: 'peer-b' };
  const wRestricted = trustWeightOf(restrictedItem);
  const wPublic = trustWeightOf(publicItem);
  if (wRestricted > 0) { console.log('restricted entity 有正权重 ' + wRestricted + '，安全边界失效'); process.exit(1); }
  if (wPublic <= 0) { console.log('public/official item 权重异常: ' + wPublic); process.exit(1); }
  console.log('OK ' + wRestricted + '/' + wPublic);
}

// ── S148 · v1.2.2 P0 数据主权审计追踪端到端（JSONL→聚合→报告）──
function s148() {
  const { DataSovereigntyLogger } = require(process.env.PROJECT_ROOT + '/engine/audit/dist/data-sovereignty.js');
  const { generateDailyReport, aggregateStats } = require(process.env.PROJECT_ROOT + '/engine/audit/dist/report-generator.js');
  const fs = require('fs'), os = require('os'), path = require('path');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sof-ds-'));
  const logger = new DataSovereigntyLogger(tmpDir);
  logger.append({
    cloudCall: { timestamp: new Date().toISOString(), provider: 'test-provider', model: 'test-model', endpoint: 'https://api.test.com/v1', tokenCount: { input: 100, output: 50 }, purpose: 'testing' },
    localAction: { type: 'tool-call', target: 'test-tool', description: 'acceptance test scenario 148', auditResult: 'PASS' },
    dataFlow: { direction: 'local-only', sensitivity: 'restricted', fields: ['test-field'], destination: 'local-tool', redacted: true },
    taskContext: { taskId: 'test-148', userIntent: 'acceptance test', workflowId: 'test-wf-148' },
  });
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const todayDateStr = yyyy + '-' + mm + '-' + dd;
  const logPath = path.join(tmpDir, 'data', 'audit', 'data-sovereignty', yyyy, mm, todayDateStr + '.jsonl');
  const logExists = fs.existsSync(logPath);
  const logContent = logExists ? fs.readFileSync(logPath, 'utf-8').trim() : '';
  if (!logExists || !logContent.includes('test-148')) { console.log('JSONL 记录写入/读取失败'); process.exit(1); }
  const records = logContent.split('\n').map(l => JSON.parse(l));
  const stats = aggregateStats(records);
  if (!stats || typeof stats.total === 'undefined') { console.log('aggregateStats 聚合失败'); process.exit(1); }
  const report = generateDailyReport(todayDateStr, tmpDir);
  if (!report || !report.markdown || report.markdown.length === 0) { console.log('generateDailyReport 报告生成失败'); process.exit(1); }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('OK JSONL→聚合→报告');
}

// ── S149 · v1.2.2 P1 ModelRouter 路由端到端（public→cloud / restricted→local / confidential≠cloud）──
function s149() {
  const { createDefaultRouter } = require(process.env.PROJECT_ROOT + '/engine/orchestrator/dist/model-router.js');
  const router = createDefaultRouter();
  const routePublic = router.route('hello world, how are you?', {});
  const routeRestricted = router.route('analyze this data', { frontmatter: { sensitivity: 'restricted' } });
  const routeConfidential = router.route('check this', { filePath: 'report.confidential.md' });
  if (!['cloud-strong', 'cloud-fast'].includes(routePublic.target)) { console.log('public 文本未路由到云端: ' + routePublic.target); process.exit(1); }
  if (!['local-executor', 'local-pipeline', 'block'].includes(routeRestricted.target)) { console.log('restricted 数据未路由到本地: ' + routeRestricted.target); process.exit(1); }
  if (['cloud-strong', 'cloud-fast'].includes(routeConfidential.target)) { console.log('confidential 数据路由到云端——安全红线违反: ' + routeConfidential.target); process.exit(1); }
  if (!routePublic.reason) { console.log('路由结果缺少 reason 字段'); process.exit(1); }
  console.log('OK public=' + routePublic.target + ' restricted=' + routeRestricted.target + ' confidential=' + routeConfidential.target);
}

// ── S151 · v1.2.2 P3b 异步 HITL 端到端（shouldUseAsyncHITL 降级 + 请求写入 + 响应读取）──
function s151() {
  const { shouldUseAsyncHITL, writeHITLRequest, readHITLResponse, writeHITLResponse } = require(process.env.PROJECT_ROOT + '/engine/orchestrator/dist/hitl/hitl-channel.js');
  const fs = require('fs'), os = require('os'), path = require('path');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hitl-acc-'));
  const dataDir = path.join(tmpDir, 'data');
  const cpId = 'acc-test-cp-001';
  writeHITLRequest(dataDir, { checkpointId: cpId, createdAt: new Date().toISOString(), task: 'test', reviewReport: '', auditResult: 'PASS', retryCount: 0, options: ['approve', 'reject', 'aborted'] });
  const asyncAfter = shouldUseAsyncHITL(dataDir);
  if (asyncAfter !== true) { console.log('异步 HITL 模式未激活（pending/ 目录创建后 shouldUseAsyncHITL 应返回 true）'); process.exit(1); }
  writeHITLResponse(dataDir, { checkpointId: cpId, decision: 'approve', resolvedAt: new Date().toISOString() });
  const resp = readHITLResponse(dataDir, cpId);
  if (!resp || resp.decision !== 'approve') { console.log('HITL 响应读取失败（期望 approve）'); process.exit(1); }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('OK 降级判断+请求写入+响应读取+批准信号');
}

// ── S152 · v1.2.2 P4 Graph Engine 端到端（Planner 解析 + 降级链路由 + decide/execute 分离）──
function s152() {
  const { parsePlanDecide } = require(process.env.PROJECT_ROOT + '/engine/orchestrator/dist/loop/plan-node.js');
  const { routeAfterAudit } = require(process.env.PROJECT_ROOT + '/engine/orchestrator/dist/loop/graph.js');
  const { computeResultContent } = require(process.env.PROJECT_ROOT + '/engine/orchestrator/dist/loop/engineer-execute.js');
  const plan = parsePlanDecide('{"subtasks":[{"id":"s1","description":"do x"}],"rationale":""}');
  const planCount = plan ? plan.length : 0;
  const planStatus = plan && plan[0] ? plan[0].status : 'missing';
  if (planCount !== 1) { console.log('Planner 解析失败（期望 1 个子任务）'); process.exit(1); }
  if (planStatus !== 'pending') { console.log('Planner 子任务状态错误（期望 pending）'); process.exit(1); }
  if (parsePlanDecide('garbage') !== null) { console.log('Planner 非法 JSON 未返回 null（降级兜底）'); process.exit(1); }
  const routePass = routeAfterAudit({ auditResult: 'PASS', retryCount: 0, degradationLevel: 0, finalStatus: 'running' });
  const routeFailL0 = routeAfterAudit({ auditResult: 'FAIL', retryCount: 1, degradationLevel: 0, finalStatus: 'running' });
  const routeFailL2 = routeAfterAudit({ auditResult: 'FAIL', retryCount: 2, degradationLevel: 2, finalStatus: 'running' });
  const routeFailOver = routeAfterAudit({ auditResult: 'FAIL', retryCount: 3, degradationLevel: 2, finalStatus: 'running' });
  if (routePass !== 'reviewer') { console.log('降级链 PASS 未路由到 reviewer'); process.exit(1); }
  if (routeFailL0 !== 'engineer') { console.log('降级链 FAIL L0 未路由到 engineer'); process.exit(1); }
  if (routeFailL2 !== 'reviewer') { console.log('降级链 FAIL L2 未路由到 reviewer（低可信放行）'); process.exit(1); }
  if (routeFailOver !== 'human_confirm') { console.log('降级链 FAIL 超限未路由到 human_confirm'); process.exit(1); }
  computeResultContent('/tmp/x', 'create', 'hello world'); // decide/execute 分离：纯函数调用不抛即通过
  console.log('OK Planner解析+降级+降级链四路径+decide/execute分离');
}

// ── 调度器 ──────────────────────────────────────────────────
const CASES = { s101, s102, s103, s106, s107, s108, s109, s111, s115, s148, s149, s151, s152 };

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
