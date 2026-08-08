// ============================================================
// worktree-isolation.ts · git worktree 隔离原语（v1.2.8 · 交付一）
//
// 为未来并行 SubAgent 提供文件级隔离底座——不是替换编排引擎，
// 是加一层 worktree 隔离原语（AD-4：只交付三原语 + 单测 +
// LoopGraphDeps 可选注点，默认不激活；并行调度接 graph.ts 留 v1.3.0）。
//
// ## filesValue vs worktree 隔离边界
//
// | 场景 | 用 filesValue | 用 worktree |
// |------|:---:|:---:|
// | 同一波次内 SubAgent 并行 | ✅ | ❌（杀鸡用牛刀）|
// | 跨波次 SubAgent 并行 | ❌ | ✅ |
// | SubAgent 写完全不同的文件 | ✅ | ✅（可选）|
// | SubAgent 可能写同一文件 | ❌ | ✅ |
//
// filesValue = 轻量内存合并（无 git 操作，快但有竞争风险）
// worktree = 重量级隔离（git worktree + merge gate，慢但安全）
//
// 设计约束：
// - 纯 git worktree——不引入 FilesystemBackend / 虚拟文件系统 / AsyncSubAgent
// - worktree 目录固定在 <repoRoot>/.sofagent/worktrees/ 下，不污染主工作树
//   （create 时自动把该目录写入 .git/info/exclude，git status 不可见）
// - create() / cleanup() 幂等——重复调用不报错；cleanup 可在 SubAgent
//   异常退出后由调用方 try/finally 兜底调用
// - 注册表 jsonl：<repoRoot>/data/audit/worktree-registry.jsonl——
//   每次 create/cleanup/sweep/merge/audit-reject 追加一行
// - git 调用一律走 execFile（无 shell，无注入面）
// ============================================================

import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from 'fs';
import { dirname, isAbsolute, join, resolve } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/** worktree 根目录（相对 repoRoot） */
export const WORKTREE_BASE_DIR = '.sofagent/worktrees';
/** worktree 分支前缀 */
export const WORKTREE_BRANCH_PREFIX = 'sofagent/';
/** 注册表默认路径（相对 repoRoot） */
export const WORKTREE_REGISTRY_REL = 'data/audit/worktree-registry.jsonl';

// ────────────────────────────────
// 注册表（jsonl，append-only）
// ────────────────────────────────

/** 注册表条目——每次 worktree 生命周期事件追加一行 */
export interface WorktreeRegistryEntry {
  /** ISO 8601 时间戳 */
  ts: string;
  /**
   * 生命周期事件：
   * - create：worktree 创建
   * - cleanup：正常清理（幂等，重复调用也会记录）
   * - sweep：启动清扫回收（进程已死的孤儿 worktree）
   * - merge / audit-reject：merge-gate 写入的结果事件（不改变 active 状态，
   *   状态只由 create/cleanup/sweep 决定）
   */
  event: 'create' | 'cleanup' | 'sweep' | 'merge' | 'audit-reject';
  /** SubAgent 标识 */
  agentId: string;
  /** worktree 分支名（sofagent/wt-{uuid}） */
  branch: string;
  /** worktree 绝对路径（.sofagent/worktrees/wt-{uuid}） */
  path: string;
  /** 记录方进程 pid——sweep 死活判定依据 */
  pid: number;
  /** 补充信息（merge commit / 拒绝原因 / 回收说明） */
  detail?: string;
}

/** 解析注册表路径（默认 <repoRoot>/data/audit/worktree-registry.jsonl） */
export function resolveRegistryPath(repoRoot: string, registryPath?: string): string {
  return registryPath ? resolve(registryPath) : join(repoRoot, WORKTREE_REGISTRY_REL);
}

/**
 * 追加一行注册表记录。
 * 写入失败不阻断主流程——注册表是辅助追溯，不是事务日志。
 */
export function appendWorktreeRegistry(registryPath: string, entry: WorktreeRegistryEntry): void {
  try {
    mkdirSync(dirname(registryPath), { recursive: true });
    appendFileSync(registryPath, `${JSON.stringify(entry)}\n`);
  } catch {
    // 注册表写入失败静默——不阻断 worktree 主流程
  }
}

