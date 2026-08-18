// ============================================================
// degradation.ts · 分级降级梯队（v1.3.7 交付⑭ · 韧性设计 · OpenFDE 启发）
//
// 定位：sofagent 当前的降级是二态（全功能 / crash）。本模块补分级降级
// 梯队——当某个能力不可用时，逐级降级而非整盘崩溃：
//   full（全部规则 + LLM 审计）
//     → rules-only（纯 git-diff 规则，LLM 不可用时）
//     → minimal（只跑 A1-A11 核心安全规则，审计引擎超时时）
//     → safe-stop（全部规则都跑不动时，安全停止不破坏）
// workflow never stops = 总有一级能兜底。
//
// 三个降级触发器（可检测）：
//   llm-unavailable  LLM 不可用（连接拒绝 / API 宕机 / 鉴权失败 / 超时）
//   audit-timeout    审计引擎超时（runRules 超过阈值未返回）
//   daemon-crash     daemon 崩溃（health 心跳停滞 / status=stopped）
//
// ⚠️ 铁律：
//   1. 状态机单向降级（full→rules-only→minimal→safe-stop），不越级回跳
//   2. 每次降级写审计日志（emitDecision kind=FALLBACK_DEGRADE），
//      记录降级原因 + 降级到哪级 + 上一级持续多久
//   3. 降级动作本身绝不抛错阻塞主流程——writeAuditLog 内部吞错降级
// ============================================================

import { emitDecision } from './decision-log';

/** 降级级别（四级梯队，从轻到重） */
export type DegradationLevel = 'full' | 'rules-only' | 'minimal' | 'safe-stop';

/** 降级触发器（三类可检测故障） */
export type DegradationTrigger = 'llm-unavailable' | 'audit-timeout' | 'daemon-crash';

/** 级别顺序（单一事实源——状态机转移、能力映射、过滤都从这派生） */
export const LEVEL_ORDER: readonly DegradationLevel[] = ['full', 'rules-only', 'minimal', 'safe-stop'];

/** minimal 级保留的核心安全规则编号区间（A1-A11，对齐 changelog「只跑 A1-A11」） */
export const CORE_RULE_MIN = 1;
export const CORE_RULE_MAX = 11;

/** 单个降级事件的记录 */
export interface DegradationRecord {
  /** 降级前级别 */
  from: DegradationLevel;
  /** 降级后级别 */
  to: DegradationLevel;
  /** 触发器（recover 时为 null） */
  trigger: DegradationTrigger | null;
  /** 降级原因（人类可读） */
  reason: string;
  /** 事件时间（ISO 8601 UTC） */
  ts: string;
  /** 在 `from` 级别持续了多久才发生本次转移（毫秒） */
  durationMs: number;
  /** 转移方向：degrade=降级 / recover=恢复 */
  direction: 'degrade' | 'recover';
}

/** 某一级别的能力画像（调用方据此决定跑什么） */
export interface LevelCapability {
  level: DegradationLevel;
  /** 是否跑 LLM 审计 */
  llmAudit: boolean;
  /** 是否跑 git-diff 规则 */
  diffRules: boolean;
  /** 是否只跑核心安全规则（A1-A11） */
  coreOnly: boolean;
  /** 是否安全停止（不跑任何审计，保数据不破坏） */
  stops: boolean;
}

/** 触发器 → 默认降级原因文案 */
const DEFAULT_REASONS: Record<DegradationTrigger, string> = {
  'llm-unavailable': 'LLM 不可用——降级为纯 git-diff 规则审计',
  'audit-timeout': '审计引擎超时——降级为只跑核心安全规则',
  'daemon-crash': 'daemon 崩溃——安全停止，不破坏已有数据',
};

/** 级别 → 能力画像（单一事实源） */
const CAPABILITIES: Record<DegradationLevel, LevelCapability> = {
  full: { level: 'full', llmAudit: true, diffRules: true, coreOnly: false, stops: false },
  'rules-only': { level: 'rules-only', llmAudit: false, diffRules: true, coreOnly: false, stops: false },
  minimal: { level: 'minimal', llmAudit: false, diffRules: true, coreOnly: true, stops: false },
  'safe-stop': { level: 'safe-stop', llmAudit: false, diffRules: false, coreOnly: false, stops: true },
};

