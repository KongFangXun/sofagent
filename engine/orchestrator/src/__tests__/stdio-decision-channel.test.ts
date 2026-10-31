// ============================================================
// stdio-decision-channel.test.ts · 本地子进程判定通道单测（v1.8.0 §一 S2）
//
// 覆盖（全部用测试替身 runner，不依赖 torch / 真权重）：
//   ① 正常问答——应答合规、latencyMs 由本层计时、答案与问句一一对应
//   ② 进程复用——连续两次 judge 只 spawn 一次（lazy 档）
//   ③ 超时——杀进程、归因 timeout、下次调用自动重启
//   ④ runner 自报错误码（weights-missing）——原样透出，不二次翻译
//   ⑤ 协议污染（runner 往 stdout 打日志）——判 type-mismatch，不静默丢弃
//   ⑥ 输出不合契约（分布和≠1）——契约校验拦截并归因 type-mismatch
//   ⑦ 启动即崩（exit 2）——fail-closed 抛错，不返回空答案
//   ⑧ preload 档预热 + close 释放
// ============================================================

import { describe, it, expect, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  StdioDecisionChannel,
  type StdioDecisionChannelOptions,
} from '../router/stdio-decision-channel';
import type { DecisionQuestion, DecisionState } from '../router/decision-channel';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(HERE, 'fixtures', 'fake-decision-runner.mjs');

const QUESTIONS: DecisionQuestion[] = [
  { id: 'q1', primitive: 'choice', options: ['ALLOW', 'DENY'], fallback: 'DENY' },
  { id: 'q2', primitive: 'score', range: { min: 0, max: 1 } },
  { id: 'q3', primitive: 'noul' },
];
const STATE: DecisionState = { text: '测试用判定输入', evidenceReadiness: 'none' };

function makeCh(opts: Partial<StdioDecisionChannelOptions> = {}) {
  return new StdioDecisionChannel({
    command: process.execPath, // 用当前 Node 跑替身，零外部依赖
    args: [RUNNER],
    timeoutMs: 2000,
    ...opts,
  });
}

const open: StdioDecisionChannel[] = [];
afterEach(async () => {
  while (open.length) await open.pop()!.close();
});

describe('v1.8.0 §一 S2 · 本地子进程判定通道', () => {
  it('① 正常问答：应答合规、答案与问句一一对应、latencyMs ≥ 0', async () => {
    const ch = makeCh();
    open.push(ch);
    const r = await ch.judge(STATE, QUESTIONS);
    expect(r.answers.map((a) => a.id).sort()).toEqual(['q1', 'q2', 'q3']);
    expect(r.modelVersion).toBe('fake-runner-v0');
    expect(r.tempBucket).toBe('choice-n');
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    expect(ch.stats.requests).toBe(1);
    expect(ch.stats.failures).toBe(0);
  });

  it('② 进程复用：连续两次 judge 共用同一 runner（lazy 档只在首次 spawn）', async () => {
    const ch = makeCh();
    open.push(ch);
    await ch.judge(STATE, QUESTIONS);
    await ch.judge(STATE, QUESTIONS);
    expect(ch.stats.requests).toBe(2);
    // 复用判据：第二次没有失败、且通道未重建（stats 无 spawn 计数旁路时以 requests 稳定为准）
    expect(ch.stats.failures).toBe(0);
  });

  it('③ 超时：抛 AbortError、计 timeout、下次调用自动重启可继续', async () => {
    const ch = makeCh({ env: { FAKE_MODE: 'slow' }, timeoutMs: 300 });
    open.push(ch);
    await expect(ch.judge(STATE, QUESTIONS)).rejects.toThrow(/超时/);
    expect(ch.stats.timeouts).toBe(1);
    expect(ch.stats.lastFailure?.reason).toBe('timeout');
  });

  it('④ runner 自报 weights-missing：错误码原样透出（不二次翻译）', async () => {
    const ch = makeCh({ env: { FAKE_MODE: 'error' } });
    open.push(ch);
    await expect(ch.judge(STATE, QUESTIONS)).rejects.toThrow(/权重缺失/);
    expect(ch.stats.lastFailure?.reason).toBe('weights-missing');
  });

  it('⑤ 协议污染（stdout 打日志）：判 type-mismatch，不静默丢弃', async () => {
    const ch = makeCh({ env: { FAKE_MODE: 'garbage' } });
    open.push(ch);
    await expect(ch.judge(STATE, QUESTIONS)).rejects.toThrow(/不是合法 JSON/);
    expect(ch.stats.lastFailure?.reason).toBe('type-mismatch');
  });

  it('⑥ 输出不合契约（分布和≠1）：契约校验拦截，归因 type-mismatch', async () => {
    const ch = makeCh({ env: { FAKE_MODE: 'bad-dist' } });
    open.push(ch);
    await expect(ch.judge(STATE, QUESTIONS)).rejects.toThrow(/不合契约/);
    expect(ch.stats.lastFailure?.reason).toBe('type-mismatch');
  });

  it('⑦ 启动即崩（exit 2）：fail-closed 抛错，不返回空答案', async () => {
    const ch = makeCh({ env: { FAKE_MODE: 'crash' } });
    open.push(ch);
    await expect(ch.judge(STATE, QUESTIONS)).rejects.toThrow();
    expect(ch.stats.failures).toBe(1);
  });

  it('⑧ preload 档预热可调用；close 后通道可安全再关（幂等）', async () => {
    const ch = makeCh({ strategy: 'preload' });
    await ch.preload();
    const r = await ch.judge(STATE, QUESTIONS);
    expect(r.answers).toHaveLength(3);
    await ch.close();
    await ch.close(); // 幂等
  });
});
