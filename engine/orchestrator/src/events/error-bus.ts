// ============================================================
// events/error-bus.ts · AI 异常处理总线（v1.5.2 第三章新建）
// ============================================================
//
// Agent 执行异常不再各节点自兜底——统一进总线做**三分类路由**：
//
//   可重试   → 重试队列（第一章死信通道 + v1.3.1 退避阶梯）
//   需人工   → HITL 审批队列（hitl-channel 的 pending 文件通道）
//   需回滚   → 回溯能力（core restoreSnapshot——与 snapshot_restore 工具同原语，
//              经 `deps.rollback` **注入**执行器；**未注入 ⇒ fail-closed 不回滚**，
//              绝不拿 `process.cwd()` 兜底去回滚用户当前工程目录）
//
// 🔴 入口复用第一章死信通道：所有异常一律先经 `bus.sendToDeadLetter()` 入
//    死信队列（本文件**不新建第二套死信机制**），再按下分类做具体路由动作。
//
// 🔴 留痕：异常进总线即写 decision-log（emitDecision），挂 v1.4.4 `causedBy`
//    因果边；kind 取值按任务书钉死的映射表复用既有枚举值（本版禁止新增 kind）：
//
//    | 异常分类 | 复用 kind        | why 必带标签      |
//    |----------|------------------|-------------------|
//    | 可重试   | FALLBACK_DEGRADE | retryable         |
//    | 需人工   | ESCALATE_REPORT  | needs-human       |
//    | 需回滚   | EVOLUTION        | needs-rollback    |
//
//    映射收敛在 ANOMALY_DECISION_KIND / ANOMALY_WHY_TAG 两个常量表——
//    三分类的留痕区分度是**结构保证**，不是调用方自觉。
// ============================================================

import { emitDecision } from '@sofagent/audit';
import type { DecisionKind } from '@sofagent/audit';
import {
  classifyError,
  getDataDir,
  isRetryableStopReason,
  MAX_RETRY_COUNT,
  type StopReason,
} from '@sofagent/core';
import { HITL_OPTIONS, writeHITLRequest, type HITLRequest } from '../hitl/hitl-channel';
import { EventBus } from './bus';
import { EVENT_TYPES, type SofagentEvent } from './types';

// ────────────────────────────────────────────────────────────
// 三分类（枚举 + 留痕映射表——勿自行发挥）
// ────────────────────────────────────────────────────────────

/** 异常三分类 */
export type AnomalyClass = 'retryable' | 'needs-human' | 'needs-rollback';

/**
 * 三分类 → DecisionKind 映射（任务书钉死；本版禁止新增 kind）。
 *
 * 语义依据取自 `engine/audit/src/decision-schema.ts` 的枚举注释：
 *   FALLBACK_DEGRADE「降级执行（LLM 不可用等）」
 *   ESCALATE_REPORT 「上报问题/升级人工」
 *   EVOLUTION       「进化动作（…/ 回滚）」
 */
export const ANOMALY_DECISION_KIND: Record<AnomalyClass, DecisionKind> = {
  retryable: 'FALLBACK_DEGRADE',
  'needs-human': 'ESCALATE_REPORT',
  'needs-rollback': 'EVOLUTION',
};

/** 三分类 → why 必带标签（验收断言按表核对） */
export const ANOMALY_WHY_TAG: Record<AnomalyClass, string> = {
  retryable: 'retryable',
  'needs-human': 'needs-human',
  'needs-rollback': 'needs-rollback',
};

// ────────────────────────────────────────────────────────────
// 入参 / 出参
// ────────────────────────────────────────────────────────────

/** 异常上报入参 */
export interface AnomalyInput {
  /** 异常对象（Error 或任意可字符串化值） */
  error: unknown;
  /** 已知的 stop_reason（缺省按 error 现场分类） */
  stopReason?: StopReason;
  /** 异常来源事件（有则进第一章死信通道时携带完整事件上下文） */
  event?: SofagentEvent;
  /** 所属 workflow / 节点 */
  workflowId?: string;
  nodeId?: string;
  /** 决策留痕主体（缺省 agentId='orchestrator:error-bus'） */
  agentId?: string;
  sessionId?: string;
  /** 已尝试次数（缺省 1） */
  attempts?: number;
  /** 允许的重试上限（缺省 v1.3.1 MAX_RETRY_COUNT=5） */
  maxRetries?: number;
  /** 副作用已落地（用于「需回滚」判定） */
  sideEffectsApplied?: boolean;
  /** 显式要求回滚 */
  requiresRollback?: boolean;
  /** 显式要求人工介入 */
  requiresHuman?: boolean;
  /** 因果边：上游决策条目 ts（挂 causedBy） */
  causedBy?: string[];
  /** 回滚目标（注入回滚执行器时使用；未注入执行器则整段 fail-closed 跳过，不取 cwd 兜底） */
  rollback?: { projectDir?: string; snapshotSha?: string };
}