/** 获取某级别的能力画像 */
export function getCapability(level: DegradationLevel): LevelCapability {
  return CAPABILITIES[level];
}

/**
 * 按级别过滤规则（minimal 只保留 A1-A11；safe-stop 清空）。
 * full / rules-only 不过滤（全量跑 git-diff 规则）。
 * @param rules 规则数组（需带 number 字段）
 * @param level 当前降级级别
 */
export function filterRulesForLevel<T extends { number: number }>(rules: T[], level: DegradationLevel): T[] {
  if (level === 'full' || level === 'rules-only') return rules;
  if (level === 'minimal') return rules.filter((r) => r.number >= CORE_RULE_MIN && r.number <= CORE_RULE_MAX);
  return []; // safe-stop
}

// ── 三个触发器检测器（可检测 = 能从错误/健康状态判定出触发器类型）──

/**
 * 检测 LLM 不可用——匹配常见网络/鉴权/服务故障特征。
 * @param err LLM 调用抛出的错误（或错误消息字符串）
 */
export function isLlmUnavailable(err: unknown): boolean {
  const msg = errToMessage(err).toLowerCase();
  if (msg === '') return false;
  const patterns = [
    'econnrefused', 'econnreset', 'enotfound', 'eai_again', 'etimedout',
    'connection refused', 'connection reset', 'network', 'socket hang up',
    'fetch failed', 'timeout', 'timed out',
    '401', '403', 'unauthorized', 'forbidden', 'invalid api key', 'auth',
    '429', 'rate limit', 'too many requests',
    '500', '502', '503', '504', 'service unavailable', 'bad gateway', 'internal server error',
    'api down', 'llm unavailable', 'model unavailable', 'provider error',
  ];
  return patterns.some((p) => msg.includes(p));
}

/**
 * 检测审计引擎超时——错误指明超时，或耗时超过阈值。
 * @param err runRules 抛出的错误（可选）
 * @param elapsedMs 实际耗时（可选，与 timeoutMs 比较）
 * @param timeoutMs 超时阈值（默认 30s）
 */
export function isAuditTimeout(err: unknown, elapsedMs?: number, timeoutMs = 30_000): boolean {
  const msg = errToMessage(err).toLowerCase();
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('etimedout')) return true;
  if (typeof elapsedMs === 'number' && elapsedMs > timeoutMs) return true;
  return false;
}

/**
 * 检测 daemon 崩溃——health 缺失 / status=stopped / 心跳停滞。
 * @param health daemon 健康对象（可为 null = daemon 从未运行）
 * @param staleThresholdMs 心跳停滞阈值（默认 10min，与 daemon-health 对齐）
 */
export function isDaemonCrash(
  health: { status?: string; lastHeartbeat?: string } | null,
  staleThresholdMs = 10 * 60 * 1000,
): boolean {
  if (!health) return true; // daemon 从未运行视为不可用
  if (health.status === 'stopped') return true;
  if (health.lastHeartbeat) {
    const hb = new Date(health.lastHeartbeat).getTime();
    if (!isNaN(hb) && Date.now() - hb > staleThresholdMs) return true;
  }
  return false;
}

/** 从任意错误对象提取消息文本 */
function errToMessage(err: unknown): string {
  if (err == null) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return String(err);
}

/** DegradationManager 构造选项 */
export interface DegradationManagerOptions {
  /** 审计日志的 agentId（缺省 'sofagent'） */
  agentId?: string;
  /** 审计日志的 sessionId（缺省 'degradation'） */
  sessionId?: string;
  /** 数据目录覆盖（测试隔离用，透传 emitDecision dataDir） */
  dataDir?: string;
  /** 时间源注入（测试用，缺省 Date.now） */
  now?: () => number;
}

/**
 * 分级降级状态机——管理当前降级级别 + 降级历史 + 审计留痕。
 *
 * 用法：
 *   const dm = new DegradationManager({ dataDir });
 *   if (isLlmUnavailable(err)) dm.degrade('llm-unavailable');
 *   const cap = getCapability(dm.getLevel());  // 按能力画像跑审计
 *
 * 线程安全：单进程内同步调用，无并发问题；跨进程请各自实例化。
 */
