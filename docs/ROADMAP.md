# 路线图 · Roadmap

> 已经做了什么、未来要去哪、哪些地方需要你的帮助。
> v1.3.9 · 2026-08-21（UTC）· 🔍 官方 AST 规则引擎 + 🧩 meta-harness 统一编排 + 📊 worklog 工作明细 + 🔬 API 分级治理 + ⚙️ FORGE driver 切 DSH

产品定位详见 [设计哲学](./PHILOSOPHY.md) 和 [README](../README.md)。

## 现在在哪：v1.3.9（已交付）

> **v1.3.9 已于 2026-08-21 交付**——官方 AST 规则引擎（sofagent-ruleset-ast 含 ASI01/ASI04）+ meta-harness 多 harness 统一编排（DSH 形态对齐）+ AI 工作明细数据层（worklog + worklog_query MCP）+ API 分级 @public/@internal（1439 符号 + CI 门禁）+ FORGE driver 切 DSH（显式后端选择 + CLI 桥接 + bash 全权限）+ MLflow agent 评估 + Agentic Browser + 跨平台适配器（Cursor/Codex/Gemini）+ tools/ 物理分子目录 + ATTRIBUTION 归因引擎 + Dream Sandbox 沙盒审计 + >5MB diff 缝隙修复 + FORGE driver 进程守护（daemon + watcher）。详见 [v1.3.9 开发日志](./changelog/v1.3/v1.3.9.md)。
>
> **下一版 v1.4.0（规划中）**：Web 工作明细页 + 成本审计（超支告警 + `cost_query` MCP）+ DSH 反向插件家族（cordis-plugin-* 九件套）。详见下方「版本规划」表。
>
> **v1.3.8 已于 2026-08-20 交付**——代理网关硬边界（唯一出入口 + 风险分级 + 权限单调守卫 + HITL 审批队列激活）+ 数据静态加密（纯 TS AES-256-GCM 透明加解密 + 密钥指纹强制备份）+ Durable Execution L3（WAL 三态恢复 + undo 三档回滚）+ 异步长任务自治（cron 三档糖 + 依赖图 + 死循环检测）+ FORGE driver 保活三件套（pm2 托管 / resume 断点续跑 / liveness 探针）+ SDK sandbox:true 启用（工具/文件/网络三层沙箱）+ release-gate 瘦身（--judgment-only 判断层直启 + F 循环 FAIL 即停）+ fresh-eyes 成本重构（usage.jsonl 计量 + B 侧复核模式）+ 快照写路径加固（revert 两阶段原子化）· 另含 bugfix 批次（四 P0 安全修复 + 防屎山四项）。详见 [v1.3.8 开发日志](./changelog/v1.3/v1.3.8.md)。
>
> **v1.3.7 已于 2026-08-18 交付**——SubAgent 完整沙箱 + 场景驱动权限 + AgentShield 五类扫描 + 行业 overlay 四套 + 断路器行为监控 + ontology 生命周期 + 审查循环自适应并发 + memory-sync 路径通用化 + 26 项独立审查 bugfix。详见 [v1.3.7 开发日志](./changelog/v1.3/v1.3.7.md)。
>
> **v1.3.6 已于 2026-08-18 交付**——引擎接口外化完整版（模型层接入前置）：三个数据接口（Workflow 标准格式 + 运行容器 + 审阅协议字段 / Ontology 标准 Schema 注册 / 模型注册 + 灰度切换）+ 一个代码接口（SubAgent 托管 SDK `harness.wrap`）+ 训练协议三约定 + 预算控制 + 路由决策可解释性 + 机器可判定验收 tool + 可靠性五件（FORGE worktree 隔离 / 双闸验证 / 疲劳度检测 / 分级降级 / decisions.jsonl 完整版）· MCP 52→60 tools。详见 [v1.3.6 开发日志](./changelog/v1.3/v1.3.6.md)。

> ✅ **企业采购阻塞项 · Webhook 推送已于 v1.2.1 交付**：v1.1.6 接通 webhook **PASS/WARN/FAIL 三态推送**，v1.2.1 补齐企业协同平台（飞书/钉钉/企微）完整 Webhook 推送能力（见 SECURITY.md「审计结果推送」）。采购阻塞项已解除。

---

## 迭代历程

完整版本历史见 [CHANGELOG](../CHANGELOG.md)。v0.x 为实验/测试版，v1.0.0 起为正式版。

