---
name: fresh-eyes-loop
description: 发布后独立质量循环——A/B 双盲 12 视角 fresh-eyes 审查 + 修复 + 验证，每轮新 session 保证零上下文，连续 2 轮无 P0/P1 即停。
emoji: 🔍
color: "#16B8F3"
version: 1.3.4
---

# fresh-eyes-loop · 质量循环定义

> **一个循环 = 一轮又一轮的"独立审查 → 修复 → 验证"，直到干净为止。**
>
> 这不是检查清单，是一套**让独立性可被重复执行**的机制。每一轮都用全新 session 跑（零上下文），所以"作者自己看不出问题"这个人类弱点被结构性消解。

## 这是什么

一套可复用的质量循环定义。它描述：谁来做（A / B 两个 subagent）、每一轮怎么走（审查 → 合并 → 修复 → 验证）、什么时候停（连续 2 轮无 P0/P1）、产物放哪（`runs/YYYY/MM/DD/run-NN/`）。

- **A** = 审查者 / QA：独立跑 12 视角审查、合并 A/B 两份报告、验证 B 的修复。
- **B** = 工程师：独立跑 12 视角审查、执行合并后的修复。
- **driver（"我"，当前会话）**：在 A/B 之间中转、维护 `runs/` 文件、判定停止条件。**driver 不是常驻 agent**，只是一轮里 relay 的人类或会话。

## 怎么用

1. 读 `loop.md` 拿到完整 SOP（角色 / 轮次协议 / 产物 schema / 停止条件）。
2. 12 视角的定义见 `FORGE/playbook/fresh-eyes-review.md`（两个 subagent 都按它跑）。
3. A/B 的行为指令在 `prompts/`（a-check / b-check / a-consolidate / b-fix / b-audit / a-verify）。
4. v1.2.8 新增 **b-audit** 步骤：b-fix 改完代码后 driver 自动跑 `sofagent-audit --diff`——审计每次变更，dogfooding 铁律。audit FAIL（exit 2）打回 b-fix 重修，不进 a-verify。
4. 跨 run 的永久索引在 `FORGE/LEDGER.md`（被 git 跟踪）；每轮正文在 `runs/`（不进 git）。

## 实现载体

A/B 由 **Node driver**（`FORGE/src/fresh-eyes-driver.mjs`）驱动——每个 step 独立子进程（真零上下文），LangGraph `createReactAgent` 编排。当前 session 只负责启动 driver + 监控进度。

## Session 监控协议（CRITICAL）

**启动 driver 后，session 不是傻等，而是进入 sleep 轮询模式**——保持 working 状态，让用户感知"后台在干活"。

### 执行方式

```
1. Bash（⚠️ 必须加 run_in_background: true + dangerouslyDisableSandbox: true，否则三层进程嵌套会被 sandbox SIGKILL）:
   node FORGE/src/fresh-eyes-driver.mjs --target <版本号> --max-rounds 10

   🔴 铁律：必须 dangerouslyDisableSandbox。
   原因：driver(spawn) → worker(spawn) → run_bash(execSync) = 三层子进程嵌套。
   sandbox 对进程嵌套层数有限制，第 4 层进程返回时整棵进程树被 SIGKILL。
   脱离 sandbox 后不受此限制。（2026-08-05 run-01~03 验证）

   🔴 v1.2.9 教训：禁止用 nohup+disown 启动——WorkBuddy 会清理脱离 session 的后台进程。
   必须用 Bash 工具的 run_in_background: true（安全替代方案）。

2. 记住 runDir（driver 启动日志第一行会打印）

3. 循环（最多 30 次，防 turn 超限）:
   sleep 300                                          # 等 5 分钟
   cat <runDir>/status.json                           # 读进度
   判断:
     - phase === "completed" 或 "error"  → 汇报最终结果，退出循环
     - heartbeat 超 90s 未更新            → ⚠️ 疑似 driver 死亡，检查进程存活（见下）
     - phase 跟上次相同（无变化）        → 静默，继续下一轮 sleep
     - phase 有变化                      → 一句话汇报，继续 sleep
```

### 🔴 Heartbeat 死亡检测（v1.2.7 run-01 教训）

**背景**：driver 被 SIGKILL（sandbox 回收 / OOM）时，所有 Node handler 都来不及
执行，status.json 停在上一次状态，监控端无法区分"在跑"和"已死"。

**解法**：driver 每 15s 更新 status.json 的 `heartbeat` 字段。监控端发现 heartbeat
超过 90s 未更新 → 大概率 driver 已死，需用 `pgrep` 确认：

```
pgrep -f "fresh-eyes-driver"  # 有输出=活着，无输出=已死
```

如果确认已死，读 latest.json 的 stopReason 判断死亡类型，汇报后退出监控。

### 汇报规则

- **只在 phase 变化时说话**——同一状态不重复汇报
- **一句话**——不展开 details，用户想看细节自己读 status.json
- 格式示例：`📊 Round 2 完成 — ❌ P0=1 P1=3，进入下一轮`
- 最终结果用 2-3 行收尾：轮数 + 停止原因 + 最终 P0/P1/P2 计数

### 为什么不用 CLI 推送

driver 写 status.json 就够了——session 自己来读。推变拉，`codebuddy-reporter` 适配器已废弃。driver 不需要知道 session 的存在。

## 循环级演化

`evolution.md` 记录对这套循环本身的改进建议（人类门控的"加一减一"），防止 specs 越长越烂。
