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

  it('data URI 内嵌 base64 图像 → PASS（合法资源不误报）', () => {
    // 实锤场景：dashboard logo 70KB base64 载荷——原文撞裸 40 位模式 + 载荷内
    // 随机子串（aws/key）凑出 contextKeyword
    const pngB64 = Buffer.from('\x89PNG\r\n\x1a\n' + 'x'.repeat(400) + 'aws' + 'y'.repeat(100)).toString('base64');
    expect(
      toolSecretLeak.check(makeCtx({ content: `<img src="data:image/png;base64,${pngB64}" alt="logo">` })).status,
    ).toBe('PASS');
  });

  it('data URI 同行混真密钥 → FAIL（豁免不遮真泄漏）', () => {
    const pngB64 = Buffer.from('\x89PNG\r\n\x1a\n' + 'x'.repeat(100)).toString('base64');
    expect(
      toolSecretLeak.check(makeCtx({ content: `<img src="data:image/png;base64,${pngB64}"> k="${AWS_KEY}"` })).status,
    ).toBe('FAIL');
  });

  it('多行文本：key 在 A 行、40 位段在 B 行 → PASS（contextKeyword 行级语义）', () => {
    // 实锤场景：CSS @keyframes 的 "key"（行 1）给 200 行外 GitHub URL 40 位路径段凑词
    const css = '@keyframes sk-shimmer{0%{background-position:-400px 0}}';
    const urlLine = 'link: https://github.com/SomeUser/project-name/blob/main/FDE/GUIDE.md here';
    // 构造：40 位纯 base64 段放另一行，与 key 不同行
    const fortySeg = 'aB3dE5fG7hJ9kL1mN3oP5qR7sT9uV1wX3yZ5a7B9'; // 40 位无关键词同行
    const multi = css + '\n' + urlLine + '\nplain=' + fortySeg;
    expect(toolSecretLeak.check(makeCtx({ content: multi })).status).toBe('PASS');
  });

  it('多行文本：key 与 40 位段同行 → FAIL（行内上下文仍生效）', () => {
    const fortySeg = 'aB3dE5fG7hJ9kL1mN3oP5qR7sT9uV1wX3yZ5a7B9';
    const multi = 'line1\nkey=' + fortySeg;
    expect(toolSecretLeak.check(makeCtx({ content: multi })).status).toBe('FAIL');
  });
});
