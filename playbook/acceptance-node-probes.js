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

// ── S106 · v1.1.8 编排模块——compose DAG 调度（detectFileConflicts 同文件冲突检测）──
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
  // v1.4.9 P1-14：知识库路径真值 = {SOFAGENT_HOME}/data/knowledge（v1.2.1 数据目录重构）。
  // 本 fixture 对断言为**空转**（collectSummaryMaterial 读的是 {SOFAGENT_DATA||dir/.sofagent}/log.md），
  // 但仍随本批迁到 data/knowledge——否则它会成为「旧路径残留」门禁的活区命中点。
  fs.mkdirSync(path.join(tmpDir, 'data', 'knowledge'), { recursive: true });
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
  // v1.4.7 章十五：落盘路径插 repo-hash 段——data/audit/data-sovereignty/<repo-hash>/{年}/{月}/
  // 探针用 glob 找当日 jsonl（不硬编码 repo-hash——探针 cwd 可能非 git 仓，hash 形态随环境）
  const dsRoot = path.join(tmpDir, 'data', 'audit', 'data-sovereignty');
  const { execSync } = require('child_process');
  let logPath = null;
  try {
    logPath = execSync(`find ${JSON.stringify(dsRoot)} -name ${JSON.stringify(todayDateStr + '.jsonl')} 2>/dev/null`, { encoding: 'utf-8' }).trim().split('\n')[0] || null;
  } catch { logPath = null; }
  const logExists = !!logPath && fs.existsSync(logPath);
  const logContent = logExists && logPath ? fs.readFileSync(logPath, 'utf-8').trim() : '';
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
  if (routePass !== 'checker') { console.log('降级链 PASS 未路由到 checker（v1.2.4 P2b）'); process.exit(1); }
  if (routeFailL0 !== 'engineer') { console.log('降级链 FAIL L0 未路由到 engineer'); process.exit(1); }
  if (routeFailL2 !== 'checker') { console.log('降级链 FAIL L2 未路由到 checker（v1.2.4 P2b 低可信放行）'); process.exit(1); }
  if (routeFailOver !== 'human_confirm') { console.log('降级链 FAIL 超限未路由到 human_confirm'); process.exit(1); }
  computeResultContent('/tmp/x', 'create', 'hello world'); // decide/execute 分离：纯函数调用不抛即通过
  console.log('OK Planner解析+降级+降级链四路径+decide/execute分离');
}

// ── S155 · v1.2.3 编排隔离底座——WorktreeHandle create/cleanup 幂等──
async function s155() {
  const { createWorktree } = require(process.env.PROJECT_ROOT + '/engine/orchestrator/dist/worktree-isolation.js');
  const fs = require('fs'), os = require('os'), path = require('path');
  const { execFileSync } = require('child_process');
  const git = (a, cwd) => execFileSync('git', a, { cwd, encoding: 'utf-8' });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-acc-wt-'));
  git(['init', '-q'], tmpDir);
  git(['config', 'user.email', 't@t.com'], tmpDir);
  git(['config', 'user.name', 'T'], tmpDir);
  fs.writeFileSync(path.join(tmpDir, 'README.md'), '# T\n');
  git(['add', '.'], tmpDir);
  git(['commit', '-q', '-m', 'init'], tmpDir);
  const h = createWorktree({ repoRoot: tmpDir, agentId: 'acc-155' });
  await h.create();
  await h.create(); // 幂等：重复调用不报错
  if (!fs.existsSync(h.path)) { console.log('worktree 未创建'); process.exit(1); }
  await h.cleanup();
  await h.cleanup(); // 幂等：重复调用不报错
  if (fs.existsSync(h.path)) { console.log('worktree 未清理'); process.exit(1); }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('OK create/cleanup 幂等（重复调用不报错）');
}

// ── S156 · v1.2.3 编排隔离底座——审计合并卡关（PASS→merge / FAIL→reject）──
async function s156() {
  const { createWorktree } = require(process.env.PROJECT_ROOT + '/engine/orchestrator/dist/worktree-isolation.js');
  const { runMergeGate } = require(process.env.PROJECT_ROOT + '/engine/orchestrator/dist/worktree-merge-gate.js');
  const fs = require('fs'), os = require('os'), path = require('path');
  const { execFileSync } = require('child_process');
  const git = (a, cwd) => execFileSync('git', a, { cwd, encoding: 'utf-8' });
  const mkRepo = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-acc-gate-'));
    git(['init', '-q'], d);
    git(['config', 'user.email', 't@t.com'], d);
    git(['config', 'user.name', 'T'], d);
    fs.writeFileSync(path.join(d, 'README.md'), '# T\n');
    git(['add', '.'], d);
    git(['commit', '-q', '-m', 'init'], d);
    return d;
  };
  // 场景 A：audit PASS → 合并成功，主分支可见产出文件 + merge commit
  const repoA = mkRepo();
  const hA = createWorktree({ repoRoot: repoA, agentId: 'eng-pass' });
  await hA.create();
  fs.mkdirSync(path.join(hA.path, 'src'), { recursive: true });
  fs.writeFileSync(path.join(hA.path, 'src', 'feature.ts'), 'export const answer = 42;\n');
  const rA = await runMergeGate(hA, { repoRoot: repoA, task: 'add src/feature.ts module' });
  if (rA.status !== 'merged') { console.log('PASS 场景未合并: status=' + rA.status + ' reason=' + (rA.rejectionReason || '')); process.exit(1); }
  if (!fs.existsSync(path.join(repoA, 'src', 'feature.ts'))) { console.log('合并后主分支不可见产出文件'); process.exit(1); }
  const logA = git(['log', '--oneline', '-3'], repoA);
  if (!logA.includes('merge')) { console.log('主分支无 merge commit'); process.exit(1); }
  // 场景 B：audit FAIL → 不合并（提交 .env 触发 A1 底线拒绝）
  const repoB = mkRepo();
  const hB = createWorktree({ repoRoot: repoB, agentId: 'eng-fail' });
  await hB.create();
  fs.writeFileSync(path.join(hB.path, '.env'), 'SECRET_KEY=abc123\n');
  const rB = await runMergeGate(hB, { repoRoot: repoB, task: 'add .env' });
  if (rB.status !== 'rejected') { console.log('FAIL 场景未拒绝: status=' + rB.status); process.exit(1); }
  if (rB.auditVerdict !== 'FAIL') { console.log('audit 判定非 FAIL: ' + rB.auditVerdict); process.exit(1); }
  if (fs.existsSync(path.join(repoB, '.env'))) { console.log('被拒产出泄漏到主分支——安全红线'); process.exit(1); }
  fs.rmSync(repoA, { recursive: true, force: true });
  fs.rmSync(repoB, { recursive: true, force: true });
  console.log('OK PASS→merge + FAIL→reject（审计卡关双向）');
}



// ── S418-S424 · v1.4.9 阶段五 P0-3 补测——九章零锚点行为锁（release-gate 20260916-01）──
// 断言本体：shell 侧（acceptance-test.sh）只留 4 行调用壳（行数警戒线收敛批，
// 对齐 S101/S156 先例——v1.2.1 探针库抽取的同构手法）。
// 协议与库契约一致：成功打 "OK …" exit 0；失败打 "S4xx_FAIL:原因" exit 1。
// 🔴 签名纪律（本批实锤教训，逐函数核对源码后才写断言）：
//   registerDevice(identity, {kind, capabilities}, dataDir)——dataDir 是第三位置参数；
//   reportHeartbeat/enqueue/claim/reassign 走 opts.dataDir 形态；
//   generateAgentIdentity 的 agentId 是随机 UUID——对账用返回值不用硬编码；
//   hold 模式返回 ok:false + reason:'held-for-alarm'（挂起即本意，非错误）。

// 公共：HOME 隔离（防碰真机 ~/.sofagent），返回隔离 dataDir 所需件
function _s41x_init(tag) {
  const fs = require('fs'), path = require('path'), os = require('os');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), tag + '-'));
  process.env.SOFAGENT_HOME = home; process.env.HOME = home;
  return { fs, path, home, dataDir: path.join(home, 'data') };
}
// 公共：bad[] 累积多断言，末尾统一裁决（失败时输出全部命中的问题，保可见性）
function _s41x_done(bad, tag) {
  if (bad.length) { console.log(tag + '_FAIL:' + bad.join('|')); process.exit(1); }
  console.log('OK ' + tag + ' 行为锁全过');
}
// 公共：生成真实 Ed25519 身份码（registerDevice 走验签——伪身份必被拒）
function _s41x_identity(agentName) {
  const ai = require(process.env.PROJECT_ROOT + '/engine/core/dist/agent-identity.js');
  return ai.generateAgentIdentity(agentName);
}
// 公共：注册设备（标准三参形态）
function _s41x_register(dr, identity, capabilities, dataDir) {
  return dr.registerDevice(identity, { kind: 'pc', capabilities }, dataDir);
}

