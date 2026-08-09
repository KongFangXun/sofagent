# FORGE Sub-Agent 开发参照标准

> **开发 FORGE Loop（fresh-eyes / release-gate）过程中沉淀的完整方法论。**
>
> 这不是"踩坑参考"，是**开发参照**——下次开发新的 loop 或 sub-agent 时，必须逐条对照本文档执行。每条标准都来自真实 debug 会话（附 commit hash + 根因），不是理论推演。
>
> v1.3.0 · 2026-08-08（UTC）· 孔放勋
>
> v1.2.9 run-12 更新（2026-08-08）：跨闭包变量引用、nohup 后台死亡、8GB 并发 OOM 三项新坑位
>
> v1.3.0 run-21 更新（2026-08-09）：**产物完整性校验（防"假成功"）**、并行工具调用硬熔断超发、步骤级工具预算、LEDGER 假阳性污染四项新坑位

## 本文档定位

| 属性 | 说明 |
|------|------|
| **适用对象** | FORGE 新 loop 开发者、sub-agent 架构设计、driver 编排层开发 |
| **权威性** | 参照标准——开发前必读，设计决策必须与本文档一致或给出明确理由偏离 |
| **维护方式** | 每次踩到新坑或做出架构决策后，更新对应章节 + commit hash |
| **不替代** | LangGraph / deepagents 官方文档——本文档讲"我们怎么用"，不讲"它是什么" |

> **与其他文档的关系**：架构全景看 [ARCHITECTURE.md](../../docs/ARCHITECTURE.md)，产品哲学看 [PHILOSOPHY.md](../../docs/PHILOSOPHY.md)，FORGE 双层循环架构看 [FORGE/README.md](../README.md)。本文档聚焦**开发层面**。

---

## 各章索引

| 章 | 文件 | 核心内容 |
|---|------|---------|
| 一·架构设计 | [./architecture.md](./architecture.md) | createReactAgent 禁用 createDeepAgent · Driver-Worker 编排 · 步骤定义 · 目录架构 |
| 二·模型配置 | [./models.md](./models.md) | MODEL_CONFIGS · Thinking-only 模型 · 步骤级 maxTokens · 计费模式 |
| 三·性能优化 | [./performance.md](./performance.md) | 三层上下文裁剪（截断+stateModifier+preModelHook）· 效率铁律 · stream |
| 四·Driver 编排 | [./driver.md](./driver.md) | recursionLimit · **三层熔断死循环防护** · **零信任复核（FAIL≠真实 bug）** · 失败容错 · 分片 · 停止条件 · 外部脚本 spawn · --step |
| 五~八·Stream/Prompt/工具/可观测 | [./stream-prompt-tools.md](./stream-prompt-tools.md) | stream 迁移 P0 铁律 · BSD 约束 · 工具格式转换 · 两层可观测 |

---

## 九、Sub-Agent 开发完整检查清单

> 开发新 loop 或 sub-agent 前，逐条对照。

### 🔰 架构与框架

