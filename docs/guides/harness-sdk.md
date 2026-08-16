# SubAgent 托管 SDK（`harness.wrap`）

> v1.3.6 交付——约束层作为引擎的**最终接缝**：开发者用 LangChain/LangGraph 写自己的 graph，一行包装即自动获得约束层全部能力（审计 / 审批 / 身份 / Trace / 决策审计）。

## 为什么需要托管 SDK

此前，开发者/商业侧的 Agent 进约束层只有两条路——workflow.yml 映射（4 种内置类型）或 agent-creation 生成。**没有「自定义 graph 直接托管」的开发接口**。

托管 SDK 补上这条缺口：**模型生成的 sub-agent 本质是 graph 配置，托管 SDK 让它们直接受约束层治理**——这也是「sub-agent 自动设计与训练」的落点。

## 快速开始（10 行跑通受约束 Agent）

```ts
import { harness } from '@sofagent/orchestrator';
import { createReactAgent } from '@langchain/langgraph/prebuilt';

// 1. 你自己的 LangGraph agent（createReactAgent 或纯 StateGraph 编译产物均可）
const myAgent = await createReactAgent({ llm: model, tools: myTools });

// 2. 一行包装——获得审计 / 审批 / 身份 / Trace 全部治理面
const hosted = harness.wrap(myAgent, {
  approval: 'allow-with-audit', // 放行但全部留痕（保守默认）
  identity: 'enterprise-001',   // 委托人标识（自动签发身份码）
  trace: true,                  // LLM 调用级 Trace 落盘
});

// 3. 照常 invoke——工具调用已在内部被拦截审计
const result = await hosted.agent.invoke({ messages: [...] });
```

## 双形态兼容

| 形态 | 用法 | 拦截点 |
|------|------|--------|
| `createReactAgent` | `wrapTools(myTools, options)` 后传给 agent | middleware 工具链路 |
| 纯 `StateGraph` | 同一 `wrapTools` 产物注入 `tools` 节点 | tools 节点（工具调用必经点） |

两形态共享同一工具层拦截内核——`harness.wrapTools(tools, options)` 是共同的治理注入点。

## 审批模式

| 模式 | 语义 |
|------|------|
| `allow-with-audit`（默认） | 放行 + 审计留痕（保守默认，不破坏既有行为） |
| `require-approval` | 副作用类工具（write/delete/git 等）调 `requestApproval` 等人审；**无审批通道时 fail-safe 拒绝** |
| `deny` | 副作用类工具全部拦截（只读观察模式——适合审计/监控类 agent） |

副作用工具判定：`isSideEffectTool(name)`——按名匹配（write/delete/git/bash/run 等）。

## registry 执行链

`wrap()` 自动把 agent 注册为 **graph 构建器**（工厂函数）：

- registry 存「怎么构建」（`getGraphBuilder(name).build()`）
- dag-runner 管「什么时候构建」——workflow 节点 `agent: <name>` 命中构建器时按需实例化执行

避免「注册了但跑不起来」：dag-runner 不直接引用 registry，走 parser 解析链，链上命中构建器才实例化。

## 版本边界

`sandbox: true` 依赖 v1.3.7 沙箱组件——**本版传 true 返回明确错误「v1.3.8 启用」**，v1.3.8（沙箱已交付）接入。

## 层级定位

托管 SDK 与 DSH 的集成收敛为 **plugin（能力挂载）+ 审批应答者（治理通道）** 两层，不做 DSH 第七种 SubAgent 提供方——sofagent 是治理层不是执行体：我们的战场是约束与审计「干活的 Agent」，不是自己下场当一个可被委派的打工人。