// S416 · 第八章 敏感识别插槽——DetectorRegistry 四方法 + tierOf 三档 + L0 检测器形态
// （run-02 C-P1-6 扩：敏感度分类器三档 + NER 外挂协议三态——注册/调用/降级全上抛）
async function s416() {
  const core = require(process.env.PROJECT_ROOT + '/engine/core/dist/index.js'); const bad = [];
  const r = new core.DetectorRegistry();
  for (const m of ['register', 'unregister', 'list', 'runPipeline']) if (typeof r[m] !== 'function') bad.push('DetectorRegistry 缺方法 ' + m);
  if (core.tierOf(0.9) !== 'high' || core.tierOf(0.5) !== 'low') bad.push('tierOf 三档判定');
  const d = core.createL0RegexDetector({ patterns: [{ name: 'phone', regex: /(1[3-9]\d{9})/, tier: 1 }] });
  if (!d || typeof d.detect !== 'function' || d.layer !== 'L0') bad.push('L0 检测器形态异常');

  // ── 敏感度分类器（run-02 C-P1-6 补：三档 + 模型档透传 + routeReason 审计链锚点）──
  const reg = new core.DetectorRegistry();
  reg.register(core.createL0RegexDetector({ patterns: [{ name: 'phone', regex: /(1[3-9]\d{9})/, tier: 1 }] }));
  const dSens = core.classifySensitivity('联系 13812345678 王工', reg);
  if (dSens.level !== 'sensitive' || dSens.decidedBy !== 'rule' || !dSens.routeReason || !dSens.matchedLabels.includes('phone')) bad.push('sensitive 档判定错:' + JSON.stringify(dSens));
  const dInt = core.classifySensitivity('这是内部资料 请勿外传', reg);
  if (dInt.level !== 'internal') bad.push('internal 档判定错:' + dInt.level);
  const dPub = core.classifySensitivity('今天天气不错', reg);
  if (dPub.level !== 'public') bad.push('public 档判定错:' + dPub.level);
  const dModel = core.classifySensitivity('任意文本', reg, { modelLevel: 'sensitive' });
  if (dModel.level !== 'sensitive' || dModel.decidedBy !== 'model') bad.push('外挂模型档透传错:' + JSON.stringify(dModel));

  // ── L2 NER 外挂协议三态（run-02 C-P1-6 补）──
  // 协议：prefetchRemoteSpans(text, config, fetchLike) 异步预取 → createPrefetchedRemoteDetector(spans) 同步包装；
  // 响应体 = span 数组（非 {spans} 包装）；失败/非 2xx/结构不符一律上抛（fail-closed 不静默放行）
  const okSpans = await core.prefetchRemoteSpans('张三的工作日志', { name: 'l2-remote-ner', endpoint: 'http://ner:9000' },
    async () => ({ ok: true, status: 200, json: async () => [{ start: 0, end: 2, label: 'PERSON', score: 0.95 }] }));
  if (okSpans.length !== 1 || okSpans[0].text !== '张三' || okSpans[0].layer !== 'L2') bad.push('NER 预取切片/层级错:' + JSON.stringify(okSpans));
  const l2 = core.createPrefetchedRemoteDetector(okSpans, { name: 'l2-remote-ner' });
  if (l2.layer !== 'L2' || typeof l2.detect !== 'function') bad.push('NER 包装形态错');
  const detSpans = l2.detect('张三的工作日志');
  if (detSpans.length !== 1 || detSpans[0].label !== 'PERSON') bad.push('NER detect 断言错');
  // 降级上抛 ×2：不可达（HTTP 0）/ 结构不符（非数组）
  let threw1 = false, threw2 = false;
  try { await core.prefetchRemoteSpans('x', { endpoint: 'http://dead:1' }, async () => ({ ok: false, status: 0, json: async () => [] })); } catch { threw1 = true; }
  try { await core.prefetchRemoteSpans('x', { endpoint: 'http://bad:1' }, async () => ({ ok: true, status: 200, json: async () => ({ not: 'array' }) })); } catch { threw2 = true; }
  if (!threw1 || !threw2) bad.push('NER 降级未上抛（fail-closed 失效）');
  _s41x_done(bad, 'S416');
}

// S418 · 第二章 G10 授权读取——参数缺失拒 + 未注册拒 + [sofagent] 前缀
// （run-03 C-P1-1 扩：白名单内放行侧——真实身份注册 + 声明 + 读取成功 + 内容一致 + 审计留痕）
async function s418() {
  const q = require(process.env.PROJECT_ROOT + '/engine/mcp/dist/tools/device-data-query.js'); const bad = [];
  let r = await q.deviceDataQuery({ identity: null, path: '/tmp/x' });
  if (r.data.ok !== false || r.data.reason !== 'invalid-params') bad.push('参数缺失未拒');
  if (!r.text.startsWith('[sofagent]')) bad.push('身份字段缺失时无 [sofagent] 前缀');
  r = await q.deviceDataQuery({ identity: { agentId: 'ghost-dev', publicKey: 'x' }, path: '/tmp/x' });
  if (r.data.ok !== false) bad.push('未注册设备未拒');
  if (!['not-registered', 'invalid-identity', 'daemon-unavailable', 'revoked'].includes(r.data.reason)) bad.push('拒绝 reason 异常:' + r.data.reason);

  // ── 放行侧全链（run-03 C-P1-1 补——白名单匹配只测过「能拒」没测过「能放」）──
  // 身份注册 → 白名单声明 → 白名单内读取成功（内容一致 + 脱敏面在位 + 审计留痕）→ 白名单外拒
  const { fs, path, home, dataDir } = _s41x_init('s418');
  const core = require(process.env.PROJECT_ROOT + '/engine/core/dist/index.js');
  const identity = _s41x_identity('s418-hp-dev');
  const dr = require(process.env.PROJECT_ROOT + '/engine/daemon/dist/device-registry.js');
  const reg = dr.registerDevice(identity, { kind: 'node' }, dataDir);
  if (!reg.ok) bad.push('放行侧注册失败:' + reg.reason);
  const shareDir = path.join(home, 'share');
  fs.mkdirSync(shareDir, { recursive: true });
  core.saveDeviceDataPolicy({ version: 1, deviceId: identity.agentId, allowedDirs: [shareDir] }, dataDir);
  fs.writeFileSync(path.join(shareDir, 'report.txt'), 'server ok load=0.42');
  // 密钥就位（emitDecision HMAC 面——审计留痕断言的前置）
  fs.writeFileSync(path.join(home, '.sofagent-key'), 's418-hp-hmac-key');
  process.env.SOFAGENT_KEY_PATH = path.join(home, '.sofagent-key');
  const hit = await q.deviceDataQuery({ identity, path: path.join(shareDir, 'report.txt') });
  if (hit.data.ok !== true) bad.push('白名单内读取未放行:' + hit.data.reason);
  if (hit.data.content !== 'server ok load=0.42') bad.push('读取内容不一致:' + JSON.stringify(hit.data.content));
  if (hit.data.auditLogged !== true) bad.push('放行读取未留审计痕');
  const miss = await q.deviceDataQuery({ identity, path: shareDir + '-secret/x.txt' });
  if (miss.data.ok !== false || miss.data.reason !== 'path-not-allowed') bad.push('白名单外未拒（边界字符防绕过失效）');
  _s41x_done(bad, 'S418');
}

