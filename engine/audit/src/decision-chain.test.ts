// ============================================================
// decision-chain.test.ts · 决策日志链完整性校验测试（v1.3.0 交付 6 T02）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { emitDecision } from './decision-log';
import { checkDecisionChainDetailed } from './decision-chain';
import { getDecisionLogPath } from '@sofagent/core';

function tmpDir(): string {
  const dir = join(tmpdir(), `sofagent-decision-chain-test-${Date.now()}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeInput(sessionId: string) {
  return {
    agentId: 'engineer',
    sessionId,
    kind: 'TOOL_GATE' as const,
    moment: 'ACT' as const,
    why: { text: `决策 ${sessionId}` },
  };
}

describe('checkDecisionChainDetailed', () => {
  let testDir: string;
  let savedKeyPath: string | undefined;

  beforeEach(() => {
    testDir = tmpDir();
    savedKeyPath = process.env.SOFAGENT_KEY_PATH;
    const KEY_PATH = join(testDir, 'test-hmac-key');
    writeFileSync(KEY_PATH, 'test-hmac-key-0123456789abcdef');
    process.env.SOFAGENT_KEY_PATH = KEY_PATH;
  });

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* */ }
    if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
    else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
  });

  it('文件不存在 → insufficient', () => {
    const result = checkDecisionChainDetailed(testDir);
    expect(result.status).toBe('insufficient');
  });

  it('仅 1 条记录 → insufficient', () => {
    emitDecision(makeInput('s1'), testDir);
    const result = checkDecisionChainDetailed(testDir);
    expect(result.status).toBe('insufficient');
  });

  it('连续写入 2 条 → ok（链完整 + HMAC 验签通过）', () => {
    emitDecision(makeInput('s1'), testDir);
    emitDecision(makeInput('s2'), testDir);
    const result = checkDecisionChainDetailed(testDir);
    expect(result.status).toBe('ok');
  });

  it('篡改决策条目内容 → tampered（红）', () => {
    emitDecision(makeInput('s1'), testDir);
    emitDecision(makeInput('s2'), testDir);
    const filePath = getDecisionLogPath(testDir);
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
    // 篡改第二条的 why.text（在 HMAC 签名之后改内容）
    const second = JSON.parse(lines[1]!);
    second.why = { text: '被篡改的决策理由' };
    lines[1] = JSON.stringify(second);
    writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
    const result = checkDecisionChainDetailed(testDir);
    expect(result.status).toBe('tampered');
  });

  it('篡改创世条目 → unverifiable（mirror core：v2 创世分支不做指纹区分）', () => {
    // 与 checkHistoryChainDetailed 完全同构：v2 创世条目 HMAC 不匹配在 core 的
    // genesis 分支只置 foundUnverifiable（不判 tampered）——decision-chain mirror 同行为。
    emitDecision(makeInput('s1'), testDir);
    emitDecision(makeInput('s2'), testDir);
    const filePath = getDecisionLogPath(testDir);
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
    const genesis = JSON.parse(lines[0]!);
    genesis.why = { text: '创世被篡改' };
    lines[0] = JSON.stringify(genesis);
    writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
    const result = checkDecisionChainDetailed(testDir);
    expect(result.status).toBe('unverifiable');
  });

  it('无密钥时降级 SHA-256 链仍通过（hmacSig 缺省）', () => {
    // 无密钥 = SOFAGENT_KEY_PATH 指向不存在的文件（getHmacKey 返回 null → 不写 hmacSig）。
    // 注意：不能 delete 环境变量——会 fallback 到真实 ~/.sofagent-key 造成测试污染。
    const KEY_PATH = join(testDir, 'missing-hmac-key');
    process.env.SOFAGENT_KEY_PATH = KEY_PATH;
    try { rmSync(KEY_PATH, { force: true }); } catch { /* */ }
    emitDecision(makeInput('s1'), testDir);
    emitDecision(makeInput('s2'), testDir);
    const filePath = getDecisionLogPath(testDir);
    const entries = readFileSync(filePath, 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
    expect(entries[0]!.hmacSig).toBeUndefined();
    const result = checkDecisionChainDetailed(testDir);
    expect(result.status).toBe('ok');
  });
});
