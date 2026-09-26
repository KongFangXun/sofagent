# Changelog

<p align="center"><img src="docs/assets/sofagent.png" alt="sofagent" width="96" /></p>

> **本文件是目录索引**。每个版本的完整开发日志在 [`docs/changelog/`](./docs/changelog/) 下，此处仅保留「版本能力索引（一段式）+ 链接」与「跨版本破坏性变更 / 退役公告」，不重复逐版细节。
> 实验版（v0.x）历史日志在 [`docs/archive/changelog-experimental/`](./docs/archive/changelog-experimental/)。
> **状态标注约定**：正式版条目一律带发布日期；近期版本另附「已发版 / 待发版」状态标注，历史版本以日期为准。

---

## 正式版（v1.0.0+）

> 未来版本规划见 [ROADMAP.md](./docs/ROADMAP.md)。
> 尚未实现的规划版本（标注"尚未实现"）在 `docs/changelog/` 下对应版本目录中（如 `v1.5/`、`v1.6/`–`v1.9/`、`v2.0/`），**不纳入本索引**；已开发完成但未发版的版本纳入本索引并附「待发版」状态标注——tag/npm/package.json 在发版时统一同步。规划版本的完整排期见 [ROADMAP](./docs/ROADMAP.md)。

- **v1.5.2** — 🔍 审计模块 · 对外开放面与判定语义：MCP audit 数据对外（`audit_query` 只读 + 事件订阅推送）· 约束导出与证据链外部可验（`ruleset_export` 机器可读 JSON 双向可逆 + 独立验签工具零依赖三态校验）· should-run 判定链 · 审计结论失效语义 · 网络出口治理面 · 事前授权补环 · DSH 插件 npm 首发面 · 测试 5083→**5296**（+213，13 包 workspace（模块包）口径，包数统计标准见 [WIKI §六](./docs/WIKI.md#六当前状态)）· acceptance 367→**373** · 2026-09-24 已发版 · MCP 新增 `audit_query`、`ruleset_export` 两个 tool（总数 107） · [开发日志](./docs/changelog/v1.5/v1.5.2.md)

> 📌 **当前口径**：MCP tool 总数 **103**（2026-09-26 浏览器四件套（`playwright_*`）退役，[v2.0.0 §七 B 表](./docs/changelog/v2.0/v2.0.0.md)；上方 107 为 v1.5.2 发版时点读数）
- **v1.5.1** — 编排模块 · 事件驱动：业务事件触发 · 理解债务应对 · 设备 OTA 远程升级 · 审计输入双通道 · `sofagent demo` · 测试 4903→**5083**（+180，13 包 workspace（模块包）口径 5083（发版时点），包数统计标准见 [WIKI §六](./docs/WIKI.md#六当前状态)）· acceptance 357→**367** · 回归 87 维 · 2026-09-22 已发版 · [开发日志](./docs/changelog/v1.5/v1.5.1.md)
- **v1.5.0** — 治理模块 · 可见性与本体成熟：治理 KPI 面板（Dashboard 治理 tab 六卡 + 数据集审阅 + lineage 合规报告 + 周报）· 本体数据双时态（stateAt 时点快照 + 三层渐进加载）· Ontology Validation Engine（DAG 无环 + 激活前置门 fail-closed）· 跨层证据对账 trace_reconcile（三源四态）· FDE 陪跑期 · 存量清扫 + @sofagent/inject 更名 · DSH 插件事件接线 · MCP 104→**105** tools · 测试 4805→**4903**（+98，13 包 workspace 口径，包数统计标准见 [WIKI §六](./docs/WIKI.md#六当前状态)）· acceptance 352→**357** · 2026-09-19 已发版 · [开发日志](./docs/changelog/v1.5/v1.5.0.md)


> ⚠️ **API 退役公告（v1.4.3 · 提前一版公告，移除归 v1.5.0）**
>
> `checkHistoryChainIntegrity`（@public 双导出：`@sofagent/audit` 与 `@sofagent/core`）**已于 v1.5.0 移除**——布尔语义无法区分篡改/不可复验/历史不足三态，后继 `checkHistoryChainDetailed` 已交付多版。迁移：原 `true` 对应 `status === 'ok'`；原 `false` 改读结构化字段（`tampered` = HMAC 链断裂 / `unverifiable` = 环境漂移 / `insufficient-history` = 记录不足），已迁移示例见 `engine/audit/src/commands/verify.ts`。

> 🔴 **破坏性变更公告（v1.4.8）· 训练域符号迁移至 `@sofagent/train`**
>
> `@sofagent/orchestrator` 根 barrel 移除 train 域 **101 个重导出块 / 561 个 `@public` 符号**（orchestrator 符号数 1444 → 883），全部迁入独立包 `@sofagent/train`（barrel 564 符号）。**替换路径**：`import { createTrainJob } from '@sofagent/train'`。
> **不提供兼容期**（技术原因，非选择）：保留根 barrel 重导出会使 `orchestrator` 依赖 `train`，与 `train` 依赖 `orchestrator` 构成**包级循环**。全仓 `@public` 基线 2281 → 2283。

> 📋 **判据偏差登记（v1.4.8）· 伞包依赖闭包**
>
> 任务书判据「伞包 `sofagent` 闭包**不含** `@sofagent/train`」**未达成**（实测包含——umbrella 直连 audit / mcp / orchestrator / daemon，train 经 daemon / mcp 传递）。**改口径收口**为「`@sofagent/orchestrator` 闭包不含 train」：该闭包 7 成员不含 train，第 7 批真实目标（后训代码移出编排核心）已达成。
> 不继续做的理由：① 单写 `peerDependencies` 无效（npm ≥7 默认自动安装 peer，本仓零先例）② `mcp` 缺 train 会**启动即失败**（`mcp-server → tool-registry → tools/train-cloud` 三点静态串联，非工具级降级）③ B 方案会让 `dependency-direction.sh` 对这两条边**失明**。**未来前置**：mcp tool 注册形态重构（新批次）。

> 🔶 **破坏性变更公告（v1.5.0 · 死配置清扫与同名导出更名）**
>
> ① **`cleanupOnRecord` / `SOFAGENT_CLEANUP_ON_RECORD` 死配置全链移除**：`SofaEnvConfig` 中的 `cleanupOnRecord`（@deprecated v1.4.3 披露）已随死配置清扫删除，**shell 与 PowerShell 侧消费链同批清扫完成**——`engine/scripts/lib/config.sh` 的 `data_cleanup_on_record` 解析与 `SOFAGENT_CLEANUP_ON_RECORD` / `SOFA_CLEANUP_ON_RECORD` 导出、`engine/scripts/task-record.sh` 的写后概率触发、`engine/scripts/verify.sh` 的「清理触发已启用」告警，以及 `engine/scripts/windows/lib/config.ps1` 对应段**均已移除，三侧零残留**（合规配置段检查同步为 6 项）。**升级影响（行为变更）**：此前在 `fde.md` 设 `data_cleanup_on_record: true` 的用户，写入后按 1/N 概率自动清理的行为不再发生——需要自动清理请显式调度 `engine/scripts/cleanup.sh`，保留策略用 `SOFAGENT_RETENTION_DAYS` / `SOFAGENT_RETENTION_MAX`（消费点 `engine/scripts/cleanup.sh`）。完整披露见 [LIMITATIONS §七](./docs/LIMITATIONS.md)。
> ② **`@sofagent/train` 导出 `routeRequest` 更名为 `canaryRouteRequest`**（同名消歧）：orchestrator 另有同名 `routeRequest`（`@sofagent/orchestrator/workflow` 语义路由）——同名不同物，裸符号 grep 接线断言会假阳性。该导出零生产消费者，破坏面为零；消费侧（仅测试）已同步更名。同名导出矩阵见 [WIKI 术语表](./docs/WIKI.md)。

- **v1.4.9** — 设备接入与数据承接：G9 设备注册/发现/心跳（Ed25519 身份 + 在线才派单/掉线改派）· G10 数据目录白名单授权读取 · G11 采集声明 opt-in 上行（WAL 加密暂存 + 断点续传 + 审计计量）· T7 router 过站 session 承接 · T8 敏感识别三层插槽（SDK 面，管线接线排期 v1.5.1）· T9 权重灰度 AB（SDK 面同上）· G5b 连接器注册 + G1 workflow 模板血缘 · T6 installer + T10 模型清单 · MCP 95→**104**（9 新）· 测试 4429→**4805** · 2026-09-17 已发版 · [开发日志](./docs/changelog/v1.4/v1.4.9.md)

- **v1.4.8** — 插件管控与工程效能：插件来源白名单 · 应用级工具策略 · 多 Agent 协作阵型库 · 自动上下文压缩 · shell 提权分级 · 成本 quota 事前门禁 · 依赖方向架构测试 · 自研进化 gate（skillopt 更名 @sofagent/evolve）· 执行机制纪律批 · MCP 95→**95**（零新增）· 测试 4279→**4429** · 2026-09-13 已发版 · [开发日志](./docs/changelog/v1.4/v1.4.8.md)
- **v1.4.7** — 商业平台接口版：G2 能力缺口 · G4 人机贡献度 · G6 节点可见性 · G7 多租户 v0 · G13 PR 生命周期 · G14 workflow CRUD · workflow 烧录 USB · G8 首部署 cron · 云训练 TrainChannel 收口 · MCP 84→**95**（11 新）· 测试 4088→**4279** · 2026-09-11 已发版 · [开发日志](./docs/changelog/v1.4/v1.4.7.md)
- **v1.4.6** — 后训模块 · 分布式与云端：多卡/多机训练（schema v2 + GPU 拓扑 + NCCL 诊断）· 云 VM 执行面 train_cloud · 标准数据推送接口双闸 · 边界收缩（约 −1.2k 行）· MCP 83→**84** · 测试 4055→**4088** · 2026-09-09 已发版 · [开发日志](./docs/changelog/v1.4/v1.4.6.md)
- **v1.4.5** — 后训模块 · 服务与持续：train_serve 推理服务 · 持续后训练三触发与回退 · train_compliance 合规扫描 · train_deliverable 交付包 · 进化实证收口 · 可靠性加固批 · MCP 80→**83** · 测试 3753→**4055** · 2026-09-08 已发版 · [开发日志](./docs/changelog/v1.4/v1.4.5.md)
- **v1.4.4** — 后训模块 · 信号与部署闭环：训练语料导出三件套 · 企业专属模型本地权重部署（manifest+sha256 篡改拒绝）· 训练产物自动注册 · 多基座对比（train compare ROI 排序）· 决策因果链与先例检索 · CI 供应链全 SHA 固定 · MCP 79→**80** · 测试 3619→**3753** · 2026-09-04 已发版 · [开发日志](./docs/changelog/v1.4/v1.4.4.md)
- **v1.4.3** — 后训模块 · 运行与需求 + 审计聚合：train_status/train_list 监控 · train_diagnose 七类诊断 · 训练沙箱 · 需求推导 + RL 配方模板 · 审计聚合 --stats · 反作弊基线 · 存量清扫五件 · MCP 76→**79** · 测试 3349→**3619** · 2026-09-01 已发版 · [开发日志](./docs/changelog/v1.4/v1.4.3.md)
- **v1.4.2** — 后训模块 · 数据与评估 + FDE 六引擎：数据管道（多源接入+质量闸门+脱敏）· dataset_version 台账 · eval 闭环 · train_doctor · dry-run 算力外推 · fde_* 六件 · IM 桥 · MCP 67→**76** · 测试 3202→**3349** · 2026-08-29 已发版 · [开发日志](./docs/changelog/v1.4/v1.4.2.md)
- **v1.4.1** — 🚂 后训模块 · 地基：train-job 编排（`train_submit` 67 tools）+ 审计 HMAC 链 + enterpriseId 隔离 + 可复现指纹 + 权重 HMAC 签名阻断 + 崩溃恢复 + 安全基线（路径白名单/注入过滤/凭据脱敏）+ Metal reward 收敛验证 + 双栈契约文档 + SKILL 体系重构 + 依赖升级 · 测试 2981→**3222**（+241，全量口径：包含非 workspace 计数的散测 3178+44——v1.4.2 起改为 12 包 workspace 口径，两版数字不直接可比）· 2026-08-28 · [开发日志](./docs/changelog/v1.4/v1.4.1.md)
- **v1.4.0** — 📊 Web 工作明细页 + 图谱栏 + 💰 成本审计（`cost_query` + 超支告警）+ 🔌 DSH 插件家族 9 款 + 🦞 OpenClaw 插件 4 款 + 🏠 Dashboard HTML 产品化 + 📡 远程 API 通道 + 🔗 MLflow 接线 + 🌐 Agentic Browser（66 tools）+ 🔀 工具角色分层 + ⚡ DSH 默认启用 + 🔌 MCP 自动配置 + 🔄 联邦查询 E2E + 🐚 bash 3.2 实测 · 测试 2903→**2981**（+78）· 2026-08-23 · [开发日志](./docs/changelog/v1.4/v1.4.0.md)
- **v1.3.9** — 🔍 官方 AST 规则引擎（8+2 规则同管线）+ meta-harness 多 harness 编排 + worklog 数据层 + API 分级 @public/@internal（1439 符号门禁）+ FORGE 切 DSH + MLflow agent 评估 + Agentic Browser + 跨平台适配器 + ATTRIBUTION 归因 + Dream Sandbox + >5MB diff 修复 + 长任务进程自愈（守护 daemon + watcher，进程被外部回收后自动恢复） · 测试 2782→**2903**（+121）· 2026-08-23 · [开发日志](./docs/changelog/v1.3/v1.3.9.md)
- **v1.3.8** — 🛡️ 代理网关硬边界（唯一出入口 + HITL 审批队列首场景）+ 🔐 数据静态加密（能力交付：AES-256-GCM，daemon 接线 v1.4.7 收口——密钥就绪后审计历史密文落盘 SOFAGENT-AGE-V1，见 SECURITY）+ ⏸️ Durable Execution L3（WAL 三档可逆）+ ⏰ 异步长任务自治（cron + 依赖图）+ FORGE 保活三件套 + SDK `sandbox:true` + release-gate 瘦身 + 审查成本计量（逐步 token 记账 + 单次草稿模式） + 快照写路径加固 · 测试 2655→**2782**（+127）· 2026-08-20 · [开发日志](./docs/changelog/v1.3/v1.3.8.md)
- **v1.3.7** — 🏰 SubAgent 完整沙箱（虚拟 FS/网络白名单/独立进程/A-B 双跑）+ 场景驱动权限（fail-closed）+ AgentShield 五类扫描 + 行业 overlay 四套 + 断路器监控（ASI08/ASI10）+ ontology 生命周期（branch/trunk + 审阅门）+ FORGE 自适应并发 + memory-sync 路径通用化 + 安全加固 26 项 · 2026-08-18 · [开发日志](./docs/changelog/v1.3/v1.3.7.md)
- **v1.3.6** — 🔌 引擎接口外化（Workflow 标准格式 / Ontology Schema D1-D5 / 模型注册灰度 + 强制人审）+ SubAgent 托管 SDK + 训练协议三约定 + 路由可解释性 + 机器可判定验收（define_acceptance）+ 可靠性五件（worktree 隔离/双闸验证/疲劳检测/降级梯队/decisions 五分类）+ market→commons 更名 · MCP 52→**60** · 2026-08-18 · [开发日志](./docs/changelog/v1.3/v1.3.6.md)
- **v1.3.5** — MCP 自进化 + instinct→skill 自动进化：引擎接口外化推进 · MCP 48→**52**（4 新）· 测试 2380→**2431** · 2026-08-16 已发版 · [开发日志](./docs/changelog/v1.3/v1.3.5.md)
- **v1.3.4** — 🏪 L3 组织能力市场（五环：发布→发现→调用→评价→养护 + 6 market MCP tool；market_* 系列 v1.3.6 起更名 commons_*）+ 🛡️ SkillScan 安全门（三态判定 + 发布/安装双触发）+ 📊 评估体系三步（harvest→jury→promote）+ 🔌 编排层与执行层分离（ExecutionBackend + DSH 执行后端接入）+ 📜 DecisionKind.MARKET + daemon 市场双巡检 · 2026-08-14 · [开发日志](./docs/changelog/v1.3/v1.3.4.md)
- **v1.3.3** — 🤝 L2 团队协作协议（五大机制）+ ✨ Refine Agent 完整版 + 🧭 主 agent 编排 + 🚪 入口路由 + 📈 进化闭环升级 + 📜 evidence 字段 · 2026-08-12 · [开发日志](./docs/changelog/v1.3/v1.3.3.md)
- **v1.3.2** — 🔄 Onboard Agent 完整版（L2-L5）· 2026-08-11 · [开发日志](./docs/changelog/v1.3/v1.3.2.md)
- **v1.3.1** — Durable Execution 编排增强 + Benchmark 基线：波次并发 + MergeQueue · 测试 2105→**2209** · 2026-08-11 已发版 · [开发日志](./docs/changelog/v1.3/v1.3.1.md)
- **v1.3.0** — 🔐 运行时审计最小闭环（tool wrapper 拦截层）+ 决策审计（意图问责 MVP）+ 双规则统一 + 运行时审计日志按 git 仓库隔离（FORGE 自托管 SubAgent 路径已交付 repo-hash 隔离；文档曾长期标「规划中」系滞后；引擎侧 data-sovereignty 审计日志仍全局，排 v1.3.9；commit 级 history.jsonl 仍全局）+ HITL 钩子 + list_rules 规则透明化 + 激活链收尾 + 外部记忆后端 Path A + 进化链路写保护 · 2026-08-09 · [开发日志](./docs/changelog/v1.3/v1.3.0.md)
- **v1.2.9** — ⏸️ Checkpoint/Resume + 🏠 PM2 守护 + 🔗 激活链 Phase 3 后半 + mcp-server 拆分 + 📐 约束层叙事重构 + 🚪 三个入口产品（npx CLI + 规则市场 + GitHub Action） · 2026-08-08 · [开发日志](./docs/changelog/v1.2/v1.2.9.md)
- **v1.2.8** — 记忆分层 + 定时任务 + 🔗 激活链 Phase 3 前半 + ⏸️ Checkpoint/Resume · 2026-08-07 · [开发日志](./docs/changelog/v1.2/v1.2.8.md)
- **v1.2.7** — 编排模块增强 + 🔗 激活链 Phase 2 后半（Session Goals `/goal` + `/compact` + Skill 渐进加载 + doctor --repair + enterprise-graph StateGraph 构建 + --support-bundle + One-Line bootstrap.sh + Agent Mailbox）· 2026-08-06 · [开发日志](./docs/changelog/v1.2/v1.2.7.md)
- **v1.2.6** — 激活链 Phase 2 前半（映射表+注册扩展）+ MCP 交付链路修补（4 tool 三处注册）+ 文档死链清零 · 2026-08-04 · [开发日志](./docs/changelog/v1.2/v1.2.6.md)
- **v1.2.5** — 激活链 Phase 1 ACTIVATE（activate.ts + MCP activate_workflow tool）+ 审计模块加固（A20-A23 四条安全规则 + 结构性地基加固 + 检测盲区补全）+ daemon 可靠性（推送重试 + plist 校验 + 健康自检）+ 多设备前置（Agent 身份码 + 跨设备审计聚合 + 协议中立）· 2026-08-02 · [开发日志](./docs/changelog/v1.2/v1.2.5.md)
- **v1.2.4** — 知识进化（分层巡检 L1/L2/L3 + skillopt 自动触发 + 失败清单 + 联邦蒸馏 + Skill×MCP 集成 + FDE 人机分离 + LESSONS 方法论）· 2026-08-02 · [开发日志](./docs/changelog/v1.2/v1.2.4.md)
- **v1.2.3** — Dashboard 产品化 + 编排隔离底座 + 审查进度可视化（git worktree 隔离三原语 + 控制图波次渲染 + Dashboard FORGE 审查 tab 进度实时显示 + 用户可读状态映射 + v1.2.2 BugFix 31 项）· 2026-07-30 · [开发日志](./docs/changelog/v1.2/v1.2.3.md)
- **v1.2.2** — 数据主权审计 + 混合模型路由 + FDE Dashboard + Graph Engine + 异步 HITL + Skill 升级三策略（4 维审计追踪 + 敏感度路由 + bash 三栏 + Planner 降级链 + checkpoint 挂起）— 38 项修复详见 git log v1.2.2...v1.2.1 --oneline · 2026-07-29 · [开发日志](./docs/changelog/v1.2/v1.2.2.md)
- **v1.2.1** — 数据目录重构 + Webhook 推送 + SubAgent 可见性 L2 + custom/ 闭环 + eval/ab-test 半成品补全（.sofagent/ → data/ + 飞书/钉钉/企微推送 + ProgressMiddleware + golden set 42 条 + CLI + 持久化）· 2026-07-28 · [开发日志](./docs/changelog/v1.2/v1.2.1.md)
- **v1.2.0** — 物理结构大重构（/sofagent/→/engine/ + SKILL 收敛 + install.sh 提根 + rules 独立包）· 2026-07-26 · [开发日志](./docs/changelog/v1.2/v1.2.0.md)
- **v1.1.9** — 产品叙事收敛（FDE Agent）+ USB 完整运行时 + daemon A/B 自动调度器 + 控制图状态抽取 + v1.1.8 BugFix 42 项 · 2026-07-22 · [开发日志](./docs/changelog/v1.1/v1.1.9.md)
- **v1.1.8** — 安全层加密配对 + 联邦查询 + Prompt 注入防护补齐 + 编排模块串行版（DAG 并行规划在 v1.3.1） · 2026-07-22 · [开发日志](./docs/changelog/v1.1/v1.1.8.md)
- **v1.1.7** — Dream Cycle 6 阶段 + sensitivity + 知识健康巡检 + 知识可观测性 · 2026-07-20 · [开发日志](./docs/changelog/v1.1/v1.1.7.md)
- **v1.1.6** — BugFix 21 项 + LLM Wiki 3 层分层 + conflict-check · 2026-07-19 · [开发日志](./docs/changelog/v1.1/v1.1.6.md)
- **v1.1.5** — releasing.md SOP 集成 + MCP pipe + knowledge tool + USB federation HMAC · 2026-07-19 · [开发日志](./docs/changelog/v1.1/v1.1.5.md)
- **v1.1.4** — LOOP 独立产品化 + 工具注入 + A18/A19 + CI 修复 · 2026-07-19 · [开发日志](./docs/changelog/v1.1/v1.1.4.md)
- **v1.1.3** — LangGraph StateGraph 直接编排 + Checkpoint + HITL · 2026-07-18 · [开发日志](./docs/changelog/v1.1/v1.1.3.md)
- **v1.1.2** — 测试体系修复 + 文档一致性 · 2026-07-16 · [开发日志](./docs/changelog/v1.1/v1.1.2.md)
- **v1.1.1** — LOOP 双 Agent 串联 + Harness 可见性 + 多设备同步指南 · 2026-07-15 · [开发日志](./docs/changelog/v1.1/v1.1.1.md)
- **v1.1.0** — 包结构纯度重构（12 包独立）+ 轻量多设备 · 2026-07-14 · [开发日志](./docs/changelog/v1.1/v1.1.0.md)
- **v1.0.9** — 二进制文件审计 + 快照时间线 + MCP compose tool + 安全加固 + 遗留补齐 · 2026-07-14 · [开发日志](./docs/changelog/v1.0/v1.0.9.md)
- **v1.0.8** — FDE Agent 自进化 + 文件系统审计 + 内嵌 isomorphic-git + Agent 定义去耦合 · 2026-07-13 · [开发日志](./docs/changelog/v1.0/v1.0.8.md)
- **v1.0.7** — 双节点架构 + Sub Agent 约束自加载 + ao 完全退役 · 2026-07-13 · [开发日志](./docs/changelog/v1.0/v1.0.7.md)
- **v1.0.6** — 编排迁移 + A/B 真实运行器 + 安全加固 + SkillOpt CLI 修复 · 2026-07-13 · [开发日志](./docs/changelog/v1.0/v1.0.6.md)
- **v1.0.5** — Ontology 统一层 + Work模板市场 · 2026-07-12 · [开发日志](./docs/changelog/v1.0/v1.0.5.md)
- **v1.0.4** — Sub Agent 自进化 · 2026-07-11 · [开发日志](./docs/changelog/v1.0/v1.0.4.md)
- **v1.0.3** — 编排模块重构 + LOOP 自迭代 · 2026-07-11 · [开发日志](./docs/changelog/v1.0/v1.0.3.md)
- **v1.0.2** — 文档修正 + 规则对齐 · 2026-07-11 · [开发日志](./docs/changelog/v1.0/v1.0.2.md)
- **v1.0.1** — AI 知识库实现版 · 2026-07-11 · [开发日志](./docs/changelog/v1.0/v1.0.1.md)
- **v1.0.0** — 正式版：Agent 审计工具 · 2026-07-10 · [开发日志](./docs/changelog/v1.0/v1.0.0.md)

---

## 实验版（v0.x）

> ⚠️ 以下为实验/测试版，产品形态与技术方案多次重大调整。正式版从 v1.0.0 开始。完整日志在 [`docs/archive/changelog-experimental/`](./docs/archive/changelog-experimental/)。

<details>
<summary>v0.81–v0.99.9 实验版历史（点击展开）</summary>

- **v0.99.9** — AI 知识库概念 + verify.ts 拆分 + 行业笔记 + 理论基础 · 2026-07-07 · [开发日志](./docs/archive/changelog-experimental/v0.99.9.md)
- **v0.99.8** — 文档收尾 + FDE 架构重构 · 2026-07-05 · [开发日志](./docs/archive/changelog-experimental/v0.99.8.md)
- **v0.99.7** — 发布基础设施修复版 · 2026-07-04 · [开发日志](./docs/archive/changelog-experimental/v0.99.7.md)
- **v0.99.6** — npm 双包发布 + 25 项修复 · 2026-07-04 · [开发日志](./docs/archive/changelog-experimental/v0.99.6.md)
- **v0.99.5** — CI 自动化 + npm 发布 · 2026-07-03 · [开发日志](./docs/archive/changelog-experimental/v0.99.5.md)
- **v0.99.4** — 准入诚实化 + 41 项修复 · 2026-07-02 · [开发日志](./docs/archive/changelog-experimental/v0.99.4.md)
- **v0.99.3** — 文档校准版 · 2026-06-29 · [开发日志](./docs/archive/changelog-experimental/v0.99.3.md)
- **v0.99.2** — 质量加固版 · 2026-07-01 · [开发日志](./docs/archive/changelog-experimental/v0.99.2.md)
- **v0.99.1** — OpenClaw 叙事重写 + MCP 独立包 · 2026-06-28 · [开发日志](./docs/archive/changelog-experimental/v0.99.1.md)
- **v0.99** — v1.0 前收尾版 · 2026-06-26 · [开发日志](./docs/archive/changelog-experimental/v0.99.md)
- **v0.98** — 架构重组版 · 2026-06-24 · [开发日志](./docs/archive/changelog-experimental/v0.98.md)
- **v0.97** — 证据版本 · 2026-06-22 · [开发日志](./docs/archive/changelog-experimental/v0.97.md)
- **v0.96** — 诚实收缩 · 2026-06-20 · [开发日志](./docs/archive/changelog-experimental/v0.96.md)
- **v0.95** — 审计体系重构 · 2026-06-18 · [开发日志](./docs/archive/changelog-experimental/v0.95.md)
- **v0.94** — 工程硬伤止血 · 2026-06-16 · [开发日志](./docs/archive/changelog-experimental/v0.94.md)
- **v0.93** — 工程迁移 · 2026-06-14 · [开发日志](./docs/archive/changelog-experimental/v0.93.md)
- **v0.92** — 安全加固 + 工程止血 · 2026-06-13 · [开发日志](./docs/archive/changelog-experimental/v0.92.md)
- **v0.91** — sofagent-audit MVP · 2026-06-12 · [开发日志](./docs/archive/changelog-experimental/v0.91.md)
- **v0.90** — 安全审查 · 2026-06-10 · [开发日志](./docs/archive/changelog-experimental/v0.90.md)
- **v0.86** — 运行时加固 · 2026-06-09 · [开发日志](./docs/archive/changelog-experimental/v0.86.md)
- **v0.85** — 定位重构 · 2026-06-08 · [开发日志](./docs/archive/changelog-experimental/v0.85.md)
- **v0.84** — 证据打磨 · 2026-06-07 · [开发日志](./docs/archive/changelog-experimental/v0.84.md)
- **v0.83** — 安装修复 · 2026-06-05 · [开发日志](./docs/archive/changelog-experimental/v0.83.md)
- **v0.82** — 五平台实测 · 2026-06-03 · [开发日志](./docs/archive/changelog-experimental/v0.82.md)
- **v0.81** — daemon 骨架 · 2026-06-01 · [开发日志](./docs/archive/changelog-experimental/v0.81.md)

</details>

---

## v0.47–v0.80 — 早期开发期（摘要）

> 这段时间每个版本间隔 1-3 天，改动密集。只保留摘要，详细日志在 [`docs/archive/changelog-experimental/`](./docs/archive/changelog-experimental/) 下。

| 版本区间 | 主题 |
|---------|------|
| v0.70–v0.80 | 企业合规三件套（脱敏/保留/审计）+ daemon 开发（v0.76-0.80 内部版本，合并至 v0.81 发布） |
| v0.60–v0.63 | 架构重构（扁平化 + 诚实化）+ CI 闭环 |
| v0.54–v0.56 | 加载链防漏读 + Handbook 拆分 |
| v0.51–v0.53 | 宣称对齐 + 评审反馈修复 |
| v0.47–v0.50 | 项目首次发布 + 安装断裂修复 |

> ℹ️ 以上区间涵盖此时期全部版本；子版本无单独索引条目。实验期仅保留文字档案（本节与 archive 目录），git tag 与 release 自 v1.0.0 起维护。
> 早期版本的完整日志在 [`docs/archive/changelog-experimental/`](./docs/archive/changelog-experimental/) 目录下。
