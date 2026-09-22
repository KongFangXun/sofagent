// ============================================================
// exec/git-capability.ts · Git 能力三态 × 执行隔离两模式判定矩阵（v1.5.1 扩展三）
// ============================================================
// 两维正交、不许混判：
//   Git 能力：none（无 git）/ local（有仓库无 remote）/ remote（可推送）
//   执行隔离：worktree（隔离工作树）/ original-dir（共享原目录）
// 据此降级：remote → 标准 worktree + 自动提交 + 可提 PR；
//           local → 本地隔离可用、PR 通道关闭；
//           none → 共享目录执行、无 branch/diff/PR。
// 自动提交与自动推送分开判定（仅 remote 可推送）；
// 降级必须显式阻塞提示——不许静默生成空目录冒充已有内容。
// ============================================================

/** Git 能力三态 */
export type GitCapability = 'none' | 'local' | 'remote';

/** 执行隔离两模式 */
export type IsolationMode = 'worktree' | 'original-dir';

/** 执行计划（九组合矩阵的输出） */
export interface ExecutionPlan {
  /** 可用 Git 自动提交 */
  autoCommit: boolean;
  /** 可用 Git 自动推送（仅 remote） */
  autoPush: boolean;
  /** 可提 PR */
  canOpenPR: boolean;
  /** 是否可用 worktree 隔离 */
  worktreeIsolation: boolean;
  /** 降级说明（显式阻塞提示——降级了什么、为什么） */
  degradations: string[];
  /** 硬阻塞（无法安全执行的组合提示；空数组 = 可执行） */
  blockers: string[];
}

/**
 * 正交判定矩阵（纯函数——九组合逐组合可测）。
 * cap × mode → 执行计划。
 */
export function planExecution(capability: GitCapability, mode: IsolationMode): ExecutionPlan {
  const degradations: string[] = [];
  const blockers: string[] = [];

  // 维度一：Git 能力（决定 提交/推送/PR 三通道）
  const autoCommit = capability !== 'none';
  const autoPush = capability === 'remote';
  const canOpenPR = capability === 'remote';
  if (capability === 'none') {
    degradations.push('Git 能力 none：无 branch/diff/PR——变更不经 git 留痕，执行结果只走审计日志');
  } else if (capability === 'local') {
    degradations.push('Git 能力 local：自动提交可用、PR 通道关闭（无 remote 可推送）');
  }

  // 维度二：执行隔离（决定 worktree 可用性）
  const worktreeIsolation = capability !== 'none' && mode === 'worktree';
  if (mode === 'worktree' && capability === 'none') {
    blockers.push('隔离模式 worktree 需要 Git 能力 ≥ local——无 git 环境无法创建工作树，改用 original-dir 共享执行（显式降级，不静默建空目录）');
  }
  if (mode === 'original-dir' && capability === 'remote') {
    degradations.push('original-dir 共享目录 + remote 能力：可提交可推送，但共享目录并发写有竞态风险——建议 worktree 隔离');
  }

  return { autoCommit, autoPush, canOpenPR, worktreeIsolation, degradations, blockers };
}
