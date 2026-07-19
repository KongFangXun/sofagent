# FDE 工具包

> **FDE 工具包本身就是 sofagent 产品的一部分。**
>
> sofagent 是一底座·两能力·三引擎组成的治理系统——约束底座管行为，编排引擎拆任务，审计引擎盯变更，回溯能力保安全，质评能力度质量，进化引擎持续优化。FDE 用这个工具包帮企业梳理工作流、构建本体模型、识别节点与量化、装上底座。**FDE 工作用自己产品，给别人部署完让别人也用自己产品。**
>
> 整个逻辑是嵌套的：FDE 本身也是一个 workflow（12 步），FDE 走这 12 步时用的就是 sofagent。走完之后，帮企业在闲置设备上装上同一个 sofagent——底座跑起来，客户的 AI 节点在上面干活。
>
> > 💡 FDE 是什么、12 步流程详解：[FDE.md](./FDE.md)。这里只讲怎么装、怎么用。

---

## 前提条件

- **Node.js** >= 18（`node --version` 确认）
- **git**（`git --version` 确认）
- **npm**（`npm --version` 确认）
- **bash**（macOS/Linux 自带，Windows 用 Git Bash）

---

## 装上就能用

| 平台 | 怎么装 | 怎么激活 |
|------|------|------|
| **OpenClaw** | `bash fde-install.sh` | 装完直接打开 Agent，自动就绪 |
| **WorkBuddy** | `bash fde-install.sh --platform workbuddy` 或手动 `cp -r agents/SKILL/sofagent-fde/ ~/.workbuddy/skills/sofagent-fde/` | 在对话中输入 `@sofagent-fde` |
| **其他平台** | 装 sofagent + 复制 SKILL.md 内容到 system prompt | Agent 读完后自动调用 CLI |

`fde-install.sh` 安装完成后，同时安装了两个内置 Agent Skill：`@sofagent-fde`（FDE 部署工程师）和 `@sofagent-audit`（合规审计员）。

### 装完之后做什么

1. **激活 Skill** → 按上表对应平台的方法让 Agent 加载 FDE 工作台
2. **Agent 引导** → Agent 会按 [FDE.md](./FDE.md) §1 开始，引导你描述企业基本信息，然后一步步走完 12 步部署
3. **部署 sofagent 到设备**（核心步骤）→ 流程走完后，找一台闲置设备（服务器/旧电脑），`bash sofagent/scripts/install.sh` 把 sofagent 一底座·两能力·三引擎装上去——约束底座 + 编排引擎 + 审计引擎 + 回溯能力 + 质评能力 + 进化引擎就绪，上面开始跑你的 workflow AI 节点

### 种子指令（备选，非 OpenClaw/WorkBuddy 用户使用）

把下面这段粘贴给你的 Agent：

```
请完整阅读 FDE/SKILL.md、FDE/FDE.md。
读完后按 FDE.md §1 开始引导我完成 FDE 部署。
```

---

## 文件

| 文件 | 干什么 |
|------|------|
| `SKILL.md` | Skill 入口（Agent 激活后自动加载，第一个说话引导你） |
| `FDE.md` | 12 步部署知识文档（4 阶段：进场→挖掘→交付→检查离场）+ 角色定义 + 步骤详解 |
| `templates/` | 交付物模板（企业画像 + 部署方案 + 工作流节点文档 + 企业 Skill），以 FDE 自身为案例 |
| `fde-install.sh` | 一键装 sofagent + 写入 fde.md |

---

## Webhook（部署完成后配置）

走完 [FDE.md](./FDE.md) 12 步流程、设备上的 AI 节点开始运行之后，配置 webhook 让审计结果自动推送到公司群：

```bash
# 群设置 → 群机器人 → 复制 Webhook URL
export SOFAGENT_WEBHOOK_URL="你的 URL"
sofagent-audit --diff HEAD~1..HEAD --webhook dingtalk  # 或 feishu / wecom
```
