// ============================================================
// FORGE/src/tool-output-budget.mjs · 分层工具输出截断中间件（v1.2.8 功能③）
//
// 将 sf_read 500 行截断从单点提升为分层中间件，注入 createReactAgent 的
// middleware 链。不同步骤类型有不同的截断预算：
//
//   审查类（a-check/b-check）   → 200 行（只读摘要）
//   修复类（b-fix/f-fix）       → 100 行（精确定位）
//   验证类（a-verify）          → 50 行（最严格）
//   合并类（a-consolidate）     → 500 行（需要全局视角）
//   默认                        → 200 行
//
// 设计原则：
//   1. 单一事实源——全部 truncateToolOutput 逻辑从此处定义，driver 调用
//   2. 步骤感知——不同 step 名称自动匹配预算
//   3. 头尾各半——保留开头和结尾，截断中间冗余内容
//   4. No-such-file 检测——检测到文件不存在时追加系统提示（防死循环）
// ============================================================

/**
 * 步骤类型 → 截断预算映射。
 */
const STEP_BUDGETS = {
  // 审查类：只读摘要，200 行够用
  'a-check':       200,
  'b-check':       200,
  // 合并类：需要全局视角，给最多行数
  'a-consolidate': 500,
  // 修复类：精确定位，减少噪音
  'b-fix':         100,
  'f-fix':         100,
  // 验证类：最严格，只看关键输出
  'a-verify':      50,
  // release-gate V 步骤
  'acceptance':    200,
  'regression':    200,
  'coverage':      200,
  'consolidate':   500,
  'verdict':       100,
  // F 诊断：读 verdict + 源码，200 够用
  'f-diagnose':    200,
};

/** 默认截断行数 */
export const DEFAULT_BUDGET = 200;

/**
 * 根据步骤名获取截断预算。
 *
 * @param {string} stepName - 步骤名（如 'a-check', 'b-fix', 'f-fix'）
 * @returns {number} 截断行数
 */
export function getStepBudget(stepName) {
  return STEP_BUDGETS[stepName] ?? DEFAULT_BUDGET;
}

/**
 * 截断工具输出（防止超长输出撑爆上下文）。
 *
 * v1.2.8 统一实现——替代 driver-base / fresh-eyes / release-gate 三处分散的 truncateToolOutput。
 *
 * 策略：头尾各 maxLines/2 行，截断中间。
 * 额外：检测 "No such file" 并追加系统提示。
 *
 * @param {string} text - 原始输出
 * @param {number} maxLines - 最大行数（默认 200）
 * @returns {string} 截断后的输出
 */
export function truncateToolOutput(text, maxLines = DEFAULT_BUDGET) {
  if (!text || typeof text !== 'string') return '';
  const str = String(text);

  // No such file 检测——辅助手段，在工具输出末尾追加系统提示
  const hasNoSuchFile = /No such file or directory/i.test(str);

  const lines = str.split('\n');
  if (lines.length <= maxLines) {
    return hasNoSuchFile
      ? str + '\n\n[系统提示] 该文件不存在，请记录为缺失并继续下一步，禁止换路径重试。'
      : str;
  }

  const half = Math.floor(maxLines / 2);
  const head = lines.slice(0, half);
  const tail = lines.slice(-half);
  const truncated = [
    ...head,
    `\n... [${lines.length - maxLines} lines truncated by FORGE ToolOutputBudget — head ${half} + tail ${half}] ...\n`,
    ...tail,
  ].join('\n');

  return hasNoSuchFile
    ? truncated + '\n\n[系统提示] 该文件不存在，请记录为缺失并继续下一步，禁止换路径重试。'
    : truncated;
}

/**
 * 创建步骤感知的工具输出截断函数。
 *
 * 用于在 driver 内部替代硬编码的 maxLines——根据当前步骤名自动选择预算。
 *
 * @param {string} stepName - 当前步骤名
 * @returns {function(string): string} 截断函数
 *
 * @example
 * const truncate = createToolOutputBudget('b-fix');
 * const output = truncate(rawToolOutput); // 自动用 100 行预算
 */
export function createToolOutputBudget(stepName) {
  const budget = getStepBudget(stepName);
  return (text) => truncateToolOutput(text, budget);
}

/**
 * 为 driver-base 创建统一的截断中间件导出。
 *
 * 在 createForgeDriverBase() 的返回对象中注入此函数，
 * 替代旧的 truncateToolOutput 内部实现。
 */
export default {
  truncateToolOutput,
  getStepBudget,
  createToolOutputBudget,
  STEP_BUDGETS,
  DEFAULT_BUDGET,
};
