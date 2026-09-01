// ============================================================
// model-register.ts · MCP tool：model_register（v1.3.7 交付 ④）
// ============================================================
//
// 模型注册入口——评测（v1.3.1 Benchmark）通过后注册模型 endpoint。
// 委托 @sofagent/orchestrator 的 registerModel（原子写 + 事件留痕）。
//
// 边界：
//   - 本版只处理 endpoint 型模型；source='local-path' 为 v1.4.3 扩展位预留
//   - endpoint 可以是第三方 router（LiteLLM/OpenRouter）地址——
//     sofagent 只管「上线了没/灰度到多少/退役了没」，路由由第三方决定
// ============================================================

import { join } from 'path';
import { getDataDir } from '@sofagent/core';

export interface ModelRegisterArgs {
  /** 注册名（唯一标识——model_switch 按此切换） */
  name: string;
  /** 服务地址（endpoint 必填；local-path 型为权重目录占位） */
  endpoint: string;
  /** 模型名（传给服务的 model 字段） */
  model: string;
  /** 客户端协议（缺省 ollama；openai-compatible = vLLM/第三方 router） */
  client_type?: 'ollama' | 'openai-compatible';
  /** 来源类型（缺省 endpoint；local-path = v1.4.1 扩展位预留） */
  source?: 'endpoint' | 'local-path';
  /** 评测分数（评测→注册流程的证据位） */
  eval_score?: number;
  /** 备注 */
  comment?: string;
  /**
   * 端点能力画像（v1.3.6 交付⑧——可选填，不填向后兼容）。
   * strengths 擅长能力 / modalities 模态 / maxContext 最大上下文 /
   * costPerKToken 每千 token 成本 / latencyP50 延迟 P50。
   */
  profile?: {
    strengths?: string[];
    modalities?: string[];
    maxContext?: number;
    costPerKToken?: number;
    latencyP50?: number;
  };
}

export interface ModelRegisterToolResult {
  text: string;
  data: {
    isError: boolean;
    ok: boolean;
    issues: string[];
    name?: string;
    registered?: boolean;
  };
}

export async function modelRegister(args: ModelRegisterArgs): Promise<ModelRegisterToolResult> {
  const { name, endpoint, model, client_type, source, eval_score, comment, profile } = args;

  if (typeof name !== 'string' || name.trim() === '') {
    return {
      text: '[sofagent] model_register 失败：name 必填且非空',
      data: { isError: true, ok: false, issues: ['name 必填且非空'] },
    };
  }

  // v1.3.6 交付⑧：能力画像校验——传入的 profile 需为对象且至少一个有效字段
  let cleanProfile: ModelRegisterArgs['profile'] | undefined;
  if (profile !== undefined) {
    if (typeof profile !== 'object' || profile === null || Array.isArray(profile)) {
      return {
        text: '[sofagent] model_register 失败：profile 必须是对象',
        data: { isError: true, ok: false, issues: ['profile 必须是对象'] },
      };
    }
    const hasField =
      (Array.isArray(profile.strengths) && profile.strengths.length > 0) ||
      (Array.isArray(profile.modalities) && profile.modalities.length > 0) ||
      typeof profile.maxContext === 'number' ||
      typeof profile.costPerKToken === 'number' ||
      typeof profile.latencyP50 === 'number';
    if (hasField) cleanProfile = profile;
    // 无有效字段 → 忽略（等同不填，向后兼容）
  }

  try {
    const { registerModel } = await import('@sofagent/orchestrator');
    const result = registerModel(
      {
        name,
        endpoint: endpoint ?? '',
        model: model ?? '',
        ...(client_type ? { clientType: client_type } : {}),
        ...(source ? { source } : {}),
        ...(typeof eval_score === 'number' ? { meta: { evalScore: eval_score, ...(comment ? { notes: comment } : {}) } } : comment ? { meta: { notes: comment } } : {}),
        ...(cleanProfile ? { profile: cleanProfile } : {}),
      },
      { dataDir: getDataDir(), actor: 'mcp-model-register', ...(comment ? { comment } : {}) },
    );

    if (!result.ok) {
      return {
        text: `[sofagent] 模型注册失败 ❌：${result.message}`,
        data: { isError: true, ok: false, issues: result.issues, name },
      };
    }

    // decision-log 留痕（对齐 promote_ab 审计模式）
    try {
      const audit = (await import('@sofagent/audit')) as unknown as {
        emitDecision: (input: Record<string, unknown>) => unknown;
      };
      audit.emitDecision({
        agentId: 'sofagent-mcp-model-register',
        sessionId: `model-register-${Date.now()}`,
        kind: 'CONFIG_CHANGE',
        moment: 'ACT',
        why: `模型注册：${name}（endpoint=${endpoint}${source === 'local-path' ? '，local-path 扩展位' : ''}）`,
        evidence: [`model=${name} endpoint=${endpoint} client_type=${client_type ?? 'ollama'}`],
      });
    } catch {
      // 留痕降级不阻塞
    }

    return {
      text: `[sofagent] ${result.message}`,
      data: { isError: false, ok: true, issues: [], name, registered: true },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      text: `[sofagent] model_register 异常：${msg}`,
      data: { isError: true, ok: false, issues: [msg] },
    };
  }
}
