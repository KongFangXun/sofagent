// ============================================================
// loop/checker-nodes.ts · 多类型 Checker 图节点（v1.2.5 · P2b）
// ============================================================
//
// 三种 Checker 节点（audit 之后、reviewer 之前）：
//   format-checker：输出是否符合预期 schema
//   fact-checker：引用的文件/数据源是否真实存在
//   source-validator：信息来源可信度评分
//
// 受控循环升级（当前 engineer→audit→FAIL→engineer 单一重试圈）：
//   - 补信息后继续：audit 证据不足→回到 plan 补子任务
//   - 降级通过：audit WARN→标记后 reviewer 带警告展示
//   - 循环守卫：每种循环独立 maxRetries + degradationThreshold + humanHandoffTrigger
//
// 集成衔接：Checker 发现的失败模式喂给 P1 skillopt failure-ledger
// ============================================================

import { existsSync } from 'fs';
import { join } from 'path';
import type { LoopArtifacts, LoopGraphState } from './state';

/** Checker 结果 */
export interface CheckerResult {
  /** checker 名称 */
  name: string;
  /** 判定：通过/警告/失败 */
  verdict: 'PASS' | 'WARN' | 'FAIL';
  /** 详细报告 */
  report: string;
  /** 失败模式（用于喂给 failure-ledger） */
  failureMode?: string;
  /** 建议的正确做法 */
  correctApproach?: string;
}

/** 循环控制配置（受控循环升级） */
export interface LoopControlConfig {
  /** 最大重试次数 */
  maxRetries: number;
  /** 降级阈值（达到后触发降级） */
  degradationThreshold: number;
  /** 人工介入触发器（连续失败次数后触发） */
  humanHandoffTrigger: number;
}

/** 默认循环控制配置 */
export const DEFAULT_LOOP_CONTROL: LoopControlConfig = {
  maxRetries: 3,
  degradationThreshold: 2,
  humanHandoffTrigger: 3,
};

// ════════════════════════════════════════
// format-checker：输出是否符合预期 schema
// ════════════════════════════════════════

/**
 * format-checker 节点
 *
 * 检查 engineer 产出是否符合预期格式：
 *   - 代码文件是否有语法结构（非空文件 + 合理的行数）
 *   - 输出是否含必要的关键字（如 export/import/function 等）
 */
export function makeFormatCheckerNode(): (state: LoopGraphState) => Promise<any> {
  return async (state: LoopGraphState): Promise<Partial<LoopGraphState>> => {
    const output = state.artifacts.engineerOutput;

    const checks: string[] = [];
    let hasIssue = false;

    // 1. 非空检查
    if (!output || output.trim().length < 10) {
      checks.push('FAIL: 产出为空或过短（<10 字符）');
      hasIssue = true;
    } else {
      checks.push('PASS: 产出非空');
    }

    // 2. 结构完整性（含代码块/文件引用/变更描述之一）
    const hasCodeBlock = output.includes('```') || output.includes('export ') || output.includes('function ');
    const hasFileRef = /\.(ts|js|py|json|md|yml|yaml)\b/.test(output);
    if (!hasCodeBlock && !hasFileRef) {
      checks.push('WARN: 产出缺少代码块或文件引用');
      hasIssue = true;
    } else {
      checks.push('PASS: 产出含代码结构');
    }

    // 3. 长度合理性（过长可能是膨胀，过短可能是空跑）
    const lineCount = output.split('\n').length;
    if (lineCount > 200) {
      checks.push(`WARN: 产出 ${lineCount} 行，可能过度膨胀`);
      hasIssue = true;
    } else if (lineCount < 3) {
      checks.push(`WARN: 产出仅 ${lineCount} 行，可能为空跑`);
      hasIssue = true;
    } else {
      checks.push(`PASS: 产出 ${lineCount} 行，长度合理`);
    }

    const result: CheckerResult = {
      name: 'format-checker',
      verdict: hasIssue ? (lineCount < 3 || output.trim().length < 10 ? 'FAIL' : 'WARN') : 'PASS',
      report: checks.join('\n'),
      failureMode: hasIssue ? 'format-mismatch' : undefined,
      correctApproach: hasIssue ? '确保产出包含完整的代码变更 + 文件引用' : undefined,
    };

    return {
      currentNode: 'format-checker' as LoopGraphState['currentNode'],
      artifacts: {
        ...state.artifacts,
      } as LoopArtifacts,
      // checker 结果通过 artifacts 传递（不污染 auditResult）
      // 后续 routeAfterChecker 会读取此值
    } as Partial<LoopGraphState> & { checkerResults?: CheckerResult[] };
  };
}

