// ============================================================
// native-gate.ts · 自研技能进化 gate 验证器（v1.4.8 ⑩）
// ============================================================
// 替代 skillopt-sleep 外部 CLI（pip 依赖摘除——部署确定性）：
//   跑 eval 验证集 → 出分数 → 与历史最优比对 → 接受/回滚。
//
// 依赖面拍板（devlog ⑩ 两条合法路径取 ②）：gate 自含最小验证执行器，
// 零新依赖（不 import @sofagent/eval——evolve 构建……eval 之后本可依赖，
// 但最小执行器 = 纯函数 + 注入式命令跑器，保持 gate 可独立单测）。
// ============================================================

import { execFileSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, renameSync, copyFileSync, rmSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

/** 历史最优记录（JSON——score 单调可比即可） */
export interface GateHistory {
  bestScore: number;
  updatedAt: string;
  /** 采纳次数（观测面） */
  adopted: number;
  /** 回滚次数 */
  reverted: number;
}

/** gate 判定结果 */
export interface GateVerdict {
  action: 'adopt' | 'revert';
  /** 本次分数 */
  score: number;
  /** 历史最优 */
  bestScore: number;
  /** 判定依据 */
  basis: string;
}

export interface NativeGateOptions {
  /** 工作目录（技能目录父级——历史与备份落此） */
  workDir: string;
  /** 待验证技能目录（staging 副本——adopt 时替换正式位） */
  candidateDir: string;
  /** 正式技能目录 */
  targetDir: string;
  /** 验证命令（跑 eval 验证集——如 node run-evals.js --json；stdout 须含可解析分数） */
  verifyCommand: string;
  /** 分数解析（stdout → 数值分数；缺省取 stdout 最后一个浮点数） */
  parseScore?: (stdout: string) => number;
  /** 历史文件路径（缺省 workDir/.gate-history.json） */
  historyPath?: string;
}

const DEFAULT_PARSE = (stdout: string): number => {
  const nums = stdout.match(/\d+(\.\d+)?/g);
  if (!nums || nums.length === 0) throw new Error('验证输出无可解析分数');
  return parseFloat(nums[nums.length - 1]!);
};

function loadHistory(path: string): GateHistory {
  if (!existsSync(path)) return { bestScore: Number.NEGATIVE_INFINITY, updatedAt: '', adopted: 0, reverted: 0 };
  return JSON.parse(readFileSync(path, 'utf-8')) as GateHistory;
}

/**
 * 自研 gate 验证器主入口。
 * 流程：跑验证命令（cwd=candidateDir）→ 解析分数 → 比对历史最优 →
 *       adopt（candidate 就位 target + 更新历史）/ revert（恢复备份）。
 * fail-closed：验证命令失败 = 分数不可信 → revert（不接受未验证技能）。
 */
export function runNativeGate(opts: NativeGateOptions): GateVerdict {
  const historyPath = opts.historyPath ?? join(opts.workDir, '.gate-history.json');
  const history = loadHistory(historyPath);
  const parse = opts.parseScore ?? DEFAULT_PARSE;

  // 备份正式位（revert 路径依赖）
  const backupDir = `${opts.targetDir}.gate-bak`;
  if (existsSync(opts.targetDir)) {
    rmSync(backupDir, { recursive: true, force: true });
    copyFileSync(opts.targetDir, backupDir); // target 是文件（SKILL.md 形态技能）
  }

  let score: number;
  try {
    // cwd 须目录——candidate/target 是文件路径（SKILL.md 形态），验证命令在候选所在目录执行
    const stdout = execFileSync('bash', ['-c', opts.verifyCommand], {
      cwd: dirname(opts.candidateDir),
      encoding: 'utf-8',
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    score = parse(stdout);
  } catch (err) {
    // 验证失败 = revert（不 adopt 未验证技能）
    revertFrom(backupDir, opts.targetDir);
    bump(historyPath, history, 'reverted');
    return {
      action: 'revert',
      score: Number.NaN,
      bestScore: history.bestScore,
      basis: `验证命令失败: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}——fail-closed 回滚`,
    };
  }

  if (score > history.bestScore) {
    // adopt：candidate 就位 + 历史更新
    if (existsSync(opts.targetDir)) rmSync(opts.targetDir, { force: true });
    copyFileSync(opts.candidateDir, opts.targetDir);
    bump(historyPath, { ...history, bestScore: score, updatedAt: new Date().toISOString() }, 'adopted');
    return { action: 'adopt', score, bestScore: history.bestScore, basis: `分数 ${score} > 历史最优 ${history.bestScore}——采纳` };
  }
  // revert：不优于历史 → 回滚正式位
  revertFrom(backupDir, opts.targetDir);
  bump(historyPath, history, 'reverted');
  return { action: 'revert', score, bestScore: history.bestScore, basis: `分数 ${score} ≤ 历史最优 ${history.bestScore}——回滚` };
}

function revertFrom(backupDir: string, targetDir: string): void {
  if (existsSync(backupDir)) {
    if (existsSync(targetDir)) rmSync(targetDir, { force: true });
    renameSync(backupDir, targetDir);
  }
}

function bump(path: string, history: GateHistory, kind: 'adopted' | 'reverted'): void {
  const next: GateHistory = {
    ...history,
    adopted: history.adopted + (kind === 'adopted' ? 1 : 0),
    reverted: history.reverted + (kind === 'reverted' ? 1 : 0),
  };
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2) + '\n');
}
