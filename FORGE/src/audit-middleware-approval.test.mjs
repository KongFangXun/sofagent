// ============================================================
// audit-middleware-approval.test.mjs · 工具审批四模式测试（v1.3.1 交付 10）
//
// 覆盖（FORGE middleware 层——与 rules 包 approval-mode.test.ts 互补）：
//   - allow-with-audit 默认 = v1.3.0 行为不破坏（wrapTool 两参调用照常放行）
//   - deny-all 全部拦截 + 合成中止消息「工具调用被拒绝（模式：{mode}）」
//   - read-only：r 工具放行 / rw 工具拒绝
//   - always-ask：无回调保守默认拒绝（铁律 #7）/ 有回调 await 人工决定
//   - 每次审批决定（放行与拒绝）写 approval_decision 审计事件
//   （APPROVAL_ALLOWED / APPROVAL_DENIED）
//   - 审批继承：setDefaultApprovalMode 后子 middleware 缺省继承
// ============================================================

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  createAuditMiddleware,
  resolveRuntimeAuditPath,
  setDefaultApprovalMode,
  getDefaultApprovalMode,
} from './audit-middleware.mjs';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { RulesEngine } = require('../../engine/rules/dist/index.js');

function tmpDir() {
  return mkdtempSync(join(tmpdir(), 'sofagent-approval-'));
}

// 空规则引擎——规则层全 PASS，隔离验证审批模式分支
const passEngine = new RulesEngine([]);

// 每个测试后复位模块默认模式，避免测试间污染
afterEach(() => {
  setDefaultApprovalMode('allow-with-audit');
});

