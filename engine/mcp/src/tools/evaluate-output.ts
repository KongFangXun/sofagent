// ============================================================
// tools/evaluate-output.ts · evaluate_output MCP tool（v1.2.4 · P3 S2）
// ============================================================

import { runEval } from '@sofagent/eval';
import { EVAL_DIR, EVAL_LATEST, EVAL_HISTORY, atomicWriteSync } from '@sofagent/core';
import { existsSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';

export interface EvaluateOutputArgs {
  golden_set_path?: string;
  verbose?: boolean;
}

export function evaluateOutput(args: EvaluateOutputArgs): { text: string; data: unknown } {
  const goldenSetPath = args.golden_set_path || EVAL_DIR;

  try {
    const result = runEval({
      evalDir: goldenSetPath,
      verbose: args.verbose ?? false,
    });

    // 结果写入 latest.json + 追加 history.jsonl
    const evalLatestDir = EVAL_LATEST;
    const evalLatestParent = join(evalLatestDir, '..');
    if (!existsSync(evalLatestParent)) mkdirSync(evalLatestParent, { recursive: true });

    atomicWriteSync(evalLatestDir, JSON.stringify(result, null, 2));

    try {
      appendFileSync(EVAL_HISTORY, JSON.stringify({ timestamp: new Date().toISOString(), ...result }) + '\n', 'utf-8');
    } catch { /* */ }

    const lines: string[] = ['[sofagent] 评估完成:', ''];
    lines.push(`总测试数: ${result.totalTests}`);
    lines.push(`通过: ${result.passed}`);
    lines.push(`失败: ${result.failed}`);
    lines.push(`评分: ${result.score}`);

    if (args.verbose && result.failures && result.failures.length > 0) {
      lines.push('', '失败用例:');
      for (const f of result.failures.slice(0, 10)) {
        lines.push(`  - ${f.name ?? f.id ?? 'unknown'}: ${f.reason ?? 'no detail'}`);
      }
    }

    return {
      text: lines.join('\n'),
      data: {
        totalTests: result.totalTests,
        passed: result.passed,
        failed: result.failed,
        score: result.score,
        failures: result.failures ?? [],
      },
    };
  } catch (err) {
    return {
      text: `[sofagent] 评估异常：${err instanceof Error ? err.message : String(err)}`,
      data: { error: true, totalTests: 0, passed: 0, failed: 0, score: 0, failures: [] },
    };
  }
}
