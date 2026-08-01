// ============================================================
// think-generator.ts · 基于 git diff 自动生成 think.md 条目
// v0.98 方案 A：审计引擎基于 diff 硬证据自动生成反思记录
// v1.2.0 迁移到 @sofagent/think
// ============================================================

import { existsSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { DiffFile, AuditResult } from '@sofagent/core';
import { VERSION, getThinkPath, appendThinkEntry, DATA_DIR, EVAL_LATEST } from '@sofagent/core';
import type { DataChange, DataAuditResult } from '@sofagent/core';
/**
 * think.md 条目生成选项
 */
export interface ThinkEntryOptions {
  /** 数据根目录，默认 process.cwd()/data（v1.2.1 起，原 .sofagent/） */
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
  const thinkPath = getThinkPath(dataDir);

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

  // 追加不覆盖（经 @sofagent/core 契约，强制 append-only 不变量）
  appendThinkEntry(thinkPath, entry);
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
  entry += `- #审计结果(sofagent-audit v${VERSION}): ${auditVerdict} — ${ruleCount} 条规则触发\n`;
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
  } catch (e) {
    // best-effort 降级：读不到 think.md 不阻断条目生成，但 warn 原错以便排查
    console.warn(`[think-generator] 读取 think.md 失败，幂等检查降级为跳过: ${e instanceof Error ? e.message : String(e)}`);
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

/** 格式化时间戳 YYYY-MM-DD HH:MM */
function formatTimestamp(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

/** 获取数据根目录（v1.2.1：默认从 .sofagent/ 迁移到 data/，SOFAGENT_DATA 可覆盖） */
function getSofagentDataDir(): string {
  return process.env.SOFAGENT_DATA || DATA_DIR;
}

/** 安全读取 think.md 内容用于缓存 */
function readThinkForCache(thinkPath: string): string {
  try {
    return existsSync(thinkPath) ? readFileSync(thinkPath, 'utf-8') : '';
  } catch (e) {
    // best-effort 降级：读不到 think.md 缓存不阻断条目生成，但 warn 原错以便排查
    console.warn(`[think-generator] 读取 think.md 缓存失败，高频检测降级为空: ${e instanceof Error ? e.message : String(e)}`);
    return '';
  }
}

// ============================================================
// v1.2.4 新增：从 eval latest.json 生成 think.md 反思条目
// ============================================================

/** latest.json 中失败用例的结构 */
interface EvalFailedCase {
  testId: string;
  description: string;
  overallScore: number;
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
  error?: string;
}

/** latest.json 的结构 */
interface EvalLatestJson {
  timestamp: string;
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  duration: number;
  failures: EvalFailedCase[];
}

/**
 * 从 eval latest.json 失败用例生成 think.md 反思条目
 *
 * 流程：
 * 1. 读 data/eval/latest.json
 * 2. 提取 failures 数组（passed=false 的用例）
 * 3. 为每条失败用例生成 think.md 反思条目
 * 4. latest.json 不存在时静默跳过（eval 尚未运行过）
 * 5. latest.json 存在但 failures 为空时跳过（全通过无需反思）
 * 6. 幂等检查（同一 testId + 同一分钟不重复写入）
 *
 * @param opts 可选配置（dataDir / now）
 */
export function generateThinkFromEval(opts?: ThinkEntryOptions): void {
  const latestPath = opts?.dataDir
    ? join(opts.dataDir, 'eval', 'latest.json')
    : EVAL_LATEST;

  // latest.json 不存在 → 静默跳过
  if (!existsSync(latestPath)) {
    return;
  }

  let latest: EvalLatestJson;
  try {
    latest = JSON.parse(readFileSync(latestPath, 'utf-8')) as EvalLatestJson;
  } catch (err) {
    console.error(`[think] JSON 解析失败: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  // failures 为空 → 跳过（全通过无需反思）
  if (!latest.failures || latest.failures.length === 0) {
    return;
  }

  const now = opts?.now ?? new Date();
  const dataDir = opts?.dataDir ?? getSofagentDataDir();
  const thinkPath = getThinkPath(dataDir);

  // 确保 dataDir 存在
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  for (const failure of latest.failures) {
    const entry = formatEvalFailure(failure, now);

    // 幂等检查
    if (existsSync(thinkPath) && isEvalDuplicateEntry(thinkPath, failure.testId, now)) {
      continue;
    }

    appendThinkEntry(thinkPath, entry);
  }
}

/**
 * 格式化单条 eval 失败用例为 think.md 反思条目
 *
 * 格式：## {timestamp} eval 失败: {testId}
 *       - #期望: {expected 摘要}
 *       - #实际: {actual 摘要}
 *       - #综合得分: {score}%
 *       - #教训: {基于 rules_triggered 生成}
 */
function formatEvalFailure(failure: EvalFailedCase, now: Date): string {
  const timestamp = formatTimestamp(now);
  const score = Math.round(failure.overallScore * 100);

  // 提取 expected / actual 摘要（截取关键信息，避免过长）
  const expectedSummary = summarizeRecord(failure.expected);
  const actualSummary = summarizeRecord(failure.actual);

  // 基于 actual 中的 rules_triggered 生成教训
  const rulesTriggered = (failure.actual['rules_triggered'] as string[]) ?? [];
  const lesson = generateEvalLesson(rulesTriggered, failure.error);

  let entry = `\n## ${timestamp} eval 失败: ${failure.testId}\n`;
  entry += `- #期望: ${expectedSummary}\n`;
  entry += `- #实际: ${actualSummary}\n`;
  entry += `- #综合得分: ${score}%\n`;
  entry += `- #教训: ${lesson}\n`;
  entry += '\n';

  return entry;
}

/**
 * 将 Record 简化为可读摘要（避免 think.md 条目过长）
 */
function summarizeRecord(rec: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(rec)) {
    if (Array.isArray(value)) {
      parts.push(`${key}=[${value.join(',')}]`);
    } else {
      parts.push(`${key}=${String(value)}`);
    }
  }
  return parts.join(', ');
}

/**
 * 基于 eval 失败用例触发的规则生成教训
 */
function generateEvalLesson(rulesTriggered: string[], error?: string): string {
  if (rulesTriggered.length === 0) {
    return error ? `eval 未匹配预期，错误: ${error}` : 'eval 未匹配预期，需检查 golden set 用例定义';
  }

  const lessons: string[] = [];
  for (const ruleId of rulesTriggered) {
    switch (ruleId) {
      case 'A1':
        lessons.push('触碰了敏感文件，应严格避免 .env / *.pem 等文件变更');
        break;
      case 'A2':
        lessons.push('泄漏了密钥，严禁硬编码 API Key / Secret');
        break;
      case 'A3':
        lessons.push('改了任务范围外的文件，应聚焦任务相关文件');
        break;
      case 'A4':
        lessons.push('删除了配置文件，应保护关键配置不被删除');
        break;
      case 'A5':
        lessons.push('commit msg 质量不足，应如实描述变更内容');
        break;
      case 'A6':
        lessons.push('破坏了构建配置，应保护 tsconfig / package.json 不被误删');
        break;
      case 'A7':
        lessons.push('盲改无日志，应先读取文件并记录操作日志');
        break;
      case 'A8':
        lessons.push('逃验证，不应跳过 CI 测试流程');
        break;
      case 'A9':
        lessons.push('代码含 prompt 注入模式，应过滤危险指令');
        break;
      case 'A10':
        lessons.push('引入了非官方依赖源，应使用官方 npm registry');
        break;
      case 'A11':
        lessons.push('滥资源，应避免提交大文件或 node_modules');
        break;
      case 'A14':
        lessons.push('知识库越权访问，应限制在任务相关范围内');
        break;
      case 'A15':
        lessons.push('盲动操作，应先规划再执行');
        break;
      case 'A16':
        lessons.push('非授权文件变更，应避免修改敏感目录如 .github/workflows');
        break;
      case 'A17':
        lessons.push('异常批量变更，应控制单次变更文件数量');
        break;
      case 'A18':
        lessons.push('提交了垃圾文件，应过滤 .DS_Store / *.log 等');
        break;
      case 'A19':
        lessons.push('commit msg 质量低，应提供有意义的描述');
        break;
      case 'E1':
        lessons.push('修改了 src/ 源码但未同步修改测试文件，应补充对应测试');
        break;
      case 'E2':
        lessons.push('裸 TODO 无上下文，应标注负责人和计划');
        break;
      case 'E3':
        lessons.push('大段删除代码，应拆分或保留有价值的实现');
        break;
      case 'E4':
        lessons.push('注释率过低，应为公开函数添加文档注释');
        break;
      default:
        lessons.push(`触发规则 ${ruleId}，需关注`);
        break;
    }
  }

  return lessons.join('；');
}

/**
 * 幂等检查：同一 testId + 同一分钟不重复写入
 */
function isEvalDuplicateEntry(thinkPath: string, testId: string, now: Date): boolean {
  let content: string;
  try {
    content = readFileSync(thinkPath, 'utf-8');
  } catch (err) {
    console.error(`[think] 读取 think.md 失败: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }

  const timestamp = formatTimestamp(now);
  const expectedHeader = `## ${timestamp} eval 失败: ${testId}`;

  return content.includes(expectedHeader);
}

// ============================================================
// v1.2.4 P3 S4：数据变更回溯——从结构化 DataChange 生成 think.md 条目
// ============================================================

/**
 * 从结构化数据变更生成回溯条目（区别于代码变更的 generateThinkEntry）
 *
 * @param changes 数据变更记录数组
 * @param results 数据审计结果
 * @param task 任务描述
 */
export function generateDataThink(
  changes: Array<{ type: string; name: string; action: string }>,
  results: { hasFail: boolean; hasWarn: boolean; failCount: number; warnCount: number; violations: Array<{ rule: string; severity: string; detail: string }> },
  task?: string,
): void {
  if (changes.length === 0) return;

  const now = new Date();
  const date = now.toISOString().split('T')[0] ?? '';
  const dataDir = getSofagentDataDir();
  const thinkPath = getThinkPath(dataDir);

  // 确保 dataDir 存在
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const lines: string[] = [];
  lines.push('');
  lines.push(`--- ${date} · sofagent-audit v${VERSION} · 数据变更回溯 ---`);
  lines.push(`任务: ${task ?? '(未指定)'}`);
  lines.push(`变更: ${changes.length} 项（${changes.map((c) => `${c.action} ${c.type}:${c.name}`).join(', ')}）`);

  if (results.hasFail || results.hasWarn) {
    lines.push(`审计: ${results.failCount} FAIL / ${results.warnCount} WARN`);
    for (const v of results.violations) {
      lines.push(`  - [${v.severity}] ${v.rule}: ${v.detail}`);
    }
    if (results.hasFail) {
      lines.push(`教训: 数据写入被审计拦截，需修正后重试`);
    } else {
      lines.push(`教训: 数据写入有警告，关注关联完整性和格式一致性`);
    }
  } else {
    lines.push(`审计: ✅ 全部数据规则通过`);
  }

  lines.push('');
  appendThinkEntry(thinkPath, lines.join('\n') + '\n');
}
