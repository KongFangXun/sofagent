// ============================================================
// concurrent-git-discipline.ts · 多 Agent 并发 Git 纪律守卫（v1.5.1 扩展三）
// ============================================================
// 共享目录下的行为纪律（与 v1.3.6 worktree 物理隔离互补）：
//   ① 开工前 status/log 核对不抢改
//   ② 提交用精确 pathspec（禁 add -A）
//   ③ 暂存区隔离（他人已暂存文件不连带提交）
// ============================================================

import { execFileSync } from 'child_process';

/** 纪律校验结果 */
export interface DisciplineVerdict {
  ok: boolean;
  /** 违纪项（人读——附修法） */
  violations: string[];
}

/**
 * pathspec 纪律校验——提交命令必须用精确 pathspec。
 * 禁用形态：`git add -A` / `git add .` / `git commit -a`（隐式全量暂存）。
 */
export function checkPathspecDiscipline(command: string): DisciplineVerdict {
  const violations: string[] = [];
  if (/\bgit\s+add\s+(-A|--all|\.)(\s|$)/.test(command)) {
    violations.push('禁用 `git add -A/--all/.`——并发场景会连带他人暂存文件；改用精确 pathspec（git add <文件...>）');
  }
  if (/\bgit\s+commit\s+[^|;]*(-a|--all)\b/.test(command)) {
    violations.push('禁用 `git commit -a`——隐式暂存全部已跟踪文件改动；先精确 add 再 commit');
  }
  return { ok: violations.length === 0, violations };
}

/**
 * 暂存区隔离检测——他人（非本 agent）已暂存的文件不连带提交。
 * @param stagedFiles 当前暂存区文件清单（git diff --cached --name-only 输出）
 * @param myFiles 本 agent 声明改动的文件清单
 * @returns 他人暂存文件 = 暂存区 - 我的文件（非空即违纪风险）
 */
export function detectForeignStaged(stagedFiles: string[], myFiles: string[]): { foreign: string[]; ok: boolean } {
  const mine = new Set(myFiles);
  const foreign = stagedFiles.filter((f) => !mine.has(f));
  return { foreign, ok: foreign.length === 0 };
}

/**
 * 开工前核对——status/log 快照（不抢改纪律的取证面）。
 * 返回当前 HEAD 与脏文件清单（调用方留存，提交前对照——期间 HEAD 变化即有并发写入）。
 */
export function snapshotForTurn(cwd: string): { head: string; dirtyFiles: string[] } {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8', cwd }).trim();
  const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf-8', cwd });
  const dirtyFiles = status.split('\n').filter(Boolean).map((l) => l.slice(3).trim());
  return { head, dirtyFiles };
}

/**
 * 提交前核对——开工快照与当前态对照（HEAD 漂移 = 并发写入，须人工分诊）。
 */
export function verifyNoConcurrentWrite(before: { head: string }, cwd: string): DisciplineVerdict {
  const now = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8', cwd }).trim();
  if (now !== before.head) {
    return {
      ok: false,
      violations: [`HEAD 已从 ${before.head.slice(0, 8)} 漂移到 ${now.slice(0, 8)}——期间有并发提交，重新核对 status/log 后再提交（不抢改纪律）`],
    };
  }
  return { ok: true, violations: [] };
}
