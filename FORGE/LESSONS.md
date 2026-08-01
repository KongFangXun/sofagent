# FORGE Loop 开发踩坑大全

> **第一次用 LangGraph + 异构 LLM 构建 fresh-eyes-loop 的全部血泪教训。**
>
> 每个坑都来自真实 debug 会话，附根因 + 修复 + 验证。
> 开发新 loop / 新 sub-agent 前必读——犯过的错不用再犯。

---

## 一、框架选型：弃用 deepagents，直接用 LangGraph

### 坑 1：createDeepAgent 硬编码注入 FilesystemMiddleware（P0 级阻塞）

**现象**：worker 跑到并行工具调用时报 `Multiple errors occurred during superstep N` + `Cannot read properties of undefined (reading 'length')`。DeepSeek 偶然没触发，GLM-5.2 必崩。

**假修复**（commit e4ba836）：`createDeepAgent({ middleware: [] })`——以为这能禁用 FilesystemMiddleware。

**根因**（源码级定位，`deepagents/dist/langsmith-DjCMSywL.js:5879-5895`）：

```js
const middleware = [
  todoMiddleware,
  fsMiddleware,           // ← 硬编码注入，无法通过参数禁用
  subagentMiddleware,     // ← REQUIRED，也不能排除
  ...customMiddleware,    // ← 你的 middleware:[] 只追加到这
];
```

- `REQUIRED_MIDDLEWARE_NAMES = Set(["FilesystemMiddleware","SubAgentMiddleware"])`
- `validateExcludedMiddlewareName()` 明确禁止排除这两个
- `middleware:[]` 的语义是"追加空数组到链尾"，不是"替换整个链"

**最终修复**（commit 9a9c5dc）：用 `@langchain/langgraph/prebuilt` 的 `createReactAgent` 替代 `createDeepAgent`。

```js
const { createReactAgent } = await import('@langchain/langgraph/prebuilt');
const agent = createReactAgent({ llm: model, tools, prompt: systemPrompt });
```

- createReactAgent 是同一套 React 模式（ToolNode + agent loop）
- 但不带 FilesystemMiddleware——你有自己的 sf_read/sf_write/run_bash
- DeepSeek 不需要 deepagents 的文件工具抽象层

**教训**：
1. 读源码！不要靠猜 API 语义。`middleware:[]` 看起来像"禁用 middleware"，实际是"追加"
2. required 的东西就是 required，别浪费时间找绕过方法——换框架
3. "修了但偶尔还崩" = 根因没找对，DeepSeek 跑通只是运气好

---

### 坑 2：工具格式必须用 `tool()` 创建

**现象**：ToolNode 报 `Cannot read properties of undefined (reading 'length')`。

**根因**：dist/tools.js 用手写 ExecutableTool 格式（`{name, description, schema, func}`），但 LangGraph ToolNode 期望 `@langchain/core/tools` 的 `tool()` 函数创建的 DynamicStructuredTool。

**修复**：loadTools() 加转换层，JSON Schema → zod，用 `tool()` 包装：

```js
const { tool } = require('@langchain/core/tools');
const { z } = require('zod');

return rawTools.map((rawTool) => {
  if (rawTool.lc_namespace) return rawTool;  // 已转换过

  const properties = rawTool.schema?.properties || {};
  const zodShape = {};
  for (const [key, prop] of Object.entries(properties)) {
    let zodField;
    if (prop.type === 'string') zodField = z.string();
    else if (prop.type === 'number' || prop.type === 'integer') zodField = z.number();
    else if (prop.type === 'boolean') zodField = z.boolean();
    else zodField = z.string();
    if (prop.description) zodField = zodField.describe(prop.description);
    if (!(rawTool.schema?.required || []).includes(key)) zodField = zodField.optional();
    zodShape[key] = zodField;
  }

  return tool(
    async (input) => await rawTool.func(input),
    { name: rawTool.name, description: rawTool.description, schema: z.object(zodShape) }
  );
});
```

