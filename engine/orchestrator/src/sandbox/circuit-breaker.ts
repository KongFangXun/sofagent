// ============================================================
// circuit-breaker.ts · SubAgent 断路器 + 行为监控（竞品吸收③）
// v1.3.7 交付⑤ 新增
//
// 来源：Microsoft Agent Governance Toolkit——Agent SRE（熔断开关）+
//   Agent Hypervisor（行为监控）。覆盖 OWASP ASI08（级联故障）+ ASI10（失控 agent）。
//
// 两个运行时治理能力：
//   1. 断路器：SubAgent 连续 N 次失败自动熔断（暂停调用 + 通知人工）——防级联
//   2. 行为监控：工具调用率/失败率/权限提升尝试三指标采集，超阈值自动隔离
//      （切回人工模式）——与沙箱联动：隔离态 SubAgent 不再有新任务
//
// 两者均有恢复路径（人工确认后复位，不永久卡死）
// ============================================================

/** 熔断状态 */
export type BreakerState = 'closed' | 'open' | 'half-open';

/** 行为指标快照 */
export interface BehaviorMetrics {
  /** 时间窗口内的工具调用率（次/分钟） */
  callRatePerMin: number;
  /** 失败率（0-1） */
  failureRate: number;
  /** 权限提升尝试次数 */
  elevationAttempts: number;
}

/** 行为监控阈值 */
export interface BehaviorThresholds {
  /** 调用率上限（次/分钟，默认 120——超过视为失控循环） */
  maxCallRatePerMin: number;
  /** 失败率上限（0-1，默认 0.5） */
  maxFailureRate: number;
  /** 权限提升尝试上限（默认 3） */
  maxElevationAttempts: number;
}

export const DEFAULT_BEHAVIOR_THRESHOLDS: BehaviorThresholds = {
  maxCallRatePerMin: 120,
  maxFailureRate: 0.5,
  maxElevationAttempts: 3,
};

/** 断路器/监控事件（审计出口——写审计日志） */
export interface GovernanceEvent {
  ts: string;
  agentId: string;
  type: 'breaker-open' | 'breaker-half-open' | 'breaker-closed' | 'isolation' | 'recovery' | 'threshold-warning';
  detail: string;
  /** 触发指标快照（隔离/警告时附带） */
  metrics?: BehaviorMetrics;
}

export interface CircuitBreakerOptions {
  /** 连续失败熔断阈值 N（默认 3——文档化默认值） */
  failureThreshold?: number;
  /** half-open 探测等待（ms，默认 60s——人工确认前的冷却） */
  resetTimeoutMs?: number;
  /** 行为阈值 */
  thresholds?: Partial<BehaviorThresholds>;
  /** 指标窗口（ms，默认 60s 滑窗） */
  metricsWindowMs?: number;
  /** 通知回调（熔断/隔离时调用——通知人工） */
  notify?: (event: GovernanceEvent) => void;
}

export interface CircuitBreaker {
  /** 记录一次调用结果（守卫先于调用方重试决策） */
  recordCall(agentId: string, ok: boolean): void;
  /** 记录一次权限提升尝试（行为监控第三指标） */
  recordElevationAttempt(agentId: string): void;
  /** 判定该 agent 是否可接新任务（隔离态/熔断态 = false——与沙箱联动） */
  canAcceptTask(agentId: string): boolean;
  /** 当前熔断状态 */
  state(agentId: string): BreakerState;
  /** 当前行为指标 */
  metrics(agentId: string): BehaviorMetrics;
  /** 人工恢复（复位断路器 + 解除隔离——恢复路径） */
  recover(agentId: string, by: string): void;
  /** 事件导出（审计出口） */
  exportEvents(): GovernanceEvent[];
  /** 隔离名单 */
  isolatedAgents(): string[];
}

/** 单 agent 追踪状态 */
interface AgentTrack {
  consecutiveFailures: number;
  state: BreakerState;
  isolated: boolean;
  openedAt: number;
  // 滑窗调用记录（时间戳+成败）
  calls: Array<{ ts: number; ok: boolean }>;
  elevationAttempts: number;
}

/**
 * 创建断路器 + 行为监控。
 *
 * 默认值文档化（验收标准 1）：
 *   - 连续失败熔断 N = 3（failureThreshold）
 *   - half-open 冷却 60s（resetTimeoutMs）
 *   - 行为阈值：调用率 120/min / 失败率 0.5 / 提权尝试 3 次
 */
