# 路线图 · Roadmap

> 已经做了什么、未来要去哪、哪些地方需要你的帮助。
> v1.3.6 · 2026-08-17（UTC）· 🔌 引擎接口外化完整版（Workflow 容器 / Ontology 注册 / 托管 SDK / 模型灰度 / 训练协议 / 机器验收 · 52→60 MCP tools）

产品定位详见 [设计哲学](./PHILOSOPHY.md) 和 [README](../README.md)。

## 现在在哪：v1.3.6（已交付）

> **v1.3.6 已于 2026-08-17 交付**——引擎接口外化完整版（模型层接入前置）：三个数据接口（Workflow 标准格式 + 运行容器 + 审阅协议字段 / Ontology 标准 Schema 注册 / 模型注册 + 灰度切换）+ 一个代码接口（SubAgent 托管 SDK `harness.wrap`）+ 训练协议三约定 + 预算控制 + 路由决策可解释性 + 机器可判定验收 tool + 可靠性五件（FORGE worktree 隔离 / 双闸验证 / 疲劳度检测 / 分级降级 / decisions.jsonl 完整版）· MCP 52→60 tools。详见 [v1.3.6 开发日志](./changelog/v1.3/v1.3.6.md)。
>
> **v1.3.5 已于 2026-08-16 交付**——自进化与运维闭环：MCP 48→52 tools（A/B 实验 + 快照恢复，破坏性操作强制人审）+ instinct→skill 自动进化 + FDE 运维五件 + 依赖安全升级（npm audit 清零）+ DSH MCP 互通 + 四份审查 bugfix 38 项。详见 [v1.3.5 开发日志](./changelog/v1.3/v1.3.5.md)。

> ✅ **企业采购阻塞项 · Webhook 推送已于 v1.2.1 交付**：v1.1.6 接通 webhook **PASS/WARN/FAIL 三态推送**，v1.2.1 补齐企业协同平台（飞书/钉钉/企微）完整 Webhook 推送能力（见 SECURITY.md「审计结果推送」）。采购阻塞项已解除。

---

## 迭代历程

完整版本历史见 [CHANGELOG](../CHANGELOG.md)。v0.x 为实验/测试版，v1.0.0 起为正式版。

