// ============================================================
// think-generator.ts · 基于 git diff 自动生成 think.md 条目
// v0.98 方案 A：审计引擎基于 diff 硬证据自动生成反思记录
// 不依赖 Agent 配合——diff 是客观证据
// ============================================================

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import type { DiffFile } from './diff-parser';
import type { AuditResult } from './reporter';

/**
 * think.md 条目生成选项
 */
export interface ThinkEntryOptions {
  /** {SOFAGENT_DATA} 根目录，默认 process.cwd()/.sofagent */
  dataDir?: string;
  /** 强制使用的写入时间戳（测试用），默认 now() */
  now?: Date;
}

/**
 * 基于 diff + 审计结果生成 think.md 条目并追加写入
 * 幂等：同一 task + 同一分钟内不重复写入
 *
 * @param diffFiles git diff 解析出的文件变更
 * @param results 审计引擎运行结果
 * @param task 任务描述（--task 参数）
 * @param opts 可选配置
 */
export function generateThinkEntry(
  diffFiles: DiffFile[],
  results: AuditResult,
  task?: string,
  opts?: ThinkEntryOptions
): void {
  // 空 diff 不生成条目
  if (diffFiles.length === 0) return;

  const now = opts?.now ?? new Date();
  const dataDir = opts?.dataDir ?? getSofagentDataDir();
  const thinkPath = join(dataDir, 'think.md');

  // 幂等检查：如果 think.md 最后一节是同一 task + 同一分钟，不重复写入
  if (existsSync(thinkPath) && isDuplicateEntry(thinkPath, task, now)) {
    return;
  }

  // 刷新 think 内容缓存（高频检测要用历史内容）
  const existingContent = readThinkForCache(thinkPath);

  const entry = formatThinkEntry(diffFiles, results, task, now, existingContent);

  // 确保 dataDir 存在
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  // 追加不覆盖
  appendFileSync(thinkPath, entry, 'utf-8');
}

/**
 * 格式化单条 think.md 反思记录
 */
function formatThinkEntry(
  diffFiles: DiffFile[],
  results: AuditResult,
  task: string | undefined,
  now: Date,
  existingContent: string = ''
): string {
  const timestamp = formatTimestamp(now);
  const taskName = task || '(未指定)';

  // 审计结果摘要
  const triggeredRules = results.rules.filter((r) => r.status !== 'PASS');
  const auditVerdict = results.exitCode === 0 ? 'PASS' : results.exitCode === 1 ? 'WARN' : 'FAIL';
  const ruleCount = triggeredRules.length;

  // 改动范围
  const fileList = diffFiles.slice(0, 5).map((f) => f.path).join(', ');
  const fileListSuffix = diffFiles.length > 5 ? `, ...共 ${diffFiles.length} 个` : '';

  // 自动生成教训
  const lessons = generateLessons(triggeredRules);

  // 高频问题检测
  const repeatPattern = detectRepeatPattern(existingContent, lessons);

  let entry = `\n## ${timestamp} 任务: ${taskName}\n\n`;
  entry += `- #审计结果: ${auditVerdict} — ${ruleCount} 条规则触发\n`;
  entry += `- #改动范围: 改了 ${diffFiles.length} 个文件（${fileList}${fileListSuffix}）\n`;
  entry += `- #教训: ${lessons}\n`;
  if (repeatPattern) {
    entry += `- #重复模式: ${repeatPattern}\n`;
  }
  entry += '\n';

  return entry;
}

/**
 * 基于触发的规则自动生成教训文本
 */
