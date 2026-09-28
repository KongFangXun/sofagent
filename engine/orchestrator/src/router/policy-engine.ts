// ============================================================
// policy-engine.ts · 任务×敏感度双维路由决策引擎（v1.5.4 · 第一章新建 · 第二章对接）
// ============================================================
//
// 定位：**往哪走**（模型路由层）。按「任务类型 × 数据敏感度」双维决策：
//
//   任务类型（任务分级路由）：
//     planning  规划类 → 云端强档（cloud-strong）
//     execution 执行类 → 本地执行档（local-executor）
//     pipeline  管道类（模板/格式/字段提取）→ 本地管道档（local-pipeline）
//
//   数据敏感度（敏感度路由）：
//     敏感数据（restricted / confidential）**强制本地**（fail-closed）——
//     无论任务类型，一律落本地档；本地不可用时 **block**（绝不 fallback 云端）。
//
// 路由可解释：每次决策附 routeReason（复用 v1.3.6 EndpointProfile + route-policy 模式）。
// 降级梯队：云端不可用 → 本地承接（public/internal 场景）；敏感数据不降级云端。
// fail-closed：配置错误 / 不可路由时返回 block 决策（拒绝执行，不静默放行）。
//
// 第二章对接（同版相邻段，本文件被第二章扩展）：
//   - `decideAndDispatch`：决策产出**对接槽位管理与下达面**——本地档先经
//     SlotManager 取用（超限排队 + 超时升级），再经 DecisionDispatcher 按标准
//     schema 下达 router（schema 校验 fail-closed）。
//   - `decideByAdjudication`：判定分层编排（IntentTriage L0/L1/L2）**实际接入**
//     本引擎的去向下达路径——判定链产出 target → 映射任务分级 → decideAndDispatch
//     （判定链与路由链在此合流，判定件不占本地主模型槽的语义由 SlotManager 承载）。
// ============================================================

import type {
  ModelRoute,
  RouteReason,
  RouteTarget,
  Sensitivity,
  TaskComplexity,
} from '../model-router';
import {
  DEFAULT_ROUTER_CONFIG,
  type ModelRouterConfig,
} from '../model-router-config';
import type { SlotLane } from './slot-manager';
import { SlotManager } from './slot-manager';
import {
  DecisionDispatcher,
  type DispatchResult,
  type RouteDisposition,
} from './decision-dispatch';
import type { DecisionQuestion, DecisionState } from './decision-channel';
import type { IntentTriage, TriageOutcome } from './intent-triage';

/** 任务分级（任务类型维——与敏感度维正交） */
export type TaskClass = 'planning' | 'execution' | 'pipeline';

/** 路由决策输入（双维） */
export interface PolicyRouteInput {
  /** 任务类型（规划 / 执行 / 管道） */
  taskClass: TaskClass;
  /** 数据敏感度 */
  sensitivity: Sensitivity;
  /** 任务复杂度（可选——写审计与留痕） */
  complexity?: TaskComplexity;
  /** 云端可用性（false → 非敏感降级本地；敏感数据不受此影响，恒本地） */
  cloudAvailable?: boolean;
  /** 本地可用性（false 且敏感 → fail-closed block） */
  localAvailable?: boolean;
  /** 任务 ID（审计） */
  taskId?: string;
}

/** 路由决策（在 ModelRoute 之上补双维与下达标识） */
export interface PolicyDecision extends ModelRoute {
  /** 任务类型（决策维一） */
  taskClass: TaskClass;
  /** 决策标识（下达面幂等键） */
  decisionId: string;
  /** fail-closed：配置错误 / 不可路由时为 true（target 恒为 block） */
  failClosed?: boolean;
}

/** 引擎依赖（均可注入——测试零真实网络 / 零真实时钟） */
export interface PolicyEngineDeps {
  /** 路由配置（缺省 DEFAULT_ROUTER_CONFIG） */
  config?: ModelRouterConfig;
  /** 槽位管理器（下达前本地档取用——缺省不接入槽位） */
  slotManager?: SlotManager;
  /** 决策下达器（缺省 console 面） */
  dispatcher?: DecisionDispatcher;
  /** 判定分层编排（第二章——缺省不接入判定链；`decideByAdjudication` 需要它） */
  triage?: IntentTriage;
}

