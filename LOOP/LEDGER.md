# LEDGER · 质量循环跨 Run 永久索引

> **这是唯一被 git 跟踪的循环状态文件。** 它不随 `runs/` 清理而消失。
>
> 原则：**目录（指针 + 统计）vs runs/（正文，可丢弃）**。
> - `runs/YYYY/MM/DD/round-NN/` 存每一轮的完整正文（check-a / check-b / findings / result / summary），发版后或磁盘压力大时可整体删除。
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
| runs 指针 | 相对仓库根的路径，如 `LOOP/SKILL/fresh-eyes-loop/runs/2026/07/25/run-01` |

## 示例

```
# 日期          | run-id        | 循环       | 轮数 | P0 | P1 | P2 | 停止原因       | → runs 指针
2026-07-25      | 20260725-01   | fresh-eyes | 3    | 0  | 0  | 7  | 2-rounds-clean | LOOP/SKILL/fresh-eyes-loop/runs/2026/07/25/run-01
```
