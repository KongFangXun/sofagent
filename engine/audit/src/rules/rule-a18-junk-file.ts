// ============================================================
// A18 垃圾文件（安全层 · 能力拐杖）
// 检测临时文件名模式的垃圾文件——如 a.txt / test1.js / new-name.txt
// evidenceMode: git-diff
// v1.3.7 新增 · v1.2.0 审查修正（不区分 status，modified 也告警）
// v1.5.2 修复（P0-02 · S51）: 豁免基线由「当前 git 索引（git ls-files）」收窄
// 为「HEAD 提交树（git ls-tree HEAD）」——正规仓库里 a.txt 可能是长期维护的
// 真实文件（如依赖清单片段、约定俗成命名），仅当其已存在于 HEAD 基线时豁免
// WARN；本次新 `git add` 混入、尚未进入 HEAD 的垃圾文件必须告警，避免索引
// 命中吞掉本应告警的场景（正是 S51 漏报根因）。
// ============================================================
import { basename } from 'path';
import { execFileSync } from 'child_process';
import type { AuditContext, RuleScan } from './types';
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
 * - v1.4.8: HEAD 提交树中已存在的文件（见 getTrackedFiles）
 */
function isExempt(filePath: string): boolean {
  // 测试目录豁免
  if (/^(test|tests|__tests__)\//i.test(filePath)) return true;
  // 正规测试文件豁免
  if (/\.(test|spec)\.(ts|js|tsx|jsx)$/i.test(filePath)) return true;
  return false;
}

/**
 * v1.4.8（P0-02）: HEAD 提交树查询——返回 cwd 下 HEAD 基线中的文件集合（Set）。
 * 单次 `git ls-tree -r HEAD` 全量拉取（大仓库也是毫秒级读取，远快于按文件逐个
 * 查询）；非 git 仓库 / HEAD 未诞生（首次提交 unborn）/ git 不可用返回 null——
 * 豁免降级关闭，保持既有告警行为（fail-closed 于垃圾检测而非崩盘）：未进入
 * HEAD 的新混入文件一律告警。
 */
function getTrackedFiles(): Set<string> | null {
  try {
    const out = execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024, // 百万级文件仓库兜底（默认 1MB 会炸）
    });
    return new Set(out.split('\n').filter(Boolean));
  } catch {
    return null;
  }
}

/** 规则判定本体（v1.4.8 条目 7）：只产出 status/details——前置块由 assembleCheck 装配 */
export function scanA18(ctx: AuditContext): RuleScan {
  const hits: string[] = [];

  // v1.4.8（P0-02）: 惰性拉取 HEAD 基线——仅在存在候选垃圾文件时查询一次
  let tracked: Set<string> | null | undefined;
  for (const file of ctx.diffFiles) {
    // 豁免规则：正规测试文件/目录跳过
    if (isExempt(file.path)) continue;

    const name = basename(file.path);
    let matched = false;
    for (const { regex, label } of JUNK_PATTERNS) {
      if (regex.test(name)) {
        // v1.4.8（P0-02）: 命中垃圾模式但已存在于 HEAD 基线（存量文件）→ 豁免。
        // tracked === null（非 git 环境 / 首次提交 HEAD 未诞生）时不豁免，保持旧告警行为。
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
    return {
      status: 'WARN',
      details: [`检测到 ${hits.length} 个疑似垃圾文件：${hits.join('；')}`],
    };
  }

  return { status: 'PASS', details: [] };
}
