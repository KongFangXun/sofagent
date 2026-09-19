# 路线图 · Roadmap

<p align="center"><img src="assets/sofagent.png" alt="sofagent" width="96" /></p>

> 已经做了什么、未来要去哪、哪些地方需要你的帮助。
> v1.5.0 · 2026-09-19（UTC）· ✅ 已发版 · 孔放勋
> v1.5.0（✅ 已发版 · 2026-09-19）——治理模块 · 可见性与本体成熟：MCP 104→105 tools · 测试 4805→4903 · acceptance 352→357。完整历史见 [CHANGELOG](../CHANGELOG.md)。

产品定位详见 [设计哲学](./PHILOSOPHY.md) 和 [README](../README.md)。

## 目录

- [现在在哪：v1.5.0（已交付）· 下一版 v1.5.1（待发版）](#现在在哪v150已交付-下一版-v151待发版)
- [迭代历程](#迭代历程)
- [未来去哪](#未来去哪)
- [版本规划](#版本规划)
- [行业印证](#行业印证)
- [探索方向](#探索方向)
- [分层模型架构（v3.x 远景概述）](#分层模型架构v3x-远景概述)
- [欢迎参与](#欢迎参与)
- [历史架构演进](#历史架构演进)

---

## 现在在哪：v1.5.0（已交付）· 下一版 v1.5.1（待发版）

> **v1.5.0 开发完成、文档收尾完成，待发布**——治理 KPI 面板 + 本体数据双时态 + Validation Engine + 跨层证据对账 + FDE 陪跑期 + 存量清扫 + DSH 插件事件接线 · 测试 4805→4903 · acceptance 352→357。详见 [v1.5.0 开发日志](./changelog/v1.5/v1.5.0.md)。发布后本节随 bump 同批更新。

---

## 迭代历程

完整版本历史见 [CHANGELOG](../CHANGELOG.md)。v0.x 为实验/测试版，v1.0.0 起为正式版。

| 版本 | 核心交付 |
|------|------|
| **v1.5.0** | **🛡️ 治理模块 · 可见性与本体成熟**：治理 KPI 面板（Dashboard 治理 tab 六卡 + 数据集审阅 + lineage 合规报告 + 周报导出）· 本体数据双时态（stateAt 时点快照 + 三层渐进加载）· Ontology Validation Engine（DAG 环检测 + 激活前置门 fail-closed）· 跨层证据对账 trace_reconcile（三源四态）· FDE 陪跑期 + @sofagent/inject 更名 · DSH 插件事件接线 · MCP 104→105 tools · 测试 4805→4903 · acceptance 352→357 |
| **v1.4.9** | **📡 设备接入与数据承接**：G9 设备注册/发现/心跳（Ed25519 身份 + 在线才派单/掉线改派）+ G10 数据目录白名单授权读取 + G11 采集声明 opt-in 上行（WAL 加密暂存 + 断点续传 + 审计计量）+ T7 router 过站 session 承接 + T8 敏感识别三层插槽（SDK 面）+ T9 权重灰度 AB + G5b 连接器注册 + G1 workflow 模板血缘 + T6 installer + T10 模型清单 · MCP 95→**104**（9 新）· 测试 4429→**4805**（详见 [CHANGELOG](../CHANGELOG.md)） |
| **v1.4.8** | **🔌 插件管控与工程效能**：插件来源白名单 · 应用级工具策略 · 多 Agent 协作阵型库 · 自动上下文压缩 · shell 提权分级 · 成本 quota 事前门禁 · 依赖方向架构测试 · 自研进化 gate（skillopt 更名 `@sofagent/evolve`）· 执行机制纪律批 · MCP 95→**95**（零新增）· 测试 4279→**4429**（详见 [CHANGELOG](../CHANGELOG.md)） |
| **v1.4.7** | **🔌 商业平台接口版**：读接口（G2 能力缺口 / G4 人机贡献度 / G6 节点级可见性 / G7 多租户 v0）· 写接口（G13 PR 生命周期三 tool · G14 workflow CRUD 四 tool · `trigger.schedule`）· 交付三件（workflow 烧 USB / G8 首部署 cron / 上岗 prompt）· 云训练执行收口（TrainChannel 标准接口 + ssh 通道）· 三接线（静态加密 / audit repo-hash / data_push）· audit 规约层与 PROV-O 导出· 测试 4107→**4279**（起点为换基后口径：4107 = 4088 + 19 散测；CHANGELOG 索引行记换基前值 4088）· acceptance 311→328 · MCP 84→**95**（详见 [CHANGELOG](../CHANGELOG.md)） |
| **v1.4.6** | **🚀 后训模块 · 分布式与云端**：多卡/多机训练（gpu.count/nodes + schema v2 存量兼容 + GPU 双轴拓扑 + NCCL 第八类诊断）+ 云 VM 执行面（train_cloud 注册/体检/远程 spawn + 分拣三档宁拦勿漏 + 失联止损 5min + 成本入预算）+ 标准数据推送接口（双闸，入口接线 v1.4.7）+ 边界收缩（配方外部装载/trainEnvInit 归 shell/model-downloader 删除/TrainExecutor 隔离，约 −1.2k 行）· 测试 4055→4088 · acceptance 305→311 · MCP 83→84（详见 [CHANGELOG](../CHANGELOG.md)） |
| **v1.4.5** | **🚀 后训模块 · 服务与持续**：训练推理服务 train_serve + 持续后训练三触发与回退保护 + 合规扫描闸门 train_compliance + FDE 交付包 train_deliverable + 保留策略归档 + 后训 Quickstart 十步 + 进化实证收口（真脑/台账/采样/L4 自进化）+ FDE 进场记忆目录 + 可靠性加固批（webhook SSRF/审计链截断/超时降级）· 测试 3753→4055 · acceptance 304→305 · MCP 80→83（详见 [CHANGELOG](../CHANGELOG.md)） |
| **v1.4.4** | **🚀 后训模块 · 信号与部署闭环**：训练语料导出三件套（corpus_export 79→80 + reward 骨架）+ 企业专属模型本地权重部署（manifest+sha256 篡改拒绝+rollback-weights）+ 训练产物→注册自动衔接 + 多基座对比（train compare ROI 排序）+ 决策因果链与先例检索 + CI 供应链全 SHA 固定 + 五能力叙事定稿 · 测试 3619→3753 · acceptance 294→304 · MCP 79→80（详见 [CHANGELOG](../CHANGELOG.md)） |
| **v1.4.3** | **🚀 后训模块 · 运行与需求 + 审计聚合指标**：训练监控 + GPU 队列（train_status/train_list）· 失败诊断 train_diagnose 七类 · 训练沙箱 + 设备打包 · 需求推导 + RL 配方模板 · 后训练 workflow 模板 · 审计聚合指标 --stats · 训练反作弊基线 · 存量清扫五件（含 checkHistoryChainIntegrity 退役公告）· doctor 补 Ontology 完整性 · 测试 3349→3619 · acceptance 276→294 · MCP 76→79 |
| **v1.4.2** | **🚀 后训模块 · 数据与评估 + FDE Harness 层**：数据管道（多源接入 + 质量闸门 + 脱敏）· dataset_version 版本台账 · eval 闭环 · 环境管理 + train_doctor · dry-run 与算力外推 · 训练报告 · FDE 六件（fde_interview/classify/quantify/derive/distill/deploy）· IM 桥 dsh-im · 测试 3202→3349 · acceptance 271→276 · MCP 67→76 |
| **v1.4.1** | 🚂 后训模块 · 地基 八大块（train-job 编排 + train_job 审计 HMAC 链 + enterpriseId 隔离 + 可复现指纹 + 权重 HMAC 签名 + 中断回收 + 崩溃恢复 + 安全基线）+ train_submit + 阶段 0 Metal reward 收敛验证 + 双栈契约/训练安全基线文档 + SKILL 体系重构 · 测试 2981→3222（+241）· MCP 66→67 |
| **v1.4.0** | 📊 Web 工作明细页 + 图谱栏 + 成本审计（cost_query）+ DSH 插件 9 款 + OpenClaw 插件 4 款 + Dashboard 产品化 + 联邦查询 E2E + MLflow + Agentic Browser + 工具角色分层 + MCP 自动配置 · 测试 2903→2981 · MCP 61→66 |
| **v1.3.x**（10 版） | **运行时审计闭环 + L1-L3 组织协作 + 引擎接口外化 + 自进化种子**：v1.3.0 运行时审计最小闭环（激活链 SUSTAIN 收尾）→ v1.3.1 Durable Execution + Benchmark → v1.3.2 Onboard Agent → v1.3.3 L2 团队协作 → v1.3.4 L3 组织能力市场 + 编排/执行分离 → v1.3.5 MCP 自进化 + instinct→skill 自动进化 → v1.3.6 引擎接口外化完整版（模型层前置 · MCP 52→60）→ v1.3.7 SubAgent 完整沙箱 + AgentShield + 行业 overlay → v1.3.8 代理网关硬边界 + 数据静态加密 + Durable L3 → v1.3.9 AST 规则引擎 + meta-harness + FORGE driver 切 DSH（详见 [CHANGELOG](../CHANGELOG.md)） |
| **v1.2.x**（10 版） | **激活链 ACTIVATE→ORCHESTRATE→EXECUTE 全线打通 + 约束层叙事统一 + 三个入口产品**：v1.2.0 物理结构大重构（/sofagent/→/engine/）→ v1.2.5 激活链 Phase 1 + A20-A23 规则 → v1.2.7 编排模块增强（StateGraph + Session Goals）→ v1.2.9 FORGE 短任务化 + npx CLI/规则市场/GitHub Action 三入口 + 约束层叙事重构（详见 [CHANGELOG](../CHANGELOG.md)） |
| **v1.1.x**（10 版） | **编排模块从 ao → LangGraph + 多设备联邦 + Dream Cycle 知识进化**：v1.1.0 包结构纯度重构（12 包独立）→ v1.1.3 LangGraph StateGraph 直接编排 → v1.1.7 Dream Cycle 6 阶段 + 知识健康巡检 → v1.1.8 安全层加密 + 联邦查询 → v1.1.9 产品叙事收敛（FDE Agent）+ USB 完整运行时（详见 [CHANGELOG](../CHANGELOG.md)） |
| **v1.0.x**（10 版） | **审计模块奠基 + AI 知识库实现 + 双节点架构**：v1.0.0 正式版发布（Agent 审计工具，2026-07-10）→ v1.0.5 Ontology 统一层 + Work模板市场 → v1.0.7 双节点架构 + ao 退役 → v1.0.8 FDE Agent 自进化 + 文件系统审计 → v1.0.9 二进制审计 + MCP compose tool（详见 [CHANGELOG](../CHANGELOG.md)） |

> ℹ️ v1.4.8 / v1.4.9 两行未单列 acceptance 增量——两版合计 acceptance 328→352，逐版拆分未留档，按诚实原则留空；v1.5.0 起恢复逐版记录。

## 未来去哪

> 以下是**方向**，不是承诺。没实测过的事标「不知道」。

**终局**：企业不再需要 FDE。AI 节点部署后自主运行，审计模块持续盯变更，编排模块自动纠偏，知识库自我积累——人只需要偶尔看一眼 dashboard 确认一切正常。我们做的不是给企业装 AI，是让企业忘了我们的存在。

> 连创造 AI 的人都在公开表达方向失控的不安（DeepMind 创始人 Hassabis 2026 年访谈）——「AI 可以被管住」的 Harness 中间件不是选配，是刚需。

**为什么是现在——转折点的三信号**：单一信号不够，三信号同时成熟才构成真正的范式转折点：

| 信号 | 维度 | 内容 |
|------|------|------|
| 供给侧 | AI Coding 成本趋零 | FDE 借 AI Coding 1 天出 Demo，瓶颈从技术能力转向**业务抽象能力**（能否把 SOP 拆成 Agent 工作流） |
| 治理侧 | Agent IAM 组织身份 | Agent 有工号/权限/审计/全生命周期管理，从「工具」变「员工」，才能进生产环境 |
| 能力侧 | 协同飞轮持续进化 | 每次人工纠正/确认/追问回流为结构化学习信号，越用越懂企业 |

**现实验证**：工作流主语从「人」迁移到「Agent」——SOP 拆为 Agent 工作流、给 Agent 派工号、人工纠正回流为学习信号——三信号同时成熟的落地案例。

sofagent 的定位正卡在这个转折点上：审计模块（治理侧）+ Ontology（能力侧）+ 开源 MIT（供给侧）——三信号缺一不可，单独做任何一个都不够。

**供给侧技术拼图已齐**（NVIDIA 2025.7 判断：模型/微调框架/示范方案/沙盒/工具链全部就绪）——sofagent 的 `install.sh` + FDE 四阶段示范方案直接给一套可以跑的蓝图，不是告诉企业"该做"。

两条路径：**FDE 驻场部署**（传统中小企业，FDE 进场→四阶段十二步流程→交付→撤离）和 **开发者自部署**（开源社区，git clone→install.sh→审计→CI 集成）。

设备端形态：安装时可配置 Agent 平台（OpenClaw / WorkBuddy 等），审计结果通过 MCP server 推到企业协同平台。**数据主权在设备**——所有记忆、日志、决策记录永不离开本地。

> 以下是方向落地为版本的具体拆解。v3.x 长期架构骨架见下方「探索方向」。

---

## 版本规划

> 以下带状态版本表为权威源；各版本子项定义见各行「日志」列链接的规划文件。

### 排期准入判据

> **每版交付章上限 10 章**（v1.5.0 已冻结的章节不追溯；自 v1.5.1 起适用）。超限章**优先后移到后续版本**（用版本序列承接，不轻易退回探索方向表——先把版本排满再谈砍）；后移顺序按下方权重从低到高。

| 权重 | 来源 | 判据 |
|:--:|------|------|
| **W1** | 具名消费方诉求 | 指认得出消费方——G 编号 / 平台层或模型层接口表 / 真实客户诉求 |
| **W2** | 数据飞轮链路缺口 | 一体机链路（session→分拣→脱敏→数据集→训练→灰度）上缺失的那一环 |
| **W3** | 已交付能力的缺陷与债务 | 存量红、命名债、假绿、跨仓漂移、悬空承诺 |
| **W4** | 外部对照研究收编 | 须能回答「服务于 W1 或 W2 的哪一条」；答不出按 W5 处置 |
| **W5** | 内部灵感 / 远景 / 纯评估报告 | 默认进探索方向表，不占版本章；已排者超限时优先移出 |

**两条落地纪律**：① **收编须指认消费方**——进 changelog 的每章须能指认 W1/W2/W3 至少一项，不能指认的移入探索方向表；② **不设冷却期**——外部研究的吸收节奏由维护者按当期上下文人工裁定，登记（[VALIDATION](./VALIDATION.md)）与承诺（changelog）分离的原则不变。

### 规划版本

> 🔴 **阻塞项占位纪律**：任何 🔴 采购 / 合规阻塞项必须在下表占据一个**明确的版本单元格**（标注具体版本号），不得仅写在散文备注里。

| 版本 | 状态 | 核心交付 | 日志 |
|------|:--:|------|:--:|
| **v1.4.8** | 🔨 开发完成（✅ 已发版（2026-09-13）） | **🔌 插件管控与工程效能**：插件来源白名单（Git URL/主机/本地路径 + 托管 hook 独裁）· 应用级工具策略（app×tool 白名单矩阵，fail-closed）· 多 Agent 协作阵型库（六阵型）· 自动上下文压缩（加载链超 3% 预算触发）· shell 提权分级（dangerous 走 HITL）· 成本 quota 事前门禁 · 依赖方向架构测试（13 包边界[build 序列口径：12 模块包 + load-chain，不含 umbrella] + CI 强制）· workflow 节点级模型偏好绑定 · 技能按模型分级门控 · 自研进化 gate 验证器 + skillopt 重构更名 @sofagent/evolve（进化四角色合拢完整自进化循环）· 跨 harness 协作阵型注册表（ACP Registry，接入仅评估不承诺）· **执行机制纪律批（商业平台机制对账：调度判定双层纯函数主判 / Git 能力降级矩阵三态×两隔离 / 多 Agent 并发 Git 纪律 / 作用域显名禁裸 id）** | [日志](./changelog/v1.4/v1.4.8.md) |
| **v1.4.9** | 🔨 开发完成（✅ 已发版（2026-09-17）） | **📟 设备接入与数据承接版（多设备 Harness 中间层 + router 伴生数据面）**：G9 设备注册/发现与心跳（Ed25519 身份码 + 验签 fail-closed）· G10 设备侧数据面授权读取（目录白名单默认空 opt-in + 脱敏联动 + 读取审计入 HMAC 链）· G11 数据上行通道（采集声明 opt-in → WAL 暂存 → 断点续传 → 加密上行）· **G5b 连接器注册/发现（自 v1.4.8 迁入：connector_list + 第三方连接器注册——v1.4.8 实交付插件来源白名单 + app_tool_policy，连接器注册面未随版落地）** · **G1 workflow 模板导出/导入 + 血缘（自 v1.4.7 候选迁入：五件套导出 + fork 谱系回流——逐版对账确认掉出版本序列）** · installer skill（prompt 驱动裸机自动安装）· 任务下发通道一期——心跳捎带 · 在线才派单 / 掉线改派语义（G9 验收标准补全）· 跨设备任务路由评估（依赖 v1.5.1 事件总线，评估不实做）· **session 承接与 router 伴生（自 v1.5.3 前移改写：router 基于开源自建、约束层不自研 router 本体，交付伴生 exporter 协议——过站 session 多轮样本模型 + 蒸馏偏好对构造 + 工作产物采集五源→六源 + usage 入 cost 台账 + key 维度 harness 四件：按 key 计量/审计挂链/异常检测/处置建议）**· **敏感识别升级（自 v1.5.3 前移 + 三层检测器新编排：L0 内置正则 / L1 企业专名词典（最高优先级·零模型）/ L2 外挂 NER（含一体机本地模型适配器）+ Presidio 实体类型 schema 对齐；敏感度分类器与脱敏共用插槽 + 置信度三层 fail-closed）**· **权重灰度发布 AB（自 v1.5.3 前移：新旧 LoRA 按流量比例灰度 + 劣化自动回退）**——一体机数据飞轮（session→分拣→脱敏→数据集→训练→灰度上线）在 v1.5.0 前整链成型；「平台不直连设备，数据一律过约束层」；**设备侧 /health 健康巡检端点（三态分层）+ 会话作用域续接五元组（宁可不续走摘要交接）+ 执行侧模型清单上报 + 执行时 skill 快照（打包/清理/审计锚点）**；商业侧规划独立于本仓库维护 | [日志](./changelog/v1.4/v1.4.9.md) |
| **v1.5.0** | ✅ 已发版（2026-09-19） | **🛡️ 治理模块 · 可见性与本体成熟**：治理 KPI 面板（Dashboard 独立「治理」tab 六卡 + 数据集审阅卡（语义质量人审兜底）+ 合规报告导出（数据集 lineage 双闸记录 + 审计链 HMAC 引用）+ 周报导出）· 本体数据双时态事实（validFrom/validTo + 时点快照）· 本体渐进加载三层（entity 摘要→relations→全文，记忆层预算联动）· Ontology Validation Engine（DAG 无环 + 激活前置门）· 决策因果链消费（v1.4.4 causedBy 字段面板化）· FDE 陪跑期补全（期满总结 + fde_deploy 登记衔接）· 存量清扫收尾（退役 API 正式移除[breaking] + composeWithDeepAgents @public 别名下线[breaking·基线同批改] + audit CLI 三 shim 移除 + **关键依赖落后决策**：js-yaml patch 已升，zod / LangGraph / automerge 具名顺延）· 跨层证据对账（trace 对账）（Agent 自述 vs git diff vs 模型行为三源对齐——「别当摄像头当法医」）· 命名债务清扫（@sofagent/harness → @sofagent/inject[breaking]，harness 一词独占给产品叙事）· **DSH 插件事件接线（cordis 对照研究收编——plugin-kit 加 seamHandlers 声明面，audit 4 事件位 + inject/evolve/rollback 各 1 共 7 handler 接既有 bridge API，判定逻辑零改动纯接线；seam 从声明到实现，SEAMS §6 两侧拉平）** `[插件]`。**形态归属**：主干 5 章（治理面板 / 本体双时态[含渐进加载扩展] / Validation Engine[**不可拔**] / FDE 陪跑期 / 跨层对账）+ 通道成分 1（跨层对账的 trace 接入适配器——宿主事件流解析） + 非功能 3 章（存量清扫=**退役动作**属可拔契约执行面 / 探索方向说明=文档 / 命名债=重构）+ 插件 1 章（DSH 事件接线——只声明 seam 转发 handler 接既有 bridge，判定与审计逻辑零改动） | [日志](./changelog/v1.5/v1.5.0.md) |
| **v1.5.1** | 📋 规划中 | **⚡ 编排模块 · 事件驱动**：业务节点事件驱动触发（上游产出/webhook 入站/cron 三类事件源 + `on:` 声明式订阅 + 死信重放）· 理解债务应对（auto-PR 决策解释块引因果链 + daemon 周报）· AI 异常处理总线（三分类路由 + 复用死信通道，自 v2.x 前移）· G12 设备 OTA 远程升级（验签 + 灰度 + 失败自动回滚，自 v2.x 前移——G9-G11 管数据通道，G12 管运维通道）`[通道]` · 任务下发通道二期——推送/实时（一期心跳捎带在 v1.4.9）`[通道]` · `sofagent demo` 五分钟戏剧弧（增长杠杆——一条命令跑完注入→违规→拦截→回滚→举证，探索方向提级）`[通道]` · **审计输入双通道（事件总线第一个消费方：`tools/pre-execute` 意图流接入 + 规则通道声明 + 同链留痕——审计输入从 git diff 单通道扩为「调用意图 + 结果文本」双通道，规则判定逻辑零改动）** · **T8/T9 生产管线接线（自 v1.5.0 顺延——v1.4.9 已交付的敏感识别三层插槽（L0 敏感模式/L1 词典/L2 外挂 NER）与权重灰度 AB 由 SDK 面接入生产管线：`device_data_push` / `router_session_push` 上行过三层检测 + 灰度分流，判定逻辑零改动）**。**形态归属**：主干 5 章（事件驱动触发 / 理解债务 / 异常总线 / 审计输入双通道 / T8/T9 生产管线接线）+ 通道 3 章（demo 演示编排 / G12 运维通道——**验签判定留主干**，本版只出设备侧执行面；任务下发二期——推送/实时，走设备通道契约）+ 通道成分 1（事件驱动触发的 webhook / IM 外部入站适配器——IO 接入算子）。*原「进化模块实证收口」已整版前移 [v1.4.5](./changelog/v1.4/v1.4.5.md)* | [日志](./changelog/v1.5/v1.5.1.md) |
| **v1.5.2** | 📋 规划中 | **🔍 审计模块 · 开放与治理面**：MCP audit 数据对外（audit_query 只读 + 事件订阅推送）· 运行时 should-run 判定链（每轮开工前五问）· doctor 修复闭环（备份 + 一键重置到默认 + **@sofagent/evolve 旧包退役收尾**：移除 workspace 引用，自 v1.4.8 承接——breaking 随重置语义一并收）· 约束导出与证据链外部可验（ruleset_export 机器可读 JSON 双向可逆 + **独立验签工具**零依赖三态校验——第三方无需安装 sofagent 即可举证 HMAC 链）· **双规则引擎统一（消除 ARCHITECTURE 悬空承诺——tool-level 3 条与 git-diff 24 条收敛为单一规则引擎 + 两种触发时机）**· **审计规则自测 schema（Codex execpolicy 启发——24 条规则强制携带 match/not_match 正负样例，加载时断言 fail-closed + FAIL 报文附替代建议 + 多规则取最严）**· **A24 交付物落点审计规则（+1 条成 25——白名单 opt-in 事前拦截，出生即带正负样例；全仓计数落点同批升级）**· **审计结论失效语义（Codex Guardian 启发——授权变更/压缩不兼容/风险升级三触发，失效结论不当新证据用；只收失效词汇表与判定，不收 reviewer pool）****形态归属**：主干 7 章（MCP audit 对外 / should-run 判定链 / doctor 修复闭环 / 约束导出与独立验签 / 规则自测 schema / A24 交付物落点规则 / 审计结论失效语义）+ 通道成分 1（doctor 修复闭环的 refresh 备份与重置执行动作）+ 非功能 1 章（双规则引擎统一=重构，不新增能力面）——功能章全部为审计判定与举证面。*「FDE 进场记忆目录」已前移 [v1.4.5](./changelog/v1.4/v1.4.5.md)*；*四章（SMB 场景审计扩展 / UI 层审计前置评估 / OWASP 补条 / 能力面使用率治理）已后移 [v1.5.4](./changelog/v1.5/v1.5.4.md)* | [日志](./changelog/v1.5/v1.5.2.md) |
| **v1.5.3** | 📋 规划中 | **⚡ 执行模块 · 路由与验证（自 v2.0.0 前移 · 原编号 v1.5.4 顺延）**：模型路由层（云端规划/本地执行分层路由 + 敏感度 fail-closed + routeReason 可解释——敏感度分类输入前置件与 session 承接/权重灰度 AB 已前移 [v1.4.9](./changelog/v1.4/v1.4.9.md)，本版做调用侧分流）· 凭证隔离 Vault（Agent 代码碰不到 token + 轮换吊销）· 多实例自验证（N 实例多数表决 + 分歧路由 HITL，复用 run_ab_test）· 全节点执行状态机（SKILL.state 收编——P+Σt+ot 三输入确定性合并，O(1) prompt O(T) token + 「轨迹可弃行为可溯」审计闸门前置）· **tool search 按需加载（OpenAI Agents API 启发——工具不全量注入，按节点域+任务检索注入子集 + 分步按需 + 命中率度量；mid-turn steering 运行中纠偏随本版评估）**· **CLI 单入口收敛（13 bin → `sofagent <域> <动作>`——实测 12 个 `sofagent-*` + 裸名主入口已在位，补域路由 + 旧命令 shim 化，文档面同批收敛）** · **本地槽位排队与判定分层（私有部署一体机形态消费方[W1]——本地并发槽位信号量 3–5 + 排队超时按合规升级云端 + 判定分层 L0 声明式映射/L1 embedding 分类/L2 难例兜底[判定不占本地主模型槽] + 决策下达面[补 v1.4.9 承接面的反向通道，构成双向闭环]）**。**形态归属**：主干 5 章（路由判定 / 多实例表决 / 全节点状态机 / tool search / 本地槽位排队与判定分层）+ 通道 1 章（凭证 Vault——凭证托管/轮换/吊销是通用轮子，换 HashiCorp Vault 价值不受损，「Agent 代码碰不到 token」的拦截约束留主干）+ 非功能 1 章（CLI 单入口=重构 13 bin → 1）。主干部分为判定、拦截、留痕、账本四类产出，无插件化空间。三项依赖全就绪故前移；v2.0.0 收窄为离线 USB 节点合体 | [日志](./changelog/v1.5/v1.5.3.md) |
| **v1.5.4** | 📋 规划中 | **🔍 审计模块 · 场景扩展与能力治理**：SMB 场景审计扩展（数据处理/报表生成——数值勾稽 / 来源可溯 / 口径一致三规则 + `DecisionKind` 加 `DATA_PRODUCT`[⚠️ `@public` 契约] + SMB onboarding 模板 + 治理 KPI 复用）· UI 层审计前置评估（多模态截图证据可行性报告，实做候选 v2.x）· OWASP Agentic Top 10 补条（按版补 1-2 条 ASI 规则走向 10/10）· 能力面使用率治理（SkillOps 五维 + 低价值技能退役候选 + 技术债台账 + 工具使用率遥测 `tool-usage.jsonl` 本地无上报 + `stats --tools` 三视图）· 数据生命周期治理（memory 事实二级分层+归档轮转 / 审计链历史段归档双锚点 / 遗留备份接管 / doctor data 健康项）——**四章自 v1.5.2 章数上限收敛后移**（按[排期准入判据](#排期准入判据)），第五章新增排期 · **可拔契约与主干能力清单（2026-09-18 用户拍板落盘：`engine/capabilities.json` SSOT + 82 个 `SOFAGENT_*` 按「功能门控 / 配置参数」分流 + 级联校验 exit 2 + 关档硬线扩主干侧 + `list_capabilities` 可拔能力地图）**。**形态归属**：主干 5 章（SMB 场景审计扩展 / OWASP 补条 / 能力面使用率治理 / 数据生命周期治理 / **可拔契约与主干能力清单**）+ 通道成分 1（数据生命周期治理中的归档轮转与遗留清理**执行动作**）+ 外部成分 1（SMB onboarding 模板——数据类）+ 非功能 1 章（UI 层审计前置评估=可行性报告，本版不实做） | [日志](./changelog/v1.5/v1.5.4.md) |
| **v1.5.5** | 📋 规划中 | **⚡ 进化模块 · 自进化链路补强（RSI 三算子对位 · 2026-09-19 用户拍板落盘）**：经验池接训练管道（instinct 池→数据集→TrainChannel 断链打通——`instinct` 第五数据源 + 血缘锚点，一体机飞轮 Data 面自供给）· 进化准入判据（检验-生成差距——域验证器三档 deterministic/model-judge/human-only 分流 + 未登记 fail-closed 按 human-only）· 三层晋级判据（注入租用→skill 半持久→微调摊销——频次×存续×验证三输入纯函数 + 晋级台账 + promote-train 只提示人审）· 出题考核器（instinct 反向生成考核题 + 双成功才 `verified` 入池 + 考核态进 scorer 置信度——Data-RSI 归因→出题→考核补齐）· 加载链配置面契约（四层配置字段 SSOT + 字段所有权断言 + 越界检测——与 v1.5.4 可拔契约同族）· **自进化写面的审计覆盖（第三轮补盲：prompt / memory 两面补留痕——权重面 v1.4.4 manifest 与 skill 面 eval-gate 已覆盖，唯独自我改进最大的两个写面无硬证据，审计失明）** · **能力基线版本线（四层状态快照成链——v1.4.9 执行级快照管单次可复现，本版管跨时间可追溯，出事能回答「当时它是怎么做事的」）** · **验证器自身老化检测（元验证——进化越久验证集越失真，越进化门越松；老化只提示不阻断）**。**形态归属**：主干 8 章（准入判据 / 晋级判据 / 出题考核器 / 配置面契约 / 经验池管道的入池资格判定 / 写面审计覆盖 / 能力基线版本线 / 验证器老化检测）+ 通道成分 1（经验池管道的数据集构造与 TrainChannel 提交**执行动作**）；准入、考核、写面审计三章**不可拔**（进化安全边界与审计地基）。两项裁定不进版：统一改进调度器（马场——组合层，各面未熟前过度抽象）与证据驱动分组升级（马鞍但价值中）均入探索方向表 | [日志](./changelog/v1.5/v1.5.5.md) |
| **v2.0.0** | 📋 规划中 | **🏰 数据主权大版本（收窄版）**：**离线 USB 节点合体**一件核心（本地权重 v1.4.4 + workflow 烧录 v1.4.7 + 审计模块 + 路由底座 v1.5.3 前移件 = 完全离线运行 + 审计滞留回传）——模型路由/Vault/多实例表决三件已前移 v1.5.3，本版交付面收窄、发版确定性提高 · **网络出口治理面（Codex Guardian 启发——host 白名单 opt-in + 出站裁决审计挂链，与 G10「管进」对称补「管出」；边界=策略契约+审计，不自建拦截器）**。**形态归属**：部署形态 1 章（**正交第三轴**——四位一体封装是「同一能力换部署形态」，归属不变，**不标 `[主干]`**）+ 主干 1 章（网络出口治理面——出站裁决 + 留痕挂链；边界自述「策略契约 + 审计，不自建拦截器」）+ 通道成分 2（第一章离线审计日志回传；第二章拦截器接口——裁决契约留约束层、egress proxy / OS 沙箱实现出约束层） | [日志](./changelog/v2.0/v2.0.0.md) |


> 维护者口径（场景数 SSOT、加载链预算跟踪）已迁 [DEVELOPMENT](./DEVELOPMENT.md)——路线图只讲方向，不讲内部对账细节。当前值 358（最大场景号 S431；SSOT = `playbook/acceptance-test.sh` 头部声明，逐条对账见 [DEVELOPMENT](./DEVELOPMENT.md)）。

---

## 行业印证

> 完整行业对标（DeerFlow / Omnigent / DataFlow / OpenWorker / OpenFDE / a16z 七法则 / Graph Engineering / 5 阶段风险收敛）统一见 [VALIDATION](./VALIDATION.md)。以下仅保留与版本规划直接相关的结论。

**落地纪律**：行业对标均为「用行业术语框定已有/规划能力」，不新增能力范围。外部框架是设计启发 + 开源借力，非依赖引入。

**热度信号**：2025-2026 硅谷「AI 自进化 / Loop」成为最热关键词（斯坦福 2025 秋季自进化公开课），其「工具调用 + 验证器 + 评审器 + 编排器」四件套与激活链（ACTIVATE→ORCHESTRATE→EXECUTE→SUSTAIN）逐件对位——激活链不是追热点，是提前踩中趋势。方法论印证见 [VALIDATION · Verifier 才是瓶颈](./VALIDATION.md#verifier-才是瓶颈) 与 [VALIDATION · 循环系统的鲁棒性](./VALIDATION.md#循环系统的鲁棒性四类故障与六要素)。

---

## 探索方向

> 探索方向 = 想到了但还没排进具体版本的方向。已交付的见[迭代历程](#迭代历程)，已排期的见[版本规划](#版本规划)。

| 方向 | 一句话 |
|------|------|
| **自带净水设备的水龙头（v3.x+ 远景）** | Subagent 支持挂载外部精调小模型（约束层提供路由与加载插槽），零投喂、本地推理、离线可用 |
| 国标 Agent 审计对位 | 关注国家 AI 智能体互联标准草案进展，标准正式发布后评估对齐 |
| **ACS YAML 策略引擎（Microsoft AGT 启发）** | 现有 ruleset 是 JSON，AGT 的 ACS 用 YAML + OPA Rego + Cedar 三引擎——策略更人类可读，需评估兼容性 |
| **RL 训练治理（Microsoft AGT Agent Lightning 启发）** | 训练期间策略违规惩罚（policy-enforced runners + reward shaping）——v1.4.4 规则→reward 映射已铺路，v1.4.6 分布式执行面（train multi）已交付，待排期评估（候选 v1.5.x 后段） |
| **事前授权（mandate）补环** | 现有审计是**事后**环（变更 → git diff → 24 规则 → 留痕可举证），缺**事前**环：Agent 动手前先领一张有限、可归属的授权（范围 + 时效 + 审批人），越界在**执行前**拦下而非事后追责。公开生态已有把两环做成同一个协议的实现（`emiliaprotocol/emilia-protocol`——在受保护执行边界上强制有限、客户自有授权）——本仓目前只有后环。**不提前抽象**：动手条件是真实企业客户提出「先批后干」的合规诉求；另注意 `define_acceptance` 是**验收条件**不是**行动授权**，两者别混 |
| **docs 文体归位（三棵树声明式迁移 · Omarchy 启发）** | 文档按受众×文体分三棵树：任务流程（SKILL/、releasing/）/ 参考（ARCHITECTURE、LIMITATIONS 等）/ 用户手册（README、HANDBOOK）——Omarchy 三棵树启发。**不做目录大迁移**（锚点/预算/历史路径破坏大于收益），走声明式：WIKI 分工表已加文体列，新内容按声明落位，旧文档大改时自然毕业。印证见 [VALIDATION · Omarchy](./VALIDATION.md#omarchyskillmd-形态收敛与单一权威源纪律) |
| **数据 schema 迁移管道（Omarchy migrations/ 启发）** | `~/.sofagent/data/` 数据格式演进的机制兜底：按版本号顺序执行迁移脚本 + 幂等可重跑（`sofagent doctor --migrate` 或升级时自动执行）。**不提前建管道**（无提前抽象纪律）——v1.5.0 trace 新数据源已埋 `schemaVersion` 前置件，首个破坏性 schema 变更真实出现时再触发评估 |
| **审计范围语义一等公民化（AuditScope 重构）** | 所有规则输入面显式声明取 HEAD 还是 range——引入 `AuditScope{ diffRange, commitMsg, task, actor }` 显式对象，规则从 scope 取输入、不再自己调 git，消灭「规则自己调 git 取错范围」整类 bug（v1.4.4 审查 quick A9 同类，最小修复已随 12ec0171 落地，根治走重构专项——v1.4.5 重构窗口已过未排期，候选 v1.5.x 后段） |
| **大文档三档拆分（概念/决策/清单）** | ARCHITECTURE/PHILOSOPHY 类大文档按「概念/决策/清单」三档拆分重组，控制单文档认知负载——归文档优化专项（无版本单元格，触发时机=下一次大规模文档新增时） |
| **DSH-only 执行面收尾（保险绳拆除）** | FORGE 执行后端 v1.4.3 起全 step 默认 DSH，LangGraph 仅作 fallback 保险绳（`FORGE_FRESH_EYES_BACKEND=langgraph` 回退口 + langgraph-backend.ts + audit-middleware 包裹路径）。DSH 发布非 alpha 稳定版且连续 2–3 个完整 run 零 fallback 时，删除兜底面收尾为 DSH-only——driver 侧质量门控（熔断/产物门控/宽限窗）是产品逻辑不随迁，留在 driver。alpha 期实测已两遇破坏性变更（0.1.2-alpha.3→rc.1 砍 `Session.events`，防御见 snapshotSessionEvents 双形态兼容），保险绳成本低、拆除不急 |
| **统一改进调度器（RSI 组合层 · 各面成熟后再议）** | 失败信号→改进面路由的统一调度器（该改 Harness 还是改 Model 由调度器判）。裁定不进 v1.5.5（马场——经验池/准入/晋级/考核四面未熟前是过度抽象，组合层的价值随被组合面的成熟而增长）。触发条件：[v1.5.5](./changelog/v1.5/v1.5.5.md) 四章交付且各面有真实运行数据后评估 |
| **证据驱动分组（GEE 式 evolve 升级）** | instinct→skill 聚合从 2-gram 浅分组升级为证据驱动（工具调用直方图 / 高频命令 / 重复纠正聚合后再判哪些模式成 skill——RSI-Harness GEE 思路，轨迹数据 execution-backends/trajectory.ts 已有）。裁定马鞍但价值中、独立可做——不占版本格，触发条件=下一次 evolve 模块返工窗口 |
| **透明仓（wild idea · 视角 21）** | evidence/ 实时公开治理原始记录（含误报）——审查 run 的 P0/P1 判定、误报与翻案全过程原样公开，「审查自己也在被审计」。比发版后 cherry-pick 的结论文档更狠的诚实面；误报率够低（当前 <5%）才敢开，先攒 [anti-cases](./evidence/anti-cases/README.md) 与 fresh-eyes 校准档案，无版本单元格、不排期，触发条件=第三方首次独立审查 |
| **透明仓（wild idea）** | evidence/ 实时公开治理原始记录（含误报）——审查 run 的 P0/P1 判定、误报与翻案全过程原样公开，「审查自己也在被审计」。比发版后 cherry-pick 的结论文档更狠的诚实面；误报率压到红线以下（**红线 <5%，当前未测**——见 [evidence 误报率红线](./evidence/evidence.md)）才敢开，先攒 [anti-cases](./evidence/anti-cases/README.md) 与 fresh-eyes 校准档案，无版本单元格、不排期，触发条件=第三方首次独立审查 |
| **敌手自测（audit 红队）** | 定期以攻击者视角尝试绕过审计——篡改 `history.jsonl` / 伪造 HMAC 链 / 绕过 ToolGate，结果进 [anti-cases](./evidence/anti-cases/README.md)。审计系统的可信度靠「被打过而没被打穿」证明；与「透明仓」触发条件（第三方首次独立审查）天然合流。无版本单元格、不排期 |

> 📖 DeerFlow / OpenFDE 方法论印证见 [VALIDATION](./VALIDATION.md)。

> 以下「分层模型架构」为探索方向的核心技术骨架概述。当前版本约束层未涉及，v3.x 才启动。

## 分层模型架构（v3.x 远景概述）

核心驱动力 = **数据主权**（企业数据进 API key 大模型 = 一定被拿去训练）。三层模型 + Harness 路由：云端 32B+ 负责规划推理 → 翻译成标准化指令 → 本地 MoE 主力（35B 级总参 / 3B 激活档）执行工作流判定与多步 workflow → 本地小模型跑管道层（模板/格式/字段提取）。敏感数据只在本地处理，通用知识才走云端。**约束层只做模型路由（model-router.ts 已有四档插槽），精调 pipeline 属模型层非开源范围。** 路由层可提前到 v2.x 做（不依赖精调模型）；**离线 USB 节点提前到 v2.x**（企业专属模型本地推理 + workflow 烧录合体——v1.4.4 本地权重部署 + v1.4.7 workflow 烧录底座已就绪，v2.x 合体成完全离线节点）；v3.x-v4.x+ 剩企业专属小模型精调（QLoRA distill 轻量化）。完整技术骨架（Mermaid 图 + 选型表 + 实现难度）见 [PHILOSOPHY · 远期演化愿景](./PHILOSOPHY.md#远期演化愿景从内置小模型到自动化企业后训模块)。

---

## 欢迎参与

| 你能做的事 | 时间 | 说明 |
|------|:--:|------|
| 跨平台测试 | 30 min | 你有 Codex / Hermes / Claude Code？装一下告诉我们 |
| 补充 FAQ | 20 min | 你踩了什么坑？直接改 [HANDBOOK](./HANDBOOK.md) 的「排查与自定义」节 |
| 文档翻译 | 1-2 h | 英文翻译对社区意义巨大 |
| 第三方证据 | 1 周 | 装完用一周，填 [docs/evidence/evidence.md](./evidence/evidence.md) |
| 安全审计 | 不限 | 给 SECURITY.md 较真 |
| 企业场景反馈 | 30 min | 你们团队怎么用 Agent？直接开 Issue |

> [CONTRIBUTING.md](../CONTRIBUTING.md)

---

## 历史架构演进

编排模块从 ao → DeepAgents → LangGraph 的升级史（v1.2.0 起 FORGE loop 已完全弃用 deepagents，改用 createReactAgent；历史编排模块的 DeepAgents 调度原型见 v1.1.8 changelog）、Ontology 从实体关联到本体数据的渐进构建、外部框架对标（Palantir/gbrain/WeKnora/Runta）、Loop Engineering 全栈对照等详见 **[ARCHITECTURE.md](./ARCHITECTURE.md)** 的「架构设计决策的行业锚点」+「编排收敛与 A/B 测试」+「本体数据 = GitHub 生长树」章节，以及各版本 **[开发日志](./changelog/)**。

> 📖 多设备同步方案见 [多设备同步指南](./guides/multi-device-sync.md)。

> 📖 loop-engineering 启发方向的去向：FDE 节点注册表 + Worktree 隔离已交付（v1.3.5 / v1.3.6），理解债务已排期（v1.5.1），quota 事前门禁 + 依赖方向测试已交付（v1.4.8）。来源链接见 [cobusgreyling/loop-engineering](https://github.com/cobusgreyling/loop-engineering)（MIT 开源）。