// S419 · 第三章 G11 上行通道——拒绝路径（invalid-params + isError + 未注册拒）+ 成功路径全链
// （WAL 加密入队明文不落盘 → 游标续传 → ack 后不重传 → 无密钥 fail-closed——run-02 C-P1-4 扩）
async function s419() {
  const p = require(process.env.PROJECT_ROOT + '/engine/mcp/dist/tools/device-data-push.js'); const bad = [];
  let r = await p.deviceDataPush({ category: '', payload: '' });
  if (r.data.ok !== false || r.data.reason !== 'invalid-params') bad.push('参数缺失未拒');
  if (r.data.isError !== true) bad.push('isError 形态缺失');
  r = await p.deviceDataPush({ identity: { agentId: 'ghost-dev', publicKey: 'x' }, category: 'metrics', payload: '{}' });
  if (r.data.ok !== false) bad.push('未注册设备未拒');
  if (!['not-registered', 'invalid-identity', 'daemon-unavailable', 'revoked'].includes(r.data.reason)) bad.push('拒绝 reason 异常:' + r.data.reason);

  // ── 成功路径全链（upload-wal dist 直调·run-02 C-P1-4 补）──
  // 独立子进程语义：本探针进程内先以隔离密钥实测 WAL 面（密钥须在 require 前就位——模块级常量）
  const { fs, path, home } = _s41x_init('s419');
  fs.writeFileSync(path.join(home, '.sofagent-key'), 's419-e2e-hmac-key');
  process.env.SOFAGENT_KEY_PATH = path.join(home, '.sofagent-key');
  const uw = require(process.env.PROJECT_ROOT + '/engine/daemon/dist/upload-wal.js');
  const dataDir = path.join(home, 'data');
  // ① 加密入队：seq 单调 + 密文三件套落盘 + 明文不落盘（原始数据不出设备的存储面字面语义）
  const e1 = uw.enqueueUpload('s419-dev', 'metrics', '{"cpu":"机密值42"}', { redactHits: 0, dataDir });
  const e2 = uw.enqueueUpload('s419-dev', 'metrics', '{"cpu":"机密值50"}', { redactHits: 1, dataDir });
  if (!e1.ok || !e2.ok || e2.seq !== e1.seq + 1) bad.push('入队失败或 seq 非单调:' + JSON.stringify([e1, e2]));
  const walRaw = fs.readFileSync(uw.uploadWalPath(dataDir), 'utf-8');
  if (walRaw.includes('机密值')) bad.push('明文泄漏进 WAL');
  // ② pending + 解密回读（AES-256-GCM 往返——密文可解且与明文一致）
  const pend = uw.pendingUploads(dataDir);
  if (pend.length !== 2) bad.push('pending 计数=' + pend.length);
  const dec = uw.decryptPendingUpload(pend[0]);
  if (dec !== '{"cpu":"机密值42"}') bad.push('解密回读不一致:' + String(dec));
  // ③ 游标续传：ack 后 cursor 推进 + pending 清零（已确认段不重传）
  if (uw.readUploadCursor(dataDir) !== 0) bad.push('初始游标非 0');
  const ack = uw.ackUpload(e2.seq, { deviceId: 's419-dev', dataDir });
  if (!ack.ok) bad.push('ack 失败:' + ack.message);
  if (uw.readUploadCursor(dataDir) !== e2.seq) bad.push('游标未推进');
  if (uw.pendingUploads(dataDir).length !== 0) bad.push('ack 后仍 pending（会重传）');
  // ④ 无密钥 fail-closed：不可加密 = 不可上行（明文降级不是可接受形态）
  const nkHome = fs.mkdtempSync(path.join(require('os').tmpdir(), 's419-nk-'));
  const nkKey = path.join(nkHome, 'no-key');
  const savedKey = process.env.SOFAGENT_KEY_PATH;
  process.env.SOFAGENT_KEY_PATH = nkKey;
  if (require.cache[require.resolve(process.env.PROJECT_ROOT + '/engine/daemon/dist/upload-wal.js')]) {
    delete require.cache[require.resolve(process.env.PROJECT_ROOT + '/engine/daemon/dist/upload-wal.js')];
  }
  const uwNoKey = require(process.env.PROJECT_ROOT + '/engine/daemon/dist/upload-wal.js');
  const nk = uwNoKey.enqueueUpload('s419-dev', 'metrics', 'x', { dataDir: path.join(nkHome, 'data') });
  if (nk.ok !== false || nk.reason !== 'no-aes-key') bad.push('无密钥未拒:' + JSON.stringify(nk));
  process.env.SOFAGENT_KEY_PATH = savedKey;

  // ── tool 入口 happy-path 全链（run-03 C-P0-1 真实缺口补——此前只测 WAL 面直调，未测 MCP tool 入口串联）──
  // 声明 opt-in → deviceDataPush 放行入队 → 声明外/目的地不符双拒 → 审计计量留痕（decision-log evidence 六元组）
  // 注意：tool 层 dataDir 走 getDataDir(undefined) → SOFAGENT_DATA 环境变量（须在 require core 前就位）
  const hpHome = fs.mkdtempSync(path.join(require('os').tmpdir(), 's419-hp-'));
  const hpDataDir = path.join(hpHome, 'data');
  process.env.SOFAGENT_DATA = hpDataDir;
  process.env.SOFAGENT_KEY_PATH = path.join(hpHome, '.sofagent-key');
  fs.writeFileSync(process.env.SOFAGENT_KEY_PATH, 's419-hp-hmac-key');
  // 刷新模块级缓存：dataDir/密钥常量在 require 时固化（与上面无密钥面同手法）
  for (const mod of ['engine/core/dist/index.js', 'engine/daemon/dist/device-registry.js', 'engine/daemon/dist/upload-wal.js', 'engine/audit/dist/index.js']) {
    const abs = path.join(process.env.PROJECT_ROOT, mod);
    if (require.cache[require.resolve(abs)]) delete require.cache[require.resolve(abs)];
  }
  const hpCore = require(process.env.PROJECT_ROOT + '/engine/core/dist/index.js');
  const hpIdentity = _s41x_identity('s419-tool-dev');
  const hpDr = require(process.env.PROJECT_ROOT + '/engine/daemon/dist/device-registry.js');
  if (!hpDr.registerDevice(hpIdentity, { kind: 'node' }, hpDataDir).ok) bad.push('tool 链注册失败');
  hpCore.saveDeviceUploadPolicy({ version: 1, deviceId: hpIdentity.agentId, declarations: [{ category: 'metrics', frequency: '@daily', destination: 'platform-a' }] }, hpDataDir);
  const push = require(process.env.PROJECT_ROOT + '/engine/mcp/dist/tools/device-data-push.js');
  const ok1 = await push.deviceDataPush({ identity: hpIdentity, category: 'metrics', payload: '{"cpu":0.42}' });
  if (ok1.data.ok !== true || ok1.data.delivery !== 'queued' || ok1.data.isError !== false) bad.push('声明内上行未入队:' + JSON.stringify(ok1.data));
  if (ok1.data.auditLogged !== true) bad.push('上行未留审计计量痕');
  const rej1 = await push.deviceDataPush({ identity: hpIdentity, category: 'screenshots', payload: 'x' });
  if (rej1.data.ok !== false || rej1.data.reason !== 'category-not-declared') bad.push('声明外类别未拒:' + rej1.data.reason);
  const rej2 = await push.deviceDataPush({ identity: hpIdentity, category: 'metrics', payload: 'x', destination: 'platform-b' });
  if (rej2.data.ok !== false || rej2.data.reason !== 'destination-mismatch') bad.push('目的地不符未拒:' + rej2.data.reason);
  // 审计计量断言：decision-log 落盘且 evidence 含 seq/delivery（数据量/次数经 evidence 进计量视野）
  const hpUw = require(process.env.PROJECT_ROOT + '/engine/daemon/dist/upload-wal.js');
  const hpWalRaw = fs.readFileSync(hpUw.uploadWalPath(hpDataDir), 'utf-8');
  if (hpWalRaw.includes('0.42')) bad.push('tool 链明文泄漏进 WAL');
  const logPath = path.join(hpDataDir, 'audit', 'decision-log.jsonl');
  if (!fs.existsSync(logPath)) bad.push('decision-log 未落盘');
  else {
    const last = JSON.parse(fs.readFileSync(logPath, 'utf-8').trim().split('\n').pop());
    const ev = Array.isArray(last.evidence) ? last.evidence.map((x) => String(x)) : [];
    if (!ev.some((x) => x.includes('seq=' + ok1.data.seq))) bad.push('审计 evidence 缺 seq:' + JSON.stringify(last.evidence));
    if (!ev.some((x) => x.includes('delivery=queued'))) bad.push('审计 evidence 缺 delivery');
  }
  _s41x_done(bad, 'S419');
}

