// ============================================================
// run-envs.test.ts · 环境探测测试
// v0.97 新增
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  detectRuntimeEnv,
  collectEnvVars,
  detectTools,
  collectPaths,
  getSystemInfo,
  probeEnvironment,
} from './run-envs';

describe('run-envs', () => {
  describe('detectRuntimeEnv', () => {
    it('返回有效的环境类型字符串', () => {
      const env = detectRuntimeEnv();
      expect(typeof env).toBe('string');
      expect(env.length).toBeGreaterThan(0);

      // macOS 上应返回 macOS
      if (require('os').platform() === 'darwin') {
        expect(env).toBe('macOS');
      }
    });

    it('WSL 环境下识别 WSL', () => {
      const originalWsl = process.env.WSL_DISTRO_NAME;
      process.env.WSL_DISTRO_NAME = 'Ubuntu';

      const env = detectRuntimeEnv();
      expect(env).toContain('WSL');

      // Restore
      if (originalWsl) process.env.WSL_DISTRO_NAME = originalWsl;
      else delete process.env.WSL_DISTRO_NAME;
    });
  });

  describe('collectEnvVars', () => {
    it('返回包含 PATH 和 HOME 的记录', () => {
      const vars = collectEnvVars();
      expect(vars).toHaveProperty('PATH');
      expect(vars).toHaveProperty('HOME');
    });

    it('API Key 被脱敏', () => {
      process.env.DEEPSEEK_API_KEY = 'sk-12345678901234567890test';

      const vars = collectEnvVars();
      if (vars.DEEPSEEK_API_KEY) {
        expect(vars.DEEPSEEK_API_KEY).toContain('***');
        expect(vars.DEEPSEEK_API_KEY).not.toContain('1234567890');
      }

      delete process.env.DEEPSEEK_API_KEY;
    });

    it('不存在的环境变量不出现在结果中', () => {
      const vars = collectEnvVars();
      expect(vars).not.toHaveProperty('NON_EXISTENT_VAR_12345');
    });
  });

  describe('detectTools', () => {
    it('返回工具可用性记录', () => {
      const tools = detectTools();

      expect(tools).toHaveProperty('bash');
      expect(tools.bash!.available).toBe(true); // bash 几乎总是可用

      expect(tools).toHaveProperty('node');
      expect(tools.node!.available).toBe(true); // node 在测试环境可用
    });
  });

  describe('collectPaths', () => {
    it('返回非空路径数组', () => {
      const paths = collectPaths(process.platform === 'win32' ? ';' : ':');
      expect(paths.length).toBeGreaterThan(0);
      expect(Array.isArray(paths)).toBe(true);
    });

    it('所有路径都非空', () => {
      const paths = collectPaths();
      for (const p of paths) {
        expect(p.length).toBeGreaterThan(0);
      }
    });
  });

  describe('getSystemInfo', () => {
    it('返回完整的系统信息', () => {
      const info = getSystemInfo();

      expect(info).toHaveProperty('hostname');
      expect(info).toHaveProperty('user');
      expect(info).toHaveProperty('home');
      expect(info).toHaveProperty('platform');
      expect(info).toHaveProperty('cpus');
      expect(info.cpus).toBeGreaterThan(0);
    });
  });

  describe('probeEnvironment', () => {
    it('返回完整的环境报告', () => {
      const report = probeEnvironment();

      expect(report).toHaveProperty('env');
      expect(report).toHaveProperty('runtimeEnv');
      expect(report).toHaveProperty('tools');
      expect(report).toHaveProperty('paths');

      expect(Object.keys(report.tools).length).toBeGreaterThan(0);
    });
  });
});
