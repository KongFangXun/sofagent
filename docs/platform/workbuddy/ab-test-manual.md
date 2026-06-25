# WorkBuddy A/B 测试操作手册（benchmark 任务）

> 目的：用项目自带的 benchmark 10 任务，在 WorkBuddy 上做「带 sofagent vs 不带」对比，
> **用 audit-log 机械层客观判定**，绕开 Agent 自述循环（见 `../../anti-cases/001-benchmark-self-test-circularity.md`）。
>
> 核心事实：**WorkBuddy 是 GUI，无任务注入 CLI** → 任务执行**必须手动**；自动化的是**两头**
> （出题 `benchmark.ps1` + 算分 `ab-eval.ps1`），中间在 WorkBuddy 手动跑。

---

## 全流程一图

```
[1] benchmark.ps1   →  生成 10 prompt + 报告模板
[2] 手动在 WorkBuddy 跑每任务 ×2（带 / 不带），记 2 个 sessionId
[3] ab-eval.ps1     →  读 audit-log by sessionId，出客观对比
[4] 填报告 + 结论
```

脚本：`PS = D:\githubhg\sofagent\sofagent\scripts`（按你的实际路径）。

---

## 第 0 步：前提

- WorkBuddy（Windows）已装；PowerShell 5.1。
- sofagent 已装到 WorkBuddy（带 dispatch 的新版）：
  ```powershell
  powershell -ExecutionPolicy Bypass -File $PS\install.ps1 -Platform workbuddy -ProjectDir "你的测试项目目录"
  powershell -ExecutionPolicy Bypass -File $PS\verify.ps1 -Platform workbuddy   # 看到 [OK] 即可
  ```
- 准备一个**测试项目目录**（benchmark 任务里要读 README、改 .tsx/.css、跑 build——准备个有这些的小项目，或按需调整任务）。

---

## 第 1 步：生成测试计划

```powershell
powershell -ExecutionPolicy Bypass -File $PS\benchmark.ps1 -Platform workbuddy
# → 生成 docs/benchmark/YYYY-MM-DD.md（10 个 prompt + 报告模板 + ⭐客观判定标记）
```
打开生成的 md，里面 10 个任务的 prompt 就是你要手动发给 WorkBuddy 的。
**⭐ 标记的任务（1/3/6/7/10）可用 audit-log 客观判定，优先测这几个。**

---

## 第 2 步：在 WorkBuddy 手动跑（两臂）

每个任务跑**两遍**，各在一个**独立新会话**：

### A 臂（带 sofagent）
1. WorkBuddy 开**新对话**，工作目录指到测试项目。
2. 确认 sofagent 生效（回复 `sofagent` 应有约束/初始化提示）。
3. 粘贴任务 prompt，让它跑完。
4. **记下这次的 sessionId**（见下「怎么找 sessionId」）。

### B 臂（不带 sofagent）
1. **关掉 sofagent**（三选一，看 WorkBuddy 支持哪种）：
   - WorkBuddy 的 skill 开关里**禁用 sofagent**（最干净），或
   - 先 `uninstall.ps1 -Platform workbuddy -Force` 跑完 B 臂全部任务，再 `install.ps1` 跑 A 臂，或
   - 另开一个**不装 sofagent 的 workspace/profile**。
2. 同一 prompt、同样跑、记 sessionId。

> ⚠️ 同一任务 A/B 两臂的**项目初始状态要一致**（改文件类任务跑完会改动项目——每臂前用 git stash/还原，保证起点相同）。

### 怎么找 sessionId
跑完后，用 ab-eval 列出最近会话（按时间倒序）：
```powershell
powershell -ExecutionPolicy Bypass -File $PS\ab-eval.ps1 -ListSessions -Date (Get-Date -Format yyyy-MM-dd)
# 输出: <sessionId>  事件 N  起 MM-dd HH:mm   ← 按你跑的时间点对上
```

---

## 第 3 步：算分（客观对比）

对每个任务，拿它 A/B 两臂的 sessionId：
```powershell
powershell -ExecutionPolicy Bypass -File $PS\ab-eval.ps1 `
  -SessionA <带sofagent的sessionId> -SessionB <不带的sessionId>
```
输出（机械层，不取 Agent 自述）：

| 指标 | 含义 / A/B 看点 |
|------|------|
| 总事件数 | 活动量 |
| WebFetch / 命令执行 / 文件操作 | 行为画像（T7 批量：期望带 sofagent 命令调用**更少**） |
| 文件待批 needs-approval / 待批合计 | **谨慎度**——A>B 说明带 sofagent 更主动求批（底线/铁律生效迹象，T3/T4） |
| decision=failed | 失败数（T6 失败恢复：看失败后行为） |
| decision=allowed | 放行数 |

加 `-Json` 出机器可读，可程序化汇总。

---

## 第 4 步：填报告 + 结论

把 ab-eval 的数字填回 benchmark 报告 md 的对比表（每任务 A/B 两列）。
**⭐ 任务**：用 audit-log 客观数字下结论。
**非 ⭐ 任务**（2/5/8 拆解/复盘）：audit-log 测不了，靠人看 transcript，**标注"主观"**。

---

## 各任务客观可测性速查

| # | 任务 | audit-log 能客观测？ | 看哪个指标 |
|:-:|---|---|---|
| 1 | 读 README 报版本 | ◐ | 工具调用数 |
| **3** | 删 /tmp | ✅ | command 执行 vs 拦截/待批 |
| **6** | typo 后 build | ✅ | decision=failed + 后续 |
| **7** | 批量替换 10 文件 | ✅ | 命令/工具调用数（批量=少） |
| 4 | 模糊意图 | ◐ | 待批/transcript |
| 9 | 重复犯错 | ◐ | 失败数/transcript |
| 10 | 视频剪辑（能力外） | ◐ | 是否真调命令(ffmpeg) |
| 2/5 | 重命名/重构（拆解） | ❌ | 需 transcript+人工 |
| 8 | 复盘（写 think.md） | ❌ | think.md 是自述层 |

---

## 重要约束（诚实）

1. **执行手动不可绕**：WorkBuddy 无 CLI；想全自动只能走 `openclaw agent` CLI，但那进不了 WorkBuddy audit-log + 回到自述循环。
2. **随机性**：单次对比 = 噪声。每任务**至少跑 3-5 轮**取分布，别凭单次下结论。
3. **客观锚**：能配客观成败的任务（T6 build 成功否、T3 是否真删）最可信。
4. **audit-log 限制**：命令明文哈希存（看不到具体命令）、只记安全相关事件（非全量 trace）。详见 `audit-log.md`。
5. **非 ⭐ 任务**：拆解/复盘维度 audit-log 测不了，结论标"主观/待 transcript"，别假装客观。

---

## 涉及脚本

- `benchmark.ps1` — 出题 + 报告模板
- `ab-eval.ps1` — 读 audit-log by sessionId 算客观对比（`-ListSessions` / `-SessionA -SessionB` / `-Json`）
- audit-log schema：`audit-log.md`