/** 读运行时审计日志全部行（JSON 数组） */
function readLogLines(cwd) {
  const logPath = resolveRuntimeAuditPath(cwd);
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

test('allow-with-audit 默认行为不破坏：wrapTool 两参调用照常放行', async () => {
  const dir = tmpDir();
  const savedHome = process.env.SOFAGENT_HOME;
  process.env.SOFAGENT_HOME = dir;
  try {
    const mw = createAuditMiddleware(passEngine, { agentName: 't', cwd: dir, emitDecision: false });
    const wrapped = mw.wrapTool(async () => 'ok', 'sf_read');
    const result = await wrapped({ path: 'README.md' });
    assert.equal(result, 'ok'); // 原 func 执行
    assert.equal(getDefaultApprovalMode(), 'allow-with-audit'); // 默认模式

    // 放行也写 approval_decision（APPROVAL_ALLOWED）
    const lines = readLogLines(dir);
    const approvals = lines.filter((l) => l.verdict?.ruleName === 'approval_decision');
    assert.ok(approvals.length >= 1, '放行应写 approval_decision');
    assert.equal(approvals[approvals.length - 1].verdict.status, 'APPROVAL_ALLOWED');
  } finally {
    if (savedHome === undefined) delete process.env.SOFAGENT_HOME;
    else process.env.SOFAGENT_HOME = savedHome;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deny-all：全部拦截 + 合成中止消息（r 和 rw 都拒）', async () => {
  const dir = tmpDir();
  const savedHome = process.env.SOFAGENT_HOME;
  process.env.SOFAGENT_HOME = dir;
  try {
    const mw = createAuditMiddleware(passEngine, {
      agentName: 't', cwd: dir, emitDecision: false, approvalMode: 'deny-all',
    });
    let executed = 0;
    const wrappedR = mw.wrapTool(async () => { executed++; return 'ok'; }, 'sf_read', 'r');
    const wrappedRw = mw.wrapTool(async () => { executed++; return 'ok'; }, 'sf_write', 'rw');

    const r1 = await wrappedR({ path: 'a.md' });
    const r2 = await wrappedRw({ path: 'b.md', content: 'x' });
    assert.equal(r1, '⛔ [sofagent 审计] 拒绝：工具调用被拒绝（模式：deny-all）');
    assert.equal(r2, '⛔ [sofagent 审计] 拒绝：工具调用被拒绝（模式：deny-all）');
    assert.equal(executed, 0); // 原 func 均未执行——不崩溃，返回合成消息

    // 拒绝写 APPROVAL_DENIED
    const lines = readLogLines(dir);
    const denied = lines.filter((l) => l.verdict?.status === 'APPROVAL_DENIED');
    assert.ok(denied.length >= 2, `应有 ≥2 条 APPROVAL_DENIED，实际 ${denied.length}`);
  } finally {
    if (savedHome === undefined) delete process.env.SOFAGENT_HOME;
    else process.env.SOFAGENT_HOME = savedHome;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('read-only：r 工具放行 / rw 工具拒绝', async () => {
  const dir = tmpDir();
  const savedHome = process.env.SOFAGENT_HOME;
  process.env.SOFAGENT_HOME = dir;
  try {
    const mw = createAuditMiddleware(passEngine, {
      agentName: 'bench-agent', cwd: dir, emitDecision: false, approvalMode: 'read-only',
    });
    // 只读放行（Benchmark 评测场景：读 statement）
    const wrappedR = mw.wrapTool(async () => 'content', 'sf_read', 'r');
    assert.equal(await wrappedR({ path: 'statement/README.md' }), 'content');

    // 读写拒绝（评测 Agent 不得写文件）——无回调保守拒绝
    let wrote = false;
    const wrappedRw = mw.wrapTool(async () => { wrote = true; return 'ok'; }, 'sf_write', 'rw');
    const result = await wrappedRw({ path: 'artifact.md', content: 'x' });
    assert.equal(result, '⛔ [sofagent 审计] 拒绝：工具调用被拒绝（模式：read-only）');
    assert.equal(wrote, false);
  } finally {
    if (savedHome === undefined) delete process.env.SOFAGENT_HOME;
    else process.env.SOFAGENT_HOME = savedHome;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('保守默认拒绝铁律：always-ask 无回调 → 拒绝一切（不是放行）', async () => {
  const dir = tmpDir();
  const savedHome = process.env.SOFAGENT_HOME;
  process.env.SOFAGENT_HOME = dir;
  try {
    const mw = createAuditMiddleware(passEngine, {
      agentName: 't', cwd: dir, emitDecision: false, approvalMode: 'always-ask',
    });
    let executed = 0;
    const wrapped = mw.wrapTool(async () => { executed++; return 'ok'; }, 'sf_read', 'r');
    // 连只读工具也要人工确认——无回调即拒绝
    const result = await wrapped({ path: 'README.md' });
    assert.equal(result, '⛔ [sofagent 审计] 拒绝：工具调用被拒绝（模式：always-ask）');
    assert.equal(executed, 0);

    const lines = readLogLines(dir);
    const denied = lines.filter((l) => l.verdict?.status === 'APPROVAL_DENIED');
    assert.ok(denied.length >= 1, '保守拒绝应写 APPROVAL_DENIED');
    assert.ok(
      denied.some((l) => (l.verdict.details?.[0] ?? '').includes('保守默认拒绝')),
      '拒绝理由应注明保守默认拒绝'
    );
  } finally {
    if (savedHome === undefined) delete process.env.SOFAGENT_HOME;
    else process.env.SOFAGENT_HOME = savedHome;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('always-ask 有回调：await approvalCallback 拿人工决定（放行与拒绝都记录）', async () => {
  const dir = tmpDir();
  const savedHome = process.env.SOFAGENT_HOME;
  process.env.SOFAGENT_HOME = dir;
  try {
    const calls = [];
    const approvalCallback = async ({ toolName, permission }) => {
      calls.push({ toolName, permission });
      return toolName === 'sf_read'; // 只批准读
    };
    const mw = createAuditMiddleware(passEngine, {
      agentName: 't', cwd: dir, emitDecision: false,
      approvalMode: 'always-ask', approvalCallback,
    });

    // 人工放行
    const wrappedR = mw.wrapTool(async () => 'ok', 'sf_read', 'r');
    assert.equal(await wrappedR({ path: 'a.md' }), 'ok');
    // 人工拒绝
    let wrote = false;
    const wrappedRw = mw.wrapTool(async () => { wrote = true; return 'ok'; }, 'sf_write', 'rw');
    assert.equal(await wrappedRw({ path: 'b.md' }), '⛔ [sofagent 审计] 拒绝：工具调用被拒绝（模式：always-ask）');
    assert.equal(wrote, false);

    // 回调收到 toolName + permission
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], { toolName: 'sf_read', permission: 'r' });
    assert.deepEqual(calls[1], { toolName: 'sf_write', permission: 'rw' });

    // 两种决定都写 approval_decision
    const lines = readLogLines(dir);
    const statuses = lines.filter((l) => l.verdict?.ruleName === 'approval_decision').map((l) => l.verdict.status);
    assert.ok(statuses.includes('APPROVAL_ALLOWED'), `应含放行记录: ${statuses}`);
    assert.ok(statuses.includes('APPROVAL_DENIED'), `应含拒绝记录: ${statuses}`);
  } finally {
    if (savedHome === undefined) delete process.env.SOFAGENT_HOME;
    else process.env.SOFAGENT_HOME = savedHome;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('审批继承：setDefaultApprovalMode 后子 middleware 缺省继承父模式', async () => {
  const dir = tmpDir();
  const savedHome = process.env.SOFAGENT_HOME;
  process.env.SOFAGENT_HOME = dir;
  try {
    // 父 Agent 设置模块默认模式
    setDefaultApprovalMode('deny-all');
    assert.equal(getDefaultApprovalMode(), 'deny-all');

    // 子 Agent 创建 middleware 不传 approvalMode → 继承 deny-all
    const childMw = createAuditMiddleware(passEngine, { agentName: 'child', cwd: dir, emitDecision: false });
    let executed = 0;
    const wrapped = childMw.wrapTool(async () => { executed++; return 'ok'; }, 'sf_read', 'r');
    const result = await wrapped({ path: 'a.md' });
    assert.equal(result, '⛔ [sofagent 审计] 拒绝：工具调用被拒绝（模式：deny-all）');
    assert.equal(executed, 0);

    // 显式传 approvalMode 优先于模块默认值
    const overrideMw = createAuditMiddleware(passEngine, {
      agentName: 'child2', cwd: dir, emitDecision: false, approvalMode: 'allow-with-audit',
    });
    const wrapped2 = overrideMw.wrapTool(async () => 'ok', 'sf_read', 'r');
    assert.equal(await wrapped2({ path: 'a.md' }), 'ok');
  } finally {
    setDefaultApprovalMode('allow-with-audit');
    if (savedHome === undefined) delete process.env.SOFAGENT_HOME;
    else process.env.SOFAGENT_HOME = savedHome;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('规则引擎 FAIL 优先于审批模式（FAIL 拦截不受 approvalMode 影响）', async () => {
  const dir = tmpDir();
  const savedHome = process.env.SOFAGENT_HOME;
  process.env.SOFAGENT_HOME = dir;
  try {
    const { defaultToolRules } = require('../../engine/rules/dist/index.js');
    const mw = createAuditMiddleware(new RulesEngine(defaultToolRules), {
      agentName: 't', cwd: dir, emitDecision: false, approvalMode: 'allow-with-audit',
    });
    // 写 .env 被规则引擎 FAIL 拦截——即使 allow-with-audit 也不执行
    const wrapped = mw.wrapTool(async () => 'ok', 'sf_write', 'rw');
    const result = await wrapped({ path: '.env', content: 'SECRET=1' });
    assert.ok(String(result).includes('[sofagent 审计] 拦截'), `应被规则引擎拦截: ${result}`);
  } finally {
    if (savedHome === undefined) delete process.env.SOFAGENT_HOME;
    else process.env.SOFAGENT_HOME = savedHome;
    rmSync(dir, { recursive: true, force: true });
  }
});
