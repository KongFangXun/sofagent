# Changelog

> **本文件是目录索引**。每个版本的完整开发日志在 [`docs/changelog/`](./docs/changelog/) 下，此处仅保留「版本能力索引（一段式）+ 链接」，不重复细节。
> 实验版（v0.x）历史日志在 [`docs/archive/changelog-experimental/`](./docs/archive/changelog-experimental/)。

---

## 正式版（v1.0.0+）

> 未来版本规划见 [ROADMAP.md](./docs/ROADMAP.md)。
> 尚未实现的规划版本（标注"尚未实现"）在 `docs/changelog/v1.4/` 下，不纳入本索引；已开发完成但未发版的版本纳入本索引并附「待发版」状态标注——tag/npm/package.json 在发版时统一同步。

> ⚠️ **API 退役公告（v1.4.3 · 提前一版公告，移除归 v1.5.0）**
>
> `checkHistoryChainIntegrity`（@public 双导出：`@sofagent/audit` 与 `@sofagent/core`）**将于 v1.5.0 移除**——布尔语义无法区分篡改/不可复验/历史不足三态，后继 `checkHistoryChainDetailed` 已交付多版。迁移：原 `true` 对应 `status === 'ok'`；原 `false` 改读结构化字段（`tampered` = HMAC 链断裂 / `unverifiable` = 环境漂移 / `insufficient-history` = 记录不足），已迁移示例见 `engine/audit/src/commands/verify.ts`。

