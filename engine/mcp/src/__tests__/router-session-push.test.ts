// ============================================================
// router-session-push.test.ts · router_session_push MCP tool 测试
// v1.4.9 T7（第七章）新增
// ============================================================
//
// 覆盖面：
//   1. text 首行 [sofagent] 前缀（三层签名铁律）
//   2. schema 校验 fail-closed（坏格式拒绝 + 人读 issues）
//   3. 合法推送落盘（多轮展开 + 脱敏 + cost 台账 + 审计事件 HMAC）
//   4. 幂等：同 sessionId 重复推送拒绝
//   5. TOOLS 数组含 router_session_push（注册面接线——TOOLS 104）
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { routerSessionPush } from '../tools/router-session-push';
import { TOOLS } from '../tool-registry';

const tmpDirs: string[] = [];

function mkDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-router-push-'));
  tmpDirs.push(dir);
  return dir;
}

// A2 自指规避：sk 密钥 fixture 运行时拼接（项目先例）
const SK_KEY = ['sk-abcdefghij', 'klmnopqrstuvwxyz1234567890'].join('');

function mkRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessionId: 'sess-test-001',
    enterpriseId: 'ent-test',
    source: 'router-unit',
    messages: [
      { role: 'system', content: '你是企业助手' },
      { role: 'user', content: `查产能，key=${SK_KEY}` },
      { role: 'assistant', content: '今日产能 12,400 件。' },
    ],
    usage: { inputTokens: 300, outputTokens: 100, model: 'qwen2.5-7b', pricePerKUsd: 0.002 },
    route: { targetModel: 'qwen2.5-7b', reason: '本地优先' },
    apiKeyId: 'key-42',
    ...overrides,
  };
}

