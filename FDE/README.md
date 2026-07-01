# FDE 工具包

> **中小企业自己做 FDE。** 装上工具包，Agent 带你十步走完 workflow 梳理和 AI 节点识别，找台闲置设备装 sofagent——上面跑的 harness 层管着所有 AI 节点。不需要请顾问，不需要技术背景，能跟着流程走就行。
>
> 你的电脑就是 FDE 工作台——sofagent 在后台帮你拆任务、记反思、沉淀经验。你负责聊业务，Agent 负责出方案。

---

## 装上就能用

| 平台 | 怎么装 | 怎么激活 |
|------|------|------|
| **OpenClaw** | `bash fde-install.sh` | 装完直接打开 Agent，自动就绪 |
| **WorkBuddy** | `cp -r FDE/ ~/.workbuddy/skills/sofagent-fde/` | `@skill:sofagent-fde` |
| **Codex / 其他** | 复制下面的种子指令 | 粘贴到 Agent |

ClawHub / SkillHub 用户：`clawhub skill install KongFangXun/sofagent-fde` 或 `skillhub install sofagent-fde`。

### 种子指令（备选）

```
请完整阅读 FDE/SKILL.md、FDE/FDE.md、FDE/workflow/template.yaml、FDE/agents/templates.md。
读完后按 FDE.md §一 开始引导我完成 FDE 部署。
```

---

## 文件

| 文件 | 干什么 |
|------|------|
| `SKILL.md` | Skill 入口（Agent 激活后自动加载 3 个文件，第一个说话引导你） |
| `FDE.md` | 十步部署知识文档（§一~§十一） |
| `workflow/template.yaml` | 流程模板（Agent 可解析，按步骤拆任务） |
| `agents/templates.md` | 3 个角色（分析师 §一~四 / 规划师 §五~六 / 部署工程师 §七~九） |
| `fde-install.sh` | 一键装 sofagent + 部署模板 |

---

## Webhook

部署完成后配置，审计结果自动推送到公司群：

```bash
# 群设置 → 群机器人 → 复制 Webhook URL
export SOFAGENT_WEBHOOK_URL="你的 URL"
sofagent-audit --diff HEAD~1..HEAD --webhook dingtalk  # 或 feishu / wecom
```
