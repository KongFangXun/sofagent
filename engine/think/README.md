# @sofagent/think

sofagent 思考链分析——推理路径追踪、决策可视化、思维审计。基于 git diff 硬证据自动生成反思条目。

## API

- `generateThinkEntry()` — 从 git diff 生成反思摘要（≤200 字），写入 think.md 反思区
- 类型：`ThinkEntryOptions`
- 依赖关系：`@sofagent/core`