describe('router_session_push MCP tool（v1.4.9 T7）', () => {
  let dataDir: string;

  beforeAll(() => {
    dataDir = mkDataDir();
    process.env.SOFAGENT_DATA = dataDir;
    // 临时 HMAC 密钥（隔离真实 ~/.sofagent-key）
    const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofagent-key-iso-'));
    tmpDirs.push(keyDir);
    fs.writeFileSync(path.join(keyDir, '.sofagent-key'), 'test-hmac-key-0123456789abcdef', 'utf-8');
    process.env.SOFAGENT_KEY_PATH = path.join(keyDir, '.sofagent-key');
  });

  afterAll(() => {
    delete process.env.SOFAGENT_KEY_PATH;
    for (const d of tmpDirs) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  });

  it('text 首行以 [sofagent] 开头（成功路径）', async () => {
    const r = await routerSessionPush({ raw: mkRaw() });
    expect(r.text.startsWith('[sofagent]')).toBe(true);
    expect(r.data.ok).toBe(true);
    expect(r.data.isError).toBe(false);
  });

  it('schema 校验 fail-closed——坏格式拒绝且给 issues', async () => {
    const r = await routerSessionPush({ raw: { sessionId: '', messages: [] } });
    expect(r.data.ok).toBe(false);
    expect(r.data.reason).toBe('invalid-schema');
    expect(r.data.message).toContain('sessionId');
  });

  it('未知字段拒绝（.strict() 透传）', async () => {
    const r = await routerSessionPush({ raw: mkRaw({ evil: 'x' }) });
    expect(r.data.ok).toBe(false);
    expect(r.data.reason).toBe('invalid-schema');
  });

  it('参数缺失拒绝（raw 非对象）', async () => {
    const r = await routerSessionPush({ raw: null });
    expect(r.data.ok).toBe(false);
    expect(r.data.reason).toBe('invalid-params');
  });

  it('合法推送——多轮展开落盘 + messages 字段合法 JSON', async () => {
    const r = await routerSessionPush({ raw: mkRaw({ sessionId: 'sess-full' }) });
    expect(r.data.ok).toBe(true);
    expect(r.data.recordCount).toBe(1);
    const sessionFile = r.data.sessionFile!;
    expect(fs.existsSync(sessionFile)).toBe(true);
    const lines = fs.readFileSync(sessionFile, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(1);
    const rec = JSON.parse(lines[0]!) as { id: string; fields: Record<string, unknown> };
    expect(rec.id).toBe('sess-full#w1');
    // messages 字段是合法 JSON 数组（chat 形态消费）
    const msgs = JSON.parse(rec.fields.messages as string) as Array<{ role: string; content: string }>;
    expect(msgs).toHaveLength(3);
    expect(msgs[0]!.role).toBe('system');
  });

  it('脱敏贯通——payload 内密钥不落盘原值', async () => {
    const r = await routerSessionPush({ raw: mkRaw({ sessionId: 'sess-redact' }) });
    expect(r.data.ok).toBe(true);
    const content = fs.readFileSync(r.data.sessionFile!, 'utf-8');
    expect(content).not.toContain(SK_KEY);
    expect(content).not.toContain('sk-abcdefghij');
  });

  it('usage 入 cost 台账——按模型记录 + 单价核算', async () => {
    const r = await routerSessionPush({ raw: mkRaw({ sessionId: 'sess-cost' }) });
    expect(r.data.ok).toBe(true);
    const ledger = r.data.costLedgerFile!;
    expect(fs.existsSync(ledger)).toBe(true);
    // 台账 append-only——读末行（本会话入账行）
    const lastLine = fs.readFileSync(ledger, 'utf-8').trim().split('\n').pop()!;
    const entry = JSON.parse(lastLine) as {
      model: string; apiKeyId: string; inputTokens: number; outputTokens: number; costUsd: number;
    };
    expect(entry.model).toBe('qwen2.5-7b');
    expect(entry.apiKeyId).toBe('key-42');
    expect(entry.inputTokens).toBe(300);
    expect(entry.outputTokens).toBe(100);
    expect(entry.costUsd).toBeCloseTo(0.4 * 0.002); // 400/1000 × 0.002
  });

  it('key 维度过站行为 HMAC 挂链——审计事件含 hmacSig', async () => {
    const r = await routerSessionPush({ raw: mkRaw({ sessionId: 'sess-audit' }) });
    expect(r.data.ok).toBe(true);
    expect(r.data.auditLogged).toBe(true);
    const events = fs.readFileSync(path.join(dataDir, 'audit', 'router-session-events.jsonl'), 'utf-8');
    const last = events.trim().split('\n').pop()!;
    const evt = JSON.parse(last) as { sessionId: string; hmacSig?: string; key: string };
    expect(evt.sessionId).toBe('sess-audit');
    expect(evt.key).toBe('key-42');
    expect(evt.hmacSig).toMatch(/^[0-9a-f]{64}$/); // HMAC 留痕
  });

  it('幂等——同 sessionId 重复推送拒绝（不追加）', async () => {
    const first = await routerSessionPush({ raw: mkRaw({ sessionId: 'sess-dup' }) });
    expect(first.data.ok).toBe(true);
    const second = await routerSessionPush({ raw: mkRaw({ sessionId: 'sess-dup' }) });
    expect(second.data.ok).toBe(false);
    expect(second.data.reason).toBe('duplicate-session');
    // 文件仍只有一份记录（未追加）
    const lines = fs.readFileSync(first.data.sessionFile!, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(1);
  });

  it('TOOLS 数组含 router_session_push（注册面接线——当版终值）', () => {
    const t = TOOLS.find((x) => x.name === 'router_session_push');
    expect(t).toBeDefined();
    expect(t!.roles).toContain('ops');
    expect(t!.description).toContain('session 承接');
    expect(t!.inputSchema.required).toContain('raw');
    // 全量计数锁（107 = v1.5.2 终值——v1.5.0 trace_reconcile 105 + v1.5.2 audit_query/ruleset_export 107）
    expect(TOOLS.length).toBe(107);
  });
});
