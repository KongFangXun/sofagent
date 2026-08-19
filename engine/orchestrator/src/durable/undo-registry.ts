// ============================================================
// durable/undo-registry.ts · 工具 undo 函数注册表（WAL 回滚执行器）
// v1.3.8 交付三 新增
//
// 难点不在 WAL 本身，而在 undo——不是所有操作都可逆（changelog §三）：
//   ✅ 可逆 reversible：git 操作（git restore）、文件写入（删掉新写的）
//   ⚠️ 部分可逆 partial：PR 创建（能关不能删）、飞书消息（2 分钟内可撤回）
//   ❌ 不可逆 irreversible：邮件发送、webhook 触发（已被消费）
//
// 不可逆策略：isReversible 查询返回 irreversible → 执行前应告警
//（warnHook 回调——网关/调用方决定挂 HITL 或拒绝）；已发生的不可逆
// 副作用**不回滚**（已发生的事实不篡改——undo 返回 skipped）。
//
// 内置两个可逆实现（本版注册）：
//   - gitRestore：临时 git 仓库回滚（git checkout 指定文件/全部工作区）
//   - deleteWrittenFile：删除新写的文件（begin 声明 target 路径）
//
// 零 npm 依赖——Node 内建 child_process/fs。
// ============================================================

import { execFileSync } from 'child_process';
import { existsSync, realpathSync, statSync, unlinkSync } from 'fs';
import { dirname, isAbsolute, relative, resolve } from 'path';

/** 可逆性三档 */
export type UndoTier = 'reversible' | 'partial' | 'irreversible';

/** undo 执行结果 */
export interface UndoResult {
  /** 任务标识（WAL 事务） */
  taskId: string;
  /** 动作标识（SideEffectSpec.action） */
  action: string;
  /** 回滚状态：done=已回滚 / skipped=不回滚（不可逆或对象已消失）/ failed=回滚失败 */
  status: 'done' | 'skipped' | 'failed';
  /** 说明（done 跳过了什么 / skipped 原因 / failed 错误信息） */
  detail?: string;
}

/**
 * undo 函数签名——输入 begin 记录声明的副作用描述（action/target/detail）
 * 与操作上下文，输出回滚结果。实现方自行保证幂等（重复 undo 无害）。
 */
export type UndoFn = (effect: { taskId: string; action: string; target?: string; detail?: string }) => UndoResult;

/** 注册表条目 */
interface RegistryEntry {
  fn: UndoFn;
  tier: UndoTier;
}

/** 不可逆操作的执行前告警回调（网关接 HITL / CLI 打印警示） */
export type WarnHook = (message: {
  taskId?: string;
  tool: string;
  action: string;
  tier: UndoTier;
  warning: string;
}) => void;

/**
 * undo 函数注册表。
 *
 * 用法：
 *   const reg = createUndoRegistry();
 *   reg.registerUndo('git.checkout', gitRestore, 'reversible');
 *   reg.registerUndo('file.write', deleteWrittenFile, 'reversible');
 *   reg.registerUndo('pr.create', closePr, 'partial');
 *   reg.registerUndo('email.send', () => skipped, 'irreversible');
 *   reg.isReversible('email.send');              // 'irreversible'
 *   reg.getUndo('git.checkout');                 // UndoFn
 */
export class UndoRegistry {
  private readonly entries = new Map<string, RegistryEntry>();
  private readonly warnHooks: WarnHook[] = [];

  /**
   * 注册工具/动作的 undo 函数。
   * @param tool 工具或动作标识（与 SideEffectSpec.action 对齐）
   * @param fn undo 实现（返回 UndoResult；不可逆操作返回 status='skipped'）
   * @param tier 可逆档位（默认 'reversible'——显式传值更清晰）
   */
  registerUndo(tool: string, fn: UndoFn, tier: UndoTier = 'reversible'): void {
    this.entries.set(tool, { fn, tier });
  }

  /** 注册不可逆告警回调（可多个——观测/审计/HITL 各挂一个） */
  onIrreversible(hook: WarnHook): void {
    this.warnHooks.push(hook);
  }

  /**
   * 查询可逆性——执行前调用：irreversible 时调用方应先告警/挂 HITL。
   * 未注册的动作按 irreversible 处理（fail-safe：无法回滚 = 不承诺可回滚）。
   */
  isReversible(tool: string): UndoTier {
    return this.entries.get(tool)?.tier ?? 'irreversible';
  }

