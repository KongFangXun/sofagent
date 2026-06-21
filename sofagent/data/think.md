# think.md · 反思

> 由 sofagent 子 Skill 自动维护。每次任务闭环后，主 Agent 反问自己「有什么值得记住的」→ 写入反思区。
>
> 本文件是格式参考——实际文件在 SKILL.md B1 初始化时自动创建到 `{SOFAGENT_DATA}/think.md`。
>
> 数据来源：task/logs/ + scoring.md + orchestrator/。读取方：加载链第 2 层（每次会话启动注入）。

---

> ⚠️ 审计提示：每 10 次任务闭环后，花 5 分钟翻阅 task/logs/ 最近记录，对照本反思区——
> 删除因单次巧合产生、未在后续任务中复现的条目。LLM 自评可能漂移，人是最后的刹车。

## 反思区（进加载链，≤2K token）

> 每天提炼 1-3 句反思摘要，超过 2K token 自动挤旧到归档。

### YYYY-MM-DD 日摘要 | 权重 0.7
> ① 做对了什么？② 做错了什么？③ 下次改什么？（3 问模板，见 loop-check.md closure 模式）
今天做了数据分析报表。① 按语义簇拆 4 子任务，DAG 无环依赖 [已验证]。② Skill A 超时 3 次 #超时 [LLM自评:5.0]。③ 下次同类任务不选 Skill A 做数据清洗——先用 Flash 模型做预算内试探。
权重构成: 新鲜度 +0.3 | 反思关联 +0.3 | 引用热度 +0.1
影响链: [#超时 0.5](#超时) · [Skill A 3.8↓](skills/研发/代码生成/skill-a.md)
← task/logs/YYYY-MM-DD.md

### 会话交接 | YYYY-MM-DD HH:MM
触发原因：缓存占用达到 52%
未完成任务：数据分析报表（子任务 3/4 完成，待聚合结果）
关键约束：用户要求周五前交付、不要用 Pro 跑简单任务
← task/logs/YYYY-MM-DD.md

### 当前项目：sofagent Harness | 核心任务：编写 Handbook、设计 Skill

### 用户偏好：简洁回复+表格 / 不要未经确认创建文件 / loading 时展示 thinking

### 最优拆法：数据分析报表 | 4 子任务
[已失效] 3 子任务拆法 → 4 子任务 | 原因：A/B 测试新方案胜出
← task/logs/YYYY-MM-DD.md

---

## 归档区（不进加载链）

### YYYY-MM-DD 日摘要 | 权重 0.3 ……（已归档）
### YYYY-WXX 周摘要 · YYYY-MM 月摘要 · YYYY 年摘要

> 💡 权重 <0.3 且 90 天的自动清理。日摘要标 task/logs 日期。
> ⚠️ 每条反思末尾带标记：[LLM自评:分数]（纯 LLM 判断，加载时权重 ×0.3）/ [已验证]（有客观证据）/ [用户确认]（用户明确确认）。
