// ============================================================
// check-portability.test.ts · 跨平台兼容性测试
// v0.97 新增
// ============================================================

import { describe, it, expect } from 'vitest';
import { checkPortability, testHashFallback, printReport, PortabilityReport } from './check-portability';

describe('check-portability', () => {
  describe('checkPortability', () => {
    it('返回有效的报告对象', () => {
      const report = checkPortability();

      expect(report).toHaveProperty('os');
      expect(report).toHaveProperty('arch');
      expect(report).toHaveProperty('release');
      expect(report).toHaveProperty('bashVersion');
      expect(report).toHaveProperty('gitVersion');
      expect(report).toHaveProperty('nodeVersion');
      expect(report).toHaveProperty('hasShasum');
      expect(report).toHaveProperty('hasSha256sum');
      expect(report).toHaveProperty('statType');
      expect(report).toHaveProperty('issues');
    });

    it('OS 名称包含类型信息', () => {
      const report = checkPortability();
      expect(report.os.length).toBeGreaterThan(0);

      const osType = require('os').type();
      if (osType === 'Darwin') {
        expect(report.os).toContain('Darwin');
      } else if (osType === 'Linux') {
        expect(report.os).toContain('Linux');
      } else if (osType === 'Windows_NT') {
        expect(report.os).toContain('Windows_NT');
      }
    });

    it('macOS 上 statType 为 bsd', () => {
      const osType = require('os').type();
      const report = checkPortability();

      if (osType === 'Darwin') {
        expect(report.statType).toBe('bsd');
      }
    });

    it('Node.js 版本存在', () => {
      const report = checkPortability();
      expect(report.nodeVersion).toBeTruthy();
      expect(report.nodeVersion).toMatch(/v?\d+\.\d+\.\d+/);
    });
  });

  describe('testHashFallback', () => {
    it('生成有效的 8 位 hex slug', () => {
      const result = testHashFallback('sofagent-task');

      if (result.ok) {
        expect(result.slug).toMatch(/^[0-9a-f]{8}$/);
      }
      // If shasum/sha256sum not available, ok will be false — still valid behavior
    });

    it('不同输入产生不同 slug', () => {
      const r1 = testHashFallback('task-1');
      const r2 = testHashFallback('task-2');

      if (r1.ok && r2.ok) {
        expect(r1.slug).not.toBe(r2.slug);
      }
    });

    it('相同输入产生相同 slug', () => {
      const r1 = testHashFallback('same-input');
      const r2 = testHashFallback('same-input');

      if (r1.ok && r2.ok) {
        expect(r1.slug).toBe(r2.slug);
      }
    });
  });

  describe('printReport', () => {
    it('生成非空的格式化报告', () => {
      const report = checkPortability();
      const output = printReport(report);

      expect(output.length).toBeGreaterThan(0);
      expect(output).toContain('== 环境 ==');
      expect(output).toContain('uname');
      expect(output).toContain('== 关键依赖 ==');
    });

    it('无问题时显示通过', () => {
      const cleanReport: PortabilityReport = {
        os: 'Darwin 25.5.0 (arm64)',
        arch: 'arm64',
        release: '25.5.0',
        bashVersion: 'GNU bash, version 3.2.57',
        gitVersion: 'git version 2.39.5',
        nodeVersion: 'v22.0.0',
        hasShasum: true,
        hasSha256sum: true,
        statType: 'bsd',
        issues: [],
      };

      const output = printReport(cleanReport);
      expect(output).toContain('全部通过');
    });

    it('有问题时列出问题', () => {
      const reportWithIssues: PortabilityReport = {
        os: 'Linux (arm64)',
        arch: 'arm64',
        release: '6.1.0',
        bashVersion: null,
        gitVersion: null,
        nodeVersion: null,
        hasShasum: false,
        hasSha256sum: false,
        statType: 'unknown',
        issues: ['bash 不可用', 'git 不可用', 'Node.js 不可用'],
      };

      const output = printReport(reportWithIssues);
      expect(output).toContain('bash 不可用');
      expect(output).toContain('个问题');
    });
  });
});
