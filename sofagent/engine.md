# engine.md · 任务编排引擎 · v0.83

> 由 SKILL.md A0 触发。仅 🔴 复杂任务且用户确认后点火。`{SOFAGENT_DATA}` = `{当前工作目录}/.sofagent/`。
> ⛔ 三层加载链已在 SKILL.md 启动时完成——engine.md 不重复。编排引擎只管拆解、执行、闭环。
> B.系统安装 + D.种子指令均为一次性执行（首次后自动跳过）。
> Skill 检索（ClawHub）→ 见 [Developer §三](../DEVELOPMENT.md#三模型最优选择)「四步集成 + 渐进信任」。
> 离线模式：rules.md 含 `offline: true` 时，跳过 ClawHub 搜索，Skills 手动放入 `~/.openclaw/skills/` 目录。
>
> 当 `command -v ao` 失败或 rules.md 含 `offline: true` 时，走默认编排：
> 1. 主 Agent 按语义簇拆 3-5 个子任务（按任务描述的自然语义分界）
> 2. 每个子任务手动分配角色（从 agency-agents-zh 模板或 Agent 自行判断）
> 3. 用 `{OPENCLAW_SCRIPTS}/task-record.sh` 逐条记录，手动闭环
> 4. 不生成 YAML 工作流文件——主 Agent 直接在上下文里管理 DAG
>
> ⚠️ **ao 降级前必须检查 API Key**：`command -v ao` 成功 ≠ ao 可用。即使 ao 已安装，如果没有配置 LLM API Key（`$DEEPSEEK_API_KEY` / `$ANTHROPIC_API_KEY` / `$OPENAI_API_KEY` 任一非空），ao compose 会静默失败，后续闭环也写不进去。判断细节见下方「A2. ao 能力探测」。
>
> 这是简化版编排——没有 ao compose 的模板匹配和自动分配，但保留了"拆解→执行→闭环"的核心结构。比纯手动强，比 ao 弱。

### ao compose vs 默认编排 · 能力差异

| 能力 | ao compose 模式 | 默认编排模式 |
|------|:--:|:--:|
| 模板匹配（Task Graph 自动生成）| ✅ | ❌ — Agent 手工按语义簇拆解 |
| 角色分配（子 Agent 岗位定位）| ✅ — agency-agents-zh 模板 | ⚠️ — Agent 自行判断 |
| 成本预估（token 预算）| ✅ — ao compose 输出 | ❌ — 无预估 |
| 并行调度（子任务并发）| ✅ — ao run 管理 | ❌ — 主 Agent 串行执行 |
| 工作流 YAML 复用 | ✅ — 同类任务直接复跑 | ❌ — 每次重新拆解 |
| 约束层 | ✅ 不变 | ✅ 不变 — 约束层不依赖 ao |

---

## A. 平台检测 + 场景判断

**平台**（优先读缓存 `{SOFAGENT_DATA}/platform`）：`~/.openclaw/`→OpenClaw / `~/.workbuddy/`→WorkBuddy / `~/.codex/`→Codex / `~/.hermes/`→Hermes / `$CLAUDE_CODE`→Claude Code → 检测后写缓存。

**场景**（检查 `{SOFAGENT_DATA}/think.md`）：
→ 不存在 → 首次运行：继续 B→D。口头：「sofagent 已就绪。」
→ 存在 → 回归运行：跳过 B+D，读 think.md 反思区 → 直接进子 Skill 索引。

## A2. ao 能力探测（🔴 任务点火前必跑）

> `command -v ao` 成功 ≠ ao 可用。ao compose 静默失败会让 Agent 困在手工拆解里而不自知。本节点把判断做成显式步骤，不依赖「仔细读注释」的自觉。

**快速决策表**：

| 条件 | 路径 | 编排能力 |
|------|------|---------|
| `command -v ao` ✅ + API Key ✅ | ao compose 完整编排 | 模板匹配 + 子 Agent 分配 + 成本预估 |
| `command -v ao` ✅ + API Key ❌ | 口头告知 → 默认编排 | 手工拆解 + task-record |
| `command -v ao` ❌ | 口头告知 → 默认编排 | 手工拆解 + task-record |

> 以下三条为详细判断规则（含用户提示话术），按顺序判断，命中即停：

1. ✅ **完整编排** — `command -v ao` 成功 **且** ao 已配置可用 API Key（请自行设置一个可用的 API Key 环境变量，如 `DEEPSEEK_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`）→ 走 ao compose（模板匹配 → 子 Agent 分配 → Loop check）。
   > 💡 **provider 优先级**：DeepSeek API > OpenAI/Anthropic API > OpenClaw CLI。OpenClaw CLI provider 下 ao compose 存在已知 YAML 格式兼容性问题（跨 3 模型失败），优先使用 API provider。
2. ⚠️ **口头告知后降级** — `command -v ao` 成功 **但** 未配置 API Key → 先口头告知用户：「ao 已安装但未配置 API Key，编排降级为手工拆解。请自行设置一个可用的 API Key 环境变量后可用。」然后走默认编排。
3. ❌ **告知后降级** — `command -v ao` 失败 → 口头告知用户：「ao compose 未安装，编排引擎使用简化模式。如需完整编排能力（模板匹配、子 Agent 分配、成本预估），运行：`npm install -g agency-orchestrator && bash {OPENCLAW_SCRIPTS}/install.sh --platform openclaw`。企业内网环境可继续使用当前手动模式（--no-ao），约束层不受影响。」然后走默认编排。

> 默认编排见文件顶部注释块（按语义簇拆 3-5 个子任务 + 手动分配角色 + `{OPENCLAW_SCRIPTS}/task-record.sh` 逐条记录）。

## A3. 🔴 点火前准入检查（不可跳过）

> 🔴 复杂任务编排点火前，Agent 必须显式输出一行准入检查结果。这不是技术拦截（prompt 层做不到），是**流程钉**——Agent 自己声明通过了检查，复盘时有据可查。不输出这行 = 不走编排。

1. 调用 `task-aware.md` §1.1 风险边界检查（5 类高风险任务：需求不清 / 产品判断 / 安全权限含密码密钥支付 / 数据删除 / 架构重构）
2. 检查结果必须显式输出以下两种格式之一：
   - `[准入检查: PASS]` → 继续走编排流程
   - `[准入检查: REJECT — {具体原因}]` → 停止，不给替代方案
3. ⛔ 如果输出 REJECT 后又继续编排——Agent 自己知道在做什么，复盘时可追溯

## A4. ComplexityScorer 模型路由

> 💡 50 行确定性公式——在 ao compose 前运行，决定任务走 Pro 还是 Flash 模型。不替代 ao compose 的模板匹配，只决定用哪个模型来跑编排。

**公式**：总分 = 子任务数 × 0.4 + 跨领域数 × 0.3 + 预估 token × 0.2 + 含代码/报告 × 0.1

| 因子 | 权重 | 判定规则 |
|------|:--:|------|
| **子任务数** | ×0.4 | 从任务描述估算子任务数量：1-2 个→0.1 / 3-5 个→0.4 / 6-10 个→0.7 / 10+个→1.0 |
| **跨领域数** | ×0.3 | 涉及几个不同领域（代码/文档/数据/部署/安全）：1 个→0.1 / 2 个→0.4 / 3 个→0.7 / 4+个→1.0 |
| **预估 token** | ×0.2 | 预估总 token 消耗：<10K→0.1 / 10K-50K→0.4 / 50K-200K→0.7 / >200K→1.0 |
| **含代码/报告** | ×0.1 | 是否涉及代码生成或报告产出：纯文本→0 / 含代码→0.5 / 含代码+报告→1.0 |

**路由决策**：
- 总分 ≥ 0.5 → **Pro 模型**（ao compose 完整编排）
- 总分 < 0.5 → **Flash 模型** 或 默认编排（降级）
- 模型选择写入 `{SOFAGENT_DATA}/orchestrator/` 供后续同类任务参考

> ⛔ ComplexityScorer 给的是**建议**——Agent 可在 task-aware 1.4 澄清阶段与用户确认后覆盖。rules.md 模型偏好始终最高优先级。

## B. 系统安装（一次性）

**B0**：
- OpenClaw → 首次从源仓库运行 `bash ~/.openclaw/scripts/install.sh --platform openclaw`（install.sh 是安装器，不部署自身到 scripts/；已安装则跳过）。失败不阻塞。
- WorkBuddy → 跳过（WorkBuddy 靠 skill 系统加载，不依赖 shell hook 与 scripts/，B0 无需调脚本）。
**B1**：`mkdir -p {SOFAGENT_DATA}/{task/plans,task/logs,scoring,orchestrator}` → 创建 `think.md`（反思区空白模板）→ 创建 `scoring/_index.md` + `orchestrator/_index.md`。bash 不可用：逐条 mkdir + Write。
**B2**：INIT_OK → 继续 D。失败 → 停止：「初始化失败，检查权限。」

## D. 植入种子指令（一次性）

先读目标文件查重（含 `sofagent` 则跳过）。自动写：WorkBuddy→`.workbuddy/memory/MEMORY.md` / OpenClaw→`~/.openclaw/MEMORY.md`。手动：Claude→`CLAUDE.md` / Codex→`AGENTS.md` / Hermes→`SOUL.md`。内容：「每次对话开始时，读取 SKILL.md 并执行入口流程。」

---

## ⛔ 入口结束 → 加载子 Skill

> 入口流程（A→B→D）完成后立即 Read `entry-gate.md` 并执行全部。⛔ 闸门检查严禁输出给用户。

| # | 子 Skill | 何时加载 | 位置 |
|:--:|------|------|------|
| 1 | entry-gate | 入口结束后 | `entry-gate.md` |
| 2 | task-aware | 收到任何任务时 | `task-aware.md` |
| 3 | task-closure | 闭环信号时 | `task-closure.md` |
| 4 | loop-check | 检查点/失败/闭环 | `loop-check.md` |

闭环信号：① 子任务完成+用户确认 ② 用户 /new 或 /reset。

---

## 执行纪律

SKILL.md 地基 → A0 → 🟢🟡只读task-aware / 🔴→engine→entry-gate。**回复前闸门**每次执行。核心靠 MD 文件，脚本仅在 bash 可用时使用。写入前读确认、写入后验证。数据仅写 `{SOFAGENT_DATA}/`。**加载链、能力注册、每任务闸门、闭环清单——四个硬出口，严禁输出给用户。**

### 幂等检查（Idempotency Pre-check）

> [软约束·全平台] prompt 级提醒——Agent 可能跳过。OpenClaw 上 Hook 可升级为硬拦截

> Agent 执行不可逆操作时，如果任务暂停又恢复、或子 Agent 重试，同一个操作可能被执行两次——发两封邮件、扣两次钱。重跑 = 可能重复执行副作用。

覆盖 4 类不可逆操作：

| 操作类型 | 示例 | 检查方式 |
|---------|------|---------|
| **git push** | `git push origin main` | 查 task/logs 是否有同 branch + 同 commit-hash 的成功记录 |
| **rm -rf** | `rm -rf dist/` | 查目标路径是否已不存在（已删 = 已成功） |
| **外部 API**（POST/PUT/DELETE） | 发邮件、付款 | 查 task/logs 是否有同 operation-id 的成功响应 |
| **数据库写入** | INSERT / UPDATE | 查 task/logs 是否有同 row-key 的写入记录 |

**操作 ID 生成**：`echo "${task_id}${step_number}${resource}" | shasum -a 256 | cut -c1-16`

**流程**：
```
子 Agent 执行不可逆操作前：
1. 生成唯一操作 ID（task-id + step-number + resource-hash）
2. 查 task/logs 是否有同 ID 的成功记录
3. 有 → 跳过（标记「已执行，幂等跳过」）
4. 无 → 执行 → 写入 task/logs（ID + 执行状态 + 时间戳）
```

> 只覆盖 4 类不可逆操作。文件创建、代码修改等可重做操作不需要 idempotency 检查。

### 每步验证节点

> 编排流程中，每步完成后必须跑对应的验证。验证失败 → 不进入下一步。这是铁律 #3「验证再继续」在编排层的具体实现。

| 步类型 | 验证方式 | 失败处理 |
|------|------|------|
| 代码生成/修改 | `bash -n`（语法检查）/ 跑对应测试 / lint | 修正后重跑验证，连续 2 次失败→见失败分支 #2 |
| 文档生成 | 拼写检查 / 链接有效性检查（`curl -sI` 只查 404） / 格式一致性 | 自动修正错别字和死链 |
| 数据处理 | 行数验证 / 格式校验（CSV 列数一致 / JSON `jq '.'` 可解析） | 回退到上一步，检查数据源 |
| 文件操作 | `ls -la` 确认文件存在且非空 / `cmp` 验证内容 | 重新执行写操作 |
| 编排步骤 | `bash {OPENCLAW_SCRIPTS}/task-record.sh --closure-check` | 记录失败原因，继续下一子任务 |

### 6 个显式失败分支

> 不靠 catch-all 的「失败→降级」。每条失败路径有名字、有触发条件、有处理策略。

| # | 失败分支 | 触发条件 | 处理策略 |
|:--:|------|------|------|
| 1 | **单步测试失败** | 子任务验证未通过（测试/lint exit ≠ 0） | 回溯到该子任务的起点，检查输入完整性，修正后重试 1 次 |
| 2 | **连续两次失败** | 同一子任务连续 2 次验证失败 | 🔴 回滚该子任务的所有变更（`git checkout --` 或等效操作），通知用户失败原因 + 已尝试方案，等用户指令 |
| 3 | **改动过大** | 单子任务修改文件数 > 10 或修改行数 > 500 | 🟡 暂停，列出涉及文件清单，让用户确认是否继续 |
| 4 | **任务冲突** | 多个子任务修改同一文件 | 🟡 暂停，合并策略：优先串行化（后来的子任务等前一个完成），若冲突不可自动解决→通知用户 |
| 5 | **多 Agent 矛盾** | 多个子 Agent 对同一问题输出矛盾结论 | 主 Agent 裁决：比较证据质量（有外部验证 > LLM 自评），取有证据支撑的结论。两者均无外部证据→通知用户选择 |
| 6 | **成本超预算** | token 消耗超过 A4 ComplexityScorer 预估的 1.5 倍 | 停止剩余子任务，汇报已完成部分 + 已消耗 token，用户决定是否继续或降级为 Flash |

### 步数闸（Step Limiter）

> [软约束·全平台] prompt 级提醒——Agent 可能跳过。OpenClaw 上 Hook 可升级为硬拦截

> 来源：sofagent-dev 前身 `iteration-guard.js`。Agent 在无人值守场景下可能反复调工具直到 timeout 被杀——浪费 token。

MAX_STEPS=50（硬上限）+ GRACE_STEPS=3（恩典期，让 Agent 收尾）两段式预算：
```bash
MAX_STEPS=50; GRACE_STEPS=3
step_count=$(($(cat "$STEP_FILE" 2>/dev/null || echo 0) + 1))
echo "$step_count" > "$STEP_FILE"
if [ "$step_count" -ge "$MAX_STEPS" ] && [ "$step_count" -lt "$((MAX_STEPS + GRACE_STEPS))" ]; then
    inject_budget_warning  # 步数将尽，请收尾
elif [ "$step_count" -ge "$((MAX_STEPS + GRACE_STEPS))" ]; then
    force_stop "步数预算完全耗尽"
fi
```

> 恩典期比 timeout 暴力 kill 更优雅——给 Agent 3 步机会输出最终结果，不丢失中间产出。

### 熔断闸（Circuit Breaker）

> [软约束·全平台] prompt 级提醒——Agent 可能跳过。OpenClaw 上 Hook 可升级为硬拦截

> 来源：sofagent-dev 前身 `behavior-validator.js` 三态断路器。防止子 Agent 雪崩——N 个子 Agent × 3 次重试 = 3N 次无效调用。

per-Agent 状态文件，FAILURE_THRESHOLD=3 / COOLDOWN_SECONDS=30：
```bash
CIRCUIT_FILE="$TASK_DIR/circuit_state"
FAILURE_THRESHOLD=3; COOLDOWN_SECONDS=30
state=$(get_circuit_state "$agent_id")
case "$state" in
    OPEN)
        [ "$(time_since_opened "$agent_id")" -ge "$COOLDOWN_SECONDS" ] \
            && set_circuit_state "$agent_id" HALF_OPEN \
            || { skip_agent "$agent_id" "熔断中"; return 1; }
        ;;
esac
if agent_success; then
    set_circuit_state "$agent_id" CLOSED; reset_failure_count "$agent_id"
else
    increment_failure_count "$agent_id"
    [ "$(get_failure_count "$agent_id")" -ge "$FAILURE_THRESHOLD" ] \
        && set_circuit_state "$agent_id" OPEN
fi
```

> CLOSED→连续失败→OPEN（拒绝 30s）→冷却期满→HALF_OPEN（试探 1 次）→成功回 CLOSED / 失败回 OPEN。
