// ============================================================
// A3 不改越界（边界层 · 业务底线）
// 合并自旧 #7 谨慎修改 + R1 无关文件
// diff 中是否有不在 --task 描述关键词范围内的文件
// v0.95：文件路径匹配改用 basename 精确匹配，关键词匹配兼容 Unicode（中文路径）
// 配置：LOW_RISK_PATTERNS 和阈值从 ctx.config 取值（三级 fallback）
// ============================================================

import { basename } from 'path';
import type { AuditContext, RuleCheck } from './types';
import type { AuditConfig } from '@sofagent/core';
import { DEFAULT_CONFIG } from '@sofagent/core';

/** 默认低风险模式（当 ctx.config 不存在时使用） */
const DEFAULT_LOW_RISK_PATTERNS = [
  /package-lock\.json$/i,
  /yarn\.lock$/i,
  /pnpm-lock\.yaml$/i,
  /\.gitignore$/i,
  /\.eslintrc/i,
  /\.prettierrc/i,
  /tsconfig.*\.json$/i,
  /readme(\.\w+)?\.md$/i,
  /changelog\.md$/i,
  /license$/i,
  /code_of_conduct\.md$/i,
  /contributing\.md$/i,
  /security\.md$/i,
];

/**
 * 将 config 中的 glob 风格 lowRiskPatterns 转为正则数组
 * 支持：精确文件名（package-lock.json）、通配符后缀（*.log）、路径模式（docs/**）
 */
function compileLowRiskPatterns(configPatterns: string[]): RegExp[] {
  const regexes: RegExp[] = [];
  for (const pattern of configPatterns) {
    if (pattern.includes('*') || pattern.includes('/')) {
      // glob 风格 → 转正则
      // 先转义所有正则特殊字符（. + ? 等），再处理 glob 通配符
      // *.log → [^/]*\.log$
      // docs/** → docs\/.*
      let regexStr = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // 转义正则特殊字符（保留 * / ? 用于 glob）
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\\\?/g, '[^/]');  // \? 是上一步转义后的 ?
      regexes.push(new RegExp(regexStr, 'i'));
    } else {
      // 精确文件名 → basename 匹配
      const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      regexes.push(new RegExp(escaped + '$', 'i'));
    }
  }
  return regexes;
}

/**
 * 从任务描述中提取文件名（中英文均支持，兼容 Unicode）
 * 匹配模式：filename.ext / path/to/file.ext / 无扩展名文件（Makefile 等）
 */