| 版本 | 核心交付 |
|------|------|
| **v1.3.6** | 🔌 引擎接口外化完整版（模型层接入前置）：📥 三个数据接口（Workflow 标准格式 + 运行容器 + merge_criteria/approver 审阅协议字段 / Ontology 标准 Schema 注册 D1-D5 留痕 / 模型注册 + 灰度切换全流程审计 + 强制人审）+ 🧩 SubAgent 托管 SDK（harness.wrap 双形态兼容）+ 🏋️ 训练协议三约定 + 预算控制（B2 决策前移自 v1.4.1）+ 🧭 路由决策可解释性（EndpointProfile + route-policy + routeReason 结构化理由链）+ ✅ 机器可判定验收（define_acceptance / check_acceptance，复用 Benchmark 判定引擎）+ 🛡️ 可靠性五件（FORGE worktree 隔离根治 run-07 / 双闸验证 postToolCall 副作用复查 / Agent 疲劳度检测 / 分级降级梯队 / decisions.jsonl 五分类完整版）+ 🌳 仓库森林叙事升级 · MCP 52→60 tools（8 个新 tool 全登记） |
| **v1.3.5** | 🧬 MCP 自进化+运维闭环（run_ab_test / promote_ab 人审晋升 / snapshot_list / snapshot_restore 人审恢复 · 48→52 tools）+ 🌱 instinct→skill 自动进化（三源提取 + 置信度评分 + /evolve 聚合 + 错题本，DSH 插件形态预留）+ 🤝 FDE 运维五件（陪跑期/进场记忆/错题本/节点注册表/审计问卷 7 行业脚本）+ 🔒 依赖安全升级（vitest→4.1.10 critical 清零 + automerge 1.x→3.x 包名切换 + LangGraph/js-yaml/archiver）+ 🔌 DSH MCP 互通（52 tools stdio 即挂 + 人审语义不降级）· bugfix 38 项前置 |
| **v1.3.4** | 🏪 L3 组织能力公地（五环：发布→发现→调用→评价→养护 + 6 能力公地 MCP tool + trust 评分；原名 market_*，v1.3.6 起更名）+ 🛡️ SkillScan 安全门（发布/安装双触发，三态判定）+ 📊 评估体系三步（规则从生产中生长）+ 🔌 编排层与执行层分离（ExecutionBackend + DSH 执行后端接入，rc 守卫 + LangGraph fallback）+ 📜 DecisionKind.COMMONS 审计分型 + 🤖 公地健康双巡检（daemon L1 日更 + L2 周检） |
| **v1.3.3** | 🤝 L2 团队协作协议（五大机制）+ ✨ Refine Agent 完整版 + 🧭 主 agent 编排 + 🚪 入口路由 + 📈 进化闭环升级 + 📜 evidence 字段 |
| **v1.3.2** | 🔄 Onboard Agent 完整版（L2-L5 循环引擎：定位→修复→再跑→收敛，FORGE 产品化第二刀）+ 🎯 企业专属 eval 套件（金融/制造/供应链模板）+ ⚡ workflow 批量自动生成（一次建 N 个 sub-agent）+ 🧩 模型接入插槽扩展（client_type）+ 🎙️ FDE 梳理辅助（ontology 咨询式生成）+ 🧵 LLM Trace 任务级轨迹 + Onboard/Refine Session 级隔离 |
| **v1.3.1** | 🧠 Ontology 运行时层（Action 注册表 + validator 三态 + Schema 定稿）+ 🔀 并行编排（ParallelScheduler + 波次审计卡关 + MergeQueue）+ ⏸️ Durable Execution（checkpoint 续跑 + 副作用幂等）+ 🆔 Agent 身份码 Ed25519 + 🚀 Onboard Agent L1 + 📊 Benchmark 评测（隔离执行 + HMAC 链）+ 🔒 工具审批四模式 + 📜 LLM 调用级 Trace + 🔄 错误处理（stop_reason + 退避 + 收敛）+ 📚 L4 渐进加载 + 🏛️ 国标对齐 GB/T 48000.3-2026 |
| **v1.3.0** | 🛡️ 运行时审计最小闭环（wrapToolCall middleware + tool-gate 动态拦截 + 审计日志）+ 🧠 决策审计（emitDecision + HMAC 链 + kind-wise back）+ 🔗 激活链 Phase 4 收尾（SUSTAIN）+ 📋 list_rules MCP tool + 🔧 双规则系统统一（ruleType）+ 📦 外部记忆后端 Path A（7 个交付项）+ 🔧 进化链路写保护 + 🔓 运行时审计日志按 git 仓库隔离 + 🔧 危险操作 HITL 钩子 |
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
| **v1.3.6** | ✅ 已交付 | **🔌 引擎接口外化完整版（模型层接入前置 · 原 v2.0 前移）**：① Workflow 标准格式 + 运行容器（JSON Schema + MCP `workflow_submit`；**+ 审阅协议字段 `merge_criteria`/`approver`——workflow 从「步骤列表」升级为「变更提案的审阅协议」，审计引擎即 merge_criteria 执行器，GitHub 式协作底座，2026-08-16 新增**）② Ontology 注册接口（MCP `ontology_import` + D1-D5 审计）③ **SubAgent 托管 SDK**（`harness.wrap` 包装 LangGraph 自定义 Agent → 自动获得审计/审批/身份/Trace，createReactAgent + 纯 StateGraph 双形态——模型层 sub-agent 托管的落点）④ **模型注册 + 灰度切换**（`model_register` / `model_switch`，评测 → 注册 → 灰度 → 晋升全流程审计 + 强制人审；`source: 'local-path'` 扩展位预留，企业专属模型本地权重部署在 v1.4.1 填充；**通用模型路由不自研——企业挂第三方 model router（LiteLLM/OpenRouter），sofagent 只保留数据主权路由 + 注册/灰度/退役，2026-08-10 补充**）⑤ **训练协议三约定 + 训练预算控制（B2 决策前移自 v1.4.1，2026-08-12）**——双栈架构契约（Node 控制面 spawn Python + stdout JSON 流 + SIGINT 控制）+ 成本透明（超预算暂停 + 人审），让企业专属模型早期试点客户更早接入 ⑥ **路由决策可解释性（role-model 启发，2026-08-13 新增）**——补 Profiles 半个（端点能力画像）+ Policy 半个（偏好/预算/决胜规则）+ routeReason 结构化决策字段，**不自研路由器只补决策可审计性** ⑦ **运维闭环增强四件（自 v1.3.5 移入 2026-08-15：双闸验证 postToolCall 副作用复查 / Agent 疲劳度检测 / 分级降级梯队 full→rules-only→minimal→safe-stop / decisions.jsonl 完整版）** + **DSH 正向执行后端补全（2026-08-14 新增）**——v1.3.4 已交付接口骨架 + 版本守卫（rc 拦截），本版补全：`runCordisAgent()` 对照 @deepseek-ai/dsh 正式版 Cordis API 重写 + `dag-runner`/`composer`/`loop/nodes`/`node-executor` 剩余调用点迁移到 ExecutionBackend + 正式版发布后版本守卫放开（**契约依据已就绪：DSH 官方 cordis-tutorial 七章已发布——apply(ctx)/事件域/工具流水线/插件三形态，重写不再猜测 API；工具格式转换对照官方 ToolDefinition 三段式**，2026-08-15 教程全量蒸馏确认；**+ Trajectory 信号采集 PoC 与节点级审计可行性实测**——订阅事件流落 JSON 验证 reward 样本格式（商业模型层 B' 路径起点）+ 24 条规则逐条判定节点链适配性，产出 v1.4.0 plugin 节点级审计交付范围依据，2026-08-15 补充；**+ 验收 MCP tool 先行版（`define_acceptance` / `check_acceptance`——复用 Benchmark 判定引擎，任何 MCP 宿主可调，DSH 经 v1.3.5 互通即得软约束验收，v1.4.0 plugin 再硬化，收敛鸿沟直接解，2026-08-16 补充）** + **双后端镜像验证（DSH 后端跑通后同一 workflow 在 LangGraph / DSH 双后端执行，Trajectory 过程视角 + git diff 结果视角对比一致 = ExecutionBackend 抽象正确性实证，2026-08-16 补充）**）。**依赖：DSH 正式版发布（当前 rc.6）**——rc 期间版本守卫继续拦截，不阻塞 v1.3.6 其他交付项 ——**训练语料导出三件套已移至 v1.4.1 训练引擎**（2026-08-10 决策已定：训练相关内容统一从 v1.4.x 开始） + **🔧 FORGE 隔离加固（2026-08-16 新增 · 四件：fresh-eyes/release-gate 双 driver git worktree 隔离 + worker-alive 戳 + 启动前独占窗口检查 + LEDGER 中止归档 SOP——run-07 两次进程死亡与 worker 测试残留污染主仓的直接修复，用户拍板四件全做；其中 worker-alive 戳/独占窗口检查/LEDGER SOP 三件已落地，本版实际开发 = worktree 隔离 + worker-alive 戳 release-gate 侧镜像补全）** | [日志](./changelog/v1.3/v1.3.6.md) |
| **v1.3.7** | 📋 规划中 | **🔒 SubAgent 完整沙箱 + 场景驱动权限 + 🛡️ AgentShield + 行业 overlay（原 v1.4.0 前移）**：① 沙箱——虚拟文件系统隔离 + 网络出站白名单 + 工具调用中介（前置 allow/deny）+ 虚拟 key 凭证边界注入 + AsyncSubAgent + 真·实时 A/B 双跑 ② 场景驱动权限体系（身份→场景匹配→风险等级→放行）——审计从「事后」扩展到「运行时」（范围限定 SubAgent；**设计轴对齐 DSH 权限两旋钮正交分解：效果边界（沙箱）× 决策通道（审批）分离 + fail-closed + 守卫先于事件分发**，2026-08-15 DSH 教程蒸馏补充）③ **AgentShield 审计维度扩展**（agent 配置/hook/MCP 攻击面静态扫描——密钥检测增强 + hook 注入分析 + MCP 风险画像 + agent 配置审查，ECC AgentShield 102 规则/1282 测试启发，填补「Agent 配置本身是攻击面」维度，2026-08-13 补充）④ **行业 overlay 规则包**（金融/医疗/政务/AI 四行业自动激活额外约束——复用 `--ruleset` 规则市场机制，fdeops 5 overlays 启发，2026-08-13 补充）⑤ **断路器 + 行为监控**（OWASP ASI08 级联故障 + ASI10 失控 agent——连续 N 次失败自动熔断 + agent 行为指标超阈值自动隔离，Microsoft AGT Agent SRE + Agent Hypervisor 启发，2026-08-13 补充）⑥ **ontology 生命周期状态 trunk/branch（GitHub 式协作底座 ontology 层落点，2026-08-16 新增）**——实体加 lifecycle 字段，branch→trunk 迁移走 v1.3.6 approver 审阅门，对齐能力公地五环状态，ontology-view 区分基线资产与试验资产 | [日志](./changelog/v1.3/v1.3.7.md) |
| **v1.3.8** | 📋 规划中 | **🛡️ 代理网关硬边界 + 数据静态加密 + Durable L3（原 v1.4.0 前移）**：① 代理网关（唯一出入口 + 风险分级 + 超阈值人工批准）② 数据静态加密（age）③ Durable Execution L3（WAL 写在网关层）④ **托管 SDK `sandbox: true` 选项启用**（v1.3.6 SDK 的沙箱接线） | [日志](./changelog/v1.3/v1.3.8.md) |
| **v1.3.9** | 📋 规划中 | **🛠️ 官方 AST 规则引擎 + meta-harness + 📊 AI 工作明细数据层 + MLflow agent 评估 + Agentic Browser + 🔒 API 分级治理（原 v1.5.0 + v2.0 前移）**：① 官方 `sofagent-ruleset-ast` 语义级规则引擎参考实现（TypeScript compiler / tree-sitter）② meta-harness 多 harness 统一编排（策略强制在基础设施层 + 跨会话协作）③ AI 工作明细数据层（业务视角：按 Agent/按 Workflow/按周 + 人工介入记录，零新数据——复用审计 + decision-log + LLM Trace；**补节点实际耗时采集——绩效量化引擎 `年节省=日耗时×时薪×250` 的直接输入**，2026-08-10 新增；数据源可复用 v1.3.6 DSH 事件流（如后端启用，节点级留痕天然含耗时字段，2026-08-15 补充）；`worklog_query` MCP + 落盘 `worklog.json`；终端 ASCII 视图可选；**Web 工作明细页 v1.4.0**，Startwork 启发）④ **📊 MLflow agent 评估集成**（从 v1.3.3 移入，2026-08-12：50+ 标准指标 + LLM-as-Judge + MLflow tracking）⑤ **🌐 Agentic Browser / Playwright**（从 v1.3.3 移入，2026-08-12：Refine Agent UI 验证 + 4 核心 tool + 运行时审计统一通道）⑥ **🔒 API 分级 @public/@internal + CI 门禁（B3 决策，2026-08-12）**——`engine/*/src/index.ts` 双层 export 划分（@public = semver 锁定，商业模型层 可依赖；@internal = 不承诺，破坏性变更无需 bump），CI 加 public API 变更检测（变更必须 semver bump + CHANGELOG 记录）；AST 规则引擎天然可复用做 API 语义解析，同版交付降本；**商业模型层 Q3 代码同源（独立仓库 + npm 依赖）的前置依赖——API 没分级 = 商业侧不敢锁依赖** ⑦ **跨平台适配器扩展**（至少加 Cursor/Codex/Gemini CLI 三平台——ECC 15 平台同源配置启发，API 分级做完后扩展成本最低，2026-08-13 补充） | [日志](./changelog/v1.3/v1.3.9.md) |
| **v1.4.0** | 📋 规划中 | **📊 Web 工作明细页 + 💰 成本审计 + 🔌 DSH 反向插件（企业 AI 工作记录视图 · 版本号重新启用）**：`dashboard.html` 加「工作明细」区块（按 Agent/按 Workflow/按周 + 人工介入记录，读 v1.3.9 落盘的 `worklog.json`，降级示例对齐现有模式）+ **成本审计维度**（WARN only 不拦截——超支告警 + `cost_query` MCP tool + COST DecisionKind，ccteam 启发；v1.3.9 worklog 已采集成本数据，本版补"超支判定 + 告警"这把刀）+ **DSH 反向插件适配（plugin 家族 · 2026-08-16 单点改家族）**（把 sofagent @public API 包装成**一族独立 Cordis 插件**——`cordis-plugin-audit`（审阅门：机器审阅 24 规则 + 节点级审计）/ `cordis-plugin-rollback`（剪枝：effect disposer）/ `cordis-plugin-inject`（约束：apply(ctx) 注入四层加载链）/ `cordis-plugin-evolve`（进化：think.md 反思 + Dream Cycle 蒸馏 + skillopt 优化）/ `cordis-plugin-ontology`（地图：共享语义底座）/ `cordis-plugin-commons`（公地：能力五环，复用 v1.3.4 六能力公地 tool，v1.3.6 起 market_* 更名 commons_*）/ `cordis-plugin-gate`（合并标准：turn-stopping 硬门禁）/ `cordis-plugin-daemon`（养护：7×24 巡检 + 健康监测）/ `cordis-plugin-fde`（攻面：fde_interview/classify/quantify 三 tool），每个插件干一件事、可独立安装渐进采用——攻守一体 + 四能力闭环 + 仓库森林四要素 + 公地生态层 = 一个 FDE；协作底座是涌现不是构建，plugin 挂进 DSH 后生态自动获得「仓库森林」运转机制——依赖链：v1.3.6 ExecutionBackend 接口 → v1.3.9 API 分级 @public → 本版插件包装；DSH 正式版已发布的 Cordis 插件协议对照，2026-08-14 明确；**seam 选型已按官方文档精确化：审计挂 `tools/result`（官方钦定审计入口，观察不可变权威结果）+ `tools/pre-execute`（拒绝/放行策略）+ `fs/write-intent`（文件门禁）；审批留痕走 log-only 会话事件不进模型 surface；仓库打 `dsh-plugin` GitHub topic 占生态位；**插件含节点级审计 v1**——适配节点链的规则子集（范围由 v1.3.6 实测结论定）扩展为 tool 调用级归因 + pre-execute 拒绝留痕，2026-08-15 落位；**审批应答者**——sofagent 审批引擎注册进 DSH approval 应答者链（企业一个审批队列管所有 Agent）；**回溯 Cordis 语义化**——git snapshot 实现为 effect disposer（卸载即逆序撤销）；**验收硬门禁——挂 `agent/turn-stopping` 拦截关轮（验收不过不放行 + 失败原因注入 + maxGoalRounds 防刷轮），v1.3.6 软约束 tool 的 plugin 硬化，收敛鸿沟的工程解**，2026-08-15/16 补充）——Dashboard Web 前端已就绪（dashboard.html 6 页 + serve-dashboard.mjs），v1.3.9 已承载 AST + meta 两个大交付，Web 页 + 成本审计 + DSH 插件同版交付 | [日志](./changelog/v1.4/v1.4.0.md) |
| **v1.4.1** | 📋 规划中 | **🚀 训练引擎 · 地基（编排 + 审计 + 隔离 + 指纹 + 签名 + 回收 + 恢复 + 安全）**：① **train-job 编排层** ② **train_job 审计** ③ **训练隔离边界**（enterpriseId 全链路）④ **训练可复现指纹**（checkpoint 续跑版本锁定）⑤ **训练产物完整性校验**（权重 HMAC）⑥ **训练中断与资源回收**（心跳+孤儿巡检+GPU 泄漏检测）⑦ **引擎崩溃恢复**（假活任务清理+三选项恢复）⑧ **训练安全基线**（路径注入/沙箱自检/凭据脱敏+攻击面声明文档）——**训练协议三约定 + 训练预算控制已前移至 v1.3.6（B2 决策，2026-08-12）** | [日志](./changelog/v1.4/v1.4.1.md) |
| **v1.4.2** | 📋 规划中 | **🚀 训练引擎 · 数据与评估（管道 + 版本 + eval + 环境 + dry-run + 报告）**：① **企业数据 → 训练集管道**（CSV/Excel/**DB/API** 多源异构接入 + instruction/偏好对构建 + 质量闸门 + 训练入口脱敏）② **训练集版本管理**（dataset_version，eval 引用版本可复现）③ **训练中 eval 闭环**（复用 v1.3.1 Benchmark，阈值外部化——机制开源/阈值外部化）④ **训练环境管理**（train env init + train doctor + **基座模型下载管理** + 环境版本清单）⑤ **训练 dry-run 与配置预检**（train dry-run：极小数据集跑通管线 + 显存预检 + 数据抽样检查——失败前预防，与 v1.4.3 diagnose 互补）⑥ **训练报告**（train report：客户可读交付物 + 量化四字段，绩效量化引擎输入） | [日志](./changelog/v1.4/v1.4.2.md) |
| **v1.4.3** | 📋 规划中 | **🚀 训练引擎 · 运行与需求（监控 + 诊断 + 沙箱 + 推导 + 模板 + workflow + 可观测）**：① **训练监控与 GPU 队列**（train_status + **train_list** + 显存预算排队 + webhook + **Dashboard 训练区块 + 健康度指标落盘**）② **训练失败诊断**（OOM/数据/发散/框架/环境五类）③ **训练沙箱 + 设备打包**（扩展 v1.3.7 + 离线 + 设备封装前置）④ **训练需求推导 + 模板库**（`train analyze` + 场景模板）⑤ **后训练 workflow 模板**（七节点 FDE 载体 + 三 HITL） | [日志](./changelog/v1.4/v1.4.3.md) |
| **v1.4.4** | 📋 规划中 | **🚀 训练引擎 · 信号与部署闭环（语料 + 权重 + 注册 + 对比）**：① **训练语料导出三件套**（规则 + GUIDE 方法论 + 样本四源 [decision-log/llm-calls/evaluation-log/runtime-audit] + Trace 轨迹 + 通用脱敏管线 + HMAC 签名 + 合规红线——含 human-fde 人工基准，从 v1.3.2/v1.3.6 归集）② **企业专属模型本地权重部署链路**（权重目录规范 + 本地加载 + 版本回滚，从 v1.3.6 归集）③ **训练产物 → 模型注册自动衔接**（train done + eval pass → model_register，闭环最后一步）④ **多基座对比训练**（train compare：同数据多基座并行 + ROI 排序，阶段 2 选型前置） | [日志](./changelog/v1.4/v1.4.4.md) |
| **v1.4.5** | 📋 规划中 | **🚀 训练引擎 · 服务与持续（推理服务 + 持续后训练 + 合规扫描 + 交付包 + 归档 + quickstart · 生命周期补全）**：① **训练推理服务**（train serve + 健康检查 + model_switch 联动）② **持续后训练**（数据回流 + 阈值/定时/人工触发 + 回退保护）③ **训练数据合规扫描**（PII/敏感字段 + 合规闸门）④ **FDE 训练交付包**（配置+数据+eval 基线+运维手册+权重清单）⑤ **训练产物归档与保留策略**（train-retention + @weekly 归档 + 90 天销毁 + 空间预警）⑥ **训练引擎 Quickstart**（端到端示例文档 + 合成数据 + 最小 job.json） | [日志](./changelog/v1.4/v1.4.5.md) |
| **v1.4.6** | 📋 规划中 | **🚀 训练引擎 · 分布式与云端（多卡 + 云 VM 执行面 · 规模化前置）**：① **多卡/分布式训练**（train multi：多卡/多机配置 + verl/DeepSpeed 集群 spawn + GPU 队列多卡拓扑感知 + 分布式失败诊断）② **云端 VM 执行面**（train cloud：Node 控制面本地 + Python 执行面云上——ssh/API 远程 spawn + 数据加密上传/训练后清理 + 云端成本入预算——「全托管」交付模式技术底座；⚠️ 敏感数据不上公有云，走客户机房联合训练） | [日志](./changelog/v1.4/v1.4.6.md) |
| **v1.4.7** | 📋 规划中 | **🔌 商业平台 平台接口版（商业产品层前置 · 2026-08-17 新增）**：承载 商业平台.md §9.1 平台接口预留中未覆盖项——**G2 能力缺口查询**（MCP `workflow_gaps`——读 workflow 状态找「缺人/缺能力的节点」，悬赏式 PR 的发现接口，依赖 v1.3.9 worklog + v1.3.7 ontology lifecycle）· **G4 绩效数据导出**（MCP `contribution_query`——读审计 + decision-log 算每人/每 workflow 贡献度，DKP 价值轨数据源，对齐 v1.4.5 FDE 训练交付包的量化四字段）· **G6 节点级可见性元数据**（workflow schema 加 `visibility` 字段 open/private/result-only——任务面/数据面分离，审阅门按此执行）· **G7 多租户抽象层 v0**（引擎数据路径 `data/<tenant>/` 命名空间——先做数据路径抽象，隔离策略随 SaaS 需要细化；动引擎内核，v1.4.6 云 VM 执行面后评估） | [日志](./changelog/v1.4/v1.4.7.md) |

> 📖 **已交付版本**（v1.0.0~v1.3.5）的详细交付清单见 [迭代历程](#迭代历程) + 各版本 [开发日志](./changelog/)。ROADMAP 只规划未来版本（v1.3.6+），不保留已交付版本的详细说明——交付即移出。

> 🔗 **版本重排说明**（2026-08-09）：原 v1.4.0（沙箱/权限/网关/加密/WAL）→ v1.3.7/v1.3.8；原 v1.5.0（meta-harness）→ v1.3.9；原 v2.0（引擎接口外化）→ v1.3.6。依赖链在 v1.3.x 内已满足，模型层接入需要接口尽早就绪。v1.4.0 版本号重新启用（承载 Web 工作明细页 + 成本审计）；v1.5.0 / v2.0 版本号留空，未来按需重新规划。各版本详细重排原因见对应 [开发日志](./changelog/)。

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
| **GEPA / MemEx / RLM 评估（Omnigent 路线图参考 · v2.x）** | Omnigent 路线图四项（GEPA 自动优化 / MemEx 持久记忆 / RLM 强化学习 / Server MCP）方向在 v2.x 评估框架时参考——跟踪其落地后再对齐，不抢跑 |
| **spec-first 硬禁令（OpenFDE 启发 · 设计约束）** | 单一事实源——transcript 永不直驱代码，spec 才是唯一驱动 |
| **FDE 进场记忆目录工程化（fdeops-arch 启发）** | 每客户一个 `data/fde-sessions/<client-id>/` 目录 + 10 文件各司其职 + session-stop 自动捕获——方法论已在 FDE/GUIDE §5.8b 落盘，工程化（自动捕获 hook + 跨 session 恢复）与 v1.3.5 instinct 自动进化合并评估 |
| **Memory Vault 跨工具交接（ECC 启发）** | 企业多 AI 工具场景的 FDE 过程记忆跨工具交接——`memory handoff --from workbuddy --target claude` 式的跨 harness 交接能力 |
| **多 Agent 协作阵型库（ccteam 启发）** | 把协作模式抽象为可配置阵型（commander&crews / driver&advisor / cross-review / bake-off / research-triangulation / cost-pyramid 六种）——等 v1.3.6 SubAgent 托管 SDK 落地后评估是否做阵型配置层 |
| **失败记忆显式化（MateBot 启发）** | 独立"错题本"机制（区别于 think.md 反思 + knowledge/ 正向经验）——与 v1.3.5 instinct→skill 自动进化合并评估，不另起炉灶 |
| **凭证隔离 Vault（OMA 启发）** | 沙箱发 HTTP 请求时动态注入凭证、Agent 代码碰不到 token——执行层安全基础设施，v1.3.7 虚拟 key 凭证边界已部分覆盖，完整 Vault 属 v2.x+ 方向 |
| **FDE 节点注册表（loop-engineering 启发）** | 为 FDE 模板建 `fde-registry.yaml`（机器可读：id/cadence/risk/skills/human_gates），audit 引擎直接读取——从手动排查到机器可读 |
| **执行层隔离 Worktree 模式（loop-engineering 启发）** | 每个 code-change 跑在隔离 git worktree——短期推荐实践 → 中期编排引擎内置 `worktree create` → 远期 L2+ 硬性要求 |
| **理解债务应对（loop-engineering 启发）** | Comprehension Debt Spiral（S2 级故障）——审计已覆盖「发生了什么」，需补「为什么这么做」（auto-PR 要求 Agent 解释决策）+「本周摘要」（daemon 周报）|
| **DSH 正向执行后端接入（DeepSeek Harness 启发）** | 定义 `ExecutionBackend` 接口，DSH Cordis 运行时成为可选执行后端（fallback LangGraph createReactAgent）——编排层（图结构+审计卡关）与执行层显式分离。**v1.3.4 已交付**：接口骨架 + 版本守卫（rc 拦截）+ launcher + FORGE 两 driver 迁移。**v1.3.6 补全**：runCordisAgent 对照正式版 API 重写 + 剩余调用点（dag-runner/composer/loop/node-executor）迁移 |
| **DSH 反向插件适配（DeepSeek Harness 启发）** | 把 sofagent @public API 包装成 Cordis **plugin 家族**（audit/rollback/inject/ontology/gate 五个独立插件，2026-08-16 单点改家族），反向暴露给 DSH 生态——依赖链：v1.3.6 ExecutionBackend 接口 → v1.3.9 API 分级 @public → **v1.4.0 插件包装**（2026-08-14 明确）。**v1.3.5 已先行 MCP 互通**（DSH mcp-client 挂 sofagent-mcp 即调 52 tools——插件婚姻前的先牵手，2026-08-15） |
| **DSH 可靠调度插件（daemon 差异化插槽 · 2026-08-15 新增）** | DSH schedule 三硬局限（无 cron / session 必须 live / 错过不补）= sofagent daemon 的生态位——把 daemon inspector 巡检能力以 DSH 插件形态提供（可靠调度 + 补偿执行 + 离线运行）+ **jobs 互操作（2026-08-16 补充）：daemon 巡检注册为 DSH job（长任务托管/进度/终止统一），反方向 DSH job 完成通知走 sofagent 审批队列——两边任务生命周期互相可见**。**✅ 已并入 `cordis-plugin-daemon`（v1.4.0，2026-08-16 落位）** |
| **DSH 反馈信号消费（2026-08-16 新增）** | DSH 消息级赞/踩 sidecar（版本化写入、仅认 append-origin 非空 assistant 消息）→ sofagent v1.3.4 评估三步（harvest→jury→promote）的 jury 环节直接把用户赞/踩当裁决信号——**用户的拇指就是评估者**。**✅ 已并入 `cordis-plugin-evolve`（v1.4.0，2026-08-16 落位：赞/踩 = 进化信号源之一）** |
| **DSH Ontology + FDE 方法论 plugin（2026-08-16 新增）** | DSH 生态**语义层真空**：ontology（entity/concept/relations + entity-store/merge-engine）注册成 tools（`ontology_define/query/validate`）给多 Agent 协作共享语义底座（SHACL 形状约束=协同治理层，见 ARCHITECTURE §七锚点）；FDE 方法论（五要素访谈/三问判定/量化四字段）包装成 `fde_interview/classify/quantify` tools。**workflow 不做 plugin**（ctx.workflowEngine 是生态主人地盘）——走 v1.3.6 已预留的格式互转。量化只带口述时薪框架，薪酬基准属 商业模型层 不进开源。**✅ 已排 v1.4.0**（ontology 并入 `cordis-plugin-ontology`，FDE 方法论并入 `cordis-plugin-fde`，2026-08-16 落位） |
| **DSH 训练控制面 plugin（2026-08-16 新增 · 深水区终局）** | v1.4.x 训练引擎的控制面 tools（`train_submit/status/budget_check`）天然 plugin 形态（DSH jobs 托管长任务互补）；执行面/GPU/商业模型层 训练资产**绝不进 plugin**（§3.6 归属拍板）。终局拼图：Trajectory 采集（v1.3.6）+ 训练引擎（v1.4.x）+ plugin 包装 = **DSH Agent 用自己的执行轨迹训练自己**（Cordis 论文指向但 DSH 未交付的自进化 Harness）。**远期方向：v1.4.x 尾段或 v2.x，引擎本体稳定后再评估** |
| **ACS YAML 策略引擎（Microsoft AGT 启发）** | 现有 ruleset 是 JSON，AGT 的 ACS 用 YAML + OPA Rego + Cedar 三引擎——策略更人类可读，需评估兼容性 |
| **Shadow AI Discovery（Microsoft AGT 启发）** | 扫描进程/配置/仓库发现未注册「影子 agent」——审计盲区，与 v1.3.7 行为监控互补 |
| **RL 训练治理（Microsoft AGT Agent Lightning 启发）** | 训练期间策略违规惩罚——与 v1.4.1 训练引擎预算控制同向 |
| **OWASP Agentic Top 10 全覆盖路线（Microsoft AGT 启发）** | v1.3.7 补 ASI08+ASI10，v1.3.9 补 ASI01+ASI04，远期 10/10 全覆盖对齐 AGT |
| **能力缺口地图（GitHub 式协作底座启发 · 2026-08-16 新增）** | 从「能力地图」（ontology 有什么能力）进化到「能力缺口地图」（哪里需要 PR）——人+AI 想给别人的树提 PR，先得知道「哪棵树需要什么、哪里有空缺」，issue 化的贡献机会。依赖 worklog（v1.3.9）+ 能力地图（ontology lifecycle v1.3.7）成熟后才有土壤，暂占概念位 |
| **fork 语义（GitHub 式协作底座启发 · 2026-08-16 新增）** | GitHub 的 fork 在企业语境 = 部门复制别人的能力改造成自己的版本（复制 + 改造 + 独立演进），比「复用」更激进。当前能力公地是「调用」（复用），无「fork」（分叉演进）。依赖能力公地（v1.3.4）成熟后评估，暂占概念位 |
| **商业平台 平台接口预留（2026-08-17 新增 · 商业产品层前置）** | 商业平台（商业 SaaS 产品层，`商业仓库/商业平台/商业平台.md`）需要 sofagent 预留的平台接口，提前定义、**逐条对应 v1.4.x 实际排期**：**G1 workflow 模板导出/导入 + 血缘追踪**（MCP `workflow_export`/`workflow_import`，挂靠 v1.4.4 模型注册器同类机制扩展——workflow 模板同样可注册，模板元数据加血缘字段）· **G2 能力缺口查询**（MCP `workflow_gaps`——读 workflow 状态找「缺人/缺能力的节点」，悬赏式 PR 的发现接口，**v1.4.7 承载**：依赖 worklog v1.3.9 + ontology lifecycle v1.3.7）· **G3 计量数据暴露**（**✅ v1.4.0 `cost_query` 已覆盖**——成本审计数据口，商业平台 credit 成本轨直接消费，无需新增）· **G4 绩效数据导出**（MCP `contribution_query`——读审计 + decision-log 算每人/每 workflow 贡献度，DKP 价值轨数据源，**v1.4.7 承载**：对齐 v1.4.5 量化四字段）· **G5 MCP 连接器注册/发现**（挂靠 v1.4.2「DB/API 数据源」扩展——企业存量系统 OA/CRM/ERP 经 MCP 接入，先打通「接入」，连接器注册/发现随 SaaS 需要再补）· **G6 节点级可见性元数据**（workflow schema 加 `visibility` 字段 open/private/result-only——任务面/数据面分离，审阅门按此执行，**v1.4.7 承载**）· **G7 多租户抽象层**（引擎层数据路径 `data/<tenant>/` 命名空间 + 审计/日志按租户隔离，**v1.4.7 v0**：数据路径抽象，隔离策略 v2.x 细化） |

> 📖 DeerFlow / OpenFDE 方法论印证见 [VALIDATION](./VALIDATION.md)。

> 以下「分层模型架构」为探索方向的核心技术骨架概述。当前版本（v1.3.x）引擎层未涉及，v3.x 才启动。

## 分层模型架构（v3.x 远景概述）

核心驱动力 = **数据主权**（企业数据进 API key 大模型 = 一定被拿去训练）。三层模型 + Harness 路由：云端 32B+ 负责规划推理 → 翻译成标准化指令 → 本地 7B 执行多步 workflow → 本地 0.5B 跑管道层（模板/格式/字段提取）。敏感数据只在本地处理，通用知识才走云端。**引擎层只做模型路由（model-router.ts 已有四档插槽），精调 pipeline 属模型层非开源范围。** 路由层可提前到 v2.x 做（不依赖精调模型），离线 USB 节点是 v3.x-v4.x+ 的工作。完整技术骨架（Mermaid 图 + 选型表 + 实现难度）见 [PHILOSOPHY · 远期演化愿景](./PHILOSOPHY.md#远期演化愿景从内置小模型到自动化企业后训练引擎)。

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
| 第三方证据 | 1 周 | 装完用一周，填 EVIDENCE.md |
| 安全审计 | 不限 | 给 SECURITY.md 较真 |
| 企业场景反馈 | 30 min | 你们团队怎么用 Agent？直接开 Issue |

> [CONTRIBUTING.md](../CONTRIBUTING.md)

---

## 历史架构演进

编排引擎从 ao → DeepAgents → LangGraph 的升级史（v1.2.0 起 FORGE loop 已完全弃用 deepagents，改用 createReactAgent；历史编排引擎的 DeepAgents 调度原型见 v1.1.8 changelog）、Ontology 从实体关联到本体结构的渐进构建、外部框架对标（Palantir/gbrain/WeKnora/Runta）、Loop Engineering 全栈对照等详见 **[ARCHITECTURE.md](./ARCHITECTURE.md)** 的「行业印证」+「编排引擎」+「Ontology 本体结构」章节，以及各版本 **[开发日志](./changelog/)**。

> 📖 多设备同步方案见 [多设备同步指南](./guides/multi-device-sync.md)。

> 📖 以上三个 loop-engineering 启发方向（FDE 节点注册表 / Worktree 隔离 / 理解债务）已并入上方 [探索方向](#探索方向) 表，来源链接见 [cobusgreyling/loop-engineering](https://github.com/cobusgreyling/loop-engineering)（MIT 开源）。
