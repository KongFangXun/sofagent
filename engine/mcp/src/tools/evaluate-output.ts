// ============================================================
// evaluate-output.ts · MCP tool：用 golden set 评估 Agent 产出（v1.3.5 S2 新增）
// ============================================================
//
// 复用 @sofagent/eval 的 runEval()
// 默认 golden set 路径使用 @sofagent/core 导出的 EVAL_DIR 常量
// 结果写入 EVAL_LATEST + 追加 EVAL_HISTORY（与 CLI 行为一致）
// ============================================================

import { existsSync, writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { runEval, type EvalResult } from '@sofagent/eval';
import { EVAL_DIR, EVAL_LATEST, EVAL_HISTORY, VERSION } from '@sofagent/core';

// ============================================================
// 类型定义
// ============================================================

export interface EvaluateOutputArgs {
  /** golden set 文件路径（默认使用内置 golden set） */
  golden_set_path?: string;
  /** 是否输出详细报告 */
  verbose?: boolean;
}

export interface EvaluateOutputResult {
  text: string;
  data: {
    totalTests: number;
    passed: number;
    failed: number;
    score: number;
    failures: Array<{ testId: string; error?: string }>;
  };
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 查找默认 golden set 文件
 */
function findDefaultGoldenSet(): string | null {
  const candidates = [
    join(EVAL_DIR, 'golden-set.yaml'),
    join(EVAL_DIR, 'golden-set.yml'),
    join(EVAL_DIR, 'tests', 'golden-set.yaml'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

// ============================================================
// 主函数
// ============================================================

export async function evaluateOutput(args: EvaluateOutputArgs): Promise<EvaluateOutputResult> {
  const goldenSetPath = args.golden_set_path ?? findDefaultGoldenSet();
  const verbose = args.verbose ?? false;

  if (!goldenSetPath || !existsSync(goldenSetPath)) {
    return {
      text: `[sofagent] golden set 文件不存在（查找路径: ${goldenSetPath || EVAL_DIR}）。\n请先创建 golden set 或指定 golden_set_path 参数。`,
      data: {
        totalTests: 0,
        passed: 0,
        failed: 0,
        score: 0,
        failures: [],
      },
    };
  }

  let result: EvalResult;
  try {
    result = await runEval({
      goldenSetPath,
      verbose,
    });
  } catch (err) {
    return {
      text: `[sofagent] eval 运行失败: ${err instanceof Error ? err.message : String(err)}`,
      data: {
        totalTests: 0,
        passed: 0,
        failed: 0,
        score: 0,
        failures: [],
      },
    };
  }

  const score = Math.round(result.passRate * 100);

  // 写入 latest.json + 追加 history.jsonl
  const latestJson = {
    timestamp: new Date().toISOString(),
    total: result.total,
    passed: result.passed,
    failed: result.failed,
    passRate: result.passRate,
    duration: result.duration,
    failures: result.results
      .filter((r) => !r.passed)
      .map((r) => ({
        testId: r.testId,
        description: '',
        overallScore: r.score.overall,
        expected: r.expected,
        actual: r.actual,
        ...(r.error ? { error: r.error } : {}),
      })),
  };

  if (!existsSync(EVAL_DIR)) {
    mkdirSync(EVAL_DIR, { recursive: true });
  }

  try {
    writeFileSync(EVAL_LATEST, JSON.stringify(latestJson, null, 2), 'utf-8');
    const historyEntry = JSON.stringify({
      timestamp: latestJson.timestamp,
      total: result.total,
      passed: result.passed,
      failed: result.failed,
      passRate: result.passRate,
    });
    appendFileSync(EVAL_HISTORY, historyEntry + '\n', 'utf-8');
  } catch {
    // 写入失败非致命
  }

  const lines: string[] = [];
  lines.push(`[sofagent] eval 完成 · sofagent-audit v${VERSION}`);
  lines.push(`总分: ${score}% · 通过 ${result.passed}/${result.total} · 耗时 ${result.duration}ms`);

  if (result.failed > 0) {
    lines.push('');
    lines.push(`失败用例（${result.failed}）:`);
    for (const r of result.results.filter((r) => !r.passed)) {
      const errMsg = r.error ? ` · ${r.error}` : '';
      lines.push(`  ❌ ${r.testId}${errMsg}`);
    }
  } else if (result.total > 0) {
    lines.push('✅ 全部用例通过');
  }

  return {
    text: lines.join('\n'),
    data: {
      totalTests: result.total,
      passed: result.passed,
      failed: result.failed,
      score,
      failures: result.results
        .filter((r) => !r.passed)
        .map((r) => ({
          testId: r.testId,
          ...(r.error ? { error: r.error } : {}),
        })),
    },
  };
}