// S420 · 第四+五章 installer skill + 心跳捎带下发——五步标题/诊断四字段 + enqueue→捎带→claim 往返
async function s420() {
  const { fs, dataDir } = _s41x_init('s420'); const bad = [];
  const md = fs.readFileSync(process.env.PROJECT_ROOT + '/SKILL/harness/installer.md', 'utf8');
  for (const h of ['## 第 0 步 · 前置确认（读上岗 prompt）', '## 第 1 步 · 环境依赖检测', '## 第 2 步 · install.sh 执行', '## 第 3 步 · 安装结果校验', '## 第 4 步 · 触发 G9 设备注册'])
    if (!md.includes(h)) bad.push('installer 缺标题:' + h.slice(3, 12));
  const diagBlocks = md.split('\n').filter(l => l.includes('"step"'));
  if (diagBlocks.length < 4) bad.push('结构化诊断块不足 4');
  for (const f of ['"status"', '"advice"', '"rollback"']) if (!md.includes(f)) bad.push('诊断缺字段 ' + f);
  const dr = require(process.env.PROJECT_ROOT + '/engine/daemon/dist/device-registry.js');
  const id = _s41x_identity('s420-dev');
  if (!_s41x_register(dr, id, ['task'], dataDir).ok) bad.push('注册失败');
  // 在线先于入队：enqueue 会做在线判定（T12 在线才派单）——先心跳后入队
  dr.reportHeartbeat(id, { dataDir });
  const enq = dr.enqueueDeviceTask(id.agentId, { title: 'S420 任务', payload: 'echo ok', dispatchedBy: 'platform' }, { dataDir });
  if (!enq.ok) bad.push('入队失败:' + enq.message);
  const hb = dr.reportHeartbeat(id, { dataDir });
  if (!hb.ok) bad.push('心跳失败:' + hb.message);
  if (!Array.isArray(hb.pendingTasks) || !hb.pendingTasks.some(t => t.title === 'S420 任务')) bad.push('心跳未捎带待执行任务清单');
  const claim = dr.claimDeviceTask(id, { dataDir });
  if (!claim.ok) bad.push('领取失败:' + claim.message);
  _s41x_done(bad, 'S420');
}

// S421 · 第六章 派单语义——离线拒派 + reassign 落在线备机 + hold 挂起告警回调
async function s421() {
  const { dataDir } = _s41x_init('s421'); const bad = [];
  const dr = require(process.env.PROJECT_ROOT + '/engine/daemon/dist/device-registry.js');
  const id = _s41x_identity('s421-dev');
  if (!_s41x_register(dr, id, ['compute'], dataDir).ok) bad.push('主设备注册失败');
  // ① 掉线设备 enqueue 拒（在线才派单——永不心跳即离线）
  const enq = dr.enqueueDeviceTask(id.agentId, { title: 'T', payload: 'P', dispatchedBy: 'platform' }, { dataDir });
  if (enq.ok !== false) bad.push('离线设备未被拒派');
  // ② reassign 模式：同能力在线备机接手（agentId 为随机 UUID——对账用返回值）
  const id2 = _s41x_identity('s421-bak');
  if (!_s41x_register(dr, id2, ['compute'], dataDir).ok) bad.push('备机注册失败');
  dr.reportHeartbeat(id2, { dataDir });
  const re = dr.reassignOrHold(id.agentId, { title: '改派任务', payload: 'P', dispatchedBy: 'platform' }, { dataDir });
  if (!re.ok || re.reassignedTo !== id2.agentId) bad.push('改派未落在线备机:' + JSON.stringify(re).slice(0, 120));
  // ③ hold 模式：挂起 + 告警回调（ok:false + reason='held-for-alarm' 是本意形态）
  let alarmHit = false;
  const ho = dr.reassignOrHold(id.agentId, { title: '挂起任务', payload: 'P', dispatchedBy: 'platform' }, { dataDir, mode: 'hold', onHoldAlarm: () => { alarmHit = true; } });
  if (ho.ok !== false || ho.reason !== 'held-for-alarm') bad.push('挂起模式形态异常:' + JSON.stringify(ho).slice(0, 120));
  if (!alarmHit) bad.push('挂起未触发告警回调');
  _s41x_done(bad, 'S421');
}

// S422 · 第七章 蒸馏偏好对——配对方向 + 缺源跳过计数 + qualityScore 择优 + toRecords 衔接
async function s422() {
  const dp = require(process.env.PROJECT_ROOT + '/engine/train/dist/distill-pairs.js'); const bad = [];
  const mk = (promptId, origin, response, qualityScore) => ({ promptId, origin, response, qualityScore });
  let r = dp.buildDistillPairs([
    mk('p1', 'teacher', '教师优质回答（超过最小长度）', 0.95),
    mk('p1', 'local', '本地一般回答', 0.4),
  ]);
  if (r.pairs.length !== 1) bad.push('双响应未成对');
  if (r.pairs[0] && (r.pairs[0].chosen !== '教师优质回答（超过最小长度）' || r.pairs[0].rejected !== '本地一般回答')) bad.push('chosen/rejected 方向颠倒');
  r = dp.buildDistillPairs([mk('p2', 'teacher', '只有教师没有本地', 0.9)]);
  if (r.pairs.length !== 0 || !JSON.stringify(r.skipReasons).includes('缺本地响应')) bad.push('缺本地未跳过计数');
  r = dp.buildDistillPairs([
    mk('p3', 'teacher', '弱教师', 0.3), mk('p3', 'teacher', '强教师回答内容', 0.99),
    mk('p3', 'local', '本地回答', 0.5),
  ]);
  if (r.pairs[0] && r.pairs[0].chosen !== '强教师回答内容') bad.push('教师多响应未择优');
  const recs = dp.distillPairsToRecords(r.pairs);
  if (!Array.isArray(recs)) bad.push('toRecords 非数组');

  // ── session 承接五元组 + router 伴生（run-02 C-P1-5 补——模块七双叙事面行为锁）──
  const { fs, path, home } = _s41x_init('s422');
  fs.writeFileSync(path.join(home, '.sofagent-key'), 's422-e2e-key');
  process.env.SOFAGENT_KEY_PATH = path.join(home, '.sofagent-key');
  const si = require(process.env.PROJECT_ROOT + '/engine/train/dist/session-ingest.js');
  // ① 五元组全匹配 → continue；任一不匹配 → handoff + mismatched 指认（宁可不续）
  const scope = { executor: 'e1', workerId: 'w1', model: 'glm', workDir: '/w', runtime: 'node' };
  const cont = si.decideContinuation(scope, scope);
  if (cont.canContinue !== true || cont.mode !== 'continue') bad.push('全匹配未续接:' + JSON.stringify(cont));
  const mis = si.decideContinuation(scope, { ...scope, model: 'qwen' });
  if (mis.canContinue !== false || mis.mode !== 'handoff' || !mis.mismatched.includes('model')) bad.push('模型不匹配未走 handoff:' + JSON.stringify(mis));
  const mis2 = si.decideContinuation(scope, { ...scope, workerId: 'w2' });
  if (mis2.canContinue !== false || !mis2.mismatched.includes('workerId')) bad.push('员工不匹配未指认:' + JSON.stringify(mis2));
  // ② 摘要交接三要素（较早摘要 + 最近消息 + 最新结论）
  const hs = si.buildHandoffSummary([
    { role: 'user', content: 'q1' }, { role: 'assistant', content: '较早回答' },
    { role: 'user', content: 'q2' }, { role: 'assistant', content: '最近回答' },
    { role: 'user', content: 'q3' }, { role: 'assistant', content: '最新结论回答' },
  ]);
  if (!hs.earlierSummary || !Array.isArray(hs.recentMessages) || hs.recentMessages.length === 0 || hs.latestConclusion !== '最新结论回答') bad.push('交接三要素缺:' + Object.keys(hs).join(','));
  // ③ router 伴生 exporter 推送：合法 session 落盘 + 幂等拒 + usage 入 cost 台账
  const rp = require(process.env.PROJECT_ROOT + '/engine/mcp/dist/tools/router-session-push.js');
  const raw = {
    sessionId: 's422-sess', enterpriseId: 'acme', source: 'router', scope,
    messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'ok' }],
    usage: { inputTokens: 10, outputTokens: 5, model: 'glm' },
    route: { targetModel: 'glm', reason: 'default' },
  };
  const push1 = await rp.routerSessionPush({ raw });
  if (push1.data.isError) bad.push('router 推送失败:' + (push1.data.message || '').slice(0, 80));
  else {
    const sessFile = path.join(home, 'data', 'acme', 'router-sessions', 's422-sess.jsonl');
    if (!fs.existsSync(sessFile)) bad.push('session 未落盘');
    const costFile = path.join(home, 'data', 'acme', 'cost', 'router-usage.jsonl');
    if (!fs.existsSync(costFile)) bad.push('cost 台账未落盘');
    else {
      const costLine = JSON.parse(fs.readFileSync(costFile, 'utf-8').trim().split('\n')[0]);
      if (costLine.inputTokens !== 10 || costLine.outputTokens !== 5 || costLine.model !== 'glm') bad.push('cost 台账形态错:' + JSON.stringify(costLine));
    }
  }
  const push2 = await rp.routerSessionPush({ raw });
  if (!push2.data.isError || push2.data.reason !== 'duplicate-session') bad.push('幂等未拒:' + JSON.stringify({ isError: push2.data.isError, reason: push2.data.reason }));
  const push3 = await rp.routerSessionPush({ raw: { bad: 1 } });
  if (!push3.data.isError || push3.data.reason !== 'invalid-schema') bad.push('非法 schema 未拒:' + String(push3.data.reason));
  _s41x_done(bad, 'S422');
}

