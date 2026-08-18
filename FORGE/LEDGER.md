# LEDGER · 质量循环跨 Run 永久索引

> ⚠️ **内部工具文件**：本文件是 sofagent 项目 FORGE 自迭代工具链的内部状态记录，非面向用户的文档。其中的 FAIL 记录、勘误行等均为开发过程正常产物，不代表产品质量问题。

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

> 📌 **关于 FAIL 记录**：以下记录反映了 FORGE 质量循环从 v1.0.5 到 v1.2.8 的真实迭代过程。早期的 FAIL 主要来自工具链 bug（driver 解析 bug、U+FFFD 编码问题、coverage 零覆盖），而非产品功能缺陷。这些问题在迭代中逐步修复，最终 run-24 达到 PASS。保留原始记录是 append-only 纪律的要求，也是 sofagent"审计每次变更"理念在自身开发中的实践。

2026-07-26     | 20260726-03    | fresh-eyes  | 1    | 14  | 21  | 16  | max-rounds      | FORGE/SKILL/fresh-eyes-loop/runs/2026/07/26/run-03

2026-07-28     | 20260728-05    | release-gate | 4    | FAIL       | SKIP       | FAIL     | FAIL    | ~/.sofagent/data/forge-runs/release-gate-loop/2026-07-28/run-05

2026-07-29     | 20260729-01    | release-gate | 4    | FAIL       | SKIP       | FAIL     | FAIL    | ~/.sofagent/data/forge-runs/release-gate-loop/2026-07-29/run-01

2026-07-29     | 20260729-02    | release-gate | 4    | SKIP       | FAIL       | FAIL     | FAIL    | ~/.sofagent/data/forge-runs/release-gate-loop/2026-07-29/run-02

2026-07-29     | 20260729-03    | release-gate | 4    | SKIP       | FAIL       | FAIL     | FAIL    | ~/.sofagent/data/forge-runs/release-gate-loop/2026-07-29/run-03

2026-07-29     | 20260729-04    | release-gate | 4    | SKIP       | FAIL       | FAIL     | FAIL    | ~/.sofagent/data/forge-runs/release-gate-loop/2026-07-29/run-04

2026-07-29     | 20260729-08    | release-gate | 5    | FAIL       | FAIL       | FAIL     | FAIL    | ~/.sofagent/data/forge-runs/release-gate-loop/2026-07-29/run-08

2026-07-29     | 20260729-14    | release-gate | 4    | FAIL       | SKIP       | FAIL     | FAIL    | ~/.sofagent/data/forge-runs/release-gate-loop/2026-07-29/run-14

2026-07-29     | 20260729-16    | release-gate | 3    | FAIL       | FAIL       | FAIL     | ERROR   | ~/.sofagent/data/forge-runs/release-gate-loop/2026-07-29/run-16

2026-07-31     | 20260731-01    | release-gate | 5    | FAIL       | FAIL       | FAIL     | FAIL    | ~/.sofagent/data/forge-runs/release-gate-loop/2026-07-31/run-01

2026-07-31     | 20260731-04    | release-gate | 5    | FAIL       | FAIL       | FAIL     | FAIL    | ~/.sofagent/data/forge-runs/release-gate-loop/2026-07-31/run-04

2026-07-31     | 20260731-05    | release-gate | 5    | FAIL       | FAIL       | FAIL     | FAIL    | ~/.sofagent/data/forge-runs/release-gate-loop/2026-07-31/run-05

2026-07-31     | 20260731-05*   | release-gate | 5    | PASS       | PASS       | PASS     | PASS    | 勘误：run-05 真实裁决 PASS（verdict.md 权威）。上行为 driver parseVerdict/parseStepResults 解析 bug（commit a845ed8 已修）导致的误标，特此补正。run-01/run-04 的 FAIL 为真实裁决（coverage 零覆盖 + regression U+FFFD），未受此 bug 影响。

2026-08-02     | 20260802-05    | fresh-eyes  | 2    | 0   | 0   | 0   | 2-rounds-clean  | ~/.sofagent/data/forge-runs/fresh-eyes-loop/2026-08-02/run-05