---

### 坑 3：工具名 BUILTIN 冲突

**现象**：工具调用失败，报 tool name collision。

**根因**：`ls` / `read_file` / `write_file` / `edit_file` / `glob` / `grep` 是 deepagents 保留名。

**修复**：自定义工具加前缀——`sf_read` / `sf_write` / `sf_edit`。

**教训**：如果你用自己的工具集替代 deepagents 内置工具（用 createReactAgent 后这不再是问题），仍然要避免和 LangGraph 生态的其他工具撞名。

---

## 二、recursionLimit：按步骤区分，不能一刀切

### 坑 4：统一 recursionLimit=150 导致 OOM

**现象**：a-consolidate worker 报 exit 137（SIGKILL / OOM）。

**根因**：recursionLimit=150 对文本处理类步骤太高——消息在内存里累积，Node.js 内存爆炸。

**修复**（commit 3248395）：按步骤类型区分：

```js
const STEP_RECURSION_LIMITS = {
  'a-check':       150,  // 审查类：需要大量读文件+搜索
  'b-check':       150,
  'a-consolidate': 50,   // 文本处理类：合并/格式化
  'b-fix':         60,
  'a-verify':      50,
};
```

**经验值**：
- 每次工具调用 = 2 步（model call + tool node）
- 25 步 ≈ 12 轮工具调用 → 只够简单问答
- 50 步 ≈ 25 轮工具调用 → 够文本处理
- 150 步 ≈ 75 轮工具调用 → 够完整代码审查（12 视角）
- 超过 150 → OOM 风险

---

## 三、macOS BSD 工具兼容性：LLM 的隐形杀手

### 坑 5：GLM/DeepSeek 反复用 GNU 语法导致命令报错

**现象**：循环日志里大量 `grep: invalid option -- P`、`sed: illegal option -- -`、`openssl:Error: '--version' is an invalid command`。LLM 浪费 recursionLimit 步数在重试错误命令上。

**根因**：LLM 训练数据以 Linux 为主，默认用 GNU 语法。macOS 是 BSD 工具，行为不同。

**修复**（commit 3248395）：buildSystemPrompt 追加 macOS 约束段：

```js
const shellConstraints = [
  '',
  '## 运行环境约束（macOS BSD 工具）',
  '',
  '你在 macOS 上运行，shell 是 BSD 版本，不是 GNU/Linux：',
  '- grep：不支持 -P（PCRE），用 grep -E 代替',
  '- sed：不支持 --version/-V；-i 必须带后缀',
  '- cat：不支持 -A，用 cat -v 或 od -c',
  '- stat：不支持 --format，用 stat -f',
  '- 不支持 <(...）process substitution（/bin/sh 没有）',
  '- 不支持 ${var} 之外的字符串操作',
  '',
  '命令报错时，不要反复重试同一命令——换一种方式或跳过。',
].join('\n');
```

**验证效果**：加上约束后，a-consolidate 从"40步不收敛"变成"完美产出 49 行 findings.md"。

**教训**：LLM 不知道你的运行环境，必须在 systemPrompt 里显式告诉它。

---

## 四、失败路径：不能让一个 worker 崩掉整个循环

### 坑 6：a-consolidate 失败 = 整个循环崩溃

**现象**：a-consolidate OOM 崩溃后，driver 的 main() catch 虽然写了 ERROR + LOOP_END 事件，但整个循环还是退出了，后面的 b-fix / a-verify 都没跑。

**修复**（commit 3248395）：步骤 ③ 加 try/catch 降级：

```js
try {
  await spawnWorker('a-consolidate', roundDir, target, roundNum);
} catch (consolidateErr) {
  console.warn(`⚠️ a-consolidate 失败: ${consolidateErr.message}`);
  console.warn(`   降级：直接拼接 check-a + check-b 作为 findings.md`);
  writeFallbackFindings(roundDir);
}
```