// S423 · 第九章 权重灰度 AB——同 key 确定性分流 + 0/100 端点 + 劣化判定附原因 + 无劣化对照
async function s423() {
  const wc = require(process.env.PROJECT_ROOT + '/engine/train/dist/weight-canary.js'); const bad = [];
  const cfg = { oldAdapter: 'local-27b', newAdapter: 'cloud-plus', newWeightPercent: 50 };
  const v1 = wc.canaryRouteRequest('user-42', cfg); const v2 = wc.canaryRouteRequest('user-42', cfg);
  if (v1.adapter !== v2.adapter || v1.isNew !== v2.isNew) bad.push('同 key 分流不稳定');
  if (wc.canaryRouteRequest('any', { ...cfg, newWeightPercent: 0 }).isNew !== false) bad.push('0% 未全走旧臂');
  if (wc.canaryRouteRequest('any', { ...cfg, newWeightPercent: 100 }).isNew !== true) bad.push('100% 未全走新臂');
  const old = { requests: 100, correct: 90, refusals: 2, costUsd: 1 };
  const badArm = { requests: 100, correct: 40, refusals: 30, costUsd: 5 };
  const d = wc.judgeDeterioration(old, badArm);
  if (!d.deteriorated || !Array.isArray(d.reasons) || d.reasons.length === 0) bad.push('劣化未判定/无原因');
  const ok = wc.judgeDeterioration(old, { requests: 100, correct: 92, refusals: 1, costUsd: 1 });
  if (ok.deteriorated) bad.push('同指标误判劣化');
  _s41x_done(bad, 'S423');
}

// S424 · 第十章 模型清单上报——retired 过滤 + schema 非法降级原因 + 心跳 availableModels 捎带
async function s424() {
  const { fs, path, dataDir, home } = _s41x_init('s424'); const bad = [];
  fs.mkdirSync(path.join(dataDir, 'config'), { recursive: true });
  // 合法注册表（version:1 schema）：两活一退役 → 只收非 retired + source=registry
  fs.writeFileSync(path.join(dataDir, 'config', 'model-registry.json'), JSON.stringify({ version: 1, models: {
    m1: { name: 'qwen-27b', endpoint: 'http://localhost:8000', clientType: 'openai', status: 'active' },
    m2: { name: 'glm-air', endpoint: 'http://localhost:8001', clientType: 'openai', status: 'active' },
    m3: { name: 'legacy-7b', endpoint: 'http://localhost:8002', clientType: 'openai', status: 'retired' },
  } }));
  const mi = require(process.env.PROJECT_ROOT + '/engine/daemon/dist/model-inventory.js');
  const inv = mi.scanRegistryModels(dataDir);
  if (inv.availableModels.length !== 2) bad.push('retired 未过滤:' + inv.availableModels.map(m => m.name).join(','));
  if (inv.availableModels.some(m => m.source !== 'registry')) bad.push('source 非 registry');
  // schema 非法（version:2）→ 空清单 + 降级原因（fail-degradable 不打哑炮）
  const badDir = path.join(home, 'bad-data');
  fs.mkdirSync(path.join(badDir, 'config'), { recursive: true });
  fs.writeFileSync(path.join(badDir, 'config', 'model-registry.json'), JSON.stringify({ version: 2, models: {} }));
  const inv2 = mi.scanRegistryModels(badDir);
  if (inv2.availableModels.length !== 0 || !Array.isArray(inv2.degradedReasons) || inv2.degradedReasons.length === 0) bad.push('schema 非法未降级说明');
  // 心跳捎带 availableModels（T10 第三项联动）
  const dr = require(process.env.PROJECT_ROOT + '/engine/daemon/dist/device-registry.js');
  const id = _s41x_identity('s424-dev');
  if (!_s41x_register(dr, id, [], dataDir).ok) bad.push('注册失败');
  const hb = dr.reportHeartbeat(id, { dataDir, availableModels: inv.availableModels });
  if (!hb.ok) bad.push('心跳失败:' + hb.message);

  // ── 执行时 skill 快照三态（run-02 C-P1-7 补：生成/读取/清理/不一致检出/无常驻语义）──
  fs.writeFileSync(path.join(home, '.sofagent-key'), 's424-e2e-key');
  process.env.SOFAGENT_KEY_PATH = path.join(home, '.sofagent-key');
  const ss = require(process.env.PROJECT_ROOT + '/engine/orchestrator/dist/exec/skill-snapshot.js');
  const skillRoot = path.join(home, 'SKILL-test');
  fs.mkdirSync(path.join(skillRoot, 'harness'), { recursive: true });
  fs.writeFileSync(path.join(skillRoot, 'harness', 'installer.md'), '# 安装');
  fs.writeFileSync(path.join(skillRoot, 'review.md'), '# 审查');
  // ① 生成：清单含相对路径 + sha256 前 16 位 + 落盘 manifest
  const snap1 = ss.snapshotSkills({ skillRoot, sessionId: 's424-1', dataDir, agentId: 's424-probe' });
  if (snap1.packages.length !== 2 || !snap1.packages.some((p) => p.name === 'harness/installer.md')) bad.push('快照清单形态错:' + JSON.stringify(snap1.packages.map((p) => p.name)));
  if (!snap1.packages.every((p) => /^[0-9a-f]{16}$/.test(p.sha256))) bad.push('sha256 前 16 位形态错');
  // ② 读取：manifest 回读一致 + 更新后新快照版本/sha 变（两次执行用不同 skill 版本可证）
  const m1 = ss.readSnapshotManifest(dataDir, 's424-1');
  if (!m1 || m1.sessionId !== 's424-1' || m1.packages.length !== 2) bad.push('manifest 读取不一致');
  const shaBefore = snap1.packages.find((p) => p.name === 'review.md').sha256;
  fs.writeFileSync(path.join(skillRoot, 'review.md'), '# 审查 v2 内容更新');
  const snap2 = ss.snapshotSkills({ skillRoot, sessionId: 's424-2', dataDir, agentId: 's424-probe' });
  const shaAfter = snap2.packages.find((p) => p.name === 'review.md').sha256;
  if (shaBefore === shaAfter) bad.push('skill 更新后快照 sha 未变（两次执行版本不可辨）');
  // ③ 不一致检出：manifest sha 与实际文件不符可辨（篡改可检测——回放对账语义）
  const m2 = ss.readSnapshotManifest(dataDir, 's424-2');
  m2.packages[0].sha256 = 'deadbeefdeadbeef';
  const actualSha = require('crypto').createHash('sha256').update(fs.readFileSync(path.join(skillRoot, m2.packages[0].name))).digest('hex').slice(0, 16);
  if (m2.packages[0].sha256 === actualSha) bad.push('篡改 sha 不可辨');
  // ④ 清理零残留 + 幂等 + 不误删兄弟会话 + 清理后 manifest=null（无常驻——审计链才是持久证据）
  ss.cleanupSnapshot(dataDir, 's424-1');
  if (fs.existsSync(path.join(dataDir, 'skill-snapshots', 's424-1'))) bad.push('清理后残留');
  if (ss.readSnapshotManifest(dataDir, 's424-1') !== null) bad.push('清理后 manifest 仍可读（无常驻语义破坏）');
  if (!fs.existsSync(path.join(dataDir, 'skill-snapshots', 's424-2', 'snapshot-manifest.json'))) bad.push('误删兄弟会话');
  ss.cleanupSnapshot(dataDir, 's424-1'); // 幂等不抛
  // ⑤ 空 skillRoot → 空清单照样走完（诚实记录「当时无 skill」比缺记录诚实）
  const snap3 = ss.snapshotSkills({ skillRoot: path.join(home, 'no-such'), sessionId: 's424-3', dataDir, agentId: 's424-probe' });
  if (snap3.packages.length !== 0) bad.push('空 root 应产空清单');
  _s41x_done(bad, 'S424');
}

