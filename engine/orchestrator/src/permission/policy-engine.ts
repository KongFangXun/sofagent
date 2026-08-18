// ============================================================
// permission/policy-engine.ts · 策略引擎（放行/deny/人工批准）
// v1.3.6 · v1.3.7 开发② 新增
//
// 判定链完整闭环：身份 → 场景匹配 → 风险等级 → 【放行/deny/人工批准】
//   每步可追溯（decision-log 留痕——每条判定含全链证据）
//
// 三合一（验收标准 4）：
//   - 团队场景权限（v1.3.3 L2 协作：team 范围内角色限定）
//   - 市场调用权限（v1.3.4 L3 市场：commons 能力调用授权）
//   - 动态提权到期回收（elevated grant 带 expiresAt，过期自动失效）
//
// DSH 三硬约束（2026-08-15 决策，验收标准 5/6）：
//   1. fail-closed：匹配不到场景/策略异常 → deny，不默认放行
//   2. 守卫先于事件分发：判定在工具执行前（decide() 返回后调用方才可执行）
//   3. 最小权限：场景只授任务所需最小面（scenario-router 的 allowedDomains）
// ============================================================

import { ScenarioRouter, ScenarioMatchRequest, createScenarioRouter } from './scenario-router';
import { classifyRisk, riskToDefaultAction, RiskLevel } from './risk-classifier';

/** 判定结果动作 */
export type PolicyAction = 'allow' | 'deny' | 'human-approval';

/** 决策日志条目（每步可追溯） */
export interface DecisionLogEntry {
  ts: string;
  /** 请求快照 */
  request: PermissionRequest;
  /** 判定链各环结果 */
  chain: {
    identity: string;
    scenarioMatched: boolean;
    scenarioId?: string;
    risk: RiskLevel;
  };
  /** 最终判定 */
  action: PolicyAction;
  /** 判定依据（人工复核用） */
  reason: string;
  /** 是否来自动态提权 */
  viaElevation?: boolean;
}

/** 权限请求 */
export interface PermissionRequest extends ScenarioMatchRequest {
  /** 请求者身份（v1.3.1 Ed25519 身份码派生的 agent ID） */
  agentId: string;
  /** 调用来源：task（任务执行）/ team（L2 协作）/ commons（L3 市场调用） */
  source: 'task' | 'team' | 'commons';
  /** 目标（team 角色 / commons 能力名） */
  target?: string;
}

/** 动态提权授予 */
export interface ElevationGrant {
  agentId: string;
  /** 提权的场景维度（临时允许触碰某域） */
  domain: string;
  /** 过期时间（ISO）——到期自动回收 */
  expiresAt: string;
  grantedAt: string;
  reason: string;
}

/** 团队角色权限表（L2 v1.3.3——简化为角色→可扮演场景） */
export interface TeamPolicy {
  role: string;
  allowedTaskTypes: string[];
}

/** 市场能力授权表（L3 v1.3.4——能力名→允许的 agent 集合，* 为全放） */
export interface CommonsPolicy {
  capability: string;
  allowedAgents: string[] | '*';
}

export interface PolicyEngineOptions {
  scenarioRouter?: ScenarioRouter;
  /** L2 团队角色策略集 */
  teamPolicies?: TeamPolicy[];
  /** L3 市场授权集 */
  commonsPolicies?: CommonsPolicy[];
  /** 高危动作默认处置覆盖（默认 human-approval） */
  highRiskAction?: PolicyAction;
}

export interface PolicyEngine {
  /** 判定（守卫先于事件分发——调用方必须在执行前调用） */
  decide(req: PermissionRequest): { action: PolicyAction; reason: string; log: DecisionLogEntry };
  /** 动态提权授予（带过期） */
  grantElevation(agentId: string, domain: string, ttlMs: number, reason: string): ElevationGrant;
  /** 查询某 agent 的活跃提权 */
  activeElevations(agentId: string): ElevationGrant[];
  /** 到期回收（惰性清理——每次 decide 时也做） */
  sweepExpired(): number;
  /** 决策日志导出（审计出口） */
  exportLog(): DecisionLogEntry[];
  /** 人工批准回调（human-approval 通过后记录） */
  recordHumanApproval(entryTs: string): void;
}

/**
 * 创建策略引擎。
 */
