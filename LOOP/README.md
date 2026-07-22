# LOOP — sofagent 自迭代工具包

> 🔒 **对外叙事边界**：LOOP 不出现在任何对外（用户/买家）叙事中——对外只有 FDE Agent；LOOP 是 sofagent 项目内部的自迭代开发工具包。

> 🔖 **定位**：LOOP 是 sofagent 的**开发者自迭代入口**（非独立仓库）。需先 `git clone` sofagent 主仓库，LOOP 依赖主仓库的编排引擎和审计引擎。

> 🔖 **品牌归属**：LOOP（自迭代编排）是 **sofagent** 底座的产品封装。LOOP 的 engineer→audit→reviewer 循环由 `sofagent-orchestrator` 编排引擎驱动，每个节点的审计卡关由 `sofagent-audit` 执行。LOOP 做的是"持续自迭代优化 Agent 定义"，底层引擎始终是 sofagent。

> **LOOP 是 sofagent 项目的自迭代开发工具包**——用 sofagent 的审计引擎和 Sub Agent 能力，自动执行 WorkBuddy 等外部平台编排好的开发任务。**不泛化为「任何项目」的通用工具**：LOOP 管理的是 sofagent 自己的代码变更（PRD → 架构 → 编码 → 审查 → 发版），服务的是 sofagent 项目的开发者，不是交给企业终端用户的产品。
>
> **边界**：LOOP 给开发者用（管理代码变更），不给终端用户——企业用户的入口是 [FDE Agent](../FDE/README.md)；`LOOP/loop-install.sh` 是三个安装包中唯一装 LOOP 的（开发者专用），`install.sh` 与 `FDE/fde-install.sh` 均不自动装 LOOP。
>
> 📦 **发版工具链方向声明（只声明不搬）**：发版 SOP 与发布工程师（sofagent-releaser）链路将归入 `LOOP/releaser/`——发版属于开发链路，理应由 LOOP 承载。v1.1.9 仅声明方向，物理归位在 v1.2.0 进行。
>
> **LOOP 是 sofagent 的自迭代部署入口（非独立产品）。** 需先 `git clone` 主仓库，再从 `LOOP/` 目录运行（依赖主仓库 `sofagent/scripts/install.sh`）；单独 clone `LOOP/` 子目录会因缺少主仓库依赖而跑不通。

## 快速开始

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
| `sofagent-engineer` | 软件工程师——写代码、修复 | `agents/SKILL/sofagent-engineer/SKILL.md` |
| `sofagent-reviewer` | 代码审查员——审查 + 自动门控 | `agents/SKILL/sofagent-reviewer/SKILL.md` |
| `sofagent-audit` | 合规审计员——A1-A11、A14-A19 规则检查 | `agents/SKILL/sofagent-audit/SKILL.md` |
| `sofagent-releaser` | 发布工程师——十二阶段发版 SOP（v1.1.5 新增，按需激活） | `agents/SKILL/sofagent-releaser/SKILL.md` |

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