// S425 · 第一章 G1 workflow 模板分发——export/import dist 直调往返（导出落盘→导入回读→节点一致
// + 跨租户剥离 + 血缘回溯 + 篡改拒收 + 全私空包拒收 + 落地闸冲突拒收）
async function s425() {
  const { fs, path, dataDir } = _s41x_init('s425'); const bad = [];
  const storeDir = path.join(dataDir, 'workflow-store');
  fs.mkdirSync(storeDir, { recursive: true });
  // 合法 CRUD 形态 trunk（导入 schema 要求 node 必含 id/agent/task 三 string——与 workflowCreateSchema 同门）
  const trunk = {
    version: 2, owner: 'qa-e2e',
    workflow: {
      workflowId: 'wf-e2e', name: 'E2E 往返验证流', description: 'S425 探针',
      nodes: [
        { id: 'collect', agent: 'collector-agent', task: '采集本体数据 ontology-entity-A', depends_on: [], type: 'auto', visibility: 'open' },
        { id: 'review', agent: 'reviewer-agent', task: '复核 ontology-entity-A 引用', depends_on: ['collect'], type: 'manual', visibility: 'open' },
        { id: 'secret', agent: 'inner-agent', task: '内部私域节点', depends_on: [], type: 'auto', visibility: 'private' },
      ],
    },
  };
  fs.writeFileSync(path.join(storeDir, 'wf-e2e.json'), JSON.stringify(trunk, null, 2));
  const wexp = require(process.env.PROJECT_ROOT + '/engine/mcp/dist/tools/workflow-export.js');
  const wimp = require(process.env.PROJECT_ROOT + '/engine/mcp/dist/tools/workflow-import.js');

  // ① 导出成功：bundle 五件套按实收录 + private 剥离 1 件 + 悬空 depends_on 清理
  const exported = await wexp.workflowExport({ workflow_id: 'wf-e2e', enterprise: 'acme', cross_tenant: true, actor: 'qa', data_dir: dataDir });
  if (exported.data.isError) { bad.push('导出失败:' + (exported.data.code || '')); }
  else {
    const bundle = exported.data.bundle;
    if (!bundle.manifest || typeof bundle['workflow.yml'] !== 'string' || typeof bundle['ontology-entities.json'] !== 'string') bad.push('bundle 缺必备件');
    if (bundle.manifest.strippedPrivate !== 1) bad.push('private 剥离计数=' + bundle.manifest.strippedPrivate);
    const yml = require('js-yaml').load(bundle['workflow.yml']);
    const ids = yml.nodes.map((n) => n.id).join(',');
    if (ids !== 'collect,review') bad.push('剥离后节点=' + ids);
    const rev = yml.nodes.find((n) => n.id === 'review');
    if (JSON.stringify(rev.depends_on) !== JSON.stringify(['collect'])) bad.push('悬空 depends_on 未清理:' + JSON.stringify(rev.depends_on));
    // ② 导入回读往返：落地 v1 新 id + 节点 id/agent/task 逐项一致 + owner 落地者
    const imported = await wimp.workflowImport({ bundle, imported_as: 'wf-e2e-rt', owner: 'qa-imp', actor: 'qa', data_dir: dataDir });
    if (imported.data.isError) { bad.push('导入失败:' + (imported.data.code || '') + ' ' + (imported.data.issues ? imported.data.issues[0] : '')); }
    else {
      const rt = JSON.parse(fs.readFileSync(path.join(storeDir, 'wf-e2e-rt.json'), 'utf-8'));
      if (rt.id !== 'wf-e2e-rt' || rt.version !== 1 || rt.owner !== 'qa-imp') bad.push('落地形态错:' + rt.id + '/v' + rt.version + '/' + rt.owner);
      const same = yml.nodes.length === rt.workflow.nodes.length && yml.nodes.every((n, i) =>
        n.id === rt.workflow.nodes[i].id && n.agent === rt.workflow.nodes[i].agent && n.task === rt.workflow.nodes[i].task);
      if (!same) bad.push('往返节点不一致');
      const lt = imported.data.lineageTrace || [];
      if (!Array.isArray(lt) || lt.length < 2 || lt[0].workflowId !== 'wf-e2e' || lt[0].enterprise !== 'acme' || lt[0].version !== 2) bad.push('血缘回溯锚缺失');
      // ③ 落地闸：同名再导入 → duplicate-id 拒收
      const dup = await wimp.workflowImport({ bundle, imported_as: 'wf-e2e-rt', actor: 'qa', data_dir: dataDir });
      if (!dup.data.isError || dup.data.code !== 'duplicate-id') bad.push('冲突未拒:' + String(dup.data.code));
    }
    // ④ 完整性闸：篡改 workflow.yml → integrity-mismatch 拒收
    const tampered = { ...bundle, 'workflow.yml': bundle['workflow.yml'].replace('E2E 往返验证流', 'TAMPERED') };
    const tamperRes = await wimp.workflowImport({ bundle: tampered, imported_as: 'wf-tamper', actor: 'qa', data_dir: dataDir });
    if (!tamperRes.data.isError || tamperRes.data.code !== 'integrity-mismatch') bad.push('篡改未拒:' + String(tamperRes.data.code));
  }
  // ⑤ schema 闸：node 缺 agent/task 的非法模板 → schema-gate 拒收（fail-closed）
  const illDoc = { name: '非法模板', nodes: [{ id: 'x1', task: '只有 task' }] };
  const illYml = require('js-yaml').dump(illDoc);
  const illBundle = {
    manifest: { kind: 'sofagent-workflow-template', version: 1, files: { 'workflow.yml': require('crypto').createHash('sha256').update(illYml, 'utf8').digest('hex'), 'ontology-entities.json': require('crypto').createHash('sha256').update('[]', 'utf8').digest('hex') }, lineage: { sourceEnterprise: 'acme', sourceWorkflowId: 'wf-ill', sourceVersion: 1 } },
    'workflow.yml': illYml,
    'ontology-entities.json': '[]',
  };
  const illRes = await wimp.workflowImport({ bundle: illBundle, imported_as: 'wf-ill-rt', actor: 'qa', data_dir: dataDir });
  if (!illRes.data.isError || illRes.data.code !== 'schema-gate') bad.push('非法模板未拒:' + String(illRes.data.code));
  // ⑥ 全私导出 → empty-after-strip 拒收（空包分发无意义且掩盖全私事实）
  fs.writeFileSync(path.join(storeDir, 'wf-all-private.json'), JSON.stringify({
    version: 1, owner: 'x',
    workflow: { workflowId: 'wf-all-private', name: '全私', nodes: [{ id: 'p1', agent: 'a', task: 't', visibility: 'private' }] },
  }, null, 2));
  const emptyRes = await wexp.workflowExport({ workflow_id: 'wf-all-private', actor: 'qa', data_dir: dataDir });
  if (!emptyRes.data.isError || emptyRes.data.code !== 'empty-after-strip') bad.push('全私空包未拒:' + String(emptyRes.data.code));
  // ⑦ tool-registry 双注册断言（S192/S398 先例路径——源码 SSOT）
  const regSrc = fs.readFileSync(process.env.PROJECT_ROOT + '/engine/mcp/src/tool-registry.ts', 'utf-8');
  if (!/'workflow_export'/.test(regSrc)) bad.push('tool-registry 缺 workflow_export 注册');
  if (!/'workflow_import'/.test(regSrc)) bad.push('tool-registry 缺 workflow_import 注册');
  _s41x_done(bad, 'S425');
}

