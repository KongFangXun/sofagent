// ============================================================
// loop/engineer-execute.ts · engineer execute 层（v1.2.9 · P4）
// ============================================================
//
// 职责：确定性执行 decide 层输出的决策 JSON——
//       文件编辑（edit/create）→ git add → git diff 产出。
//       不调任何 LLM，纯代码层。
//
// 设计约束：
//   - 相同 decide JSON 输入 → 相同文件编辑结果（无副作用验证可测）
//   - dryRun 模式：只计算将发生的变更，不真正写盘/跑 git（测试用）
//   - 文件编辑策略：action='create' 写整文件（diffHint 为全文）；
//     action='edit' 追加 diffHint 到文件尾部（最小可行实现——真正的
//     精确 patch 由 LLM 工具调用路径负责，本层是降级确定性兜底）
// ============================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { execSync } from 'child_process';
import type { EngineerDecide } from './engineer-decide';

// ============================================================
// 类型定义
// ============================================================

/** 单条文件变更的执行结果 */
export interface FileChangeResult {
  /** 目标文件路径（相对 cwd） */
  file: string;
  /** 变更动作 */
  action: 'edit' | 'create';
  /** 执行是否成功 */
  success: boolean;
  /** 结果摘要（人可读） */
  summary: string;
  /** 变更后文件内容（dryRun 模式下为预测内容） */
  resultContent?: string;
}

/** execute 层完整输出 */
export interface EngineerExecuteResult {
  /** 每条变更的执行结果 */
  changes: FileChangeResult[];
  /** git diff 产出（dryRun 时为拼接的伪 diff 摘要） */
  diff: string;
  /** 全部变更是否成功 */
  allSuccess: boolean;
  /** 人可读执行摘要（写入 engineerOutput） */
  summary: string;
}

/** execute 层依赖（测试可注入） */
export interface EngineerExecuteDeps {
  /** 项目根目录（文件 I/O 与 git 命令的 cwd） */
  cwd: string;
  /**
   * dryRun=true：只计算变更，不写盘不跑 git（测试 / 无副作用验证用）
   * dryRun=false：真正写文件 + git add + git diff
   */
  dryRun?: boolean;
  /** git 命令执行器（测试可注入 mock；默认 execSync） */
  gitRunner?: (args: string, cwd: string) => string;
  /** 日志输出 */
  log?: (msg: string) => void;
}

// ============================================================
// 默认 git 执行器
// ============================================================

function defaultGitRunner(args: string, cwd: string): string {
  return execSync(`git ${args}`, { encoding: 'utf-8', cwd, maxBuffer: 16 * 1024 * 1024 });
}

// ============================================================
// execute 主入口
// ============================================================

/**
 * 确定性执行 decide 输出。
 *
 * 流程：
 *   1. 逐条变更：create → 写 diffHint 全文；edit → 追加 diffHint（带分隔注释）
 *   2. dryRun=false 时：git add <files> → git diff --cached 产出
 *   3. 汇总 summary（含 rationale）
 *
 * @param decide decide 层输出（已过 zod 校验）
 * @param deps 执行依赖
 */
export async function engineerExecute(
  decide: EngineerDecide,
  deps: EngineerExecuteDeps,
): Promise<EngineerExecuteResult> {
  const log = deps.log ?? (() => {});
  const dryRun = deps.dryRun ?? false;
  const gitRunner = deps.gitRunner ?? defaultGitRunner;
  const results: FileChangeResult[] = [];
  const touchedFiles: string[] = [];

  for (const change of decide.changes) {
    const absPath = join(deps.cwd, change.file);
    try {
      const resultContent = computeResultContent(absPath, change.action, change.diffHint);
      if (!dryRun) {
        const dir = dirname(absPath);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(absPath, resultContent, 'utf-8');
      }
      results.push({
        file: change.file,
        action: change.action,
        success: true,
        summary: `${change.action === 'create' ? '新建' : '编辑'} ${change.file}（${change.description.slice(0, 60)}）`,
        resultContent,
      });
      touchedFiles.push(change.file);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`[execute] ${change.file} 变更失败：${msg}`);
      results.push({
        file: change.file,
        action: change.action,
        success: false,
        summary: `变更失败 ${change.file}：${msg.slice(0, 80)}`,
      });
    }
  }

  // git add + diff（dryRun 跳过真实 git，产出伪 diff 摘要）
  const diff = produceDiff(touchedFiles, deps.cwd, dryRun, gitRunner, results);
  const allSuccess = results.every((r) => r.success);
  const summary = [
    `[execute] ${results.filter((r) => r.success).length}/${results.length} 条变更已应用`,
    `rationale: ${decide.rationale.slice(0, 200)}`,
    ...results.map((r) => `- ${r.summary}`),
  ].join('\n');

  return { changes: results, diff, allSuccess, summary };
}

// ============================================================
// 内部：内容计算与 diff 产出
// ============================================================

/**
 * 计算变更后的文件内容（纯函数——dryRun 与真实写盘共用同一逻辑，
 * 保证「相同输入 → 相同输出」的确定性）。
 *
 * create：diffHint 即全文。
 * edit：若文件已存在，在尾部追加 diffHint（带 sofagent 分隔注释）；
 *       不存在则等价 create。
 */
export function computeResultContent(absPath: string, action: 'edit' | 'create', diffHint: string): string {
  if (action === 'create') return diffHint;
  // edit
  if (existsSync(absPath)) {
    const prev = readFileSync(absPath, 'utf-8');
    const separator = '\n// ── sofagent execute 变更 ──\n';
    return prev.endsWith('\n') ? `${prev}${separator}${diffHint}\n` : `${prev}\n${separator}${diffHint}\n`;
  }
  return diffHint;
}

/**
 * 产出 diff：
 *   dryRun=true → 拼接伪 diff（文件清单 + 字数统计），不跑 git
 *   dryRun=false → git add → git diff --cached
 * git 不可用时降级返回文件清单摘要（不 throw）。
 */
function produceDiff(
  files: string[],
  cwd: string,
  dryRun: boolean,
  gitRunner: (args: string, cwd: string) => string,
  results: FileChangeResult[],
): string {
  if (dryRun) {
    return results
      .map((r) => `[dryRun] ${r.action} ${r.file} → ${r.resultContent?.length ?? 0} chars`)
      .join('\n');
  }
  if (files.length === 0) return '';
  try {
    gitRunner(`add -- ${files.map((f) => `"${f}"`).join(' ')}`, cwd);
    return gitRunner('diff --cached', cwd);
  } catch {
    // git 不可用（非 git 仓库等）→ 降级摘要，不阻断流程
    return `[git 不可用] 已变更文件：${files.join(', ')}`;
  }
}