| 版本 | 核心交付 |
|------|------|
| **v1.3.9** | 🔍 官方 AST 规则引擎（sofagent-ruleset-ast 含 ASI01/ASI04 · 8+2 规则）+ 🧩 meta-harness 多 harness 统一编排（DSH 形态对齐）+ 📊 AI 工作明细数据层（worklog + worklog_query MCP）+ 🔬 API 分级 @public/@internal（1439 符号 + CI 门禁）+ ⚙️ FORGE driver 切 DSH（显式后端选择 + CLI 桥接 + bash 全权限）+ 📈 MLflow agent 评估（13 指标 + LLM-as-Judge）+ 🌐 Agentic Browser（4 工具 + 视觉降级）+ 🧭 跨平台适配器（Cursor/Codex/Gemini CLI）+ 🗂️ tools/ 物理分子目录 + 🏷️ ATTRIBUTION 归因引擎 + 🏖️ Dream Sandbox 沙盒审计 + 🩹 >5MB diff 缝隙修复（spill 落盘）+ 🔄 FORGE driver 进程守护（daemon + watcher）· 阶段五~八全流程（15 acceptance 场景补齐 + release-gate 三跑 PASS） |
| **v1.3.8** | 🛡️ 代理网关硬边界（唯一出入口 + 风险分级 + 权限单调守卫 + HITL 审批队列激活）+ 🔐 数据静态加密（纯 TS AES-256-GCM + 密钥指纹强制备份）+ ⏸️ Durable Execution L3（WAL 三态恢复 + undo 三档）+ 🤖 异步长任务自治（cron 三档糖 + 依赖图 + 死循环检测）+ ⚙️ FORGE driver 保活三件套（pm2 / resume / liveness）+ 🧩 SDK sandbox:true 启用（三层沙箱）+ 🔻 release-gate 瘦身（--judgment-only + F 循环 FAIL 即停）+ 📊 fresh-eyes 成本重构（usage.jsonl + B 侧复核）+ 📸 快照写路径加固（revert 原子化）· bugfix 四 P0（A1 后缀绕过 / A2 FFFD / 安装链 / 声称断裂） |
| **v1.3.7** | 🏰 SubAgent 完整沙箱（虚拟 FS / 网络白名单 / 工具中介 / 虚拟 key / 独立进程 / A-B 双跑）+ 🔐 场景驱动权限（身份→场景→风险→放行，fail-closed）+ 🛡️ AgentShield 五类扫描（MCP 画像 / Hook 注入 / 配置审查 / 密钥增强 / Shadow AI 发现）+ 🏥 行业 overlay 四套（fintech/medical/government/ai）+ ⚡ 断路器行为监控（ASI08 熔断 + ASI10 隔离）+ 🌳 ontology 生命周期（branch/trunk + migrateToTrunk 审阅门 + OKF 三件套）+ ⚙️ FORGE 审查循环自适应并发 + 🔌 memory-sync 路径通用化 + 26 项独立审查 bugfix |
| **v1.3.6** | 🔌 引擎接口外化完整版（模型层接入前置）：📥 三个数据接口（Workflow 标准格式 + 运行容器 + merge_criteria/approver 审阅协议字段 / Ontology 标准 Schema 注册 D1-D5 留痕 / 模型注册 + 灰度切换全流程审计 + 强制人审）+ 🧩 SubAgent 托管 SDK（harness.wrap 双形态兼容）+ 🏋️ 训练协议三约定 + 预算控制（自 v1.4.1 前移）+ 🧭 路由决策可解释性（EndpointProfile + route-policy + routeReason 结构化理由链）+ ✅ 机器可判定验收（define_acceptance / check_acceptance，复用 Benchmark 判定引擎）+ 🛡️ 可靠性五件（FORGE worktree 隔离根治 run-07 / 双闸验证 postToolCall 副作用复查 / Agent 疲劳度检测 / 分级降级梯队 / decisions.jsonl 五分类完整版）+ 🌳 仓库森林叙事升级 · MCP 52→60 tools（8 个新 tool 全登记） |
| **v1.3.5** | 🧬 MCP 自进化+运维闭环（run_ab_test / promote_ab 人审晋升 / snapshot_list / snapshot_restore 人审恢复 · 48→52 tools）+ 🌱 instinct→skill 自动进化（三源提取 + 置信度评分 + /evolve 聚合 + 错题本，DSH 插件形态预留）+ 🤝 FDE 运维五件（陪跑期/进场记忆/错题本/节点注册表/审计问卷 7 行业脚本）+ 🔒 依赖安全升级（vitest→4.1.10 critical 清零 + automerge 1.x→3.x 包名切换 + LangGraph/js-yaml/archiver）+ 🔌 DSH MCP 互通（52 tools stdio 即挂 + 人审语义不降级）· bugfix 38 项前置 |
| **v1.3.4** | 🏪 L3 组织能力公地（五环：发布→发现→调用→评价→养护 + 6 能力公地 MCP tool + trust 评分；原名 market_*，v1.3.6 起更名）+ 🛡️ SkillScan 安全门（发布/安装双触发，三态判定）+ 📊 评估体系三步（规则从生产中生长）+ 🔌 编排层与执行层分离（ExecutionBackend + DSH 执行后端接入，rc 守卫 + LangGraph fallback）+ 📜 DecisionKind.COMMONS 审计分型 + 🤖 公地健康双巡检（daemon L1 日更 + L2 周检） |
| **v1.3.3** | 🤝 L2 团队协作协议（五大机制）+ ✨ Refine Agent 完整版 + 🧭 主 agent 编排 + 🚪 入口路由 + 📈 进化闭环升级 + 📜 evidence 字段 |
| **v1.3.2** | 🔄 Onboard Agent 完整版（L2-L5 循环引擎：定位→修复→再跑→收敛，FORGE 产品化第二刀）+ 🎯 企业专属 eval 套件（金融/制造/供应链模板）+ ⚡ workflow 批量自动生成（一次建 N 个 sub-agent）+ 🧩 模型接入插槽扩展（client_type）+ 🎙️ FDE 梳理辅助（ontology 咨询式生成）+ 🧵 LLM Trace 任务级轨迹 + Onboard/Refine Session 级隔离 |
| **v1.3.1** | 🧠 Ontology 运行时层（Action 注册表 + validator 三态 + Schema 定稿）+ 🔀 并行编排（ParallelScheduler + 波次审计卡关 + MergeQueue）+ ⏸️ Durable Execution（checkpoint 续跑 + 副作用幂等）+ 🆔 Agent 身份码 Ed25519 + 🚀 Onboard Agent L1 + 📊 Benchmark 评测（隔离执行 + HMAC 链）+ 🔒 工具审批四模式 + 📜 LLM 调用级 Trace + 🔄 错误处理（stop_reason + 退避 + 收敛）+ 📚 L4 渐进加载 + 🏛️ 本体建模要求对齐 GB/T 48000.3-2026 |
| **v1.3.0** | 🛡️ 运行时审计最小闭环（wrapToolCall middleware + tool-gate 动态拦截 + 审计日志）+ 🧠 决策审计（emitDecision + HMAC 链 + kind-wise back）+ 🔗 激活链 Phase 4 收尾（SUSTAIN）+ 📋 list_rules MCP tool + 🔧 双规则系统统一（ruleType）+ 📦 外部记忆后端 Path A（7 个交付项）+ 🔧 进化链路写保护 + 🔓 运行时审计日志按 git 仓库隔离（复核注记：未随版落地，转规划）+ 🔧 危险操作 HITL 钩子 |
| **v1.2.x**（10 版） | **激活链 ACTIVATE→ORCHESTRATE→EXECUTE 全线打通 + 约束层叙事统一 + 三个入口产品**：v1.2.0 物理结构大重构（/sofagent/→/engine/）→ v1.2.5 激活链 Phase 1 + A20-A23 规则 → v1.2.7 编排引擎增强（StateGraph + Session Goals）→ v1.2.9 FORGE 短任务化 + npx CLI/规则市场/GitHub Action 三入口 + 约束层叙事重构（详见 [CHANGELOG](../CHANGELOG.md)） |
| **v1.1.x**（10 版） | **编排引擎从 ao → LangGraph + 多设备联邦 + Dream Cycle 知识进化**：v1.1.0 包结构纯度重构（12 包独立）→ v1.1.3 LangGraph StateGraph 直接编排 → v1.1.7 Dream Cycle 6 阶段 + 知识健康巡检 → v1.1.8 安全层加密 + 联邦查询 → v1.1.9 产品叙事收敛（FDE Agent）+ USB 完整运行时（详见 [CHANGELOG](../CHANGELOG.md)） |
| **v1.0.x**（10 版） | **审计引擎奠基 + AI 知识库实现 + 双节点架构**：v1.0.0 正式版发布（Agent 审计工具，2026-07-10）→ v1.0.5 Ontology 统一层 + Work模板市场 → v1.0.7 双节点架构 + ao 退役 → v1.0.8 FDE Agent 自进化 + 文件系统审计 → v1.0.9 二进制审计 + MCP compose tool（详见 [CHANGELOG](../CHANGELOG.md)） |

