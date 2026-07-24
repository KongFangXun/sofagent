# @sofagent/ab-test

sofagent A/B 测试框架——对比实验、指标显著性分析、自动 promote 决策。

## API

- `decidePromotion()` — 对比 A/B 方案指标，连续 2 轮胜出 → auto promote
- `DEFAULT_SCORE_WEIGHTS` — 默认评分权重
- 类型：`ABConfig` / `ABTestResult` / `PromotionDecision` / `ScoreWeights`
- 依赖关系：`@sofagent/core`
