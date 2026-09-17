// ============================================================
// loop/llm-model-resolver.ts · LLM provider/model/key 解析（v1.4.8 条目 4 范围回收）
// ============================================================
// 原内联在 nodes.ts（深模块条目 4 曾被裁为「不搬」）：独立成件会触发 A2「密钥赋值形态」
// 误报——`const apiKey = resolveApiKey(role)` 的 RHS 是函数调用（运行时读取语义，
// 与 process.env 引用同构），却被赋值形态正则当硬编码密钥拦下，甚至波及文档中对代码的描述。
// A2 修复（函数调用 RHS 豁免 + 尾锚 `(?!\w|\()` 防贪婪回溯）后本件独立，
// nodes.ts 恢复「只保留节点工厂」的定位。
// 导出面经 nodes.ts re-export 原样保留（loop/index.ts 与测试导入面不变）。
// ============================================================

// LLM Provider 解析（v1.1.4 · v1.1.5 通用化）
// 通过 SOFAGENT_LLM=provider:modelName 指定模型。
//
// 支持两种 provider：
//   1. 预置 provider: glm / kimi / deepseek（走 OpenAI 兼容 API）
//   2. custom: 任意 OpenAI 兼容 API
//      SOFAGENT_LLM=custom:<模型名>
//      SOFAGENT_LLM_BASE_URL=https://your-endpoint/v1/
//      SOFAGENT_LLM_API_KEY=sk-xxx
//
// API key 优先级（按角色解析）：
//   SOFAGENT_LLM_{ROLE}_API_KEY > SOFAGENT_LLM_API_KEY > OPENAI_API_KEY（兜底）
//   例：engineer 用 SOFAGENT_LLM_ENGINEER_API_KEY；reviewer 用 SOFAGENT_LLM_REVIEWER_API_KEY
//   如果没设角色 key，退到通用 SOFAGENT_LLM_API_KEY；再退到 OPENAI_API_KEY
//
// 未设置 SOFAGENT_LLM → 返回 null → 降级到 spawnSubAgent [降级运行]。
// ════════════════════════════════════════

interface LLMProviderConfig {
  baseURL: string;
  defaultModel: string;
}

const LLM_PROVIDERS: Record<string, LLMProviderConfig> = {
  glm:      { baseURL: 'https://open.bigmodel.cn/api/paas/v4/', defaultModel: 'glm-4-flash' },
  kimi:     { baseURL: 'https://api.moonshot.cn/v1/',         defaultModel: 'moonshot-v1-8k' },
  deepseek: { baseURL: 'https://api.deepseek.com/v1/',         defaultModel: 'deepseek-chat' },
};

/**
 * 按角色解析 API key（v1.1.5 · v1.2.6 FORGE A/B 兜底）。
 * 四级回退：SOFAGENT_LLM_{ROLE}_API_KEY > SOFAGENT_LLM_API_KEY > SOFAGENT_LLM_A_API_KEY > OPENAI_API_KEY
 */
function resolveApiKey(role: 'engineer' | 'reviewer' | null = null): string | undefined {
  if (role) {
    const roleKey = process.env[`SOFAGENT_LLM_${role.toUpperCase()}_API_KEY`];
    if (roleKey) return roleKey;
  }
  return process.env.SOFAGENT_LLM_API_KEY
    ?? process.env.SOFAGENT_LLM_A_API_KEY   // v1.2.6 FORGE A 角色兜底
    ?? process.env.OPENAI_API_KEY;
}

export async function resolveLLMModel(role: 'engineer' | 'reviewer' | null = null): Promise<Record<string, unknown> | null> {
  const llmEnv = process.env.SOFAGENT_LLM;
  // v1.2.6: 打通 FORGE A/B 环境变量回退
  // 有 role 时：SOFAGENT_LLM_{ROLE} > SOFAGENT_LLM_A（兜底）
  // 无 role 时：SOFAGENT_LLM_A > SOFAGENT_LLM_B（兜底）
  // 占位值豁免：FORGE env.local.template 教用户设 SOFAGENT_LLM_A="active" 等
  // 占位串（driver 启动检查只要求非空，真实模型由 profile.mjs 决定）——
  // 这类值不是 provider:model 格式，须跳过该级回退而不是当 provider 解析
  // （旧实现会打「未知的 LLM provider: active」告警并降级，模板与引擎语义冲突）。
  const PLACEHOLDER_VALUES = new Set(['active', 'on', 'true', '1', 'enabled', 'yes']);
  const isPlaceholder = (v: string | undefined): boolean =>
    !!v && PLACEHOLDER_VALUES.has(v.trim().toLowerCase());
  const effectiveLlmEnv = [llmEnv, role ? process.env[`SOFAGENT_LLM_${role.toUpperCase()}`] : undefined, process.env.SOFAGENT_LLM_A, process.env.SOFAGENT_LLM_B]
    .find((v): v is string => !!v && !isPlaceholder(v));
  if (!effectiveLlmEnv) return null;

  const [provider, modelName] = effectiveLlmEnv.split(':');
  const providerKey = provider ?? '';

  // 解析 baseURL：custom 走 env，预置 provider 走查表
  let baseURL: string;
  if (providerKey === 'custom') {
    baseURL = process.env.SOFAGENT_LLM_BASE_URL ?? '';
    if (!baseURL) {
      console.warn('[sofagent] custom provider 需要 SOFAGENT_LLM_BASE_URL 环境变量');
      return null;
    }
  } else {
    const config = LLM_PROVIDERS[providerKey];
    if (!config) {
      console.warn(`[sofagent] 未知的 LLM provider: ${providerKey || '(空)'}。支持: glm, kimi, deepseek, custom。custom 需配合 SOFAGENT_LLM_BASE_URL 使用`);
      return null;
    }
    baseURL = config.baseURL;
  }

  // 解析 API key（v1.1.5 三级回退）
  const apiKey = resolveApiKey(role);
  if (!apiKey) {
    console.warn(`[sofagent] 未找到 API key。请设置以下任一环境变量（按优先级）：${role ? `\n  SOFAGENT_LLM_${role.toUpperCase()}_API_KEY（推荐：${role} 专用）` : ''}\n  SOFAGENT_LLM_API_KEY（通用）\n  OPENAI_API_KEY（兜底）`);
    return null;
  }

  try {
    const { ChatOpenAI } = await import('@langchain/openai');
    const model = new ChatOpenAI({
      modelName: modelName || LLM_PROVIDERS[providerKey]?.defaultModel || 'gpt-4o-mini',
      configuration: { baseURL },
      openAIApiKey: apiKey,
    });
    return { model };
  } catch {
    console.warn('[sofagent] @langchain/openai 初始化失败，降级到零工具路径');    return null;
  }
}
