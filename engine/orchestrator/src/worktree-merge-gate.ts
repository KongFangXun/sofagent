// ============================================================
// worktree-merge-gate.ts · 审计合并卡关（v1.3.2 · 交付一）
//
// 流程：
//   worktree.diff() → audit diff（复用 @sofagent/audit 现有规则，不新写）
//     → PASS/WARN → git merge --no-ff 合并回主分支（保留分支历史，
//                    merge commit 可追溯到是哪个 SubAgent 做的）
//     → FAIL      → 丢弃 worktree + 记录拒绝原因 + 通知编排引擎重试
//
// git merge 文本冲突（不是 audit FAIL，是 git merge 冲突）由
// conflict-resolver.ts 仲裁：
//   incoming 赢 → merge --no-ff -X theirs 完成合并
//   incumbent 赢 → merge --abort + 丢弃 worktree + 通知重试
//   scope 重叠 → merge --abort + 记录 pending-hitl + 通知人工确认
//
// 约束：
// - 审计入口与 loop audit 节点一致（parseDiff + runRules 程序化调用）
// - 合并策略固定 --no-ff（保留分支历史，可追溯 SubAgent 来源）
// - git 调用一律走 execFile（无 shell，无注入面）
// ============================================================

import { execFile } from 'child_process';
import { resolve } from 'path';
import { promisify } from 'util';
import {
  appendWorktreeRegistry,
  resolveRegistryPath,
  type WorktreeHandle,
} from './worktree-isolation';
import {
  appendConflictRecord,
  resolveConflictsPath,
  resolveWorktreeConflict,
  type ConflictParty,
  type ConflictRecord,
} from './conflict-resolver';

const execFileAsync = promisify(execFile);

/** 执行 git 命令（execFile，无 shell 注入面），返回 stdout */
async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf-8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

// ────────────────────────────────
// 类型
// ────────────────────────────────

/** 卡关结果状态 */
export type MergeGateStatus =
  | 'merged'            // 审计通过 + 合并成功
  | 'rejected'          // 审计 FAIL——丢弃 worktree，通知重试
  | 'noop'              // 分支无新提交——无事可做（worktree 保留）
  | 'conflict-resolved' // 文本冲突已自动仲裁（详见 conflict.resolution）
  | 'conflict-hitl'     // 文本冲突升级人工确认（worktree 保留待人工处理）
  | 'error';            // 卡关自身错误（git/audit 不可用等）

/** 卡关结果 */
export interface MergeGateResult {
  status: MergeGateStatus;
  /** merge commit SHA（merged / incoming 赢的 conflict-resolved 时存在） */
  mergeCommitSha?: string;
  /** 审计判定 */
  auditVerdict?: 'PASS' | 'WARN' | 'FAIL';
  /** 审计报告摘要 */
  auditReport?: string;
  /** 拒绝原因（rejected / error 时存在） */
  rejectionReason?: string;
  /** 冲突裁决记录（conflict-* 时存在） */
  conflict?: ConflictRecord;
}

/** runMergeGate 入参 */
export interface MergeGateOptions {
  /** 主仓库根目录（默认 process.cwd()） */
  repoRoot?: string;
  /** 任务描述（审计上下文，供 A3 任务关联等规则使用） */
  task?: string;
  /** 主分支 ref（默认自动探测当前分支） */
  mainRef?: string;
  /** 注册表路径覆盖 */
  registryPath?: string;
  /** 冲突记录路径覆盖 */
  conflictsPath?: string;
  /** 主分支侧冲突方信息覆盖（默认 agentId='main'，无 scope） */
  incumbent?: Partial<ConflictParty>;
  /** 编排引擎重试通知（audit FAIL / 冲突让步时触发） */
  notifyRetry?: (agentId: string, reason: string) => void | Promise<void>;
  /** HITL 通知（scope 重叠冲突时触发；v1.2.3 仅通知不阻塞） */
  notifyHuman?: (record: ConflictRecord) => void | Promise<void>;
  /** 日志输出 */
  log?: (msg: string) => void;
}

