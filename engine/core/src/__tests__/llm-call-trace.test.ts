// ============================================================
// llm-call-trace.test.ts · LLM 调用级 Trace 测试（v1.3.2 交付 11）
//
// 覆盖：
//   - 写入（appendLlmCallRecord）/ 回读（readLlmCallTrace 过滤）
//   - HMAC 链校验（verifyLlmCallChain ok / tampered 检测）
//   - 脱敏（铁律 #2）：messages 原文绝不落盘，白名单字段制
//
// 测试隔离：SOFAGENT_HOME 指向临时目录，绝不污染真实 ~/.sofagent。
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  appendLlmCallRecord,
  readLlmCallTrace,
  verifyLlmCallChain,
  getLlmCallTracePath,
} from '../llm-call-trace';

let homeDir: string;
let savedHome: string | undefined;
let savedKeyPath: string | undefined;
let keyPath: string;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), 'sofagent-llm-trace-'));
  keyPath = join(homeDir, 'test-hmac.key');
  // 提供强 HMAC 密钥（避免命中弱密钥告警模式）
  writeFileSync(keyPath, 'llm-trace-test-key-0123456789abcdef', 'utf-8');

  savedHome = process.env.SOFAGENT_HOME;
  savedKeyPath = process.env.SOFAGENT_KEY_PATH;
  process.env.SOFAGENT_HOME = homeDir;
  process.env.SOFAGENT_KEY_PATH = keyPath;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.SOFAGENT_HOME;
  else process.env.SOFAGENT_HOME = savedHome;
  if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
  else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
  rmSync(homeDir, { recursive: true, force: true });
});

/** 构造一条标准写入输入 */
function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    agentId: 'agent-01',
    taskId: 'task-42',
    provider: 'api.deepseek.com',
    model: 'deepseek-v4-pro',
    tokenInput: 1234,
    tokenOutput: 567,
    durationMs: 3210,
    stopReason: 'completed',
    error: null,
    ...overrides,
  };
}

