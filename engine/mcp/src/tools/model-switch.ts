// ============================================================
// model-switch.ts · MCP tool：model_switch（v1.3.6 交付 ④）
// ============================================================
//
// 灰度切换 / 晋升 / 回滚入口。委托 @sofagent/orchestrator：
//   - percent < 100 → canary 灰度（可逆运维操作直接生效）
//   - percent = 100 / 缺省 → 晋升全量 🔴 强制人审（对齐 v1.3.5 promote_ab）
//   - action='rollback' → 一键回滚到上一活动模型（止损不要求人审）
// ============================================================

import { join } from 'path';

function getSofagentDataDir(): string {
  return process.env.SOFAGENT_DATA || join(process.cwd(), 'data');
}

export interface ModelSwitchArgs {
  /** 目标模型名（rollback 时可省略） */
  name?: string;
  /** 档位：executor / pipeline（缺省 executor） */
  lane?: 'executor' | 'pipeline';
  /** 灰度比例 1-99；100/缺省 = 晋升全量（强制人审） */
  percent?: number;
  /** 动作：switch（默认）/ rollback */
  action?: 'switch' | 'rollback';
  /** 🔴 人工确认（晋升 percent=100 时必填 true） */
  human_confirmed?: boolean;
  /** 备注（灰度依据 / 回滚原因） */
  comment?: string;
}

export interface ModelSwitchToolResult {
  text: string;
  data: {
    isError: boolean;
    ok: boolean;
    /** 是否挂起等人审（ok=true 但 awaitingHuman=true = 未执行） */
    awaitingHuman: boolean;
    issues: string[];
    model?: string;
    lane?: string;
    percent?: number;
  };
}

export async function modelSwitch(args: ModelSwitchArgs): Promise<ModelSwitchToolResult> {
  const { name, lane = 'executor', percent, action = 'switch', human_confirmed, comment } = args;

  try {
    const { switchModel, rollbackModel } = await import('@sofagent/orchestrator');
    const opts = {
      dataDir: getSofagentDataDir(),
      actor: 'mcp-model-switch',
      ...(human_confirmed !== undefined ? { humanConfirmed: human_confirmed } : {}),
      ...(comment ? { comment } : {}),
    };

    // 回滚路径
    if (action === 'rollback') {
      const result = rollbackModel(lane, opts);
      if (!result.ok) {
        return {
          text: `[sofagent] 回滚失败 ❌：${result.message}`,
          data: { isError: result.issues.length > 0, ok: false, awaitingHuman: false, issues: result.issues, lane },
        };
      }
      await emitSwitchDecision(`模型回滚：${result.message}`, lane, undefined);
      return {
        text: `[sofagent] ${result.message}`,
        data: { isError: false, ok: true, awaitingHuman: false, issues: [], lane },
      };
    }

    // 切换/晋升路径
    if (typeof name !== 'string' || name.trim() === '') {
      return {
        text: '[sofagent] model_switch 失败：name 必填（rollback 可省略）',
        data: { isError: true, ok: false, awaitingHuman: false, issues: ['name 必填'] },
      };
    }
    const result = switchModel(name, lane, percent, opts);
    if (!result.ok) {
      return {
        text: `[sofagent] 模型切换失败 ❌：${result.message}`,
        data: { isError: result.issues.length > 0, ok: false, awaitingHuman: false, issues: result.issues, model: name, lane },
      };
    }
    if (result.awaitingHuman) {
      return {
        text: `[sofagent] ⏸ ${result.message}`,
        data: { isError: false, ok: true, awaitingHuman: true, issues: [], model: name, lane, percent: percent ?? 100 },
      };
    }
    // v1.3.6 交付⑧：routeReason 结构化理由链（policy + matchedEndpoint + decisionScore）
    const routeReason = await buildRouteReason(name, lane);
    await emitSwitchDecision(
      `模型${percent === 100 || percent === undefined ? '晋升' : '灰度切换'}：${result.message}`,
      lane,
      routeReason,
    );
    return {
      text: `[sofagent] ${result.message}`,
      data: { isError: false, ok: true, awaitingHuman: false, issues: [], model: name, lane, percent: percent ?? 100 },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      text: `[sofagent] model_switch 异常：${msg}`,
      data: { isError: true, ok: false, awaitingHuman: false, issues: [msg] },
    };
  }
}

/**
 * 构造 routeReason（v1.3.6 交付⑧）——路由决策可解释性留痕。
 *
 * policy 命中哪类策略（route-policy.yml preferences 首项，无配置 = default）；
 * matchedEndpoint = 切换到的模型 endpoint；rejectedEndpoints = 被 denyEndpoints
 * 硬性拒绝的；decisionScore = 决胜分（有 tieBreaker 时记 1，否则省略）。
 * 实际路由仍由第三方 router 做——此处只记理由链。降级不阻塞切换本身。
 */
async function buildRouteReason(
  modelName: string,
  lane: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    const { loadRoutePolicy, isEndpointDenied, loadRegistry } = await import('@sofagent/orchestrator');
    const projectRoot = process.cwd();
    const { policy } = loadRoutePolicy(projectRoot);

    const dataDir = getSofagentDataDir();
    let matchedEndpoint: string | undefined;
    const rejected: string[] = [];
    try {
      const registry = loadRegistry(dataDir);
      const models = Object.values(registry.models ?? {});
      const matched = models.find((m) => m.name === modelName);
      matchedEndpoint = matched?.endpoint;
      // 被 denyEndpoints 硬性拒绝的其他 endpoint（reason 可解释「为什么不是它们」）
      for (const m of models) {
        if (m.name !== modelName && m.endpoint && isEndpointDenied(m.endpoint, policy)) {
          rejected.push(m.endpoint);
        }
      }
    } catch {
      // 注册表读失败——matchedEndpoint/rejected 留空，policy 仍可记
    }

    const preference = policy.preferences?.[0];
    const routePolicyLabel = preference ?? 'default';
    return {
      policy: routePolicyLabel,
      ...(matchedEndpoint ? { matchedEndpoint } : {}),
      ...(rejected.length > 0 ? { rejectedEndpoints: rejected } : {}),
      ...(policy.tieBreaker ? { decisionScore: 1 } : {}),
    };
  } catch {
    return undefined; // 构造失败降级——不记 routeReason，切换照常
  }
}

/** decision-log 留痕（非致命）——v1.3.6 交付⑧：why 支持结构化 routeReason */
async function emitSwitchDecision(
  whyText: string,
  lane: string,
  routeReason?: Record<string, unknown>,
): Promise<void> {
  try {
    const audit = (await import('@sofagent/audit')) as unknown as {
      emitDecision: (input: Record<string, unknown>) => unknown;
    };
    audit.emitDecision({
      agentId: 'sofagent-mcp-model-switch',
      sessionId: `model-switch-${Date.now()}`,
      kind: 'CONFIG_CHANGE',
      moment: 'ACT',
      why: {
        text: whyText,
        ...(routeReason ? { routeReason } : {}),
      },
      evidence: [`lane=${lane}`],
    });
  } catch {
    // 留痕降级不阻塞
  }
}
