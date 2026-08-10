<p align="center">
  <img src="docs/assets/banner.png" alt="sofagent" width="100%" />
</p>

<p align="center">
  <a href="https://github.com/KongFangXun/sofagent/actions/workflows/verify.yml"><img src="https://github.com/KongFangXun/sofagent/actions/workflows/verify.yml/badge.svg" alt="Verify" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-brightgreen" alt="License: MIT" /></a>
  <a href="./CHANGELOG.md"><img src="https://img.shields.io/badge/Version-v1.3.1-16B8F3" alt="Version" /></a>
</p>

<p align="center">
  <a href="README.en.md">English</a> · <a href="#这是什么">这是什么</a> · <a href="#fde-方法论">FDE 方法论</a> · <a href="#快速开始">快速开始</a> · <a href="#三个入口从-30-秒到全套部署">三个入口</a> · <a href="#为什么选-sofagent">为什么选</a> · <a href="#文档">文档</a> · <a href="https://github.com/KongFangXun/sofagent">⭐ Star</a>
</p>

---

## 这是什么

**sofagent 是一个开源 FDE Agent**（Forward Deployed Engineer Agent）——进场帮你梳理业务工作流，把能自动化的环节变成 AI 节点；交付完成后 FDE 离场，AI 节点继续 7×24 自动执行任务，每次干活受审计、越界能拦截、出事能回滚。

```mermaid
graph LR
    A["① 进场梳理<br/>对话引导梳理工作流<br/>哪些自动化·哪些人工·哪些不动"] --> B["② 部署 AI 节点<br/>把自动化环节变成 SubAgent<br/>用你已有的 AI 工具，不用学新界面"]
    B --> C["③ 离场后自运转<br/>FDE 走了，sofagent 留下 7×24<br/>每次干活受检查·越界能拦·出事能回滚"]
    C -.->|经验沉淀·持续优化| C
```

> 🏞️ 大厂给你"水"（大模型）和"河床"（Agent 平台），但水是原水，你不敢直接喝。sofagent 是帮你把河里的水让整个城市用起来的工程——堤坝不让水泛滥、自来水厂把原水变直饮水、管网把水送到每家每户的水龙头。模型给 90% 的智力，sofagent 补 10% 的可靠执行。
>
> 🌳 往远看，sofagent 帮企业长出一棵**会自我养护的 AI 能力树**——每个 AI 节点是一根枝条，审计是护栏，经验沉淀是根系，离场后 FDE 留下养护这棵树（7×24 巡检 + 审计 + 进化）。从「AI 替我干活」到「企业长出会养护的 AI 能力树」，详见 [FDE 方法论](./FDE/GUIDE.md)。

### 和裸 Agent 有什么不同

| 维度 | 裸 Agent（ChatGPT / Copilot） | sofagent |
|:-----|:------|:------|
| 变更审计 | 无 | git diff 24 条规则，硬证据判定 |
| 越界拦截 | 靠 prompt 自觉 | 违规当场阻断 + 审计留证 |
| 出事回滚 | 手动翻 commit | 一键快照回到任意节点 |
| 经验积累 | 每次从零开始 | 自动沉淀进知识库，进化能力持续迭代中 |

## 核心特性

**FDE Agent 交付**

- 🧭 **进场梳理工作流**——五要素深挖 + 三问判定法，把每个岗位环节摸清，算清每个 AI 节点值多少钱
- 🤖 **部署 AI 节点**——三层交付物（文档层 + Skill 层 + 运行层），装进你已有的 AI 工具，从"你干活"变"你派活"
- 🏠 **离场后常驻**——FDE Agent 留下巡检、审计、优化，7×24 在线，人离场治理不离开

**治理保障**

- 🔍 **零配置审计**——`npx -y -p @sofagent/audit sofagent-audit`，任何 git 仓库 3 秒审计最近一次 commit
- 🧱 **24 条审计规则**——密钥泄漏、越界编辑、注入防御、权限红线，git diff 硬证据判定，违规当场拦截
- 🛡️ **自动快照回溯**——每次审计后自动存档，出事一键回到任意快照

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
- 🧬 **经验自动沉淀**——think.md 反思 + knowledge 维护，每次任务的经验教训自动进知识库，进化能力持续迭代中

> 部署的不是裸 Agent，是**带约束骨架的 Agent**——约束是建议性的，审计是强制性的：Agent 可以不遵守约束，但每次变更都逃不过审计。

## 产品一瞥

<p align="center">
  <img src="docs/assets/dashboard.png" alt="sofagent Dashboard 驾驶舱" width="100%" />
</p>

<p align="center"><sub>Dashboard 驾驶舱：规则通过率、审计任务、违规趋势——AI 在干什么，一眼看清。安装后运行 <code>sofagent-dashboard --full</code> 启动</sub></p>

## 快速开始

**30 秒，零配置**——在任何 git 仓库跑一次审计：

```bash
npx -y -p @sofagent/audit sofagent-audit
```

> 💡 `sofagent-audit` 是 quick 只读审计（审计最近一次 commit，默认安全无副作用）；`sofagent-audit-full` 是完整审计，需显式指定操作（如 `--diff <range>` / `--init` 等）。

拦截特定格式密钥泄漏时是这样的（真实输出）：

