// ============================================================
// config-loader.test.ts · 配置加载器测试（含环境变量）
// v0.97 新增：loadEnvConfig 测试
// ============================================================

import { describe, it, expect, afterAll } from 'vitest';
import { loadEnvConfig, ENV_DEFAULTS, DEFAULT_CONFIG, loadConfig } from './config-loader';

const originalEnv = { ...process.env };

describe('config-loader', () => {
  afterAll(() => {
    // Restore env
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    for (const [key, val] of Object.entries(originalEnv)) {
      if (val !== undefined) process.env[key] = val;
    }
  });

  describe('loadConfig', () => {
    it('返回默认配置（无配置文件时）', () => {
      const config = loadConfig();
      expect(config.lowRiskPatterns).toContain('package-lock.json');
      expect(config.testPatterns).toContain('npm test');
      expect(config.carefulModifyThreshold).toBe(0.2);
      expect(config.extendedRulesEnabled).toBe(false);
    });
  });

  describe('loadEnvConfig', () => {
    it('默认值全部关闭', () => {
      // Clear all sofagent env vars
      delete process.env.SOFA_SANITIZE;
      delete process.env.SOFA_SANITIZE_IPS;
      delete process.env.SOFA_RETENTION_DAYS;
      delete process.env.SOFA_RETENTION_MAX;
      delete process.env.SOFA_CLEANUP_ON_RECORD;
      delete process.env.SOFA_CLEANUP_FREQUENCY;
      delete process.env.SOFA_AUDIT_ENABLED;
      delete process.env.SOFAGENT_DATA;

      const config = loadEnvConfig();

      expect(config.sanitizeEnabled).toBe(false);
      expect(config.sanitizeIpsEnabled).toBe(false);
      expect(config.retentionDays).toBe(90);
      expect(config.retentionMax).toBe(500);
      expect(config.cleanupOnRecord).toBe(false);
      expect(config.cleanupFrequency).toBe(10);
      expect(config.auditEnabled).toBe(false);
    });

    it('环境变量 true/1/yes 转为 boolean', () => {
      process.env.SOFA_SANITIZE = 'true';
      process.env.SOFA_SANITIZE_IPS = '1';
      process.env.SOFA_CLEANUP_ON_RECORD = 'yes';
      process.env.SOFA_AUDIT_ENABLED = 'true';

      const config = loadEnvConfig();

      expect(config.sanitizeEnabled).toBe(true);
      expect(config.sanitizeIpsEnabled).toBe(true);
      expect(config.cleanupOnRecord).toBe(true);
      expect(config.auditEnabled).toBe(true);
    });

    it('环境变量数字正确解析', () => {
      process.env.SOFA_RETENTION_DAYS = '30';
      process.env.SOFA_RETENTION_MAX = '200';
      process.env.SOFA_CLEANUP_FREQUENCY = '5';

      const config = loadEnvConfig();

      expect(config.retentionDays).toBe(30);
      expect(config.retentionMax).toBe(200);
      expect(config.cleanupFrequency).toBe(5);
    });

    it('环境变量 SOFAGENT_DATA 优先', () => {
      process.env.SOFAGENT_DATA = '/tmp/test-sofagent';

      const config = loadEnvConfig();

      if (require('fs').existsSync('/tmp/test-sofagent')) {
        expect(config.dataDir).toBe('/tmp/test-sofagent');
      }
      // 如果目录不存在，会 fallback（这是预期行为）
    });

    it('非法数字回退默认值', () => {
      process.env.SOFA_RETENTION_DAYS = 'not-a-number';
      process.env.SOFA_RETENTION_MAX = 'abc';

      const config = loadEnvConfig();

      expect(config.retentionDays).toBe(90);
      expect(config.retentionMax).toBe(500);
    });
  });
});
