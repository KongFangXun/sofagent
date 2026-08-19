// ============================================================
// proxy-gateway.test.ts · v1.3.8 交付一：代理网关硬边界测试
// ============================================================
//
// 覆盖（TDD——先红后绿）：
// - 四防：绕过（启动完整性自检）/ DDoS（token bucket 限速）/
//   伪造（未注册身份 deny）/ 日志注入（sanitize 后 append-only）
// - 判定链：白名单（network-gateway 兜底）→ 权限上界 → 风险阈值 →
//   极高风险挂 HITL
// - 权限上界：首次锁定 / 收窄（只减不增）/ 越界 deny 三态 +
//   越界不中断任务
// - HITL：approve 放行 / reject deny 两态 + listPending
// - 高频越界（连续 5 次）→ onViolation 回调（调用方接 circuit-breaker）
//
// 全部使用临时目录隔离（mkdtemp）——不污染仓库。
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  createProxyGateway,
  classifyRequestRisk,
  type ProxyRequest,
  type ProxyGatewayOptions,
} from '../../gateway/proxy-gateway';
import { createPermissionCeiling } from '../../gateway/permission-ceiling';

// ════════════════════════════════════════
// Helper
// ════════════════════════════════════════

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-gateway-'));
}

function rmDir(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
}

/** 构造一个最小合法请求（低风险 read，白名单内） */
function readReq(overrides: Partial<ProxyRequest> = {}): ProxyRequest {
  return {
    agentId: 'a1',
    tool: 'read_file',
    action: 'read',
    target: { host: 'api.github.com', port: 443, protocol: 'https' },
    params: { path: 'src/index.ts' },
    ...overrides,
  };
}

/** 构造默认网关选项（a1 注册 read_file/write_file/db_write/delete_record） */
function defaultOptions(dataDir: string, overrides: Partial<ProxyGatewayOptions> = {}): ProxyGatewayOptions {
  return {
    dataDir,
    allowHosts: ['api.github.com'],
    agents: { a1: ['read_file', 'write_file', 'db_write', 'delete_record', 'send_email'] },
    ...overrides,
  };
}

/** 读审计 JSONL 并逐行解析（校验「每行一个合法 JSON」） */
function readAuditLines(dataDir: string): Record<string, unknown>[] {
  const auditPath = path.join(dataDir, 'gateway', 'audit.jsonl');
  const content = fs.readFileSync(auditPath, 'utf-8');
  return content.split('\n').filter(Boolean).map(l => JSON.parse(l) as Record<string, unknown>);
}

// ════════════════════════════════════════
// 一、四防
// ════════════════════════════════════════

