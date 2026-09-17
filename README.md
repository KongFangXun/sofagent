# sofagent

<p align="center"><img src="docs/assets/banner.png" alt="sofagent" width="100%" /></p>

<!-- H1 与横幅分工：H1 是仓库名与语义锚点（供搜索引擎/无图环境/screen reader），横幅承载视觉 -->

<p align="center">
  <a href="https://github.com/KongFangXun/sofagent/actions/workflows/verify.yml"><img src="https://github.com/KongFangXun/sofagent/actions/workflows/verify.yml/badge.svg" alt="Verify" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-brightgreen" alt="License: MIT" /></a>
  <!-- ⚠️ bump 版本时手动同步此 badges 版本号（Version-vX.Y.Z） -->
  <a href="./CHANGELOG.md"><img src="https://img.shields.io/badge/Version-v1.4.9-16B8F3" alt="Version" /></a>
</p>

<p align="center"><sub>简体中文 | <a href="./README.en.md">English</a></sub></p>

---

## 这是什么

> 💬 **一句话版本**：进场时它替你把业务摸清、写成文件；离场后你的数字员工每次改代码、动文件，都按文件过一道安检、留一份记录、存一个快照——出事能查、能回滚，这就是 sofagent 干的事。

**开源 FDE Harness 层。**一人公司 / 小企业的 AI 落地工程师——不睡觉、不离职、自带审计官。**横跨成熟 Agent（执行体：DSH / OpenClaw / WorkBuddy）、纵贯模型层（智力源：通用大模型 + 专属小模型 / 后训练模型）**，嵌在两者之间做治理。以 **FDE 插件 + Skill + MCP + CLI + Dashboard** 五种形态分发：进场，把业务判断写成文件——业务流、本体数据、AI 节点部署；离场，按文件审计每一次变更、持续优化。