/** 审计结论（内部） */
interface AuditOutcome {
  verdict: 'PASS' | 'WARN' | 'FAIL';
  report: string;
}

// ────────────────────────────────
// 主流程
// ────────────────────────────────

/**
 * 审计合并卡关——SubAgent 产出合并回主分支前的唯一入口。
 *
 * 不变量：
 * - audit FAIL 的产出绝不进入主分支
 * - 冲突绝不静默覆盖（要么按 scope 自动裁决，要么升级人工）
 * - 每一步都有 jsonl 痕迹（registry / conflicts）
 */
export async function runMergeGate(
  handle: WorktreeHandle,
  opts: MergeGateOptions = {},
): Promise<MergeGateResult> {
  const repoRoot = resolve(opts.repoRoot ?? process.cwd());
  const registryPath = resolveRegistryPath(repoRoot, opts.registryPath);
  const conflictsPath = resolveConflictsPath(repoRoot, opts.conflictsPath);
  const log = opts.log ?? (() => {});
  const task = opts.task ?? `worktree merge: ${handle.agentId}`;

  const recordRegistry = (event: 'merge' | 'audit-reject', detail: string): void => {
    appendWorktreeRegistry(registryPath, {
      ts: new Date().toISOString(),
      event,
      agentId: handle.agentId,
      branch: handle.branch,
      path: handle.path,
      pid: process.pid,
      detail,
    });
  };

  try {
    // ── 1. 提交 worktree 工作区的未提交变更（SubAgent 留下的产出） ──
    await commitPendingChanges(handle);

    // ── 2. 计算 merge-base 与分支 tip，判断是否有新提交 ──
    const mainRef = opts.mainRef ?? (await detectMainRef(repoRoot));
    const mergeBase = (await git(['merge-base', mainRef, handle.branch], repoRoot)).trim();
    const tipSha = (await git(['rev-parse', handle.branch], repoRoot)).trim();
    if (mergeBase === tipSha) {
      log(`ℹ️ merge-gate: ${handle.branch} 无新提交，noop`);
      return { status: 'noop' };
    }

    // ── 3. 审计（复用 @sofagent/audit 现有规则，不新写） ──
    const auditOutcome = await auditWorktreeDiff(repoRoot, mergeBase, tipSha, task);
    if (auditOutcome.verdict === 'FAIL') {
      const reason = `审计未通过：${auditOutcome.report}`;
      recordRegistry('audit-reject', reason);
      await handle.cleanup(); // 丢弃 worktree
      await opts.notifyRetry?.(handle.agentId, reason);
      log(`⛔ merge-gate: audit FAIL · ${handle.branch} 已丢弃，通知 ${handle.agentId} 重试`);
      return {
        status: 'rejected',
        auditVerdict: 'FAIL',
        auditReport: auditOutcome.report,
        rejectionReason: reason,
      };
    }

    // ── 4. 合并（--no-ff 保留分支历史） ──
    const mergeMsg = `merge(worktree): ${handle.branch} (${handle.agentId})`;
    try {
      await git(['merge', '--no-ff', '-m', mergeMsg, handle.branch], repoRoot);
      const mergeCommitSha = (await git(['rev-parse', 'HEAD'], repoRoot)).trim();
      recordRegistry('merge', `mergeCommit=${mergeCommitSha} audit=${auditOutcome.verdict}`);
      await handle.cleanup();
      log(`✅ merge-gate: 已合并 ${handle.branch} → ${mainRef}（${mergeCommitSha.slice(0, 8)}）`);
      return {
        status: 'merged',
        mergeCommitSha,
        auditVerdict: auditOutcome.verdict,
        auditReport: auditOutcome.report,
      };
    } catch (mergeErr) {
      // ── 5. 文本冲突 → conflict-resolver 仲裁 ──
      const conflictFiles = await listConflictFiles(repoRoot);
      if (conflictFiles.length === 0) {
        // 非文本冲突的 merge 失败（如主工作树脏文件阻挡）——abort 后报 error
        await git(['merge', '--abort'], repoRoot).catch(() => '');
        const msg = mergeErr instanceof Error ? mergeErr.message : String(mergeErr);
        return {
          status: 'error',
          auditVerdict: auditOutcome.verdict,
          rejectionReason: `git merge 失败：${msg}`,
        };
      }
      return await arbitrateAndAct({
        handle,
        repoRoot,
        mainRef,
        mergeMsg,
        conflictFiles,
        auditOutcome,
        conflictsPath,
        opts,
        recordRegistry,
        log,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 'error', rejectionReason: `merge-gate 内部错误：${msg}` };
  }
}

// ────────────────────────────────
// 内部步骤
// ────────────────────────────────

/**
 * 提交 worktree 工作区的未提交变更。
 * 显式提交身份（sofagent-{agentId}）——merge commit 历史可追溯到
 * 是哪个 SubAgent 做的，且不受主仓库 user.name/user.email 配置缺失影响。
 *
 * add --force：worktree 内的全部产出都必须进入审计视野——gitignore
 * （含用户全局 excludesFile，常含 .env）不能成为 SubAgent 绕过审计的
 * 通道。被 ignore 的敏感文件（如 .env）先强制提交，再由 A1 拦截 FAIL，
 * 而不是静默丢弃让 SubAgent 误以为产出已合并。
 */
async function commitPendingChanges(handle: WorktreeHandle): Promise<void> {
  await git(['add', '-A', '--force'], handle.path);
  const status = (await git(['status', '--porcelain'], handle.path)).trim();
  if (!status) return;
  await git(
    [
      '-c', `user.name=sofagent-${handle.agentId}`,
      '-c', 'user.email=sofagent-agent@local',
      'commit', '-m', `sofagent(${handle.agentId}): worktree changes`,
    ],
    handle.path,
  );
}

/** 探测主分支 ref（detached HEAD 时返回 'HEAD'） */
async function detectMainRef(repoRoot: string): Promise<string> {
  const ref = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot)).trim();
  return ref || 'HEAD';
}