describe('交付一 · 四防', () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => rmDir(dir));

  it('防绕过：启动完整性自检失败 → 网关拒绝服务（一切请求 deny）', () => {
    // 审计目录父路径是一个普通文件 → mkdir 失败 → 自检不过
    const blocker = path.join(dir, 'blocker.txt');
    fs.writeFileSync(blocker, 'not a dir', 'utf-8');
    const gw = createProxyGateway(defaultOptions(path.join(blocker, 'sub', 'data')));

    const integrity = gw.integrityCheck();
    expect(integrity.ok).toBe(false);

    const res = gw.checkRequest(readReq());
    expect(res.decision).toBe('deny');
    expect(res.reason).toContain('完整性自检');
  });

  it('防绕过：完整性自检通过时明确报告各项检查', () => {
    const gw = createProxyGateway(defaultOptions(dir));
    const integrity = gw.integrityCheck();
    expect(integrity.ok).toBe(true);
    expect(integrity.checks.length).toBeGreaterThanOrEqual(2); // 审计可写 + 网络网关就绪
    for (const c of integrity.checks) expect(c.ok).toBe(true);
  });

  it('防 DDoS：token bucket 限速——同 agent 短窗内超限请求 deny + 审计留痕', () => {
    const gw = createProxyGateway(defaultOptions(dir, {
      rateLimit: { windowMs: 60_000, maxRequests: 3 },
    }));
    // 前 3 次放行
    for (let i = 0; i < 3; i++) {
      expect(gw.checkRequest(readReq()).decision).toBe('allow');
    }
    // 第 4 次 → 限速 deny
    const res = gw.checkRequest(readReq());
    expect(res.decision).toBe('deny');
    expect(res.reason).toContain('限速');
    // 限速事件落审计
    const lines = readAuditLines(dir);
    expect(lines.some(l => String(l['reason'] ?? '').includes('限速'))).toBe(true);
  });

  it('防伪造：未注册 agentId 的请求 fail-closed deny + 审计含伪造标记', () => {
    const gw = createProxyGateway(defaultOptions(dir));
    const res = gw.checkRequest(readReq({ agentId: 'ghost-agent' }));
    expect(res.decision).toBe('deny');
    expect(res.reason).toContain('未注册');
    const lines = readAuditLines(dir);
    expect(lines.some(l => String(l['reason'] ?? '').includes('未注册'))).toBe(true);
  });

  it('防伪造：请求缺 agentId（空串）同样 deny', () => {
    const gw = createProxyGateway(defaultOptions(dir));
    const res = gw.checkRequest(readReq({ agentId: '' }));
    expect(res.decision).toBe('deny');
  });

  it('防日志注入：参数含换行伪造行 + 密钥 → 审计单行合法 JSON + 密钥打码', () => {
    const gw = createProxyGateway(defaultOptions(dir));
    // AKIA 前缀与尾段运行时拼接——源码不落完整字面量（提交审计 A2 会拦硬编码密钥）
    const awsLikeKey = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
    gw.checkRequest(readReq({
      params: {
        note: `line1\n{"fake":"entry"}\nsk-abcdefghijklmnop1234 and ${awsLikeKey} and password=SuperSecret99`,
      },
    }));
    const auditPath = path.join(dir, 'gateway', 'audit.jsonl');
    const content = fs.readFileSync(auditPath, 'utf-8');
    // 1) 仍是一行（注入的 \n 不产生新审计行）
    expect(content.trim().split('\n').length).toBe(1);
    // 2) 该行是合法 JSON
    const parsed = JSON.parse(content.trim()) as Record<string, unknown>;
    // 3) 密钥已打码（明文不出现在落盘内容中）
    expect(content).not.toContain('sk-abcdefghijklmnop1234');
    expect(content).not.toContain(awsLikeKey);
    expect(content).not.toContain('SuperSecret99');
    expect(parsed).toBeTruthy();
  });
});

// ════════════════════════════════════════
// 二、判定链（白名单 → 权限上界 → 风险阈值 → 极高 HITL）
// ════════════════════════════════════════

describe('交付一 · 判定链', () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => rmDir(dir));

  it('白名单：目标 host 不在白名单 → deny（network-gateway 兜底）', () => {
    const gw = createProxyGateway(defaultOptions(dir));
    const res = gw.checkRequest(readReq({
      target: { host: 'evil.example.com', port: 443, protocol: 'https' },
    }));
    expect(res.decision).toBe('deny');
    expect(res.reason).toContain('白名单');
  });

  it('风险分级：read=低 / write=中 / db 写=高 / 删除与外传=极高', () => {
    expect(classifyRequestRisk(readReq())).toBe('low');
    expect(classifyRequestRisk(readReq({ tool: 'write_file', action: 'write' }))).toBe('medium');
    expect(classifyRequestRisk(readReq({ tool: 'db_write', action: 'write' }))).toBe('high');
    expect(classifyRequestRisk(readReq({ tool: 'delete_record', action: 'delete' }))).toBe('critical');
    expect(classifyRequestRisk(readReq({ tool: 'export_data', action: 'export' }))).toBe('critical');
    // 工具名含转账语义（write 动作）也是极高
    expect(classifyRequestRisk(readReq({ tool: 'bank_transfer', action: 'write' }))).toBe('critical');
  });

  it('风险阈值：低/中风险自动放行，高风险（默认阈值）deny', () => {
    const gw = createProxyGateway(defaultOptions(dir));
    expect(gw.checkRequest(readReq()).decision).toBe('allow'); // low
    expect(gw.checkRequest(readReq({ tool: 'write_file', action: 'write' })).decision).toBe('allow'); // medium
    const res = gw.checkRequest(readReq({ tool: 'db_write', action: 'write' })); // high
    expect(res.decision).toBe('deny');
    expect(res.reason).toContain('风险');
  });

  it('极高风险 → 挂 HITL：返回 hitl-pending + pending/{id}.json 落盘（含请求快照与 reason）', () => {
    const gw = createProxyGateway(defaultOptions(dir));
    const res = gw.checkRequest(readReq({ tool: 'delete_record', action: 'delete' }));
    expect(res.decision).toBe('hitl-pending');
    expect(res.checkpointId).toBeTruthy();

    const pendingPath = path.join(dir, 'gateway', 'pending', `${res.checkpointId}.json`);
    expect(fs.existsSync(pendingPath)).toBe(true);
    const cp = JSON.parse(fs.readFileSync(pendingPath, 'utf-8')) as Record<string, unknown>;
    expect(cp['agentId']).toBe('a1');
    expect(String(cp['reason'] ?? '')).toContain('人工');
    expect(cp['request']).toBeTruthy(); // 请求快照
  });

  it('权限上界：请求所需工具越界 → deny（含越界权限项审计）', () => {
    const gw = createProxyGateway(defaultOptions(dir));
    const res = gw.checkRequest(readReq({ tool: 'rm_rf' }));
    expect(res.decision).toBe('deny');
    expect(res.reason).toContain('rm_rf'); // 审计理由点名越界项
    const lines = readAuditLines(dir);
    const denyLine = lines.find(l => l['decision'] === 'deny');
    expect(denyLine).toBeTruthy();
  });
});