## 未来去哪

> 以下是**方向**，不是承诺。没实测过的事标「不知道」。

**终局**：企业不再需要 FDE。AI 节点部署后自主运行，审计引擎持续盯变更，编排引擎自动纠偏，知识库自我积累——人只需要偶尔看一眼 dashboard 确认一切正常。我们做的不是给企业装 AI，是让企业忘了我们的存在。

> DeepMind 创始人 Demis Hassabis 在 2026 年 Guardian 采访中坦言："**现在发生的一切，并不是我当初希望 AI 发展的方式。**"这位一手推动了 AlphaFold 和 AlphaGo 的人，在 AI 走向商业化失控的转折点上，公开表达了不安。sofagent 的终局不是"更多的 AI"，而是"AI 可以被管住"——如果连创造 AI 的人都觉得方向失控了，那 Harness 中间件就不是选配，是刚需。

**为什么是现在——转折点的三信号**：单一信号不够，三信号同时成熟才构成真正的范式转折点：

| 信号 | 维度 | 内容 |
|------|------|------|
| 供给侧 | AI Coding 成本趋零 | FDE 借 AI Coding 1 天出 Demo，瓶颈从技术能力转向**业务抽象能力**（能否把 SOP 拆成 Agent 工作流） |
| 治理侧 | Agent IAM 组织身份 | Agent 有工号/权限/审计/全生命周期管理，从「工具」变「员工」，才能进生产环境 |
| 能力侧 | 协同飞轮持续进化 | 每次人工纠正/确认/追问回流为结构化学习信号，越用越懂企业 |

**现实验证（数字原生工作方式）**：工作流主语从「人」迁移到「Agent」——将 SOP 拆为 Agent 工作流、给 Agent 派工号、把人工纠正回流为学习信号——正是三信号同时成熟的落地案例，让抽象框架变现实（2026-07 行业观察）。

sofagent 的定位正卡在这个转折点上：审计引擎（治理侧）+ Ontology（能力侧）+ 开源 MIT（供给侧）——三信号缺一不可，单独做任何一个都不够。

**供给侧补全——「技术拼图已齐」**（黄仁勋 2025.7）：NVIDIA 判断企业 AI Agent 的所有核心组件——世界级语言模型（NITRO 3 ULTRA）、针对性微调框架、示范方案（Deep In Blueprint）、沙盒安全运行环境、无缝集成工具链——已全部就绪。"所有技术拼图已经拼齐，企业没有理由不立刻拥抱 Harness 工程。" sofagent 的 `install.sh` + FDE 四阶段示范方案正是这一判断的工程实现——不是告诉企业"该做"，而是直接给一套可以跑的具体蓝图。

两条路径：**FDE 驻场部署**（传统中小企业，FDE 进场→四阶段十二步流程→交付→撤离）和 **开发者自部署**（开源社区，git clone→install.sh→审计→CI 集成）。

设备端形态：安装时可配置 Agent 平台（OpenClaw / WorkBuddy 等），审计结果通过 MCP server 推到企业协同平台。**数据主权在设备**——所有记忆、日志、决策记录永不离开本地。

> 以下是方向落地为版本的具体拆解。v3.x 长期架构骨架见下方「探索方向」。

---

## 版本规划

> 以下带状态版本表为权威源；各版本详细子节见下方 `###`。

### 规划版本

> 🔗 **激活链进度框架**：v1.2.5-v1.3.0 按激活链四阶段推进（ACTIVATE→ORCHESTRATE→EXECUTE→SUSTAIN），每个版本对应一个阶段或阶段内子步骤。详见 [激活链设计文档](./guides/fde-activation-chain.md)。
>
> ✅ **已完成阶段**：ACTIVATE（v1.2.5）→ ORCHESTRATE（v1.2.6-v1.2.7）→ EXECUTE 前半（v1.2.8）

> 🔴 **阻塞项占位纪律**：任何 🔴 采购 / 合规阻塞项必须在下表占据一个**明确的版本单元格**（标注具体版本号），不得仅写在散文备注里。

