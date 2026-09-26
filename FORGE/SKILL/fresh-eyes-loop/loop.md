# fresh-eyes-loop · 循环 SOP

> 本文件定义质量循环的**运行协议**。A/B 的具体行为指令在 `prompts/`，12 视角定义在 `playbook/fresh-eyes-review.md`（playbook 共 22 视角六层：1-12 循环标准配置；13-16 文档治理/通读、17-19 动态面（需 build/实跑取证）、20-21 深度专项、22 发现面均不在本循环内——边界以 playbook 分层表为准）。

## 核心原则

1. **零上下文每轮**：A 和 B 每一轮都用**全新 session**（新建独立 session / 子进程，或刷新对话）。上一轮的记忆不在这一轮。这是 fresh-eyes 纪律的硬保障——作者在项目里待太久产生的"解释盲区"被结构性消解。
2. **双盲独立**：A 和 B 跑的是**同一套 12 视角**，但互相不知道对方看到了什么。两人在不同 session 独立产出，合并时才对照。重叠 = 高置信问题；单方独特发现 = 也值得记。
3. **编排者只 relay，不审查**：编排者（一次 harness 运行，注入主任务协议）负责在角色间传文件、维护 `runs/`、判定停止。**编排者不替角色做判断**。
4. **不修改审查对象以外东西**：B 只修合并后的 findings 指向的问题，不顺手重构。

## 角色

| 角色 | 身份 | 每轮动作 | 产物 |
|------|------|---------|------|
| **A** | 审查者 / QA | ① 独立跑 12 视角审查 ② 合并 A/B 报告 ③ 验证 B 修复 | `check-a.md` → `findings.md` + `result.md` → 回填 verify |
| **B** | 工程师 | ① 独立跑 12 视角审查 ② 执行合并后的修复 | `check-b.md` → `summary.md` |
| **编排者** | 一次 harness 运行（WorkBuddy 有人值守 / DSH 无头 / Codex headless，注入主任务协议即跑） | 中转文件、建 `runs/`、判定停止、写 `LEDGER.md` | `runs/` 目录 + LEDGER 行 |

A/B 基于 `SKILL/agents/` 的 `reviewer` + `engineer` 两个 SubAgent 能力构建（同底座，不同行为指令）。

## 目录约定（3 级分层）

```
FORGE/SKILL/fresh-eyes-loop/runs/YYYY/MM/DD/run-NN/
```

- 不是每天都会跑循环，但不跑的那天不建目录。
- 一天多次跑 = `run-01` / `run-02` …（当日序号）。
- 每轮在 `run-NN/` 下再细分：`round-01/` `round-02/` …，每轮产物放对应 round 目录。

**跨 run 永久索引**：`FORGE/LEDGER.md`（被 git 跟踪，追加 only）。`runs/` 正文不进 git（见 `runs/.gitignore`）。

## 单轮协议（Round Protocol）

每一轮 N（round-NN）：

```
1. [A 新 session] 跑 12 视角审查        → runs/.../round-NN/check-a.md
2. [B 新 session] 跑 12 视角审查        → runs/.../round-NN/check-b.md   （双盲，独立）
3. [A session]    合并 check-a + check-b → findings.md（去重 + P0/P1/P2）+ result.md（给 B 的修复指令）
4. [B 新 session] 读 result.md 修复代码  → summary.md（改了什么文件 / 验证方式）
5. [A 新 session] 按 findings.md 验证修复 → 回填 result.md 的 verify 列（PASS/FAIL/无法验证）
6. 编排者判定停止条件
```

> 步骤 1–2 可并行（A/B 互不影响）。步骤 3–5 必须串行（有依赖）。

> 💡 **为什么 result.md 要精确路径，不只是给结论**：A/B 双盲交接的核心是保留"活着的工作现场"，不是压缩成结论。强弱模型协作的研究表明，把强模型的审查结论压成摘要交给执行者，会丢失工作现场——执行者拿到结论却不知道改哪个文件的哪一行。sofagent 的 result.md 设计（每条 finding 对应精确文件路径 + 期望修复行为）正是对这一教训的工程回应：给 B 不只是"什么问题"，而是"在哪个文件的哪一行、期望改成什么样"。这也是实测血泪教训——a-consolidate 崩溃时只留下结论摘要，B 拿到后修了 0 条。

## 产物 Schema