/**
 * 审计 worktree 分支 diff——程序化调用 @sofagent/audit。
 * 与 loop audit 节点同一入口（parseDiff + runRules，silent 模式跳过
 * 日志依赖规则）。range 为纯 SHA（hex + '..'），天然通过 parseDiff
 * 的注入字符校验（分支名含 '/' 不能直接用）。
 */
async function auditWorktreeDiff(
  repoRoot: string,
  mergeBase: string,
  tipSha: string,
  task: string,
): Promise<AuditOutcome> {
  const audit = await import('@sofagent/audit');
  const diffFiles = audit.parseDiff(`${mergeBase}..${tipSha}`, repoRoot);
  if (diffFiles.length === 0) {
    return { verdict: 'WARN', report: '审计提示：分支 diff 为空——可能只有合并提交' };
  }
  const result = audit.runRules(diffFiles, [], task, false, true);
  const verdict: AuditOutcome['verdict'] =
    result.exitCode === 0 ? 'PASS' : result.exitCode === 1 ? 'WARN' : 'FAIL';
  const lines = result.rules
    .filter((r) => r.status !== 'SKIPPED' && r.status !== 'PASS')
    .map((r) => `[${r.status}] #${r.number} ${r.name}${r.details.length ? `：${r.details.join('；')}` : ''}`);
  return {
    verdict,
    report: lines.length > 0 ? lines.join('\n') : `${result.rules.length} 条规则全部通过`,
  };
}