writeFallbackFindings() 直接拼接两份 check 报告作为 findings.md，让循环继续走到 b-fix。

**教训**：
1. 循环编排必须做容错——一个步骤崩不能拖死整条链
2. 降级产物质量肯定不如正常流程，但"有"比"没有"强
3. driver 的 catch 块也要写可见性事件（失败路径覆盖）

---

### 坑 7：worker catch 块没写可见性事件

**现象**（commit 4a4a143）：worker 失败时 driver 抛 uncaught exception，但 status.json 停在 `round-1-running`，Dashboard 看到"永远在跑"。

**修复**：模块级 `globalVisibility` 引用 + catch 块 emit ERROR + LOOP_END：

```js
let globalVisibility = null;

main().catch(err => {
  console.error(`💥 致命错误: ${err.message}`);
  if (globalVisibility) {
    globalVisibility.emit(EVENTS.ERROR, { message: err.message, ... });
    globalVisibility.emit(EVENTS.LOOP_END, { actualRounds: 0, stopReason: 'fatal-error', ... });
  }
  process.exit(1);
});
```

---

## 五、目录架构：每个 loop 自包含

### 坑 8：runs 目录放错位置（已纠正）

**经历**：一度把 `runs/` 从 `FORGE/SKILL/fresh-eyes-loop/runs/`（4 层深）挪到 `FORGE/runs/`（2 层深），觉得"好找"。

**纠正**（commit 8cd7b23）：迁回原位。原因——未来会有多个 loop（fresh-eyes/releaser/...），最终连成 graph。每个 loop 必须自包含：各自的 prompts/specs/runs 独立。

```
FORGE/SKILL/
├── fresh-eyes-loop/
│   ├── prompts/
│   ├── specs/
│   └── runs/            ← 自己的产物自己管
├── releaser-loop/       ← 未来
│   └── runs/
└── ...
```

`.gitignore` 用通配：`FORGE/SKILL/*/runs/`（覆盖所有 loop）。

**教训**："找文件方便"是工具层问题（加个 `--last-run` 参数就行），不能为此破坏架构边界。

---

## 六、异构模型配置：GLM vs DeepSeek 行为差异

### 坑 9：GLM-5.2 和 DeepSeek 的工具调用行为不同

**观察**：
- DeepSeek 更"保守"——倾向串行调用工具，不太触发并行 bug
- GLM-5.2 更"激进"——经常同一步并行调多个工具（读文件+搜索+跑测试），容易触发 FilesystemMiddleware 的并行 bug
- GLM-5.2 在 macOS 上更容易踩 BSD 工具坑（可能训练数据中 Linux 占比更高）

**配置差异**（MODEL_CONFIGS）：

| 维度 | A (GLM-5.2) | B (DeepSeek V4 Pro) |
|------|-------------|---------------------|
| baseURL | Coding Plan 端点 | api.deepseek.com |
| 计费 | 订阅制 | 按量 |
| 特殊参数 | temperature 1.0 | thinking:{type:enabled} + reasoning_effort:high |
| token 消耗 | 高（~85万/轮） | 低（~9万/轮） |
| 适用步骤 | 审查/合并/验证 | 审查/修复 |

**教训**：异构模型不只是"用不同模型"，还要理解它们的工具调用行为差异，据此调 recursionLimit 和 prompt 约束。

---

### 坑 10：prompt 文件名和产物名不一致

**经历**：调试时写 `--step a-check` 读 `check-b.md`，实际 prompt 文件叫 `b-check.md`（prompt 名），产物叫 `check-b.md`（产物名）。

**教训**：prompt 和产物命名要统一规则。我们的约定：prompt 用 `<role>-<action>.md`（a-check.md），产物用 `check-<role>.md`（check-a.md）。

---

## 七、prompt 设计：12 视角太重，需要分层

### 坑 11：GLM-5.2 跑 12 视角审查需要 7 分钟

**现象**：fresh-eyes 要求 12 个视角逐一审查，每个视角都要读文件+搜索+分析。GLM-5.2 跑 150 步、7 分钟才完成。

