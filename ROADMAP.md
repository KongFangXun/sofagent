# 路线图 · Roadmap

> 已经做了什么、未来要去哪、哪些地方需要你的帮助。
> v1.1.4 · 2026-07-19（UTC）· A18/A19 审计新规则 + LOOP 工具注入 + daemon 可见性 · 规划：v1.1.5-v1.1.9 → v1.2.0 收口

<img src="docs/assets/sofagent.png" alt="sofagent" width="160" />

> 🎯 **sofagent 没有界面。你和它对话，它做完了告诉你结果在哪。** 语言就是界面，MCP 就是入口，输出必须推到用户面前。详见 [设计哲学](./docs/PHILOSOPHY.md)。

> 🎯 **Agent Harness 中间件 + FDE 工具包**——一底座·四引擎（约束底座 + 编排/审计/回溯/进化引擎），不依附任何 Agent 平台，独立做底线守卫。

> 🎯 **开源（MIT）FDE 工具包**：FDE 不是一款软件，而是一种能力——让任意大厂 Agent + 大模型在企业里可治理、可问责地落地。一底座·四引擎（约束底座 + 编排/审计/回溯/进化引擎）做问责底座，帮 **SMB 与 OPC 的每个人**，用自己选的 Agent 和模型，快速成为自己业务的 FDE。

> 🎯 **90%/10% 价值分层**：AI 模型提供 90% 的智力输出，但不提供可靠性和可问责性。最后 10%——让企业敢把任务交给 Agent 自主执行——是 sofagent 提供的。模型越强，这 10% 越值钱。

**FDE 是一种能力，不是软件。** 产品已闭合三种 FDE 能力：

| FDE 能力 | sofagent 产品映射 |
|---------|------------------|
| 掌握完整上下文 | Ontology 统一层 + 记忆系统（单人拿到全量业务世界模型） |
| 打破岗位边界 | SkillHub（单人借 Agent Skill 调动多岗能力 → 阿里 OPT「一人团队」） |
| 对结果负责 | 审计引擎 + 验证门控（交付可追溯、可问责——轻量版 KYA） |

---

## 现在在哪：v1.1.5 📋（规划中）

