# FORGE 快速入门 · 环境配置与模型接入

> 本文覆盖模型接入、环境变量、driver 启动——这些是 FORGE 两个内环（fresh-eyes-loop 质量循环 + release-gate-loop 发版闸门）的运行基础。循环协议详见各自 `FORGE/SKILL/<loop>/loop.md`。

---

## 第一步：确认安装

```bash
# 确认 sofagent 底座已装
sofagent-audit --version   # 应输出 v1.3.6 或更高

# 没用？装一下
bash install.sh
```

## 第二步：配置模型

fresh-eyes-loop 和 release-gate-loop **共用同一套模型配置**——只需配一次，两个循环都能跑。fresh-eyes-loop 由 A（审查者）和 B（工程师）两个角色组成；release-gate-loop 由 V（验证者）单角色组成。

**统一单模型**（当前口径，权威源 `FORGE/models/profile.mjs`）：六个角色（A/B/C/D/V/F）统一走 **glm-5.3-flash**（GLM Coding Plan 订阅档）。fresh-eyes 纪律通过**每步独立子进程（零上下文）+ 独立 prompt** 实现，不依赖模型差异。

| 角色 | 职责 | 模型 | 行为指令 | 工具集 |
|:--:|------|------|------|------|
| **A**（审查者） | 12 视角单盲审查 + 合并 | glm-5.3-flash | `prompts/a-check-perspective-*.md` / `a-consolidate.md` | `REVIEWER_TOOLS`（只读） |
| **B**（工程师） | 修复缺陷 | glm-5.3-flash | `prompts/b-check.md` / `b-fix.md` | `ENGINEER_TOOLS`（含写工具） |
| **C**（验收者） | 逐条实测验收 B 的修复 | glm-5.3-flash | `prompts/c-verify.md` | `REVIEWER_TOOLS`（只读） |
| **D**（复核者） | 对抗裁决 P0/P1（CONFIRM/DOWNGRADE/REOPEN） | glm-5.3-flash | `prompts/d-review.md` | `REVIEWER_TOOLS`（只读） |
| **V**（验证者） | release-gate 全流程 | glm-5.3-flash | `prompts/*.md` | `REVIEWER_TOOLS`（只读） |
| **F**（修复者） | 补位修复 | glm-5.3-flash | `prompts/`（profile.mjs:56 实证） | `ENGINEER_TOOLS`（含写工具） |

> 💡 **换模型只改一处**：编辑 `FORGE/models/profile.mjs`（改 import 和角色映射即可），driver 代码不需要动——key 也自动跟着模型文件走。

### 配置环境变量

全链单一 GLM key 即可（如需按量备选可再配 DeepSeek）：

```bash
# GLM Coding Plan key——六个角色共用
export GLM_API_KEY=REPLACE_ME

# 模型规格标识（driver 启动检查要求非空，内容不影响模型选择——模型由 profile.mjs 决定）
export SOFAGENT_LLM_A="active"
export SOFAGENT_LLM_B="active"
```

也可以用 `env.local` 模板（见 `FORGE/env.local.template`）：

```bash
mkdir -p ~/.sofagent
cp FORGE/env.local.template ~/.sofagent/env.local
# 编辑 ~/.sofagent/env.local 填入真实 key
source ~/.sofagent/env.local
```

> key 文件刻意放在**仓库目录之外**（`~/.sofagent/env.local`）——不只靠 .gitignore 挡，而是让它根本不在仓库里（2026-09-12 收面批迁移）。

### 模型参数

**glm-5.3-flash（全角色）**：driver 传 `thinking={type:'enabled', clear_thinking:false}` + `reasoningEffort='max'` + `temperature=1.0`，启用最强推理模式。

| 参数 | 值 | 说明 |
|------|:--:|------|
| `maxTokens`（默认） | 16000 | 限制输出 token，防止 thinking 模式无限消耗 |
| `maxTokens`（合并步骤） | 32000 | a-consolidate / consolidate 单独覆盖——合并多份完整报告输出超长，16000 会截断导致整轮降级 |

> 如需覆盖默认参数或切换模型，改 `FORGE/models/profile.mjs`（两个 driver 共用，不需要改 driver 代码）。

### 模型定价与计费模式

每轮循环的 token 用量会被准确记录。**成本**的估算方式取决于各模型的计费模式：

