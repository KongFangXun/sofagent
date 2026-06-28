# closure.md · 闭环验收 · v0.95

> 拆自 engine.md。派发（dispatch.md）完成后加载——验收产出、回流主理人、更新状态。
> 闭环逻辑详见 loop-check.md（closure 模式）。

---

## 闭环信号

① 子任务完成 + 用户确认
② 用户 /new 或 /reset

> 闭环信号出现 → Read `task-closure.md`（离境闸门执行清单）→ 调 Loop Check（closure 模式）

## 闭环验收流程

### 1. 写 task/logs

```bash
bash {OPENCLAW_SCRIPTS}/task-record.sh \
  --task "任务简述" \
  --result "成功|失败|部分完成" \
  --model "deepseek-v4|claude-sonnet|..." \
  --tokens 4500 \
  --cost 0.15 \
  --skills "task-aware"
```

> 🖥️ **Windows PowerShell（非 WSL，无 bash）**等价命令（见 SKILL.md「跨平台脚本调用约定」）：
> ```powershell
> powershell -File {OPENCLAW_SCRIPTS}/task-record.ps1 -Task "任务简述" -Result "成功|失败|部分完成" -Model "deepseek-v4|..." -Tokens 4500 -Cost 0.15 -Skills "task-aware"
> ```
> 两者都不可用时降级为 LLM 直接追加写入 `{SOFAGENT_DATA}/task/logs/YYYY-MM/YYYY-MM-DD.md`（格式参考 `data/task.md`）。

### 2. 调起 Loop Check（closure 模式）

传入 `loop-check.md` + `mode=closure` + 当前 task/logs + scoring/_index.md + orchestrator/。

**平台分级**：
- OpenClaw：`session.spawn` 独立子 Agent 做评分——主 Agent 只传 task/logs，不传执行上下文
- 其他平台：主 Agent 重新 Read task/logs，以文件为唯一依据做证据驱动评审

Loop Check 返回：反思摘要 → 写入 think.md / 评分 → **追加**写入 scoring/_index.md（保留历史，不覆盖）/ A/B 决策 → 写入 orchestrator/ / 汇报 → 口头返给用户。

> 失败时优先调 Loop Check（failure 模式）做诊断。可自愈则重试一次，不可则如实汇报。

### 3. 状态回流

闭环完成后回传主理人（SKILL.md 回复前闸门）：
- 最小成果 → 用户确认
- task/logs 已写 ✓
- think.md 反思已更新 ✓
- scoring/_index.md 已追加 ✓

> ⛔ 闭环清单不可跳过。全部打勾才能回用户。

---

> 闭环验收 = 顾问模式。读数据、做判断、给建议——主 Agent 自己决定怎么做。脚本数数，Agent 判断。

## Gotcha

- **闭环只回流结果不回流教训**——task/logs 写了但 think.md 反思没更新，下次加载链读不到教训。后果：同类任务重复踩坑，反思区形同虚设。
- **闭环只跑测试不检查构建产物**——测试过了但产物文件缺失或格式错误。后果：CI 绿了但交付物不可用。
- **只看"做完"不看"用户确认"**——子任务跑完了但没等用户确认就直接闭环。后果：闭环了但用户不知道，下次任务衔接断裂。
- **scoring 覆盖而非追加**——评分写入 scoring/_index.md 时覆盖了历史条目。后果：历史评分丢失，A/B 对比失去参照基线。