- **v1.4.4** — 🚀 后训模块 · 信号与部署闭环：训练语料导出三件套（`corpus_export` 79→80 tools + 规则 27 编号位 + 五源样本聚合脱敏 + reward 骨架）· 企业模型本地权重部署（sha256 清单 + 篡改拒绝 + `rollback-weights`）· 训练产物→注册衔接（双闸 + 挂载人审）· 多基座对比训练（`train compare` + ROI 排序）· 决策因果链（`causedBy`/`traceDecisionChain`/先例检索）· CI 供应链全 SHA 固定 + dashboard 离线 · 存量升级审查十项 · spec-first 硬禁令 · 六轮审查 17 项收编 · 五能力叙事升级（注入·审计·回溯·沉淀·进化）· MCP 79→**80** · 测试 3619→**3744**（+125）· acceptance 294→**303** · **⏳ 待发版** · 2026-09-02 开发完成 · [开发日志](./docs/changelog/v1.4/v1.4.4.md)
- **v1.4.3** — 🚀 后训模块 · 运行与需求：训练监控 + GPU 队列（`train_status`/`train_list` 79 tools + 显存预算 + webhook）· 失败诊断 `train_diagnose` 七类 · 训练沙箱 + 设备打包 · 需求推导 + RL 配方模板 · 后训练 workflow 模板 · FORGE DSH 深化 · 审计聚合指标 `--stats` · 训练反作弊基线 · onboarding 断层走查 · fresh-eyes F-01~14 修复 · 存量清扫（ao 退役 / compose 更名 / `checkHistoryChainIntegrity` 退役公告）· doctor 补 Ontology 完整性 · MCP 76→**79** · 测试 3349→**3619**（+270）· acceptance 276→**294** · 2026-09-01 · [开发日志](./docs/changelog/v1.4/v1.4.3.md)
- **v1.4.2** — 🚀 后训模块 · 数据与评估 + FDE 工作台：数据管道（CSV/Excel/JSON/PG/MySQL/REST → instruction/DPO/RL + 质量闸门 + 脱敏）· `dataset_version` 版本台账 · eval 闭环（Benchmark read-only + 阈值外部化）· 环境管理 + `train_doctor` · dry-run 预检 + 算力外推 · 训练报告 `train_report` · FDE 六引擎工作台（interview/classify/quantify/derive/distill/deploy）· IM 桥 dsh-im · FORGE 步零地基修复 · MCP 67→**76** · 测试 3202→**3349**（+147）· 2026-08-28 · [开发日志](./docs/changelog/v1.4/v1.4.2.md)
- **v1.4.1** — 🚂 后训模块 · 地基：train-job 编排（`train_submit` 67 tools）+ 审计 HMAC 链 + enterpriseId 隔离 + 可复现指纹 + 权重 HMAC 签名阻断 + 崩溃恢复 + 安全基线（路径白名单/注入过滤/凭据脱敏）+ Metal reward 收敛验证 + 双栈契约文档 + SKILL 体系重构 + 依赖升级 · 测试 2981→**3222**（+241）· 2026-08-28 · [开发日志](./docs/changelog/v1.4/v1.4.1.md)
- **v1.4.0** — 📊 Web 工作明细页 + 图谱栏 + 💰 成本审计（`cost_query` + 超支告警）+ 🔌 DSH 插件家族 9 款 + 🦞 OpenClaw 插件 4 款 + 🏠 Dashboard HTML 产品化 + 📡 远程 API 通道 + 🔗 MLflow 接线 + 🌐 Agentic Browser（66 tools）+ 🔀 工具角色分层 + ⚡ DSH 默认启用 + 🔌 MCP 自动配置 + 🔄 联邦查询 E2E + 🐚 bash 3.2 实测 · 测试 2903→**2981**（+78）· 2026-08-23 · [开发日志](./docs/changelog/v1.4/v1.4.0.md)
- **v1.3.9** — 🔍 官方 AST 规则引擎（8+2 规则同管线）+ meta-harness 多 harness 编排 + worklog 数据层 + API 分级 @public/@internal（1439 符号门禁）+ FORGE 切 DSH + MLflow agent 评估 + Agentic Browser + 跨平台适配器 + ATTRIBUTION 归因 + Dream Sandbox + >5MB diff 修复 + driver 进程守护 · 测试 2782→**2903**（+121）· 2026-08-23 · [开发日志](./docs/changelog/v1.3/v1.3.9.md)
- **v1.3.8** — 🛡️ 代理网关硬边界（唯一出入口 + HITL 审批队列首场景）+ 🔐 数据静态加密（能力交付：AES-256-GCM，daemon 接线未启用，排期 v1.4.7 见 SECURITY）+ ⏸️ Durable Execution L3（WAL 三档可逆）+ ⏰ 异步长任务自治（cron + 依赖图）+ FORGE 保活三件套 + SDK `sandbox:true` + release-gate 瘦身 + 审查循环成本重构 + 快照写路径加固 · 测试 2655→**2782**（+127）· 2026-08-20 · [开发日志](./docs/changelog/v1.3/v1.3.8.md)
- **v1.3.7** — 🏰 SubAgent 完整沙箱（虚拟 FS/网络白名单/独立进程/A-B 双跑）+ 场景驱动权限（fail-closed）+ AgentShield 五类扫描 + 行业 overlay 四套 + 断路器监控（ASI08/ASI10）+ ontology 生命周期（branch/trunk + 审阅门）+ FORGE 自适应并发 + memory-sync 路径通用化 + 26 项加固（4 P0 + 红队防御增强）· 2026-08-18 · [开发日志](./docs/changelog/v1.3/v1.3.7.md)
- **v1.3.6** — 🔌 引擎接口外化（Workflow 标准格式 / Ontology Schema D1-D5 / 模型注册灰度 + 强制人审）+ SubAgent 托管 SDK + 训练协议三约定 + 路由可解释性 + 机器可判定验收（define_acceptance）+ 可靠性五件（worktree 隔离/双闸验证/疲劳检测/降级梯队/decisions 五分类）+ market→commons 更名 · MCP 52→**60** · 2026-08-18 · [开发日志](./docs/changelog/v1.3/v1.3.6.md)
- **v1.3.5** — 🧬 MCP 自进化+运维闭环（run_ab_test / promote_ab 人审晋升 / snapshot_list / snapshot_restore 人审恢复 · 48→52 tools）+ 🌱 instinct→skill 自动进化（三源提取 + 置信度评分 + /evolve 聚合 + 错题本）+ 🤝 FDE 运维五件（陪跑期/进场记忆/节点注册表/审计问卷 7 行业）+ 🔒 依赖安全升级（vitest critical 清零 + automerge 3.x + LangGraph/js-yaml/archiver）+ 🔌 DSH MCP 互通 + 🛡️ 加固修复 38 项（影子审计器防线 / 门禁假绿清零 / 泄漏清理 / post-commit 绕过检测）· 2026-08-16 · [开发日志](./docs/changelog/v1.3/v1.3.5.md)
- **v1.3.4** — 🏪 L3 组织能力市场（五环：发布→发现→调用→评价→养护 + 6 market MCP tool；market_* 系列 v1.3.6 起更名 commons_*）+ 🛡️ SkillScan 安全门（三态判定 + 发布/安装双触发）+ 📊 评估体系三步（harvest→jury→promote）+ 🔌 编排层与执行层分离（ExecutionBackend + DSH 执行后端接入）+ 📜 DecisionKind.MARKET + daemon 市场双巡检 · 2026-08-14 · [开发日志](./docs/changelog/v1.3/v1.3.4.md)
- **v1.3.3** — 🤝 L2 团队协作协议（五大机制）+ ✨ Refine Agent 完整版 + 🧭 主 agent 编排 + 🚪 入口路由 + 📈 进化闭环升级 + 📜 evidence 字段 · 2026-08-12 · [开发日志](./docs/changelog/v1.3/v1.3.3.md)
- **v1.3.2** — 🔄 Onboard Agent 完整版（L2-L5）· 2026-08-11 · [开发日志](./docs/changelog/v1.3/v1.3.2.md)
- **v1.3.1** — 🧠 Ontology 运行时层（Action 注册表 + validator 三态 + Schema 定稿）+ 并行编排（ParallelScheduler + 波次审计卡关 + MergeQueue）+ Durable Execution（checkpoint 续跑 + 副作用幂等）+ Agent 身份码 Ed25519 + 🚀 Onboard Agent L1 + 📊 Benchmark 评测（隔离执行 + HMAC 链）+ 🔒 工具审批四模式 + 📜 LLM 调用级 Trace + 🔄 错误处理（stop_reason + 退避 + 收敛）+ 📚 L4 渐进加载 + 本体建模要求对齐 GB/T 48000.3-2026（ontology 合规参考基线，非审计国标） · 2026-08-09 · [开发日志](./docs/changelog/v1.3/v1.3.1.md)
- **v1.3.0** — 🔐 运行时审计最小闭环（tool wrapper 拦截层）+ 决策审计（意图问责 MVP）+ 双规则统一 + 运行时审计日志按 git 仓库隔离（FORGE 自托管 SubAgent 路径已交付 repo-hash 隔离；文档曾长期标「规划中」系滞后；引擎侧 data-sovereignty 审计日志仍全局，排 v1.3.9；commit 级 history.jsonl 仍全局）+ HITL 钩子 + list_rules 规则透明化 + 激活链收尾 + 外部记忆后端 Path A + 进化链路写保护 · 2026-08-09 · [开发日志](./docs/changelog/v1.3/v1.3.0.md)
- **v1.2.9** — ⏸️ Checkpoint/Resume + 🏠 PM2 守护 + 🔗 激活链 Phase 3 后半 + mcp-server 拆分 + 📐 约束层叙事重构 + 🚪 三个入口产品（npx CLI + 规则市场 + GitHub Action） · 2026-08-08 · [开发日志](./docs/changelog/v1.2/v1.2.9.md)
- **v1.2.8** — 记忆分层 + 定时任务 + 🔗 激活链 Phase 3 前半 + ⏸️ Checkpoint/Resume · 2026-08-07 · [开发日志](./docs/changelog/v1.2/v1.2.8.md)
- **v1.2.7** — 编排模块增强 + 🔗 激活链 Phase 2 后半（Session Goals `/goal` + `/compact` + Skill 渐进加载 + doctor --repair + enterprise-graph StateGraph 构建 + --support-bundle + One-Line bootstrap.sh + Agent Mailbox）· 2026-08-06 · [开发日志](./docs/changelog/v1.2/v1.2.7.md)
- **v1.2.6** — 激活链 Phase 2 前半（映射表+注册扩展）+ MCP 交付链路修补（4 tool 三处注册）+ 文档死链清零 · 2026-08-04 · [开发日志](./docs/changelog/v1.2/v1.2.6.md)
- **v1.2.5** — 激活链 Phase 1 ACTIVATE（activate.ts + MCP activate_workflow tool）+ 审计模块加固（A20-A23 四条安全规则 + 结构性地基加固 + 检测盲区补全）+ daemon 可靠性（推送重试 + plist 校验 + 健康自检）+ 多设备前置（Agent 身份码 + 跨设备审计聚合 + 协议中立）· 2026-08-02 · [开发日志](./docs/changelog/v1.2/v1.2.5.md)
- **v1.2.4** — 知识进化（分层巡检 L1/L2/L3 + skillopt 自动触发 + 失败清单 + 联邦蒸馏 + Skill×MCP 集成 + FDE 人机分离 + LESSONS 方法论）· 2026-08-02 · [开发日志](./docs/changelog/v1.2/v1.2.4.md)
- **v1.2.3** — Dashboard 产品化 + 编排隔离底座 + Fresh-Eyes 流程化（git worktree 隔离三原语 + 控制图波次渲染 + 用户可读状态映射 + releasing.md 阶段一重组 + v1.2.2 BugFix 31 项）· 2026-07-30 · [开发日志](./docs/changelog/v1.2/v1.2.3.md)
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

> ℹ️ 以上区间涵盖此时期所有 git tag（含 v0.62, v0.63.1, v0.64, v0.70.0, v0.70.1, v0.71, v0.72, v0.73, v0.74, v0.75 等子版本），子版本无单独索引条目。
> 早期版本的完整日志在 [`docs/archive/changelog-experimental/`](./docs/archive/changelog-experimental/) 目录下。
