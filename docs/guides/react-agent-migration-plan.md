# 迁移架构方案：createDeepAgent → createReactAgent

> ⚠️ **v1.2.0 迁移已完成，本文档仅保留作历史参考。** deepagents 已于 v1.2.0 彻底弃用，编排引擎全面迁移至 LangGraph createReactAgent。以下内容反映的是迁移决策过程，不代表当前架构。
>
> 架构师 Bob 出品 · 2026-07-26
> 目标：代码追上文档声明——v1.2.0 已声称弃用 deepagents，迁移至 LangGraph createReactAgent

---

## 1. 总体策略

核心思路是**最小差异迁移（minimal viable diff）**：将所有 `import('deepagents')` 的 `createDeepAgent` 替换为 `import('@langchain/langgraph/prebuilt')` 的 `createReactAgent`，同时处理三个关键差异点——工具格式转换（ExecutableTool → DynamicStructuredTool）、FilesystemMiddleware 消失后的工具自给、subagents 真委派的替代实现。

迁移的关键依据：
- FORGE 的 `fresh-eyes-driver.mjs` 已在生产环境跑通同样的迁移（commit 9a9c5dc），验证了 `createReactAgent` 可以完全替代 `createDeepAgent`
- `@langchain/langgraph@^1.4.7` 已经在 orchestrator 的 dependencies 中，无需新增依赖
- ENGINEER_TOOLS / REVIEWER_TOOLS 已包含完整的文件工具（sf_read/sf_write/sf_edit/search_code/run_bash/run_test），无需依赖 deepagents 的 FilesystemMiddleware

迁移按"最简单 → 最复杂"的顺序推进：先处理单 Agent 调用（composer / launcher / ab-runner），再处理带工具注入的节点（nodes.ts），最后处理带 subagents 委派的最复杂场景（dag-runner.ts）。

---

## 2. 文件级迁移清单

| 文件 | 迁移动作 | 复杂度 | 关键变更点 |
|------|---------|--------|-----------|
| `tools.ts` | 新增 `convertToLangGraphTools()` 转换函数 | 中 | ExecutableTool[] → DynamicStructuredTool[] 转换层（JSON Schema → zod） |
| `loop/nodes.ts` | 替换 engineer/reviewer 两处 createDeepAgent | 中 | import 源切换 + 工具转换 + prompt 参数名 `systemPrompt` → `prompt` + `maxTurns` → `recursionLimit` |
| `composer.ts` | 替换 composeYaml 中的 createDeepAgent | 低 | import 源切换 + 参数名调整（单 Agent 纯文本生成，无工具） |
| `launcher.ts` | 替换 loadDeepAgents / launch 中的 createDeepAgent | 低 | import 源切换 + 参数名调整 |
| `ab-runner.ts` | 替换 runDeepAgent 中的 createDeepAgent | 低 | import 源切换 + 参数名调整 + 新增 @langchain/langgraph 依赖 |
| `dag-runner.ts` | 替换 CreateDeepAgentFn + subagents 委派 | **高** | 类型改名 + subagents → tools 方案 + loadCreateDeepAgent 改名 |
| `__tests__/dag-runner.test.ts` | 同步调整 mock 签名 | 中 | CreateDeepAgentFn → CreateReactAgentFn + mock 参数结构变化 |

---

## 3. FilesystemMiddleware 替代方案（难点 1）

**结论：不需要额外补工具。ENGINEER_TOOLS / REVIEWER_TOOLS 已经完全自给。**

分析依据：

```
deepagents FilesystemMiddleware 提供的内置工具：
  read_file, write_file, edit_file, glob, grep, execute

sofagent ENGINEER_TOOLS 已包含的自定义工具（tools.ts）：
  sf_read    → 等价 read_file（改名避开 BUILTIN 冲突，见 LESSONS.md 坑 3）
  sf_write   → 等价 write_file
  sf_edit    → 等价 edit_file
  search_code → 等价 glob+grep（grep -rn 实现）
  run_bash   → 等价 execute
  run_test   → 额外（npm test 封装）

sofagent REVIEWER_TOOLS 已包含：
  sf_read, search_code, run_bash（只读 3 个，审查员不写）
```

