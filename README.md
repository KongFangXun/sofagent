# sofagent

[![License](https://img.shields.io/badge/license-MIT%20%2B%20CC--BY--4.0-brightgreen)](./LICENSE)
[![Version](https://img.shields.io/badge/version-v0.60-1E40AF)](./Handbook.md)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-主力平台-2563EB)](./Design.md#平台依赖)
[![兼容](https://img.shields.io/badge/兼容-WorkBuddy%20%C2%B7%20Claude%20Code%20%C2%B7%20Codex%20%C2%B7%20Hermes-lightgrey)](./Design.md#平台依赖)
[![GitHub stars](https://img.shields.io/github/stars/KongFangXun/sofagent?style=flat)](https://github.com/KongFangXun/sofagent/stargazers)

<img src="images/sofagent.png" alt="sofagent" width="300" />

> sofa + agent = 沙发特工——希望有一天，我们能躺在沙发上，Agent 就把活干完了。
> v0.60 · 2026-06-19

我叫孔放勋，一个完全不懂代码的产品经理。所有设计决策来自大半年的真实使用经验，文档由 [DeepSeek V4 Pro](https://api-docs.deepseek.com/zh-cn/) 辅助生成。欢迎大佬进来改。

---

## 这是什么

给 Agent 配了个「指导员」——不是让它更聪明，是让它别乱来。

| 角色 | 怎么干 |
|------|------|
| **Skill**（判断）| MD 文件当规则书，Agent 加载后照做——三层加载链、复杂度预判、反思沉淀 |
| **脚本**（执行）| bash 脚本处理机械活——读写文件、调 API，Agent 调 shell 跑（非 bash 平台降级为 Read/Edit 工具） |
| **平台兜底**| 加载链 + 断路器 + 死循环检测——OpenClaw 系由 Hook 和配置层兜底，其他平台依赖自身安全机制 |

> ⚠️ sofagent 是软约束层——靠 Agent 读取并自觉遵守，不是硬编码强制执行。执行率受上下文长度、模型能力影响。详见 [Design §三](./Design.md)。

---

## 三份文档

| 你是谁 | 看哪个 | 一句话 |
|------|------|------|
| 普通用户 | [Handbook.md](./Handbook.md)（436 行） | 怎么装、怎么用、什么是铁律 |
| 开发者 | [Developer.md](./Developer.md)（561 行） | Skill 怎么协同、编排怎么跑、反思怎么闭环 |
| 设计爱好者 | [Design.md](./Design.md)（573 行） | 为什么选这些设计、已知局限 |
| 技术 VP 推广 | [docs/team-deploy.md](./docs/team-deploy.md)（3 页） | 装、试、回顾三阶段落地指南 |

---

## 怎么工作

```
三层加载链（常驻地基：宪法 → 反思区 → 你的规则）
          ↓
    A0 复杂度预判
    ├── 🟢🟡 简单 → 快速响应（地基在线）
    └── 🔴 复杂 → 任务编排引擎点火
                   │
              ┌────┴────┐
         智能拆解 → 分批执行 → Loop 检查（子任务间 · 60%预算 · 重大操作前）
              │                       │
              └─── 闭环反思 ←─────────┘
                      ↓
              下次参考上次经验
```

| 做什么 | 怎么做 |
|------|------|
| **地基** | 三层加载链——宪法（4底线+10铁律）→ 反思区（自动错题本）→ 你的规则。整个会话期间永远在线 |
| **引擎** | 任务编排引擎——🔴 复杂任务时点火，智能拆解 + Loop 检查 + 闭环反思 |
| **进化** | 渐进减薄——同类任务根据历史成功率调整编排深度，跑崩了恢复完整编排 |

> 💡 核心理念：**厚在治理，薄在复用。** 约束自己定，模板和 Skills 从社区取。为 AI Agent 提供纪律层与反思循环（效果待社区验证）。
> 💰 安装成本：约 3,000 token 地基常驻（128K 窗口的 2.5%）。编排引擎仅 🔴 复杂任务时额外 ~800 token。详见 [Token 预算](./Handbook.md#token-预算参考)。

> ⚠️ **已知局限**：核心效果尚无第三方实测数据；复盘是 LLM 自评，无客观基准；Loop Agent 非独立进程；纯文件约束依赖 Agent 配合；数据明文存储（task/logs + think.md 含任务记录，无加密）；不是多用户系统（共享 .sofagent/ 会交叉污染经验）。详见 [DESIGN §三](./Design.md)。

## 实际效果

> 🌍 朋友说用起来还行，以后要继续用 → [Case 001](./docs/cases/italy-travel-2026-06-18/) · [Evidence.md](./Evidence.md#第三方测试)
> ⚠️ 该案例指标均为 Agent 自评，未经人工核验（v0.54 跑通）

> ⚠️ **以下指标待 v1.0 前由社区填写，作者不自行宣称效果数字。当前全为占位。**

| 指标 | 使用前 | 使用后 | 变化 |
|------|:--:|:--:|:--:|
| 任务完成率 | _待测_ | _待测_ | _待测_ |
| 同一错误重复天数 | _待测_ | _待测_ | _待测_ |
| 单任务 token 浪费 | _待测_ | _待测_ | _待测_ |

> 详见 [Evidence.md](./Evidence.md)——社区用户的实际使用数据。
> 想贡献你的数据？跑满一周后把你的 task/log 貼到 Evidence.md。

---

## 不是什么

- ❌ 不是 AI 框架——不管模型 API、不写 prompt，那是 Model 层的事
- ❌ 不是 Skills 商店——不维护可复用 Skills（内置 task-aware 等核心治理 Skill 除外），外部 Skills 从社区获取
- ✅ 是一套**治理方法**——靠 Skill + 脚本 + 配置三层落地，告诉 Agent 什么能做、什么不能做、什么时候该收手。OpenClaw first，其他平台仅宪法层约束（详见 [Design §三 平台依赖](./Design.md#平台依赖) 能力表）

---

## Quick Start

> 选你的平台，5 步，10 分钟。

### 1. 前置依赖

| 依赖 | 版本要求 | 为什么需要 | 检查命令 |
|------|------|------|------|
| bash | ≥4 | install.sh / load-chain.sh / task-record.sh | `bash --version` |
| git | 任意 | clone 仓库、task/logs 追溯、worktree 隔离 | `git --version` |
| node | ≥18 | `ao compose` 编排引擎（agency-orchestrator）| `node --version` |
| npm | ≥9 | 全局安装 agency-orchestrator | `npm --version` |

> ⚠️ WorkBuddy 用户若不跑编排引擎（只用宪法层约束），node/npm 可不带。OpenClaw / Claude Code / Codex / Hermes 跑复杂任务（🔴）必须有 node + npm。

### 2. git clone

```bash
git clone https://github.com/KongFangXun/sofagent.git
cd sofagent
```

### 3. 安装

```bash
bash sofagent/scripts/install.sh --platform 你的平台
```

| 平台 | 命令 | 说明 |
|------|------|------|
| **OpenClaw** | `bash sofagent/scripts/install.sh` | 自动探测，完整部署（宪法 + Hook + 断路器） |
| **WorkBuddy** | `bash sofagent/scripts/install.sh --platform workbuddy` 或通过技能市场安装 | 部署 SKILL.md 到 `~/.workbuddy/skills/sofagent/` |
| **Claude Code** | `bash sofagent/scripts/install.sh --platform claude` | 部署宪法 + 输出种子指令（需手动粘贴到 CLAUDE.md） |
| **Codex** | `bash sofagent/scripts/install.sh --platform codex` | 部署宪法 + 输出种子指令（需手动粘贴到 AGENTS.md） |
| **Hermes** | `bash sofagent/scripts/install.sh --platform hermes` | 部署宪法 + 输出种子指令（需手动粘贴到 SOUL.md） |

> 未指定 `--platform` 时自动探测。

**install.sh 会改什么文件**：
- OpenClaw：写入 `~/.openclaw/sofagent.md`、`~/.openclaw/rules.md`、`~/.openclaw/skills/sofagent/`（含 6 个 Skill .md + scripts/ + data/ + constitution/）
- WorkBuddy：写入 `~/.workbuddy/skills/sofagent/`（含 SKILL.md + 子目录）
- Claude Code / Codex / Hermes：写入 `~/.claude/`（或 `~/.codex/`、`~/.hermes/`）的宪法文件，并输出种子指令让你手动贴到 CLAUDE.md / AGENTS.md / SOUL.md

### 4. 30 秒 smoke test

```bash
bash sofagent/scripts/verify.sh
```

> 预期：9 类 24+ 检查项全 pass。加 `--json` 可集成到 CI/CD。如果 fail，看 [Handbook §六](./Handbook.md#六常见问题) 排查。

### 5. 跑第一个任务

打开你的 Agent 客户端，试一个需要多步拆解的任务（这样才能看出 sofagent 的编排能力）：

> `/goal` 是 Claude Code 的自主执行命令；OpenClaw 用户可直接描述复杂任务，Agent 会自动触发编排引擎。详见 [Handbook §四](./Handbook.md#四任务目标制定)。

```
/goal 帮我分析一下这个项目的代码质量，生成一份改进建议报告
```

Agent 会自动拆解任务 → 匹配 Skill → 执行 → 反思沉淀。在 OpenClaw 上全程自动；在其他平台部分能力需手动触发（详见 [Design §三 平台依赖](./Design.md#平台依赖) 能力表）。

跑完看结果：

```bash
ls .sofagent/task/logs/        # 按「年-月」分目录的执行日志
cat .sofagent/think.md         # Agent 自动提炼的反思摘要
```

OpenClaw 上全自动，其他平台需手动触发闭环。

---

**跑通了？** [Handbook.md](./Handbook.md) 教你怎么调，[Developer.md](./Developer.md) 讲内部怎么跑，[Design.md](./Design.md) 说为什么这么设计。

---

## 项目结构

```
├── README.md
├── LICENSE                     ← CC-BY-4.0 + MIT 双许可
├── CONTRIBUTING.md
├── Handbook.md        ← 用户手册：怎么用
├── Developer.md       ← 开发者文档：Skill 结构、编排、反思、数据架构
├── Design.md          ← 设计哲学：为什么这么设计
├── Roadmap.md                  ← 路线图：下一步计划和参与方式
├── Evidence.md                 ← 社区用户实际使用数据（待填写）
├── Testing.md                  ← 标准化测试用例
├── docs/                       ← 文档
│   ├── enterprise-deploy.md    ←   企业级部署指南
│   ├── team-deploy.md          ←   技术 VP 落地指南
│   └── cases/                  ←   第三方使用案例
│       └── italy-travel-2026-06-18/ ←     Case 001: 首次全流程跑通证据
├── .github/                    ← GitHub 配置
│   └── ISSUE_TEMPLATE.md       ←   Issue 模板
├── sofagent/                   ← 核心部署文件
│   ├── SKILL.md                ←   🌟 主入口——加载这个就启动整套体系
│   ├── engine.md               ← 完整入口引擎（A→D 初始化 + 子 Skill 索引）
│   ├── entry-gate.md           ←     入境闸门：内部初始化检查
│   ├── task-aware.md           ←     每任务闸门：边界→判级→澄清
│   ├── task-closure.md         ←     离境闸门：调 Loop Agent 收口
│   ├── loop-agent.md           ←     循环顾问：三模式五触发点（checkpoint/failure/closure）
│   ├── constitution/           ←     宪法文件（rules.md 部署到对应平台目录）
│   │   └── rules.md            ←       执行层：模型偏好 + 行为规则（宪法内联在 SKILL.md）
│   ├── data/                   ←     数据模板（格式参考）
│   │   ├── think.md
│   │   ├── scoring.md
│   │   ├── orchestrator.md
│   │   └── task.md
│   └── scripts/                ←     安装和运行脚本
│       ├── install.sh          ←       一键安装（多平台兼容）
│       ├── verify.sh
│       ├── uninstall.sh
│       ├── load-chain.sh       ←       三层加载链（OpenClaw Hook）
│       ├── task-record.sh
│       └── task-orchestrate.sh
└── images/
    └── sofagent.png            ← Logo
```

安装后自动生成的 `.sofagent/` 数据目录：

```
.sofagent/                    ← 运行时数据（Agent 自动维护）
├── think.md                  ←   反思摘要（加载链第 2 层）
├── orchestrator/             ←   编排最优配置沉淀
│   └── workflows/            ←     ao compose 生成的 YAML
├── scoring.md                ←   Skill 使用评分记录
└── task/                     ←   任务计划 + 执行日志
    ├── plans/                ←     澄清阶段产出的任务计划
    └── logs/                 ←     闭环后按天归档的执行记录
```

> 💡 `.sofagent/` 是 Agent 的「工作笔记」——每次任务自动记录，跨任务自动反思沉淀。

> 💡 你看到的 6 个 Skill 文件（1 主 Skill + 5 子 Skill）+ 6 个脚本不是「堆文件」——Skill 文件各管一件事（入境/每任务/离境/Loop），脚本处理确定性操作（安装/验证/记录/编排）。复用了 4 个开源项目做编排、岗位匹配、Skills 发现，自己只写了治理层。详见 [用了哪些外部项目](#用了哪些外部项目)。

---

## 用了哪些外部项目

| 依赖 | 干什么 |
|------|------|
| [OpenClaw](https://github.com/openclaw/openclaw) | Agent 运行时——加载链、Hook、Session 管理 |
| [agency-orchestrator](https://github.com/jnMetaCode/agency-orchestrator)（Apache-2.0） | 任务编排引擎——`ao compose` 一行拆任务、匹配角色 |
| [agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh) | 215 个中文岗位模板 |
| [ClawHub](https://clawhub.ai) / 各平台技能市场 | 外部 Skills 的发现来源——不内置，按需从社区获取 |

---

## 贡献

欢迎提 Issue 和 PR，尤其是挑刺的那种。详见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

---

## 致谢

- [OpenClaw](https://github.com/openclaw/openclaw) by Peter Steinberger — 整个 sofagent 的基石
- [DeepSeek V4 Pro](https://api-docs.deepseek.com/zh-cn/) — 所有文件都是它辅助生成的
- [Andrej Karpathy Skills](https://github.com/multica-ai/andrej-karpathy-skills) — 4 条编码原则是 10 则铁律的根基
- [agency-orchestrator](https://github.com/jnMetaCode/agency-orchestrator) + [agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh) — 任务编排引擎 + 中文岗位库
- [Anthropic Skills](https://github.com/anthropics/skills) — 官方 SKILL.md 格式规范
- [Anthropic Managed Agents](https://www.anthropic.com/engineering/managed-agents) — 四层架构的设计哲学源头
- [Loop Engineering](https://addyo.substack.com/p/loop-engineering) by Addy Osmani — 循环工程五大件，sofagent 编排层的理论源头
- [superpowers](https://github.com/obra/superpowers) — Skill 作为 Harness 杠杆的思路
