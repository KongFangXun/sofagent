---
name: release-gate-loop
description: 发版前自动验证闸门——V 验证 + F 修复循环（verdict FAIL → F 改代码 → 跑 audit → V 重验），最大 3 轮直到 PASS。纯只读验证 + 最小修复。
emoji: 🚪
color: "#F59E0B"
version: 1.4.0
---

# release-gate-loop · 发版闸门循环定义

> **V 验证 FAIL 后触发 F 修复循环——F 读 verdict → 改代码 → 跑 audit → V 重验，最大 3 轮。**

## 这是什么

一套可复用的发版前自动验证闸门 + 自动修复。它描述：谁来做（V = 验证者 + F = 修复者）、怎么走（V 5 步验证 + F 3 步修复循环）、产物放哪（`runs/release-gate-loop/YYYY-MM-DD/run-NN/round-N/`）。

- **V** = 验证者：跑 acceptance-test.sh、跑 regression-checklist、做覆盖率交叉检查、合并报告、出裁决。
- **F** = 修复者：V 裁决 FAIL 后，F 读 verdict 报告 → 定位根因 → 改代码 → driver 自动跑 audit → 回到 V 重验。
- **driver（"我"，当前会话）**：在步骤间中转、维护 `runs/` 文件、复制报告到桌面。driver 不是 agent，只是编排层。

## 怎么用

1. 读 `loop.md` 拿到完整 SOP（角色 / 步骤协议 / 产物 schema）。
2. 5 步的行为指令在 `prompts/`（acceptance / regression / coverage / consolidate / verdict）。
3. F 步骤指令在 `prompts/`（f-diagnose / f-fix）+ driver 自动执行 f-audit。
4. 跨 run 的永久索引在 `FORGE/LEDGER.md`（被 git 跟踪）；每次产物在 `runs/`（不进 git）。

## 实现载体

V 由 **Node driver**（`FORGE/src/release-gate-driver.mjs`）驱动——每个 step 独立子进程（真零上下文），LangGraph `createReactAgent` 编排。当前 session 只负责启动 driver + 监控进度。

## Session 监控协议（CRITICAL）

**启动 driver 后，session 不是傻等，而是进入 sleep 轮询模式**——保持 working 状态，让用户感知"后台在干活"（**每 120 秒一轮，读 status.json 输出一行状态**——session 一直活跃 = 用户界面持续可见「在跑」，这是硬要求非可选）。

### 🔴 启动前独占窗口检查

**启动 driver 前，必须确认本仓库当前没有其他写操作会话在跑**——release-gate 的 worker 与主仓共享工作目录，git 基线被并发改写（restore / 回补 / 批量 commit）会直接杀死进程树。检查项与 fresh-eyes-loop SKILL 同款：问用户有无并发写会话 + `git status --porcelain` 抽查。git worktree 隔离（v1.3.6 交付 8）落地后本检查降级为提醒项。

### 执行方式

