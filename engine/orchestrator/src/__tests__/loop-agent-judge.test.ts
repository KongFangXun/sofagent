// ============================================================
// loop-agent-judge.test.ts · Onboard L1 判定器测试（v1.3.1 交付 8）
// ============================================================
//
// 覆盖：
// - crash：信号终止（SIGKILL/SIGSEGV 等）/ 无退出码无信号
// - error：非零退出码 / stderr 有输出
// - timeout：超过可配超时阈值
// - passed：退出码 0 无 stderr（不判对不对——L1 边界）
// ============================================================

import { describe, it, expect } from 'vitest';
import { judgeRunResult, DEFAULT_TIMEOUT_MS } from '../loop-agent/judge';

describe('loop-agent judge · L1 三态判定（v1.3.1 交付 8）', () => {
  it('crash：进程被崩溃信号终止（SIGKILL）', () => {
    const verdict = judgeRunResult({ exitCode: null, signal: 'SIGKILL', durationMs: 1000 });
    expect(verdict.state).toBe('crash');
    expect(verdict.detail).toContain('SIGKILL');
  });

  it('crash：段错误信号（SIGSEGV）', () => {
    const verdict = judgeRunResult({ exitCode: null, signal: 'SIGSEGV' });
    expect(verdict.state).toBe('crash');
  });

  it('crash：无退出码无信号（异常终止）', () => {
    const verdict = judgeRunResult({ exitCode: null, stderr: 'core dumped' });
    expect(verdict.state).toBe('crash');
  });

  it('error：非零退出码', () => {
    const verdict = judgeRunResult({ exitCode: 1, stderr: 'Error: module not found' });
    expect(verdict.state).toBe('error');
    expect(verdict.detail).toContain('退出码 1');
  });

  it('error：退出码 0 但 stderr 有输出', () => {
    const verdict = judgeRunResult({ exitCode: 0, stderr: 'warning: deprecated API' });
    expect(verdict.state).toBe('error');
    expect(verdict.detail).toContain('stderr');
  });

  it('timeout：超过可配超时阈值（默认 120s）', () => {
    const verdict = judgeRunResult({ exitCode: null, durationMs: 121_000 });
    expect(verdict.state).toBe('timeout');
    expect(verdict.detail).toContain('超时');
  });

  it('timeout：阈值可配（timeoutMs 覆盖）', () => {
    const verdict = judgeRunResult({ exitCode: null, durationMs: 5_000 }, { timeoutMs: 3_000 });
    expect(verdict.state).toBe('timeout');
  });

  it('timeout 优先级高于 crash/error（超时最明确）', () => {
    const verdict = judgeRunResult({ exitCode: 1, signal: 'SIGKILL', stderr: 'x', durationMs: 200_000 });
    expect(verdict.state).toBe('timeout');
  });

  it('passed：退出码 0 无 stderr（不判对不对——L1 边界）', () => {
    const verdict = judgeRunResult({ exitCode: 0, stdout: '语义上可能不对，但跑起来了', durationMs: 500 });
    expect(verdict.state).toBe('passed');
    expect(verdict.detail).toContain('L2-L5'); // 语义对错留 L2-L5
  });

  it('DEFAULT_TIMEOUT_MS = 120000', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(120_000);
  });
});
