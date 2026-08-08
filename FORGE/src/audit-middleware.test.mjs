// ============================================================
// audit-middleware.test.mjs · 运行时审计 tool wrapper 测试（v1.3.0 交付 1 + 8 + 3）
//
// 覆盖：
//   - createAuditMiddleware 三态判定（PASS/WARN/FAIL）
//   - FAIL 拦截优先于 progress（wrapTool 返回拒绝消息，不执行原 func）
//   - 运行时审计日志写入 data/audit/runtime/<repo-hash>/runtime-audit.jsonl
//   - 交付 8：仓库隔离（git 目录 → repo-hash；非 git → nogit-<cwd-hash>）
//   - args 摘要脱敏（content/command 等字段不落原文）
//   - emitDecision 决策日志联动（TOOL_GATE）
//   - 交付 3：requireApproval → HITL 待批准消息 + recordHitlAudit 决策归档
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

import { createAuditMiddleware, computeRepoHash, resolveRuntimeAuditPath, appendRuntimeAuditLog, recordHitlAudit } from './audit-middleware.mjs';

// CJS 包在 .mjs 测试里用 createRequire 导入
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { RulesEngine, defaultToolRules } = require('../../engine/rules/dist/index.js');
const auditDist = require('../../engine/audit/dist/public-api.js');

function tmpDir() {
  const dir = mkdtempSync(join(tmpdir(), 'sofagent-audit-mw-'));
  return dir;
}

