# Changelog

> **本文件是目录索引**。每个版本的完整开发日志在 [`docs/changelog/`](./docs/changelog/) 下，此处仅保留「版本能力索引（一段式）+ 链接」，不重复细节。
> 实验版（v0.x）历史日志在 [`docs/archive/changelog-experimental/`](./docs/archive/changelog-experimental/)。

---

## 正式版（v1.0.0+）

> 未来版本规划见 [ROADMAP.md](./docs/ROADMAP.md)。
> 尚未实现的规划版本（标注"尚未实现"）在 `docs/changelog/v1.4/` 下，不纳入本索引；已开发完成但未发版的版本纳入本索引并附「待发版」状态标注——tag/npm/package.json 在发版时统一同步。

> ⚠️ **API 退役公告（v1.4.3 · 提前一版公告，移除归 v1.5.0）**
>
> `checkHistoryChainIntegrity`（布尔返回的审计历史链校验）**将于 v1.5.0 移除**。布尔语义无法区分「篡改 / 不可复验 / 历史不足」三种失败形态，后继 `checkHistoryChainDetailed` 已交付多版（结构化 status 可区分三者，doctor / verify 已全部迁移）。它是 @public API 双导出（`@sofagent/audit` 与 `@sofagent/core`），适配器请按下方迁移指引更新：
>
> **迁移指引**：`checkHistoryChainIntegrity(dataDir): boolean` → `checkHistoryChainDetailed(dataDir): { status: 'ok' | 'tampered' | 'unverifiable' | 'insufficient-history'; ... }`——原 `true` 对应 `status === 'ok'`；原 `false` 改读结构化字段（`tampered` = HMAC 链断裂有篡改证据 / `unverifiable` = 环境漂移不可复验 / `insufficient-history` = 记录不足无法校验）。示例见 `engine/audit/src/commands/verify.ts`（已迁移的生产调用方）。

