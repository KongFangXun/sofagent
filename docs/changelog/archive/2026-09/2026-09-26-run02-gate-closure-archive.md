# run-02 发版闸门前置闭环归档（2026-09-26）

对应 `verdict.md` 第四节前置项 1 / 3 / 4（K2 台账、S316 复位、动态口径确认）。

---

## A. S316 去向说明与复位留痕（前置项 1 · P1-1）

### 裁定：**误删，非漏跑 → P0 升级条款不触发**

| 证据 | 结论 |
|---|---|
| `git log --oneline -S 'scenario 316' -- playbook/acceptance-test.sh` 双命中 | `2b1717e0`（v1.3.9 批次加入）→ `15959531`（后续批次整理时**静默删除**） |
| 被断言特性 `--daemon` / `--watch` / `--resume` | 至今活体于 `FORGE/src/release-gate-driver.mjs:338-339` |
| run-02 验收实收 376 段与场景索引 376 条 | 双向一致——缺席属计划外误删，非执行漏跑 |

### 修复

`playbook/acceptance-test.sh` 已复位场景 S316（4 行，位于 L2666 空档）：

```bash
scenario 316 "v1.3.9 交付十三：FORGE driver 进程守护——daemon 自脱离 + watcher 自动 resume"; S316_OK=true
grep -q -- "--daemon" "$PROJECT_ROOT/FORGE/src/release-gate-driver.mjs" || S316_OK=false
grep -q -- "--watch" "$PROJECT_ROOT/FORGE/src/release-gate-driver.mjs" || S316_OK=false
grep -q -- "--resume" "$PROJECT_ROOT/FORGE/src/release-gate-driver.mjs" || S316_OK=false
```

- 断言目标相对 `15959531` 删除前版本**修正**：`src/daemon-manager.mjs` → `FORGE/src/release-gate-driver.mjs`（现行活体文件）
- 修复 commit：`e1cf9ed4`（本 worktree F 分支）
- 升级条款：**不触发**（证实为覆盖声明误删，非验收执行漏跑）

---

## B. 场景缺号台账（前置项 3 · K2）

| 缺号 | 取证（`git log -S` 全历史） | 定性 | 处置 |
|---|---|---|---|
| S36 | 全历史空命中 | 计划跳号（从未分配） | 台账登记，无代码修改 |
| S38 | 全历史空命中 | 计划跳号（从未分配） | 台账登记，无代码修改 |
| S364 | 全历史空命中 | 计划跳号（从未分配） | 台账登记，无代码修改 |
| S366 | 全历史空命中 | 计划跳号（从未分配） | 台账登记，无代码修改 |
| S417 | `git log -S 'S417'` 双处留痕（raw log L1682/L1685：`merged into S379`） | 并入 S379 | 台账登记，无代码修改 |

### 上轮 coverage 编号闭环对账

上轮（run-01）coverage 报告中更早编号的发现，本轮已全部在 verdict 三子闸门证据中有对应闭环记录；无遗留未对账项。

---

## C. S165/S360/S362 对账断言口径确认备忘（前置项 4 · K3）

### 结论：**三处均为动态口径，无硬编码 25/28，无需改动**

| 场景 | 实测断言形态 | 判定 |
|---|---|---|
| S165 | `裸 awk 计算 + bc 阈值比较` | 动态计算，无硬编码 |
| S360 | `P1 基线锚定 + 演进验证（hard）`（此前已收紧，对账同时引用基线与演进两侧计数） | 动态口径 |
| S362 | 同 S360 收紧方式 | 动态口径 |

- A24 后 25→26 口径变化对三处均无影响（计数由表达式现算，不引用字面量）
- check-docs §17 精确数对账：本版执行结论与 verdict 一致（前置项 7 一并确认）
- 其余 K3 子项（S172/S180 阈值余量、S208/S209/S211 裸 PASS、S34/S41/S270/S318/S319 口径浮动）属 verdict 发版后跟进项，**不在本轮范围**

---

## D. 处置汇总

| 前置项 | 处置 | commit |
|---|---|---|
| 1（S316） | 代码复位（acceptance-test.sh）+ 本文件 A 节留痕 | `e1cf9ed4` |
| 3（K2 台账） | 本文件 B 节归档（五缺号均无代码修改依据） | 本 commit |
| 4 / 7（动态口径 + §17） | 本文件 C 节确认备忘（零改动） | 本 commit |
| 2（K1 钉值） | bootstrap.sh 登记 + 轮转时序 | `29fb702d` |
| 5（marketplace 有网复跑） | 见 fix-summary 遗留风险（本环境无网，证据待补） | — |
| 6（材料归档） | run-02 目录即归档位；v1.5.3.md 模块九/十核对由 f-release 承接 | — |
| 8（bump + tag 后复验） | SOP 阶段六时序项，非本轮 | — |
