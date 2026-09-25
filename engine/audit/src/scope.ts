// ============================================================
// scope.ts · 审计范围语义一等公民化（AuditScope）· v1.5.3 第七章
// ============================================================
// 问题（v1.4.4 审查 quick A9 同类，最小修复随 12ec0171 落地——本章为根治面）：
//   规则**各自调 git 取输入**（A18 `git ls-tree HEAD` / A5 `git log -1`）——取哪个
//   范围散落在规则内部，任一处写错范围即静默取错输入，且无法在一处审计「本次范围」。
//
// 解法：把「审计范围 + 上下文输入」收口为一个**显式对象** `AuditScope`——
//   ① 唯一构造器 `createAuditScope` 是**规则侧 / 规则执行路径内唯一**的 git 触达点
//      （规则零 git；非规则面——CLI / commands / hook-install / webhook 等——另有
//      自身 git 调用，**不在**本章收口范围，勿把本句读成「全仓唯一 git 调用」）；
//   ② 规则从 `ctx.scope` 取输入，不再自己调 git（机械扫描实证：rules/ 下除检测
//      正则外零 `child_process` 调用）；
//   ③ 构造点进审计留痕（本次范围 = `scope.diffRange`，随历史条目落盘）。
//
// 🔴 未接线字段显式登记（本版主题：消灭「已声明却零接线」——不留不说的悬空字段）：
//   · `diffRange`——当前**仅结构化承载（构造 + 留痕）**，**尚无任何规则消费**。不接线
//     的理由：现有两条依赖 git 的规则语义都不需要「范围」——A18 的豁免基线**按设计**取
//     `HEAD` 树（v1.5.2 P0-02：故意从索引收窄到 HEAD 树，见 rule-a18 头注释），A5 的输入
//     **按设计**取 HEAD 终点 commit message；为它们硬塞 range 取值 = 制造假消费。
//     消费触发条件【可判定】：当出现**第一条**需要「本次 range 内文件集 / range 级越界」
//     的规则时（如把「只审增量、豁免历史」升级为 by-range 判定），由 scope 增开
//     `rangeFiles()` 并在该规则内消费 `scope.diffRange`——**届时应删除本登记**。
//   · `actor`——**已接线**（不再是悬空字段）：CLI 审计留痕（index.ts）消费
//     `scope.actor` / `scope.actorSource`，并删除了自身重复的 git 作者解析链。
//
// 边界：本模块只依赖 Node 内置模块（child_process），不 import 规则/注册表——无循环。
// ============================================================

import { execFileSync } from 'child_process';

/**
 * `actor` 解析来源——把「为何取不到作者名」显式化为一个枚举，从而**不需要空 catch**
 * （本版主题：消灭静默降级——失败事实进返回值而非被吞）。
 *
 * - `explicit`：调用方显式注入 args.actor（优先于 git 解析）
 * - `ident`：`git var GIT_AUTHOR_IDENT` 解析出作者名（配置链完整时的正常路径）
 * - `config`：`git var` 未取到名 → `git config user.name` 兜底命中
 * - `unset`：git **可用**但**未配置身份**（`config user.name` 命令成功却空值）——正常态，非异常
 * - `unavailable`：git 调用**失败**（非 git 环境 / 无 git 可执行文件 / unborn 等）——异常态
 */
export type ActorSource = 'explicit' | 'ident' | 'config' | 'unset' | 'unavailable';

/**
 * 审计范围（AuditScope）——规则输入面的显式声明对象。
 *
 * 声明核 4 字段（devlog §七）：`diffRange` / `commitMsg` / `task` / `actor`——
 *   所有规则输入面显式声明「取 HEAD 还是 range」，输入来源在对象上一处可见。
 *
 * 另含**构造器解析的输入面**（非声明核，供规则/留痕消费，均由构造器从 git 解析）：
 *   - `headTreeFiles()`：HEAD 提交树文件集（A18「垃圾文件」豁免基线）；
 *   - `commitMsgError`：`commitMsg` 解析失败原因（供 A5 FAIL 报文，保持既有措辞）；
 *   - `actorSource`：`actor` 的来源枚举（把「为何取不到作者名」显式化——见 {@link ActorSource}）。
 *
 * 🔴 构造纪律：`AuditScope` **只**由 {@link createAuditScope} 产出——规则侧不得
 *    自行构造（否则即「第二处构造面」，本章要消灭的正是这个）。所有 git 解析
 *   集中在构造器内一次性完成（惰性 + 记忆化，未读取不触达 git）。
 */