| 版本 | 状态 | 核心交付 | 日志 |
|------|:--:|------|:--:|
| **v1.3.6** | ✅ 已交付 | **🔌 引擎接口外化完整版（模型层接入前置 · 原 v2.0 前移）**：① Workflow 标准格式 + 运行容器（JSON Schema + MCP `workflow_submit`；**+ 审阅协议字段 `merge_criteria`/`approver`——workflow 从「步骤列表」升级为「变更提案的审阅协议」，审计引擎即 merge_criteria 执行器，GitHub 式协作底座，2026-08-16 新增**）② Ontology 注册接口（MCP `ontology_import` + D1-D5 审计）③ **SubAgent 托管 SDK**（`harness.wrap` 包装 LangGraph 自定义 Agent → 自动获得审计/审批/身份/Trace，createReactAgent + 纯 StateGraph 双形态——模型层 sub-agent 托管的落点）④ **模型注册 + 灰度切换**（`model_register` / `model_switch`，评测 → 注册 → 灰度 → 晋升全流程审计 + 强制人审；`source: 'local-path'` 扩展位预留，企业专属模型本地权重部署在 v1.4.1 填充；**通用模型路由不自研——企业挂第三方 model router（LiteLLM/OpenRouter），sofagent 只保留数据主权路由 + 注册/灰度/退役，2026-08-10 补充**）⑤ **训练协议三约定 + 训练预算控制（自 v1.4.1 前移，2026-08-12）**——双栈架构契约（Node 控制面 spawn Python + stdout JSON 流 + SIGINT 控制）+ 成本透明（超预算暂停 + 人审），让企业专属模型早期试点客户更早接入 ⑥ **路由决策可解释性（role-model 启发，2026-08-13 新增）**——补 Profiles 半个（端点能力画像）+ Policy 半个（偏好/预算/决胜规则）+ routeReason 结构化决策字段，**不自研路由器只补决策可审计性** ⑦ **运维闭环增强四件（自 v1.3.5 移入 2026-08-15：双闸验证 postToolCall 副作用复查 / Agent 疲劳度检测 / 分级降级梯队 full→rules-only→minimal→safe-stop / decisions.jsonl 完整版）** + **DSH 正向执行后端补全（2026-08-14 新增）**——v1.3.4 已交付接口骨架 + 版本守卫（rc 拦截），本版补全：`runCordisAgent()` 对照 @deepseek-ai/dsh 正式版 Cordis API 重写 + `dag-runner`/`composer`/`loop/nodes`/`node-executor` 剩余调用点迁移到 ExecutionBackend + 正式版发布后版本守卫放开（**契约依据已就绪：DSH 官方 cordis-tutorial 七章已发布——apply(ctx)/事件域/工具流水线/插件三形态，重写不再猜测 API；工具格式转换对照官方 ToolDefinition 三段式**，2026-08-15 教程全量蒸馏确认；**+ Trajectory 信号采集 PoC 与节点级审计可行性实测**——订阅事件流落 JSON 验证 reward 样本格式（商业模型层 B' 路径起点）+ 24 条规则逐条判定节点链适配性，产出 v1.4.0 plugin 节点级审计交付范围依据，2026-08-15 补充；**+ 验收 MCP tool 先行版（`define_acceptance` / `check_acceptance`——复用 Benchmark 判定引擎，任何 MCP 宿主可调，DSH 经 v1.3.5 互通即得软约束验收，v1.4.0 plugin 再硬化，收敛鸿沟直接解，2026-08-16 补充）** + **双后端镜像验证（DSH 后端跑通后同一 workflow 在 LangGraph / DSH 双后端执行，Trajectory 过程视角 + git diff 结果视角对比一致 = ExecutionBackend 抽象正确性实证，2026-08-16 补充）**）。**依赖：DSH 正式版发布（当前 rc.6）**——rc 期间版本守卫继续拦截，不阻塞 v1.3.6 其他交付项 ——**训练语料导出三件套已移至 v1.4.1 训练引擎**（2026-08-10 决策已定：训练相关内容统一从 v1.4.x 开始） + **🔧 FORGE 隔离加固（2026-08-16 新增 · 四件：fresh-eyes/release-gate 双 driver git worktree 隔离 + worker-alive 戳 + 启动前独占窗口检查 + LEDGER 中止归档 SOP——run-07 两次进程死亡与 worker 测试残留污染主仓的直接修复，四件全做；其中 worker-alive 戳/独占窗口检查/LEDGER SOP 三件已落地，本版实际开发 = worktree 隔离 + worker-alive 戳 release-gate 侧镜像补全）** | [日志](./changelog/v1.3/v1.3.6.md) |
| **v1.4.0** | 📋 规划中 | **📊 Web 工作明细页 + 💰 成本审计 + 🔌 DSH 反向插件（企业 AI 工作记录视图 · 版本号重新启用）**：`dashboard.html` 加「工作明细」区块（按 Agent/按 Workflow/按周 + 人工介入记录，读 v1.3.9 落盘的 `worklog.json`，降级示例对齐现有模式）+ **成本审计维度**（WARN only 不拦截——超支告警 + `cost_query` MCP tool + COST DecisionKind，ccteam 启发；v1.3.9 worklog 已采集成本数据，本版补"超支判定 + 告警"这把刀）+ **DSH 反向插件适配（plugin 家族 · 2026-08-16 单点改家族）**（把 sofagent @public API 包装成**一族独立 Cordis 插件**——`cordis-plugin-audit`（审阅门：机器审阅 24 规则 + 节点级审计）/ `cordis-plugin-rollback`（剪枝：effect disposer）/ `cordis-plugin-inject`（约束：apply(ctx) 注入四层加载链）/ `cordis-plugin-evolve`（进化：think.md 反思 + Dream Cycle 蒸馏 + skillopt 优化）/ `cordis-plugin-ontology`（地图：共享语义底座）/ `cordis-plugin-commons`（公地：能力五环，复用 v1.3.4 六能力公地 tool，v1.3.6 起 market_* 更名 commons_*）/ `cordis-plugin-gate`（合并标准：turn-stopping 硬门禁）/ `cordis-plugin-daemon`（养护：7×24 巡检 + 健康监测）/ `cordis-plugin-fde`（攻面：fde_interview/classify/quantify/derive/distill/deploy 六 tool），每个插件干一件事、可独立安装渐进采用——攻守一体 + 四能力闭环 + 仓库森林四要素 + 公地生态层 = 一个 FDE；协作底座是涌现不是构建，plugin 挂进 DSH 后生态自动获得「仓库森林」运转机制——依赖链：v1.3.6 ExecutionBackend 接口 → v1.3.9 API 分级 @public → 本版插件包装；DSH 正式版已发布的 Cordis 插件协议对照，2026-08-14 明确；**seam 选型已按官方文档精确化：审计挂 `tools/result`（官方钦定审计入口，观察不可变权威结果）+ `tools/pre-execute`（拒绝/放行策略）+ `fs/write-intent`（文件门禁）；审批留痕走 log-only 会话事件不进模型 surface；仓库打 `dsh-plugin` GitHub topic 占生态位；**插件含节点级审计 v1**——适配节点链的规则子集（范围由 v1.3.6 实测结论定）扩展为 tool 调用级归因 + pre-execute 拒绝留痕，2026-08-15 落位；**审批应答者**——sofagent 审批引擎注册进 DSH approval 应答者链（企业一个审批队列管所有 Agent）；**回溯 Cordis 语义化**——git snapshot 实现为 effect disposer（卸载即逆序撤销）；**验收硬门禁——挂 `agent/turn-stopping` 拦截关轮（验收不过不放行 + 失败原因注入 + maxGoalRounds 防刷轮），v1.3.6 软约束 tool 的 plugin 硬化，收敛鸿沟的工程解**，2026-08-15/16 补充）——Dashboard Web 前端已就绪（dashboard.html 6 页 + serve-dashboard.mjs），v1.3.9 已承载 AST + meta 两个大交付，Web 页 + 成本审计 + DSH 插件同版交付 + **三件收口（2026-08-22 排入 · 独立审查发现的未接线项）**——**MLflow 接线**（v1.3.9 已交付 `logBenchmarkToMlflow` 13 指标但零运行时调用者：接入 Benchmark 评测链路 + 进公共 API，tracking server 不可达降级不抛）+ **Agentic Browser MCP 注册**（v1.3.9 已交付 browser-tools 4 工具但未注册：接入 tool-registry，MCP 61→65，README 能力段呈现）+ **联邦查询跨设备 E2E**（federation 现有 9 个同进程 mock 单测缺跨进程证据：桌面已验证脚本 5 场景 10 断言固化入仓 + 双设备 OpenClaw 通道联调记录，multi-device-sync 更新） + **bash 3.2 真实环境验证（2026-08-22 排入 · v1.3.4 release-gate 遗留）**——全 shell 脚本在真实 macOS bash 3.2（非 shim）跑通：`/bin/bash -n` 全量语法 + 门禁四件/install.sh/post-install.sh 实跑 EXIT=0，修复空数组守卫/pipefail/BSD sed 词边界等兼容差异并 zsh+bash3.2 双跑验证 | [日志](./changelog/v1.4/v1.4.0.md) |
| **v1.4.1** | 📋 规划中 | **🚀 训练引擎 · 地基（编排 + 审计 + 隔离 + 指纹 + 签名 + 回收 + 恢复 + 安全）**：① **train-job 编排层** ② **train_job 审计** ③ **训练隔离边界**（enterpriseId 全链路）④ **训练可复现指纹**（checkpoint 续跑版本锁定）⑤ **训练产物完整性校验**（权重 HMAC）⑥ **训练中断与资源回收**（心跳+孤儿巡检+GPU 泄漏检测）⑦ **引擎崩溃恢复**（假活任务清理+三选项恢复）⑧ **训练安全基线**（路径注入/沙箱自检/凭据脱敏+攻击面声明文档）——**训练协议三约定 + 训练预算控制已前移至 v1.3.6（2026-08-12）** | [日志](./changelog/v1.4/v1.4.1.md) |
| **v1.4.2** | 📋 规划中 | **🚀 训练引擎 · 数据与评估（管道 + 版本 + eval + 环境 + dry-run + 报告）**：① **企业数据 → 训练集管道**（CSV/Excel/**DB/API** 多源异构接入 + instruction/偏好对构建 + 质量闸门 + 训练入口脱敏）② **训练集版本管理**（dataset_version，eval 引用版本可复现）③ **训练中 eval 闭环**（复用 v1.3.1 Benchmark，阈值外部化——机制开源/阈值外部化）④ **训练环境管理**（train env init + train doctor + **基座模型下载管理** + 环境版本清单）⑤ **训练 dry-run 与配置预检**（train dry-run：极小数据集跑通管线 + 显存预检 + 数据抽样检查——失败前预防，与 v1.4.3 diagnose 互补）⑥ **训练报告**（train report：客户可读交付物 + 量化四字段，绩效量化引擎输入） | [日志](./changelog/v1.4/v1.4.2.md) |
| **v1.4.3** | 📋 规划中 | **🚀 训练引擎 · 运行与需求（监控 + 诊断 + 沙箱 + 推导 + 模板 + workflow + 可观测）**：① **训练监控与 GPU 队列**（train_status + **train_list** + 显存预算排队 + webhook + **Dashboard 训练区块 + 健康度指标落盘**）② **训练失败诊断**（OOM/数据/发散/框架/环境五类）③ **训练沙箱 + 设备打包**（扩展 v1.3.7 + 离线 + 设备封装前置）④ **训练需求推导 + 模板库**（`train analyze` + 场景模板）⑤ **后训练 workflow 模板**（七节点 FDE 载体 + 三 HITL） | [日志](./changelog/v1.4/v1.4.3.md) |
| **v1.4.4** | 📋 规划中 | **🚀 训练引擎 · 信号与部署闭环（语料 + 权重 + 注册 + 对比）**：① **训练语料导出三件套**（规则 + GUIDE 方法论 + 样本四源 [decision-log/llm-calls/evaluation-log/runtime-audit] + Trace 轨迹 + 通用脱敏管线 + HMAC 签名 + 合规红线——含 human-fde 人工基准，从 v1.3.2/v1.3.6 归集）② **企业专属模型本地权重部署链路**（权重目录规范 + 本地加载 + 版本回滚，从 v1.3.6 归集）③ **训练产物 → 模型注册自动衔接**（train done + eval pass → model_register，闭环最后一步）④ **多基座对比训练**（train compare：同数据多基座并行 + ROI 排序，阶段 2 选型前置） | [日志](./changelog/v1.4/v1.4.4.md) |
| **v1.4.5** | 📋 规划中 | **🚀 训练引擎 · 服务与持续（推理服务 + 持续后训练 + 合规扫描 + 交付包 + 归档 + quickstart · 生命周期补全）**：① **训练推理服务**（train serve + 健康检查 + model_switch 联动）② **持续后训练**（数据回流 + 阈值/定时/人工触发 + 回退保护）③ **训练数据合规扫描**（PII/敏感字段 + 合规闸门）④ **FDE 训练交付包**（配置+数据+eval 基线+运维手册+权重清单）⑤ **训练产物归档与保留策略**（train-retention + @weekly 归档 + 90 天销毁 + 空间预警）⑥ **训练引擎 Quickstart**（端到端示例文档 + 合成数据 + 最小 job.json） | [日志](./changelog/v1.4/v1.4.5.md) |
| **v1.4.6** | 📋 规划中 | **🚀 训练引擎 · 分布式与云端（多卡 + 云 VM 执行面 · 规模化前置）**：① **多卡/分布式训练**（train multi：多卡/多机配置 + verl/DeepSpeed 集群 spawn + GPU 队列多卡拓扑感知 + 分布式失败诊断）② **云端 VM 执行面**（train cloud：Node 控制面本地 + Python 执行面云上——ssh/API 远程 spawn + 数据加密上传/训练后清理 + 云端成本入预算——「全托管」交付模式技术底座；⚠️ 敏感数据不上公有云，走客户机房联合训练） | [日志](./changelog/v1.4/v1.4.6.md) |
| **v1.4.7** | 📋 规划中 | **🔌 商业平台 平台接口版（商业产品层前置 · 2026-08-17 新增）**：承载 商业平台 平台接口规划 §9.1 中未覆盖项——**G2 能力缺口查询**（MCP `workflow_gaps`——读 workflow 状态找「缺人/缺能力的节点」，悬赏式 PR 的发现接口，依赖 v1.3.9 worklog + v1.3.7 ontology lifecycle）· **G4 绩效数据导出**（MCP `contribution_query`——读审计 + decision-log 算每人/每 workflow 贡献度，DKP 价值轨数据源，对齐 v1.4.5 FDE 训练交付包的量化四字段）· **G6 节点级可见性元数据**（workflow schema 加 `visibility` 字段 open/private/result-only——任务面/数据面分离，审阅门按此执行）· **G7 多租户抽象层 v0**（引擎数据路径 `data/<tenant>/` 命名空间——先做数据路径抽象，隔离策略随 SaaS 需要细化；动引擎内核，v1.4.6 云 VM 执行面后评估。**共享执行层隔离刚需 · 2026-08-20 强化**：社区私有化部署 DSH 实践（两篇，2026-08-19）验证「企业共享 Agent」是真实需求，且共同缺口 = 多账号/权限/数据隔离——G7 正是补「隔离」的引擎侧底座（数据路径抽象是第一步，按用户隔离工作区/知识库随后细化））· **workflow 烧进 USB**（FDE 交付物理载体 · 2026-08-19 新增：`create-usb-key` 产物清单扩展——烧入 workflow 定义 + 依赖 skill/tool 注册 + 节点配置，插上即是一个会跑企业具体业务流程的节点，与 商业平台 在线交付互补；依赖 fde_deploy v1.4.0 + DSH 执行后端，升级 v1.1.9「只烧引擎+知识」为「烧引擎+知识+workflow」）· **审计留痕双层（2026-08-22 排入 · Codex rollout-trace 启发）**——history.jsonl 读取端拆独立规约层（raw append-only 写路径不动），与审计存储 SQLite 迁移评估同批 · **静态加密全量接线 + 引擎侧 data-sovereignty repo-hash 隔离（2026-08-22 从 v1.3.9 未兑现项移排）**——forge-runs/checkpoint/model-registry 三目录 + task/logs + think.md 加密接线，复用 FORGE 方案补齐引擎侧 `data/audit/data-sovereignty/<repo-hash>/` 隔离（原排 v1.3.9 未交付，与 G7 数据主权主题同源，并入本版） | [日志](./changelog/v1.4/v1.4.7.md) |
| **v1.4.8** | 📋 规划中 | **🔌 插件分发企业管控（2026-08-22 新增 · Codex marketplace 启发）**：插件来源白名单（Git URL / 主机模式 / 本地路径三类，对齐 Codex MarketplaceAllowedSource）+ 托管 hook 独裁模式（`allow_managed_hooks_only` 等价物，企业部署忽略用户自定义 hook 只跑 sofagent 托管审计 hook）——管控同时覆盖 ClawHub（OpenClaw plugin 家族）+ SkillHub（DSH plugin 家族），判断在安装侧生效。**依赖 v1.4.0 三 plugin 家族交付** | [日志](./changelog/v1.4/v1.4.8.md) |


### 加载链预算目标跟踪

- **≤3% 总占用预算目标**（加载链总占用 ≤ 上下文窗口 3% / 规范类 ≤500 字 / think ≤2K token）：当前状态 v1.3.8 未全量落地（当前为全文注入，仅 persona 前 500 字符与 knowledge 单篇前 2000 字符有截断）；目标版本：后续版本（与窗口超预算拒载/降级机制一并落地，见 [ARCHITECTURE §四 加载链预算](./ARCHITECTURE.md#四核心设计决策)）。

---

## 行业印证

### 🔮 行业印证

> 完整行业对标（DeerFlow / Omnigent / DataFlow / OpenWorker / OpenFDE / a16z 七法则 / Graph Engineering / 5 阶段风险收敛）统一见 [VALIDATION](./VALIDATION.md)。以下仅保留与版本规划直接相关的结论。

**运行时审计演进路线**（meta-harness 三问作答）：
- **v1.3.x**：最小运行时审计——wrapToolCall middleware 包 createReactAgent（FORGE 已跑 createReactAgent，加 middleware 即可）
- **v1.3.7**：完整运行时审计——策略强制 + 沙箱 + 状态化拦截（范围限定 SubAgent）
- **v1.3.9**：meta-harness——多 harness 编排（承接 v1.3.7 沙箱底座）

**落地纪律**：以上均为「用行业术语框定已有/规划能力」，不新增能力范围。外部框架是设计启发 + 开源借力，非依赖引入。

**热度信号**：2025-2026 硅谷「AI 自进化 / Loop」成为最热关键词，斯坦福 2025 秋季直接开设自进化公开课（主讲为前 Google PaLM 训练负责人 + 递归自我改进实验室联创），把 Agent 工作流拆成「工具调用 + 验证器 + 评审器 + 编排器」四件套——这与我们的激活链（ACTIVATE→ORCHESTRATE→EXECUTE→SUSTAIN）逐件对位：编排器=激活链、验证器=审计 Gate、评审器=fde.md/acceptance、工具调用=MCP server。激活链不是追热点，是提前踩中趋势——方法论印证见 [VALIDATION · Verifier 才是瓶颈](./VALIDATION.md#verifier-才是瓶颈) 与 [VALIDATION · 循环系统的鲁棒性](./VALIDATION.md#循环系统的鲁棒性四类故障与六要素)。

---

## 探索方向

> 探索方向 = 想到了但还没排进具体版本的方向。已交付的见[迭代历程](#迭代历程)，已排期的见[版本规划](#版本规划)。

| 方向 | 一句话 |
|------|------|
| PE/VC 多企业审计仪表盘 | 投后管理场景——所有被投企业的 AI 审计数据汇总到一个面板 |
| FDE 陪跑期机制 | 部署后前 2 周 AI 节点 daily review，人类反馈和 AI 反思双向写入 think.md |
| SMB 场景审计扩展 | 审计从代码开发扩展到数据处理/报表生成 |
| **自带净水设备的水龙头（v3.x+ 远景）** | Subagent 支持挂载外部精调小模型（引擎层提供路由与加载插槽），零投喂、本地推理、离线可用 |
| 国标 Agent 审计对位 | 关注国家 AI 智能体互联标准草案进展，标准正式发布后评估对齐 |
| **Ontology Validation Engine（DataFlow 启发）** | Schema 已交付（v1.3.1）+ 注册接口排期（v1.3.6）+ Validation Engine（DAG 无环 + schema 兼容）与「本体结构 = GitHub 生长树」的根系工程化合并评估 |
| **bash 3.2 真实环境验证（v1.3.4 release-gate 遗留）** | 全部 shell 脚本在真实 macOS bash 3.2（非 shim）跑一遍——空数组/pipefail/词边界差异 |
| **trimMessagesSafe 作用域审计（v1.3.4 release-gate 遗留）** | FORGE 消息裁剪的作用域边界确认（跨闭包引用同款风险家族） |
| **评估反哺闭环端到端场景（v1.3.4 verdict 遗留）** | harvest→jury→promote 全链路 acceptance 场景（当前只有 3 处单点覆盖） |
| **MCP 暴露 audit 数据对外（DataFlow 启发）** | v1.3.6 已排期 ontology/workflow 暴露面；audit 数据对外暴露（读 history.jsonl/decision-log 的 MCP 接口）作为 meta-harness（v1.3.9）的延伸能力评估 |
| **spec-first 硬禁令（OpenFDE 启发 · 设计约束）** | 单一事实源——transcript 永不直驱代码，spec 才是唯一驱动 |
| **FDE 进场记忆目录工程化（fdeops-arch 启发）** | 每客户一个 `data/fde-sessions/<client-id>/` 目录 + 10 文件各司其职 + session-stop 自动捕获——方法论已在 FDE/GUIDE §5.8b 落盘，工程化（自动捕获 hook + 跨 session 恢复）与 v1.3.5 instinct 自动进化合并评估 |
| **多 Agent 协作阵型库（ccteam 启发 · Codex collaboration-mode 补充 2026-08-22）** | 把协作模式抽象为可配置阵型（commander&crews / driver&advisor / cross-review / bake-off / research-triangulation / cost-pyramid 六种）——等 v1.3.6 SubAgent 托管 SDK 落地后评估是否做阵型配置层。**Codex collaboration-mode-templates（default.md / plan.md 可切换协作模式）是现成参考形态**；Codex agent-graph-store（thread-spawn 边生命周期 Open/Closed）提供子 Agent 编排图的边状态管理参考 |
| **L4 工具层自进化（self-evolution 五层谱系 · 2026-08-17）** | Agent 自写工具→SkillScan 安全门→人审→注册进工具箱——五层中唯一空白层（L1 记忆/L3 技能已交付，L5 训练引擎 v1.4.1 排期中）；安全语义基建现成（SkillScan + promote 人审模式复用），谱系定位见 PHILOSOPHY §五 |
| **凭证隔离 Vault（OMA 启发）** | 沙箱发 HTTP 请求时动态注入凭证、Agent 代码碰不到 token——执行层安全基础设施，v1.3.7 虚拟 key 凭证边界已部分覆盖，完整 Vault 属 v2.x+ 方向 |
| **理解债务应对（loop-engineering 启发）** | Comprehension Debt Spiral（S2 级故障）——审计已覆盖「发生了什么」，需补「为什么这么做」（auto-PR 要求 Agent 解释决策）+「本周摘要」（daemon 周报）|
| **DSH 训练控制面 plugin（2026-08-16 新增 · 深水区终局）** | v1.4.x 训练引擎的控制面 tools（`train_submit/status/budget_check`）天然 plugin 形态（DSH jobs 托管长任务互补）；执行面/GPU/商业模型层 训练资产**绝不进 plugin**（§3.6 归属决策：训练资产属商业层）。终局拼图：Trajectory 采集（v1.3.6）+ 训练引擎（v1.4.x）+ plugin 包装 = **DSH Agent 用自己的执行轨迹训练自己**（Cordis 论文指向但 DSH 未交付的自进化 Harness）。**远期方向：v1.4.x 尾段或 v2.x，引擎本体稳定后再评估** |
| **ACS YAML 策略引擎（Microsoft AGT 启发）** | 现有 ruleset 是 JSON，AGT 的 ACS 用 YAML + OPA Rego + Cedar 三引擎——策略更人类可读，需评估兼容性 |
| **RL 训练治理（Microsoft AGT Agent Lightning 启发）** | 训练期间策略违规惩罚——与 v1.4.1 训练引擎预算控制同向 |
| **OWASP Agentic Top 10 全覆盖路线（Microsoft AGT 启发）** | v1.3.7 补 ASI08+ASI10，v1.3.9 补 ASI01+ASI04，远期 10/10 全覆盖对齐 AGT |
| **评测结论证据树（HarnessEval 启发）** | 评测结论须挂可验证证据树——每个结论可回溯到原始执行证据，与审计引擎「先留证据再给结论」同源。可借鉴 Plan→Route→Decompose→Verify 四阶段范式升级 release-gate-loop 的裁决链。当前单源（15 机构联合评测主张），待独立来源累计后评估排期 |
| **成本控制前移：quota 事前门禁（Loop Engineering 控制面启发 · 2026-08-19 新增）** | 每轮执行前先问配额、验证过的回写才记 spend——成本从「事后记账」前移为「事前问路」，与 v1.3.7「守卫先于事件分发」哲学同向。v1.4.0 成本审计 WARN only 为起点，事前门禁为演进方向 |
| **证据强度分级标注（Loop Engineering 控制面启发 · 2026-08-19 新增）** | 对外展示的案例/证据按来源强度分级（公开可查 / 用户自报 / 自测自报），只维护最强少数案例——防止把自测当实证。当前 VALIDATION/THANKS 有来源纪律但无强度分级，发版 SOP 可吸收 |
| **运行时 should-run 判定链（Loop Engineering 控制面启发 · 2026-08-19 新增）** | 每轮开工前统一问一遍的判定链：健康 → 人审 gate → 证据等待 → 专注等待 → 配额，全部通过才执行——断路器（v1.3.7）两态的丰富形态，等运行时数据积累后评估演化 |
| **依赖方向架构测试（Loop Engineering 控制面启发 · 2026-08-19 新增）** | CI 强制包依赖方向（控制面不得依赖展示/CLI 层）——审查视角有但 CI 无强制，低成本高价值，需先定包边界清单 |
| **审计存储 SQLite 迁移（DeepSeek Harness RC.8 启发 · 2026-08-20 新增 · Codex thread-store 参考 2026-08-22）** | history.jsonl 明文存储（LIMITATIONS 已披露）→ SQLite 迁移评估——DSH RC.8 实测 SQLite 后端读写/分叉性能提升 + 存储体积下降（数据结构不兼容），sofagent 审计历史若迁 SQLite 可获得查询能力（按 agent/时间/规则过滤）+ 体积收益；大工程（数据迁移 + 兼容层 + 既有 reader 改造），等 worklog 聚合（v1.3.9）消费模式跑稳后评估。**候选版本：v1.4.7**（与 G7 多租户数据路径同批动引擎内核，G7 v0 先做路径抽象、SQLite 引擎替换随后评估）。**参考**：Codex thread-store 的 queue_store + thread_sections 分区存储是会话/事件持久化的现成实现 |
| **UI 层审计（多模态截图证据 · 2026-08-20 新增）** | 审计从代码 diff 扩展到 UI 行为——Agentic Browser（v1.3.9）截图经多模态分析产出 UI 层审计证据（「表单提交是否正确」不再只靠断言），截图作为审计证据入 history；**纯文本模型可用工具层视觉降级消费截图**（OCR+结构化，DSH 社区 dsh-vision 启发）；依赖 v1.3.9 多模态链路跑通 + 审计证据模型扩展，暂占概念位。**候选版本：v2.x**（证据模型扩展是远期，v1.4.x 专注训练引擎与 商业平台 接口） |
| **workflow 节点级模型偏好绑定（共享执行层启发 · 2026-08-20 新增）** | workflow 每个节点可绑定特定 Provider/模型（默认 DeepSeek 省钱、复杂节点切旗舰）——「workflow 共享执行层」的模型路由维度：与 v1.3.6 模型注册/灰度切换衔接，补「节点级偏好绑定」；**不自研路由**（v1.3.6 已明确企业挂第三方 router），只定义「workflow 执行层模型路由接口」让第三方/企业网关接入。社区共享 DSH 实践（2026-08-19）显示多用户共用执行层时「按场景选模型」是刚需。**候选版本：v1.4.7**（与 G7 多租户抽象层同批评估——企业级共享执行层的两个引擎侧基础） |
| **插件来源管控补充维度（Codex connectors 启发 · 2026-08-22 新增）** | Codex connectors 的 app_tool_policy（应用级工具策略——哪个 app 能调哪些工具）是企业管控的另一维度——v1.4.8 插件分发企业管控（已排期）落地后评估补此维度 |
| **审计留痕格式：raw trace + reduced state 双层（Codex rollout-trace 启发 · 2026-08-22 排入 v1.4.7）** | Codex 的 rollout-trace 分「raw bundle（原始事件流，writer 热路径只写不读）+ reduced state（语义规约缓存，供 replay/viewer 消费）」两层——与 sofagent「Ledger 原始不可变 + Views 派生」同构，但 Codex 把「raw 写入器」和「语义回放器」物理拆成两个 crate（热路径零负担）。借鉴点：审计历史（history.jsonl）的读取端拆出独立规约层，避免「写多读少」的单一文件性能瓶颈。**已排期：v1.4.7**（与 SQLite 迁移评估同批） |
| **自动上下文压缩（Codex compact 启发 · 2026-08-22 新增）** | Codex 的 compact.rs 是官方「ARC-AGI-3 13.3%→38.3%」两大调整之一（保留推理 + 上下文压缩）：`pre-compact`/`post-compact` hooks + SUMMARIZATION_PROMPT 摘要 + 多触发策略（AutoCompactWindowIds / CompactionReason）+ 压缩替代历史保留 initial context。sofagent 加载链预算（≤3% 总占用）已披露「尚未全量落地」——本方向评估自动压缩（窗口超预算触发摘要，对齐 memory 分层「写入笨、派生灵活」哲学）。**候选版本：v1.4.x**（与加载链预算同域评估）。**参考**：context-fragments 的 start/end markers（注入上下文带标记、事后可识别） |
| **shell 提权分级策略（Codex shell-escalation 启发 · 2026-08-22 新增）** | Codex 的 shell-escalation 是完整提权框架：`EscalationPolicy`（决策）+ `EscalationDecision`（allow/prompt/forbid）+ `EscalationPermissions`（权限位）+ execve wrapper——危险命令从「沙箱内直接跑」升级为「提权策略决策后跑」。sofagent 审计有 HITL 钩子但 shell 执行无分级提权策略——评估把「命令分级 → 策略决策 → HITL/拒绝」接入 daemon/编排层执行（与 v1.3.7 场景驱动权限衔接）。**候选版本：v1.4.x** |

> 📖 DeerFlow / OpenFDE 方法论印证见 [VALIDATION](./VALIDATION.md)。

> 以下「分层模型架构」为探索方向的核心技术骨架概述。当前版本（v1.3.x）引擎层未涉及，v3.x 才启动。

## 分层模型架构（v3.x 远景概述）

核心驱动力 = **数据主权**（企业数据进 API key 大模型 = 一定被拿去训练）。三层模型 + Harness 路由：云端 32B+ 负责规划推理 → 翻译成标准化指令 → 本地 7B 执行多步 workflow → 本地 0.5B 跑管道层（模板/格式/字段提取）。敏感数据只在本地处理，通用知识才走云端。**引擎层只做模型路由（model-router.ts 已有四档插槽），精调 pipeline 属模型层非开源范围。** 路由层可提前到 v2.x 做（不依赖精调模型）；**离线 USB 节点提前到 v2.x**（企业专属模型本地推理 + workflow 烧录合体——v1.4.4 本地权重部署 + v1.4.7 workflow 烧录底座已就绪，v2.x 合体成完全离线节点，2026-08-19 提前）；v3.x-v4.x+ 剩企业专属小模型精调（QLoRA distill 轻量化）。完整技术骨架（Mermaid 图 + 选型表 + 实现难度）见 [PHILOSOPHY · 远期演化愿景](./PHILOSOPHY.md#远期演化愿景从内置小模型到自动化企业后训练引擎)。

---

## 不需要的

以下认真考虑过但决定不做。完整设计禁区见 [PHILOSOPHY §八](./PHILOSOPHY.md#八不做什么设计禁区)。

---

## 欢迎参与

| 你能做的事 | 时间 | 说明 |
|------|:--:|------|
| 跨平台测试 | 30 min | 你有 Codex / Hermes / Claude Code？装一下告诉我们 |
| 补充 FAQ | 20 min | 你踩了什么坑？直接改 HANDBOOK §三（排查问题） |
| 文档翻译 | 1-2 h | 英文翻译对社区意义巨大 |
| 第三方证据 | 1 周 | 装完用一周，填 [docs/evidence/evidence.md](./evidence/evidence.md) |
| 安全审计 | 不限 | 给 SECURITY.md 较真 |
| 企业场景反馈 | 30 min | 你们团队怎么用 Agent？直接开 Issue |

> [CONTRIBUTING.md](../CONTRIBUTING.md)

---

## 历史架构演进

编排引擎从 ao → DeepAgents → LangGraph 的升级史（v1.2.0 起 FORGE loop 已完全弃用 deepagents，改用 createReactAgent；历史编排引擎的 DeepAgents 调度原型见 v1.1.8 changelog）、Ontology 从实体关联到本体结构的渐进构建、外部框架对标（Palantir/gbrain/WeKnora/Runta）、Loop Engineering 全栈对照等详见 **[ARCHITECTURE.md](./ARCHITECTURE.md)** 的「架构设计决策的行业锚点」+「编排收敛与 A/B 测试」+「本体结构 = GitHub 生长树」章节，以及各版本 **[开发日志](./changelog/)**。

> 📖 多设备同步方案见 [多设备同步指南](./guides/multi-device-sync.md)。

> 📖 以上三个 loop-engineering 启发方向（FDE 节点注册表 / Worktree 隔离 / 理解债务）已并入上方 [探索方向](#探索方向) 表，来源链接见 [cobusgreyling/loop-engineering](https://github.com/cobusgreyling/loop-engineering)（MIT 开源）。