  /** 取 undo 函数（未注册返回 null——调用方按不可逆处理） */
  getUndo(tool: string): UndoFn | null {
    return this.entries.get(tool)?.fn ?? null;
  }

  /**
   * 执行前告警：不可逆（或部分可逆）操作触发 warnHook。
   * partial 也告警——「能关 PR 但删不掉记录」用户应知情。
   */
  warnIfNotFullyReversible(tool: string, taskId?: string): void {
    const tier = this.isReversible(tool);
    if (tier === 'reversible') return;
    const warning =
      tier === 'irreversible'
        ? `操作 ${tool} 不可逆（无法回滚）——执行后崩溃恢复只能跳过，不会撤销已发生的外部副作用`
        : `操作 ${tool} 部分可逆——回滚只能部分撤销（如关闭 PR 但无法抹去创建记录）`;
    for (const hook of this.warnHooks) {
      try {
        hook({ taskId, tool, action: tool, tier, warning });
      } catch {
        // 告警回调失败不阻断（观测面异常不该拖垮执行面）
      }
    }
  }

  /** 已注册动作清单（观测/测试用） */
  registeredTools(): string[] {
    return [...this.entries.keys()];
  }
}

/** 创建注册表并预注册内置可逆实现（gitRestore / deleteWrittenFile） */
export function createUndoRegistry(): UndoRegistry {
  const reg = new UndoRegistry();
  reg.registerUndo('git.checkout', gitRestore, 'reversible');
  reg.registerUndo('file.write', deleteWrittenFile, 'reversible');
  return reg;
}

// ────────────────────────────────
// 内置可逆实现一：git 回滚（gitRestore）
// ────────────────────────────────

/**
 * git 仓库回滚——target 为仓库内文件路径时 `git checkout -- <file>`
 * 恢复单个文件；target 为仓库根（或 'ALL'）时 `git checkout -- .`
 * 恢复整个工作区。
 *
 * 安全边界：
 *   - target 必须落在 git 仓库内（git rev-parse --show-toplevel 校验），
 *     防止把任意路径喂给 git checkout
 *   - 只动工作区（checkout --），不动 commit 历史/远端——回滚的是
 *     「未提交的修改」，已提交内容由 git 自身历史保证，不归 WAL 管
 *   - 仓库外路径 → skipped（不是 git 管辖的操作，交其他 undo 处理）
 */
