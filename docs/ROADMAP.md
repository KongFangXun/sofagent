# 路线图 · Roadmap

> 已经做了什么、未来要去哪、哪些地方需要你的帮助。
> v1.4.6 · 2026-09-09（UTC，⏳ 定稿待发版）· 🚀 后训模块 · 分布式与云端（多卡训练/云 VM 执行面/边界收缩）。此前版本详见 [CHANGELOG](../CHANGELOG.md) 与各版开发日志。

产品定位详见 [设计哲学](./PHILOSOPHY.md) 和 [README](../README.md)。

## 现在在哪：v1.4.6（已交付）

> **v1.4.6 开发完成（2026-09-07）**——后训模块 · 分布式与云端（多卡/多机训练 train_multi + 云 VM 执行面 train_cloud + 边界收缩约 −1.2k 行）· 测试 4055→4088（12 包 workspace 口径）· acceptance 311 场景 / 392 断言（S376-S382 新增 + S383 边界收缩行为锁）· MCP 83→84 tools · release-gate verdict=PASS（run-02 + 2026-09-09 手动收敛版判断层补齐，LEDGER 20260909-03）。详见 [v1.4.6 开发日志](./changelog/v1.4/v1.4.6.md)。下一版 v1.4.7（商业平台接口版，G8 cron job 包 + 云训练执行接线收口 + G14 workflow 工具面）见[版本规划](#版本规划)。

---

## 迭代历程

完整版本历史见 [CHANGELOG](../CHANGELOG.md)。v0.x 为实验/测试版，v1.0.0 起为正式版。

| 版本 | 核心交付 |
|------|------|
| **v1.4.6** | **🚀 后训模块 · 分布式与云端**：多卡/多机训练（gpu.count/nodes + schema v2 存量兼容 + GPU 双轴拓扑 + NCCL 第八类诊断）+ 云 VM 执行面（train_cloud 注册/体检/远程 spawn + 分拣三档宁拦勿漏 + 失联止损 5min + 成本入预算）+ 标准数据推送接口（双闸，入口接线 v1.4.7）+ 边界收缩（配方外部装载/trainEnvInit 归 shell/model-downloader 删除/TrainExecutor 隔离，约 −1.2k 行）· 测试 4055→4088 · acceptance 310→311 · MCP 83→84（详见 [CHANGELOG](../CHANGELOG.md)） |
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

## 未来去哪

> 以下是**方向**，不是承诺。没实测过的事标「不知道」。

**终局**：企业不再需要 FDE。AI 节点部署后自主运行，审计模块持续盯变更，编排模块自动纠偏，知识库自我积累——人只需要偶尔看一眼 dashboard 确认一切正常。我们做的不是给企业装 AI，是让企业忘了我们的存在。

> 连创造 AI 的人都在公开表达方向失控的不安（DeepMind 创始人 Hassabis 2026 年访谈）——「AI 可以被管住」的 Harness 中间件不是选配，是刚需。

**为什么是现在——转折点的三信号**：单一信号不够，三信号同时成熟才构成真正的范式转折点：

| 信号 | 维度 | 内容 |
|------|------|------|
| 供给侧 | AI Coding 成本趋零 | FDE 借 AI Coding 1 天出 Demo，瓶颈从技术能力转向**业务抽象能力**（能否把 SOP 拆成 Agent 业务流） |
| 治理侧 | Agent IAM 组织身份 | Agent 有工号/权限/审计/全生命周期管理，从「工具」变「员工」，才能进生产环境 |
| 能力侧 | 协同飞轮持续进化 | 每次人工纠正/确认/追问回流为结构化学习信号，越用越懂企业 |

**现实验证**：业务流主语从「人」迁移到「Agent」——SOP 拆为 Agent 业务流、给 Agent 派工号、人工纠正回流为学习信号——三信号同时成熟的落地案例。

sofagent 的定位正卡在这个转折点上：审计模块（治理侧）+ Ontology（能力侧）+ 开源 MIT（供给侧）——三信号缺一不可，单独做任何一个都不够。

**供给侧技术拼图已齐**（NVIDIA 2025.7 判断：模型/微调框架/示范方案/沙盒/工具链全部就绪）——sofagent 的 `install.sh` + FDE 四阶段示范方案直接给一套可以跑的蓝图，不是告诉企业"该做"。

两条路径：**FDE 驻场部署**（传统中小企业，FDE 进场→四阶段十二步流程→交付→撤离）和 **开发者自部署**（开源社区，git clone→install.sh→审计→CI 集成）。

设备端形态：安装时可配置 Agent 平台（OpenClaw / WorkBuddy 等），审计结果通过 MCP server 推到企业协同平台。**数据主权在设备**——所有记忆、日志、决策记录永不离开本地。

> 以下是方向落地为版本的具体拆解。v3.x 长期架构骨架见下方「探索方向」。

---

## 版本规划

> 以下带状态版本表为权威源；各版本子项定义见各行「日志」列链接的规划文件。

### 规划版本


> 🔴 **阻塞项占位纪律**：任何 🔴 采购 / 合规阻塞项必须在下表占据一个**明确的版本单元格**（标注具体版本号），不得仅写在散文备注里。

| 版本 | 状态 | 核心交付 | 日志 |
|------|:--:|------|:--:|
| **v1.4.7** | 📋 规划中 | **🔌 商业平台接口版**：G2 能力缺口查询 · G4 绩效数据导出（orgId 过滤防跨租户）· G6 节点可见性元数据 · G7 多租户数据路径 v0 · workflow 烧进 USB · 审计留痕双层 · 静态加密全量接线 · **G8 首部署 cron job 包（本版最高优先级）** · G13 PR 生命周期接口（含拒绝留痕进 decision-log）· **G1 workflow 模板导出/导入（🔶 候选占位 · 待定，非定案）** · 上岗 prompt 生成器（裸装节点开箱即用的岗位 prompt 生成，与 G14 工具面同批）· **G14 workflow CRUD + LUI Agent 工具面（四 tools + schema 校验门内嵌 + `trigger.schedule` 节点级定时字段，「平台零 GUI」的引擎侧地基）** · G13 PR 触发绑定 confidence 两态（suggested/confirmed 三铁律）· audit 专职面文档化 + tool 描述四原则化（机制 v1.4.4 已交付，本版补对外门面）· **云训练执行接线收口（daemon 真实 ssh 执行 + `TrainChannel` 标准接口与适配规范——不预设用户云厂商，托管微调 API 由用户按规范对接，引擎出 ssh 通道与参考示例 + 云端事件回流审计链 + 失联止损 + 端到端 demo）**；商业侧规划独立于本仓库维护 | [日志](./changelog/v1.4/v1.4.7.md) |
| **v1.4.8** | 📋 规划中 | **🔌 插件管控与工程效能**：插件来源白名单（Git URL/主机/本地路径 + 托管 hook 独裁）· 应用级工具策略（app×tool 白名单矩阵，fail-closed）· 多 Agent 协作阵型库（六阵型）· 自动上下文压缩（加载链超 3% 预算触发）· shell 提权分级（dangerous 走 HITL）· 成本 quota 事前门禁 · 依赖方向架构测试（13 包边界 + CI 强制）· workflow 节点级模型偏好绑定 · 技能按模型分级门控 · 自研进化 gate 验证器 + skillopt 重构更名 @sofagent/evolve（进化四角色合拢完整自进化循环）· 跨 harness 协作阵型注册表（ACP Registry）· **执行机制纪律批（商业平台机制对账：调度判定双层纯函数主判 / Git 能力降级矩阵三态×两隔离 / 多 Agent 并发 Git 纪律 / 作用域显名禁裸 id）** | [日志](./changelog/v1.4/v1.4.8.md) |
| **v1.4.9** | 📋 规划中 | **📟 设备接入与数据承接版（多设备 Harness 中间层 + router 伴生数据面）**：G9 设备注册/发现与心跳（Ed25519 身份码 + 验签 fail-closed）· G10 设备侧数据面授权读取（目录白名单默认空 opt-in + 脱敏联动 + 读取审计入 HMAC 链）· G11 数据上行通道（采集声明 opt-in → WAL 暂存 → 断点续传 → 加密上行）· installer skill（prompt 驱动裸机自动安装）· 任务下发通道一期——心跳捎带 · 在线才派单 / 掉线改派语义（G9 验收标准补全）· 跨设备任务路由评估（依赖 v1.5.1 事件总线，评估不实做）· **session 承接与 router 伴生（自 v1.5.3 前移改写：router 基于开源自建、引擎不自研 router 本体，交付伴生 exporter 协议——过站 session 多轮样本模型 + 蒸馏偏好对构造 + 工作产物采集五源→六源 + usage 入 cost 台账 + key 维度 harness 四件：按 key 计量/审计挂链/异常检测/处置建议）**· **敏感识别升级（自 v1.5.3 前移 + 三层检测器新编排：L0 内置正则 / L1 企业专名词典（最高优先级·零模型）/ L2 外挂 NER（含一体机本地模型适配器）+ Presidio 实体类型 schema 对齐；敏感度分类器与脱敏共用插槽 + 置信度三层 fail-closed）**· **权重灰度发布 AB（自 v1.5.3 前移：新旧 LoRA 按流量比例灰度 + 劣化自动回退）**——一体机数据飞轮（session→分拣→脱敏→数据集→训练→灰度上线）在 v1.5.0 前整链成型；「平台不直连设备，数据一律过约束层」；**设备侧 /health 健康巡检端点（三态分层）+ 会话作用域续接五元组（宁可不续走摘要交接）+ 执行侧模型清单上报 + 执行时 skill 快照（打包/清理/审计锚点）**；商业侧规划独立于本仓库维护 | [日志](./changelog/v1.4/v1.4.9.md) |
| **v1.5.0** | 📋 规划中 | **🛡️ 治理模块 · 可见性与本体成熟**：治理 KPI 面板（Dashboard 独立「治理」tab 六卡 + 数据集审阅卡（语义质量人审兜底）+ 合规报告导出（数据集 lineage 双闸记录 + 审计链 HMAC 引用）+ PE/VC 多企业仪表盘 v0 + 周报导出）· 本体数据双时态事实（validFrom/validTo + 时点快照）· 本体渐进加载三层（entity 摘要→relations→全文，记忆层预算联动）· Ontology Validation Engine（DAG 无环 + 激活前置门）· 决策因果链消费（v1.4.4 causedBy 字段面板化）· FDE 陪跑期补全（期满总结 + fde_deploy 登记衔接）· 存量清扫收尾（退役 API 正式移除[breaking] + audit CLI 三 shim 移除）· 跨层证据对账引擎 trace 对账（Agent 自述 vs git diff vs 模型行为三源对齐——「别当摄像头当法医」） | [日志](./changelog/v1.5/v1.5.0.md) |
| **v1.5.1** | 📋 规划中 | **⚡ 编排模块 · 事件驱动**：业务节点事件驱动触发（上游产出/webhook 入站/cron 三类事件源 + `on:` 声明式订阅 + 死信重放）· 理解债务应对（auto-PR 决策解释块引因果链 + daemon 周报）· AI 异常处理总线（三分类路由 + 复用死信通道，自 v2.x 前移）· G12 设备 OTA 远程升级（验签 + 灰度 + 失败自动回滚，自 v2.x 前移——G9-G11 管数据通道，G12 管运维通道）· 任务下发通道二期——推送/实时（一期心跳捎带在 v1.4.9）。*原「进化模块实证收口」已整版前移 [v1.4.5](./changelog/v1.4/v1.4.5.md)* | [日志](./changelog/v1.5/v1.5.1.md) |
| **v1.5.2** | 📋 规划中 | **🔍 审计模块 · 场景扩展**：SMB 场景审计（勾稽/溯源/口径三规则 + 无代码仓库 onboarding 模板）· UI 层审计前置评估（多模态截图证据可行性报告，实做候选 v2.x）· MCP audit 数据对外（audit_query 只读 + 事件订阅推送）· 运行时 should-run 判定链（每轮开工前五问）· OWASP Agentic Top 10 按版补条 · doctor 修复闭环（备份 + 一键重置到默认）· 约束导出通道（ruleset_export 机器可读 JSON，与加载格式双向可逆）· **双规则引擎统一（消除 ARCHITECTURE 悬空承诺——tool-level 3 条与 git-diff 24 条收敛为单一规则引擎 + 两种触发时机）***「FDE 进场记忆目录」已前移 [v1.4.5](./changelog/v1.4/v1.4.5.md)* | [日志](./changelog/v1.5/v1.5.2.md) |
| **v1.5.3** | 📋 规划中 | **⚡ 执行模块 · 路由与验证（自 v2.0.0 前移 · 原编号 v1.5.4 顺延）**：模型路由层（云端规划/本地执行分层路由 + 敏感度 fail-closed + routeReason 可解释——敏感度分类输入前置件与 session 承接/权重灰度 AB 已前移 [v1.4.9](./changelog/v1.4/v1.4.9.md)，本版做调用侧分流）· 凭证隔离 Vault（Agent 代码碰不到 token + 轮换吊销）· 多实例自验证（N 实例多数表决 + 分歧路由 HITL，复用 run_ab_test）· 全节点执行状态机（SKILL.state 收编——P+Σt+ot 三输入确定性合并，O(1) prompt O(T) token + 「轨迹可弃行为可溯」审计闸门前置）。三项依赖全就绪故前移；v2.0.0 收窄为离线 USB 节点合体 | [日志](./changelog/v1.5/v1.5.3.md) |
| **v2.0.0** | 📋 规划中 | **🏰 数据主权大版本（收窄版）**：**离线 USB 节点合体**一件核心（本地权重 v1.4.4 + workflow 烧录 v1.4.7 + 审计模块 + 路由底座 v1.5.3 前移件 = 完全离线运行 + 离线激活 + 审计滞留回传）——模型路由/Vault/多实例表决三件已前移 v1.5.3，本版交付面收窄、发版确定性提高 | [日志](./changelog/v2.0/v2.0.0.md) |

### 场景数 SSOT 口径

> **SSOT 口径**：`FORGE/playbook/acceptance-test.sh` 头部「场景数」声明 = 真实 `scenario` 调用行数（非编号最大值、非运行时执行数）。当前值 305（最大场景号 S375，S1-S344 间有历史空洞号；S373/S374/S375 为 v1.4.5 反哺闭环、L4 自进化链路级与 train 五新面行为锁场景——S375 两批扩展覆盖模块八/六，S265 归并入 S264 对销）。
>
> 后续版本引用场景数一律以 `acceptance-test.sh` 头部声明为准，禁止从其他文档转述。


### 加载链预算目标跟踪

- **≤3% 总占用预算目标**（加载链总占用 ≤ 上下文窗口 3% / 规范类 ≤500 字 / think ≤2K token）：当前未全量落地（全文注入，仅 persona 前 500 字符与 knowledge 单篇前 2000 字符有截断）；目标版本：后续版本（与窗口超预算拒载/降级机制一并落地，见 [ARCHITECTURE §四 加载链预算](./ARCHITECTURE.md#四核心设计决策)）。

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
| **自带净水设备的水龙头（v3.x+ 远景）** | Subagent 支持挂载外部精调小模型（引擎层提供路由与加载插槽），零投喂、本地推理、离线可用 |
| 国标 Agent 审计对位 | 关注国家 AI 智能体互联标准草案进展，标准正式发布后评估对齐 |
| **ACS YAML 策略引擎（Microsoft AGT 启发）** | 现有 ruleset 是 JSON，AGT 的 ACS 用 YAML + OPA Rego + Cedar 三引擎——策略更人类可读，需评估兼容性 |
| **RL 训练治理（Microsoft AGT Agent Lightning 启发）** | 训练期间策略违规惩罚（policy-enforced runners + reward shaping）——v1.4.4 规则→reward 映射已铺路，v1.4.6 分布式执行面（train multi）已交付，待排期评估（候选 v1.5.x 后段） |
| **docs 文体归位（三棵树声明式迁移 · Omarchy 启发）** | 文档按受众×文体分三棵树：任务流程（SKILL/、releasing/）/ 参考（ARCHITECTURE、LIMITATIONS 等）/ 用户手册（README、HANDBOOK）——Omarchy 三棵树启发。**不做目录大迁移**（锚点/预算/历史路径破坏大于收益），走声明式：WIKI 分工表已加文体列，新内容按声明落位，旧文档大改时自然毕业。印证见 [VALIDATION · Omarchy](./VALIDATION.md#omarchyskillmd-形态收敛与单一权威源纪律) |
| **数据 schema 迁移管道（Omarchy migrations/ 启发）** | `~/.sofagent/data/` 数据格式演进的机制兜底：按版本号顺序执行迁移脚本 + 幂等可重跑（`sofagent doctor --migrate` 或升级时自动执行）。**不提前建管道**（无提前抽象纪律）——v1.5.0 trace 新数据源已埋 `schemaVersion` 前置件，首个破坏性 schema 变更真实出现时再触发评估 |
| **审计范围语义一等公民化（AuditScope 重构）** | 所有规则输入面显式声明取 HEAD 还是 range——引入 `AuditScope{ diffRange, commitMsg, task, actor }` 显式对象，规则从 scope 取输入、不再自己调 git，消灭「规则自己调 git 取错范围」整类 bug（v1.4.4 审查 D-1 quick A9 同类，最小修复已随 12ec0171 落地，根治走重构专项——v1.4.5 重构窗口已过未排期，候选 v1.5.x 后段） |
| **大文档三档拆分（概念/决策/清单）** | ARCHITECTURE/PHILOSOPHY 类大文档按「概念/决策/清单」三档拆分重组，控制单文档认知负载——归文档优化专项（无版本单元格，触发时机=下一次大规模文档新增时） |
| **CLI 单入口收敛（叙事收敛批）** | 11 个 `sofagent-*` 二进制命令对用户是 11 个记忆点——长期收口为 `sofagent <域> <动作>` 单入口（`sofagent audit` / `sofagent train` / `sofagent ontology` …），旧命令保留兼容期。动 bin 面与全部文档，候选 v1.5.x 某版评估（与 v1.4.8 依赖方向架构测试同期看） |
| **DSH-only 执行面收尾（保险绳拆除）** | FORGE 执行后端 v1.4.3 起全 step 默认 DSH，LangGraph 仅作 fallback 保险绳（`FORGE_FRESH_EYES_BACKEND=langgraph` 回退口 + langgraph-backend.ts + audit-middleware 包裹路径）。DSH 发布非 alpha 稳定版且连续 2–3 个完整 run 零 fallback 时，删除兜底面收尾为 DSH-only——driver 侧质量门控（熔断/产物门控/宽限窗）是产品逻辑不随迁，留在 driver。alpha 期实测已两遇破坏性变更（0.1.2-alpha.3→rc.1 砍 `Session.events`，防御见 snapshotSessionEvents 双形态兼容），保险绳成本低、拆除不急 |
| **透明仓（wild idea · 视角 21）** | evidence/ 实时公开治理原始记录（含误报）——审查 run 的 P0/P1 判定、误报与翻案全过程原样公开，「审查自己也在被审计」。比发版后 cherry-pick 的结论文档更狠的诚实面；误报率够低（当前 <5%）才敢开，先攒 [anti-cases](./evidence/anti-cases/README.md) 与 fresh-eyes 校准档案，无版本单元格、不排期，触发条件=第三方首次独立审查 |

> 📖 DeerFlow / OpenFDE 方法论印证见 [VALIDATION](./VALIDATION.md)。

> 以下「分层模型架构」为探索方向的核心技术骨架概述。当前版本引擎层未涉及，v3.x 才启动。

## 分层模型架构（v3.x 远景概述）

核心驱动力 = **数据主权**（企业数据进 API key 大模型 = 一定被拿去训练）。三层模型 + Harness 路由：云端 32B+ 负责规划推理 → 翻译成标准化指令 → 本地 MoE 主力（35B 级总参 / 3B 激活档）执行业务流判定与多步 workflow → 本地小模型跑管道层（模板/格式/字段提取）。敏感数据只在本地处理，通用知识才走云端。**引擎层只做模型路由（model-router.ts 已有四档插槽），精调 pipeline 属模型层非开源范围。** 路由层可提前到 v2.x 做（不依赖精调模型）；**离线 USB 节点提前到 v2.x**（企业专属模型本地推理 + workflow 烧录合体——v1.4.4 本地权重部署 + v1.4.7 workflow 烧录底座已就绪，v2.x 合体成完全离线节点）；v3.x-v4.x+ 剩企业专属小模型精调（QLoRA distill 轻量化）。完整技术骨架（Mermaid 图 + 选型表 + 实现难度）见 [PHILOSOPHY · 远期演化愿景](./PHILOSOPHY.md#远期演化愿景从内置小模型到自动化企业后训模块)。

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

编排模块从 ao → DeepAgents → LangGraph 的升级史（v1.2.0 起 FORGE loop 已完全弃用 deepagents，改用 createReactAgent；历史编排模块的 DeepAgents 调度原型见 v1.1.8 changelog）、Ontology 从实体关联到本体数据的渐进构建、外部框架对标（Palantir/gbrain/WeKnora/Runta）、Loop Engineering 全栈对照等详见 **[ARCHITECTURE.md](./ARCHITECTURE.md)** 的「架构设计决策的行业锚点」+「编排收敛与 A/B 测试」+「本体数据 = GitHub 生长树」章节，以及各版本 **[开发日志](./changelog/)**。

> 📖 多设备同步方案见 [多设备同步指南](./guides/multi-device-sync.md)。

> 📖 loop-engineering 启发方向的去向：FDE 节点注册表 + Worktree 隔离已交付（v1.3.5 / v1.3.6），理解债务已排期（v1.5.2），quota 事前门禁 + 依赖方向测试已排期（v1.4.8）。来源链接见 [cobusgreyling/loop-engineering](https://github.com/cobusgreyling/loop-engineering)（MIT 开源）。