// ════════════════════════════════════════
// 三、HITL 人工批准
// ════════════════════════════════════════

describe('交付一 · HITL 人工批准', () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => rmDir(dir));

  it('approve → 原请求放行（返回 allow + 请求快照）', () => {
    const gw = createProxyGateway(defaultOptions(dir));
    const res = gw.checkRequest(readReq({ tool: 'delete_record', action: 'delete' }));
    expect(res.decision).toBe('hitl-pending');
    const cpId = res.checkpointId!;

    const resolved = gw.resolve(cpId, 'approve');
    expect(resolved.decision).toBe('allow');
    expect((resolved.request as ProxyRequest).tool).toBe('delete_record');
  });

  it('reject → deny + 审计留痕', () => {
    const gw = createProxyGateway(defaultOptions(dir));
    const res = gw.checkRequest(readReq({ tool: 'delete_record', action: 'delete' }));
    const resolved = gw.resolve(res.checkpointId!, 'reject');
    expect(resolved.decision).toBe('deny');

    const lines = readAuditLines(dir);
    expect(lines.some(l => l['event'] === 'hitl-resolve' && l['decision'] === 'deny')).toBe(true);
  });

  it('resolve 未知 checkpointId → 明确报错', () => {
    const gw = createProxyGateway(defaultOptions(dir));
    expect(() => gw.resolve('gw-nonexistent', 'approve')).toThrow(/不存在/);
  });

  it('listPending：列出挂起 checkpoint，resolve 后不再列出', () => {
    const gw = createProxyGateway(defaultOptions(dir, {
      agents: { a1: ['read_file', 'write_file', 'db_write', 'delete_record', 'send_email', 'export_data'] },
    }));
    const r1 = gw.checkRequest(readReq({ tool: 'delete_record', action: 'delete' }));
    const r2 = gw.checkRequest(readReq({ tool: 'export_data', action: 'export' }));
    expect(gw.listPending().map(p => p.checkpointId).sort()).toEqual(
      [r1.checkpointId, r2.checkpointId].sort(),
    );
    gw.resolve(r1.checkpointId!, 'approve');
    const remain = gw.listPending().map(p => p.checkpointId);
    expect(remain).toContain(r2.checkpointId);
    expect(remain).not.toContain(r1.checkpointId);
  });
});

// ════════════════════════════════════════
// 四、权限上界（单元：锁定 / 收窄 / 越界三态）
// ════════════════════════════════════════

