# fresh-eyes-loop · 循环 SOP

> 本文件定义质量循环的**运行协议**。A/B 的具体行为指令在 `prompts/`，12 视角定义在 `specs/fresh-eyes-review.md`。

## 核心原则

1. **零上下文每轮**：A 和 B 每一轮都用**全新 session**（DeepAgents 开 session，或刷新对话）。上一轮的记忆不在这一轮。这是 fresh-eyes 纪律的硬保障——作者在项目里待太久产生的"解释盲区"被结构性消解。
2. **双盲独立**：A 和 B 跑的是**同一套 12 视角**，但互相不知道对方看到了什么。两人在不同 session 独立产出，合并时才对照。重叠 = 高置信问题；单方独特发现 = 也值得记。
3. **driver 只 relay，不审查**：driver（"我"，当前会话）负责在 A/B 之间传文件、维护 `runs/`、判定停止。**driver 不替 A/B 做判断**。
4. **不修改审查对象以外东西**：B 只修合并后的 findings 指向的问题，不顺手重构。

## 角色

| 角色 | 身份 | 每轮动作 | 产物 |
|------|------|---------|------|
| **A** | 审查者 / QA | ① 独立跑 12 视角审查 ② 合并 A/B 报告 ③ 验证 B 修复 | `check-a.md` → `findings.md` + `result.md` → 回填 verify |
| **B** | 工程师 | ① 独立跑 12 视角审查 ② 执行合并后的修复 | `check-b.md` → `summary.md` |
| **driver** | 当前会话 | 中转文件、建 `runs/`、判定停止、写 `LEDGER.md` | `runs/` 目录 + LEDGER 行 |

A/B 基于 `SKILL/agents/` 的 `reviewer` + `engineer` 两个 subagent 能力构建（同底座，不同行为指令）。

## 目录约定（3 级分层）

```
LOOP/SKILL/fresh-eyes-loop/runs/YYYY/MM/DD/run-NN/
```

- 不是每天都会跑循环，但不跑的那天不建目录。
- 一天多次跑 = `run-01` / `run-02` …（当日序号）。
- 每轮在 `run-NN/` 下再细分：`round-01/` `round-02/` …，每轮产物放对应 round 目录。

**跨 run 永久索引**：`LOOP/LEDGER.md`（被 git 跟踪，追加 only）。`runs/` 正文不进 git（见 `runs/.gitignore`）。

## 单轮协议（Round Protocol）

每一轮 N（round-NN）：

```
1. [A 新 session] 跑 12 视角审查        → runs/.../round-NN/check-a.md
2. [B 新 session] 跑 12 视角审查        → runs/.../round-NN/check-b.md   （双盲，独立）
3. [A session]    合并 check-a + check-b → findings.md（去重 + P0/P1/P2）+ result.md（给 B 的修复指令）
4. [B 新 session] 读 result.md 修复代码  → summary.md（改了什么文件 / 验证方式）
5. [A 新 session] 按 findings.md 验证修复 → 回填 result.md 的 verify 列（PASS/FAIL/无法验证）
6. driver 判定停止条件
```

> 步骤 1–2 可并行（A/B 互不影响）。步骤 3–5 必须串行（有依赖）。

## 产物 Schema

| 文件 | 作者 | 内容 |
|------|------|------|
| `check-a.md` / `check-b.md` | A / B | 各自 12 视角独立发现，每条带 `视角 / 文件路径 / 具体描述 / 优先级(P0\|P1\|P2)` |
| `findings.md` | A | 合并去重后的统一问题清单，按 P0→P2 排序，每条带 `来源(A/B/双)` |
| `result.md` | A | 给 B 的修复指令（每条 finding → 期望修复行为）；末尾 verify 列由步骤 5 回填 |
| `summary.md` | B | 修复记录：改了哪些文件、怎么验证、遗留风险 |

**优先级**：`P0` 严重/阻塞 · `P1` 应该修 · `P2` 观察项。

## 停止条件

- **主停止**：连续 **2 轮** `findings.md` 中 **无 P0 且无 P1** → 停止，本轮循环结束。
- **人工停止**：driver 在任意轮后判定 `human-stop`（如时间窗到了）。
- **上限**：设 `max-rounds`（默认 10），触顶强制停止并标注 `max-rounds`，遗留 P0/P1 进 `LEDGER.md` 备注。

停止后 driver 向 `LOOP/LEDGER.md` 追加一行（见 `LEDGER.md` 列定义）。

## DeepAgents 实现提示

- A/B 用 DeepAgents **开新 session** 实现零上下文；若平台不支持 per-round session，则用**对话刷新**替代（效果等价）。
- driver 把对应 `prompts/*.md` 作为 subagent 的 system/behavior 指令注入。
- 12 视角正文不必塞进 prompt（太长）——prompt 里写"按 `specs/fresh-eyes-review.md` 的 12 视角跑"，让 subagent 自行读取。

## 循环级演化（evolution.md）

`evolution.md` 是人类门控的"加一减一"改进记录：每次循环后若发现 specs/prompts 该增删，提出**一条加 + 一条减**的建议，由人类确认后才落地。防止 specs 无限膨胀成"屎山"。
