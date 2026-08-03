// Qwen3.8-max · 阿里百炼 Token Plan 订阅制
// OpenAI 兼容接口。thinking-only 模型（始终思考、无法关闭）。
// 不需要（也不应传）enable_thinking/thinking 参数，也没有 reasoningEffort（DeepSeek/GLM 专属）。
export default {
  model: 'qwen3.8-max',
  baseURL: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  apiKeyEnv: 'QWEN_API_KEY',         // 厂商 key 变量名（切模型时 key 自动跟着走）
  pricing: {
    input: 0,
    output: 0,
    currency: 'CNY',
    source: 'https://help.aliyun.com/zh/model-studio/deep-thinking',
    note: 'Token Plan 订阅制，不按量计价，此处置 0',
    billing: 'subscription',
  },
};