2026-08-02     | 20260802-06    | fresh-eyes  | 3    | 0   | 0   | 0   | weighted-convergence | ~/.sofagent/data/forge-runs/fresh-eyes-loop/2026-08-02/run-06

2026-08-03     | 20260803-02    | release-gate | 3    | PASS       | SKIP       | SKIP     | FAIL    | ~/.sofagent/data/forge-runs/release-gate-loop/2026-08-03/run-02

2026-08-03     | 20260803-06    | release-gate | 4    | PASS       | FAIL       | SKIP     | FAIL    | ~/.sofagent/data/forge-runs/release-gate-loop/2026-08-03/run-06

2026-08-03     | 20260803-08    | release-gate | 5    | PASS       | FAIL       | PASS     | FAIL    | ~/.sofagent/data/forge-runs/release-gate-loop/2026-08-03/run-08

2026-08-05     | 20260805-03    | fresh-eyes  | 2    | 0   | 0   | 0   | consecutive-degraded-error | ~/.sofagent/data/forge-runs/fresh-eyes-loop/2026-08-05/run-03

2026-08-05     | 20260805-05    | fresh-eyes  | 2    | 1   | 1   | 0   | consecutive-degraded-error | ~/.sofagent/data/forge-runs/fresh-eyes-loop/2026-08-05/run-05

2026-08-05     | 20260805-06    | fresh-eyes  | 5    | 1   | 1   | 2   | weighted-convergence | ~/.sofagent/data/forge-runs/fresh-eyes-loop/2026-08-05/run-06

2026-08-06     | 20260806-06    | release-gate | 5    | SKIP       | SKIP       | PASS     | PASS    | ~/.sofagent/data/forge-runs/release-gate-loop/2026-08-06/run-06

2026-08-07     | 20260807-24    | release-gate | 8    | FAIL       | FAIL       | PASS     | PASS    | ~/.sofagent/data/forge-runs/release-gate-loop/2026-08-07/run-24

2026-08-08     | 20260808-12    | fresh-eyes  | 2    | 0   | 0   | 0   | 2-rounds-clean  | /Users/kongfangxun/.sofagent/data/forge-runs/fresh-eyes-loop/2026-08-08/run-12

2026-08-08     | 20260808-07    | release-gate | 17   | PASS       | PASS       | PASS     | PASS    | /Users/kongfangxun/.sofagent/data/forge-runs/release-gate-loop/2026-08-08/run-07

2026-08-09     | 20260809-21    | fresh-eyes  | 3    | 0   | 0   | 0   | 2-rounds-clean  | /Users/kongfangxun/.sofagent/data/forge-runs/fresh-eyes-loop/2026-08-09/run-21

2026-08-09     | 20260809-21    | release-gate | 20   | FAIL       | PASS       | PASS     | PASS    | /Users/kongfangxun/.sofagent/data/forge-runs/release-gate-loop/2026-08-09/run-21

2026-08-10     | 20260810-03    | fresh-eyes  | 2    | 0   | 10  | 1   | consecutive-degraded-error | /Users/kongfangxun/.sofagent/data/forge-runs/fresh-eyes-loop/2026-08-10/run-03

2026-08-10     | 20260810-10    | release-gate | 20   | FAIL       | SKIP       | FAIL     | PASS    | /Users/kongfangxun/.sofagent/data/forge-runs/release-gate-loop/2026-08-10/run-10

2026-08-10     | 20260810-13    | release-gate | 20   | PASS       | FAIL       | PASS     | PASS    | /Users/kongfangxun/.sofagent/data/forge-runs/release-gate-loop/2026-08-10/run-13

2026-08-11     | 20260811-11    | fresh-eyes  | 2    | 0   | 0   | 0   | 2-rounds-clean  | /Users/kongfangxun/.sofagent/data/forge-runs/fresh-eyes-loop/2026-08-11/run-11

2026-08-12     | 20260812-01    | release-gate | 17   | PASS       | PASS       | PASS     | PASS    | /Users/kongfangxun/.sofagent/data/forge-runs/release-gate-loop/2026-08-12/run-01

2026-08-13     | 20260813-01    | release-gate | 20   | FAIL       | FAIL       | FAIL     | PASS    | /Users/kongfangxun/.sofagent/data/forge-runs/release-gate-loop/2026-08-13/run-01

