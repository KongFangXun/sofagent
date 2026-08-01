# 路线图 · Roadmap

> 已经做了什么、未来要去哪、哪些地方需要你的帮助。
> v1.2.4 · 2026-08-02（UTC）· 🧠 知识进化（分层巡检 + skillopt 自动触发 + Skill×MCP 集成 + FDE 人机分离 + FORGE LESSONS 方法论）

产品定位详见 [设计哲学](./docs/PHILOSOPHY.md) 和 [README](./README.md)。

## 现在在哪：v1.2.5（规划中 · 激活链 Phase 1）

> **🔗 激活链 ACTIVATE + 多设备前置（v1.2.5）**：
> 新增 `activate.ts`，读 FDE 交付物（ontology + workflow.yml + skills/）→ 注册企业 SubAgent → 写入 `.sofagent/subagents/*.yml`。
> 解决"FDE 交付后断裂带"——交付物躺在文件里没人消费，需要手动接线才能跑起来。
> 多设备前置（轻量）：Agent 独立身份码 + 跨设备审计轨迹聚合 + 协议中立审计。
>
> 📖 [v1.2.5 开发日志](./docs/changelog/v1.2/v1.2.5.md) · 完整版本历史见 [CHANGELOG](./CHANGELOG.md) 和 [迭代历程](#迭代历程)

> ✅ **企业采购阻塞项 · Webhook 推送已于 v1.2.1 交付**：v1.1.6 接通 webhook **PASS/WARN/FAIL 三态推送**（本地 agent 自测），v1.2.1 补齐企业协同平台（飞书/钉钉/企微）完整 Webhook 推送能力（见 SECURITY.md「审计结果推送」）。采购阻塞项已解除。

---

## 迭代历程

完整版本历史见 [CHANGELOG](./CHANGELOG.md)。v0.x 为实验/测试版，v1.0.0 起为正式版。

| 版本 | 核心交付 |
|------|------|
| **v1.2.4** | 知识进化（分层巡检 L1/L2/L3 + skillopt 自动触发 + 失败清单 + 联邦蒸馏 + 进化引擎接通 eval）+ Dashboard 历史趋势 + Skill × MCP 集成（S1-S5）+ FDE 人机分离（README/GUIDE/SKILL.md 升格 + 子 Skill 分包 01-05）+ FORGE stream 迁移 + LESSONS 方法论 |
| **v1.2.3** | Dashboard 产品化（控制图波次渲染 + 用户可读状态映射 + Fresh-Eyes 审查进度 + Workspace 变更摘要）+ 编排隔离底座（git worktree 三原语 + 审计合并卡关）+ Fresh-Eyes-Loop 移至阶段一 + v1.2.2 BugFix 31 项 + 裁决解析健壮性加固 |
| **v1.2.2** | 数据主权审计（4 维追踪 + HMAC 链 + 日/周/月报告）+ 混合模型路由（ModelRouter + Ollama 接入）+ FDE Dashboard（终端三栏）+ Graph Engine（Planner + 降级链 + decide/execute 分层）+ 异步 HITL + Skill 升级三策略 + v1.2.1 BugFix 38 项 |
| **v1.2.1** | 数据目录重构（.sofagent/ → data/）+ Webhook 推送 + SubAgent 可见性 L2 + custom/ 闭环 |
| **v1.2.0** | 物理结构大重构（/sofagent/→/engine/ + SKILL 收敛 + 发版工具链拆散 + install.sh 提根 + rules 独立包） |
| **v1.1.9** | 产品叙事收敛（FDE Agent）+ USB 完整运行时 + daemon A/B 自动调度器 + 控制图状态抽取 + v1.1.8 BugFix 42 项 |
| **v1.1.8** | 安全层加密配对 + 联邦查询 + Prompt 注入防护补齐 + 编排引擎串行版（DAG 并行规划在 v1.3.1） |
| **v1.1.7** | Dream Cycle 6 阶段 + sensitivity + 知识健康巡检 + 知识可观测性：gbrain 精简 pipeline 替换旧脚本 + knowledge 敏感度分级（缺省 internal）+ knowledge-health 5 项检查（@weekly）+ `knowledge status` 聚合命令 |
| **v1.1.6** | BugFix 21 项 + LLM Wiki 3 层分层 + conflict-check：v1.1.5 遗留全数修复 + Ledger-Views-Policy 显式化（详见 [ARCHITECTURE §文件系统架构](./docs/ARCHITECTURE.md#文件系统架构)）+ daemon 知识健康巡检（矛盾/孤儿/死链） |

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

> 🔴 **阻塞项占位纪律**：任何 🔴 采购 / 合规阻塞项必须在下表占据一个**明确的版本单元格**（标注具体版本号，如 v1.2.1），不得仅写在散文备注里。散文式「建议优先排期」会悄然过时——v1.2.0 时 Webhook 阻塞项就曾因只写在备注、未落版本格，导致建议过期却仍未排期。教训：**阻塞项 = 版本格，不是建议**。

| 版本 | 状态 | 核心交付 | 日志 |
|------|:--:|------|:--:|
| **v1.2.x** | 📋 规划中 | 完整多设备协同——**L2 团队协作协议**：共享态/意图广播/触发反应/冲突消解/反馈放大五大机制，从单人约束到团队协作；**L3 组织能力市场**：Skill/Agent/流程在企业内发布→发现→调用→评价，高频高价值自然胜出。+ Agent 独立身份码 + 跨设备审计轨迹聚合 + 场景驱动权限体系 + 代理网关硬边界。**🔮 探索**：路由器式配网（边缘设备 WiFi 热点 + 手机端配置网页，仅用于初始配置，配置完成后回归纯 LUI）+ **协议中立**（审计层只走 MCP 等开放协议和 git diff/JSONL/Markdown 开放格式，不为任何单一平台写专属集成——不绑定平台，平台不绑定审计） + **编排隔离底座（git worktree 轻量形态）+ 波次拓扑可视化（控制图视角，随 dashboard 交付，详见子里程碑）** | — |

#### v1.2.x 里程碑拆分

> 6 版本定稿 + 3 弹性位（v1.2.7/v1.2.8/v1.2.9 空位，紧急修复或探索项按需取用）。

| 版本 | 主题 | 核心交付 |
|------|------|------|
| **v1.2.1** | **数据目录重构 + ✅ Webhook + SubAgent 可见性 L2（已发版）** | **数据目录重构**：`.sofagent/` 669 个运行时数据文件统一迁移到 `data/` 可见目录——用户能直接打开、Dashboard 直接消费、备份只需拷贝一个目录（v1.2.2 Dashboard 前置基础设施）· ✅ **Webhook 推送完整能力（飞书/钉钉/企微）— 采购阻塞项已解除** · **SubAgent 可见性 L2**（ProgressMiddleware：worker 内部工具调用序列 + LLM 心跳 → sub-progress jsonl，Dashboard 实时面板数据前置）· custom/ README 重写（加载链声明 + 安装保护逻辑移至 v1.2.2）· 数据层清理（IDENTITY.md + eval.md 删除 + 模板标注 + daemon-health.json）（详见 [开发日志](./docs/changelog/v1.2/v1.2.1.md)）|
| **v1.2.2** | **数据主权 + 路由 + Dashboard（数据主权 + SubAgent 实时面板）** | ① 数据主权审计追踪（4 维审计日志 + 年/月目录 + 每日/周/月报告 + 四路分发闭环）② 混合模型路由层（ModelRouter 敏感度×任务类型路由 + Ollama 接入）③ FDE Dashboard 第一版（数据主权视图 + **SubAgent 实时面板 L3**：消费 v1.2.1 L2 数据，双 agent 状态卡 + 工具调用流 + 成本曲线 + 心跳检测）④ Skill 分层升级三策略 install.sh 实现（详见 [开发日志](./docs/changelog/v1.2/v1.2.2.md)）|
| **v1.2.3** | **Dashboard 产品化 + 编排隔离底座 + Fresh-Eyes 流程化** | ① **Fresh-Eyes Dashboard 集成**（fresh-eyes-driver 的 A/B sub agent 写入 sub-progress-*.jsonl 至 `data/forge-runs/`，Dashboard `--watch` 模式实时显示 loop 审查进度——每轮发现数、当前审查文件、A/B 双盲状态）② Dashboard 波次拓扑可视化（bash + jq ASCII art 渲染控制图：节点/边/波次分层实时状态，延续 v1.2.2 零依赖路线）③ 编排隔离底座（git worktree 四子里程碑：隔离原语→审计合并卡关→冲突消解→filesValue 边界）④ Fresh-Eyes-Loop 移至阶段一（releasing.md SOP 重组——新版本第一步跑 fresh-eyes-loop 审查上版本，提前自 v1.2.4）⑤ Workspace 变更摘要（每次运行后记录创建/修改/删除文件清单 → Dashboard 消费，提前自 v1.2.8）⑥ Dashboard 用户可读性（技术状态→用户可读映射 + --technical 切回）（详见 [开发日志](./docs/changelog/v1.2/v1.2.3.md)）|
| **v1.2.4** | **知识进化 + 知识健康** | ① 分层巡检 L1/L2/L3（@daily/@weekly/@monthly 三级 + 读写回路对标）② skillopt 自动触发（失败模式 3 次自动优化）③ 失败清单自动优化（负面样本为主要燃料）④ conflict-check CLI + 联邦蒸馏 ⑤ **进化引擎接通 eval**（think-generator 读 eval failures → 写 think.md，前置 eval 补全在 v1.2.1 P0b）⑥ **Dashboard 历史趋势 + 任务统计**（v1.2.2 每日快照 → 周对比/月趋势/任务成功率/TOP5 违规，v1.2.4 补齐）⑦ **Skill × MCP 集成**（P3 独立开发线：S1 Skill 引用 MCP 工具 / S2 新增 6 tools / S3 Skill 精简 / S4 数据变更审计 D1-D5 / S5 审计结果汇报 + 品牌可见化五层兜底）⑧ **FDE 人机分离 + Skill 分包**（P4 独立开发线：README 门面 / GUIDE 学习手册 / SKILL/SKILL.md 升格唯一主入口 / 子 Skill 分包 01-05 / 删除 FDE/SKILL.md+FDE.md+quick-start.md，发布源 ./FDE→./SKILL）（Fresh-Eyes-Loop 移至阶段一已提前至 v1.2.3）（详见 [开发日志](./docs/changelog/v1.2/v1.2.4.md)）|
| **v1.2.5** | **🔗 激活链 Phase 1 + 多设备前置** | **🔗 激活链 Phase 1 ACTIVATE**——新增 `activate.ts`，读 FDE 交付物 → 注册企业 SubAgent → 写入 `.sofagent/subagents/*.yml`（registry.ts 动态注册机制已有，缺的是往里写企业 Agent 的自动化流程）+ MCP `activate_workflow` tool。**多设备前置（轻量）**：① Agent 独立身份码 + KYA 轻量版（企业 SubAgent 注册即带身份）② 跨设备审计轨迹聚合 ③ 协议中立审计（只走 MCP + 开放格式）。⚠️ **原多设备 L2/L3 大项已拆**：L2 协作协议 → v1.3.3、L3 能力市场 → v1.3.4、权限体系+代理网关 → v1.4.0、归因引擎 → v2.x（详见 [开发日志](./docs/changelog/v1.2/v1.2.5.md) + [激活链设计](./docs/guides/fde-activation-chain.md)）|
| **v1.2.6** | **🔒 弹性预留 + 🔗 激活链 Phase 2 前半** | **储备项**：① `sofagent-audit --support-bundle` ② `--doctor` 输出增强 ③ README Deployment Sizing 表格 ④ One-Line Agent Setup。**🔗 激活链 Phase 2 前半**：workflow-parser 扩展支持 `agent: enterprise` 类型 + registry.ts 的 SubAgentDefinition 增加 hitl/hitlConfig/knowledgeDomain 字段——为 v1.2.7 StateGraph 构建打基础（详见 [开发日志](./docs/changelog/v1.2/v1.2.6.md)）|
| **v1.2.7** | **编排引擎增强（DeerFlow 启发）+ 🔗 激活链 Phase 2 后半** | ① **Session Goals**（`/goal`）② **手动上下文压缩**（`/compact`）③ **Skill 渐进式加载** ④ **`--doctor` 可操作修复提示** ⑤ **FORGE driver 三方抽象** ⑥ **🔗 激活链 Phase 2 后半**——新增 `enterprise-graph.ts` + `composeEnterpriseWorkflow()`：从 FDE 交付物构建企业专属 LangGraph StateGraph（不调 LLM 拆任务，直接用 workflow.yml）+ 数据流三层设计（State 实时 + entity 持久化 + 双写）（详见 [开发日志](./docs/changelog/v1.2/v1.2.7.md)）|
| **v1.2.8** | **记忆分层 + 定时任务（DeerFlow 启发）+ 🔗 激活链 Phase 3 前半** | ① **记忆事实级分层** ② **Scheduled Tasks MVP**（cron+once / 暂停/恢复/触发/历史/删除）③ **ToolOutputBudget 中间件化** ④ **🔗 激活链 Phase 3 前半**——dag-runner 扩展支持企业 Agent + 新增 `node-executor.ts` + `run-enterprise` CLI 子命令（详见 [开发日志](./docs/changelog/v1.2/v1.2.8.md)）|
| **v1.2.9** | **🔒 弹性预留 + 🔗 激活链 Phase 3 后半** | **🔗 激活链 Phase 3 后半**：① HITL 中断处理（`hitl-handler.ts`——⚡ 节点执行前暂停等人确认）② 每节点执行后自动审计 + think.md 回溯 ③ 异常处理（exceptions 队列 + 重试/跳过策略）。紧急修复 / 探索项按需取用（详见 [开发日志](./docs/changelog/v1.2/v1.2.9.md)）|
| **v1.3.0** | 📋 规划中 | **运行时审计最小闭环 + 🔗 激活链 Phase 4 收尾（SUSTAIN）**：① wrapToolCall middleware 包 createReactAgent ② engine/rules 3 条 tool-gate 规则升级为运行时拦截 + 审计日志 ③ 危险操作前人工批准钩子 ④ 复用 FORGE 已跑 createReactAgent ⑤ 审计日志按 git 仓库隔离 ⑥ 决策审计 Judgment Unit（emitDecision + kind-wise back）⑦ **🔗 激活链收尾**：全链路验证（activate→compose→run→HITL→audit→sustain）+ wrapToolCall 自动覆盖企业 Agent + FDE SKILL.md 新增 activate 引导（详见 [开发日志](./docs/changelog/v1.3/v1.3.0.md) + [激活链设计](./docs/guides/fde-activation-chain.md)）|
| **v1.3.1** | 📋 规划中 | **Ontology 本体结构 + 国标对齐 + 并行编排**：① 本体即本体结构——将 Ontology 统一层从「描述事实如何被理解」升级为「可运行推理底座」（对齐 LLM + Harness 规则 A1-A11、A14-A19 + E1-E4（共 21 条）+ 记忆 Ledger-Views-Policy）；② 三层落地法（统一元模型 → 企业通用 Ontology 规范：命名/版本/验证 → 与 Agent 平台打通）；③ 国标对齐 GB/T 48000.3-2026《标准数字化 第3部分:本体建模要求》作为审计/Ontology 层合规参考基线；④ **编排引擎并行调度（Graph Engineering 视角：控制图多循环 DAG 波次并行）**：基于 v1.1.8 的编排引擎调度原型（已从 DeepAgents 迁移至 LangGraph createReactAgent），新增 DAG 依赖解析（Kahn 波次拓扑）+ 并行扇出/扇入（LangGraph `Send` API）+ 循环依赖检测 + 失败传播策略 + 超时熔断；每波次经 audit 节点（★Reality Anchor，真实 git diff 作 guard edge）卡关，并行 SubAgent 文件隔离由 v1.2.x 的 git worktree 隔离底座提供；恢复时**幂等性保证**（任务 ID 查重，避免 SubAgent 恢复后重复执行外部动作如重复创建 PR）（详见 [开发日志](./docs/changelog/v1.3/v1.3.1.md)）|
| **v1.3.2** | 📋 规划中 | **多设备协同第一刀：Agent 身份码 + 跨设备审计聚合**：① Agent 独立身份码 + KYA 完整版（Ed25519 签发/验证，绑定委托人/约束/责任，身份与审计双签名）② 跨设备审计轨迹聚合（按 agentId 合并完整轨迹，复用安全联邦加密通道）③ MCP `agent_identity` + `audit_trail` tool。**这是 L2/L3 的地基**——没有身份就没有"谁在协作"（原 v1.2.5 拆入）（详见 [开发日志](./docs/changelog/v1.3/v1.3.2.md)）|
| **v1.3.3** | 📋 规划中 | **L2 团队协作协议（五大机制）**：共享态（CRDT 合并）/ 意图广播 / 触发反应 / 冲突消解（trust 优先）/ 反馈放大（团队级 think.md 沉淀）+ 团队状态管理（team.yml + 团队会话持久化 + 团队审计）。让多个有身份的 Agent 从"各自为战"变成"一个团队"（原 v1.2.5 拆入，依赖 v1.3.2 身份码）（详见 [开发日志](./docs/changelog/v1.3/v1.3.3.md)）|
| **v1.3.4** | 📋 规划中 | **L3 组织能力市场（发布→发现→调用→评价）**：Skill / Agent / 流程打包发布（market/ 目录）+ 目录检索（复用 search_knowledge）+ 调用挂载（复用 registry）+ 评分聚合（评分 × 调用量加权自然选择）+ 全程审计。高频高价值能力自然胜出（原 v1.2.5 拆入，依赖 v1.3.3 L2 协议）（详见 [开发日志](./docs/changelog/v1.3/v1.3.4.md)）|
| **v1.4.0** | 📋 规划中 | **SubAgent 完整沙箱执行环境 + 场景驱动权限体系 + 代理网关硬边界 + 数据静态加密**：① **沙箱**——虚拟文件系统隔离（FilesystemBackend + virtualMode）、网络出站白名单、**工具调用中介（前置 allow/deny，非仅审计追踪）**、**虚拟 key 凭证边界注入**、AsyncSubAgent（远程 Agent Protocol 服务端）+ 真·实时 A/B 双跑；② **场景驱动权限体系**（原 v1.2.5 拆入）——权限按"场景"（任务类型 × 数据域 × 动作风险等级）动态判定，判定链 = 身份（v1.3.2）→ 场景匹配 → 风险等级 → 放行，含团队场景权限 + 市场调用权限 + 动态提权到期回收；③ **代理网关硬边界**（原 v1.2.5 拆入）——SubAgent 所有外部请求经网关（唯一出入口），allow/deny + 风险分级 + 超阈值人工批准；④ **数据静态加密（age）**——`~/.sofagent/data/` 审计数据 age 加密落盘（原计划 v1.3.0，随安全加固批次后移），解决明文存储合规短板。审计从「事后」扩展到「运行时」（**范围限定 SubAgent，主 Agent 仍事后审计**）（详见 [开发日志](./docs/changelog/v1.4/v1.4.0.md)）|

#### v1.3.x 里程碑拆分

> 运行时审计最小闭环（v1.3.0）是 v1.3.x 第一刀：不替换 harness，只在 createReactAgent 上加 middleware 层。完整运行时审计（策略强制 + 沙箱 + 状态化拦截）仍留 v1.4.0；meta-harness 多 harness 编排已前移到 v1.5.0（承接 v1.4.0 沙箱底座）。

| 版本 | 主题 | 核心交付 |
|------|------|------|
| **v1.3.0** | **运行时审计最小闭环（LangGraph middleware）** | ① wrapToolCall middleware 包 createReactAgent ② engine/rules 3 条 tool-gate 规则升级为运行时拦截 + 审计日志 ③ 危险操作前人工批准钩子 ④ 复用 FORGE 已跑 createReactAgent ⑤ 审计日志按 git 仓库隔离（详见 [开发日志](./docs/changelog/v1.3/v1.3.0.md)）|
| **v1.3.1** | **Ontology 本体结构 + 国标对齐 + 并行编排** | 见上方主表：Ontology 本体结构 + GB/T 48000.3-2026 国标对齐 + 控制图多循环 DAG 波次并行 |
| **v1.3.2** | **多设备第一刀：身份码 + 审计聚合** | Agent 独立身份码（Ed25519）+ 跨设备审计轨迹聚合 + `agent_identity`/`audit_trail` MCP tool（详见 [开发日志](./docs/changelog/v1.3/v1.3.2.md)）|
| **v1.3.3** | **L2 团队协作协议** | 共享态/意图广播/触发反应/冲突消解/反馈放大五大机制 + 团队状态管理（详见 [开发日志](./docs/changelog/v1.3/v1.3.3.md)）|
| **v1.3.4** | **L3 组织能力市场** | 发布→发现→调用→评价 + 评分聚合自然选择 + 全程审计（详见 [开发日志](./docs/changelog/v1.3/v1.3.4.md)）|
| **v1.3.5-v1.3.9** | 🔒 弹性预留 | 紧急修复 / 探索项按需取用（智能 E2E 测试 Agent、规则文件独立只读焊死门、Agent 执行层实时治理等 v1.3+ 探索项可在此落位）|

### v1.2.x Graph Engine 进化路线

> 理论基础：Carlos E. Perez·[From Loop Engineering to Graph Engineering?](https://engineering.zooz.com/intuitionmachine/from-loop-engineering-to-graph-engineering-d3ebeb08511c)（单闭环四类失效→Graph 拓扑解法+grounding）、Addy Osmani·Loop Engineering（Context→Harness→Loop 三层框架）、工程实践（Workflow→Graph Engine 五组件五原则）。五层工程化模型（Prompt→Context→Harness→Loop→Graph）为行业共识框架。详见 [ARCHITECTURE §Graph Engineering 视角](./docs/ARCHITECTURE.md#graph-engineering-视角控制图--stategraph) 和 [THANKS](./docs/THANKS.md)。

| 版本 | Graph Engine 交付 | 对标缺口 |
|------|---------|------|
| **v1.2.2** | **Planner 节点**（任务分解）+ **降级路由链**（retry→降级→标记→人工）+ **engineer-decide/execute 分层**（LLM 层 + 代码层）+ Dashboard Graph Engine 状态卡片 | ③Planner / ④降级 / ⑤LLM vs 代码 |
| **v1.2.3** | **并行子图执行**（worktree 隔离 + 多 engineer 并发）+ **Dashboard ASCII 控制图**（节点/边/波次分层，bash + jq 渲染）+ **Fresh-Eyes 进度可视化** + **Workspace 变更摘要** | ①并行 / Dashboard 图视图 |
| **v1.2.4** | ⚠️ 早期规划，**实际交付已调整**——v1.2.4 真实范围为「**知识进化 + 知识健康**」（分层巡检 L1/L2/L3 · skillopt 自动触发 · 失败清单自动优化 · 进化引擎接通 eval · Skill × MCP 集成 · FDE 人机分离，以 L88 迭代历程为准）。本行原「多类型 Checker + 受控循环升级」未随 v1.2.4 交付，相关 Graph Engine 能力归入后续版本规划 | ②Checker 扩展 / ⑥受控循环（未交付） |
| **v1.2.5** | **五类边契约形式化**（数据流/控制流/权限流/证据流/失败流）+ **Anchor 配置**（冻结验收标准防自洽）+ Graph Engine 归因 | ⑧边契约 / ⑨Anchor |
| **v1.3.1** | 控制图多循环 DAG 波次并行（Kahn 拓扑 + `Send` API + ★Reality Anchor git diff guard edge） | ①并行（完整 DAG） |

### v1.2.0 — 记忆/知识层升级（本体结构铺垫）

> 💡 **v1.2.0 是 v1.2.x 主题线的第一刀**：把 gbrain / LLM Wiki / Palantir 操作型本体论的外部验证吸收为「方法」（分阶段记忆整合、分层巡检、读写回路对标），不吸收其「定位」（不变成 agent runtime，不走集中式 Ontology OS）。详细 scope / 交付拆分（P0/P1/P2）/ 边界见 [v1.2.0 开发日志](./docs/changelog/v1.2/v1.2.0.md)。

🛡️ **差异化铁律（对标时必守）**：gbrain 是「agent 自己的脑」，Palantir Ontology 是「企业级操作层」，sofagent 是「约束中间件」（数据主权 + 第三方独立 + MIT 可审计）。吸收方法，不吸收定位；不建自动化 diff 任务，发版前由架构评审顺带 diff 一次 gbrain 的 dream-cycle / skillopt / Palantir 的 OAG 进展，结论进当版 changelog「行业对标」小节。

### 多设备协同（规划中，已拆分至 v1.3.x / v1.4.x）

> 💡 **多 Agent 协同已在 v1.x 完成**：v1.0.3 FDE SubAgent + Audit SubAgent 并存 → v1.0.4 A/B 自动优化双 Agent 对比。**轻量多设备在 v1.1.0 起步**（经验共享 + 权限作用域化 + daemon 主动巡检）。完整版按依赖链拆分：**v1.3.2 身份码+审计聚合 → v1.3.3 L2 协作协议 → v1.3.4 L3 能力市场 → v1.4.0 权限体系+代理网关**（原 v1.2.5 过重拆分，详见各版本开发日志）。

**ATTRIBUTION 归因引擎（v2.x 探索区）**：审计能告诉你 Agent 违规了，但不能告诉你哪次正确的审计干预带来了业务价值。ATTRIBUTION 需要在多设备、多客户、长时间尺度上追踪审计决策→业务指标的因果链。**挂 v2.x 探索区**——依赖 v1.3.2 跨设备审计聚合数据积累（v1.3.4 市场调用数据也可作输入），执行层能力（沙箱/权限/网关）落地后再做分析层。

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

**Dream Sandbox 沙盒审计（v2.x 探索）**：Agent 操作先在平行空间模拟运行，人类审批后点「合并」才生效——将约束从事后升级为事前。来源：Palantir AIP，详见 [THANKS](./docs/THANKS.md)。

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

> 💡 **核心设计原则**：本体结构 = GitHub 生长树——树干 = 本体结构本身，分支 = 单个 ontology 节点新增，护栏 = 审计引擎，根系 = 每个节点的强制 frontmatter（输入 / 产出 / 通过标准 / 哪些数据禁用），养护 = 本体变更的 review + rollback。完整映射与 v2.x「ontology I/O schema 硬化」的契合见 [ARCHITECTURE.md · 本体结构 = GitHub 生长树](./docs/ARCHITECTURE.md)。

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

---

## 行业印证

### 🔮 Graph Engineering 印证（2026-07 新概念 · 迭代参考）

> 📐 来源：2026-07 行业新概念「Graph Engineering」——prompt→context→harness→loop→**graph** 的演进（嵌套非替换）；本质 = 设计 loop/process 之间的关系。理论根 = FSM/Statecharts（Harel 1987）。核心构件：**控制图**（node=state, edge=transition, guard edge 守门）+ **数据图**（知识图谱/血缘）+ **★Reality Anchor**（无 anchor = 披着 PM 外衣的幻觉）。实现模式含 DAG 波次拓扑（Kahn）、扇出/扇入、worktree 隔离、可审计状态文件、动态重规划。

sofagent 的编排引擎天然就是「控制图」——`engine/orchestrator/src/loop/graph.ts` 用 `@langchain/langgraph` StateGraph 实现 `START→engineer→audit→reviewer→human_confirm→END`，`audit` 节点即 Reality Anchor（真实 git diff A1-A11、A14-A19 + E1-E4（共 21 条）作 guard edge），`FileCheckpointer` 快照到 `.sofagent/checkpoint/` 即可审计状态文件。数据图天然对应 蓄水池（知识库）+ 市政规划（Ontology）。**所以 sofagent 已经在做 Graph Engineering，只是没用这个词**——后续迭代用其术语框定「并行编排」与「可视化」，不引入新能力。

**可学习的未来迭代（落盘到对应版本）**：① 多循环 DAG 波次并行、② 并行 SubAgent git worktree 隔离、③ 用户视角波次拓扑可视化——三项能力的现状与落地版本已并入上方「版本规划」表（v1.3.1 ④ / v1.2.x 子里程碑 ②·1~②·4、③·1~③·2 / v1.1.9 ③·1），详细拆分见 `### v1.2.x` 与 `### v1.3.1` 子节。此处仅作 Graph Engineering 概念框定，不新增能力范围。

> 🔴 **落地纪律**：① 和 ② 是「用 Graph Engineering 术语框定已有/规划能力」，不新增能力范围；③ 是纯可视化，依赖 dashboard 产品化节奏（v1.2.x 起）。

### 🔮 DeerFlow 参考清单

> 方法论印证见 [PHILOSOPHY §十 · DeerFlow](./docs/PHILOSOPHY.md#deerflow-20大厂用harness命名的活样本2026-07-行业印证)。以下仅保留版本分配：

| # | 设计启发 | 落地版本 |
|---|---|---|
| 1 | `make support-bundle` | v1.2.6 |
| 2 | `make doctor` 可操作修复 | v1.2.6→v1.2.7 |
| 3 | Session Goals（`/goal`）| **v1.2.7** |
| 4 | `/compact` 手动上下文压缩 | **v1.2.7** |
| 5 | Skill 渐进式加载 | **v1.2.7** |
| 6 | 记忆事实级分层 | **v1.2.8** |
| 7 | Scheduled Tasks MVP | **v1.2.8** |
| 8 | ToolOutputBudget 中间件化 | **v1.2.8** |
| 9 | SkillScan 安全扫描器 | v1.4.x |
| 10 | Agentic Browser（Playwright）| v1.4.x |
| 11 | TUI / Dashboard / 对话分支 | v2.x |

> 🔴 落地纪律：DeerFlow 是 Python 运行时，以上全是设计启发（非依赖引入）。

### 🔮 Omnigent 参考清单

> 方法论印证见 [PHILOSOPHY §十 · Omnigent](./docs/PHILOSOPHY.md#databricks-omnigentmeta-harness-把策略强制在基础设施层2026-07-行业印证)。

**已实现 → 印证 sofagent 判断**：策略在基础设施层强制 / git push 拦截需人批 / egress proxy 注入密钥 / OS 沙箱 / YAML agent 跨 harness 切换。

**可借力开源**：LiteLLM（成本路由 v1.4.x）、bubblewrap（沙箱 v1.4.0）、LangChain middleware（运行时审计 v1.3.x）、EnkryptAI（审计护栏 v1.4.x）。

> 🔴 落地纪律：Omnigent 是 Python 运行时，以上是设计启发 + 开源借力，非依赖引入。

### 🔮 DataFlow 参考清单

> 方法论印证见 [PHILOSOPHY §十 · DataFlow](./docs/PHILOSOPHY.md#dataflow顶尖高校独立用harness命名做-agent-约束2026-07-行业印证)。

核心印证：Agent 经受控接口作业 / Request-Validate-Commit 受控变异 / Skills 程序化引导 / Validation Engine / 工件须可审计。可借鉴的 8 项具体落版本见下方「探索方向」表。

> 🔴 DataFlow 只校验 pipeline 结构，不审计 Agent 行为——sofagent 差异化在 A1-A19 行为问责 + 常驻员工 + 控制平面治理。

### 🔮 OpenFDE/ChatDemo 参考清单

> 方法论印证见 [PHILOSOPHY §十 · OpenFDE](./docs/PHILOSOPHY.md#openfdechatdemofde-术语同源佐证2026-07-行业印证)。

| # | 设计 | 优先级 |
|---|---|---|
| 1 | spec-first 硬禁令：单一事实源，transcript 永不直驱代码 | **最高优先** |
| 2 | decisions.jsonl 判断时刻日志 → 决策审计 v1.3.x | **最高优先** · 已成文 |
| 3 | 分级降级梯队（console→TUI→spec，workflow never stops）| **最高优先** |
| 4 | 产品化阈值 + 四类沉淀物硬护栏 | 参考 |

> 🔴 ChatDemo 是售前 POC，无 A1-A19 审计、无常驻员工——sofagent 差异化在行为问责 + 治理。

### 🔮 OpenFDE 主仓 对标借鉴

决策审计 Judgment Unit（`{kind, moment, why, spec_ref}` schema → v1.3.x 意图审计）+ INDUC 阶段化知识归纳 + 产品化阈值/四类沉淀物。详见上方 ChatDemo #2-4。

### 🔮 OpenWorker / aisuite 参考清单（2026-07 · 吴恩达团队）

> 📐 来源：[OpenWorker](https://github.com/andrewyng/openworker)（7.3k stars, MIT）+ 底层引擎 [aisuite](https://github.com/andrewyng/aisuite)。定位 = 桌面 AI 代理（个人单机），与 sofagent（企业约束+审计层）**不在同一层面**，不构成 OpenClaw 替代关系。

**核心印证**：「交付成果而非对话」（outcome not answer）与 sofagent「交付文档而非建议」同源；aisuite `<provider>:<model>` 统一接口 + 国产模型全覆盖，与 sofagent 11 模型供应商方向重叠。

**不构成 OpenClaw 替代**——OpenClaw 承担 sofagent 三个不可替代职能：① 硬安全（加载链/断路器）② Sub Agent 运行时调度 ③ channel 联邦（多设备配对查 knowledge/）。OpenWorker 是单 agent 串行桌面应用，没有这些基础设施层。

| # | 设计启发 | 落地版本 |
|---|---|---|
| 1 | 四级权限模型（plan→interactive→auto→custom）+ `allowed_commands` / `auto_allow` 双白名单 | v1.3.x · FDE sustain daemon 审批机制参考 |
| 2 | 无人值守收件箱：consequential 操作不执行也不阻塞，暂存等批量审核 | v1.2.8 · Scheduled Tasks 配合 daemon 审批 |
| 3 | Tauri 桌面壳（React + Rust，比 Electron 轻量） | v2.x · FDE Dashboard 桌面版评估 |
| 4 | aisuite Agents API：Tool Policies（RequireApprovalPolicy）+ State Stores + Artifacts | 参考 · 运行时审计层设计参考 |

> 🔴 落地纪律：OpenWorker/aisuite 是 Python 生态，以上是设计启发，非依赖引入。

### 🔴 运行时审计演进路线（meta-harness 三问作答 · 2026-07）

> 用户三问：① harness 层能否升级 meta-harness？② 何时能做运行时审计？③ 用 LangGraph create_react_agent 时是否就能做到运行时审计？

**问题①：能否升级 meta-harness？** 能，但分两阶段——
- 当前 harness 层 = SKILL.md 约束底座（注入层）+ 提交时 git diff 21 条规则。与 Omnigent 的本质差异：咱们管「提交时」，meta-harness 管「运行时」。
- 阶段一（运行时审计）：把「提交时审计」延伸为「运行时拦截 + 审计日志」——不替换 harness，而是在 createReactAgent 外面包一层 middleware。
- 阶段二（meta-harness）：多 harness 编排 + 跨会话协作 + 统一策略治理（参考 Omnigent 的 server/agent/session 三档策略）。这是 **v1.5.0** 的事——承接 v1.4.0 沙箱底座（单 SubAgent 沙箱 → 多 harness 统一编排更连贯），不必拖到 v2.x。

**问题②：何时能做运行时审计？**
- 最小运行时审计（工具调用前/后钩子 + 审计日志，复用 engine/rules 的 3 条 tool-gate 规则）：**v1.3.x** 即可（FORGE fresh-eyes-loop 已用 createReactAgent，加 wrapToolCall 钩子）。
- 完整运行时审计（策略强制 + 沙箱 + 状态化拦截，范围限定 SubAgent）：**v1.4.0**（已有规划：「审计引擎从事后扩展到运行时，工具调用中介前置 allow/deny，虚拟 key 边界注入」）。
- meta-harness（多 harness 编排）：**v1.5.0**（承接 v1.4.0 沙箱底座，单 SubAgent 沙箱 → 多 harness 统一编排）。

**问题③：用 create_react_agent 时能否做到运行时审计？** —— **能，但 create_react_agent 本身不做审计，它只提供接入点**：
- 老版 create_react_agent 有「pre_model_hook」/「post_model_hook」（只能拦 model 前后，粗粒度）。
- LangGraph 已用 createReactAgent（TS，@langchain/langgraph），支持「interruptBefore」/「interruptAfter」+ pre/post model hook，可做粗粒度运行时拦截。
- 升级到 LangChain 1.0 的「create_agent」可拿完整 **middleware 系统**：「wrapToolCall」（绕每次工具调用）是运行时审计的**精确接入点**——拦截每个工具调用、记录审计日志、危险操作前要求人工批准。
- **最小闭环方案**：在 createReactAgent 外面包一层 wrapToolCall middleware，把 engine/rules 的 3 条 tool-gate 规则从「编排层静态 gate」升级为「运行时动态拦截 + 审计日志」。可行性：高（FORGE 已跑 createReactAgent，只需加 middleware 层）。这正是 DeerFlow 中间件链 + Omnigent 策略层的同款思路。

### 🔮 a16z AI 管理七法则 印证（2026-07 · 迭代参考）

> 📐 来源：a16z（2026-07-15，Hebbia 创始人 George Sivulka）[《You Just Hired a Million Bad Employees》](https://www.a16z.news/)（原文 URL 待核实）——「人比软件便宜」，解法 = 管理。七法则逐条印证 sofagent 已做对什么、缺什么。

七法则完整映射表（a16z 概念 → sofagent 对应 → 现状 → 落地版本 → 说明）已整理到 [PHILOSOPHY · a16z 印证](./docs/PHILOSOPHY.md#a16z你刚雇了一百万个糟糕员工印证2026-07)。本节仅保留与 ROADMAP 规划直接相关的「落地纪律」结论：

> 🔴 **落地纪律**：①~⑧ 是「用 a16z 术语框定已有/规划能力」，不新增能力范围；⑨ 企业专属 eval 套件产品化 → v1.3.1+（tie 失败清单驱动优化 v1.2.x + RSI 验证体系 v2.x）；⑩ 转型服务规模化 / 多客户并行交付 → tie FDE 陪跑期机制 + PE/VC 多企业审计仪表盘 + FDE Demo Kit 工程化。两者均为真实缺口，挂接既有储备，不凭空造功能。

### 行业研报印证：动态 Agent 组织与 5 阶段风险收敛（2026-07）

- **动态 Agent 组织（Graph 自我改写）**：研报把「Prompt → Loop → Graph」的下一跳定义为「动态 Agent 组织」——图结构能自行改写自身（增删节点/重排依赖）。这是 sofagent 编排层（graph.ts + 进化引擎）的远期探索方向，但需与「约束底座永远在线」共存——动态只在编排层发生，约束/审计层不动。
- **5 阶段落地节奏对照**：研报给出「只读对象层 → 统一状态关系 → 挂载 Method → 开放低风险 Action → 高风险 Action」的渐进路径，核心是**不要一上来就 Agent 自动闭环**。与 sofagent「分阶段风险收敛 + human-in-the-loop 按风险分级」同构，可作为 v1.3.1 Ontology 本体结构落地的节奏参考。

> 📖 来源：温故知新 2026-07-21（行业研报《从提示工程到图系统》《Ontology Runtime 企业级架构落地》）

> 对应产品哲学见 PHILOSOPHY.md §十（行业方法论印证：FDE / Harness 第三方佐证）。

---

## 探索方向

| 方向 | 一句话 |
|------|------|
| workflow 外部模板扩充 | 引入 BPMN 2.0 / Coze / Dify 作为行业流程参考 |
| 企业 AI 节点知识库 | 多设备蒸馏记忆聚合到企业 NAS，知识库管理员 Agent 自动分类 |
| Agent 疲劳度检测 | 监控上下文窗口污染和决策质量衰减信号 |
| 双闸验证 | 工具执行前 gate + 执行后副作用复查 |
| SMB 场景审计扩展 | 审计从代码开发扩展到数据处理/报表生成 |
| 组织记忆主动调取 | Agent 接任务前先检索 think.md 共享版 |
| 异步长任务自治 | daemon 从文件监控升级为长任务自主运行 |
| PE/VC 多企业审计仪表盘 | 投后管理场景——所有被投企业的 AI 审计数据汇总到一个面板，投后团队统一监控 |
| FDE 陪跑期机制 | 部署后前 2 周 AI 节点 daily review，人类反馈和 AI 反思双向写入 think.md |
| 国标 Agent 审计对位 | 关注国家 AI 智能体互联标准草案进展（截至 2026-07 仍为征求意见稿阶段），标准正式发布后评估 sofagent 审计规则的合规对齐 |
| **自带净水设备的水龙头（v3.x-v4.x+ 远景）** | Subagent 内置 workflow 专属精调小模型，零投喂、本地推理、离线可用——防投喂的终极工程落地 |
| **Agent 身份码（v1.1.0）** | 国标草案中唯一明确「后续转强制」的方向。v1.1.0 预研——标准仍在制定中，落地取决于国标正式发布 |
| **RSI 验证体系（v2.x+ 远期储备）** | 递归漂移（Recursive Drift）是 RSI 核心障碍。验证体系 = 分治式子 Agent + 多路径冗余校验 + RL 同步训练裁判防"奖励黑客"。当前漂移率 10% 量级，目标降到 0.1% 以下——解题/验证分离思想已近期吸收（ARCHITECTURE §二），RL 裁判训练远期储备 |
| **FDE 双团队模型（储备）** | Echo（领域专家发现）+ Delta（工程师快速原型）双团队配对 + demo 驱动 + 产品团队作泛化引擎。作 FDE 模型补充参考 |
| **WB 企业版竞品对标（商业化储备）** | 席位全生命周期管理（离职自动释放）+ 成本三维核算（部门/项目/成员）+ 统一采购合规 + 审计追踪+安全沙箱 + 知识资产沉淀。商业化方向参考 |
| **市场信号验证（OpenFDE 信号库 · 2025-2026）** | 据 OpenFDE 信号库 P2 扫描（indices 0-11，均 Anthropic 系动态）记录的四起市场动作，佐证 FDE-as-a-Service / Services-as-Software 方向被资本验证，强化 sofagent FDE 通用能力化 + Services-as-Software 对外叙事说服力（非技术变更，纯定位/竞品补充）：① Anthropic 收购 Fractional AI（FDE 即服务 M&A 实证）；② Accenture×Anthropic 3 万人受训含 FDE（最大规模 FDE 标准化培训）；③ Blackstone+H&F+Goldman 共建企业 AI 服务公司（Services-as-Software 资本化）；④ Anthropic 接入 Palantir FedStart（AI 厂商借力合规底座） |
| **FDE Demo Kit 工程化（储备）** | 演示 FDE Agent 能力范式：7 行业 demo + demo 隔离 + IaC/CI-CD + 可追溯部署 + 权限演示。FDE demo 工程化参照标杆 |
| **Agent 执行层实时治理（Runta 参考 · v1.3.1+，仅 SubAgent）** | syscall/网络/凭证边界实时拦截，**范围限定 sofagent 自派 SubAgent 沙箱**（主 Agent 永远事后审计，不做实时拦截）；凭证虚拟 key 中介（host 边界注入）。详见 [ARCHITECTURE.md 行业框架对齐章节](./docs/ARCHITECTURE.md)（外部框架对标含 Runta） |
| **LangSmith 可观测性集成（开发者可选 · 不进产品核心）** | LangSmith 是 LangChain 生态的 Agent 可观测性平台。**定位：开发调试工具，不是产品组成部分**——就像用 Chrome DevTools 调试网页，但不把 DevTools 打包进产品。开发阶段设 `LANGSMITH_TRACING=true` + `LANGSMITH_API_KEY` 获得推理级 trace（免费 5,000 traces/月）。**不作为 sofagent 产品的依赖**——Dashboard 基于 sofagent 自带的 jsonl 状态文件（git diff + usage.jsonl + progress.jsonl），不依赖闭源商业服务。SDK 是 MIT 开源，平台服务闭源收费——企业想用自己集成，不在 MIT 仓内内置 |
| SkillHub → 单人闭环多岗（阿里 OPT） | 对标阿里 OPT（One Person Team）——单人 + agent skill + 企业系统 → 闭环完成多岗工作 |
| 规则文件独立只读（焊死的门 · v1.3.x） | 约束规则文件独立于 Agent 工作区，只读挂载，Agent 不可篡改——根治「AI 改测试掩盖错误」 |
| **SkillScan 确定性安全扫描器（v1.4.x · DeerFlow 启发）** | A9 注入检测局限的分层补充——纯正则覆盖不了 leet speak（`1gn0r3`）/ Unicode 同形字 / Base64 编码绕过。DeerFlow 用确定性扫描器（Phase 1 离线，无 Semgrep 依赖）做第一道，语义分析留后续。sofagent 可借鉴：先做确定性扫描层，LLM 辅助检测推 v1.4.x+ |
| **Agentic Browser 工具层（v1.4.x · DeerFlow 启发）** | FDE Agent 做"网页审计巡检"AI 节点时的现成方案——Playwright 全套（navigate/snapshot/click/type/screenshot）+ SSRF 防护默认开启。sofagent 可封装为 MCP tool，供 SubAgent 做网页内容审计 |
| **TUI Terminal Workbench（v2.x 产品化 · DeerFlow 启发）** | 补强感知层——用户不开 Agent 平台就能看审计历史/跑 doctor/看知识库状态。DeerFlow 的 TUI 是嵌入式运行（不需要 Gateway/Docker），键盘驱动 + slash 命令面板。sofagent TUI 应更轻（纯 Node，读 `~/.sofagent/data/` 目录），符合零依赖调性。性价比最高的产品化补强 |
| **轻量 Web UI / Dashboard（v2.x 产品化 · DeerFlow 启发但不照抄）** | DeerFlow Web UI 功能完整（流式 Markdown/对话分支/工作区徽章/设置面板），但部署重（Nginx+Gateway+Postgres 起步 8C16G）。sofagent Dashboard 保持轻量单页（Vite+React 读 `~/.sofagent/data/` 目录），不引入重部署依赖。对话分支（完成回合可分支为新对话）是关键交互 |
| **产品进化叙事（产品化 · DeerFlow 启发）** | DeerFlow 专门写"一开始是 Deep Research 框架，社区跑出了新玩法，所以重写成 Harness"。sofagent 有完整 v0.x→v1.2 进化史（10+ 版本），可写成同样的故事进 README 或 PHILOSOPHY——感染力远胜功能列表 |
| **Subagent 内置专精小模型（v3.x-v4.x+ 远景 · "自带净水设备的水龙头"）** | 四阶段：① v1.2.x 架构预留（Subagent 定义加 `inference` 字段支持调 Ollama）→ ② v3.x 工具链（`sofagent-model distill`，用 workflow 运行日志微调专属小模型）→ ③ v4.x 本地推理（业务 workflow 默认跑本地精调模型；代码/强推理等高价值智能任务直连云端最强 LLM，本地小模型只覆盖业务 workflow 场景）→ ④ v4.x+ 离线节点（USB key = 完整 AI 节点，不联网、不走大厂、零投喂——数据主权的终极形态）。详见 River 比喻概念体系（本地 Desktop 概念稿 `sofagent-river-比喻概念体系-2026-07-21.md`，未入仓）§3.2。为什么不是 v2.x 做工具链：微调是数据工程，需要足够多的真实 workflow 日志才有训练燃料；v2.x 还在铺多设备协同和 Dashboard，数据积累不够 · 🔴 术语纠正：这里不是「从 72B 大模型剪枝/蒸馏」——剪枝/蒸馏/量化是大厂造小基座的上游技术（Qwen2.5-0.5B 已是蒸馏+剪枝+量化后的开源产物，直接拿）。sofagent 做产业链下游最后一环：下载已开源小基座 → 用企业 workflow 数据 **QLoRA 微调**（4-bit 量化基座 + 低秩适配器；不动基座参数）→ 教它这一个 workflow。CLI 名 `distill` 是品牌叫法，实际动作是 QLoRA 精调 · 🔴 **后训练定位**：QLoRA 精调属「领域后训练（domain post-training）」的一环，是参数高效微调（PEFT）的一种；区别于基模厂商发布前的通用后训练（SFT + RLHF 等对齐），sofagent 做的是企业侧领域适配 · 🔴 **分层模型策略定稿（2026-07-25 孔老师拍板）**：不做"一个模型跑所有 workflow"，也不做"每个 workflow 一个专职小模型"——做 **Harness 分层路由**（三层模型 + 数据主权驱动）。核心洞察：云端大模型把自然语言 Prompt 翻译成标准化任务指令，摘出本地模型能做的部分交给本地执行，数据不出内网。0.5B 的甜区 = 约束完善后的管道执行（模板填充/格式转换/字段提取），不需要理解自然语言；7B 负责多步 workflow 执行（读写 Excel + 调工具）；32B/云端负责复杂规划推理。核心驱动力 = 数据主权：企业数据进 API key 大模型 = 一定被拿去训练，沙盒也拦不住（已有客户硬件代码出现在 AI 输出中的真实案例）。分层让敏感数据只在本地处理，通用知识才走云端 · 32B 量化后 ~32G 显存单台 RTX 5090 可推理；9B 微调一台 5090 够用；0.5B Mac Mini 可跑 · 🔴 **v3.x 优先级论证（2026-07-25 确认）**：阿里/钉钉会议验证 Skill 廉价化危机——豆包/Hermes 已能自动生成 Skill，以 Prompt 形式出现的产品形态将被模型吞噬。Skill 只是入口（初级交付，数千元），企业专属小模型才是护城河（高阶交付，数十万元）。v3.x 从"远景"应提升为"战略必争" · 工具链 TypeScript CLI（`sofagent-model`）封装 Python 训练引擎 + node-llama-cpp 推理，项目工程面保持 NodeJS

---

| 借鉴项 | 说明 |
| --- | --- |
| **运行时审计接入点（v1.3.x · LangGraph middleware 启发）** | LangChain 1.0+「create_agent」/「create_react_agent」的 middleware 系统：**wrapToolCall**（绕每次工具调用）是运行时审计精确接入点；node-style hooks（beforeAgent/beforeModel/afterModel/afterAgent）做粗粒度拦截。咱们已用 createReactAgent，包一层 middleware 即可把 engine/rules 的 tool-gate 升级为运行时拦截 + 审计日志 |
| **EnkryptAI Secure MCP Gateway（v1.4.x · 现成护栏库）** | LangChain/LangGraph 的 pre_model_hook / post_model_hook 安全护栏，支持 **audit_only 模式（只记录不阻断）**。可作为 v1.4.x 运行时审计层的参考或集成，省得自研护栏 |
| **LiteLLM 控制平面（v1.4.x · 开源借力）** | BerriAI 开源 LLM gateway（MIT，100+ LLM，240M+ 拉取）：成本追踪 / 预算 / 路由 / 护栏。未来「控制平面」成本与路由层站在这上面，不必自研网关 |
| **OpenWorker 权限模型（v1.3.x · 设计启发）** | 吴恩达团队的四级权限（plan/interactive/auto/custom）+ `allowed_commands` 命令白名单 + `auto_allow` 工具白名单。FDE sustain 模式 daemon 审批可直接参考这套分级；无人值守收件箱（consequential 操作暂存等批量审核）配合 Scheduled Tasks v1.2.8 |
| **bubblewrap / seatbelt 沙箱（v1.4.0 · 开源借力）** | Omnigent 同款 OS 级沙箱原语（Linux bwrap+seccomp / macOS seatbelt）。SubAgent 沙箱执行环境的「工具调用中介 + 虚拟 key 边界」可直接复用，省得自研沙箱底座 |
| **ACP 开放协议（观察 · 不押注）** | Agent Client Protocol（LSP 式，Omnigent 在用）— meta-harness 开放接入标准。标准化赢面大于厂商锁定，未来接入层可对齐 ACP 而非自造协议 |
| **Conductor 轻量多 agent 编排（观察）** | 比 Omnigent 轻量的多 agent 编排验证方案，先于完整 meta-harness 验证「多 agent 并行」价值 |
| **Cloudflare Agent Runtime / Vercel（观察）** | 云端 runtime 与算力分离的多 provider 格局，未来 SubAgent 云端执行可参考 |
| **MLflow agent 评估（v2.x · 开源借力）** | Databricks 开源（Apache-2.0），50+ agent 评估指标 + LLM-as-Judge。FORGE fresh-eyes-loop 缺量化「Agent 行为评审标准」，可进 v2.x 评估框架参考 |
| **可视化 DAG 编辑（v2.x 产品化 · DataFlow 启发）** | Dashboard v2.x 引入 workflow DAG 画布，双模态共享状态（会话 Agent + DAG 画布实时同步同一 pipeline 表示），把 workflow 编排从纯文本/Markdown 升级为可拖拽、可检查、可回滚的可视化图——补 sofagent 缺的「workflow 可视图」 |
| **ontology I/O schema 硬化（v2.x · DataFlow 启发）** | 将 ontology 从目录级升级为带 JSON Schema 校验的约束图，硬化每个 workflow 节点的输入/输出形状，变异前拦截不兼容——与 audit A1-A19 同源的事前约束 |
| **工作状态 per-node 遥测（v1.2.2/v2.x · DataFlow 启发）** | 借鉴 DataFlow 按算子统计（执行名/成功率/耗时）的遥测思路，SubAgent 状态卡具体化 per-node 遥测：成功率/平均耗时/任务名——让「工作状态」栏从"在不在跑"升级为"跑得好不好" |
| **分层模型多模型编排抽象（v3.x · DataFlow 启发）** | 借鉴 DataFlow 的多模型适配层（claude/codex/cursor），为 v3.x 分层模型（云端32B规划+本地7B执行+管道0.5B）引入多模型适配层，统一不同模型供应商接入 |
| **MCP 暴露 ontology / audit（v2.x+ 集成协议 · DataFlow 启发）** | 提供对外 MCP 集成协议，让外部 Agent 经受控接口读写 ontology 与审计记录（而非自由脚本），对齐 ACP 思路；Dashboard 后端经 MCP 喂数据，与 §六 控制平面打法同源 |
| **变异前必先读最新状态铁律（v1.x 铁律 + v2.x 实现 · DataFlow 启发）** | 借鉴 DataFlow「每轮合成前先拉取最新 pipeline 状态」的设计，正式立为铁律：任何 workflow 变异前必先读取最新状态（含人工改动），避免并发/陈旧状态导致的不一致——FORGE session 监控已有雏形 |
| **ontology 组合约束图（v2.x · DataFlow 启发）** | 借鉴 DataFlow 的组合约束（算子兼容图：模态匹配/字段流约定），ontology 从"节点目录"升级为"节点兼容约束图"，显式声明哪些节点可前后衔接 |
| **workflow 构建蓝图（v2.x · DataFlow 启发）** | 借鉴 DataFlow 的过程蓝图（推荐构建序列），将 SKILL 正式化为 workflow 构建蓝图——给定目标时推荐节点选择/参数配置/组装步骤序列，减少语义错误 |

> 以下「分层模型架构」为探索方向的核心技术骨架展开——回答 v3.x "怎么做"，而非 "做什么"。

## 分层模型架构（v3.x 技术骨架 2026-07-25 定稿）

> 核心驱动力：**数据主权**。企业数据进 API key 大模型 = 一定被拿去训练，沙盒也拦不住。分层让敏感数据只在本地处理。

### 三层模型 + Harness 路由

```mermaid
graph TB
    subgraph "云端 · 规划层"
        A[用户自然语言 Prompt] --> B{Harness 路由器}
        B -->|复杂规划/推理| C[云端大模型 32B+]
        C -->|翻译成标准化任务指令| D[JSON Task Schema]
    end

    subgraph "本地 · 执行层"
        D -->|多步 workflow 执行| E[本地 7B 模型]
        E -->|每步审计 + 回滚| F[Harness 审计引擎]
    end

    subgraph "本地 · 管道层"
        D -->|固定模板/格式转换/字段提取| G[本地 0.5B 模型]
        G -->|快速执行| H[结构化输出]
    end

    C -.->|失败 fallback| E
    E -.->|失败 fallback| C
```

### 各层职责与选型

| 层 | 模型规模 | 职责 | 硬件门槛 | 数据安全级别 |
|----|---------|------|---------|------------|
| **规划层** | 32B+ / 云端 API | 复杂规划 · 长上下文推理 · 多轮对话 · **Prompt→标准化指令翻译** | 无（API 调用） | 通用知识/脱敏数据 |
| **执行层** | 7B-9B | 多步 workflow 执行 · 读写 Excel · 调用工具 | 单台 RTX 5090 | 企业业务数据（不出内网） |
| **管道层** | 0.5B-1B | 模板填充 · 格式转换 · 字段提取 · 规则化任务 | Mac Mini | 所有数据（含核心机密） |

### 0.5B 的甜区（2026-07-25 孔老师洞察）

0.5B 不需要理解自然语言指令。它的甜区是：**约束做够后的结构化执行**。

云端大模型负责把自然语言翻译成标准化任务指令（JSON schema），0.5B 只管执行这个指令。它不需要"听懂"人话，只需要"见过这种模式就能照着做"。需要理解自然语言、需要跟人多轮交互的部分，那是大模型的活。

**后训练对小基座的甜区约束**：0.5B 经领域后训练后，甜区仍只覆盖**管道层**（模板填充 / 格式转换 / 字段提取）——后训练强化「见过这种模式就照着做」，但抬不动基座的智力天花板。真实企业 workflow（多步执行、读写业务系统、调用工具）需 7B-9B 后训练（执行层）；复杂规划推理仍需 32B / 云端（规划层）。即「后训练 ≠ 小模型包打天下」：后训练放大的是窄域执行力，不是通用智能。选型原则与 §各层职责 一致（阿里 P9 验证：0.5B 撑不住企业 workflow，至少 6B-7B，最好 32B）。

### 数据分流 = 安全分级

| 数据类型 | 走哪层 | 为什么 |
|---------|--------|--------|
| 公开信息 / 通用知识 | 规划层（云端） | 不敏感 |
| 企业业务数据（报表/合同/绩效） | 执行层（本地 7B） | 核心资产，不能进 API |
| 企业核心机密（财务/股权/客户名单） | 管道层（本地 0.5B）+ 权限审计 | 最高级别 |

### 为什么不做"一个 32B 搞定一切"

| 维度 | 一个 32B 跑所有事 | Harness 分层路由 |
|------|------------------|-----------------|
| 成本 | 每企业上一台 5090（~2.5 万） | 大量低成本任务由 0.5B 吃掉（Mac Mini 可跑） |
| 延迟 | 32B 推理慢 | 0.5B 推理速度是 7B 的 10 倍以上 |
| 可审计性 | 黑盒跑完所有事，出问题难定位 | 每层都有审计 + 回滚 |
| 数据主权 | 数据必须过大模型 API | 敏感数据只在本地处理 |
| 渐进部署 | 一上来就得买 GPU | 先用云端 API + Harness，逐步落地本地 |

### 实现难度

路由层本身不难——任务路由（Prompt→标准化指令）、格式定义（JSON schema）、本地模型服务（Ollama）都是成熟技术。真正难的是 v3.x 的 LoRA 精调 pipeline（数据工程，需要足够多 workflow 日志）和 v4.x 的离线 USB 节点（完整 AI 节点封装）。

> 路由层可以提前到 v2.x 做，不依赖精调模型——一开始本地跑通用 7B/0.5B 就行，数据主权保护立刻生效。精调是后来的优化，不是路由的前提。

> **远期演进目标（非当前周期范围 · 2026-07-30 战略讨论）**：分层模型架构是「给企业部署定制模型」的能力骨架。更远的终态是将其**平台化、自动化**——sofagent 从「自训自用」升级为「ontology 驱动的后训练模型自动部署引擎」：自动帮企业基于私有业务做后训练并把模型部署到企业侧，使用者是企业客户。此为**后期迭代阶段目标蓝图，当前完全不具备该能力**，不视为本期/近期计划。> 来源：产品战略讨论 2026-07-30（尚未实现）。
> **远期训练主体与部署逻辑（非当前周期范围 · 2026-07-30 战略讨论）**：后训练由 **sofagent 引擎（Harness + 进化引擎 + 训练流水线）跑脚本**完成；被训练基座为开源模型，训练发生在**企业侧**（数据不出域、BYOK）；交付物为部署在企业侧的定制模型，企业是真正使用者。此为后期迭代蓝图，当前不具备。> 来源：产品战略讨论 2026-07-30（尚未实现）。
> **远期技术底座（非当前周期范围 · 2026-07-30 温故知新）**：上述「后训练模型自动部署引擎」的训练技术底座 = **LoRA / 低秩适配（PEFT 参数高效微调）**——引擎部署在企业侧，驱动开源基座做领域后训练，只训练低秩适配器、不动基座参数（与前文 §Subagent 内置专精小模型「QLoRA 微调」一脉相承：QLoRA = 4-bit 量化基座 + LoRA 适配器）。此为远期蓝图锚点，**当前完全不具备该能力**，不视为本期/近期计划。> 来源：学习笔记《大模型 LoRA 低秩适配技术原理深度解析》2026-07-29（尚未实现）。
> **远期训练质量闸门（非当前周期范围 · 2026-07-30 温故知新）**：后训练最常见的翻车原因是**过拟合**——典型信号是训练集准确率 98% 但验证集仅 65%，业界判据为训练/验证表现差距超 10%。行业已验证三道治理闸门，恰好对应 sofagent 的三引擎：① **数据飞轮**（持续回流失败案例做训练燃料，制造业跑 3 个月业务适应性 +41%）→ 进化引擎（eval failures → think.md → 下一轮）；② **影子部署**（新旧模型并行比对，提前发现 12% 异常场景）→ 审计/回溯引擎（快照 + diff）；③ **测试金字塔**（缺陷逃逸率从 27% 降到 8%）→ 回溯回放。一句话：过拟合不是模型太聪明，而是数据太贫瘠——sofagent 沉淀的 workflow 失败案例正是对抗它的燃料。此为远期训练蓝图锚点，**当前完全不具备该能力**。> 来源：学习笔记《大模型微调过拟合深度拆解》2026-07-30（尚未实现）。

---

## 不需要的

以下认真考虑过但决定不做。完整设计禁区见 [PHILOSOPHY §八](./docs/PHILOSOPHY.md#八不做什么设计禁区)。

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

→ [CONTRIBUTING.md](./CONTRIBUTING.md)

---

## 长期叙事：Conway/Coase 双重反转

> **Conway 定律反转**：传统软件架构反映组织沟通结构。Agent 时代出现反转——Agent 架构（谁做什么、怎么协作）开始**反向塑造企业组织形态**。阿里巴巴 OPT 已观察到这一趋势：单人 + Agent Skill + 企业系统 → 闭环完成多岗工作，传统部门边界被 Agent 能力边界替代。
>
> **Coase 定理反转**：企业存在的经济学理由是内部交易成本低于市场。当 Agent 将内部协调成本降为零，企业的边界开始模糊——一个人借 Agent 能做成的事，不再需要一个部门。"企业"从组织结构变成一个 Agent 能力矩阵。
>
> sofagent 的终局：**Ontology（业务世界模型）+ SkillHub（跨岗能力）+ 审计引擎（责任确权）= 让单人 + 硅基构成的最小闭环单元，替代传统多部门协作。**
## 历史架构演进

编排引擎从 ao → DeepAgents → LangGraph 的升级史（v1.2.0 起 FORGE loop 已完全弃用 deepagents，改用 createReactAgent；历史编排引擎的 DeepAgents 调度原型见 v1.1.8 changelog）、Ontology 从实体关联到本体结构的渐进构建、外部框架对标（Palantir/gbrain/WeKnora/Runta）、Loop Engineering 全栈对照等详见 **[ARCHITECTURE.md](./docs/ARCHITECTURE.md)** 的「行业印证」+「编排引擎」+「Ontology 本体结构」章节，以及各版本 **[开发日志](./docs/changelog/)**。

> 📖 多设备同步方案见 [多设备同步指南](./docs/guides/multi-device-sync.md)。

## 中期方向：FDE 节点注册表（Pattern Registry）

loop-engineering 社区将 7 个生产模式编入机器可读 `patterns/registry.yaml`（含 id/cadence/risk/skills/human_gates/token cost），使工具能自动工作。**sofagent 可做**：为 FDE 模板建 `fde-registry.yaml`，audit 引擎可直接读取——从手动排查到机器可读。

> 📖 来源：cobusgreyling/loop-engineering（MIT 开源）— [patterns/registry.yaml](https://github.com/cobusgreyling/loop-engineering/blob/main/patterns/registry.yaml)

## 远期方向：执行层面隔离（Worktree 模式）

loop-engineering 要求每个 code-change 跑在隔离 git worktree 里——一次 fix 一个 worktree，拒绝则丢弃。这是 sofagent **当前明确的差距**。实现路径：**短期（v1.x）** 在 DEVELOPMENT 中记录为推荐实践 → **中期（v2.x）** 编排引擎内置 `sofagent worktree create` → **远期（v3.x+）** L2+ 硬性要求。

> 📖 来源：cobusgreyling/loop-engineering（MIT 开源）— [primitives.md](https://github.com/cobusgreyling/loop-engineering/blob/main/docs/primitives.md) / [anti-patterns.md](https://github.com/cobusgreyling/loop-engineering/blob/main/docs/anti-patterns.md)

## 远期方向：理解债务应对策略（Comprehension Debt）

loop-engineering 的 Comprehension Debt Spiral（理解债务螺旋）被评为 S2 级故障模式：速度上升但无人能解释变更 → 自动化成了黑箱。sofagent 的应对：**审计已覆盖**「发生了什么」→ 需新增「为什么这么做」（auto-PR 描述中要求 Agent 解释决策）→ 需新增「本周摘要」（daemon 周报）。核心认知：理解债务是工具的边界，不是失败——自动化越高，人类判断责任越大。

> 📖 来源：cobusgreyling/loop-engineering（MIT 开源）— [failure-modes.md](https://github.com/cobusgreyling/loop-engineering/blob/main/docs/failure-modes.md)