```
1. Bash（⚠️ 必须加 run_in_background: true + dangerouslyDisableSandbox: true，
   否则三层进程嵌套会被 sandbox SIGKILL）:

   # V/F 环境变量（⚠️ 必须手动导出——resolveConfigs 自动生成 SOFAGENT_LLM_V/F
   # 但 models/ 未覆盖 specEnv，不导出会报"缺少环境变量"）：
   export SOFAGENT_LLM_V="${SOFAGENT_LLM_A}"
   export SOFAGENT_LLM_F="${SOFAGENT_LLM_B}"

   # 并发自适应（v1.3.7 ⑦）：未显式设置时 driver 自动探测物理内存取并发
   # （<12GB→1 / 12-23GB→2 / 24-47GB→4 / ≥48GB→6）——8GB 机器自动取 1，无需手动设。
   # 运行中 worker OOM（SIGKILL）自动熔断降级（本批剩余串行，连续 2 批回退 1）。
   # 需强制指定时才设 FORGE_MAX_CONCURRENCY：
   node FORGE/src/release-gate-driver.mjs --target <版本号>

   # sandbox 环境（acceptance-test.sh 预跑会被 kill 时）：
   # 先手动预跑到 /tmp（driver 启动时自动复制到 runDir）：
   bash FORGE/playbook/acceptance-test.sh > /tmp/acceptance-raw.log 2>&1
   # 再加 --skip-acceptance 启动：
   node FORGE/src/release-gate-driver.mjs --target <版本号> --skip-acceptance

   # 沙箱 OOM 环境（driver 主进程 + worker 内存叠加触发 OOM 时）：
   # 用 --step 单步模式，外层脚本逐步调用，每步全新进程退出：
   node FORGE/src/release-gate-driver.mjs --step acceptance  --target <版本号> --run-dir <runDir>
   node FORGE/src/release-gate-driver.mjs --step regression  --target <版本号> --run-dir <runDir>
   node FORGE/src/release-gate-driver.mjs --step coverage     --target <版本号> --run-dir <runDir>
   node FORGE/src/release-gate-driver.mjs --step consolidate  --target <版本号> --run-dir <runDir>
   node FORGE/src/release-gate-driver.mjs --step verdict       --target <版本号> --run-dir <runDir>

   # 🔥 判断层瘦身模式（阶段五 SOP 默认，2026-08-19 run-04 实测后启用）：
   # 脚本层（acceptance-test.sh + check-version/check-docs/锚点/check-review-system/check-tool-health）
   # 由 session 直跑（零 LLM），全绿后 driver 只跑判断层四步——一次启动直达：
   node FORGE/src/release-gate-driver.mjs --judgment-only --target <版本号>
   # 依据：全流程实测 30.7 万 token 中 61% 花在 acceptance 12 分片 LLM 复核（复核脚本
   # exit 0 的确定性结果，增值≈0）；判断层四步约 9 万 token / 20 分钟，盲审独立性保留在
   # 有判断空间的 regression 语义审查 + 终裁。
   # v1.3.8 交付七：--judgment-only 替代原「--step 四步手工编排」——一次进程串行四步，
   # 无需外层脚本逐步调用。旧 --step 单步模式仍可用于单步调试。
   # verdict=FAIL 时循环即停（v1.3.8 起 F 修复链默认关闭，无 f-* 产物）；
   # 修复责任回阶段四主 session。显式 --auto-fix 才进修复链（最多 3 轮）。

   # 全流程模式的 acceptance 抽查化（v1.3.8 交付七）——只审本版新增场景区间：
   node FORGE/src/release-gate-driver.mjs --target <版本号> --acceptance-range S294-S310
   # 分片范围从全量 12 片均分收敛为指定区间（本版新增场景），跳过历史场景的重复复核。

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

driver 被 SIGKILL（sandbox 回收 / OOM / 环境冲突）时，所有 Node handler 都来不及执行，status.json 停在上一次状态，监控端无法区分"在跑"和"已死"。

**解法**：driver 每 15s 更新 status.json 的 `heartbeat` 字段。监控端发现 heartbeat 超过 90s 未更新 → 大概率 driver 已死，用 `pgrep` 确认：

```
pgrep -f "release-gate-driver"  # 有输出=活着，无输出=已死
```

如果确认已死：读 `latest.json` 的 stopReason（若有），汇报后退出监控。

### 🔴 中止 run 的 LEDGER 归档铁律

**任何原因中止的 run（进程死亡 / 人工 kill / 环境冲突）也必须在 LEDGER 留一行**——「没有终态记录」的 run 是审计黑洞。监控端在确认 driver 死亡后人工补行（格式与 fresh-eyes-loop SKILL 同款：`日期 | runId | release-gate | 轮数* | 计数 | aborted-<死因> | runDir`）。

### 汇报规则

- **只在 phase 变化时说话**——同一状态不重复汇报
- **一句话**——不展开 details，用户想看细节自己读 status.json
- 格式示例：`📊 acceptance 完成 — PASS，进入 regression`
- 最终结果用 2-3 行收尾：裁决（PASS/FAIL）+ 报告路径

### 为什么不用 CLI 推送

driver 写 status.json 就够了——session 自己来读。推变拉，driver 不需要知道 session 的存在。

## 循环级演化

`evolution.md` 记录对这套循环本身的改进建议（人类门控的"加一减一"），防止 specs 越长越烂。
