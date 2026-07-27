# LEDGER · 质量循环跨 Run 永久索引

> **这是唯一被 git 跟踪的循环状态文件。** 它不随 `runs/` 清理而消失。
>
> 原则：**目录（指针 + 统计）vs runs/（正文，可丢弃）**。
> - `<loop>/runs/YYYY/MM/DD/round-NN/` 存每一轮的完整正文（check-a / check-b / findings / result / summary），发版后或磁盘压力大时可整体删除。每个 loop 自带独立 runs/，多 loop graph 时各自隔离。
> - 本文件是跨 run 的永久索引：每一轮循环追加一行，记录日期、run-id、轮数、各级问题数、停止原因、指向 runs/ 的指针。即使 runs/ 被清空，本文件仍能回答"我们做过几轮、每轮发现了什么量级的问题"。

## 写入纪律

- **追加 only**，绝不修改历史行。
- 每一轮完整循环（从启动到满足停止条件）结束后追加一行。
- 一行一个 run；同一天多次跑循环 = 多个 run（run-id 带序号）。

## 列定义

```
日期 | run-id | 循环 | 轮数 | P0 | P1 | P2 | 停止原因 | → runs 指针
```

| 列 | 含义 |
|----|------|
| 日期 | `YYYY-MM-DD` |
| run-id | `YYYYMMDD-NN`（同日第 NN 次循环） |
| 循环 | `fresh-eyes` |
| 轮数 | 实际跑了几轮（round-01 … round-NN） |
| P0/P1/P2 | 该 run 最终 findings 中各级问题总数（去重后） |
| 停止原因 | `2-rounds-clean`（连续 2 轮无 P0/P1）/ `human-stop` / `max-rounds` |
| runs 指针 | 相对仓库根的路径，如 `FORGE/SKILL/fresh-eyes-loop/runs/2026/07/25/run-01` |

## 示例

```
# 日期          | run-id        | 循环       | 轮数 | P0 | P1 | P2 | 停止原因       | → runs 指针
2026-07-25      | 20260725-01   | fresh-eyes | 3    | 0  | 0  | 7  | 2-rounds-clean | FORGE/SKILL/fresh-eyes-loop/runs/2026/07/25/run-01
```

---

## release-gate 循环列定义

release-gate-loop 与 fresh-eyes-loop 共享本文件，通过"循环"列区分。列格式不同：

```
日期 | run-id | 循环 | 步数 | acceptance | regression | coverage | 裁决 | → runs 指针
```

| 列 | 含义 |
|----|------|
| 日期 | `YYYY-MM-DD` |
| run-id | `YYYYMMDD-NN`（同日第 NN 次循环） |
| 循环 | `release-gate` |
| 步数 | 实际完成的步骤数（正常 5，有崩溃可能 < 5） |
| acceptance | 步骤①验收测试结果：`PASS` / `FAIL` / `SKIP` |
| regression | 步骤②回归检查结果：`PASS` / `FAIL` / `SKIP` |
| coverage | 步骤③覆盖率交叉检查结果：`PASS` / `FAIL` / `SKIP` |
| 裁决 | 最终判定：`PASS`（全 PASS）/ `FAIL`（有任一 FAIL）/ `ERROR`（步骤崩溃） |
| runs 指针 | 相对仓库根或 SOFAGENT_HOME 的路径 |

### release-gate 示例

```
# 日期          | run-id        | 循环        | 步数 | acceptance | regression | coverage | 裁决  | → runs 指针
2026-07-27      | 20260727-01   | release-gate| 5    | PASS       | PASS       | PASS     | PASS  | ~/.sofagent/data/forge-runs/release-gate-loop/2026-07-27/run-01
```

---

## 运行记录

2026-07-26     | 20260726-03    | fresh-eyes  | 1    | 14  | 21  | 16  | max-rounds      | FORGE/SKILL/fresh-eyes-loop/runs/2026/07/26/run-03
