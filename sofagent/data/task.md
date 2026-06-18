# task/ · 任务数据目录

> 运行时由主 Agent 自动创建和维护。包含两个子目录：
> - `task/plans/` — 澄清阶段产出的计划
> - `task/logs/` — 闭环阶段产出的执行记录（每天一个文件：`YYYY-MM-DD.md`）
>
> 本文件是格式参考——实际目录在 Skill 首次加载时自动初始化。
>
> 读取方：反思（→ think.md）、skill-iterate（→ scoring.md）、闭环流程（→ orchestrator/）。
>
> ⚠️ 以下路径为相对于 `{SOFAGENT_DATA}/` 的简写。实际读写时请加 `{SOFAGENT_DATA}/` 前缀。

---

## 计划格式（`task/plans/YYYY-MM-DD-HHMMSS-{简述}.md`）

第二轮澄清时生成，随澄清过程更新。定稿后标 `#confirmed`，闭环后标 `#closed`。

```
# 数据分析报表 | YYYY-MM-DD HH:MM
> 状态：#pending → #confirmed → #closed

- 原始任务：帮我分析过去三个月的数据，做报表
- 优化后 prompt：（主 Agent 将用户一句话优化后的完整指令）
- 拆成 4 个子任务：
  ① 子任务1 → Agent模板A → Skill A+B → Flash → 12,000 token
  ② 子任务2 → Agent模板B → Skill B+C → Pro → 18,000 token
  ③ 子任务3 → Agent模板C → Skill A+C → Flash → 8,000 token
  ④ 子任务4 → Agent模板D → Skill D → Pro → 7,000 token
- 总预估：45,000 token | 约 ¥0.23
- 复用模板：数据分析报表（第 2 次使用）

## 修改记录
- YYYY-MM-DD HH:MM：第二轮调整——子任务 3 改为 Pro
```

---

## 执行日志格式（`task/logs/YYYY-MM/YYYY-MM-DD.md`）

闭环时写入。子任务拆解不重复——引用卡片。

```
## 2026-06-09 14:30
- 计划：task/plans/2026-06-09-143000-数据分析报表.md
- 实际消耗：52,000 token | 约 ¥0.28
- Skill 评分：Skill A 复盘总分 3.8（各维评分：编排准确性 4 / 匹配度 4 / 经济性 3 / 流畅度 3 / 完整性 4 / 复用潜力 5 / 流程合规 4 / Loop有效性 3）
- 编排模板：数据分析报表（第 1 次使用）
- 反思：API 超时重试 3 次 | 标签 #api #timeout
- 标记：✅ 完成  #good
```

---

## 快捷标注（写入 task/logs/ 当天文件末尾即可）

| 标记 | 含义 | 触发效果 |
|------|------|------|
| `#failed` | 任务失败 | 计入编排回滚判断 |
| `#good` | 用户认可 | 对应 Skill 复用潜力 +1，跳过积累门槛 |
| `#bad` | 用户不满 | 立即写入 think.md 反思区（置信度 0.7） |
| `#checkpoint` | 中间检查点 | 通过标记 |

不需要手动写任何东西。Agent 会自动维护。