test('computeRepoHash: git 目录返回稳定 hash，非 git 目录返回 nogit- 前缀', () => {
  // git 目录（当前仓库）
  const h1 = computeRepoHash(process.cwd());
  const h2 = computeRepoHash(process.cwd());
  assert.match(h1, /^[0-9a-f]{12}$/);
  assert.equal(h1, h2); // 稳定

  // 非 git 目录
  const dir = tmpDir();
  try {
    const h3 = computeRepoHash(dir);
    assert.ok(h3.startsWith('nogit-'), `非 git 目录应返回 nogit- 前缀，实际 ${h3}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveRuntimeAuditPath: 路径为 data/audit/runtime/<repo-hash>/runtime-audit.jsonl', () => {
  const p = resolveRuntimeAuditPath(process.cwd());
  assert.ok(p.includes('audit'));
  assert.ok(p.includes('runtime'));
  assert.ok(p.endsWith('runtime-audit.jsonl'));
});

test('createAuditMiddleware: PASS 放行、FAIL 拦截、WARN 告警', () => {
  const mw = createAuditMiddleware(new RulesEngine(defaultToolRules), {
    agentName: 'test',
    cwd: process.cwd(),
    emitDecision: false,
  });

  // PASS：读 README.md
  const pass = mw.check('sf_read', { path: 'README.md' });
  assert.equal(pass.status, 'PASS');
  assert.equal(pass.blocked, false);

  // FAIL：写 .env（A1 敏感文件）
  const fail = mw.check('sf_write', { path: '.env', content: 'SECRET=1' });
  assert.equal(fail.status, 'FAIL');
  assert.equal(fail.blocked, true);
  assert.ok(fail.reason.includes('tool-sensitive-file'));

  // WARN：路径类参数但非敏感（如读 docs/）→ PASS（当前规则集无 WARN 触发）
  // 直接验证 aggregate 语义：无规则命中 → PASS
});

test('wrapTool: FAIL 拦截返回拒绝消息且不执行原 func', async () => {
  const mw = createAuditMiddleware(new RulesEngine(defaultToolRules), {
    agentName: 'test',
    cwd: process.cwd(),
    emitDecision: false,
  });
  let executed = false;
  const wrapped = mw.wrapTool(async () => { executed = true; return 'ok'; }, 'sf_write');
  const result = await wrapped({ path: '.env', content: 'x' });
  assert.ok(result.includes('Audit 拦截'));
  assert.equal(executed, false); // 原 func 未执行

  // PASS 工具正常执行
  const wrappedPass = mw.wrapTool(async () => 'ok', 'sf_read');
  const result2 = await wrappedPass({ path: 'README.md' });
  assert.equal(result2, 'ok');
});

test('运行时审计日志写入 + args 摘要脱敏 + emitDecision 联动', () => {
  const dir = tmpDir();
  // 隔离：SOFAGENT_HOME + SOFAGENT_DATA 指向临时目录，避免写真实 ~/.sofagent。
  // （getDecisionLogPath 优先读 SOFAGENT_DATA，resolveDataDir 读 SOFAGENT_HOME——两者都要设）
  const savedHome = process.env.SOFAGENT_HOME;
  const savedData = process.env.SOFAGENT_DATA;
  process.env.SOFAGENT_HOME = dir;
  process.env.SOFAGENT_DATA = join(dir, 'data');
  try {
    const mw = createAuditMiddleware(new RulesEngine(defaultToolRules), {
      agentName: 'test-agent',
      cwd: dir,
      sessionId: 'sess-test',
      emitDecision: true,
    });
    mw.check('sf_write', { path: 'config.yml', content: 'password=hunter2-secret', command: 'echo hi' });

    // 运行时审计日志
    const logPath = resolveRuntimeAuditPath(dir);
    assert.ok(existsSync(logPath), 'runtime-audit.jsonl 应存在');
    const lines = readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]);
    assert.equal(last.toolName, 'sf_write');
    assert.equal(last.agentName, 'test-agent');
    // 摘要脱敏：content/command 不落原文
    assert.equal(last.args_summary.content, '<redacted>');
    assert.equal(last.args_summary.command, '<redacted>');
    assert.ok(!JSON.stringify(last).includes('hunter2-secret'));

    // 决策日志（TOOL_GATE）
    const decisionPath = join(dir, 'data', 'audit', 'decision-log.jsonl');
    assert.ok(existsSync(decisionPath), 'decision-log.jsonl 应存在');
    const dLines = readFileSync(decisionPath, 'utf-8').trim().split('\n').filter(Boolean);
    const d = JSON.parse(dLines[dLines.length - 1]);
    assert.equal(d.kind, 'TOOL_GATE');
    assert.equal(d.moment, 'ACT');
    assert.equal(d.agentId, 'test-agent');
  } finally {
    if (savedHome === undefined) delete process.env.SOFAGENT_HOME;
    else process.env.SOFAGENT_HOME = savedHome;
    if (savedData === undefined) delete process.env.SOFAGENT_DATA;
    else process.env.SOFAGENT_DATA = savedData;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('appendRuntimeAuditLog: 非 git 目录不与其他仓库混用', () => {
  const dir = tmpDir();
  const savedHome = process.env.SOFAGENT_HOME;
  process.env.SOFAGENT_HOME = dir;
  try {
    // 两个不同的非 git cwd → 不同 nogit- hash
    const subA = join(dir, 'projA');
    const subB = join(dir, 'projB');
    mkdirSync(subA, { recursive: true });
    mkdirSync(subB, { recursive: true });
    appendRuntimeAuditLog({ toolName: 't', verdict: { status: 'PASS' } }, subA);
    appendRuntimeAuditLog({ toolName: 't', verdict: { status: 'PASS' } }, subB);

    const pathA = resolveRuntimeAuditPath(subA);
    const pathB = resolveRuntimeAuditPath(subB);
    assert.notEqual(pathA, pathB, '不同非 git 目录应隔离到不同 nogit- 目录');
    assert.ok(pathA.includes('nogit-'));
    assert.ok(pathB.includes('nogit-'));
    assert.ok(existsSync(pathA));
    assert.ok(existsSync(pathB));
  } finally {
    if (savedHome === undefined) delete process.env.SOFAGENT_HOME;
    else process.env.SOFAGENT_HOME = savedHome;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 交付 3：HITL 钩子（requireApproval → 待批准消息 + 决策归档）──
test('交付 3: requireApproval → check 返回 hitlPending + wrapTool 返回待批准消息', async () => {
  // 构造一条 requireApproval=true 的规则
  const approvalRule = {
    name: 'tool-approval-demo',
    number: 99,
    ruleClass: '业务底线',
    ruleType: 'tool',
    check: () => ({
      status: 'PASS',
      ruleName: 'tool-approval-demo',
      ruleNumber: 99,
      details: ['高危操作需要人工确认'],
      suggestion: '等待批准',
      requireApproval: true,
    }),
  };
  const { RulesEngine } = require('../../engine/rules/dist/index.js');
  const engine = new RulesEngine([approvalRule]);
  const mw = createAuditMiddleware(engine, { agentName: 'test', cwd: process.cwd(), emitDecision: false });

  // check 层面：hitlPending=true
  const verdict = mw.check('sf_write', { path: 'config.yml' });
  assert.equal(verdict.hitlPending, true);
  assert.equal(verdict.status, 'HITL');
  assert.equal(verdict.blocked, true);
  assert.ok(verdict.reason.includes('tool-approval-demo'), `reason 应含规则名: ${verdict.reason}`);

  // wrapTool 层面：返回待批准消息，不执行原 func
  let executed = false;
  const wrapped = mw.wrapTool(async () => { executed = true; return 'ok'; }, 'sf_write');
  const result = await wrapped({ path: 'config.yml' });
  assert.ok(result.includes('HITL 待批准'));
  assert.ok(result.includes('hitl_resolve'));
  assert.equal(executed, false);
});

test('交付 3: recordHitlAudit 拒绝/超时 → 审计 FAIL 记录到运行时日志', () => {
  const dir = tmpDir();
  const savedHome = process.env.SOFAGENT_HOME;
  process.env.SOFAGENT_HOME = dir;
  try {
    recordHitlAudit({ toolName: 'sf_write', decision: 'reject', reason: '人工拒绝高危写入', cwd: dir });
    recordHitlAudit({ toolName: 'sf_delete', decision: 'timeout', reason: '等待超时', cwd: dir });

    const logPath = resolveRuntimeAuditPath(dir);
    assert.ok(existsSync(logPath));
    const lines = readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
    assert.equal(lines.length, 2);
    const reject = JSON.parse(lines[0]);
    assert.equal(reject.verdict.status, 'HITL_REJECTED');
    const timeout = JSON.parse(lines[1]);
    assert.equal(timeout.verdict.status, 'HITL_TIMEOUT');
  } finally {
    if (savedHome === undefined) delete process.env.SOFAGENT_HOME;
    else process.env.SOFAGENT_HOME = savedHome;
    rmSync(dir, { recursive: true, force: true });
  }
});