**当前状态**：能跑通但偏慢。未来优化方向：
- 12 视角拆成 3-4 个 sub-agent 并行（每个跑 3-4 个视角）
- 或者按视角优先级分两轮（先跑 P0 视角，有发现再深入）

**教训**：一个 agent 做太多事 = 慢 + 容易超 recursionLimit。复杂任务要考虑拆分。

---

## 附录：完整修复时间线

| 时间 | commit | 问题 | 级别 |
|------|--------|------|------|
| 07-25 | 4a4a143 | 失败路径可见性缺口 | P1 |
| 07-25 | e4ba836 | 工具格式 + middleware:[] 假修复 | P0（假修复） |
| 07-26 | 9a9c5dc | createDeepAgent → createReactAgent | P0（真修复） |
| 07-26 | 3248395 | recursionLimit 按步骤 + macOS 约束 + 降级 | P1 |
| 07-26 | 8cd7b23 | runs 目录迁回原位（架构纠偏） | P2 |
| 08-01 | 63b130d | 步骤级 maxTokens 覆盖（consolidate 32000） | P1 |
| 08-01 | da1039a | 四项 ReAct 性能优化 | P1 |
| 08-01 | a0571a4 | stream 迁移 finalState 数据丢失 | P0 |

---

## 八、性能优化：ReAct Agent 慢的四根因（da1039a）

### 坑 12：上下文雪球——工具输出不裁剪导致 prompt 膨胀

**现象**：fresh-eyes-loop 单轮审查 7-8 分钟。usage.jsonl 显示 b-check 第一步 prompt_tokens 就 102k，到 b-fix round-4 出现单次 296k tokens 的怪物调用。

**根因**：LangGraph ReAct 把**所有工具调用的完整输出**追加到 messages 列表，从不裁剪。Agent 跑一次 `npm test` 输出 2000 行，这个完整输出在之后每一次 LLM 调用时都被重新处理：

```
第 1 次调用：  prompt=15k  → LLM 处理 15k
第 50 次调用： prompt=50k  → LLM 处理 50k
第 100 次调用：prompt=90k  → LLM 处理 90k（每次推理时间翻倍）
```

**修复**（commit da1039a）：两层裁剪——

**第一层：工具输出截断** `truncateToolOutput()`。工具返回超过 200 行只保留头尾各 100 行：

```js
function truncateToolOutput(text, maxLines = 200) {
  const lines = String(text).split('\n');
  if (lines.length <= maxLines) return text;
  const half = maxLines / 2;
  return [
    ...lines.slice(0, half),
    `\n... [${lines.length - maxLines} lines truncated] ...\n`,
    ...lines.slice(-half),
  ].join('\n');
}
```

**第二层：上下文窗口裁剪** `stateModifier`。替代 `prompt` 参数（两者互斥），每次 LLM 调用前保留 system + 首条 user + 最后 30 条消息：

```js
const agent = createReactAgent({
  llm: model, tools,
  // v1.2.5：stateModifier = system prompt 注入 + 上下文裁剪（替代 prompt）
  stateModifier: (state) => {
    const messages = state.messages ?? [];
    if (messages.length <= MAX_CONTEXT_MESSAGES + 1) {
      return [systemMsg, ...messages];
    }
    return [systemMsg, messages[0], ...messages.slice(-MAX_CONTEXT_MESSAGES)];
  },
});
```

**⚠️ 关键坑：`prompt` 和 `stateModifier` 互斥**。LangGraph 源码 `_getPrompt()` 强校验——同时传两个会直接报错。如果之前用 `prompt: systemPrompt`，迁移到 `stateModifier` 时必须把 systemPrompt 移到 stateModifier 内部以 `SystemMessage` 形式注入。

**实测效果**：prompt tokens 峰值从 296k → 稳定 ~30k。预计总执行时间 **-50~60%**。