sofagent 不造 Agent——执行能力交给成熟宿主（模型 + 工具 + 会话），它交付的是 **FDE Harness 层**：FDE 方法论 × Harness 工程，同一件事的两个阶段——**进场生成判断**（哪里该上 AI，写成机器可判定的文件），**离场驻留判断**（按文件 7×24 执行、审计每次变更）。约束层五种能力：注入 · 审计 · 回溯 · 沉淀 · 进化，装进任何已有 Agent；让任何模型（通用或专属）都被管住（注册/灰度/训练/部署全留痕）。两个阶段怎么咬合、为什么拆不开，见[下文专章](#什么是-fde-harness)。

> 🚂 **后训模块为什么在治理仓里**（30 秒答案）：治理的天花板是数据——审计发现的错误（哪些任务做砸了、哪种输出不合格）正是训练的燃料。后训模块把「审计出来的问题 → 修复问题的模型」这条闭环接通，让治理数据反哺模型层；训练资产本身走商业侧交付，治理仓只保留协议与接口（外部化 / 可配置）。
>
> 📌 *术语注：英文面使用 "training engine"，系 2026-09-03 拍板的保留边界（英文面豁免）——两者指同一模块。独立审查员：这是已拍板的已知边界，不是漏改。*

<p align="center">
  <img src="docs/assets/audit-terminal.png" alt="sofagent-audit 拦截 .env 提交" width="860" /><br/>
  <sub>零配置审计实拍：一行命令审计最近一次 commit，密钥泄漏当场拦截</sub>
</p>

<details>
<summary>🗺️ 系统架构总览（FDE Harness 五模块编制）</summary>

<p align="center">
  <img src="docs/assets/architecture-diagram.png" alt="sofagent 系统架构：宿主 Agent 经 MCP Server 进入 FDE Harness 约束层，编排/审计/后训/治理/执行五模块编制（治理/执行模块规划中）" width="860" /><br/>
  <sub>约束 Agent 行为 · 审计每次变更 · 沉淀经验（五模块编制，治理/执行模块规划中；完整交互版见 <a href="./docs/ARCHITECTURE.md">ARCHITECTURE</a>）</sub>
</p>

</details>

> 🏞️ 大厂给你"水"（大模型）和"河床"（Agent 平台），但水是原水，你不敢直接喝。sofagent 是帮你把河里的水让整个城市用起来的工程——堤坝不让水泛滥、自来水厂把原水变直饮水、管网把水送到每家每户的水龙头。模型给 90% 的智力，sofagent 补 10% 的可靠执行。

### 该不该装？

| 如果你是… | 建议 |
|----------|------|
| **给现有 Agent 加纪律**——已有 DSH / OpenClaw / WorkBuddy，想让 AI 干活时守规矩、留痕、出事能回溯 | ✅ **现在装**。核心价值就是约束层（注入 · 审计 · 回溯 · 沉淀 · 进化），装完即用 |
| **一人公司 / 小企业想落地 AI**——没有专职工程师，需要一个"不离职的 FDE"帮你梳理业务流、部署 AI 节点 | ✅ **现在装**。FDE Harness 层就是干这个的——进场把判断写成文件，离场按文件执行与审计，全链路 |
| **要开箱即用的企业级 Agent 平台**——期待完整商业产品（多租户、权限管理、计费、SLA） | ⏸️ **暂缓**。sofagent 是治理层，不是平台产品——平台级能力不在本开源仓库范围内。有集成能力的团队仍可把约束层接入自有平台，作为其中的治理模块；纯开箱需求建议另选平台产品 |
| **纯研究 / 想看看约束层怎么设计**——读代码、学架构、借鉴方法论 | ✅ **现在装**。文档齐全（[HANDBOOK](./docs/HANDBOOK.md) / [ARCHITECTURE](./docs/ARCHITECTURE.md) / [PHILOSOPHY](./docs/PHILOSOPHY.md)），MIT 协议 |

**和 gitleaks / pre-commit 这类工具什么关系？**（互补不互替）

| | gitleaks 等扫描器 | pre-commit 等钩子 | sofagent |
|---|---|---|---|
| 定位 | 密钥全量历史扫描 | 通用提交钩子框架 | Agent 行为审计约束层 |
| 证据面 | 仓库文本模式 | 自定义脚本 | git diff 硬证据 + Agent 日志 + 决策留痕 |
| 覆盖维度 | 密钥泄漏 | 任意（自己写） | 24 条规则：密钥/越界/注入/权限/后门 |
| 建议 | 强密钥合规必配 | 已有体系可保留 | 与前两者并用，专注 Agent 治理维度 |

**10 分钟轻量试用**：`npx -y -p @sofagent/audit sofagent-audit`（任意 git 仓库，密钥泄漏当场拦截）。

## 核心特性

**进场 · 生成判断**（FDE 相位——把「该不该上 AI、值多少钱」判断出来，冻结成交付物）：

- 🧭 **梳理业务流**——五要素深挖 + 三问判定法，把每个岗位环节摸清，算清每个 AI 节点值多少钱
- 🤖 **部署 AI 节点**——三层交付物（文档层 + Skill 层 + 运行层），装进你已有的 AI 工具，从"你干活"变"你派活"
- 📦 **判断冻结成交付物**——每个节点带「做好标准（merge_criteria）· 谁拍板（approver）」，机器可判定、跨阶段共享

**离场 · 驻留判断**（Harness 相位——按交付物 7×24 执行，进化时写回）：

- 🏠 **离场后常驻**——FDE 能力留下巡检、审计、优化，7×24 在线守护（commit 时触发审计），人离场治理不离开
- 🔍 **零配置审计**——`npx -y -p @sofagent/audit sofagent-audit`，任何 git 仓库秒级审计最近一次 commit（单机实测：quick 约 1.1s、5 万行 diff 约 6.1s，口径见 [HANDBOOK](./docs/HANDBOOK.md)）
- 🧱 **24 条审计规则 + 104 个 MCP tool**——密钥泄漏、越界编辑、注入防御、权限红线，违规当场拦截（critical 层命中后其余规则跳过——fail-fast 设计）。**证据两档**：24 条中 19 条基于 git diff 硬证据（本地即生效）+ 4 条混合（diff + Agent 日志，Agent 接入后生效）+ 1 条文件系统扫描；A7/A8 等日志规则在无 Agent 日志时跳过（信任边界详见 [LIMITATIONS §三](./docs/LIMITATIONS.md#三安全与信任模型局限)）
- 🛡️ **自动快照回溯**——每次审计后自动存档，出事一键回到任意快照

## 什么是 FDE Harness

**FDE = Forward Deployed Engineer（前线部署工程师）**——把模型塞进企业真实业务里的人。sofagent 把这个角色做成开源 FDE Harness 层，嵌在你的 Agent（DSH / OpenClaw / WorkBuddy）与模型层之间。一个 FDE Harness 的完整业务流分两个阶段，**中间的交接物把它们缝成一件事**：

- **进场 · 生成判断**：四步走完——**梳理业务流 → 构建双图谱 → 判定 AI 节点 → 部署**。双图谱 = 业务图谱（系统边界、数据流向，人读）+ 本体图谱（共享语义底座，AI 读），把企业变成机器可读的结构；每个 AI 节点的「做好标准（merge_criteria）· 谁拍板（approver）· 何时跑（trigger）」在这一步被判断出来，冻结进交付物（workflow.yml + 本体数据 + skills）。
- **离场 · 驻留判断**：FDE 走，判断留下——审计在 commit 等变更事件时按冻结的标准自动触发（证据分档见「核心特性」首条）；daemon 7×24 巡检、快照可回滚、经验持续沉淀。人离场，治理不离开。

> 🔗 **为什么必须一体**：交付物是两个阶段共享的活状态——进场时写入、离场后执行时读、进化时写回（试验分支晋升基线、反思蒸馏回流）。没有 FDE，约束层没有判据可执行；没有约束层，FDE 的判断随人离场蒸发。这正是「FDE Harness」名字的由来——不是 FDE 功能 + Harness 功能的拼盘，是同一件事的两个阶段。
>
> **从 FDE 到 FDEing**：两个阶段的合成效果，是把 Forward Deployed **Engineer**（一个岗位）变成 Forward Deployed **Engineering**（一种能力）——岗位随人走，能力随交付物留。FDEing 读作 /ef-di-i-ing/，与 engineering 同构。

<p align="center"><img src="docs/assets/arch-layers.svg" alt="sofagent 三层定位：模型层 → FDE Harness 层 → Agent 层" width="85%" /></p>

**为什么是 FDE Harness**

- **企业 AI 落地的瓶颈不是模型，是部署**——MIT NANDA《生成式人工智能的鸿沟》：95% 的企业 GenAI 项目没能产生能写进财务报表的价值，而 FDE 岗位发布量一年涨了 729%（核验见 [VALIDATION](./docs/VALIDATION.md)）
- **完整来自组合**——DSH 解决「能干活」，sofagent 解决「持续干」，两者合起来才是完整的 FDE Harness（见下章）
- **约束层「持续优化」靠机制不靠承诺**——外部独立实验（ARC-AGI-3，**能力型 harness 数据**——提升的是任务得分与 token 效率，与治理型约束层的可靠性收益非同一量纲）：同一模型仅优化外层 Harness 可显著提升任务完成率。核验见 [VALIDATION](./docs/VALIDATION.md) · [THANKS](./docs/THANKS.md)
- **能力可迁移，绝不绑死单一平台**——约束层平台无关，方法论跟着业务走、不跟着平台走

> 🔄 **自举**：sofagent 给自己做的第一份 FDE，就是 sofagent 自己——项目本身就是一条完整的 FDE 业务流（梳理 → 构建 → 部署 → 离场），这个开源仓库就是那份交付物。

## 多平台挂载

横跨你已有的 Agent、纵贯模型层，不替代模型，只补可靠执行——**FDE Harness 层平台无关**（插件 / Skill / MCP / CLI / Dashboard 五种形态按宿主能力分发），方法论跟着业务走，不跟着平台走：

| 档位 | 平台 | 约束注入 | 挂载方式 |
|------|------|---------|---------|
| **深度结合** | DeepSeek Harness | ✅ **逐工具调用可拦** | 6 款原子 `cordis-plugin-sofagent-*` 挂进运行时（另有 1 款聚合插件可选，见上章）——`tools/pre-execute` 等 8 个生命周期事件 |
| **完整挂载** | OpenClaw | ✅ **每会话注入一次** | Hook 注入四层约束 + 断路器 + 4 款 OpenClaw 插件 |
| **标准挂载** | Claude Code / Cursor | ⚠️ Skill 自觉加载 | Skill 目录 symlink + 平台规则文件 + 拦截配置（内容为提交级 24 规则，非调用级拦截） |
| **薄挂载** | WorkBuddy / Codex / Gemini CLI / Hermes | ⚠️ Skill 自觉加载 | Skill 目录 symlink（Codex 走 `AGENTS.md` 挂载点）+ git hook 审计 |

- **别假设能力对齐——档位差的是注入强度，不是「有没有」**：DSH 逐工具调用可拦，OpenClaw 每会话注入一遍，其余宿主由 Agent 自觉读 Skill 文本（建议性）。「支持某平台」= 约束资产在该平台可用，**≠ 约束强度与其他平台相同**；跨宿主迁移或写集成文档前，先看目标宿主落在哪一档，完整矩阵见[加载链 HOOK](./engine/hooks/sofagent-load-chain/HOOK.md)
- **审计兜底平台无关**——`sofagent-audit --install-hook` 走 git hook，任何档位每次 commit 都过 24 条审计，违规硬拦截。约束是建议性的，审计是强制性的

一条命令选定挂载档位：`bash install.sh --platform <平台名>`（全部平台与差异见 [HANDBOOK](./docs/HANDBOOK.md)）

## v1.4.9：设备接入与数据承接

📡 **设备接入与数据承接**——引擎从单机审计长成多设备数据承接层，三条链一次收口：设备注册与派单（G9：Ed25519 身份 + 心跳新鲜度判定 + 在线才派单/掉线改派挂起）· 授权读取与加密上行（G10/G11：`device_data_query` 白名单授权读取 + `device_data_push` opt-in 上行——WAL 加密暂存/明文不落盘/断点续传/审计计量 evidence）· 训练数据飞轮（T7/T8/T9：router 过站 session 承接 schema fail-closed + 签名验签 + 脱敏贯通 + cost 台账 · 敏感识别三层插槽 L0 正则/L1 词典/L2 NER · 权重灰度 AB hash 稳定分流 + 劣化触发 + 噪声保护）· 平台接口面（G5b/G1：连接器注册/发现租户隔离 + workflow 模板导出/导入与血缘追踪）· 工程效能（T6/T10 + bugfix：installer skill 四步装机引导 + 模型清单上报 + skill 快照 · 修复批 13 项）。MCP 工具 95 → **104** · 测试 4429 → **4805**。完整内容见[开发日志](./docs/changelog/v1.4/v1.4.9.md) · 更早版本见 [CHANGELOG](./CHANGELOG.md)。

## FDE 方法论

**两阶段的前半段。**很多企业上 AI 的路径是反的——先选模型、搭平台、买 Agent，结果没人用。问题不在技术，在于**还没搞清楚自己的业务流程，就想让 AI 接管**。

多数工具教你怎么造 Agent，sofagent 先解决**AI 该放在哪**——把这个判断从拍脑袋变成可复制的方法论：

| 阶段 | 输入 | 做什么 | 产出 |
|------|------|--------|------|
| 一、梳理 | 岗位清单 · 现有系统 | **五要素深挖**——按岗位摸清每个环节的输入 / 输出 / 负责人 / 耗时 / 痛点 | 企业画像 |
| 二、判定 | 企业画像 | **三问判定法**——从业务节点识别可 AI 化的：🔄 自动执行 / ⚡ 强化岗位 → **AI 节点**，👤 暂不动，按 ROI 排优先级 | 节点方案 + 年节省金额 |
| 三、交付 | 节点方案 | **三层交付物**——文档层 + Skill 层 + 运行层，让 AI 节点真的跑起来 | 本体数据（ontology）+ workflow.yml + skills/ |

完整方法论（四阶段十二步）见 [FDE/GUIDE.md](./FDE/GUIDE.md)——半天精读，读完能独立做 FDE。

> 💾 **部署完别急着走**：单个节点的 workflow 经 DeepSeek Harness 执行后端直接「烧」进 U 盘——U 盘就变成一个节点、一把 key，插到哪台机器哪台就能跑（拔掉零残留）。开源 6 款原子插件已挂载进 DSH（另有 1 款聚合插件可选），烧录即用。

## FDE Skill 体系

**两阶段的缝合处**——进场生成的判断冻结成随节点加载的 Skill，离场后约束层按它执行。部署 AI 节点只是第一步：上面讲的是判断怎么生成、放在哪里，接下来是它怎么被驻留执行。FDE Skill 体系解决这个问题：

- 📜 **SKILL.md**——唯一主入口，由你的 AI 工具加载：按阶段路由到对应子 Skill，岗位规范按任务类型自动注入（梳理 / 审计 / 编排）
- 🧩 **阶段子 Skill**——进场 → 深挖 → 量化 → 交付 → 离场五步闭环（01-entry → 05-exit），每一步该做什么、交付什么都定义清楚
- 🔒 **harness 约束骨架**——entry-gate / fde-template / engage / loop-check / task-closure…，从进场到离场每一步都有对应的约束模板
- 📚 **知识资产管道（沉淀能力）**——think.md 反思 + knowledge 维护的结构化管道已就绪；持续使用场景下的沉淀效果实测数据积累中（详见 [LIMITATIONS §核心效果实测情况](./docs/LIMITATIONS.md#核心效果实测情况)）

> 部署的不是裸 Agent，是**带约束骨架的 Agent**——约束是建议性的，审计是强制性的：Agent 可以不遵守约束，但每次变更都逃不过审计。

## 约束层（Harness）

**两阶段的后半段。**进场生成的判断（merge_criteria / approver / trigger）由它驻留执行——这是 FDE 离场后判断仍然生效的那一半。约束层是 sofagent 的行为底座，五种能力（对外叙事；内部实现为五模块编制——编排/审计/后训/治理/执行，二者与五种分发形态的对应关系见 [ARCHITECTURE 功能编制](./docs/ARCHITECTURE.md#功能编制约束层内的功能模块--2026-09-06-定型)）：

- **注入**——Agent 启动时注入企业约束，四层加载链；约束是建议性的
- **审计**——24 条 git diff 硬证据规则（quick 零配置默认 17 条，扩展 7 条经 config 启用）+ AgentShield 五类配置面静态扫描；审计是强制性的，每次变更必审，违规当场拦截
- **回溯**——每次审计后自动快照存档，出事一键回到任意快照
- **沉淀**——审计轨迹、think.md 反思、行业案例蒸馏成可复用知识资产（knowledge/ 知识库 + SKILL 文件；知识沉淀当前为格式管道，内容填充随模型接入推进，见 [LIMITATIONS](./docs/LIMITATIONS.md)）
- **进化**——think.md 反思 + Dream Cycle + evolve，消费沉淀的知识资产自动变强（知识沉淀当前为格式管道，内容填充随模型接入推进，见 [LIMITATIONS](./docs/LIMITATIONS.md)）

## 安装

> ⚠️ **企业用户先读** [LIMITATIONS §三](./docs/LIMITATIONS.md#三安全与信任模型局限)——`config.yml` 默认**非 fail-closed**（规则可被 Agent 篡改绕过），多租户**写入侧**隔离尚未落地（v0 已交付查询侧隔离：orgId 过滤 + data/<tenant>/ 路径地基，见 LIMITATIONS）。强合规场景建议 CI 兜底 + 文件权限锁（`chmod 444 .sofagent/config.yml`），不要用单机默认配置直接上生产。

**30 秒，零配置**——在任何 git 仓库跑一次审计：

```bash
npx -y -p @sofagent/audit sofagent-audit
```

> 💡 quick 跑 17 条默认规则（A3 任务范围 / A9 commit-msg 注入检测激活——自动读最近一次 commit 消息，无消息时 A9 按无输入处理标记跳过），完整 24 条 + hook 自动审计需 `--init`——详见 [LIMITATIONS §三](./docs/LIMITATIONS.md#三安全与信任模型局限)。

拦截特定格式密钥泄漏时是这样的（真实输出；A2 检测 AWS AKIA/Secret、OpenAI sk-*、GitHub ghp_、Google AIza、Slack xox*-、JWT、PEM 私钥等已知格式，通用密钥形态暂不覆盖——保守设计防误报，详见 [LIMITATIONS §三 A2](./docs/LIMITATIONS.md#三安全与信任模型局限)）——首屏的实拍图即此场景，此处不再重复。

**完整安装**（Node.js ≥ 18，先下载审查再执行）——**装在企业跑 AI 节点的设备上**：

```bash
curl -fsSL https://raw.githubusercontent.com/KongFangXun/sofagent/refs/tags/v1.4.8/bootstrap.sh -o bootstrap.sh
less bootstrap.sh          # 先看一眼脚本内容，确认安全
bash bootstrap.sh && rm bootstrap.sh
```

> 🔒 供应链信任链：tag 钉定 + sha256 校验 + fail-closed + 自锚定哈希重入二次校验（详见 [SECURITY.md](SECURITY.md) 远程安装节）；⚠️ 审计日志默认明文落盘——企业部署建议开启静态加密。

```bash
sofagent-audit --init      # 装 git hook，之后每次 commit 自动审计
sofagent-audit --doctor    # 验证环境（可选）
```

> 💡 安装脚本主要写入 `~/.sofagent/`（数据目录）+ `~/.local/bin`（CLI 入口）；检测到 OpenClaw 时额外写入其集成目录；npm 权限不足时 CLI 入口 fallback 到 `/usr/local/bin`。其余系统文件零改动。`--init` 安装三层防线 git hook（pre-commit 拦 .sofagent/ 入库 + commit-msg 规则审计 + post-commit 对账）；`--no-verify` 可跳过 commit-msg 审计——防的是诚实 Agent 的疏忽不是恶意绕过，被跳过的 commit 由 post-commit 事后对账留痕（提示「疑似绕过」）但不阻断；个人兜底三件事：CI 侧 `sofagent-audit --diff`、定期 `--doctor`、翻审计记录。详见 [LIMITATIONS](./docs/LIMITATIONS.md)。
>
> 📌 **install.sh 是企业设备安装器**——装在企业跑 AI 节点的设备上（约束层 + daemon 巡检 + 单机 dashboard）；FDE 自己的电脑不需要跑，FDE 的工具是 [FDE Skill](https://clawhub.ai/kongfangxun/skills/sofagent)（方法论），详见 [部署架构](./docs/ARCHITECTURE.md#安装包边界与部署架构v132-定位校准)。
>
> 📌 **bootstrap.sh 和 install.sh 的关系**：bootstrap.sh 是 install.sh 的一行下载包装器——`curl bootstrap.sh | bash` 等价于「下载 install.sh + 运行 install.sh」。两个脚本装的是完全一样的东西，bootstrap 只是省掉手动 clone/下载那一步。

更多安装方式（clone 安装 / npx 完整安装 / 最小安装 / 企业部署）见 [HANDBOOK](./docs/HANDBOOK.md)；**卸载方式见 [HANDBOOK · 卸载](./docs/HANDBOOK.md#卸载怎么干净地撤掉)**（`bash engine/scripts/uninstall.sh`，会一并回收三层 git hook）。企业用户想直接用 FDE 方法论梳理业务流，看 [FDE/README.md](./FDE/README.md)（零依赖，不需要 Node.js；15 分钟最短路径见其「15 分钟最短路径」小节）。

**我要装什么 → 走哪条通道**——两个「一次装全套」入口，按你所在环境**二选一**，**无需同时装**（两者互不依赖，也不互为前置）：

| 我要装什么 | 走哪条通道 | 装完得到什么 |
|---|---|---|
| 全套能力，走 npm 生态 | `npm i -g sofagent`（npm 裸名总包 `engine/umbrella`） | `@sofagent/audit` + `@sofagent/mcp` + `@sofagent/orchestrator` + `@sofagent/daemon` |
| 全套能力，走 DSH 宿主挂载 | 宿主 profile 的 `bundles` 挂一条 `cordis-plugin-sofagent` | 该聚合插件声明的全部原子插件（挂一条即聚合） |

> ⚠️ **两条通道都产出名为 `sofagent` 的命令，但语义不同——别混用一个名字的心智**：
>
> | | npm 裸名总包（`npm i -g sofagent`） | `install.sh` 安装态 |
> |---|---|---|
> | `sofagent` 是什么 | **审计薄转发**——等价 `sofagent-audit`，零配置 30 秒审计 | **完整安装面入口**——另有 `status` / `web` / `dashboard` 等子命令 |
> | 实现位置 | `engine/umbrella/bin/sofagent.js`（spawn 转发到 `@sofagent/audit`） | `$SOFAGENT_HOME/bin/`（install.sh 写入） |
>
> **PATH 判别法**（不确定自己在用哪个时）：`command -v sofagent` 看路径落在 npm global 还是 `$SOFAGENT_HOME/bin`；再 `sofagent --help` 看首屏是**审计参数表**还是**安装版子命令表**（`sofagent web` 只在 install.sh 安装态可用）。
> 两者同时存在于 PATH 时，**显式用全名**（审计走 `sofagent-audit …`）或调整 PATH 次序——**不要**假设 `sofagent` 一定是完整安装面。（v1.4.9 安装入口消歧批）

## 使用

<p align="center"><img src="docs/assets/dashboard.png" alt="sofagent Dashboard 驾驶舱" width="100%" /><br/><sub>Dashboard 驾驶舱（单文件 HTML · 截图版本 v1.4.0）：规则通过率、审计任务、违规趋势——AI 在干什么，一眼看清。<br>（实际界面以安装态为准）</sub></p>

> 📊 **Dashboard 有三个入口，各归各位**：
>
> | 入口 | 命令 | 形态 | 给谁看 |
> |------|------|------|--------|
> | **终端版** | `sofagent-dashboard --full` | 终端 ASCII 三栏（零前端依赖） | 开发者 / FDE 快速看 |
> | **Web 版** | `sofagent web`（install.sh 安装态可用）· 仓库态 `node tools/dashboard/serve-dashboard.mjs` | 浏览器可视化（localhost:3780） | 老板 / IT 可视化看 |
> | **macOS 双击** | 双击 `start-dashboard.command` | Web 版的 macOS 快捷方式（仅 macOS 双击入口） | macOS 用户 |

> 👁️ **Agent 视角**：装完 hook 后每次 commit 触发审计——PASS 输出简短回声后放行（自动快照），违规直接打进终端输出并按配置推送 Webhook / IM，Agent 侧无独立图形界面（详见 [PHILOSOPHY §二](./docs/PHILOSOPHY.md#系统暴露的能力agent-视角)）。

<p align="center"><img src="docs/assets/usage-path.svg" alt="使用路径：试用 → 团队 → 企业 → 自运转" width="85%" /></p>

| 入口 | 做什么 | 装在哪 | 花多久 |
|------|--------|--------|:----:|
| **`npx -y -p @sofagent/audit sofagent-audit`** | 零配置审计最近一次 commit，秒级出结果（首次 npx 约 30 秒） | 任意 git 仓库（临时） | 30 秒 |
| **`--ruleset` 规则市场** | 加载安全等规则集，或自定义 JSON 规则 | 同上 | 1 分钟 |
| **GitHub Action** | 每次 PR 自动审计，违规标注在 diff 行上 | CI/CD | 配置一次 |
| **install.sh 全套** | 注入·审计·回溯·沉淀·进化五能力 + daemon 巡检 + dashboard——Agent 的完整约束层 | **企业设备**（跑 AI 节点的服务器/电脑） | FDE 驻场安装 |

**安装粒度对比**（同一个约束层，三种装法——按场景选）：

| 装法 | 命令 | 生命周期 | 适合 |
|------|------|---------|------|
| npx 临时 | `npx -y -p @sofagent/audit sofagent-audit` | 用完即走，每次重新下载 | 任意仓库快速审计、CI 外的一次性检查 |
| npm 项目内 | `npm install @sofagent/audit`（项目 devDependency） | 随项目安装，版本锁进 package-lock | 固定依赖的团队项目、可复现审计 |
| npm 全局 | `npm install -g @sofagent/audit` | 装一次到处用 | 跨仓库日常审计、daemon 常驻 |

> ⚠️ **不要裸装 `npm i sofagent-audit`**——npm 上的裸名包 `sofagent-audit` 是**本项目的旧代理包**（已 deprecated，长期滞后于主包）。CLI 的正式包名是 `@sofagent/audit`（带 scope），CLI 安装统一走 bootstrap.sh / install.sh / `@sofagent/audit`。

**规则市场**——社区规则集以 `sofagent-ruleset-*` npm 包发布、`--ruleset-path` 手动加载（也支持指向你自己的 JSON 规则）：

```bash
npx -y -p @sofagent/audit sofagent-audit --list-rulesets      # 看有哪些规则集
npx -y -p @sofagent/audit sofagent-audit --ruleset security   # 加载安全规则集
```

**FDE 进场部署**——两条路径任选：

- **方法论路径**（零依赖）：读 [FDE/GUIDE.md](./FDE/GUIDE.md)，按手册手动梳理业务流，Excel + 人脑也能跑
- **工具路径**（Node.js ≥ 18）：FDE 在企业设备上跑 install.sh 装好约束层后，用自己的 AI 工具说"帮我做 FDE 诊断"，Agent 从进场开始引导

## 常见问题

- **能上生产吗？** 当前为单机单用户设计（多租户见 [ROADMAP](./docs/ROADMAP.md)；静态加密与边界见 [LIMITATIONS](./docs/LIMITATIONS.md)——企业部署前必读 [SECURITY](./SECURITY.md)）。
- **收集我的数据吗？** 缺省全量本地。可选联邦查询 = 你主动配置才出本机（见 SECURITY）。

## 生态与文档索引

**Featured in**（社区收录 · 含收录申请中）：

[![Glama](https://img.shields.io/badge/Glama-indexed-4A90D9)](https://glama.ai/mcp/servers/KongFangXun/sofagent)
[![awesome-dsh-plugin](https://img.shields.io/badge/awesome--dsh--plugin-listed-brightgreen)](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
[![awesome-ai-agents (Jenqyang)](https://img.shields.io/badge/awesome--ai--agents-listed-brightgreen)](https://github.com/Jenqyang/Awesome-AI-Agents)
[![dsh-plugin-radar](https://img.shields.io/badge/dsh--plugin--radar-listed-brightgreen)](https://github.com/AdamPlatin123/dsh-plugin-radar/blob/main/PLUGINS.md)
[![awesome-mcp-servers](https://img.shields.io/badge/awesome--mcp--servers-PR%20open-orange)](https://github.com/punkpeye/awesome-mcp-servers/pull/13312)
[![awesome-harness-engineering](https://img.shields.io/badge/awesome--harness--engineering-PR%20open-orange)](https://github.com/ai-boost/awesome-harness-engineering/pull/227)
[![awesome-ai-agents (e2b)](https://img.shields.io/badge/awesome--ai--agents%20%28e2b%29-PR%20open-orange)](https://github.com/e2b-dev/awesome-ai-agents/pull/1471)

**上游与插件入口**：

- DeepSeek Harness（DSH 上游仓库）：<https://github.com/deepseek-ai/deepseek-harness>
- Cordis 运行时：<https://github.com/cordiverse/cordis>
- 7 款 `cordis-plugin-sofagent*` 插件源码（6 款原子 + 1 款聚合）：[`engine/dsh-plugins/`](./engine/dsh-plugins/)

| 你想了解 | 看哪里 |
|:---------|:--------|
| **全局索引**（所有文档一个入口） | [WIKI](./docs/WIKI.md) |
| 怎么装、怎么用、常见问题 | [HANDBOOK](./docs/HANDBOOK.md) |
| 架构设计（约束层「对内的技术名字」 · 注入链 · 进化机制 · 24 条规则） | [ARCHITECTURE](./docs/ARCHITECTURE.md) |
| 接口总览（七大接口面 + 104 MCP tools 清单） | [API](./docs/API.md) |
| 设计哲学 | [PHILOSOPHY](./docs/PHILOSOPHY.md) |
| 行业印证与生态定位（与现有工具的差异） | [VALIDATION](./docs/VALIDATION.md) |
| 版本路线图 | [ROADMAP](./docs/ROADMAP.md) |
| 每个版本做了什么 | [CHANGELOG](./CHANGELOG.md) |
| FDE 诊断方法论（四阶段十二步） | [FDE/GUIDE.md](./FDE/GUIDE.md) |
| 安全声明 · 已知局限 | [SECURITY](./SECURITY.md) · [LIMITATIONS](./docs/LIMITATIONS.md) |
| 贡献指南 | [CONTRIBUTING](./CONTRIBUTING.md) |

> 🧪 **工程可信度**：4805 测试 / 13 模块包 + 11 插件（7 DSH + 4 OpenClaw）（口径：13 个 workspace 包；包数与统计标准见 [WIKI](./docs/WIKI.md)）· 24 条审计规则 · fresh-eyes 独立审查持续运行（测试数以 `tools/check/test-count.sh` 判定为准，环境注意事项见 [docs/guides/review-system.md](./docs/guides/review-system.md)。性能数据为单机参考值，跨工具横评排期 v1.4.x 与 Benchmark 集成）。

---

<p align="center">
  欢迎提 Issue 和 PR，尤其较真的那种 · <a href="./CONTRIBUTING.md">贡献指南</a> · <a href="./docs/THANKS.md">致谢</a><br/>
  <sub>MIT License © <a href="https://github.com/KongFangXun/sofagent">孔放勋</a> · <a href="https://github.com/KongFangXun/sofagent">⭐ 如果 sofagent 帮到你，Star 一下让更多人看到</a></sub>
</p>