| 文件 | 作者 | 内容 |
|------|------|------|
| `check-a.md` / `check-b.md` | A / B | 各自 12 视角独立发现，每条带 `视角 / 文件路径 / 具体描述 / 优先级(P0\|P1\|P2)` |
| `findings.md` | A | 合并去重后的统一问题清单，按 P0→P2 排序，每条带 `来源(A/B/双)` |
| `result.md` | A | 给 B 的修复指令（每条 finding → 期望修复行为）；末尾 verify 列由步骤 5 回填 |
| `summary.md` | B | 修复记录：改了哪些文件、怎么验证、遗留风险 |

**优先级**：`P0` 严重/阻塞 · `P1` 应该修 · `P2` 观察项。

> 另有两份**跨形态状态产物** `status.md` / `verdict.md`（runDir 根、不入 round 目录）：定义见「执行形态」节主任务协议第 3 条，机器校验面 = `tools/check/check-fresh-eyes-artifacts.mjs`。本表仅列 per-round 产物。

## 停止条件

- **主停止**：连续 **2 轮** `findings.md` 中 **无 P0 且无 P1** → 停止，本轮循环结束。
- **人工停止**：编排者在任意轮后判定 `human-stop`（如时间窗到了）。
- **上限**：设 `max-rounds`（默认 10），触顶强制停止并标注 `max-rounds`，遗留 P0/P1 进 `LEDGER.md` 备注。
- **v1.2.7 Session Goal**：设置 `completion_condition` 后，每轮结束后用轻量模型评估是否满足条件：
  - `PASS` → `stopReason='goal-met'`（目标达成停止）
  - `CONTINUE` + 续接次数 < `max_continuations`（默认 10）→ 继续下一轮
  - 续接次数 ≥ `max_continuations` → `stopReason='goal-max-continuations'`（续接超限停止）
  - `FAIL` → `stopReason='goal-failed'`（目标无法达成停止）
  - 未设置 `completion_condition` → fallback 到"连续 2 轮无 P0/P1"启发式（向后兼容）

### 循环健康指标：Evidence Delta（证据增量）

每轮循环必须产出**证据增量（Evidence Delta）**——新的错误码、新的后台状态或新的产物。无新证据即视为「无效空转（Token Burn）」，应立即停止空转、改变方法而非重复调用。这与「连续 2 轮无 P0/P1 即停」主停止条件互补：前者管单轮是否有效进展，后者管整体收敛。

> 来源：Loop Engineering 反模式「Token Burn」修复方案（工程实践消化，2026-07）

停止后编排者向 `FORGE/LEDGER.md` 追加一行（见 `LEDGER.md` 列定义）。

## 执行形态（单轨 · 编排权上收到协议层）

循环的编排逻辑 = 本文件「主任务协议」六条（SSOT）；**编排者就是一次 harness 运行本身**——注入协议即跑，不存在第二种编排形态。状态全在 `runs/` 文件里（文件即状态），中断任意载体接续跑，无需重开。

| 层 | 归属 |
|----|------|
| **编排逻辑** | 主任务协议六条（本文件，唯一 SSOT） |
| **编排者** | 任意 harness session：WorkBuddy（有人值守，单轮 + 修复批）/ **DSH 无头（主载体，无人值守多轮）** / Codex headless |
| **角色执行** | 三通道任选（见主任务协议第 2 条；每角色独立上下文） |
| **执行器** | `node FORGE/src/fresh-eyes-driver.mjs --worker --step <step> --round-dir <abs> --target <ver>`（通道②专用；DSH 后端；worktree 隔离经 `FORGE_WORKTREE_ROOT` 环境变量继承——由编排方建立并注入；内置 stall 守卫与工具软硬熔断） |
| **产物契约** | `runs/` 文件即状态 + `tools/check/check-fresh-eyes-artifacts.mjs` 守闸（存在性 + schema + 计数一致性，fail-closed） |

**快速模式与无人值守是同一协议的预算参数差异**：有人值守 = 1 轮审查 + 修复批（阶段三常用形态）；无人值守 = max-rounds 多轮收敛。不是两套流程，SOP 只此一份。

**driver 编排入口已删除（2026-09-26 整合归一）**：`fresh-eyes-driver.mjs` 现仅含 worker 单步执行链路（多轮编排循环及其专属机制——停止判定 / 分片编排 / spawn 编排 / LEDGER 写入 / latest.json 指针 / watcher——已随归一删除，经验沉淀于 `FORGE/lessons/driver.md`）。无参调用或编排参数会得到退役提示与 exit 2。