- [ ] **用 `createReactAgent`，禁用 `createDeepAgent`**（[一·框架选型](./architecture.md#框架选型createreactagent禁用-createdeepagent)）
- [ ] **Driver-Worker 分离**：Driver 纯编排不审查，Worker 零上下文独立进程（[一·Driver-Worker](./architecture.md#driver-worker-编排模式)）
- [ ] **步骤在 STEPS 常量中定义**，含 role / prompt / outputs / inputs / maxTokens（[一·步骤定义](./architecture.md#步骤定义模式)）
- [ ] **runs 目录放在 loop 自己目录下**，`.gitignore` 加 `FORGE/SKILL/*/runs/`（[一·目录架构](./architecture.md#目录架构每个-loop-自包含)）
- [ ] **LEDGER.md 追加一行记录**

### 🤖 模型配置

- [ ] **MODEL_CONFIGS 定义完整字段**（[二·模型配置](./models.md#模型配置)）
- [ ] **Thinking-only 模型不传 thinking/reasoningEffort**（[二·Thinking-only](./models.md#thinking-模型特殊处理)）
- [ ] **合并/汇总步骤 maxTokens = 32000**（[二·步骤级 maxTokens](./models.md#步骤级-maxtokens-覆盖)）
- [ ] **计费模式标注**（subscription 的 cost_cny = null）

### ⚡ 性能优化（v1.2.5+）

- [ ] **工具输出截断**：truncateToolOutput(text, 200)（[三·上下文管理](./performance.md#上下文管理三层裁剪截断--statemodifier--premodelhook)）
- [ ] **上下文窗口裁剪**：stateModifier 保留 system + 首条 + 最后 16 条（[三·上下文管理](./performance.md#上下文管理三层裁剪截断--statemodifier--premodelhook)）
- [ ] **preModelHook 物理裁剪**：state.messages hard_limit=20（[三·上下文管理](./performance.md#上下文管理三层裁剪截断--statemodifier--premodelhook)）
- [ ] **SKILL.md 加效率铁律**：reviewer ≤50 步，engineer ≤30 步（[三·效率铁律](./performance.md#agent-行为约束skillmd-效率铁律)）
- [ ] **stream 替代 invoke**（[三·流式输出](./performance.md#流式输出stream-替代-invoke)）

### 🔧 Driver 编排

- [ ] **recursionLimit 按步骤区分**（审查类 130）（[四·recursionLimit](./driver.md#recursionlimit-按步骤区分)）
- [ ] **三层熔断防护**（L1 软 50 + L2 硬 60 写报告窗口 5 + L3 recursionLimit 130）（[四·三层熔断](./driver.md#worker-工具调用死循环防护三层熔断)）
- [ ] **L2 用两阶段写报告窗口**（不 break，进 5 superstep 窗口）（[四·L2 两阶段](./driver.md#l2-两阶段写报告窗口关键设计)）
- [ ] **extractAgentText 跳过空 content**（createReactAgent 中间消息全空）（[四·兜底报告](./driver.md#兜底报告合成)）
- [ ] **并行 Worker 用 allSettled**（[四·allSettled](./driver.md#allsettled-并行降级)）
- [ ] **parseStopCondition 做降级检测**（占位报告不算干净轮）（[四·降级检测](./driver.md#降级检测防假阳性干净)）
- [ ] **产物完整性校验**（"有输出"≠"解析成功"；判定产物 result.md 空占位→降级重建，绝不静默跳过）（[四·产物完整性校验](./driver.md#产物完整性校验防假成功v130-run-21-教训)）
- [ ] **判定产物必须可消费**（降级重建 result.md 用 `### finding-NN` 带优先级，别写 SKIP 表格让 b-fix 空转）（[四·产物完整性校验](./driver.md#产物完整性校验防假成功v130-run-21-教训)）
- [ ] **必读文件多的步骤单独配工具预算**（a-consolidate 60/80；开放探索类压低 12/15；并行 tool_call 让硬熔断超发，45 实际撞 48-60）（[四·并行超发](./driver.md#并行工具调用让硬熔断超发--步骤级预算覆盖v130-run-21)）
- [ ] **排查标记字符串防假阳性**（grep `===FILE:` 命中占位注释文本自身，用 `^===FILE:` 只匹配行首）（[四·产物完整性校验](./driver.md#产物完整性校验防假成功v130-run-21-教训)）
- [ ] **连续 2 轮降级直接 error 退出**（[四·连续降级](./driver.md#连续降级-error-退出)）
- [ ] **硬熔断 break 后 stream.return()**（防幽灵请求）（[四·stream.return](./driver.md#streamreturn-防幽灵api-请求)）
- [ ] **每个步骤 try/catch + 降级兜底**（[四·失败路径容错](./driver.md#失败路径容错)）
- [ ] **driver catch 块写 ERROR + LOOP_END 事件**（模块级 globalVisibility）（[四·失败路径容错](./driver.md#失败路径容错)）
- [ ] **finding >10 条时分片执行**（[四·分片执行](./driver.md#分片执行模式)）
- [ ] **停止条件只数标记不做语义判断**（[四·停止条件](./driver.md#停止条件判定)）
- [ ] **spawn 外部脚本时流式写入日志**（[四·外部脚本](./driver.md#外部脚本-spawn-生存规范)）
- [ ] **FAIL 判定必须零信任复核**（亲手实跑检查命令，FAIL≠真实 bug；命令缺陷修 checklist 不修产品代码）（[四·零信任复核](./driver.md#零信任复核worker-的-fail-判定不可全信v125-run-0608-教训)）
- [ ] **child.on('close') 处理 signal 参数**（被 kill 时 code=null）（[四·外部脚本](./driver.md#外部脚本-spawn-生存规范)）
- [ ] **shell 脚本中禁用 `| head -N`**（pipefail + SIGPIPE）（[四·外部脚本](./driver.md#外部脚本-spawn-生存规范)）
- [ ] **长脚本每 30s 输出 progress 日志**（[四·外部脚本](./driver.md#外部脚本-spawn-生存规范)）
- [ ] **init 内部设 SOFAGENT_SKIP_HOOK=1**（[四·SKIP_HOOK](./driver.md#sofagent_skip_hook----skip-acceptance----step)）
- [ ] **driver 支持 --skip-acceptance**（[四·--skip-acceptance](./driver.md#sofagent_skip_hook----skip-acceptance----step)）
- [ ] **driver 支持 --step 单步模式**（[四·--step](./driver.md#sofagent_skip_hook----skip-acceptance----step)）
- [ ] **沙箱环境加 --max-old-space-size=1536**（v1.2.5 run-07 教训：768 在长循环 OOM）（[四·V8 heap](./driver.md#v8-heap-限制--max-old-space-size反直觉优化)）
- [ ] **跨闭包变量提到 agent 定义前**（stateModifier 和 invokeAgent 是平行闭包，不可见对方局部变量）（[四·跨闭包变量](./driver.md#跨闭包变量引用js-作用域陷阱v129-run-07)）
- [ ] **后台启动用 Bash 工具 run_in_background，禁用 nohup+disown**（WorkBuddy 清理脱离进程）（[四·nohup 不安全](./driver.md#nohupdisown-在-workbuddy-中不安全v129-run-0711)）
- [ ] **启动前算并发上限**（并发 ≤ floor((RAM - 3GB) / worker_heap_limit)）（[三·并发内存](./performance.md#并发-worker-总内存计算v129-run-0809)）

### 🔴 stream 迁移（如做 invoke→stream 改造时必查）

- [ ] **chunk 格式确认**：`{ [nodeName]: delta }`（[五·stream](./stream-prompt-tools.md#五stream-迁移规范p0-级铁律)）
- [ ] **下游消费函数验证**（[五·stream](./stream-prompt-tools.md#stream-迁移检查清单)）
- [ ] **格式适配层**：累积 delta.messages → `{ messages: allMessages }`（[五·stream](./stream-prompt-tools.md#api-返回格式差异)）
- [ ] **端到端验证**（产物文件 + usage.jsonl）（[五·stream](./stream-prompt-tools.md#stream-迁移检查清单)）

### 📝 Prompt 设计

- [ ] **systemPrompt 末尾加 macOS BSD 工具约束段**（[六·BSD 约束](./stream-prompt-tools.md#六prompt-设计规范)）
- [ ] **systemPrompt 通过 stateModifier 注入**（[六·注入方式](./stream-prompt-tools.md#systemprompt-注入方式)）
- [ ] **纯只读场景加只读铁律**（release-gate 特有）（[六·只读约束](./stream-prompt-tools.md#纯只读约束release-gate-特有)）

### 🔧 工具开发

- [ ] **ExecutableTool → DynamicStructuredTool 转换**（[七·工具格式](./stream-prompt-tools.md#七工具开发规范)）
- [ ] **工具名加前缀**（sf_read / sf_write）（[七·工具命名](./stream-prompt-tools.md#工具命名)）
- [ ] **工具输出截断埋点**（[七·截断埋点](./stream-prompt-tools.md#工具输出截断埋点)）

### 📊 可观测性

- [ ] **两层可观测**（L1 visibility + L2 progressMw）（[八·两层可观测](./stream-prompt-tools.md#八可观测性规范)）
- [ ] **观测层失败不阻断主流程**（[八·两层可观测](./stream-prompt-tools.md#两层可观测)）
- [ ] **latest.json 原子写入**（先 .tmp 再 rename）（[八·latest.json](./stream-prompt-tools.md#latestjson-指针)）
- [ ] **darwin 平台绑 caffeinate 防后台节流**（[八·caffeinate](./stream-prompt-tools.md#macos-后台节流防护)）

---

## 十、附录

### 修复时间线

| 时间 | commit | 问题 | 级别 | 对应章节 |
|------|--------|------|------|---------|
| 07-25 | 4a4a143 | 失败路径可见性缺口 | P1 | 四·失败路径容错 |
| 07-25 | e4ba836 | middleware:[] 假修复 | P0（假修复） | 一·框架选型 |
| 07-26 | 9a9c5dc | createDeepAgent → createReactAgent | P0 | 一·框架选型 |
| 07-26 | 3248395 | recursionLimit 按步骤 + macOS 约束 + 降级 | P1 | 四·recursionLimit / 六·BSD 约束 |
| 07-26 | 8cd7b23 | runs 目录迁回原位（架构纠偏） | P2 | 一·目录架构 |
| 08-01 | 63b130d | 步骤级 maxTokens 覆盖（consolidate 32000） | P1 | 二·步骤级 maxTokens |
| 08-01 | da1039a | 四项 ReAct 性能优化（截断+裁剪+铁律+stream） | P1 | 三·上下文管理 / 效率铁律 / 流式输出 |
| 08-01 | a0571a4 | stream 迁移 finalState 数据丢失 | P0 | 五·stream 迁移 |
| 08-01 | 35cfb22 | 外部脚本 spawn 生存（流式日志+signal+head 管道） | P1 | 四·外部脚本 spawn 生存 |
| 08-01 | ae6f1c0 | spawn 生存规范文档化 | P2 | 四·外部脚本 spawn 生存 |
| 08-01 | 0d3c36e | SOFAGENT_SKIP_HOOK 防递归 + driver --skip-acceptance | P2 | 四·SKIP_HOOK |
| 08-01 | c1fab22 | 检查清单+附录同步 | P2 | 四·--skip-acceptance |
| 08-01 | 3530200 | 单步模式 + bash 编排脚本（跨步骤 OOM） | P0 | 四·--step |
| 08-01 | 95583e2 | preModelHook 物理裁剪 + --max-old-space-size=768（v1.2.5 起上调 1536） | P0 | 三·上下文管理 / 四·V8 heap |
| 08-02 | 95cd74a | worker 工具调用预算 prompt 铁律 + recursionLimit 熔断 | P1 | 四·死循环防护（L0） |
| 08-02 | ca9e329 | stateModifier 工具计数硬熔断 + allSettled 降级 + No such file 检测 | P0 | 四·死循环防护（L1/L2） |
| 08-02 | a610d5d | recursionLimit 130 + extractAgentText 空内容抢救 | P1 | 四·recursionLimit / 四·兜底报告 |
| 08-02 | dd5dde2 | P2 审查修复 × 3（注释措辞 + magic number 顶层化 + stream.return） | P2 | 四·死循环防护 |
| 08-02 | f240594 | parseStopCondition 降级检测——占位文件不算干净轮 | P0 | 四·降级检测防假阳性干净 |
| 08-02 | 701582a | L2 改两阶段写报告窗口 + 连续降级 error 退出 + 兜底合成报告 | P0 | 四·L2 两阶段 / 四·兜底报告 |
| 08-08 | run-07 | effectiveHardLimit 跨闭包引用——stateModifier 定义→invokeAgent 引用 | P0 | 四·跨闭包变量引用 |
| 08-08 | run-07~11 | nohup+disown 后台进程被 WorkBuddy 清理（4 次静默死亡） | P0 | 四·nohup 不安全 |
| 08-08 | run-08~09 | 8GB 机器并发 3/6 worker OOM（各 worker 2GB heap） | P0 | 三·并发 worker 总内存 |
| 08-09 | d152f1d2 | a-consolidate 假成功——兜底产物缺 ===FILE: 分隔符→result.md 判空→假 2-rounds-clean（findings 全丢） | P0（假阳性） | 四·产物完整性校验 |
| 08-09 | d152f1d2 | 并行 tool_call 回合边界检查超发 + 步骤级工具预算（a-consolidate 60/80） | P1 | 四·并行超发 |

### 历史坑位索引

| # | 问题 | 整合位置 |
|---|------|---------|
| 1 | createDeepAgent 硬编码 FilesystemMiddleware | 一·框架选型 |
| 2 | 工具格式必须用 tool() 创建 | 七·工具格式转换 |
| 3 | 工具名 BUILTIN 冲突 | 七·工具命名 |
| 4 | 统一 recursionLimit 导致 OOM | 四·recursionLimit |
| 5 | GLM/DeepSeek 反复用 GNU 语法 | 六·BSD 约束 |
| 6 | a-consolidate 失败 = 整个循环崩溃 | 四·失败路径容错 |
| 7 | worker catch 块没写可见性事件 | 四·失败路径容错 |
| 8 | runs 目录放错位置 | 一·目录架构 |
| 9 | 异构模型工具调用行为差异 | 二·模型配置 + 一·框架选型 |
| 10 | prompt 文件名和产物名不一致 | 一·步骤定义 |
| 11 | 12 视角太重需要分层 | 四·recursionLimit + 三·效率铁律 |
| 12 | 上下文雪球——工具输出不裁剪 | 三·上下文管理 |
| 13 | Agent 过度探索——910 次工具调用 | 三·Agent 行为约束 |
| 14 | invoke → stream 迁移的 P0 数据丢失 | 五·stream 迁移 |
| 15 | a-consolidate maxTokens 被截断 | 二·步骤级 maxTokens |
| 16 | 外部脚本 spawn——流式日志+signal+head 管道 | 四·外部脚本 spawn 生存 |
| 17 | init → hook 递归 + sandbox 复用 | 四·SKIP_HOOK / --skip-acceptance |
| 18 | 沙箱 OOM 三层——preModelHook + heap + 单步 | 三·上下文管理 + 四·V8 heap + 四·--step |
| 19 | Worker 死循环——Qwen3.8 无视 prompt 1119 次调用 | 四·死循环防护（三层熔断） |
| 20 | 硬熔断打断写报告——所有消息全空 content | 四·L2 两阶段 + 四·兜底报告 |
| 21 | 假阳性干净——降级占位被当"审查通过" | 四·降级检测防假阳性干净 |
| 22 | effectiveHardLimit 跨闭包引用——JS 作用域陷阱 | 四·跨闭包变量引用 |
| 23 | nohup+disown 后台进程被 WorkBuddy 清理 | 四·nohup 不安全 |
| 24 | 并发 worker 总内存超物理内存 → 系统级 OOM | 三·并发 worker 总内存 |
| 25 | 假成功——兜底产物格式坏被当"成功"，判定产物判空→假绿停止 | 四·产物完整性校验 |
| 26 | 并行 tool_call 让硬熔断超发（45 实际撞 48-60）+ 必读文件多须步骤级预算 | 四·并行超发 |

### 关键设计决策速查

| 决策 | 选择 | 理由 |
|------|------|------|
| Agent 框架 | createReactAgent | createDeepAgent 硬编码 FilesystemMiddleware |
| 进程模型 | spawn 子进程 | 零上下文继承，步骤间文件传递 |
| 沙箱执行 | --step 单步模式 + 外层编排 | 每步全新进程退出，内存归零 |
| 沙箱内存 | --max-old-space-size=1536 | v1.2.5 起 768→1536（长循环 OOM 教训）；v1.2.9 run-09 再调至 2048 |
| 后台启动 | Bash 工具 run_in_background | nohup+disown 被 WorkBuddy 清理（run-07~11 教训） |
| 并发上限 | floor((RAM - 3GB) / 2GB) | 8GB 机器并发=1，16GB+ 机器并发=6（run-08~09 OOM 教训） |
| 上下文注入 | stateModifier（非 prompt） | 互斥约束 + 可同时做裁剪 |
| 上下文物理裁剪 | preModelHook | stateModifier 只裁 prompt，preModelHook 物理替换 messages |
| 执行模式 | stream（非 invoke） | 实时进度打印 |
| 输出截断 | 200 行（头尾各 100） | 平衡信息与上下文膨胀 |
| prompt 窗口 | 最后 16 条（stateModifier） | 最后 8 轮工具交互 |
| 物理消息窗口 | 最后 20 条（preModelHook） | state.messages 上限 |
| 合并步骤 maxTokens | 32000 | thinking-only 16000 不够 |
| 分片 batch | 动态（≤20→5, ≤35→3, >35→2） | finding 越多每批越小 |
| 死循环防护 | 三层熔断（L1 软 50→L2 硬 60 窗口 5→L3 recursionLimit 130） | prompt 管不住 Qwen3.8 |
| 降级检测 | DEGRADATION_MARKERS 5 标记词 + isClean 前置 !isDegraded | 占位报告不算干净轮 |
| 连续降级 | 2 轮直接 fatal-error 退出 | 三层熔断全被打穿时止损 |
| 产物完整性 | 判定产物（result.md）空占位→降级重建为可修 finding | "有输出"≠"解析成功"；判定产物永远可解析（run-21 假成功教训） |
| 步骤级工具预算 | 必读文件多→单独 toolSoftLimit/toolHardLimit（consolidate 60/80） | 并行 tool_call 让硬熔断超发；开放探索类压低（12/15） |