tools.ts 第 68-70 行和第 104-106 行的注释已明确说明改名原因："原名 read_file/write_file/edit_file，因 deepagents 内置保留名冲突改名"。这些工具从一开始就是作为 deepagents FilesystemMiddleware 的替代品设计的。

**迁移后唯一需要做的事**：工具格式转换。createDeepAgent 接受 `ExecutableTool`（`{name, description, schema, func}` 格式），createReactAgent 的 ToolNode 要求 `DynamicStructuredTool`（由 `@langchain/core/tools` 的 `tool()` 函数创建）。

转换方案——在 `tools.ts` 中新增一个转换函数（FORGE 的 `loadTools()` 已有跑通的 .mjs 参考，需翻译为 TypeScript）：

```typescript
// tools.ts 新增导出
import { tool, type DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

export function convertToLangGraphTools(tools: ExecutableTool[]): DynamicStructuredTool[] {
  return tools.map(t => {
    // JSON Schema → zod 简化转换
    const zodShape: Record<string, z.ZodTypeAny> = {};
    const properties = t.schema.properties;
    const requiredFields = t.schema.required ?? [];
    for (const [key, prop] of Object.entries(properties)) {
      const p = prop as { type?: string; description?: string };
      let zodField: z.ZodTypeAny;
      if (p.type === 'number' || p.type === 'integer') zodField = z.number();
      else if (p.type === 'boolean') zodField = z.boolean();
      else zodField = z.string(); // fallback（当前所有工具参数都是 string）
      if (p.description) zodField = (zodField as any).describe(p.description);
      if (!requiredFields.includes(key)) zodField = zodField.optional();
      zodShape[key] = zodField;
    }
    return tool(
      async (input) => { const result = t.func(input); return await result; },
      { name: t.name, description: t.description, schema: z.object(zodShape) }
    );
  });
}
```

**需要确认的包**：
- `@langchain/core` — 已通过 `@langchain/langgraph` 间接安装（node_modules 中存在），但 orchestrator/package.json 当前未显式声明。**建议加入显式 dependencies**。
- `zod` — 已在 node_modules 中存在（deepagents/langgraph 间接依赖），**建议加入显式 dependencies**。

---

## 4. subagents 真委派替代方案（难点 2）

**选择方案 B：把 subagents 的能力封装成 tools，注入给单个 createReactAgent。**

### 三方案对比

| 方案 | 描述 | 优点 | 缺点 | 结论 |
|------|------|------|------|------|
| A | 每个 subagent → 独立 createReactAgent 实例 + 外层 StateGraph 编排 | 最灵活，真并行 | 改动巨大，dag-runner 几乎重写，超出"最小差异"原则 | ✗ |
| **B** | **每个 subagent → 一个 tool，注入给单个 createReactAgent** | **改动小，保持 dag-runner 现有结构** | **主 Agent 通过 tool call 委派（非 subagents 参数）** | **✓** |
| C | 保持接口不变只换内部实现（适配器层） | 接口零变化 | createReactAgent 不支持 subagents 参数，适配器层只是把方案 B 包了一层，多一层无意义抽象 | ✗ |

### 方案 B 的具体设计

当前 dag-runner 的 `createDeepAgent({ subagents, tools, systemPrompt })` 中：
- `subagents`：每个有 `{ name, description, systemPrompt }`，主 Agent 通过 `task` tool 委派
- `tools: []`：主 Agent 自己不用工具，只做委派

迁移后：
- 每个 subagent 被封装为一个 **`task_<name>` tool**（DynamicStructuredTool）
- tool 的 `func` 内部创建一个子 `createReactAgent` 实例并 invoke
- 所有 `task_<name>` tools 注入给主 `createReactAgent`
- 主 Agent 的 `tools` 从 `[]` 变为 `[task_node1, task_node2, ...]`

