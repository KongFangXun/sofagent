# 一、架构设计原则

> [← 返回索引](./index.md)

### 框架选型：createReactAgent，禁用 createDeepAgent

所有 FORGE loop 的 sub-agent 必须使用 `@langchain/langgraph/prebuilt` 的 `createReactAgent`，禁止使用 `deepagents` 的 `createDeepAgent`。

**原因**：`createDeepAgent` 硬编码注入了 `FilesystemMiddleware`（required，无法禁用），其 `wrapToolCall` 在并行工具调用时触发 `undefined.length` 崩溃。DeepSeek 偶然不触发并行调用所以能跑，GLM-5.2 / Qwen 在 superstep 5 即崩（commit 9a9c5dc）。

```js
// ❌ createDeepAgent——FilesystemMiddleware 硬编码，并行工具调用必崩
const agent = createDeepAgent({ llm, tools, middleware: [] }); // middleware:[] 是追加空数组，不是禁用

// ✅ createReactAgent——同一套 React 模式，不带 FilesystemMiddleware
const agent = createReactAgent({ llm: model, tools, stateModifier });
```

> **教训**：`middleware:[]` 看起来像"禁用 middleware"，实际是"追加空数组"（commit e4ba836 假修复）。required 的东西就是 required，读源码确认 API 语义，别靠猜。

### Driver-Worker 编排模式

Driver 是纯编排层（不审查），Worker 在独立子进程中执行单个步骤（零上下文继承）。

```mermaid
graph TD
    DRV["Driver（main process）"]
    DRV -->|"spawn"| W1["Worker ①（独立进程）"]
    DRV -->|"spawn"| W2["Worker ②（零上下文）"]
    DRV -->|"spawn"| W3["Worker ③"]
    W1 -->|"写产物"| F1["check-a.md"]
    W2 -->|"读输入/写产物"| F2["findings.md"]
    DRV -->|"数标记判停止"| LEDGER["LEDGER + latest.json"]
```

三个设计原则：
1. **Worker 零上下文**：全新 node 进程，步骤间通过文件传递数据（check-a.md → findings.md → result.md）
2. **Driver 不审查**：只做 spawn + 判停止条件（数 P0/P1 标记）
3. **文件即接口**：Worker 的输入/输出都是文件路径，多产物用 `===FILE: filename===` 分隔

> **为什么不用 in-process**：跨步骤需要全新 agent session（清空上下文），spawn 子进程是最简单的方案——进程退出即天然清空。

### 步骤定义模式

```js
const STEPS = {
  'a-check':       { role: 'A', prompt: 'a-check.md',       outputs: ['check-a.md'],             inputs: [] },
  'a-consolidate': { role: 'A', prompt: 'a-consolidate.md', outputs: ['findings.md','result.md'],inputs: ['check-a.md','check-b.md'], maxTokens: 32000 },
};
```

**命名约定**：Prompt `<role>-<action>.md`，产物 `<action>-<role>.md`。

### 目录架构：每个 loop 自包含

```
FORGE/SKILL/
├── fresh-eyes-loop/    ← prompts/ + specs/ + runs/(gitignore)
├── release-gate-loop/  ← prompts/ + runs/
└── ...（未来新 loop）
```

`.gitignore` 通配：`FORGE/SKILL/*/runs/`。

> **坑源**（commit 8cd7b23）：曾把 `runs/` 从 4 层深挪到 2 层深——"找文件方便"是工具层问题，不能破坏架构边界。