/** 端到端（取用 + 下达）结果 */
export interface DispatchOutcome {
  /** 最终决策（含升级后形态） */
  decision: PolicyDecision;
  /** 排队票据（本地档超限入队时） */
  queueTicket?: { position: number; estimatedWaitMs: number };
  /** 等待判定（超时升级建议） */
  wait?: { action: 'wait' | 'escalate-cloud'; waitedMs: number; reason: string };
  /** 下达结果（未 block 时） */
  dispatch?: DispatchResult;
}

/** 判定分层接入输入（第二章判定链 → 第一章去向下达） */
export interface AdjudicationInput {
  /** 待判定语义输入（含证据就绪度——判据门控面） */
  state: DecisionState;
  /** 判定问句集（L1 一次提交全部——批量纪律） */
  questions: DecisionQuestion[];
  /** 数据敏感度（双维路由维二——判定去向映射回分级维后再按敏感度裁决） */
  sensitivity: Sensitivity;
  /** 任务复杂度（可选——写审计与留痕） */
  complexity?: TaskComplexity;
  /** 云端可用性 */
  cloudAvailable?: boolean;
  /** 本地可用性 */
  localAvailable?: boolean;
  /** 任务 ID（审计） */
  taskId?: string;
  /** 排队优先级 */
  priority?: 'high' | 'normal' | 'low';
  /** ⚡ 节点（强制 ASK） */
  criticalNode?: boolean;
  /** 是否在判定域内（false → SKIP，走 L0 兜底） */
  inDomain?: boolean;
}

/** 判定分层接入结果（判定结果 + 去向下达结果） */
export interface AdjudicationOutcome extends DispatchOutcome {
  /** 判定分层结果（L0/L1/L2 或拒绝启用） */
  triage: TriageOutcome;
}

/**
 * 任务×敏感度双维路由决策引擎。
 */
export class PolicyEngine {
  private readonly config: ModelRouterConfig;
  private readonly slotManager?: SlotManager;
  private readonly dispatcher: DecisionDispatcher;
  private readonly triage?: IntentTriage;
  private seq = 0;
  private readonly now: () => number;

  constructor(deps: PolicyEngineDeps = {}) {
    this.config = deps.config ?? DEFAULT_ROUTER_CONFIG;
    if (deps.slotManager) this.slotManager = deps.slotManager;
    this.dispatcher = deps.dispatcher ?? new DecisionDispatcher();
    if (deps.triage) this.triage = deps.triage;
    this.now = () => Date.now();
  }

  /**
   * 配置 fail-closed 校验（数据主权铁律：敏感数据降级策略必须 block-and-alert）。
   * @returns 违规项（空 = 配置合法）
   */
  configIssues(): string[] {
    const issues: string[] = [];
    const fb = this.config.policy?.fallbackOnLocalFailure;
    if (!fb) {
      issues.push('缺 policy.fallbackOnLocalFailure 配置');
    } else {
      if (fb.restricted !== 'block-and-alert') issues.push(`restricted 降级策略非法（须 block-and-alert，实为 ${String(fb.restricted)}）`);
      if (fb.confidential !== 'block-and-alert') issues.push(`confidential 降级策略非法（须 block-and-alert，实为 ${String(fb.confidential)}）`);
    }
    if (!this.config.local?.executor || !this.config.local?.pipeline) {
      issues.push('缺本地档配置（local.executor / local.pipeline）');
    }
    return issues;
  }

