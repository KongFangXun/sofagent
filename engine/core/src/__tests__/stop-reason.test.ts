// ============================================================
// stop-reason.test.ts · 错误处理升级测试（v1.3.1 交付 12）
//
// 覆盖：
//   - stop_reason 六值分类（classifyError）
//   - auth（401/403）永不重试（铁律）
//   - 退避序列 2s→4s→8s→16s→30s（封顶 30s，≤5 次）
//   - convergeToolError 工具失败收敛为结构化消息（不 throw）
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  classifyError,
  isRetryableStopReason,
  backoffDelayMs,
  BACKOFF_SCHEDULE_MS,
  MAX_RETRY_COUNT,
} from '../stop-reason';
import type { StopReason } from '../stop-reason';
import { callModelAPI, convergeToolError, ModelCallError } from '../model-client';

describe('交付 12：stop_reason 六值分类 classifyError', () => {
  // ── auth：凭证被拒（401/403）永不重试 ──

  it('HTTP 401 → auth（显式 httpStatus 参数）', () => {
    expect(classifyError(new Error('模型 API 调用失败'), 401)).toBe('auth');
  });

  it('HTTP 403 → auth（显式 httpStatus 参数）', () => {
    expect(classifyError(new Error('forbidden'), 403)).toBe('auth');
  });

  it('错误消息含 401 → auth（消息推断）', () => {
    expect(classifyError(new Error('模型 API 返回错误 401: Unauthorized'))).toBe('auth');
  });

  it('错误消息含 403 → auth（消息推断）', () => {
    expect(classifyError(new Error('模型 API 返回错误 403: invalid api key'))).toBe('auth');
  });

  it('err.httpStatus 属性 403 → auth', () => {
    const err = new Error('x');
    (err as Error & { httpStatus?: number }).httpStatus = 403;
    expect(classifyError(err)).toBe('auth');
  });

  // ── aborted：用户中断不重试 ──

  it('用户中断 → aborted', () => {
    expect(classifyError(new Error('用户中断'))).toBe('aborted');
    expect(classifyError(new Error('Aborted by user'))).toBe('aborted');
  });

  // ── timeout：超时/传输断开 ──

  it('超时 → timeout', () => {
    expect(classifyError(new Error('request timeout after 60000ms'))).toBe('timeout');
  });

  it('AbortError（传输层 abort）→ timeout', () => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    expect(classifyError(err)).toBe('timeout');
  });

  it('网络错误 fetch failed → timeout', () => {
    expect(classifyError(new Error('fetch failed'))).toBe('timeout');
  });

  it('连接重置 ECONNRESET → timeout', () => {
    expect(classifyError(new Error('socket error: ECONNRESET'))).toBe('timeout');
  });

  // ── malformed：解析失败/流截断 ──

  it('JSON 解析失败 → malformed', () => {
    expect(classifyError(new Error('Unexpected token < in JSON at position 0'))).toBe('malformed');
  });

  it('响应解析失败（流截断）→ malformed', () => {
    expect(classifyError(new Error('模型 API 响应解析失败（疑似流截断）'))).toBe('malformed');
  });

  it('空内容 → malformed', () => {
    expect(classifyError(new Error('模型 API 返回空内容'))).toBe('malformed');
  });

  // ── failed：其余非瞬态错误 ──

  it('其他错误 → failed', () => {
    expect(classifyError(new Error('模型 API 返回错误 400: bad request'))).toBe('failed');
    expect(classifyError(new Error('internal error'))).toBe('failed');
  });

  // ── 重试性判定 ──

  it('isRetryableStopReason：timeout/malformed/failed 可重试', () => {
    expect(isRetryableStopReason('timeout')).toBe(true);
    expect(isRetryableStopReason('malformed')).toBe(true);
    expect(isRetryableStopReason('failed')).toBe(true);
  });

  it('isRetryableStopReason：auth 永不重试（铁律）', () => {
    expect(isRetryableStopReason('auth')).toBe(false);
  });

  it('isRetryableStopReason：aborted 不重试', () => {
    expect(isRetryableStopReason('aborted')).toBe(false);
  });

  it('isRetryableStopReason：completed 不重试', () => {
    expect(isRetryableStopReason('completed')).toBe(false);
  });

  it('六值全覆盖：每个 StopReason 都有明确的重试/不重试归属', () => {
    const all: StopReason[] = ['completed', 'aborted', 'timeout', 'malformed', 'failed', 'auth'];
    const retryable = all.filter(isRetryableStopReason);
    expect(retryable).toEqual(['timeout', 'malformed', 'failed']);
  });
});

describe('交付 12：指数退避序列', () => {
  it('退避表 = 2s → 4s → 8s → 16s → 30s', () => {
    expect(BACKOFF_SCHEDULE_MS).toEqual([2000, 4000, 8000, 16000, 30000]);
  });

  it('最多 5 次（≤5）', () => {
    expect(MAX_RETRY_COUNT).toBe(5);
    expect(BACKOFF_SCHEDULE_MS.length).toBe(5);
  });

  it('backoffDelayMs 逐次取值正确', () => {
    expect(backoffDelayMs(0)).toBe(2000);
    expect(backoffDelayMs(1)).toBe(4000);
    expect(backoffDelayMs(2)).toBe(8000);
    expect(backoffDelayMs(3)).toBe(16000);
    expect(backoffDelayMs(4)).toBe(30000);
  });

  it('超出表长度取封顶值 30s', () => {
    expect(backoffDelayMs(5)).toBe(30000);
    expect(backoffDelayMs(99)).toBe(30000);
  });

  it('负数下标取首项（健壮性）', () => {
    expect(backoffDelayMs(-1)).toBe(2000);
  });
});

