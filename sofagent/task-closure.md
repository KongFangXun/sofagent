# 离境闸门 · v0.95

> 由 SKILL.md 触发。闭环信号出现后，按此清单逐项执行。

---

## ⬜ 执行清单

> **闭环前先写 task/logs**（`{OPENCLAW_SCRIPTS}` 优先 `~/.openclaw/scripts/`，不存在则搜 `sofagent/scripts/`）：
> ```bash
> bash {OPENCLAW_SCRIPTS}/task-record.sh \
>   --task "任务简述" \
>   --result "成功|失败|部分完成" \
>   --model "deepseek-v4|claude-sonnet|..." \
>   --tokens 4500 \
>   --cost 0.15 \
>   --skills "task-aware"
> ```
> 🖥️ **Windows PowerShell（非 WSL，无 bash）**等价命令（见 SKILL.md「跨平台脚本调用约定」）：
> ```powershell
> powershell -File {OPENCLAW_SCRIPTS}/task-record.ps1 -Task "任务简述" -Result "成功|失败|部分完成" -Model "deepseek-v4|..." -Tokens 4500 -Cost 0.15 -Skills "task-aware"
> ```
> 两者都不可用时降级为 LLM 直接追加写入 `{SOFAGENT_DATA}/task/logs/YYYY-MM/YYYY-MM-DD.md`（格式参考 `data/task.md`）。

```
⬜ ① 写 task/logs（命令见上方引用块）
⬜ ② 调起 Loop Check（closure 模式）
      → 反思 → 评分 → A/B → 汇报
      详见 loop-check.md
```

> ①② 不可跳过。执行后写入对应文件（think.md / scoring/_index.md 追加新条目 / orchestrator/）。全部打勾才能回用户。

---

## ② 调起 Loop Check（closure 模式）

传入 loop-check.md + `mode=closure` + 当前 task/logs + scoring/_index.md + orchestrator/。

**平台分级**：
- OpenClaw：`session.spawn` 独立子 Agent 做评分——主 Agent 只传 task/logs，不传执行上下文
- 其他平台：主 Agent 重新 Read task/logs，以文件为唯一依据做证据驱动评审

Loop Check 返回：反思摘要 → 写入 think.md / 评分 → **追加**写入 scoring/_index.md（保留历史，不覆盖）/ A/B 决策 → 写入 orchestrator/ / 汇报 → 口头返给用户。

> 失败时优先调 Loop Check（failure 模式）做诊断。可自愈则重试一次，不可则如实汇报。

---
> 本文件为离境闸门的唯一指令来源。闭环逻辑详见 loop-check.md。

---

## Gotcha

- **闭环只跑测试不检查构建产物**——测试 exit 0 就认为做完了，但产物文件可能缺失或格式错误。后果：CI 绿了但交付物不可用。
- **只看「做完」不看「用户确认」**——子任务跑完了直接闭环，没等用户说「完成」。后果：闭环了但用户不知道，下次任务衔接断裂。
- **task/logs 命令写完不验证**——task-record.sh 跑了但没确认写入成功。后果：反思和评分基于空数据，复盘结果不可信。
- **闭环跳过 Loop Check**——赶时间直接回用户，跳过 closure 模式的反思 + 评分。后果：教训没沉淀，下次还踩同一个坑。
