// ============================================================
// policy-layer.ts · meta-harness 策略强制层
// v1.4.3（二）：策略在 meta-harness 层强制——跨 harness 状态追踪 +
// 动作前拦截（对齐 Omnigent「策略强制在基础设施层」）
//
// 设计边界：
// - 单 harness 内部的工具门禁走 v1.3.7 sandbox tool-gate；
//   本层管的是「跨 harness 的一致策略」——文件锁冲突 / 并发上限 /
//   敏感动作审批，单个 harness 自己看不见这些
// - 拦截返回结构化裁决（allow/deny/warn），不直接 throw——
//   编排层决定 deny 是跳过还是降级
// ============================================================

/** 跨 harness 可观测的动作类型 */
export type MetaActionType =
  | 'tool_call'
  | 'file_write'
  | 'net_request'
  | 'subagent_spawn'
  | 'profile_install'
  | 'report_delivery';

/** 一次待裁决的动作 */
export interface MetaAction {
  /** 发起动作的 harness 实例 ID */
  harnessId: string;
  /** 动作类型 */
  type: MetaActionType;
  /** 动作细节（工具名 / 文件路径 / URL 等） */
  detail?: string;
  /** 关联的 agent 身份码（v1.3.1 identity，缺省未知） */
  agentId?: string;
  /** 时间戳（缺省取当前） */
  timestamp?: string;
}

/** 策略裁决 */
export interface PolicyVerdict {
  /** 是否放行 */
  allowed: boolean;
  /** 命中的策略 ID 列表（deny 优先记录） */
  violated: string[];
  /** 人类可读说明（deny/warn 原因） */
  reason: string;
}

/** 一条 meta 策略声明 */
export interface MetaPolicy {
  /** 策略 ID（全局唯一） */
  id: string;
  /** 策略说明 */
  description: string;
  /**
   * 裁决函数：返回 'deny'（拒绝）| 'warn'（放行但记录）| 'allow'/undefined（不管）。
   * 只依赖 action + 当前跨 harness 状态视图——纯函数风格，便于测试。
   */
  judge(action: MetaAction, state: MetaStateView): 'deny' | 'warn' | 'allow' | undefined;
}

/** 跨 harness 状态视图（judge 的只读面） */
export interface MetaStateView {
  /** 已注册的 harness 实例数 */
  harnessCount: number;
  /** 各 harness 的命名实例（多命名实例：同一 profile 装多个实例） */
  harnessIds: readonly string[];
  /** 文件锁占用表：路径 → 持有 harnessId */
  fileLocks: ReadonlyMap<string, string>;
  /** 某 harness 正在运行的任务数 */
  runningTasks(harnessId: string): number;
  /** 某 harness 是否已安装某 Profile Bundle */
  hasProfile(harnessId: string, profileName: string): boolean;
}

// ── 内置策略（官方默认集）──────────────────────────────────

/** 文件锁互斥——跨 harness 写同一路径必须拒绝（对齐 L2 detectFileLockConflict 语义） */
export const fileLockPolicy: MetaPolicy = {
  id: 'meta/file-lock',
  description: '跨 harness 文件锁互斥：同一路径被其他 harness 持有时拒绝写入',
  judge(action, state) {
    if (action.type !== 'file_write' || !action.detail) return undefined;
    const holder = state.fileLocks.get(action.detail);
    if (holder && holder !== action.harnessId) {
      return 'deny';
    }
    return undefined;
  },
};

/** 并发上限——meta 层统一限流（防多 harness 同时跑爆机器） */
export const concurrencyCapPolicy: MetaPolicy = {
  id: 'meta/concurrency-cap',
  description: '单 harness 并发任务上限（默认 4）',
  judge(action, state) {
    if (action.type !== 'subagent_spawn') return undefined;
    if (state.runningTasks(action.harnessId) >= 4) return 'deny';
    return undefined;
  },
};

/** Profile 白名单——未登记的 Profile Bundle 不许装（供应链面，ASI04 关联） */
export const profileAllowlistPolicy: MetaPolicy = {
  id: 'meta/profile-allowlist',
  description: 'Profile Bundle 白名单：只许装 allowlist 里的 profile',
  judge(action) {
    if (action.type !== 'profile_install') return undefined;
    // 官方约定 profile 名以 sofagent- 开头或形如 @scope/*——其他一律拒绝
    const name = action.detail ?? '';
    if (/^(sofagent-|@[\w.-]+\/)/.test(name)) return undefined;
    return 'deny';
  },
};