> **releasing.md SOP 集成 + MCP pipe `audit_file` + MCP knowledge resource + USB federation HMAC**——Agent 按十二阶段 SOP 自动发版（releaser Skill）+ Agent 通过 MCP 编辑的文件也能即时审计（补 v1.1.4 daemon 盲区）+ 7 个 knowledge resource 暴露 + push target 路由 + USB federation 签名校验。同时修复 v1.1.4 审查 9 项 P0/P1 文档漂移 + maxTurns/warn-accumulator/A18/audit history/tools.ts 6 项改进。v1.1.4 pre-push-check 13 通过/1 警告（共 14 项）、660 tests 全绿。
>
> 📖 [v1.1.4 开发日志](./docs/changelog/v1.1.4.md) · 完整版本历史见 [CHANGELOG](./CHANGELOG.md) 和 [迭代历程](#迭代历程)

---

## 迭代历程

> 倒叙排列，每个版本有独立开发日志。v0.x 为实验/测试版，v1.0.0 起为正式版。

| 版本 | 核心交付 | 日志 |
|------|------|:--:|
| **v1.1.4** 🚧 | A18/A19 两条审计新规则（21 条规则集）+ LOOP 工具注入（6 工具）+ daemon 可见性修复 + USB federation + WARN 累积报告 + 8 项审查修复 | [📖](./docs/changelog/v1.1.4.md) |
| **v1.1.3** 🔧 | LangGraph StateGraph 四节点自动流转 + Checkpoint 持久化 + HITL 确认 + 39 项审查修复 | [📖](./docs/changelog/v1.1.3.md) |
| **v1.1.2** 🔧 | LOOP 双 Agent 串联 + Harness 可见性签名 + 多设备同步指南 + 测试体系修复 | [📖](./docs/changelog/v1.1.2.md) |
| **v1.1.1** 🔧 | 双 Agent 串联验证 + 记忆契约代码化 + 多设备同步 + 全仓质量审计收口 | [📖](./docs/changelog/v1.1.1.md) |
| **v1.1.0** 🎉 | 包结构纯度重构（12 包独立）+ 轻量多设备（权限作用域化+经验共享+自迭代周报+daemon 主动巡检）| [📖](./docs/changelog/v1.1.0.md) |
| **v1.0.9** 🔧 | 二进制文件审计（A16-A17）+ 快照时间线 + MCP compose tool + daemon 闭环 + cron 巡检 + A9 中文注入 | [📖](./docs/changelog/v1.0.9.md) |
| **v1.0.8** 🔧 | FDE Agent 自进化（deploy + sustain 双模式）+ 文件系统审计（isomorphic-git + fs-watch）+ 快照回溯 + Agent 定义去耦合 + TencentDB Memory | [📖](./docs/changelog/v1.0.8.md) |
| **v1.0.7** 🔧 | 双节点架构 + Sub Agent 约束自加载 + CLI 编排入口 + ao 完全退役 + A/B 自动切换 | [📖](./docs/changelog/v1.0.7.md) |
| **v1.0.6** 🔧 | 编排迁移 + A/B 真实运行器 + 安全加固 + SkillOpt CLI 修复 | [📖](./docs/changelog/v1.0.6.md) |
| **v1.0.5** 🔧 | Ontology 统一层 + Workflow Hub + A9 分级安全 + A15 绕过修复 + fail-closed 默认安全 | [📖](./docs/changelog/v1.0.5.md) |
| **v1.0.4** 🔧 | 自动优化 + 约束验证：eval harness + Sub Agent A/B 自动优化 + HITL 渐进自主度 + A15 约束验证 | [📖](./docs/changelog/v1.0.4.md) |
| **v1.0.3** 🔧 | 编排引擎重构 + LOOP 自迭代：FDE Sub Agent（DeepAgentsJS+LangGraph+Agency Agents+SkillOpt）+ 4 Agent 定义 + 内外层循环 + 4 验证文件自动优化 + 30 项修复 | [📖](./docs/changelog/v1.0.3.md) |
| **v1.0.2** 🔧 | 文档修正 + 规则对齐：15 项修复 | [📖](./docs/changelog/v1.0.2.md) |
| **v1.0.1** 🔧 | AI 知识库实现版：7 件事（目录骨架/fde 规则/Skill/四层加载链/daemon Ingest/Lint/轮次上限）+ A14 越权审计 + 回归检查清单 | [📖](./docs/changelog/v1.0.1.md) |
| **v1.0.0** 🎉 | 正式版：Agent 审计工具——18 件事 + 408 测试全绿 + 回归检查清单 | [📖](./docs/changelog/v1.0.0.md) |
| *(实验/测试版)* | | |
| **v0.99.9** | AI 知识库概念先行 + verify.ts 拆分（1257→4模块）+ 行业笔记落地 + 理论引证 | [📖](./docs/archive/changelog-experimental/v0.99.9.md) |
| **v0.99.8** | 文档收尾 + FDE 架构重构：FDE 四层→三层实体 + templates 镜像产出 + Skill 精简 | [📖](./docs/archive/changelog-experimental/v0.99.8.md) |
| **v0.99.7** | 发布基础设施修复：CI E403 根治 + OIDC 清零 + mcp 依赖解锁 + shellcheck 清零 + Windows 标注 | [📖](./docs/archive/changelog-experimental/v0.99.7.md) |
| **v0.99.6** | npm 双包发布 + 25 项修复 | [📖](./docs/archive/changelog-experimental/v0.99.6.md) |
| **v0.99.5** | CI 自动化 + npm 发布：NPM_TOKEN 自动发布 + 工具增强 | [📖](./docs/archive/changelog-experimental/v0.99.5.md) |
| **v0.99.4** | 准入诚实化：41 项全面修复，准入 6✅→3✅ 诚实化，doc-vs-reality 清零，闭环→多维 | [📖](./docs/archive/changelog-experimental/v0.99.4.md) |
| **v0.99.3** | 文档校准：16 项一致性清零（术语/幽灵引用/ROADMAP/CI/归档）+ bump-version 修复 | [📖](./docs/archive/changelog-experimental/v0.99.3.md) |
| **v0.99.2** | 18 项修复：daemon 歧义根治 + 死链清零 | [📖](./docs/archive/changelog-experimental/v0.99.2.md) |
| **v0.99.1** | OpenClaw 叙事重写 + YAML→js-yaml + MCP 独立包 + 局限声明修正 | [📖](./docs/archive/changelog-experimental/v0.99.1.md) |
| **v0.99** | v1.0 前收尾：Skill≤90行 + 放弃条件 + MCP Server + verify→TS | [📖](./docs/archive/changelog-experimental/v0.99.md) |
| **v0.98** | 架构重组：产品核心转为事后审计 + FDE 企业部署 + OpenClaw 必装 | [📖](./docs/archive/changelog-experimental/v0.98.md) |
| **v0.97** | 审计 A9/A10/A11 + 编排引擎重构（砍四级深度→两档拆解 + engage.md）+ bash→TS 第二波 + 概念精简 | [📖](./docs/archive/changelog-experimental/v0.97.md) |
| **v0.96** | README 六段式重构（373→166行）+ bash→TS 第一波 + 铁律重排 + 编排定位澄清 | [📖](./docs/archive/changelog-experimental/v0.96.md) |
| **v0.95** | 铁律精简 10→6（4 条移审计层）+ 目录改名 + 三源收敛 + FDE 商业模式 | [📖](./docs/archive/changelog-experimental/v0.95.md) |
| **v0.94** | 6 项代码止血 + --silent 模式 + LogFormat 可插拔 + FDE Skill 部署者优先 | [📖](./docs/archive/changelog-experimental/v0.94.md) |
| **v0.93** | 4 项 FP 修复 + bash→TS 迁移 + 27 cases FP=0% FN=0% + 10 组对照实验 | [📖](./docs/archive/changelog-experimental/v0.93.md) |
| **v0.92** | 安全加固 + 信任模型声明 + 审计 A7 检测加固 + 工程欠债清算 + OpenClaw 对照实验 | [📖](./docs/archive/changelog-experimental/v0.92.md) |
| **v0.91** | sofagent-audit MVP + ARCHITECTURE 瘦身（710→378行）+ COMMUNITY.md | [📖](./docs/archive/changelog-experimental/v0.91.md) |
| **v0.86** | 读写型分流 + Loop 成熟度四问 + 19 项学习笔记约束 + 8 项评审反馈 | [📖](./docs/archive/changelog-experimental/v0.86.md) |
| **v0.85** | 定位校准（「治理」→「纪律」）+ ROADMAP 砍削 + 45 组验证实验设计 + sofagent-audit 方向确立 | [📖](./docs/archive/changelog-experimental/v0.85.md) |
| **v0.82** | 五平台实测 + 步数闸/熔断闸/幂等检查/评判器隔离在非 OpenClaw 平台均不生效确认 | [📖](./docs/archive/changelog-experimental/v0.82.md) |
| **v0.81** | daemon 核心骨架 + 5 项治理加固 + macOS launchd + Linux systemd | [📖](./docs/archive/changelog-experimental/v0.81.md) |
| **v0.75** | 降低试用门槛 + benchmark.sh + 英文 README + Co-maintainer 招募 | [📖](./docs/archive/changelog-experimental/v0.75.md) |
| **v0.74** | 文档拆分去重 + verify.sh --quick + Scoring 基准线 | [📖](./docs/archive/changelog-experimental/v0.74.md) |
| **v0.73** | 三道闸门体系 + 编排加固 + 记忆最小闭环 + scoring 第九维 | [📖](./docs/archive/changelog-experimental/v0.73.md) |
| **v0.72** | README 平台能力表重构 + benchmark.sh + anti-cases | [📖](./docs/archive/changelog-experimental/v0.72.md) |
| **v0.7x** | 企业合规：数据保留 + task/logs 脱敏 + 审计日志 | [📖](./docs/archive/changelog-experimental/v0.75.md) |
| **v0.6x** | 质量加固：端到端测试 + 闭环验证 + WorkBuddy 专家团共存 | — |
| **v0.5x** | 企业级能力：install.sh/uninstall.sh + 离线模式 + 编排 fallback | — |
| **v0.1~v0.4** | 核心约束：4 底线 + 6 铁律 + Loop Agent + 三层闸门 + 渐进减薄 + 反思区 + scoring | — |

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

sofagent 的定位正卡在这个转折点上：审计引擎（治理侧）+ Ontology（能力侧）+ 开源 MIT（供给侧）——三信号缺一不可，单独做任何一个都不够。

两条路径：**FDE 驻场部署**（传统中小企业，FDE 进场→四阶段十二步流程→交付→撤离）和 **开发者自部署**（开源社区，git clone→install.sh→审计→CI 集成）。

设备端形态：安装时自动带 OpenClaw，审计结果通过 MCP server 推到企业协同平台。**数据主权在设备**——所有记忆、日志、决策记录永不离开本地。

### 规划版本

| 版本 | 状态 | 核心交付 | 日志 |
|------|:--:|------|:--:|
| **v1.1.5** | 📋 规划中 | **SOP 自动发版 + MCP pipe `audit_file` + knowledge resource + USB federation HMAC**：releaser Skill（十二阶段 SOP）+ MCP 协议层编辑纳入审计（补 v1.1.4 daemon 盲区）+ 7 个 knowledge MCP resource + push target 路由 + USB federation 签名 + v1.1.4 审查 9 项修复（文档漂移）+ maxTurns/warn-accumulator/A18/audit history/tools.ts 6 项改进 | [📖](./docs/changelog/v1.1.5.md) |
| **v1.1.6** | 📋 规划中 | **LLM Wiki 3 层分层 + conflict-check**：Ledger-Views-Policy 显式化 + daemon 知识健康巡检 | [📖](./docs/changelog/v1.1.6.md) |
| **v1.1.7** | 📋 规划中 | **Dream Cycle 6 阶段 + sensitivity**：gbrain 精简 pipeline 替换旧脚本 + knowledge 敏感度分级 | [📖](./docs/changelog/v1.1.7.md) |
| **v1.1.8** | 📋 规划中 | **安全层 + 联邦查询 + Agent 安全防护**：AES-256-GCM + ECDH 配对 + OpenClaw channel 联邦知识查询 + Prompt 注入 8 层防护体系（指令分层隔离 / 工具动态最小权限 / 后端强制校验 / 敏感数据不进 prompt / RAG 可信分级 / 输出结构化+执行前审核 / 高危动作强制人工确认 / 全链路日志+红队测试——核心原则：模型提建议，系统控执行） | [📖](./docs/changelog/v1.1.8.md) |
| **v1.1.9** | 📋 规划中 | **USB 完整运行时**：Node.js 单文件打包 + OpenClaw 便携化 + 跨平台启动脚本（macOS/Windows/Linux）。U 盘插入 → 双击 start → 联邦在线 → 拔掉零残留 | [📖](./docs/changelog/v1.1.9.md) |
| **v1.2.0** | 📋 规划中 | **多设备知识联邦收口 🎉**：端到端全功能验证（LOOP + Dream Cycle + 联邦查询 + 加密）+ gbrain 行业对标 + USB key 产品故事写入主文档 + 兜底修复。v1.2.x 完整多设备协同的起点 | [📖](./docs/changelog/v1.2.0.md) |
| **v1.2.x** | 📋 规划中 | 完整多设备协同——**L2 团队协作协议**：共享态/意图广播/触发反应/冲突消解/反馈放大五大机制，从单人约束到团队协作；**L3 组织能力市场**：Skill/Agent/流程在企业内发布→发现→调用→评价，高频高价值自然胜出。+ Agent 独立身份码 + 跨设备审计轨迹聚合 + 场景驱动权限体系 + 代理网关硬边界。**🔮 探索**：路由器式配网（边缘设备 WiFi 热点 + 手机端配置网页，仅用于初始配置，配置完成后回归纯 LUI）+ **协议中立**（审计层只走 MCP 等开放协议和 git diff/JSONL/Markdown 开放格式，不为任何单一平台写专属集成——不绑定平台，平台不绑定审计） | — |
| **v1.3.0** | 📋 规划中 | **Ontology 认知底座 + 国标对齐**：① 本体即认知底座——将 Ontology 统一层从「描述事实如何被理解」升级为「可运行推理底座」（对齐 LLM + Harness 规则 A1-A17 + 记忆 Ledger-Views-Policy）；② 三层落地法（统一元模型 → 企业通用 Ontology 规范：命名/版本/验证 → 与 Agent 平台打通）；③ 国标对齐 GB/T 48000.3-2026《标准数字化 第3部分:本体建模要求》作为审计/Ontology 层合规参考基线；④ **SubAgent 沙箱执行环境**：将 orchestrator 内置为完整的沙箱运行时——文件系统隔离、网络出站白名单、工具调用审计追踪——让 LOOP SubAgent 不依赖外部 Agent 平台，自给自足完成代码开发全流程 | — |

---


### v1.2.0 — 记忆/知识层升级（认知底座铺垫）

> 💡 **v1.2.0 是 v1.2.x 主题线的第一刀**：把 gbrain / LLM Wiki 的外部验证吸收为「方法」（分阶段记忆整合、分层巡检），不吸收其「定位」（不变成 agent runtime）。详细 scope / 交付拆分（P0/P1/P2）/ 边界见 [v1.2.0 开发日志](./docs/changelog/v1.2.0.md)。

🛡️ **差异化铁律（对标时必守）**：gbrain 是「agent 自己的脑」，sofagent 是「约束中间件」（数据主权 + 第三方独立 + MIT 可审计）。吸收方法，不吸收定位；不建自动化 diff 任务，发版前由架构评审顺带 diff 一次 gbrain 的 dream-cycle / skillopt，结论进当版 changelog「行业对标」小节。

### v1.2.x — 完整多设备协同（规划中）

> 💡 **多 Agent 协同已在 v1.x 完成**：v1.0.3 FDE Sub Agent + Audit Sub Agent 并存 → v1.0.4 A/B 自动优化双 Agent 对比 → v1.0.5 Agent Dashboard 探索原型。**轻量多设备在 v1.1.0 起步**（经验共享 + 权限作用域化 + daemon 主动巡检）。v1.2.x 做完整版。
>
> v1.2.x 的核心是两件事：**完整多设备协同**（每个 AI 节点拥有独立身份、跨设备审计轨迹可追溯、场景驱动权限体系、代理网关硬边界）和 **Workflow Hub 前端**（Web catalog + 社区贡献仪表盘 + 模板 marketplace）。

**ATTRIBUTION 归因引擎（v1.2.x 探索）**：当前 sofagent 审计能告诉你 Agent 违规了，但不能告诉你哪次正确的审计干预带来了业务价值。ATTRIBUTION 需要在多设备、多客户、长时间尺度上追踪审计决策→业务指标的因果链——"到底哪一次审计干预推动了真实业务结果"。依赖真实企业数据和 v1.2.x 的多设备协同基础设施。

**失败清单驱动 skillopt（v1.2.x 探索）**：当前 skillopt 基于正例（成功任务模式）优化 Skill。更有效的做法是积累负面样本——每个 Skill 跑失败时记录失败场景 + 原因 + 正确做法，daemon 定期汇总为"失败清单"，skillopt 以负面样本为主要燃料驱动优化。"告诉模型什么做法是错的"比"什么是对的"信息量更大。前置设计文档见 [FDE 附录：Skill 质量标尺与编写原则](FDE/FDE.md#附录skill-质量标尺与编写原则)。

**KYA 身份确权 — 审计引擎作为 Agent 责任绑定底座（v1.2.x 探索）**：a16z 研判智能体经济瓶颈从「智力」转向「身份」——非人类身份:人类 = 96:1，急需 KYA（Know Your Agent）：加密签名凭证将 Agent 与委托人/约束/法律责任深度绑定。sofagent 的审计引擎（约束行为 + 变更审计 + 责任归属）本质就是企业内部轻量版 KYA。v1.2.x 评估是否引入签名凭证做 Agent 行动的可审计绑定。

**SkillHub — 向「单人闭环多岗（阿里 OPT）」演进**：当前 SkillHub 定位为 Workflow 模板 marketplace。演进方向是对标阿里 OPT（One Person Team）——单人 + agent skill + 企业系统 → 闭环完成多岗工作。SkillHub 不只是模板库，是「硅基员工进组织架构」的产品化雏形。

**焊死的门——规则文件独立只读（v1.3.x 探索）**：当前 sofagent 的约束规则（SKILL.md / fde.md）以纯 MD 文件注入 Agent 上下文，Agent 可修改自己的约束文件。v1.3.x 评估引入文件系统权限模型——规则文件独立于 Agent 工作区，只读挂载，Agent 不可篡改。这是「AI 改测试掩盖错误」问题的根治方案。

四阶段渐进：协同编排协议（Markdown 优先）→ Agent 发现与注册 → 跨设备任务分发 → 企业 Agent 知识库（多设备蒸馏记忆聚合到企业自有 NAS/云盘，底层用 [Graphify](https://github.com/safishamsi/graphify) 轻量知识图谱）

> 🧠 **技术底座参考 — A2A 协议**：Google A2A（Agent-to-Agent）协议为多智能体协作定义了三个关键层级：① 动态服务发现（Agent 版 DNS——Agent 广播能力，匹配条件者自动响应）、② 能力契约对齐（入参/输出 Schema 握手，消除自然语言歧义）、③ 全状态接力（任务交接时同时移交执行目标 + 前置共识 + 专属记忆）。MCP 解决「脑和手」的工具调用，A2A 解决「脑和脑」的协作分工。
>
> 同时也需防御 A2A 的三大工程雷区：**语义漂移**（多 Agent 链路中每层推理偏差累积导致末端动作与原始需求南辕北辙）、**死循环雪崩**（Agent 互等形成逻辑闭环，数秒内耗尽 Token 预算）、**权限穿透**（低权限 Agent 构造恶意 A2A 请求诱骗高权限 Agent 执行危险操作）。防御方案三板斧：协调者中枢监控 + 强类型 Schema 前置拦截 + 零信任动态令牌——这三条将纳入 sofagent v2.x 的审计规则体系。

> 🛠️ **工程参考 — Multica**：[Multica](https://github.com/multica-ai/multica)（4000+ commits）在 Agent 团队协作的工程实现上有三个可直接参考的模式：① **Polymorphic Actor**——用 `(type, id)` 二元组统一建模人类和 Agent，不区分「人做的」还是「AI 做的」，只关心「谁做了、做到哪了」；② **Session Resumption**——Agent 跨会话恢复工作目录和上下文，不仅反思（think.md），还保留执行环境；③ **Claim-then-Execute**——daemon 用 PostgreSQL `SELECT ... FOR UPDATE SKIP LOCKED` 抢锁认领任务，保证多设备并发下不重复执行。这三个模式为 sofagent v1.2.x 的 Agent 独立身份码 + 跨设备审计聚合提供了可落地的工程参考。

**多 Agent 共享记忆三模式对比**（未做决策，先让讨论可见）：

| 模式 | 机制 | 优势 | 劣势 | 适用场景 |
|------|------|------|------|---------|
| **黑板模式** | 中央共享文件，所有 Agent 读写同一区域 | 简单直观，一致性容易保证 | 单点瓶颈，并发写冲突 | 设备数少、信任度高 |
| **Gossip 协议** | P2P 传播，Agent 间互相同步增量 | 去中心化，容错强 | 最终一致，同步延迟 | 设备多、网络不稳定 |
| **上下文路由** | 按需注入，协调者根据任务匹配相关记忆 | 精准，不浪费上下文 | 需要智能匹配引擎 | 任务边界清晰、记忆量大 |

**双层循环（Loop Engineering）**：

> 来源：Karpathy [AutoResearch](https://github.com/karpathy/autoresearch) + Bilevel Autoresearch 论文。与 ARCHITECTURE 的[三层循环（Andrew Ng 框架）](https://www.deeplearning.ai/the-batch/three-key-loops-for-building-great-software)视角不同——Karpathy 的双层循环关注自动化迭代的深度，Ng 的三层循环关注产品反馈的广度。

当前 sofagent 实现了**内层循环**（Agent 执行→审计→反思→自动纠偏）。v1.2.x 将实现**外层循环**——loop-evaluate 评分驱动 Skill 自动优化，打破 Agent 的先验认知，强制探索本能回避的优化方向。

| 循环层 | 时间尺度 | 职责 | sofagent 对应 | 当前状态 |
|--------|:--:|------|------|:--:|
| 内层 | 秒-分钟 | Agent 执行 + 反思 + 自动纠偏 | entry-gate → task-aware → loop-check → think.md → loop-exit | ✅ v0.99+ |
| 外层 | 天-周 | Skill 优化 + 知识库沉淀 | loop-evaluate → eval.md → AI 知识库 → Skill 自动优化 | v1.2.x |

> 当前 ROADMAP 已有「分布式反思同步」（Gossip 方向）。三模式不是互斥的——实践中可能黑板打底 + 上下文路由按需补充。决策留到 v1.2.x 需求分析时做。

**Dream Sandbox 沙盒审计（探索方向）**：参照 Palantir AIP 的 Dream Sandbox——Agent 操作先在平行空间模拟运行，人类审批后点「合并」才生效，相当于「对现实做版本控制」。当前 sofagent 只能事后 git diff 审计，沙盒审计将约束从事后升级为事前。v2.x 如果企业用户对 Agent 自主操作有安全需求时探索。（来源：Palantir AIP 架构分析，详见 [THANKS.md](./docs/THANKS.md)）

**审批通道分层（探索方向）**：entry-gate 风险分级（v1.x）之上，可探索超时降级（审批 30 分钟无响应 → 自动降级为只读模式还是阻塞？）和防橡皮图章（连续秒批 → 系统警告）。**这是企业级 BPM 功能，不是 Agent harness 层的职责**——v2.x 如果企业用户强烈需求才考虑。

**演化路径**：

| 阶段 | 形态 | 对应版本 |
|------|------|:--:|
| Ralph 循环（真菌） | 状态外化到文件，Agent 本体无状态 | v0.x-v1.0.x |
| Ralph 工厂（轻量多设备） | 自治循环进化——经验共享 + 审计可见 + 权限作用域化 | v1.1.x |
| 有身份 Agent（多设备完整） | 每个 AI 节点有独立身份，跨设备审计聚合，场景驱动权限 | v1.2.x 规划 |
| 无身份 Agent（细菌） | 用完即焚，全新生成，零状态 | v3.x 远景 |

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
| **Agent 身份码（v1.1.0）** | 国标草案中唯一明确「后续转强制」的方向。v1.1.0 预研——标准仍在制定中，落地取决于国标正式发布 |
| **RSI 验证体系（v2.x+ 远期储备）** | 递归漂移（Recursive Drift）是 RSI 核心障碍。验证体系 = 分治式子 Agent + 多路径冗余校验 + RL 同步训练裁判防"奖励黑客"。当前漂移率 10% 量级，目标降到 0.1% 以下——解题/验证分离思想已近期吸收（ARCHITECTURE §二），RL 裁判训练远期储备 |
| **FDE 双团队模型（储备）** | Echo（领域专家发现）+ Delta（工程师快速原型）双团队配对 + demo 驱动 + 产品团队作泛化引擎。作 FDE 模型补充参考 |
| **WB 企业版竞品对标（商业化储备）** | 席位全生命周期管理（离职自动释放）+ 成本三维核算（部门/项目/成员）+ 统一采购合规 + 审计追踪+安全沙箱 + 知识资产沉淀。商业化方向参考 |
| **FDE Demo Kit 工程化（储备）** | 演示工具包范式：7 行业 demo + demo 隔离 + IaC/CI-CD + 可追溯部署 + 权限演示。FDE demo 工程化参照标杆 |

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
| 安全审计 | 不限 | 给 SECURITY.md 挑刺 |
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

> 以下记录了 sofagent 从 v1.0.0 到 v1.1.3 的架构演变过程——编排引擎从 ao 迁移到 DeepAgents 再到 LangGraph 直接控制、Ontology 从实体关联渐进构建到认知底座、以及外部框架对标和行业信号验证。这些不是未来的规划，是已经走过的路。保留在此供新人理解架构的历史上下文。

### v1.x — 发布后

> **v1.0.1-v1.0.9 开发日志**：[v1.0.1](./docs/changelog/v1.0.1.md) → [v1.0.2](./docs/changelog/v1.0.2.md) → [v1.0.3](./docs/changelog/v1.0.3.md) → [v1.0.4](./docs/changelog/v1.0.4.md) → [v1.0.5](./docs/changelog/v1.0.5.md) → [v1.0.6](./docs/changelog/v1.0.6.md) → [v1.0.7](./docs/changelog/v1.0.7.md) → [v1.0.8](./docs/changelog/v1.0.8.md) → [v1.0.9](./docs/changelog/v1.0.9.md)
>
> **v1.0.7 双节点架构**：v1.0.7 起 sofagent 分两种部署节点——**自动运行节点**（OpenClaw 全栈）和**个人增强节点**（第三方 Agent + sofagent，不需 OpenClaw）。Sub Agent 启动时自加载约束（`buildConstrainedSystemPrompt`），不依赖宿主平台 Skill 系统。编排引擎通过 CLI 入口（`sofagent-orchestrator compose --task`）对任意 Agent 平台开放。（完整对照表见 [ARCHITECTURE 双节点架构](./docs/ARCHITECTURE.md#双节点架构)）
>
> **v1.0.8 文件系统审计**：审计引擎从"只有 git commit 才触发"扩展为"任何文件变更都触发"。内嵌 `isomorphic-git`（纯 JS Git，~2MB），daemon 监控文件变更直接跑审计——不需要装 git、不需要 commit。这让审计引擎成为**平台无关的核心能力**，非开发者的 AI 文件变更也能审计。v1.0.9 加二进制文件审计（A16-A17）+ 快照时间线。

#### 编排引擎升级：ao → DeepAgents + Agency Agents

v1.x 的核心架构升级——将编排引擎从自研实验性的 ao，渐进迁移到 LangChain 生态的 [DeepAgentsJS](https://github.com/langchain-ai/deepagentsjs)（LangGraph.js 之上的 batteries-included Agent harness），子 Agent 岗位定义参考 [Agency Agents](https://github.com/msitarzewski/agency-agents)（230+ 岗位模板，含 16 个职能部门 + 企业级 CI/lint 体系）。

**设计哲学**：OpenClaw 负责「连接与行动」（IM 渠道、消息路由），DeepAgents 负责「深度思考」（长任务规划、子 Agent 孵化、状态管理）。ao 验证了「Agent 需要编排层」这个需求，DeepAgents 是生产级实现。

```
OpenClaw 总管（TS）
 ├── sofagent-audit（TS · git diff 硬审计）
 ├── FDE Sub Agent（DeepAgents · 常驻 · 读代码/跑测试/生成手册）
 └── Audit Sub Agent（DeepAgents · 按需 · 语义审查/跨 repo 审计/Workflow 巡检）

依赖链：sofagent → deepagents (npm) → LangGraph.js (内部状态图引擎)
当前状态：v1.1.3 起 sofagent 直接 import @langchain/langgraph（orchestrator 包），DeepAgents 仍间接提供
```

> ⚠️ **LangGraph 能力标注**（诚实声明）：v1.1.3 前 sofagent 不直接使用 LangGraph。v1.1.3 起 orchestrator 直接 import @langchain/langgraph 控制 StateGraph。LangGraph.js 是 DeepAgentsJS 的内部依赖——提供 StateGraph（状态图）、条件路由、checkpoint（持久化）、HITL 中断恢复等能力。sofagent 通过 DeepAgents 的 `createDeepAgent()` 间接获得这些能力，v1.1.3 起同时直接调用 LangGraph API。
>
> **v1.1 计划直接使用 LangGraph 的能力**（需安装 `@langchain/langgraph`）：
> - **StateGraph**：自定义 Sub Agent 的多步骤状态流转（当前 DeepAgents 内部已用，sofagent 未直接控制）
> - **Checkpoint 持久化**：长任务中断后恢复执行状态（当前 launcher.ts 只做心跳检测，不做状态恢复）
> - **条件路由**：根据审计结果动态路由——PASS → 自动合并、WARN → HITL 审批、FAIL → 阻断+回滚（当前硬编码在 reporter.ts）
>
> v1.1 之前，sofagent 对 LangGraph 的"使用"仅限于 DeepAgents 内部封装——sofagent 代码中没有 `import` LangGraph 的任何模块。

**分阶段落地：**

| 阶段 | 版本 | 动作 | 关键依赖 |
|:--:|------|------|------|
| 🔵 引入 | v1.0.1 | `npm install deepagents`（optional）→ launcher.ts 作为 thin wrapper 接入 `createDeepAgent()` | deepagentsjs |
| 🟡 替换 | v1.0.3 | 基于 Agency Agents 模板定义 FDE Sub Agent 岗位（role/workflow/rules/deliverables）→ 定义层完成（registry.ts + YML），编排仍走 ao CLI | agency-agents 模板 |
| 🟢 增强 | v1.0.4 | eval harness + HITL middleware + A/B 对比（单次手动） + A15 约束验证。独立于 DeepAgents | — |
| ⚠️ 过渡 | v1.0.5 | Ontology 统一层 + launcher wrapper 保留，编排仍走 ao CLI。文档诚实降级——不再声称 DeepAgents 全覆盖 | — |
| 🔧 迁移 | v1.0.6 | compose 编排逻辑从 ao CLI 迁到 DeepAgents，ao 降为 fallback。Sub Agent 运行状态基础跟踪 | deepagentsjs |
| ✅ 退役 | v1.0.7 | ao 依赖正式移除。deepagents 提升为正式依赖。A/B 自动切换（连续计数器 + auto promote）。**双节点架构**——Sub Agent 约束自加载（`buildConstrainedSystemPrompt`），CLI 编排入口（`sofagent-orchestrator compose --task`），第三方 Agent 平台无需 OpenClaw 即可用编排引擎 | deepagentsjs → required dep |
| ✅ 直接使用 | v1.1.3 | 直接 import `@langchain/langgraph`——用 StateGraph 自定义 Sub Agent 状态流转 + Checkpoint 做长任务中断恢复 + 条件路由动态决策（PASS/WARN/FAIL → 不同后续动作） | @langchain/langgraph → 直接依赖 |

#### Ontology 渐进构建（企业数字孪生操作层）

借鉴 Palantir Ontology——实体+关系+动作+约束四合一。不放到 v2.x，从 v1.0.1 开始每个版本加一层，自然演化。

| 阶段 | 版本 | 动作 | 说明 |
|:--:|------|------|------|
| 🌱 实体关联 | v1.0.1 | entities/ 页面的 frontmatter 加 `relations` 字段（`has_many`/`belongs_to`/`references`） | 知识库从独立页面变成关联图 |
| 🏗️ 动作定义 | v1.0.3 | Workflow 节点的 YML 加 `actions` 声明——每个节点能对什么对象做什么操作、有什么约束 | Agent 不只是能看什么（knowledge-domain），还能做什么（actions） |
| 🔍 约束验证 | v1.0.4 | 新增 A15 审计规则——Agent 执行的 action 是否在节点声明的 actions 范围内、是否满足 constraints | 事后审计扩展到事前约束检查 |
| 🌐 统一 Ontology 层 | v1.0.5 | `.sofagent/ontology/` 目录——自动从 entities + workflow actions 合并生成，Agent 加载时获得完整世界模型 | FDE 交付的不是文档，是企业数字孪生的操作接口 |
| 🛡️ 防幻觉四方案 | v1.0.5 | Schema Guided（ontology 约束 Action 输出）+ HTRO（High Trust Read Only，只读可信源）+ RAG+溯源（引用必须可追溯到 knowledge/ 页面）+ Action Type 终审（审计层验证 action 类型合规） | 与 A 系列「硬证据」哲学一致 |
| 📄 人类可读 Ontology | v1.0.8 | `sofagent-audit ontology view`——从三个 YAML（objects.yml / actions.yml / constraints.yml）生成人类可读的 MD 摘要 | FDE 离场时交给客户的"企业数字孪生说明书" |
| 🖥️ Dashboard | v1.x | MCP push 三个 YAML → 服务器渲染为 HTML 仪表盘。两个模块——**Ontology 模块**（实体关系图 + 动作矩阵 + 约束拓扑）和 **River 模块**（多个 Workflow 的关联拓扑——River 是 Workflow 的集合，展示如何互联、数据如何回流、如何汇入统一入口） | 从"离场交付一份文档"升级为"离场交付一个可运行的治理仪表盘" |

> 💡 反常识：不到 1000 个高质量 Token 即可构建有效知识图谱——关键不是数据量，是数据质量和约束规则。Ontology 的门槛远比看起来低。
>
> **本体 vs 知识**：AI 业务理解偏差领域有一个精辟定义——"**知识记录业务中发生过什么，本体描述这些事实应该如何被理解和关联**"。sofagent 的 knowledge/ 目录（entities + concepts）记录"发生过什么"，Ontology 统一层（entities→relations→actions→constraints 三路合并）描述"如何被理解和关联"。知识和本体不是一回事，但必须一起工作——这正是 v1.0.1-v1.0.5 渐进构建 Ontology 的设计逻辑。

> **意图债清零收口（v1.0.8 Ontology 收口）**：意图债是输入端反复交代背景的成本（SKILL.md + fde.md 在还这笔债）。v1.0.8 在 Ontology 渐进构建语境下显式闭合三者联动——**SKILL.md 固化规则（意图债清零）↔ fde.md 业务四问（FDE 入场梳理客户业务）↔ Ontology 统一层（客户 workflow 关联）**。FDE 用业务四问建立客户本体，SKILL.md 把规则固化进交付物，Ontology 把关联沉淀为企业数字孪生——意图债在交付闭环中彻底清零。

#### Ontology 认知底座与国标对齐（v1.3.0 规划）

> 来源：GB/T 48000.3-2026《标准数字化 第3部分:本体建模要求》（2026-01-28 发布，2026-08-01 实施）+ 企业 AI Ontology 基石方法论。

**⬜1 本体即认知底座（非静态知识库）**：当前 sofagent 的认知核心是「LLM + Harness 规则(A1-A17) + 记忆(Ledger-Views-Policy)」，Ontology 统一层是「事实如何被理解」的显式层。v1.3.0 将其从"描述层"升级为"可运行推理底座"——本体参与编排决策（Action Type 定级、Domain/Range 约束直接驱动 entry-gate 与 loop 出口），而非仅作文档摘要。sofagent 已非纯静态 KB，此方向是强化而非 pivot。（原拟 v2.x，调整为 v1.3.0——本体推理化是近期可落地的渐进增强。）

**本体论护城河（战略维度）**：Ontology-first 不只是技术正确，更是商业护城河。行业 scale 落地把套路沉淀为固化文档，而大模型厂商可快速将其蒸馏进基础模型瞬间替代——通用 Skill / 模板会被吞噬，企业本体论却因绑定创始人风格与真实业务基因而不可迁移。这是一道"阳谋"：模型越强，越证明企业需要标准化本体，而 sofagent 已占位 Ontology 渐进构建路线。v1.3.0 的对外叙事卖的是"企业专属认知底座"，不是可被吞噬的通用能力。

**Matia 海外验证**：Matia 已在海外跑通企业本体论的落地路径，证明"本体论作为企业 AI 落地核心方案"具备可行性（非纯理论）。作为第三方便捷印证，与 Palantir Foundry（Ontology 驱动企业 OS）、YC FDE Playbook（Ontology 作为最早约束工程）并列，支撑 sofagent Ontology 定位的对外叙事（海外已商业化跑通）。

**⬜2 三层落地法 + 国标对齐**：

| 层 | 动作 | 说明 |
|------|------|------|
| ① 统一元模型 | 对齐 GB/T 五组件（实体类型/数据属性/对象属性/公理/规则） | 补 ontology/README.md 的数据属性与公理 GAP |
| ② 企业通用 Ontology 规范 | 命名 / 版本 / 验证约定 | 让 FDE 交付的企业本体可跨客户复用、可审计 |
| ③ 与 Agent 平台打通 | Ontology 作为编排引擎的世界模型输入 | 不绑定任何平台（Harness 中间件定位） |

**国标对齐操作方式**：不追求把 sofagent 变成"企业本体平台"——定位是**审计标准参考**。具体：① 审计引擎新增"国标条款对位"维度（A 系列规则可追溯到 GB/T 48000.3 相应要求）；② Ontology 统一层输出增加"国标合规摘要"段（哪些组件已建模、哪些 GAP）。标准 2026-08-01 实施后评估落地节奏。

#### 行业信号校准与已验证方向（第二批 6 篇行业笔记 · 2026-07-13）

> 来源：翁荔《AI 安全里的 Harness》(六层模型/价值二分)、执行边界五组件、AI 控制 3 年演进、FDE 中国落地困境、DeepMind 四方对齐、Loop Engineering 全栈。均为**外部验证 sofagent 已选主航道**，非架构转向。

**已验证方向（外部背书矩阵）**：
- **执行边界五组件** ↔ 审计引擎（刹车=entry-gate 拒绝/放弃条件；黑匣子=审计引擎 git+文件系统双源；护栏=审计闭环+放弃条件；隔离带=双节点架构）。**缺口：限速器（频率/规模/额度）维度无显式设计 → 见下 v1.x 设计注记。**
- **Harness 价值二分**（补短板型 vs 现实世界接入型）：sofagent 属"现实世界接入型"——模型越强价值越大，不补模型短板。最强外部背书（翁荔原文同句）。
- **Loop Engineering 全栈**：发现/派活/验证/持久化/调度 五动作 + 六组件 + 六成本，sofagent 近乎 1:1 覆盖（见上方「已实现能力自证」表）。
- **四方对齐**（AI/用户/开发者/社会）：审计引擎证据链已支撑四方问责（见 ARCHITECTURE 四方对齐章节）。

**🟡 设计注记（需立项，非本轮实现）**：
- **限速器（v1.x）**：entry-gate 新增"频率/规模/额度/对象"前置校验——动作级策略（额度/频率/时间窗/风险等级）。执行边界五组件唯一真缺口。挂 v1.x 设计，实现后续做。
- **跨系统隔离带（v2.x 边界注记）**：双节点架构解决"节点间"隔离；但 CRM→财务→云控制台之间的**权限扩散边界**未解——一个系统权限不应无边界扩散到另一个系统。v2.x「场景驱动权限体系 + 代理网关硬边界」设计时一并考虑。

**⬜ 长期项（叙事/定位，非工程）**：
- **AI 控制赛道 2026-2029**：外部信号一致指向"AI 控制将在 3 年内成为安全核心"。sofagent 提前卡位"执行控制"方向正确，作为对外叙事时间窗锚点（2026-2029）。
- **FDE 中国落地困境**：笔记列 5 大障碍（不为探索付费/难盈利/SaaS 渗透仅 15.8%/人才缺失/甲方不信任 95% 失败）。sofagent 用"固定 AI 节点生成企业专有 skill"规避人力 FDE 陷阱——验证 AI-Native FDE 路线正确性。商业化策略参考，非工程任务。（注：项目暂无独立商业笔记文件，此条记入 ROADMAP。）
- **拟人化风险**：叙事护栏——"AI 数字员工进组织架构"需设边界，避免过度承诺自主。与 HANDBOOK 叙事护栏并一处。
- **Self-Improvement 诚实化**：LOOP 自迭代架构（4 Agent）**有效奖励信号必须外生**（环境/人工校验），不暗示自主自我提升。诚实标注于 LOOP 架构处。

#### V2.0 规划（远期架构探索）

> 来源：Agent-to-Agent（A2A）协议设计范式权衡——静态「拓扑」（谁连谁、节点与边的连接关系）vs 动态「循环」（plan→build→deploy→evaluate 反馈闭环）。当前 sofagent 由单一编排引擎管理一条闭环，尚未进入「多 Agent 互相组网的拓扑编排」阶段。

- **拓扑 vs 循环 / 信号密度 > 通讯密度（V2.0 探索项）**：多 Agent 协作时，靠预先画好的静态拓扑路由任务，还是靠动态循环让 Agent 自组织？这是 V2.0 的编排范式决策点。与 v2.x「场景驱动权限体系 + 代理网关硬边界」「Dream Sandbox 沙盒审计」同属远期架构探索，V2.0 立项评估。

#### 记忆分层金字塔集成（v1.0.8）

sofagent 知识库 L0-L2 已有（think.md → entities → concepts），缺 L3 用户画像。TencentDB Agent Memory 补齐这块：

| 层 | sofagent 现状 | TencentDB 对应 | v1.0.8 动作 |
|:--:|------|------|------|
| L0 原始对话 | ✅ think.md | conversations/*.jsonl | 不碰（各管各的） |
| L1 原子事实 | ✅ entities/ | records/*.jsonl + vectors.db | 不碰（sofagent 不依赖外部 DB） |
| L2 场景归纳 | ✅ concepts/ | scene_blocks/*.md | 可选同步到 knowledge/concepts/ |
| **L3 用户画像** | ❌ 缺失 | **persona.md** | **✅ daemon Ingest 同步 + 加载链注入** |

**设计原则**：sofagent 只读 Markdown 产物（persona.md + scene_blocks/），不碰 TencentDB 的 SQLite、不调 HTTP API。单向同步：`~/.openclaw/memory-tdai/` → `.sofagent/knowledge/`。

#### TencentDB 深度集成（v1.x 探索，不实现也没关系）

v1.0.8 只读 Markdown 足够用。如果未来 sub agent 需要实时搜索记忆，可选路径 A（OpenClaw 中间人——launcher.ts 注册 `memory_search` tool）或路径 B（`memory-sdk-ts` 直连远端 Gateway）。不急着做——弱依赖够用的话，这节永远停留在探索阶段。

#### 外部框架对齐（v1.x 全版本基线）

sofagent 不是孤立的——五层架构与以下成熟项目有明确的对应/借鉴关系：

| sofagent 模块 | 对应外部框架 | 关系 | 版本 |
|------|------|------|:--:|
| 审计引擎 | 独立自研——外部无可替代 | 核心差异化 | v1.0 |
| 编排引擎 | [DeepAgentsJS](https://github.com/langchain-ai/deepagentsjs)（v1.0.x 间接使用）+ [LangGraph.js](https://github.com/langchain-ai/langgraphjs)（v1.1 起直接使用 StateGraph + Checkpoint + 条件路由） | 借鉴后替换 ao | v1.0.1-v1.1 |
| Skill 系统 | Agency Agents（岗位模板，v1.0.3）+ SkillOpt（Skill 文档自动优化，v1.0.3）+ eval harness + A/B 对比（Sub Agent 配置自动优化，v1.0.4） | 模板引用 + 对接优化引擎 | v1.0.1-v1.0.4 |
| AI 知识库 | OpenFDE 10 步工作流（行业定位验证）+ Google OKF（同构独立验证）+ CAG 第 7 代 RAG（同构验证）+ Glean 工业数据（1.7万页/召回~100%） | 外部验证 | v1.0-v1.1 |
| 安全设计哲学 | gstack 六层安全栈（分类器 / fail-closed / 原子写 / 密钥格式持续更新） | 实践参照 | v1.0.4-v1.0.5 |
| 企业世界模型 | Palantir Ontology（实体+关系+动作+约束） | 概念借鉴，渐进构建 | v1.0.1-v1.0.5 |
| 记忆分层金字塔 | TencentDB Agent Memory（L0-L3 四层 + 双轨存储 + 符号化压缩） | 只读 Markdown 产物集成 | v1.0.8 |
| Harness 理论基础 | Hugging Face 实验 + ICML 2025 + Harness Engineering 三代演进（Prompt→Context→Harness）+ LangChain/Codex/gstack 工业验证 | 多重验证 | v1.0 基线 |
| 任务路由 + Skill 组合 | Router+Skill 架构（行业评估为性价比最高方案） | task-aware 路由与 sofagent 方向一致 | v1.x 基线 |
| 文档理解 / RAG | [WeKnora](https://github.com/Tencent/WeKnora)（腾讯微信对话开放平台开源，MIT，Go+Python，v0.7.0） | 潜在下游能力——RAG/ReAct Agent/Auto-Wiki/多模态文档解析。sofagent 是 Harness（管 Agent），WeKnora 是 RAG 平台（跑任务），非竞品。无 NPM/TS SDK，只能 MCP/REST/CLI 集成。三步走详见[下方专节](#weknora-集成三步走文档理解rag-能力补位) | v1.2.x 评估 |

#### WeKnora 集成三步走（文档理解/RAG 能力补位）

> 来源：腾讯微信对话开放平台开源项目 WeKnora（v0.7.0，2026-07-17，MIT，[GitHub](https://github.com/Tencent/WeKnora)）。调研时间 2026-07-19。**WeKnora 和 sofagent 不在同一层，是潜在下游能力，不是竞品**——sofagent 是 Harness 中间件（管 Agent），WeKnora 是 RAG 知识平台（跑任务的 Agent）。

**为什么值得看**：WeKnora 的工程化程度（企业级 RBAC + Langfuse 可观测性 + 契约测试 + MCP/CLI/REST 三套对外接口 + 20+ LLM 集成 + 8 向量库 + 9 IM 渠道）是腾讯微信对话开放平台的真实生产沉淀。sofagent 当前 knowledge 层只支持 markdown/text，WeKnora 能补齐 PDF/Word/图片/Excel/PPT 多模态文档解析 + 知识图谱 + 自适应分块这一整块能力。

| 阶段 | 版本 | 动作 | 风险/边界 |
|:--:|:--:|------|------|
| 🔍 **短期·认知储备** | **现在** | 只做调研，不开新线。把 WeKnora 列入"v1.2.x 企业级方向参考项目"清单。v1.1.x 收口期不动 | 无风险——零代码改动 |
| 🧩 **中期·审计增强型 connector** | **v1.2.x** | `sofagent/mcp` 新增 `rag_query` 工具，底层调 WeKnora MCP server（`weknora mcp serve`）。**非透传模式**——sofagent 三层加值：① 调用前审计 query（R1 query 审计）；② 调用中包装返回，强制走三层签名铁律；③ 调用后记录 RAG 调用链到 audit history | WeKnora v0.x 尚未 1.0，接口可能不稳；需评估私有化部署的数据主权边界 |
| 🏗️ **长期·knowledge 后端** | **v1.3.x+** | 把 WeKnora 的文档解析能力作为 sofagent knowledge 层的可选后端——扩展 PDF/Word/图片/Excel 支持。daemon 文件变更审计扩展到多模态文档。WeKnora v0.6 企业级 RBAC + v0.7 Scoped API Key 可作为 sofagent 企业版权限体系的参考标杆 | 长期项，v1.3.x Ontology 认知底座 + 国标对齐落地后再评估 |

**品牌可见性铁律（connector 禁止透传）**：WeKnora connector 是"审计增强型"，不是"透明管道"。每次 `rag_query` 返回必须走 sofagent 已有的三层签名铁律（v1.1.2 落地，见 `sofagent/mcp/src/mcp-server.ts`）：

| 层 | 现有实现位置 | 对 RAG connector 的要求 |
|---|---|---|
| ① 首行 `[sofagent]` 前缀 | mcp-server.ts 三层签名铁律 | 返回首行格式：`[sofagent] rag_query: <query> (via weknora) · <verdict>`，让 Agent 第一眼就知道是谁在说话 |
| ② 结构化 `auditEngine` + `via` 字段 | mcp-server.ts `auditEngine: 'sofagent-audit v${VERSION}'` | `data.auditEngine: 'sofagent-audit v${VERSION}'` + 新增 `data.via: 'weknora'`——Agent 解析 JSON 时能看到审计引擎标识 + RAG 后端来源 |
| ③ 规则编号 + 规则数 | mcp-server.ts `scope: ['A3','A7',...]` / `rulesCount` | `data.scope: ['R1','R2','R3']`（新增 R 系列规则）+ `data.rulesCount` 递增 |

**新增审计维度 — R 系列 RAG 规则**（区别于现有 A 系列提交审计、E 系列 eval 评分）：

| 规则 | 触发时机 | 检查内容 | 返回示例 |
|---|---|---|---|
| **R1 query 审计** | `rag_query` 调用前 | query 越界（请求其他项目知识库）、敏感词、数据主权边界（私有化部署时禁止跨租户查询） | `[sofagent] R1: query 越界，请求了未授权的 knowledge base` |
| **R2 结果可信度审计** | `rag_query` 返回后 | 引用是否可追溯（无 source 的回答降级）、置信度是否达标（< 阈值打 WARN）、是否触发幻觉模式（答案与知识库矛盾） | `[sofagent] R2: 3/5 引用无可追溯 source，置信度 0.42（< 阈值 0.7）` |
| **R3 引用追溯审计** | Agent 后续 commit 时 | Agent 在代码/文档中引用的事实，是否能在 RAG 调用历史中找到出处（类似 A14 知识库越权，但作用域是 RAG 结果） | `[sofagent] R3: 引用的事实无 RAG 来源记录` |

**差异化铁律（与 gbrain 对标同款守则）**：吸收 WeKnora 的「方法」（多模态解析、自适应分块、企业级 RBAC 工程化），不吸收其「定位」（不变成 RAG 平台）。sofagent 始终是 Harness 中间件——数据主权（本地不送云）+ 第三方独立性（不做 Agent 运行）+ 开源 MIT（审计工具本身可审计）。**Agent 用什么 RAG 后端是 Agent 的自由，sofagent 负责审计 Agent 调 RAG 的行为——这就是 connector 不做透传的根因。**


#### Loop Engineering 全栈对照（已实现能力自证）

> 来源：Loop Engineering 方法论（5 动作 / 6 组件 / 6 成本）。sofagent 近乎 1:1 覆盖——对外可讲"sofagent 就是一套产品化的 Loop Engineering 系统"，与 Karpathy AutoResearch、Andrew Ng 三层循环、Addy Osmani agent-skills 相互印证。

| Loop Engineering 维度 | sofagent 对应 | 状态 |
|------|------|:--:|
| **5 动作** · 发现 | loop-check（违规检测）| ✅ |
| 派活 | git worktree + Sub Agent 调度 | ✅ |
| 验证 | 独立审查 Agent + 双审（Maker-Checker）| ✅ |
| 持久化 | think.md + 记忆金字塔 L0-L3 | ✅ |
| 调度 | CLI 编排入口（sofagent-orchestrator compose）| ✅ |
| **6 组件** · 自动化 | daemon 常驻 + 自动触发 | ✅ |
| 工作树 | git worktree 隔离 | ✅ |
| Skills | Skill 系统 + SkillOpt | ✅ |
| MCP | @sofagent/mcp 独立包 | ✅ |
| 子 Agent | DeepAgents Sub Agent | ✅ |
| 外部记忆 | AI 知识库 + TencentDB 只读集成 | ✅ |
| **6 成本** · 意图债 | SKILL.md 固化规则 | ✅ |
| 验证债 | 双审 + 独立审查 Agent | ✅ |
| 理解债 | entry-gate 理解成本检查 | ⚠️ 部分 |
| 认知投降 | HANDBOOK 场景三（反合理化表）| ✅ |
| 编排税 | 审查带宽（A/B 对比确定性）| ⚠️ 部分 |
| Token 失控 | 预算表 + 轮次上限 | ✅ |

> **理论框架对照（通用 Loop Engineering 6 隐性成本 → sofagent 落地命名）**：下方通用框架命名源自外部 Loop Engineering 方法论，与上方 sofagent 特化命名是**同一组隐性成本的两种表述**——对外沟通可按受众选用。sofagent 将通用框架的细分项合并为 6 个自沉淀命名，并额外显式化了「意图债 / Token 失控」两个通用框架未单列的成本。

| 通用框架隐性成本 | sofagent 对应（上表） | 映射说明 |
|------|------|------|
| 上下文污染 | 理解债 | 上下文质量劣化，需反复交代背景（与意图债同源） |
| 状态漂移 | 验证债 | Agent 状态偏离预期，靠双审 / 独立审查拉回 |
| 验证缺失 | 验证债 | 同上——验证机制兜底；sofagent 将「状态漂移 + 验证缺失」合并为「验证债」 |
| 返工 | 编排税 | 协调与重做开销 |
| 协调 | 编排税 | 多 Agent 编排税负（A/B 对比确定性） |
| 认知负债 | 认知投降 | AI 放弃独立判断、顺人类偏好的代价（HANDBOOK 场景三） |
| —（未单列） | 意图债 | sofagent 特化：SKILL.md 固化规则清零输入端背景重述成本 |
| —（未单列） | Token 失控 | sofagent 特化：预算表 + 轮次上限兜底 |

| 想法 | 说明 |
|------|------|
| **gstack/OKF 工程学习**（v1.0.5） | 从 gstack 和 Google OKF 借鉴 5 项工程改进：原子文件写入 / 首次运行分类器 / fail-closed 默认安全 / 生产者-消费者架构文档化 / A9 分级安全。详见 [THANKS](./docs/THANKS.md) |
| **企业 Skill 自动优化** | FDE 部署时给每个 AI 节点定制专属 Skill（注入行业术语/业务规则/历史案例）。节点跑起来后，基于 eval.md 评分 + task/logs 记录 + think.md 反思，Skill 自动迭代优化——检查点不合格时触发优化分析，A/B 测试新版本，candidate 胜出 promote 替换 current。这是 sofagent 的核心服务：**Skill 不只是部署时写好，运行时持续进化** |
| **AI 知识库（v1.0.1）** | FDE 交付的第三样东西从散文件升级为结构化知识系统。`.sofagent/knowledge/` 目录：entities/（实体页）+ concepts/（概念页）+ comparisons/（对比页）。daemon 检测 task/logs 变化触发 Ingest，loop-evaluate 顺带跑 Lint，加载链启动时被动注入 top-N 相关页。think.md 不动（职责不重叠）。**新增 Workflow 节点数据契约**（每个 Agent 只看自己职责范围内的知识）+ **entities 实体关联**（frontmatter `relations` 字段——知识库从独立页面变成关联图，Ontology 第 1 步）。详见 [v1.0.1 开发日志](./docs/changelog/v1.0.1.md) |
| **think.md 模板强制** | think.md 目前可选——Agent 想写就写。v1.0.1 升级：如果写，必须按模板（做了什么 / 踩了什么坑 / 下次怎么办）。不强制写，审计引擎检测「本次任务无 think.md」标 ⚠️ 但不阻断。**不做 gate 前置检查**——强制 gate 会导致 Agent 用垃圾内容填模板 |
| **loop-check 轮次上限** | 当前 loop-check 只有步数比例检查点（60%），无绝对轮次上限。v1.0.1 加硬性兜底：超过 N 轮自动 closure → 交还人类。防止工具持续报错导致 Agent 无限循环消耗 Token |
| **后置测验（可选维度）** | loop-check 新维度：任务结束时 AI 出题反问人类「我做了 X，你理解了吗？」从 Agent 自检到人机对齐。默认关闭，高风险任务才开启。成本高（每次任务需人答题），v2.x 探索 |
| **Skill 自动优化闭环（v1.0.3）** | FDE 离场时生成的定制 Skill 不是一次性写完就固定的——接入 [微软 SkillOpt](https://github.com/microsoft/SkillOpt) 自动优化引擎（SkillOpt）：Agent 跑任务 → eval + task/logs 收集轨迹 → `skillopt-sleep` 夜间训练（Rollout→Reflect→Aggregate→Select→Update→Evaluate）→ validation gate 严格验证 → 只升不降替换 Skill。MIT 免费，本地 pip 安装，通过 CLI subprocess 调用。详见 [v1.0.3 开发日志](./docs/changelog/v1.0.3.md) |
| 质量抽检仪表盘 | 抽检合格率、skillopt 迭代记录可视化 |
| age 加密 / 多用户隔离 | think.md + task/logs 加密；同机权限隔离 |
| 多企业平台 webhook | 飞书 + 企微 + 自定义 webhook |
| 记忆架构升级 | Ledger-Views-Policy 三层模型 |
| **Windows 完整支持** | PowerShell 对齐——verify.ps1 从 230 行扩到 ~700 行（对齐 verify.sh ~48 项动态检查）。当前覆盖率 24%，v0.99.7 起诚实标注为实验性。目标：覆盖率 ≥80%，去掉实验性标注。**v1.x 增量**：借鉴 gstack 的 Windows NTFS ACL 加固（icacls 翻译 POSIX 权限）和 `Bun.which` 跨平台路径处理 |
| **--doctor --html 自包含报告**（v1.x） | 借鉴 OKF 的自包含 HTML 交付物模式——`--doctor` 支持 `--html` 输出单文件报告（无需后端、无需安装、浏览器直接打开）。降低知识传播门槛 |
| **recipe + bundle 知识复现**（v2.x） | 借鉴 OKF 的 recipe+bundle 模式——FDE 部署时生成 recipe 文件记录 knowledge/ 的生成参数和来源，确保企业知识 build 可复现、可审查 |
| **daemon 文档校准** | 外部用户反馈（Case 025）：daemon 实际监控 think.md/fde.md hash 变化，非直接监听 git commit 审计。需更新文档 + 评估是否在 daemon 主循环加 `sofagent-audit --diff HEAD` 定时触发 |
| 分布式反思同步 | Gossip 协议 + 信任加权投票 |
| bash 代码债清理 | ~450 行重复代码（颜色常量/日志函数/平台探测），方向：bash → TypeScript 迁移，不新建 bash 基础设施 |
| 英文文档扩展 | HANDBOOK/DEVELOPMENT/ARCHITECTURE 英文翻译 |
| **失败案例库** | 收集 Agent 审计拦截的真实案例（去敏后），用于回归测试 + 训练。已有 audit history 数据源 |
| **held-out 测试集** | 预留一批不参与日常迭代的测试样本，版本发版前验证（翁荔提出的三项短板之一） |
| **长期健康度监控** | 追踪 Agent 约束服从率随时间变化的趋势（是否衰减、是否需刷新约束措辞） |
| ARCHITECTURE 可读性 | 降低外部引用密度，让新人 10 分钟能看懂
| 恢复路径结构化 | think.md 记录失败但没有结构化恢复机制，等 JSONL 落地
| 审计规则模板消除重复 | RuleFunction 类型工厂 + Runner 注册模式（15 个 rule-*.ts 减少 30% 重复代码）
| 测试工具函数提取 | makeDiffFile / runDiffParse 等重复定义收敛到 test-utils.ts
| A20 供应链安全 | 依赖变更审计（v1.1.4 占用 A18/A19 编号，此项后移为 A20） |
| A21 文件权限 | chmod 操作检测（v1.1.4 占用 A18/A19 编号，此项后移为 A21） |
| MCP/Plugin/Skill/Hook 四组件扩展 | 在现有 MCP+Skill 基础上架构 Plugin+Hook 层
| 双闸验证：执行前 + 副作用写回前 | 审计从事后 diff 扩展到事前拦截
| **entry-gate 风险分级审批** | 当前权限清单是二分（能做/不能做）。升级为三级：🟢 低风险自动放行 / 🟡 中风险需确认 / 🔴 高风险（DB/外部 API/文件删除）必须人工审批。让低风险更快通过，把人工注意力精准投放到高风险节点。**不做**超时降级和防橡皮图章——那是企业级 BPM 的功能，不是 Agent harness 层的职责（v2.x 再探索） |
| **7-Entry Checklist 结构化** | 当前 entry-gate 只落地了 7-Entry 中的 recovery（LIMITATIONS + daemon 边界说明）和 loop（loop-check/evaluate）。完整 7 项：contact / assembly / model / loop / gate / executor / transcript。v1.x 在 entry-gate 注释埋占位结构 |
| **编排引擎收敛保护** | Loop 工程核心是收敛——不具备收敛性的目标会无限烧 Token。加硬约束：同一任务跑超过 N 轮未收敛 → 强制停下问人，写 think.md 标记「收敛失败」。当前 think.md 是被动记录，缺主动叫停机制
| loop-check 三元统一出口 | pass/fail/warn 收敛，对齐审计引擎 exit code 0/1/2
| 记忆产权三维框架 | 对象归属 / 锁定策略 / 边界定义补充到记忆层
| **记忆分层金字塔（L0-L3）**（v1.x-v2.x） | 借鉴 TencentDB Agent Memory 的 4 层记忆架构：L0 原始对话（think.md）→ L1 原子事实（自动提取 entities）→ L2 场景聚合（自动生成 concepts）→ L3 用户画像（新增 persona.md）。当前仅有手工 knowledge/，缺自动化提炼流水线和 L3 用户画像。v1.x 加 L1→L2 自动聚合，v2.x 加 L3 用户画像 + SQLite 双轨存储。详见 [TencentDB Agent Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory) |
| **OKF 知识互操作**（v2.x 探索） | Google OKF（LMVKI 知识沉淀 + OKF 互操作两代分化）。当前 knowledge/ 已实现知识沉淀（等同于 LMVKI），未来方向：① 导出为 OKF 标准格式（统一元数据：标题/类型/标签/更新时间/来源）② 让外部 AI 系统（Cloud/Gemini/Cursor）零适配直接读取 sofagent 的知识库。把企业知识库从"sofagent 专属"变成"所有 AI 通用"
| **私有化评估体系**（v1.x） | 微软 Nadella：未来企业最重要 IP 是 private evals。FDE 交付的 scoring 反馈 + Skill 迭代历史 + 知识库演变 = 企业的私有化评估闭环。当前已实现 eval.md + A/B 对比 + SkillOpt，v1.x 强化为 FDE 离场时的核心交付物描述
| 入口契约三门槛 | 审计引擎扩展：检查提交含 decision log / PR 大小 / 测试证据，把「重建意图」成本推回提交者 |
| 记忆冲突检测三步法 | think.md 从追加模式升级：检测矛盾→智能融合→重心明确，不简单覆盖 |
| 审计工具健康度运维 | 规则失效检测 + baseline 增长告警——审计工具也需要被审计 |
| Skill 四维评估体系 | scoring 从「结果目标」扩展到「结果+过程+风格+效率」+ 反控样本测试 |
| Conway/Coase 双重反转叙事 | Agent 架构反向塑造组织形态——选择 sofagent 是组织治理模式的选择 |

#### 轻量多设备（v1.1.0 起）

> 💡 **为什么提前到 v1.x**：Cloudtag / Sierra / Shopify 三家企业不约而同验证了"Agent 从工具变数字员工"的趋势。sofagent 定位从"约束工具"升级为"Harness 中间件"——多设备是中间件的必修课。v1.1.x 做轻量版（不碰身份/权限/协同协议），v1.2.x 做完整版。

v1.x 的多设备 = **经验共享 + 审计可见**，不碰身份/权限/协同协议：

| 能力 | 说明 | 实现路径 |
|------|------|------|
| **经验共享** | A 设备上 Agent 学到的经验（knowledge/ + think.md），B 设备能用 | 文件同步层（git submodule / NAS / 云盘挂载），不搞 P2P 协议 |
| **自迭代周报** | daemon 定期汇总 think.md 生成 `lessons-missteps.md`——"上周 Agent 反复犯什么错" | daemon 扩展：定时扫描 think.md → LLM 汇总 → 写入 knowledge/ |
| **权限作用域化** | 借鉴 Cloudtag 三层能力叠加——组织默认层（基线 permission.json）→ 工作区级（项目 .sofagent/permissions.local.json 覆盖）→ 频道级（当前不实现，v1.2.x） | permission.json 支持项目级 override，优先级覆盖无降级 |
| **daemon 主动巡检** | 从被动监工升级为主动告警——定期跑 doctor + 审计历史，发现 Agent 反复犯的同类错误 | daemon 扩展：定时执行 audit history 分析 → 生成告警 |

**不做的**（v1.2.x 再说）：Agent 独立身份码、跨设备实时任务分发、多人协同线程、场景驱动权限的频道级、代理网关。

> 📖 4 种同步方案（iCloud / NAS / Dropbox / git submodule）见 [多设备同步指南](./docs/guides/multi-device-sync.md)。
