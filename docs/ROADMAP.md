# 路线图 · Roadmap

<p align="center"><img src="assets/sofagent.png" alt="sofagent" width="96" /></p>

> 已经做了什么、未来要去哪、哪些地方需要你的帮助。
> v1.5.1 · 2026-09-22（UTC）· ✅ 已发版 · 孔放勋
> v1.5.1（✅ 已发版 · 2026-09-22）——编排模块 · 事件驱动：测试 4903→5083 · acceptance 357→367。完整历史见 [CHANGELOG](../CHANGELOG.md)。

产品定位详见 [设计哲学](./PHILOSOPHY.md) 和 [README](../README.md)。

## 目录

- [现在在哪：v1.5.1（已发版）· 下一版 v1.5.2（已排期）](#现在在哪v151已发版-下一版-v152已排期)
- [迭代历程](#迭代历程)
- [未来去哪](#未来去哪)
- [版本规划](#版本规划)
- [行业印证](#行业印证)
- [探索方向](#探索方向)
- [分层模型架构（v3.x 远景概述）](#分层模型架构v3x-远景概述)
- [欢迎参与](#欢迎参与)
- [历史架构演进](#历史架构演进)

---

## 现在在哪：v1.5.1（已发版）· 下一版 v1.5.2（已排期）

> **v1.5.1 开发完成、文档收尾完成，已于 2026-09-22 发布**——编排模块事件驱动（业务事件触发 + 理解债务应对 + 设备 OTA 远程升级 + 异常处理总线）· 任务下发通道二期 · 生产管线接线 · 审计输入双通道 · `sofagent demo` · 测试 4903→5083 · acceptance 357→367。详见 [v1.5.1 开发日志](./changelog/v1.5/v1.5.1.md)。

---

## 迭代历程

完整版本历史见 [CHANGELOG](../CHANGELOG.md)。v0.x 为实验/测试版，v1.0.0 起为正式版。

| 版本 | 核心交付 |
|------|------|
| **v1.5.0** | **🛡️ 治理模块 · 可见性与本体成熟**：治理 KPI 面板（Dashboard 治理 tab 六卡 + 数据集审阅 + lineage 合规报告 + 周报）· 本体数据双时态（stateAt 时点快照 + 三层渐进加载）· Ontology Validation Engine（DAG 无环 + 激活前置门 fail-closed）· 决策因果链消费 · FDE 陪跑期补全 · 跨层证据对账 trace_reconcile（三源四态）· 存量清扫收尾（退役 API 正式移除 + composeWithDeepAgents 别名下线 + audit CLI 三 shim 移除）· 命名债务清扫（`@sofagent/harness` → `@sofagent/inject`）· DSH 插件事件接线 · MCP 104→**105** · 测试 4805→**4903**（+98）· acceptance 352→357（详见 [CHANGELOG](../CHANGELOG.md)） |
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
| **v1.4.8** | 🔨 开发完成（✅ 已发版（2026-09-13）） | **🔌 插件管控与工程效能**：插件来源白名单 · 应用级工具策略（app×tool 白名单矩阵，fail-closed）· 多 Agent 协作阵型库 · 自动上下文压缩 · shell 提权分级（dangerous 走 HITL）· 成本 quota 事前门禁 · 依赖方向架构测试（14 包边界[build 序列口径：13 模块包 + load-chain，不含 umbrella；workspace 总量 26 口径见 [WIKI §六](./WIKI.md#六当前状态)] + CI 强制）· workflow 节点级模型偏好绑定 · 技能按模型分级门控 · 自研进化 gate 验证器 + skillopt 重构更名 @sofagent/evolve · 跨 harness 协作阵型注册表（ACP Registry，接入仅评估不承诺）· **执行机制纪律批（调度判定双层纯函数主判 / Git 能力降级矩阵 / 多 Agent 并发 Git 纪律 / 作用域显名禁裸 id）** | [日志](./changelog/v1.4/v1.4.8.md) |
| **v1.4.9** | 🔨 开发完成（✅ 已发版（2026-09-17）） | **📟 设备接入与数据承接版（多设备 Harness 中间层 + router 伴生数据面）**：G9 设备注册/发现与心跳（Ed25519 身份 + 在线才派单/掉线改派）· G10 设备侧数据面授权读取（目录白名单 opt-in + 脱敏联动 + 审计入 HMAC 链）· G11 数据上行通道（采集声明 opt-in → WAL 暂存 → 断点续传 → 加密上行）· G5b 连接器注册/发现 · G1 workflow 模板导出/导入 + 血缘 · installer skill · 任务下发通道一期（心跳捎带）· 跨设备任务路由评估 · session 承接与 router 伴生 · 敏感识别升级（L0 正则 / L1 企业词典 / L2 外挂 NER 三层检测器）· 权重灰度发布 AB（劣化自动回退）· 设备侧 `/health` 巡检 + 会话作用域续接五元组 + 执行侧模型清单上报 + 执行时 skill 快照。详见 [开发日志](./changelog/v1.4/v1.4.9.md)。 | [日志](./changelog/v1.4/v1.4.9.md) |
| **v1.5.0** | ✅ 已发版（2026-09-19） | **🛡️ 治理模块 · 可见性与本体成熟**：治理 KPI 面板（Dashboard 治理 tab 六卡 + 数据集审阅 + lineage 合规报告 + 周报）· 本体数据双时态 · 本体渐进加载三层 · Ontology Validation Engine · 决策因果链消费 · FDE 陪跑期补全 · 存量清扫收尾（退役 API 移除 + 别名下线 + audit CLI 三 shim 移除，breaking）· 跨层证据对账 · 命名债务清扫（`@sofagent/harness` → `@sofagent/inject`，breaking）· DSH 插件事件接线。**形态归属**：主干 5 章（治理面板 / 本体双时态 / Validation Engine[**不可拔**] / FDE 陪跑期 / 跨层对账）+ 通道成分 1 + 非功能 3 章 + 插件 1 章。详见 [开发日志](./changelog/v1.5/v1.5.0.md)。 | [日志](./changelog/v1.5/v1.5.0.md) |
| **v1.5.1** | ✅ 已发版（2026-09-22） | **⚡ 编排模块 · 事件驱动**：业务节点事件驱动触发（三类事件源 + `on:` 订阅 + 死信重放）· 理解债务应对 · AI 异常处理总线（自 v2.x 前移）· G12 设备 OTA 远程升级（自 v2.x 前移）`[通道]` · 任务下发通道二期（推送/实时）`[通道]` · `sofagent demo` 五分钟戏剧弧`[通道]` · 审计输入双通道 · T8/T9 生产管线接线（自 v1.5.0 顺延）· 存量断链修复（`--legacy` 退役调用方清零 + 防复发断言，**开工优先于第三、五章**）。**形态归属**：主干 7 章 + 通道 3 章 + 通道成分 1 + 非功能 2 章。*原「进化模块实证收口」已整版前移 [v1.4.5](./changelog/v1.4/v1.4.5.md)*。详见 [开发日志](./changelog/v1.5/v1.5.1.md)。 | [日志](./changelog/v1.5/v1.5.1.md) |
| **v1.5.2** | 📋 规划中 | **🔍 审计模块 · 开放与治理面**：MCP audit 数据对外（`audit_query` 只读 + 事件订阅推送）· 运行时 should-run 判定链 · doctor 修复闭环（含 `@sofagent/skillopt` 旧包 npm deprecate 补齐——registry 侧 v1.4.8 未落的历史债；非 breaking）· 约束导出与证据链外部可验（`ruleset_export` + 零依赖验签工具）· 双规则引擎统一 · 审计规则自测 schema · A24 交付物落点审计规则（+1 成 25）· 审计结论失效语义。**形态归属**：主干 8 章 + 通道成分 1 + 非功能 1 章；四章已后移 [v1.5.4](./changelog/v1.5/v1.5.4.md)。详见 [开发日志](./changelog/v1.5/v1.5.2.md)。 | [日志](./changelog/v1.5/v1.5.2.md) |
| **v1.5.3** | 📋 规划中 | **⚡ 执行模块 · 路由与验证（自 v2.0.0 前移）**：模型路由层（云端规划/本地执行分层 + 敏感度 fail-closed + routeReason 可解释）· 凭证隔离 Vault · 多实例自验证（N 实例多数表决 + 分歧路由 HITL）· 全节点执行状态机（`SKILL.state` 收编）· tool search 按需加载 · CLI 单入口收敛（13 bin → `sofagent <域> <动作>`）· 本地槽位排队与判定分层。**形态归属**：主干 5 章 + 通道 1 章 + 非功能 1 章；v2.0.0 收窄为离线 USB 节点合体。详见 [开发日志](./changelog/v1.5/v1.5.3.md)。 | [日志](./changelog/v1.5/v1.5.3.md) |
| **v1.5.4** | 📋 规划中 | **🔍 审计模块 · 场景扩展与能力治理**：SMB 场景审计扩展（`DecisionKind` 加 `DATA_PRODUCT`[⚠️ `@public` 契约] + SMB onboarding 模板）· UI 层审计前置评估（本版不实做）· OWASP Agentic Top 10 补条 · 能力面使用率治理（SkillOps 五维 + 技术债台账）· 数据生命周期治理（归档轮转 + 遗留备份接管 + doctor data 健康项）· 可拔契约与主干能力清单（2026-09-18 用户决策落盘：`engine/capabilities.json` SSOT + 82 个 `SOFAGENT_*` 分流 + 级联校验 exit 2）。**形态归属**：主干 5 章 + 通道成分 1 + 外部成分 1 + 非功能 1 章。详见 [开发日志](./changelog/v1.5/v1.5.4.md)。 | [日志](./changelog/v1.5/v1.5.4.md) |
| **v1.5.5** | 📋 规划中 | **⚡ 进化模块 · 自进化链路补强（RSI 三算子对位 · 2026-09-19 用户决策落盘）**：经验池接训练管道（`instinct` 第五数据源）· 进化准入判据 · 三层晋级判据 · 出题考核器 · 加载链配置面契约 · 自进化写面的审计覆盖（prompt / memory 两面补留痕）· 能力基线版本线 · 验证器自身老化检测（只提示不阻断）。**形态归属**：主干 8 章 + 通道成分 1；准入、考核、写面审计三章**不可拔**。两项裁定不进版：统一改进调度器（组合层，各面未熟前属过早抽象）与证据驱动分组升级（价值中）均入探索方向表。详见 [开发日志](./changelog/v1.5/v1.5.5.md)。 | [日志](./changelog/v1.5/v1.5.5.md) |
| **v2.0.0** | 📋 规划中 | **🏰 数据主权大版本（收窄版）**：**离线 USB 节点合体**一件核心（本地权重 v1.4.4 + workflow 烧录 v1.4.7 + 审计模块 + 路由底座 v1.5.3 前移件 = 完全离线运行 + 审计滞留回传）——模型路由/Vault/多实例表决三件已前移 v1.5.3，本版交付面收窄、发版确定性提高 · **网络出口治理面（Codex Guardian 启发——host 白名单 opt-in + 出站裁决审计挂链，与 G10「管进」对称补「管出」；边界=策略契约+审计，不自建拦截器）**。**形态归属**：部署形态 1 章（**正交第三轴**——四位一体封装是「同一能力换部署形态」，归属不变，**不标 `[主干]`**）+ 主干 1 章（网络出口治理面——出站裁决 + 留痕挂链；边界自述「策略契约 + 审计，不自建拦截器」）+ 通道成分 2（第一章离线审计日志回传；第二章拦截器接口——裁决契约留约束层、egress proxy / OS 沙箱实现出约束层） | [日志](./changelog/v2.0/v2.0.0.md) |


> 维护者口径（场景数 SSOT、加载链预算跟踪）已迁 [DEVELOPMENT](./DEVELOPMENT.md)——路线图只讲方向，不讲内部对账细节。当前值 367（最大场景号 S441；SSOT = `playbook/acceptance-test.sh` 头部声明，逐条对账见 [DEVELOPMENT](./DEVELOPMENT.md)）。

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
| **统一改进调度器（RSI 组合层 · 各面成熟后再议）** | 失败信号→改进面路由的统一调度器（该改 Harness 还是改 Model 由调度器判）。裁定不进 v1.5.5（经验池/准入/晋级/考核四面未熟前属过早抽象，组合层的价值随被组合面的成熟而增长）。触发条件：[v1.5.5](./changelog/v1.5/v1.5.5.md) 四章交付且各面有真实运行数据后评估 |
| **证据驱动分组（GEE 式 evolve 升级）** | instinct→skill 聚合从 2-gram 浅分组升级为证据驱动（工具调用直方图 / 高频命令 / 重复纠正聚合后再判哪些模式成 skill——RSI-Harness GEE 思路，轨迹数据 execution-backends/trajectory.ts 已有）。裁定价值中、独立可做——不占版本格，触发条件=下一次 evolve 模块返工窗口 |
| **透明仓（wild idea）** | evidence/ 实时公开治理原始记录（含误报）——审查 run 的 P0/P1 判定、误报与翻案全过程原样公开，「审查自己也在被审计」。比发版后 cherry-pick 的结论文档更狠的诚实面；误报率压到红线以下（**红线 <5%，当前未测**——见 [evidence 误报率红线](./evidence/evidence.md)）才敢开，先攒 [anti-cases](./evidence/anti-cases/README.md) 与 fresh-eyes 校准档案，无版本单元格、不排期，触发条件=第三方首次独立审查 |
| **运行期宿主装配（通道章宿主侧收尾）** | v1.5.1 的三条通道章（G12 设备 OTA / 任务下发通道二期 / `sofagent demo`）交付的是**契约与执行侧**，宿主侧装配不在该版落点，留下三项悬空：① **签名者信任锚**——`verifyDeliverySignature` 只证「摘要由信封**自带公钥**签出」的自洽性，全链无平台公钥 pin / 无 principal 白名单 / 无设备注册表绑定（[SECURITY](../SECURITY.md#g12-设备远程下发面升级--内容下发--任务推送) G12 ① 已如实披露）② **订阅登记调用方归属**——`registerDeviceSubscriptions` / `deviceTaskReceipt` 零生产调用方，需定「`device_register` 成功后调用」还是「设备进程启动时注册」（含重启幂等语义）③ **死信批量排空器**——`listDeadLetters()` 聚合枚举已在位，缺的是批量**动作**入口；排空器须逐条确认，沿用 `replayDeadLetter` 的「非 retryable 需显式 `force`」守卫。**触发条件 = 首次接真实传输通道**：第①项在该时点由「设计期已知缺口」直接变为「已暴露面」（当前三条下发面均为注入端口、外部不可达），须同批落地；②③ 可与①同批，也可在设备侧生命周期语义定稿后单独落地。归因 **W3**（已交付能力的缺陷与债务 · 悬空承诺）｜ 无版本单元格 |
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
