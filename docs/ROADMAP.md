# 路线图 · Roadmap

> 已经做了什么、未来要去哪、哪些地方需要你的帮助。
> v1.4.4 · 2026-09-02（UTC）· 🚀 训练引擎 · 信号与部署闭环（语料 + 权重 + 注册 + 对比 + 因果链 + CI 加固 · ⏳ 待发版——开发完成，tag/npm 发版时同步）
>
> **v1.4.3 已于 2026-09-01 发版**：🚀 训练引擎 · 运行与需求 十三章（训练监控/GPU 队列 + 失败诊断 + 沙箱/设备打包 + 需求推导/模板库 + 后训练 workflow + DSH 执行深化收口 + 审计聚合指标 + 反作弊基线 + 存量清扫/doctor 体检）+ MCP 76→79 tools + 测试 3349→3619——详见 [v1.4.3 开发日志](./changelog/v1.4/v1.4.3.md)。v1.4.2 数据与评估详见 [v1.4.2 开发日志](./changelog/v1.4/v1.4.2.md)。

产品定位详见 [设计哲学](./PHILOSOPHY.md) 和 [README](../README.md)。

## 现在在哪：v1.4.4（⏳ 待发版——开发完成）

> **v1.4.4 开发完成（2026-09-02），待 tag/npm 发版**——训练引擎 · 信号与部署闭环 十章（训练语料导出三件套 + 本地权重部署链路 + 训练产物→注册衔接 + 多基座对比训练 + 决策因果链与先例检索 + CI 供应链加固 + 存量升级审查 + spec-first 硬禁令 + 六轮审查 17 项收编批 + 五能力叙事升级）· 测试 3619→3744 · acceptance 294→303 场景（S362-S371，S364 归并入 S348）· MCP 79→80 tools。详见 [v1.4.4 开发日志](./changelog/v1.4/v1.4.4.md)。

