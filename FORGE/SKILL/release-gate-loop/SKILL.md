---
name: release-gate-loop
description: 发版前自动验证闸门——V 验证 + F 修复循环（verdict FAIL → F 改代码 → 跑 audit → V 重验），最大 3 轮直到 PASS。纯只读验证 + 最小修复。
emoji: 🚪
color: "#F59E0B"
version: 1.3.0
---

# release-gate-loop · 发版闸门循环定义

> **v1.2.8 升级：V 验证 FAIL 后触发 F 修复循环——F 读 verdict → 改代码 → 跑 audit → V 重验，最大 3 轮。**
>
> v1.2.7 是线性 5 步跑完即出 PASS/FAIL。v1.2.8 在 FAIL 后自动修复，形成验-改闭环。

## 这是什么

一套可复用的发版前自动验证闸门 + 自动修复。它描述：谁来做（V = 验证者 + F = 修复者）、怎么走（V 5 步验证 + F 3 步修复循环）、产物放哪（`runs/release-gate-loop/YYYY-MM-DD/run-NN/round-N/`）。

- **V** = 验证者：跑 acceptance-test.sh、跑 regression-checklist、做覆盖率交叉检查、合并报告、出裁决。
- **F** = 修复者（v1.2.8 新增）：V 裁决 FAIL 后，F 读 verdict 报告 → 定位根因 → 改代码 → driver 自动跑 audit → 回到 V 重验。
- **driver（"我"，当前会话）**：在步骤间中转、维护 `runs/` 文件、复制报告到桌面。driver 不是 agent，只是编排层。

## 怎么用

1. 读 `loop.md` 拿到完整 SOP（角色 / 步骤协议 / 产物 schema）。
2. 5 步的行为指令在 `prompts/`（acceptance / regression / coverage / consolidate / verdict）。
3. v1.2.8 新增 F 步骤指令在 `prompts/`（f-diagnose / f-fix）+ driver 自动执行 f-audit。
4. 跨 run 的永久索引在 `FORGE/LEDGER.md`（被 git 跟踪）；每次产物在 `runs/`（不进 git）。

## 实现载体

V 由 **Node driver**（`FORGE/src/release-gate-driver.mjs`）驱动——每个 step 独立子进程（真零上下文），LangGraph `createReactAgent` 编排。当前 session 只负责启动 driver + 监控进度。

## Session 监控协议（CRITICAL）

**启动 driver 后，session 不是傻等，而是进入 sleep 轮询模式**——保持 working 状态，让用户感知"后台在干活"。

### 执行方式

```
1. Bash（⚠️ 必须加 run_in_background: true + dangerouslyDisableSandbox: true，
   否则三层进程嵌套会被 sandbox SIGKILL）:

   # V/F 环境变量（⚠️ 必须手动导出——resolveConfigs 自动生成 SOFAGENT_LLM_V/F
   # 但 models/ 未覆盖 specEnv，不导出会报"缺少环境变量"）：
   export SOFAGENT_LLM_V="${SOFAGENT_LLM_A}"
   export SOFAGENT_LLM_F="${SOFAGENT_LLM_B}"

   # 8GB 机器必须限并发（每个 worker --max-old-space-size=2048，3+ 并发即 OOM）：
   FORGE_MAX_CONCURRENCY=1 node FORGE/src/release-gate-driver.mjs --target <版本号>

   # sandbox 环境（acceptance-test.sh 预跑会被 kill 时）：
   # 先手动预跑到 /tmp（driver 启动时自动复制到 runDir）：
   bash FORGE/playbook/acceptance-test.sh > /tmp/acceptance-raw.log 2>&1
   # 再加 --skip-acceptance 启动：
   FORGE_MAX_CONCURRENCY=1 node FORGE/src/release-gate-driver.mjs --target <版本号> --skip-acceptance

   # 沙箱 OOM 环境（driver 主进程 + worker 内存叠加触发 OOM 时）：
   # 用 --step 单步模式，外层脚本逐步调用，每步全新进程退出：
   node FORGE/src/release-gate-driver.mjs --step acceptance  --target <版本号> --run-dir <runDir>
   node FORGE/src/release-gate-driver.mjs --step regression  --target <版本号> --run-dir <runDir>
   node FORGE/src/release-gate-driver.mjs --step coverage     --target <版本号> --run-dir <runDir>
   node FORGE/src/release-gate-driver.mjs --step consolidate  --target <版本号> --run-dir <runDir>
   node FORGE/src/release-gate-driver.mjs --step verdict       --target <版本号> --run-dir <runDir>

   🔴 铁律：必须 dangerouslyDisableSandbox。
   原因：driver(spawn) → worker(spawn) → run_bash(execSync) = 三层子进程嵌套。
   sandbox 对进程嵌套层数有限制，第 4 层进程返回时整棵进程树被 SIGKILL。

2. 记住 runDir（driver 启动日志第一行会打印）

3. 循环（最多 20 次，防 turn 超限）:
   sleep 120                                          # 等 2 分钟
   cat <runDir>/status.json                           # 读进度
   判断:
     - phase === "completed" 或 "error"  → 汇报最终结果，退出循环
     - heartbeat 超 90s 未更新            → ⚠️ 疑似 driver 死亡，检查进程存活（见下）
     - phase 跟上次相同（无变化）        → 静默，继续下一轮 sleep
     - phase 有变化                      → 一句话汇报，继续 sleep
```

### 🔴 Heartbeat 死亡检测

**背景**：driver 被 SIGKILL（sandbox 回收 / OOM）时，所有 Node handler 都来不及
执行，status.json 停在上一次状态，监控端无法区分"在跑"和"已死"。

**解法**：driver 每 15s 更新 status.json 的 `heartbeat` 字段。监控端发现 heartbeat
超过 90s 未更新 → 大概率 driver 已死，需用 `pgrep` 确认：

```
pgrep -f "release-gate-driver"  # 有输出=活着，无输出=已死
```

如果确认已死，读 latest.json 的 stopReason 判断死亡类型，汇报后退出监控。

### 汇报规则

- **只在 phase 变化时说话**——同一状态不重复汇报
- **一句话**——不展开 details，用户想看细节自己读 status.json
- 格式示例：`📊 acceptance 完成 — PASS，进入 regression`
- 最终结果用 2-3 行收尾：裁决（PASS/FAIL）+ 报告路径

### 为什么不用 CLI 推送

driver 写 status.json 就够了——session 自己来读。推变拉，driver 不需要知道 session 的存在。

## 循环级演化

`evolution.md` 记录对这套循环本身的改进建议（人类门控的"加一减一"），防止 specs 越长越烂。
