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
});