**伪代码（给工程师的实现指引，不是最终代码）**：

```typescript
// 迁移后的 dag-runner runDAG() 核心逻辑
const subagentTools = configs.map(c => {
  const subSystemPrompt = constrainedPrefix
    ? `${constrainedPrefix}\n\n${c.systemPrompt}`
    : c.systemPrompt;

  // 每个 subagent 封装为一个 tool
  return tool(
    async (input: { task_description: string }) => {
      // 内部创建子 agent
      const subAgent = createReactAgent({
        llm: model,
        tools: convertToLangGraphTools(ENGINEER_TOOLS), // SubAgent 继承默认工具集
        prompt: subSystemPrompt,
      });
      const result = await subAgent.invoke({
        messages: [{ role: 'user', content: input.task_description }],
      }, { recursionLimit: 50 });
      return extractAgentText(result);
    },
    {
      name: `task_${c.name}`,
      description: c.description,
      schema: z.object({
        task_description: z.string().describe('委派给此 Agent 的子任务描述'),
      }),
    }
  );
});

// 主 Agent 用 subagent tools 委派
const orchestrator = createReactAgent({
  llm: model,
  tools: subagentTools,
  prompt: ORCHESTRATOR_PROMPT,
});
```

**注意点**：
1. dag-runner 当前没有传 `model`/`llm` 参数给 createDeepAgent（deepagents 内部自动从环境变量解析 LLM）。createReactAgent 需要显式传 `llm`。**需要从 nodes.ts 的 `resolveLLMModelFor()` 提取模型解析逻辑，或让 dag-runner 也走相同的 LLM 解析路径。** 这是迁移引入的一个新依赖点。
2. `assertSubAgentsNoEmptyTools()` 函数在迁移后**语义变化**——不再有 subagents 配置数组（subagents 变成了 tools）。建议保留函数但改为检查 `subagentTools.length > 0`，或标记为 deprecated。
3. `detectFileConflicts()` 和 `ORCHESTRATOR_PROMPT` **不需要改**——它们是纯文本处理，与 Agent 创建无关。

---

## 5. 依赖倒置接口调整（难点 3）

### 类型改名策略

**建议全部改名（CreateDeepAgentFn → CreateReactAgentFn），不留旧名。**

理由：
1. 迁移完成后 deepagents 包会被移除，留着 "Deep" 命名会造成认知混淆
2. 改名是机械替换，风险可控
3. 文档已声明弃用 deepagents，代码命名应与文档一致

### 具体改名清单

| 文件 | 旧名 | 新名 |
|------|------|------|
| dag-runner.ts | `CreateDeepAgentFn` | `CreateReactAgentFn` |
| dag-runner.ts | `loadCreateDeepAgent()` | `loadCreateReactAgent()` |
| dag-runner.ts | `DagRunnerDeps.createDeepAgent` | `DagRunnerDeps.createReactAgent` |
| dag-runner.ts | `assertSubAgentsNoEmptyTools()` | 保留名称但改注释（或改为 `assertHasSubAgentTools()`） |
| composer.ts | `DeepAgentFactory` | `ReactAgentFactory` |
| composer.ts | `loadDeepAgentsCreate()` | `loadReactAgentCreate()` |
| composer.ts | `ComposeAgentConfig` / `ComposeAgent` | 保留（这些是本地接口，不含 "Deep"） |
| launcher.ts | `DeepAgentConfig` / `DeepAgentFactory` | `ReactAgentConfig` / `ReactAgentFactory` |
| launcher.ts | `loadDeepAgents()` | `loadReactAgent()` |
| ab-runner.ts | `DeepAgentConfig` / `DeepAgentFactory` / `DeepAgentInstance` | `ReactAgentConfig` / `ReactAgentFactory` / `ReactAgentInstance` |
| ab-runner.ts | `runDeepAgent()` | `runReactAgent()` |
| dag-runner.test.ts | `CreateDeepAgentFn` import | `CreateReactAgentFn` |
| dag-runner.test.ts | `mockCreateDeepAgent()` | `mockCreateReactAgent()` |

