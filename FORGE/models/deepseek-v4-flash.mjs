// DeepSeek V4.1 Flash · 按量计费（DeepSeek API）
// OpenAI 兼容接口。支持 reasoning_effort 参数（无 thinking 参数）。
//
// 沿革：本文件原承载 V4-Flash；V4.1-Flash 发布后 V4-Flash 已退役，官方把
// deepseek-v4-flash 留作**临时兼容别名**路由至 V4.1-Flash（官方明示别名后续移除），
// 故 model 直接用官方正式名 deepseek-flash。文件名沿用历史命名，内容已对齐 V4.1-Flash。
// 发布说明：https://api-docs.deepseek.com/news/news260910
export default {
  model: 'deepseek-flash',
  baseURL: 'https://api.deepseek.com/v1',
  apiKeyEnv: 'DEEPSEEK_API_KEY',      // 厂商 key 变量名（与 Pro 共用同一个 DeepSeek key）
  reasoningEffort: 'max',
  pricing: {
    input: 1.0,
    output: 4.0,
    currency: 'CNY',
    source: 'https://api-docs.deepseek.com/quick_start/pricing',
    note: '官方以 USD 计价：off-peak $0.15 in / $0.6 out（cache hit $0.003），peak 为 2 倍；本表按汇率 6.71 折算为 CNY 供估算',
    billing: 'pay-as-you-go',
  },
};