export function createCircuitBreaker(options: CircuitBreakerOptions = {}): CircuitBreaker {
  const failureThreshold = options.failureThreshold ?? 3;
  const resetTimeoutMs = options.resetTimeoutMs ?? 60_000;
  const windowMs = options.metricsWindowMs ?? 60_000;
  const thresholds: BehaviorThresholds = { ...DEFAULT_BEHAVIOR_THRESHOLDS, ...(options.thresholds || {}) };

  const agents = new Map<string, AgentTrack>();
  const events: GovernanceEvent[] = [];

  function track(agentId: string): AgentTrack {
    let t = agents.get(agentId);
    if (!t) {
      t = { consecutiveFailures: 0, state: 'closed', isolated: false, openedAt: 0, calls: [], elevationAttempts: 0 };
      agents.set(agentId, t);
    }
    return t;
  }

  function emit(event: GovernanceEvent): void {
    events.push(event);
    options.notify?.(event); // 通知人工（验收 1：熔断事件通知）
  }

  function computeMetrics(t: AgentTrack): BehaviorMetrics {
    const now = Date.now();
    const windowStart = now - windowMs;
    const recent = t.calls.filter(c => c.ts >= windowStart);
    const windowMin = windowMs / 60_000;
    const failures = recent.filter(c => !c.ok).length;
    return {
      callRatePerMin: recent.length / Math.max(windowMin, 0.001),
      failureRate: recent.length > 0 ? failures / recent.length : 0,
      elevationAttempts: t.elevationAttempts,
    };
  }

  /** 超阈值检查（行为监控——ASI10 失控 agent） */
  function checkThresholds(agentId: string, t: AgentTrack): void {
    if (t.isolated) return; // 已隔离不重复判
    const m = computeMetrics(t);
    const over: string[] = [];
    if (m.callRatePerMin > thresholds.maxCallRatePerMin) over.push(`调用率 ${m.callRatePerMin.toFixed(0)}/min > ${thresholds.maxCallRatePerMin}`);
    if (m.failureRate > thresholds.maxFailureRate && t.calls.length >= 5) over.push(`失败率 ${(m.failureRate * 100).toFixed(0)}% > ${(thresholds.maxFailureRate * 100).toFixed(0)}%`);
    if (m.elevationAttempts > thresholds.maxElevationAttempts) over.push(`提权尝试 ${m.elevationAttempts} > ${thresholds.maxElevationAttempts}`);

    if (over.length > 0) {
      // 超阈值自动隔离（切回人工模式）——与沙箱联动：canAcceptTask=false
      t.isolated = true;
      emit({
        ts: new Date().toISOString(),
        agentId,
        type: 'isolation',
        detail: `行为超阈值自动隔离（切回人工模式）：${over.join('；')}——人工确认后 recover() 复位`,
        metrics: m,
      });
    }
  }

  return {
    recordCall(agentId, ok) {
      const t = track(agentId);
      t.calls.push({ ts: Date.now(), ok });
      // 滑窗裁剪（防内存无限涨）
      if (t.calls.length > 10_000) t.calls = t.calls.slice(-5_000);

      if (ok) {
        // 成功重置连续失败计数（half-open 探测成功 → 恢复 closed）
        t.consecutiveFailures = 0;
        if (t.state === 'half-open') {
          t.state = 'closed';
          emit({ ts: new Date().toISOString(), agentId, type: 'breaker-closed', detail: 'half-open 探测成功——熔断解除（自动恢复）' });
        }
      } else {
        t.consecutiveFailures += 1;
        // ASI08 级联故障防御：连续 N 失败 → 熔断
        if (t.state === 'closed' && t.consecutiveFailures >= failureThreshold) {
          t.state = 'open';
          t.openedAt = Date.now();
          emit({
            ts: new Date().toISOString(),
            agentId,
            type: 'breaker-open',
            detail: `连续 ${t.consecutiveFailures} 次失败——熔断（暂停该 agent 调用，通知人工；${resetTimeoutMs / 1000}s 后可 half-open 探测）`,
          });
        } else if (t.state === 'half-open') {
          // 探测失败 → 回到 open
          t.state = 'open';
          t.openedAt = Date.now();
          emit({ ts: new Date().toISOString(), agentId, type: 'breaker-open', detail: 'half-open 探测失败——回到熔断' });
        }
      }
      checkThresholds(agentId, t);
    },

    recordElevationAttempt(agentId) {
      const t = track(agentId);
      t.elevationAttempts += 1;
      checkThresholds(agentId, t);
    },

    canAcceptTask(agentId) {
      const t = agents.get(agentId);
      if (!t) return true;
      if (t.isolated) return false; // 隔离态不再接新任务（与沙箱联动）
      if (t.state === 'open') {
        // 冷却期满 → half-open（允许一次探测）
        if (Date.now() - t.openedAt >= resetTimeoutMs) {
          t.state = 'half-open';
          emit({ ts: new Date().toISOString(), agentId, type: 'breaker-half-open', detail: '冷却期满——half-open 探测（允许一次调用验证恢复）' });
          return true;
        }
        return false;
      }
      return true;
    },

    state(agentId) {
      return agents.get(agentId)?.state ?? 'closed';
    },

    metrics(agentId) {
      return computeMetrics(track(agentId));
    },

    recover(agentId, by) {
      const t = track(agentId);
      const wasDown = t.isolated || t.state !== 'closed';
      t.isolated = false;
      t.state = 'closed';
      t.consecutiveFailures = 0;
      t.elevationAttempts = 0;
      t.calls = [];
      if (wasDown) {
        emit({ ts: new Date().toISOString(), agentId, type: 'recovery', detail: `人工恢复（by ${by}）——断路器复位 + 隔离解除，不永久卡死` });
      }
    },

    exportEvents() {
      return [...events];
    },

    isolatedAgents() {
      return [...agents.entries()].filter(([, t]) => t.isolated).map(([id]) => id);
    },
  };
}