### createReactAgent 签名 vs createDeepAgent 签名

```typescript
// createDeepAgent（旧）签名（来自 dag-runner.ts CreateDeepAgentFn）
createDeepAgent({
  subagents: Array<{ name; description; systemPrompt; tools? }>,
  tools: unknown[],
  systemPrompt: string,
  // 可选：model, maxTurns, middleware 等
}) → Promise<{ invoke: (input) => Promise<unknown> }>

// createReactAgent（新）签名（来自 @langchain/langgraph/prebuilt）
createReactAgent({
  llm: BaseLanguageModel,       // 必填，显式传模型
  tools: DynamicStructuredTool[], // 必填，用 tool() 创建
  prompt: string,                // 注意：参数名是 prompt 不是 systemPrompt
}) → CompiledStateGraph           // 有 .invoke() 和 .stream() 方法
```

关键差异：
1. **参数名**：`systemPrompt` → `prompt`
2. **必填 llm**：需要显式传模型实例（不再由 deepagents 内部自动解析）
3. **无 subagents**：不支持 subagents 参数（方案 B 用 tools 替代）
4. **无 maxTurns**：用 `invoke()` 的第二参数 `{ recursionLimit }` 替代
5. **返回值**：`CompiledStateGraph` 而非自定义对象，但都有 `.invoke()` 方法，兼容

---

## 6. ToolGate 兼容性确认（难点 4）

**结论：ToolGate 完全兼容，但需要调整包装层级。**

### 当前架构

```
tools.ts:
  ENGINEER_TOOLS (ExecutableTool[])
    ↓ wrapToolsWithGate(ENGINEER_TOOLS, gate)
  gatedTools (ExecutableTool[])  ← gate 在 func 层面拦截
    ↓ 注入 createDeepAgent
  Agent 使用
```

`wrapToolsWithGate` 的实现（tools.ts 第 545-563 行）是在每个 tool 的 `func` 外面包一层 gate 检查——这是一个**纯 JavaScript 层面的函数包装**，与 LangGraph 的 ToolNode 无关。

### 迁移后的架构

```
tools.ts:
  ENGINEER_TOOLS (ExecutableTool[])
    ↓ wrapToolsWithGate(ENGINEER_TOOLS, gate)
  gatedTools (ExecutableTool[])  ← gate 仍在 func 层面拦截（不变）
    ↓ convertToLangGraphTools(gatedTools)
  DynamicStructuredTool[]        ← 转换后的 tool() 包装，func 内部调用 gatedTool.func
    ↓ 注入 createReactAgent
  Agent 使用
```

**关键**：gate 包装在转换**之前**执行。`convertToLangGraphTools` 的 `tool()` 包装内部调用 `t.func(input)`，而这个 `t.func` 已经是 gated 版本——所以 gate 检查在 ToolNode 执行 tool 时自然触发。

**不需要改动的部分**：
- `createToolGate()` — 不依赖 Agent 框架，纯逻辑
- `wrapToolsWithGate()` — 纯函数包装，与框架无关
- `toolGate` 单例 — 同上

**调用顺序调整**（nodes.ts 中）：

