# sofagent

> 🌐 [English abridged version →](README.en.md) | 🇨🇳 中文完整版

<p align="center">
  <img src="sofagent.png" alt="sofagent" width="160" />
</p>

<p align="center">
  <strong>sofa + agent = sofagent / 沙发特工</strong><br/>
  <em>做的不是帮企业「接上 AI」——是帮企业「用对 AI」。</em>
</p>

<p align="center" style="color:#64748B;font-size:14px;">
  中小企业和 OPC 的 FDE 工具包<br/>
  约束底座管行为，审计引擎盯结果，编排引擎自动干活
</p>

<p align="center">
  <a href="https://github.com/KongFangXun/sofagent/actions/workflows/verify.yml"><img src="https://github.com/KongFangXun/sofagent/actions/workflows/verify.yml/badge.svg" alt="Verify" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-brightgreen" alt="License: MIT" /></a>
  <a href="./CHANGELOG.md"><img src="https://img.shields.io/badge/Version-v1.0.5-16B8F3" alt="Version" /></a>
</p>

---

## 为什么需要 sofagent？

95%+ 的中小企业卡在这三道坎：

| 🚫 预期太高 | 🔧 技术主导 | 👻 装了没人管 |
|:--|:--|:--|
| 买了一堆 AI 工具，以为什么都能干。不是 AI 不行——是没人梳理工作流，不知道从哪下手 | 技术视角看不到业务节点。AI 落地不是 IT 项目，是业务改造 | AI 干得好不好没人知道。行为没约束、结果缺审计——出了问题找不到责任人 |

**sofagent 做的事**：FDE 就像一个工头，带着一群 AI 工人干活——进场先梳理工作流、识别 AI 节点、装上工具包、让 AI 自己跑业务。不用请顾问、不用养 AI 团队。

---

## 怎么装？

```bash
npm install -g @sofagent/audit && sofagent-audit --init
```

装完改个文件提交试试——hook 会先跑审计再放行：

```bash
echo "API_KEY=sk-123456" > .env && git add .env && git commit -m "test"
# → ⛔ A1 不碰敏感：.env 包含密钥格式，拦截提交
```

> 需要 Node.js ≥ 18 + bash + git。macOS / Linux 全功能，Windows 实验性。[完整安装说明](./docs/HANDBOOK.md)

---

## 怎么工作？

```mermaid
graph LR
    A[AI Agent<br/>写代码/改配置] --> B[git commit]
    B --> C{sofagent<br/>审计引擎}
    C -->|git diff 扫描| D[15 条规则判定]
    D -->|违规| E[⛔ 拦截 + 记录]
    D -->|合规| F[✅ 放行]
    E --> G[think.md<br/>自动反思]
    F --> H[代码入库]
    G --> A
```

审计引擎不依赖 AI 自觉——它看的是 git diff 硬证据。AI 改了什么就是什么，赖不掉。约束底座同时把规则注入 Agent 上下文，让它开工前就知道红线在哪。编排引擎负责把大任务拆小、多任务并行、定期 A/B 测试找更优方案。

### 架构总览

```
┌─────────────────────────────────────────────────────┐
│                    sofagent                         │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ 约束底座  │  │ 审计引擎  │  │ 编排引擎（实验性） │  │
│  │          │  │          │  │                  │  │
│  │ 宪法层    │  │ git diff │  │ 任务拆解→匹配模板  │  │
│  │ 反思层    │  │ →15 规则 │  │ →并行执行→评分    │  │
│  │ 规范层    │  │ →exit cd │  │ →A/B 自动优化    │  │
│  │          │  │          │  │                  │  │
│  │ 全平台   │  │ 全平台   │  │ 仅 OpenClaw      │  │
│  └──────────┘  └──────────┘  └──────────────────┘  │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │ 🆕 v1.0.5                                     │  │
│  │ Ontology 统一层 · Workflow Hub 行业模板        │  │
│  │ Agent Dashboard · 原子写入 · 分级安全          │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

---

## 和现有工具有什么区别？

| | sofagent | detect-secrets | pre-commit hooks |
|------|:--:|:--:|:--:|
| 密钥检测 | ✅ | ✅ | ❌ |
| Agent 越界检测 | ✅ | ❌ | ❌ |
| 注入攻击检测 | ✅ | ❌ | ❌ |
| 流程合规（改前读/改后测） | ✅ | ❌ | ❌ |
| 知识库越权 | ✅ | ❌ | ❌ |
| 配置删除检测 | ✅ | ❌ | ❌ |
| 安装复杂度 | 一行命令 | 一行命令 | 需手写规则 |

---

## 效果怎么样？

> 🔬 Hugging Face 实验：同一模型不改权重，仅优化外层 Harness，在法律 Agent 基准中从 3.5% 跃升至 80.1%（76 分差全部来自外层机制）。[详情](./docs/ARCHITECTURE.md)

- 核心逻辑 **470+ tests 全绿**（diff-parser / config-loader / rules A1-A15 / reporter）
- 15 条审计规则（11 默认 + 4 扩展 + 2 实验性），覆盖密钥泄漏、越界修改、注入攻击、知识库越权等
- MIT 许可证，代码、文档、模板随便用

> ⚠️ 编排引擎需要 OpenClaw，能跑但还在打磨。[已知局限](./docs/LIMITATIONS.md)

---

## 你需要哪个？

| 你的场景 | 用什么 |
|---------|--------|
| 只想拦截密钥泄漏 | `npm install -g @sofagent/audit` 就够了 |
| 想管住 Agent 全流程 | 审计引擎 + 约束底座（install.sh） |
| 想自动编排 Agent 任务 | + 编排引擎（需要 OpenClaw） |

---

## 延伸阅读

| 你想了解 | 看哪里 |
|---------|--------|
| 怎么装、怎么用、常见问题 | [HANDBOOK](./docs/HANDBOOK.md) |
| 为什么这么设计 | [ARCHITECTURE](./docs/ARCHITECTURE.md) |
| 安全声明 | [SECURITY](./SECURITY.md) |
| 已知局限 | [LIMITATIONS](./docs/LIMITATIONS.md) |
| 版本路线图 | [ROADMAP](./ROADMAP.md) |
| 贡献指南 | [CONTRIBUTING](./CONTRIBUTING.md) |
| 企业部署（FDE 工具包 + Workflow Hub 模板） | [FDE/](./FDE/) \| [Workflow Hub](./workflow-hub/) |

---

## 贡献与致谢

欢迎提 Issue 和 PR，尤其挑刺的那种。[CONTRIBUTING.md](./CONTRIBUTING.md) · [致谢](./docs/THANKS.md)

> 我叫孔放勋，一个只懂点前端代码的产品经理。sofagent 的代码由 AI 模型编写，作者做产品决策和终审。每个版本经独立模型评审。