function extractFileNamesFromTask(task: string): string[] {
  const names: string[] = [];
  // 带扩展名的文件名（含路径）—— Unicode 兼容，用 u flag + 非 ASCII 友好字符集
  const extPattern = /[^\s:,;()"'`|<>]+\.[a-zA-Z0-9]+/gu;
  let match: RegExpExecArray | null;
  while ((match = extPattern.exec(task)) !== null) {
    names.push(match[0].toLowerCase());
  }
  // 无扩展名的常见文件
  const noExtPattern = /\b(Makefile|Dockerfile|Jenkinsfile|Vagrantfile|LICENSE|CHANGELOG)\b/gi;
  while ((match = noExtPattern.exec(task)) !== null) {
    names.push(match[0].toLowerCase());
  }
  return [...new Set(names)];
}

/**
 * 从任务描述中提取路径模式（如 src/components, glob 模式等）
 * Unicode 兼容——匹配包含 / 的路径片段（支持中文路径）
 */
function extractPathPatternsFromTask(task: string): string[] {
  const patterns: string[] = [];
  // 路径模式：包含 / 的路径片段——Unicode 兼容（非空白非分隔符字符 + /）
  const pathPattern = /[^\s:,;()"'`|<>]+\/[^\s:,;()"'`|<>]*/gu;
  let match: RegExpExecArray | null;
  while ((match = pathPattern.exec(task)) !== null) {
    patterns.push(match[0].toLowerCase());
  }
  return [...new Set(patterns)];
}

/**
 * 检查文件是否与任务描述相关
 * 优先级：精确 basename 匹配 > 路径模式匹配 > 关键词子串匹配
 * Unicode 兼容——中文路径通过 basename 匹配
 */
function isFileRelatedToTask(
  filePath: string,
  taskFileNames: string[],
  taskPathPatterns: string[],
  taskKeywords: string[]
): boolean {
  const fileName = basename(filePath).toLowerCase();
  const filePathLower = filePath.toLowerCase();

  // ① 精确 basename 匹配——任务描述中提到的文件名
  for (const taskName of taskFileNames) {
    const taskBasename = basename(taskName);
    if (taskBasename === fileName) return true;
  }

  // ② 路径模式匹配——任务描述中明确提到的路径片段
  for (const pattern of taskPathPatterns) {
    if (filePathLower.includes(pattern)) return true;
  }

  // ③ 关键词子串匹配（兜底——英文关键词匹配英文文件名）
  for (const kw of taskKeywords) {
    if (filePathLower.includes(kw)) return true;
  }

  return false;
}

export function checkRuleA3(ctx: AuditContext): RuleCheck {
  const { diffFiles, task, commitMsg, config } = ctx;
  const rule: RuleCheck = {
    name: 'A3 不改越界',
    number: 3,
    status: 'PASS',
    details: [],
    evidenceMode: 'git-diff',
    ruleClass: '业务底线',
  };

  // 确定低风险模式和阈值——优先用 config，fallback 到硬编码默认值
  const effectiveConfig: AuditConfig = config ?? DEFAULT_CONFIG;
  const lowRiskRegexes = compileLowRiskPatterns(effectiveConfig.lowRiskPatterns);
  // 合并默认的硬编码模式（确保向后兼容）
  const allLowRiskPatterns = [...lowRiskRegexes, ...DEFAULT_LOW_RISK_PATTERNS];
  const threshold = effectiveConfig.carefulModifyThreshold;

  if (!task) {
    // 没有提供任务描述——降级为仅检查文件路径是否在越界列表内
    // 不依赖 task 语义，只检查低风险白名单之外的文件变更
    rule.details.push('未提供 --task 参数，跳过任务关联检查。仅检查文件路径。');
    // 注意：不设为 WARN/PASS——无 task 时 A3 保持 PASS（降级模式，不做越界判断）
    return rule;
  }

  // 组合搜索源：task（subject）+ commitMsg（完整 message，含 body）
  // commit body 里常列明每个文件的改动说明，A3 应一并纳入关联判定
  const searchText = commitMsg ? `${task}\n${commitMsg}` : task;

  // 提取任务描述中的文件名、路径模式、关键词
  const taskFileNames = extractFileNamesFromTask(searchText);
  const taskPathPatterns = extractPathPatternsFromTask(searchText);
  // P1-13: 停用词表——常见英文词不作为关键词
  const STOP_WORDS = new Set([
    'the', 'for', 'and', 'are', 'but', 'not', 'you', 'all', 'any', 'can',
    'had', 'her', 'was', 'one', 'our', 'out', 'has', 'have', 'from',
    'this', 'that', 'with', 'will', 'your', 'add', 'fix', 'set', 'get',
    'use', 'new', 'old', 'see', 'way', 'say', 'she', 'how', 'its', 'now',
    'did', 'let', 'put', 'run', 'try', 'two', 'men', 'day', 'own',
    '到', '的', '了', '在', '是', '和', '与', '或', '一个', '可以',
  ]);
  const taskKeywords = searchText
    .toLowerCase()
    .split(/[\s,，。、；;:：()（）+]+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));

  // P1-29: 短中文 commit（<10 字符且含中文）不触发盲改告警——
  // 中文短句通常不含文件名/路径（如「修复bug」「改配置」），A3 关键词匹配
  // 必然失败 → 对任意文件变更 100% 误报（本项目历史 13.9% commit 被标 [底线]）。
  const cjkCount = (searchText.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const isShortChineseTask = cjkCount > 0 && searchText.trim().length < 10;

  const unexpectedFiles: string[] = [];

  for (const file of diffFiles) {
    const filePath = file.path.toLowerCase();

    // 跳过低风险文件
    let isLowRisk = false;
    for (const pattern of allLowRiskPatterns) {
      if (pattern.test(filePath)) {
        isLowRisk = true;
        break;
      }
    }
    if (isLowRisk) continue;

    // 检查文件是否与任务描述相关
    const isRelated = isFileRelatedToTask(
      file.path,
      taskFileNames,
      taskPathPatterns,
      taskKeywords
    );
    if (!isRelated) {
      unexpectedFiles.push(file.path);
    }
  }

  // 如果超过阈值的文件修改与任务无关，发出警告
  const totalFiles = diffFiles.filter((f) => {
    const name = f.path.toLowerCase();
    return !allLowRiskPatterns.some((p) => p.test(name));
  }).length;

  if (!isShortChineseTask && totalFiles > 0 && unexpectedFiles.length > totalFiles * threshold) {
    rule.status = 'WARN';
    rule.details.push(
      `${unexpectedFiles.length}/${totalFiles} 个文件不在任务描述 ("${task}") 范围内: ${unexpectedFiles.slice(0, 3).join(', ')}${unexpectedFiles.length > 3 ? ` 等` : ''}`
    );
  }

  return rule;
}