```typescript
// 迁移前（nodes.ts defaultRunEngineer）
const gate = createToolGate({ agentName: 'engineer', taskDesc: task.slice(0, 500) });
const gatedTools = wrapToolsWithGate(ENGINEER_TOOLS, gate);
const agent = await createDeepAgent({ ...resolved, tools: gatedTools, systemPrompt, maxTurns });

// 迁移后（nodes.ts defaultRunEngineer）
const gate = createToolGate({ agentName: 'engineer', taskDesc: task.slice(0, 500) });
const gatedTools = wrapToolsWithGate(ENGINEER_TOOLS, gate);
const langGraphTools = convertToLangGraphTools(gatedTools); // ← 新增转换层
const agent = createReactAgent({
  llm: resolved.model,           // ← 从 resolved 中取 model
  tools: langGraphTools,
  prompt: systemPrompt,          // ← systemPrompt → prompt
});
const result = await agent.invoke(
  { messages: [{ role: 'user', content: fullTask }] },
  { recursionLimit: resolveMaxTurns('engineer') * 2 }, // ← maxTurns → recursionLimit（×2 因为每轮 = 2 步）
);
```

---

## 7. 降级兜底处理（难点 5）

**结论：降级逻辑保留，只需把 catch 中的 `createDeepAgent` import 改为 `createReactAgent`。降级路径本身不需要调整。**

### 当前降级逻辑（nodes.ts 第 247-251 行）

```typescript
} catch {
  // 降级兜底：模型解析失败 / deepagents import 失败 → spawnSubAgent 零工具路径
  const fallback = await spawnSubAgent(ENGINEER_AGENT, fullTask);
  return `[降级运行] ${fallback}`;
}
```

这个 try/catch 的触发条件是：
1. `resolveLLMModelFor()` 返回 null（SOFAGENT_LLM 未设置）
2. `import('deepagents')` 失败（包未安装）

迁移后触发条件变为：
1. `resolveLLMModelFor()` 返回 null — **不变**
2. `import('@langchain/langgraph/prebuilt')` 失败 — **几乎不可能**（langgraph 是核心依赖，不像 deepagents 是可选的）

**降级路径 `spawnSubAgent`** 走的是 `launcher.ts` → `composeWithDeepAgents`（composer.ts），所以 launcher 和 composer 的迁移完成后，降级链路也自动跟着迁移了。不需要额外处理。

### ab-runner.ts 的降级逻辑（第 205-221 行）

```typescript
async function runTestCase(testCase, skillPath, verbose) {
  try {
    return await withTimeout(() => runDeepAgent(testCase, skillPath), 5 * 60 * 1000);
  } catch (e) {
    // DeepAgents 运行超时或异常，降级到方案 B（模型 API 直跑）
    return await runMinimalAgent(testCase, skillPath);
  }
}
```

迁移后 `runDeepAgent` 改名为 `runReactAgent`，降级路径 `runMinimalAgent` 不变（它本来就不依赖 Agent 框架，直接调 `callModelAPI`）。

---

## 8. 任务列表（给工程师）

> 以下任务按依赖顺序排列。每个任务标注了涉及的文件、具体改什么、依赖关系。

### T01: 工具转换层 + 依赖声明

**文件**：
- `engine/orchestrator/src/tools.ts`（修改）
- `engine/orchestrator/package.json`（修改）

**具体改动**：
1. 在 tools.ts 中新增 `convertToLangGraphTools(tools: ExecutableTool[]): DynamicStructuredTool[]` 函数
   - 参考 FORGE `fresh-eyes-driver.mjs` 的 `loadTools()` 转换逻辑（JSON Schema → zod）
   - 导出该函数供 nodes.ts / dag-runner.ts 使用
2. 在 package.json 的 dependencies 中新增 `"@langchain/core"` 和 `"zod"` 的显式声明（当前是间接依赖）
3. **暂时不移除** `"deepagents"` 依赖（等全部迁移完成 + 测试通过后再移除）

**依赖**：无（第一步）

**验收标准**：`convertToLangGraphTools(ENGINEER_TOOLS)` 返回 6 个 DynamicStructuredTool 实例，每个有正确的 name/description/schema。

---

### T02: 简单单 Agent 迁移（composer.ts + launcher.ts + ab-runner.ts）

**文件**：
- `engine/orchestrator/src/composer.ts`（修改）
- `engine/orchestrator/src/launcher.ts`（修改）
- `engine/ab-test/src/ab-runner.ts`（修改）
- `engine/ab-test/package.json`（修改）

