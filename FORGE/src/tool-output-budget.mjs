// ============================================================
// FORGE/src/tool-output-budget.mjs · 分层工具输出截断中间件（v1.2.8 功能③）
// v1.2.9 功能⑦：渐进式磁盘加载
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
//   5. 渐进式磁盘加载——超长输出截断后写完整版到磁盘，截断标记附路径
// ============================================================

import { writeFileSync } from 'fs';

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
 * v1.2.9 功能⑦：渐进式磁盘加载——diskPath 非空时写完整输出到磁盘，截断标记附路径。
 *
 * 策略：头尾各 maxLines/2 行，截断中间。
 * 额外：检测 "No such file" 并追加系统提示。
 *
 * @param {string} text - 原始输出
 * @param {number} maxLines - 最大行数（默认 200）
 * @param {string} [diskPath] - 磁盘路径，非空时写完整输出到该文件，截断标记附路径
 * @returns {string} 截断后的输出
 */
export function truncateToolOutput(text, maxLines = DEFAULT_BUDGET, diskPath) {
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

  // v1.2.9 功能⑦：渐进式磁盘加载——写完整输出到磁盘，截断标记附路径
  let diskHint = '';
  if (diskPath) {
    try {
      writeFileSync(diskPath, str, 'utf-8');
      diskHint = ` 完整输出已写入 ${diskPath}`;
    } catch {
      // 写失败静默降级——截断仍正常工作，只是没有磁盘备份
    }
  }

  const truncated = [
    ...head,
    `\n... [${lines.length - maxLines} lines truncated by FORGE ToolOutputBudget — head ${half} + tail ${half}]${diskHint} ...\n`,
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
 * v1.2.9 功能⑦：diskDir 非空时自动生成文件名传给 truncateToolOutput 做渐进式磁盘加载。
 *
 * @param {string} stepName - 当前步骤名
 * @param {string} [diskDir] - 磁盘目录，非空时自动生成文件名写完整输出
 * @returns {function(string): string} 截断函数
 *
 * @example
 * const truncate = createToolOutputBudget('b-fix');
 * const output = truncate(rawToolOutput); // 自动用 100 行预算
 *
 * @example
 * const truncate = createToolOutputBudget('a-check', '/tmp/forge-overflow');
 * const output = truncate(rawToolOutput); // 截断 + 完整输出写入磁盘
 */
export function createToolOutputBudget(stepName, diskDir) {
  const budget = getStepBudget(stepName);
  if (!diskDir) {
    return (text) => truncateToolOutput(text, budget);
  }
  // v1.2.9 功能⑦：diskDir 非空时自动生成唯一文件名
  const stamp = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const diskPath = `${diskDir.replace(/\/$/, '')}/tool-output-${stepName}-${stamp}.txt`;
  return (text) => truncateToolOutput(text, budget, diskPath);
}

/** 触发小模型总结的行数阈值 */
const SUMMARIZE_THRESHOLD = 400;

/**
 * 审查类步骤判定——这些步骤的工具输出超阈值时走小模型总结。
 *
 * @param {string} stepName - 步骤名
 * @returns {boolean}
 */
function isReviewStep(stepName) {
  if (!stepName) return false;
  return [
    'a-check', 'b-check', 'acceptance', 'regression', 'coverage', 'f-diagnose',
  ].includes(stepName)
    || stepName.startsWith('a-check-p')
    || stepName.startsWith('b-check-p');
}

/**
 * 用小模型（deepseek-v4-flash）按任务目标总结超长工具输出。
 *
 * v1.2.9 功能⑧：L2 防御层——信息密度 > 原文截断。
 * 总结失败时 fallback 到 truncateToolOutput（L1 截断），保证不丢数据。
 *
 * @param {string} text - 原始工具输出
 * @param {string} taskContext - 任务上下文/目标（如 "A 视角审查 b-fix 步骤产物"）
 * @param {object} [options] - 可选配置
 * @param {number} [options.fallbackLines=200] - 总结失败时的截断行数
 * @param {string} [options.diskPath] - 渐进式磁盘加载路径（fallback 时传入）
 * @returns {Promise<string>} 总结后的文本
 */
export async function summarizeToolOutput(text, taskContext, options = {}) {
  const fallbackLines = options.fallbackLines ?? DEFAULT_BUDGET;

  if (!text || typeof text !== 'string') return '';
  // 短文本直接返回，不需要总结
  const lines = text.split('\n');
  if (lines.length <= SUMMARIZE_THRESHOLD) return text;

  try {
    const { ChatOpenAI } = await import('@langchain/openai');
    const summarizer = new ChatOpenAI({
      modelName: 'deepseek-v4-flash',
      temperature: 0,
      maxTokens: 800,
    });

    const prompt = [
      '你是工具输出总结器。以下是审查过程中某次工具调用的完整输出。',
      `当前任务目标：${taskContext || '通用审查'}`,
      '请提取与任务目标相关的关键信息，压缩成结构化摘要。',
      '保留：文件路径、行号、错误信息、关键代码片段、数值结果。',
      '丢弃：重复的样板输出、无关的调试噪音。',
      '输出格式：简洁的 Markdown 列表。',
    ].join('\n');

    const result = await summarizer.invoke([
      { role: 'system', content: prompt },
      { role: 'user', content: text },
    ]);

    const summary = typeof result?.content === 'string'
      ? result.content
      : String(result?.content ?? '');

    return `[L2 小模型总结 · ${lines.length} 行 → ${summary.split('\n').length} 行]\n\n${summary}`;
  } catch {
    // 总结失败 fallback 到截断——不丢数据
    return truncateToolOutput(text, fallbackLines, options.diskPath);
  }
}

/**
 * 创建智能截断器——审查类步骤走 summarizeToolOutput，其他走 truncateToolOutput。
 *
 * v1.2.9 功能⑧：L1+L2 联合截断入口。
 *
 * @param {string} stepName - 当前步骤名
 * @param {string} taskContext - 任务上下文/目标（传给 summarizeToolOutput）
 * @param {object} [options] - 可选配置（diskDir 等）
 * @returns {Promise<function(string): Promise<string>>} 异步截断器
 *
 * @example
 * const truncate = await createSmartTruncator('a-check', 'A 视角安全审查');
 * const output = await truncate(rawToolOutput);
 */
export async function createSmartTruncator(stepName, taskContext, options = {}) {
  const budget = getStepBudget(stepName);

  if (isReviewStep(stepName)) {
    // 审查类步骤：L2 小模型总结
    return async (text) => summarizeToolOutput(text, taskContext, {
      fallbackLines: budget,
      diskPath: options.diskDir || undefined,
    });
  }

  // 非审查类步骤：L1 截断
  if (options.diskDir) {
    const stamp = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const diskPath = `${options.diskDir.replace(/\/$/, '')}/tool-output-${stepName}-${stamp}.txt`;
    return async (text) => truncateToolOutput(text, budget, diskPath);
  }

  return async (text) => truncateToolOutput(text, budget);
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
  summarizeToolOutput,
  createSmartTruncator,
  STEP_BUDGETS,
  DEFAULT_BUDGET,
  SUMMARIZE_THRESHOLD,
};
