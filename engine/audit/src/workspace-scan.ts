// ============================================================
// workspace-scan.ts · 工作区垃圾残留扫描
// v1.3.6 新增 · 2026-08-16 根目录测试残留事件防再犯（收编：原 v1.3.6 预研随 839a6e6 入库，按「新文件版本头必须匹配 SSOT」纪律归位 v1.3.6）
//
// 背景：A18 只审 git diff——文件不被 commit 就永远不进审计视野；
// 昨晚并行会话在主仓做审计规则/npm 实验，残留 t/、npm-p4-test/、
// b.ts、.env 等 7 项垃圾，无任何门禁发现。
//
// 本模块在每次 sofagent-audit 运行时顺带扫描全仓：
// - 已跟踪文件（git ls-files）中的垃圾命名
// - untracked 文件（git ls-files --others --exclude-standard）中的垃圾命名
// - 嵌套独立 .git 目录（git 灾难根源之一：误把主仓当 /tmp 实验场）
// 结果以 WARN 输出（不阻断），提醒人工清理。
//
// 判定逻辑复用 A18 的 JUNK_PATTERNS（单字母/临时测试前缀/可疑命名）。
// ============================================================

import { execFileSync } from 'child_process';
import { basename, join } from 'path';
import { existsSync, statSync } from 'fs';

/** A18 垃圾命名模式（与 rule-a18-junk-file.ts 保持同步） */
const JUNK_PATTERNS: { regex: RegExp; label: string }[] = [
  { regex: /^[a-z]\.(txt|md|js|ts)$/i, label: '单字母文件名' },
  { regex: /^(test|tmp|temp|foo|bar|aaa)[0-9]*\./i, label: '临时测试文件' },
  { regex: /^(new|old)-name\./i, label: '可疑命名(new/old-name)' },
];

/** 目录级垃圾命名（本事件新增：实验目录整目录判定） */
const JUNK_DIR_PATTERNS: { regex: RegExp; label: string }[] = [
  { regex: /^(npm|npx|pnpm|yarn)-[a-z0-9-]*test[a-z0-9-]*$/i, label: '包管理器实验目录' },
  { regex: /^[a-z]-?(npm|npx)-test$/i, label: '包管理器实验目录' },
  { regex: /^(t|tmp|temp)[0-9]*$/i, label: '临时目录' },
];

/** 豁免：与 A18 一致 + 运行时产物目录 */
function isExempt(filePath: string): boolean {
  if (/^(test|tests|__tests__)\//i.test(filePath)) return true;
  if (/\.(test|spec)\.(ts|js|tsx|jsx)$/i.test(filePath)) return true;
  if (/^(\.git|node_modules|\.sofagent|\.workbuddy|dist|coverage)\//i.test(filePath)) return true;
  return false;
}

function matchJunk(name: string): string | null {
  for (const { regex, label } of JUNK_PATTERNS) {
    if (regex.test(name)) return label;
  }
  return null;
}

function matchJunkDir(name: string): string | null {
  for (const { regex, label } of JUNK_DIR_PATTERNS) {
    if (regex.test(name)) return label;
  }
  return null;
}

export interface WorkspaceScanIssue {
  /** 相对仓库根的路径 */
  path: string;
  /** 命中的模式标签 */
  reason: string;
  /** 来源：tracked（已被 git 跟踪）/ untracked（躺在工作区） */
  source: 'tracked' | 'untracked';
}

export interface WorkspaceScanResult {
  /** 发现的垃圾残留列表（空数组 = 干净） */
  issues: WorkspaceScanIssue[];
  /** 扫描是否成功执行（git 不可用等场景返回 false，静默跳过） */
  executed: boolean;
}

/** 安全执行 git 命令（失败返回 null，不抛错——扫描是附带能力，不能影响主审计） */
function gitLines(args: string[]): string[] | null {
  try {
    const out = execFileSync('git', args, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 });
    return out.split('\n').filter((l) => l.trim().length > 0);
  } catch {
    return null;
  }
}

/**
 * 工作区垃圾残留扫描（v1.3.5）
 *
 * 扫描范围：
 * 1. git ls-files（已跟踪文件）
 * 2. git ls-files --others --exclude-standard（untracked 且未被 .gitignore 排除的）
 * 3. 根目录一级子目录中含独立 .git 的（嵌套仓库 = 实验场信号）
 *
 * 输出 WARN 不阻断——清理决策留给人。
 */
export function scanWorkspace(cwd?: string): WorkspaceScanResult {
  const dir = cwd ?? process.cwd();
  const issues: WorkspaceScanIssue[] = [];

  // ---- 1. 已跟踪 + untracked 文件的垃圾命名 ----
  const tracked = gitLines(['-C', dir, 'ls-files']);
  const untracked = gitLines(['-C', dir, 'ls-files', '--others', '--exclude-standard']);

  if (tracked === null && untracked === null) {
    // git 不可用（非 git 目录等）——静默跳过，不影响主审计
    return { issues, executed: false };
  }

  const scan = (files: string[] | null, source: 'tracked' | 'untracked') => {
    if (!files) return;
    for (const f of files) {
      if (isExempt(f)) continue;
      const name = basename(f);
      const hit = matchJunk(name) ?? matchJunkDir(name);
      if (hit) {
        issues.push({ path: f, reason: hit, source });
        // 上限保护：超过 50 条只报前 50（垃圾海场景不刷屏）
        if (issues.length >= 50) return;
      }
    }
  };

  scan(tracked, 'tracked');
  scan(untracked, 'untracked');

  // ---- 2. 根目录一级子目录的嵌套 .git 检测（git 灾难根源之一）----
  try {
    const rootEntries = execFileSync('ls', ['-1', dir], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf-8' })
      .split('\n')
      .filter((l) => l.trim().length > 0);
    for (const entry of rootEntries) {
      if (entry.startsWith('.') || isExempt(entry)) continue;
      const full = join(dir, entry);
      try {
        const st = statSync(full);
        if (st.isDirectory() && existsSync(join(full, '.git'))) {
          // 嵌套仓库：node_modules 内的 .git 不算（被豁免前缀覆盖）
          issues.push({ path: entry, reason: '嵌套独立 .git（实验场信号）', source: 'untracked' });
        }
      } catch {
        // 单项 stat 失败跳过
      }
    }
  } catch {
    // ls 失败（权限等）跳过嵌套检测
  }

  return { issues, executed: true };
}

/** 格式化扫描结果为输出行（CLI 集成用） */
export function formatWorkspaceScan(result: WorkspaceScanResult): string[] {
  if (!result.executed || result.issues.length === 0) return [];
  const lines: string[] = [];
  lines.push(`⚠️ [sofagent] A18+ 工作区垃圾残留扫描：发现 ${result.issues.length} 项`);
  for (const i of result.issues.slice(0, 10)) {
    const src = i.source === 'tracked' ? '已被 git 跟踪' : 'untracked';
    lines.push(`    · ${i.path}（${i.reason} · ${src}）`);
  }
  if (result.issues.length > 10) {
    lines.push(`    · ...另有 ${result.issues.length - 10} 项未列出`);
  }
  lines.push('    提示：测试实验请在 /tmp 进行；垃圾残留请清理（rm + git rm --cached）');
  return lines;
}
