// DeepSeek V4 Pro · 按量计费（DeepSeek API）
// OpenAI 兼容接口。支持 reasoning_effort 参数（无 thinking 参数）。
export default {
  model: 'deepseek-v4-pro',
  baseURL: 'https://api.deepseek.com/v1',
  apiKeyEnv: 'DEEPSEEK_API_KEY',      // 厂商 key 变量名（切模型时 key 自动跟着走）
  reasoningEffort: 'max',
  pricing: {
    input: 3,
    output: 6,
    currency: 'CNY',
    source: 'https://api-docs.deepseek.com/quick_start/pricing',
    note: '缓存命中 input 0.025元/M（120x 价差）。本表按未命中算（成本上界）',
    billing: 'pay-as-you-go',
  },
};