  /**
   * 双维路由决策（同步——不探测可达性）。
   *
   * fail-closed：配置违规 → 返回 block 决策（拒绝执行）。
   */
  decide(input: PolicyRouteInput): PolicyDecision {
    const decisionId = `pd-${(this.seq += 1)}-${input.taskClass}`;
    const issues = this.configIssues();
    if (issues.length > 0) {
      return {
        target: 'block',
        reason: 'insufficient-local-capacity',
        sensitivity: input.sensitivity,
        ...(input.complexity ? { complexity: input.complexity } : {}),
        taskClass: input.taskClass,
        decisionId,
        failClosed: true,
        blockReason: `路由配置 fail-closed：${issues.join('；')}`,
      };
    }

    const sensitive = input.sensitivity === 'restricted' || input.sensitivity === 'confidential';

    // ── 维二：敏感度（优先——敏感数据强制本地，fail-closed）──
    if (sensitive) {
      const target: RouteTarget = input.taskClass === 'pipeline' ? 'local-pipeline' : 'local-executor';
      if (input.localAvailable === false) {
        return {
          target: 'block',
          reason: 'insufficient-local-capacity',
          sensitivity: input.sensitivity,
          ...(input.complexity ? { complexity: input.complexity } : {}),
          taskClass: input.taskClass,
          decisionId,
          failClosed: true,
          blockReason: '敏感数据 + 本地不可用——fail-closed 阻断（绝不 fallback 云端）',
        };
      }
      return {
        target,
        reason: 'sensitive-data',
        sensitivity: input.sensitivity,
        ...(input.complexity ? { complexity: input.complexity } : {}),
        taskClass: input.taskClass,
        decisionId,
      };
    }

    // ── 维一：任务类型（非敏感——规划走云强档，执行/管道走本地档）──
    let target: RouteTarget;
    let reason: RouteReason;
    if (input.taskClass === 'planning') {
      target = 'cloud-strong';
      reason = 'complex-reasoning';
    } else if (input.taskClass === 'execution') {
      target = 'local-executor';
      reason = 'workflow-execution';
    } else {
      target = 'local-pipeline';
      reason = 'fixed-pipeline';
    }

    // ── 降级梯队：云端不可用 → 本地承接（非敏感场景）──
    if (target === 'cloud-strong' && input.cloudAvailable === false) {
      target = 'local-executor';
      reason = 'workflow-execution';
    }

    return {
      target,
      reason,
      sensitivity: input.sensitivity,
      ...(input.complexity ? { complexity: input.complexity } : {}),
      taskClass: input.taskClass,
      decisionId,
    };
  }

  /**
   * 路由预览（纯函数形态——可观测 / MCP tool 消费；不取用槽位、不下达）。
   */
  previewRoute(input: PolicyRouteInput): PolicyDecision {
    return this.decide(input);
  }

  /**
   * 决策 → 去向下达 payload（RouteDisposition）。
   * slotLane 由目标档位推导（local-executor→executor / local-pipeline→pipeline）。
   */
  toDisposition(
    decision: PolicyDecision,
    opts: { targetModel?: string; fallbackChain?: string[]; priority?: 'high' | 'normal' | 'low' } = {},
  ): RouteDisposition {
    const slotLane = slotLaneOf(decision.target);
    return {
      decisionId: decision.decisionId,
      targetModel: opts.targetModel ?? resolveTargetModel(this.config, decision.target),
      ...(opts.fallbackChain ? { fallbackChain: opts.fallbackChain } : {}),
      ...(slotLane ? { slotLane } : {}),
      ...(opts.priority ? { priority: opts.priority } : {}),
      reason: decision.reason,
    };
  }

  /**
   * 决策产出**对接槽位管理与下达面**（第二章对接）。
   *
   * 流程：decide → 本地档经 SlotManager 取用（超限排队 + 超时升级判定）→
   * 经 DecisionDispatcher 按标准 schema 下达（fail-closed）。
   */
  async decideAndDispatch(input: PolicyRouteInput, opts: { priority?: 'high' | 'normal' | 'low' } = {}): Promise<DispatchOutcome> {
    let decision = this.decide(input);
    if (decision.target === 'block') {
      // block：不下达（拦截出口）
      return { decision };
    }

    const lane = slotLaneOf(decision.target);
    let queueTicket: DispatchOutcome['queueTicket'];
    let wait: DispatchOutcome['wait'];

    // ── 槽位对接（仅本地档）──
    if (this.slotManager && lane) {
      const outcome = this.slotManager.acquire({ requestId: decision.decisionId, kind: 'main-model', lane, ...(opts.priority ? { priority: opts.priority } : {}) });
      if ('queued' in outcome) {
        const complianceAllowsCloud = !(input.sensitivity === 'restricted' || input.sensitivity === 'confidential');
        const w = this.slotManager.evaluateWait(decision.decisionId, { complianceAllowsCloud });
        wait = w;
        if (w.action === 'escalate-cloud') {
          // 合规允许出门 → 自动提议转云端（routeReason 留痕）。
          // 队列卫生：转云端即不再占本地队列位——withdraw 把排队票据移出
          //（不能用 release：该 id 未获槽，release 会误走判定链分支递减计数，
          //  且残留票据会在后续 release 同名 id 时误提升队首占用其位）。
          this.slotManager.withdraw(decision.decisionId);
          decision = {
            ...decision,
            target: 'cloud-strong',
            reason: 'insufficient-local-capacity',
          };
        } else {
          queueTicket = { position: outcome.queued.position, estimatedWaitMs: outcome.queued.estimatedWaitMs };
        }
      }
    }

    const disposition = this.toDisposition(decision, opts.priority ? { priority: opts.priority } : {});
    const dispatch = await this.dispatcher.dispatch(disposition);
    return {
      decision,
      ...(queueTicket ? { queueTicket } : {}),
      ...(wait ? { wait } : {}),
      dispatch,
    };
  }

