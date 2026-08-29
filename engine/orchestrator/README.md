# @sofagent/orchestrator

sofagent 编排引擎——多 Agent 协作、业务流调度、prompt 模板。任务拆解 + LangGraph StateGraph 四节点串行状态机（v1.2.0 从 deepagents 迁移至 createReactAgent）。

## 安装

```bash
npm install -g @sofagent/orchestrator
```

安装后获得 `sofagent-orchestrator`（编排 CLI，含 `compose` / `compare` 子命令）与 `sofagent-orchestrator-compare` 命令。Node.js 18+。

## API

- `composeWithDeepAgents()` / `compose()` — 任务描述 → 编排方案 YAML + SubAgent 配置
- `runDAG()` — 编排执行器（当前串行，DAG 并行规划在 v1.3.1）
- `parseWorkflow()` — YAML → SubAgent 映射（含环检测 / 悬空校验）
- 依赖关系：`@sofagent/core` + `@sofagent/harness` + `@langchain/langgraph`

## 文档

- [架构总览](../../docs/ARCHITECTURE.md) — 编排引擎在约束层中的位置与数据流
- [使用手册（WIKI）](../../docs/WIKI.md) — 面向 FDE 的完整用法
- [贡献指南](../../CONTRIBUTING.md) — monorepo 单包开发流程
