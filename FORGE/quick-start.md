# FORGE 快速入门 · 环境配置与 A/B 异构模型接入

> 本文覆盖 A/B 异构模型接入、环境变量、driver 启动——这些是 FORGE fresh-eyes-loop 的运行基础。循环协议详见 `FORGE/SKILL/fresh-eyes-loop/loop.md`。

---

## 第一步：确认安装

```bash
# 确认 sofagent 底座已装
sofagent-audit --version   # 应输出 v1.2.0 或更高

# 没用？装一下
bash install.sh
```

## 第二步：设 A/B 异构模型

fresh-eyes-loop 的核心设计是 **A/B 异构模型**——审查（A）和修复（B）使用不同厂商的模型，减少同模型盲区（同一模型的训练偏差在自审时会被跳过，但跨模型审查能互相发现对方遗漏的问题）。

| 角色 | 职责 | 推荐能力 | 示例模型 + 端点 |
|:--:|------|------|------|
| **A**（审查者） | 12 视角审查 + 合并 + 验证 | 强推理 + 中文理解 | 审查类模型，如 `https://<your-provider>/v1/` |
| **B**（工程师） | 修复缺陷 | 强编码 + 最小变更 | 工程类模型，如 `https://<your-provider>/v1/` |

> 💡 **A/B 必须异构**：审查和修复使用不同厂商的模型，减少同模型盲区。具体选什么模型由你决定——sofagent 不绑定任何特定模型，只要兼容 OpenAI 格式即可。下方示例用占位符演示配置方式。

### 配置环境变量

```bash
# A（审查者）= 你选的审查类模型
export SOFAGENT_LLM_A=<provider>:<model-name>
export SOFAGENT_LLM_A_API_KEY=your-key

# B（工程师）= 你选的工程类模型（必须与 A 不同厂商）
export SOFAGENT_LLM_B=<provider>:<model-name>
export SOFAGENT_LLM_B_API_KEY=your-key
```

> **为什么是异构**：如果 A 和 B 用同一个模型，该模型在训练时遗漏的 bug 类型会在自审中被再次遗漏——"fresh-eyes"的前提就是审查者换了一双不同的眼睛。A 审 B 写的代码、B 审 A 写的代码，交叉视角才能覆盖单模型盲区。

### 模型参数

| 角色 | 模型类型 | 关键参数 |
|:--:|------|------|
| A | 审查类（强推理） | `temperature=1.0`（审查需要发散，不收敛到单一视角） |
| B | 工程类（强编码） | `thinking.enabled=true` + `reasoning_effort=high`（修复需要深度推理） |

> 这些参数由 driver 自动注入，用户无需手动配置。如需覆盖默认参数，在 `FORGE/src/fresh-eyes-driver.mjs` 的 `MODEL_CONFIG` 中修改。

### 模型定价与计费模式

每轮循环的 token 用量会被准确记录。**成本**的估算方式取决于各模型的计费模式：

| 模型类型 | 计费模式 | 说明 |
|------|:--:|------|
| **A**（订阅制模型） | 📦 订阅制 | 按月固定费用 + 额度，**不按 token 扣费**。driver 对 A 只记录 token 用量，`cost_cny` 记为 `null`，`price_confidence` 标为 `subscription` |
| **B**（按量计费模型） | 💧 按量计费 | driver 按「官方标价 × token 用量」算出 `cost_cny` 估算值。实际账单受**缓存命中率**影响，以厂商 API 后台为准 |

> ⚠️ **计费模式区分（重要）**：
> - **token 是客观事实，成本是主观语义**：无论什么计费模式，用了多少 token 是确定的；但硬把订阅制和按量制凑成一个总成本数字会误导，所以 driver 只展示 token 总量 + B 的按量成本
> - 具体定价查阅你所选模型的厂商官方定价页

### API key 加载优先级（三级回退）

```
SOFAGENT_LLM_{ROLE}_API_KEY  >  SOFAGENT_LLM_API_KEY  >  OPENAI_API_KEY
   角色专用 key（A/B 分账）     通用 key（共用一把）     OpenAI 兼容默认
```

A 和 B 可以用不同 key（分账号计费）。如果只有一个 key 且两个 provider 都兼容 OpenAI 格式，设 `OPENAI_API_KEY` 即可，A/B 共用。

### API Key 透明度

- key 仅存在本地环境变量（`~/.zshrc` 或 `~/.bashrc`），**不进代码、不进 git、不进日志**
- key 仅用于调用配置的 LLM API 的 HTTPS 请求（请求头 `Authorization: Bearer <key>`）
- **不上传、不转发、不记录到第三方**——sofagent 无后端服务器
- 详细的 key 管理和安全承诺见根目录 [`SECURITY.md`](../SECURITY.md) §六「LLM API Key 透明度」

---

## 第三步：跑循环

