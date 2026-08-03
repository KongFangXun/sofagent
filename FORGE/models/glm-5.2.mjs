// GLM-5.2 · 智谱 Coding Plan 订阅制
// OpenAI 兼容接口。Coding Plan 专用端点（不能替换为通用端点 open.bigmodel.cn/api/paas/v4）。
// 支持 thinking + reasoning_effort 参数。
export default {
  model: 'glm-5.2',
  baseURL: 'https://open.bigmodel.cn/api/coding/paas/v4',
  apiKeyEnv: 'GLM_API_KEY',           // 厂商 key 变量名（切模型时 key 自动跟着走）
  thinking: { type: 'enabled' },
  reasoningEffort: 'max',
  temperature: 1.0,
  pricing: {
    input: 0,
    output: 0,
    currency: 'CNY',
    source: 'https://open.bigmodel.cn/pricing',
    note: 'Coding Plan 订阅制，不按量计价，此处置 0；按量参考 input¥10 output¥30',
    billing: 'subscription',
  },
};
