// ============================================================
// router-slots.ts · MCP tool：router_slots（v1.5.4 · 第二章）
// ============================================================
//
// 槽位与排队可观测面：查询本地推理槽位占用 / 排队深度 / 各请求等待时长
// （运维可见，**数据本地不出门**）。另附**路由预览**——按任务×敏感度双维
// 预览去向决策与 routeReason（路由可解释）。
//
// 数据源：
//   - snapshot：读 `data/router-slots.json`（daemon 持有的槽位态持久化）——
//     缺省为空态快照；可直接传 `state` 注入（测试 / 巡检）
//   - route-preview：纯函数预览（不取用槽位、不下达）
// ============================================================

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { getDataDir } from '@sofagent/core';
import {
  PolicyEngine,
  SlotManager,
  type PolicyDecision,
  type Sensitivity,
  type SlotManagerState,
  type TaskClass,
} from '@sofagent/orchestrator';

export interface RouterSlotsArgs {
  /** 动作：snapshot 查槽位态（缺省）/ route-preview 预览路由决策 */
  action?: 'snapshot' | 'route-preview';
  /** 槽位上限（snapshot 空态时用；缺省 5） */
  max_slots?: number;
  /** 任务类型（route-preview 用） */
  task_class?: TaskClass;
  /** 数据敏感度（route-preview 用） */
  sensitivity?: Sensitivity;
  /** 云端可用性（route-preview 用） */
  cloud_available?: boolean;
  /** 本地可用性（route-preview 用） */
  local_available?: boolean;
  /** 槽位态注入（缺省读 data/router-slots.json——测试 / 巡检直接注入） */
  state?: SlotManagerState;
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
 * @param args.action 'snapshot'（查槽位态）| 'route-preview'（预览路由决策）
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