/** 读取注册表全部条目（坏行跳过——进程崩溃可能写了一半） */
export function readWorktreeRegistry(registryPath: string): WorktreeRegistryEntry[] {
  if (!existsSync(registryPath)) return [];
  const entries: WorktreeRegistryEntry[] = [];
  for (const line of readFileSync(registryPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as WorktreeRegistryEntry);
    } catch {
      // 跳过坏行
    }
  }
  return entries;
}

/**
 * 重放注册表，返回仍处于 active 状态的 worktree 条目。
 * 判定：按 path 分组，最后一个生命周期事件为 create 即为 active
 * （cleanup/sweep 收尾；merge/audit-reject 不影响状态）。
 */
export function listActiveWorktrees(entries: WorktreeRegistryEntry[]): WorktreeRegistryEntry[] {
  const lastEventByPath = new Map<string, WorktreeRegistryEntry['event']>();
  const metaByPath = new Map<string, WorktreeRegistryEntry>();
  for (const e of entries) {
    if (e.event === 'create' || e.event === 'cleanup' || e.event === 'sweep') {
      lastEventByPath.set(e.path, e.event);
      metaByPath.set(e.path, e);
    }
  }
  return [...lastEventByPath.entries()]
    .filter(([, event]) => event === 'create')
    .map(([p]) => metaByPath.get(p)!);
}

// ────────────────────────────────
// git 辅助
// ────────────────────────────────

/** 执行 git 命令（execFile，无 shell 注入面），返回 stdout */
async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf-8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

/** 分支是否存在 */
async function branchExists(repoRoot: string, branch: string): Promise<boolean> {
  try {
    await git(['rev-parse', '--verify', '--quiet', branch], repoRoot);
    return true;
  } catch {
    return false;
  }
}

/**
 * 强制移除 worktree + 删除分支——全链路容错（cleanup/sweep 的幂等基石）。
 * git worktree remove 失败（元数据损坏/未注册）时降级为手动删目录 + prune。
 */
async function forceRemoveWorktree(repoRoot: string, wtPath: string, branch: string): Promise<void> {
  try {
    await git(['worktree', 'remove', '--force', wtPath], repoRoot);
  } catch {
    // 降级路径：手动删目录 + worktree prune 清理元数据
    try {
      rmSync(wtPath, { recursive: true, force: true });
    } catch {
      // 目录不存在——幂等
    }
    try {
      await git(['worktree', 'prune'], repoRoot);
    } catch {
      // 非 git 环境——忽略
    }
  }
  try {
    await git(['branch', '-D', branch], repoRoot);
  } catch {
    // 分支不存在——幂等
  }
}

/**
 * 把 worktree 根目录写入 .git/info/exclude——主工作树 git status 不显示
 * .sofagent/worktrees/ 未跟踪条目（不污染主工作树视野）。
 * 失败不阻断创建（仅影响 git status 整洁度）。
 */
async function ensureGitExclude(repoRoot: string): Promise<void> {
  try {
    // --git-common-dir：主仓库与 linked worktree 场景都指向共享 git 目录
    const gitDirRaw = (await git(['rev-parse', '--git-common-dir'], repoRoot)).trim();
    const gitDir = isAbsolute(gitDirRaw) ? gitDirRaw : resolve(repoRoot, gitDirRaw);
    const infoDir = join(gitDir, 'info');
    mkdirSync(infoDir, { recursive: true });
    const excludePath = join(infoDir, 'exclude');
    const line = '/.sofagent/worktrees/';
    const existing = existsSync(excludePath) ? readFileSync(excludePath, 'utf-8') : '';
    if (!existing.split('\n').includes(line)) {
      const needNewline = existing.length > 0 && !existing.endsWith('\n');
      appendFileSync(excludePath, `${needNewline ? '\n' : ''}${line}\n`);
    }
  } catch {
    // exclude 写入失败静默
  }
}

// ────────────────────────────────
// WorktreeHandle
// ────────────────────────────────

