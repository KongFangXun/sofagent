// ============================================================
// decision-memory-extractor.test.ts · 决策记忆回灌测试（v1.3.0 交付 10 MA5 + MA7）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { emitDecision, type EmitDecisionInput } from '@sofagent/audit';
import { getHighFrequencyPatterns } from '@sofagent/audit';
import { extractHighFrequencyDecisions, extractRuleContext, runDailyMemoryExtraction, type MemoryEntry } from '../extractors/decision-memory-extractor';

function tmpDir(): string {
  const dir = join(tmpdir(), `sofagent-decision-extract-${Date.now()}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeInput(overrides: Partial<EmitDecisionInput> = {}): EmitDecisionInput {
  return {
    agentId: 'engineer',
    sessionId: 'sess-1',
    kind: 'TOOL_GATE',
    moment: 'ACT',
    why: { text: '拦截写 .env', tags: ['a1'] },
    ...overrides,
  };
}

describe('decision-memory-extractor (MA5/MA7)', () => {
  let testDir: string;
  let savedKeyPath: string | undefined;
  let savedData: string | undefined;

  beforeEach(() => {
    testDir = tmpDir();
    savedKeyPath = process.env.SOFAGENT_KEY_PATH;
    savedData = process.env.SOFAGENT_DATA;
    const KEY_PATH = join(testDir, 'test-hmac-key');
    writeFileSync(KEY_PATH, 'test-hmac-key-0123456789abcdef');
    process.env.SOFAGENT_KEY_PATH = KEY_PATH;
    process.env.SOFAGENT_DATA = join(testDir, 'data');
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* */ }
    if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
    else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
    if (savedData === undefined) delete process.env.SOFAGENT_DATA;
    else process.env.SOFAGENT_DATA = savedData;
  });

  it('MA5: getHighFrequencyPatterns 提取 kind+tags ≥3 次模式', () => {
    for (let i = 0; i < 3; i++) {
      emitDecision(makeInput({ sessionId: `s${i}`, why: { text: 'x', tags: ['a1'] } }));
    }
    emitDecision(makeInput({ sessionId: 's3', why: { text: 'y', tags: ['a9'] } }));

    const patterns = getHighFrequencyPatterns(3);
    expect(patterns.length).toBe(1);
    expect(patterns[0]!.count).toBe(3);
    expect(patterns[0]!.kind).toBe('TOOL_GATE');
  });

  it('MA5: extractHighFrequencyDecisions 产出 forge/decisions namespace', () => {
    for (let i = 0; i < 3; i++) {
      emitDecision(makeInput({ sessionId: `s${i}`, why: { text: 'x', tags: ['a1'] } }));
    }
    const entries = extractHighFrequencyDecisions(3);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]!.namespace).toBe('forge/decisions');
    expect(entries[0]!.content).toContain('TOOL_GATE');
  });

  it('MA7: extractRuleContext 按 triggeredRule 聚合 top-5 上下文', () => {
    const decisions = [
      makeInput({ sessionId: 's1', why: { text: '命中规则 R1 场景A', tags: ['a1'], triggeredRule: 'tool-sensitive-file' } }),
      makeInput({ sessionId: 's2', why: { text: '命中规则 R1 场景B', tags: ['a1'], triggeredRule: 'tool-sensitive-file' } }),
      makeInput({ sessionId: 's3', why: { text: '命中规则 R2', tags: ['a9'], triggeredRule: 'tool-injection' } }),
    ] as EmitDecisionInput[];
    for (const d of decisions) emitDecision(d);

    const entries = extractRuleContext([]);
    const ruleWhy = entries.filter((e) => e.namespace === 'rules/why');
    expect(ruleWhy.length).toBe(2);
    const r1 = ruleWhy.find((e) => (e.metadata as { rule: string }).rule === 'tool-sensitive-file');
    expect(r1).toBeDefined();
    expect(r1!.content).toContain('场景A');
    expect((r1!.metadata as { triggerCount: number }).triggerCount).toBe(2);
  });

  it('MA7: 无 triggeredRule 时回退 tags 中的规则名', () => {
    emitDecision(makeInput({ sessionId: 's1', why: { text: '拦截', tags: ['tool-secret-leak'] } }));
    const entries = extractRuleContext([]);
    const r = entries.find((e) => (e.metadata as { rule: string }).rule === 'tool-secret-leak');
    expect(r).toBeDefined();
  });

  it('runDailyMemoryExtraction: 未配置 FORGE_MEMORY_BACKEND → 仅返回提取结果不 crash', async () => {
    delete process.env.FORGE_MEMORY_BACKEND;
    for (let i = 0; i < 3; i++) {
      emitDecision(makeInput({ sessionId: `s${i}`, why: { text: 'x', tags: ['a1'] } }));
    }
    const entries = await runDailyMemoryExtraction();
    expect(Array.isArray(entries)).toBe(true);
  });

  it('runDailyMemoryExtraction: 注入 writeFn 时逐条写入', async () => {
    delete process.env.FORGE_MEMORY_BACKEND;
    for (let i = 0; i < 3; i++) {
      emitDecision(makeInput({ sessionId: `s${i}`, why: { text: 'x', tags: ['a1'] } }));
    }
    const written: string[] = [];
    const entries = await runDailyMemoryExtraction(async (e: MemoryEntry) => { written.push(e.namespace); return { ok: true }; });
    expect(written.length).toBe(entries.length);
    expect(written.some((n) => n === 'forge/decisions')).toBe(true);
  });
});
