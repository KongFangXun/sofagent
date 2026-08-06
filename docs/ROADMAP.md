# 路线图 · Roadmap

> 已经做了什么、未来要去哪、哪些地方需要你的帮助。
> v1.2.7 · 2026-08-05（UTC）· 🔗 激活链 Phase 2 后半（StateGraph 构建）+ 编排引擎增强 + FORGE 三方抽象

产品定位详见 [设计哲学](./PHILOSOPHY.md) 和 [README](../README.md)。

## 现在在哪：v1.2.7（开发完成 · 🔗 激活链 Phase 2 后半（StateGraph 构建）+ 编排引擎增强 + FORGE 三方抽象）

> **v1.2.6 交付内容**：
> **🔗 激活链 Phase 2 前半**：workflow-parser 扩展支持 `agent: enterprise` 类型 + registry.ts 的 SubAgentDefinition 增加 hitl/hitlConfig/knowledgeDomain 字段 + 2A workflow.yml 格式对齐 + 2B SOFAGENT_LLM env 打通。
> **🔌 MCP 交付链路修补**：4 个 MCP tool——`daemon_status`（只读状态查询）/ `list_agents` / `list_concepts` / `hitl_resolve`（MCP 覆盖度审计缺口补全）。
> **📄 文档死链清零**：ROADMAP/LIMITATIONS 搬家后 74 处死链修复（scenario 164 门禁前置）。
> **README Deployment Sizing**：企业 IT 三档规格表格。
> 原储备项（support-bundle / doctor 增强 / One-Line Setup）移至 v1.2.7。
> v1.2.5 已交付激活链 Phase 1（ACTIVATE），v1.2.6 完成Phase 2（ORCHESTRATE）准备期。
>
> 📖 [v1.2.6 开发日志](./changelog/v1.2/v1.2.6.md) · 完整版本历史见 [CHANGELOG](../CHANGELOG.md) 和 [迭代历程](#迭代历程)

> ✅ **企业采购阻塞项 · Webhook 推送已于 v1.2.1 交付**：v1.1.6 接通 webhook **PASS/WARN/FAIL 三态推送**（本地 agent 自测），v1.2.1 补齐企业协同平台（飞书/钉钉/企微）完整 Webhook 推送能力（见 SECURITY.md「审计结果推送」）。采购阻塞项已解除。

---

## 迭代历程

完整版本历史见 [CHANGELOG](../CHANGELOG.md)。v0.x 为实验/测试版，v1.0.0 起为正式版。

| 版本 | 核心交付 |
|------|------|
| **v1.2.5** | 激活链 Phase 1 ACTIVATE（activate.ts + MCP activate_workflow tool）+ 审计引擎加固（A20-A23 + 结构性地基加固 + 检测盲区补全）+ daemon 可靠性（推送重试 + plist 校验 + 健康自检）+ 多设备前置（Agent 身份码 + 跨设备审计聚合 + 协议中立） |
| **v1.2.4** | 知识进化（分层巡检 L1/L2/L3 + skillopt 自动触发 + 失败清单 + 联邦蒸馏 + 进化引擎接通 eval）+ Dashboard 历史趋势 + Skill × MCP 集成（S1-S5）+ FDE 人机分离（README/GUIDE/SKILL.md 升格 + 子 Skill 分包 01-05）+ FORGE stream 迁移 + LESSONS 方法论 |
| **v1.2.3** | Dashboard 产品化（控制图波次渲染 + 用户可读状态映射 + Fresh-Eyes 审查进度 + Workspace 变更摘要）+ 编排隔离底座（git worktree 三原语 + 审计合并卡关）+ Fresh-Eyes-Loop 移至阶段一 + v1.2.2 BugFix 31 项 + 裁决解析健壮性加固 |
| **v1.2.2** | 数据主权审计（4 维追踪 + HMAC 链 + 日/周/月报告）+ 混合模型路由（ModelRouter + Ollama 接入）+ FDE Dashboard（终端三栏）+ Graph Engine（Planner + 降级链 + decide/execute 分层）+ 异步 HITL + Skill 升级三策略 + v1.2.1 BugFix 38 项 |
| **v1.2.1** | 数据目录重构（.sofagent/ → data/）+ Webhook 推送 + SubAgent 可见性 L2 + custom/ 闭环 |
| **v1.2.0** | 物理结构大重构（/sofagent/→/engine/ + SKILL 收敛 + 发版工具链拆散 + install.sh 提根 + rules 独立包） |
| **v1.1.9** | 产品叙事收敛（FDE Agent）+ USB 完整运行时 + daemon A/B 自动调度器 + 控制图状态抽取 + v1.1.8 BugFix 42 项 |
| **v1.1.8** | 安全层加密配对 + 联邦查询 + Prompt 注入防护补齐 + 编排引擎串行版（DAG 并行规划在 v1.3.1） |
| **v1.1.7** | Dream Cycle 6 阶段 + sensitivity + 知识健康巡检 + 知识可观测性：gbrain 精简 pipeline 替换旧脚本 + knowledge 敏感度分级（缺省 internal）+ knowledge-health 5 项检查（@weekly）+ `knowledge status` 聚合命令 |
| **v1.1.6** | BugFix 21 项 + LLM Wiki 3 层分层 + conflict-check：v1.1.5 遗留全数修复 + Ledger-Views-Policy 显式化（详见 [ARCHITECTURE §文件系统架构](./ARCHITECTURE.md#文件系统架构)）+ daemon 知识健康巡检（矛盾/孤儿/死链） |

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

设备端形态：安装时自动带 OpenClaw，审计结果通过 MCP server 推到企业协同平台。**数据主权在设备**——所有记忆、日志、决策记录永不离开本地。

> 以下是方向落地为版本的具体拆解。v3.x 长期架构骨架见下方「探索方向」。

---

## 版本规划

> 以下带状态版本表为权威源；各版本详细子节见下方 `###`。

### 规划版本

> 🔗 **激活链进度框架**：v1.2.5-v1.3.0 按激活链四阶段推进（ACTIVATE→ORCHESTRATE→EXECUTE→SUSTAIN），每个版本对应一个阶段或阶段内子步骤。详见 [激活链设计文档](./guides/fde-activation-chain.md)。

> 🔴 **阻塞项占位纪律**：任何 🔴 采购 / 合规阻塞项必须在下表占据一个**明确的版本单元格**（标注具体版本号，如 v1.2.1），不得仅写在散文备注里。散文式「建议优先排期」会悄然过时——v1.2.0 时 Webhook 阻塞项就曾因只写在备注、未落版本格，导致建议过期却仍未排期。教训：**阻塞项 = 版本格，不是建议**。

| 版本 | 状态 | 核心交付 | 日志 |
|------|:--:|------|:--:|
| **v1.2.x** | 📋 规划中 | 完整多设备协同——**L2 团队协作协议**：共享态/意图广播/触发反应/冲突消解/反馈放大五大机制，从单人约束到团队协作；**L3 组织能力市场**：Skill/Agent/流程在企业内发布→发现→调用→评价，高频高价值自然胜出。+ Agent 独立身份码 + 跨设备审计轨迹聚合 + 场景驱动权限体系 + 代理网关硬边界（✅ 其中轻量三项已在 v1.2.5 提前交付：Agent 身份码 + KYA 轻量版、跨设备审计聚合轻量版、协议中立审计声明）。**🔮 探索**：路由器式配网（边缘设备 WiFi 热点 + 手机端配置网页，仅用于初始配置，配置完成后回归纯 LUI）+ **协议中立**（审计层只走 MCP 等开放协议和 git diff/JSONL/Markdown 开放格式，不为任何单一平台写专属集成——不绑定平台，平台不绑定审计） + **编排隔离底座（git worktree 轻量形态）+ 波次拓扑可视化（控制图视角，随 dashboard 交付，详见子里程碑）** | — |

#### v1.2.x 里程碑拆分

> 9 版本全部定稿（v1.2.1-v1.2.9；v1.2.6 已承接激活链 Phase 2 前半 + MCP 交付链路修补 + 文档死链清零 + Deployment Sizing，原储备项移至 v1.2.7）。

| 版本 | 主题 | 核心交付 |
|------|------|------|
| **v1.2.1** | **数据目录重构 + ✅ Webhook + SubAgent 可见性 L2（已发版）** | **数据目录重构**：`.sofagent/` 669 个运行时数据文件统一迁移到 `data/` 可见目录——用户能直接打开、Dashboard 直接消费、备份只需拷贝一个目录（v1.2.2 Dashboard 前置基础设施）· ✅ **Webhook 推送完整能力（飞书/钉钉/企微）— 采购阻塞项已解除** · **SubAgent 可见性 L2**（ProgressMiddleware：worker 内部工具调用序列 + LLM 心跳 → sub-progress jsonl，Dashboard 实时面板数据前置）· custom/ README 重写（加载链声明 + 安装保护逻辑移至 v1.2.2）· 数据层清理（IDENTITY.md + eval.md 删除 + 模板标注 + daemon-health.json）（详见 [开发日志](./changelog/v1.2/v1.2.1.md)）|
| **v1.2.2** | **数据主权 + 路由 + Dashboard（数据主权 + SubAgent 实时面板）** | ① 数据主权审计追踪（4 维审计日志 + 年/月目录 + 每日/周/月报告 + 四路分发闭环）② 混合模型路由层（ModelRouter 敏感度×任务类型路由 + Ollama 接入）③ FDE Dashboard 第一版（数据主权视图 + **SubAgent 实时面板 L3**：消费 v1.2.1 L2 数据，双 agent 状态卡 + 工具调用流 + 成本曲线 + 心跳检测）④ Skill 分层升级三策略 install.sh 实现（详见 [开发日志](./changelog/v1.2/v1.2.2.md)）|
| **v1.2.3** | **Dashboard 产品化 + 编排隔离底座 + Fresh-Eyes 流程化** | ① **Fresh-Eyes Dashboard 集成**（fresh-eyes-driver 的 A/B sub agent 写入 sub-progress-*.jsonl 至 `data/forge-runs/`，Dashboard `--watch` 模式实时显示 loop 审查进度——每轮发现数、当前审查文件、A/B 双盲状态）② Dashboard 波次拓扑可视化（bash + jq ASCII art 渲染控制图：节点/边/波次分层实时状态，延续 v1.2.2 零依赖路线）③ 编排隔离底座（git worktree 四子里程碑：隔离原语→审计合并卡关→冲突消解→filesValue 边界）④ Fresh-Eyes-Loop 移至阶段一（releasing.md SOP 重组——新版本第一步跑 fresh-eyes-loop 审查上版本，提前自 v1.2.4）⑤ Workspace 变更摘要（每次运行后记录创建/修改/删除文件清单 → Dashboard 消费，提前自 v1.2.8）⑥ Dashboard 用户可读性（技术状态→用户可读映射 + --technical 切回）（详见 [开发日志](./changelog/v1.2/v1.2.3.md)）|
| **v1.2.4** | **知识进化 + 知识健康** | ① 分层巡检 L1/L2/L3（@daily/@weekly/@monthly 三级 + 读写回路对标）② skillopt 自动触发（失败模式 3 次自动优化）③ 失败清单自动优化（负面样本为主要燃料）④ conflict-check CLI + 联邦蒸馏 ⑤ **进化引擎接通 eval**（think-generator 读 eval failures → 写 think.md，前置 eval 补全在 v1.2.1 P0b）⑥ **Dashboard 历史趋势 + 任务统计**（v1.2.2 每日快照 → 周对比/月趋势/任务成功率/TOP5 违规，v1.2.4 补齐）⑦ **Skill × MCP 集成**（P3 独立开发线：S1 Skill 引用 MCP 工具 / S2 新增 6 tools / S3 Skill 精简 / S4 数据变更审计 D1-D5 / S5 审计结果汇报 + 品牌可见化五层兜底）⑧ **FDE 人机分离 + Skill 分包**（P4 独立开发线：README 门面 / GUIDE 学习手册 / SKILL/SKILL.md 升格唯一主入口 / 子 Skill 分包 01-05 / 删除 FDE/SKILL.md+FDE.md+quick-start.md，发布源 ./FDE→./SKILL）（Fresh-Eyes-Loop 移至阶段一已提前至 v1.2.3）（详见 [开发日志](./changelog/v1.2/v1.2.4.md)）|
| **v1.2.5** | **🔗 激活链 Phase 1 + 🛡️ 审计引擎加固 + 🔧 daemon 可靠性 + 多设备前置** | **🔗 激活链 Phase 1 ACTIVATE**——新增 `activate.ts`，读 FDE 交付物 → 注册企业 SubAgent → 写入 `.sofagent/subagents/*.yml`（registry.ts 动态注册机制已有，缺的是往里写企业 Agent 的自动化流程）+ MCP `activate_workflow` tool。**🛡️ 审计引擎加固**——AUDIT_PRIORITY 规则归属调整（层名 critical/warning/crutch/extended 不变，只调规则在各层的分配：A19 从 critical 移到 warning、A10 从 warning 提升到 critical、A6 从 warning 移到 crutch）+ 新增 A20 不泄外联·A21 不植后门·A22 不越权限·A23 不逃路径四条安全规则（填补网络外传/持久化/提权/路径穿越四大盲区）+ E3 并入 A11 精简规则数 + A2 编码绕过修复 + A3 中文 commit 误报修复 + ToolGate/A2 正则统一 + **结构性地基加固**（BASELINE_RULE_KEYS 扩展至 9 条：安全红线不可 config 关闭 + critical 层全量收集：多条同时 FAIL 全部报告 + 审计引擎源码自保护：A16 保护 rules/ 目录）+ **检测盲区补全**（A10 postinstall 脚本注入检测 + A9 动态执行模式告警 + shared/patterns.ts 收敛为全规则共享库）。**🔧 daemon 可靠性**——推送重试上限（maxRetries=3 + 指数退避）+ plist 路径校验（existsSync 防假成功）+ 健康自检（daemon-health.json + 5min heartbeat）+ im-outbox 生命周期（成功删除 / 失败移 failed/ / 7 天清理）。**多设备前置（轻量）**：① Agent 独立身份码 + KYC 轻量版 ② 跨设备审计轨迹聚合 ③ 协议中立审计。⚠️ **原多设备 L2/L3 大项已拆**：L2 协作协议 → v1.3.3、L3 能力市场 → v1.3.4、权限体系+代理网关 → v1.4.0、归因引擎 → v2.x（详见 [开发日志](./changelog/v1.2/v1.2.5.md) + [激活链设计](./guides/fde-activation-chain.md)）|
| **v1.2.6** | **🔗 激活链 Phase 2 前半 + 🔌 MCP 交付链路修补 + 📄 文档死链清零** | **🔗 激活链 Phase 2 前半**：workflow-parser 扩展支持 `agent: enterprise` 类型 + registry.ts 的 SubAgentDefinition 增加 hitl/hitlConfig/knowledgeDomain 字段——为 v1.2.7 StateGraph 构建打基础。**🔌 MCP 交付链路修补**：4 个 MCP tool（`daemon_status`/`list_agents`/`list_concepts`/`hitl_resolve`，覆盖度审计缺口补全）。**📄 文档死链清零**：ROADMAP/LIMITATIONS 搬家后 74 处死链修复（scenario 164 门禁前置）。**README Deployment Sizing**：企业 IT 三档规格表格。原储备项（support-bundle/doctor 增强/One-Line Setup）移至 v1.2.7（详见 [开发日志](./changelog/v1.2/v1.2.6.md)）|
| **v1.2.7** | **编排引擎增强（DeerFlow 启发）+ 🔗 激活链 Phase 2 后半** | ① **Session Goals**（`/goal`）② **手动上下文压缩**（`/compact`）③ **Skill 渐进式加载** ④ **`--doctor` 可操作修复提示** ⑤ **FORGE driver 三方抽象** ⑥ **🔗 激活链 Phase 2 后半**——新增 `enterprise-graph.ts` + `composeEnterpriseWorkflow()`：从 FDE 交付物构建企业专属 LangGraph StateGraph（不调 LLM 拆任务，直接用 workflow.yml）+ 数据流三层设计（State 实时 + entity 持久化 + 双写）⑦ **`--support-bundle`**（一键生成 issue 摘要 + 证据 zip）⑧ **One-Line Agent Setup**（curl\|bash 一行安装入口）⑨ **Agent Mailbox**（SubAgent 间异步消息，从 v1.2.5 P6b 拆入）（详见 [开发日志](./changelog/v1.2/v1.2.7.md)）|
| **v1.2.8** | **记忆分层 + 定时任务（DeerFlow 启发）+ 🔗 激活链 Phase 3 前半 + 🚪 release-gate-loop F 修复者 + 🔍 FORGE 全 loop 接入 audit** | ① **记忆事实级分层** ② **Scheduled Tasks MVP**（cron+once / 暂停/恢复/触发/历史/删除）③ **ToolOutputBudget 中间件化** ④ **🔗 激活链 Phase 3 前半**——dag-runner 扩展支持企业 Agent + 新增 `node-executor.ts` + `run-enterprise` CLI 子命令 ⑤ **🚪 release-gate-loop 新增 F（修复者）角色**——V 验证 FAIL 后触发 F 读 verdict 报告→定位根因→改代码→跑 audit→回到 V 重验，形成验-改循环直到 PASS（最大 3 轮），release-gate 从"线性 5 步跑完即出"升级为真正的闭环 ⑥ **🔍 FORGE 全 loop 接入 audit（dogfooding 铁律）**——fresh-eyes-loop 的 b-fix 步骤 + release-gate-loop 的 F 步骤，改完代码必须跑 `sofagent-audit --diff`，audit 不通过打回重修，不进下一环节。sofagent 卖点是"审计每次变更"，自己的 loop 改代码也必须走自己的 audit（详见 [开发日志](./changelog/v1.2/v1.2.8.md)）|
| **v1.2.9** | **🔒 弹性预留 + 🔗 激活链 Phase 3 后半** | **🔗 激活链 Phase 3 后半**：① HITL 中断处理（`hitl-handler.ts`——⚡ 节点执行前暂停等人确认）② 每节点执行后自动审计 + think.md 回溯 ③ 异常处理（exceptions 队列 + 重试/跳过策略）。紧急修复 / 探索项按需取用（详见 [开发日志](./changelog/v1.2/v1.2.9.md)）|
| **v1.3.0** | 📋 规划中 | **运行时审计最小闭环 + 🔗 激活链 Phase 4 收尾（SUSTAIN）**：① wrapToolCall middleware 包 createReactAgent ② engine/rules 3 条 tool-gate 规则升级为运行时拦截 + 审计日志 ③ 危险操作前人工批准钩子 ④ 复用 FORGE 已跑 createReactAgent ⑤ 审计日志按 git 仓库隔离 ⑥ 决策审计 Judgment Unit（emitDecision + kind-wise back）⑦ **🔗 激活链收尾**：全链路验证（activate→compose→run→HITL→audit→sustain）+ wrapToolCall 自动覆盖企业 Agent + FDE SKILL.md 新增 activate 引导 ⑧ **list_rules** MCP tool（tool-gate 规则透明化，覆盖度审计缺口补全）（详见 [开发日志](./changelog/v1.3/v1.3.0.md) + [激活链设计](./guides/fde-activation-chain.md)）|
| **v1.3.1** | 📋 规划中 | **Ontology 本体结构 + 国标对齐 + 并行编排 + Agent 身份码 + 跨设备审计聚合 + 🚀 Onboard Agent L1**：① 本体结构——将 Ontology 统一层从「描述事实如何被理解」升级为「可运行推理底座」（对齐 LLM + Harness 规则 A1-A11、A14-A19 + E1-E4（共 21 条，v1.2.5 起含 A20-A23 共 24 条，E3 并入 A11）+ 记忆 Ledger-Views-Policy）；② 三层落地法（统一元模型 → 企业通用 Ontology 规范：命名/版本/验证 → 与 Agent 平台打通）；③ 国标对齐 GB/T 48000.3-2026《标准数字化 第3部分:本体建模要求》作为审计/Ontology 层合规参考基线；④ **并行编排**——使用 LangGraph 原生 DAG 并行能力（StateGraph + Send API），每波次经审计节点（★Reality Anchor，真实 git diff 作 guard edge）卡关，并行 SubAgent 文件隔离由 v1.2.x 的 git worktree 隔离底座提供；恢复时**幂等性保证**（任务 ID 查重，避免 SubAgent 恢复后重复执行外部动作如重复创建 PR）；⑤ **Ontology CRUD 补全**——`update_entity` / `delete_entity` / `delete_concept` 三个 MCP tool（覆盖度审计缺口补全，删除类强制人审）；⑥ **Agent 独立身份码 + KYA 完整版**（Ed25519 签发/验证，绑定委托人/约束/责任，身份与审计双签名）+ 跨设备审计轨迹聚合（按 agentId 合并完整轨迹，复用安全联邦加密通道）+ MCP `agent_identity` + `audit_trail` tool；⑦ **🚀 Onboard Agent L1（FORGE 产品化第一刀 · 工程判定层）**：企业 AI 节点 activate 后自动跑一轮 → crash/error 判定 → 报错人工修 → 再跑（半自动调试循环，L2-L5 在 v1.3.2）。**这是 L2/L3 的地基**——没有身份就没有"谁在协作"（原 v1.3.2 身份码+审计聚合拆入本版）（详见 [开发日志](./changelog/v1.3/v1.3.1.md)）|
| **v1.3.2** | 📋 规划中 | **🚀 Onboard Agent 完整版（L2-L5 · FORGE 产品化第二刀）**：① **L2 语义判定**——基于 v1.3.1 Ontology 定义预期输出 → 对比器判"跑出来的对不对"（Ontology 作判据，本版前置）② **L3 自动定位**——不对时用 LLM 实时推理定位错误源（skill/ontology/prompt 哪层出问题）③ **L4 自动修复**——定位后自动改 + 审计引擎 git diff 硬证据兜底 ④ **L5 循环收敛**——回归测试 + 连续 N 轮 PASS 才停，防发散。与 v1.3.1 L1（工程判定）组成完整五层 Onboard Agent（详见 [开发日志](./changelog/v1.3/v1.3.2.md)）|
| **v1.3.3** | 📋 规划中 | **L2 团队协作协议（五大机制）+ ✨ Refine Agent 完整版**：① **L2 协作协议**——共享态（CRDT 合并）/ 意图广播 / 触发反应 / 冲突消解（trust 优先）/ 反馈放大（团队级 think.md 沉淀）+ 团队状态管理（team.yml + 团队会话持久化 + 团队审计）；② **✨ Refine Agent**——让 AI 节点从「能用」到「好用」：复用 Onboard Agent 的循环引擎（driver/judge/converge），判据从 Ontology（对不对）换成质量规则集（好不好），五层一次交付（L1 质量探测 → L2 质量判定 → L3 定位 → L4 修复 → L5 收敛）。原型 = FORGE fresh-eyes-loop。与团队协作同版交付：Refine 的质量规则集天然适合团队级反馈放大（一个 Agent 学到的质量经验广播给全队）（原 v1.2.5 拆入协作协议，依赖 v1.3.1 身份码 + v1.3.2 Onboard 循环引擎）（详见 [开发日志](./changelog/v1.3/v1.3.3.md)）|
| **v1.3.4** | 📋 规划中 | **L3 组织能力市场（发布→发现→调用→评价）**：Skill / Agent / 流程打包发布（market/ 目录）+ 目录检索（复用 search_knowledge）+ 调用挂载（复用 registry）+ 评分聚合（评分 × 调用量加权自然选择）+ 全程审计。高频高价值能力自然胜出（原 v1.2.5 拆入，依赖 v1.3.3 L2 协议）（详见 [开发日志](./changelog/v1.3/v1.3.4.md)）|
| **v1.3.5** | 📋 规划中 | **自进化与运维闭环（MCP 覆盖度审计缺口补全）**：4 个 MCP tool——`run_ab_test` / `promote_ab`（ab-test 自进化闭环，晋升强制人审）+ `snapshot_list` / `snapshot_restore`（daemon 运维快照，恢复强制人审）（详见 [开发日志](./changelog/v1.3/v1.3.5.md)）|
| **v1.4.0** | 📋 规划中 | **SubAgent 完整沙箱执行环境 + 场景驱动权限体系 + 代理网关硬边界 + 数据静态加密**：① **沙箱**——虚拟文件系统隔离（FilesystemBackend + virtualMode）、网络出站白名单、**工具调用中介（前置 allow/deny，非仅审计追踪）**、**虚拟 key 凭证边界注入**、AsyncSubAgent（远程 Agent Protocol 服务端）+ 真·实时 A/B 双跑；② **场景驱动权限体系**（原 v1.2.5 拆入）——权限按"场景"（任务类型 × 数据域 × 动作风险等级）动态判定，判定链 = 身份（v1.3.1）→ 场景匹配 → 风险等级 → 放行，含团队场景权限 + 市场调用权限 + 动态提权到期回收；③ **代理网关硬边界**（原 v1.2.5 拆入）——SubAgent 所有外部请求经网关（唯一出入口），allow/deny + 风险分级 + 超阈值人工批准；④ **数据静态加密（age）**——`~/.sofagent/data/` 审计数据 age 加密落盘（原计划 v1.3.0，随安全加固批次后移），解决明文存储合规短板。审计从「事后」扩展到「运行时」（**范围限定 SubAgent，主 Agent 仍事后审计**）。**v1.4.x backlog**：`eval_history` MCP tool（eval 包——查询历史评估报告，P2 锦上添花，视本版容量顺带或砍，不单独建版本）（详见 [开发日志](./changelog/v1.4/v1.4.0.md)）|

#### v1.3.x 里程碑拆分

> 运行时审计最小闭环（v1.3.0）是 v1.3.x 第一刀：不替换 harness，只在 createReactAgent 上加 middleware 层。完整运行时审计（策略强制 + 沙箱 + 状态化拦截）仍留 v1.4.0；meta-harness 多 harness 编排已前移到 v1.5.0（承接 v1.4.0 沙箱底座）。

| 版本 | 主题 | 核心交付 |
|------|------|------|
| **v1.3.0** | **运行时审计最小闭环（LangGraph middleware）** | ① wrapToolCall middleware 包 createReactAgent ② engine/rules 3 条 tool-gate 规则升级为运行时拦截 + 审计日志 ③ 危险操作前人工批准钩子 ④ 复用 FORGE 已跑 createReactAgent ⑤ 审计日志按 git 仓库隔离 ⑥ **list_rules** MCP tool（tool-gate 规则透明化，覆盖度审计缺口补全）（详见 [开发日志](./changelog/v1.3/v1.3.0.md)）|
| **v1.3.1** | **Ontology + 并行编排 + 身份码 + Onboard L1** | 见上方主表：Ontology 本体结构 + GB/T 48000.3-2026 国标对齐 + DAG 波次并行 + Agent 身份码（Ed25519）+ 跨设备审计聚合 + Onboard Agent L1（工程判定）|
| **v1.3.2** | **🚀 Onboard Agent 完整版（L2-L5）** | L2 语义判定（Ontology 判据）+ L3 自动定位（LLM 推理）+ L4 自动修复（审计兜底）+ L5 循环收敛（回归+连续 PASS）（详见 [开发日志](./changelog/v1.3/v1.3.2.md)）|
| **v1.3.3** | **L2 团队协作协议 + ✨ Refine Agent** | 协作五大机制 + Refine Agent 完整版（质量规则集判据，复用 Onboard 循环引擎）（详见 [开发日志](./changelog/v1.3/v1.3.3.md)）|
| **v1.3.4** | **L3 组织能力市场** | 发布→发现→调用→评价 + 评分聚合自然选择 + 全程审计（详见 [开发日志](./changelog/v1.3/v1.3.4.md)）|
| **v1.3.5** | **自进化与运维闭环（MCP 覆盖度审计缺口补全）** | `run_ab_test` / `promote_ab`（晋升强制人审）+ `snapshot_list` / `snapshot_restore`（恢复强制人审）四个 MCP tool（详见 [开发日志](./changelog/v1.3/v1.3.5.md)）|
| **v1.3.6-v1.3.9** | 🔒 弹性预留 | 紧急修复 / 探索项按需取用（智能 E2E 测试 Agent、规则文件独立只读焊死门、Agent 执行层实时治理等 v1.3+ 探索项可在此落位）|

### v1.2.x Graph Engine 进化路线

> 编排引擎直接使用 LangGraph 原生能力（StateGraph + createReactAgent），不自建 DAG 调度。审计节点（★Reality Anchor）作为 guard edge 嵌入 LangGraph 工作流——这是 sofagent 在 Graph Engineering 中的唯一定位。理论框架详见 [VALIDATION](./VALIDATION.md) 和 [ARCHITECTURE §Graph Engineering 视角](./ARCHITECTURE.md#graph-engineering-视角控制图--stategraph)。

**sofagent 已经在做 Graph Engineering**——`engine/orchestrator/src/loop/graph.ts` 用 LangGraph StateGraph 实现 `START→engineer→audit→reviewer→human_confirm→END`，`audit` 节点即 ★Reality Anchor（真实 git diff 24 条规则作 guard edge），`FileCheckpointer` 快照到 `.sofagent/checkpoint/` 即可审计状态文件。数据图天然对应蓄水池（知识库）+ 市政规划（Ontology）。后续迭代用 Graph Engineering 术语框定「并行编排」与「可视化」，不引入新能力。

| 版本 | Graph Engine 交付 | 状态 |
|------|---------|:--:|
| **v1.2.2** | Planner 节点（任务分解）+ 降级路由链（retry→降级→标记→人工）+ engineer-decide/execute 分层（LLM 层 + 代码层）+ Dashboard Graph Engine 状态卡片 | ✅ 已交付 |
| **v1.2.3** | 并行子图执行（worktree 隔离 + 多 engineer 并发）+ Dashboard ASCII 控制图（节点/边/波次分层）+ Fresh-Eyes 进度可视化 | ✅ 已交付 |
| **v1.3.1** | 控制图多循环 DAG 波次并行——使用 LangGraph 原生 DAG 并行能力（StateGraph + Send API），每波次经 audit 节点（★Reality Anchor）卡关 | 📋 规划中 |

> 📝 **v1.2.5-v1.2.9 聚焦激活链**（ACTIVATE→ORCHESTRATE→EXECUTE→SUSTAIN），不含 Graph Engine 新增交付。v1.2.4 的 Graph Engine Checker 扩展（P2b）因知识进化主线优先而降级，相关能力归入 v1.3.1。

> 🔴 **落地纪律**：上表是「用 Graph Engineering 术语框定已有/规划能力」，不新增能力范围。理论基础：Carlos E. Perez·[From Loop Engineering to Graph Engineering](https://engineering.zooz.com/intuitionmachine/from-loop-engineering-to-graph-engineering-d3ebeb08511c)（单闭环四类失效→Graph 拓扑解法+grounding）。

### v1.2.0 — 记忆/知识层升级（本体结构铺垫）

> 💡 **v1.2.0 是 v1.2.x 主题线的第一刀**：把 gbrain / LLM Wiki / Palantir 操作型本体论的外部验证吸收为「方法」（分阶段记忆整合、分层巡检、读写回路对标），不吸收其「定位」（不变成 agent runtime，不走集中式 Ontology OS）。详细 scope / 交付拆分（P0/P1/P2）/ 边界见 [v1.2.0 开发日志](./changelog/v1.2/v1.2.0.md)。

🛡️ **差异化铁律（对标时必守）**：gbrain 是「agent 自己的脑」，Palantir Ontology 是「企业级操作层」，sofagent 是「约束中间件」（数据主权 + 第三方独立 + MIT 可审计）。吸收方法，不吸收定位；不建自动化 diff 任务，发版前由架构评审顺带 diff 一次 gbrain 的 dream-cycle / skillopt / Palantir 的 OAG 进展，结论进当版 changelog「行业对标」小节。

### 多设备协同（规划中，已拆分至 v1.3.x / v1.4.x）

> 💡 **多 Agent 协同已在 v1.x 完成**：v1.0.3 FDE SubAgent + Audit SubAgent 并存 → v1.0.4 A/B 自动优化双 Agent 对比。**轻量多设备在 v1.1.0 起步**（经验共享 + 权限作用域化 + daemon 主动巡检）。完整版按依赖链拆分：**v1.3.1 身份码+审计聚合 → v1.3.3 L2 协作协议 → v1.3.4 L3 能力市场 → v1.4.0 权限体系+代理网关**（原 v1.2.5 过重拆分，详见各版本开发日志）。

**ATTRIBUTION 归因引擎（v2.x 探索区）**：审计能告诉你 Agent 违规了，但不能告诉你哪次正确的审计干预带来了业务价值。ATTRIBUTION 需要在多设备、多客户、长时间尺度上追踪审计决策→业务指标的因果链。**挂 v2.x 探索区**——依赖 v1.3.1 跨设备审计聚合数据积累（v1.3.4 市场调用数据也可作输入），执行层能力（沙箱/权限/网关）落地后再做分析层。

**失败清单驱动 skillopt（✅ v1.2.4 已实现）**：积累负面样本——每个 Skill 跑失败时记录失败场景 + 原因 + 正确做法，以负面样本为主要燃料驱动优化。"告诉模型什么做法是错的"比"什么是对的"信息量更大。v1.2.4 落地为 `engine/skillopt/src/auto-trigger.ts`（连续 3 次失败自动触发）+ `failure-ledger.ts`（失败清单管理）+ 新建 `optimize()` API。

**KYA 身份确权（v1.2.x 探索）**：a16z 研判非人类身份:人类 = 96:1，急需 KYA（Know Your Agent）——加密签名凭证将 Agent 与委托人/约束/法律责任深度绑定。sofagent 审计引擎（约束 + 审计 + 归属）本质是轻量版 KYA。

**智能 E2E 测试 Agent（v1.3+ 探索）**：笔记① Lantern+Playwright 实测表明，AI 大脑 + Web 自动化执行器 + 本地模型可做到「给高层级目标、零定位代码自主测试」（页面变更免疫、需求泛用、数据不出网）。可演进 sofagent 的 QA / `acceptance-test`——用 Agent 替代 bash 断言脚本做端到端验证，作为 v1.3+ 的质量保障方向。

四阶段渐进：协同编排协议（Markdown 优先）→ Agent 发现与注册 → 跨设备任务分发 → 企业 Agent 知识库（多设备蒸馏记忆聚合到企业自有 NAS/云盘，底层用 [Graphify](https://github.com/safishamsi/graphify) 轻量知识图谱）

> 🧠 A2A 协议参考：Google A2A 为多 Agent 协作定义三层——动态服务发现 / 能力契约对齐 / 全状态接力。MCP 解决「脑和手」，A2A 解决「脑和脑」。工程参考：Multica 的 Polymorphic Actor + Session Resumption + Claim-then-Execute 模式为 v1.2.x 的 Agent 独立身份码提供可落地方向。

**双层循环（Loop Engineering）**：

| 循环层 | 时间尺度 | 职责 | 状态 |
|--------|:--:|------|:--:|
| 内层 | 秒-分钟 | Agent 执行 + 审计 + 反思 + 自动纠偏 | ✅ v1.0+ |
| 外层 | 天-周 | Skill 优化 + 知识库沉淀 | v1.2.x 规划 |

**Dream Sandbox 沙盒审计（v2.x 探索）**：Agent 操作先在平行空间模拟运行，人类审批后点「合并」才生效——将约束从事后升级为事前。来源：Palantir AIP，详见 [THANKS](./THANKS.md)。

**v1.2.x 子里程碑 · 编排隔离底座 + 波次拓扑可视化（Graph Engineering 印证）**

> 从 v1.4.0 重沙箱捆绑中拆出**纯 git 原生形态**的并行文件隔离，并补齐用户视角的控制图可视化——这是 v1.3.1「控制图波次并行」的**隔离前提 + 可观测前提**。重沙箱（虚拟文件系统 + 虚拟 key 凭证边界 + AsyncSubAgent + 实时 A/B 双跑）仍留 v1.4.0。

**② 并行 SubAgent git worktree 隔离（拆 4 子里程碑）**：
- **②·1 worktree 隔离原语**：orchestrator 调度并行 SubAgent 时，每个 SubAgent `git worktree add` 独立工作树 + 独立分支；无 FilesystemBackend / 虚拟文件系统 / AsyncSubAgent 等新运行时依赖
- **②·2 审计合并卡关**：各 worktree 工作完成后，sofagent audit 对每棵树跑 `git diff` 硬证据卡关（★Reality Anchor），通过后再合并回主工作树
- **②·3 冲突消解策略**：并行 SubAgent 写到同一逻辑文件时的冲突仲裁规则（按节点职责域划分优先 / 人工确认兜底），写入 harness 约束
- **②·4 与 v1.1.8 `filesValue` 同步合并的边界**：明确"同步并行用 filesValue 自动合并" vs "跨波次并行用 worktree 隔离"的适用边界，二者不互相替代

**③ 用户视角波次拓扑可视化（拆 2 子里程碑，数据层 ③·1 已提前至 v1.1.9）**：
- **③·1 Dashboard 波次拓扑视图**：前端渲染控制图（节点 + 边 + 波次分层），实时显示每波次 SubAgent 状态 + audit 卡关结果，替代纯技术状态文件
- **③·2 用户可读性**：面向"人看一眼就懂现在卡在哪"的语言化呈现（非开发者视角），随 v1.2.x dashboard 产品化节奏交付

**演化路径**：

| 阶段 | 形态 | 对应版本 |
|------|------|:--:|
| Ralph 循环（真菌） | 状态外化到文件，Agent 本体无状态 | v0.x-v1.0.x |
| Ralph 工厂（轻量多设备） | 自治循环进化——经验共享 + 审计可见 + 权限作用域化 | v1.1.x |
| 有身份 Agent（多设备完整） | 每个 AI 节点有独立身份，跨设备审计聚合，场景驱动权限 | v1.2.x 规划 |
| 无身份 Agent（细菌） | 用完即焚，全新生成，零状态 | v3.x 远景 |

**交付组织探索（v1.2.x 储备）**
规模化交付 FDE 时，孔老师设想一种「阿米巴三人组」的最小交付单元——一个可独立核算、快速组合的小队结构，对应 FDE 在企业侧落地的部署 / 合规 / 工程 / 审查等角色。配套的技能分级采用 S / A / B / C 四档：S 级为经生产验证、可独立上线的成熟技能；A 级为已对齐标准、需轻量监督；B 级为可用但需人工兜底；C 级为实验性、仅内部验证。该分级旨在让交付质量可度量、可定价，是 v1.2.x 商业化规模化的方法储备，非当前版本范围。

### v1.3.1 — Ontology 本体结构（操作型本体论落地）

> 💡 来自 Palantir 操作型本体论系列研报（2026-07）的启发。Palantir 4000 亿美元市值的核心护城河不是"本体论"概念包装，而是 **Action Types 作为类型系统一等公民**——操作语义与数据定义同层建模，LLM 所有调用必须经过本体层定义的 Action 执行，无法绕过直接写库。

sofagent v1.3.1 的 Ontology 本体结构方向与之高度同构，但走**分布式路线**——不建中央本体操作系统，让每个 Agent 自建本体（Ledger-Views-Policy），联邦查询跨设备共享，git diff + audit history 做硬证据链：

| Palantir 做法 | sofagent 做法 | 差异化 |
|------|------|------|
| Action Types 内嵌本体，LLM 调用必经 | A15 约束验证（事后）+ fde.md Policy（事前声明） | 事后审计 + 逐步前移 |
| OAG 五层确定性架构 | Harness 约束底座 + MCP + FORGE 双 Agent | 同构轻量，无需五层就位即可工作 |
| 集中式 Ontology OS，重度物化索引 | 分布式 knowledge/，联邦查询按需获取 | MIT 开源、零锁定、数据主权本地 |
| Markings + CBAC 本体级安全 | sensitivity frontmatter + 跨设备联邦过滤 | 渐进式演进 |

> 💡 **核心设计原则**：本体结构 = GitHub 生长树——树干 = 本体结构本身，分支 = 单个 ontology 节点新增，护栏 = 审计引擎，根系 = 每个节点的强制 frontmatter（输入 / 产出 / 通过标准 / 哪些数据禁用），养护 = 本体变更的 review + rollback。完整映射与 v2.x「ontology I/O schema 硬化」的契合见 [ARCHITECTURE.md · 本体结构 = GitHub 生长树](./ARCHITECTURE.md)。

---

## 产品化与商业化方向

> 控制平面打法——卖「能力」不卖「工时」，必须有自己的 MCP + dashboard。

sofagent 的结构性壁垒不在「更聪明的 Agent」（那是大厂在商品化的东西），而在「管住 Agent 的那一层」。产品化方向锁定四条：

1. **卖能力不卖工时**：FDE 从「一种岗位 / 服务」重构成「企业该有的能力」，用 Agent / SubAgent / 产品化封装交给企业，企业自己用、自己落地 AI 化。
2. **MCP + dashboard 必须有**：dashboard 是自有视图（持久可见 + 真相源），MCP 是向外接的桥。Agent 的 LUI + LLM 吞噬一切 → 所以要有 dashboard；dashboard 轻量 → 所以靠 MCP 配合。两者配合才能把「项目」变成「产品」。
3. **open-core 双轨**：内核 MIT 开源（信任 + 分发 + 生态），只卖 dashboard 那层（控制台 / 合规月报 / 告警）。
4. **能力长在代码里，不长在 prompt 里——对抗「模型吞噬一切」**：skill / prompt engineering / context engineering / 以 skill 形式做的 harness engineering，本质都是**文字形式的约束**。每次注入到模型 = 每次投喂 = 每次训练——模型会训练得越来越强，**必然吞噬文字形式的约束**（今天的 Skill 是差异化优势，明天就是模型的内置能力）。sofagent 对策：把 Skill + Harness 能力**封装进 Subagent**（代码级实现，非文字注入）+ **防投喂机制**（防止输入素材变成大模型训练材料）。生存位：细分业务 workflow 上对业务最终结果的可约束性——这个不会被模型吞噬。

**市场信号**（非技术变更，纯定位 / 竞品补充）：
- **FDE-as-a-Service / Services-as-Software 被资本验证**（详见「探索方向 · 市场信号验证」）：Anthropic 收购 Fractional AI、Accenture×Anthropic 3 万人 FDE 受训、Blackstone+H&F+Goldman 共建企业 AI 服务公司、Anthropic 接入 Palantir FedStart。
- **受监管行业规模化交付（2026 concrete 证据，强化上条）**：全球 Top-3 SI 将 FDE 能力标准化、规模化交付至强监管场景——TCS×Anthropic 在 56 国为 5 万员工与受监管行业部署 Claude；DXC×Anthropic 联盟（FDE 培训认证规模化）；Anthropic×Infosys 在电信等受监管行业共建 AI Agent。三者同源互证 sofagent「FDE 通用能力化 + Services-as-Software + 受监管行业护城河」定位，且印证「卖能力不卖工时」路线在强监管客户侧已被头部 SI 验证可行。
  > 📖 来源：温故知新 2026-07-23 / 2026-07-25（OpenFDE 信号库 P2 🎯：DXC / TCS / Infosys）
- **PE/VC 多企业审计仪表盘**（探索方向）：投后管理场景，所有被投企业 AI 审计数据汇总到一个面板。
- **WB 企业版竞品对标**（商业化储备）：席位全生命周期管理 + 成本三维核算 + 统一采购合规 + 审计追踪 + 安全沙箱。
- **🔴 Skill 廉价化危机（2026-07-25 阿里/钉钉会议验证）**：豆包已能自动生成 Skill、Hermes 能给自己生成 Skill → 以 Prompt 形式出现的所有产品形态都将被模型吞噬。Skill 只是入口（初级交付，数千元），企业专属小模型才是护城河（高阶交付，数十万元）。资本叙事四级：Skill(千元) → Workflow 自动化(万元) → 企业专属小模型(数十万元) → "训练小模型的模型"(技术壁垒)。v3.x 从"远景"提升为"战略必争"。
- **私有化部署需求加速（2026-07-25 会议验证）**：客户担心数据被用于训练（已有硬件客户代码出现在 AI 输出中）。U 盘交付模式的"龙虾 U 盘"心理价值——插入即用、拔出即停，制造"盾牌般的物理安全感"。核心卖的不是技术实现，是老板的掌控感。

**待落地**：首个 MVP = FDE Agent + 一个引擎 dashboard（进度 / 合规视图）；商业计划（GTM / 定价 / 买家画像 / 竞争象限）独立私有仓维护，不进本 MIT 库。

**分层落地中型蓝海**
商业化切入上，孔老师倾向「分层落地」而非一刀切：先在中型客户（有真实 workflow、愿为成果付费、但养不起自建 AI 团队）的蓝海市场建立标杆，用 FDE 的「交付企业专有 skill」模式把单点打透，再向大型客户的标准化模块、小型客户的自助模板双向延伸。核心判断是——卖能力不卖工时，控制平面（sofagent 引擎）是底层，业务 workflow 的可约束性才是护城河。

### 价值度量翻转：FDE vs 传统外包（2026-07 行业参考 blog 研读）

行业参考以「数字员工」重新定义 AI to B 的价值度量：传统外包按人·月计费，FDE 按成果·Token 计费，成本差可达三个数量级。

| 维度 | 传统外包团队 | 1 个 FDE Agent |
|------|------|------|
| 人力 | 5 人（待核验）| 1 FDE（一底座·三引擎 + FORGE 工具链）|
| 周期 | 3 个月（待核验）| 3 天（待核验）|
| 成本 | 50 万（待核验）| 500 元 Token（待核验）|

> 印证 sofagent 商业化判断「卖能力不卖工时」：护城河是可约束的业务 workflow，不是人头。

> 📖 来源：行业参考 blog《价值度量翻转》（2026，具体 URL 待核验）

### 为什么需要中间件，而不是更多 FDE：SMB 断层（2026-08 行业印证）

SaaStr 创始人 Jason Lemkin 算清了 FDE 模式的单位经济账：FDE 年薪 $135K–$200K+，一名 $200K 的 FDE 管 3–5 个企业账户，仅工程费即**每客户 $40K–$67K/年**，加差旅与利润后**每部署年成本 $75K+**。对 20–50 人、$2M–$10M 营收的中小企业，这笔实施费占营收 1–4%（还没算 AI 工具本身），无法 justify——55% 的 SMB 称成本是最大采用障碍。

结果是市场两极：Tier 1 企业拿到定制 AI + 嵌入式工程 + 高成功率；Tier 2 中小企业只拿到「预打包方案 + 远程支持 + 培训会」这种无结果承诺的版本。原文结论：**「最需要 AI 转型的企业，可能正被那个能出结果的实施模型的定价排除在外。」**

**这正是 sofagent 的位置**：Lemkin 只给出「SMB 需要另一套剧本——第一天就设计自实施、做行业模板、重 onboarding UX」，却没回答「自实施如何保证结果」。若 FDE 的判断力能固化进一层可复制的 harness（约束 + 审计 + 经验回流），$75K/部署的人力成本才可能摊薄成软件成本。$75K/部署/年是可长期引用的量化锚点。

> 📖 来源：[Forward Deployed Engineer: What It Takes to Make AI Work in B2B](https://www.saastr.com/forward-deployed-engineer-what-it-takes-to-make-ai-work-in-b2b-but-do-they-work-for-smbs/)（saastr.com，2026）

---

## 行业印证

### 🔮 行业印证

> 完整行业对标（DeerFlow / Omnigent / DataFlow / OpenWorker / OpenFDE / a16z 七法则 / Graph Engineering / 5 阶段风险收敛）统一见 [VALIDATION](./VALIDATION.md)。以下仅保留与版本规划直接相关的结论。

**运行时审计演进路线**（meta-harness 三问作答）：
- **v1.3.x**：最小运行时审计——wrapToolCall middleware 包 createReactAgent（FORGE 已跑 createReactAgent，加 middleware 即可）
- **v1.4.0**：完整运行时审计——策略强制 + 沙箱 + 状态化拦截（范围限定 SubAgent）
- **v1.5.0**：meta-harness——多 harness 编排（承接 v1.4.0 沙箱底座）

**落地纪律**：以上均为「用行业术语框定已有/规划能力」，不新增能力范围。外部框架是设计启发 + 开源借力，非依赖引入。

---

## 探索方向

| 方向 | 一句话 |
|------|------|
| PE/VC 多企业审计仪表盘 | 投后管理场景——所有被投企业的 AI 审计数据汇总到一个面板 |
| FDE 陪跑期机制 | 部署后前 2 周 AI 节点 daily review，人类反馈和 AI 反思双向写入 think.md |
| SMB 场景审计扩展 | 审计从代码开发扩展到数据处理/报表生成 |
| **自带净水设备的水龙头（v3.x+ 远景）** | Subagent 内置 workflow 专属精调小模型（QLoRA），零投喂、本地推理、离线可用 |
| **Onboard Agent（FORGE 产品化 · v1.3.1 L1 + v1.3.2 L2-L5）** | 把 FORGE 验证的「元循环」能力泛化——企业 AI 节点生成后，自动调试到跑通（activate→run→audit→fix→re-run）。从「给自己用」（FORGE）变「给客户用」。v1.3.1 交付 L1（工程判定：crash/error/超时）+ v1.3.2 交付 L2-L5（语义判定→自动定位→自动修复→循环收敛）|
| **Refine Agent（FORGE 产品化第三刀 · v1.3.3）** | Onboard Agent 让节点「能用」，Refine Agent 让节点「好用」——复用 Onboard 循环引擎，判据从 Ontology（对不对）换成质量规则集（好不好）。原型 = FORGE fresh-eyes-loop。v1.3.3 五层一次交付，与团队协作协议同版（质量经验可团队级反馈放大）|
| 国标 Agent 审计对位 | 关注国家 AI 智能体互联标准草案进展，标准正式发布后评估对齐 |
| 异步长任务自治 | daemon 从文件监控升级为长任务自主运行 |
| 双闸验证 | 工具执行前 gate + 执行后副作用复查 |
| Agent 疲劳度检测 | 监控上下文窗口污染和决策质量衰减信号 |
| **make support-bundle（DeerFlow 启发）** | ✅ v1.2.7 交付（`sofagent-audit --support-bundle`，一键打包诊断信息环境/日志/审计快照，自动脱敏） |
| **SkillScan 安全扫描器（DeerFlow 启发）** | 安装第三方 Skill 前静态扫描注入/越权风险（v1.4.x） |
| **Agentic Browser / Playwright（DeerFlow 启发）** | Agent 驱动浏览器做端到端操作，与「智能 E2E 测试 Agent」探索同源（v1.4.x） |
| **TUI / Dashboard / 对话分支（DeerFlow 启发）** | 终端 UI + 可视化面板 + 对话分支回溯（v2.x 远景） |
| **spec-first 硬禁令（OpenFDE 启发 · 最高优先）** | 单一事实源——transcript 永不直驱代码，spec 才是唯一驱动（设计约束） |
| **decisions.jsonl 判断时刻日志（OpenFDE 启发 · 最高优先）** | 每次判断落 `{kind, moment, why, spec_ref}`，决策审计底座（v1.3.x 意图审计） |
| **分级降级梯队（OpenFDE 启发 · 最高优先）** | console→TUI→spec 逐级降级，workflow never stops（韧性设计） |
| **Durable Execution（Pydantic AI 启发）** | 长任务 checkpoint 续跑——与回溯引擎互补（回溯=向后回滚，Durable=向前续跑），v1.3.1-1.4.0 窗口评估 |

> 📖 DeerFlow / OpenFDE 方法论印证见 [VALIDATION](./VALIDATION.md)；已被主版本表收纳的 DeerFlow 项（Session Goals `/goal`、`/compact`、Skill 渐进加载、记忆分层、Scheduled Tasks、ToolOutputBudget、`--doctor`）见 v1.2.7 / v1.2.8，不在此重复。

---

| 借鉴项 | 说明 |
| --- | --- |
| **运行时审计接入点（v1.3.x · LangGraph middleware）** | wrapToolCall middleware 包 createReactAgent，把 tool-gate 规则升级为运行时拦截 + 审计日志 |
| **EnkryptAI Secure MCP Gateway（v1.4.x · 开源借力）** | pre_model_hook / post_model_hook 安全护栏，audit_only 模式 |
| **LiteLLM 控制平面（v1.4.x · 开源借力）** | 开源 LLM gateway：成本追踪 / 预算 / 路由 / 护栏 |
| **OpenWorker 权限模型（v1.3.x · 设计启发）** | 四级权限 + 命令白名单 + 无人值守收件箱（详见 [VALIDATION](./VALIDATION.md)）|
| **bubblewrap / seatbelt 沙箱（v1.4.0 · 开源借力）** | OS 级沙箱原语（Linux bwrap+seccomp / macOS seatbelt），SubAgent 沙箱底座 |
| **MLflow agent 评估（v2.x · 开源借力）** | 50+ agent 评估指标 + LLM-as-Judge，FORGE 评估框架参考 |

> 以下「分层模型架构」为探索方向的核心技术骨架概述。当前版本（v1.2.x）未涉及，v3.x 才启动。

## 分层模型架构（v3.x 远景概述）

核心驱动力 = **数据主权**（企业数据进 API key 大模型 = 一定被拿去训练）。三层模型 + Harness 路由：云端 32B+ 负责规划推理 → 翻译成标准化指令 → 本地 7B 执行多步 workflow → 本地 0.5B 跑管道层（模板/格式/字段提取）。敏感数据只在本地处理，通用知识才走云端。路由层可提前到 v2.x 做（不依赖精调模型），QLoRA 精调 pipeline 和离线 USB 节点是 v3.x-v4.x+ 的工作。完整技术骨架（Mermaid 图 + 选型表 + 实现难度 + 后训练闸门）见 [产品战略讨论记录 2026-07-25/30](./PHILOSOPHY.md)。

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

→ [CONTRIBUTING.md](../CONTRIBUTING.md)

---

## 长期叙事：Conway/Coase 双重反转

> **Conway 定律反转**：传统软件架构反映组织沟通结构。Agent 时代出现反转——Agent 架构（谁做什么、怎么协作）开始**反向塑造企业组织形态**。阿里巴巴 OPT 已观察到这一趋势：单人 + Agent Skill + 企业系统 → 闭环完成多岗工作，传统部门边界被 Agent 能力边界替代。
>
> **Coase 定理反转**：企业存在的经济学理由是内部交易成本低于市场。当 Agent 将内部协调成本降为零，企业的边界开始模糊——一个人借 Agent 能做成的事，不再需要一个部门。"企业"从组织结构变成一个 Agent 能力矩阵。
>
> sofagent 的终局：**Ontology（业务世界模型）+ SkillHub（跨岗能力）+ 审计引擎（责任确权）= 让单人 + 硅基构成的最小闭环单元，替代传统多部门协作。**
## 历史架构演进

编排引擎从 ao → DeepAgents → LangGraph 的升级史（v1.2.0 起 FORGE loop 已完全弃用 deepagents，改用 createReactAgent；历史编排引擎的 DeepAgents 调度原型见 v1.1.8 changelog）、Ontology 从实体关联到本体结构的渐进构建、外部框架对标（Palantir/gbrain/WeKnora/Runta）、Loop Engineering 全栈对照等详见 **[ARCHITECTURE.md](./ARCHITECTURE.md)** 的「行业印证」+「编排引擎」+「Ontology 本体结构」章节，以及各版本 **[开发日志](./changelog/)**。

> 📖 多设备同步方案见 [多设备同步指南](./guides/multi-device-sync.md)。

## 中期方向：FDE 节点注册表（Pattern Registry）

loop-engineering 社区将 7 个生产模式编入机器可读 `patterns/registry.yaml`（含 id/cadence/risk/skills/human_gates/token cost），使工具能自动工作。**sofagent 可做**：为 FDE 模板建 `fde-registry.yaml`，audit 引擎可直接读取——从手动排查到机器可读。

> 📖 来源：cobusgreyling/loop-engineering（MIT 开源）— [patterns/registry.yaml](https://github.com/cobusgreyling/loop-engineering/blob/main/patterns/registry.yaml)

## 远期方向：执行层面隔离（Worktree 模式）

loop-engineering 要求每个 code-change 跑在隔离 git worktree 里——一次 fix 一个 worktree，拒绝则丢弃。这是 sofagent **当前明确的差距**。实现路径：**短期（v1.x）** 在 DEVELOPMENT 中记录为推荐实践 → **中期（v2.x）** 编排引擎内置 `sofagent worktree create` → **远期（v3.x+）** L2+ 硬性要求。

> 📖 来源：cobusgreyling/loop-engineering（MIT 开源）— [primitives.md](https://github.com/cobusgreyling/loop-engineering/blob/main/docs/primitives.md) / [anti-patterns.md](https://github.com/cobusgreyling/loop-engineering/blob/main/docs/anti-patterns.md)

## 远期方向：理解债务应对策略（Comprehension Debt）

loop-engineering 的 Comprehension Debt Spiral（理解债务螺旋）被评为 S2 级故障模式：速度上升但无人能解释变更 → 自动化成了黑箱。sofagent 的应对：**审计已覆盖**「发生了什么」→ 需新增「为什么这么做」（auto-PR 描述中要求 Agent 解释决策）→ 需新增「本周摘要」（daemon 周报）。核心认知：理解债务是工具的边界，不是失败——自动化越高，人类判断责任越大。

> 📖 来源：cobusgreyling/loop-engineering（MIT 开源）— [failure-modes.md](https://github.com/cobusgreyling/loop-engineering/blob/main/docs/failure-modes.md)
