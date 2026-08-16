// ============================================================
// model-unregister.ts · MCP tool：model_unregister（v1.3.6 交付 ④）
// ============================================================
//
// 模型退役 / 恢复入口。委托 @sofagent/orchestrator：
//   - action='retire'（默认）→ 🔴 强制人审，标记退役（不参与路由，可恢复）
//   - action='restore' → 🔴 强制人审，恢复退役模型
// 对齐 v1.3.4 L3 养护环「失效退役」+ v1.3.5 promote_ab 人审语义。
// ============================================================

import { join } from 'path';

function getSofagentDataDir(): string {
  return process.env.SOFAGENT_DATA || join(process.cwd(), 'data');
}

export interface ModelUnregisterArgs {
  /** 目标模型名 */
  name: string;
  /** 动作：retire（默认退役）/ restore（恢复退役模型） */
  action?: 'retire' | 'restore';
  /** 🔴 人工确认（false/缺省 → 挂起等人审） */
  human_confirmed?: boolean;
  /** 备注（退役原因 / 恢复理由） */
  comment?: string;
}

export interface ModelUnregisterToolResult {
  text: string;
  data: {
    isError: boolean;
    ok: boolean;
    awaitingHuman: boolean;
    issues: string[];
    model?: string;
    action?: string;
  };
}

export async function modelUnregister(args: ModelUnregisterArgs): Promise<ModelUnregisterToolResult> {
  const { name, action = 'retire', human_confirmed, comment } = args;

  if (typeof name !== 'string' || name.trim() === '') {
    return {
      text: '[sofagent] model_unregister 失败：name 必填且非空',
      data: { isError: true, ok: false, awaitingHuman: false, issues: ['name 必填'] },
    };
  }

  try {
    const { retireModel, restoreModel } = await import('@sofagent/orchestrator');
    const opts = {
      dataDir: getSofagentDataDir(),
      actor: 'mcp-model-unregister',
      ...(human_confirmed !== undefined ? { humanConfirmed: human_confirmed } : {}),
      ...(comment ? { comment } : {}),
    };

    const result = action === 'restore' ? restoreModel(name, opts) : retireModel(name, opts);

    if (!result.ok) {
      return {
        text: `[sofagent] 模型${action === 'restore' ? '恢复' : '退役'}失败 ❌：${result.message}`,
        data: { isError: result.issues.length > 0, ok: false, awaitingHuman: false, issues: result.issues, model: name, action },
      };
    }
    if (result.awaitingHuman) {
      return {
        text: `[sofagent] ⏸ ${result.message}`,
        data: { isError: false, ok: true, awaitingHuman: true, issues: [], model: name, action },
      };
    }

    // decision-log 留痕（非致命）
    try {
      const audit = (await import('@sofagent/audit')) as unknown as {
        emitDecision: (input: Record<string, unknown>) => unknown;
      };
      audit.emitDecision({
        agentId: 'sofagent-mcp-model-unregister',
        sessionId: `model-unregister-${Date.now()}`,
        kind: 'CONFIG_CHANGE',
        moment: 'ACT',
        why: `模型${action === 'restore' ? '恢复' : '退役'}：${name}${comment ? ` · ${comment}` : ''}`,
        evidence: [`model=${name} action=${action}`],
      });
    } catch {
      // 留痕降级不阻塞
    }

    return {
      text: `[sofagent] ${result.message}`,
      data: { isError: false, ok: true, awaitingHuman: false, issues: [], model: name, action },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      text: `[sofagent] model_unregister 异常：${msg}`,
      data: { isError: true, ok: false, awaitingHuman: false, issues: [msg] },
    };
  }
}