export function createPolicyEngine(options: PolicyEngineOptions = {}): PolicyEngine {
  const router = options.scenarioRouter || createScenarioRouter();
  const highRiskAction: PolicyAction = options.highRiskAction || 'human-approval';
  const teamPolicies = options.teamPolicies || [];
  const commonsPolicies = options.commonsPolicies || [];

  const log: DecisionLogEntry[] = [];
  const elevations = new Map<string, ElevationGrant[]>();
  const humanApprovals = new Set<string>();

  function sweepExpired(): number {
    let swept = 0;
    const now = Date.now();
    for (const [agent, list] of elevations) {
      const alive = list.filter(g => new Date(g.expiresAt).getTime() > now);
      swept += list.length - alive.length;
      if (alive.length === 0) elevations.delete(agent);
      else elevations.set(agent, alive);
    }
    return swept;
  }

  function hasElevation(agentId: string, domain: string): ElevationGrant | null {
    const now = Date.now();
    for (const g of elevations.get(agentId) || []) {
      if (g.domain === domain && new Date(g.expiresAt).getTime() > now) return g;
    }
    return null;
  }

  function decide(req: PermissionRequest): { action: PolicyAction; reason: string; log: DecisionLogEntry } {
    sweepExpired(); // 惰性回收

    const risk = classifyRisk(req.action, req.domain);
    const chain: DecisionLogEntry['chain'] = {
      identity: req.agentId,
      scenarioMatched: false,
      risk,
    };

    // ── 判定链第 1 环：身份（空身份直接 deny——fail-closed）──
    if (!req.agentId) {
      return finalize('deny', 'fail-closed：缺少 agent 身份', chain, req);
    }

    // ── 来源限定：L2 team 角色必须在策略表内 ──
    if (req.source === 'team' && req.target) {
      const tp = teamPolicies.find(p => p.role === req.target);
      if (!tp) {
        return finalize('deny', `fail-closed：团队角色 ${req.target} 无策略（L2 未授权）`, chain, req);
      }
      if (!tp.allowedTaskTypes.includes(req.taskType)) {
        return finalize('deny', `团队角色 ${req.target} 不允许任务类型 ${req.taskType}`, chain, req);
      }
    }
    // ── L3 commons 能力授权 ──
    if (req.source === 'commons' && req.target) {
      const cp = commonsPolicies.find(p => p.capability === req.target);
      if (!cp) {
        return finalize('deny', `fail-closed：市场能力 ${req.target} 无授权策略`, chain, req);
      }
      if (cp.allowedAgents !== '*' && !cp.allowedAgents.includes(req.agentId)) {
        return finalize('deny', `agent 不在能力 ${req.target} 授权名单`, chain, req);
      }
    }

    // ── 判定链第 2 环：场景匹配（fail-closed）──
    const matchReq: ScenarioMatchRequest = { taskType: req.taskType, domain: req.domain, action: req.action };
    const match = router.match(matchReq);
    chain.scenarioMatched = match.matched;
    if (match.matched) chain.scenarioId = match.scenario?.id;

    if (!match.matched) {
      // 动态提权豁免检查（提权 = 显式临时授权，带过期）
      const elev = hasElevation(req.agentId, req.domain);
      if (elev) {
        // 提权放行——但仍走风险分级（critical 仍需人审）
        if (risk === 'high' || risk === 'critical') {
          return finalize(highRiskAction, `提权命中但风险 ${risk} 仍需人审（提权来源：${elev.reason}）`, chain, req, true);
        }
        return finalize('allow', `动态提权放行（${elev.reason}，到期 ${elev.expiresAt}）`, chain, req, true);
      }
      return finalize('deny', match.reason || 'fail-closed：场景不匹配', chain, req);
    }

    // ── 判定链第 3→4 环：风险等级 → 处置 ──
    // 极高风险（删/外传敏感域）强制人工批准——无人审确认不执行（验收 3）
    if (risk === 'critical' || risk === 'high') {
      return finalize(highRiskAction, `风险等级 ${risk}（${req.action} ${req.domain}）→ ${highRiskAction}`, chain, req);
    }
    return finalize('allow', `场景 ${chain.scenarioId} · 风险 ${risk} → 自动放行（最小权限面内）`, chain, req);
  }

  function finalize(action: PolicyAction, reason: string, chain: DecisionLogEntry['chain'], req: PermissionRequest, viaElevation = false): { action: PolicyAction; reason: string; log: DecisionLogEntry } {
    const entry: DecisionLogEntry = {
      ts: new Date().toISOString(),
      request: { ...req },
      chain,
      action,
      reason,
      viaElevation,
    };
    log.push(entry);
    return { action, reason, log: entry };
  }

  return {
    decide,
    grantElevation(agentId, domain, ttlMs, reason) {
      const grant: ElevationGrant = {
        agentId, domain,
        expiresAt: new Date(Date.now() + ttlMs).toISOString(),
        grantedAt: new Date().toISOString(),
        reason,
      };
      const list = elevations.get(agentId) || [];
      list.push(grant);
      elevations.set(agentId, list);
      return grant;
    },
    activeElevations(agentId) {
      const now = Date.now();
      return (elevations.get(agentId) || []).filter(g => new Date(g.expiresAt).getTime() > now);
    },
    sweepExpired,
    exportLog() {
      return [...log];
    },
    recordHumanApproval(entryTs) {
      humanApprovals.add(entryTs);
    },
  };
}
