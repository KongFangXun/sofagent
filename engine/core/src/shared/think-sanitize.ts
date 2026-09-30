// ============================================================
// shared/think-sanitize.ts · think 条目文本清洗（单一实现）
// v1.5.5 新增：消除 write_think（MCP 侧）与 appendManualThinkEntry（think 包侧）
//   两份已分叉的清洗实现——此前 MCP 侧只清洗 lesson、不清洗 task，task 里的换行
//   可注入新的 `## 标题` 结构；两处常量与时间戳格式化亦各写一份。
// ============================================================
//
// 清洗管线（顺序固定，勿调换）：长度截断 → 换行折叠 → 首尾 trim → 空值缺省占位。
//   · 截断在折行之前——与两侧原实现逐字一致（折行后长度会变，顺序反了产物不同）。
//   · 换行折叠为单空格——防内容注入新的 `## 时间戳 任务:` 条目标题。
// ============================================================

/**
 * lesson 长度上限（字符数）。
 * 两侧原常量同名异值域一致（均为 10000），现收敛为唯一来源。
 */
export const MAX_THINK_LESSON_LENGTH = 10000;

/** 清洗选项 */
export interface ThinkSanitizeOptions {
  /** 长度上限（默认 MAX_THINK_LESSON_LENGTH） */
  maxLength?: number;
  /** 清洗后为空时的缺省占位（不给则返回空串） */
  fallback?: string;
}

/**
 * 清洗 think 条目文本（lesson / task 共用同一管线）。
 *
 * @param input 待清洗内容（非字符串按 String() 归一，null/undefined 视为空串）
 * @param opts  maxLength / fallback
 * @returns 清洗后的文本（空且给了 fallback 时返回 fallback）
 */
export function sanitizeThinkText(input: unknown, opts: ThinkSanitizeOptions = {}): string {
  const maxLength = opts.maxLength ?? MAX_THINK_LESSON_LENGTH;
  let text = input === undefined || input === null ? '' : String(input);
  if (text.length > maxLength) {
    text = text.slice(0, maxLength);
  }
  text = text.replace(/[\r\n]+/g, ' ').trim();
  if (text === '' && opts.fallback !== undefined) {
    return opts.fallback;
  }
  return text;
}