| 模型类型 | 计费模式 | 说明 |
|------|:--:|------|
| **glm-5.3-flash**（全角色使用） | 📦 订阅制 | GLM Coding Plan，按月固定费用 + 额度，**不按 token 扣费**。driver 只记录 token 用量，`cost_cny` 记为 `null`，`price_confidence` 标为 `subscription` |
| **按量计费模型**（如需切换） | 💧 按量计费 | driver 按「官方标价 × token 用量」算出 `cost_cny` 估算值。实际账单受**缓存命中率**影响，以厂商 API 后台为准 |

> ⚠️ **计费模式区分（重要）**：
> - **token 是客观事实，成本是主观语义**：无论什么计费模式，用了多少 token 是确定的；但硬把订阅制和按量制凑成一个总成本数字会误导，所以 driver 只展示 token 总量
> - 具体定价查阅你所选模型的厂商官方定价页

### API Key 透明度

- key 仅存在本地环境变量（`~/.zshrc` 或 `~/.sofagent/env.local`），**不进代码、不进 git、不进日志**
- key 仅用于调用配置的 LLM API 的 HTTPS 请求（请求头 `Authorization: Bearer <key>`）
- **不上传、不转发、不记录到第三方**——sofagent 无后端服务器
- 详细的 key 管理和安全承诺见根目录 [`SECURITY.md`](../SECURITY.md) §六「LLM API Key 透明度」

---

## 第三步：跑循环

FORGE 有两个内环，共用第二步配置的环境变量，各自有独立的 driver。

### fresh-eyes-loop（质量循环 · 阶段三）

driver（`FORGE/src/fresh-eyes-driver.mjs`）会自动 spawn 独立子进程跑每个 step——每个 step 都是全新的 Node 进程，**真零上下文**（不是同一 session 内换 prompt，而是彻底重启进程）。

```bash
# 一键启动（driver 自动起 A/B 子进程）——target 传当前开发版本号
node FORGE/src/fresh-eyes-driver.mjs --target v1.3.7 --max-rounds 10

# 先 dry-run 看流程（不实际调用 LLM，只打印 step 序列）
node FORGE/src/fresh-eyes-driver.mjs --target v1.3.7 --dry-run
```

**driver 参数**：

| 参数 | 说明 | 默认值 |
|------|------|------|
| `--target` | 目标版本号（当前开发版本，如 `v1.3.7`），用于 run 目录命名 | 必填 |
| `--max-rounds` | 最大循环轮次 | `10` |
| `--dry-run` | 只打印 step 序列，不调用 LLM | `false` |

**单轮协议**（driver 自动编排，无需手动 relay）：

```
a-check       → A（审查角色）独立跑 12 视角审查，输出 check-a.md
b-check       → B（工程师角色）独立跑 12 视角审查，输出 check-b.md
a-consolidate → A 合并 A+B findings，去重排序，输出 findings.md + result.md
b-fix         → B 按 result.md 修复，输出 summary.md
c-verify      → C 独立验收修复结果（逐条实测）
d-review      → D 对抗复核 P0/P1，REOPEN 打回重修
              → 连续 2 轮无 P0/P1 → 停止
```

产物写到 `~/.sofagent/data/forge-runs/fresh-eyes-loop/YYYY-MM-DD/run-NN/` 目录下。

### release-gate-loop（发版闸门 · 阶段六）

driver（`FORGE/src/release-gate-driver.mjs`）驱动单角色（V = 验证者）跑 5 步线性验证，跑完即出 PASS/FAIL 裁决。纯只读——不做任何修复。

```bash
# 一键启动
node FORGE/src/release-gate-driver.mjs --target v1.3.7

# 先 dry-run 看流程
node FORGE/src/release-gate-driver.mjs --target v1.3.7 --dry-run

# sandbox 环境（acceptance-test.sh 预跑会被 kill 时）：
# 先手动预跑，再 --skip-acceptance 启动
bash playbook/acceptance-test.sh > /tmp/acceptance-raw.log 2>&1
node FORGE/src/release-gate-driver.mjs --target v1.3.7 --skip-acceptance

# 沙箱 OOM 环境（driver + worker 内存叠加触发 OOM 时）：
# 用 --step 单步模式，逐步调用，每步全新进程退出
node FORGE/src/release-gate-driver.mjs --step acceptance --target v1.3.7 --run-dir <runDir>
node FORGE/src/release-gate-driver.mjs --step regression  --target v1.3.7 --run-dir <runDir>
node FORGE/src/release-gate-driver.mjs --step coverage     --target v1.3.7 --run-dir <runDir>
node FORGE/src/release-gate-driver.mjs --step consolidate  --target v1.3.7 --run-dir <runDir>
node FORGE/src/release-gate-driver.mjs --step verdict       --target v1.3.7 --run-dir <runDir>
```

