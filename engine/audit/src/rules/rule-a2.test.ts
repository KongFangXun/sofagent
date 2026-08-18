// ============================================================
// rule-a2.test.ts · A2 不泄密钥——密钥泄漏检测测试
// ============================================================

import { describe, it, expect } from 'vitest';
import { checkRuleA2 } from './rule-a2-secret-leak';
import type { AuditContext } from './types';
import type { DiffFile } from '@sofagent/core';
import { makeDiffFile, makeCtx } from '../test-utils';

describe('A2 不泄密钥', () => {
  it('新增行含 AWS Access Key → FAIL', () => {
    const ctx = makeCtx([makeDiffFile('src/config.ts', ['+const key = "AKIAIOSFODNN7EXAMPLE"'])]);
    const result = checkRuleA2(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('新增行含 Private Key → FAIL', () => {
    const ctx = makeCtx([makeDiffFile('src/key.ts', ['+-----BEGIN RSA PRIVATE KEY-----'])]);
    const result = checkRuleA2(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('新增行含 OpenAI API Key → FAIL', () => {
    const longKey = 'sk-' + 'a'.repeat(48);
    const ctx = makeCtx([makeDiffFile('src/ai.ts', [`+const apiKey = "${longKey}"`])]);
    const result = checkRuleA2(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('新增行含 GitHub Token → FAIL', () => {
    const ctx = makeCtx([makeDiffFile('src/ci.ts', ['+const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789AB"'])]);
    const result = checkRuleA2(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('新增行含 OpenAI Project Key (sk-proj-) → FAIL', () => {
    const projKey = 'sk-proj-' + 'a'.repeat(48);
    const ctx = makeCtx([makeDiffFile('src/ai.ts', [`+const apiKey = "${projKey}"`])]);
    const result = checkRuleA2(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('新增行含 Anthropic API Key (sk-ant-api03-) → FAIL', () => {
    const antKey = 'sk-ant-api03-' + 'a'.repeat(43);
    const ctx = makeCtx([makeDiffFile('src/ai.ts', [`+const apiKey = "${antKey}"`])]);
    const result = checkRuleA2(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('新增行含 DeepSeek API Key (sk- 32位) → FAIL', () => {
    const dsKey = 'sk-' + 'a'.repeat(32);
    const ctx = makeCtx([makeDiffFile('src/ai.ts', [`+const apiKey = "${dsKey}"`])]);
    const result = checkRuleA2(ctx);
    expect(result.status).toBe('FAIL');
  });

  // v1.3.6 B24: Stripe 下划线前缀——fixture 运行时拼接（铁律：测试不字面写真实格式密钥）
  it('新增行含 Stripe sk_live_ 下划线 key → FAIL', () => {
    const stripeKey = 'sk_live_' + 'a'.repeat(24);
    const ctx = makeCtx([makeDiffFile('src/pay.ts', [`+const stripeKey = "${stripeKey}"`])]);
    const result = checkRuleA2(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('新增行含 Stripe sk_test_ 下划线 key → FAIL', () => {
    const stripeKey = 'sk_test_' + 'a'.repeat(24);
    const ctx = makeCtx([makeDiffFile('src/pay.ts', [`+const stripeKey = "${stripeKey}"`])]);
    const result = checkRuleA2(ctx);
    expect(result.status).toBe('FAIL');
  });

  it('无密钥 → PASS', () => {
    const ctx = makeCtx([makeDiffFile('src/index.ts', ['+const x = 1;'])]);
    const result = checkRuleA2(ctx);
    expect(result.status).toBe('PASS');
  });

  it('evidenceMode 标注为 git-diff', () => {
    const ctx = makeCtx([makeDiffFile('src/index.ts', ['+const x = 1;'])]);
    const result = checkRuleA2(ctx);
    expect(result.evidenceMode).toBe('git-diff');
  });

  // 二进制文件盲区 WARN（红队实测：二进制 blob 无内容行可扫，密钥可藏身）
  describe('新增二进制文件 WARN', () => {
    it('新增 .bin 文件 → WARN（二进制不扫内容）', () => {
      const ctx = makeCtx([makeDiffFile('assets/blob.bin', ['diff --git a/assets/blob.bin b/assets/blob.bin', 'Binary files /dev/null and b/assets/blob.bin differ'], 'added')]);
      const result = checkRuleA2(ctx);
      expect(result.status).toBe('WARN');
      expect(result.details.join(' ')).toContain('二进制文件不扫内容');
    });

    it('新增 .exe/.dll/.so/.dylib 文件 → WARN', () => {
      for (const p of ['dist/tool.exe', 'lib/native.dll', 'lib/plugin.so', 'lib/mac.dylib']) {
        const ctx = makeCtx([makeDiffFile(p, [], 'added')]);
        const result = checkRuleA2(ctx);
        expect(result.status, p).toBe('WARN');
      }
    });

    it('无二进制扩展名但 diff 标记 Binary files differ（内容含 NUL 字节）→ WARN', () => {
      // git 对含 NUL 字节的文件（如伪装 .txt 的 blob）自动按二进制处理
      const ctx = makeCtx([makeDiffFile('data/payload.txt', ['diff --git a/data/payload.txt b/data/payload.txt', 'index 0000000..abc1234', 'Binary files /dev/null and b/data/payload.txt differ'], 'added')]);
      const result = checkRuleA2(ctx);
      expect(result.status).toBe('WARN');
      expect(result.details.join(' ')).toContain('人工确认');
    });

    it('修改既有二进制文件（非新增）→ 不告警（只审新增盲区）', () => {
      const ctx = makeCtx([makeDiffFile('assets/blob.bin', ['Binary files a/assets/blob.bin and b/assets/blob.bin differ'], 'modified')]);
      const result = checkRuleA2(ctx);
      expect(result.status).toBe('PASS');
    });

    it('新增二进制文件不拦截——可与密钥 FAIL 共存且 FAIL 优先', () => {
      const key = 'sk-' + 'a'.repeat(40);
      const ctx = makeCtx([
        makeDiffFile('assets/lib.so', [], 'added'),
        makeDiffFile('src/cfg.ts', [`+const k = "${key}"`]),
      ]);
      const result = checkRuleA2(ctx);
      expect(result.status).toBe('FAIL');
      expect(result.details.join(' ')).toContain('二进制文件不扫内容');
    });
  });
});
