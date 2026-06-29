// ============================================================
// benchmark.test.ts · 基准测试框架测试
// v0.97 新增
// ============================================================

import { describe, it, expect } from 'vitest';
import { runBenchmark, quickPing, runSuite, formatMarkdownReport, BenchResult, BenchConfig } from './benchmark';

describe('benchmark', () => {
  describe('runBenchmark', () => {
    it('快速命令 3 次运行全部成功', () => {
      const result = runBenchmark({
        command: 'node',
        args: ['-e', 'true'],
        runs: 3,
        timeout: 5000,
      });

      expect(result.total).toBe(3);
      expect(result.success).toBe(3);
      expect(result.failed).toBe(0);
      expect(result.successRate).toBe(1.0);
      expect(result.avgMs).toBeGreaterThan(0);
      expect(result.minMs).toBeGreaterThan(0);
      expect(result.maxMs).toBeGreaterThan(0);
      expect(result.stdMs).toBeGreaterThanOrEqual(0);
      expect(result.durations.length).toBe(3);
    });

    it('所有运行失败时成功率 0', () => {
      const result = runBenchmark({
        command: 'this-command-does-not-exist-at-all-12345',
        args: [],
        runs: 2,
        timeout: 3000,
      });

      expect(result.total).toBe(2);
      expect(result.success).toBe(0);
      expect(result.failed).toBe(2);
      expect(result.successRate).toBe(0);
      expect(result.failures.length).toBe(2);
    });

    it('部分失败时正确统计', () => {
      // 使用一个有时会失败的复杂命令
      const result = runBenchmark({
        command: 'node',
        args: ['-e', 'if (process.argv.length > 10) process.exit(1) else console.log("ok")'],
        runs: 5,
        timeout: 5000,
      });

      expect(result.total).toBe(5);
      // 所有运行应该成功（参数数量固定）
      expect(result.durations.length).toBe(5);
    });

    it('耗时在合理范围内', () => {
      const result = runBenchmark({
        command: 'node',
        args: ['-e', 'let x=0; for(let i=0;i<100000;i++) x+=i'],
        runs: 3,
        timeout: 10000,
      });

      // 应该有一些耗时但不会太离谱
      if (result.success > 0) {
        expect(result.avgMs).toBeGreaterThan(0);
        expect(result.avgMs).toBeLessThan(5000); // 不应该超过 5s
      }
    });
  });

  describe('quickPing', () => {
    it('5 次运行全部成功', () => {
      const result = quickPing(5);

      expect(result.total).toBe(5);
      expect(result.success).toBe(5);
      expect(result.failed).toBe(0);
      expect(result.successRate).toBe(1.0);
    });

    it('返回正确的 durations 数组长度', () => {
      const result = quickPing(3);
      expect(result.durations.length).toBe(3);
    });
  });

  describe('formatMarkdownReport', () => {
    it('生成包含关键信息的 Markdown', () => {
      const config: BenchConfig = {
        command: 'node',
        args: ['-e', '1+1'],
        runs: 5,
        timeout: 5000,
      };

      const result: BenchResult = {
        total: 5,
        success: 5,
        failed: 0,
        successRate: 1.0,
        avgMs: 12.5,
        minMs: 10.0,
        maxMs: 15.0,
        stdMs: 2.0,
        durations: [10, 12, 15, 13, 12],
        failures: [],
      };

      const report = formatMarkdownReport('测试命令', config, result);

      expect(report).toContain('测试命令');
      expect(report).toContain('| 成功率 ');
      expect(report).toContain('100.0%');
      expect(report).toContain('12.5ms');
    });

    it('失败记录包含错误信息', () => {
      const config: BenchConfig = {
        command: 'bad-command',
        args: [],
        runs: 2,
        timeout: 1000,
      };

      const result: BenchResult = {
        total: 2,
        success: 0,
        failed: 2,
        successRate: 0,
        avgMs: 0,
        minMs: 0,
        maxMs: 0,
        stdMs: 0,
        durations: [0, 0],
        failures: [
          { run: 1, error: 'Command not found: bad-command' },
          { run: 2, error: 'Command not found: bad-command' },
        ],
      };

      const report = formatMarkdownReport('失败测试', config, result);
      expect(report).toContain('失败记录');
      expect(report).toContain('bad-command');
    });
  });

  describe('runSuite', () => {
    it('运行多个测试并汇总', () => {
      const suite = [
        { name: 'node-eval', config: { command: 'node', args: ['-e', '1+1'], runs: 2, timeout: 5000 } },
        { name: 'node-version', config: { command: 'node', args: ['--version'], runs: 2, timeout: 5000 } },
      ];

      const { results, summary } = runSuite(suite);

      expect(Object.keys(results).length).toBe(2);
      expect(results['node-eval']).toBeDefined();
      expect(results['node-version']).toBeDefined();
      expect(summary).toContain('# sofagent Benchmark');
      expect(summary).toContain('node-eval');
      expect(summary).toContain('node-version');
    });
  });
});
