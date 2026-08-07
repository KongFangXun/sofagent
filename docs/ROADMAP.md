# 路线图 · Roadmap

> 已经做了什么、未来要去哪、哪些地方需要你的帮助。
> v1.2.8 · 2026-08-06（UTC）· 🔗 激活链 Phase 3 前半（dag-runner 企业 Agent）+ FORGE 全 loop 接入 audit + release-gate F 修复者

产品定位详见 [设计哲学](./PHILOSOPHY.md) 和 [README](../README.md)。

## 现在在哪：v1.2.8（已交付）

> **v1.2.8 交付内容**：
> **记忆事实级分层** + **Scheduled Tasks MVP**（cron+once / 暂停/恢复/触发/历史/删除）
> **ToolOutputBudget 中间件化**（工具输出截断 + 安全裁剪配对）
> **🔗 激活链 Phase 3 前半**：dag-runner 扩展支持企业 Agent + 新增 `node-executor.ts` + `run-enterprise` CLI 子命令
> **🚪 release-gate-loop 新增 F（修复者）角色**：V 验证 FAIL 后触发 F 读 verdict→定位根因→改代码→跑 audit→回到 V 重验，形成验-改循环（最大 3 轮）
> **🔍 FORGE 全 loop 接入 audit（dogfooding 铁律）**：fresh-eyes b-fix + release-gate F 步骤改完代码必须跑 `sofagent-audit --diff`，不通过打回
> **⏸️ FORGE Checkpoint/Resume（轮级）**：driver-base saveResumePoint/loadResumePoint 原子写入 + 容错读取
>
> 📖 [v1.2.8 开发日志](./changelog/v1.2/v1.2.8.md) · 完整版本历史见 [CHANGELOG](../CHANGELOG.md) 和 [迭代历程](#迭代历程)

> ✅ **企业采购阻塞项 · Webhook 推送已于 v1.2.1 交付**：v1.1.6 接通 webhook **PASS/WARN/FAIL 三态推送**，v1.2.1 补齐企业协同平台（飞书/钉钉/企微）完整 Webhook 推送能力（见 SECURITY.md「审计结果推送」）。采购阻塞项已解除。

---

## 迭代历程

完整版本历史见 [CHANGELOG](../CHANGELOG.md)。v0.x 为实验/测试版，v1.0.0 起为正式版。

| 版本 | 核心交付 |
|------|------|
| **v1.2.8** | 记忆分层 + 定时任务 + 🔗 激活链 Phase 3 前半（dag-runner 企业 Agent + node-executor + run-enterprise CLI）+ 🚪 release-gate-loop F 修复者（验-改循环）+ 🔍 FORGE 全 loop 接入 audit（dogfooding）+ ⏸️ Checkpoint/Resume 轮级断点 |
| **v1.2.7** | 编排引擎增强（Session Goals `/goal` + `/compact` + Skill 渐进加载 + doctor --repair + FORGE driver-base + enterprise-graph StateGraph 构建 + --support-bundle + One-Line bootstrap.sh + Agent Mailbox）+ 🔗 激活链 Phase 2 后半 |
| **v1.2.6** | 🔗 激活链 Phase 2 前半（映射表 + 注册扩展）+ MCP 交付链路修补（daemon_status/list_agents/list_concepts/hitl_resolve 四 tool 三处注册）+ 文档死链清零（74 处）+ README Deployment Sizing |
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
>
> ✅ **已完成阶段**：ACTIVATE（v1.2.5）→ ORCHESTRATE（v1.2.6-v1.2.7）→ EXECUTE 前半（v1.2.8）

> 🔴 **阻塞项占位纪律**：任何 🔴 采购 / 合规阻塞项必须在下表占据一个**明确的版本单元格**（标注具体版本号），不得仅写在散文备注里。

| 版本 | 状态 | 核心交付 | 日志 |
|------|:--:|------|:--:|
| **v1.2.9** | 🔨 开发中 | **🔧 FORGE Driver 短任务化 + ⏸️ Checkpoint/Resume 升级 + 🏠 PM2 守护 + 🔗 激活链 Phase 3 后半**：① 短任务化——a-check/b-check 从"1 worker 跑 12 视角"拆成"12 独立 worker 各跑 1 视角"（5-8 次工具调用）② Checkpoint/Resume 从轮级升级为 worker 级断点（`completedWorkers: string[]`）③ PM2 守护进程（脱离 session 生命周期，崩溃自动重启+日志持久化+开机自启）④ 激活链 Phase 3 后半（HITL 中断处理 + 每节点执行后自动审计 + 异常处理）⑤ 工程债务——mcp-server.ts 1899 行拆分 | [日志](./changelog/v1.2/v1.2.9.md) |
| **v1.3.0** | 📋 规划中 | **运行时审计最小闭环 + 🔗 激活链 Phase 4 收尾（SUSTAIN）**：① wrapToolCall middleware 包 createReactAgent ② engine/rules 3 条 tool-gate 规则升级为运行时拦截 + 审计日志 ③ 危险操作前人工批准钩子 ④ 复用 FORGE 已跑 createReactAgent ⑤ 审计日志按 git 仓库隔离 ⑥ 决策审计 Judgment Unit（emitDecision + kind-wise back）⑦ **🔗 激活链收尾**：全链路验证（activate→compose→run→HITL→audit→sustain）+ wrapToolCall 自动覆盖企业 Agent + FDE SKILL.md 新增 activate 引导 ⑧ **list_rules** MCP tool（tool-gate 规则透明化，覆盖度审计缺口补全） | [日志](./changelog/v1.3/v1.3.0.md) |
| **v1.3.1** | 📋 规划中 | **Ontology 本体结构 + 国标对齐 + 并行编排 + Agent 身份码 + 跨设备审计聚合 + 🚀 Onboard Agent L1**（详见 [下方详解](#v131--ontology-本体结构操作型本体论落地)） | [日志](./changelog/v1.3/v1.3.1.md) |
| **v1.3.2** | 📋 规划中 | **🚀 Onboard Agent 完整版（L2-L5 · FORGE 产品化第二刀）**：① L2 语义判定（Ontology 判据）② L3 自动定位（LLM 推理）③ L4 自动修复（审计兜底）④ L5 循环收敛（回归+连续 PASS） | [日志](./changelog/v1.3/v1.3.2.md) |
| **v1.3.3** | 📋 规划中 | **L2 团队协作协议（五大机制）+ ✨ Refine Agent 完整版**：① 协作协议——共享态/意图广播/触发反应/冲突消解/反馈放大 + 团队状态管理 ② Refine Agent——复用 Onboard 循环引擎，判据从 Ontology 换成质量规则集（好不好），五层一次交付 | [日志](./changelog/v1.3/v1.3.3.md) |
| **v1.3.4** | 📋 规划中 | **L3 组织能力市场（发布→发现→调用→评价）**：Skill/Agent/流程打包发布 + 目录检索 + 调用挂载 + 评分聚合（评分 × 调用量加权自然选择）+ 全程审计 | [日志](./changelog/v1.3/v1.3.4.md) |
| **v1.3.5** | 📋 规划中 | **自进化与运维闭环（MCP 覆盖度审计缺口补全）**：`run_ab_test` / `promote_ab`（晋升强制人审）+ `snapshot_list` / `snapshot_restore`（恢复强制人审） | [日志](./changelog/v1.3/v1.3.5.md) |
| **v1.4.0** | 📋 规划中 | **SubAgent 完整沙箱执行环境 + 场景驱动权限体系 + 代理网关硬边界 + 数据静态加密**：① 沙箱——虚拟文件系统隔离 + 网络出站白名单 + 工具调用中介（前置 allow/deny）+ 虚拟 key 凭证边界注入 + AsyncSubAgent + 真·实时 A/B 双跑 ② 场景驱动权限体系（身份→场景匹配→风险等级→放行）③ 代理网关硬边界（唯一出入口）④ 数据静态加密（age）——审计从「事后」扩展到「运行时」（范围限定 SubAgent） | [日志](./changelog/v1.4/v1.4.0.md) |
| **v2.0** | 📋 规划中 | **引擎层接口外化**：① 约束导出通道（审计规则导出为机器可读标准格式）② Workflow 标准格式 + 运行容器 ③ Ontology 标准 Schema + 注册接口 ④ 审计规则插件化（24 条规则从硬编码改为可外部注册）。前置依赖：v1.3.1 Ontology 落地 + v1.4.0 沙箱底座就绪 | — |

#### v1.3.x 里程碑拆分

> 运行时审计最小闭环（v1.3.0）是 v1.3.x 第一刀：不替换 harness，只在 createReactAgent 上加 middleware 层。完整运行时审计（策略强制 + 沙箱 + 状态化拦截）仍留 v1.4.0；meta-harness 多 harness 编排已前移到 v1.5.0（承接 v1.4.0 沙箱底座）。

| 版本 | 主题 | 核心交付 |
|------|------|------|
| **v1.3.0** | **运行时审计最小闭环（LangGraph middleware）** | ① wrapToolCall middleware 包 createReactAgent ② engine/rules 3 条 tool-gate 规则升级为运行时拦截 + 审计日志 ③ 危险操作前人工批准钩子 ④ 复用 FORGE 已跑 createReactAgent ⑤ 审计日志按 git 仓库隔离 ⑥ **list_rules** MCP tool（详见 开发日志 ./changelog/v1.3/v1.3.0.md）|
| **v1.3.1** | **Ontology + 并行编排 + 身份码 + Onboard L1** | 见上方主表 + [Ontology 详解](#v131--ontology-本体结构操作型本体论落地) |
| **v1.3.2** | **🚀 Onboard Agent 完整版（L2-L5）** | L2 语义判定（Ontology 判据）+ L3 自动定位（LLM 推理）+ L4 自动修复（审计兜底）+ L5 循环收敛（回归+连续 PASS）（详见 开发日志 ./changelog/v1.3/v1.3.2.md）|
| **v1.3.3** | **L2 团队协作协议 + ✨ Refine Agent** | 协作五大机制 + Refine Agent 完整版（质量规则集判据，复用 Onboard 循环引擎）（详见 开发日志 ./changelog/v1.3/v1.3.3.md）|
| **v1.3.4** | **L3 组织能力市场** | 发布→发现→调用→评价 + 评分聚合自然选择 + 全程审计（详见 开发日志 ./changelog/v1.3/v1.3.4.md）|
| **v1.3.5** | **自进化与运维闭环（MCP 覆盖度审计缺口补全）** | `run_ab_test` / `promote_ab` + `snapshot_list` / `snapshot_restore` 四个 MCP tool（详见 开发日志 ./changelog/v1.3/v1.3.5.md）|
| **v1.3.6-v1.3.9** | 🔒 弹性预留 | 紧急修复 / 探索项按需取用 |

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

**v1.3.1 完整交付清单**：① 本体结构升级为可运行推理底座（对齐 24 条审计规则 + Ledger-Views-Policy）② 三层落地法（统一元模型 → 企业通用 Ontology 规范 → 与 Agent 平台打通）③ 国标对齐 GB/T 48000.3-2026 ④ **并行编排**——LangGraph 原生 DAG 并行（StateGraph + Send API），每波次经审计节点（★Reality Anchor）卡关，git worktree 隔离（v1.2.3 底座），幂等性保证 ⑤ **Ontology CRUD 补全**——`update_entity`/`delete_entity`/`delete_concept` 三个 MCP tool ⑥ **Agent 独立身份码 + KYA 完整版**（Ed25519 签发/验证）+ 跨设备审计轨迹聚合 + MCP `agent_identity`/`audit_trail` tool ⑦ **🚀 Onboard Agent L1（FORGE 产品化第一刀 · 工程判定层）**：企业 AI 节点 activate 后自动跑一轮 → crash/error 判定 → 报错人工修 → 再跑

> 🔗 **Graph Engineering 定位**：sofagent 已经在做 Graph Engineering——`engine/orchestrator/src/loop/graph.ts` 用 LangGraph StateGraph 实现 `START→engineer→audit→reviewer→human_confirm→END`，`audit` 节点即 ★Reality Anchor（真实 git diff 24 条规则作 guard edge）。v1.3.1 的「控制图多循环 DAG 波次并行」是这一定位的自然延伸。理论框架详见 [VALIDATION](./VALIDATION.md) 和 [ARCHITECTURE §Graph Engineering 视角](./ARCHITECTURE.md#graph-engineering-视角控制图--stategraph)。

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
- **🔴 Skill 廉价化危机（2026-07-25 阿里/钉钉会议验证）**：豆包已能自动生成 Skill、Hermes 能给自己生成 Skill → 以 Prompt 形式出现的所有产品形态都将被模型吞噬。引擎层对策见上方第 4 点（能力封装进 Subagent + 防投喂机制）。
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

SaaStr 创始人 Jason Lemkin 算清了 FDE 模式的单位经济账：FDE 年薪 $135K–$200K+，一名 $200K 的 FDE 管 3–5 个企业账户，仅工程费即**每客户 $40K–$67K/年**，加差旅与利润后**每部署年成本 $75K+**。对 20–50 人、$2M–$10M 营收的中小企业，这笔实施费占营收 1-4%（还没算 AI 工具本身），无法 justify——55% 的 SMB 称成本是最大采用障碍。

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
| ATTRIBUTION 归因引擎（v2.x） | 追踪审计决策→业务指标的因果链，依赖 v1.3.1 跨设备审计聚合数据积累 |
| Dream Sandbox 沙盒审计（v2.x） | Agent 操作先在平行空间模拟运行，人类审批后点「合并」才生效——约束从事后升级为事前（来源：Palantir AIP） |
| **自带净水设备的水龙头（v3.x+ 远景）** | Subagent 支持挂载外部精调小模型（引擎层提供路由与加载插槽），零投喂、本地推理、离线可用 |
| **Onboard Agent（FORGE 产品化 · v1.3.1 L1 + v1.3.2 L2-L5）** | 把 FORGE 验证的「元循环」能力泛化——企业 AI 节点生成后，自动调试到跑通（activate→run→audit→fix→re-run）。从「给自己用」变「给客户用」|
| **Refine Agent（FORGE 产品化第三刀 · v1.3.3）** | Onboard Agent 让节点「能用」，Refine Agent 让节点「好用」——复用 Onboard 循环引擎，判据从 Ontology 换成质量规则集 |
| 国标 Agent 审计对位 | 关注国家 AI 智能体互联标准草案进展，标准正式发布后评估对齐 |
| 异步长任务自治 | daemon 从文件监控升级为长任务自主运行 |
| 双闸验证 | 工具执行前 gate + 执行后副作用复查 |
| Agent 疲劳度检测 | 监控上下文窗口污染和决策质量衰减信号 |
| **SkillScan 安全扫描器（DeerFlow 启发）** | 安装第三方 Skill 前静态扫描注入/越权风险（v1.4.x） |
| **Agentic Browser / Playwright（DeerFlow 启发）** | Agent 驱动浏览器做端到端操作，与「智能 E2E 测试 Agent」探索同源（v1.4.x） |
| **TUI / Dashboard / 对话分支（DeerFlow 启发）** | 终端 UI + 可视化面板 + 对话分支回溯（v2.x 远景） |
| **spec-first 硬禁令（OpenFDE 启发 · 最高优先）** | 单一事实源——transcript 永不直驱代码，spec 才是唯一驱动（设计约束） |
| **decisions.jsonl 判断时刻日志（OpenFDE 启发 · 最高优先）** | 每次判断落 `{kind, moment, why, spec_ref}`，决策审计底座（v1.3.x 意图审计） |
| **分级降级梯队（OpenFDE 启发 · 最高优先）** | console→TUI→spec 逐级降级，workflow never stops（韧性设计） |
| **Durable Execution（Pydantic AI 启发）** | 长任务 checkpoint 续跑——与回溯引擎互补（回溯=向后回滚，Durable=向前续跑），v1.3.1-1.4.0 窗口评估 |

> 📖 DeerFlow / OpenFDE 方法论印证见 [VALIDATION](./VALIDATION.md)。

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

核心驱动力 = **数据主权**（企业数据进 API key 大模型 = 一定被拿去训练）。三层模型 + Harness 路由：云端 32B+ 负责规划推理 → 翻译成标准化指令 → 本地 7B 执行多步 workflow → 本地 0.5B 跑管道层（模板/格式/字段提取）。敏感数据只在本地处理，通用知识才走云端。**引擎层只做模型路由（model-router.ts 已有四档插槽），精调 pipeline 属模型层非开源范围。** 路由层可提前到 v2.x 做（不依赖精调模型），离线 USB 节点是 v3.x-v4.x+ 的工作。完整技术骨架（Mermaid 图 + 选型表 + 实现难度）见 [产品战略讨论记录 2026-07-25/30](./PHILOSOPHY.md)。

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