**具体改动**：

**composer.ts**：
1. `loadDeepAgentsCreate()` → `loadReactAgentCreate()`：import 源从 `'deepagents'` 改为 `'@langchain/langgraph/prebuilt'`，import 的符号从 `createDeepAgent` 改为 `createReactAgent`
2. 类型改名：`DeepAgentFactory` → `ReactAgentFactory`
3. `composeYaml()` 中调用处：`createDeepAgent({ name, systemPrompt, tools: [] })` → `createReactAgent({ llm: model, tools: [], prompt: systemPrompt })`
   - **注意**：composer 当前不传 model（deepagents 内部自动解析）。createReactAgent 需要显式传 llm。需要从 nodes.ts 提取 `resolveLLMModel()` 的逻辑，或在 composer 中内联一个简易模型解析。
   - **最小改动方案**：composer 调用 `resolveLLMModel(null)` 获取 model 实例（从 nodes.ts 导出该函数，或在 composer 中 import）。如果解析失败，走现有的 `return null` 降级路径。

**launcher.ts**：
1. `loadDeepAgents()` → `loadReactAgent()`：同 composer
2. 类型改名：`DeepAgentConfig` → `ReactAgentConfig`，`DeepAgentFactory` → `ReactAgentFactory`
3. `launch()` 中调用处：参数名 `systemPrompt` → `prompt`，新增 `llm` 参数（从 definition.modelName 或环境变量解析）
4. `spawnSubAgent()` 中的 `import('./composer')` 调用不变（composer 内部已迁移）

**ab-runner.ts**：
1. `runDeepAgent()` → `runReactAgent()`：import 源切换 + 参数名调整
2. 类型改名：`DeepAgentConfig` → `ReactAgentConfig`，`DeepAgentInstance` → `ReactAgentInstance`，`DeepAgentFactory` → `ReactAgentFactory`
3. `runTestCase()` 中的调用同步改名
4. package.json 新增 `"@langchain/langgraph"` 依赖

**依赖**：T01（需要 convertToLangGraphTools，虽然这三个文件暂时不需要工具转换，但保持 import 一致性）

**验收标准**：三个文件的 `tsc --noEmit` 通过，不出现 `deepagents` 或 `createDeepAgent` 字样。

---

### T03: nodes.ts 迁移（engineer/reviewer 节点）

**文件**：
- `engine/orchestrator/src/loop/nodes.ts`（修改）

**具体改动**：

**defaultRunEngineer()**（第 208-252 行）：
1. 第 228 行 `const { createDeepAgent } = await import('deepagents')` → `const { createReactAgent } = await import('@langchain/langgraph/prebuilt')`
2. 第 234-241 行 createDeepAgent 调用 → createReactAgent 调用：
   ```typescript
   const langGraphTools = convertToLangGraphTools(gatedTools);
   const agent = createReactAgent({
     llm: resolved.model,  // resolved 来自 resolveLLMModelFor
     tools: langGraphTools,
     prompt: systemPrompt,
   });
   const result = await agent.invoke(
     { messages: [{ role: 'user', content: fullTask }] },
     { recursionLimit: resolveMaxTurns('engineer') * 2 },
   );
   ```
3. `import { convertToLangGraphTools } from '../tools'`（新增）

**defaultRunReviewer()**（第 346-395 行）：
1. 同 engineer，第 371 行 import 源切换
2. 第 377-384 行调用方式同上调整
3. 工具用 REVIEWER_TOOLS

**extractAgentText()**（第 473-489 行）：
- **不需要改**——createReactAgent 的返回值也有 `messages` 数组，格式兼容。

**降级 catch 块**：
- **不需要改**——catch 里走的是 `spawnSubAgent`（launcher.ts），launcher 已在 T02 迁移。

**依赖**：T01（convertToLangGraphTools）、T02（launcher 的 spawnSubAgent 已迁移）

