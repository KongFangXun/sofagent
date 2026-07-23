// ============================================================
// tool-secret-leak.test.ts · 密钥泄漏检测规则测试
// 注意：fixture 里的 secret-like 串用运行时拼接（铁律 #3）
// ============================================================

import { describe, it, expect } from 'vitest';
import { toolSecretLeak } from '../rules/tool-secret-leak';
import type { ToolCallContext } from '../types';

function makeCtx(args: Record<string, unknown>): ToolCallContext {
  return { toolName: 'write_file', args, agentName: 'engineer', taskDesc: 'test', cwd: '/tmp' };
}

// 运行时拼接——字面串会触发 A2 误报
const AWS_KEY = 'AKIA' + 'IOSFODNN7EXAMPLE';
const PRIVATE_KEY_HEADER = '-----BEGIN ' + 'RSA PRIVATE KEY-----';
const GH_TOKEN = 'ghp_' + 'abcdefghijklmnopqrstuvwxyz0123456789AB';
const OPENAI_KEY = 'sk-' + 'a'.repeat(48);

describe('tool-secret-leak', () => {
  it('普通内容 → PASS', () => {
    expect(toolSecretLeak.check(makeCtx({ content: 'hello world' })).status).toBe('PASS');
  });

  it('AWS Access Key → FAIL', () => {
    expect(
      toolSecretLeak.check(makeCtx({ content: 'const key = "' + AWS_KEY + '"' })).status,
    ).toBe('FAIL');
  });

  it('Private Key 头 → FAIL', () => {
    expect(
      toolSecretLeak.check(makeCtx({ content: PRIVATE_KEY_HEADER })).status,
    ).toBe('FAIL');
  });

  it('GitHub Token → FAIL', () => {
    expect(
      toolSecretLeak.check(makeCtx({ token: GH_TOKEN })).status,
    ).toBe('FAIL');
  });

  it('OpenAI API Key → FAIL', () => {
    expect(
      toolSecretLeak.check(makeCtx({ api_key: OPENAI_KEY })).status,
    ).toBe('FAIL');
  });

  it('嵌套对象中的密钥 → FAIL', () => {
    expect(
      toolSecretLeak.check(makeCtx({ config: { deep: { token: AWS_KEY } } })).status,
    ).toBe('FAIL');
  });

  it('无密钥的正常配置 → PASS', () => {
    expect(
      toolSecretLeak.check(makeCtx({ config: { host: 'localhost', port: 3000 } })).status,
    ).toBe('PASS');
  });
});
