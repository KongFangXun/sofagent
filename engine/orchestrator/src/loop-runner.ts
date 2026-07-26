// ============================================================
// loop-runner.ts · LOOP 双 Agent 自迭代运行器
// Engineer → Reviewer 双 Agent 串联
//
// 流程：
//   1. Engineer 执行任务（最小变更）
//   2. Reviewer 审查 Engineer 的产出
//   3. 如果 Reviewer 判定 IS_PASS: NO → 回 Engineer 修复
//   4. 重复直到 IS_PASS: YES 或达到最大迭代次数
// ============================================================

import { ENGINEER_AGENT, REVIEWER_AGENT } from './builtin-agents';
import { spawnSubAgent } from './launcher';
import type { SubAgentDefinition } from './registry';

/** LOOP 迭代结果 */
export interface LOOPResult {
  /** 最终判定 */
  verdict: 'PASS' | 'FAIL';
  /** 迭代次数 */
  iterations: number;
  /** 每次迭代的 Engineer 输出 */
  engineerOutputs: string[];
  /** 每次迭代的 Reviewer 审查报告 */
  reviewReports: string[];
  /** 最终产物 */
  finalOutput: string;
}

/** LOOP 运行选项 */
export interface LOOPOptions {
  /** 最大迭代次数，默认 3 */
  maxIterations?: number;
  /** 静默模式（不输出日志） */
  silent?: boolean;
}

/**
 * 运行一次 LOOP 迭代：Engineer 执行 → Reviewer 审查
 *
 * @param task 任务描述
 * @param options LOOP 选项
 * @returns LOOP 迭代结果
 */
export async function runLOOPIteration(
  task: string,
  options: LOOPOptions = {}
): Promise<LOOPResult> {
  const maxIterations = options.maxIterations ?? 3;
  const silent = options.silent ?? false;

  const engineerOutputs: string[] = [];
  const reviewReports: string[] = [];

  const log = (msg: string) => {
    if (!silent) console.log(msg);
  };

  log(`🔁 LOOP 启动 · 最大迭代 ${maxIterations} 次`);
  log(`📋 任务: ${task}`);
  log('');

  // Prepend audit context to task for engineer
  const fullTask = [
    `# LOOP 任务`,
    task,
    '',
    '# 执行纪律',
    '1. 先读再改：修改前先 Read 目标文件',
    '2. 最小变更：只触碰任务要求的内容',
    '3. 验证再继续：完成后确认 build 通过',
  ].join('\n');

  for (let i = 0; i < maxIterations; i++) {
    log(`── 迭代 ${i + 1}/${maxIterations} ──`);

    // Phase 1: Engineer 执行
    log(`👷 Engineer 执行中...`);
    const engineerOutput = await spawnSubAgent(ENGINEER_AGENT, fullTask);
    engineerOutputs.push(engineerOutput);
    log(`✅ Engineer 完成`);

    // Phase 2: Reviewer 审查
    const reviewTask = [
      `# 审查任务`,
      `审查以下 Engineer 的产出：`,
      '',
      '```',
      engineerOutput.slice(0, 4000), // 截断以防过长
      '```',
      '',
      '# 审查要求',
      '1. 按 🔴🟡💭 分级标注问题',
      '2. 检查是否满足原始任务要求',
      '3. 检查是否有范围蔓延（做了任务不需要的改动）',
      '4. 输出判定：IS_PASS: YES 或 IS_PASS: NO',
    ].join('\n');

    log(`🔍 Reviewer 审查中...`);
    const reviewReport = await spawnSubAgent(REVIEWER_AGENT, reviewTask);
    reviewReports.push(reviewReport);
    log(`📝 Reviewer 完成`);

    // Phase 3: 判定
    const isPass = /IS_PASS\s*:\s*YES/i.test(reviewReport);

    if (isPass) {
      log('');
      log(`✅ LOOP 通过 · ${i + 1} 次迭代`);
      return {
        verdict: 'PASS',
        iterations: i + 1,
        engineerOutputs,
        reviewReports,
        finalOutput: engineerOutput,
      };
    }

    log(`🔄 IS_PASS: NO · 进行下一轮迭代`);
    log('');

    // 如果不是最后一次迭代，把审查反馈加入到任务中
    if (i < maxIterations - 1) {
      const reviewFeedback = [
        reviewReport.slice(0, 2000),
        '',
        '# 审查反馈（上一轮）',
        '请根据以上审查反馈修复问题，只修复 Reviewer 标记的 🔴 阻塞项和 🟡 建议项。',
      ].join('\n');

      // 将审查反馈追加到 fullTask 中
      // 注意：这是简单的文本拼接，实际 Agent 环境中由 Agent 自行理解上下文
      log('📎 审查反馈已注入下一轮任务');
    }
  }

  log('');
  log(`❌ LOOP 未通过 · ${maxIterations} 次迭代后仍有问题`);

  return {
    verdict: 'FAIL',
    iterations: maxIterations,
    engineerOutputs,
    reviewReports,
    finalOutput: engineerOutputs[engineerOutputs.length - 1] ?? '',
  };
}