/** 回滚执行结局 */
export interface RollbackOutcome {
  attempted: boolean;
  executed: boolean;
  snapshotSha?: string;
  restoredFiles?: number;
  error?: string;
}

/** 路由动作结局 */
export interface AnomalyRouting {
  /** 重试队列（可重试类；沿用死信通道条目） */
  retry: { queued: true; deadLetterId: string; nextRetryDelayMs: number } | null;
  /** HITL 审批队列（需人工类） */
  hitl: { checkpointId: string; pendingPath: string } | null;
  /** 回溯能力（需回滚类） */
  rollback: RollbackOutcome | null;
}

/** 异常上报结果 */
export interface AnomalyRoutingResult {
  anomalyClass: AnomalyClass;
  /** 落盘使用的 DecisionKind（按映射表） */
  decisionKind: DecisionKind;
  /** why 必带标签 */
  whyTag: string;
  /** decision-log 条目 ts（可作下游决策的 causedBy 锚点） */
  decisionTs: string;
  /** 死信 id（异常入口——第一章死信通道） */
  deadLetterId: string;
  /** stop_reason 六值分类 */
  stopReason: StopReason;
  /** 路由动作结局 */
  routed: AnomalyRouting;
}

/** 总线依赖（回滚/HITL 写入可注入——测试注入假实现，生产走既有原语） */
export interface AnomalyBusDeps {
  /** 第一章事件总线（异常入口 = 其死信通道） */
  bus: EventBus;
  /** 数据目录覆盖（缺省走 getDataDir） */
  dataDir?: string;
  /**
   * 回滚执行器（与 snapshot_restore 工具同原语：core restoreSnapshot）。
   *
   * 🔴 **未注入 ⇒ fail-closed 不回滚**（v1.5.1 修复批）：原缺省实现拿 `process.cwd()`
   * 当 `projectDir` 去 `restoreSnapshot`——那会回滚**用户的当前工程目录**。现改为：
   * 未注入执行器时不执行回滚，并把「已跳过」写进 decision-log evidence 与 HITL 留痕。
   */
  rollback?: (input: { projectDir: string; snapshotSha?: string }) => RollbackOutcome;
  /** HITL 请求写入器（缺省 = hitl-channel writeHITLRequest） */
  writeHitl?: (request: HITLRequest) => string;
}

// ────────────────────────────────────────────────────────────
// 分类
// ────────────────────────────────────────────────────────────

/**
 * 异常三分类（判定顺序——先显式声明，再错误性质与副作用，最后重试余额）。
 *
 *   ① requiresHuman         → needs-human（调用方显式声明优先）
 *   ② requiresRollback      → needs-rollback
 *   ③ 不可重试（auth/aborted/completed，v1.3.1 isRetryableStopReason 判定）
 *        · 有副作用落地 → needs-rollback（脏数据先清）
 *        · 否则         → needs-human（凭证/用户中断只能人处理）
 *   ④ 可重试（timeout/malformed/failed）
 *        · 有副作用落地 → needs-rollback（盲重试会叠加脏写）
 *        · 重试余额耗尽 → needs-human（自动路径已到边界，交人判断）
 *        · 否则         → retryable
 *
 * @param input 异常上下文
 * @returns 三分类之一
 */
export function classifyAnomaly(input: {
  error: unknown;
  stopReason?: StopReason;
  attempts?: number;
  maxRetries?: number;
  sideEffectsApplied?: boolean;
  requiresRollback?: boolean;
  requiresHuman?: boolean;
}): AnomalyClass {
  if (input.requiresHuman === true) return 'needs-human';
  if (input.requiresRollback === true) return 'needs-rollback';

  const stopReason = input.stopReason ?? classifyError(input.error);
  const retryable = isRetryableStopReason(stopReason);
  const dirty = input.sideEffectsApplied === true;

  if (!retryable) return dirty ? 'needs-rollback' : 'needs-human';

  if (dirty) return 'needs-rollback';
  const attempts = input.attempts ?? 1;
  const maxRetries = input.maxRetries ?? MAX_RETRY_COUNT;
  return attempts > maxRetries ? 'needs-human' : 'retryable';
}

