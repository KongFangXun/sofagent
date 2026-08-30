# release-gate-loop · 循环 SOP

> 本文件定义发版闸门循环的**运行协议**。V 的具体行为指令在 `prompts/`。
> v1.2.9 升级：从线性 5 步升级为验-改循环（V FAIL → F 修复 → V 重验）。

## 核心原则

1. **V 只验证不修复**：V 的 5 步全部纯只读（铁律）。V 只验证 + 生成报告，不做修复。工具集只有只读工具。
2. **F 只修复 V 指出的问题**：F 读 V 的 verdict 报告 → 定位根因 → 改代码（最小改动）。改完 driver 自动跑 audit。
3. **验-改循环**：verdict FAIL 时触发 F 步骤链 → f-diagnose → f-fix → f-audit → 新一轮 V 全量重验。最大 3 轮。
4. **确定性优先**：跑的是确定性清单（acceptance-test.sh + regression-checklist），不是直觉审查。双盲审查是 fresh-eyes-loop 的专利。
5. **步骤崩溃不中断**：某步子进程崩溃，继续执行后续步骤，verdict 基于不完整数据判 FAIL。

## 角色

| 角色 | 身份 | 动作 | 产物 |
|------|------|------|------|
| **V** | 验证者 | 5 步串行验证 | `acceptance.md` → `regression.md` → `coverage.md` → `stage6-report.md` → `verdict.md` |
| **F** | 修复者 | verdict FAIL 后修复代码 | `fix-plan.md` → `fix-summary.md` → `audit-result.md` |
| **driver** | 用户手动新开的执行 session（见 SKILL.md「执行载体铁律」） | 中转文件、建 `runs/`、复制报告到桌面、写 `LEDGER.md` | `runs/` 目录 + LEDGER 行 |

## 目录约定（round 层级）

```
~/.sofagent/data/forge-runs/release-gate-loop/YYYY-MM-DD/run-NN/
├── round-1/
│   ├── acceptance.md
│   ├── regression.md
│   ├── coverage.md
│   ├── stage6-report.md
│   ├── verdict.md          ← V 裁决 FAIL
│   ├── fix-plan.md         ← F 诊断产出的修复方案
│   ├── fix-summary.md      ← F 修复记录
│   └── audit-result.md     ← sofagent-audit 检查结果
├── round-2/
│   ├── acceptance.md       ← V 重验
│   └── ...
└── verdict.md              ← 最终裁决（复制最后一轮的）
```

## 单轮协议（Step Protocol）

### V 验证阶段（每轮固定 5 步）

```
① acceptance  → 跑 bash FORGE/playbook/acceptance-test.sh    → 产物 acceptance.md
② regression  → 读 regression-checklist.md 跑各维度命令      → 产物 regression.md
③ coverage    → 读 changelog 功能点，逐条 grep acceptance-test → 产物 coverage.md
④ consolidate → 合并三份产物                                  → 产物 stage6-report.md
⑤ verdict     → PASS/FAIL 裁决                               → 产物 verdict.md
```

### F 修复阶段（verdict FAIL 时触发）

```
⑥ f-diagnose  → F 读 verdict.md → 定位根因 → 写 fix-plan.md
⑦ f-fix       → F 读 fix-plan.md → 改代码 → 写 fix-summary.md
⑧ f-audit     → driver 自动跑 sofagent-audit --diff HEAD~1..HEAD
                audit PASS → 进入 round N+1（新一轮 V 全量重验）
                audit FAIL → 打回 f-fix 重修
```

### 收敛判定

```
verdict = PASS → 出 loop，可以发版 ✅
verdict = FAIL 且 round < 3 → 触发 F 步骤链 → round N+1
verdict = FAIL 且 round ≥ 3 → 输出"需人工介入"报告 ❌ → 出 loop
```

## 产物 Schema

| 文件 | 步骤 | 内容 |
|------|------|------|
| `acceptance.md` | ① | acceptance-test.sh 执行结果 |
| `regression.md` | ② | regression-checklist 逐维度结果 |
| `coverage.md` | ③ | changelog 功能点 vs acceptance-test 交叉覆盖 |
| `stage6-report.md` | ④ | 合并报告 |
| `verdict.md` | ⑤ | PASS/FAIL 裁决 |
| `fix-plan.md` | ⑥ v1.2.8 | F 诊断的修复方案 |
| `fix-summary.md` | ⑦ v1.2.8 | F 修复记录 |
| `audit-result.md` | ⑧ v1.2.8 | sofagent-audit 检查结果 |

## createReactAgent 实现提示

- V 用 `REVIEWER_TOOLS`（只读工具集）；F 用 `ENGINEER_TOOLS`（含 write/edit）。
- F 由 Node driver spawn 独立子进程（与 B 共用 engineer skill）。
- f-audit 是 driver 步骤（role: null），不调 LLM，driver 直接执行 `runAuditGate()`。

## 循环级演化（evolution.md）

`evolution.md` 是人类门控的"加一减一"改进记录：每次循环后若发现 specs/prompts 该增删，提出**一条加 + 一条减**的建议，由人类确认后才落地。防止 specs 无限膨胀成"屎山"。