/** 列出 merge 冲突（未合并）文件 */
async function listConflictFiles(repoRoot: string): Promise<string[]> {
  try {
    const out = await git(['diff', '--name-only', '--diff-filter=U'], repoRoot);
    return out.split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** arbitrateAndAct 入参（内部） */
interface ArbitrateParams {
  handle: WorktreeHandle;
  repoRoot: string;
  mainRef: string;
  mergeMsg: string;
  conflictFiles: string[];
  auditOutcome: AuditOutcome;
  conflictsPath: string;
  opts: MergeGateOptions;
  recordRegistry: (event: 'merge' | 'audit-reject', detail: string) => void;
  log: (msg: string) => void;
}

/**
 * 冲突仲裁与执行：
 * - incoming 赢 → abort + merge -X theirs 重新合并（保留 --no-ff merge commit）
 * - incumbent 赢 → abort + 丢弃 worktree + 通知重试
 * - hitl → abort + 记录 pending-hitl + 通知人工（worktree 保留待人工处理）
 */
async function arbitrateAndAct(params: ArbitrateParams): Promise<MergeGateResult> {
  const {
    handle, repoRoot, mainRef, mergeMsg, conflictFiles,
    auditOutcome, conflictsPath, opts, recordRegistry, log,
  } = params;

  const committedAtOf = async (ref: string): Promise<string> => {
    try {
      return (await git(['log', '-1', '--format=%cI', ref], repoRoot)).trim();
    } catch {
      return new Date().toISOString();
    }
  };

  const incoming: ConflictParty = {
    agentId: handle.agentId,
    branch: handle.branch,
    responsibilityScope: handle.responsibilityScope,
    committedAt: await committedAtOf(handle.branch),
  };
  const incumbent: ConflictParty = {
    agentId: opts.incumbent?.agentId ?? 'main',
    branch: opts.incumbent?.branch ?? mainRef,
    responsibilityScope: opts.incumbent?.responsibilityScope,
    committedAt: opts.incumbent?.committedAt ?? (await committedAtOf(mainRef)),
  };

  const resolution = resolveWorktreeConflict({ files: conflictFiles, incoming, incumbent });
  const record: ConflictRecord = {
    ts: new Date().toISOString(),
    files: conflictFiles,
    incoming,
    incumbent,
    resolution: resolution.resolution,
    reason: resolution.reason,
    status: resolution.resolution === 'hitl' ? 'pending-hitl' : 'resolved',
  };
  appendConflictRecord(conflictsPath, record);

  if (resolution.resolution === 'hitl') {
    // 升级人工——abort 保持主工作树干净，worktree 保留待人工处理
    await git(['merge', '--abort'], repoRoot).catch(() => '');
    await opts.notifyHuman?.(record);
    log(`⏸️ merge-gate: 冲突升级人工确认 · ${conflictFiles.join(', ')}`);
    return { status: 'conflict-hitl', auditVerdict: auditOutcome.verdict, conflict: record };
  }

  if (resolution.resolution === 'incoming-wins') {
    // incoming 全赢——abort 后带 -X theirs 重新合并（冲突 hunk 取分支侧）
    await git(['merge', '--abort'], repoRoot).catch(() => '');
    await git(['merge', '--no-ff', '-X', 'theirs', '-m', mergeMsg, handle.branch], repoRoot);
    const mergeCommitSha = (await git(['rev-parse', 'HEAD'], repoRoot)).trim();
    recordRegistry('merge', `mergeCommit=${mergeCommitSha} conflict=incoming-wins`);
    await handle.cleanup();
    log(`✅ merge-gate: 冲突仲裁 incoming 赢 · 已合并（${mergeCommitSha.slice(0, 8)}）`);
    return {
      status: 'conflict-resolved',
      mergeCommitSha,
      auditVerdict: auditOutcome.verdict,
      conflict: record,
    };
  }

  // incumbent 赢——后提交者/越 scope 者让步：abort + 丢弃 + 通知重试
  await git(['merge', '--abort'], repoRoot).catch(() => '');
  await handle.cleanup();
  await opts.notifyRetry?.(handle.agentId, resolution.reason);
  log(`🔄 merge-gate: 冲突仲裁 incumbent 赢 · ${handle.agentId} 让步，通知重试`);
  return { status: 'conflict-resolved', auditVerdict: auditOutcome.verdict, conflict: record };
}