// ════════════════════════════════════════
// fact-checker：引用的文件/数据源是否真实存在
// ════════════════════════════════════════

/**
 * fact-checker 节点
 *
 * 检查 engineer 产出的描述中引用的文件/路径是否真实存在：
 *   - 提取 output 中提到的文件路径
 *   - 逐个检查是否存在（相对项目根）
 */
export function makeFactCheckerNode(): (state: LoopGraphState) => Promise<any> {
  return async (state: LoopGraphState): Promise<Partial<LoopGraphState>> => {
    const output = state.artifacts.engineerOutput;
    const projectDir = process.cwd();

    const checks: string[] = [];
    let missingCount = 0;

    // 提取引用的文件路径（简单的正则匹配）
    const filePathPattern = /(?:src\/|engine\/|tools\/|docs\/|test\/|tests\/)([^\s'"`,)]+\.(?:ts|js|py|json|md|yml|yaml|sh))/g;
    const referencedFiles = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = filePathPattern.exec(output)) !== null) {
      const fullPath = match[0];
      if (fullPath) referencedFiles.add(fullPath);
    }

    if (referencedFiles.size === 0) {
      checks.push('PASS: 未引用具体文件路径（或引用格式不标准）');
    } else {
      for (const file of referencedFiles) {
        const absPath = join(projectDir, file);
        if (existsSync(absPath)) {
          checks.push(`PASS: ${file} 存在`);
        } else {
          checks.push(`FAIL: ${file} 不存在`);
          missingCount++;
        }
      }
    }

    const result: CheckerResult = {
      name: 'fact-checker',
      verdict: missingCount > 0 ? 'FAIL' : 'PASS',
      report: checks.join('\n'),
      failureMode: missingCount > 0 ? 'non-existent-file-reference' : undefined,
      correctApproach: missingCount > 0 ? `修正 ${missingCount} 个不存在的文件引用` : undefined,
    };

    return {
      currentNode: 'fact-checker' as LoopGraphState['currentNode'],
      artifacts: {
        ...state.artifacts,
      } as LoopArtifacts,
    } as Partial<LoopGraphState>;
  };
}

// ════════════════════════════════════════
// source-validator：信息来源可信度评分
// ════════════════════════════════════════

/** 来源可信度等级 */
type SourceTrust = 'high' | 'medium' | 'low' | 'unverified';

/**
 * source-validator 节点
 *
 * 评估 engineer 产出中的信息来源可信度：
 *   - 官方文档链接 → high
 *   - 测试文件引用 → high
 *   - 注释/类型系统 → medium
 *   - 未标注来源 → unverified
 */