/** 敏感工具审批——高危工具调用在 meta 层也要过一道（与 sandbox gate 分层） */
export const sensitiveToolPolicy: MetaPolicy = {
  id: 'meta/sensitive-tool',
  description: '高危工具（rm/eval/exec 族）跨 harness 一律 warn 留痕',
  judge(action) {
    if (action.type !== 'tool_call') return undefined;
    if (/\b(rm|eval|exec|spawn)\b/i.test(action.detail ?? '')) return 'warn';
    return undefined;
  },
};

// ── 策略层本体 ────────────────────────────────────────────

/**
 * meta-harness 策略强制层。
 * 用法：所有 harness 的动作在执行前调 `beforeAction`——
 * deny 即拦、warn 即放行但入审计轨迹。
 */
export class PolicyLayer {
  private readonly policies = new Map<string, MetaPolicy>();
  /** 文件锁表：路径 → 持有 harnessId（acquire 语义，显式释放） */
  private readonly fileLocks = new Map<string, string>();
  /** 各 harness 运行中任务计数 */
  private readonly running = new Map<string, number>();
  /** 各 harness 已安装 profile 集合 */
  private readonly profiles = new Map<string, Set<string>>();
  /** 拦截历史（审计轨迹的一部分，audit-aggregator 可拉取） */
  private readonly interceptionLog: Array<MetaAction & { verdict: PolicyVerdict }> = [];

  constructor(builtin = true) {
    if (builtin) {
      for (const p of [fileLockPolicy, concurrencyCapPolicy, profileAllowlistPolicy, sensitiveToolPolicy]) {
        this.policies.set(p.id, p);
      }
    }
  }

  /** 注册自定义策略（同 ID 覆盖） */
  registerPolicy(policy: MetaPolicy): void {
    this.policies.set(policy.id, policy);
  }

  /** 动作前拦截——所有策略顺序裁决，deny 优先 */
  beforeAction(action: MetaAction): PolicyVerdict {
    const view = this.stateView();
    const violated: string[] = [];
    let denied = false;
    let reason = '';
    for (const policy of this.policies.values()) {
      const v = policy.judge(action, view);
      if (v === 'deny') {
        denied = true;
        violated.push(policy.id);
        reason = `[${policy.id}] ${policy.description}（harness=${action.harnessId}, action=${action.type}${action.detail ? `, detail=${action.detail}` : ''}）`;
      } else if (v === 'warn') {
        violated.push(policy.id);
      }
    }
    const verdict: PolicyVerdict = { allowed: !denied, violated, reason };
    this.interceptionLog.push({ ...action, timestamp: action.timestamp ?? new Date().toISOString(), verdict });
    return verdict;
  }

  /** 跨 harness 状态视图（judge 的只读面） */
  stateView(): MetaStateView {
    return {
      harnessCount: this.running.size,
      harnessIds: [...this.running.keys()],
      fileLocks: this.fileLocks,
      runningTasks: (id) => this.running.get(id) ?? 0,
      hasProfile: (id, name) => this.profiles.get(id)?.has(name) ?? false,
    };
  }

  // ── 状态追踪原语（编排层调用）──

  /** harness 注册（进入 meta 编排） */
  trackHarness(harnessId: string): void {
    if (!this.running.has(harnessId)) this.running.set(harnessId, 0);
    if (!this.profiles.has(harnessId)) this.profiles.set(harnessId, new Set());
  }

  /** harness 注销 */
  untrackHarness(harnessId: string): void {
    this.running.delete(harnessId);
    // 释放其持有的文件锁，防泄漏死锁
    for (const [path, holder] of [...this.fileLocks]) {
      if (holder === harnessId) this.fileLocks.delete(path);
    }
  }

  /** 任务开始/结束计数 */
  trackTaskStart(harnessId: string): void {
    this.running.set(harnessId, (this.running.get(harnessId) ?? 0) + 1);
  }

  trackTaskEnd(harnessId: string): void {
    const cur = this.running.get(harnessId) ?? 0;
    this.running.set(harnessId, Math.max(0, cur - 1));
  }

  /** 文件锁获取（同 harness 幂等重入） */
  acquireFileLock(harnessId: string, path: string): boolean {
    const holder = this.fileLocks.get(path);
    if (holder && holder !== harnessId) return false;
    this.fileLocks.set(path, harnessId);
    return true;
  }

  /** 文件锁释放 */
  releaseFileLock(harnessId: string, path: string): void {
    if (this.fileLocks.get(path) === harnessId) this.fileLocks.delete(path);
  }

  /** Profile 安装登记 */
  trackProfileInstall(harnessId: string, profileName: string): void {
    let set = this.profiles.get(harnessId);
    if (!set) { set = new Set(); this.profiles.set(harnessId, set); }
    set.add(profileName);
  }

  /** 拉取拦截历史（审计聚合消费） */
  getInterceptionLog(): ReadonlyArray<MetaAction & { verdict: PolicyVerdict }> {
    return this.interceptionLog;
  }
}
