# 二、模型配置规范

> [← 返回索引](../LESSONS.md)

### 模型配置

`MODEL_CONFIGS` 必须定义完整字段（driver 启动时校验）：

```js
const MODEL_CONFIGS = {
  A: { baseURL, model, maxTokens, apiKeyEnv, specEnv, agentSkillPath, toolsKey, billing },
};
```

| 角色 | 模型 | 计费 | 用途 |
|------|------|------|------|
| A（审查者） | qwen3.8-max-preview | Token Plan 订阅制 | 审查 / 合并 / 验证 |
| B（工程师） | qwen3.8-max-preview | Token Plan 订阅制 | 审查 / 修复 |
| V（验证者） | qwen3.8-max-preview | Token Plan 订阅制 | release-gate 全流程 |

> **从异构到单模型**：v1.2.3 前用不同厂商做"异构双盲"，v1.2.4 起改 Qwen 单模型——thinking 能力够强，fresh-eyes 纪律的核心保障是**零上下文每步**（结构隔离），而非模型差异。

### Thinking-only 模型特殊处理

Qwen3.8-max-preview 是 thinking-only 模型（始终思考、无法关闭），三个约束：

1. **不传 thinking/reasoningEffort**：MODEL_CONFIGS 不定义这两个字段（reasoningEffort 是 DeepSeek 专属）
2. **maxTokens 包含 thinking tokens**：留给实际输出的更少 → 合并步骤需单独调高（见下文）
3. **退化逻辑保留无害**：thinking 退化分支对 Qwen 天然不触发，保留做参考

### 步骤级 maxTokens 覆盖

合并/汇总步骤必须单独配 32000（commit 63b130d）。默认 16000 对 a-consolidate 不够——thinking-only 的 16000 里还包含 thinking tokens → 输出被截断 → 无法生成合法 result.md → 整轮降级 → 审出的问题一个都没修。

```js
const STEPS = { 'a-consolidate': { ..., maxTokens: 32000 } };
```

### 计费模式与成本追踪

- `subscription`（订阅制）：cost_cny = null
- `pay-as-you-go`（按量）：按 MODEL_PRICING 表估算，标注 `price_confidence: 'estimated'`

> driver 算出的 cost_cny 仅供成本感知，真实账单到 API 后台查看。
