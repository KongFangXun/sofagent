<p align="center">
  <img src="docs/assets/banner.png" alt="sofagent" width="100%" />
</p>

<p align="center">
  <a href="https://github.com/KongFangXun/sofagent/actions/workflows/verify.yml"><img src="https://github.com/KongFangXun/sofagent/actions/workflows/verify.yml/badge.svg" alt="Verify" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-brightgreen" alt="License: MIT" /></a>
  <a href="./CHANGELOG.md"><img src="https://img.shields.io/badge/Version-v1.3.7-16B8F3" alt="Version" /></a>
</p>

<p align="center">
  <a href="README.en.md">English</a> · <a href="#这是什么">这是什么</a> · <a href="#快速开始">快速开始</a> · <a href="#fde-方法论">FDE 方法论</a> · <a href="#三个入口从-30-秒到全套部署">三个入口</a> · <a href="#为什么选-sofagent">为什么选</a> · <a href="#文档">文档</a> · <a href="https://github.com/KongFangXun/sofagent">⭐ Star</a>
</p>


---

## 这是什么

**sofagent 是一个开源 FDE Agent**（MIT）——进场帮你梳理业务工作流，把能自动化的环节变成 AI 节点；交付完成后 FDE 离场，AI 节点继续 7×24 自动执行任务，每次干活受审计、越界能拦截、出事能回滚。它以 [FDE Skill](https://clawhub.ai/kongfangxun/skills/sofagent) 形态在 ClawHub 分发（帮 SMB · OPC 的每个人成为自己业务的 FDE 的方法论 Skill），装到企业设备后以**约束层引擎**长期运行（注入·审计·回溯·进化四种能力，daemon 为其常驻载体）。

> 📊 **为什么是现在**：MIT NANDA 实验室《生成式人工智能的鸿沟》报告指出，全球企业过去三年在生成式 AI 上烧了三四百亿美元，**95% 的项目没能产生能写进财务报表的价值**；与此同时，一个叫「前线部署工程师」（Forward Deployed Engineer，FDE）的岗位发布量一年涨了 **729%**（Indeed 2025 数据）。模型不稀缺了，能把模型塞进客户真实业务里的人，才稀缺——sofagent 就是把这件事工程化的开源底座。（数据核验与多机构口径对照见 [VALIDATION §一·治理缺口的代价](./docs/VALIDATION.md#治理缺口的代价三项联网核验证据)，FDE 经济账见 [VALIDATION §四](./docs/VALIDATION.md#四市场印证行业判断被市场买单)。）

```mermaid
graph LR
    A["① 进场梳理<br/>对话引导梳理工作流<br/>哪些自动化·哪些人工·哪些不动"] --> B["② 部署 AI 节点<br/>把自动化环节变成 SubAgent<br/>用你已有的 AI 工具，不用学新界面"]
    B --> C["③ 离场后自运转<br/>FDE 走了，sofagent 留下 7×24<br/>每次干活受检查·越界能拦·出事能回滚"]
    C -.->|经验沉淀·持续优化| C
```

> 💾 **部署完别急着走**：单个节点的 workflow（Agent 的能力）用 LangGraph 定义好后，经 DSH（DeepSeek Harness 执行后端）直接「烧」进 U 盘——U 盘就变成一个节点、一把 key，插到哪台机器哪台就能跑（拔掉零残留）。详见 [HANDBOOK · USB 一键烧录](./docs/HANDBOOK.md#近期版本新功能速览)。

> 🏞️ 大厂给你"水"（大模型）和"河床"（Agent 平台），但水是原水，你不敢直接喝。sofagent 是帮你把河里的水让整个城市用起来的工程——堤坝不让水泛滥、自来水厂把原水变直饮水、管网把水送到每家每户的水龙头。模型给 90% 的智力，sofagent 补 10% 的可靠执行。

### 和裸 Agent 有什么不同

| 维度 | 裸 Agent（ChatGPT / Copilot） | sofagent |
|:-----|:------|:------|
| 变更审计 | 无（需自行配 pre-commit + gitleaks） | git diff 24 条规则，硬证据判定 |
| 越界拦截 | 需自行拼装 hooks | 违规当场阻断 + 审计留证 |
| 出事回滚 | 手动翻 commit | 一键快照回到任意节点 |
| 经验积累 | 每次从零开始 | 自动沉淀进知识库（think.md + Dream Cycle + skillopt，v1.3.x 持续增强） |

## 核心特性

**FDE 交付（进场 → 部署 → 离场 → 自运转）**

- 🧭 **进场梳理工作流**——五要素深挖 + 三问判定法，把每个岗位环节摸清，算清每个 AI 节点值多少钱
- 🤖 **部署 AI 节点**——三层交付物（文档层 + Skill 层 + 运行层），装进你已有的 AI 工具，从"你干活"变"你派活"
- 🏠 **离场后常驻**——FDE Agent 留下巡检、审计、优化，7×24 在线，人离场治理不离开

**治理保障**

- 🔍 **零配置审计**——`npx -y -p @sofagent/audit sofagent-audit`，任何 git 仓库秒级审计最近一次 commit（实测 quick 单次约 1.1s、5 万行 diff 约 6.1s，M 系列 Mac；首次 npx 下载约 30 秒）
- 🧱 **24 条审计规则**（17 默认启用 + 7 扩展可选）——密钥泄漏、越界编辑、注入防御、权限红线，git diff 硬证据判定，违规当场拦截
- 🛡️ **自动快照回溯**——每次审计后自动存档，出事一键回到任意快照

## 快速开始

**30 秒，零配置**——在任何 git 仓库跑一次审计（开发/测试场景；强合规场景见 [SECURITY](./SECURITY.md)）：

```bash
npx -y -p @sofagent/audit sofagent-audit
```

> 💡 `sofagent-audit` 是 quick 只读审计（审计最近一次 commit，默认安全无副作用）；`sofagent-audit-full` 是完整审计，需显式指定操作（如 `--diff <range>` / `--init` 等）。
>
> ⚠️ **quick 模式范围**：quick 是零配置快速审计，跑 **17 条默认规则**（A3 任务越界 / A9 commit msg 注入无输入跳过，需日志的规则走降级判定；**7 条扩展规则默认不加载**——完整 24 条 = 17 默认 + 7 扩展）。完整防护（commit msg 注入拦截 + 越界检查 + hook 自动审计）需 `--init` 安装 git hook 走完整引擎。详见 [LIMITATIONS §三](./docs/LIMITATIONS.md#三安全与信任模型局限)。

拦截特定格式密钥泄漏时是这样的（真实输出）：

> ℹ️ A2 检测 AWS AKIA、OpenAI sk-*、GitHub ghp_、PEM 私钥等已知格式；通用密钥形态（password=、secret 裸值）暂不覆盖——保守设计防误报。详见 [LIMITATIONS §三 A2](./docs/LIMITATIONS.md#三安全与信任模型局限)。

<p align="center">
  <img src="docs/assets/audit-terminal.png" alt="sofagent-audit 拦截 .env 提交" width="860" />
</p>

**完整安装**（Node.js ≥ 18，先下载审查再执行）——**装在企业跑 AI 节点的设备上**：

```bash
curl -fsSL https://raw.githubusercontent.com/KongFangXun/sofagent/refs/tags/v1.3.7/bootstrap.sh -o bootstrap.sh
less bootstrap.sh          # 先看一眼脚本内容，确认安全
bash bootstrap.sh && rm bootstrap.sh
sofagent-audit --init      # 装 git hook，之后每次 commit 自动审计
sofagent-audit --doctor    # 验证环境（可选）
```

> 💡 所有安装脚本只写入 `~/.sofagent/`，不修改系统文件。`--no-verify` 可绕过本地 hook——sofagent 防的是诚实 Agent 的疏忽，不是恶意绕过；高安全场景请在 CI 侧加 `sofagent-audit --diff` 兜底。详见 [LIMITATIONS](./docs/LIMITATIONS.md)。
>
> 📌 **install.sh 是企业设备安装器**——装在跑 AI 节点的服务器/电脑上，给 Agent 当约束层引擎（注入·审计·回溯·进化四能力 + daemon 常驻巡检 + 单机 dashboard）。FDE 自己的电脑不需要跑 install.sh，FDE 的工具是 [FDE Skill](https://clawhub.ai/kongfangxun/skills/sofagent)（方法论）。详见 [部署架构](./docs/ARCHITECTURE.md#安装包边界与部署架构v132-定位校准)。
>
> 📌 **bootstrap.sh 和 install.sh 的关系**：bootstrap.sh 是 install.sh 的一行下载包装器——`curl bootstrap.sh | bash` 等价于"下载 install.sh + 运行 install.sh"。两个脚本装的东西完全一样，bootstrap 只是省去手动 clone/下载的步骤。

更多安装方式（clone 安装 / npx 完整安装 / 最小安装 / 企业部署）见 [HANDBOOK](./docs/HANDBOOK.md)。企业用户想直接用 FDE 方法论梳理工作流，看 [FDE/README.md](./FDE/README.md)（零依赖，不需要 Node.js；15 分钟最短路径见其「15 分钟最短路径」小节）。

## FDE 方法论

很多企业上 AI 的路径是反的——先选模型、搭平台、买 Agent，结果没人用。问题不在技术，在于**还没搞清楚自己的业务流程，就想让 AI 接管**。

多数工具教你怎么造 Agent，sofagent 先解决**AI 该放在哪**——五要素深挖和三问判定法，把这个判断从拍脑袋变成可复制的方法论：

| 阶段 | 做什么 | 产出 |
|------|--------|------|
| ① 梳理 | **五要素深挖**——按岗位把每个环节的输入 / 输出 / 负责人 / 耗时 / 痛点摸清 | 企业画像 |
| ② 判定 | **三问判定法**——哪些环节适合上 AI：🔄 自动执行 · ⚡ 强化岗位 · 👤 暂不动，按 ROI 排优先级 | 节点方案 + 年节省金额 |
| ③ 交付 | **三层交付物**——文档层 + Skill 层 + 运行层，让 AI 节点真的跑起来 | 本体结构（ontology）+ workflow.yml + skills/ |

完整方法论（四阶段十二步）见 [FDE/GUIDE.md](./FDE/GUIDE.md)——半天精读，读完能独立做 FDE。

## FDE Skill 体系

部署 AI 节点只是第一步——上面讲的是**怎么梳理、放哪里**，接下来是**怎么让它每次都守规矩**。随节点一起加载的 FDE Skill 体系解决这个问题：

- 📜 **SKILL.md**——唯一主入口，由你的 AI 工具加载：按阶段路由到对应子 Skill，岗位规范按任务类型自动注入（梳理 / 审计 / 编排）
- 🧩 **阶段子 Skill**——进场 → 深挖 → 量化 → 交付 → 离场五步闭环（`01-entry` → `05-exit`），每一步该做什么、交付什么都定义清楚
- 🔒 **harness 约束骨架**——entry-gate / fde-template / engage / loop-check / task-closure…，从进场到离场每一步都有对应的约束模板
- 🧬 **经验自动沉淀**——think.md 反思 + knowledge 维护，每次任务的经验教训自动进知识库

> 部署的不是裸 Agent，是**带约束骨架的 Agent**——约束是建议性的，审计是强制性的：Agent 可以不遵守约束，但每次变更都逃不过审计。

## 产品一瞥

<p align="center">
  <img src="docs/assets/dashboard.png" alt="sofagent Dashboard 驾驶舱" width="100%" />
</p>

<p align="center"><sub>Dashboard 驾驶舱：规则通过率、审计任务、违规趋势——AI 在干什么，一眼看清。</sub></p>

> 📊 **Dashboard 有三个入口，各归各位**：
>
> | 入口 | 命令 | 形态 | 给谁看 |
> |------|------|------|--------|
> | **终端版** | `sofagent-dashboard --full` | 终端 ASCII 三栏（零前端依赖） | 开发者 / FDE 快速看 |
> | **Web 版** | `node tools/serve-dashboard.mjs` | 浏览器可视化（localhost:3780） | 老板 / IT 可视化看 |
> | **macOS 双击** | 双击 `start-dashboard.command` | Web 版的 macOS 快捷方式（仅 macOS 双击入口） | macOS 用户 |
>
> ⚠️ **Dashboard 是已用用户的运维面板，不是首次体验入口。** 数据源是 `~/.sofagent/data/` 下的审计记录——没跑过 `sofagent-audit` 就没数据（Web 版降级显示示例数据）。第一次用？先在你的项目里跑 `npx -y -p @sofagent/audit sofagent-audit`，跑完 Dashboard 才有真实数据。

## 三个入口，从 30 秒到全套部署

不用一开始就做全套决定——从 30 秒体验开始，觉得有用再深入：

```mermaid
graph LR
    A["① 试用<br/>npx -y -p @sofagent/audit sofagent-audit<br/>30 秒零配置审计·任意 git 仓库"] --> B["② 团队<br/>规则市场 + GitHub Action<br/>PR 自动审计·CI/CD"]
    B --> C["③ 企业<br/>install.sh 全套<br/>装在企业设备·7×24 监控"]
    C -.->|FDE 离场后| D["④ 自运转<br/>Agent 干活·sofagent 盯着<br/>审计·回滚·巡检"]
```

| 入口 | 做什么 | 装在哪 | 花多久 |
|------|--------|--------|:----:|
| **`npx -y -p @sofagent/audit sofagent-audit`** | 零配置审计最近一次 commit，秒级出结果（首次 npx 约 30 秒） | 任意 git 仓库（临时） | 30 秒 |
| **`--ruleset` 规则市场** | 加载安全等规则集，或自定义 JSON 规则 | 同上 | 1 分钟 |
| **GitHub Action** | 每次 PR 自动审计，违规标注在 diff 行上 | CI/CD | 配置一次 |
| **install.sh 全套** | 注入·审计·回溯·进化四能力 + daemon 巡检 + dashboard——Agent 的完整约束层 | **企业设备**（跑 AI 节点的服务器/电脑） | FDE 驻场安装 |

sofagent 支持加载可组合的规则集（**规则市场**）——内置安全规则集，也支持社区发布的规则集包。内置 24 条审计规则（quick 默认跑 17 条，扩展 7 条经 config 启用），加载额外规则集可以扩展审计覆盖面：

**规则市场**：

```bash
npx -y -p @sofagent/audit sofagent-audit --list-rulesets      # 看有哪些规则集
npx -y -p @sofagent/audit sofagent-audit --ruleset security   # 加载安全规则集
```

社区规则集以 `sofagent-ruleset-*` npm 包发布，通过 `--ruleset-path` 手动加载（当前不支持 npm 包自动发现）；也支持 `--ruleset-path` 指向你自己的 JSON 规则。

**FDE 进场部署**——两条路径任选：

- **方法论路径**（零依赖）：读 [FDE/GUIDE.md](./FDE/GUIDE.md)，按手册手动梳理工作流，Excel + 人脑也能跑
- **工具路径**（Node.js ≥ 18）：FDE 在企业设备上跑 install.sh 装好约束层后，用自己的 AI 工具说"帮我做 FDE 诊断"，Agent 从进场开始引导

## v1.3.7 新能力

> 🏰 **v1.3.7 新能力**（SubAgent 完整沙箱 + 场景驱动权限 + AgentShield + 行业 overlay + 断路器 + ontology 生命周期）：
> - **SubAgent 完整沙箱**：🏰 虚拟文件系统（写入先进虚拟层，审批后原子落盘 + 证据流 HMAC 链）/ 网络出站白名单（DNS 隧道 + raw socket 全拦，域名后缀 + CIDR）/ 工具调用中介（Symbol 唯一 ID 判定，未注册 fail-closed）/ 虚拟 key（vk- 前缀 + scope 数据流契约 + token bucket 限速 + 日志脱敏）/ AsyncSubAgent 独立进程（stdout JSON 行 + SIGINT 优雅退出）/ 真·实时 A/B 双跑（隔离环境并行 + 行级 diff）——v1.3.8 `sandbox:true` 的完整前置
> - **场景驱动权限**：🔐 身份→场景匹配→风险等级→放行/deny/人工批准，每步 decision-log 留痕；DSH 三硬约束（fail-closed / 守卫先于事件分发 / 最小权限面）；敏感域自动提级（审计数据写删一律 critical）
> - **AgentShield 五类扫描**：🛡️ MCP 配置风险画像 / Hook 注入分析 / Agent 配置审查（否定后行断言排除反向表述）/ 密钥检测增强 / **Shadow AI 发现**（扫进程/配置/仓库，揪出未注册的「影子 agent」）——静态确定性，零 LLM 自评
> - **行业 overlay 四套**：🏥 fintech（反洗钱留痕）/ medical（PHI 保护）/ government（等保留痕）/ ai（模型注册）——context.md `industry:` 自动加载，未标注保守默认
> - **断路器 + 行为监控**：⚡ 连败熔断 + 冷却 half-open 探测自动恢复（ASI08）/ 三指标滑窗超阈值隔离切人工（ASI10，与沙箱联动：隔离态不接新任务）
> - **ontology 生命周期**：🌳 lifecycle branch/trunk + 审阅门 `migrateToTrunk`（approver 必填）+ OKF 三件套（type 必填 / stale_after 信任时效 / verified 人审>机审分层）
> - **审查循环自适应并发**：⚙️ 按物理内存预算表自动取并发（8GB→1 ... ≥48GB→6）+ OOM 熔断降级；LLM 调用全程 timeout+retry
> - **26 项独立审查 bugfix**：🛡️ 四轮 16 视角审查全数修复（verify-commit 洗白链 / 安装链断链 / 门禁三态等 4 P0 根治 + 红队四项防御增强）
>
> 详见 [v1.3.7 开发日志](./docs/changelog/v1.3/v1.3.7.md)。更早版本见 [CHANGELOG](./CHANGELOG.md)。

## 为什么选 sofagent

| 维度 | 通用 Agent 框架 | sofagent |
|------|----------------|----------|
| 核心问题 | 怎么造 Agent | **AI 该放在哪**（先梳理再部署） |
| 安全保障 | 框架层无（需自行接 pre-commit / trufflehog） | git diff 硬证据审计 + 运行时拦截 + 一键回滚 |
| 审阅方式 | 靠人手动 review（人力瓶颈） | **机器审阅**——24 条规则自动审 + git diff 硬证据，纯 AI 节点也能被审 |
| 知识积累 | 从零开始 | 经验自动沉淀进 knowledge 知识库（think.md + Dream Cycle，v1.3.x 持续增强） |
| 数据主权 | 云端托管 | 缺省全量本地，可选联邦查询 |
| 部署方式 | 学新平台 | 装进你已有的 AI 工具（Claude Code / Cursor / WorkBuddy…） |

## 证据与可信度

> 🔬 **外部独立实验证据**（非官方自测）：Joel Niklaus 的 harness-optimization 研究（[研究代码仓库](https://github.com/JoelNiklaus/harness-optimization)，数据见仓库内实验）显示，同一模型不改权重、仅优化外层 Harness，法律 Agent 基准从 **63.4% → 80.1%（+16.7pp）**。详见 [THANKS.md](./docs/THANKS.md)。

> 🧪 **工程可信度**：2655 测试 / 13 包（12 个含测试）（实测见 `tools/test-count.sh`，flaky 重跑机制内置，以脚本判定为准）· 24 条审计规则 · fresh-eyes 独立审查持续运行（审查体系运作见 [docs/guides/review-system.md](./docs/guides/review-system.md)）。

## 文档

| 你想了解 | 看哪里 |
|:---------|:--------|
| **全局索引**（所有文档一个入口） | [WIKI](./docs/WIKI.md) |
| 怎么装、怎么用、常见问题 | [HANDBOOK](./docs/HANDBOOK.md) |
| 架构设计（约束层「对内的技术名字」 · 注入链 · 进化机制 · 24 条规则） | [ARCHITECTURE](./docs/ARCHITECTURE.md) |
| 设计哲学 | [PHILOSOPHY](./docs/PHILOSOPHY.md) |
| 行业印证与生态定位（与现有工具的差异） | [VALIDATION](./docs/VALIDATION.md) |
| 版本路线图 | [ROADMAP](./docs/ROADMAP.md) |
| 每个版本做了什么 | [CHANGELOG](./CHANGELOG.md) |
| FDE 诊断方法论（四阶段十二步） | [FDE/GUIDE.md](./FDE/GUIDE.md) |
| 安全声明 · 已知局限 | [SECURITY](./SECURITY.md) · [LIMITATIONS](./docs/LIMITATIONS.md) |
| 贡献指南 | [CONTRIBUTING](./CONTRIBUTING.md) |

---

<p align="center">
  欢迎提 Issue 和 PR，尤其较真的那种 · <a href="./CONTRIBUTING.md">贡献指南</a> · <a href="./docs/THANKS.md">致谢</a><br/>
  <sub>MIT License © <a href="https://github.com/KongFangXun/sofagent">孔放勋</a> · <a href="https://github.com/KongFangXun/sofagent">⭐ 如果 sofagent 帮到你，Star 一下让更多人看到</a></sub>
</p>
