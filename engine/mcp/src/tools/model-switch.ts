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
      await emitSwitchDecision(`模型回滚：${result.message}`, lane);
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
    await emitSwitchDecision(`模型${percent === 100 || percent === undefined ? '晋升' : '灰度切换'}：${result.message}`, lane);
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

/** decision-log 留痕（非致命） */
async function emitSwitchDecision(why: string, lane: string): Promise<void> {
  try {
    const audit = (await import('@sofagent/audit')) as unknown as {
      emitDecision: (input: Record<string, unknown>) => unknown;
    };
    audit.emitDecision({
      agentId: 'sofagent-mcp-model-switch',
      sessionId: `model-switch-${Date.now()}`,
      kind: 'CONFIG_CHANGE',
      moment: 'ACT',
      why,
      evidence: [`lane=${lane}`],
    });
  } catch {
    // 留痕降级不阻塞
  }
}