// ────────────────────────────────────────────────────────────
// 异常总线
// ────────────────────────────────────────────────────────────

/**
 * 异常总线——三分类路由 + 全程留痕。
 *
 * 用法（节点兜底出口 / 事件路由失败处）：
 *   const anomalies = new AnomalyBus({ bus });
 *   await anomalies.report({ error, nodeId, causedBy: [路由决策 ts] });
 *   // 从死信通道进来的异常：await anomalies.reportFromDeadLetter(deadLetterId)
 */
export class AnomalyBus {
  private readonly bus: EventBus;
  private readonly dataDir: string;
  /** 注入的回滚执行器（未注入 = null ⇒ 需回滚类 fail-closed 跳过，不取 process.cwd() 兜底） */
  private readonly rollbackFn: ((input: { projectDir: string; snapshotSha?: string }) => RollbackOutcome) | null;
  private readonly writeHitlFn: (request: HITLRequest) => string;

  constructor(deps: AnomalyBusDeps) {
    this.bus = deps.bus;
    this.dataDir = deps.dataDir ?? deps.bus.dataDir ?? getDataDir();
    this.rollbackFn = deps.rollback ?? null;
    this.writeHitlFn = deps.writeHitl ?? ((request) => {
      writeHITLRequest(this.dataDir, request);
      return `${this.dataDir}/hitl/pending/${request.checkpointId}.json`;
    });
  }

  /**
   * 上报异常：分类 → 写 decision-log（挂因果边）→ 进死信通道 → 按分类路由。
   *
   * @param input 异常上下文
   * @returns 分类 + 留痕 ts + 死信 id + 路由结局
   */
  report(input: AnomalyInput): AnomalyRoutingResult {
    const stopReason = input.stopReason ?? classifyError(input.error);
    const errorText = input.error instanceof Error ? input.error.message : String(input.error ?? '');
    const anomalyClass = classifyAnomaly({ ...input, error: input.error, stopReason });
    const kind = ANOMALY_DECISION_KIND[anomalyClass];
    const tag = ANOMALY_WHY_TAG[anomalyClass];

    // 需回滚类但**未注入回滚执行器** ⇒ 本次不会执行回滚（fail-closed，不取 process.cwd()
    // 兜底——那会回滚用户当前工程目录）。该事实先于动作写进 decision-log evidence（先留痕后动作）。
    const rollbackSkipReason =
      anomalyClass === 'needs-rollback' && this.rollbackFn === null
        ? '未注入回滚执行器，已跳过回滚（不取 process.cwd() 兜底）'
        : undefined;

    // ① 异常进总线即写 decision-log（挂 causedBy 因果边）
    const decisionTs = this.writeAnomalyDecision({
      input,
      anomalyClass,
      kind,
      tag,
      stopReason,
      errorText,
      ...(rollbackSkipReason !== undefined ? { rollbackSkipReason } : {}),
    });

    // ② 入口 = 第一章死信通道（不新建第二套死信机制）
    const event = input.event ?? this.synthesizeEvent(input, stopReason, errorText);
    const deadLetterId = this.bus.sendToDeadLetter(event, {
      nodeId: input.nodeId,
      error: errorText,
      stopReason,
      attempts: input.attempts ?? event.attempt ?? 1,
      decisionTs,
      anomalyClass,
    });

    // ③ 按分类路由到对应处理器
    const routed: AnomalyRouting = { retry: null, hitl: null, rollback: null };
    if (anomalyClass === 'retryable') {
      const entry = this.bus.getDeadLetter(deadLetterId);
      routed.retry = {
        queued: true,
        deadLetterId,
        nextRetryDelayMs: entry?.nextRetryDelayMs ?? 0,
      };
    } else if (anomalyClass === 'needs-human') {
      routed.hitl = this.enqueueHitl(input, stopReason, errorText, anomalyClass);
    } else {
      // fail-closed（v1.5.1 修复批）：**未注入执行器 ⇒ 不回滚**——缺省实现曾拿
      // `process.cwd()` 当 projectDir 去 restoreSnapshot，可能回滚**用户的当前工程目录**。
      // 注入执行器时行为与既有版本逐字一致（projectDir 仍缺省取 cwd，属调用方 opt-in）。
      const outcome: RollbackOutcome =
        this.rollbackFn !== null
          ? this.rollbackFn({
              projectDir: input.rollback?.projectDir ?? process.cwd(),
              ...(input.rollback?.snapshotSha !== undefined ? { snapshotSha: input.rollback.snapshotSha } : {}),
            })
          : {
              attempted: false,
              executed: false,
              error: rollbackSkipReason ?? '未注入回滚执行器，已跳过回滚（不取 process.cwd() 兜底）',
            };
      routed.rollback = outcome;
      if (!outcome.executed) {
        // 回滚不可执行（无可用快照等）→ 同时进人工队列，不静默留在自动路径
        routed.hitl = this.enqueueHitl(
          input,
          stopReason,
          `${errorText}（回滚未执行：${outcome.error ?? '未知原因'}）`,
          anomalyClass,
        );
      }
    }

    return {
      anomalyClass,
      decisionKind: kind,
      whyTag: tag,
      decisionTs,
      deadLetterId,
      stopReason,
      routed,
    };
  }