export class DegradationManager {
  private level: DegradationLevel = 'full';
  private enteredAt: number;
  private readonly history: DegradationRecord[] = [];
  private readonly opts: DegradationManagerOptions;
  private readonly nowFn: () => number;

  constructor(opts: DegradationManagerOptions = {}) {
    this.opts = opts;
    this.nowFn = opts.now ?? Date.now;
    this.enteredAt = this.nowFn();
  }

  /** 当前降级级别 */
  getLevel(): DegradationLevel {
    return this.level;
  }

  /** 当前级别已持续多久（毫秒） */
  getCurrentLevelDuration(): number {
    return this.nowFn() - this.enteredAt;
  }

  /** 降级历史（时间升序） */
  getHistory(): DegradationRecord[] {
    return [...this.history];
  }

  /** 是否已处于安全停止（最重降级，无法再降） */
  isSafeStopped(): boolean {
    return this.level === 'safe-stop';
  }

  /**
   * 降级一级（full→rules-only→minimal→safe-stop）。
   * 已在 safe-stop 时返回 null（无法再降）。
   * @param trigger 触发器
   * @param reason 自定义原因（缺省用触发器默认文案）
   * @returns 降级记录；无法降级时 null
   */
  degrade(trigger: DegradationTrigger, reason?: string): DegradationRecord | null {
    const idx = LEVEL_ORDER.indexOf(this.level);
    if (idx >= LEVEL_ORDER.length - 1) return null;
    const to = LEVEL_ORDER[idx + 1]!;
    return this.transition(this.level, to, trigger, reason ?? DEFAULT_REASONS[trigger], 'degrade');
  }

  /**
   * 直接降级到指定级别（只允许向下，跨级也一步到位）。
   * 目标不比当前级别更重时返回 null。
   */
  degradeTo(target: DegradationLevel, trigger: DegradationTrigger, reason?: string): DegradationRecord | null {
    const cur = LEVEL_ORDER.indexOf(this.level);
    const tgt = LEVEL_ORDER.indexOf(target);
    if (tgt <= cur) return null;
    return this.transition(this.level, target, trigger, reason ?? DEFAULT_REASONS[trigger], 'degrade');
  }

  /**
   * 恢复一级（safe-stop→minimal→rules-only→full）。
   * 已在 full 时返回 null。恢复同样写审计日志（direction=recover）。
   */
  recover(reason?: string): DegradationRecord | null {
    const idx = LEVEL_ORDER.indexOf(this.level);
    if (idx <= 0) return null;
    const to = LEVEL_ORDER[idx - 1]!;
    return this.transition(this.level, to, null, reason ?? '故障恢复——降级级别上调', 'recover');
  }

  /** 状态机转移（私有唯一入口——保证历史 + 审计 + 级别原子更新） */
  private transition(
    from: DegradationLevel,
    to: DegradationLevel,
    trigger: DegradationTrigger | null,
    reason: string,
    direction: 'degrade' | 'recover',
  ): DegradationRecord {
    const now = this.nowFn();
    const durationMs = now - this.enteredAt;
    const record: DegradationRecord = {
      from,
      to,
      trigger,
      reason,
      ts: new Date(now).toISOString(),
      durationMs,
      direction,
    };
    this.history.push(record);
    this.level = to;
    this.enteredAt = now;
    this.writeAuditLog(record);
    return record;
  }

  /**
   * 每次降级/恢复写审计日志（kind=FALLBACK_DEGRADE）。
   * ⚠️ 绝不抛错——降级是韧性兜底，审计写失败不能反过来压垮主流程。
   */
  private writeAuditLog(record: DegradationRecord): void {
    try {
      emitDecision(
        {
          agentId: this.opts.agentId ?? 'sofagent',
          sessionId: this.opts.sessionId ?? 'degradation',
          kind: 'FALLBACK_DEGRADE',
          moment: 'ATTRIBUTION',
          why: {
            text: `${record.direction === 'degrade' ? '降级' : '恢复'} ${record.from} → ${record.to}（上一级持续 ${record.durationMs}ms）：${record.reason}`,
            tags: ['degradation', record.direction, ...(record.trigger ? [record.trigger] : [])],
            confidence: 'high',
          },
        },
        this.opts.dataDir,
      );
    } catch {
      // 降级审计写失败——吞错（降级动作本身不能因审计失败而中断）
    }
  }
}
