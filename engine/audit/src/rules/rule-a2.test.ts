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

  // v1.3.8 P0-2 回归：FFFD 短路绕过——攻击者把密钥后拼非法 UTF-8 字节再 base64/hex，
  // 解码产生 \uFFFD。旧逻辑「含 FFFD 即整体放弃解码」会让密钥候选逃逸（实测复现：
  // base64(AWS 密钥 + 0xd4 0x90 0x8b) 旧逻辑返回 null）。
  // 修复：解码后剥离 \uFFFD 再跑密钥正则（密钥本体是 ASCII，FFFD 是干扰尾巴）。
  // 场景：encoded.txt 内容即裸 base64（printf '<密钥>' | base64 > encoded.txt）。
  describe('FFFD 短路绕过（非法 UTF-8 尾字节）', () => {
    // 运行时拼接密钥形态（铁律：测试不字面写真实格式密钥，与文件上方用例的拆分手法一致）
    const awsLike = ['AK', 'IAIOSFODNN7EXAMPLE'].join('');

    it('base64 密钥 + 非法 UTF-8 尾字节 → 剥离 FFFD 后仍 FAIL（不再整体放弃）', () => {
      // payload 运行时拼接：密钥 + 非法 UTF-8 序列（0xd4 0x90 0x8b）→ 解码产生 \uFFFD
      const payload = Buffer.concat([
        Buffer.from(awsLike),
        Buffer.from([0xd4, 0x90, 0x8b]),
      ]).toString('base64');
      const ctx = makeCtx([makeDiffFile('encoded.txt', [`+${payload}`])]);
      const result = checkRuleA2(ctx);
      expect(result.status).toBe('FAIL');
    });

    it('hex 密钥 + 非法 UTF-8 尾字节 → 剥离 FFFD 后仍 FAIL', () => {
      const payload = Buffer.concat([
        Buffer.from(awsLike),
        Buffer.from([0xd4, 0x90, 0x8b]),
      ]).toString('hex');
      const ctx = makeCtx([makeDiffFile('encoded.hex', [`+${payload}`])]);
      const result = checkRuleA2(ctx);
      expect(result.status).toBe('FAIL');
    });

    it('合法 base64 密钥（无 FFFD 污染）→ 仍 FAIL（无回归）', () => {
      const payload = Buffer.from(awsLike).toString('base64');
      const ctx = makeCtx([makeDiffFile('plain-b64.txt', [`+${payload}`])]);
      const result = checkRuleA2(ctx);
      expect(result.status).toBe('FAIL');
    });

    it('纯随机二进制 base64（剥离 FFFD 后无密钥特征）→ 不误报 PASS', () => {
      // 全随机字节解码后既无可打印密钥也无中文 → 清洗后仍为空候选 → 不告警
      const payload = Buffer.from([0xd4, 0x90, 0x8b, 0xff, 0xfe, 0x81, 0xa2, 0xb3]).toString('base64');
      const ctx = makeCtx([makeDiffFile('noise.txt', [`+${payload}`])]);
      const result = checkRuleA2(ctx);
      expect(result.status).toBe('PASS');
    });
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

  // v1.3.8 P1-A2 回归：.gitattributes -diff 两步隐身——原仅 WARN 放行：
  // 第一步提交 .gitattributes 标记 secrets.js -diff（WARN 不拦截），
  // 第二步提交密钥文件，git diff 无内容行 → A2 静默全绿。升级为 FAIL。
  describe('.gitattributes -diff 隐身（升级 FAIL）', () => {
    it('第一步：提交 .gitattributes 标记 -diff → FAIL（不再 WARN 放行）', () => {
      const ctx = makeCtx([makeDiffFile('.gitattributes', ['+secrets.js -diff'])]);
      const result = checkRuleA2(ctx);
      expect(result.status).toBe('FAIL');
      expect(result.details.join(' ')).toContain('-diff');
    });

    it('通配符标记 *.env -diff → FAIL', () => {
      const ctx = makeCtx([makeDiffFile('.gitattributes', ['+*.env -diff'])]);
      const result = checkRuleA2(ctx);
      expect(result.status).toBe('FAIL');
    });

    it('带附加属性 key.bin -diff merge=keep → FAIL', () => {
      const ctx = makeCtx([makeDiffFile('.gitattributes', ['+key.bin -diff merge=keep'])]);
      const result = checkRuleA2(ctx);
      expect(result.status).toBe('FAIL');
    });

    it('普通 .gitattributes 行（非 -diff）→ PASS（不误伤）', () => {
      const ctx = makeCtx([makeDiffFile('.gitattributes', ['+*.png binary'])]);
      const result = checkRuleA2(ctx);
      expect(result.status).toBe('PASS');
    });
  });
});