/**
 * worktree 句柄——一个 SubAgent 的独立工作区。
 *
 * 生命周期：
 *   const handle = createWorktree({ agentId: 'engineer-1', repoRoot });
 *   try {
 *     await handle.create();
 *     // SubAgent 在 handle.path 内工作……
 *   } finally {
 *     await handle.cleanup();   // 异常退出也能幂等清理
 *   }
 */
export interface WorktreeHandle {
  /** 工作树路径（<repoRoot>/.sofagent/worktrees/wt-{uuid}） */
  readonly path: string;
  /** 分支名（sofagent/wt-{uuid}） */
  readonly branch: string;
  /** SubAgent 标识 */
  readonly agentId: string;
  /** 职责域（目录/文件前缀列表，conflict-resolver 仲裁输入，可选） */
  readonly responsibilityScope?: string[];
  /** 创建 git worktree + 分支（幂等，重复调用不报错） */
  create(): Promise<void>;
  /** 销毁：清理 worktree + 删除分支（幂等，重复调用不报错） */
  cleanup(): Promise<void>;
  /** 获取相对主工作树（创建时点 HEAD）的 git diff 文本 */
  diff(): Promise<string>;
}

/** createWorktree 入参 */
export interface CreateWorktreeOptions {
  /** SubAgent 标识（必填，写入注册表与分支历史） */
  agentId: string;
  /** 主仓库根目录（默认 process.cwd()） */
  repoRoot?: string;
  /** 职责域（目录/文件前缀列表，冲突仲裁用，可选） */
  responsibilityScope?: string[];
  /** 注册表路径覆盖（默认 <repoRoot>/data/audit/worktree-registry.jsonl） */
  registryPath?: string;
  /** uuid 注入（测试用，默认 crypto.randomUUID()） */
  id?: string;
}

/**
 * git worktree 句柄实现。
 *
 * 内部状态：created 标记 + baseSha（创建时点主仓 HEAD）。
 * baseSha 是 diff() 的基准——"相对主工作树的 diff"即"相对创建时点
 * 主工作树 HEAD 的 diff"，覆盖分支提交与工作区未提交变更。
 */
class GitWorktreeHandle implements WorktreeHandle {
  readonly path: string;
  readonly branch: string;
  readonly agentId: string;
  readonly responsibilityScope?: string[];

  private readonly repoRoot: string;
  private readonly registryPath: string;
  private created = false;
  private baseSha = '';

  constructor(opts: CreateWorktreeOptions) {
    const id = opts.id ?? randomUUID();
    this.repoRoot = resolve(opts.repoRoot ?? process.cwd());
    this.agentId = opts.agentId;
    this.path = join(this.repoRoot, WORKTREE_BASE_DIR, `wt-${id}`);
    this.branch = `${WORKTREE_BRANCH_PREFIX}wt-${id}`;
    this.responsibilityScope = opts.responsibilityScope;
    this.registryPath = resolveRegistryPath(this.repoRoot, opts.registryPath);
  }

  /**
   * 创建 worktree（幂等）。
   * 重复调用直接返回；发现同名残留（上次进程异常退出的尸体）先清再建，
   * 保证干净起点。
   */
  async create(): Promise<void> {
    if (this.created) return; // 幂等：同句柄重复 create 不报错

    mkdirSync(dirname(this.path), { recursive: true });
    await ensureGitExclude(this.repoRoot);

    // 残留清理——目录在就整体移除；只剩分支就删分支
    if (existsSync(this.path)) {
      await forceRemoveWorktree(this.repoRoot, this.path, this.branch);
    } else if (await branchExists(this.repoRoot, this.branch)) {
      try {
        await git(['branch', '-D', this.branch], this.repoRoot);
      } catch {
        // 分支删除失败不阻断——后续 worktree add -b 会报出真实错误
      }
    }

    // 记录创建时点主仓 HEAD 作为 diff 基准
    this.baseSha = (await git(['rev-parse', 'HEAD'], this.repoRoot)).trim();
    await git(['worktree', 'add', this.path, '-b', this.branch], this.repoRoot);
    this.created = true;
    this.record('create');
  }

