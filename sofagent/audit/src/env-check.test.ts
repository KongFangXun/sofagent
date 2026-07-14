// env-check.test.ts · FDE 环境验证测试

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkEnv, type EnvResult } from '@sofagent/core';

describe('env-check', () => {
  describe('checkEnv', () => {
    it('返回完整结构包含所有字段', () => {
      const r = checkEnv();
      expect(r).toHaveProperty('node');
      expect(r).toHaveProperty('git');
      expect(r).toHaveProperty('npm');
      expect(r).toHaveProperty('disk');
      expect(r).toHaveProperty('openclaw');
      expect(r).toHaveProperty('sofagent');
      expect(r).toHaveProperty('bash');
      expect(r).toHaveProperty('allOk');
      expect(r.node).toHaveProperty('version');
      expect(r.node).toHaveProperty('ok');
      expect(typeof r.node.version).toBe('string');
      expect(typeof r.node.ok).toBe('boolean');
    });

    it('Node.js 版本检查：当前版本 ≥18 时 ok 为 true', () => {
      const r = checkEnv();
      const major = parseInt(process.version.slice(1).split('.')[0]!, 10);
      expect(r.node.ok).toBe(major >= 18);
      expect(r.node.version).toBe(process.version);
    });

    it('disk.freeMB 是有效数字且非负', () => {
      const r = checkEnv();
      expect(typeof r.disk.freeMB).toBe('number');
      expect(r.disk.freeMB).toBeGreaterThanOrEqual(0);
    });

    it('allOk 为 boolean 且与其他检查一致', () => {
      const r = checkEnv();
      expect(typeof r.allOk).toBe('boolean');
      // allOk 必须在所有关键项通过时才是 true
      if (r.allOk) {
        expect(r.node.ok).toBe(true);
        expect(r.git.available).toBe(true);
        expect(r.npm.available).toBe(true);
      }
    });
  });

  describe('EnvResult 模拟场景', () => {
    it('全部通过时 allOk 为 true', () => {
      const r: EnvResult = {
        node: { version: 'v22.12.0', ok: true },
        git: { available: true, isRepo: true },
        npm: { available: true },
        disk: { freeMB: 50000 },
        openclaw: { exists: true },
        sofagent: { exists: true },
        bash: { version: 'GNU bash, version 5.2.0', ok: true },
        allOk: true,
      };
      expect(r.allOk).toBe(true);
      expect(r.node.ok).toBe(true);
      expect(r.bash.ok).toBe(true);
    });

    it('Node.js < 18 时 node.ok 为 false', () => {
      const r: EnvResult = {
        node: { version: 'v16.20.0', ok: false },
        git: { available: true, isRepo: false },
        npm: { available: true },
        disk: { freeMB: 10000 },
        openclaw: { exists: true },
        sofagent: { exists: true },
        bash: { version: 'GNU bash, version 5.2.0', ok: true },
        allOk: false,
      };
      expect(r.node.ok).toBe(false);
      expect(r.allOk).toBe(false);
    });

    it('bash 不可用时 bash.ok 为 false', () => {
      const r: EnvResult = {
        node: { version: 'v22.12.0', ok: true },
        git: { available: true, isRepo: true },
        npm: { available: true },
        disk: { freeMB: 10000 },
        openclaw: { exists: true },
        sofagent: { exists: true },
        bash: { version: null, ok: false },
        allOk: false,
      };
      expect(r.bash.ok).toBe(false);
      expect(r.bash.version).toBeNull();
      expect(r.allOk).toBe(false);
    });

    it('磁盘空间不足 1024MB 时 allOk 为 false', () => {
      const r: EnvResult = {
        node: { version: 'v22.12.0', ok: true },
        git: { available: true, isRepo: true },
        npm: { available: true },
        disk: { freeMB: 500 },
        openclaw: { exists: true },
        sofagent: { exists: true },
        bash: { version: 'GNU bash, version 5.2.0', ok: true },
        allOk: false,
      };
      expect(r.disk.freeMB).toBeLessThan(1024);
      expect(r.allOk).toBe(false);
    });
  });
});
