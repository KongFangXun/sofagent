# Changelog

<p align="center"><img src="https://gcore.jsdelivr.net/gh/KongFangXun/sofagent@main/docs/assets/sofagent.png" alt="sofagent" width="96" /></p>

> **sofagent 是开源（MIT）的 FDE Harness 层**；**本文件是版本目录索引**。完整开发日志在 [`docs/changelog/`](./docs/changelog/) 下，此处仅留「版本能力索引（一段式）+ 链接」与「跨版本破坏性变更 / 退役公告」，不重复逐版细节。
> **状态标注约定**：正式版条目一律带发布日期；近期版本另附「已发版 / 待发版」状态标注，历史版本以日期为准。

## 目录

- [正式版](#正式版v100) · [实验版与早期开发期](#实验版v0x与早期开发期)

## 正式版（v1.0.0+）

> 未来版本规划见 [ROADMAP.md](./docs/ROADMAP.md)。
> 尚未实现的规划版本（标注"尚未实现"）留在 `docs/changelog/` 对应版本目录（如 `v1.6/`–`v1.9/`、`v2.0/`），**不进本索引**；已开发未发版者进索引并标「待发版」——tag/npm/package.json 发版时统一同步。
>
> 注：本节「正式版」是相对 v0.x「实验版」的**里程碑分类**；接口稳定性承诺见 [README 版本阶段](./README.md#安装)——v1.x 为**阿尔法施工期**，v2.0.0 起贝塔。

- **v1.7.0** — 🧭 判定底座·阶段二（模型与校准）——2026-10-22 已发版（✅ 已发版）：RLCD 严格适当评分训练（三类原语分派损失+非对称惩罚+RLOO/KL/降权三防线）· 分桶温度校准（三原语分立+保序+独立校准集隔离断言）· 校准纪律门禁（uncalibrated 声明制+check-calibration-claims 接入发布链）· 弃权第四态（三源留痕+分档门槛+未达阈不可关）· 三原语概率面完整化 · 三态对照与双达阈判定（实测：ECE 17/18 格达线 · 一致率 zh 0.425/en 0.665 未达 ⇒ 阶段三暂缓，短板定位判定质量）· 判据变更留痕（RULER_CHANGE+HMAC 链）——测试 6230→6512（+282，13 包）· 规则 28 · 场景 411→417（+S488-S493）· 回归 84 维 · release-gate verdict=PASS · [开发日志](./docs/changelog/v1.7/v1.7.0.md)
- **v1.6.0** — 🧭 判定底座·阶段一（判据与数据地基）——2026-10-15 已发版（✅ 已发版）：三原语类型化 · 28 规则拆 36 条判据（fail-closed schema + 质量 lint）· 数据集三元组（对比样本四步构造 · 家族级切分）· 三源采集器 + 九类困难样本 · 四道质量门 + 主动选样 · 判定头契约（EncoderLike）· 零样本基线如实落数 · `loop:` 循环语义（fail-closed + pause/resume）——测试 6067→**6230**（+163，
  13 包）· 规则 **28** · 场景 406→**411**（+S483-487）· 回归 **83 维** · [开发日志](./docs/changelog/v1.6/v1.6.0.md)（2026-10-20 更正：起点数 6069→6067、增量 +161→+163，三源归一实测口径，出处 commit 3f219b3a2；verdict=PASS 结论见开发日志发布记录，索引行不再重复）
- **v1.5.9** — 🧬 进化模块·写面审计与元验证——2026-10-13 已发版（✅ 已发版）：自进化写面审计留痕（prompt/memory 两面）· 能力基线版本线（四层快照+回滚）· 加载链配置面契约（18 字段 SSOT）· 验证器老化检测 · FDE Handbook 六段升格 · 透明仓与敌手自测（红队两态）· evolve 升格 RSI 独立模块 · **旧命令 shim 显式退役（12 bin，破坏性）**
  ——MCP **104** · 测试 5946→**6067**（+121，13 包）· 规则 **28** · acceptance 场景 401→**406**（+S478-482 共 5 场景：3 承接 B 类 + S481 一维收口锁 + S482 Handbook 升格锁）全绿（断言 488/488）· [开发日志](./docs/changelog/v1.5/v1.5.9.md)

- **v1.5.8** — ⚡ 进化模块·准入门与数据面——2026-10-09（✅ 已发版）：进化准入判据（三档分流 · 未登记 fail-closed）· 三层晋级判据（注入租用 / skill 半持久 / 微调摊销 + 四道证据门槛）· 经验池接训练管道（血缘锚点 + train 旁挂适配器 + 混合构建）· 出题考核器（双成功判定 + 独立性硬门 + 沉淀三态）· RL 训练治理（opt-in 策略集 + 单源惩罚折算）· 规则数 25→28 全线清偿 + 门禁补强 5 道（进化模块五章为 SDK 面先行，用户可触达入口排期 v1.5.9）
  ——MCP **104** · 测试 5842→**5946**（+104，13 包）· 规则 **28**（17+11）· acceptance 场景 **401** 全绿（断言 483/483）· [开发日志](./docs/changelog/v1.5/v1.5.8.md)
- **v1.5.7** — 🔍 审计模块·覆盖面扩展与能力面治理——2026-10-08 已发版：SMB 场景审计（勾稽/溯源/口径三判据）· 审计规则 25→**28 条**（E5 数据产物 / E6 提示注入 / E7 决策质量）· 决策类型 17→**18 值**· 浏览器底座退役 · 能力面治理（SkillOps 五维 + 遥测 status/durationMs + 可拔契约 18 单元）· 评估三件（UI=不实做 / 国标 5 标准 10 差距 / ACS=不采纳）
  ——MCP **104** · 测试 5661→**5842**（+181，workspace 13 包）· acceptance 场景 **401** 全绿（断言 483/483）· [开发日志](./docs/changelog/v1.5/v1.5.7.md)
- **v1.5.6** — 🧭 存量收敛·单入口与数据面——2026-10-04 已发版：CLI 单入口收敛（13 bin → 单入口 + 12 shim）· 数据生命周期治理（记忆分层归档 · 审计链历史段归档 · doctor 数据健康度 · 记忆项目作用域）· 文档与安装面修复批（21 项）——MCP **104** · 测试 5642→**5661**（13 包）· acceptance **479**（场景 397，
  双口径见[开发日志](./docs/changelog/v1.5/v1.5.6.md#实现纪要2026-10-02--10-04--四波次)） · [开发日志](./docs/changelog/v1.5/v1.5.6.md)
- **v1.5.5** — ⚡ 执行模块·执行状态机与按需加载——2026-10-01 已发版：全节点执行状态机 · Tool search 按需加载（BM25+中文 2-gram）· 多 Agent 阵型调度（六阵型三态）· 编排依赖治理（langgraph 降 optional）· README 理念主线重写——MCP **104** · 测试 5569→**5642**（13 包）· acceptance 388→**395** · [开发日志](./docs/changelog/v1.5/v1.5.5.md)
- **v1.5.4** — 🎯 执行模块·模型路由与凭证验证——2026-09-30 已发版：路由决策链（三级路由/敏感强制本地/硬拒）· 凭证隔离 Vault · 多实例自验证表决 · AI 节点治理接入 · 授权/凭证对账——MCP 103→**104** · 测试 5408→**5569**（13 包）· acceptance 377→**388** · [开发日志](./docs/changelog/v1.5/v1.5.4.md)
- **v1.5.3** — 🔍 审计模块·规则引擎统一与自测：双规则引擎统一 · 规则自测 schema（正负样例 fail-closed）· A24 交付物落点规则（24→25）· doctor 修复闭环 · 测试 5296→**5408**（13 包 workspace 口径）
  · acceptance 373→**377** · 2026-09-26 已发版 · [开发日志](./docs/changelog/v1.5/v1.5.3.md)
- **v1.5.2** — 🔍 审计模块·对外开放面与判定语义：MCP audit 数据对外（`audit_query` 只读 + 事件订阅）· 约束导出外部可验（`ruleset_export`）· should-run 判定链 · 审计结论失效语义 · 网络出口治理面 · 事前授权补环 · DSH 插件 npm 首发面
· 测试 5083→**5296**（+213，13 包 workspace（模块包）口径）· acceptance 367→**373** · MCP 新增 `audit_query`/`ruleset_export`（总数 107） · 2026-09-24 已发版 · [开发日志](./docs/changelog/v1.5/v1.5.2.md)
> 📌 **当前口径**：MCP tool 总数 **104**（v1.5.4 新增 `router_slots` 103→104；浏览器四件套 MCP 面（`playwright_*`）2026-09-26 退役 107→103，底座随 v1.5.7 章二删除，裁定见 [v2.0.0 §七 B 表](./docs/changelog/v2.0/v2.0.0.md)；上方 107 为 v1.5.2 时点读数）
- **v1.5.1** — 🎬 编排模块·事件驱动（业务事件触发/设备 OTA/审计输入双通道/`sofagent demo`）· 测试 4903→**5083**（13 包 workspace 口径）· acceptance 357→**367** · 2026-09-22 已发版 · [开发日志](./docs/changelog/v1.5/v1.5.1.md)
- **v1.5.0** — 📊 治理模块·可见性与本体成熟（治理 KPI 面板/本体双时态/Validation Engine/trace 对账/FDE 陪跑期/DSH 插件事件接线）· MCP 104→105 tools · 测试 4805→**4903**（+98，13 包口径）· acceptance 352→**357** · 2026-09-19 已发版 · [开发日志](./docs/changelog/v1.5/v1.5.0.md)
- **v1.4.x（后训模块九连版 v1.4.1→v1.4.9）** — 🚂 train-job 编排 → 数据管道 → eval → serve → 分布式训练 → 商业接口 → 插件管控 → 设备接入：企业专属小模型全链路（train compare 多基座对比 · 详见各版日志）。



> ⚠️ **API 退役公告（v1.4.3 公告 · v1.5.0 移除）**
>
> `checkHistoryChainIntegrity`（@public 双导出：audit / core）**已于 v1.5.0 移除**——布尔语义无法区分篡改 / 不可复验 / 历史不足三态，后继 `checkHistoryChainDetailed` 已交付。迁移：原 `true` → `status === 'ok'`；原 `false` → 结构化字段（`tampered` / `unverifiable` / `insufficient-history`），示例见 `engine/audit/src/commands/verify.ts`。

> 🔴 **破坏性变更公告（v1.4.8）· 训练域符号迁移至 `@sofagent/train`**
>
> `@sofagent/orchestrator` 根 barrel 移除 train 域 **101 个重导出块 / 561 个 `@public` 符号**（orchestrator 符号数 1444 → 883），全部迁入独立包 `@sofagent/train`（barrel 564 符号）。**替换路径**：`import { createTrainJob } from '@sofagent/train'`。
> **不提供兼容期**（技术原因，非选择）：保留根 barrel 重导出会使 `orchestrator` 与 `train` 互相依赖，构成**包级循环**。全仓 `@public` 基线 2281 → 2283。

> 📋 **判据偏差登记（v1.4.8）· 伞包依赖闭包**
>
> 任务书判据「伞包 `sofagent` 闭包**不含** `@sofagent/train`」**未达成**（实测包含——umbrella 直连 audit / mcp / orchestrator / daemon，train 经 daemon / mcp 传递）。**改口径收口**为「`@sofagent/orchestrator` 闭包不含 train」：该闭包 7 成员不含 train，第 7 批真实目标（后训代码移出编排核心）已达成。
> 不继续做的理由：① 单写 `peerDependencies` 无效（npm ≥7 默认自动安装 peer）② `mcp` 缺 train 会**启动即失败**（`mcp-server → tool-registry → tools/train-cloud` 三点静态串联）③ B 方案会让 `dependency-direction.sh` 对这两条边**失明**。**未来前置**：mcp tool 注册形态重构。

> 🔶 **破坏性变更公告（v1.5.0 · 死配置清扫与同名导出更名）**
>
> ① **`cleanupOnRecord` / `SOFAGENT_CLEANUP_ON_RECORD` 死配置全链移除**：`SofaEnvConfig` 中的 `cleanupOnRecord`（@deprecated v1.4.3）已随死配置清扫删除，**shell 与 PowerShell 侧消费链同批清扫，三侧零残留**（合规配置段检查同步为 6 项；逐文件清单见 [v1.5.0 开发日志](./docs/changelog/v1.5/v1.5.0.md)）。
>**升级影响（行为变更）**：此前在 `fde.md` 设 `data_cleanup_on_record: true` 的用户，写入后按 1/N 概率自动清理的行为不再发生——需要自动清理请显式调度 `engine/scripts/cleanup.sh`，保留策略用 `SOFAGENT_RETENTION_DAYS` / `SOFAGENT_RETENTION_MAX`。完整披露见 [LIMITATIONS §七](./docs/LIMITATIONS.md)。
> ② **`@sofagent/train` 导出 `routeRequest` 更名为 `canaryRouteRequest`**（同名消歧）：orchestrator 另有同名 `routeRequest`（`@sofagent/orchestrator/workflow` 语义路由）——裸符号 grep 接线断言会假阳性。该导出零生产消费者，破坏面为零；消费侧（仅测试）已同步更名。同名导出矩阵见 [WIKI 术语表](./docs/WIKI.md)。

> 🔶 **破坏性变更公告（v1.5.7 · F53 注册路径验哈希旁路移除）**
>
> **`RegisterModelInput.verifyHash` 入参删除，`registerModel` 验哈希硬编码为 `true`**（供应链红线收口）：v1.5.1 披露的「注册路径可用 `verifyHash: false` 显式跳过验哈希」旁路（调用方恰是被约束方）已移除——注册 / 切换（switchModel）/ 回滚（rollbackWeightsVersion）三条版本切换路径统一为唯一强校验路径。
> **升级影响（行为变更）**：此前依赖 `verifyHash: false` 跳过权重哈希校验的注册调用将**直接失败**（哈希不匹配即拒绝注册，fail-closed）；MCP tool `model_register` 的 `verify_hash` 参数不再生效（schema 保留兼容、传入即被忽略，后续版本移除）。全仓三个调用点已同批适配（mcp/model-register、train/artifact-register、orchestrator/registerLocalEndpoint——最后一个本就不传该参数）。
>裁定链：维护者拍板「硬编码 true 为唯一路径」，随 v1.5.7 发版生效。

> 🗑️ **API 退役公告（v1.5.7 · 浏览器实现底座删除与公开面 4 符号吊销）**
>
> **`@sofagent/orchestrator` 公开面吊销 4 符号**：`BrowserSession` / `BrowserDriver` / `BrowserAuditSink` / `BrowserSessionFactory`（`public-api-baseline` 同批移除，2549→2545）——实现底座 `engine/orchestrator/src/refine-agent/browser-tools.ts`（260 行）与其单测（204 行）已删除，
>对齐 [v2.0.0 §七 B 表](./docs/changelog/v2.0/v2.0.0.md) 裁定（「第四轮补 · orchestrator 侧能力库」）。触发链：[v1.5.7 第二章 UI 审计可行性报告](./docs/eval/ui-audit-feasibility.md)落盘（结论「不实做」）⇒ 四件套随之退役删除。
> **升级影响（公开 API 删除）**：外部代码 import 上述 4 符号将编译失败——四件套自 MCP 面 2026-09-26 注销（107→103）后已零生产消费面，SDK 面台账零登记（`check-unwired-exports` 实测零命中），实际破坏面为零；历史实现可自 v1.4.x tag 取回。
>**保留不变**：三件图像能力 `analyzeScreenshot` / `readImageMeta` / `degradeImageToText`（dsh-vision 视觉降级本体，非四件套）迁 `engine/orchestrator/src/refine-agent/image-meta.ts`，`@public` 导出与基线条目原样保留（导出改指新模块，导入路径无需变更）。MCP 工具面无增删（仍 104）。

- **v1.3.9** — 🔍 官方 AST 规则引擎（8+2 规则同管线）+ meta-harness 多 harness 编排 + worklog 数据层 + API 分级 @public/@internal（1439 符号门禁）+ FORGE 切 DSH + MLflow agent 评估 + Agentic Browser + 跨平台适配器 + ATTRIBUTION 归因 + Dream Sandbox + >5MB diff 修复 + 长任务进程自愈（守护 daemon + watcher，
  进程被外部回收后自动恢复） · 测试 2782→**2903**（+121）· 2026-08-23 · [开发日志](./docs/changelog/v1.3/v1.3.9.md)
- **v1.3.8** — 🛡️ 代理网关硬边界（唯一出入口 + HITL 审批队列首场景）+ 🔐 数据静态加密（能力交付：AES-256-GCM，daemon 接线 v1.4.7 收口——密钥就绪后审计历史密文落盘 SOFAGENT-AGE-V1，见 SECURITY）+ ⏸️ Durable Execution L3（WAL 三档可逆）+ ⏰ 异步长任务自治（cron + 依赖图）+ FORGE 保活三件套 + SDK `sandbox:true` + release-gate 瘦身 + 审查成本计量（逐步 token 记账 + 单次草稿模式） + 快照写路径加固 · 测试
  2655→**2782**（+127）· 2026-08-20 · [开发日志](./docs/changelog/v1.3/v1.3.8.md)
- **v1.3.7** — 🏰 SubAgent 完整沙箱（虚拟 FS/网络白名单/独立进程/A-B 双跑）+ 场景驱动权限（fail-closed）+ AgentShield 五类扫描 + 行业 overlay 四套 + 断路器监控（ASI08/ASI10）+ ontology 生命周期（branch/trunk + 审阅门）+ FORGE 自适应并发 + memory-sync 路径通用化 + 安全加固 26 项 · 2026-08-18 · [开发日志](./docs/changelog/v1.3/v1.3.7.md)
- **v1.3.6** — 🔌 引擎接口外化（Workflow 标准格式 / Ontology Schema D1-D5 / 模型注册灰度 + 强制人审）+ SubAgent 托管 SDK + 训练协议三约定 + 路由可解释性 + 机器可判定验收（define_acceptance）+ 可靠性五件（worktree 隔离/双闸验证/疲劳检测/降级梯队/decisions 五分类）+ market→commons 更名 · MCP 52→**60** · 2026-08-18 · [开发日志](./docs/changelog/v1.3/v1.3.6.md)
- **v1.3.5** — MCP 自进化 + instinct→skill 自动进化：引擎接口外化推进 · MCP 48→**52**（4 新）· 测试 2380→**2431** · 2026-08-16 已发版 · [开发日志](./docs/changelog/v1.3/v1.3.5.md)
- **v1.3.4** — 🏪 L3 组织能力市场（五环：发布→发现→调用→评价→养护 + 6 market MCP tool；market_* 系列 v1.3.6 起更名 commons_*）+ 🛡️ SkillScan 安全门（三态判定 + 发布/安装双触发）+ 📊 评估体系三步（harvest→jury→promote）+ 🔌 编排层与执行层分离（ExecutionBackend + DSH 执行后端接入）+ 📜 DecisionKind.MARKET + daemon 市场双巡检 · 2026-08-14 ·
  [开发日志](./docs/changelog/v1.3/v1.3.4.md)
- **v1.3.3** — 🤝 L2 团队协作协议（五大机制）+ ✨ Refine Agent 完整版 + 🧭 主 agent 编排 + 🚪 入口路由 + 📈 进化闭环升级 + 📜 evidence 字段 · 2026-08-12 · [开发日志](./docs/changelog/v1.3/v1.3.3.md)
- **v1.3.2** — 🔄 Onboard Agent 完整版（L2-L5）· 2026-08-11 · [开发日志](./docs/changelog/v1.3/v1.3.2.md)
- **v1.3.1** — Durable Execution 编排增强 + Benchmark 基线：波次并发 + MergeQueue · 测试 2105→**2209** · 2026-08-11 已发版 · [开发日志](./docs/changelog/v1.3/v1.3.1.md)
- **v1.3.0** — 🔐 运行时审计最小闭环（tool wrapper 拦截层）+ 决策审计（意图问责 MVP）+ 双规则统一 + 运行时审计日志按 git 仓库隔离（FORGE 自托管 SubAgent 路径已交付 repo-hash 隔离；文档曾长期标「规划中」系滞后；引擎侧 data-sovereignty 审计日志仍全局，排 v1.3.9；
  commit 级 history.jsonl 仍全局）+ HITL 钩子 + list_rules 规则透明化 + 激活链收尾 + 外部记忆后端 Path A + 进化链路写保护 · 2026-08-09 · [开发日志](./docs/changelog/v1.3/v1.3.0.md)
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


## 实验版（v0.x）与早期开发期

v0.1–v0.80 的开发期记录已归档至 [docs/archive/changelog-experimental-versions.md](./docs/archive/changelog-experimental-versions.md)（原文保真）；v1.0.0 起的正式版记录见上方各节。