  /**
   * 清理 worktree + 分支（幂等）。
   * 每一步都容忍"不存在"——SubAgent 异常退出后由调用方 try/finally
   * 兜底调用也安全。每次调用记录一行注册表。
   */
  async cleanup(): Promise<void> {
    await forceRemoveWorktree(this.repoRoot, this.path, this.branch);
    this.created = false;
    this.record('cleanup');
  }

  /**
   * 获取相对主工作树（创建时点 HEAD）的完整 diff。
   * 覆盖：分支上已提交的变更 + 工作区未提交变更 + 未跟踪新文件
   * （intent-to-add --force 让新文件进入 diff 视野，不真正 stage 内容；
   * --force 保证被 gitignore 的文件也不逃出 diff 视野）。
   */
  async diff(): Promise<string> {
    if (!this.created || !this.baseSha) {
      throw new Error(`[worktree] diff() 前请先 create()（agent=${this.agentId}）`);
    }
    await git(['add', '-N', '-A', '--force'], this.path).catch(() => '');
    return git(['diff', this.baseSha], this.path);
  }

  /** 写注册表 */
  private record(event: WorktreeRegistryEntry['event'], detail?: string): void {
    appendWorktreeRegistry(this.registryPath, {
      ts: new Date().toISOString(),
      event,
      agentId: this.agentId,
      branch: this.branch,
      path: this.path,
      pid: process.pid,
      detail,
    });
  }
}

/** 创建 worktree 句柄 */
export function createWorktree(opts: CreateWorktreeOptions): WorktreeHandle {
  return new GitWorktreeHandle(opts);
}

// ────────────────────────────────
// 启动清扫
// ────────────────────────────────

/**
 * 判断进程是否存活。
 * kill(pid, 0)：ESRCH/EINVAL → 死；EPERM → 活（无权限发信号但进程在）。
 */
export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** sweepStaleWorktrees 入参 */
export interface SweepOptions {
  /** 主仓库根目录（默认 process.cwd()） */
  repoRoot?: string;
  /** 注册表路径覆盖 */
  registryPath?: string;
  /** 死活判定注入（测试用，默认 pidAlive） */
  isAlive?: (pid: number) => boolean;
  /** 日志输出 */
  log?: (msg: string) => void;
}

/** sweepStaleWorktrees 结果 */
export interface SweepResult {
  /** 已回收的 worktree 路径（进程已死） */
  swept: string[];
  /** 保留的 worktree 路径（进程仍存活） */
  kept: string[];
}

/**
 * 启动清扫：读取注册表，回收所有状态为 active 但进程已死的 worktree。
 *
 * 场景：SubAgent 进程被杀（kill -9 / 崩溃 / OOM）后，worktree 目录与
 * 分支残留。下次编排引擎启动时调用本函数回收。
 *
 * 死活判定：注册表 create 记录中的 pid + kill(pid, 0)。
 * 回收动作 = forceRemoveWorktree + 写 sweep 记录。
 */
export async function sweepStaleWorktrees(opts: SweepOptions = {}): Promise<SweepResult> {
  const repoRoot = resolve(opts.repoRoot ?? process.cwd());
  const registryPath = resolveRegistryPath(repoRoot, opts.registryPath);
  const isAlive = opts.isAlive ?? pidAlive;
  const active = listActiveWorktrees(readWorktreeRegistry(registryPath));

  const swept: string[] = [];
  const kept: string[] = [];
  for (const entry of active) {
    if (isAlive(entry.pid)) {
      kept.push(entry.path);
      continue;
    }
    // 进程已死——回收 worktree + 分支
    await forceRemoveWorktree(repoRoot, entry.path, entry.branch);
    appendWorktreeRegistry(registryPath, {
      ts: new Date().toISOString(),
      event: 'sweep',
      agentId: entry.agentId,
      branch: entry.branch,
      path: entry.path,
      pid: process.pid,
      detail: `reclaim dead pid=${entry.pid}`,
    });
    opts.log?.(`🧹 sweep 回收 worktree: ${entry.path}（pid=${entry.pid} 已死）`);
    swept.push(entry.path);
  }
  return { swept, kept };
}
