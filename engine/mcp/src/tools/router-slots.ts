// ============================================================
// router-slots.ts · MCP tool：router_slots（v1.5.4 · 第二章）
// ============================================================
//
// 槽位与排队可观测面：查询本地推理槽位占用 / 排队深度 / 各请求等待时长
// （运维可见，**数据本地不出门**）。另附**路由预览**——按任务×敏感度双维
// 预览去向决策与 routeReason（路由可解释）。第三动作 **adjudicate**——
// 判定分层链（IntentTriage L0/L1/L2）**接入去向下达**的生产入口
// （v1.5.4 第二章判定链的生产调用点：本 tool 即 `decideByAdjudication` 的
// 实际消费方，非仅测试调用；既有 tool 加 action ⇒ 工具数不变）。
//
// 数据源：
//   - snapshot：读 `data/router-slots.json`（daemon 持有的槽位态持久化）——
//     缺省为空态快照；可直接传 `state` 注入（测试 / 巡检）
//   - route-preview：纯函数预览（不取用槽位、不下达）
//   - adjudicate：构造判定链（IntentTriage）注入 PolicyEngine →
//     `decideByAdjudication`（判定 target → 映射分级 → 去向下达）
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { getDataDir } from '@sofagent/core';
import {
  PolicyEngine,
  IntentTriage,
  SlotManager,
  type PolicyDecision,
  type Sensitivity,
  type SlotManagerState,
  type TaskClass,
} from '@sofagent/orchestrator';

export interface RouterSlotsArgs {
  /** 动作：snapshot 查槽位态（缺省）/ route-preview 预览路由决策 / adjudicate 判定链接入去向下达 */
  action?: 'snapshot' | 'route-preview' | 'adjudicate';
  /** 槽位上限（snapshot 空态时用；缺省 5） */
  max_slots?: number;
  /** 任务类型（route-preview 用） */
  task_class?: TaskClass;
  /** 数据敏感度（route-preview / adjudicate 用） */
  sensitivity?: Sensitivity;
  /** 云端可用性（route-preview / adjudicate 用） */
  cloud_available?: boolean;
  /** 本地可用性（route-preview / adjudicate 用） */
  local_available?: boolean;
  /** 槽位态注入（缺省读 data/router-slots.json——测试 / 巡检直接注入） */
  state?: SlotManagerState;
  /** 判定链语义输入文本（adjudicate 用——待判定工作流节点上下文 / 变更描述） */
  text?: string;
  /** 判定链结构化解引用（adjudicate 用——workflow 节点 id / 规则编号，供 L0 先判） */
  refs?: string[];
  /** 判定链问句集（adjudicate 用——缺省单问句 choice[allow,deny]） */
  questions?: Array<{
    id: string;
    primitive: 'choice' | 'score' | 'noul';
    options?: string[];
    fallback?: string;
    range?: { min: number; max: number };
    evidence?: 'structural' | 'trace';
  }>;
  /** 证据就绪度（adjudicate 用——缺省 none；none + 需证据判据 ⇒ 拒绝启用） */
  evidence_readiness?: 'structural' | 'trace' | 'none';
  /** 是否在判定域内（adjudicate 用；false → SKIP 走 L0 兜底） */
  in_domain?: boolean;
  /** ⚡ 节点（adjudicate 用——强制 ASK） */
  critical_node?: boolean;
  /** 排队优先级（adjudicate 用） */
  priority?: 'high' | 'normal' | 'low';
}

export interface RouterSlotsResult {
  text: string;
  data: {
    isError: boolean;
    ok: boolean;
    issues: string[];
    /** snapshot 面 */
    snapshot?: {
      maxSlots: number;
      inUse: number;
      available: number;
      queueDepth: number;
      decisionInFlight: number;
      queued: SlotManagerState['queued'];
    };
    /** route-preview 面 */
    decision?: { target: string; reason: string; sensitivity: string; taskClass: string; routeReason: string };
    /** adjudicate 面（判定分层链产出 + 去向下达） */
    adjudication?: {
      layer: string;
      triageTarget: string;
      target: string;
      sensitivity: string;
      routeReason: string;
      decisionId: string;
      dispatched: boolean;
    };
  };
}

/** 读取 daemon 持久化的槽位态（缺省 null——空态） */
function loadPersistedState(dataDir: string): SlotManagerState | null {
  try {
    const file = join(dataDir, 'router-slots.json');
    if (!existsSync(file)) return null;
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as SlotManagerState;
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed;
  } catch {
    return null; // 坏文件 → 视为空态（不阻断观测面）
  }
}

/**
 * router_slots MCP tool。
 *
 * @param args.action 'snapshot'（查槽位态）| 'route-preview'（预览路由决策）| 'adjudicate'（判定链接入去向下达）
 */