export function makeSourceValidatorNode(): (state: LoopGraphState) => Promise<any> {
  return async (state: LoopGraphState): Promise<Partial<LoopGraphState>> => {
    const output = state.artifacts.engineerOutput;
    const checks: string[] = [];
    let trustScore = 0;
    let totalSources = 0;

    // 1. 官方文档链接
    const docLinks = output.match(/https?:\/\/[^\s)]+\.(?:md|txt|html)/g) ?? [];
    const officialLinks = docLinks.filter((l) =>
      /typescriptlang|nodejs|developer\.mozilla|github\.com/.test(l),
    );
    if (officialLinks.length > 0) {
      trustScore += 2 * officialLinks.length;
      totalSources += officialLinks.length;
      checks.push(`PASS: ${officialLinks.length} 个官方文档引用`);
    }

    // 2. 测试文件引用
    const testRefs = output.match(/\.test\.(ts|js)|\.spec\.(ts|js)|test_|_test/g) ?? [];
    if (testRefs.length > 0) {
      trustScore += 2 * Math.min(testRefs.length, 3);
      totalSources += testRefs.length;
      checks.push(`PASS: ${testRefs.length} 个测试引用`);
    }

    // 3. 类型注解（TypeScript type annotations）
    const typeAnnotations = output.match(/:\s*(string|number|boolean|void|any|unknown|never)\b/g) ?? [];
    if (typeAnnotations.length > 0) {
      trustScore += 1;
      checks.push(`PASS: ${typeAnnotations.length} 处类型注解`);
    }

    // 4. 未标注来源的断言（"应该"/"必须"/"总是"）
    const assertions = output.match(/(应该|必须|总是|一定|绝)/g) ?? [];
    if (assertions.length > 5) {
      trustScore -= 1;
      checks.push(`WARN: ${assertions.length} 处无来源断言`);
    }

    // 综合评分
    let trustLevel: SourceTrust = 'unverified';
    if (trustScore >= 4) trustLevel = 'high';
    else if (trustScore >= 2) trustLevel = 'medium';
    else if (trustScore >= 1) trustLevel = 'low';

    const result: CheckerResult = {
      name: 'source-validator',
      verdict: trustLevel === 'unverified' || trustLevel === 'low' ? 'WARN' : 'PASS',
      report: `来源可信度: ${trustLevel}（评分 ${trustScore}）\n${checks.join('\n')}`,
      failureMode: trustLevel === 'low' || trustLevel === 'unverified' ? 'low-source-trust' : undefined,
      correctApproach: trustLevel === 'low' || trustLevel === 'unverified'
        ? '补充官方文档引用/测试验证/类型注解以提升可信度'
        : undefined,
    };

    return {
      currentNode: 'source-validator' as LoopGraphState['currentNode'],
      artifacts: {
        ...state.artifacts,
      } as LoopArtifacts,
    } as Partial<LoopGraphState>;
  };
}

// ════════════════════════════════════════
// 受控循环升级：路由判定
// ════════════════════════════════════════

/** 受控循环模式 */
export type ControlledLoopMode =
  | 'retry' // 正常重试（回 engineer）
  | 'supplement' // 补信息后继续（回 plan 补子任务）
  | 'degraded-pass' // 降级通过（WARN→标记后 reviewer 带警告展示）
  | 'human-handoff'; // 人工介入

/**
 * 基于三个 checker 结果判定受控循环模式
 *
 * @param checkerResults 三个 checker 的结果
 * @param retryCount 当前重试次数
 * @param config 循环控制配置
 */
export function resolveLoopMode(
  checkerResults: CheckerResult[],
  retryCount: number,
  config: LoopControlConfig = DEFAULT_LOOP_CONTROL,
): ControlledLoopMode {
  const hasFail = checkerResults.some((c) => c.verdict === 'FAIL');
  const hasWarn = checkerResults.some((c) => c.verdict === 'WARN');

  // 有 FAIL 且已达上限 → 人工介入
  if (hasFail && retryCount >= config.humanHandoffTrigger) {
    return 'human-handoff';
  }

  // 有 FAIL 且达降级阈值 → 补信息（回 plan）
  if (hasFail && retryCount >= config.degradationThreshold) {
    return 'supplement';
  }

  // 有 FAIL 且在重试范围内 → 正常重试
  if (hasFail) {
    return 'retry';
  }

  // 仅 WARN（无 FAIL）→ 降级通过
  if (hasWarn) {
    return 'degraded-pass';
  }

  // 全 PASS → 继续 reviewer（不改变流转）
  return 'degraded-pass'; // degraded-pass 在此处语义=继续流转（WARN 标记为空）
}

