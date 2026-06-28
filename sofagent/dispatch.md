# dispatch.md · 任务拆解与派发 · v0.95

> 拆自 engine.md。点火（ignite.md）完成后加载——把复杂任务拆成子任务并分配执行。
> 默认编排（无 ao）见文件底部。

---

## ao compose vs 默认编排 · 能力差异

| 能力 | ao compose 模式 | 默认编排模式 |
|------|:--:|:--:|
| 模板匹配（Task Graph 自动生成）| ✅ | ❌ — Agent 手工按语义簇拆解 |
| 角色分配（子 Agent 岗位定位）| ✅ — agency-agents-zh 模板 | ⚠️ — Agent 自行判断 |
| 成本预估（token 预算）| ✅ — ao compose 输出 | ❌ — 无预估 |
| 并行调度（子任务并发）| ✅ — ao run 管理 | ❌ — 主 Agent 串行执行 |
| 工作流 YAML 复用 | ✅ — 同类任务直接复跑 | ❌ — 每次重新拆解 |
| 约束层 | ✅ 不变 | ✅ 不变 — 约束层不依赖 ao |

> Skill 检索（ClawHub）→ 见 [Developer §三](../DEVELOPMENT.md#三模型最优选择)「四步集成 + 渐进信任」。
> 离线模式：rules.md 含 `offline: true` 时，跳过 ClawHub 搜索，Skills 手动放入 `~/.openclaw/skills/` 目录。

---

## 默认编排（ao 不可用时）

> 当 `command -v ao` 失败或 rules.md 含 `offline: true` 时，走默认编排：
> 1. 主 Agent 按语义簇拆 3-5 个子任务（按任务描述的自然语义分界）
> 2. 每个子任务手动分配角色（从 agency-agents-zh 模板或 Agent 自行判断）
> 3. 用 `{OPENCLAW_SCRIPTS}/task-record.sh` 逐条记录，手动闭环
> 4. 不生成 YAML 工作流文件——主 Agent 直接在上下文里管理 DAG
>
> ⚠️ **ao 降级前必须检查 API Key**：判断细节见 ignite.md「A2. ao 能力探测」。
>
> 这是简化版编排——没有 ao compose 的模板匹配和自动分配，但保留了"拆解→执行→闭环"的核心结构。比纯手动强，比 ao 弱。

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

> 编排流程中，每步完成后必须跑对应的验证。验证失败 → 不进入下一步。这是审计 A8「不逃验证」在编排层的具体实现。

| 步类型 | 验证方式 | 失败处理 |
|------|------|------|
| 代码生成/修改 | `bash -n`（语法检查）/ 跑对应测试 / lint | 修正后重跑验证，连续 2 次失败→见失败分支 #2 |
| 文档生成 | 拼写检查 / 链接有效性检查（`curl -sI` 只查 404） / 格式一致性 | 自动修正错别字和死链 |
| 数据处理 | 行数验证 / 格式校验（CSV 列数一致 / JSON `jq '.'` 可解析） | 回退到上一步，检查数据源 |
| 文件操作 | `ls -la` 确认文件存在且非空 / `cmp` 验证内容 | 重新执行写操作 |
| 编排步骤 | `bash {OPENCLAW_SCRIPTS}/task-record.sh --closure-check` | 记录失败原因，继续下一子任务 |

### 7 个显式失败分支

> 不靠 catch-all 的「失败→降级」。每条失败路径有名字、有触发条件、有处理策略。

| # | 失败分支 | 触发条件 | 处理策略 |
|:--:|------|------|------|
| 1 | **单步测试失败** | 子任务验证未通过（测试/lint exit ≠ 0） | 回溯到该子任务的起点，检查输入完整性，修正后重试 1 次 |
| 2 | **连续两次失败** | 同一子任务连续 2 次验证失败 | 🔴 回滚该子任务的所有变更（`git checkout --` 或等效操作），通知用户失败原因 + 已尝试方案，等用户指令 |
| 3 | **改动过大** | 单子任务修改文件数 > 10 或修改行数 > 500 | 🟡 暂停，列出涉及文件清单，让用户确认是否继续 |
| 4 | **任务冲突** | 多个子任务修改同一文件 | 🟡 暂停，合并策略：优先串行化（后来的子任务等前一个完成），若冲突不可自动解决→通知用户 |
| 5 | **多 Agent 矛盾** | 多个子 Agent 对同一问题输出矛盾结论 | 主 Agent 裁决：比较证据质量（有外部验证 > LLM 自评），取有证据支撑的结论。两者均无外部证据→通知用户选择 |
| 6 | **成本超预算** | token 消耗超过 A4 ComplexityScorer 预估的 1.5 倍 | 停止剩余子任务，汇报已完成部分 + 已消耗 token，用户决定是否继续或降级为 Flash |
| 7 | **Ghost 无响应** | 子 Agent 超过 N 分钟无输出（默认 N=5） | 标记为 ghost，自动中止该子 Agent，交还主 Agent 决策。Ghost 率数据：约 28%（Code Review 范式转移笔记，AI 收到主观反馈后停止响应的比例） |

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

### 四大跑偏检测（v0.86 新增）

> 来源：Anthropic Cloud Code 工作流研究 + 实战观察。Agent 在循环中不是随机出错——有四种系统性偏移模式，每种都有对应的检测信号和回拉策略。

| # | 跑偏模式 | 典型表现 | 检测信号 | 回拉策略 |
|:--:|------|------|------|------|
| 1 | **细节沉迷** | 在一个子任务上反复打磨，忘记还有 5 个子任务没动 | 同一子任务连续 3+ 轮 checkpoint，其他子任务 0 进展 | 🟡 强制提醒：「当前子任务已 N 轮，剩余 M 个子任务未启动，是否先推进其他子任务？」 |
| 2 | **单 Bug 停滞** | 卡在一个 bug 上反复重试，不换思路 | 同一失败分支连续触发 3 次（闭环失败分支 #2 已定义：连续 2 次失败 → 回滚+通知。但 Agent 可能绕过回滚继续硬试） | 🔴 强制交还人类：已在同一点失败 3 次，不再自动重试 |
| 3 | **目标漂移** | 跑着跑着偏离了用户原始需求，开始做用户没要求的事 | checkpoint 产出和 task-aware §1 目标对照——语义相似度低于阈值 | 🟡 暂停，重新对照原始目标：「当前正在做 X，用户最初要的是 Y，是否需要调整方向？」 |
| 4 | **跳过验证** | 写完代码不验证就继续下一步 | Write/Edit 后无 build/test/curl 验证记录（审计 A8 的 runtime 检测） | 🔴 强制补验证：检测到未验证的修改，必须先跑验证再继续 |

> 这四种模式覆盖了 Loop Engineering 研究中 80%+ 的 Agent 循环失效场景。检测到跑偏时不要静默修正——**大声说出来**（🟡 一句话通知 / 🔴 完整汇报+等确认），让用户知道 Loop 在起作用。

---

> 派发完成 → Read `closure.md`（闭环验收）

## Gotcha

- **拆解过细导致子任务间丢失上下文**——5 个子任务各自拿到的不完整信息拼不出全局。后果：交接冲突 + 重复劳动 + 风格不一致。
- **默认编排不生成 YAML**——每次重新拆解，无法复用同类任务的最优拆法。后果：同类任务反复踩同一种拆法错误。
- **步数闸靠 prompt 软约束**——Agent 可能跳过步数检查继续硬跑。后果：token 预算耗尽到 timeout 才停，浪费资源。
- **跑偏检测要大声说**——静默修正不让用户知道 Loop 在起作用，用户以为 Agent 自己修的。后果：用户不信任编排机制，下次不用。