export interface AuditScope {
  /** 审计范围（'HEAD' / 'HEAD~1..HEAD' / 'A..B'）——显式声明本次审计取哪一段 */
  readonly diffRange: string;
  /**
   * 本范围终点的 commit message（构造器解析：显式注入优先；未注入则 `git log -1`）。
   * `undefined` = 未提供且 git 不可读（此时 {@link commitMsgError} 载失败原因）。
   */
  readonly commitMsg: string | undefined;
  /** {@link commitMsg} 解析失败原因（仅当 commitMsg === undefined 时非空）；供 A5 FAIL 报文 */
  readonly commitMsgError: string | undefined;
  /** 任务描述（--task 参数）——输入面显式传递，规则不再各取各的 */
  readonly task: string | undefined;
  /** 发起方（git 作者名；非 git 环境 / 未配置身份 → 'unknown'，不伪造） */
  readonly actor: string;
  /**
   * {@link actor} 的来源枚举（把「为何取不到作者名」显式化——{@link ActorSource}）。
   * 与 `actor` 同步解析（同一惰性点）：读 `actorSource` 亦触发一次解析、不重复触 git。
   */
  readonly actorSource: ActorSource;
  /**
   * HEAD 提交树文件集（A18 豁免基线的**唯一取数口**）。
   * 惰性 + 记忆化：首次调用才触达 git。`null` = 非 git 环境 / unborn HEAD
   * （调用方据此不豁免 —— fail-closed 于垃圾检测而非崩盘）。
   */
  headTreeFiles(): Set<string> | null;
}

/**
 * 构造器入参——全部可选。
 * 未提供 `diffRange` 时默认 `'HEAD'`（预提交审计的默认范围）。
 */
export interface AuditScopeInput {
  diffRange?: string;
  /** 显式 commit message（优先于 git 解析） */
  commitMsg?: string;
  task?: string;
  /** 显式 actor（优先于 git 解析） */
  actor?: string;
  /**
   * 测试注入：直接给定 HEAD 基线（跳过 git）。
   * 用于确定性回归锁（把 cwd 相关的 git 读取替换为固定基线 → 输出可逐字节复现）。
   */
  headTreeFiles?: () => Set<string> | null;
}

// ── git 触达计数器（测试证明「规则侧零 git」的行为证据，非仅静态 grep）──
let GIT_CALL_COUNT = 0;
/** 自上次 reset 起，本模块触达 git 的次数 */
export function scopeGitCallCount(): number {
  return GIT_CALL_COUNT;
}
/** 归零 git 触达计数（测试用） */
export function resetScopeGitCallCount(): void {
  GIT_CALL_COUNT = 0;
}

/** 唯一 git 执行口——所有 git 调用经此，计数可观测 */
function gitOut(args: string[]): string {
  GIT_CALL_COUNT += 1;
  return execFileSync('git', args, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024, // 百万级文件仓库兜底（与旧 A18 一致）
  });
}

/** HEAD 提交树文件集（非 git / unborn HEAD → null，不抛） */
function readHeadTreeFiles(): Set<string> | null {
  try {
    const out = gitOut(['ls-tree', '-r', '--name-only', 'HEAD']);
    return new Set(out.split('\n').filter(Boolean));
  } catch {
    return null;
  }
}