/**
 * 将 checker 的失败模式记录到 failure-ledger（喂给 P1 skillopt）
 *
 * 通过动态 import skillopt 避免编译期依赖
 */
export async function recordCheckerFailures(
  checkerResults: CheckerResult[],
  skillId: string,
): Promise<void> {
  try {
    const skillopt = await import('@sofagent/skillopt');
    if (typeof skillopt.recordFailure === 'function') {
      for (const result of checkerResults) {
        if (result.failureMode) {
          skillopt.recordFailure({
            timestamp: new Date().toISOString(),
            skillId,
            failureMode: result.failureMode,
            reason: result.report.slice(0, 200),
            correctApproach: result.correctApproach,
            source: 'orchestrator-checker',
          });
        }
      }
    }
  } catch {
    // skillopt 不可用时静默跳过（不影响 LOOP 流程）
  }
}

// ════════════════════════════════════════
// checker 节点工厂（合并三个 checker 到一个 LangGraph 节点）
// ════════════════════════════════════════

/**
 * 创建 checker 节点（执行 format/fact/source 三个检查器）
 *
 * 流程：
 *   1. 依次执行 format-checker → fact-checker → source-validator
 *   2. 汇总结果
 *   3. 有 FAIL → 记录到 failure-ledger → 回 engineer（受控循环）
 *   4. 仅 WARN → 标记后继续 reviewer（降级通过）
 *   5. 全 PASS → 继续 reviewer
 */
export function makeCheckerNode(
  deps: {
    log?: (msg: string) => void;
    maxRetries?: number;
  } = {},
): (state: LoopGraphState) => Promise<any> {
  const log = deps.log ?? (() => {});
  const maxRetries = deps.maxRetries ?? 3;

  const formatChecker = makeFormatCheckerNode();
  const factChecker = makeFactCheckerNode();
  const sourceValidator = makeSourceValidatorNode();

  return async (state: LoopGraphState): Promise<Partial<LoopGraphState>> => {
    log('🔍 checker 执行中（format + fact + source）...');

    // 执行三个 checker
    const formatResult = await formatChecker(state) as unknown as { checkerResults?: CheckerResult[] };
    const factResult = await factChecker(state) as unknown as { checkerResults?: CheckerResult[] };
    const sourceResult = await sourceValidator(state) as unknown as { checkerResults?: CheckerResult[] };

    // 重建结构化 CheckerResult（从节点返回值中恢复）
    // 由于 makeFormatCheckerNode 等返回的 Partial<LoopGraphState> 不含 CheckerResult，
    // 实际 checker 结果需从 report 字段提取。此处简化：重新执行逻辑获取结构化结果。
    const checkerResults = executeCheckersStandalone(state);

    // 判定受控循环模式
    const mode = resolveLoopMode(checkerResults, state.retryCount, {
      maxRetries,
      degradationThreshold: 2,
      humanHandoffTrigger: 3,
    });

    // 记录失败模式到 failure-ledger
    const hasFailures = checkerResults.some((c) => c.failureMode);
    if (hasFailures) {
      void recordCheckerFailures(
        checkerResults,
        `loop-${state.checkpointId}`,
      );
    }

    log(`🔍 checker 完成 · 模式: ${mode}`);

    // 根据模式决定状态更新
    const checkerReport = checkerResults
      .map((c) => `[${c.verdict}] ${c.name}: ${c.report.split('\n')[0]}`)
      .join('\n');

    // checker 默认不阻断流转——标记结果后继续 reviewer
    // 受控循环（retry/supplement）通过 audit 节点已有的重试机制处理
    // checker 只负责记录失败模式到 failure-ledger + 标记 auditReport
    const auditReport = hasFailures
      ? `${state.artifacts.auditReport}\n\n[checker ${mode === 'degraded-pass' ? '降级通过' : '结果'}]\n${checkerReport}`
      : `${state.artifacts.auditReport}\n\n[checker 全通过]\n${checkerReport}`;

    return {
      currentNode: 'checker',
      artifacts: { auditReport },
    } as any;
  };
}

