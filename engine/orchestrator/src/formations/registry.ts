// ============================================================
// formations/registry.ts · 六阵型拓扑定义与实例化（v1.5.1 第三章）
// ============================================================
// 阵型实例化 = 读配置 → 生成成员拓扑（v1.3.6 SubAgent SDK 形态的
// spawn 计划）+ 边生命周期管理（Open/Closed——ACP agent-graph-store 参考）。
// 审计留痕：每次阵型运行记 who-派发-who / 交接事件（调用方落 decision-log）。
// ============================================================

import type { FormationConfig, FormationName, FormationEdge } from './schema';
/** 实例化后的成员节点（spawn 计划） */
export interface SpawnedMember {
  role: string;
  agentType: string;
  /** 边生命周期：open（活跃）/ closed（已完成退出） */
  state: 'open' | 'closed';
}

/** 交接事件（审计留痕素材） */
export interface HandoffEvent {
  ts: string;
  from: string;
  to: string;
  protocol: FormationEdge['protocol'];
  /** 派发语义（who-派发-who 可回溯） */
  dispatchedBy?: string;
}

/** 阵型实例 */
export interface FormationInstance {
  formation: FormationName;
  members: SpawnedMember[];
  /** 交接留痕（追加式——exportFormationAudit 导出给调用方落审计） */
  handoffs: HandoffEvent[];
  /** 关闭成员（边生命周期收口） */
  closeMember(role: string): void;
  /** 记录交接（同步阻塞 / 异步通知 / 审阅回传） */
  recordHandoff(edge: Pick<HandoffEvent, 'from' | 'to' | 'protocol'>, dispatchedBy?: string): void;
  /** 导出审计面 */
  exportFormationAudit(): { formation: FormationName; members: Array<{ role: string; agentType: string; state: string }>; handoffs: HandoffEvent[] };
}

/** 六阵型默认拓扑模板（formation.yml 缺省 edges 时的兜底） */
export const FORMATION_TEMPLATES: Record<FormationName, { members: Array<{ role: string; agentType: string }>; edges: FormationEdge[] }> = {
  'commander-crews': {
    members: [
      { role: 'commander', agentType: 'engineer' },
      { role: 'crew-1', agentType: 'engineer' },
      { role: 'crew-2', agentType: 'engineer' },
    ],
    edges: [
      { from: 'commander', to: 'crew-1', protocol: 'sync' },
      { from: 'commander', to: 'crew-2', protocol: 'sync' },
    ],
  },
  'driver-advisor': {
    members: [
      { role: 'driver', agentType: 'engineer' },
      { role: 'advisor', agentType: 'reviewer' },
    ],
    edges: [{ from: 'advisor', to: 'driver', protocol: 'review' }],
  },
  'cross-review': {
    members: [
      { role: 'reviewer-a', agentType: 'reviewer' },
      { role: 'reviewer-b', agentType: 'reviewer' },
    ],
    edges: [
      { from: 'reviewer-a', to: 'reviewer-b', protocol: 'review' },
      { from: 'reviewer-b', to: 'reviewer-a', protocol: 'review' },
    ],
  },
  'bake-off': {
    members: [
      { role: 'candidate-a', agentType: 'engineer' },
      { role: 'candidate-b', agentType: 'engineer' },
      { role: 'judge', agentType: 'reviewer' },
    ],
    edges: [
      { from: 'candidate-a', to: 'judge', protocol: 'async' },
      { from: 'candidate-b', to: 'judge', protocol: 'async' },
    ],
  },
  'research-triangulation': {
    members: [
      { role: 'researcher-1', agentType: 'engineer' },
      { role: 'researcher-2', agentType: 'engineer' },
      { role: 'researcher-3', agentType: 'engineer' },
      { role: 'verifier', agentType: 'reviewer' },
    ],
    edges: [
      { from: 'researcher-1', to: 'verifier', protocol: 'async' },
      { from: 'researcher-2', to: 'verifier', protocol: 'async' },
      { from: 'researcher-3', to: 'verifier', protocol: 'async' },
    ],
  },
  'cost-pyramid': {
    members: [
      { role: 'base-cheap', agentType: 'engineer' },
      { role: 'key-expensive', agentType: 'engineer' },
    ],
    edges: [
      { from: 'base-cheap', to: 'key-expensive', protocol: 'sync' },
    ],
  },
};

/**
 * 实例化阵型。
 * 配置缺省 members/edges 时用内置模板兜底（formation.yml 最小只需阵型名）。
 * bake-off 阵型的择优复用 v1.3.5 A/B 基建（orchestrator-compare）——
 * 本层只出拓扑，A/B 判定由调用方接既有 ab 流程。
 */
export function instantiateFormation(config: FormationConfig): FormationInstance {
  const formation = config.formation as FormationName;
  const template = FORMATION_TEMPLATES[formation];
  const members: SpawnedMember[] = (config.members?.length ? config.members : template.members).map((m) => ({
    role: m.role,
    agentType: m.agentType,
    state: 'open' as const,
  }));
  const handoffs: HandoffEvent[] = [];

  return {
    formation,
    members,
    handoffs,
    closeMember(role) {
      const m = members.find((x) => x.role === role);
      if (m) m.state = 'closed';
    },
    recordHandoff(edge, dispatchedBy) {
      handoffs.push({ ts: new Date().toISOString(), ...edge, ...(dispatchedBy ? { dispatchedBy } : {}) });
    },
    exportFormationAudit() {
      return {
        formation,
        members: members.map((m) => ({ role: m.role, agentType: m.agentType, state: m.state })),
        handoffs: [...handoffs],
      };
    },
  };
}