> 角色以现行**单盲四角色**（A 审 → B 修 → C 验 → D 复核，SSOT = `docs/changelog/releasing/auto-converge-protocol.md`）为准；下方「单轮协议」示例为 legacy 双盲形态（`FORGE_ENABLE_B_CHECK=1` 逃生门），两形角色映射见 auto-converge。

### harness 注入形态 · 主任务协议（注入即跑）

对 harness 注入以下主任务（替换花括号占位符）。执行体无对话上下文——本协议自包含：

1. **状态接续先行**：runDir = `FORGE/SKILL/fresh-eyes-loop/runs/YYYY/MM/DD/run-NN/`。已存在产物 → 读最高 `round-NN` 与 `status.md` 按断点续跑，**已完成轮禁止重开**；不存在 → 建目录开工。
2. **角色零上下文纪律（防「发现者 = 修复者」）**：编排者不得在同一上下文里既发现又修复。角色执行三通道任选（每角色独立上下文）：① 本运行自身的注入即零上下文——仅首个角色可用（通常是 A 审查）；② 执行器单步：`node FORGE/src/fresh-eyes-driver.mjs --worker --step <step> --round-dir <abs> --target <ver>`（worktree 隔离经 `FORGE_WORKTREE_ROOT` 由编排方建立并注入；内置 stall 守卫与工具熔断）；③ 有头 session 的 subagent。
3. **每轮落盘（文件即状态）**：按「产物 Schema」节写 round-NN/ 文件；另维护两份状态产物——**`status.md`** 单行现态（格式：`round-NN · <phase> · P0=<n>/P1=<n>`，phase ∈ {reviewing / fixing / verifying / done}，对应四角色 A 审 → B 修 → C 验 → D 复核），它是断点续跑与外部监督的唯一现态锚；**`verdict.md`**（终态判定，D 复核收口时写：停止原因 + 最终 P0/P1 定性结论 + 判定关键行原文，对齐 auto-converge 最终汇报的「判定关键行原文」要求）。
4. **收敛与红线**：停止条件按上方「停止条件」节执行；收敛语义（分诊三定性 / 停手条件）以 `docs/changelog/releasing/auto-converge-protocol.md` 为单一维护源。**run 纪律红线（自包含内联，违反即 run 报废级事故）**：① run 窗口内（审查/修复/验证进行中）任何 session 不 commit / 不改仓库文件；② 修复批不得改执行器源码（`FORGE/src/fresh-eyes-driver.mjs`）、审查视角定义（`playbook/fresh-eyes-review.md`）与校准档案（`playbook/fresh-eyes-calibration.md`）——原 commit-msg hook 冻结窗口机制锁已退役，本声明为唯一约束面，细则与后果见 `docs/changelog/releasing/03-quality-loop.md` 铁律五条。
5. **机器守闸**：`node tools/check/check-fresh-eyes-artifacts.mjs --runDir <abs>` 校验产物契约（存在性 + schema + 计数一致性）——编排者停止条件判定的机械面；`--self-test` 自检。
6. **收尾两动作**：`FORGE/LEDGER.md` 追加一行；最终汇报按 `docs/changelog/releasing/03-quality-loop.md` 汇报模板（含「未跑步骤声明」）。

### 注入包安全纪律

- **注入包本体 = 交付物**：落 runDir 存档（`injection-prompt.md`），不得只存在于对话——审计链要求每次注入可追溯。
- **注入即授权改仓 + 跑测试**：主任务必须显式携带**越界清单**（不做 push / tag / publish、不动 FORGE 源码与审查视角定义、不改 devlog 勾选、不自称收编——复验收编是主 session 职责）。
- **执行产生的 commit 过审计钩子**（25 条规则 + HMAC 链，机制强制非纪律约束）。

## 执行器实现提示（`--worker` 单步链路）

- 每个角色 step 由执行器在独立子进程内跑（真零上下文）：编排方按角色逐次调用 `--worker`，子进程读 `prompts/*.md` 作为行为指令。
- 12 视角正文不塞 prompt（太长）——prompt 里写"按 `playbook/fresh-eyes-review.md` 的 12 视角跑"，让执行器自行读取。
- 编排方职责（协议第 2-3 条）：逐角色调用执行器、在角色间传产物文件、维护 status.md、判定停止。

## 循环级演化（evolution.md）

`evolution.md` 是人类门控的"加一减一"改进记录：每次循环后若发现 specs/prompts 该增删，提出**一条加 + 一条减**的建议，由人类确认后才落地。防止 specs 无限膨胀成"屎山"。
