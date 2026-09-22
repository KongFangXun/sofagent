// ============================================================
// escalation/policy.ts · 提权策略路由（v1.5.1 第五章）
// ============================================================
// 纯函数（core 零跨包 import）：
//   safe      → 直接跑（allow）
//   risky     → 场景策略判定（企业可配 allow/require-approval）
//   dangerous → HITL 审批队列（forbid-until-approved——fail-closed：
//               未经审批不执行；审批面在 rules 及以上层，本层只出判定）
//
// 决策留痕：本层返回结构化判定（level/basis/decision）——调用层
// （orchestrator/daemon）据此记 DecisionKind.ESCALATE_REPORT +
// DecisionCategory='escalate'（复用 audit 既有分型，不新增成员）。
// ============================================================

import { classifyCommand, type ClassifiedCommand, type ClassifierOverrides, type EscalationLevel } from './classifier';

/** 提权决策三态（对齐 Codex EscalationDecision allow/prompt/forbid 语义） */
export type EscalationDecision =
  | { action: 'allow'; level: EscalationLevel; basis: string }
  | { action: 'require-approval'; level: EscalationLevel; basis: string; queue: 'hitl' }
  | { action: 'forbid-until-approved'; level: 'dangerous'; basis: string; queue: 'hitl' };

/** 企业场景策略（risky 级的路由覆盖——按命令模式细分） */
export interface EscalationScenarioPolicy {
  /**
   * risky 命令的场景覆盖：模式命中 → allow（白名单放行，如 CI 内 npm install）。
   * 未配置/未命中的 risky → require-approval。
   */
  riskyAllowPatterns?: Array<{ re: string; basis: string }>;
}

export interface EscalationPolicyOptions {
  /** 分级覆盖（企业自定义危险模式/安全命令） */
  classifierOverrides?: ClassifierOverrides;
  /** 场景策略（risky 级白名单） */
  scenario?: EscalationScenarioPolicy;
}

export interface EscalationVerdict {
  command: string;
  /** 分级明细（含依据——决策留痕素材） */
  classified: ClassifiedCommand;
  /** 路由决策 */
  decision: EscalationDecision;
}

/**
 * 提权策略路由（纯函数）。
 * 三级路由：
 *   safe → allow（直接跑）
 *   risky → 场景白名单命中 allow，否则 require-approval（HITL 队列）
 *   dangerous → forbid-until-approved（fail-closed：未经审批不执行）
 */
export function routeEscalation(command: string, options?: EscalationPolicyOptions): EscalationVerdict {
  const classified = classifyCommand(command, options?.classifierOverrides);

  if (classified.level === 'safe') {
    return {
      command,
      classified,
      decision: { action: 'allow', level: 'safe', basis: classified.basis },
    };
  }

  if (classified.level === 'dangerous') {
    return {
      command,
      classified,
      decision: { action: 'forbid-until-approved', level: 'dangerous', basis: classified.basis, queue: 'hitl' },
    };
  }

  // risky：场景白名单命中 → allow；否则 require-approval
  const allowPatterns = options?.scenario?.riskyAllowPatterns ?? [];
  for (const p of allowPatterns) {
    if (new RegExp(p.re, 'i').test(classified.command)) {
      return {
        command,
        classified,
        decision: { action: 'allow', level: 'risky', basis: `${classified.basis}；场景白名单放行（${p.basis}）` },
      };
    }
  }
  return {
    command,
    classified,
    decision: { action: 'require-approval', level: 'risky', basis: classified.basis, queue: 'hitl' },
  };
}