> ℹ️ A2 检测 AWS AKIA、OpenAI sk-*、GitHub ghp_、PEM 私钥等已知格式；通用密钥形态（password=、secret 裸值）暂不覆盖——保守设计防误报。详见 [LIMITATIONS A2](./docs/LIMITATIONS.md#a2-密钥检测局限编码与格式绕过v125-披露)。

<p align="center">
  <img src="docs/assets/audit-terminal.png" alt="sofagent-audit 拦截 .env 提交" width="860" />
</p>

**完整安装**（Node.js ≥ 18，先下载审查再执行）：

```bash
curl -fsSL https://raw.githubusercontent.com/KongFangXun/sofagent/main/bootstrap.sh -o bootstrap.sh
less bootstrap.sh          # 先看一眼脚本内容，确认安全
bash bootstrap.sh && rm bootstrap.sh
sofagent-audit --init      # 装 git hook，之后每次 commit 自动审计
sofagent-audit --doctor    # 验证环境（可选）
```

> 💡 所有安装脚本只写入 `~/.sofagent/`，不修改系统文件。`--no-verify` 可绕过本地 hook——sofagent 防的是诚实 Agent 的疏忽，不是恶意绕过；高安全场景请在 CI 侧加 `sofagent-audit --diff` 兜底。详见 [LIMITATIONS](./docs/LIMITATIONS.md)。

更多安装方式（clone 安装 / npx 完整安装 / 最小安装 / 企业部署）见 [HANDBOOK](./docs/HANDBOOK.md)。企业用户想直接用 FDE 方法论梳理工作流，看 [FDE/README.md](./FDE/README.md)（零依赖，不需要 Node.js）。

## 三个入口，从 30 秒到全套部署

不用一开始就做全套决定——从 30 秒体验开始，觉得有用再深入：

```mermaid
graph LR
    A["个人<br/>npx -y -p @sofagent/audit sofagent-audit<br/>30 秒零配置审计"] --> B["团队<br/>规则市场 + GitHub Action<br/>PR 自动审计"]
    B --> C["企业<br/>FDE Agent<br/>全套部署·7×24 自运转"]
```

| 入口 | 做什么 | 花多久 |
|------|--------|:----:|
| **`npx -y -p @sofagent/audit sofagent-audit`** | 零配置审计最近一次 commit，3 秒出结果 | 30 秒 |
| **`--ruleset` 规则市场** | 加载安全等规则集，或自定义 JSON 规则 | 1 分钟 |
| **GitHub Action** | 每次 PR 自动审计，违规标注在 diff 行上 | 配置一次 |
| **FDE Agent** | 进场梳理工作流 → 部署 AI 节点 → 7×24 自运转 | FDE 驻场 |

**规则市场**：

```bash
npx -y -p @sofagent/audit sofagent-audit --list-rulesets      # 看有哪些规则集
npx -y -p @sofagent/audit sofagent-audit --ruleset security   # 加载安全规则集
```

社区规则集以 `sofagent-ruleset-*` npm 包发布，装上自动发现；也支持 `--ruleset-path` 指向你自己的 JSON 规则。

**FDE Agent**——进场梳理 + 部署 + 常驻，两条路径任选：

- **方法论路径**（零依赖）：读 [FDE/GUIDE.md](./FDE/GUIDE.md)，按手册手动梳理工作流，Excel + 人脑也能跑
- **工具路径**（Node.js ≥ 18）：装好后在你的 AI 工具里说"帮我做 FDE 诊断"，Agent 从进场开始引导你

## 为什么选 sofagent

| 维度 | 通用 Agent 框架 | sofagent |
|------|----------------|----------|
| 核心问题 | 怎么造 Agent | **AI 该放在哪**（先梳理再部署） |
| 安全保障 | 靠 prompt 约束 | git diff 硬证据审计 + 运行时拦截 + 一键回滚 |
| 知识积累 | 从零开始 | 经验自动沉淀进 knowledge 知识库，持续优化 |
| 数据主权 | 云端托管 | 缺省全量本地，可选联邦查询 |
| 部署方式 | 学新平台 | 装进你已有的 AI 工具（Claude Code / Cursor / WorkBuddy…） |

## 证据与可信度

> 🔬 **外部独立实验证据**（非官方自测）：Joel Niklaus 的 harness-optimization 研究（[研究代码仓库](https://github.com/JoelNiklaus/harness-optimization)，数据见仓库内实验）显示，同一模型不改权重、仅优化外层 Harness，法律 Agent 基准从 **63.4% → 80.1%（+16.7pp）**。详见 [THANKS.md](./docs/THANKS.md)。

> 🧪 **工程可信度**：1719 测试 / 12 包（全绿，实测见 `tools/test-count.sh`）· 24 条审计规则 · fresh-eyes 独立审查持续运行（审查工具见 [FORGE/playbook/fresh-eyes-review.md](./FORGE/playbook/fresh-eyes-review.md)）。

> 🔐 **v1.3.0 新能力**：运行时审计（tool wrapper 动态拦截 + 审计留证）· 决策审计（意图问责：`emitDecision` + HMAC 链 + kind-wise 查询）· 规则透明化（`list_rules` MCP tool）· HITL 人工批准钩子 · 运行时审计日志按 git 仓库隔离 · 激活链 Phase 4 收尾 · 外部记忆后端 Path A（可选，缺省关闭）· 进化链路写保护。详见 [v1.3.0 开发日志](./docs/changelog/v1.3/v1.3.0.md)。

## 文档

| 你想了解 | 看哪里 |
|:---------|:--------|
| 怎么装、怎么用、常见问题 | [HANDBOOK](./docs/HANDBOOK.md) |
| 架构设计（约束层 · 注入链 · 进化机制 · 24 条规则） | [ARCHITECTURE](./docs/ARCHITECTURE.md) |
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