  /**
   * 判定分层 → 双维路由下达（第二章判定链**实际接入**第一章去向下达面）。
   *
   * 流程：`IntentTriage.triage`（L0 声明式映射 → L1 批量单次判 → L2 难例兜底，
   * 含证据/校准门控）产出判定 `target` → 映射为任务分级 → `decideAndDispatch`
   * （本地档经 SlotManager 取用 + 经 DecisionDispatcher 下达）。判定链全程经
   * SlotManager `kind='decision'` 取用，不占本地主模型槽（行为锁）。
   *
   * fail-closed：未注入判定链（`PolicyEngineDeps.triage` 缺失）⇒ 拒绝执行，不静默跳过。
   */
  async decideByAdjudication(input: AdjudicationInput): Promise<AdjudicationOutcome> {
    if (!this.triage) {
      throw new Error(
        'decideByAdjudication 需要注入 IntentTriage（PolicyEngineDeps.triage）——判定链缺失时拒绝执行（fail-closed）',
      );
    }
    const triage = await this.triage.triage(input.state, input.questions, {
      ...(input.criticalNode !== undefined ? { criticalNode: input.criticalNode } : {}),
      ...(input.inDomain !== undefined ? { inDomain: input.inDomain } : {}),
    });
    const routeInput: PolicyRouteInput = {
      taskClass: taskClassForTriageTarget(triage.target),
      sensitivity: input.sensitivity,
      ...(input.complexity ? { complexity: input.complexity } : {}),
      ...(input.cloudAvailable !== undefined ? { cloudAvailable: input.cloudAvailable } : {}),
      ...(input.localAvailable !== undefined ? { localAvailable: input.localAvailable } : {}),
      ...(input.taskId ? { taskId: input.taskId } : {}),
    };
    const outcome = await this.decideAndDispatch(routeInput, input.priority ? { priority: input.priority } : {});
    return { ...outcome, triage };
  }
}

/** 判定去向 → 任务分级（判定链产出映射回第一章双维路由的分级维） */
export function taskClassForTriageTarget(target: RouteTarget): TaskClass {
  if (target === 'cloud-strong' || target === 'cloud-fast') return 'planning';
  if (target === 'local-pipeline') return 'pipeline';
  return 'execution';
}

/** 目标档位 → 槽位归属（本地档才有槽位归属；云端/block 无） */
export function slotLaneOf(target: RouteTarget): SlotLane | undefined {
  if (target === 'local-executor') return 'executor';
  if (target === 'local-pipeline') return 'pipeline';
  return undefined;
}

/**
 * 解析目标档位对应的具体模型名（配置面；空串模型名 → 回退档位 token 作占位）。
 * 占位仅用于可观测/预览——真实下达前由注册表覆盖（applyRegistryOverrides）。
 */
export function resolveTargetModel(config: ModelRouterConfig, target: RouteTarget): string {
  switch (target) {
    case 'cloud-strong':
      return config.cloud.strong.model || 'cloud-strong';
    case 'cloud-fast':
      return config.cloud.fast.model || 'cloud-fast';
    case 'local-executor':
      return config.local.executor.model || 'local-executor';
    case 'local-pipeline':
      return config.local.pipeline.model || 'local-pipeline';
    case 'decision-model':
      return 'decision-model';
    case 'block':
    default:
      return 'block';
  }
}
