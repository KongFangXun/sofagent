# LOOP — sofagent 自迭代工具包

> **LOOP 是 sofagent 项目的开发者自迭代工具包**——自动执行 engineer→audit���reviewer 循环，管理 sofagent 自己的代码变更。用 sofagent 的引擎驱动，不面向终端用户。企业用户的入口是 [FDE Agent](../FDE/README.md)。

## 快速开始

LOOP 装完后，你可以派一个开发任务（比如"在 README 加一段简介"），LOOP 自动跑完 engineer 写代码 → audit 审计 → reviewer 审查的循环。

```bash
# 1. 一键安装（会引导你配置 LLM provider + API key）
bash LOOP/loop-install.sh

# 2. 如果跳过了安装向导，手动设模型 + key
#    engineer（写代码）建议性价比模型，reviewer（审查）建议推理能力更强的模型
export SOFAGENT_LLM_ENGINEER=deepseek:deepseek-chat
export SOFAGENT_LLM_REVIEWER=glm:glm-4-flash
#    OpenAI API 格式是事实标准——所有主流模型供应商都兼容，统一用 OPENAI_API_KEY 入口
export OPENAI_API_KEY=sk-xxx
export LOOP_AUTO=1                                    # 全自动

# API key 解析优先级（三级回退）：
#   SOFAGENT_LLM_ENGINEER_API_KEY ← 角色专用（推荐）
#     ↓ 找不到
#   SOFAGENT_LLM_API_KEY           ← 通用
#     ↓ 找不到
#   OPENAI_API_KEY                 ← 兜底（OpenAI 兼容 API 的事实标准入口）
# engineer 和 reviewer 可以用不同 key（分账号计费）。
# 同理 reviewer 用 SOFAGENT_LLM_REVIEWER_API_KEY。
# 三个都没设 → 节点降级到零工具路径（输出加 [降级运行] 前缀）。

# LOOP_AUTO 自动判定行为：
#   LOOP_AUTO=1 时 human_confirm 节点不等待人工，直接解析 reviewer 报告里的 IS_PASS：
#     IS_PASS: YES   → ✅ 通过，进 completed 终态
#     IS_PASS: NO    → 🔄 驳回，回 engineer 修复
#     无法解析        → 🔄 保守默认驳回（不瞎放行）
#   未设 LOOP_AUTO 时走 stdin readline 等待人工 y/n，不限时——
#   stdin 关闭视为 abort，checkpoint 已保存，可 loop --resume 恢复。

# 3. 跑单任务
sofagent-orchestrator loop --task "在 README.md 第三行后加一条项目简介"
```

LOOP 自动流转：engineer 写代码 → audit 审计 → reviewer 审查 → 人工确认（`LOOP_AUTO=1` 时按 `IS_PASS` 自动判定，见上方注释）。

**一个 key 走天下**：DeepSeek / GLM / Kimi / OpenRouter / Together / 本地 vLLM / Ollama 都是 OpenAI 兼容 API，一把 `OPENAI_API_KEY` 就能跑——key 只发到你 `SOFAGENT_LLM_*` 指定的 provider，不会发到 OpenAI。

**engineer/reviewer 分账号**（可选高级用法）见 `LOOP/quick-start.md` 高级用法小节。

**不局限于预置 provider**：任何 OpenAI 兼容 API 都能用 `custom:<model>` + `SOFAGENT_LLM_BASE_URL` 接入。详见 `LOOP/quick-start.md` 第四步。

## 内置 Agent

> 注意：LOOP 的 4 个 Agent Skill（sofagent-engineer / sofagent-reviewer / sofagent-audit / sofagent-releaser）与 FDE 的 4 个（sofagent-fde / sofagent-audit / sofagent-engineer / sofagent-reviewer）有重叠但不完全相同——LOOP 有发布工程师（releaser），FDE 有部署工程师（fde）。两者共享 sofagent-audit / sofagent-engineer / sofagent-reviewer 三个 Skill。

| Skill | 角色 | 位置 |
|-------|------|------|
| `sofagent-engineer` | 软件工程师——写代码、修复 | `SKILL/agents/engineer/SKILL.md` |
| `sofagent-reviewer` | 代码审查员——审查 + 自动门控 | `SKILL/agents/reviewer/SKILL.md` |
| `sofagent-audit` | 合规审计员——A1-A11、A14-A19 规则检查 | `SKILL/agents/audit/SKILL.md` |
| `sofagent-releaser` | 发布工程师——十二阶段发版 SOP（v1.1.5 新增，按需激活） | `LOOP/releaser/releaser-skill/SKILL.md` |

## 怎么用 workflow 模式（高级）

编排层（WorkBuddy 等）产出 workflow.yml → LOOP 引擎外层循环逐个执行子任务。

```bash
# workflow 模式由 LOOP/src/workflow.ts 提供
# 需在 sofagent 底座基础上额外配置
```

详细文档见 `LOOP/LOOP.md`，快速入门见 `LOOP/quick-start.md`。

## 目录

```
LOOP/
  README.md                     ← 你在这里
  loop-install.sh               ← 一键安装
  SKILL.md                      ← Skill 定义
  quick-start.md                ← 快速入门
  LOOP.md                       ← 设计文档
  src/
    types.ts / workflow.ts      ← 运行时代码
```