**验收标准**：`tsc --noEmit` 通过；engineer/reviewer 节点的 createReactAgent 调用参数正确（llm + tools + prompt + recursionLimit）。

---

### T04: dag-runner.ts 迁移（subagents 委派）+ 测试同步

**文件**：
- `engine/orchestrator/src/dag-runner.ts`（修改）
- `engine/orchestrator/src/__tests__/dag-runner.test.ts`（修改）

**具体改动**：

**dag-runner.ts**：

1. 类型改名（全局替换）：
   - `CreateDeepAgentFn` → `CreateReactAgentFn`
   - `loadCreateDeepAgent()` → `loadCreateReactAgent()`
   - `DagRunnerDeps.createDeepAgent` → `DagRunnerDeps.createReactAgent`

2. `CreateReactAgentFn` 签名调整——不再有 `subagents` 参数，改为纯 `(params: { llm, tools, prompt }) => ...`：
   ```typescript
   export type CreateReactAgentFn = (params: {
     llm: unknown;              // BaseLanguageModel 实例
     tools: unknown[];           // DynamicStructuredTool[]
     prompt: string;
   }) => Promise<{ invoke: (input: ..., config?: { recursionLimit?: number }) => Promise<unknown> }>;
   ```

3. `loadCreateReactAgent()` 的 import 源切换

4. `runDAG()` 核心逻辑重写（方案 B）：
   - 保留：parseWorkflowYaml / detectFileConflicts / 四层约束 prompt 注入
   - 改变：`createDeepAgent({ subagents, tools: [], systemPrompt })` → 每个 subagent 封装为 tool + `createReactAgent({ llm, tools: subagentTools, prompt })`
   - 新增：LLM 模型解析（从 nodes.ts 导入 `resolveLLMModelFor` 或 `resolveLLMModel`）
   - 新增：`import { convertToLangGraphTools } from './tools'`
   - 新增：`import { tool } from '@langchain/core/tools'`、`import { z } from 'zod'`

5. `assertSubAgentsNoEmptyTools()` 调整：
   - 语义变化——不再检查 subagents 配置数组
   - 改为检查 `subagentTools.length > 0`，或标记 deprecated 并保留空实现不抛错

6. `ORCHESTRATOR_PROMPT` 微调：
   - "用 task 工具把节点的 task 描述交给它" → "用 `task_<name>` 工具委派"（工具命名格式变了）

**dag-runner.test.ts**：

1. import 改名：`CreateDeepAgentFn` → `CreateReactAgentFn`
2. `mockCreateDeepAgent()` → `mockCreateReactAgent()`：
   - mock 签名从 `(params: { subagents, tools, systemPrompt })` 变为 `(params: { llm, tools, prompt })`
   - captured.params 的结构变化：不再有 `.subagents`，改为 `.tools`（subagent tools 数组）
3. 用例 1（端到端）：断言从 `captured.params.subagents.length` 变为 `captured.params.tools.length`
4. 用例 2（冲突检测）：`captured.params` 结构同上调整
5. 用例 5（不可用）：错误信息从 "deepagents 不可用" 改为 "langgraph createReactAgent 不可用" 或 "createReactAgent 不可用"
6. 用例 6（F-01 回归）：`assertSubAgentsNoEmptyTools` 调整为检查 tools 数组

**依赖**：T01（convertToLangGraphTools + tool() + zod）、T03（resolveLLMModelFor 导出）

**验收标准**：`npm test` 全部通过（dag-runner.test.ts 的 6 个用例）；`tsc --noEmit` 通过。

---

### T05: 收尾清理 + 全量验证

**文件**：
- `engine/orchestrator/package.json`（修改）
- `engine/ab-test/package.json`（修改）
- 全项目 grep 验证