driver（`FORGE/src/fresh-eyes-driver.mjs`）会自动 spawn 独立子进程跑每个 step——每个 step 都是全新的 Node 进程，**真零上下文**（不是同一 session 内换 prompt，而是彻底重启进程）。

```bash
# 一键启动（driver 自动起 A/B 子进程）
node FORGE/src/fresh-eyes-driver.mjs --target v1.2.0 --max-rounds 10

# 先 dry-run 看流程（不实际调用 LLM，只打印 step 序列）
node FORGE/src/fresh-eyes-driver.mjs --target v1.2.0 --dry-run
```

**driver 参数**：

| 参数 | 说明 | 默认值 |
|------|------|------|
| `--target` | 目标版本号（如 `v1.2.0`），用于 run 目录命名 | 必填 |
| `--max-rounds` | 最大循环轮次 | `10` |
| `--dry-run` | 只打印 step 序列，不调用 LLM | `false` |

**单轮协议**（driver 自动编排，无需手动 relay）：

```
a-check     → A（审查模型）独立跑 12 视角审查，输出 findings.jsonl
b-check     → B（工程模型）独立跑 12 视角审查，输出 findings.jsonl
a-consolidate → A 合并 A+B findings，去重排序，输出 consolidated.jsonl
b-fix       → B 按 consolidated.jsonl 修复，输出 diff patch
a-verify    → A 验证修复结果，判定本轮是否 PASS
            → 连续 2 轮无 P0/P1 → 停止
```

产物写到 `runs/YYYY/MM/DD/run-NN/` 目录下，每个 step 有独立的 `.jsonl` 产物文件。

### Usage 成本透明

每轮循环的 token 用量和成本会记录到 `runs/.../run-NN/usage.jsonl`，每行一条记录：

```json
{
  "ts": "2026-07-24T12:34:56.789Z",
  "target": "v1.2.0",
  "round": 1,
  "step": "a-check",
  "role": "A",
  "model": "<你配置的模型名>",
  "api_base": "open.bigmodel.cn",
  "prompt_tokens": 12450,
  "completion_tokens": 1820,
  "total_tokens": 14270,
  "cost_cny": null,
  "price_confidence": "subscription",
  "latency_ms": 8400
}
```

| 字段 | 说明 |
|------|------|
| `role` | 角色标识（`A` = 审查者 / `B` = 工程师） |
| `model` | 模型名（你配置的 `<provider>:<model-name>`） |
| `prompt_tokens` | 输入 token 数 |
| `completion_tokens` | 输出 token 数 |
| `total_tokens` | prompt + completion 合计 |
| `cost_cny` | 本条调用的估算成本（人民币元）。订阅制模型记为 `null` |
| `price_confidence` | `subscription` = 订阅制（不按 token 扣费）/ `estimated` = 按量估算（官方标价 × token）/ `no-pricing` = 未知模型无法估算 |
| `latency_ms` | API 响应延迟（毫秒） |

跑完后 driver 会在 stdout 打印**用量摘要**（token 为主，成本按计费模式区分展示）：

```
[总用量] tokens: 68,940  (A 订阅 + B 按量 ¥0.0089)
         A(审查模型):       47,640 tokens  [订阅额度]
         B(工程模型):   21,300 tokens  ¥0.0089 [按量计费]
```

---

## 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| `SOFAGENT_LLM_A_API_KEY` 未设 | 没配 A 角色的 key | `export SOFAGENT_LLM_A_API_KEY=your-key` |
| `SOFAGENT_LLM_B_API_KEY` 未设 | 没配 B 角色的 key | `export SOFAGENT_LLM_B_API_KEY=your-key` |
| driver 找不到 `node` 命令 | Node.js 未安装或不在 PATH | 装 Node.js ≥ 18（`brew install node` / `nvm install 18`） |
| A/B 用了同一个模型 | 两个角色配了同一个 `SOFAGENT_LLM_*` | 检查 A/B 是否指向不同厂商模型——异构是设计要求 |
| reviewer 每轮都驳回 | 审查标准太严 | 改 `SKILL/agents/reviewer/SKILL.md` 的判定标准 |
| API key 报 401 | key 过期或额度耗尽 | 去对应厂商控制台检查 key 状态和余额 |
| usage.jsonl 中 `price_confidence: no-pricing` | 该模型不在 `MODEL_PRICING` 表里 | 查阅厂商官方定价页，在 driver 内补上 |
| A 返回 error 1113「余额不足」| 审查模型端点写错 | 检查 A 的 `baseURL` 是否与你的模型供应商文档一致（订阅制端点 vs 按量端点可能不同） |
| sofagent-audit 命令未找到 | 底座没装 | `bash install.sh` |

> 📖 详细设计见 `FORGE/archive/self-evolution-design.md`（旧自迭代模型，保留参考）和 `FORGE/SKILL/fresh-eyes-loop/loop.md`（当前循环协议）。
