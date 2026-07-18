# Work模板市场

> **这是社区模板市场**——面向用户的 workflow 目录和格式规范。
> 代码实现在 `sofagent/work模板市场/`（npm 包，负责解析和运行 workflow）。

企业工作流落地底座——预先编排好分支、工具调用顺序、接口调用，全流程轨迹固定、节点独立监控、可并行提效、几乎无幻觉。

采用**混合架构**：外层用 `workflow.yml` 的 Graph 骨架（`nextNodes`）锁定全链路步骤、保证可追溯；内层单个节点保留模型自主规划（节点 `prompt` 即 ReAct Agent）。既拿到 Workflow 的可控性，又保留局部灵活性。

## 文档

- [CATALOG.md](./CATALOG.md) —— 模板目录与分类
- [SPEC.md](./SPEC.md) —— Workflow 格式规范（`workflow.yml` 骨架 + 节点 prompt 约定）
- [CONTRIBUTING.md](./CONTRIBUTING.md) —— 如何新增 / 提交模板

设计定位详见 [根 README §Work模板市场](../README.md#work模板市场企业落地的可靠底座) 与 [ARCHITECTURE §River—Workflow—Subagent](../docs/ARCHITECTURE.md#river--workflow--subagent-三层架构)。
