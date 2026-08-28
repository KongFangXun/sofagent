// GLM-5.3-Flash · 智谱 Coding Plan 订阅制（GLM-5 系列首个原生多模态，320B/激活 18B 混合架构）
// OpenAI 兼容接口。与 glm-5.3 同走 Coding Plan 专用端点（不能替换为通用端点 open.bigmodel.cn/api/paas/v4）。
// 官方文档：https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash
// 要点：thinking.type 仅支持 enabled（建议 clear_thinking: false）；reasoning_effort 推荐 max；
//      Coding Plan 下相较于 glm-5.3 可用额度增加至 3 倍。
export default {
  model: 'glm-5.3-flash',
  baseURL: 'https://open.bigmodel.cn/api/coding/paas/v4',
  apiKeyEnv: 'GLM_API_KEY',           // 厂商 key 变量名（与 glm-5.3 共用同一个 Coding Plan key）
  thinking: { type: 'enabled', clear_thinking: false },
  reasoningEffort: 'max',
  temperature: 1.0,
  pricing: {
    input: 0,
    output: 0,
    currency: 'CNY',
    source: 'https://open.bigmodel.cn/pricing',
    note: 'Coding Plan 订阅制，不按量计价，此处置 0；按量参考 input¥1 output¥8（以官网为准）',
    billing: 'subscription',
  },
};
