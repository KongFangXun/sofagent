# release-gate-loop · 循环 SOP

> 本文件定义发版闸门循环的**运行协议**。V 的具体行为指令在 `prompts/`。

## 核心原则

1. **纯只读**：整个循环**不得修改任何代码或文档**（铁律）。V 只验证 + 生成报告，不做修复。工具集只有只读工具（read_file / ls / glob / grep / run_bash），没有 write/edit 工具。
2. **单轮线性**：5 步串行执行，跑完即出结论。不循环、不收敛——一次过。
3. **确定性优先**：跑的是确定性清单（acceptance-test.sh + regression-checklist），不是直觉审查。双盲审查是 fresh-eyes-loop 的专利，验证清单单跑即够。
4. **步骤崩溃不中断**：某步子进程崩溃，继续执行后续步骤，verdict 基于不完整数据判 FAIL。比直接崩溃有诊断价值。

## 角色

| 角色 | 身份 | 动作 | 产物 |
|------|------|------|------|
| **V** | 验证者 | 5 步串行执行验证 | `acceptance.md` → `regression.md` → `coverage.md` → `stage6-report.md` → `verdict.md` |
| **driver** | 当前会话 | 中转文件、建 `runs/`、复制报告到桌面、写 `LEDGER.md` | `runs/` 目录 + LEDGER 行 |

V 基于 `SKILL/agents/` 的 `reviewer` SubAgent 能力构建（同底座，行为指令在 prompts/ 里）。

## 目录约定（2 级分层，无 round 层级）

```
~/.sofagent/data/forge-runs/release-gate-loop/YYYY-MM-DD/run-NN/
```

- 每次发版闸门验证 = 一个 `run-NN`。
- **无 round 层级**——单轮线性，不需要 round-NN 子目录。

**跨 run 永久索引**：`FORGE/LEDGER.md`（被 git 跟踪，追加 only）。`runs/` 正文不进 git（见 `runs/.gitignore`）。

## 单轮协议（Step Protocol）

```
① acceptance  → 跑 bash FORGE/playbook/acceptance-test.sh    → 产物 acceptance.md
② regression  → 读 regression-checklist.md 跑各维度命令      → 产物 regression.md
③ coverage    → 读 changelog 功能点，逐条 grep acceptance-test → 产物 coverage.md
④ consolidate → 合并三份产物                                  → 产物 stage6-report.md（复制到桌面）
⑤ verdict     → PASS/FAIL 裁决                               → 产物 verdict.md
```

> 5 步全部串行（有依赖链）。

## 产物 Schema

| 文件 | 步骤 | 内容 |
|------|------|------|
| `acceptance.md` | ① | acceptance-test.sh 执行结果：退出码、场景数、通过/失败/SKIP 数、失败清单 |
| `regression.md` | ② | regression-checklist 逐维度结果：PASS/FAIL/SKIP/⏰ 标注 |
| `coverage.md` | ③ | changelog 功能点 vs acceptance-test 交叉覆盖检查 |
| `stage6-report.md` | ④ | 合并报告：综合判定 + 三节摘要 + FAIL 清单 + 建议（复制到 `~/Desktop/vX.Y-stage6-report.md`） |
| `verdict.md` | ⑤ | 最终裁决：PASS/FAIL + 依据 + 下一步指引 |

## 停止条件

**无停止判定**——5 步跑完即结束。不循环。

某步子进程崩溃不中断循环：
- driver 打印警告
- 该步骤产物可能不完整
- 继续执行下一步骤
- 第⑤步 verdict 会基于不完整数据判定 FAIL
- LEDGER 记录 stopReason = 'step-error'

driver 向 `FORGE/LEDGER.md` 追加一行（见 `LEDGER.md` 列定义）。

## createReactAgent 实现提示

- V 由 Node driver（`FORGE/src/release-gate-driver.mjs`）spawn 独立子进程实现真零上下文。
- driver 把对应 `prompts/*.md` 作为 SubAgent 的 user message 注入，systemPrompt 从 `reviewer/SKILL.md` 构建。
- 5 步全部使用 `REVIEWER_TOOLS`（只读工具集）+ `deepseek-v4-flash` 模型。

## 循环级演化（evolution.md）

`evolution.md` 是人类门控的"加一减一"改进记录：每次循环后若发现 specs/prompts 该增删，提出**一条加 + 一条减**的建议，由人类确认后才落地。防止 specs 无限膨胀成"屎山"。
