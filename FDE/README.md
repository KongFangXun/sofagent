# FDE 工具包

> **中小企业自己做 FDE。** 装上工具包，Agent 带你十步走完 workflow 梳理和 AI 节点识别，找台闲置设备装 sofagent——上面跑的 harness 层管着所有 AI 节点。不需要请顾问，不需要技术背景，能跟着流程走就行。
>
> 你的电脑就是 FDE 工作台——sofagent 在后台帮你拆任务、记反思、沉淀经验。你负责聊业务，Agent 负责出方案。
>
> > 💡 FDE 是什么、为什么重要：[FDE.md](./FDE.md) 开头有完整说明——工头带 AI 员工上岗的比喻、三件工具定位、Rolling AI 等行业实践参考。这里只讲怎么装、怎么用。

---

## 装上就能用

| 平台 | 怎么装 | 怎么激活 |
|------|------|------|
| **OpenClaw** | 终端 `cd` 到仓库目录，`bash fde-install.sh` | 装完直接打开 Agent，自动就绪 |
| **WorkBuddy** | `cp -r FDE/ ~/.workbuddy/skills/sofagent-fde/` | 在 Agent 中输入 `@skill:sofagent-fde` |
| **其他平台** | 复制下方种子指令，粘贴到你的 Agent | Agent 读完后按 §一 引导你部署 |

ClawHub / SkillHub 用户：`clawhub skill install KongFangXun/sofagent-fde` 或 `skillhub install sofagent-fde`。

### 装完之后做什么

1. **激活 Skill** → 按上表对应平台的方法让 Agent 加载 FDE 工作台
2. **Agent 引导** → Agent 会按 [FDE.md](./FDE.md) §一 开始，引导你描述企业基本信息，然后一步步走完十步部署
3. **部署到设备** → 流程走完后，找一台闲置设备（服务器/旧电脑），`bash sofagent/scripts/install.sh` 把 sofagent 装上去——上面开始跑你的 workflow AI 节点

### 种子指令（备选，非 OpenClaw/WorkBuddy 用户使用）

把下面这段粘贴给你的 Agent：

```
请完整阅读 FDE/SKILL.md、FDE/FDE.md、FDE/workflow/template.yaml、FDE/agents/templates.md。
读完后按 FDE.md §一 开始引导我完成 FDE 部署。
```

---

## 文件

| 文件 | 干什么 |
|------|------|
| `SKILL.md` | Skill 入口（Agent 激活后自动加载 3 个文件，第一个说话引导你） |
| `FDE.md` | 十步部署知识文档（§一~§十一，含工头比喻、行业参考、编排引擎说明） |
| `workflow/template.yaml` | 流程模板（Agent 可解析，按步骤拆任务） |
| `agents/templates.md` | 3 个角色（分析师 §一~四 / 规划师 §五~六 / 部署工程师 §七~九） |
| `fde-install.sh` | 一键装 sofagent + 部署模板 |

---

## Webhook（部署完成后配置）

走完 [FDE.md](./FDE.md) 十步流程、设备上的 AI 节点开始运行之后，配置 webhook 让审计结果自动推送到公司群：

```bash
# 群设置 → 群机器人 → 复制 Webhook URL
export SOFAGENT_WEBHOOK_URL="你的 URL"
sofagent-audit --diff HEAD~1..HEAD --webhook dingtalk  # 或 feishu / wecom
```