export function gitRestore(effect: { taskId: string; action: string; target?: string; detail?: string }): UndoResult {
  const target = effect.target;
  if (!target) {
    return { taskId: effect.taskId, action: effect.action, status: 'skipped', detail: 'git.checkout undo 缺少 target（无可回滚对象）' };
  }
  const abs = realPathOf(absoluteOf(target));
  if (!existsSync(abs)) {
    // 文件不存在：要么从未创建，要么已被回滚——幂等成功
    return { taskId: effect.taskId, action: effect.action, status: 'done', detail: `target 不存在（已回滚或未发生）: ${target}` };
  }
  // 仓库定位：target 所在（或其祖先）git 仓库根
  const repoRoot = gitRepoRootOf(abs);
  if (!repoRoot) {
    return { taskId: effect.taskId, action: effect.action, status: 'skipped', detail: `target 不在 git 仓库内（非 git.checkout 管辖）: ${target}` };
  }
  try {
    const rel = relFromRoot(repoRoot, abs);
    // 相对路径逃逸仓库根（realpath 归一后仍 ../../）——非本仓管辖，拒绝
    if (rel.startsWith('..')) {
      return { taskId: effect.taskId, action: effect.action, status: 'skipped', detail: `target 逃逸仓库根（${target} vs ${repoRoot}）` };
    }
    // 单文件或整仓恢复（target 即仓库根时恢复全部工作区）
    const scope = rel === '.' || rel === '' ? '.' : rel;
    // tracked 预检：untracked 文件不在 git 索引内——git checkout 会报
    // pathspec 错。这类「工具新写的文件」归 file.write undo（删除）管，
    // 不归 git 管（skipped 而非 failed——职责划分不是故障）
    if (scope !== '.') {
      try {
        execFileSync('git', ['ls-files', '--error-unmatch', '--', scope], {
          cwd: repoRoot,
          stdio: 'pipe',
          timeout: 5_000,
        });
      } catch {
        return { taskId: effect.taskId, action: effect.action, status: 'skipped', detail: `untracked 文件不受 git checkout 管辖（由 file.write undo 负责删除）: ${target}` };
      }
    }
    // execFileSync 数组参数——不经 shell，路径含空格/元字符无注入面
    execFileSync('git', ['checkout', '--', scope], {
      cwd: repoRoot,
      stdio: 'pipe',
      timeout: 10_000,
    });
    return {
      taskId: effect.taskId,
      action: effect.action,
      status: 'done',
      detail: `git checkout -- ${scope}（工作区已恢复）`,
    };
  } catch (err) {
    return {
      taskId: effect.taskId,
      action: effect.action,
      status: 'failed',
      detail: `git checkout 失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ────────────────────────────────
// 内置可逆实现二：删除新写文件（deleteWrittenFile）
// ────────────────────────────────

/**
 * 删除工具新写的文件——begin 声明 target 路径，undo 时删除。
 *
 * 安全边界：只删文件（不递归删目录——目录删除交给专用的目录 undo，
 * 本版不提供，防误删整个 data/ 级别的树）；不存在视为已回滚（幂等）。
 */
export function deleteWrittenFile(effect: { taskId: string; action: string; target?: string; detail?: string }): UndoResult {
  const target = effect.target;
  if (!target) {
    return { taskId: effect.taskId, action: effect.action, status: 'skipped', detail: 'file.write undo 缺少 target（无可删除对象）' };
  }
  const abs = absoluteOf(target);
  if (!existsSync(abs)) {
    return { taskId: effect.taskId, action: effect.action, status: 'done', detail: `文件已不存在（已回滚或未发生）: ${target}` };
  }
  let st;
  try {
    st = statSync(abs);
  } catch (err) {
    return { taskId: effect.taskId, action: effect.action, status: 'failed', detail: `stat 失败: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!st.isFile()) {
    return { taskId: effect.taskId, action: effect.action, status: 'skipped', detail: `target 不是普通文件（拒绝递归删除目录）: ${target}` };
  }
  try {
    unlinkSync(abs);
    return { taskId: effect.taskId, action: effect.action, status: 'done', detail: `已删除新写文件: ${target}` };
  } catch (err) {
    return { taskId: effect.taskId, action: effect.action, status: 'failed', detail: `删除失败: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ────────────────────────────────
// 路径辅助
// ────────────────────────────────

/** 相对路径解析为绝对路径（相对 cwd——调用方通常传绝对路径） */
function absoluteOf(p: string): string {
  return isAbsolute(p) ? p : resolve(p);
}

/**
 * 真实绝对路径——穿透符号链接（macOS tmpdir 是 /var → /private/var 软链：
 * git rev-parse 返回真实前缀，若 target 保留软链前缀，relative() 会产出
 * ../../ 灾难路径喂给 git checkout）。路径不存在时退回未解析形态。
 */
function realPathOf(absPath: string): string {
  try {
    return realpathSync(absPath);
  } catch {
    return absPath;
  }
}

/** 定位路径所在 git 仓库根（非 git 管辖返回 null）。
 *  cwd 取「目录本身优先」：目录 target（仓库根整仓恢复）直接用它；
 *  文件 target 用其父目录（git rev-parse 只认目录，cwd 给文件路径 ENOTDIR）。 */
function gitRepoRootOf(absPath: string): string | null {
  let cwd = absPath;
  try {
    if (!statSync(absPath).isDirectory()) cwd = dirname(absPath);
  } catch {
    return null;
  }
  try {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      stdio: 'pipe',
      timeout: 5_000,
    })
      .toString()
      .trim();
    return root.length > 0 ? root : null;
  } catch {
    // exit 非 0 = 不在 git 仓库内
    return null;
  }
}

/** 仓库根内相对路径（跨平台分隔符归一） */
function relFromRoot(repoRoot: string, absPath: string): string {
  const rel = relative(repoRoot, absPath);
  // POSIX 化（Windows 反斜杠不影响 git，但保持输出一致性）
  return rel.split('\\').join('/');
}