**具体改动**：
1. 从 orchestrator/package.json 的 dependencies 中**移除** `"deepagents": "^1.10.7"`
2. `npm install` 确认无 broken dependencies
3. 全项目 grep `createDeepAgent` / `deepagents` — 确认零残留（dist/ 产物除外，需 rebuild）
4. `npm run build`（所有 engine 包）
5. `npm test`（所有 engine 包）
6. FORGE 的 `fresh-eyes-driver.mjs` 中 `loadTools()` 引用的是 `dist/tools.js`——确认 `convertToLangGraphTools` 导出后，FORGE 的工具转换不再需要自己做（可选优化，不影响迁移）

**依赖**：T01、T02、T03、T04 全部完成

**验收标准**：
- grep `createDeepAgent` 在 src/ 下零结果
- grep `deepagents` 在 package.json 中零结果
- `npm run build` 全部成功
- `npm test` 全部通过
- FORGE fresh-eyes-loop 至少跑一轮验证（如果环境允许）

---

## 9. 待明确事项

### 9.1 dag-runner 的 LLM 模型解析（需确认）

**问题**：当前 dag-runner 的 `createDeepAgent` 调用不传 model 参数（deepagents 内部自动从环境变量解析）。createReactAgent 必须显式传 `llm`。

**当前选项**：
- **选项 A**（推荐）：从 nodes.ts 导出 `resolveLLMModelFor` / `resolveLLMModel`，dag-runner 直接调用。dag-runner 不指定角色（用 null），走通用 SOFAGENT_LLM 环境变量。
- **选项 B**：dag-runner 内联一套独立的模型解析逻辑（代码重复，不推荐）。
- **选项 C**：dag-runner 接受外部传入的 model 实例（新增 DagRunnerDeps.model 字段）。

**架构师建议**：选项 A。nodes.ts 的 `resolveLLMModelFor` 已经是成熟的模型解析逻辑，dag-runner 只需 import 复用。

### 9.2 recursionLimit 换算（需确认）

**问题**：nodes.ts 当前用 `maxTurns` 控制 Agent 轮次（engineer=20, reviewer=15）。createReactAgent 用 `recursionLimit`（每轮工具调用 = 2 步）。

**换算**：`recursionLimit = maxTurns * 2`（engineer=40, reviewer=30）。

**但 FORGE 经验值显示**：审查类步骤建议 150+，文本处理类 50。sofagent 的 engineer=20 轮（=40 步）可能偏低——但这是**调优问题不是迁移问题**，先保持 `maxTurns * 2` 的换算，后续按实际运行结果调整。

### 9.3 deepagents 包移除时机（需确认）

**问题**：T05 计划移除 deepagents 依赖。但 FORGE 的 `fresh-eyes-driver.mjs` 的 `loadTools()` 引用 `require('../../engine/orchestrator/dist/tools.js')`——如果 deepagents 被移除，tools.ts 中 `import type { StructuredToolParams } from '@langchain/core/tools'` 不受影响，但注释中的 "deepagents" 字样需要清理。

**建议**：T05 移除 deepagents 依赖后，同步清理所有源码注释中的 "deepagents" / "DeepAgents" 字样（保留 CHANGELOG 中的历史记录）。

### 9.4 SubAgent 工具集选择（需确认）

**问题**：方案 B 中，每个 subagent 被封装为 tool，tool 内部创建子 createReactAgent。这个子 Agent 应该用什么工具集？

**当前选项**：
- **选项 A**（推荐）：所有子 Agent 统一用 `convertToLangGraphTools(ENGINEER_TOOLS)`——全量 6 个工具。
- **选项 B**：按 workflow YAML 中节点的 `agent` 字段（developer / qa-engineer / technical-writer / researcher）分配不同工具子集。
- **选项 C**：子 Agent 不用工具（纯文本生成）——但这样 SubAgent 就失去了文件操作能力。

**架构师建议**：选项 A。当前 workflow YAML 的 agent 类型只是标签，实际工具集差异不大。统一用 ENGINEER_TOOLS 最简单，后续如需细分再迭代。
