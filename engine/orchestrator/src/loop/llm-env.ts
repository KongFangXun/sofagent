// ============================================================
// loop/llm-env.ts · LOOP 角色 LLM 环境解析（v1.4.9 深模块条目 4 批三）
// ============================================================
// 从 nodes.ts 迁出（原位在 219-232 行）：角色级 SOFAGENT_LLM_<ROLE> 优先，
// 解析失败回落 SOFAGENT_LLM。独立成件后 agent-runner 与 nodes 共用，
// nodes-llm-env.test.ts 改从本文件导入（断言不变）。
// ============================================================

import { resolveLLMModel } from './llm-model-resolver'; // 四级回退解析在 llm-model-resolver.ts——llm-env 只收角色级覆写层
/**
 * 角色级 LLM 解析：SOFAGENT_LLM_<ROLE> 优先 → SOFAGENT_LLM 兜底。
 * （原 nodes.ts resolveLLMModelFor——逐字迁移，行为不变）
 */
export async function resolveLLMModelFor(role: 'engineer' | 'reviewer'): Promise<Record<string, unknown> | null> {
  const envKey = `SOFAGENT_LLM_${role.toUpperCase()}`;
  const roleEnv = process.env[envKey];
  if (roleEnv) {
    const saved = process.env.SOFAGENT_LLM;
    process.env.SOFAGENT_LLM = roleEnv;
    const result = await resolveLLMModel(role);
    process.env.SOFAGENT_LLM = saved ?? '';
    if (result) return result;
    console.warn(`[sofagent] ${envKey}=${roleEnv} 解析失败，尝试 SOFAGENT_LLM 兜底`);
  }
  return resolveLLMModel(role);
}