2026-08-13     | 20260813-04    | release-gate | 17   | PASS       | PASS       | PASS     | PASS    | /Users/kongfangxun/.sofagent/data/forge-runs/release-gate-loop/2026-08-13/run-04

2026-08-14     | 20260814-01    | release-gate | 19   | PASS       | SKIP       | FAIL❗修正 | FAIL❗修正 | /Users/kongfangxun/.sofagent/data/forge-runs/release-gate-loop/2026-08-14/run-01

2026-08-14     | 20260814-04    | release-gate | 16   | PASS       | SKIP       | PASS     | PASS❗补跑 | /Users/kongfangxun/.sofagent/data/forge-runs/release-gate-loop/2026-08-14/run-04（regression 首跑瞬时 LLM 故障，补跑 FAIL=0，verdict IS_PASS:YES 真通过——尾列 ERROR 是 stopReason 残留标记，人工修正）

2026-08-15     | 20260815-05    | fresh-eyes  | 3    | 0   | 0   | 1   | consecutive-degraded-error | /Users/kongfangxun/.sofagent/data/forge-runs/fresh-eyes-loop/2026-08-15/run-05

2026-08-15     | 20260815-06    | fresh-eyes  | 3    | 0   | 0   | 1   | consecutive-degraded-error | /Users/kongfangxun/.sofagent/data/forge-runs/fresh-eyes-loop/2026-08-15/run-06

2026-08-16     | 20260815-07    | fresh-eyes  | 4*   | 0   | 9(R1)   | 10(R1) | aborted-env-conflict（R1 完整且修复有效；R2-R4 报告在档但合并两度降级 + 两次进程死亡：仓库基线 restore 重建与红队 worker git 测试竞态；详见 run-07/progress.jsonl） | /Users/kongfangxun/.sofagent/data/forge-runs/fresh-eyes-loop/2026-08-15/run-07

2026-08-16     | 20260816-01    | release-gate | 20   | PASS       | FAIL❗修正 | PASS     | FAIL❗修正 | /Users/kongfangxun/.sofagent/data/forge-runs/release-gate-loop/2026-08-16/run-01（❌ 假 PASS 事故：status.json 写 PASS/regression=SKIP 与 verdict.md 的 FAIL 矛盾——verdict 为权威。真实 FAIL=维度 17 bin 权限 + 维度 78 版本头；维度 72 是检查命令注释误报已修正。F 修复循环 commit 失败未闭环。两 FAIL 已于当日修复，见 run-02 重跑）

2026-08-16     | 20260816-07    | release-gate | 17   | PASS       | FAIL       | FAIL     | ERROR   | /Users/kongfangxun/.sofagent/data/forge-runs/release-gate-loop/2026-08-16/run-07

2026-08-16     | 20260816-10    | release-gate | 0    | PASS       | SKIP       | SKIP     | ERROR   | /Users/kongfangxun/.sofagent/data/forge-runs/release-gate-loop/2026-08-16/run-10
2026-08-17     | 20260817-03    | fresh-eyes  | 2.5* | 0   | 4(R2)   | 3(R2) | aborted-user-stop（R1 a-consolidate 降级误判 clean；R2 正常合并 P1×4/P2×3 并 b-fix 修复 finding-01 安装 URL v1.3.5→v1.3.6（worktree commit 727104b + README/README.en/.gitignore 未提交）；R3 起步 2 worker 后用户终止——单轮 ~95min 串行太慢阻塞后续工作；降速根因与 v1.3.7 自适应并发方案见 v1.3.7.md §一点五） | /Users/kongfangxun/.sofagent/data/forge-runs/fresh-eyes-loop/2026-08-17/run-03
2026-08-17     | 20260817-05    | release-gate | 0.5  | 0    | 0    | 0    | aborted-oom-sigkill（acceptance 12/12 分片完成+合并报告 acceptance.md 已产出 222/222 PASS·299/299 脚本口径；acceptance-consolidate 步骤后整树 SIGKILL——FORGE_MAX_CONCURRENCY=1 未对 acceptance 分片批次生效（并发 6×2GB heap），8GB 机器 OOM；无 fatal 事件/latest.json，worktree 残留 run-05 待清。修复方向：driver 分片批次并发上限须尊重 FORGE_MAX_CONCURRENCY） | /Users/kongfangxun/.sofagent/data/forge-runs/release-gate-loop/2026-08-17/run-05

