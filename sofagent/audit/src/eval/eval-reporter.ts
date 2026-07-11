// ============================================================
// eval/eval-reporter.ts · eval 报告生成器
// v1.0.4 新增
// 输出 markdown 格式报告
// ============================================================

import type { EvalResult, TestCaseResult } from './types';

/**
 * 生成 markdown 格式的 eval 报告
 */
export function generateEvalReport(result: EvalResult): string {
  const lines: string[] = [];

  lines.push('# sofagent Eval 报告');
  lines.push('');
  lines.push(`**运行时间**: ${new Date().toISOString()}`);
  lines.push(`**耗时**: ${(result.duration / 1000).toFixed(2)}s`);
  lines.push('');

  // 汇总
  lines.push('## 汇总');
  lines.push('');
  const passRate = (result.passRate * 100).toFixed(1);
  const emoji = result.passRate >= 0.9 ? '✅' : result.passRate >= 0.7 ? '⚠️' : '❌';
  lines.push(`| 指标 | 值 |`);
  lines.push(`|------|-----|`);
  lines.push(`| 总计 | ${result.total} |`);
  lines.push(`| 通过 | ${result.passed} |`);
  lines.push(`| 失败 | ${result.failed} |`);
  lines.push(`| 通过率 | ${emoji} ${passRate}% |`);
  lines.push('');

  // 详细结果
  if (result.results.length > 0) {
    lines.push('## 详细结果');
    lines.push('');

    for (const r of result.results) {
      const status = r.passed ? '✅' : '❌';
      lines.push(`### ${status} ${r.testId}`);
      lines.push('');
      lines.push(`- **通过**: ${r.passed ? '是' : '否'}`);
      lines.push(`- **耗时**: ${r.duration}ms`);
      lines.push(`- **精确匹配**: ${(r.score.exactMatch * 100).toFixed(1)}%`);
      lines.push(`- **语义相似**: ${(r.score.semanticSimilarity * 100).toFixed(1)}%`);
      lines.push(`- **规则合规**: ${(r.score.ruleCompliance * 100).toFixed(1)}%`);
      lines.push(`- **综合得分**: ${(r.score.overall * 100).toFixed(1)}%`);

      if (r.error) {
        lines.push(`- **错误**: ${r.error}`);
      }
      lines.push('');
    }
  }

  // 失败用例汇总
  const failures = result.results.filter((r) => !r.passed);
  if (failures.length > 0) {
    lines.push('## 失败用例');
    lines.push('');
    for (const f of failures) {
      lines.push(`- **${f.testId}**: 综合得分 ${(f.score.overall * 100).toFixed(1)}%${f.error ? ` (${f.error})` : ''}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 输出 eval 报告到 stdout
 */
export function printEvalReport(result: EvalResult): void {
  console.log(generateEvalReport(result));

  // 退出码
  if (result.failed > 0) {
    process.exitCode = 1;
  }
}
