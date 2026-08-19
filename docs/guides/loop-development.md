# FORGE Loop 开发指南

> **想给 FORGE 加新 loop？这份文档告诉你怎么搭。** 从 driver 脚本结构到三个必踩的坑，每条都来自真实 debug 会话。
>
> v1.3.8 · 2026-08-20（UTC）

<img src="../docs/assets/sofagent.png" alt="sofagent" width="160" />

- [一、技术栈：一句话声明](#一技术栈一句话声明)
- [二、为什么选 LangGraph（弃用 deepagents）](#二为什么选-langgraph弃用-deepagents)
- [三、核心 Driver 脚本结构](#三核心-driver-脚本结构)
- [四、新 Loop 开发 Checklist](#四新-loop-开发-checklist)
- [五、三个必踩的坑](#五三个必踩的坑)
- [六、异构模型配置](#六异构模型配置)
- [七、参考实现：fresh-eyes-loop](#七参考实现fresh-eyes-loop)

---

## 一、技术栈：一句话声明

**FORGE loop = LangChain Core（LLM 调用底座）+ LangGraph `createReactAgent`（编排引擎）。**

不多不少。不用 deepagents 全家桶，不用 LangChain 全家桶（Document Loader / Vector Store / RAG pipeline 都不碰）。完整技术选型原则见 [VALIDATION](../VALIDATION.md#技术选型原则用什么不用什么)。

```js
const { createReactAgent } = await import('@langchain/langgraph/prebuilt');
const agent = createReactAgent({ llm: model, tools, prompt: systemPrompt });
```

这一行替代了 deepagents 的 `createDeepAgent({ middleware, subagents })` 全套——更简单、更可控、不崩。

> 完整踩坑记录（为什么从 deepagents 迁移到 LangGraph）见 [FORGE/lessons/index.md](../../FORGE/lessons/index.md)。

---

## 二、为什么选 LangGraph（弃用 deepagents）

deepagents 在 v1.0.1-v1.1.x 阶段启发了 sofagent 编排引擎的设计，但 v1.2.0 起被彻底弃用。三个**不可逆硬伤**决定了它不适合 FORGE：

### 硬伤 1：FilesystemMiddleware 硬编码注入（P0）

deepagents 的 `createDeepAgent` 在源码中硬编码注入 `FilesystemMiddleware`（`deepagents/dist/langsmith-DjCMSywL.js:5879-5895`）：

```js
// deepagents 源码（不可修改）
const middleware = [
  todoMiddleware,
  fsMiddleware,           // ← 硬编码，无法通过参数禁用
  subagentMiddleware,     // ← REQUIRED，也不能排除
  ...customMiddleware,    // ← 你的 middleware:[] 只追加到这
];
```

`REQUIRED_MIDDLEWARE_NAMES = Set(["FilesystemMiddleware","SubAgentMiddleware"])` 明确禁止排除这两个。你以为 `middleware:[]` 能禁用它？不——语义是"追加空数组到链尾"，不是"替换整个链"。

### 硬伤 2：wrapToolCall 并行调用崩溃（P0）

FilesystemMiddleware 的 `wrapToolCall` 在处理并行工具调用时触发 `Cannot read properties of undefined (reading 'length')`（superstep N AggregateError）。DeepSeek 偶然没触发并行调用所以能跑，GLM-5.2 在 superstep 5 触发即崩。

**"修了但偶尔还崩" = 根因没找对，DeepSeek 跑通只是运气好。**

### 硬伤 3：REQUIRED_MIDDLEWARE_NAMES 白名单禁止排除（P0）

即使你知道是 FilesystemMiddleware 的锅，也无法排除它——源码里 `validateExcludedMiddlewareName()` 会抛错阻止你。

### deepagents 适合什么场景？

deepagents 不是"不能用"——它适合：快速原型、串行工具调用、标准文件操作、不需要并行 SubAgent 的场景。如果你只需要一个能读写文件的 Agent demo，deepagents 开箱即用很好。

**但 FORGE loop 需要精细控制**：每步独立进程隔离、并行双盲审查、自定义工具集（不依赖 deepagents 的内置文件工具）、按步骤区分 recursionLimit、审计可追溯。这些需求下 deepagents 的黑盒成了枷锁。

LangGraph 的 `createReactAgent` 是同一套 React 模式（ToolNode + agent loop），但所有节点和边都暴露给你——白盒可控。

---

## 三、核心 Driver 脚本结构

参考实现：`FORGE/src/fresh-eyes-driver.mjs`。以下是新 loop driver 的关键结构。

### 3.1 整体架构：Driver + Worker

```
driver（主进程）          worker（子进程，每步一个）
  ├─ 解析 CLI 参数          ├─ 读 prompt 模板
  ├─ 建 run 目录            ├─ buildSystemPrompt
  ├─ 编排循环轮次      →    ├─ createModel（异构模型）
  │   ├─ spawnWorker ①      ├─ loadTools + tool() 转换
  │   ├─ spawnWorker ②      ├─ createReactAgent
  │   ├─ spawnWorker ③      ├─ agent.invoke({ recursionLimit })
  │   ├─ ...                └─ 写产物文件
  ├─ 判停止条件
  ├─ 写 LEDGER
  └─ emit 可见性事件
```

Driver 只做编排（起进程、传路径、判停止、写索引），不做语义判断。Worker 在独立子进程中跑——**真·零上下文**，每步的内存和状态完全隔离。

### 3.2 createReactAgent 导入

```js
const { createReactAgent } = await import('@langchain/langgraph/prebuilt');
const agent = createReactAgent({
  llm: model,
  tools,
  prompt: systemPrompt,
});
```

### 3.3 工具定义与 `sf_` 前缀

FORGE 的自定义工具用 `sf_` 前缀（`sf_read` / `sf_write` / `sf_edit`），避免和 LangGraph 生态的 BUILTIN 工具名冲突（`read_file` / `write_file` 等是保留名）。

工具必须用 `@langchain/core/tools` 的 `tool()` 函数创建（不是手写 ExecutableTool 格式），否则 ToolNode 报 `Cannot read properties of undefined`：

```js
const { tool } = require('@langchain/core/tools');
const { z } = require('zod');

const wrappedTool = tool(
  async (input) => await rawTool.func(input),
  {
    name: rawTool.name,
    description: rawTool.description,
    schema: z.object(zodShape),  // JSON Schema → zod 转换
  }
);
```

### 3.4 STEP_RECURSION_LIMITS：按步骤区分

**不能一刀切。** 审查类步骤需要大量读文件+搜索，文本处理类步骤主要是合并/格式化——用同一个 recursionLimit 会导致前者不够、后者 OOM。

```js
const STEP_RECURSION_LIMITS = {
  'a-check':       150,  // 审查类：≈75 轮工具调用，够 12 视角完整审查
  'b-check':       150,
  'a-consolidate': 50,   // 文本处理类：≈25 轮工具调用，够合并/格式化
  'b-fix':         60,
  'a-verify':      50,
};

const recursionLimit = STEP_RECURSION_LIMITS[step] ?? 50;
```

经验值：每次工具调用 = 2 步（model call + tool node）。超过 150 步 → OOM 风险（exit 137）。

### 3.5 buildSystemPrompt + macOS BSD 约束

systemPrompt 末尾必须注入 macOS 运行环境约束段——LLM 默认用 GNU/Linux 语法，macOS 的 BSD 工具全报错：

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
  '- 不支持 <(...) process substitution（/bin/sh 没有）',
  '',
  '命令报错时，不要反复重试同一命令——换一种方式或跳过。',
].join('\n');
```

### 3.6 失败降级机制

每个关键步骤必须有 try/catch + 降级兜底。最典型的是 `writeFallbackFindings`——a-consolidate 失败时，直接拼接两份 check 报告作为 findings.md，让循环继续走到 b-fix：

```js
try {
  await spawnWorker('a-consolidate', roundDir, target, roundNum);
} catch (consolidateErr) {
  console.warn(`⚠️ a-consolidate 失败: ${consolidateErr.message}`);
  writeFallbackFindings(roundDir);  // 降级：拼接 check-a + check-b
}
```

降级产物质量不如正常流程，但"有"比"没有"强——一个步骤崩不能拖死整条链。

### 3.7 spawnWorker 独立进程模型

每个步骤在独立 `node` 子进程中执行，保证真·零上下文：

```js
function spawnWorker(step, roundDir, target, round) {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(process.execPath, [
      __filename, '--worker', '--step', step,
      '--round-dir', roundDir, '--target', target,
    ], {
      cwd: REPO_ROOT,
      stdio: ['pipe', 'inherit', 'inherit'],
      env: { ...process.env, FORGE_ROUND: String(round) },
    });
    child.on('close', (code) => {
      if (code === 0) resolveP();
      else rejectP(new Error(`worker ${step} 退出码 ${code}`));
    });
  });
}
```

步骤 ①②（双盲独立审查）可并行调用 `spawnParallel`；步骤 ③④⑤ 必须串行（有数据依赖）。

---

## 四、新 Loop 开发 Checklist

开发新 loop 前，对照这份清单逐项确认：

- [ ] **每个 loop 都须包含**——`prompts/` / `specs/` / `runs/` 独立目录，不混用
- [ ] **driver 用 `createReactAgent`**——不用 `createDeepAgent`（已弃用）
- [ ] **工具用 `tool()` 创建**——JSON Schema → zod 转换，不用手写 ExecutableTool
- [ ] **工具名加 `sf_` 前缀**——避免和 LangGraph BUILTIN 工具冲突
- [ ] **recursionLimit 按步骤区分**——审查类 150 / 文本处理类 50，不能一刀切
- [ ] **systemPrompt 注入 macOS BSD 工具约束**——LLM 不知道你跑在 macOS 上
- [ ] **失败路径有降级兜底**——关键步骤 try/catch + writeFallback 函数
- [ ] **driver catch 块写 ERROR + LOOP_END 事件**——否则 Dashboard 看到"永远在跑"
- [ ] **`runs/` 目录放在 loop 自己目录下**——`.gitignore` 加 `FORGE/SKILL/*/runs/`
- [ ] **`LEDGER.md` 追加一行记录**——git 跟踪的跨 run 永久索引

---

## 五、三个必踩的坑

以下三个坑在 fresh-eyes-loop 开发过程中全部踩过，每个都附代码示例和修复方案。

### 坑 1：recursionLimit 不分步骤导致 OOM（exit 137）

**现象**：`a-consolidate`（合并两份审查报告）worker 报 `exit 137`（SIGKILL / OOM）。Node.js 进程被操作系统强杀。

**根因**：recursionLimit=150 对文本处理类步骤太高。LangGraph 的 agent 在每次工具调用后把 message 追加到 messages 数组——150 步意味着消息可能累积到数十 MB，Node.js 默认堆内存（~1.5GB）撑不住就 OOM。

审查类步骤（a-check）用 150 不会 OOM，因为消息增长慢（大量是工具调用结果，短文本）；但 a-consolidate 要读取两份完整的 check 报告 + 产出 findings.md + result.md，单条消息体积大，150 步累积就爆了。

**修复**：

```js
// 按步骤类型区分 recursionLimit
const STEP_RECURSION_LIMITS = {
  'a-check':       150,  // 审查类：需要大量读文件+搜索
  'b-check':       150,
  'a-consolidate': 50,   // 文本处理类：合并/格式化，50 步够
  'b-fix':         60,   // 修复类：需要读写文件，介于两者之间
  'a-verify':      50,   // 验证类：读 findings + summary 对比
};
```

**经验值参考**：

| recursionLimit | ≈ 工具调用轮数 | 适合什么步骤 |
|:-:|:-:|------|
| 25 | 12 轮 | 简单问答 |
| 50 | 25 轮 | 文本处理（合并/格式化/验证） |
| 150 | 75 轮 | 完整代码审查（12 视角） |
| >150 | — | OOM 风险区 |

### 坑 2：macOS BSD 工具不兼容

**现象**：循环日志里大量 `grep: invalid option -- P`、`sed: illegal option -- -`、`openssl:Error: '--version' is an invalid command`。LLM 浪费 recursionLimit 步数在重试错误命令上——本来 50 步够完成的任务，20 步浪费在报错重试上，剩下的步数不够产出。

**根因**：LLM 训练数据以 Linux（GNU 工具）为主，默认用 GNU 语法。macOS 是 BSD 工具，行为差异显著：

| GNU 语法（LLM 默认） | BSD 实际行为（macOS） | 正确写法 |
|------|------|------|
| `grep -P "pattern"` | `-P` 不存在 | `grep -E "pattern"` |
| `sed --version` | `--version` 报错 | 不用 |
| `sed -i "s/a/b/"` | `-i` 需要后缀 | `sed -i "" "s/a/b/"` |
| `stat --format=...` | 不支持 `--format` | `stat -f ...` |
| `cat -A` | 不支持 | `cat -v` 或 `od -c` |
| `<(...)` process substitution | `/bin/sh` 没有 | 用临时文件 |

**修复**：在 `buildSystemPrompt` 返回的 systemPrompt 末尾追加 BSD 约束段（代码见 [§3.5](#35-buildsystemprompt--macos-bsd-约束)）。

**验证效果**：加上约束后，`a-consolidate` 从"40 步不收敛"变成"完美产出 49 行 findings.md"。

### 坑 3：worker 崩溃导致整个循环挂掉

**现象**：步骤 ③（a-consolidate）OOM 崩溃后，driver 的 `main()` catch 写了 ERROR + LOOP_END 事件，但整个循环还是退出了——后面的 b-fix / a-verify 都没跑。

**根因**：步骤 ③ 的 `spawnWorker` reject 后，异常一路冒泡到 `runRound` → `main` 的 for 循环 → `main().catch()`。没有在步骤级别做 try/catch 拦截。

**修复**：两个层面——

**层面 1：步骤级 try/catch + 降级函数**（代码见 [§3.6](#36-失败降级机制)）

在 `spawnWorker('a-consolidate', ...)` 外面包 try/catch，catch 里调 `writeFallbackFindings(roundDir)` 写降级产物。降级产物质量不如正常流程，但"有"比"没有"强——一个步骤崩不能拖死整条链。

**层面 2：driver catch 块写可见性事件**

```js
// 模块级引用——让 catch 块也能写可见性事件
let globalVisibility = null;

main().catch(err => {
  console.error(`💥 致命错误: ${err.message}`);
  if (globalVisibility) {
    globalVisibility.emit(EVENTS.ERROR, { message: err.message });
    globalVisibility.emit(EVENTS.LOOP_END, {
      actualRounds: 0, stopReason: 'fatal-error',
    });
  }
  process.exit(1);
});
```

没有层面 2，status.json 会停在 `round-1-running`，Dashboard 看到"永远在跑"。

---

## 六、异构模型配置

fresh-eyes-loop 使用两个不同厂商的模型，分别承担审查者和工程师角色。

### 配置表

| 维度 | A（审查者） | B（工程师） |
|------|-------------|-------------|
| **模型** | GLM-5.2（智谱） | DeepSeek V4 Pro |
| **baseURL** | `https://open.bigmodel.cn/api/coding/paas/v4/` | `https://api.deepseek.com/` |
| **计费** | Coding Plan 订阅制 | 按量计费 |
| **特殊参数** | `temperature: 1.0` / `maxTokens: 16000` | `thinking: { type: "enabled" }` / `reasoningEffort: "high"` |
| **token 消耗** | 高（~85万/轮） | 低（~9万/轮） |
| **适用步骤** | 审查 / 合并 / 验证 | 审查 / 修复 |

### 模型实例化代码

```js
const MODEL_CONFIGS = {
  A: {
    baseURL:         'https://open.bigmodel.cn/api/coding/paas/v4/',
    model:           'glm-5.2',
    temperature:     1.0,
    maxTokens:       16000,
    apiKeyEnv:       'SOFAGENT_LLM_A_API_KEY',
    billing:         'subscription',
  },
  B: {
    baseURL:         'https://api.deepseek.com/',
    model:           'deepseek-v4-pro',
    thinking:        { type: 'enabled' },
    reasoningEffort: 'high',
    apiKeyEnv:       'SOFAGENT_LLM_B_API_KEY',
    billing:         'pay-as-you-go',
  },
};
```

### API key 注入

在 `~/.zshrc` 中设置环境变量：

```bash
export SOFAGENT_LLM_A_API_KEY="your-glm-api-key"
export SOFAGENT_LLM_B_API_KEY="your-deepseek-api-key"
export SOFAGENT_LLM_A="glm-5.2"     # 可选：覆盖默认模型名
export SOFAGENT_LLM_B="deepseek-v4-pro"
```

### 行为差异注意

- **DeepSeek 更保守**：倾向串行调用工具，不太触发并行 bug
- **GLM-5.2 更激进**：经常同一步并行调多个工具（读文件+搜索+跑测试），容易踩并行坑
- **GLM-5.2 在 macOS 上更容易踩 BSD 工具坑**（可能训练数据中 Linux 占比更高）

异构模型不只是"用不同模型"——还要理解它们的工具调用行为差异，据此调 recursionLimit 和 prompt 约束。

---

## 七、参考实现：fresh-eyes-loop

### 完整链路（5 步）

```
① a-check       (A 新 session)    独立跑 12 视角审查     → check-a.md
② b-check       (B 新 session)    独立跑 12 视角审查     → check-b.md    [与①并行]
③ a-consolidate (A session)       合并 A/B 报告          → findings.md + result.md
④ b-fix         (B 新 session)    按 result.md 修复      → summary.md
⑤ a-verify      (A 新 session)    验证修复               → result.md 回填 verify 列
```

步骤 ①② 双盲独立（可并行），步骤 ③④⑤ 串行（有数据依赖）。每轮用全新 session 跑——零上下文保证独立性。

### 目录结构

```
FORGE/SKILL/fresh-eyes-loop/
├── SKILL.md              # loop 定义（frontmatter + 概述）
├── loop.md               # 循环 SOP（角色/轮次协议/产物 schema/停止条件）
├── evolution.md          # 循环级演化记录（加一减一）
├── prompts/              # A/B 行为指令
│   ├── a-check.md
│   ├── b-check.md
│   ├── a-consolidate.md
│   ├── b-fix.md
│   └── a-verify.md
├── specs/                # 审查规范
│   ├── fresh-eyes-review.md
│   ├── regression-checklist.md
│   └── acceptance-test.sh
└── runs/                 # 运行产物（不进 git）
    └── YYYY/MM/DD/run-NN/
        ├── round-01/
        │   ├── check-a.md
        │   ├── check-b.md
        │   ├── findings.md
        │   ├── result.md
        │   └── summary.md
        ├── status.json
        ├── usage.jsonl
        └── progress.jsonl
```

### run-03 结果摘要

| 维度 | 数据 |
|------|------|
| 审查目标 | sofagent v1.2.0 完整交付物 |
| 轮数 | 1 轮 |
| 耗时 | ~19 分 20 秒 |
| 总 token | 1,050,313（A: 903,462 + B: 146,851） |
| 成本 | ¥0.44（B 按量计费；A 为订阅制不单独计费） |
| 发现 | P0×14 P1×21 P2×16 |
| 停止原因 | max-rounds（单轮仍有大量 P0/P1） |

### driver 源码

完整 driver 实现：`FORGE/src/fresh-eyes-driver.mjs`（~1150 行）。关键函数：

| 函数 | 职责 |
|------|------|
| `main()` | CLI 入口：解析参数 → 编排循环 → 判停止 → 写 LEDGER |
| `runRound()` | 执行一轮（5 步：并行 ①② → 串行 ③④⑤） |
| `spawnWorker()` | 起独立子进程执行单个步骤 |
| `runWorker()` | Worker 主逻辑：读 prompt → 建 model+tools → createReactAgent → invoke → 写产物 |
| `buildSystemPrompt()` | 从 SKILL.md 构建 systemPrompt + macOS BSD 约束 |
| `createModel()` | 异构模型实例化（GLM vs DeepSeek 参数差异） |
| `loadTools()` | 工具集加载 + ExecutableTool → DynamicStructuredTool 转换 |
| `writeFallbackFindings()` | 降级兜底：a-consolidate 失败时拼接两份 check 报告 |
| `parseStopCondition()` | 读 findings.md 数 P0/P1 标记，判定是否"干净轮" |
| `recordUsage()` | 从 invoke 结果提取 usage，算成本，追加到 usage.jsonl |

---

> **完整踩坑记录**（11 个坑 + 修复时间线）见 [FORGE/lessons/index.md](../../FORGE/lessons/index.md)。
>
> **跨 run 运行历史**（永久索引）见 [FORGE/LEDGER.md](../../FORGE/LEDGER.md)。