  /**
   * 从死信条目上报异常——**异常入口复用第一章死信通道**的正规路径。
   *
   * 因果边缺省取死信条目上的 decisionTs（第一章事件路由决策 ts）——
   * 形成「事件路由 → 异常处理」的真实因果链。
   *
   * @param deadLetterId 死信 id
   * @returns 异常上报结果（死信不存在返回 null）
   */
  reportFromDeadLetter(deadLetterId: string): AnomalyRoutingResult | null {
    const entry = this.bus.getDeadLetter(deadLetterId);
    if (!entry) return null;
    return this.report({
      error: entry.error,
      stopReason: entry.stopReason,
      event: entry.event,
      ...(entry.nodeId !== undefined ? { nodeId: entry.nodeId } : {}),
      ...(entry.event.workflowId !== undefined ? { workflowId: entry.event.workflowId } : {}),
      attempts: entry.attempts,
      ...(entry.decisionTs !== undefined ? { causedBy: [entry.decisionTs] } : {}),
    });
  }

  /**
   * 可重试队列视图（复用死信通道条目——按 retryable 过滤）。
   *
   * 重放走 `bus.replayDeadLetter(id)`（退避阶梯由 bus 统一施加）。
   */
  listRetryQueue(): Array<{ deadLetterId: string; eventType: string; stopReason: StopReason; attempts: number; nextRetryDelayMs: number }> {
    return this.bus
      .listDeadLetters()
      .filter((d) => d.retryable)
      .map((d) => ({
        deadLetterId: d.id,
        eventType: d.event.type,
        stopReason: d.stopReason,
        attempts: d.attempts,
        nextRetryDelayMs: d.nextRetryDelayMs,
      }));
  }

  // ────────────────────────────────────────────────────────
  // 内部
  // ────────────────────────────────────────────────────────

  /** 写异常决策（kind / why 标签来自映射表——留痕区分度是结构保证） */
  private writeAnomalyDecision(args: {
    input: AnomalyInput;
    anomalyClass: AnomalyClass;
    kind: DecisionKind;
    tag: string;
    stopReason: StopReason;
    errorText: string;
    /** 需回滚但未注入执行器时的跳过事实（写进 evidence——留痕先于动作） */
    rollbackSkipReason?: string;
  }): string {
    const { input, anomalyClass, kind, tag, stopReason, errorText, rollbackSkipReason } = args;
    const target = [input.workflowId, input.nodeId].filter(Boolean).join('/') || '未知节点';
    const entry = emitDecision(
      {
        agentId: input.agentId ?? 'orchestrator:error-bus',
        sessionId:
          input.sessionId ??
          input.event?.correlationId ??
          `anomaly-${input.nodeId ?? input.workflowId ?? 'unknown'}`,
        kind,
        // category 是五分类闭合枚举（route/select/skip/retry/escalate），**没有 rollback 档**。
        //   故 needs-rollback 一律**不传** category——原实现把它落成 'retry'，读 decision-log
        //   的人会以为这条异常在重试，而它的正确处置是 snapshot_restore。category 本身可选
        //   （不传即无此字段，向后兼容），缺失比标错诚实。
        ...(anomalyClass === 'needs-human'
          ? { category: 'escalate' as const }
          : anomalyClass === 'retryable'
            ? { category: 'retry' as const }
            : {}),
        moment: 'ATTRIBUTION',
        why: {
          text: `[异常总线] ${anomalyClass}：${target} 失败（stop_reason=${stopReason}）：${errorText}`,
          tags: [tag, 'anomaly-bus', `stop-${stopReason}`],
          confidence: 'high',
        },
        ...(input.causedBy !== undefined && input.causedBy.length > 0
          ? { causedBy: input.causedBy, causalType: 'caused' as const }
          : {}),
        evidence: [
          `异常分类=${anomalyClass}`,
          `stop_reason=${stopReason}`,
          `节点=${target}`,
          `已尝试=${input.attempts ?? 1}`,
          ...(rollbackSkipReason !== undefined ? [`回滚=${rollbackSkipReason}`] : []),
        ],
      },
      this.dataDir,
    );
    return entry.ts;
  }

