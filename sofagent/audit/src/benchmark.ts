// ============================================================
// benchmark.ts · 基准测试框架
// v0.97: 从 benchmark.sh 迁移到 TS，零外部依赖
// ============================================================
// 功能：运行指定命令 N 次，统计平均耗时/成功率/标准差
// ============================================================

import { execFileSync, execSync } from 'child_process';
import { performance } from 'perf_hooks';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const VERSION = '0.97';

export interface BenchConfig {
  /** 运行次数 */
  runs: number;
  /** 超时时间（ms），超时后计为失败 */
  timeout: number;
  /** 命令 */
  command: string;
  /** 参数 */
  args?: string[];
  /** 工作目录 */
  cwd?: string;
}

export interface BenchResult {
  /** 总运行次数 */
  total: number;
  /** 成功次数 */
  success: number;
  /** 失败次数 */
  failed: number;
  /** 成功率 */
  successRate: number;
  /** 平均耗时（ms）——仅成功运行 */
  avgMs: number;
  /** 最快耗时（ms） */
  minMs: number;
  /** 最慢耗时（ms） */
  maxMs: number;
  /** 标准差（ms） */
  stdMs: number;
  /** 每次运行的耗时数组（ms）——与 total 一一对应，失败为 0 */
  durations: number[];
  /** 失败运行次数 */
  failures: { run: number; error: string }[];
}

/**
 * 运行基准测试
 */
export function runBenchmark(config: BenchConfig): BenchResult {
  const durations: number[] = [];
  const failures: BenchResult['failures'] = [];

  for (let i = 0; i < config.runs; i++) {
    const start = performance.now();
    try {
      const args = config.args || [];
      execFileSync(config.command, args, {
        timeout: config.timeout,
        cwd: config.cwd,
        stdio: 'pipe',
      });
      const elapsed = performance.now() - start;
      durations.push(elapsed);
    } catch (e: any) {
      durations.push(0); // failed
      failures.push({ run: i + 1, error: String(e.message || e).slice(0, 200) });
    }
  }

  const successDurations = durations.filter(d => d > 0);
  const total = config.runs;
  const success = successDurations.length;
  const failed = failures.length;
  const successRate = success / total;

  if (success === 0) {
    return {
      total, success, failed, successRate,
      avgMs: 0, minMs: 0, maxMs: 0, stdMs: 0,
      durations, failures,
    };
  }

  const totalMs = successDurations.reduce((a, b) => a + b, 0);
  const avgMs = totalMs / success;
  const minMs = Math.min(...successDurations);
  const maxMs = Math.max(...successDurations);

  // 标准差
  const variance = successDurations.reduce((sum, d) => sum + (d - avgMs) ** 2, 0) / success;
  const stdMs = Math.sqrt(variance);

  return {
    total, success, failed, successRate,
    avgMs: Math.round(avgMs * 100) / 100,
    minMs: Math.round(minMs * 100) / 100,
    maxMs: Math.round(maxMs * 100) / 100,
    stdMs: Math.round(stdMs * 100) / 100,
    durations,
    failures,
  };
}

/**
 * 生成 Markdown 格式的基准测试报告
 */
export function formatMarkdownReport(name: string, config: BenchConfig, result: BenchResult): string {
  const lines: string[] = [];

  lines.push(`## ${name}`);
  lines.push('');
  lines.push(`| 指标 | 值 |`);
  lines.push(`|------|------|`);
  lines.push(`| 命令 | \`${config.command} ${(config.args || []).join(' ')}\` |`);
  lines.push(`| 运行次数 | ${result.total} |`);
  lines.push(`| 成功次数 | ${result.success} |`);
  lines.push(`| 失败次数 | ${result.failed} |`);
  lines.push(`| 成功率 | ${(result.successRate * 100).toFixed(1)}% |`);
  lines.push(`| 平均耗时 | ${result.avgMs}ms |`);
  lines.push(`| 最快耗时 | ${result.minMs}ms |`);
  lines.push(`| 最慢耗时 | ${result.maxMs}ms |`);
  lines.push(`| 标准差 | ${result.stdMs}ms |`);

  if (result.failures.length > 0) {
    lines.push('');
    lines.push('### 失败记录');
    lines.push('');
    for (const f of result.failures) {
      lines.push(`- **运行 ${f.run}**: \`${f.error}\``);
    }
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * 运行一组基准测试并汇总
 */
export function runSuite(
  tests: { name: string; config: BenchConfig }[],
): { results: Record<string, BenchResult>; summary: string } {
  const results: Record<string, BenchResult> = {};

  for (const { name, config } of tests) {
    results[name] = runBenchmark(config);
  }

  // 生成汇总
  const lines: string[] = [];
  lines.push(`# sofagent Benchmark · v${VERSION}`);
  lines.push('');
  lines.push(`| 测试 | 成功率 | 平均耗时 | 标准差 |`);
  lines.push(`|------|:------:|:--------:|:------:|`);

  for (const [name, result] of Object.entries(results)) {
    const rate = (result.successRate * 100).toFixed(1);
    lines.push(`| ${name} | ${rate}% | ${result.avgMs}ms | ${result.stdMs}ms |`);
  }

  return { results, summary: lines.join('\n') };
}

/**
 * 快速 ping 测试（验证框架可用）
 */
export function quickPing(iterations = 5): BenchResult {
  return runBenchmark({
    command: 'node',
    args: ['-e', '1+1'],
    runs: iterations,
    timeout: 5000,
  });
}

// ── CLI ──
function main(): void {
  const args = process.argv.slice(2);

  if (args.includes('--help')) {
    console.log(`sofagent benchmark v${VERSION}`);
    console.log('  基准测试框架——运行命令 N 次并统计');
    console.log('');
    console.log('  用法:');
    console.log('    node benchmark.js --runs 10 -- node -e "1+1"');
    console.log('    node benchmark.js --ping                快速测试框架');
    console.log('');
    console.log('  参数:');
    console.log('    --runs N      运行次数（默认 10）');
    console.log('    --timeout MS  超时时间 ms（默认 30000）');
    process.exit(0);
  }

  if (args.includes('--ping')) {
    console.log('快速 ping 测试 (5 次)...');
    const result = quickPing(5);
    console.log(formatMarkdownReport('框架自检', { command: 'node', args: ['-e', '1+1'], runs: 5, timeout: 5000 }, result));
    process.exit(result.failed === 0 ? 0 : 1);
  }

  // 解析参数
  let runs = 10;
  let timeout = 30_000;
  let dashIndex = args.indexOf('--');
  let command = '';
  let cmdArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--') {
      dashIndex = i;
      break;
    }
    switch (args[i]) {
      case '--runs': runs = parseInt(args[++i]!, 10); break;
      case '--timeout': timeout = parseInt(args[++i]!, 10); break;
    }
  }

  if (dashIndex >= 0 && dashIndex < args.length - 1) {
    command = args[dashIndex + 1]!;
    cmdArgs = args.slice(dashIndex + 2);
  } else {
    console.error('用法: node benchmark.js --runs 10 -- <command> [args...]');
    process.exit(1);
  }

  const result = runBenchmark({ command, args: cmdArgs, runs, timeout });
  console.log(formatMarkdownReport('自定义测试', { command, args: cmdArgs, runs, timeout }, result));
  process.exit(result.failed === 0 ? 0 : 1);
}

if (require.main === module) {
  main();
}