export async function routerSlots(args: RouterSlotsArgs): Promise<RouterSlotsResult> {
  const action = args.action ?? 'snapshot';

  if (action === 'route-preview') {
    if (!args.task_class || !args.sensitivity) {
      return {
        text: '[sofagent] router_slots 失败：route-preview 需 task_class 与 sensitivity',
        data: { isError: true, ok: false, issues: ['route-preview 需 task_class 与 sensitivity'] },
      };
    }
    const engine = new PolicyEngine();
    const decision: PolicyDecision = engine.previewRoute({
      taskClass: args.task_class,
      sensitivity: args.sensitivity,
      ...(args.cloud_available !== undefined ? { cloudAvailable: args.cloud_available } : {}),
      ...(args.local_available !== undefined ? { localAvailable: args.local_available } : {}),
    });
    const reasonText = decision.failClosed
      ? `${decision.reason}（fail-closed：${decision.blockReason ?? ''}）`
      : decision.reason;
    return {
      text: `[sofagent] 路由预览：任务=${decision.taskClass} 敏感度=${decision.sensitivity} → ${decision.target}（routeReason=${reasonText}）`,
      data: {
        isError: false,
        ok: true,
        issues: [],
        decision: {
          target: decision.target,
          reason: decision.reason,
          sensitivity: decision.sensitivity,
          taskClass: decision.taskClass,
          routeReason: decision.reason,
        },
      },
    };
  }

  if (action === 'adjudicate') {
    if (!args.sensitivity) {
      return {
        text: '[sofagent] router_slots 失败：adjudicate 需 sensitivity',
        data: { isError: true, ok: false, issues: ['adjudicate 需 sensitivity'] },
      };
    }
    // ── 判定链生产接线（v1.5.4 第二章）──
    // 构造判定分层编排（IntentTriage）并**注入** PolicyEngine——`decideByAdjudication`
    // 缺判定链即 fail-closed 拒绝执行；本处是它在生产路径上的实际构造/调用点。
    const triage = new IntentTriage();
    const engine = new PolicyEngine({ triage });
    // 问句集缺省 = 单问句 choice[allow, deny]（带兜底候选，满足 DecisionChannel 契约）
    const questions = args.questions && args.questions.length > 0
      ? args.questions
      : [{ id: 'adjudicate-q1', primitive: 'choice' as const, options: ['allow', 'deny'], fallback: 'deny' }];
    const outcome = await engine.decideByAdjudication({
      state: {
        text: typeof args.text === 'string' ? args.text : '',
        ...(Array.isArray(args.refs) ? { refs: args.refs } : {}),
        evidenceReadiness: args.evidence_readiness ?? 'none',
      },
      questions,
      sensitivity: args.sensitivity,
      ...(args.cloud_available !== undefined ? { cloudAvailable: args.cloud_available } : {}),
      ...(args.local_available !== undefined ? { localAvailable: args.local_available } : {}),
      ...(args.in_domain !== undefined ? { inDomain: args.in_domain } : {}),
      ...(args.critical_node !== undefined ? { criticalNode: args.critical_node } : {}),
      ...(args.priority !== undefined ? { priority: args.priority } : {}),
    });
    return {
      text: `[sofagent] 判定链：层=${outcome.triage.layer} 判定去向=${outcome.triage.target} → 决策=${outcome.decision.target}（routeReason=${outcome.decision.reason}）`,
      data: {
        isError: false,
        ok: true,
        issues: [],
        adjudication: {
          layer: outcome.triage.layer,
          triageTarget: outcome.triage.target,
          target: outcome.decision.target,
          sensitivity: outcome.decision.sensitivity,
          routeReason: outcome.triage.routeReason,
          decisionId: outcome.decision.decisionId,
          dispatched: outcome.dispatch !== undefined,
        },
      },
    };
  }

  // ── snapshot：查槽位占用 / 排队深度 / 等待时长 ──
  const dataDir = getDataDir();
  const persisted = args.state ?? loadPersistedState(dataDir);
  const manager = persisted
    ? SlotManager.fromState(persisted)
    : new SlotManager(typeof args.max_slots === 'number' ? { maxSlots: args.max_slots } : {});
  const snap = manager.snapshot();
  return {
    text: `[sofagent] 本地槽位态：占用 ${snap.inUse}/${snap.maxSlots}（空闲 ${snap.available}）· 排队 ${snap.queueDepth} · 判定链在飞 ${snap.decisionInFlight}`,
    data: {
      isError: false,
      ok: true,
      issues: [],
      snapshot: {
        maxSlots: snap.maxSlots,
        inUse: snap.inUse,
        available: snap.available,
        queueDepth: snap.queueDepth,
        decisionInFlight: snap.decisionInFlight,
        queued: manager.toState().queued,
      },
    },
  };
}
