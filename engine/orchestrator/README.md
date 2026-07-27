# @sofagent/orchestrator

sofagent 编排引擎——多 Agent 协作、工作流调度、prompt 模板。DeepAgents compose 任务拆解 + LangGraph StateGraph 四节点串行状态机。

## API

- `composeWithDeepAgents()` / `compose()` — 任务描述 → 编排方案 YAML + SubAgent 配置
- `runDAG()` — 编排执行器（当前串行，DAG 并行规划在 v1.3.1）
- `parseWorkflow()` — YAML → SubAgent 映射（含环检测 / 悬空校验）
- 依赖关系：`@sofagent/core` + `@sofagent/harness` + `deepagents`