- **v1.4.3** — 🚀 训练引擎 · 运行与需求：十三章交付（① 训练监控与 GPU 队列：`train_status` + `train_list` 76→79 tools + 显存预算排队 + webhook 推送 + Dashboard 训练区块落盘 ② 失败诊断 `train_diagnose`：OOM/数据/发散/框架/环境/重复坍塌/精度异常七类 + 修复建议 ③ 训练沙箱 + 设备打包（进程隔离/离线可训/U 盘交付形态）④ 需求推导 + 模板库（`train analyze` 四步引导 + RL 配方 grpo/dapo/cispo 含 ScaleRL 四技巧 + MoE expert 覆盖防护）⑤ 后训练 workflow 模板（七节点 DAG + 三 HITL）⑥ FORGE DSH 执行深化步一~三承接（流式面重建/审查 step 分级切/usage 自动计量）⑦ 审计聚合指标（`--stats` CLI：安全边界触发率/阻断率/高危 Top5 + `--json` + 落盘）⑧ 训练反作弊基线（reward hacking 四形态双防线默认化：剥 `.git` + 网络白名单）⑨ 新功能入口导览 + onboarding 断层走查 ⑩ fresh-eyes 四轮 bugfix 批 F-01~14 全量映射表 ⑪ 存量清扫（ao 删除/compose 更名/fde_compose 收窄/`checkHistoryChainIntegrity` 退役公告 v1.5.0 移除）⑫ 存量升级审查迁 v1.4.4 ⑬ doctor 补 Ontology 完整性检查（静默跳过→WARN + repairHint））· MCP 76→**79** tools · 测试 3349→**3619**（v1.4.3 批 +138 + 安全回归 +34 + L4 路径守卫 +41 + doctor +6 + 审查修复 +11 + 出站防护 +8 + 闸门闭环批 +32 + 同批删 loop-audit-history −6 净持平）· acceptance 276→**294** 场景（S345-S361）· 2026-09-01 · [开发日志](./docs/changelog/v1.4/v1.4.3.md)
- **v1.4.2** — 🚀 训练引擎 · 数据与评估 + FDE Harness 层：九章交付（① 数据管道：CSV/Excel/JSON/文本 + PG/MySQL/REST 多源接入 → instruction/DPO/RL 构建 + 四类质量闸门 + 训练入口脱敏最小版 ② dataset_version 版本台账 hash+样本数+配置，两版 diff ③ eval 闭环：训练后自动 Benchmark read-only 评测，阈值外部化 continue/stop，eval 报告引用数据集版本 ④ 环境管理：train env init + `train_doctor` 四项体检 + 基座模型断点续传下载 ⑤ dry-run 预检：10 条管线连通 + 显存估算 + 数据抽样 + ScaleRL sigmoid 算力外推（LM 拟合零依赖）+ `train_dryrun` ⑥ 训练报告：五段 markdown+量化四字段，`train_report` 归档 ⑦ FDE 六引擎工作台：fde_interview/classify/quantify/derive/distill/deploy，data/fde/ 结构化资产 + 独立 fde-audit HMAC 留痕 ⑧ IM 桥：dsh-im 静态审计级接入指南 + install.sh 可选分支 ⑨ FORGE 步零数据流地基三债修复 + findings 重复率熔断 repeat-convergence）· MCP 67→**76** tools（fde 六件 + 训练三件）· 测试 3202→**3349**（+147：数据管道 53 / eval+环境 45 / dryrun+报告 28 / FDE 六引擎 21，全落 orchestrator 1295→1442；另 bugfix 批 +24 已计入）· 2026-08-28 · [开发日志](./docs/changelog/v1.4/v1.4.2.md)
- **v1.4.1** — 🚂 训练引擎 · 地基：八大块（train-job 编排 + `train_submit` 66→67 tools / train_job 审计 HMAC 链 / enterpriseId 隔离 + 覆写清理 / 可复现指纹 + 续跑版本锁定 / 权重 HMAC 签名 + 加载阻断 / 心跳回收 + 孤儿巡检 + GPU 泄漏检测 / 崩溃恢复三选项 / 安全基线：路径白名单 + 注入过滤 + 凭据脱敏）+ 阶段 0 Metal reward 收敛验证（@mlx-node/trl 实测）+ 双栈契约文档 + 训练安全基线文档 + SKILL 体系重构 + DSH 插件降实 + 依赖升级（LangChain 三包 + vitest）· 测试 2981→**3222**（+241：全部落在 workspace 12 包（2937→3178 tests across 12 packages），train 模块贡献；插件族 44 不变。另 v1.4.2 bugfix 批 +24（H-01/H-02/H-03/G-01/G-07 回归用例）→ 全量 3246（含插件族口径；workspace 口径 3222），见 v1.4.2 开发日志）· 2026-08-28 · [开发日志](./docs/changelog/v1.4/v1.4.1.md)
- **v1.4.0** — 📊 Web 工作明细页 + 图谱栏（FDE 双图谱 + MCP 工具视图 + skill 加载链）+ 💰 成本审计（超支告警 WARN only + `cost_query` MCP + COST DecisionKind）+ 🔌 DSH 插件家族（`cordis-plugin-sofagent-*` 9 款 · inventory 全可见 + Cursor/Claude hook 拦截）+ 🦞 OpenClaw 插件家族（4 款 code-plugin · ClawHub 发布就绪）+ 🏠 Dashboard HTML 产品化 + 📡 远程 API 通道（契约）+ 🔗 MLflow 接线 + 🌐 Agentic Browser MCP（61→66 tools）+ 🔀 工具角色分层 + 瘦描述（默认全量 66 · `SOFAGENT_MCP_ROLES` 显式收窄专职面；description 去版本号/历史注释）+ ⚡ DSH 默认启用（不等正式版，rc 期默认 CLI 桥接）+ 🔌 MCP 自动配置（install.sh codex/hermes 分支 + 各平台装完即连）+ 🔄 联邦查询跨设备 E2E（S320 fork 10 断言 + S322 独立进程 4 场景 + 双设备用例）+ 🐚 bash 3.2 真实环境验证 + 🔍 审计溯源字段回填 · 测试 2903→**2981**（+78 · 引擎 +34（含工具分层 +18 + argv 守卫 +3）/ DSH 插件 +27 / OpenClaw 插件 +17；workspace 口径 2937/12 包）· 2026-08-23 · [开发日志](./docs/changelog/v1.4/v1.4.0.md)
- **v1.3.9** — 🔍 官方 AST 规则引擎（sofagent-ruleset-ast 含 ASI01/ASI04 · 8+2 规则同管线）+ 🧩 meta-harness 多 harness 统一编排（19 测试 + DSH 形态对齐）+ 📊 AI 工作明细数据层（worklog + worklog_query MCP）+ 🔬 API 分级 @public/@internal（1439 符号 + CI 门禁基线）+ ⚙️ FORGE driver 切 DSH（显式后端选择 + CLI 桥接 + bash 全权限）+ 📈 MLflow agent 评估（13 指标 + LLM-as-Judge）+ 🌐 Agentic Browser（4 工具 + 视觉降级）+ 🧭 跨平台适配器（Cursor/Codex/Gemini CLI 薄挂载）+ 🗂️ tools/ 物理分子目录 + 🏷️ ATTRIBUTION 归因引擎（S318）+ 🏖️ Dream Sandbox 沙盒审计（S319）+ 🩹 >5MB diff 缝隙修复（spill 落盘）+ 🔄 FORGE driver 进程守护（daemon + watcher）· 测试 2782→**2903**（+121）· 2026-08-23 · [开发日志](./docs/changelog/v1.3/v1.3.9.md)
- **v1.3.8** — 🛡️ 代理网关硬边界（唯一出入口 + 风险分级 + 权限单调守卫 + HITL 审批队列激活——`hitl_resolve` 空转闭环首场景）+ 🔐 数据静态加密（能力交付：纯 TS AES-256-GCM `SOFAGENT-AGE-V1` + 密钥指纹强制备份；daemon 接线未启用，排期 v1.4.7——见 SECURITY「静态加密」节）+ ⏸️ Durable Execution L3（WAL 三件套：writer/recovery/undo 三档可逆 + 网关层集成 + 真 git 回滚实测）+ ⏰ 异步长任务自治（cron 三档糖 + 依赖图 + 死循环 replan 告警 + WAL 续跑钩子）+ 🔧 FORGE driver 保活三件套（pm2 托管 + resume 自动检测 + --check-alive 心跳探针）+ 🧩 SDK `sandbox:true` 启用（三层接线 + approval 组合）+ ✂️ release-gate 瘦身（--judgment-only 判断层直启 + F 循环 FAIL 即停 + 分片抽查化：30.7万→≤12万 token）+ 📊 审查循环成本重构（usage.jsonl 计量 + B 侧复核模式 + 单次草稿工具 · 16 视角零删减）+ 🩹 快照写路径加固（revert 原子化两阶段 + 原子替换）· 测试 2655→**2782**（bugfix +17 · 开发 +110，链路 2655→2672→2782）· 2026-08-20 · [开发日志](./docs/changelog/v1.3/v1.3.8.md)
- **v1.3.7** — 🏰 SubAgent 完整沙箱（虚拟 FS/网络白名单/工具中介/虚拟 key/独立进程/A-B 双跑——v1.3.8 `sandbox:true` 前置）+ 🔐 场景驱动权限（身份→场景→风险→放行/deny/人审 · fail-closed · 守卫先于事件分发）+ 🛡️ AgentShield 五类扫描（MCP 画像/Hook 注入/配置审查/密钥增强/Shadow AI 发现 · 零 LLM 自评）+ 🏥 行业 overlay 四套（fintech/medical/government/ai · context.md `industry:` 自动加载）+ ⚡ 断路器行为监控（ASI08 熔断 + ASI10 隔离 · 与沙箱联动）+ 🌳 ontology 生命周期（lifecycle branch/trunk + 审阅门 migrateToTrunk + OKF 三件套 type/status/stale_after/verified）+ ⚙️ FORGE 审查循环自适应并发（三级来源 + 预算表 + OOM 熔断降级）+ 🔌 memory-sync 路径通用化（TencentDB 开箱即用但非唯一）+ 26 项加固修复（verify-commit 洗白链/安装链断链/门禁三态等 4 P0 根治 + 红队四项防御增强：verify-chain 追加伪造判篡改 + A2 二进制 WARN + A9 伪造签名 + 验签 fail-closed）· 2026-08-18 · [开发日志](./docs/changelog/v1.3/v1.3.7.md)
- **v1.3.6** — 🔌 引擎接口外化完整版（模型层接入前置）：📥 三个数据接口（Workflow 标准格式 + 运行容器 + merge_criteria/approver 审阅协议字段 / Ontology 标准 Schema 注册 D1-D5 留痕可回滚 / 模型注册 + 灰度切换全流程审计 + 强制人审）+ 🧩 SubAgent 托管 SDK（`harness.wrap` 双形态兼容）+ 🏋️ 训练协议三约定 + 预算控制 + 🧭 路由决策可解释性（EndpointProfile + route-policy + routeReason 结构化理由链）+ ✅ 机器可判定验收（define_acceptance / check_acceptance）+ 🛡️ 可靠性五件（FORGE worktree 隔离 / 双闸验证 postToolCall / Agent 疲劳度检测 / 分级降级梯队 / decisions.jsonl 五分类完整版）+ 🏪 market→commons 更名 + 🌳 仓库森林叙事 · **MCP 52→60 tools（8 个新 tool 全登记）** · 2026-08-18 · [开发日志](./docs/changelog/v1.3/v1.3.6.md)
- **v1.3.5** — 🧬 MCP 自进化+运维闭环（run_ab_test / promote_ab 人审晋升 / snapshot_list / snapshot_restore 人审恢复 · 48→52 tools）+ 🌱 instinct→skill 自动进化（三源提取 + 置信度评分 + /evolve 聚合 + 错题本）+ 🤝 FDE 运维五件（陪跑期/进场记忆/节点注册表/审计问卷 7 行业）+ 🔒 依赖安全升级（vitest critical 清零 + automerge 3.x + LangGraph/js-yaml/archiver）+ 🔌 DSH MCP 互通 + 🛡️ 加固修复 38 项（影子审计器防线 / 门禁假绿清零 / 泄漏清理 / post-commit 绕过检测）· 2026-08-16 · [开发日志](./docs/changelog/v1.3/v1.3.5.md)
- **v1.3.4** — 🏪 L3 组织能力市场（五环：发布→发现→调用→评价→养护 + 6 market MCP tool；market_* 系列 v1.3.6 起更名 commons_*）+ 🛡️ SkillScan 安全门（三态判定 + 发布/安装双触发）+ 📊 评估体系三步（harvest→jury→promote）+ 🔌 编排层与执行层分离（ExecutionBackend + DSH 执行后端接入）+ 📜 DecisionKind.MARKET + daemon 市场双巡检 · 2026-08-14 · [开发日志](./docs/changelog/v1.3/v1.3.4.md)
- **v1.3.3** — 🤝 L2 团队协作协议（五大机制）+ ✨ Refine Agent 完整版 + 🧭 主 agent 编排 + 🚪 入口路由 + 📈 进化闭环升级 + 📜 evidence 字段 · 2026-08-12 · [开发日志](./docs/changelog/v1.3/v1.3.3.md)
- **v1.3.2** — 🔄 Onboard Agent 完整版（L2-L5）· 2026-08-11 · [开发日志](./docs/changelog/v1.3/v1.3.2.md)
- **v1.3.1** — 🧠 Ontology 运行时层（Action 注册表 + validator 三态 + Schema 定稿）+ 并行编排（ParallelScheduler + 波次审计卡关 + MergeQueue）+ Durable Execution（checkpoint 续跑 + 副作用幂等）+ Agent 身份码 Ed25519 + 🚀 Onboard Agent L1 + 📊 Benchmark 评测（隔离执行 + HMAC 链）+ 🔒 工具审批四模式 + 📜 LLM 调用级 Trace + 🔄 错误处理（stop_reason + 退避 + 收敛）+ 📚 L4 渐进加载 + 本体建模要求对齐 GB/T 48000.3-2026（ontology 合规参考基线，非审计国标） · 2026-08-09 · [开发日志](./docs/changelog/v1.3/v1.3.1.md)
- **v1.3.0** — 🔐 运行时审计最小闭环（tool wrapper 拦截层）+ 决策审计（意图问责 MVP）+ 双规则统一 + 运行时审计日志按 git 仓库隔离（FORGE 自托管 SubAgent 路径已交付 repo-hash 隔离；文档曾长期标「规划中」系滞后；引擎侧 data-sovereignty 审计日志仍全局，排 v1.3.9；commit 级 history.jsonl 仍全局）+ HITL 钩子 + list_rules 规则透明化 + 激活链收尾 + 外部记忆后端 Path A + 进化链路写保护 · 2026-08-09 · [开发日志](./docs/changelog/v1.3/v1.3.0.md)
- **v1.2.9** — ⏸️ Checkpoint/Resume + 🏠 PM2 守护 + 🔗 激活链 Phase 3 后半 + mcp-server 拆分 + 📐 约束层叙事重构 + 🚪 三个入口产品（npx CLI + 规则市场 + GitHub Action） · 2026-08-08 · [开发日志](./docs/changelog/v1.2/v1.2.9.md)
- **v1.2.8** — 记忆分层 + 定时任务 + 🔗 激活链 Phase 3 前半 + ⏸️ Checkpoint/Resume · 2026-08-07 · [开发日志](./docs/changelog/v1.2/v1.2.8.md)
- **v1.2.7** — 编排引擎增强 + 🔗 激活链 Phase 2 后半（Session Goals `/goal` + `/compact` + Skill 渐进加载 + doctor --repair + enterprise-graph StateGraph 构建 + --support-bundle + One-Line bootstrap.sh + Agent Mailbox）· 2026-08-06 · [开发日志](./docs/changelog/v1.2/v1.2.7.md)
- **v1.2.6** — 激活链 Phase 2 前半（映射表+注册扩展）+ MCP 交付链路修补（4 tool 三处注册）+ 文档死链清零 · 2026-08-04 · [开发日志](./docs/changelog/v1.2/v1.2.6.md)
- **v1.2.5** — 激活链 Phase 1 ACTIVATE（activate.ts + MCP activate_workflow tool）+ 审计引擎加固（A20-A23 四条安全规则 + 结构性地基加固 + 检测盲区补全）+ daemon 可靠性（推送重试 + plist 校验 + 健康自检）+ 多设备前置（Agent 身份码 + 跨设备审计聚合 + 协议中立）· 2026-08-02 · [开发日志](./docs/changelog/v1.2/v1.2.5.md)
- **v1.2.4** — 知识进化（分层巡检 L1/L2/L3 + skillopt 自动触发 + 失败清单 + 联邦蒸馏 + Skill×MCP 集成 + FDE 人机分离 + LESSONS 方法论）· 2026-08-02 · [开发日志](./docs/changelog/v1.2/v1.2.4.md)
- **v1.2.3** — Dashboard 产品化 + 编排隔离底座 + Fresh-Eyes 流程化（git worktree 隔离三原语 + 控制图波次渲染 + 用户可读状态映射 + releasing.md 阶段一重组 + v1.2.2 BugFix 31 项）· 2026-07-30 · [开发日志](./docs/changelog/v1.2/v1.2.3.md)
- **v1.2.2** — 数据主权审计 + 混合模型路由 + FDE Dashboard + Graph Engine + 异步 HITL + Skill 升级三策略（4 维审计追踪 + 敏感度路由 + bash 三栏 + Planner 降级链 + checkpoint 挂起）— 38 项修复详见 git log v1.2.2...v1.2.1 --oneline · 2026-07-29 · [开发日志](./docs/changelog/v1.2/v1.2.2.md)
- **v1.2.1** — 数据目录重构 + Webhook 推送 + SubAgent 可见性 L2 + custom/ 闭环 + eval/ab-test 半成品补全（.sofagent/ → data/ + 飞书/钉钉/企微推送 + ProgressMiddleware + golden set 42 条 + CLI + 持久化）· 2026-07-28 · [开发日志](./docs/changelog/v1.2/v1.2.1.md)
- **v1.2.0** — 物理结构大重构（/sofagent/→/engine/ + SKILL 收敛 + install.sh 提根 + rules 独立包）· 2026-07-26 · [开发日志](./docs/changelog/v1.2/v1.2.0.md)
- **v1.1.9** — 产品叙事收敛（FDE Agent）+ USB 完整运行时 + daemon A/B 自动调度器 + 控制图状态抽取 + v1.1.8 BugFix 42 项 · 2026-07-22 · [开发日志](./docs/changelog/v1.1/v1.1.9.md)
- **v1.1.8** — 安全层加密配对 + 联邦查询 + Prompt 注入防护补齐 + 编排引擎串行版（DAG 并行规划在 v1.3.1） · 2026-07-22 · [开发日志](./docs/changelog/v1.1/v1.1.8.md)
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
- **v1.0.3** — 编排引擎重构 + LOOP 自迭代 · 2026-07-11 · [开发日志](./docs/changelog/v1.0/v1.0.3.md)
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
