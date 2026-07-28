# sofagent WIKI · v1.2.1

> **这是给 AI Agent 看的项目导航索引。** 新 session 先读这个（3 分钟扫完），再按需深入具体文档。
> 人类开发者请读 [README.md](../README.md)。

---

## 一、一句话

**sofagent = FDE Agent**，进场梳理工作流、把能自动化的环节变成 AI 节点、部署到设备上 7×24 自己跑。底层是 **sofagent 引擎（Harness 中间件）**——约束 Agent 行为、审计每次变更、沉淀经验。

---

## 二、核心概念

| 概念 | 一句话 | 详情 |
|------|--------|------|
| **FDE Agent** | 对外的产品身份：「Forward Deployed Engineer」——进场→部署→离场，留一套能持续维护的 AI 化资产 | [PHILOSOPHY §一](./PHILOSOPHY.md) |
| **Harness 中间件** | 对内的技术身份：约束 Agent 行为的「缰绳」，四引擎（审计/编排/回溯/进化） | [ARCHITECTURE §二](./ARCHITECTURE.md) |
| **审计引擎** | git diff 驱动，21 条规则（A1 密钥泄漏→A21 越权操作），每次 commit 自动跑 | [ARCHITECTURE §三](./ARCHITECTURE.md) |
| **三层治理** | Ledger（原始数据）→ Views（派生视图）→ Policy（约束规则），单向派生、不可逆写 | [PHILOSOPHY §五](./PHILOSOPHY.md) |
| **FORGE** | 自迭代引擎——通过 workflow 驱动 Agent 审查/修复/验证自己的代码，核心是 fresh-eyes-loop | [FORGE/README.md](../FORGE/README.md) |
| **SKILL** | Agent 的行为约束文件系统——三层：SKILL.md（主入口）/ sofagent/（约束底座）/ agents/（Sub Agent） | [SKILL/SKILL.md](../SKILL/SKILL.md) |
| **data/** | v1.2.1 确立的 SSOT 数据目录（原 .sofagent/ 已迁移）：history.jsonl、knowledge/、audit/、config/ | [DEVELOPMENT §数据目录](./DEVELOPMENT.md) |

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
│              sofagent 引擎（Harness 中间件）       │
│  ┌──────────┬──────────┬──────────┬──────────┐  │
│  │ 审计引擎  │ 编排引擎  │ 回溯引擎  │ 进化引擎  │  │
│  │ git diff  │LangGraph │ HMAC 链  │知识蒸馏  │  │
│  │ 21条规则  │ReactAgent│ 防篡改   │sustain   │  │
│  └──────────┴──────────┴──────────┴──────────┘  │
├─────────────────────────────────────────────────┤
│  data/（运行时数据） │ engine/（12 个 npm 包）     │
└─────────────────────────────────────────────────┘
```

---

## 四、文件地图

### 根目录（重要性排序）

| 文件 | 看什么的 |
|------|---------|
| `README.md` | 项目介绍、安装、部署（给人看） |
| `ROADMAP.md` | 版本路线图、行业借鉴项、技术预研方向 |
| `CHANGELOG.md` | 纯目录索引——每版本一行，细节见 `docs/changelog/` |
| `SKILL.md` → `SKILL/SKILL.md` | FDE Agent 主入口（Harness 加载链起点） |
| `install.sh` | 一键安装脚本 |
| `LICENSE` | MIT |
| `SECURITY.md` | 安全策略、审计规则清单 |
| `LIMITATIONS.md` | 已知限制和适用边界 |
| `CONTRIBUTING.md` | 贡献指南 |

### docs/ 目录

| 文件 | 看什么的 |
|------|---------|
| `docs/WIKI.md` | **你正在读的这个**——项目导航索引 |
| `docs/PHILOSOPHY.md` | 产品哲学十三节：为什么做、三层治理、FDE 定义、行业方法论印证 |
| `docs/ARCHITECTURE.md` | 架构详解：四引擎、数据流、部署模式、文件结构 |
| `docs/DEVELOPMENT.md` | 开发指南：本地环境、包结构、测试、发版流程 |
| `docs/HANDBOOK.md` | FDE 操作手册：进场流程、节点部署、持续维护 |
| `docs/THANKS.md` | 致谢——谁启发了哪个设计决策 |
| `docs/llm-wiki-mapping.md` | Karpathy LLM Wiki 三层 ↔ sofagent 三层治理的同构对照 |
| `docs/changelog/` | 每版本开发日志（`v1.0/` `v1.1/` `v1.2/` `v1.3/`） |
| `docs/changelog/releasing.md` | **发版 SOP**——十二阶段全流程 |
| `docs/evidence/` | 效果证据：案例、基准测试、反例 |
| `docs/archive/` | 历史归档：实验版 changelog、早期证据、设计文档 |
| `docs/guides/` | 专题指南：部署、测试、MCP 使用、Loop 开发等 |

### engine/（12 个 npm 包）

| 包 | 职责 |
|----|------|
| `engine/audit/` | @sofagent/audit — 审计引擎（git diff + 21 条规则） |
| `engine/core/` | @sofagent/core — 核心类型、HMAC 工具、memory-contract |
| `engine/orchestrator/` | @sofagent/orchestrator — LangGraph createReactAgent 编排 |
| `engine/daemon/` | @sofagent/daemon — 后台守护进程（cron 巡检 + 文件监听） |
| `engine/harness/` | @sofagent/harness — SKILL 加载链（上下文注入） |
| `engine/mcp/` | @sofagent/mcp — MCP Server（知识库 CRUD tool） |
| `engine/cli/` | @sofagent/cli — CLI 入口 |
| 其余 5 包 | 详见 `docs/DEVELOPMENT.md §包结构` |

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
| 当前版本 | **v1.2.1**（2026-07-27） |
| 下一版本 | v1.2.2（数据主权仪表盘 + ModelRouter + Graph Engine 规划） |
| 测试覆盖 | 1009 测试 / 12 包全绿 |
| 审计规则 | 21 条（A1→A21），每次 commit 自动跑 |
| FORGE | fresh-eyes-loop + release-gate-loop 运行中 |
| 数据目录 | **data/**（v1.2.1 从 .sofagent/ 迁移完成） |

---

## 六、术语表

| 术语 | 简释 | 精确定义 |
|------|------|---------|
| FDE | Forward Deployed Engineer——进场部署 AI 节点的工程师 | [PHILOSOPHY §一](./PHILOSOPHY.md) |
| Harness | Agent 行为约束中间件——"缰绳"，非"马" | [ARCHITECTURE §二](./ARCHITECTURE.md) |
| Ledger | 原始数据层（think.md + history.jsonl），append-only | [PHILOSOPHY §五](./PHILOSOPHY.md) |
| Views | 派生视图层（knowledge/ 四子目录），Ledger 单向派生 | [PHILOSOPHY §五](./PHILOSOPHY.md) |
| Policy | 约束规则层（SKILL + fde.md），Agent 启动时注入 | [PHILOSOPHY §五](./PHILOSOPHY.md) |
| FORGE | 自迭代引擎——Agent 审查/修复/验证自己的代码 | [FORGE/README.md](../FORGE/README.md) |
| fresh-eyes-loop | FORGE 的质量审查闭环（a-check→b-check→a-consolidate→b-fix→a-verify） | [FORGE/SKILL/fresh-eyes-loop/SKILL.md](../FORGE/SKILL/fresh-eyes-loop/SKILL.md) |
| release-gate-loop | FORGE 的发版闸门闭环（acceptance-test + regression + 审查报告） | [FORGE/SKILL/release-gate-loop/SKILL.md](../FORGE/SKILL/release-gate-loop/SKILL.md) |
| ToolGate | Agent 工具调用的前置门禁（A2 密钥/A9 注入/A14 越权等规则） | [DEVELOPMENT §ToolGate](./DEVELOPMENT.md) |
| data/ | v1.2.1 SSOT 运行时数据目录，替换旧 .sofagent/ | [DEVELOPMENT §数据目录](./DEVELOPMENT.md) |

---

## 七、导航：遇到 X 问题 → 读 Y 文档

| 你想…… | 读这个 |
|---------|--------|
| 了解项目是什么、为什么做 | [PHILOSOPHY.md](./PHILOSOPHY.md) |
| 了解系统怎么设计的 | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| 搭建本地开发环境 | [DEVELOPMENT.md](./DEVELOPMENT.md) |
| 知道当前版本、下一步做什么 | [ROADMAP.md](../ROADMAP.md) |
| 查某个版本改了什么 | [CHANGELOG.md](../CHANGELOG.md) → `docs/changelog/vX.Y/vX.Y.Z.md` |
| 走发版流程 | [docs/changelog/releasing.md](./changelog/releasing.md) |
| 了解审计规则 | [SECURITY.md](../SECURITY.md) + [ARCHITECTURE §三](./ARCHITECTURE.md) |
| 了解 FORGE 自迭代 | [FORGE/README.md](../FORGE/README.md) |
| 了解 SKILL 约束体系 | [SKILL/SKILL.md](../SKILL/SKILL.md) |
| 作为 FDE 进场部署 | [HANDBOOK.md](./HANDBOOK.md) |
| 找效果证据/案例 | [docs/evidence/](./evidence/) |
| 添加新审计规则 | `engine/audit/src/rules/` → 对照 A1-A21 模式 |
| 新建 Sub Agent | `SKILL/agents/` → 参照 `agents/engineer/SKILL.md` |
| 运行测试 | `npm test`（根目录） |

---

> **维护规则**：本文档由 AI 在每次发版时更新（版本号、文件清单、状态表）。当前版本 v1.2.1 · 孔放勋 · 2026-07-28。
