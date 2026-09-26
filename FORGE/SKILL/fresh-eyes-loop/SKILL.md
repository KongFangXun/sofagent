---
name: fresh-eyes-loop
description: 发布后独立质量循环——单盲四角色流水线（A 审 12 视角 → B 修 → C 验 → D 复核），每轮新 session 保证零上下文，连续 2 轮无 P0/P1 即停。
emoji: 🔍
color: "#16B8F3"
version: 1.5.2
---

# fresh-eyes-loop · 质量循环定义

> **一个循环 = 一轮又一轮的"独立审查 → 修复 → 验证"，直到干净为止。**
>
> 这不是检查清单，是一套**让独立性可被重复执行**的机制。每一轮都用全新 session 跑（零上下文），所以"作者自己看不出问题"这个人类弱点被结构性消解。

## 这是什么

一套可复用的质量循环定义。它描述：谁来做（单盲四角色：A 审 / B 修 / C 验 / D 复核）、每一轮怎么走（审查 → 修复 → 验证 → 复核）、什么时候停（连续 2 轮无 P0/P1）、产物放哪（`runs/YYYY/MM/DD/run-NN/`）。

- **A** = 审查者（单盲）：独立跑 12 视角审查；发现的质量由下游 C 验收 / D 复核把关（legacy 双盲 B 并行审查走 `FORGE_ENABLE_B_CHECK=1` 逃生门）。
- **B/C/D** = 工程师执行修复（现行 B 侧为复核模式——独立复核 A 的 P0/P1，可推翻可补充）/ 验收者逐条实测验收（不采信修复自报）/ 复核者对 P0/P1 裁决 CONFIRM / DOWNGRADE / REOPEN。
- **编排者（非 agent）**：在角色间中转、维护 `runs/` 文件、判定停止条件。编排者 = **一次 harness session 本身**（WorkBuddy 有人值守 / DSH 无头 / Codex headless），注入 `loop.md`「执行形态」节的主任务协议即跑——不存在第二种编排形态（driver 多轮编排循环已随整合归一删除，经验沉淀于 `FORGE/lessons/driver.md`）。

## 怎么用

1. 读 `loop.md` 拿到完整 SOP（角色 / 轮次协议 / 产物 schema / 停止条件）。
2. 12 视角的定义见 `playbook/fresh-eyes-review.md`（A 按它跑）。playbook 共 **22 视角六层**：1-12 常规发版（driver 循环标准配置）、13-14 文档治理（手动）、15-16 全文档通读（手动/草稿工具）、**17-19 动态面**（跨组件契约/构建产物/执行证据——需跨包追踪或 build/实跑取证，worker 工具面实测仅 `sf_read` / `sf_write` / `run_bash` 三件，跨包构建取证超其超时预算，发版审查建议手动追加）、20-21 深度专项（季度全仓体检）、22 发现面（门面改动时）。**loop 与工具的视角边界以 playbook 分层表为准——playbook 演进（如新增视角/调整分层）时，本文件与下游工具同步对齐**。
3. 四角色的行为指令在 `prompts/`（a-check / a-consolidate / b-fix / b-audit / c-verify / d-review；b-check 为 legacy 双盲逃生门 `FORGE_ENABLE_B_CHECK=1` 时启用）。
4. **b-audit** 步骤：b-fix 改完代码后执行器自动跑 `sofagent-audit --diff`——审计每次变更，自用先行铁律。audit FAIL（exit 2）打回 b-fix 重修，不进 c-verify。
5. 跨 run 的永久索引在 `FORGE/LEDGER.md`（被 git 跟踪）；每轮正文在 `runs/`（不进 git）。

## 实现载体

**编排者** = harness session 本身（注入主任务协议即跑，协议 SSOT 见 `loop.md`「执行形态」节）。**角色执行**三通道任选：① 编排 session 自身（仅首个角色）② 执行器单步 `node FORGE/src/fresh-eyes-driver.mjs --worker --step <step> --round-dir <abs> --target <ver>`（DSH 后端；worktree 隔离经 `FORGE_WORKTREE_ROOT` 环境变量由编排方建立并注入；内置 stall 守卫、工具软硬熔断、报告质量门控、零发现假绿检测）③ 有头 session 的 subagent。

**工具面机制事实**（`FORGE/lessons/architecture.md`）：执行器走 DSH CLI 桥接时，sofagent 自定义工具（`sf_read` / `sf_write` / `run_bash`）在子进程边界不生效——角色实际使用 DSH 自带 bash/fs 工具链，能力等价（读文件/写文件/跑命令）。审查所需证据由 prompt 注入或角色自行 bash 取证。

机器守闸：`tools/check/check-fresh-eyes-artifacts.mjs`（产物契约校验 = 编排者停止条件判定的机械面）。

## 🔴 编排权归属铁律

**编排 = harness session 本身**（注入主任务协议、逐角色调执行器、落盘、判收敛）——**不得把编排委托给任何长驻编排进程**。历史上的 driver 多轮编排循环因此退役：主 session 内嵌套拉起长生命周期进程树，用户打断 session 时级联 SIGTERM 会杀掉整棵树，run 产物丢失（与 release-gate-loop 实证同机理）。编排 session 自身被中断无需恢复进程——状态全在 `runs/` 文件里（文件即状态），新 session 注入同一协议即断点续跑。

**长跑监督**（无人值守 DSH 场景，编排方自查三条）：
1. **轮询现态锚**：读 runDir 的 `status.md`（每轮一行，含 phase 与 P0/P1 计数）——phase 变化才汇报，同一状态不重复说话。
2. **产物真实性抽验**：报告数量增长 ≠ 有效产出。 `find <roundDir> -name 'check-*.md' -size -1k`（1KB 以下 = 疑似占位骨架），命中即 cat 验内容；收口仍未回填的视角按修复批协议补跑该视角（不必全量重跑）。
3. **中止必归档**：任何原因中止的 run（进程死亡 / 人工停止 / 环境冲突）也必须在 `FORGE/LEDGER.md` 补一行（`aborted-<死因简述>`）——没有终态记录的 run 是审计黑洞。

## 循环级演化

`evolution.md` 记录对这套循环本身的改进建议（人类门控的"加一减一"），防止 specs 越长越烂。
