// DeepSeek V4 Flash · 按量计费（DeepSeek API）
// OpenAI 兼容接口。支持 reasoning_effort 参数（无 thinking 参数）。
export default {
  model: 'deepseek-v4-flash',
  baseURL: 'https://api.deepseek.com/v1',
  apiKeyEnv: 'DEEPSEEK_API_KEY',      // 厂商 key 变量名（与 Pro 共用同一个 DeepSeek key）
  reasoningEffort: 'max',
  pricing: {
    input: 0.5,
    output: 8,
    currency: 'CNY',
    source: 'https://api-docs.deepseek.com/quick_start/pricing',
    note: 'Flash 版定价（缓存未命中）。缓存命中 input 0.025元/M',
    billing: 'pay-as-you-go',
  },
};