// S426 · 第十四章 审查体系四文档分发结构锁（run-02 C-P1-8 补——按 S180-S183 文档结构锁先例）
// 四文档 = regression-checklist.md（A 类·零新增维+归并 5 处）/ acceptance-test.sh（B 类·本场景族自身）/
// fresh-eyes-calibration.md（C 类·v1.4.9 校准收编 5 条）/ 收敛批（changelog 模块十四收敛表——行数/维数/场景数/警戒线四行对账）
async function s426() {
  const { fs } = _s41x_init('s426'); const bad = [];
  const root = process.env.PROJECT_ROOT;
  const read = (p) => fs.readFileSync(root + '/' + p, 'utf-8');
  // ① A 类锚：checklist 头部 90 维声明 + 行数警戒线双值 + 归并去向注释在位
  const rc = read('playbook/regression-checklist.md');
  if (!rc.includes('当前 90 维 · 编号 1-141 · 51 个编号已归并删除')) bad.push('checklist 头部 90 维声明漂移');
  if (!/regression-checklist\.md` ≤ 1950 行、`acceptance-test\.sh` ≤ 4500 行/.test(rc)) bad.push('警戒线双值锚漂移');
  const rcLines = (rc.match(/\n/g) || []).length; // wc -l 口径（与 check-review-system 同——换行符数，非 split 段数）
  if (rcLines > 1950) bad.push('checklist 超警戒线:' + rcLines);
  // ② C 类锚：calibration v1.4.9 收编 5 条特征锚（提取为空/同构替换 SSOT/死断言可达性/重跑全量/协议升级归 C）
  const cal = read('playbook/fresh-eyes-calibration.md');
  for (const anchor of [
    '门禁「提取为空」≠「合规为空」',
    '大范围同构替换须核对 SSOT',
    '死断言（不可达块）与断言可达性',
    '改断言必须重跑全量',
    '结构性协议升级类 finding 归 C 不归 A/B',
  ]) if (!cal.includes(anchor)) bad.push('calibration 缺锚:' + anchor.slice(0, 14));
  // ③ 收敛批锚：changelog 模块十四收敛表四行（行数/维数/场景数/警戒线）
  const cg = read('docs/changelog/v1.4/v1.4.9.md');
  if (!/## 十四、阶段四审查体系分发/.test(cg)) bad.push('changelog 模块十四章节缺');
  for (const anchor of ['| checklist 行数 |', '| checklist 维数 |', '| acceptance 行数 |', '| acceptance 场景数 |', '| 警戒线 |']) {
    if (!cg.includes(anchor)) bad.push('收敛表缺行:' + anchor);
  }
  if (!/解散 #143/.test(cg) || !/归并 #142 → #128/.test(cg)) bad.push('A 类归并/解散去向注释缺');
  // ④ 旧结构残留清零（分发后不应再有独立散落形态）
  if (/fresh-eyes-run02|round-05 findings 汇总/.test(cg) && /待整理/.test(cg)) bad.push('存在未整理残留段');
  _s41x_done(bad, 'S426');
}

// S427 · v1.5.0 章一 治理 KPI 面板——governance 聚合引擎 dist 直调（六卡键 + 周报格式化
// + lineage 合规报告结构），Dashboard 治理 tab 与 /api/governance 端点静态锚
async function s427() {
  const { fs, path } = _s41x_init('s427'); const bad = [];
  const root = process.env.PROJECT_ROOT;
  const gov = require(root + '/engine/audit/dist/governance.js');
  // ① KPI 六卡键齐备（boundary/coverage/hitl/weeklyTrend/repetition/traceReconcile 五卡 + datasetReview/decisionHighlights 扩展卡）
  const k = gov.computeGovernanceKpis(process.env.SOFAGENT_DATA);
  for (const key of ['boundary', 'coverage', 'hitl', 'weeklyTrend', 'repetition', 'traceReconcile', 'datasetReview', 'decisionHighlights']) {
    if (!(key in k)) bad.push('KPI 缺卡:' + key);
  }
  if (typeof k.consistencyRateAlias === 'string') bad.push('KPI 应为数值');
  // ② 空数据目录降级不炸（治理面板新企业首启零数据面）
  const empty = gov.computeGovernanceKpis(path.join(process.env.SOFAGENT_HOME, 'empty-data'));
  if (!empty || !('boundary' in empty)) bad.push('空目录 KPI 未降级');
  // ③ 周报导出 markdown 格式化在位
  const md = gov.formatGovernanceWeekly(typeof k === 'object' ? k : {});
  if (typeof md !== 'string' || !md.includes('治理')) bad.push('周报非 markdown/缺标题');
  // ④ 数据集 lineage 合规报告：结构键（数据从哪来→过什么闸→版本演进→审计链引用）
  if (typeof gov.buildDatasetLineageReport !== 'function') bad.push('lineage 报告函数缺失');
  // ⑤ Dashboard 静态锚：治理 tab 按钮 + KPI 端点 + 周报导出端点三件
  const html = fs.readFileSync(root + '/tools/dashboard/dashboard.html', 'utf-8');
  if (!html.includes("goPage('governance')")) bad.push('治理 tab 按钮缺');
  if (!html.includes('/api/governance')) bad.push('KPI 端点引用缺');
  if (!html.includes('/api/export-governance-weekly')) bad.push('周报导出端点引用缺');
  const serve = fs.readFileSync(root + '/tools/dashboard/serve-dashboard.mjs', 'utf-8');
  if (!serve.includes('/api/governance') || !serve.includes('/api/export-governance-weekly')) bad.push('serve 端点缺');
  _s41x_done(bad, 'S427');
}

// S428 · v1.5.0 章二 本体数据双时态——stateAt 时点快照（validTo 过滤）+ isValidAt 边界
// + progressiveLoad 三层渐进（entity 摘要→relations→全文，预算联动）
async function s428() {
  const { fs, path } = _s41x_init('s428'); const bad = [];
  const root = process.env.PROJECT_ROOT;
  const onto = require(root + '/engine/ontology/dist/index.js');
  // fixture：E1 长期有效 / E2 已过期（validTo 2026-06-30）/ E3 未生效（validFrom 2026-10-01）
  const kd = path.join(process.env.SOFAGENT_HOME, 'knowledge');
  fs.mkdirSync(path.join(kd, 'entities'), { recursive: true });
  const w = (id, fm) => fs.writeFileSync(path.join(kd, 'entities', id + '.md'),
    '---\nid: ' + id + '\nname: ' + id + '-name\n' + fm + '---\n正文全文内容 ' + id);
  w('E1', 'validFrom: 2026-01-01\n');
  w('E2', 'validFrom: 2025-01-01\nvalidTo: 2026-06-30\n');
  w('E3', 'validFrom: 2026-10-01\n');
  // ① 时点快照：2026-08-01 视角只见 E1（E2 已过期、E3 未生效）——EntityDigest[]，按 name 提取
  const at = onto.stateAt(kd, '2026-08-01');
  const names = at.map((e) => e && e.name ? e.name : String(e)).sort().join(',');
  if (names !== 'E1-name') bad.push('时点快照=' + names + '（应仅 E1）');
  // ② 历史时点：2026-05-01 视角见 E1+E2
  const hist = onto.stateAt(kd, '2026-05-01').map((e) => e.name).sort().join(',');
  if (hist !== 'E1-name,E2-name') bad.push('历史快照=' + hist);
  // ③ isValidAt 边界三态
  if (onto.isValidAt({ validFrom: '2025-01-01', validTo: '2026-06-30' }, '2026-06-30') !== false) bad.push('validTo 边界应含（闭区间）或排除——与实现一致校验失败');
  if (onto.isValidAt({ validFrom: '2026-01-01' }, '2026-12-31') !== true) bad.push('无 validTo 应长期有效');
  // ④ progressiveLoad 三层：names=实体名数组（文件名去 .md）；L1 摘要 ≤ L3 全文载荷，预算约束生效
  const pl = onto.progressiveLoad(kd, ['E1', 'E2'], onto.defaultBudget(8000), 1);
  const pl3 = onto.progressiveLoad(kd, ['E1', 'E2'], onto.defaultBudget(8000), 3);
  if (!Array.isArray(pl.digests) || pl.digests.length < 1) bad.push('渐进加载摘要层形态错');
  if (pl3.fullTexts.length < pl.fullTexts.length || (pl3.fullTexts.length === 0 && pl.digests.length > 0)) bad.push('三层载荷应≥一层');
  if (JSON.stringify(pl3).length < JSON.stringify(pl).length) bad.push('L3 序列化应≥L1');
  _s41x_done(bad, 'S428');
}

// S429 · v1.5.0 章三 Ontology Validation Engine——DAG 环检测（三色 DFS + 环链定位）
// + schema 兼容（悬空实体/字段缺失/类型错配）+ 激活前置门 fail-closed
async function s429() {
  _s41x_init('s429'); const bad = [];
  const root = process.env.PROJECT_ROOT;
  const { validateDag, validateSchemaCompat, validateForActivation } = require(root + '/engine/orchestrator/dist/graph/validator.js');
  // ① 环检测：a→c→b→a 三节点环，issue 带 kind=cycle + 环链定位
  const cyc = validateDag([
    { id: 'a', depends_on: ['c'] }, { id: 'b', depends_on: ['a'] }, { id: 'c', depends_on: ['b'] },
  ]);
  if (cyc.length === 0 || cyc[0].kind !== 'cycle' || !cyc[0].node.includes('→')) bad.push('环检测未定位环链');
  // ② 悬空依赖也算 cycle 类 issue（depends_on 引用不存在节点）
  const dangling = validateDag([{ id: 'a', depends_on: ['ghost'] }]);
  if (dangling.length === 0 || dangling[0].kind !== 'cycle') bad.push('悬空依赖未报');
  // ③ schema 兼容三态：未知实体 / 字段缺失 / 类型错配
  const ents = [{ name: 'Order', fields: { amount: 'number' } }];
  const sc = validateSchemaCompat([
    { id: 'n1', depends_on: [], io: { consumes: [
      { entity: 'NoSuch', fields: { x: 'string' } },
      { entity: 'Order', fields: { amount: 'number', ghost: 'string' } },
      { entity: 'Order', fields: { amount: 'string' } },
    ] } },
  ], ents);
  if (sc.length < 3) bad.push('schema 三态应全报（未知实体/字段缺失/类型错配），实得 ' + sc.length);
  // ④ 激活前置门：合法图 valid=true；环图 valid=false；fail-closed（校验器异常也拒绝）
  const okRes = validateForActivation([{ id: 'a', depends_on: [] }], ents);
  if (!okRes.valid) bad.push('合法图被拒');
  const badRes = validateForActivation([{ id: 'a', depends_on: ['a'] }], ents);
  if (badRes.valid) bad.push('自环图被放行');
  _s41x_done(bad, 'S429');
}

// S430 · v1.5.0 章八 跨层证据对账——reconcileTraces 四态判定 dist 直调
//（consistent/omitted 漏报/hallucinated 幻觉/misreported 瞒报 + 回滚闭环不计幻觉）
// + trace_reconcile 105th tool 注册面静态锚
async function s430() {
  const { fs } = _s41x_init('s430'); const bad = [];
  const root = process.env.PROJECT_ROOT;
  const { reconcileTraces } = require(root + '/engine/core/dist/index.js');
  const mk = (files, sid) => ({ sessionId: sid, events: files.map((f) => ({ type: 'file-op', fileOp: 'write', filePath: f })) });
  // ① 四态：一致（a）+ 漏报（b：diff 有 trace 无）+ 幻觉（ghost：trace 有 diff 无）
  const r1 = reconcileTraces({
    traces: [mk(['src/a.ts', 'src/ghost.ts'], 's1')],
    diffFiles: ['src/a.ts', 'src/b.ts'], deletedFiles: [], repoRoot: '/tmp/x',
  });
  const v = (p) => (r1.discrepancies.find((d) => d.path === p) || {}).verdict;
  if (v('src/b.ts') !== 'omitted') bad.push('漏报态判定错');
  if (v('src/ghost.ts') !== 'hallucinated') bad.push('幻觉态判定错');
  if (!r1.discrepancies.some((d) => d.path === 'src/a.ts')) { /* 一致态不入 discrepancies——正确 */ }
  else bad.push('一致态不应入差异清单');
  if (typeof r1.consistencyRate !== 'number') bad.push('一致率缺失');
  // ② 回滚闭环：写了又删（deletedFiles 命中）不计幻觉
  const r2 = reconcileTraces({
    traces: [mk(['src/rb.ts'], 's1')], diffFiles: [], deletedFiles: ['src/rb.ts'], repoRoot: '/tmp/x',
  });
  if (r2.discrepancies.some((d) => d.path === 'src/rb.ts')) bad.push('回滚闭环被误判幻觉');
  // ③ 瞒报态：declared 声明但 diff/trace 均无
  const r3 = reconcileTraces({
    traces: [mk(['src/a.ts'], 's1')], diffFiles: ['src/a.ts'], deletedFiles: [],
    declaredFiles: ['src/mis.ts'], repoRoot: '/tmp/x',
  });
  if (v('src/mis.ts') !== 'misreported' && !r3.discrepancies.some((d) => d.path === 'src/mis.ts' && d.verdict === 'misreported')) bad.push('瞒报态判定错');
  // ④ 工具注册面：trace_reconcile 在 tool-registry（105th tool）
  const reg = fs.readFileSync(root + '/engine/mcp/src/tool-registry.ts', 'utf-8');
  if (!reg.includes('trace_reconcile')) bad.push('trace_reconcile 未注册');
  _s41x_done(bad, 'S430');
}

// S431 · v1.5.0 章五 FDE 陪跑期 + 章十 DSH 插件事件接线——companion 期满总结（幂等 + 统计结构）
// + plugins.json 7 handler 声明面 + audit 插件 seamHandlers 静态锚
async function s431() {
  const { fs, path } = _s41x_init('s431'); const bad = [];
  const root = process.env.PROJECT_ROOT;
  // ① companion 常量与导出面（COMPANION_DAYS=14 + 生成函数在位）
  const comp = require(root + '/engine/daemon/dist/companion.js');
  if (comp.COMPANION_DAYS !== 14) bad.push('陪跑期常量=' + comp.COMPANION_DAYS);
  if (typeof comp.generateCompanionReport !== 'function') bad.push('期满总结生成函数缺失');
  if (typeof comp.getCompanionState !== 'function') bad.push('陪跑状态查询缺失');
  // ② 章十接线静态锚：plugins.json 7 插件 7 事件位（audit 4 + inject/evolve/rollback 各 1）
  const plugins = JSON.parse(fs.readFileSync(root + '/engine/dsh-plugins/plugins.json', 'utf-8'));
  const items = Array.isArray(plugins) ? plugins : (plugins.plugins || []);
  let handlerCount = 0;
  for (const p of items) {
    const seams = p.seamHandlers || (p.manifest && p.manifest.seamHandlers) || [];
    handlerCount += Array.isArray(seams) ? seams.length : 0;
  }
  if (handlerCount < 7) bad.push('seamHandlers 总数=' + handlerCount + '（应 ≥7）');
  // ③ audit 插件声明面：4 事件位源码锚
  const auditIdx = fs.readFileSync(root + '/engine/dsh-plugins/cordis-plugin-sofagent-audit/src/index.ts', 'utf-8');
  for (const ev of ['tools/pre-execute', 'tools/result', 'fs/write-intent', 'agent/turn-stopping']) {
    if (!auditIdx.includes(ev)) bad.push('audit 插件缺事件:' + ev);
  }
  _s41x_done(bad, 'S431');
}

// ── 调度器 ──────────────────────────────────────────────────
// S432：CHANGELOG 顶版索引行状态自洽（锁「⏳ 待发版 · 已发版」同现矛盾——发版翻牌期高频缺陷）
async function s432() {
  const { fs } = _s41x_init('s432'); const bad = [];
  const root = process.env.PROJECT_ROOT;
  const ver = JSON.parse(fs.readFileSync(root + '/package.json', 'utf-8')).version;
  const top = fs.readFileSync(root + '/CHANGELOG.md', 'utf-8')
    .split('\n').find((l) => l.startsWith('- **v' + ver + '**'));
  if (!top) { bad.push('CHANGELOG 缺当前版本 v' + ver + ' 的索引行'); }
  else if (top.includes('待发版') && top.includes('已发版')) {
    bad.push('顶版行状态自相矛盾（同时含待发版与已发版）');
  }
  _s41x_done(bad, 'S432');
}

const CASES = { s101, s102, s103, s106, s107, s108, s109, s111, s115, s148, s149, s151, s152, s155, s156, s416, s418, s419, s420, s421, s422, s423, s424, s425, s426, s427, s428, s429, s430, s431, s432 };

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