**教训**：ReAct Agent 的 messages 列表是只增不减的"雪球"。不做上下文管理，跑 100 步后每次推理要处理 10 倍于初始的 token 量。

---

### 坑 13：Agent 过度探索——910 次工具调用里大半是重复

**现象**：sub-progress 日志显示 A（Reviewer）一轮调了 910 次工具（332 次 sf_read + 563 次 run_bash），B（Engineer）更夸张 1555 次（850 次 bash）。同一文件读 3-4 遍、同一命令反复跑确认。

**根因**：Agent 有"再看一遍确认下"的强迫症——这是 LLM 的通病，不是某个模型的问题。不约束就会无限制探索。

**修复**（commit da1039a）：在 SKILL.md（systemPrompt 来源）里加效率铁律——

reviewer 加的目标 50 步以内：
- 禁止重复读同一文件——读过的结论直接用
- 禁止连续跑同一命令——结果不对换方案
- 批量读取——一步提多个 read_file 调用
- 先看目录再看细节——不要盲扫
- 结论优先——发现问题立即记录，不要无限扩展

engineer 加的目标 30 步以内：
- Read → Edit → Test 三步循环，每个修复点走一遍够
- 精准定位——result.md 给的路径和行号就是围栏

**教训**：LLM 的工具调用行为是可塑的——prompt 里明确说"目标 50 步以内，禁止重复读"，它就会克制。不说就默认无限探索。

---

### 坑 14：invoke → stream 迁移的 P0 数据丢失（a0571a4）

**现象**：四项性能优化里把 `agent.invoke()` 改成 `agent.stream(streamMode:'updates')`。语法检查通过、审计全绿。但如果真跑一轮，**所有产物文件内容会变成 `[object Object]`，usage 成本追踪全部丢失**。

**根因**：两个 API 返回格式不同：

```
invoke()  返回 → { messages: [...] }              ← 扁平，下游直接用
stream()   返回 → { agent: { messages: [...] } }   ← 外面包了一层节点名
```

代码里 `finalState = chunk` 直接赋了原始 chunk，没有解包。下游 `extractAgentText(result)` 找 `result.messages` 时拿到 undefined → 穿透到 fallback `String(result)` → 输出 `"[object Object]"`。`extractUsage(result)` 同理 → usage 全记 null。

**修复**（commit a0571a4）：累积所有 chunk 的 delta.messages 到扁平数组，返回 `{ messages: allMessages }` 模拟 invoke 返回格式：

```js
const invokeAgent = async () => {
  const stream = await agent.stream(
    { messages: [...] },
    { recursionLimit, streamMode: 'updates' }
  );

  const allMessages = [];
  for await (const chunk of stream) {
    // chunk 是 { nodeName: stateDelta } —— 解包
    for (const [, delta] of Object.entries(chunk)) {
      const msgs = delta?.messages;
      if (!Array.isArray(msgs)) continue;
      for (const msg of msgs) {
        allMessages.push(msg);
        // 实时打印工具调用...
      }
    }
  }
  // 返回扁平结构——与 invoke() 返回格式兼容
  return { messages: allMessages };
};
```

**为什么语法检查和审计没拦住**：语法检查只验证 JS 可解析，审计检查的是代码安全/规范——都不做 API 返回值结构验证。这个 bug 只有在 agent 实际跑完一轮后写产物时才暴露。

**教训（stream 迁移检查清单）**：
1. ✅ chunk 结构跟 invoke 返回值一样吗？（查文档或打 `console.log(chunk)` 确认）
2. ✅ 下游所有消费 result 的函数（extractAgentText、extractUsage）拿到的数据形状对吗？
3. ✅ 如果不一样，在哪里做格式适配？

> **核心反思**：只验证了自己改的那一段（上游：工具调用实时打印✅），没验证接口契约（下游：extractAgentText/extractUsage 数据形状❌）。这是典型的"只看了自己那段，没看整条链"。

---

## 九、步骤级 maxTokens：合并步骤的隐形截断（63b130d）

