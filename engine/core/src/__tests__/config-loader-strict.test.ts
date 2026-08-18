// ============================================================
// config-loader-strict.test.ts · 未知配置键告警 + 拼写建议单测
// v1.3.4 交付 1-G（P1）：extendedRules 静默失效修复
//
// 覆盖场景：
//   1. extendedRules（缺 Enabled 后缀）→ 告警 + 拼写建议 extendedRulesEnabled
//   2. extended_rules_enabled（蛇形）→ 告警 + 拼写建议
//   3. 正确键 extendedRulesEnabled → 无告警
//   4. loadConfig 端到端：写错键的 config.yml → 启动时输出告警
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { warnUnknownConfigKeys, loadConfig } from '@sofagent/core';

describe('config-loader strict 模式（交付 1-G · 未知键告警）', () => {
  describe('warnUnknownConfigKeys', () => {
    it('extendedRules（缺 Enabled 后缀）→ 告警 + 建议 extendedRulesEnabled', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      warnUnknownConfigKeys(
        { extendedRules: true, lowRiskPatterns: ['*.log'] },
        '/test/config.yml',
      );

      const calls = warnSpy.mock.calls.map((c) => String(c[0]));
      const extendedWarn = calls.find((c) => c.includes('extendedRules'));

      expect(extendedWarn).toBeDefined();
      expect(extendedWarn).toContain('extendedRulesEnabled');
      expect(extendedWarn).toContain('未识别');

      warnSpy.mockRestore();
    });

    it('extended_rules_enabled（蛇形拼写）→ 告警 + 建议 extendedRulesEnabled', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      warnUnknownConfigKeys(
        { extended_rules_enabled: true },
        '/test/config.yml',
      );

      const calls = warnSpy.mock.calls.map((c) => String(c[0]));
      const snakeWarn = calls.find((c) => c.includes('extended_rules_enabled'));

      expect(snakeWarn).toBeDefined();
      expect(snakeWarn).toContain('extendedRulesEnabled');

      warnSpy.mockRestore();
    });

    it('正确的 extendedRulesEnabled → 不产生 unknown key 告警', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      warnUnknownConfigKeys(
        { extendedRulesEnabled: true, carefulModifyThreshold: 0.2 },
        '/test/config.yml',
      );

      const calls = warnSpy.mock.calls.map((c) => String(c[0]));
      const unknownWarn = calls.find((c) => c.includes('未识别'));

      // 不应有任何「未识别」告警
      expect(unknownWarn).toBeUndefined();

      warnSpy.mockRestore();
    });

    it('多个未知键 → 每个都告警', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      warnUnknownConfigKeys(
        { extendedRules: true, extendedRulesEnable: false, randomKey: 42 },
        '/test/config.yml',
      );

      const calls = warnSpy.mock.calls.map((c) => String(c[0]));
      const unknownCount = calls.filter((c) => c.includes('未识别')).length;

      expect(unknownCount).toBeGreaterThanOrEqual(2);

      warnSpy.mockRestore();
    });

    it('完全无关的未知键（无相近拼写）→ 输出通用忽略告警', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      warnUnknownConfigKeys(
        { totallyRandomKeyThatDoesntMatchAnything: true },
        '/test/config.yml',
      );

      const calls = warnSpy.mock.calls.map((c) => String(c[0]));
      const genericWarn = calls.find((c) => c.includes('未识别') && c.includes('已忽略'));

      expect(genericWarn).toBeDefined();

      warnSpy.mockRestore();
    });
  });

  describe('loadConfig 端到端——写错配置键时告警', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = join(process.cwd(), '.tmp-strict-test-' + Date.now());
    });

    afterEach(() => {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* shim 环境清理失败可接受 */ }
    });

    it('config.yml 写 extendedRules（错误）→ loadConfig 输出告警 + 拼写建议', () => {
      const configDir = join(tmpDir, '.sofagent');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, 'config.yml'),
        [
          'audit:',
          '  extendedRules: true',
          '  carefulModifyThreshold: 0.2',
        ].join('\n'),
        'utf-8',
      );

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      loadConfig(tmpDir);

      const calls = warnSpy.mock.calls.map((c) => String(c[0]));
      const suggestionWarn = calls.find(
        (c) => c.includes('extendedRules') && c.includes('extendedRulesEnabled'),
      );

      expect(suggestionWarn).toBeDefined();
      warnSpy.mockRestore();
    });

    it('config.yml 写 extendedRulesEnabled（正确）→ loadConfig 不告警该键', () => {
      const configDir = join(tmpDir, '.sofagent');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, 'config.yml'),
        [
          'audit:',
          '  extendedRulesEnabled: true',
          '  carefulModifyThreshold: 0.2',
        ].join('\n'),
        'utf-8',
      );

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const config = loadConfig(tmpDir);

      // 扩展规则应正确启用
      expect(config.extendedRulesEnabled).toBe(true);

      const calls = warnSpy.mock.calls.map((c) => String(c[0]));
      const unknownWarn = calls.find(
        (c) => c.includes('extendedRulesEnabled') && c.includes('未识别'),
      );
      expect(unknownWarn).toBeUndefined();

      warnSpy.mockRestore();
    });
  });

  // ============================================================
  // 验签失败消息矛盾修复——「拒绝启动」后紧跟「已回退默认配置」
  // 的矛盾对消除：验签失败属 fail-closed，无条件抛
  // ConfigSignatureError（strict 与否不影响）；降级回退场景
  // 只说回退。verifyConfigSignature 抛的普通 Error 此前被
  // tryLoadYaml 误包装成 ConfigParseError，非 strict 时走
  // 「回退默认」路径——fail-closed 意图被静默瓦解。
  // ============================================================
  describe('签名校验失败——fail-closed 消息口径统一', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = join(process.cwd(), '.tmp-sig-fail-test-' + Date.now());
    });

    afterEach(() => {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* shim 环境清理失败可接受 */ }
    });

    it('签名不匹配（非 strict）→ 抛 ConfigSignatureError 而非回退默认', () => {
      const { ConfigSignatureError, getHmacKey } = require('@sofagent/core');
      if (getHmacKey() === null) return; // 无密钥环境跳过（CI / 全新安装）

      const configDir = join(tmpDir, '.sofagent');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, 'config.yml'),
        [
          'audit:',
          '  carefulModifyThreshold: 0.2',
          'signature: deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        ].join('\n'),
        'utf-8',
      );

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      let threw: unknown = null;
      try {
        loadConfig(tmpDir); // 非 strict（第二参 undefined）
      } catch (err) {
        threw = err;
      }

      // fail-closed：抛 ConfigSignatureError（含拒绝启动指引），绝不降级回退
      expect(threw).toBeInstanceOf(ConfigSignatureError);
      expect((threw as Error).message).toContain('拒绝启动');
      // 矛盾对消除：不出现「已回退默认配置」
      const warnCalls = warnSpy.mock.calls.map((c) => String(c[0]));
      expect(warnCalls.some((c) => c.includes('回退默认'))).toBe(false);
      warnSpy.mockRestore();
      errSpy.mockRestore();
    });

    it('有签名但无密钥（非 strict）→ 同样抛 ConfigSignatureError 不降级', () => {
      const configDir = join(tmpDir, '.sofagent');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, 'config.yml'),
        [
          'audit:',
          '  carefulModifyThreshold: 0.2',
          'signature: deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        ].join('\n'),
        'utf-8',
      );

      // 隔离密钥路径指向不存在的文件 → getHmacKey() 返回 null
      const savedKeyPath = process.env.SOFAGENT_KEY_PATH;
      process.env.SOFAGENT_KEY_PATH = join(tmpDir, 'nonexistent-key');
      try {
        let threw: unknown = null;
        try {
          loadConfig(tmpDir);
        } catch (err) {
          threw = err;
        }
        const { ConfigSignatureError } = require('@sofagent/core');
        expect(threw).toBeInstanceOf(ConfigSignatureError);
        expect((threw as Error).message).toContain('缺少 HMAC 密钥');
      } finally {
        if (savedKeyPath === undefined) delete process.env.SOFAGENT_KEY_PATH;
        else process.env.SOFAGENT_KEY_PATH = savedKeyPath;
      }
    });

    it('YAML 语法错误（非 strict）→ 仍走「回退默认配置」降级路径（原语义保留）', () => {
      const configDir = join(tmpDir, '.sofagent');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, 'config.yml'),
        'audit: [unclosed bracket\n  bad yaml here',
        'utf-8',
      );

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const config = loadConfig(tmpDir);
      // 降级到安全默认值
      expect(config).toBeDefined();
      const warnCalls = warnSpy.mock.calls.map((c) => String(c[0]));
      expect(warnCalls.some((c) => c.includes('回退默认配置'))).toBe(true);
      warnSpy.mockRestore();
    });
  });
});