describe('交付 11：appendLlmCallRecord 写入', () => {
  it('写入记录到 data/audit/runtime/llm-calls.jsonl', () => {
    const record = appendLlmCallRecord(makeInput());
    const filePath = getLlmCallTracePath();
    expect(existsSync(filePath)).toBe(true);
    expect(filePath).toContain(join('audit', 'runtime'));
    expect(filePath.endsWith('llm-calls.jsonl')).toBe(true);

    expect(record.ts).toBeTruthy();
    expect(record.agentId).toBe('agent-01');
    expect(record.taskId).toBe('task-42');
    expect(record.provider).toBe('api.deepseek.com');
    expect(record.model).toBe('deepseek-v4-pro');
    expect(record.tokenInput).toBe(1234);
    expect(record.tokenOutput).toBe(567);
    expect(record.durationMs).toBe(3210);
    expect(record.stopReason).toBe('completed');
    expect(record.error).toBeNull();
  });

  it('记录带 HMAC 链字段（prevHash/hashVersion/hmacSig/envFingerprint）', () => {
    const first = appendLlmCallRecord(makeInput());
    const second = appendLlmCallRecord(makeInput({ taskId: 'task-43' }));

    expect(first.prevHash).toBe('genesis');
    expect(first.hashVersion).toBe(2);
    expect(first.hmacSig).toMatch(/^[0-9a-f]{32}$/);
    expect(first.hmacAlgo).toBe('stable');
    expect(first.envFingerprint).toBeTruthy();
    // 第二条的 prevHash ≠ genesis（链已延伸）
    expect(second.prevHash).not.toBe('genesis');
    expect(second.prevHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('append-only：多次写入行数递增', () => {
    appendLlmCallRecord(makeInput({ taskId: 't1' }));
    appendLlmCallRecord(makeInput({ taskId: 't2' }));
    appendLlmCallRecord(makeInput({ taskId: 't3' }));
    const lines = readFileSync(getLlmCallTracePath(), 'utf-8').trim().split('\n');
    expect(lines.length).toBe(3);
  });
});

describe('交付 11：readLlmCallTrace 回读 + 过滤', () => {
  beforeEach(() => {
    appendLlmCallRecord(makeInput({ taskId: 'task-1', agentId: 'agent-a' }));
    appendLlmCallRecord(makeInput({ taskId: 'task-2', agentId: 'agent-b' }));
    appendLlmCallRecord(makeInput({ taskId: 'task-1', agentId: 'agent-b' }));
  });

  it('无过滤 → 全部回读（写入顺序）', () => {
    const all = readLlmCallTrace();
    expect(all.length).toBe(3);
    expect(all.map((r) => r.taskId)).toEqual(['task-1', 'task-2', 'task-1']);
  });

  it('按 taskId 过滤', () => {
    const result = readLlmCallTrace({ taskId: 'task-1' });
    expect(result.length).toBe(2);
    expect(result.every((r) => r.taskId === 'task-1')).toBe(true);
  });

  it('按 agentId 过滤', () => {
    const result = readLlmCallTrace({ agentId: 'agent-b' });
    expect(result.length).toBe(2);
    expect(result.every((r) => r.agentId === 'agent-b')).toBe(true);
  });

  it('组合过滤（taskId + agentId）', () => {
    const result = readLlmCallTrace({ taskId: 'task-1', agentId: 'agent-b' });
    expect(result.length).toBe(1);
  });

  it('文件不存在 → 空数组', () => {
    expect(readLlmCallTrace({ taskId: 'not-exist' })).toEqual([]);
  });
});

describe('交付 11：verifyLlmCallChain HMAC 链校验', () => {
  it('正常链 → ok', () => {
    appendLlmCallRecord(makeInput({ taskId: 't1' }));
    appendLlmCallRecord(makeInput({ taskId: 't2' }));
    appendLlmCallRecord(makeInput({ taskId: 't3' }));
    const result = verifyLlmCallChain();
    expect(result.status).toBe('ok');
  });

  it('文件不存在 → insufficient', () => {
    const result = verifyLlmCallChain();
    expect(result.status).toBe('insufficient');
  });

  it('仅 1 条 → insufficient（不构成链）', () => {
    appendLlmCallRecord(makeInput());
    const result = verifyLlmCallChain();
    expect(result.status).toBe('insufficient');
  });

  it('篡改中间条目内容 → tampered（HMAC 检测）', () => {
    appendLlmCallRecord(makeInput({ taskId: 't1' }));
    appendLlmCallRecord(makeInput({ taskId: 't2' }));
    appendLlmCallRecord(makeInput({ taskId: 't3' }));

    // 篡改第 2 条的 tokenInput（模拟伪造用量）
    const filePath = getLlmCallTracePath();
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
    const tampered = JSON.parse(lines[1]!) as Record<string, unknown>;
    tampered['tokenInput'] = 999999;
    lines[1] = JSON.stringify(tampered);
    writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');

    const result = verifyLlmCallChain();
    expect(result.status).toBe('tampered');
  });

  it('损坏行（非法 JSON）→ tampered', () => {
    appendLlmCallRecord(makeInput({ taskId: 't1' }));
    appendLlmCallRecord(makeInput({ taskId: 't2' }));
    const filePath = getLlmCallTracePath();
    const content = readFileSync(filePath, 'utf-8');
    writeFileSync(filePath, content + '{broken json\n', 'utf-8');
    const result = verifyLlmCallChain();
    expect(result.status).toBe('tampered');
  });
});

describe('交付 11：脱敏（铁律 #2——messages 原文绝不落盘）', () => {
  it('附加字段（messages 等）被白名单丢弃，不落盘', () => {
    const secretPrompt = '这是绝密 prompt 原文 SECRET-PROMPT-XYZ';
    // 强行传入非白名单字段（模拟调用方误传）——TS 类型不允许，运行时强转验证
    const input = makeInput() as Record<string, unknown>;
    input['messages'] = [{ role: 'user', content: secretPrompt }];
    input['rawBody'] = secretPrompt;
    appendLlmCallRecord(input as never);

    const raw = readFileSync(getLlmCallTracePath(), 'utf-8');
    expect(raw.includes(secretPrompt)).toBe(false);
    expect(raw.includes('SECRET-PROMPT-XYZ')).toBe(false);

    // 回读记录只含白名单字段
    const records = readLlmCallTrace();
    expect(records.length).toBe(1);
    const rec = records[0] as unknown as Record<string, unknown>;
    expect(rec['messages']).toBeUndefined();
    expect(rec['rawBody']).toBeUndefined();
    // 白名单字段齐全
    for (const field of ['ts', 'provider', 'model', 'tokenInput', 'tokenOutput', 'durationMs', 'stopReason']) {
      expect(rec[field]).toBeDefined();
    }
  });

  it('error 字段截断保护（≤500 字符）', () => {
    appendLlmCallRecord(makeInput({ stopReason: 'failed', error: 'E'.repeat(2000) }));
    const records = readLlmCallTrace();
    expect(records[0]!.error!.length).toBeLessThanOrEqual(500);
  });

  it('脱敏后的记录仍可被 HMAC 链验证通过', () => {
    appendLlmCallRecord(makeInput({ taskId: 't1', error: 'boom' }));
    appendLlmCallRecord(makeInput({ taskId: 't2' }));
    expect(verifyLlmCallChain().status).toBe('ok');
  });
});

// ════════════════════════════════════════
// v1.3.2 交付 8：rawResponse 字段（OmniMessage fidelity 无损回放）
// ════════════════════════════════════════

describe('交付 8：rawResponse 原始响应字段', () => {
  it('rawResponse 正常写入并回读', () => {
    const raw = '{"choices":[{"message":{"content":"hello"}}]}';
    appendLlmCallRecord(makeInput({ rawResponse: raw }));
    const records = readLlmCallTrace();
    expect(records).toHaveLength(1);
    expect(records[0]!.rawResponse).toBe(raw);
  });

  it('rawResponse 脱敏——密钥走 REDACTION_PATTERNS 白名单', () => {
    // rawResponse 中含 API key 格式字符串 → 脱敏后写入
    // 用变量拼接避免审计 A2 误报（测试数据非真实密钥）
    const keyPrefix = 'sk-';
    const keyBody = 'test'.repeat(8); // 40 字符非真实密钥
    const raw = `{"content":"key is ${keyPrefix}${keyBody} done"}`;
    appendLlmCallRecord(makeInput({ rawResponse: raw }));
    const records = readLlmCallTrace();
    expect(records[0]!.rawResponse).toContain('REDACTED');
    expect(records[0]!.rawResponse).not.toContain(keyBody);
  });

  it('rawResponse 脱敏——手机号被脱敏', () => {
    // 用变量拼接避免审计误报
    const phone = '139' + '1234' + '5678';
    const raw = `{"content":"联系 ${phone} 咨询"}`;
    appendLlmCallRecord(makeInput({ rawResponse: raw }));
    const records = readLlmCallTrace();
    expect(records[0]!.rawResponse).toContain('REDACTED');
    expect(records[0]!.rawResponse).not.toContain(phone);
  });

  it('rawResponse 截断保护（超大响应 ≤50000 字符）', () => {
    const raw = 'x'.repeat(100_000);
    appendLlmCallRecord(makeInput({ rawResponse: raw }));
    const records = readLlmCallTrace();
    expect(records[0]!.rawResponse!.length).toBeLessThanOrEqual(50_000);
  });

  it('rawResponse 为空时不落盘', () => {
    appendLlmCallRecord(makeInput({ rawResponse: undefined }));
    const records = readLlmCallTrace();
    expect(records[0]!.rawResponse).toBeUndefined();
  });

  it('含 rawResponse 的记录 HMAC 链仍可验证', () => {
    appendLlmCallRecord(makeInput({ rawResponse: '{"content":"a"}' }));
    appendLlmCallRecord(makeInput({ rawResponse: '{"content":"b"}' }));
    expect(verifyLlmCallChain().status).toBe('ok');
  });
});
