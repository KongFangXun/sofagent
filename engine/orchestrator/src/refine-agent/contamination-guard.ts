// ============================================================
// refine-agent/contamination-guard.ts · 污染检测（v1.3.3 交付 T05）
// ============================================================
//
// 防止 rubric / Gold 评分标准泄漏进优化器上下文（Benchmark 评测隔离铁律）。
//
// 哲学一致性（协议设计 §8.1）：优化器只能改经验层（think.md / knowledge/），
// 绝不能接触 Benchmark 的 rubric / Gold——否则优化器可以「作弊」
// （往经验层写答案，而非真正提升能力）。
//
// 检测维度：
//   1. 优化器上下文文本中是否出现 rubric 标识关键词
//   2. Candidate 修改内容是否包含 Gold 答案片段
//   3. Agent 执行上下文（workspace）是否包含 rubric 目录
//
// 命中污染 → 立即恢复（拒绝 Candidate）+ 停止优化循环。
// ============================================================

/** 污染检测输入 */
export interface ContaminationCheckInput {
  /** 优化器上下文文本（hypothesis 生成时的 prompt / 上下文材料） */
  optimizerContext: string;
  /** Candidate 修改内容（要写入 think.md / knowledge 的文本） */
  candidateContent: string;
  /** Benchmark rubric 文本（用于检测是否泄漏进优化器上下文） */
  rubricText?: string;
  /** Benchmark Gold 答案文本 */
  goldText?: string;
}

/** 污染类型 */
export type ContaminationType =
  | 'rubric_in_context'    // rubric 内容出现在优化器上下文中
  | 'gold_in_context'      // Gold 答案出现在优化器上下文中
  | 'gold_in_candidate'    // Gold 答案片段出现在 Candidate 修改内容中
  | 'rubric_keyword'       // rubric 标识关键词出现在上下文中
  | 'eval_metadata';       // 评测元数据（评分逻辑）泄漏

/** 污染检测结果 */
export interface ContaminationResult {
  /** 是否检测到污染 */
  contaminated: boolean;
  /** 污染类型列表（contaminated=true 时有值） */
  types: ContaminationType[];
  /** 检测详情（每条污染的可读描述） */
  details: string[];
}

/** rubric 标识关键词（出现这些词说明上下文可能含评分标准） */
const RUBRIC_KEYWORDS = [
  'rubric',
  'scoring criteria',
  '评分标准',
  'gold answer',
  'gold标准',
  'expected output',
  '标准答案',
  'reference solution',
  '评分细则',
];

/** 污染关键词检测的上下文窗口（Gold 片段匹配最小长度） */
const GOLD_FRAGMENT_MIN_LENGTH = 10;

/**
 * 检测污染——优化器上下文 / Candidate 内容中是否含 rubric / Gold。
 *
 * 检测逻辑：
 *   1. rubricText 出现在 optimizerContext 中 → rubric_in_context
 *   2. goldText 出现在 optimizerContext 中 → gold_in_context
 *   3. goldText 片段出现在 candidateContent 中 → gold_in_candidate
 *   4. RUBRIC_KEYWORDS 出现在 optimizerContext 中 → rubric_keyword
 *
 * @param input 检测输入
 * @returns ContaminationResult
 */
export function checkContamination(input: ContaminationCheckInput): ContaminationResult {
  const types: ContaminationType[] = [];
  const details: string[] = [];

  const ctx = input.optimizerContext.toLowerCase();
  const candidate = input.candidateContent.toLowerCase();

  // 1. rubric 内容出现在优化器上下文中
  if (input.rubricText) {
    const rubricLower = input.rubricText.toLowerCase().trim();
    if (rubricLower.length >= GOLD_FRAGMENT_MIN_LENGTH && ctx.includes(rubricLower.slice(0, Math.min(rubricLower.length, 100)))) {
      types.push('rubric_in_context');
      details.push('优化器上下文包含 rubric 评分标准内容（疑似泄漏）');
    }
  }

  // 2. Gold 答案出现在优化器上下文中
  if (input.goldText) {
    const goldLower = input.goldText.toLowerCase().trim();
    if (goldLower.length >= GOLD_FRAGMENT_MIN_LENGTH && ctx.includes(goldLower.slice(0, Math.min(goldLower.length, 100)))) {
      types.push('gold_in_context');
      details.push('优化器上下文包含 Gold 标准答案内容（疑似泄漏）');
    }
  }

  // 3. Gold 答案片段出现在 Candidate 修改内容中
  if (input.goldText) {
    const goldLower = input.goldText.toLowerCase().trim();
    if (goldLower.length >= GOLD_FRAGMENT_MIN_LENGTH && candidate.includes(goldLower.slice(0, Math.min(goldLower.length, 100)))) {
      types.push('gold_in_candidate');
      details.push('Candidate 修改内容包含 Gold 标准答案片段（疑似作弊写入答案而非提升能力）');
    }
  }

  // 4. rubric 标识关键词出现在优化器上下文中
  for (const keyword of RUBRIC_KEYWORDS) {
    if (ctx.includes(keyword.toLowerCase())) {
      types.push('rubric_keyword');
      details.push(`优化器上下文包含评分标准标识关键词「${keyword}」（疑似 rubric 泄漏）`);
      break; // 只报告一次
    }
  }

  return {
    contaminated: types.length > 0,
    types,
    details,
  };
}

/**
 * 污染检测拦截——命中污染时抛错，强制停止优化循环。
 *
 * 使用方式：在 optimization-loop 的 hypothesis → Candidate 步骤后调用，
 * 如果检测到污染 → 立即恢复（拒绝 Candidate）+ 停止。
 *
 * @param input 检测输入
 * @throws ContaminationError 命中污染时
 */
export function assertNoContamination(input: ContaminationCheckInput): void {
  const result = checkContamination(input);
  if (result.contaminated) {
    throw new ContaminationError(result);
  }
}

/** 污染检测错误（命中时抛出——强制停止优化循环） */
export class ContaminationError extends Error {
  readonly result: ContaminationResult;
  constructor(result: ContaminationResult) {
    const detailStr = result.details.join('; ');
    super(`[contamination-guard] 检测到 Benchmark 数据污染：${detailStr}——已拒绝 Candidate 并停止优化循环`);
    this.name = 'ContaminationError';
    this.result = result;
  }
}
