# 路线图 · Roadmap

> 已经做了什么、未来要去哪、哪些地方需要你的帮助。
> v1.2.0 · 2026-07-24（UTC）· 物理结构大重构（/sofagent/→/engine/ + SKILL 收敛 + 发版工具链归 LOOP + install.sh 提根 + rules 独立包）· 规划：v1.2.x（编排隔离底座：并行 SubAgent git worktree 隔离）→ v1.3.0（并行编排 / 控制图波次并行）→ v1.4.0（完整沙箱执行 + 生产级编排）

产品定位详见 [设计哲学](./docs/PHILOSOPHY.md) 和 [README](./README.md)。

## 现在在哪：v1.2.x 规划中

> **物理结构大重构已完成（v1.2.0）**：`/sofagent/` → `/engine/` 目录重命名 + Skill 收敛到 `/SKILL/`（harness/ + agents/ + custom/ 三层结构）+ 发版工具链归入 `LOOP/releaser/` + install.sh 提升根目录 + engine/rules/ 独立规则引擎包。v1.2.x 方向：编排隔离底座（并行 SubAgent git worktree 隔离）+ Dashboard 原型 + Skill 分层升级策略实现。
>
> 📖 [v1.2.0 开发日志](./docs/changelog/v1.2.0.md) · 完整版本历史见 [CHANGELOG](./CHANGELOG.md) 和 [迭代历程](#迭代历程)

> 🔴 **企业采购阻塞项 · Webhook 推送优先级上调**：v1.1.6 已接通 webhook **PASS/WARN/FAIL 三态推送**（本地 agent 自测可用），但推送到企业协同平台（飞书/钉钉/企微）的**完整 Webhook 能力仍规划在 v1.2.x**（见 SECURITY.md「审计结果推送」）。对需通过企业安全采购评审的客户，Webhook 推送是**采购阻塞项**——建议从 **v1.1.9 起优先排期**，而非等到 v1.2.x，以免卡住企业订单。

---

## 迭代历程

完整版本历史见 [CHANGELOG](./CHANGELOG.md)。v0.x 为实验/测试版，v1.0.0 起为正式版。

| 版本 | 核心交付 |
|------|------|
| **v1.2.0** | 物理结构大重构（/sofagent/→/engine/ + SKILL 收敛 + 发版工具链归 LOOP + install.sh 提根 + rules 独立包） |
| **v1.1.9** | 产品叙事收敛（FDE Agent）+ USB 完整运行时 + daemon A/B 自动调度器 + 控制图状态抽取 + v1.1.8 BugFix 42 项 |
| **v1.1.8** | 安全层加密配对 + 联邦查询 + Prompt 注入防护补齐 + 编排引擎串行版（DAG 并行规划在 v1.3.0） |
| **v1.1.7** | Dream Cycle 6 阶段 + sensitivity + 知识健康巡检 + 知识可观测性：gbrain 精简 pipeline 替换旧脚本 + knowledge 敏感度分级（缺省 internal）+ knowledge-health 5 项检查（@weekly）+ `knowledge status` 聚合命令 |
| **v1.1.6** | BugFix 21 项 + LLM Wiki 3 层分层 + conflict-check：v1.1.5 遗留全数修复 + Ledger-Views-Policy 显式化（详见 [`docs/llm-wiki-mapping.md`](docs/llm-wiki-mapping.md)）+ daemon 知识健康巡检（矛盾/孤儿/死链） |

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

两条路径：**FDE 驻场部署**（传统中小企业，FDE 进场→四阶段十二步流程→交付→撤离）和 **开发者自部署**（开源社区，git clone→install.sh→审计→CI 集成）。

设备端形态：安装时自动带 OpenClaw，审计结果通过 MCP server 推到企业协同平台。**数据主权在设备**——所有记忆、日志、决策记录永不离开本地。

---

## 版本规划

> 以下带状态版本表为权威源；各版本详细子节见下方 `###`。

### 规划版本

| 版本 | 状态 | 核心交付 | 日志 |
|------|:--:|------|:--:|
| **v1.1.9** | ✅ 开发完成 | **产品叙事收敛 + BugFix + USB + A/B + 控制图**：① 叙事收敛——对外从"Harness 中间件 + FDE 工具包"转为"FDE Agent（由 sofagent 引擎驱动）"；Harness 叙事降级为开发者文档里的实现说明；模板市场 已物理迁出至 商业仓库/模板市场/。② v1.1.8 发布后 42 条 BugFix（6 P0 + 15 P1 + 21 P2）。③ USB 完整运行时（Node 便携版 + 启动脚本 + HMAC 签名 + knowledge/ AES-256 磁盘加密 + 零残留）。④ daemon A/B 自动调度器（探索-利用循环，ab-scheduler 四阶段状态机 + ab-history jsonl + cron `ab-schedule` 分支）。⑤ 控制图状态抽取（checkpoint → ControlGraphState，version:'v1' schema 供 v1.2.x Dashboard 消费）。测试 863→909（11 包全绿，QA 第 1 轮 906 + BUG-1 修复回归 2 + POC-6 碰撞消除 1）；版本 bump 留 releasing SOP | [📖](./docs/changelog/v1.1.9.md) |
| **v1.2.0** | ✅ 已发布 | **物理结构大重构（/sofagent/→/engine/ + SKILL 收敛 + 发版工具链归 LOOP + install.sh 提根 + rules 独立包）🎉**：① **结构重构**——`/sofagent/` 内层目录 → `/engine/`（底座引擎改名）；Skill 从 4 处散落收敛到根目录 `/SKILL/`（fde/audit/engineer/reviewer/releaser + sofagent 约束底座）；`install.sh` 提升到根目录；模板市场 物理移出 MIT scope 到商业产品目录；engine/rules/ 独立规则引擎包。② 端到端全功能验证（LOOP + Dream Cycle + 联邦查询 + 加密）+ gbrain 行业对标 + USB key 产品故事写入主文档 + 兜底修复。v1.2.x 完整多设备协同的起点 | [📖](./docs/changelog/v1.2.0.md) |
| **v1.2.x** | 📋 规划中 | 完整多设备协同——**L2 团队协作协议**：共享态/意图广播/触发反应/冲突消解/反馈放大五大机制，从单人约束到团队协作；**L3 组织能力市场**：Skill/Agent/流程在企业内发布→发现→调用→评价，高频高价值自然胜出。+ Agent 独立身份码 + 跨设备审计轨迹聚合 + 场景驱动权限体系 + 代理网关硬边界。**🔮 探索**：路由器式配网（边缘设备 WiFi 热点 + 手机端配置网页，仅用于初始配置，配置完成后回归纯 LUI）+ **协议中立**（审计层只走 MCP 等开放协议和 git diff/JSONL/Markdown 开放格式，不为任何单一平台写专属集成——不绑定平台，平台不绑定审计） + **编排隔离底座（git worktree 轻量形态）+ 波次拓扑可视化（控制图视角，随 dashboard 交付，详见子里程碑）** | — |

#### v1.2.x 里程碑拆分

| 版本 | 主题 | 核心交付 |
|------|------|------|
| **v1.2.1** | **收口验证** | ① P2 端到端 mock 验证（联邦查询 + Dream Cycle + AES/ECDH + sensitivity 过滤，单机 mock 两设备）② gbrain / LLM Wiki 架构对标（WebSearch 公开资料 + diff 分析写入 changelog 对标小节）③ P3 T03-T05（WorkBuddy hook 注入 rules 引擎实现 + 验证）④ P4 P0 剩余（knowledge-health 合并为统一巡检模块，输出健康度评分 + 问题清单）|
| **v1.2.2** | **能力深化** | ① P4 P1（分层巡检 L1/L2/L3 + 读写回路对标 + skillopt 自动触发）② FDE Dashboard 原型（`.sofagent/` + `{企业名}/` 数据源对接）③ Skill 分层升级策略 install.sh 实现（安全升级/强制覆盖/diff 合并三策略）|
| **v1.2.3** | **知识进化** | ① P4 P2（conflict-check CLI + 联邦蒸馏 + OAG 方法论吸收）② Agent 独立身份码探索 ③ 跨设备审计轨迹聚合 |
| **v1.3.0** | 📋 规划中 | **Ontology 认知底座 + 国标对齐 + 并行编排**：① 本体即认知底座——将 Ontology 统一层从「描述事实如何被理解」升级为「可运行推理底座」（对齐 LLM + Harness 规则 A1-A11、A14-A19 + 记忆 Ledger-Views-Policy）；② 三层落地法（统一元模型 → 企业通用 Ontology 规范：命名/版本/验证 → 与 Agent 平台打通）；③ 国标对齐 GB/T 48000.3-2026《标准数字化 第3部分:本体建模要求》作为审计/Ontology 层合规参考基线；④ **编排引擎并行调度（Graph Engineering 视角：控制图多循环 DAG 波次并行）**：基于 v1.1.8 的 DeepAgents subagents 调度原型，新增 DAG 依赖解析（Kahn 波次拓扑）+ 并行扇出/扇入（LangGraph `Send` API）+ 循环依赖检测 + 失败传播策略 + 超时熔断；每波次经 audit 节点（★Reality Anchor，真实 git diff 作 guard edge）卡关，并行 SubAgent 文件隔离由 v1.2.x 的 git worktree 隔离底座提供 | — |
| **v1.4.0** | 📋 规划中 | **SubAgent 完整沙箱执行环境 + 生产级编排**：将 orchestrator 内置为完整的沙箱运行时——虚拟文件系统隔离（FilesystemBackend + virtualMode）、网络出站白名单、**工具调用中介（前置 allow/deny，非仅审计追踪）**、**虚拟 key 凭证边界注入（真实凭证 host 边界注入，SubAgent 只拿临时虚拟 key）**、AsyncSubAgent（远程 Agent Protocol 服务端）+ 真·实时 A/B 双跑（候选方案并行执行实时对比，替代当前日志统计法）。**并行 SubAgent 文件隔离**：git worktree 轻量形态已于 v1.2.x 落地，v1.4.0 升级为完整沙箱隔离 + 多 Sub Agent 文件竞争检测。审计引擎从「事后」扩展到「运行时」（**范围限定 SubAgent，主 Agent 仍事后审计**） | — |

### v1.2.0 — 记忆/知识层升级（认知底座铺垫）

> 💡 **v1.2.0 是 v1.2.x 主题线的第一刀**：把 gbrain / LLM Wiki / Palantir 操作型本体论的外部验证吸收为「方法」（分阶段记忆整合、分层巡检、读写回路对标），不吸收其「定位」（不变成 agent runtime，不走集中式 Ontology OS）。详细 scope / 交付拆分（P0/P1/P2）/ 边界见 [v1.2.0 开发日志](./docs/changelog/v1.2.0.md)。

🛡️ **差异化铁律（对标时必守）**：gbrain 是「agent 自己的脑」，Palantir Ontology 是「企业级操作层」，sofagent 是「约束中间件」（数据主权 + 第三方独立 + MIT 可审计）。吸收方法，不吸收定位；不建自动化 diff 任务，发版前由架构评审顺带 diff 一次 gbrain 的 dream-cycle / skillopt / Palantir 的 OAG 进展，结论进当版 changelog「行业对标」小节。

### v1.2.x — 完整多设备协同（规划中）

> 💡 **多 Agent 协同已在 v1.x 完成**：v1.0.3 FDE Sub Agent + Audit Sub Agent 并存 → v1.0.4 A/B 自动优化双 Agent 对比。**轻量多设备在 v1.1.0 起步**（经验共享 + 权限作用域化 + daemon 主动巡检）。v1.2.x 做完整版——两件事：**完整多设备协同**（每个 AI 节点独立身份、跨设备审计轨迹可追溯、场景驱动权限体系、代理网关硬边界）和 **Work模板市场 前端**（Web catalog + 社区贡献仪表盘 + 模板 marketplace）。

**ATTRIBUTION 归因引擎（v1.2.x 探索）**：审计能告诉你 Agent 违规了，但不能告诉你哪次正确的审计干预带来了业务价值。ATTRIBUTION 需要在多设备、多客户、长时间尺度上追踪审计决策→业务指标的因果链。

**失败清单驱动 skillopt（v1.2.x 探索）**：积累负面样本——每个 Skill 跑失败时记录失败场景 + 原因 + 正确做法，以负面样本为主要燃料驱动优化。"告诉模型什么做法是错的"比"什么是对的"信息量更大。

**KYA 身份确权（v1.2.x 探索）**：a16z 研判非人类身份:人类 = 96:1，急需 KYA（Know Your Agent）——加密签名凭证将 Agent 与委托人/约束/法律责任深度绑定。sofagent 审计引擎（约束 + 审计 + 归属）本质是轻量版 KYA。

四阶段渐进：协同编排协议（Markdown 优先）→ Agent 发现与注册 → 跨设备任务分发 → 企业 Agent 知识库（多设备蒸馏记忆聚合到企业自有 NAS/云盘，底层用 [Graphify](https://github.com/safishamsi/graphify) 轻量知识图谱）

> 🧠 A2A 协议参考：Google A2A 为多 Agent 协作定义三层——动态服务发现 / 能力契约对齐 / 全状态接力。MCP 解决「脑和手」，A2A 解决「脑和脑」。工程参考：Multica 的 Polymorphic Actor + Session Resumption + Claim-then-Execute 模式为 v1.2.x 的 Agent 独立身份码提供可落地方向。

**双层循环（Loop Engineering）**：

| 循环层 | 时间尺度 | 职责 | 状态 |
|--------|:--:|------|:--:|
| 内层 | 秒-分钟 | Agent 执行 + 审计 + 反思 + 自动纠偏 | ✅ v1.0+ |
| 外层 | 天-周 | Skill 优化 + 知识库沉淀 | v1.2.x 规划 |

**Dream Sandbox 沙盒审计（v2.x 探索）**：Agent 操作先在平行空间模拟运行，人类审批后点「合并」才生效——将约束从事后升级为事前。来源：Palantir AIP，详见 [THANKS](./docs/THANKS.md)。

**v1.2.x 子里程碑 · 编排隔离底座 + 波次拓扑可视化（Graph Engineering 印证）**

> 从 v1.4.0 重沙箱捆绑中拆出**纯 git 原生形态**的并行文件隔离，并补齐用户视角的控制图可视化——这是 v1.3.0「控制图波次并行」的**隔离前提 + 可观测前提**。重沙箱（虚拟文件系统 + 虚拟 key 凭证边界 + AsyncSubAgent + 实时 A/B 双跑）仍留 v1.4.0。

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

### v1.3.0 — Ontology 认知底座（操作型本体论落地）

> 💡 来自 Palantir 操作型本体论系列研报（2026-07）的启发。Palantir 4000 亿美元市值的核心护城河不是"本体论"概念包装，而是 **Action Types 作为类型系统一等公民**——操作语义与数据定义同层建模，LLM 所有调用必须经过本体层定义的 Action 执行，无法绕过直接写库。

sofagent v1.3.0 的 Ontology 认知底座方向与之高度同构，但走**分布式路线**——不建中央本体操作系统，让每个 Agent 自建本体（Ledger-Views-Policy），联邦查询跨设备共享，git diff + audit history 做硬证据链：

| Palantir 做法 | sofagent 做法 | 差异化 |
|------|------|------|
| Action Types 内嵌本体，LLM 调用必经 | A15 约束验证（事后）+ fde.md Policy（事前声明） | 事后审计 + 逐步前移 |
| OAG 五层确定性架构 | Harness 约束底座 + MCP + LOOP 双 Agent | 同构轻量，无需五层就位即可工作 |
| 集中式 Ontology OS，重度物化索引 | 分布式 knowledge/，联邦查询按需获取 | MIT 开源、零锁定、数据主权本地 |
| Markings + CBAC 本体级安全 | sensitivity frontmatter + 跨设备联邦过滤 | 渐进式演进 |

---

## 产品化与商业化方向

> 控制平面打法——卖「能力」不卖「工时」，必须有自己的 MCP + dashboard。

sofagent 的结构性壁垒不在「更聪明的 Agent」（那是大厂在商品化的东西），而在「管住 Agent 的那一层」。产品化方向锁定四条：

1. **卖能力不卖工时**：FDE 从「一种岗位 / 服务」重构成「企业该有的能力」，用 Agent / sub-agent / 产品化封装交给企业，企业自己用、自己落地 AI 化。
2. **MCP + dashboard 必须有**：dashboard 是自有视图（持久可见 + 真相源），MCP 是向外接的桥。Agent 的 LUI + LLM 吞噬一切 → 所以要有 dashboard；dashboard 轻量 → 所以靠 MCP 配合。两者配合才能把「项目」变成「产品」。
3. **open-core 双轨**：内核 MIT 开源（信任 + 分发 + 生态），只卖 dashboard 那层（控制台 / 合规月报 / 告警）。
4. **能力长在代码里，不长在 prompt 里——对抗「模型吞噬一切」**：skill / prompt engineering / context engineering / 以 skill 形式做的 harness engineering，本质都是**文字形式的约束**。每次注入到模型 = 每次投喂 = 每次训练——模型会训练得越来越强，**必然吞噬文字形式的约束**（今天的 Skill 是差异化优势，明天就是模型的内置能力）。sofagent 对策：把 Skill + Harness 能力**封装进 Subagent**（代码级实现，非文字注入）+ **防投喂机制**（防止输入素材变成大模型训练材料）。生存位：细分业务 workflow 上对业务最终结果的可约束性——这个不会被模型吞噬。

**市场信号**（非技术变更，纯定位 / 竞品补充）：
- **FDE-as-a-Service / Services-as-Software 被资本验证**（详见「探索方向 · 市场信号验证」）：Anthropic 收购 Fractional AI、Accenture×Anthropic 3 万人 FDE 受训、Blackstone+H&F+Goldman 共建企业 AI 服务公司、Anthropic 接入 Palantir FedStart。
- **PE/VC 多企业审计仪表盘**（探索方向）：投后管理场景，所有被投企业 AI 审计数据汇总到一个面板。
- **WB 企业版竞品对标**（商业化储备）：席位全生命周期管理 + 成本三维核算 + 统一采购合规 + 审计追踪 + 安全沙箱。
- **🔴 Skill 廉价化危机（2026-07-25 阿里/钉钉会议验证）**：豆包已能自动生成 Skill、Hermes 能给自己生成 Skill → 以 Prompt 形式出现的所有产品形态都将被模型吞噬。Skill 只是入口（初级交付，数千元），企业专属小模型才是护城河（高阶交付，数十万元）。资本叙事四级：Skill(千元) → Workflow 自动化(万元) → 企业专属小模型(数十万元) → "训练小模型的模型"(技术壁垒)。v3.x 从"远景"提升为"战略必争"。
- **私有化部署需求加速（2026-07-25 会议验证）**：客户担心数据被用于训练（已有硬件客户代码出现在 AI 输出中）。U 盘交付模式的"龙虾 U 盘"心理价值——插入即用、拔出即停，制造"盾牌般的物理安全感"。核心卖的不是技术实现，是老板的掌控感。

**待落地**：首个 MVP = FDE Agent + 一个引擎 dashboard（进度 / 合规视图）；商业计划（GTM / 定价 / 买家画像 / 竞争象限）独立私有仓维护，不进本 MIT 库。

**分层落地中型蓝海**
商业化切入上，孔老师倾向「分层落地」而非一刀切：先在中型客户（有真实 workflow、愿为成果付费、但养不起自建 AI 团队）的蓝海市场建立标杆，用 FDE 的「交付企业专有 skill」模式把单点打透，再向大型客户的标准化模块、小型客户的自助模板双向延伸。核心判断是——卖能力不卖工时，控制平面（sofagent 引擎）是底层，业务 workflow 的可约束性才是护城河。

---

## 行业印证

### 🔮 Graph Engineering 印证（2026-07 新概念 · 迭代参考）

> 📐 来源：2026-07 行业新概念「Graph Engineering」——prompt→context→harness→loop→**graph** 的演进（嵌套非替换）；本质 = 设计 loop/process 之间的关系。理论根 = FSM/Statecharts（Harel 1987）。核心构件：**控制图**（node=state, edge=transition, guard edge 守门）+ **数据图**（知识图谱/血缘）+ **★Reality Anchor**（无 anchor = 披着 PM 外衣的幻觉）。实现模式含 DAG 波次拓扑（Kahn）、扇出/扇入、worktree 隔离、可审计状态文件、动态重规划。

sofagent 的编排引擎天然就是「控制图」——`engine/orchestrator/src/loop/graph.ts` 用 `@langchain/langgraph` StateGraph 实现 `START→engineer→audit→reviewer→human_confirm→END`，`audit` 节点即 Reality Anchor（真实 git diff A1-A11、A14-A19 + E1-E4（共 21 条）作 guard edge），`FileCheckpointer` 快照到 `.sofagent/checkpoint/` 即可审计状态文件。数据图天然对应 蓄水池（知识库）+ 市政规划（Ontology）。**所以 sofagent 已经在做 Graph Engineering，只是没用这个词**——后续迭代用其术语框定「并行编排」与「可视化」，不引入新能力。

**可学习的未来迭代（落盘到对应版本）**：① 多循环 DAG 波次并行、② 并行 SubAgent git worktree 隔离、③ 用户视角波次拓扑可视化——三项能力的现状与落地版本已并入上方「版本规划」表（v1.3.0 ④ / v1.2.x 子里程碑 ②·1~②·4、③·1~③·2 / v1.1.9 ③·1），详细拆分见 `### v1.2.x` 与 `### v1.3.0` 子节。此处仅作 Graph Engineering 概念框定，不新增能力范围。

> 🔴 **落地纪律**：① 和 ② 是「用 Graph Engineering 术语框定已有/规划能力」，不新增能力范围；③ 是纯可视化，依赖 dashboard 产品化节奏（v1.2.x 起）。

### 🔮 a16z AI 管理七法则 印证（2026-07 · 迭代参考）

> 📐 来源：a16z（2026-07-15，Hebbia 创始人 George Sivulka）[《You Just Hired a Million Bad Employees》](https://www.a16z.news/p/the-next-ai-goldrush-tokens-loops)——「人比软件便宜」，解法 = 管理。七法则逐条印证 sofagent 已做对什么、缺什么。

七法则完整映射表（a16z 概念 → sofagent 对应 → 现状 → 落地版本 → 说明）已整理到 [PHILOSOPHY · a16z 印证](./docs/PHILOSOPHY.md#a16z你刚雇了一百万个糟糕员工印证2026-07)。本节仅保留与 ROADMAP 规划直接相关的「落地纪律」结论：

> 🔴 **落地纪律**：①~⑧ 是「用 a16z 术语框定已有/规划能力」，不新增能力范围；⑨ 企业专属 eval 套件产品化 → v1.3.0+（tie 失败清单驱动优化 v1.2.x + RSI 验证体系 v2.x）；⑩ 转型服务规模化 / 多客户并行交付 → tie FDE 陪跑期机制 + PE/VC 多企业审计仪表盘 + FDE Demo Kit 工程化。两者均为真实缺口，挂接既有储备，不凭空造功能。

### 行业研报印证：动态 Agent 组织与 5 阶段风险收敛（2026-07）

- **动态 Agent 组织（Graph 自我改写）**：研报把「Prompt → Loop → Graph」的下一跳定义为「动态 Agent 组织」——图结构能自行改写自身（增删节点/重排依赖）。这是 sofagent 编排层（graph.ts + 进化引擎）的远期探索方向，但需与「约束底座永远在线」共存——动态只在编排层发生，约束/审计层不动。
- **5 阶段落地节奏对照**：研报给出「只读对象层 → 统一状态关系 → 挂载 Method → 开放低风险 Action → 高风险 Action」的渐进路径，核心是**不要一上来就 Agent 自动闭环**。与 sofagent「分阶段风险收敛 + human-in-the-loop 按风险分级」同构，可作为 v1.3.0 Ontology 认知底座落地的节奏参考。

> 📖 来源：温故知新 2026-07-21（行业研报《从提示工程到图系统》《Ontology Runtime 企业级架构落地》）

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
| **Agent 执行层实时治理（Runta 参考 · v1.3.0+，仅 SubAgent）** | syscall/网络/凭证边界实时拦截，**范围限定 sofagent 自派 SubAgent 沙箱**（主 Agent 永远事后审计，不做实时拦截）；凭证虚拟 key 中介（host 边界注入）。详见 [ARCHITECTURE.md 行业框架对齐章节](./docs/ARCHITECTURE.md)（外部框架对标含 Runta） |
| SkillHub → 单人闭环多岗（阿里 OPT） | 对标阿里 OPT（One Person Team）——单人 + agent skill + 企业系统 → 闭环完成多岗工作 |
| 规则文件独立只读（焊死的门 · v1.3.x） | 约束规则文件独立于 Agent 工作区，只读挂载，Agent 不可篡改——根治「AI 改测试掩盖错误」 |
| **Subagent 内置专精小模型（v3.x-v4.x+ 远景 · "自带净水设备的水龙头"）** | 四阶段：① v1.2.x 架构预留（Subagent 定义加 `inference` 字段支持调 Ollama）→ ② v3.x 工具链（`sofagent-model distill`，用 workflow 运行日志微调专属小模型）→ ③ v4.x 本地推理（业务 workflow 默认跑本地精调模型；代码/强推理等高价值智能任务直连云端最强 LLM，本地小模型只覆盖业务 workflow 场景）→ ④ v4.x+ 离线节点（USB key = 完整 AI 节点，不联网、不走大厂、零投喂——数据主权的终极形态）。详见 River 比喻概念体系（本地 Desktop 概念稿 `sofagent-river-比喻概念体系-2026-07-21.md`，未入仓）§3.2。为什么不是 v2.x 做工具链：微调是数据工程，需要足够多的真实 workflow 日志才有训练燃料；v2.x 还在铺多设备协同和 Dashboard，数据积累不够 · 🔴 术语纠正：这里不是「从 72B 大模型剪枝/蒸馏」——剪枝/蒸馏/量化是大厂造小基座的上游技术（Qwen2.5-0.5B 已是蒸馏+剪枝+量化后的开源产物，直接拿）。sofagent 做产业链下游最后一环：下载已开源小基座 → 用企业 workflow 数据 **QLoRA 微调**（4-bit 量化基座 + 低秩适配器；不动基座参数）→ 教它这一个 workflow。CLI 名 `distill` 是品牌叫法，实际动作是 QLoRA 精调 · 🔴 **模型选型范围待定**（2026-07-25 讨论）：原定 0.5B-3B（默认 Qwen2.5-0.5B），但阿里企业智能 AI 负责人（P9）判断 0.5B 无法支撑企业级 workflow，至少需 6B-7B，最好 32B。两种路线待权衡：① 小模型路线（≤3B，Mac Mini MLX 可跑，成本低，但能力天花板低）② 中模型路线（6B-32B，需 GPU/RTX 5090，成本高，但能胜任完整 workflow）。32B 量化后 ~32G 显存单台 RTX 5090 可推理；9B 微调一台 5090 够用。任务价值分流不变：代码/复杂推理走云端 LLM，本地小/中模型只覆盖业务 workflow · 训练硬件：小模型路线 Mac Mini（Apple Silicon + MLX），中模型路线需 GPU · 🔴 **v3.x 优先级论证（2026-07-25 确认）**：阿里/钉钉会议验证 Skill 廉价化危机——豆包/Hermes 已能自动生成 Skill，以 Prompt 形式出现的产品形态将被模型吞噬。Skill 只是入口（初级交付，数千元），企业专属小模型才是护城河（高阶交付，数十万元）。v3.x 从"远景"应提升为"战略必争" · 工具链 TypeScript CLI（`sofagent-model`）封装 Python 训练引擎 + node-llama-cpp 推理，项目工程面保持 NodeJS

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

编排引擎从 ao → DeepAgents → LangGraph 的升级史（当前断点：DeepAgents subagents 调度能力尚未接入，v1.1.8 接入）、Ontology 从实体关联到认知底座的渐进构建、外部框架对标（Palantir/gbrain/WeKnora/Runta）、Loop Engineering 全栈对照等详见 **[ARCHITECTURE.md](./docs/ARCHITECTURE.md)** 的「行业印证」+「编排引擎」+「Ontology 认知底座」章节，以及各版本 **[开发日志](./docs/changelog/)**。

> 📖 多设备同步方案见 [多设备同步指南](./docs/guides/multi-device-sync.md)。