**driver 参数**：

| 参数 | 说明 | 默认值 |
|------|------|------|
| `--target` | 目标版本号 | 必填 |
| `--dry-run` | 只打印 step 序列，不调用 LLM | `false` |
| `--skip-acceptance` | 跳过 acceptance-test 步骤（需手动预跑） | `false` |
| `--step` | 单步模式（OOM 环境用） | 不设 = 全量跑 |
| `--run-dir` | 单步模式指定的 run 目录 | 单步模式必填 |

**5 步协议**（driver 自动编排）：

```
acceptance  → V 跑 acceptance-test.sh（115 场景），输出 acceptance 报告
regression  → V 跑 regression-checklist 检查，输出 regression 报告
coverage    → V 交叉检查覆盖率，输出 coverage 报告
consolidate → V 合并三份报告，输出综合报告
verdict     → V 出最终裁决（PASS / FAIL），写入 verdict.md
```

产物写到 `~/.sofagent/data/forge-runs/release-gate-loop/YYYY-MM-DD/run-NN/` 目录下。

### Usage 成本透明

每轮循环的 token 用量和成本会记录到 `runs/.../run-NN/usage.jsonl`，每行一条记录：

```json
{
  "ts": "2026-08-01T12:34:56.789Z",
  "target": "v1.3.7",
  "round": 1,
  "step": "a-check",
  "role": "A",
  "model": "glm-5.3-flash",
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
| `model` | 模型名 |
| `prompt_tokens` | 输入 token 数 |
| `completion_tokens` | 输出 token 数 |
| `total_tokens` | prompt + completion 合计 |
| `cost_cny` | 本条调用的估算成本（人民币元）。订阅制模型记为 `null` |
| `price_confidence` | `subscription` = 订阅制（不按 token 扣费）/ `estimated` = 按量估算 / `no-pricing` = 未知模型无法估算 |
| `latency_ms` | API 响应延迟（毫秒） |

---

## 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| `SOFAGENT_LLM_A_API_KEY` 或 `SOFAGENT_LLM_B_API_KEY` 未设 | 没配 key | 厂商 key：`export GLM_API_KEY=REPLACE_ME`（key 跟模型文件走，见 `FORGE/models/*.mjs` 的 `apiKeyEnv`） |
| driver 找不到 `node` 命令 | Node.js 未安装或不在 PATH | 装 Node.js ≥ 18（`brew install node` / `nvm install 18`） |
| reviewer 每轮都驳回 | 审查标准太严 | 改 `SKILL/agents/reviewer/SKILL.md` 的判定标准 |
| API key 报 401 | key 过期或额度耗尽 | 去对应厂商控制台检查 key 状态和余额 |
| usage.jsonl 中 `price_confidence: no-pricing` | 该模型不在 `MODEL_PRICING` 表里 | 查阅厂商官方定价页，在 driver 内补上 |
| a-consolidate 产物为空或降级 | maxTokens 截断（合并步骤输出超长） | 确认 STEPS 中 a-consolidate 的 maxTokens=32000（见 lessons/models.md） |
| sofagent-audit 命令未找到 | 底座没装 | `bash install.sh` |
| release-gate acceptance 步骤被 kill | sandbox 限制长时间子进程 | 手动预跑 `bash playbook/acceptance-test.sh > /tmp/log 2>&1`，再 `--skip-acceptance` 启动 |
| release-gate driver OOM | driver + worker 内存叠加（沙箱环境） | 用 `--step` 单步模式逐步调用（见上方命令） |
| release-gate verdict 误判 PASS/FAIL | driver parseVerdict 解析 bug | 以 `verdict.md` 权威产物为准，不信 LEDGER 中间状态（v1.2.5 已修 commit a845ed8） |

> 📖 详细设计见各自 `FORGE/SKILL/<loop>/loop.md`（循环协议）和 `FORGE/lessons/index.md`（Sub-Agent 开发参照标准）。
