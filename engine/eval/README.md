# @sofagent/eval

sofagent 质量评估引擎——量化指标、评分逻辑、evals 接口。v1.2.0 从 audit 包迁出。

## API

- `runEval()` — 运行评估用例集，返回 `EvalResult`
- `evalCase()` — 单条测试用例评分
- 类型：`TestCase` / `EvalResult` / `EvalBreakdown` / `EvalConfig`
- 依赖关系：`@sofagent/core`
