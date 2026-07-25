# FORGE 快速入门 · 环境配置与模型接入

> 本文覆盖 LLM 接入、环境变量、provider 配置——这些是 FORGE 所有 sub-agent（engineer / reviewer）的通用基础。具体的循环使用方式见各循环的 `loop.md`（当前唯一循环：`FORGE/SKILL/fresh-eyes-loop/loop.md`）。

---

## 第一步：确认安装

```bash
# 确认 sofagent 底座已装
sofagent-audit --version   # 应输出 v1.2.0 或更高

# 没用？装一下
bash install.sh
```

## 第二步：设模型

FORGE 的 sub-agent（engineer 写代码、reviewer 审查）需要 LLM 能力。每个角色可以指定不同模型。

**最简路径（推荐 · 一个 key 即可）**：

```bash
# 1. 设模型（engineer 写代码用性价比模型，reviewer 审查用推理能力更强的模型）
export SOFAGENT_LLM_ENGINEER=deepseek:deepseek-chat
export SOFAGENT_LLM_REVIEWER=glm:glm-4-flash

# 2. API key——直接用 OPENAI_API_KEY，所有 OpenAI 兼容 API 通用
#    （DeepSeek/GLM/Kimi/OpenRouter/Together/vLLM/Ollama 都是 OpenAI 兼容协议）
export OPENAI_API_KEY=sk-xxx

# 3. 全自动模式
export LOOP_AUTO=1
```

**为什么是 `OPENAI_API_KEY`**：OpenAI API 格式已经是事实标准——所有主流模型供应商都提供兼容 endpoint。OpenAI SDK 默认读这个环境变量，所以用它作为统一入口最省事。你的 key 不会发到 OpenAI，只发到你 `SOFAGENT_LLM_*` 指定的 provider。

**API key 解析优先级（三级回退）**：

```
SOFAGENT_LLM_{ROLE}_API_KEY  >  SOFAGENT_LLM_API_KEY  >  OPENAI_API_KEY
   角色专用 key（分账）         通用 key（共用一个）      OpenAI 兼容默认（推荐入门）
```

engineer 和 reviewer 可以用不同 key（分账号计费）。同理 reviewer 用 `SOFAGENT_LLM_REVIEWER_API_KEY`。

---

### 高级用法

**engineer 和 reviewer 用不同账号分账**（例如开发用便宜账号、审查用高质量账号）：

```bash
# 不设 OPENAI_API_KEY，改用角色专用 key
export SOFAGENT_LLM_ENGINEER_API_KEY=sk-cheap-account
export SOFAGENT_LLM_REVIEWER_API_KEY=sk-premium-account
```

**custom provider**（不在预置 provider 列表的模型）：

预置 provider（`deepseek`/`glm`/`kimi`）覆盖大部分场景。如果你用的模型不在预置列表（本地部署、企业内网、OpenRouter、Together AI、第三方兼容 API），用 `custom`：

```bash
export SOFAGENT_LLM_ENGINEER=custom:your-model-name
export SOFAGENT_LLM_BASE_URL=https://your-endpoint/v1/
export OPENAI_API_KEY=sk-xxx
```

`custom` provider 不会硬编码任何厂商假设——只要你给的 base URL 和 model name 能被 OpenAI SDK 识别，就能用。

## 第三步：跑循环

当前唯一可用的质量循环是 **fresh-eyes-loop**。它不是通过 CLI 命令跑的——而是 driver（你）按协议在 A/B 之间 relay。

```bash
# 1. 读协议
cat FORGE/SKILL/fresh-eyes-loop/loop.md

# 2. 开两个 session，分别注入 prompt：
#    A: FORGE/SKILL/fresh-eyes-loop/prompts/a-check.md
#    B: FORGE/SKILL/fresh-eyes-loop/prompts/b-check.md

# 3. 按 loop.md 的「单轮协议」走：审查 → 合并 → 修复 → 验证 → 判定停止
```

> 💡 未来可通过 DeepAgents orchestrator 自动化这套 relay 流程。现阶段手动驱动即可。

## LOOP_AUTO 行为说明

```
LOOP_AUTO=1   → 全自动模式（sub-agent 自主判定 IS_PASS，不等人按 y/n）
未设或=0      → stdin readline 等待人工确认 y/n，不限时
               stdin 关闭视为 abort
```

---

## 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| sub-agent 不干活 | 没设 `SOFAGENT_LLM_*` | 设 env var |
| API key 报错 | `OPENAI_API_KEY` 没设（或角色专用 key 没设） | 最简：`export OPENAI_API_KEY=sk-xxx` |
| reviewer 每轮都驳回 | 审查标准太严 | 改 `SKILL/agents/reviewer/SKILL.md` 的判定标准 |
| 用的模型不在预置 provider 列表 | 只支持 deepseek/glm/kimi 预置 | 用 `custom:<model>` + `SOFAGENT_LLM_BASE_URL` |
| sofagent-audit 命令未找到 | 底座没装 | `bash install.sh` |

> 📖 详细设计见 `FORGE/FORGE.md`（旧自迭代模型，保留参考）和 `FORGE/SKILL/fresh-eyes-loop/loop.md`（当前循环协议）。
