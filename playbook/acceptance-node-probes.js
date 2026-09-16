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

// S418 · 第二章 G10 授权读取——参数缺失拒 + 未注册拒 + [sofagent] 前缀
async function s418() {
  const q = require(process.env.PROJECT_ROOT + '/engine/mcp/dist/tools/device-data-query.js'); const bad = [];
  let r = await q.deviceDataQuery({ identity: null, path: '/tmp/x' });
  if (r.data.ok !== false || r.data.reason !== 'invalid-params') bad.push('参数缺失未拒');
  if (!r.text.startsWith('[sofagent]')) bad.push('身份字段缺失时无 [sofagent] 前缀');
  r = await q.deviceDataQuery({ identity: { agentId: 'ghost-dev', publicKey: 'x' }, path: '/tmp/x' });
  if (r.data.ok !== false) bad.push('未注册设备未拒');
  if (!['not-registered', 'invalid-identity', 'daemon-unavailable', 'revoked'].includes(r.data.reason)) bad.push('拒绝 reason 异常:' + r.data.reason);
  _s41x_done(bad, 'S418');
}

// S419 · 第三章 G11 上行通道——invalid-params + isError 形态 + 未注册拒
async function s419() {
  const p = require(process.env.PROJECT_ROOT + '/engine/mcp/dist/tools/device-data-push.js'); const bad = [];
  let r = await p.deviceDataPush({ category: '', payload: '' });
  if (r.data.ok !== false || r.data.reason !== 'invalid-params') bad.push('参数缺失未拒');
  if (r.data.isError !== true) bad.push('isError 形态缺失');
  r = await p.deviceDataPush({ identity: { agentId: 'ghost-dev', publicKey: 'x' }, category: 'metrics', payload: '{}' });
  if (r.data.ok !== false) bad.push('未注册设备未拒');
  if (!['not-registered', 'invalid-identity', 'daemon-unavailable', 'revoked'].includes(r.data.reason)) bad.push('拒绝 reason 异常:' + r.data.reason);
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
  _s41x_done(bad, 'S422');
}

// S423 · 第九章 权重灰度 AB——同 key 确定性分流 + 0/100 端点 + 劣化判定附原因 + 无劣化对照
async function s423() {
  const wc = require(process.env.PROJECT_ROOT + '/engine/train/dist/weight-canary.js'); const bad = [];
  const cfg = { oldAdapter: 'local-27b', newAdapter: 'cloud-plus', newWeightPercent: 50 };
  const v1 = wc.routeRequest('user-42', cfg); const v2 = wc.routeRequest('user-42', cfg);
  if (v1.adapter !== v2.adapter || v1.isNew !== v2.isNew) bad.push('同 key 分流不稳定');
  if (wc.routeRequest('any', { ...cfg, newWeightPercent: 0 }).isNew !== false) bad.push('0% 未全走旧臂');
  if (wc.routeRequest('any', { ...cfg, newWeightPercent: 100 }).isNew !== true) bad.push('100% 未全走新臂');
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
  _s41x_done(bad, 'S424');
}

// ── 调度器 ──────────────────────────────────────────────────
const CASES = { s101, s102, s103, s106, s107, s108, s109, s111, s115, s148, s149, s151, s152, s155, s156, s418, s419, s420, s421, s422, s423, s424 };

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
