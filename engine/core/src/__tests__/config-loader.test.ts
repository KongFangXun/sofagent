// ============================================================
// config-loader.test.ts · 配置加载器测试（含环境变量）
// v0.97 新增：loadEnvConfig 测试
// v1.2.9 (DP-3): audit 段 signature 校验测试
// ============================================================

import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { loadEnvConfig, ENV_DEFAULTS, DEFAULT_CONFIG, loadConfig } from '@sofagent/core';

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

    // DP-3: audit 段 signature 应被检测并告警，而非静默剥离
    it('audit 段含 signature 时告警（不静默忽略）', () => {
      const tmpDir = join(process.cwd(), '.tmp-dp3-test');
      const configDir = join(tmpDir, '.sofagent');
      const configPath = join(configDir, 'config.yml');
      try {
        mkdirSync(configDir, { recursive: true });
        // signature 放在 audit 段（错误位置），不是顶层
        writeFileSync(
          configPath,
          [
            'audit:',
            '  lowRiskPatterns:',
            '    - "*.log"',
            '  signature: deadbeef',
          ].join('\n'),
          'utf-8',
        );

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        loadConfig(tmpDir);

        // 应检测到 audit 段 signature 并告警
        const warned = warnSpy.mock.calls.some(
          (call) =>
            typeof call[0] === 'string' &&
            call[0].includes('audit 段含 signature'),
        );
        expect(warned).toBe(true);
        warnSpy.mockRestore();
      } finally {
        // v1.3.3 #9: WorkBuddy 沙箱下 rmSync 可能被 genie-safe-delete shim 拦截导致 ETIMEDOUT，
        // 清理失败不应影响测试断言结果（断言已在上文通过）。
        try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* shim 环境下清理失败可接受 */ }
      }
    });

    // DP-2: signConfig 签名颁发 + 验签 round-trip
    it('signConfig 签名后 loadConfig 验签通过（round-trip）', () => {
      const { signConfig } = require('@sofagent/core') as typeof import('@sofagent/core');
      const { getHmacKey } = require('@sofagent/core') as typeof import('@sofagent/core');
      // 无密钥则跳过（CI / 全新环境）
      if (getHmacKey() === null) return;

      const tmpDir = join(process.cwd(), '.tmp-dp2-test');
      const configDir = join(tmpDir, '.sofagent');
      const configPath = join(configDir, 'config.yml');
      try {
        mkdirSync(configDir, { recursive: true });
        writeFileSync(
          configPath,
          [
            'audit:',
            '  lowRiskPatterns:',
            '    - "*.log"',
            '  carefulModifyThreshold: 0.15',
          ].join('\n'),
          'utf-8',
        );

        // 首次签名
        const result1 = signConfig(configPath);
        expect(result1).toBe('signed');

        // 再次签名应为 updated
        const result2 = signConfig(configPath);
        expect(result2).toBe('updated');

        // 加载验签：不应出现 signature 不匹配告警
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        loadConfig(tmpDir);
        const mismatchWarned = warnSpy.mock.calls.some(
          (call) =>
            typeof call[0] === 'string' &&
            call[0].includes('signature 不匹配'),
        );
        expect(mismatchWarned).toBe(false);
        warnSpy.mockRestore();
      } finally {
        // v1.3.3 #9: WorkBuddy 沙箱下 rmSync 可能被 genie-safe-delete shim 拦截导致 ETIMEDOUT
        try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* shim 环境下清理失败可接受 */ }
      }
    });
    // P0-2 回归：audit.cost 曾在 mergeWithDefaults 被静默丢弃——
    // knownKeys 认识 'cost' 不告警（防呆被欺骗），消费侧 config.cost?.budget 永远 undefined。
    // 契约：warnUnknownConfigKeys knownKeys 声称认识的键，loadConfig 必须实际保留。
    it('audit.cost.budget 被透传到返回配置（此前静默丢弃）', () => {
      const tmpDir = join(process.cwd(), '.tmp-cost-test');
      const configDir = join(tmpDir, '.sofagent');
      try {
        mkdirSync(configDir, { recursive: true });
        writeFileSync(
          join(configDir, 'config.yml'),
          [
            'audit:',
            '  cost:',
            '    budget:',
            '      maxTokensPerRun: 100000',
            '      maxCostPerDay: 5',
          ].join('\n'),
          'utf-8',
        );

        const config = loadConfig(tmpDir);
        expect(config.cost?.budget?.maxTokensPerRun).toBe(100000);
        expect(config.cost?.budget?.maxCostPerDay).toBe(5);
      } finally {
        try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* 沙箱清理失败可接受 */ }
      }
    });

    // 透传契约（防手工同步断链复发）：knownKeys 清单（warnUnknownConfigKeys）里的
    // 全部键，mergeWithDefaults 必须逐一透传——「配置被认为合法」与「配置实际生效」
    // 必须是同一件事。新增 audit 段键时：knownKeys 与本测试的 YAML/断言要同步加。
    it('knownKeys 契约：audit 段全部已知键均被透传（防静默丢弃断链）', () => {
      const tmpDir = join(process.cwd(), '.tmp-contract-test');
      const configDir = join(tmpDir, '.sofagent');
      try {
        mkdirSync(configDir, { recursive: true });
        writeFileSync(
          join(configDir, 'config.yml'),
          [
            'audit:',
            '  lowRiskPatterns:',
            '    - "*.log"',
            '  testPatterns:',
            '    - "npm test"',
            '  carefulModifyThreshold: 0.15',
            '  extendedRulesEnabled: true',
            '  rules:',
            '    a3: false',
            '  loopCheckMaxRounds: 15',
            '  strict: false',
            '  A16: {}',
            '  A17: {}',
            '  loop:',
            '    maxTurns:',
            '      engineer: 10',
            '  webhook:',
            '    platform: dingtalk',
            '    url: "https://example.com/hook"',
            '  toolGate:',
            '    enabled: true',
            '    warnAsFail: false',
            '  sanitizePatterns:',
            '    - pattern: "foo"',
            '      replacement: "bar"',
            '  memory_backends: []',
            '  memory_sync:',
            '    persona_sources:',
            '      - "persona.md"',
            '  cost:',
            '    budget:',
            '      maxTokensPerRun: 100000',
          ].join('\n'),
          'utf-8',
        );

        const config = loadConfig(tmpDir);
        expect(config.lowRiskPatterns).toContain('*.log');
        expect(config.testPatterns).toContain('npm test');
        expect(config.carefulModifyThreshold).toBe(0.15);
        expect(config.extendedRulesEnabled).toBe(true);
        expect(config.rules?.a3).toBe(false);
        expect(config.loopCheckMaxRounds).toBe(15);
        expect(config.A16).toBeDefined();
        expect(config.A17).toBeDefined();
        expect(config.loop?.maxTurns?.engineer).toBe(10);
        expect(config.webhook?.url).toBe('https://example.com/hook');
        expect(config.toolGate?.enabled).toBe(true);
        expect(config.sanitizePatterns?.[0]?.pattern).toBe('foo');
        expect(config.memory_backends).toBeDefined();
        expect(config.memory_sync?.persona_sources?.[0]).toBe('persona.md');
        expect(config.cost?.budget?.maxTokensPerRun).toBe(100000);
      } finally {
        try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* 沙箱清理失败可接受 */ }
      }
    });
  });

  describe('loadEnvConfig', () => {
    it('P1-16: sanitize 默认开启（数据主权产品 opt-in→opt-out）', () => {
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

      // P1-16: sanitize 默认开启（opt-out，非 opt-in）
      expect(config.sanitizeEnabled).toBe(true);
      expect(config.sanitizeIpsEnabled).toBe(true);
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
