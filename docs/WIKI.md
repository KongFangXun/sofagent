# sofagent 项目导航索引（WIKI）

> v1.3.5 · 2026-08-16 · 孔放勋

> **读者**：人类开发者 & AI Agent 均可阅读。本文档是项目全局索引入口。
> 如果你是 AI Agent 且需要查找具体实现路径，请直接跳转到"## 代码地图"段。

> ⚠️ **术语声明（AI Agent 与人类读者必读）**：sofagent 现行架构术语以 [ARCHITECTURE.md](./ARCHITECTURE.md) 与 [PHILOSOPHY.md](./PHILOSOPHY.md) 为准——**约束层（Harness）**（一个层四种能力：注入·审计·回溯·进化，FORGE 为内部工具）+ **双层架构**（约束层 × 生命周期）。`docs/archive/` 与 `docs/changelog/v1.0/`、`docs/changelog/v1.1/` 为**历史版本快照**（实际目录为 v1.0/ 与 v1.1/ 分开，非合并的 v1.0-v1.1/），其中"四引擎""认知底座"等旧术语反映当时版本，**不代表现行设计**，请勿据此推断当前架构。

> **3 分钟建立全景理解**：核心文档太长？先看这 4 句：
> - **[ARCHITECTURE.md](./ARCHITECTURE.md)**：双层架构设计（约束层 × 生命周期）+ 约束层工程三层嵌套（约束层 → Graph → Loop），关键技术决策记录。**3 秒版**：约束层管"做对"（注入·审计·回溯·进化）· 激活链四阶段管"跑起来" · Graph 控制图分波次 · Loop 自迭代闭环。
> - **[VALIDATION.md](./VALIDATION.md)**：行业印证与生态定位——sofagent 直觉如何被行业验证 + Agent 三层模型 + 架构框架映射。
> - **[PHILOSOPHY.md](./PHILOSOPHY.md)**：设计哲学与产品方法论（§一~§九）。"不替代 Agent，做 Agent 的控制面"。
> - **[ROADMAP.md](./ROADMAP.md)**：版本路线图 + 迭代历程。当前 v1.3.5。

---

## 一、一句话

**sofagent 是一个开源 FDE Agent**（MIT，同时也是 FDE 方法论的参考实现）——进场梳理工作流、把能自动化的环节变成 AI 节点、部署到设备上 7×24 自己跑。底层是 **约束层（Harness）**——约束 Agent 行为、审计每次变更、沉淀经验。

---

## 二、核心概念

