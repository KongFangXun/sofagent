# 路线图 · Roadmap

> 已经做了什么、未来要去哪、哪些地方需要你的帮助。
> v1.4.2 · 2026-08-28（UTC）· 🚀 训练引擎 · 数据与评估 + FDE Harness 层（六引擎 + IM 桥 + DSH 执行深化 · 已发版 SSOT）
>
> **v1.4.2 已于 2026-08-28 发版**：🚀 训练引擎 · 数据与评估 六章（数据管道/版本/eval 闭环/环境/dry-run 算力外推/报告）+ FDE 六引擎工作台（fde_interview/classify/quantify/derive/distill/deploy，67→76 tools）+ 🌉 IM 桥远程指挥 + 🔧 FORGE 步零数据流地基与重复率熔断——详见 [v1.4.2 开发日志](./changelog/v1.4/v1.4.2.md)。v1.4.1 训练引擎地基详见 [v1.4.1 开发日志](./changelog/v1.4/v1.4.1.md)。

产品定位详见 [设计哲学](./PHILOSOPHY.md) 和 [README](../README.md)。

## 现在在哪：v1.4.2（已发版）

> **v1.4.2 已于 2026-08-28 发版**——训练引擎 · 数据与评估 六章（企业数据→训练集管道 / dataset_version 版本 / eval 闭环 / train env+doctor / dry-run 算力外推 / 训练报告）+ FDE 六引擎工作台（fde_interview/classify/quantify/derive/distill/deploy，MCP 67→76 tools）+ IM 桥远程指挥（dsh-im + install.sh 可选分支）+ FORGE 步零数据流地基与重复率熔断 + 四轮 16 视角审查 30 项 BugFix 批 · 测试 3202→3349（+147 开发批 +24 审查批）· acceptance 271→276 场景。详见 [v1.4.2 开发日志](./changelog/v1.4/v1.4.2.md)。
>
> **v1.4.1 已于 2026-08-27 交付**——训练引擎 · 地基 八大块（train-job 编排 + train_job 审计 HMAC 链 + enterpriseId 隔离 + 可复现指纹 + 权重 HMAC 签名 + 中断回收 + 崩溃恢复 + 安全基线）+ `train_submit`（66→67 tools）+ 阶段 0 Metal reward 收敛验证（@mlx-node/trl）+ 双栈契约文档 + 训练安全基线文档 + SKILL 体系重构 + 依赖升级（LangChain 三包 + vitest）· 测试 2981→3222（+241）。详见 [v1.4.1 开发日志](./changelog/v1.4/v1.4.1.md)。
>
> **v1.4.0 已于 2026-08-23 交付**——Web 工作明细页（四视角工作记录）+ 图谱栏（FDE 双图谱 + MCP 工具视图 + skill 加载链）+ 成本审计（超支告警 + `cost_query` MCP + COST DecisionKind）+ DSH 插件家族（`cordis-plugin-sofagent-*` 9 款，DSH inventory 全可见 + Cursor/Claude hook 拦截）+ OpenClaw 插件家族（4 款 code-plugin）+ Dashboard HTML 产品化 + 联邦查询跨设备 E2E（S320 fork 10 断言 + S322 独立进程 4 场景）+ MLflow 接线 + Agentic Browser（61→66 tools）+ 工具角色分层 + 瘦描述（默认全量 66 · `SOFAGENT_MCP_ROLES` 显式收窄专职面）+ DSH 默认启用（rc 期 CLI 桥接）+ MCP 自动配置（install.sh 装完即连）+ bash 3.2 真实环境验证 + 审计溯源字段回填。详见 [v1.4.0 开发日志](./changelog/v1.4/v1.4.0.md)。
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
| **v1.4.2** | **🚀 训练引擎 · 数据与评估 + FDE Harness 层（六引擎 + IM 桥 + DSH 执行深化）**：训练侧——① **企业数据 → 训练集管道**（CSV/Excel/**DB/API** 多源异构接入 + instruction/偏好对构建 + 质量闸门 + 训练入口脱敏）② **训练集版本管理**（dataset_version，eval 引用版本可复现）③ **训练中 eval 闭环**（复用 v1.3.1 Benchmark，阈值外部化——机制开源/阈值外部化）④ **训练环境管理**（train env init + train doctor + 基座模型下载管理 + 环境版本清单）⑤ **训练 dry-run 与配置预检**（train dry-run：极小数据集跑通管线 + 显存预检 + 数据抽样检查 + **算力外推预检**——ScaleRL sigmoid 缩放律小 run 外推大 run 成本，预算控制事前化）⑥ **训练报告**（train report：客户可读交付物 + 量化四字段，绩效量化引擎输入）；**FDE Harness 层**——⑦ **FDE 引擎化六件**（fde_interview 访谈结构化 + fde_classify 三问判定 + fde_quantify 量化计算器 + fde_derive 本体推导 + fde_distill 沉淀 + fde_deploy 部署，方法论 → 可执行引擎，产物落 `data/fde/`，MCP 67→76 tools 含训练侧三件）⑧ **IM 桥远程指挥**（DSH dsh-im 扫码接入微信/钉钉/飞书 + AI Office Connector 无公网 IP + 安全审计，FDE Harness 层执行通道）⑨ **DSH 执行深化**（FORGE loop 全量切 DSH：步零数据流地基三债修复 + 流式面重建 + 审查类 step 分级切 + 治理面收口 usage 自动计量，2026-08-26 排期；本版实交付步零三债 + 重复率熔断 + A 侧收敛指令，**步一~三拍板移交 v1.4.3**，2026-08-28 承接登记见 [v1.4.3 日志](./changelog/v1.4/v1.4.3.md)第六章） |
| **v1.4.1** | 🚂 训练引擎 · 地基 八大块（train-job 编排 + train_job 审计 HMAC 链 + enterpriseId 隔离 + 可复现指纹 + 权重 HMAC 签名 + 中断回收 + 崩溃恢复 + 安全基线）+ 🚉 train_submit（66→67 tools）+ 🔬 阶段 0 Metal reward 收敛验证（@mlx-node/trl）+ 📜 双栈契约文档 + 🛡️ 训练安全基线文档 + 🧩 SKILL 体系重构 + 📦 依赖升级（LangChain 三包 + vitest）+ 🔒 sandbox 证据链时序竞态回归锁（发布期修复）· 测试 2981→3222 全量（+241：全部落在 workspace 口径 2937→3178，train 模块贡献（各包差值以 tools/check/test-count.sh 实测为准）；插件族 44 不变）· MCP 66→67 |
| **v1.4.0** | 📊 Web 工作明细页 + 🗺️ 图谱栏（FDE 双图谱 + MCP 工具视图 + skill 加载链）+ 💰 成本审计（超支告警 + `cost_query` MCP + COST DecisionKind）+ 🔌 DSH 插件家族（`cordis-plugin-sofagent-*` 9 款 · inventory 全可见 + Cursor/Claude hook 拦截）+ 🦞 OpenClaw 插件家族（4 款 code-plugin）+ 🏠 Dashboard HTML 产品化 + 📡 远程 API 通道（契约）+ 🔗 MLflow 接线 + 🌐 Agentic Browser（66 tools）+ 🔀 工具角色分层 + 瘦描述（默认全量 66 · `SOFAGENT_MCP_ROLES` 显式收窄专职面）+ ⚡ DSH 默认启用（rc 期 CLI 桥接）+ 🔌 MCP 自动配置（install.sh 装完即连）+ 🔄 联邦查询跨设备 E2E（S320 fork 10 断言 + S322 独立进程 4 场景）+ 🐚 bash 3.2 验证 + 🔍 审计溯源字段回填 · 测试 2903→2981 全量（+78：引擎 +34（含工具分层 +18 + argv 守卫 +3）· DSH 插件 +27 · OpenClaw 插件 +17；workspace 口径 2937/12 包）· MCP 61→66 |
| **v1.3.9** | 🔍 官方 AST 规则引擎（sofagent-ruleset-ast 含 ASI01/ASI04 · 8+2 规则）+ 🧩 meta-harness 多 harness 统一编排（DSH 形态对齐）+ 📊 AI 工作明细数据层（worklog + worklog_query MCP）+ 🔬 API 分级 @public/@internal（1439 符号 + CI 门禁）+ ⚙️ FORGE driver 切 DSH（显式后端选择 + CLI 桥接 + bash 全权限）+ 📈 MLflow agent 评估（13 指标 + LLM-as-Judge）+ 🌐 Agentic Browser（4 工具 + 视觉降级）+ 🧭 跨平台适配器（Cursor/Codex/Gemini CLI）+ 🗂️ tools/ 物理分子目录 + 🏷️ ATTRIBUTION 归因引擎 + 🏖️ Dream Sandbox 沙盒审计 + 🩹 >5MB diff 缝隙修复（spill 落盘）+ 🔄 FORGE driver 进程守护（daemon + watcher）· 阶段五~八全流程（15 acceptance 场景补齐 + release-gate 三跑 PASS） |
| **v1.3.8** | 🛡️ 代理网关硬边界（唯一出入口 + 风险分级 + 权限单调守卫 + HITL 审批队列激活）+ 🔐 数据静态加密（纯 TS AES-256-GCM + 密钥指纹强制备份）+ ⏸️ Durable Execution L3（WAL 三态恢复 + undo 三档）+ 🤖 异步长任务自治（cron 三档糖 + 依赖图 + 死循环检测）+ ⚙️ FORGE driver 保活三件套（pm2 / resume / liveness）+ 🧩 SDK sandbox:true 启用（三层沙箱）+ 🔻 release-gate 瘦身（--judgment-only + F 循环 FAIL 即停）+ 📊 fresh-eyes 成本重构（usage.jsonl + B 侧复核）+ 📸 快照写路径加固（revert 原子化）· bugfix 四 P0（A1 后缀绕过 / A2 FFFD / 安装链 / 声称断裂） |
| **v1.3.7** | 🏰 SubAgent 完整沙箱（虚拟 FS / 网络白名单 / 工具中介 / 虚拟 key / 独立进程 / A-B 双跑）+ 🔐 场景驱动权限（身份→场景→风险→放行，fail-closed）+ 🛡️ AgentShield 五类扫描（MCP 画像 / Hook 注入 / 配置审查 / 密钥增强 / Shadow AI 发现）+ 🏥 行业 overlay 四套（fintech/medical/government/ai）+ ⚡ 断路器行为监控（ASI08 熔断 + ASI10 隔离）+ 🌳 ontology 生命周期（branch/trunk + migrateToTrunk 审阅门 + OKF 三件套）+ ⚙️ FORGE 审查循环自适应并发 + 🔌 memory-sync 路径通用化 + 26 项独立审查 bugfix |
| **v1.3.6** | 🔌 引擎接口外化完整版（模型层接入前置）：📥 三个数据接口（Workflow 标准格式 + 运行容器 + merge_criteria/approver 审阅协议字段 / Ontology 标准 Schema 注册 D1-D5 留痕 / 模型注册 + 灰度切换全流程审计 + 强制人审）+ 🧩 SubAgent 托管 SDK（harness.wrap 双形态兼容）+ 🏋️ 训练协议三约定 + 预算控制（自 v1.4.1 前移）+ 🧭 路由决策可解释性（EndpointProfile + route-policy + routeReason 结构化理由链）+ ✅ 机器可判定验收（define_acceptance / check_acceptance，复用 Benchmark 判定引擎）+ 🛡️ 可靠性五件（FORGE worktree 隔离根治 run-07 / 双闸验证 postToolCall 副作用复查 / Agent 疲劳度检测 / 分级降级梯队 / decisions.jsonl 五分类完整版）+ 🌳 仓库森林叙事升级 · MCP 52→60 tools（8 个新 tool 全登记） |
| **v1.3.5-v1.3.0**（6 版） | **L1-L2 组织协作 + 运行时审计最小闭环 + 公地经济 + 自进化种子**：v1.3.0 运行时审计最小闭环 + 激活链 SUSTAIN 收尾 → v1.3.1 Ontology 运行时层 + Durable Execution + Benchmark 评测 → v1.3.2 Onboard Agent 完整版 + 企业 eval 套件 → v1.3.3 L2 团队协作协议 + Refine Agent → v1.3.4 L3 组织能力公地 + SkillScan 安全门 + 编排/执行分离 → v1.3.5 MCP 自进化 + instinct→skill 自动进化 + FDE 运维五件（详见 [CHANGELOG](../CHANGELOG.md)） |
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
| 供给侧 | AI Coding 成本趋零 | FDE 借 AI Coding 1 天出 Demo，瓶颈从技术能力转向**业务抽象能力**（能否把 SOP 拆成 Agent 业务流） |
| 治理侧 | Agent IAM 组织身份 | Agent 有工号/权限/审计/全生命周期管理，从「工具」变「员工」，才能进生产环境 |
| 能力侧 | 协同飞轮持续进化 | 每次人工纠正/确认/追问回流为结构化学习信号，越用越懂企业 |

**现实验证（数字原生工作方式）**：业务流主语从「人」迁移到「Agent」——将 SOP 拆为 Agent 业务流、给 Agent 派工号、把人工纠正回流为学习信号——正是三信号同时成熟的落地案例，让抽象框架变现实（2026-07 行业观察）。

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
| **v1.4.3** | 📋 规划中 | **🚀 训练引擎 · 运行与需求（监控 + 诊断 + 沙箱 + 推导 + 模板 + workflow + DSH 执行深化收口 + 审计聚合指标 + 训练反作弊基线 + onboarding 走查 + 存量清扫与升级审查）**：① **训练监控与 GPU 队列**（train_status + **train_list** + 显存预算排队 + webhook + **Dashboard 训练区块 + 健康度指标落盘**）② **训练失败诊断**（OOM/数据/发散/框架/环境/重复坍塌/精度异常七类）③ **训练沙箱 + 设备打包**（扩展 v1.3.7 + 离线 + 设备封装前置）④ **训练需求推导 + 模板库**（`train analyze` + 场景模板 + **RL 配方模板** grpo/dapo/cispo 含 ScaleRL 四技巧 + MoE expert 覆盖防护）⑤ **后训练 workflow 模板**（七节点 FDE 载体 + 三 HITL）⑥ **FORGE DSH 执行深化步一~三承接**（2026-08-28 拍板自 v1.4.2 移入：流式面重建 / 审查类 step 分级切 / 治理面收口 usage 自动计量，详见 [v1.4.3 日志](./changelog/v1.4/v1.4.3.md)第六章）⑦ **审计聚合指标 · 安全边界触发率**（`sofagent-audit --stats` CLI + `--json` 纯净输出 + 落盘 audit-stats.json——Dashboard 面板化移 v1.5.0，纯聚合零新采集读 history.jsonl，约束层价值从逐次事件变成可汇报的治理 KPI，2026-08-28 用户拍板收编，详见 [v1.4.3 日志](./changelog/v1.4/v1.4.3.md)第七章）⑧ **训练环境反作弊基线**（reward hacking 四形态双防线默认化——禁 Git 藏 .git / 网络白名单默认拦截写进 train env init 默认配置，防线是设计期输入，2026-08-28 用户拍板收编，详见 [v1.4.3 日志](./changelog/v1.4/v1.4.3.md)第八章）⑨ **新功能入口导览 + onboarding 断层走查**（三条新产品线落地后的入口预检——HANDBOOK 导览表 + install.sh 提示分层 + 空状态友好化，2026-08-28 用户拍板收编，详见 [v1.4.3 日志](./changelog/v1.4/v1.4.3.md)第九章）⑩ **存量清扫**（ao 探测删除 / composeWithDeepAgents 更名 / fde_compose 收窄 workflow-only / checkHistoryChain 旧 API 退役 / commons_retire 自扫——退场不清扫债务一次收编，SSOT 见 [v1.5.0 第六章](./changelog/v1.5/v1.5.0.md)，2026-08-29 用户拍板收编）⑪ **存量升级审查**（老功能翻新八项登记——eval 三套统一/加载链 token 预算/webhook 事件源扩展/daemon 巡检 28 项归组/IM 桥一等公民评估/76 tools 瘦描述复核/证据强度分级/本体混合检索评估（Semantica 实测 38k→12k token 启发），去向分散 v1.4.4~v1.5.2，详见 [v1.4.4 日志](./changelog/v1.4/v1.4.4.md)第七章——2026-08-29 拍板自 v1.4.3 迁入） | [日志](./changelog/v1.4/v1.4.3.md) |
| **v1.4.4** | 📋 规划中 | **🚀 训练引擎 · 信号与部署闭环（语料 + 权重 + 注册 + 对比 + 决策因果链 + CI 加固 + 存量升级）**：① **训练语料导出三件套**（规则 + GUIDE 方法论 + 样本四源 [decision-log/llm-calls/evaluation-log/runtime-audit] + Trace 轨迹 + 通用脱敏管线 + HMAC 签名 + 合规红线——含 human-fde 人工基准 + **规则 → reward/verifier 映射**，从 v1.3.2/v1.3.6 归集）② **企业专属模型本地权重部署链路**（权重目录规范 + 本地加载 + 版本回滚，从 v1.3.6 归集）③ **训练产物 → 模型注册自动衔接**（train done + eval pass → model_register，闭环最后一步）④ **多基座对比训练**（train compare：同数据多基座并行 + ROI 排序，阶段 2 选型前置）⑤ **决策因果链与先例检索**（decision-log 加 causedBy/causalType 因果边 + traceDecisionChain 链式回溯 + findSimilarDecisions 先例匹配——Semantica「决策即节点」启发，只参照设计不引依赖，2026-08-29 排入，详见 [v1.4.4 日志](./changelog/v1.4/v1.4.4.md)第五章）⑥ **CI 供应链加固三件套**（8 个 workflow SHA 固定 + pin 对账脚本 + 本地面 fail-closed 自查——dashboard serve 实锤全网卡监听须改绑 127.0.0.1，Semantica 工程治理启发，2026-08-29 排入，详见 [v1.4.4 日志](./changelog/v1.4/v1.4.4.md)第六章）⑦ **存量升级审查**（十五项：本版消化九项——eval 三套统一为 SSOT scorer / 76 tools 瘦描述复核 / trimMessagesSafe 作用域审计 / 13 包 engines 统一 / npm 包 README 门面补齐 / check-anchors 文件存在性断言 / install.sh 部署段目录同步升级 / 「将在 vX.Y.Z 移除」过期承诺限时检查 / FDE 三层交付模板外置（distillDeliverables 模板骨架移 FDE/templates/deliverables/，模板优化从发版降级为改文档，2026-08-30 用户拍板）；登记分发六项去向 v1.4.8~v1.5.2——全仓发散扫描+三轮复查+F-15 拍板追加，2026-08-29 用户拍板，详见 [v1.4.4 日志](./changelog/v1.4/v1.4.4.md)第七章） | [日志](./changelog/v1.4/v1.4.4.md) |
| **v1.4.5** | 📋 规划中 | **🚀 训练引擎 · 服务与持续（推理服务 + 持续后训练 + 合规扫描 + 交付包 + 归档 + quickstart · 生命周期补全）**：① **训练推理服务**（train serve + 健康检查 + model_switch 联动）② **持续后训练**（数据回流 + 阈值/定时/人工触发 + 回退保护；权重级持续学习 [self-distillation/online RL] 属商业层不在本版）③ **训练数据合规扫描**（PII/敏感字段 + 合规闸门）④ **FDE 训练交付包**（配置+数据+eval 基线+运维手册+权重清单）⑤ **训练产物归档与保留策略**（train-retention + @weekly 归档 + 90 天销毁 + 空间预警）⑥ **训练引擎 Quickstart**（端到端示例文档 + 合成数据 + 最小 job.json） | [日志](./changelog/v1.4/v1.4.5.md) |
| **v1.4.6** | 📋 规划中 | **🚀 训练引擎 · 分布式与云端（多卡 + 云 VM 执行面 · 规模化前置）**：① **多卡/分布式训练**（train multi：多卡/多机配置 + verl/DeepSpeed 集群 spawn + GPU 队列多卡拓扑感知 + 分布式失败诊断）② **云端 VM 执行面**（train cloud：Node 控制面本地 + Python 执行面云上——ssh/API 远程 spawn + 数据加密上传/训练后清理 + 云端成本入预算——「全托管」交付模式技术底座；⚠️ 敏感数据不上公有云，走客户机房联合训练） | [日志](./changelog/v1.4/v1.4.6.md) |
| **v1.4.7** | 📋 规划中 | **🔌 商业平台接口版**：G2 能力缺口查询 · G4 绩效数据导出 · G6 节点可见性元数据 · G7 多租户数据路径 v0 · workflow 烧进 USB · 审计留痕双层 · 静态加密全量接线 · G8 首部署 cron job 包（**本版最高优先级**）。子项定义见 [v1.4.7 规划文件](./changelog/v1.4/v1.4.7.md)；商业侧规划独立于本仓库维护 | [日志](./changelog/v1.4/v1.4.7.md) |
| **v1.4.8** | 📋 规划中 | **🔌 插件管控与工程效能（2026-08-22 新增 · Codex marketplace 启发；2026-08-24 扩充 · 七项探索方向收编）**：**① 插件来源白名单**（Git URL / 主机模式 / 本地路径三类 + 托管 hook 独裁模式，管控同时覆盖 ClawHub + SkillHub）· **② 应用级工具策略 app_tool_policy**（app×tool 白名单矩阵，fail-closed，Codex connectors 启发）· **③ 多 Agent 协作阵型库**（六阵型：commander&crews / driver&advisor / cross-review / bake-off / research-triangulation / cost-pyramid + formation.yml 配置，v1.3.6 SubAgent SDK 已交付条件成熟）· **④ 自动上下文压缩**（加载链超 3% 预算触发摘要 + 压缩标记留痕，Codex compact 启发，加载链预算收口）· **⑤ shell 提权分级策略**（safe/risky/dangerous 三态分级 + EscalationPolicy 路由 + dangerous 走 HITL，与 v1.3.7 场景权限衔接）· **⑥ 成本 quota 事前门禁**（执行前问配额 + 验证回写才记 spend，v1.4.0 事后记账的自然演进）· **⑦ 依赖方向架构测试**（13 包边界清单 + CI 强制，低成本高价值）· **⑧ workflow 节点级模型偏好绑定**（modelPreference 字段 + 模型注册表解析，不自研路由，2026-08-24 从 v1.4.7 候选移入本版） | [日志](./changelog/v1.4/v1.4.8.md) |
| **v1.5.0** | 📋 规划中 | **🛡️ 治理引擎 · 可见性与本体成熟（2026-08-29 排期 · GitHub 同类项目扫描消化 + 探索方向收编 + 存量清扫）**：① **治理 KPI 面板**（Dashboard 独立「治理」tab——安全边界触发率/审计覆盖率/HITL 时延/周环比四卡 + **PE/VC 多企业仪表盘 v0** + 周报导出，v1.4.3 `--stats` 的面板化升级）② **本体数据双时态事实**（validFrom/validTo + stateAt 时点快照查询，Semantica 启发）③ **Ontology Validation Engine**（DAG 无环 + schema 兼容 + 激活前置门，DataFlow 启发）④ **决策因果链消费**（v1.4.4 第五章前移交付 causedBy 字段——本版治理 KPI 面板「决策高亮」消费）⑤ **FDE 陪跑期补全**（期满总结报告 + fde_deploy 登记衔接——核心 v1.3.7 已交付，本版补增量）⑥ **存量清扫**（ao 探测删除 / composeWithDeepAgents 更名 / fde_compose 收窄 workflow-only / checkHistoryChain 旧 API 退役 / commons_retire 自扫——退场不清扫债务一次收编） | [日志](./changelog/v1.5/v1.5.0.md) |
| **v1.5.1** | 📋 规划中 | **🌱 进化引擎 · 实证收口（+ 评估反哺 + L4 工具层自进化）**：①「越用越好」从 11 个一次性 case → **≥1 周持续样本 + A/B 对照**（Dream Cycle 持续采集 passRate 曲线 + 知识库增量 + 进化开关双跑，复用 run_ab_test），样本达标后收紧 README/PHILOSOPHY 措辞（产品验证工作非文档修复）② **评估反哺闭环端到端场景**（harvest→jury→promote 全链路 acceptance 场景——v1.3.4 verdict 遗留的 3 处单点覆盖补成端到端，2026-08-29 自探索方向迁入，详见 [v1.5.1 日志](./changelog/v1.5/v1.5.1.md)第二章）③ **L4 工具层自进化**（Agent 自写工具→SkillScan 安全门→人审→注册进工具箱——五层谱系唯一空白层，安全语义基建现成，2026-08-29 自探索方向迁入，详见 [v1.5.1 日志](./changelog/v1.5/v1.5.1.md)第三章） | [日志](./changelog/v1.5/v1.5.1.md) |
| **v1.5.2** | 📋 规划中 | **⚡ 编排引擎 · 事件驱动（+ AI 异常处理总线）**：① 业务节点从指令驱动 → **事件驱动触发**（上游产出/webhook 入站/cron 三类事件源 + `on:` 声明式订阅 + 事件总线全审计留痕 + 死信重放）② **理解债务应对**（auto-PR 决策解释块引因果链 + daemon 周报，loop-engineering 启发）③ **AI 异常处理总线**（可重试/需人工/需回滚三分类路由 + 复用事件总线死信通道 + 挂 causedBy 因果边——把 v1.3.1 节点级错误处理升级为跨节点总线形态，原候选 v2.x 前移，2026-08-29 自探索方向迁入，详见 [v1.5.2 日志](./changelog/v1.5/v1.5.2.md)第三章） | [日志](./changelog/v1.5/v1.5.2.md) |
| **v1.5.3** | 📋 规划中 | **🔍 审计引擎 · 场景扩展（+ MCP audit 对外 + FDE 记忆目录 + should-run 判定链）**：① **SMB 场景审计**（数据处理/报表生成——勾稽/溯源/口径三规则 + DATA_PRODUCT 决策类型 + 无代码仓库 onboarding 模板）② **UI 层审计前置评估**（多模态截图证据可行性报告，实做候选 v2.x）③ **MCP audit 数据对外**（audit_query 只读 tool 读 history.jsonl/decision-log + 事件订阅推送——meta-harness 延伸，DataFlow 启发，2026-08-29 自探索方向迁入，详见 [v1.5.3 日志](./changelog/v1.5/v1.5.3.md)第三章）④ **FDE 进场记忆目录工程化**（data/fde-sessions/<client-id>/ 目录 + 10 文件各司其职 + session-stop 自动捕获 + 跨 session 恢复——方法论已在 FDE/GUIDE §5.8b，本版工程化落地，2026-08-29 自探索方向迁入，详见 [v1.5.3 日志](./changelog/v1.5/v1.5.3.md)第四章）⑤ **运行时 should-run 判定链**（每轮开工前五问——健康→人审 gate→证据等待→专注等待→配额全过才执行，断路器两态的丰富形态，2026-08-29 自探索方向迁入，详见 [v1.5.3 日志](./changelog/v1.5/v1.5.3.md)第五章） | [日志](./changelog/v1.5/v1.5.3.md) |
| **v1.5.4** | 📋 规划中 | **⚡ 执行引擎 · 路由与验证（2026-08-29 自 v2.0.0 前移 · 用户拍板）**：① **模型路由层**（云端规划/本地执行/管道分层路由 + 敏感度 fail-closed + routeReason 可解释 + 本地端点注册——不依赖精调模型，对接现有云 API + Ollama 即可交付）② **凭证隔离 Vault**（Agent 代码碰不到 token + 轮换吊销，v1.3.7 虚拟 key 部分覆盖基础）③ **多实例自验证**（N 实例并发多数表决 + 分歧路由 HITL，复用 run_ab_test）——三项依赖全就绪故前移；v2.0.0 收窄为离线 USB 节点合体 | [日志](./changelog/v1.5/v1.5.4.md) |
| **v2.0.0** | 📋 规划中 | **🏰 数据主权大版本（收窄版 · 2026-08-29 拆分）**：**离线 USB 节点合体**一件核心（本地权重 v1.4.4 + workflow 烧录 v1.4.7 + 审计引擎 + 路由底座 v1.5.4 前移件 = 完全离线运行 + 离线激活 + 审计滞留回传）——模型路由/Vault/多实例表决三件已前移 v1.5.4，本版交付面收窄、发版确定性提高 | [日志](./changelog/v2.0/v2.0.0.md) |


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

**热度信号**：2025-2026 硅谷「AI 自进化 / Loop」成为最热关键词，斯坦福 2025 秋季直接开设自进化公开课（主讲为前 Google PaLM 训练负责人 + 递归自我改进实验室联创），把 Agent 业务流拆成「工具调用 + 验证器 + 评审器 + 编排器」四件套——这与我们的激活链（ACTIVATE→ORCHESTRATE→EXECUTE→SUSTAIN）逐件对位：编排器=激活链、验证器=审计 Gate、评审器=fde.md/acceptance、工具调用=MCP server。激活链不是追热点，是提前踩中趋势——方法论印证见 [VALIDATION · Verifier 才是瓶颈](./VALIDATION.md#verifier-才是瓶颈) 与 [VALIDATION · 循环系统的鲁棒性](./VALIDATION.md#循环系统的鲁棒性四类故障与六要素)。

---

## 探索方向

> 探索方向 = 想到了但还没排进具体版本的方向。已交付的见[迭代历程](#迭代历程)，已排期的见[版本规划](#版本规划)。

| 方向 | 一句话 |
|------|------|
| **自带净水设备的水龙头（v3.x+ 远景）** | Subagent 支持挂载外部精调小模型（引擎层提供路由与加载插槽），零投喂、本地推理、离线可用 |
| 国标 Agent 审计对位 | 关注国家 AI 智能体互联标准草案进展，标准正式发布后评估对齐 |
| **spec-first 硬禁令（OpenFDE 启发 · 设计约束）** | 单一事实源——transcript 永不直驱代码，spec 才是唯一驱动 |
| **ACS YAML 策略引擎（Microsoft AGT 启发）** | 现有 ruleset 是 JSON，AGT 的 ACS 用 YAML + OPA Rego + Cedar 三引擎——策略更人类可读，需评估兼容性 |
| **RL 训练治理（Microsoft AGT Agent Lightning 启发）** | 训练期间策略违规惩罚（policy-enforced runners + reward shaping）——需训练引擎跑通后有 reward 回路可挂，**待 v1.4.4 交付后评估排期**（2026-08-25 复审裁决：v1.4.1 地基阶段强行同版 = 无实现载体的空头承诺） |
| **OWASP Agentic Top 10 全覆盖路线（Microsoft AGT 启发）** | v1.3.7 补 ASI08+ASI10，v1.3.9 补 ASI01+ASI04，远期 10/10 全覆盖对齐 AGT |
| **评测结论证据树（HarnessEval 启发）** | 评测结论须挂可验证证据树——每个结论可回溯到原始执行证据，与审计引擎「先留证据再给结论」同源。可借鉴 Plan→Route→Decompose→Verify 四阶段范式升级 release-gate-loop 的裁决链。当前单源（15 机构联合评测主张），待独立来源累计后评估排期 |
| **证据强度分级标注（Loop Engineering 控制面启发 · 2026-08-19 新增）** | 对外展示的案例/证据按来源强度分级（公开可查 / 用户自报 / 自测自报），只维护最强少数案例——防止把自测当实证。当前 VALIDATION/THANKS 有来源纪律但无强度分级，发版 SOP 可吸收 |
| **UI 层审计（多模态截图证据 · 2026-08-20 新增 · v1.5.3 已排期前置评估）** | 审计从代码 diff 扩展到 UI 行为——Agentic Browser（v1.3.9）截图经多模态分析产出 UI 层审计证据（「表单提交是否正确」不再只靠断言），截图作为审计证据入 history；**纯文本模型可用工具层视觉降级消费截图**（OCR+结构化，DSH 社区 dsh-vision 启发）；依赖 v1.3.9 多模态链路跑通 + 审计证据模型扩展，暂占概念位。**候选版本：v2.x（v1.5.3 交付可行性评估报告）**（证据模型扩展是远期） |
| **进化引擎持续样本验证（产品验证项 · 2026-08-24 登记 · v1.5.1 已排期）** | 「越用越好」宣称当前仅 11 个一次性测试 Case（LIMITATIONS §核心效果实测情况已诚实披露），缺持续 ≥1 周样本与 A/B 对照。补法是跑 Dream Cycle 持续运行采集（eval passRate 曲线 + 知识库增量对照），属产品验证工作非文档修复——样本补上后收紧 README/PHILOSOPHY 措辞。详见 [v1.5.1 日志](./changelog/v1.5/v1.5.1.md) |

> 📖 DeerFlow / OpenFDE 方法论印证见 [VALIDATION](./VALIDATION.md)。

> 以下「分层模型架构」为探索方向的核心技术骨架概述。当前版本引擎层未涉及，v3.x 才启动。

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

编排引擎从 ao → DeepAgents → LangGraph 的升级史（v1.2.0 起 FORGE loop 已完全弃用 deepagents，改用 createReactAgent；历史编排引擎的 DeepAgents 调度原型见 v1.1.8 changelog）、Ontology 从实体关联到本体数据的渐进构建、外部框架对标（Palantir/gbrain/WeKnora/Runta）、Loop Engineering 全栈对照等详见 **[ARCHITECTURE.md](./ARCHITECTURE.md)** 的「架构设计决策的行业锚点」+「编排收敛与 A/B 测试」+「本体数据 = GitHub 生长树」章节，以及各版本 **[开发日志](./changelog/)**。

> 📖 多设备同步方案见 [多设备同步指南](./guides/multi-device-sync.md)。

> 📖 loop-engineering 启发方向的去向：FDE 节点注册表 + Worktree 隔离已交付（v1.3.5 / v1.3.6），理解债务已排期（v1.5.2），quota 事前门禁 + 依赖方向测试已排期（v1.4.8）。来源链接见 [cobusgreyling/loop-engineering](https://github.com/cobusgreyling/loop-engineering)（MIT 开源）。
