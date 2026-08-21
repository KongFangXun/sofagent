// ============================================================
// gateway/permission-ceiling.ts · SubAgent 会话级权限上界（只减不增）
// v1.3.8 交付一 新增
//
// 背景（changelog §一权限上界段）：v1.3.9 场景驱动权限实现了判定链
// （身份→场景→风险→放行），但权限集在会话内可以扩大——SubAgent 通过
// 合法的场景切换逐步拿到更多工具面，累计权限可能超出任何单一场景的授权。
//
// 本模块补一条硬约束（接口与实现分离——判定走网关机制，不靠 prompt 约定）：
//   - 每个 SubAgent **首次请求时**锁定权限上界快照（Set<tool>）
//   - 此后上界**只减不增**（narrow 收窄，永不扩大）
//   - 请求校验「所需权限 ⊆ 上界」，越界即 deny + 审计留痕（含尝试扩大的权限项）
//   - 越界不中断任务（deny 单次请求，不熔断整个 agent）
//   - 高频越界（连续 N 次，默认 5）暴露 onViolation 回调——调用方接
//     circuit-breaker（v1.3.7 sandbox/circuit-breaker.ts）做隔离
//
// 零 npm 依赖。
// ============================================================

/** 越界判定结果 */
export interface CeilingCheckResult {
  /** 所需权限是否全部在上界内 */
  ok: boolean;
  /** 越界的权限项（ok=true 时空数组——审计点名「尝试扩大的权限」用） */
  excess: string[];
}

/** 连续越界触发阈值（默认 5——见 v1.3.8 dev-prompt 交付一） */
export const DEFAULT_VIOLATION_THRESHOLD = 5;

export interface PermissionCeilingOptions {
  /** 高频越界阈值：连续 N 次越界触发 onViolation（默认 5） */
  violationThreshold?: number;
  /**
   * 高频越界回调——调用方接 circuit-breaker：
   *   ceiling = createPermissionCeiling({
   *     onViolation: (agentId) => breaker.recordElevationAttempt(agentId),
   *   })
   * 注意：单次越界不触发（只 deny 不中断）；连续达到阈值才触发。
   */
  onViolation?: (agentId: string, excess: string[]) => void;
}

export interface PermissionCeiling {
  /** 锁定权限上界快照（首次调用生效；已锁定时本调用是 no-op——只减不增的根） */
  lock(agentId: string, tools: string[]): void;
  /** 收窄上界（只减不增——入参中不在原上界内的项被丢弃） */
  narrow(agentId: string, tools: string[]): void;
  /** 读取当前上界快照（未锁定返回 null） */
  ceiling(agentId: string): ReadonlySet<string> | null;
  /** 校验「所需权限 ⊆ 上界」（越界计数 + 高频回调在此触发） */
  check(agentId: string, required: string[]): CeilingCheckResult;
  /** 当前连续越界次数（观测用） */
  consecutiveViolations(agentId: string): number;
}

interface AgentCeiling {
  tools: Set<string>;
  consecutiveViolations: number;
}

/**
 * 创建权限上界管理器。
 *
 * 生命周期约定：网关（proxy-gateway）在每个 agent 首次请求时以初始授权集
 * 调用 lock()；此后所有 check() 都针对该快照判定。narrow() 供调用方在
 * 任务阶段切换时显式收窄（如从「可写」阶段进入「只读」阶段）。
 */
export function createPermissionCeiling(options: PermissionCeilingOptions = {}): PermissionCeiling {
  const threshold = options.violationThreshold ?? DEFAULT_VIOLATION_THRESHOLD;
  const onViolation = options.onViolation;
  const agents = new Map<string, AgentCeiling>();

  function track(agentId: string): AgentCeiling {
    let t = agents.get(agentId);
    if (!t) {
      t = { tools: new Set<string>(), consecutiveViolations: 0 };
      agents.set(agentId, t);
    }
    return t;
  }

  return {
    lock(agentId, tools) {
      const t = track(agentId);
      if (t.tools.size > 0) return; // 已锁定——首快照生效，重复 lock 不扩大（只减不增）
      t.tools = new Set(tools);
    },

    narrow(agentId, tools) {
      const t = track(agentId);
      if (t.tools.size === 0) {
        // 未锁定时 narrow 视同首次锁定（无上界可收窄）
        t.tools = new Set(tools);
        return;
      }
      // 只减不增：入参 ∩ 原上界
      const next = new Set<string>();
      for (const tool of tools) {
        if (t.tools.has(tool)) next.add(tool);
      }
      t.tools = next;
    },

    ceiling(agentId) {
      const t = agents.get(agentId);
      return t && t.tools.size > 0 ? t.tools : null;
    },

    check(agentId, required) {
      const t = agents.get(agentId);
      if (!t || t.tools.size === 0) {
        // 未锁定上界——fail-closed：全部视为越界（网关侧会先 lock，此分支防御直用）
        return { ok: false, excess: [...new Set(required)] };
      }
      const excess = [...new Set(required)].filter(tool => !t.tools.has(tool));
      if (excess.length === 0) {
        // 成功校验重置连续越界计数（间歇越界不误报高频）
        t.consecutiveViolations = 0;
        return { ok: true, excess: [] };
      }
      // 越界计数 + 高频回调
      t.consecutiveViolations += 1;
      if (t.consecutiveViolations >= threshold) {
        t.consecutiveViolations = 0; // 触发后复位——按「连续爆发」计，不无限累计
        onViolation?.(agentId, excess);
      }
      return { ok: false, excess };
    },

    consecutiveViolations(agentId) {
      return agents.get(agentId)?.consecutiveViolations ?? 0;
    },
  };
}