| 概念 | 一句话 | 详情 |
|------|--------|------|
| **FDE Agent** | 对外的产品身份：「Forward Deployed Engineer」——进场→部署→离场，留一套能持续维护的 AI 化资产 | [PHILOSOPHY §一](./PHILOSOPHY.md) |
| **约束层（Harness）** | 对内的技术身份：约束 Agent 行为的「缰绳」——一个层四种能力（注入·审计·回溯·进化），编排（FORGE）为内部工具不对外宣称 | [ARCHITECTURE §二](./ARCHITECTURE.md) |
| **约束层七维度** | Agent = 模型 + 上下文 + 工具 + 状态 + 执行控制 + 权限 + 可观测性——四种能力各自覆盖其中哪些维度 | [ARCHITECTURE §一·心智模型](./ARCHITECTURE.md) |
| **约束层构成（企业视角）** | 黄仁勋定义：企业专属约束层 = 知识 + 记忆 + 工作流 + 权限 + 安全机制 + 运行环境——模型是起点，围绕模型积累的这套专属系统才是核心资产 | [PHILOSOPHY §一·理论锚点](./PHILOSOPHY.md#智能与控制分离sofagent-的理论锚点) |
| **审计引擎** | git diff 驱动，24 条规则（17 默认 + 7 扩展），A1→A23 为活跃规则（A12/A13 已在 v0.99.4 合并入 A11，编号不再使用；v1.2.5 新增 A20-A23），每次 commit 自动跑 | [ARCHITECTURE §三](./ARCHITECTURE.md) |
| **三层治理** | Ledger（原始数据）→ Views（派生视图）→ Policy（约束规则），单向派生、不可逆写 | [PHILOSOPHY §五](./PHILOSOPHY.md) |
| **FORGE** | 自迭代引擎（内部工具，外部用户可忽略）——通过 Workflow 驱动 Agent 审查/修复/验证自己的代码，核心是 fresh-eyes-loop | [FORGE/README.md](../FORGE/README.md) |
| **SKILL** | Agent 的行为约束文件系统——三层：SKILL.md（主入口）/ harness/（约束底座）/ agents/（Sub Agent） | [SKILL/SKILL.md](../SKILL/SKILL.md) |
| **激活链** | FDE 交付物→企业工作流自运转的四阶段生命周期：ACTIVATE→ORCHESTRATE→EXECUTE→SUSTAIN（v1.2.5-v1.3.0） | [guides/fde-activation-chain.md](./guides/fde-activation-chain.md) |
| **data/** | ~/.sofagent/data/ v1.2.1 确立的 SSOT 数据目录（原 .sofagent/ 已迁移）：history.jsonl、knowledge/、audit/、config/ | [DEVELOPMENT §数据目录](./DEVELOPMENT.md) |

---

## 三、架构全景

```
┌─────────────────────────────────────────────────┐
│                  FDE Agent（产品身份）            │
├─────────────────────────────────────────────────┤
│  SKILL 层（约束注入）  │  FORGE 层（自迭代）      │
│  SKILL.md + harness/  │  fresh-eyes-loop +       │
│  + agents/ + custom/  │  release-gate-loop       │
├─────────────────────────────────────────────────┤
│              约束层（Harness）              │
│  ┌──────────┬──────────┬──────────┐            │
│  │  审计能力  │ 回溯能力  │ 进化能力  │  ← 四种能力   │
│  │ git diff  │ HMAC 链  │知识蒸馏  │ （对外叙事） │
│  │ 24条规则  │ 防篡改   │sustain   │            │
│  └──────────┴──────────┴──────────┘            │
│  + 注入能力（约束注入链）                         │
│  内部：编排引擎 @sofagent/orchestrator            │
│        （LangGraph ReactAgent，非对外产品引擎）   │
├─────────────────────────────────────────────────┤
│  data/（运行时数据） │ engine/（13 个 @sofagent/* 包，测试口径 12 包） │
└─────────────────────────────────────────────────┘
```

### 运行时数据流

每个引擎运行时往 `data/` 写数据，消费者从 `data/` 读数据：*（完整全景图见 [ARCHITECTURE §二·运行时数据层](./ARCHITECTURE.md)）*

| 生产者（引擎） | → data/ 目录 | → 消费者 |
|---|---|---|
| audit（commit→runRules） | `audit/history.jsonl` | daemon（巡检）、think（反思生成） |
| think（generateThinkEntry） | `think.md` | harness 加载链（注入上下文） |
| eval（runEval）⭐ | `eval/history.jsonl` | think（进化引擎：passRate 下降→告警） |
| daemon（health-reporter） | `daemon-health.json` | Dashboard（健康面板） |
| daemon（dream-cycle） | `knowledge/` | harness 加载链（Skill 知识注入） |
| FORGE driver（loop） | `forge-runs/` | 人类（verdict.md） |

**数据流铁律**：生产者只写不读自己的输出，消费者只读不写——单向派生，不可逆。

### 三层嵌套：Harness → Graph → Loop

> 📌 **本节是三层嵌套架构图的唯一源（SSOT）**——ARCHITECTURE.md 的「补充视角」只做说明引用此处，不重复维护完整图。修改三层结构请改本段。

上述架构全景中，约束层四种能力（注入·审计·回溯·进化）与 FORGE 内部编排不是并列关系——它们按 Agent 工程三层架构嵌套：

```
约束层（工作环境）       Graph（流程拓扑）         Loop（反馈改进）
┌─────────────────┐     ┌──────────────────┐      ┌─────────────────────┐
│ 约束注入链 + 加载链│ ──→ │ 编排引擎（内部）     │ ──→  │ FORGE（fresh-eyes +   │
│ 审计能力（24规则）│     │ LangGraph ReactAgent│      │ release-gate-loop）+  │
│ daemon（文件监控） │     │ 多Agent 任务拆解     │      │ sustain（进化能力）    │
│ data/（状态持久） │     │                     │      │ eval 反馈闭环         │
│ ToolGate（权限）  │     │                     │      │                      │
└─────────────────┘     └──────────────────┘      └─────────────────────┘
  决定"能做什么"          决定"下一步去哪"          决定"怎么越做越好"
```

> **一句话记忆**：环境、反馈、流程。约束层给 Agent 一个工作间，Graph 告诉它任务流向哪，Loop 让它出错后能自己改。

---

## 四、文件地图

> 💡 **FDE/ 是给人看的部署流程文档；SKILL/ 是给 Agent 读的行为约束文件。新 Skill 放 SKILL/。**

### 根目录（重要性排序）

| 文件 | 看什么的 |
|------|---------|
| `README.md` | 项目介绍、安装、部署（给人看） |
| `docs/ROADMAP.md` | 版本路线图、行业借鉴项、技术预研方向 |
| `CHANGELOG.md` | 纯目录索引——每版本一行，细节见 `docs/changelog/` |
| `SKILL/SKILL.md` | FDE Agent 主入口（Harness 加载链起点） |
| `install.sh` | 一键安装脚本 |
| `LICENSE` | MIT |
| `SECURITY.md` | 安全策略、审计规则清单 |
| `docs/LIMITATIONS.md` | 已知限制和适用边界 |
| `CONTRIBUTING.md` | 贡献指南 |

### docs/ 目录

| 文件 | 看什么的 |
|------|---------|
| `docs/WIKI.md` | **你正在读的这个**——项目导航索引 |
| `docs/PHILOSOPHY.md` | 产品哲学九节：为什么做、三层治理、FDE 定义 |
| `docs/VALIDATION.md` | 行业印证与生态定位：31 篇行业方法论印证、a16z 七法则、Agent 三层模型、架构框架映射 |
| `docs/ARCHITECTURE.md` | 架构详解：约束层四种能力（注入·审计·回溯·进化）、数据流、部署模式、文件结构（含 Ledger-Views-Policy ↔ LLM Wiki 三层同构对照） |
| `docs/DEVELOPMENT.md` | 开发指南：本地环境、包结构、测试、发版流程 |
| `docs/HANDBOOK.md` | FDE 操作手册：进场流程、节点部署、持续维护 |
| `docs/guides/fde-activation-chain.md` | 🔗 激活链设计（v1.2.5+）：FDE 交付物 → 企业工作流自动运转（ACTIVATE→ORCHESTRATE→EXECUTE→SUSTAIN） |
| `docs/THANKS.md` | 致谢——谁启发了哪个设计决策 |
| `docs/changelog/` | 每版本开发日志（`v1.0/` `v1.1/` `v1.2/` `v1.3/` `v1.4/`）。⚠️ 早期版本日志含"审查元信息/开发过程备注"等非产品文档内容，属当时开发留痕，不代表产品能力声明。✅ **v1.3.3 起已清理审查元信息**（见 v1.3.4 bugfix），当前版本 changelog 只含产品变更声明。以各版本 changelog 顶部的"已开发/已排期"标记为准。规划中版本的开发排期见 [ROADMAP](./ROADMAP.md) |
| `docs/changelog/releasing.md` | **发版 SOP**——十二阶段全流程 |
| `docs/evidence/` | 效果证据：案例、基准测试、反例 |
| `docs/archive/` | 历史归档：实验版 changelog、早期证据、设计文档 |
| `docs/guides/` | 专题指南：部署、测试、Dashboard 开发、Loop 开发等 |

### engine/（12 个 npm 发布包，workspace 含内部 hook 包共 13 个）

| 包 | 职责 |
|----|------|
| `engine/audit/` | @sofagent/audit — 审计引擎（git diff + 24 条规则） |
| `engine/core/` | @sofagent/core — 核心类型、HMAC 工具、memory-contract |
| `engine/orchestrator/` | @sofagent/orchestrator — LangGraph createReactAgent 编排 |
| `engine/daemon/` | @sofagent/daemon — 后台守护进程（cron 巡检 + 文件监听） |
| `engine/harness/` | @sofagent/harness — SKILL 加载链（上下文注入） |
| `engine/mcp/` | @sofagent/mcp — MCP Server（知识库 CRUD tool） |
| `engine/hooks/sofagent-load-chain/` | @sofagent/load-chain — SKILL 加载链 git hook（v1.2.x 新增，第 13 个 workspace） |
| `engine/scripts/` | 运维脚本集（9 个 .sh + lib/ 模块 + windows/ 14 个 .ps1）——安装（install.sh 调用）、卸载、验证（verify.sh）、daemon 管理、审计日志记录等 |
| `~/.sofagent/bin/sofagent` | CLI 入口（安装时生成，不在仓库内）— `sofagent status/where/version/data/help` |
| 其余 5 包（eval/ab-test/skillopt/rules/ontology） | 详见 `docs/DEVELOPMENT.md §包结构`（README 统一口径为 12 个 npm 发布包，workspace 含 hooks 内部包共 13） |

### 关键数据路径（`data/`）

| 路径 | 内容 |
|------|------|
| `data/audit/history.jsonl` | 审计历史（HMAC 哈希链，append-only） |
| `data/knowledge/` | 知识库（entities / concepts / comparisons / summaries） |
| `data/config/` | 配置文件（audit-report.json 等） |

---

## 五、当前状态

| 项 | 值 |
|----|-----|
| 当前版本 | **v1.3.4**（2026-08-14） |
| 下一版 | v1.3.5（规划中，参见 docs/ROADMAP.md） |
| 测试覆盖 | 2286 测试 / 12 包（测试统计标准：有 test script 的 workspace 包；workspace 总数 13 个均发布到 npm，见 check-test-count.sh） |
| 审计规则 | 24 条（17 默认 + 7 扩展），活跃编号 A1-A11 + A14-A23 + E1-E2/E4，每次 commit 自动跑 |
| FORGE | fresh-eyes-loop + release-gate-loop 运行中 |
| 数据目录 | **data/**（v1.2.1+ SSOT 运行时数据目录） |

---

## 六、术语表

| 术语 | 简释 | 精确定义 |
|------|------|---------|
| FDE | Forward Deployed Engineer——进场部署 AI 节点的工程师 | [PHILOSOPHY §一](./PHILOSOPHY.md) |
| Harness | Agent 行为约束中间件——"缰绳"，非"马" | [ARCHITECTURE §二](./ARCHITECTURE.md) |
| Ledger | 原始数据层（think.md + history.jsonl），append-only | [PHILOSOPHY §五](./PHILOSOPHY.md) |
| Views | 派生视图层（knowledge/ 四子目录），Ledger 单向派生 | [PHILOSOPHY §五](./PHILOSOPHY.md) |
| Policy | 约束规则层（SKILL + fde.md），Agent 启动时注入 | [PHILOSOPHY §五](./PHILOSOPHY.md) |
| FORGE | 自迭代引擎（内部工具，外部用户可忽略）——Agent 审查/修复/验证自己的代码 | [FORGE/README.md](../FORGE/README.md) |
| fresh-eyes-loop | FORGE 的质量审查闭环（a-check→b-check→a-consolidate→b-fix→a-verify） | [FORGE/SKILL/fresh-eyes-loop/SKILL.md](../FORGE/SKILL/fresh-eyes-loop/SKILL.md) |
| release-gate-loop | FORGE 的发版闸门闭环（acceptance-test + regression + 审查报告） | [FORGE/SKILL/release-gate-loop/SKILL.md](../FORGE/SKILL/release-gate-loop/SKILL.md) |
| ToolGate | Agent 工具调用的前置门禁（A2 密钥/A9 注入/A14 越权等规则） | [DEVELOPMENT §ToolGate](./DEVELOPMENT.md) |
| data/ | v1.2.1 SSOT 运行时数据目录（安装后实际位于 ~/.sofagent/data/），替换旧 .sofagent/ | [DEVELOPMENT §数据目录](./DEVELOPMENT.md) |

---

## 七、导航：按你的意图选路

### 了解 FDE Agent（产品 → 理念 → 路线）

| 你想…… | 读这个 |
|---------|--------|
| 3 分钟搞懂它是什么、能干什么 | [README.md](../README.md) |
| 理解设计哲学（为什么这么做） | [PHILOSOPHY.md](./PHILOSOPHY.md) |
| 看行业印证与生态定位 | [VALIDATION.md](./VALIDATION.md) |
| 看版本路线图和下一步 | [ROADMAP.md](./ROADMAP.md) |
| 了解激活链（交付物怎么自己跑起来） | [guides/fde-activation-chain.md](./guides/fde-activation-chain.md)（v1.2.5+） |
| 作为 FDE 进场部署 | [HANDBOOK.md](./HANDBOOK.md) |
| 找效果证据/案例 | [docs/evidence/](./evidence/) |

### 部署 / 集成 / 开发

| 你想…… | 读这个 |
|---------|--------|
| 了解系统怎么设计的 | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| 搭建本地开发环境 | [DEVELOPMENT.md](./DEVELOPMENT.md) |
| 查某个版本改了什么 | [CHANGELOG.md](../CHANGELOG.md) → `docs/changelog/vX.Y/vX.Y.Z.md` |
| 了解审计规则 | [SECURITY.md](../SECURITY.md) + [ARCHITECTURE §三](./ARCHITECTURE.md) |
| 了解 SKILL 约束体系 | [SKILL/SKILL.md](../SKILL/SKILL.md) |
| 配置 GitHub Actions CI | [guides/github-action.md](./guides/github-action.md) |
| 了解文件系统审计 | [guides/filesystem-audit.md](./guides/filesystem-audit.md) |
| 开发/维护 HTML Dashboard | [guides/dashboard-html-dev.md](./guides/dashboard-html-dev.md)（V1.0 · 设计原则 · 数据链路 · 视觉规范 · 踩坑记录） |
| 企业部署指南 | [guides/enterprise-deploy.md](./guides/enterprise-deploy.md) |
| 多设备联邦同步 | [guides/multi-device-sync.md](./guides/multi-device-sync.md) |
| 团队批量部署 | [guides/team-deploy.md](./guides/team-deploy.md) |
| 运行测试 / 验证效果 | [guides/testing.md](./guides/testing.md) |
| 添加新审计规则 | `engine/audit/src/rules/` → 对照现有规则模式（defaultRules / extendedRules） |
| 新建 Sub Agent | `SKILL/agents/` → 参照 `agents/engineer/SKILL.md` |
| 运行测试 | `npm test`（根目录） |

### 贡献 / 审查 / 发版（内部工程）

| 你想…… | 读这个 |
|---------|--------|
| 了解 FORGE 自迭代工具链 | [FORGE/README.md](../FORGE/README.md) |
| 给 FORGE 加新 Loop | [guides/loop-development.md](./guides/loop-development.md) |
| 走发版流程（十二阶段 SOP） | [docs/changelog/releasing.md](./changelog/releasing.md) |
| 跑独立审查 | [FORGE/playbook/fresh-eyes-review.md](../FORGE/playbook/fresh-eyes-review.md) |
| 贡献代码 | [CONTRIBUTING.md](../CONTRIBUTING.md) |

---

> **维护规则**：本文档由 AI 在每次发版时更新（版本号、文件清单、状态表）。当前版本 v1.3.4 · 孔放勋 · 2026-08-14。
