# LOOP 快速入门 · 5 分钟把自迭代跑起来

> 你已经装了 sofagent 底座和 LOOP Skill。这篇文章告诉你第一条 workflow 怎么跑起来。

---

## 第一步：确认安装

```bash
# 确认 sofagent 底座已装
sofagent-audit --version   # 应输出 v1.1.4 或更高

# 没用？装一下
bash LOOP/loop-install.sh
```

## 第二步：准备 workflow

LOOP 的编排智能来自外部平台（WorkBuddy 等）。你在 WorkBuddy 的软件开发团队里做完 PRD → 架构设计，拿到任务列表，写成 `workflow.yml`：

```yaml
workflow:
  name: "示例：新增一条审计规则"
  nodes:
    - id: T1
      task: "在 rules/ 下新建 rule-a22.ts，定义 checkRuleA22"
    - id: T2
      task: "在 rules/index.ts 中注册 A22"
      depends_on: [T1]
    - id: T3
      task: "在 runner.ts 中调整优先级"
      depends_on: [T2]
```

## 第三步：设模型 + 跑

**最简路径（推荐 · 一个 key 搞定）**：

```bash
# 1. 设模型（engineer 写代码用性价比模型，reviewer 审查用推理能力更强的模型）
export SOFAGENT_LLM_ENGINEER=deepseek:deepseek-chat
export SOFAGENT_LLM_REVIEWER=glm:glm-4-flash

# 2. API key——直接用 OPENAI_API_KEY，所有 OpenAI 兼容 API 通用
#    （DeepSeek/GLM/Kimi/OpenRouter/Together/vLLM/Ollama 都是 OpenAI 兼容协议）
export OPENAI_API_KEY=sk-xxx

# 3. 全自动模式
export LOOP_AUTO=1

# 跑
sofagent-orchestrator loop --task "你的任务描述"
```

LOOP 自动流转：engineer 写代码 → audit 审计 → reviewer 审查 → IS_PASS → 完成 / IS_PASS:NO → 回 engineer 修复。

**为什么是 `OPENAI_API_KEY`**：OpenAI API 格式已经是事实标准——所有主流模型供应商都提供兼容 endpoint。OpenAI SDK 默认读这个环境变量，所以用它作为统一入口最省事。你的 key 不会发到 OpenAI，只发到你 `SOFAGENT_LLM_*` 指定的 provider。

---

### 高级用法（可选）

**engineer 和 reviewer 用不同账号分账**（例如开发用便宜账号、审查用高质量账号）：

```bash
# 不设 OPENAI_API_KEY，改用角色专用 key
export SOFAGENT_LLM_ENGINEER_API_KEY=sk-cheap-account
export SOFAGENT_LLM_REVIEWER_API_KEY=sk-premium-account
```

**完整 fallback 顺序**（任一命中即可，不用都设）：

```
SOFAGENT_LLM_{ROLE}_API_KEY  >  SOFAGENT_LLM_API_KEY  >  OPENAI_API_KEY
   角色专用 key（分账）         通用 key（共用一个）      OpenAI 兼容默认（推荐入门）
```

## 第四步（可选）：custom provider

预置 provider（`deepseek`/`glm`/`kimi`）覆盖大部分场景。如果你用的模型不在预置列表（本地部署、企业内网、OpenRouter、Together AI、第三方兼容 API），用 `custom`：

```bash
export SOFAGENT_LLM_ENGINEER=custom:your-model-name
export SOFAGENT_LLM_BASE_URL=https://your-endpoint/v1/
export OPENAI_API_KEY=sk-xxx
```

`custom` provider 不会硬编码任何厂商假设——只要你给的 base URL 和 model name 能被 OpenAI SDK 识别，就能用。

## 怎么用 workflow 模式

Workflow 模式是 LOOP 的高级用法——外部编排平台产出 workflow.yml → LOOP 外层循环逐个执行子任务。这个功能由 `LOOP/src/workflow.ts` 提供，需要在 sofagent 底座的基础上额外配置。

```
编排层（WorkBuddy）产出 workflow.yml
  → LOOP 引擎逐个执行子任务
    → engineer(audit → reviewer) → ✅/❌
    → 下一个子任务...
```

## 内置 Agent

LOOP 带有 3 个内置 Agent Skill，装在 `agents/SKILL/` 下：

| Skill | 角色 | 模型建议 |
|-------|------|---------|
| `sofagent-engineer` | 软件工程师——写代码、修复、build/test | 性价比模型（量大、任务明确） |
| `sofagent-reviewer` | 代码审查员——审查 + IS_PASS 判定 | 推理能力更强的模型（判断需要深思） |
| `sofagent-audit` | 合规审计员——A1-A11、A14-A19 规则检查 | 本地（不调 LLM） |

> 💡 如需 Workflow 优化（sofagent-fde），用 `bash FDE/fde-install.sh` 单独装。

## 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| `sofagent-orchestrator` 未找到 | sofagent 底座没装 | `bash LOOP/loop-install.sh` |
| engineer 不干活 | 没设 `SOFAGENT_LLM_ENGINEER` | 设 env var |
| API key 报错 | `OPENAI_API_KEY` 没设（或角色专用 key 没设） | 最简：`export OPENAI_API_KEY=sk-xxx` |
| reviewer 每轮都驳回 | 审查标准太严 | 改 `agents/SKILL/sofagent-reviewer/SKILL.md` 的判定标准 |
| LOOP_AUTO=0 时卡住 | 需要人工按 y/n | 设 `LOOP_AUTO=1` 或手动确认 |
| 用的模型不在预置 provider 列表 | 只支持 deepseek/glm/kimi 预置 | 用 `custom:<model>` + `SOFAGENT_LLM_BASE_URL` |