2026-08-17     | 20260817-05    | release-gate | 17   | PASS       | PASS       | PASS     | PASS    | /Users/kongfangxun/.sofagent/data/forge-runs/release-gate-loop/2026-08-17/run-05

2026-08-17     | 20260817-08    | release-gate | 19   | PASS       | SKIP       | PASS     | PASS    | /Users/kongfangxun/.sofagent/data/forge-runs/release-gate-loop/2026-08-17/run-08
2026-08-17     | 20260817-08❗   | release-gate | 19   | PASS❗复验FAIL | SKIP       | PASS     | PASS→FAIL | 复验修正：driver 自报 PASS 为假 PASS——verdict.md 主体=FAIL（regression 5 维 exit=1：#8/#56/#59/#96/#103 + #106/#110 ERR + regression.md 产物缺失）；F 链 f-diagnose/f-fix 双撞硬熔断走降级，f-fix 零代码改动（分支 forge/release-gate/20260817-08 自基线 1443c22 零 commit），f-audit 对空 diff 假绿，尾部追加段「FAIL→PASS」不可信（v1.3.4 带伤 PASS 同款）；stepErrors=[regression] 非空未作废本轮。真实裁决以 verdict.md 主体为准=FAIL，交回阶段五 | /Users/kongfangxun/.sofagent/data/forge-runs/release-gate-loop/2026-08-17/run-08

2026-08-18     | 20260818-01    | release-gate | 20   | PASS       | FAIL       | PASS     | PASS    | /Users/kongfangxun/.sofagent/data/forge-runs/release-gate-loop/2026-08-18/run-01
2026-08-18     | 20260818-01❗   | release-gate | 20   | PASS❗复验FAIL | FAIL       | PASS     | PASS→FAIL | 复验修正（run-08 同款假 PASS 第二次）：verdict.md 主体=FAIL（regression 一票否决：55/87 维 precheck 中段截断 63% 盲区 + #102/103/104 市场簇同簇缺失疑 market→commons 更名检查未同步 + #98/99 路径缺 PROJECT_ROOT + #106 超时 + #94/101 脚本自身缺陷 + #1 glob 缺失）；F 链 f-fix 报告自述「修复验证❌未通过」但 driver 仅凭空 diff 的 f-audit 全绿判「修复收敛 FAIL→PASS」（F 分支零 commit 三方证据：verdict 主体 FAIL + f-fix 自述未通过 + git 零 commit）。driver 债确认：f-audit 无「分支有无新 commit」前置校验，必修后才能再跑。真实裁决=FAIL 交回阶段五 | /Users/kongfangxun/.sofagent/data/forge-runs/release-gate-loop/2026-08-18/run-01

2026-08-18     | 20260818-08    | release-gate | 17   | PASS       | PASS       | PASS     | PASS    | /Users/kongfangxun/.sofagent/data/forge-runs/release-gate-loop/2026-08-18/run-08
| run-27 | 2026-08-18 | fresh-eyes | v1.3.7 阶段四 | aborted-sandbox-kill | driver+worker 双亡（nohup 启动违反 SOP——被沙箱 session 清理，同 run-12 死法）；round-1 a-check-p1 中断，零 finding 产出 | 主 session |
| run-28 | 2026-08-18 | fresh-eyes | v1.3.7 阶段四 | aborted-session-reclaim | 24 视角+合并 15 finding（0P0/4P1/11P2）全部落盘后，a-verify 分片 1/3 裸 LLM 降级调用中进程静默消失（无栈无 OOM 无退出标记，日志冻结于 22:23:30/心跳止于 22:25:55）——run-27 nohup 死法后又一同款：driver 随启动 session 被回收。finding 资产可复用，主 session 已接手零信任复验 | /Users/kongfangxun/.sofagent/data/forge-runs/fresh-eyes-loop/2026-08-18/run-28 |
