// ============================================================
// native-gate.ts · 自研技能进化 gate 验证器（v1.5.2 ⑩）
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
import { join, dirname, resolve } from 'path';

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
  /**
   * 待验证技能文件路径（**staging 副本**——adopt 时替换正式位）。
   *
   * 🔴 **必须与 `targetDir` 不同路径**（v1.4.9 G-17）。若调用方把同一路径同时传进
   * `candidateDir` 与 `targetDir`，adopt 分支的「删目标 → 拷候选」就会变成**自指删除**：
   * 先删掉 live 文件（它同时就是 candidate），再拿已删的源拷贝 ⇒ ENOENT + **live 永久丢失**。
   * 本文件已改用无损替换（`replaceAtomically`）兜住该情形，但调用方仍应保持两路径分离。
   */
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
    replaceAtomically(opts.candidateDir, opts.targetDir);
    bump(historyPath, { ...history, bestScore: score, updatedAt: new Date().toISOString() }, 'adopted');
    return { action: 'adopt', score, bestScore: history.bestScore, basis: `分数 ${score} > 历史最优 ${history.bestScore}——采纳` };
  }
  // revert：不优于历史 → 回滚正式位
  revertFrom(backupDir, opts.targetDir);
  bump(historyPath, history, 'reverted');
  return { action: 'revert', score, bestScore: history.bestScore, basis: `分数 ${score} ≤ 历史最优 ${history.bestScore}——回滚` };
}

/**
 * **无损替换**：把 `src` 的内容送到 `dst`（v1.4.9 G-17）。
 *
 * 🔴 为什么不能用 `rmSync(dst)` + `copyFileSync(src, dst)`：当 `src === dst`（调用方把
 * 同一路径同时传成 candidate 与 target）时，删目标就是**删源**——随后的拷贝必然 ENOENT，
 * 而 live 文件已经没了。实测复现（v1.4.8 实态）：调用后目录里只剩 `SKILL.md.gate-bak`，
 * `SKILL.md` 消失，错误 `ENOENT: copyfile 'SKILL.md' -> 'SKILL.md'`。
 *
 * 两条不变式：
 *   ① **同路径 ⇒ no-op**（文件已在正式位，无需搬运，绝不删）；
 *   ② 异路径 ⇒ 先写同目录临时文件，再 `renameSync` 覆盖 —— 同一文件系统内 rename 是
 *      原子替换，不存在「目标已删、新内容未到」的窗口（旧实现在该窗口里崩溃即数据丢失）。
 *
 * @param src 源文件（候选）
 * @param dst 目标文件（正式位）
 */
function replaceAtomically(src: string, dst: string): void {
  if (resolve(src) === resolve(dst)) return; // 不变式①：就地演化，文件已在正式位
  const tmp = `${dst}.gate-tmp-${process.pid}`;
  try {
    copyFileSync(src, tmp); // 先把新内容安全落到目标同目录（同文件系统，rename 才可原子）
    try {
      renameSync(tmp, dst); // 不变式②：原子替换
    } catch {
      // 少数平台 rename 不覆盖已存在目标 —— 此时新内容已安全落在 tmp，退回「删旧 → 改名」
      if (existsSync(dst)) rmSync(dst, { force: true });
      renameSync(tmp, dst);
    }
  } catch (err) {
    if (existsSync(tmp)) rmSync(tmp, { force: true }); // 不留半成品临时文件
    throw err;
  }
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