/** git 作者名解析（ident 优先 → user.name 兜底 → 'unknown'）——与 index.ts 既有口径一致 */
function resolveActorFromGit(): { name: string; source: ActorSource } {
  // 尝试 1：git var GIT_AUTHOR_IDENT（配置链完整时的正常路径）——失败不静默吞：
  //   记录为空名并继续兜底；「为何失败」由下方 config 步的来源判定显式承载。
  let identName = '';
  try {
    const ident = gitOut(['var', 'GIT_AUTHOR_IDENT']).trim();
    identName = ident.split('<')[0]?.trim() ?? '';
  } catch {
    identName = '';
  }
  if (identName) return { name: identName, source: 'ident' };
  // 尝试 2：git config user.name（兜底）——用 configThrew 记录本步成败作为来源判据
  let configThrew = false;
  try {
    const name = gitOut(['config', 'user.name']).trim();
    if (name) return { name, source: 'config' };
  } catch {
    configThrew = true;
  }
  // 两次都取不到名：config 成功却空 ⇒ git 可用但未配置身份（unset，正常态）；
  //   config 抛错 ⇒ git 调用失败（unavailable，异常态）——失败事实进返回值，不再被空 catch 吞掉。
  return { name: 'unknown', source: configThrew ? 'unavailable' : 'unset' };
}

/**
 * 构造 `AuditScope`——全工程唯一的 scope **构造工厂**（也是**规则侧**唯一 git 触达点）。
 *
 * ⚠️ 措辞口径（避免「全工程唯一构造点」这类过宽断言）：本函数是**唯一工厂**，但生产
 *   路径有**三处调用**同一工厂产出实例——`runner.ts`（**主构造点**，执行漏斗）、
 *   `assemble.ts`（缺 scope 兜底）、`test-utils.ts`（测试）——三者语义无分叉（同工厂、
 *   同入参口径），故应表述为「主构造点 / 唯一工厂」，而非「全工程唯一构造点」。
 *
 * 解析全部惰性（getter / 方法内首次触达才执行 git）：
 *   - `commitMsg`：显式注入优先，否则 `git log -1 --pretty=%B`；
 *   - `actor` / `actorSource`：显式注入优先，否则 git ident 链解析（同一惰性点）；
 *   - `headTreeFiles()`：注入提供者优先，否则 `git ls-tree -r HEAD`。
 * 这样「未消费的字段」不产生任何 git 调用——A18 无候选垃圾文件时依旧零 git。
 */
export function createAuditScope(input: AuditScopeInput = {}): AuditScope {
  const diffRange = input.diffRange ?? 'HEAD';
  const task = input.task;
  const explicitCommitMsg = input.commitMsg;
  const explicitActor = input.actor;
  const baselineProvider = input.headTreeFiles;

  let commitMsgResolved = false;
  let commitMsgValue: string | undefined;
  let commitMsgErr: string | undefined;

  let actorResolved = false;
  let actorValue = 'unknown';
  let actorSourceValue: ActorSource = 'unset';

  let baselineResolved = false;
  let baselineValue: Set<string> | null = null;

  const ensureCommitMsg = (): void => {
    if (commitMsgResolved) return;
    commitMsgResolved = true;
    if (explicitCommitMsg !== undefined) {
      commitMsgValue = explicitCommitMsg;
      return;
    }
    try {
      commitMsgValue = gitOut(['log', '-1', '--pretty=%B']).trim();
    } catch (err) {
      commitMsgErr = (err as Error).message;
      commitMsgValue = undefined;
    }
  };

  // actor 与 actorSource 同一惰性点解析：读任一 getter 均触发一次（记忆化）
  const ensureActor = (): void => {
    if (actorResolved) return;
    actorResolved = true;
    if (explicitActor !== undefined) {
      actorValue = explicitActor;
      actorSourceValue = 'explicit';
      return;
    }
    const resolved = resolveActorFromGit();
    actorValue = resolved.name;
    actorSourceValue = resolved.source;
  };

  return {
    diffRange,
    task: task,
    get commitMsg(): string | undefined {
      ensureCommitMsg();
      return commitMsgValue;
    },
    get commitMsgError(): string | undefined {
      ensureCommitMsg();
      return commitMsgErr;
    },
    get actor(): string {
      ensureActor();
      return actorValue;
    },
    get actorSource(): ActorSource {
      ensureActor();
      return actorSourceValue;
    },
    headTreeFiles(): Set<string> | null {
      if (!baselineResolved) {
        baselineResolved = true;
        baselineValue = baselineProvider ? baselineProvider() : readHeadTreeFiles();
      }
      return baselineValue;
    },
  };
}