### 坑 15：a-consolidate maxTokens=16000 被截断导致整轮降级

**现象**：fresh-eyes-loop 的 a-consolidate（合并 A/B 双份 12 视角报告）和 release-gate 的 consolidate（合并三份验证报告），completion_tokens 精确顶到 maxTokens=16000 上限被截断 → 无法生成合法 result.md → 整轮降级摘要模式 → b-fix 收到"无 finding" → 跳过修复。审出的问题一个都没修。

**根因**：全局 `maxTokens: 16000` 对所有步骤共用。Qwen3.8-max-preview 是 thinking-only 模型，16000 里还包含 thinking tokens，留给实际输出的更少。

**修复**（commit 63b130d）：步骤级 maxTokens 覆盖——

```js
const STEPS = {
  // ...
  'a-consolidate': { ..., maxTokens: 32000 },  // 合并步骤单独调高
};

// createModel 支持覆盖参数
async function createModel(role, maxTokensOverride) {
  const effectiveMaxTokens = maxTokensOverride ?? cfg.maxTokens;
  if (effectiveMaxTokens) ctorArgs.maxTokens = effectiveMaxTokens;
}

// runWorker 传入 stepDef.maxTokens
const model = await createModel(role, stepDef.maxTokens);
```

**教训**：合并/汇总类步骤的输出量远大于普通步骤。如果用 thinking-only 模型，maxTokens 里还有 thinking 的份——给合并步骤单独配更高的 maxTokens。

---

## 新 Loop 开发 Checklist

开发新 loop 前，对照这份 checklist 确认：

### 基础架构（坑 1-8）

- [ ] **用 `createReactAgent`，不用 `createDeepAgent`**
- [ ] **工具用 `tool()` 创建**，JSON Schema → zod 转换
- [ ] **工具名加前缀**（避免 BUILTIN 冲突）
- [ ] **recursionLimit 按步骤区分**（审查类 150-200，处理类 50-100）
- [ ] **systemPrompt 加 macOS BSD 约束**
- [ ] **每个步骤 try/catch + 降级兜底**
- [ ] **driver catch 块写 ERROR + LOOP_END 事件**
- [ ] **runs 目录放在 loop 自己目录下**（自包含）
- [ ] **.gitignore 加 `FORGE/SKILL/*/runs/`**
- [ ] **LEDGER.md 追加一行记录**（git 跟踪）

### 性能优化（坑 12-13，v1.2.5+）

- [ ] **工具输出截断**：loadTools 的 tool wrapper 里加 `truncateToolOutput(text, 200)`——超过 200 行只留头尾
- [ ] **上下文窗口裁剪**：用 `stateModifier` 替代 `prompt`（互斥！），保留 system + 首条 + 最后 30 条
- [ ] **stateModifier 内注入 SystemMessage**：`prompt` 和 `stateModifier` 不能同时传，systemPrompt 移到 stateModifier 内
- [ ] **SKILL.md 加效率铁律**：reviewer 目标 ≤50 步，engineer 目标 ≤30 步，禁止重复读/跑命令
- [ ] **合并步骤单独配 maxTokens**：a-consolidate / consolidate 等汇总步骤 maxTokens=32000（thinking-only 模型 16000 含 thinking tokens 不够）

### stream 迁移（坑 14，如做 invoke→stream 改造时必查）

- [ ] **chunk 格式确认**：stream(streamMode:'updates') 返回 `{ [nodeName]: delta }` 不是扁平 `{ messages: [] }`
- [ ] **下游消费函数验证**：extractAgentText / extractUsage / 所有读 result.messages 的函数，拿到的数据形状对吗？
- [ ] **格式适配层**：累积 delta.messages 到扁平数组，返回 `{ messages: allMessages }` 兼容 invoke 格式
- [ ] **端到端验证**：不只看上游日志（工具调用打印），必须检查下游产物文件内容 + usage.jsonl 有正常数据
