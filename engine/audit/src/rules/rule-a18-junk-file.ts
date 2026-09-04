// ============================================================
// A18 垃圾文件（安全层 · 能力拐杖）
// 检测临时文件名模式的垃圾文件——如 a.txt / test1.js / new-name.txt
// evidenceMode: git-diff
// v1.3.7 新增 · v1.2.0 审查修正（不区分 status，modified 也告警）
// v1.4.5 T9: git ls-files 命中豁免——正规仓库里 a.txt 可能是长期维护的
// 真实文件（如依赖清单片段、约定俗成命名）；已在 git 索引中（此前已提交
// 过）的文件名豁免 WARN，只对「本次新混入」的垃圾文件告警。
// ============================================================

import { basename } from 'path';
import { execFileSync } from 'child_process';
import type { AuditContext, RuleCheck } from './types';
/**
 * 垃圾文件名模式（basename 级匹配）：
 * - 单字母文件名：a.txt / b.md / c.js
 * - 临时测试文件前缀：test/tmp/temp/foo/bar/aaa + 可选数字
 * - 可疑命名：new-name / old-name 前缀
 */
const JUNK_PATTERNS: { regex: RegExp; label: string }[] = [
  { regex: /^[a-z]\.(txt|md|js|ts)$/i, label: '单字母文件名' },
  { regex: /^(test|tmp|temp|foo|bar|aaa)[0-9]*\./i, label: '临时测试文件' },
  { regex: /^(new|old)-name\./i, label: '可疑命名(new/old-name)' },
];

/**
 * 豁免规则——以下路径/文件名跳过检测：
 * - 正规测试目录：test/、tests/、__tests__/ 开头
 * - 正规测试文件：*.test.ts、*.spec.ts、*.test.js 结尾
 * - v1.4.5 T9: git ls-files 已跟踪文件（见 isGitTracked）
 */
function isExempt(filePath: string): boolean {
  // 测试目录豁免
  if (/^(test|tests|__tests__)\//i.test(filePath)) return true;
  // 正规测试文件豁免
  if (/\.(test|spec)\.(ts|js|tsx|jsx)$/i.test(filePath)) return true;
  return false;
}

/**
 * v1.4.5 T9: git 索引查询——返回 cwd 下 git 已跟踪文件集合（Set）。
 * 单次 `git ls-files` 全量拉取（大仓库也是毫秒级索引读取，远快于按文件
 * 逐个 ls-files --error-unmatch）；非 git 仓库 / git 不可用返回 null
 * （豁免降级关闭，不影响既有告警行为——fail-closed 于垃圾检测而非崩盘）。
 */
function getTrackedFiles(): Set<string> | null {
  try {
    const out = execFileSync('git', ['ls-files'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024, // 百万级文件仓库兜底（默认 1MB 会炸）
    });
    return new Set(out.split('\n').filter(Boolean));
  } catch {
    return null;
  }
}

export function checkRuleA18(ctx: AuditContext): RuleCheck {
  const rule: RuleCheck = {
    name: 'A18 垃圾文件',
    number: 18,
    status: 'PASS',
    details: [],
    evidenceMode: 'git-diff',
    ruleClass: '能力拐杖',
  };

  const hits: string[] = [];

  // v1.4.5 T9: 惰性拉取 git 索引——仅在存在候选垃圾文件时查询一次
  let tracked: Set<string> | null | undefined;
  for (const file of ctx.diffFiles) {
    // 豁免规则：正规测试文件/目录跳过
    if (isExempt(file.path)) continue;

    const name = basename(file.path);
    let matched = false;
    for (const { regex, label } of JUNK_PATTERNS) {
      if (regex.test(name)) {
        // v1.4.5 T9: 命中垃圾模式但 git 已跟踪（此前已提交过的存量文件）→ 豁免。
        // tracked === null（非 git 环境）时不豁免，保持旧告警行为。
        if (tracked === undefined) tracked = getTrackedFiles();
        if (tracked !== null && tracked.has(file.path)) break;
        hits.push(`${file.path}（命中模式：${label}）`);
        matched = true;
        break; // 同一文件只记录一次
      }
    }
    if (matched) continue;
  }

  if (hits.length > 0) {
    rule.status = 'WARN';
    rule.details.push(`检测到 ${hits.length} 个疑似垃圾文件：${hits.join('；')}`);
  }

  return rule;
}