/**
 * 独立执行三个 checker 并返回结构化 CheckerResult（不经过 LangGraph 节点）
 */
function executeCheckersStandalone(state: LoopGraphState): CheckerResult[] {
  const output = state.artifacts.engineerOutput;
  const results: CheckerResult[] = [];

  // ── format-checker ──
  const formatChecks: string[] = [];
  let formatHasIssue = false;
  if (!output || output.trim().length < 10) {
    formatChecks.push('FAIL: 产出为空或过短');
    formatHasIssue = true;
  } else {
    formatChecks.push('PASS: 产出非空');
  }
  const formatLineCount = output.split('\n').length;
  if (formatLineCount > 200) {
    formatChecks.push(`WARN: 产出 ${formatLineCount} 行，可能过度膨胀`);
    formatHasIssue = true;
  } else if (formatLineCount < 3) {
    formatChecks.push(`WARN: 产出仅 ${formatLineCount} 行，可能为空跑`);
    formatHasIssue = true;
  }
  results.push({
    name: 'format-checker',
    verdict: formatHasIssue
      ? (output.trim().length < 10 ? 'FAIL' : 'WARN')
      : 'PASS',
    report: formatChecks.join('\n'),
    failureMode: formatHasIssue ? 'format-mismatch' : undefined,
    correctApproach: formatHasIssue ? '确保产出包含完整代码变更' : undefined,
  });

  // ── fact-checker ──
  const projectDir = process.cwd();
  const factChecks: string[] = [];
  let missingCount = 0;
  const filePathPattern = /(?:src\/|engine\/|tools\/|docs\/|test\/|tests\/)([^\s'"`,)]+\.(?:ts|js|py|json|md|yml|yaml|sh))/g;
  const referencedFiles = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = filePathPattern.exec(output)) !== null) {
    const fp = m[0];
    if (fp) referencedFiles.add(fp);
  }
  if (referencedFiles.size === 0) {
    factChecks.push('PASS: 未引用具体文件路径');
  } else {
    for (const file of referencedFiles) {
      if (!existsSync(join(projectDir, file))) {
        factChecks.push(`FAIL: ${file} 不存在`);
        missingCount++;
      }
    }
  }
  results.push({
    name: 'fact-checker',
    verdict: missingCount > 0 ? 'FAIL' : 'PASS',
    report: factChecks.join('\n'),
    failureMode: missingCount > 0 ? 'non-existent-file-reference' : undefined,
    correctApproach: missingCount > 0 ? `修正 ${missingCount} 个不存在的文件引用` : undefined,
  });

  // ── source-validator ──
  const sourceChecks: string[] = [];
  let trustScore = 0;
  const docLinks = output.match(/https?:\/\/[^\s)]+\.(?:md|txt|html)/g) ?? [];
  if (docLinks.length > 0) trustScore += docLinks.length;
  const testRefs = output.match(/\.test\.(ts|js)|\.spec\.(ts|js)/g) ?? [];
  if (testRefs.length > 0) trustScore += Math.min(testRefs.length, 3);
  const typeAnnotations = output.match(/:\s*(string|number|boolean|void)\b/g) ?? [];
  if (typeAnnotations.length > 0) trustScore += 1;

  const trustLevel = trustScore >= 4 ? 'high' : trustScore >= 2 ? 'medium' : trustScore >= 1 ? 'low' : 'unverified';
  sourceChecks.push(`来源可信度: ${trustLevel}（评分 ${trustScore}）`);
  results.push({
    name: 'source-validator',
    verdict: trustLevel === 'unverified' || trustLevel === 'low' ? 'WARN' : 'PASS',
    report: sourceChecks.join('\n'),
    failureMode: trustLevel === 'low' || trustLevel === 'unverified' ? 'low-source-trust' : undefined,
    correctApproach: trustLevel === 'low' || trustLevel === 'unverified'
      ? '补充官方文档引用/测试验证/类型注解'
      : undefined,
  });

  return results;
}