describe('交付 12：convergeToolError 工具失败收敛', () => {
  it('收敛为结构化消息（不 throw）', () => {
    const result = convergeToolError('write_file', new Error('EACCES: permission denied'));
    expect(result.status).toBe('tool_error');
    expect(result.tool).toBe('write_file');
    expect(result.error).toContain('EACCES');
    expect(result.suggestion.length).toBeGreaterThan(0);
  });

  it('非 Error 输入也能收敛', () => {
    const result = convergeToolError('exec_command', 'exit code 127');
    expect(result.status).toBe('tool_error');
    expect(result.error).toBe('exit code 127');
  });

  it('null/undefined 错误 → 未知错误占位', () => {
    const result = convergeToolError('read_file', null);
    expect(result.status).toBe('tool_error');
    expect(result.error).toContain('未知错误');
  });

  it('超长错误消息截断保护（≤500 字符）', () => {
    const longMsg = 'x'.repeat(2000);
    const result = convergeToolError('tool', new Error(longMsg));
    expect(result.error.length).toBeLessThanOrEqual(500);
  });

  it('绝不抛异常（任何输入）', () => {
    expect(() => convergeToolError('t', undefined)).not.toThrow();
    expect(() => convergeToolError('t', { weird: true })).not.toThrow();
  });
});

// ============================================================
// callModelAPI 集成：auth 永不重试 + 退避重连（fetch stub + 可注入 sleepFn）
// ============================================================

describe('交付 12：callModelAPI 重试集成（stop_reason 分类驱动）', () => {
  // 保存/恢复环境与 fetch
  let savedApiKey: string | undefined;
  let savedFetch: typeof fetch;

  const mkResponse = (status: number, body: string) =>
    ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
      json: async () => JSON.parse(body),
    }) as unknown as Response;

  // 环境隔离：指向临时 key + 关闭 Trace 打点，避免污染真实数据
  const baseOptions = { traceEnabled: false } as const;

  // 每个用例独立保存/设置 API key 与 fetch（vitest 共享进程，用例间必须隔离）
  beforeEach(() => {
    savedApiKey = process.env.SOFAGENT_MODEL_API_KEY;
    savedFetch = globalThis.fetch;
    process.env.SOFAGENT_MODEL_API_KEY = 'test-key';
  });

  afterEach(() => {
    if (savedApiKey === undefined) delete process.env.SOFAGENT_MODEL_API_KEY;
    else process.env.SOFAGENT_MODEL_API_KEY = savedApiKey;
    globalThis.fetch = savedFetch;
  });

  it('HTTP 401/403 → auth：一次调用即抛 ModelCallError（绝不重试）', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return mkResponse(401, '{"error":"invalid key"}');
    }) as typeof fetch;

    const sleeps: number[] = [];
    await expect(
      callModelAPI([{ role: 'user', content: 'hi' }], {
        ...baseOptions,
        sleepFn: async (ms) => { sleeps.push(ms); },
      })
    ).rejects.toMatchObject({ stopReason: 'auth' });

    // 铁律：auth 一次调用即放弃，不退避重试
    expect(calls).toBe(1);
    expect(sleeps.length).toBe(0);
  });

  it('ModelCallError 携带 stopReason + httpStatus', async () => {
    globalThis.fetch = (async () => mkResponse(403, 'forbidden')) as typeof fetch;
    try {
      await callModelAPI([{ role: 'user', content: 'hi' }], { ...baseOptions });
      expect.unreachable('应抛出');
    } catch (err) {
      expect(err).toBeInstanceOf(ModelCallError);
      expect((err as ModelCallError).stopReason).toBe('auth');
      expect((err as ModelCallError).httpStatus).toBe(403);
    }
  });

  it('timeout 错误按退避阶梯重连，最终成功 → 返回内容', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls < 3) throw new Error('fetch failed'); // 前两次 timeout 类
      return mkResponse(200, JSON.stringify({
        id: '1', object: 'chat.completion', created: 1, model: 'm',
        choices: [{ index: 0, message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));
    }) as typeof fetch;

    const sleeps: number[] = [];
    const result = await callModelAPI([{ role: 'user', content: 'hi' }], {
      ...baseOptions,
      sleepFn: async (ms) => { sleeps.push(ms); },
    });

    expect(result).toBe('hello');
    expect(calls).toBe(3); // 2 次失败 + 1 次成功
    expect(sleeps).toEqual([2000, 4000]); // 退避阶梯前两级
  });

  it('超时重试用尽后抛出最后错误（≤maxRetries+1 次调用）', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      throw new Error('fetch failed');
    }) as typeof fetch;

    await expect(
      callModelAPI([{ role: 'user', content: 'hi' }], {
        ...baseOptions,
        maxRetries: 2, // 覆盖默认 5，缩短测试
        sleepFn: async () => {},
      })
    ).rejects.toThrow(/fetch failed/);
    expect(calls).toBe(3); // 1 次 + 2 次重试
  });
});
