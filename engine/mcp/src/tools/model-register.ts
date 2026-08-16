// ============================================================
// model-register.ts · MCP tool：model_register（v1.3.6 交付 ④）
// ============================================================
//
// 模型注册入口——评测（v1.3.1 Benchmark）通过后注册模型 endpoint。
// 委托 @sofagent/orchestrator 的 registerModel（原子写 + 事件留痕）。
//
// 边界：
//   - 本版只处理 endpoint 型模型；source='local-path' 为 v1.4.1 扩展位预留
//   - endpoint 可以是第三方 router（LiteLLM/OpenRouter）地址——
//     sofagent 只管「上线了没/灰度到多少/退役了没」，路由由第三方决定
// ============================================================

import { join } from 'path';

function getSofagentDataDir(): string {
  return process.env.SOFAGENT_DATA || join(process.cwd(), 'data');
}

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
  const { name, endpoint, model, client_type, source, eval_score, comment } = args;

  if (typeof name !== 'string' || name.trim() === '') {
    return {
      text: '[sofagent] model_register 失败：name 必填且非空',
      data: { isError: true, ok: false, issues: ['name 必填且非空'] },
    };
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
      },
      { dataDir: getSofagentDataDir(), actor: 'mcp-model-register', ...(comment ? { comment } : {}) },
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
