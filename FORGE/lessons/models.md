# 二、模型配置规范

> [← 返回索引](./index.md)

### 模型配置

`MODEL_CONFIGS` 必须定义完整字段（driver 启动时校验）：

```js
const MODEL_CONFIGS = {
  A: { baseURL, model, maxTokens, apiKeyEnv, specEnv, agentSkillPath, toolsKey, billing },
};
```

| 角色 | 模型 | 计费 | 用途 |
|------|------|------|------|
| A（审查者） | deepseek-v4-flash | DeepSeek API（按量） | 审查 / 合并 / 验证 |
| B（工程师） | deepseek-v4-flash | DeepSeek API（按量） | 审查 / 修复 |
| V（验证者） | deepseek-v4-flash | DeepSeek API（按量） | release-gate 全流程 |
| F（修复者） | deepseek-v4-flash | DeepSeek API（按量） | F 修复链 |

> **A/B/V/F 统一 deepseek-v4-flash**（低成本档，~0 成本）。
> 双盲审查独立性通过 A/B **不同 prompt 视角**保证（a-check.md ≠ b-check.md），**不依赖不同模型**——「异构双模型」时代已结束。
> 历史注记（勿删）：Qwen3.8-max 在工具循环里无法被 stateModifier 约束（thinking-only 停不下来）→ 改 GLM-5.2；GLM-5.2 审查步骤调 60+ 次工具不收敛。切 V4 Flash 后重点观察重型循环收敛性 + 按量计费成本。
> 权威源：`FORGE/models/profile.mjs`（换模型只改这里，lessons 不重复定义）。

### Thinking 模型特殊处理（历史，deepseek-v4-flash 不适用）

> **Qwen/GLM 时代**：A（Qwen3.8-max）是 thinking-only 模型（始终思考、无法关闭），B（GLM-5.2）通过参数显式启用 thinking。切换 deepseek-v4-flash 后**不再需要** thinking 参数特殊处理——以下为历史记录，保留供换回 thinking 类模型时参考：
>
> 1. Qwen 不传 thinking/reasoningEffort：MODEL_CONFIGS.A 不定义这两个字段
> 2. GLM 传 thinking + reasoningEffort：`thinking={type:'enabled'}` + `reasoningEffort='max'` + `temperature=1.0`
> 3. maxTokens 包含 thinking tokens → 合并步骤需单独调高
> 4. 退化逻辑保留无害：thinking 退化分支对非 thinking 模型天然不触发

### 步骤级 maxTokens 覆盖

合并/汇总步骤必须单独配 32000。默认 16000 对 a-consolidate 不够——thinking-only 的 16000 里还包含 thinking tokens → 输出被截断 → 无法生成合法 result.md → 整轮降级 → 审出的问题一个都没修。

```js
const STEPS = { 'a-consolidate': { ..., maxTokens: 32000 } };
```

### 计费模式与成本追踪

- `subscription`（订阅制）：cost_cny = null
- `pay-as-you-go`（按量）：按 MODEL_PRICING 表估算，标注 `price_confidence: 'estimated'`

> driver 算出的 cost_cny 仅供成本感知，真实账单到 API 后台查看。
