// ============================================================
// formations/registry.ts · 六阵型拓扑定义与实例化（v1.5.3 第三章）
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

/**
 * recordHandoff 的决策留痕选项（v1.5.5 阶段三 F10c）。
 * 传入时交接事件同步挂 decision-log（kind=TEAM, moment=ACT）；
 * 缺省不挂（instantiateFormation 的纯拓扑用法零变化）。
 */
export interface HandoffAuditOptions {
  /** 团队 ID（decision-log 按 team 可查） */
  teamId: string;
  /** 数据目录（缺省走 loadEnvConfig） */
  dataDir?: string;
}

/** 阵型实例 */
export interface FormationInstance {
  formation: FormationName;
  members: SpawnedMember[];
  /** 交接留痕（追加式——exportFormationAudit 导出给调用方落审计） */
  handoffs: HandoffEvent[];
  /** 关闭成员（边生命周期收口） */
  closeMember(role: string): void;
  /**
   * 记录交接（同步阻塞 / 异步通知 / 审阅回传）。
   * v1.5.5 阶段三 F10c：传 auditOpts 时同步挂 decision-log（kind=TEAM, moment=ACT）——
   * 此前仅内存 push，交接发生了但 decision-log 零留痕（「阵型是否照跑」不可查）。
   * 留痕失败降级 stderr 告警不阻塞（audit 包缺位/签名漂移时不拦拓扑装配）。
   */
  recordHandoff(edge: Pick<HandoffEvent, 'from' | 'to' | 'protocol'>, dispatchedBy?: string, auditOpts?: HandoffAuditOptions): void;
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
    recordHandoff(edge, dispatchedBy, auditOpts) {
      const ts = new Date().toISOString();
      handoffs.push({ ts, ...edge, ...(dispatchedBy ? { dispatchedBy } : {}) });
      // v1.5.5 阶段三 F10c：交接事件挂 decision-log（动态 import + 运行时签名校验，
      // 同 model-unregister.ts 的既有降级模式——缺包/签名漂移降级 stderr 告警，不阻塞）
      if (auditOpts) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const audit = require('@sofagent/audit') as unknown as {
            emitDecision?: (input: Record<string, unknown>, dataDir?: string) => unknown;
          };
          if (typeof audit.emitDecision !== 'function') {
            process.stderr.write(
              `[formations] 交接留痕降级：@sofagent/audit 未导出 emitDecision（签名漂移）——team ${auditOpts.teamId} 的交接 ${edge.from}→${edge.to} 未落 decision-log\n`,
            );
          } else {
            audit.emitDecision({
              agentId: `formation-${auditOpts.teamId}`,
              sessionId: `formation-${auditOpts.teamId}-${ts}`,
              kind: 'TEAM',
              moment: 'ACT',
              why: `阵型交接：${edge.from} → ${edge.to}（协议 ${edge.protocol}）`,
              evidence: [`team=${auditOpts.teamId} edge=${edge.from}->${edge.to} protocol=${edge.protocol}`],
            }, auditOpts.dataDir);
          }
        } catch (err) {
          process.stderr.write(
            `[formations] 交接留痕失败（不阻塞拓扑装配）: ${err instanceof Error ? err.message : String(err)}\n`,
          );
        }
      }
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