function generateLessons(triggeredRules: Array<{ name: string; number: number; status: string; details: string[] }>): string {
  if (triggeredRules.length === 0) {
    return '本次改动符合规范，无异常';
  }

  const lessons: string[] = [];

  for (const rule of triggeredRules) {
    // A3 越界修改
    if (rule.number === 3 || rule.name.includes('越界') || rule.name.includes('A3')) {
      lessons.push('改了任务描述之外的文件，下次注意聚焦');
    }
    // A7 不存盲改
    if (rule.number === 7 || rule.name.includes('盲改') || rule.name.includes('A7')) {
      lessons.push('改了源码但没写日志/测试，下次先写日志');
    }
    // A5 没验证就提交
    if (rule.number === 5 || rule.name.includes('验证') || rule.name.includes('A5')) {
      lessons.push('没有 build/test 痕迹就提交，下次先验证');
    }
  }

  if (lessons.length === 0) {
    // 有触发但没匹配到特定规则，给出通用教训
    const names = triggeredRules.map((r) => r.name).join('、');
    return `触发规则: ${names}，需关注`;
  }

  return lessons.join('；');
}

/**
 * 幂等检查：同一 task + 同一分钟内不重复写入
 */
function isDuplicateEntry(thinkPath: string, task: string | undefined, now: Date): boolean {
  let content: string;
  try {
    content = readFileSync(thinkPath, 'utf-8');
  } catch {
    return false;
  }

  const timestamp = formatTimestamp(now);
  const taskName = task || '(未指定)';
  const expectedHeader = `## ${timestamp} 任务: ${taskName}`;

  // 检查文件末尾是否有相同 header（同一分钟 + 同一 task）
  return content.includes(expectedHeader);
}

/**
 * 高频问题检测：读 think.md 历史，如果同一类教训出现 ≥3 次，标注
 * 安全读取——失败时返回空
 */
function detectRepeatPattern(thinkContent: string, currentLessons: string): string | null {
  if (!thinkContent || currentLessons === '本次改动符合规范，无异常') {
    return null;
  }

  const patterns: string[] = [];

  // 检查高频越界（历史内容搜"任务描述之外"或"越界"，当前教训匹配"任务描述之外"）
  const outOfBoundsCount = (thinkContent.match(/任务描述之外|越界/g) || []).length;
  if (outOfBoundsCount >= 2 && currentLessons.includes('任务描述之外')) {
    patterns.push('越界修改高频出现');
  }

  // 检查高频盲改（历史搜"没写日志"或"盲改"，当前教训匹配"没写日志"）
  const blindEditCount = (thinkContent.match(/没写日志|盲改/g) || []).length;
  if (blindEditCount >= 2 && currentLessons.includes('没写日志')) {
    patterns.push('不存盲改高频出现');
  }

  // 检查高频未验证（历史搜"先验证"或"build/test"，当前教训匹配"先验证"）
  const noVerifyCount = (thinkContent.match(/先验证|没.*build.*test/g) || []).length;
  if (noVerifyCount >= 2 && currentLessons.includes('先验证')) {
    patterns.push('未验证就提交高频出现');
  }

  return patterns.length > 0 ? patterns.join('；') : null;
}

/** 安全读取 think.md（模块级缓存，formatThinkEntry 调用前读） */
let _thinkCache: string | null = null;
function thinkPathSafe(): string {
  if (_thinkCache === null) {
    const dataDir = getSofagentDataDir();
    const thinkPath = join(dataDir, 'think.md');
    try {
      _thinkCache = existsSync(thinkPath) ? readFileSync(thinkPath, 'utf-8') : '';
    } catch {
      _thinkCache = '';
    }
  }
  return _thinkCache;
}

/** 格式化时间戳 YYYY-MM-DD HH:MM */
function formatTimestamp(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

/** 获取 {SOFAGENT_DATA} 目录 */
function getSofagentDataDir(): string {
  return process.env.SOFAGENT_DATA || join(process.cwd(), '.sofagent');
}

/** 安全读取 think.md 内容用于缓存 */
function readThinkForCache(thinkPath: string): string {
  try {
    return existsSync(thinkPath) ? readFileSync(thinkPath, 'utf-8') : '';
  } catch {
    return '';
  }
}

/** 测试用：重置缓存 */
export function _resetThinkCache(): void {
  _thinkCache = null;
}
