# FDE Agent — 你的常驻 AI FDE Agent

> 🔖 **定位**：FDE 是 sofagent 的**部署产品入口**（非独立仓库）。需先 `git clone` sofagent 主仓库，FDE 依赖主仓库的 `sofagent/scripts/install.sh`。

> 🔖 **品牌归属**：FDE（前线部署工程师）是 **sofagent** 底座的产品封装。FDE Agent（由 sofagent 引擎驱动）的所有审计拦截、约束注入、知识沉淀能力均来自 sofagent 引擎——`sofagent-audit`（审计引擎）、`sofagent-harness`（约束底座）、`sofagent-daemon`（知识沉淀）。FDE 做的是"把 sofagent 装到企业设备并撤离"，底层引擎始终是 sofagent。

> **FDE Agent 是建在 sofagent core 上的产品封装——用户得到的是一个常驻 AI FDE Agent，不是一套工具。FDE Agent 是企业用户的唯一入口。**
>
> [sofagent core](../README.md) 是开源（MIT）底座——一底座·四引擎（约束底座 + 编排/审计/回溯/进化引擎），你自己拿去怎么跑都行。FDE 文件夹是建在这个底座上的**产品形态**：把底座能力封装成一个常驻 FDE Agent，帮你梳理工作流、自检合规、持续优化。**人走 FDE 不走。**
>
> 内部由 4 个 Sub Agent 协作（`sofagent-fde` 部署 / `sofagent-audit` 合规审计 / `sofagent-engineer` 代码工程 / `sofagent-reviewer` 代码审查），对外用户只看到一个 FDE Agent 身份。Maker-Checker 分离在内部保持，用户不需要知道。
>
> 🏞️ **River 比喻**：大厂造河（LLM=水，Agent 平台=河床）；sofagent 引擎是堤坝+自来水厂+管网，**FDE Agent 是你家的水龙头**——你唯一打交道的就是它，拧开就有安全的 AI 能力流进业务。
>
> > 💡 FDE 是什么、12 个关键步骤详解：[FDE.md](./FDE.md)。这里只讲怎么装、怎么用。

> 🧭 **v1.2.0 目标结构（方向声明，只声明不搬）**：仓库将收敛为 `/engine/`（现 `sofagent/`，引擎层）+ `/SKILL/`（Skill 统一收敛）+ `install.sh` 提升到仓库根目录；**FDE 交付物将可见化**——按企业实例化落盘（`{企业名}/` 目录承载该企业的工作流梳理、AI 节点配置与交付记录），让企业看得见「我的 AI 化交付了什么」。v1.1.9 仅声明方向，物理迁移在 v1.2.0/v1.2.x 进行。

---

## 前提条件

- **Node.js** >= 18（`node --version` 确认）
- **git**（`git --version` 确认）
- **npm**（`npm --version` 确认）
- **bash**（macOS/Linux 自带，Windows 用 Git Bash）

---

## 安装（需 clone 主仓库）

> ⚠️ 本脚本依赖主仓库的 `sofagent/scripts/install.sh`，请确保已 clone 完整仓库后再从 `FDE/` 目录运行。

| 平台 | 怎么装 | 怎么激活 |
|------|------|------|
| **OpenClaw** | `bash fde-install.sh` | 装完直接打开 Agent，自动就绪 |
| **WorkBuddy** | `bash fde-install.sh --platform workbuddy` 或手动 `cp -r agents/SKILL/sofagent-fde/ ~/.workbuddy/skills/sofagent-fde/` | 在对话中输入 `@sofagent-fde` |
| **其他平台** | 装 sofagent + 复制 SKILL.md 内容到 system prompt | Agent 读完后自动调用 CLI |

`fde-install.sh` 安装完成后，同时安装了两个内置 Agent Skill：`@sofagent-fde`（FDE 部署工程师）和 `@sofagent-audit`（合规审计员）。

### 装完之后做什么

1. **激活 Skill** → 按上表对应平台的方法让 Agent 加载 FDE 工作台
2. **Agent 引导** → Agent 会按 [FDE.md](./FDE.md) §1 开始，引导你描述企业基本信息，然后走完 12 个关键步骤
3. **部署 sofagent 到设备**（核心步骤）→ 流程走完后，找一台闲置设备（服务器/旧电脑），`bash sofagent/scripts/install.sh` 把 sofagent 一底座·四引擎装上去（注：此命令装**底层引擎底座**；FDE 入口本身用 `FDE/fde-install.sh` 安装，见上方安装表）——约束底座 + 编排引擎 + 审计引擎 + 回溯引擎（git snapshot + revert）+ 进化引擎就绪，上面开始跑你的 workflow AI 节点

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
| `FDE.md` | 12 个关键步骤部署知识文档（4 个阶段：进场→挖掘→交付→检查离场）+ 角色定义 + 步骤详解 |
| `templates/` | 交付物模板（企业画像 + 部署方案 + 工作流节点文档 + 企业 Skill），以 FDE 自身为案例 |
| `fde-install.sh` | 一键装 sofagent + 写入 fde.md |

---

## 部署验证

部署完成后，按以下步骤确认 sofagent 在工作：

1. **hook 就位检查**：
   ```bash
   ls .git/hooks/commit-msg .git/hooks/post-commit
   sofagent-audit --doctor
   ```

2. **审计拦截测试**（在测试仓库，非生产代码）：
   ```bash
   echo "API_KEY=sk-123456" > .env && git add -f .env && GIT_EDITOR=true git commit -m "test"
   # 预期：A1 拦截提交
   ```

3. **daemon 运行确认**（如装了 daemon）：
   ```bash
   sofagent-daemon --doctor   # 或检查 launchd/systemd 状态
   ```

4. **审计历史查看**：
   ```bash
   sofagent-audit --timeline   # 应有快照记录
   ```

如果以上 4 步全绿，sofagent 已正常工作。

---

## Webhook（部署完成后配置）

> ⏰ **版本提示（v1.1.x）**：完整的 Webhook 推送到企业协同平台（钉钉/飞书/企业微信）能力规划在 **v1.2.x**。
> 当前版本审计结果可通过以下方式获取：
> - `daemon-notice.md`（daemon 自动写入本地通知文件）
> - 终端 stdout（实时审计输出）
> - `sofagent-audit --timeline`（历史快照查看）
> - 手动轮询 `.sofagent/audit/history.jsonl`（JSONL 明文，可用 filebeat/logstash 转发到 SIEM）
>
> 如需 Webhook 推送，请等待 v1.2.x 或使用 history.jsonl 手动转发方案。

走完 [FDE.md](./FDE.md) 12 个关键步骤、设备上的 AI 节点开始运行之后，配置 webhook 让审计结果自动推送到公司群：

```bash
# 群设置 → 群机器人 → 复制 Webhook URL
export SOFAGENT_WEBHOOK_URL="你的 URL"
sofagent-audit --diff HEAD~1..HEAD --webhook dingtalk  # 或 feishu / wecom
```