  /** 进 HITL 审批队列（复用 hitl-channel 的 pending 文件通道，不新建队列） */
  private enqueueHitl(
    input: AnomalyInput,
    stopReason: StopReason,
    errorText: string,
    anomalyClass: AnomalyClass,
  ): { checkpointId: string; pendingPath: string } {
    const checkpointId = `anomaly-${input.nodeId ?? input.workflowId ?? 'unknown'}-${input.event?.id ?? Date.now()}`;
    const request: HITLRequest = {
      checkpointId,
      createdAt: new Date().toISOString(),
      task: `异常处理：${input.workflowId ?? '未知 workflow'}/${input.nodeId ?? '未知节点'}`,
      reviewReport: `异常分类=${anomalyClass}；失败原因：${errorText}`,
      auditResult: stopReason,
      retryCount: input.attempts ?? 1,
      options: [...HITL_OPTIONS],
    };
    const pendingPath = this.writeHitlFn(request);
    return { checkpointId, pendingPath };
  }

  /** 合成异常事件（无来源事件时——保证异常也有事件上下文进死信通道） */
  private synthesizeEvent(input: AnomalyInput, stopReason: StopReason, errorText: string): SofagentEvent {
    const id = `anomaly-${input.nodeId ?? 'unknown'}-${Date.now()}`;
    return {
      id,
      type: EVENT_TYPES.ANOMALY_REPORTED,
      source: 'node-output',
      ts: new Date().toISOString(),
      payload: { workflowId: input.workflowId ?? null, nodeId: input.nodeId ?? null, error: errorText },
      correlationId: id,
      ...(input.workflowId !== undefined ? { workflowId: input.workflowId } : {}),
      ...(input.nodeId !== undefined ? { targetNodeId: input.nodeId } : {}),
      metadata: { stopReason, synthetic: true },
      attempt: input.attempts ?? 1,
    };
  }
}

// ────────────────────────────────────────────────────────────
// 默认异常总线（节点兜底出口的统一落点）
// ────────────────────────────────────────────────────────────

let defaultAnomalyBus: AnomalyBus | null = null;
let defaultAnomalyBusDisabled = false;

/**
 * 取默认异常总线（**懒创建**——默认配置下节点兜底出口即生效）。
 *
 * 为什么懒创建而非要求显式注册：注册点纪律的反面是「默认配置下静默不生效」
 * ——若默认无总线，节点兜底出口的异常会无人接收且无人知晓。故默认可用，
 * 接入方仍可 `setDefaultAnomalyBus(myBus)` 换成共享总线（例如与 daemon
 * 的事件总线同实例）。
 *
 * @returns 默认异常总线；已用 `setDefaultAnomalyBus(null)` 关闭时返回 null
 */
export function getDefaultAnomalyBus(): AnomalyBus | null {
  if (defaultAnomalyBusDisabled) return null;
  if (defaultAnomalyBus === null) {
    defaultAnomalyBus = new AnomalyBus({ bus: new EventBus() });
  }
  return defaultAnomalyBus;
}

/**
 * 替换/关闭默认异常总线。
 *
 * @param bus 新总线；传 null 关闭默认上报（节点兜底出口不再写留痕——慎用）
 */
export function setDefaultAnomalyBus(bus: AnomalyBus | null): void {
  if (bus === null) {
    defaultAnomalyBusDisabled = true;
    defaultAnomalyBus = null;
    return;
  }
  defaultAnomalyBusDisabled = false;
  defaultAnomalyBus = bus;
}

/**
 * 节点兜底出口的统一上报帮助函数——**出口接总线的唯一入口**。
 *
 * 语义：留痕失败**不阻断兜底返回**（对齐仓内「留痕失败不吞业务结果」纪律，
 * 见 dual-gate-mw），但仍显式告警（静默降级正是本章要防的失效形态）。
 *
 * @param input 异常上下文
 * @returns 上报结果；未启用总线或上报失败时返回 null
 */
export function reportAnomalyToDefaultBus(input: AnomalyInput): AnomalyRoutingResult | null {
  const bus = getDefaultAnomalyBus();
  if (bus === null) return null;
  try {
    return bus.report(input);
  } catch (err) {
    console.error(
      `[events:error-bus] 异常上报失败（不阻断兜底路径）：${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