> **v1.4.3 已于 2026-09-01 发版**——训练引擎 · 运行与需求 十三章（训练监控 + GPU 显存预算队列 76→79 tools / 失败诊断七类 + 修复建议 / 训练沙箱 + 设备打包 / 需求推导 `train analyze` + RL 配方模板库 / 后训练 workflow 七节点 + 三 HITL / DSH 执行深化步一~三收口 / 审计聚合指标 `--stats` 安全边界触发率 / 训练反作弊基线 reward hacking 四形态双防线 / onboarding 断层走查 / 存量清扫五件 + `checkHistoryChainIntegrity` 退役公告 / 存量升级审查迁 v1.4.4 / doctor 补 Ontology 完整性检查）· 测试 3349→3619 · acceptance 276→294 场景（S345-S361）。详见 [v1.4.3 开发日志](./changelog/v1.4/v1.4.3.md)。
>
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
| **v1.4.3** | **🚀 训练引擎 · 运行与需求 + 审计聚合指标**：① 训练监控与 GPU 队列（`train_status`/`train_list` 76→79 tools + 显存预算排队不 OOM + webhook 三态推送 + Dashboard 训练区块与健康度指标落盘 `data/dashboard/`）② 失败诊断 `train_diagnose`（OOM/数据/发散/框架/环境/重复坍塌/精度异常七类 + 修复建议含 MiniMax-M1 稳定性配方与 ScaleRL 精度处方）③ 训练沙箱 + 设备打包（进程隔离/无外网/只读数据源/只写产物目录——客户机房离线可训 + U 盘交付形态）④ 需求推导 + 模板库（`train analyze` workflow 节点→训练目标/数据需求/评估标准/配置四步引导 + RL 配方 grpo/dapo/cispo 含 ScaleRL 四技巧 + MoE expert 覆盖防护）⑤ 后训练 workflow 模板（七节点 DAG + 三 HITL 确认点，落盘 FDE/templates/）⑥ FORGE DSH 执行深化步一~三收口（流式面重建/审查类 step 分级切/治理面 usage 自动计量——自 v1.4.2 承接）⑦ 审计聚合指标（`sofagent-audit --stats`：安全边界触发率/阻断率/高危规则 Top5 + `--json` + 落盘——约束层价值从逐次事件变成可汇报的治理 KPI）⑧ 训练反作弊基线（reward hacking 四形态双防线默认化：剥 `.git` 断历史回溯 + 网络白名单默认拦截）⑨ onboarding 断层走查（HANDBOOK 导览表 + install.sh 提示分层 + 空状态友好化）⑩ fresh-eyes 四轮 bugfix 批（F-01~F-14 全量处置 + 场景锚点映射表）⑪ 存量清扫五件（ao 探测删除 / composeWithReactAgent 更名 / fde_compose 收窄 workflow-only / `checkHistoryChainIntegrity` 退役公告 v1.5.0 移除 / commons_retire 自扫）⑫ 存量升级审查（八项登记迁 v1.4.4 第七章）⑬ doctor 补 Ontology 完整性检查（frontmatter 坏格式静默跳过 → WARN + repairHint + skip-log 对账）· 测试 3349→3619（v1.4.3 批 +138 + 安全回归 +34 + L4 路径守卫 +41 + doctor +6 + 审查修复 +11 + 出站防护 +8 + 闸门闭环批）· acceptance 276→294 场景（S345-S361）· MCP 76→79 |
| **v1.4.2** | **🚀 训练引擎 · 数据与评估 + FDE Harness 层（六引擎 + IM 桥 + DSH 执行深化）**：训练侧——① **企业数据 → 训练集管道**（CSV/Excel/**DB/API** 多源异构接入 + instruction/偏好对构建 + 质量闸门 + 训练入口脱敏）② **训练集版本管理**（dataset_version，eval 引用版本可复现）③ **训练中 eval 闭环**（复用 v1.3.1 Benchmark，阈值外部化——机制开源/阈值外部化）④ **训练环境管理**（train env init + train doctor + 基座模型下载管理 + 环境版本清单）⑤ **训练 dry-run 与配置预检**（train dry-run：极小数据集跑通管线 + 显存预检 + 数据抽样检查 + **算力外推预检**——ScaleRL sigmoid 缩放律小 run 外推大 run 成本，预算控制事前化）⑥ **训练报告**（train report：客户可读交付物 + 量化四字段，绩效量化引擎输入）；**FDE Harness 层**——⑦ **FDE 引擎化六件**（fde_interview 访谈结构化 + fde_classify 三问判定 + fde_quantify 量化计算器 + fde_derive 本体推导 + fde_distill 沉淀 + fde_deploy 部署，方法论 → 可执行引擎，产物落 `data/fde/`，MCP 67→76 tools 含训练侧三件）⑧ **IM 桥远程指挥**（DSH dsh-im 扫码接入微信/钉钉/飞书 + AI Office Connector 无公网 IP + 安全审计，FDE Harness 层执行通道）⑨ **DSH 执行深化**（FORGE loop 全量切 DSH：步零数据流地基三债修复 + 流式面重建 + 审查类 step 分级切 + 治理面收口 usage 自动计量，2026-08-26 排期；本版实交付步零三债 + 重复率熔断 + A 侧收敛指令，**步一~三拍板移交 v1.4.3**，2026-08-28 承接登记见 [v1.4.3 日志](./changelog/v1.4/v1.4.3.md)第六章） |
| **v1.4.1** | 🚂 训练引擎 · 地基 八大块（train-job 编排 + train_job 审计 HMAC 链 + enterpriseId 隔离 + 可复现指纹 + 权重 HMAC 签名 + 中断回收 + 崩溃恢复 + 安全基线）+ 🚉 train_submit（66→67 tools）+ 🔬 阶段 0 Metal reward 收敛验证（@mlx-node/trl）+ 📜 双栈契约文档 + 🛡️ 训练安全基线文档 + 🧩 SKILL 体系重构 + 📦 依赖升级（LangChain 三包 + vitest）+ 🔒 sandbox 证据链时序竞态回归锁（发布期修复）· 测试 2981→3222 全量（+241：全部落在 workspace 口径 2937→3178，train 模块贡献（各包差值以 tools/check/test-count.sh 实测为准）；插件族 44 不变）· MCP 66→67 |
| **v1.4.0** | 📊 Web 工作明细页 + 🗺️ 图谱栏（FDE 双图谱 + MCP 工具视图 + skill 加载链）+ 💰 成本审计（超支告警 + `cost_query` MCP + COST DecisionKind）+ 🔌 DSH 插件家族（`cordis-plugin-sofagent-*` 9 款 · inventory 全可见 + Cursor/Claude hook 拦截）+ 🦞 OpenClaw 插件家族（4 款 code-plugin）+ 🏠 Dashboard HTML 产品化 + 📡 远程 API 通道（契约）+ 🔗 MLflow 接线 + 🌐 Agentic Browser（66 tools）+ 🔀 工具角色分层 + 瘦描述（默认全量 66 · `SOFAGENT_MCP_ROLES` 显式收窄专职面）+ ⚡ DSH 默认启用（rc 期 CLI 桥接）+ 🔌 MCP 自动配置（install.sh 装完即连）+ 🔄 联邦查询跨设备 E2E（S320 fork 10 断言 + S322 独立进程 4 场景）+ 🐚 bash 3.2 验证 + 🔍 审计溯源字段回填 · 测试 2903→2981 全量（+78：引擎 +34（含工具分层 +18 + argv 守卫 +3）· DSH 插件 +27 · OpenClaw 插件 +17；workspace 口径 2937/12 包）· MCP 61→66 |
| **v1.3.x**（10 版） | **运行时审计闭环 + L1-L3 组织协作 + 引擎接口外化 + 自进化种子**：v1.3.0 运行时审计最小闭环（激活链 SUSTAIN 收尾）→ v1.3.1 Durable Execution + Benchmark → v1.3.2 Onboard Agent → v1.3.3 L2 团队协作 → v1.3.4 L3 组织能力市场 + 编排/执行分离 → v1.3.5 MCP 自进化 + instinct→skill 自动进化 → v1.3.6 引擎接口外化完整版（模型层前置 · MCP 52→60）→ v1.3.7 SubAgent 完整沙箱 + AgentShield + 行业 overlay → v1.3.8 代理网关硬边界 + 数据静态加密 + Durable L3 → v1.3.9 AST 规则引擎 + meta-harness + FORGE driver 切 DSH（详见 [CHANGELOG](../CHANGELOG.md)） |
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
| **v1.4.4** | **🚀 训练引擎 · 信号与部署闭环（语料 + 权重 + 注册 + 对比 + 决策因果链 + CI 加固 + 存量升级 + spec-first 硬禁令 + 审查收编批）**：① **训练语料导出三件套**（规则「24+3」——口径定义见 [日志第一章表下注 A](./changelog/v1.4/v1.4.4.md#表下注-a243口径定义) + GUIDE 方法论 + 样本五源 [落点实测见 [日志第一章表下注 B](./changelog/v1.4/v1.4.4.md#表下注-b五源落点实测2026-09-01)：decision-log ✅ / llm-calls ✅异名 `llm-call-trace.ts` / evaluation-log ✅ / runtime-audit ⚠️仅 FORGE 侧实现 / fde-session ✅尚无数据] + Trace 轨迹 + 通用脱敏管线 + HMAC 签名 + 合规红线——含 human-fde 人工基准 + **规则 → reward/verifier 映射**，从 v1.3.2/v1.3.6 归集）② **企业专属模型本地权重部署链路**（权重目录规范 + 本地加载 + 版本回滚，从 v1.3.6 归集）③ **训练产物 → 模型注册自动衔接**（train done + eval pass → model_register，闭环最后一步）④ **多基座对比训练**（train compare：同数据多基座并行 + ROI 排序，阶段 2 选型前置）⑤ **决策因果链与先例检索**（decision-log 加 causedBy/causalType 因果边 + traceDecisionChain 链式回溯 + findSimilarDecisions 先例匹配——Semantica「决策即节点」启发，只参照设计不引依赖，2026-08-29 排入，详见 [v1.4.4 日志](./changelog/v1.4/v1.4.4.md)第五章）⑥ **CI 供应链加固三件套**（8 个 workflow SHA 固定 + pin 对账脚本 + 本地面 fail-closed 自查——dashboard serve 实锤全网卡监听须改绑 127.0.0.1，Semantica 工程治理启发，2026-08-29 排入，详见 [v1.4.4 日志](./changelog/v1.4/v1.4.4.md)第六章）⑦ **存量升级审查**（十六项：本版消化十项——eval 三套统一为 SSOT scorer / 79 tools 瘦描述复核（66→79 累计新增 13，2026-09-01 审查校正） / trimMessagesSafe 作用域审计 / 13 包 engines 统一 / npm 包 README 门面补齐 / check-anchors 文件存在性断言 / install.sh 部署段目录同步升级 / 「将在 vX.Y.Z 移除」过期承诺限时检查 / FDE 三层交付模板外置（distillDeliverables 模板骨架移 FDE/templates/deliverables/，模板优化从发版降级为改文档，2026-08-30 用户拍板）/ DSH 内嵌路径 cordis 断裂修复（v1.4.3 闸门发现记待办，2026-08-30 拍板）；登记分发六项去向 v1.4.8~v1.5.1（v1.5.x 顺延后区间，2026-08-31 校正）——全仓发散扫描+三轮复查+F-15 拍板追加，2026-08-29 用户拍板，详见 [v1.4.4 日志](./changelog/v1.4/v1.4.4.md)第七章）⑧ **spec-first 硬禁令**（OpenFDE 启发的单一事实源纪律工程化——transcript 永不直驱代码、spec 才是唯一驱动：check-spec-first 门禁（WARN only 渐进）+ SKILL 铁律区纪律 + doctor spec 关联覆盖率展示，2026-08-30 用户拍板自探索方向落成交付，详见 [v1.4.4 日志](./changelog/v1.4/v1.4.4.md)第八章）⑨ **六轮审查 17 项修复批**（fresh-eyes 29 视角报告桶一全量收编——2 P0（cost 配置静默丢弃/密钥环境变量未披露）+ 6 P1（webhook IPv6 SSRF 绕过/pre-commit 退出码放行/幽灵旗标×2/幽灵依赖/SECURITY 失真）+ 9 P2（数字漂移/术语漏网/注释过时/audit.md 脱敏接线/daemon 死亡感知），+ 桶三裁决 4 项落位（core 描述/注释实态/演练定性/占位测试重写），零上下文复验 5 处证据漂移修正，2026-08-31 用户拍板收编，详见 [v1.4.4 日志](./changelog/v1.4/v1.4.4.md)第九章） | [日志](./changelog/v1.4/v1.4.4.md) |
| **v1.4.5** | 📋 规划中 | **🚀 训练引擎 · 服务与持续（推理服务 + 持续后训练 + 合规扫描 + 交付包 + 归档 + quickstart + 进化引擎实证收口 + FDE 记忆目录 · 生命周期补全）**：① **训练推理服务**（train serve + 健康检查 + model_switch 联动）② **持续后训练**（数据回流 + 阈值/定时/人工触发 + 回退保护；权重级持续学习 [self-distillation/online RL] 属商业层不在本版）③ **训练数据合规扫描**（PII/敏感字段 + 合规闸门）④ **FDE 训练交付包**（配置+数据+eval 基线+运维手册+权重清单）⑤ **训练产物归档与保留策略**（train-retention + @weekly 归档 + 90 天销毁 + 空间预警）⑥ **训练引擎 Quickstart**（端到端示例文档 + 合成数据 + 最小 job.json）⑦ **进化引擎实证收口**（自原 v1.5.1 整版前移，2026-08-31 拍板——前置依赖「决策因果链」已前移 v1.4.4、依赖名存实亡：「越用越好」≥1 周持续样本 + A/B 对照 + evolution report 含证据强度三级标注与证据路径 + 措辞收紧；评估反哺 harvest→jury→promote 全链路场景；L4 工具层自进化 Agent 自写工具→SkillScan→人审→注册，五层谱系补齐；skill-impact 台账 + solves: 溯源 + eval 门控 + 执行/进化上下文隔离四件（WikiSkill 机制收编，Google Research arXiv:2608.27454——被拒提案不丢教训/技能回链问题域/过验证才发布/执行期禁查知识库，详见 [v1.4.5 日志](./changelog/v1.4/v1.4.5.md)第七章四））⑧ **FDE 进场记忆目录工程化**（自原 v1.5.3 第四章前移，2026-08-31 拍板——session 目录 + session-stop 自动捕获 + 跨 session 恢复，详见 [v1.4.5 日志](./changelog/v1.4/v1.4.5.md)第八章） | [日志](./changelog/v1.4/v1.4.5.md) |
| **v1.4.6** | 📋 规划中 | **🚀 训练引擎 · 分布式与云端（多卡 + 云 VM 执行面 · 规模化前置）**：① **多卡/分布式训练**（train multi：多卡/多机配置 + verl/DeepSpeed 集群 spawn + GPU 队列多卡拓扑感知 + 分布式失败诊断）② **云端 VM 执行面**（train cloud：Node 控制面本地 + Python 执行面云上——ssh/API 远程 spawn + 数据加密上传/训练后清理 + 云端成本入预算——「全托管」交付模式技术底座；⚠️ 敏感数据不上公有云，走客户机房联合训练） | [日志](./changelog/v1.4/v1.4.6.md) |
| **v1.4.7** | 📋 规划中 | **🔌 商业平台接口版**：G2 能力缺口查询 · G4 绩效数据导出 · G6 节点可见性元数据 · G7 多租户数据路径 v0 · workflow 烧进 USB · 审计留痕双层 · 静态加密全量接线 · G8 首部署 cron job 包（**本版最高优先级**）· **G13 PR 生命周期接口**（MCP `pr_submit`/`pr_review`/`pr_merge`——PR 提交→审阅→合并/拒绝动作面写接口，PR 状态机 + merge_criteria 联动 + 拒绝留痕进 decision-log 训练信号，2026-09-01 收编缺口 A）· **G7 补数字员工组织身份字段**（identity-store/workflow 元数据加 `orgId`——字段与策略分离，G4 绩效查询按 org 过滤防跨租户泄漏，2026-09-01 拍板提前自 v2.x）· **G1 workflow 模板导出/导入（🔶 候选占位 · 待用户拍板，非定案）**（MCP `workflow_export`/`workflow_import`——**五件套完整导出**：① workflow 定义 DAG ② 各节点 Agent 配置 ③ 节点挂载工具清单 MCP/CLI ④ 模型绑定 modelPreference ⑤ 验收标准 merge_criteria/approver + 血缘字段（来源企业/fork 链）；商业平台跨企业 fork 的载体。口径已于 2026-09-01 在 v1.4.4 第三章记明，但长期无版本单元格承接，**是 G1~G13 中唯一悬空缺口**，违反本表「🔴 阻塞项占位纪律」。**推荐落 v1.4.7 与 G13 同批**：两者同操作「workflow + 验收元数据」结构，可摊薄一次 schema 变更；且 G1 属接口面（写侧）而非交付形态面，归「商业平台接口版」比归 v2.0.0 离线 USB 节点更合语义。反候选 v2.0.0（容量足但太远，商业平台 fork 需求等不及）。拍板理由全文见 [v1.4.4 日志第三章注](./changelog/v1.4/v1.4.4.md)）· **audit 专职面文档化 + tool 描述四原则化**（`SOFAGENT_MCP_ROLES=audit` 配置说明 + 存量 audit 面与新增 G2/G4/G13 tools 描述按「职责单一/描述精确/错误清晰/参数简洁」四原则同尺打磨 + 文档-代码对账断言——**角色收窄机制 v1.4.4 已交付零开发**，本版补对外门面；仅 stdio 本地形态，远程 HTTP transport 不入本版，2026-09-03 登记）。子项定义见 [v1.4.7 规划文件](./changelog/v1.4/v1.4.7.md)；商业侧规划独立于本仓库维护 | [日志](./changelog/v1.4/v1.4.7.md) |
| **v1.4.8** | 📋 规划中 | **🔌 插件管控与工程效能（2026-08-22 新增 · Codex marketplace 启发；2026-08-24 扩充 · 七项探索方向收编）**：**① 插件来源白名单**（Git URL / 主机模式 / 本地路径三类 + 托管 hook 独裁模式，管控同时覆盖 ClawHub + SkillHub）· **② 应用级工具策略 app_tool_policy**（app×tool 白名单矩阵，fail-closed，Codex connectors 启发）· **③ 多 Agent 协作阵型库**（六阵型：commander&crews / driver&advisor / cross-review / bake-off / research-triangulation / cost-pyramid + formation.yml 配置，v1.3.6 SubAgent SDK 已交付条件成熟）· **④ 自动上下文压缩**（加载链超 3% 预算触发摘要 + 压缩标记留痕，Codex compact 启发，加载链预算收口）· **⑤ shell 提权分级策略**（safe/risky/dangerous 三态分级 + EscalationPolicy 路由 + dangerous 走 HITL，与 v1.3.7 场景权限衔接）· **⑥ 成本 quota 事前门禁**（执行前问配额 + 验证回写才记 spend，v1.4.0 事后记账的自然演进）· **⑦ 依赖方向架构测试**（13 包边界清单 + CI 强制，低成本高价值）· **⑧ workflow 节点级模型偏好绑定**（modelPreference 字段 + 模型注册表解析，不自研路由，2026-08-24 从 v1.4.7 候选移入本版）· **⑨ 技能按模型分级门控**（SKILL modelScope 字段 + 投放前兼容校验——WikiSkill 负迁移实锤防御：4B 技能把 Gemini-3.5-Flash 从 50.5% 拉到 18.1%，弱模型 workaround 束缚强模型，arXiv:2608.27454，2026-09-01 收编，详见 [v1.4.8 日志](./changelog/v1.4/v1.4.8.md)第八章扩展段）· **⑩ 自研技能进化 gate 验证器**（去 skillopt-sleep 外部依赖——eval 门控独立成验证器替代微软 CLI 子进程，理由=部署确定性+外部依赖不可控；前置依赖 v1.4.5 第七章四）eval 门控交付，2026-09-01 拍板，详见 [v1.4.8 日志](./changelog/v1.4/v1.4.8.md)⑩）· **⑪ 跨 harness 协作阵型注册表**（ACP Registry 启发——「实现一次、处处可用」分发形态：六阵型以注册表组织 + ACP 接入评估[审计执行面反向输出到编辑器工具链]，meta-harness 生态定位对照详见 [DEVELOPMENT 九C](./DEVELOPMENT.md)，2026-09-01 收编，详见 [v1.4.8 日志](./changelog/v1.4/v1.4.8.md)扩展二） | [日志](./changelog/v1.4/v1.4.8.md) |
| **v1.4.9** | 📋 规划中 | **📟 设备接入版（多设备 Harness 中间层）**：G9 设备注册/发现与心跳（MCP `device_register`/`device_list`——Ed25519 身份码 v1.3.1 复用 + 能力声明[挂载 MCP/skill/数据源] + daemon 心跳探针 v1.3.8 + 离线 webhook 告警，验签 fail-closed）· G10 设备侧数据面授权读取（数据目录白名单默认空=全不暴露 opt-in + MCP `device_data_query` + 脱敏联动 v1.4.4 管线 + 读取全程审计进 HMAC 链 + 计量进 worklog/cost）· G11 数据上行通道（采集声明 opt-in → WAL 暂存 → 断点续传 → AES-256-GCM 加密上行 → 审计留痕 → 计量进账——G10 平台拉取的补面：设备主动推，一体机推理结论/节点计量摘要回传，MCP `device_data_push`）· 跨设备任务路由评估（能力匹配 + 数据 locality + 负载水位，依赖 v1.5.1 事件总线，评估不实做）。商业平台多设备数据协同（BYOD 电脑 / AI 节点 / 模型一体机三类设备）的引擎侧载体——「平台不直连设备，数据一律过约束层」；子项定义见 [v1.4.9 规划文件](./changelog/v1.4/v1.4.9.md)；商业侧规划独立于本仓库维护 | [日志](./changelog/v1.4/v1.4.9.md) |
| **v1.5.0** | 📋 规划中 | **🛡️ 治理引擎 · 可见性与本体成熟（2026-08-29 排期 · GitHub 同类项目扫描消化 + 探索方向收编 + 存量清扫）**：① **治理 KPI 面板**（Dashboard 独立「治理」tab——安全边界触发率/审计覆盖率/HITL 时延/周环比/任务重复执行维度五卡 + **PE/VC 多企业仪表盘 v0** + 周报导出，v1.4.3 `--stats` 的面板化升级；任务重复执行维度=数据飞轮燃料读数，指标思想收编自 Harness RSI 数据飞轮论 2026-09-02）② **本体数据双时态事实**（validFrom/validTo + stateAt 时点快照查询，Semantica 启发）③ **Ontology Validation Engine**（DAG 无环 + schema 兼容 + 激活前置门，DataFlow 启发）④ **决策因果链消费**（v1.4.4 第五章前移交付 causedBy 字段——本版治理 KPI 面板「决策高亮」消费）⑤ **FDE 陪跑期补全**（期满总结报告 + fde_deploy 登记衔接——核心 v1.3.7 已交付，本版补增量）⑥ **存量清扫收尾**（五件已于 v1.4.3 先行执行——本版仅收尾：composeWithReactAgent @deprecated 别名移除 + `checkHistoryChainIntegrity` 正式移除（breaking）+ audit CLI 三 shim 移除，分阶段执行表见第六章）⑦ **跨层证据对账引擎 · trace 对账**（Agent 自述 trace [DSH session JSONL/OpenClaw 事件流] vs git diff 独立事实 vs 模型行为三源对齐——漏报/幻觉动作/瞒报差异判定 + 模型层回溯链接 v1.4.1 训练 HMAC 全链定责 + A7 证据面升级 + 治理面板 trace 对账卡（第一章总表内第六卡）；「别当摄像头当法医」——观测的对账层，不做观测产品，2026-08-30 外部竞争格局核查后排期，用户拍板，详见 [v1.5.0 日志](./changelog/v1.5/v1.5.0.md)第八章） | [日志](./changelog/v1.5/v1.5.0.md) |
| **v1.5.1** | 📋 规划中 | **⚡ 编排引擎 · 事件驱动（+ AI 异常处理总线 · 原编号 v1.5.2 顺延）**：① 业务节点从指令驱动 → **事件驱动触发**（上游产出/webhook 入站/cron 三类事件源 + `on:` 声明式订阅 + 事件总线全审计留痕 + 死信重放）② **理解债务应对**（auto-PR 决策解释块引因果链 + daemon 周报，loop-engineering 启发）③ **AI 异常处理总线**（可重试/需人工/需回滚三分类路由 + 复用事件总线死信通道 + 挂 causedBy 因果边——把 v1.3.1 节点级错误处理升级为跨节点总线形态，原候选 v2.x 前移，2026-08-29 自探索方向迁入，详见 [v1.5.1 日志](./changelog/v1.5/v1.5.1.md)第三章）④ **G12 设备 OTA 远程升级**（升级指令走事件总线 `device.upgrade` 事件 + 设备 daemon 拉取验签[复用 G9 Ed25519 链] + 灰度执行非核心→核心 + 失败自动回滚 + 升级窗口/HITL 确认策略 + 全程审计留痕，2026-09-01 用户拍板自 v2.x 前移——G9/G10/G11 管数据通道，G12 管运维通道，详见 [v1.5.1 日志](./changelog/v1.5/v1.5.1.md)第四章）。*原 v1.5.1「进化引擎实证收口」已整版前移 [v1.4.5 第七章](./changelog/v1.4/v1.4.5.md)（2026-08-31 拍板，版本号撤销引发顺延）* | [日志](./changelog/v1.5/v1.5.1.md) |
| **v1.5.2** | 📋 规划中 | **🔍 审计引擎 · 场景扩展（+ MCP audit 对外 + should-run 判定链 + OWASP 补条 + doctor 修复闭环 · 原编号 v1.5.3 顺延）**：① **SMB 场景审计**（数据处理/报表生成——勾稽/溯源/口径三规则 + DATA_PRODUCT 决策类型 + 无代码仓库 onboarding 模板）② **UI 层审计前置评估**（多模态截图证据可行性报告，实做候选 v2.x；**dashboard 首用例自举**——评估范围含「自家 dashboard 作为第一个被审计对象」，视觉回归证据链在自家产品先跑通，Omarchy visual-verification「视觉变更必须在运行中 UI 验证」精神，2026-08-31 补入）③ **MCP audit 数据对外**（audit_query 只读 tool 读 history.jsonl/decision-log + 事件订阅推送——meta-harness 延伸，DataFlow 启发，2026-08-29 自探索方向迁入，详见 [v1.5.2 日志](./changelog/v1.5/v1.5.2.md)第三章）④ **运行时 should-run 判定链**（每轮开工前五问——健康→人审 gate→证据等待→专注等待→配额全过才执行，断路器两态的丰富形态，2026-08-29 自探索方向迁入，详见 [v1.5.2 日志](./changelog/v1.5/v1.5.2.md)第四章）⑤ **OWASP Agentic Top 10 补条**（审计场景扩展版顺手补 1-2 条 ASI 规则，沿 4/10 基础按每版补条节奏推进，2026-08-31 收编）⑥ **doctor 修复闭环**（Omarchy refresh 模式启发——doctor 检查+repairHint 基础上补「备份+一键重置到默认」，条件在 v1.4.3 ⑫ Ontology 检查交付后即满足，探索方向收编，2026-08-31 拍板）。⑦ **约束导出通道**（MCP `ruleset_export`——24 条规则+扩展导出为机器可读 JSON[与 --ruleset-path 加载格式双向可逆] + 训练消费元数据[意图/样例/级别] + 版本指纹，AIR §2.8 四缺口最后一块，2026-09-01 用户拍板排期本版，详见 [v1.5.2 日志](./changelog/v1.5/v1.5.2.md)第八章）*「FDE 进场记忆目录」已前移 [v1.4.5 第八章](./changelog/v1.4/v1.4.5.md)（2026-08-31 拍板）* | [日志](./changelog/v1.5/v1.5.2.md) |
| **v1.5.3** | 📋 规划中 | **⚡ 执行引擎 · 路由与验证（模型路由层 + 凭证隔离 Vault + 多实例自验证 · 自 v2.0.0 前移 · 原编号 v1.5.4 顺延）**：① **模型路由层**（云端规划/本地执行/管道分层路由 + 敏感度 fail-closed + routeReason 可解释 + 本地端点注册——不依赖精调模型，对接现有云 API + Ollama 即可交付）② **凭证隔离 Vault**（Agent 代码碰不到 token + 轮换吊销，v1.3.7 虚拟 key 部分覆盖基础）③ **多实例自验证**（N 实例并发多数表决 + 分歧路由 HITL，复用 run_ab_test）——三项依赖全就绪故前移；v2.0.0 收窄为离线 USB 节点合体 | [日志](./changelog/v1.5/v1.5.3.md) |
| **v2.0.0** | 📋 规划中 | **🏰 数据主权大版本（收窄版 · 2026-08-29 拆分）**：**离线 USB 节点合体**一件核心（本地权重 v1.4.4 + workflow 烧录 v1.4.7 + 审计引擎 + 路由底座 v1.5.3 前移件 = 完全离线运行 + 离线激活 + 审计滞留回传）——模型路由/Vault/多实例表决三件已前移 v1.5.3，本版交付面收窄、发版确定性提高 | [日志](./changelog/v2.0/v2.0.0.md) |

### 场景数 SSOT 口径（2026-09-01 校正）

> **SSOT = `FORGE/playbook/acceptance-test.sh` 头部第 9 行的「场景数」声明，口径 = 真实 `scenario` 调用行数（非编号最大值、非运行时执行数）。**
>
> | 出处 | 值 | 说明 |
> |------|:--:|------|
> | `acceptance-test.sh:9` 头部声明 | **294** | SSOT，口径行自述「真实 scenario 调用行数，非编号最大值」 |
> | 实测 `^\s*scenario\s+<n>` 调用行 | **294** | 与头部声明**自洽**（2026-09-01 实测） |
> | 最大场景号 | S361 | 编号最大值 ≠ 场景数（S1-S344 间有 70 个历史空洞号） |
> | 唯一场景号 | 291 | 与调用行差 3：S34 出现 3 次、S167 出现 2 次——**重复编号是独立问题，本表不处理** |
> | ROADMAP v1.4.3 行（原文） | ~~293~~ | **错值，已改 294** |
>
> **本表已按 SSOT 把 v1.4.3 行的「276→293 场景（S345-S360）」校正为「276→294 场景（S345-S361）」（三处同改）**。后续版本引用场景数一律以 `acceptance-test.sh` 头部声明为准，禁止从其他文档转述。


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
| **spec-first 硬禁令（OpenFDE 启发 · ✅ v1.4.4 已排期）** | 单一事实源——transcript 永不直驱代码，spec 才是唯一驱动（落成交付见 [v1.4.4 第八章](./changelog/v1.4/v1.4.4.md)） |
| **ACS YAML 策略引擎（Microsoft AGT 启发）** | 现有 ruleset 是 JSON，AGT 的 ACS 用 YAML + OPA Rego + Cedar 三引擎——策略更人类可读，需评估兼容性 |
| **RL 训练治理（Microsoft AGT Agent Lightning 启发）** | 训练期间策略违规惩罚（policy-enforced runners + reward shaping）——需训练引擎跑通后有 reward 回路可挂，**v1.4.6 分布式执行面交付后评估排期**（2026-08-31 更新：v1.4.4 规则→reward 映射已铺路，等 v1.4.6 执行面成熟即可挂 reward 回路，候选 v1.5.x 后段） |
| **OWASP Agentic Top 10 全覆盖路线（Microsoft AGT 启发 · ✅ v1.5.2 已排期补条）** | v1.3.7 补 ASI08+ASI10，v1.3.9 补 ASI01+ASI04，v1.5.2 起按版补条（见 [v1.5.2 ⑤](./changelog/v1.5/v1.5.2.md)），远期 10/10 全覆盖对齐 AGT |
| **评测结论证据树（HarnessEval 启发 · ✅ 轻量版已排 v1.4.5）** | 评测结论须挂可验证证据树——每个结论可回溯到原始执行证据。轻量版（结论→样本文件→原始 eval 记录三跳路径）随 v1.4.5 进化样本报告交付（见 [v1.4.5 第七章](./changelog/v1.4/v1.4.5.md)）；完整版 Plan→Route→Decompose→Verify 四阶段范式升级 release-gate-loop 裁决链仍待独立来源累计后评估 |
| **证据强度分级标注（Loop Engineering 控制面启发 · ✅ 已排 v1.4.5）** | 对外展示的案例/证据按来源强度分级（公开可查 / 用户自报 / 自测自报）——v1.4.5 进化样本报告先落地三级标注（见 [v1.4.5 第七章](./changelog/v1.4/v1.4.5.md)），VALIDATION/THANKS 全站推广待样本达标后铺开 |
| **UI 层审计（多模态截图证据 · 2026-08-20 新增 · v1.5.3 已排期前置评估）** | 审计从代码 diff 扩展到 UI 行为——Agentic Browser（v1.3.9）截图经多模态分析产出 UI 层审计证据（「表单提交是否正确」不再只靠断言），截图作为审计证据入 history；**纯文本模型可用工具层视觉降级消费截图**（OCR+结构化，DSH 社区 dsh-vision 启发）；依赖 v1.3.9 多模态链路跑通 + 审计证据模型扩展，暂占概念位。**候选版本：v2.x（v1.5.3 交付可行性评估报告）**（证据模型扩展是远期） |
| **进化引擎持续样本验证（产品验证项 · 2026-08-24 登记 · ✅ 已前移 v1.4.5）** | 「越用越好」宣称当前仅 11 个一次性测试 Case（LIMITATIONS §核心效果实测情况已诚实披露），缺持续 ≥1 周样本与 A/B 对照。已随版本号前移 [v1.4.5 第七章](./changelog/v1.4/v1.4.5.md)（原 v1.5.1，2026-08-31 拍板整版前移） |
| **trace 对账（跨 harness 证据一致性 · 2026-08-30 登记 · v1.5.0 已排期）** | 观测层红海且第一方 harness 已标配（DSH Trajectory/Langfuse），sofagent 不做观测产品；但「观测的对账层」是结构性空位——Agent 自述 vs git diff vs 模型行为三源对账（「说的和干的差在哪」），只有 sofagent 能做（git-diff 独立事实 + DSH 插件生态 + 训练链 HMAC）。详见 [v1.5.0 第八章](./changelog/v1.5/v1.5.0.md) |
| **docs 文体归位（三棵树声明式迁移 · Omarchy 启发 · 2026-08-31 登记）** | 文档按受众×文体分三棵树：任务流程（SKILL/、releasing/）/ 参考（ARCHITECTURE、LIMITATIONS 等）/ 用户手册（README、HANDBOOK）——Omarchy 三棵树启发。**不做目录大迁移**（锚点/预算/历史路径破坏大于收益），走声明式：WIKI 分工表已加文体列，新内容按声明落位，旧文档大改时自然毕业。印证见 [VALIDATION · Omarchy](./VALIDATION.md#omarchyskillmd-形态收敛与单一权威源纪律) |
| **数据 schema 迁移管道（Omarchy migrations/ 启发 · 2026-08-31 登记 · 前置件已排 v1.5.0）** | `~/.sofagent/data/` 数据格式演进的机制兜底：按版本号顺序执行迁移脚本 + 幂等可重跑（`sofagent doctor --migrate` 或升级时自动执行）。**不提前建管道**（无提前抽象纪律）——v1.5.0 trace 新数据源已埋 `schemaVersion` 前置件，首个破坏性 schema 变更真实出现时再触发评估 |
| **审计范围语义一等公民化（AuditScope 重构 · 2026-09-01 登记）** | 所有规则输入面显式声明取 HEAD 还是 range——引入 `AuditScope{ diffRange, commitMsg, task, actor }` 显式对象，规则从 scope 取输入、不再自己调 git，消灭「规则自己调 git 取错范围」整类 bug（v1.4.4 审查 D-1 quick A9 同类，最小修复已随 12ec0171 落地，根治走重构专项——候选 v1.4.5+，随该版重构窗口评估） |
| **大文档三档拆分（概念/决策/清单 · 2026-09-01 登记）** | ARCHITECTURE/PHILOSOPHY 类大文档按「概念/决策/清单」三档拆分重组，控制单文档认知负载——归文档优化专项（无版本单元格，触发时机=下一次大规模文档新增时） |
| **doctor 修复闭环（Omarchy refresh 模式启发 · 2026-08-31 登记 · ✅ 已收编 v1.5.2）** | 「检查→一键修复」的自然演进：doctor 已有 repairHint（v1.4.3 补 Ontology 完整性检查），refresh 模式补「备份+重置到默认」——对标 `omarchy refresh`。已排 [v1.5.2 ⑥](./changelog/v1.5/v1.5.2.md)（条件在 v1.4.3 ⑫ 交付后即满足） |

> 📖 DeerFlow / OpenFDE 方法论印证见 [VALIDATION](./VALIDATION.md)。

> 以下「分层模型架构」为探索方向的核心技术骨架概述。当前版本引擎层未涉及，v3.x 才启动。

## 分层模型架构（v3.x 远景概述）

核心驱动力 = **数据主权**（企业数据进 API key 大模型 = 一定被拿去训练）。三层模型 + Harness 路由：云端 32B+ 负责规划推理 → 翻译成标准化指令 → 本地 MoE 主力（35B 级总参 / 3B 激活档）执行业务流判定与多步 workflow → 本地小模型跑管道层（模板/格式/字段提取）。敏感数据只在本地处理，通用知识才走云端。**引擎层只做模型路由（model-router.ts 已有四档插槽），精调 pipeline 属模型层非开源范围。** 路由层可提前到 v2.x 做（不依赖精调模型）；**离线 USB 节点提前到 v2.x**（企业专属模型本地推理 + workflow 烧录合体——v1.4.4 本地权重部署 + v1.4.7 workflow 烧录底座已就绪，v2.x 合体成完全离线节点，2026-08-19 提前）；v3.x-v4.x+ 剩企业专属小模型精调（QLoRA distill 轻量化）。完整技术骨架（Mermaid 图 + 选型表 + 实现难度）见 [PHILOSOPHY · 远期演化愿景](./PHILOSOPHY.md#远期演化愿景从内置小模型到自动化企业后训练引擎)。

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