describe('交付一 · 权限上界（permission-ceiling 单元）', () => {
  it('首次锁定：lock 后 ceiling 固定，重复 lock 不扩大', () => {
    const ceiling = createPermissionCeiling();
    ceiling.lock('a1', ['read_file', 'write_file']);
    ceiling.lock('a1', ['exec_shell']); // 二次 lock 不覆盖（首快照生效）
    expect(ceiling.check('a1', ['read_file', 'write_file']).ok).toBe(true);
    expect(ceiling.check('a1', ['exec_shell']).ok).toBe(false);
    expect(ceiling.ceiling('a1')!.has('exec_shell')).toBe(false);
  });

  it('收窄：narrow 只减不增——新增项被丢弃，收窄后原权限越界', () => {
    const ceiling = createPermissionCeiling();
    ceiling.lock('a1', ['read_file', 'write_file']);
    ceiling.narrow('a1', ['read_file', 'exec_shell']); // exec_shell 不在原上界 → 丢弃
    expect(ceiling.ceiling('a1')!.has('write_file')).toBe(false); // 已收窄掉
    expect(ceiling.ceiling('a1')!.has('exec_shell')).toBe(false); // 未扩大
    expect(ceiling.check('a1', ['write_file']).ok).toBe(false); // 原权限现为越界
  });

  it('越界返回 excess 明细（供审计点名）', () => {
    const ceiling = createPermissionCeiling();
    ceiling.lock('a1', ['read_file']);
    const res = ceiling.check('a1', ['read_file', 'exec_shell', 'sudo']);
    expect(res.ok).toBe(false);
    expect(res.excess.sort()).toEqual(['exec_shell', 'sudo']);
  });

  it('高频越界：连续 5 次触发 onViolation（对接 circuit-breaker），成功校验重置计数', () => {
    const onViolation = vi.fn();
    const ceiling = createPermissionCeiling({ violationThreshold: 5, onViolation });
    ceiling.lock('a1', ['read_file']);
    for (let i = 0; i < 4; i++) ceiling.check('a1', ['exec_shell']);
    expect(onViolation).not.toHaveBeenCalled(); // 未到阈值
    ceiling.check('a1', ['exec_shell']); // 第 5 次
    expect(onViolation).toHaveBeenCalledTimes(1);
    expect(onViolation.mock.calls[0]![0]).toBe('a1');
    // 成功校验重置连续计数——之后 4 次越界不再触发
    ceiling.check('a1', ['read_file']);
    for (let i = 0; i < 4; i++) ceiling.check('a1', ['exec_shell']);
    expect(onViolation).toHaveBeenCalledTimes(1);
  });
});

// ════════════════════════════════════════
// 五、越界不中断 + execute 执行路径
// ════════════════════════════════════════

describe('交付一 · 越界不中断与执行', () => {
  let dir: string;
  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => rmDir(dir));

  it('越界不中断任务：一次越界 deny 后，同 agent 后续合法请求继续处理', () => {
    const gw = createProxyGateway(defaultOptions(dir));
    expect(gw.checkRequest(readReq({ tool: 'rm_rf' })).decision).toBe('deny'); // 越界
    expect(gw.checkRequest(readReq()).decision).toBe('allow'); // 不中断——下一请求正常
  });

  it('execute：allow 请求执行 executor 并返回结果；deny 请求不执行', async () => {
    const gw = createProxyGateway(defaultOptions(dir));
    const ok = await gw.execute(readReq(), async () => 'done-result');
    expect(ok.decision).toBe('allow');
    expect(ok.result).toBe('done-result');

    const denied = await gw.execute(readReq({ tool: 'rm_rf' }), async () => 'should-not-run');
    expect(denied.decision).toBe('deny');
    expect(denied.result).toBeUndefined();
  });

  it('execute：executor 抛错 → abort 记录（有 wal 时）并不吞错误', async () => {
    const begins: string[] = [];
    const commits: string[] = [];
    const aborts: string[] = [];
    const gw = createProxyGateway(defaultOptions(dir, {
      wal: {
        begin: (taskId) => { begins.push(taskId); },
        commit: (taskId) => { commits.push(taskId); },
        abort: (taskId) => { aborts.push(taskId); },
      },
    }));
    await expect(gw.execute(readReq(), async () => { throw new Error('boom'); }))
      .rejects.toThrow('boom');
    expect(begins.length).toBe(1);
    expect(aborts.length).toBe(1);
    expect(commits.length).toBe(0);
  });
});
