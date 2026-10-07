# sofagent

<p align="center"><img src="docs/assets/banner.png" alt="sofagent" width="100%" /></p>

<!-- H1 与横幅分工：H1 是仓库名与语义锚点（供搜索引擎/无图环境/screen reader），横幅承载视觉 -->

<p align="center">
  <a href="https://github.com/KongFangXun/sofagent/actions/workflows/verify.yml"><img src="https://img.shields.io/github/actions/workflow/status/KongFangXun/sofagent/verify.yml?branch=main" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-brightgreen" /></a>
  <a href="./CHANGELOG.md"><img src="https://img.shields.io/badge/Version-v1.5.6-16B8F3" /></a>
  <img src="https://img.shields.io/npm/v/sofagent" />
</p>

<p align="center"><sub>简体中文 | <a href="./README.en.md">English</a></sub></p>


## 目录

- [这是什么](#这是什么)
- [该不该装？](#该不该装)
- [核心特性](#核心特性)
- [什么是 FDE Harness](#什么是-fde-harness)
- [多平台挂载](#多平台挂载)
- [v1.5.6：存量收敛（单入口 + 数据面）](#v156存量收敛单入口--数据面)
- [FDE Harness 两阶段](#fde-harness-两阶段)
- [安装](#安装)
- [使用](#使用)
- [常见问题](#常见问题)
- [生态与文档索引](#生态与文档索引)


## 这是什么

> 💬 **一句话版本**：进场时它替你把业务摸清、写成文件；离场后你的数字员工每次改代码、动文件，都按文件过一道安检、留一份记录、存一个快照——出事能查、能回滚。

> 🏢 **组织视角版本**：AI 落地卡点已从「模型够不够聪明」迁到「组织敢不敢接」——能不能进组织架构、有没有账号、绩效怎么算、做错了怎么退。sofagent 是给数字员工办入职的制度：进场把岗位职责写成文件，离场按文件做绩效考核（每次变更留证据）、组织记忆（沉淀机制随使用迭代，边界见 [LIMITATIONS](./docs/LIMITATIONS.md)）、试错容错（做错退得回）。给 AI 发工号前，先装 sofagent。

> 🧩 **一句话（三因子口径**，术语见〈[什么是 FDE Harness](#什么是-fde-harness)〉**）**：sofagent 是**自带 Harness 的 FDE 交付物治理层**——工程层（FDEing）与治理层（harness）已交付，判定层（S1M，把判定从生成里分出来的决策模型）排期 v1.6.0–v1.9.0 建设、v2.0.0 宣告。三层各司其职、不互替。
>身份公式定稿 **FDEing × S1A（S1A = S1M + Harness）**，口径 SSOT = [PHILOSOPHY · 身份口径](./docs/PHILOSOPHY.md)。

**开源 FDE Harness 层**（Harness = 「缰绳」，套住 Agent 的治理层；FDE = Forward Deployed Engineer 前线部署工程师，详见〈什么是 FDE Harness〉）——嵌在成熟 Agent（DSH / OpenClaw / WorkBuddy）与模型层之间做治理：进场把业务判断写成文件（工作流/本体数据/AI 节点），离场按文件审计每次变更。约束层五种能力（注入·审计·回溯·沉淀·进化），五种形态分发（FDE 插件 / Skill / MCP / CLI / Dashboard）。
sofagent 不造 Agent——交付的是让任何 Agent 被管住的那一层（管住强度按宿主分档：DSH/OpenClaw 硬注入可拦截，其余档位为建议性注入 + git hook 审计兜底——见〈多平台挂载〉档位表）。

<p align="center">
  <img src="docs/assets/audit-terminal.png" alt="sofagent audit 拦截 .env 提交" width="860" /><br/>
  <sub>零配置审计实拍：一行命令审计最近一次 commit，密钥泄漏当场拦截（截图摄于单入口收敛前，命令已收敛为 sofagent audit）</sub>
</p>

<details>
<summary>🗺️ 系统架构总览（FDE Harness 五模块编制）</summary>

<p align="center">
  <img src="docs/assets/architecture-diagram.png" alt="sofagent 系统架构" width="860" /><br/>
  <sub>约束 Agent 行为 · 审计每次变更 · 沉淀经验（五模块编制：治理模块 v1.5.0 已发版 · 执行模块 v1.5.4/v1.5.5 已发版；完整交互版见 <a href="./docs/ARCHITECTURE.md">ARCHITECTURE</a>）</sub>
</p>

</details>

**30 秒轻量试用**（首次含 npx 拉包，复跑秒级；单次引擎审计本身约 1.1 秒，实测口径见下）：`npx -y -p sofagent sofagent audit`（任意 git 仓库，密钥泄漏当场拦截）。

> 💡 只要审计 CLI、不想拉全量依赖树？改装 scoped 包：`npm i -g @sofagent/audit`（体积与依赖面小得多，能力面见 [LIMITATIONS · 包依赖](./docs/LIMITATIONS.md)）。

> 💡 试用时提交消息请写 **≥6 字符**（如 `initial audit test`）——A19 质量规则（编号对照见 [SECURITY 规则清单](./SECURITY.md#28-条审计规则完整清单文档级-ssot)）对超短消息（`init`/`add`）判红属设计意图（防无意义提交信息），不是故障。

**五分钟沙箱演示**（v1.5.1 已交付；沙箱隔离、真实文件零接触）：`npx -y -p sofagent sofagent audit demo`——一条命令跑完「沙箱构建 → 注入 → 故意违规 → 审计拦截 → 快照回滚 → HMAC 举证导出」五幕链路（`--speed fast` 为 60 秒版；产物落 `$SOFAGENT_DATA/demo`，不触碰被审仓库）。

> 版本说明：v1.5.6 已发版（2026-10-04）；npm 可安装最新版 `@sofagent/audit@1.5.6`。

## 该不该装？

| 如果你是… | 建议 |
|---|---|
| **给现有 Agent 加纪律**——已有 DSH / OpenClaw / WorkBuddy，想让 AI 干活时守规矩、留痕、出事能回溯 | ✅ **现在装**。核心价值就是约束层（注入 · 审计 · 回溯 · 沉淀 · 进化），装完即用 |
| **一人公司 / 小企业想落地 AI**——没有专职工程师，需要一个"不离职的 FDE"帮你梳理工作流、部署 AI 节点 | ✅ **现在装**。FDE Harness 层就是干这个的——进场把判断写成文件，离场按文件执行与审计，全链路 |
| **要开箱即用的企业级 Agent 平台**——期待完整商业产品（多租户、权限管理、计费、SLA） | ⏸️ **暂缓**。sofagent 是 FDE Harness 层，不是平台产品——平台级能力不在本开源仓库范围内。有集成能力的团队仍可把约束层接入自有平台，作为其中的治理模块；纯开箱需求建议另选平台产品 |
| **纯研究 / 想看看约束层怎么设计**——读代码、学架构、借鉴方法论 | ✅ **现在装**。文档齐全（[HANDBOOK](./docs/HANDBOOK.md) / [ARCHITECTURE](./docs/ARCHITECTURE.md) / [PHILOSOPHY](./docs/PHILOSOPHY.md)），MIT 协议 |

**和 gitleaks / pre-commit 这类工具什么关系？**（互补不互替）

| | gitleaks 等扫描器 | pre-commit 等钩子 | sofagent |
|---|---|---|---|
| 定位 | 密钥全量历史扫描 | 通用提交钩子框架 | Agent 行为审计约束层 |
| 证据面 | 仓库文本模式 | 自定义脚本 | git diff 硬证据 + Agent 日志 + 决策留痕 |
| 覆盖维度 | 密钥泄漏 | 任意（自己写） | 28 条规则：密钥/越界/注入/权限/后门 |
| 部署成本 | 低——单二进制，零依赖 | 低——随语言生态装一个 CLI | 中——企业设备需一次 `install.sh` 装约束层（也可先用 npx 零配置试用） |
| 维护负担 | 低——规则随上游更新 | 中——自定义脚本需自己维护 | 中——规则与 hook 随本仓升级，但每版需重装 hook 并对齐配置 |
| 建议 | 强密钥合规必配 | 已有体系可保留 | 与前两者并用，专注 Agent 治理维度 |

## 核心特性

> ### 万物皆可 FDEing（理念）
>
> **从 FDE 到 FDEing——万物皆可 FDEing**：把 Forward Deployed **Engineer**（岗位）变成 Forward Deployed **Engineering**（能力）——岗位随人走，能力随交付物留。**FDEing 即其缩写**（读 /ef-di-i-ing/，与 engineering 同构）：名词指这种能力，动词指把 FDE 从人力工作变成这种能力。
>
> - **FDE 是名词，FDEing 是动词**——把 FDE 从一项人力工作变成一种可自动执行的能力（打法 × 判定 × 治理合成）：花更少的人力，提供更多的能力。
> - **不限于软件**——任何业务对象、流程、节点，都可以被 FDEing 一遍「梳理 → 判定 → 交付 → 养护」；硬件节点、机器人运动过程同样是一条条 workflow，差别在执行器、不在治理形态。
> - **它同时是一种思维方式**——做任何事之前先想三件：① 这件事的 workflow 怎么搭；② 其中的 AI 节点是什么；③ 怎么让 AI 更好地帮你实现（详见 [PHILOSOPHY · 从 FDE 到 FDEing](./docs/PHILOSOPHY.md)）。

三层各归其位：**工程层（FDEing）** 进场把判断写成文件，**判定层（S1M）** 管判断怎么形成、怎么留痕、怎么被举证，**治理层（harness）** 离场后让判断 7×24 被执行。

**工程层 · FDEing**（进场 · 生成判断，FDE 相位——把「该不该上 AI、值多少钱」判断出来，冻结成交付物）：

- 🧭 **梳理工作流**——五要素深挖 + 三问判定法，把每个岗位环节摸清，算清每个 AI 节点值多少钱
- 🤖 **部署 AI 节点**——三层交付物（文档层 + Skill 层 + 运行层），装进你已有的 AI 工具，从"你干活"变"你派活"
- 📦 **判断冻结成交付物**——每个节点带「做好标准（merge_criteria）· 谁拍板（approver）」，机器可判定、跨阶段共享

**判定层 · S1M**（System One Model——判断与生成分离的决策模型；**排期 v1.6.0–v1.9.0 施工、v2.0.0 宣告，尚未交付**——本版只声明身份与路线，不声称能力实装；口径锚定 [S1M-DECISION-POINTS](./FDE/S1M-DECISION-POINTS.md) 与 [v2.0.0 §一](./docs/changelog/v2.0/v2.0.0.md)。已交付落点是既有判定与举证面）：

- 🔎 **判定留痕**——decision-log 因果链记录每个可问责决策（谁拍板、依据什么、为何这么做），供 auto-PR 解释块与 daemon 周报消费
- 🔗 **判定可举证**——审计历史落 HMAC 链，`--verify-chain` 可离线复算链完整性，结论能被第三方复核

**治理层 · harness**（离场 · 驻留判断——「harness 治理」，按交付物 7×24 执行，进化时写回）：

- 🏠 **离场后常驻**——FDE 能力留下巡检、审计、优化，7×24 在线守护（commit 时触发审计），人离场治理不离开
- 🔍 **零配置审计**——`npx -y -p sofagent sofagent audit`，任何 git 仓库秒级审计最近一次 commit（实测：quick 约 1.1s、5 万行 diff 约 6.1s，口径见 [HANDBOOK](./docs/HANDBOOK.md)）
- 🧱 **规则与安全面：28 条审计规则**——密钥泄漏、越界编辑、注入防御、权限红线，违规当场拦截；fail-fast 设计（critical 层命中后其余规则跳过）、默认非 fail-closed（配置可被篡改、hook 可被 --no-verify 跳过——绕过面见 [LIMITATIONS §三](./docs/LIMITATIONS.md#三安全与信任模型局限)）
- 🔧 **工具与能力面：104 个 MCP tool + 证据两档**——28 条规则中 22 条基于 git diff 硬证据（本地即生效）、5 条需数据面（4 需 Agent 日志、1 走 decision-log；编号对照见 [SECURITY 规则清单](./SECURITY.md#28-条审计规则完整清单文档级-ssot)，边界见 [LIMITATIONS §三](./docs/LIMITATIONS.md#三安全与信任模型局限)）
- 🛡️ **自动快照回溯**——每次审计后自动存档，出事一键回到任意快照

## 什么是 FDE Harness

**FDE = Forward Deployed Engineer（前线部署工程师）**——把模型塞进企业真实业务里的人。sofagent 把该角色做成开源 FDE Harness 层，嵌在你的 Agent（DSH / OpenClaw / WorkBuddy）与模型层之间。完整工作流分两阶段，**中间的交接物把它们缝成一件事**：

- **进场 · 生成判断**：四步——**梳理工作流 → 构建双图谱 → 判定 AI 节点 → 部署**。双图谱 = 业务图谱（边界、数据流向，人读）+ 本体图谱（共享语义底座，AI 读）；每个 AI 节点的「做好标准（merge_criteria）· 谁拍板（approver）· 何时跑（trigger）」在此判定并冻结进交付物（workflow.yml + 本体 + skills）。
- **离场 · 驻留判断**：FDE 走，判断留下——审计在 commit 等变更事件时按冻结的标准自动触发（证据分档见「核心特性」首条）；daemon 7×24 巡检、快照可回滚、经验持续沉淀。人离场，治理不离开。

> 🔗 **为什么必须一体**：交付物是两阶段共享的活状态——进场写入、离场执行时读、进化时写回（试验分支晋升基线、反思蒸馏回流）。没有 FDE，约束层无判据可执行；没有约束层，FDE 的判断随人离场蒸发。「FDE Harness」之名即由此——不是两种功能的拼盘，是同一件事的两阶段。
>
> 两个阶段的合成效果——「从 FDE 到 FDEing」——见〈核心特性〉首段理念主线（万物皆可 FDEing）。

<p align="center"><img src="docs/assets/arch-layers.svg" alt="sofagent 三层定位：模型层 → FDE Harness 层 → Agent 层" width="85%" /></p>

**为什么是 FDE Harness**

- **企业 AI 落地的瓶颈不是模型，是部署**——MIT NANDA《生成式人工智能的鸿沟》：95% 企业 GenAI 项目未能产生可写进财务报表的价值，而 FDE 岗位发布量一年涨 729%（核验见 [VALIDATION](./docs/VALIDATION.md)）
- **完整来自组合**——DSH 解决「能干活」，sofagent 解决「持续干」，两者合起来才是完整的 FDE Harness（见下一章「多平台挂载」的 DSH 档）
- **约束层「持续优化」靠机制不靠承诺**——外部独立实验（ARC-AGI-3，**能力型 harness 数据**，与治理型约束层的可靠性收益非同一量纲）：同一模型仅优化外层 Harness 即可显著提升任务完成率（核验见 [VALIDATION](./docs/VALIDATION.md) · [THANKS](./docs/THANKS.md)）
- **能力可迁移，绝不绑死单一平台**——约束层平台无关（可迁移的是约束资产与审计兜底，注入强度仍按宿主分档：DSH/OpenClaw 硬注入，其余建议性注入 + git hook 兜底——见〈多平台挂载〉档位表），方法论跟着业务走、不跟着平台走

> 🔄 **自举**：sofagent 给自己做的第一份 FDE，就是 sofagent 自己——项目本身就是一条完整的 FDE 工作流（梳理 → 构建 → 部署 → 离场），这个开源仓库就是那份交付物。

## 多平台挂载

横跨你已有的 Agent、纵贯模型层，不替代模型，只补可靠执行——**FDE Harness 层平台无关**（插件 / Skill / MCP / CLI / Dashboard 五种形态按宿主能力分发），方法论跟着业务走，不跟着平台走：

| 档位 | 平台 | 约束注入 | 挂载方式 |
|---|---|---|---|
| **深度结合** | DeepSeek Harness | ✅ **逐工具调用可拦** | 6 款原子 `cordis-plugin-sofagent-*` 挂进运行时（另有 1 款聚合可选）——`tools/pre-execute` 等 7 个生命周期事件（词汇表见 `engine/dsh-plugins/SEAMS.md`） |
| **完整挂载** | OpenClaw | ✅ **每会话注入一次** | Hook 注入四层约束 + 断路器 + 4 款 OpenClaw 插件 |
| **标准挂载** | Claude Code / Cursor | ⚠️ Skill 自觉加载 | Skill 目录 symlink + 平台规则文件 + 拦截配置（内容为提交级 25 规则，非调用级拦截） |
| **薄挂载** | WorkBuddy / Codex / Gemini CLI / Hermes | ⚠️ Skill 自觉加载 | Skill 目录 symlink（Codex 走 `AGENTS.md` 挂载点）+ git hook 审计 |

- **别假设能力对齐——档位差的是注入强度，不是「有没有」**：DSH 逐工具调用可拦，OpenClaw 每会话注入一遍，其余宿主靠 Agent 自觉读 Skill 文本。「支持某平台」= 约束资产在该平台可用，**≠ 强度与他平台相同**；跨宿主迁移前先看目标宿主落在哪档，矩阵见 [加载链 HOOK](./engine/hooks/sofagent-load-chain/HOOK.md)
- **审计兜底平台无关**——`sofagent audit --install-hook` 走 git hook，任何档位每次 commit 都自动审计（默认启用 17 条；完整 28 条需在 `.sofagent/config.yml` 显式开启 `extendedRulesEnabled: true`），违规硬拦截。
  约束是建议性的，审计是强制性的（强制的边界：默认非 fail-closed，`--no-verify` 可跳过前两层防线、post-commit 只留痕不阻断——被绕过的 commit 会留痕，详见 [LIMITATIONS §三](./docs/LIMITATIONS.md#三安全与信任模型局限)）

一条命令选定挂载档位：`bash install.sh --platform <平台名>`（全部平台与差异见 [HANDBOOK](./docs/HANDBOOK.md)）

## v1.5.6：存量收敛（单入口 + 数据面）

🧭 **一个入口、一份干净的数据面**（✅ 已发版 · 2026-10-04）——命令从 13 条收成一条，运行时数据从「只增不减」变成有生命周期：

| 能力 | 一句话 |
|---|---|
| **CLI 单入口收敛** | 13 bin 收口为 `sofagent <域> <动作>`；12 旧命令转兼容期 shim（可用 + 弃用提示） |
| **数据生命周期治理** | 事实记忆二级分层 + 冷热归档轮转；审计链历史段归档（**归档 ≠ 删除**）；遗留备份 30 天清理留痕；doctor 增数据目录健康节 |
| **沉淀记忆项目作用域** | 经验默认钉到项目，跨项目/全局不自动共享；复用走显式导出导入 + 血缘与审批留痕 |
| **运维与安全文档注入（R6）** | 四文档口径注入；LIMITATIONS 新增「S1M 判定失灵面」 |

> 📌 完整变更与验收证据见 [v1.5.6 开发日志](./docs/changelog/v1.5/v1.5.6.md)；旧版能力段见 [CHANGELOG](./CHANGELOG.md)。

## FDE Harness 两阶段

**两阶段的分工与不可分性**见上文〈[什么是 FDE Harness](#什么是-fde-harness)〉——本节补**组织侧读法**：两阶段合起来就是给数字员工办入职的全流程（离场侧自动动作：daemon 7×24 巡检 · 每次 commit 触发 28 条审计（含 **AgentShield 五类配置面静态扫描**）· 快照可回滚 · 进化时试验分支晋升与反思蒸馏写回交付物）。

| 组织动作 | sofagent 对应 |
|---|---|
| 岗位职责说明书 | 进场冻结的交付物（merge_criteria / approver / trigger） |
| 绩效考核 | 审计留痕 + 治理 KPI 面板（v1.5.0） |
| 组织记忆 | 知识沉淀（think.md 反思 + knowledge/） |
| 培训体系 | 经验→考核→晋级的自进化链（v1.5.8 排期） |
| 试错容错 | 快照回滚 + 能力基线版本线（v1.5.9 排期） |
| 劳动合同边界 | 可拔契约与主干能力清单（**未排期**——规划表中暂无对应版本条目） |

> 📚 **想深入**：[FDE/GUIDE](./FDE/GUIDE.md)（四阶段十二步）· [ARCHITECTURE](./docs/ARCHITECTURE.md)（五能力与模块）· [PHILOSOPHY](./docs/PHILOSOPHY.md)（设计禁区）· [FDE/README](./FDE/README.md)（Skill 体系）；完整导航见 [WIKI](./docs/WIKI.md)。

## 安装

**版本阶段（装前必读）**：sofagent 处于**阿尔法施工期**（v1.x）——功能面快速变动，**不承诺接口稳定**，跨版本升级前先读 [CHANGELOG](./CHANGELOG.md)。自 **v2.0.0** 起进入贝塔阶段。

对应的 npm 发布通道策略：**npm 不做 dist-tag 分道，`latest` 即最新版**——`npx @sofagent/audit` 默认拉到当前最新版本，无需指定标签（版本号承载阶段语义：v1.x 阿尔法施工期 / v2.0.0 起贝塔期）。`alpha` tag 保留为历史发布痕迹不维护。

> ⚠️ **企业用户先读** [LIMITATIONS §三](./docs/LIMITATIONS.md#三安全与信任模型局限)——`config.yml` 默认**非 fail-closed**（规则可被 Agent 篡改绕过），多租户**写入侧**隔离尚未落地（v0 已交付查询侧隔离：orgId 过滤 + data/<tenant>/ 路径地基，见 LIMITATIONS）。
>强合规场景建议 CI 兜底 + 文件权限锁（`chmod 400 .sofagent/config.yml`——辅助层，对同用户进程无效，见 [LIMITATIONS §三](./docs/LIMITATIONS.md)），不要用单机默认配置直接上生产。
>
> 🔐 **数据主权**：运行时数据不出本机（除安装时 npm 拉包外不联网）；三个 opt-in 出口（云同步 / 模型推理端点 / 云 VM 执行面）需你显式配置，详见 [SECURITY](./SECURITY.md)。

**30 秒，零配置**（首次含 npx 拉包约 30 秒，复跑秒级——引擎本体约 1.1s，实测口径见上）——在任何 git 仓库跑一次审计：

```bash
npx -y -p sofagent sofagent audit
```

> 💡 quick 跑 17 条默认规则（A3 任务范围 / A9 commit-msg 注入检测——读最近一次 commit 消息，无消息时按无输入跳过）；`--init` 的 hook 默认同样 17 条，完整 28 条需在 `.sofagent/config.yml` 开 `extendedRulesEnabled: true`——详见 [LIMITATIONS §三](./docs/LIMITATIONS.md#三安全与信任模型局限)。

> ⚠️ 这一步是**一次性审计**（当次进程内），不装 git hook——之后 commit 不会被自动拦。要长期守护请跑 `sofagent audit --init`（见下方完整安装）。

拦截特定格式密钥泄漏时是这样的（真实输出；A2（编号对照见 [SECURITY 规则清单](./SECURITY.md#28-条审计规则完整清单文档级-ssot)）检测 AWS AKIA/Secret、OpenAI sk-*、GitHub ghp_、Google AIza、Slack xox*-、JWT、PEM 私钥等已知格式，通用密钥形态暂不覆盖——保守设计防误报，详见 [LIMITATIONS §三 A2](./docs/LIMITATIONS.md#三安全与信任模型局限)）。
首屏的实拍图为 A1 场景（.env 敏感文件提交被拦、exit 2），A2 密钥格式检测为另一条规则，此处不重复截图。

**完整安装**（Node.js ≥ 18，先下载审查再执行）——**装在企业跑 AI 节点的设备上**：

```bash
curl -fsSL https://raw.githubusercontent.com/KongFangXun/sofagent/refs/tags/v1.5.6/bootstrap.sh -o bootstrap.sh
less bootstrap.sh          # 先看一眼脚本内容，确认安全
bash bootstrap.sh && rm bootstrap.sh
```

> 🔒 供应链信任链：tag 钉定 + sha256 校验 + fail-closed + 自锚定哈希重入二次校验（详见 [SECURITY.md](SECURITY.md) 远程安装节）；⚠️ 审计日志默认明文落盘——企业部署建议开启静态加密。

```bash
sofagent audit --init      # 装 git hook，之后每次 commit 自动审计
sofagent audit --doctor    # 验证环境（可选）
```

> 🔧 **新装机器首跑 `--doctor` 报「未建立 dist 基线」？** 运行 `sofagent audit --doctor --baseline` 建立基线（信任锚 = 你此刻确认 dist 可信的时刻——防影子审计器劫持，故不自动记录）。


> 💡 安装脚本写 `~/.sofagent/`（数据）+ `~/.local/bin`（CLI）；**仅显式传 `--platform <平台>` 时才写该平台集成目录**（默认不探测不修改）；npm 权限不足时 CLI fallback 到 `/usr/local/bin`，其余系统文件零改动。`--init` 装三层防线 hook（pre-commit / commit-msg / post-commit 对账）；
>`--no-verify` 可跳过 **pre-commit 与 commit-msg 两层防线**；**post-commit 事后对账不受影响**（git 原生开关不作用于它）——防的是诚实 Agent 疏忽而非恶意绕过，被跳过的 commit 由 post-commit 留痕（提示「疑似绕过」）但不阻断；个人兜底三件：CI 侧 `sofagent audit --diff`、定期 `--doctor`、翻审计记录。详见 [LIMITATIONS](./docs/LIMITATIONS.md)。
>
> 📌 **install.sh 是企业设备安装器**——装在企业跑 AI 节点的设备上（约束层 + daemon 巡检 + 单机 dashboard）；FDE 自己的电脑不需要跑，FDE 的工具是 [FDE Skill](https://clawhub.ai/kongfangxun/skills/sofagent)（方法论），详见 [部署架构](./docs/ARCHITECTURE.md#安装包边界与部署架构v132-定位校准)。
>
> 📌 **bootstrap.sh 和 install.sh 的关系**：bootstrap.sh 是 install.sh 的一行下载包装器——`curl bootstrap.sh | bash` 等价于「下载 install.sh + 运行 install.sh」。两个脚本装的是完全一样的东西，bootstrap 只是省掉手动 clone/下载那一步。

**卸载**：`bash ~/.sofagent/scripts/uninstall.sh`（安装态）或 `bash engine/scripts/uninstall.sh`（clone 态）——移除 Skill/约束文件、hook 注册与三个 git hook（`pre-commit` / `commit-msg` / `post-commit`），保留你的 `~/.sofagent/` 数据。

完整安装方式（clone / npx / 最小安装 / 企业部署）、卸载、以及「单入口与安装态怎么分辨」等消歧细节见 [HANDBOOK · 安装](./docs/HANDBOOK.md)。企业用户想直接用 FDE 方法论梳理工作流，看 [FDE/README.md](./FDE/README.md)（零依赖，不需要 Node.js；15 分钟最短路径见其「15 分钟最短路径」小节）。

## 使用

<p align="center"><img src="docs/assets/dashboard.png" alt="sofagent Dashboard 驾驶舱" width="100%" /><br/><sub>Dashboard 驾驶舱（单文件 HTML · 示例数据）：规则通过率、审计任务、违规趋势——AI 在干什么，一眼看清。<br>（界面演进见 CHANGELOG，实际以安装态为准）</sub></p>

> 📊 **Dashboard 有三个入口，各归各位**：
>
> | 入口 | 命令 | 形态 | 给谁看 |
> |---|---|---|---|
> | **终端版** | `sofagent dashboard --full`（旧 bin `sofagent-dashboard` 仍在兼容期可用） | 终端 ASCII 三栏（零前端依赖） | 开发者 / FDE 快速看 |
> | **Web 版** | `sofagent web`（install.sh 安装态可用）· 仓库态 `node tools/dashboard/serve-dashboard.mjs` | 浏览器可视化（localhost:3780） | 老板 / IT 可视化看 |
> | **macOS 双击** | 双击 `start-dashboard.command` | Web 版的 macOS 快捷方式（仅 macOS 双击入口） | macOS 用户 |
>
> ⚠️ **Dashboard 可得性边界**：三入口均**随 `install.sh` 安装态提供**；`npm i @sofagent/audit` 直装的包**不含 dashboard 静态资产**（`tools/dashboard/` 未随包分发）——npm 直装用户得到 CLI + MCP 能力面，**要 Dashboard 请走完整安装**（bootstrap.sh / install.sh）。

> 👁️ **Agent 视角**：装完 hook 后每次 commit 触发审计——PASS 输出简短回声后放行（自动快照），违规直接打进终端输出并按配置推送 Webhook / IM，Agent 侧无独立图形界面（详见 [PHILOSOPHY §二](./docs/PHILOSOPHY.md#系统暴露的能力agent-视角)）。

<p align="center"><img src="docs/assets/usage-path.svg" alt="使用路径：试用 → 团队 → 企业 → 自运转" width="85%" /></p>

| 入口 | 做什么 | 装在哪 | 花多久 |
|---|---|---|---|
| **`npx -y -p sofagent sofagent audit`** | 零配置审计最近一次 commit，秒级出结果（首次 npx 约 30 秒） | 任意 git 仓库（临时） | 30 秒 |
| **`--ruleset` 规则市场** | 加载安全等规则集，或自定义 JSON 规则 | 同上 | 1 分钟 |
| **GitHub Action** | 每次 PR 自动审计，违规标注在 diff 行上 | CI/CD | 配置一次 |
| **install.sh 全套** | 注入·审计·回溯·沉淀·进化五能力 + daemon 巡检 + dashboard——Agent 的完整约束层 | **企业设备**（跑 AI 节点的服务器/电脑） | FDE 驻场安装 |

> 📌 **单入口 CLI（v1.5.6 起）**——CLI 收敛为 **`sofagent <域> <动作>`**：`sofagent audit`（审计）· `sofagent train doctor`（训练）、`sofagent team formation`（阵型）· `sofagent daemon`（守护）… 全部域见 `sofagent help`。
>
> | 用法 | 命令 |
> |---|---|
> | 零安装试用 | `npx -y -p sofagent sofagent audit` |
> | 全局安装 | `npm i -g sofagent` → `sofagent audit` |
> | 完整安装（含 daemon / dashboard） | `bootstrap.sh` / `install.sh`（见上） |
>
> - **兼容期**：旧命令（`sofagent-audit` / `sofagent-daemon` / `sofagent-orchestrator` …）**仍可用**，会提示新入口——**一个 minor 版本后移除**。收敛前的 13 个 bin 现已由单入口统一承载。
> - ⚠️ **`npm i -g sofagent` 带来完整依赖树**（含 orchestrator/mcp/train 等能力包；实测 771 传递依赖，5 个含原生模块——新版 npm 不执行未审阅 install script，其编译**静默跳过**）。**只要审计 CLI** 用 `npx -y -p sofagent sofagent audit` 或 `npm i -g @sofagent/audit`。
> - **已下架的旧代理包**：npm 上的 `sofagent-audit`（裸名、无 scope）是旧代理包，**已于 2026-09-26 下架**——不要安装。

**规则市场**——社区规则集以 `sofagent-ruleset-*` npm 包发布、`--ruleset-path` 手动加载（plugin 类规则默认关闭，需显式 opt-in，见 SECURITY）：

```bash
npx -y -p sofagent sofagent audit --list-rulesets      # 看有哪些规则集
npx -y -p sofagent sofagent audit --ruleset security   # 加载安全规则集
```

**FDE 进场部署**——两条路径任选：

- **方法论路径**（零依赖）：读 [FDE/GUIDE.md](./FDE/GUIDE.md)，按手册手动梳理工作流，Excel + 人脑也能跑
- **工具路径**（Node.js ≥ 18）：FDE 在企业设备上跑 install.sh 装好约束层后，用自己的 AI 工具说"帮我做 FDE 诊断"，Agent 从进场开始引导

## 常见问题

- **能上生产吗？** 当前为单机单用户设计（多租户见 [ROADMAP](./docs/ROADMAP.md)；静态加密与边界见 [LIMITATIONS](./docs/LIMITATIONS.md)——企业部署前必读 [SECURITY](./SECURITY.md)）。
- **收集我的数据吗？** 缺省全量本地。可选联邦查询 = 你主动配置才出本机（见 SECURITY）。

## 生态与文档索引

**社交证明**：

[![GitHub stars](https://img.shields.io/github/stars/KongFangXun/sofagent?style=social)](https://star-history.com/#KongFangXun/sofagent&Date)

**Featured in**（社区收录 · 含收录申请中）：

[![Glama](https://img.shields.io/badge/Glama-indexed-4A90D9)](https://glama.ai/mcp/servers/KongFangXun/sofagent)
[![awesome-dsh-plugin](https://img.shields.io/badge/awesome--dsh--plugin-listed-brightgreen)](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
[![awesome-ai-agents (Jenqyang)](https://img.shields.io/badge/awesome--ai--agents-listed-brightgreen)](https://github.com/Jenqyang/Awesome-AI-Agents)
[![dsh-plugin-radar](https://img.shields.io/badge/dsh--plugin--radar-listed-brightgreen)](https://github.com/AdamPlatin123/dsh-plugin-radar/blob/main/PLUGINS.md)
[![awesome-deepseek-harness (0xsline)](https://img.shields.io/badge/awesome--deepseek--harness%20%280xsline%29-listed-brightgreen)](https://github.com/0xsline/awesome-deepseek-harness)
[![awesome-mcp-servers](https://img.shields.io/badge/awesome--mcp--servers-listed-brightgreen)](https://github.com/punkpeye/awesome-mcp-servers)
[![awesome-harness-engineering](https://img.shields.io/badge/awesome--harness--engineering-PR%20open-orange)](https://github.com/ai-boost/awesome-harness-engineering/pull/227)
[![awesome-ai-agents (e2b)](https://img.shields.io/badge/awesome--ai--agents%20%28e2b%29-PR%20open-orange)](https://github.com/e2b-dev/awesome-ai-agents/pull/1471)

**仓库内两大目录的语义归属**：

- `SKILL/`——给 Agent 读的行为约束文件系统（SKILL.md 主入口 / harness/ 约束层 / agents/ Sub Agent），新 Skill 放这里
- `FORGE/`——自迭代工具链（内部工具，外部用户可忽略），产物落 `~/.sofagent/data/forge-runs/`

**上游与插件入口**：DSH 上游 <https://github.com/deepseek-ai/deepseek-harness> · Cordis 运行时 <https://github.com/cordiverse/cordis> · 7 款 `cordis-plugin-sofagent*` 源码 [engine/dsh-plugins/](./engine/dsh-plugins/)

| 你想了解 | 看哪里 |
|---|---|
| **全部文档索引**（按意图选路） | [WIKI](./docs/WIKI.md) |
| 怎么装、怎么用、排查 | [HANDBOOK](./docs/HANDBOOK.md) |
| 架构设计与 28 条规则 | [ARCHITECTURE](./docs/ARCHITECTURE.md) |
| 每个版本做了什么 | [CHANGELOG](./CHANGELOG.md) |
| 安全声明 · 已知局限 | [SECURITY](./SECURITY.md) · [LIMITATIONS](./docs/LIMITATIONS.md) |

> 🧪 **工程可信度**（当前口径）：5842 测试 / 13 模块包 + 11 插件（7 DSH + 4 OpenClaw）· 28 条审计规则 · fresh-eyes 独立审查持续运行。
> **包数口径**（消歧）：workspace 27 = 13 模块包 + load-chain + dsh-plugin-kit + umbrella + 7 DSH 插件 + 4 OpenClaw 插件（见 [WIKI §六](./docs/WIKI.md#六当前状态)）；**测试计数口径** = 13 模块包（含 test script 的 workspace 共 25 个，插件包与工具包不计）——二者非同一集合。
> 测试数两个口径：**发版时点值**（各版本章节的 `4805→4903` 增量账）与**当前实测值**（上方「工程可信度」行）；权威值以 `tools/check/check-test-count.sh` 实跑为准，包数标准见 [WIKI](./docs/WIKI.md#六当前状态)；审查环境见 [review-system](./docs/guides/review-system.md)；
>性能数据为单机参考值。

---

<p align="center">
  欢迎提 Issue 和 PR，尤其较真的那种 · <a href="./CONTRIBUTING.md">贡献指南</a> · <a href="./docs/THANKS.md">致谢</a><br/>
  <sub>MIT License © <a href="https://github.com/KongFangXun/sofagent">孔放勋</a> · <a href="https://github.com/KongFangXun/sofagent">⭐ 如果 sofagent 帮到你，Star 一下让更多人看到</a></sub>
</p>
