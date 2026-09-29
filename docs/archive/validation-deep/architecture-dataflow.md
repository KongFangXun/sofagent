# 运行时数据层全景大图（原 docs/ARCHITECTURE.md · doc-slim 批 2026-09-28 搬出）

> 原位置：docs/ARCHITECTURE.md「运行时数据层：引擎间数据流全景」节。正文处已收敛为速览表 + 铁律，ASCII 全景图在此一字不减。

### 运行时数据层：引擎间数据流全景

约束层（审计/回溯/沉淀/进化）运行时共同往 `data/` 目录读写数据（编排模块 @sofagent/orchestrator 为内部实现，也读写此目录）。以下是生产者→数据文件→消费者的完整单向数据流（v1.2.1 补全 eval + ab-test 后的全景）：

```
                        写入侧（生产者）                          data/ 目录                          读取侧（消费者）
┌─────────────────────────────────────────┐  ┌──────────────────────┐  ┌─────────────────────────────────────┐
│ @sofagent/audit（审计）               │  │ audit/               │  │ @sofagent/daemon（巡检器）            │
│   每次 commit/变更 → runRules()          │→ │   history.jsonl      │→ │   warn-accumulator（WARN 聚合）      │
│   会话结束 → buildSessionReport()        │→ │   session-report.json│→ │   audit-history-analyzer（趋势）     │
│                                          │→ │   session-report.md  │→ │   qa-verify-warn-accumulator         │
├─────────────────────────────────────────┤  ├──────────────────────┤  ├─────────────────────────────────────┤
│ @sofagent/think（反思生成器）              │  │ think.md             │  │ @sofagent/inject（加载链第3层）      │
│   generateThinkEntry() 基于 diff+审计结果 │→ │   （append-only）      │→ │   buildConstrainedSystemPrompt()     │
│                                          │→ │                      │→ │ @sofagent/daemon（dream-cycle）       │
│                                          │→ │                      │→ │   extract-facts() → knowledge/       │
├─────────────────────────────────────────┤  ├──────────────────────┤  ├─────────────────────────────────────┤
│ @sofagent/eval（评分模块）⭐ v1.2.1 补全   │  │ eval/ ⭐              │  │ @sofagent/think（进化模块）⭐ 接通    │
│   runEval() 跑 golden set                │→ │   history.jsonl      │→ │   检测 passRate 下降→写 think.md      │
│   eval-reporter 持久化                    │→ │   reports/*.md       │→ │ Dashboard 质量趋势面板               │
├─────────────────────────────────────────┤  ├──────────────────────┤  ├─────────────────────────────────────┤
│ @sofagent/ab-test（A/B 框架）⭐ v1.2.1   │  │ ab-test/ ⭐           │  │ @sofagent/orchestrator（ab-scheduler）│
│   runABTest() 对比方案                     │→ │   history.jsonl      │→ │   aggregateRecent() 方案判定          │
│                                          │→ │   reports/*.md       │→ │ Dashboard A/B 对比面板               │
├─────────────────────────────────────────┤  ├──────────────────────┤  ├─────────────────────────────────────┤
│ @sofagent/daemon（守护进程）              │  │ dashboard/           │  │ Dashboard                            │
│   health-reporter → runHealthReport()    │→ │   daemon-health.json │→ │   健康面板                            │
│   dream-cycle → extract/synthesize       │→ ├──────────────────────┤  │ @sofagent/inject（加载链第4层）      │
│                                          │→ │ knowledge/           │→ │   buildConstrainedSystemPrompt()     │
├─────────────────────────────────────────┤  ├──────────────────────┤  ├─────────────────────────────────────┤
│ FORGE driver                             │  │ forge-runs/          │  │ verdict.md（人类读）                  │
│   fresh-eyes / release-gate              │→ │   <loop>/<date>/run/ │→ │                                     │
├─────────────────────────────────────────┤  ├──────────────────────┤  ├─────────────────────────────────────┤
│ @sofagent/core ⭐ v1.2.7                 │  │ orchestrator/goals/ ⭐│  │ @sofagent/orchestrator ⭐ v1.2.7     │
│   /goal → evaluateGoal() 写 current.json │→ │   current.json       │→ │   goal_eval 节点（每轮评估收敛）     │
│   （Session Goals 持久化）                │→ │                      │→ │                                     │
├─────────────────────────────────────────┤  ├──────────────────────┤  ├─────────────────────────────────────┤
│ @sofagent/audit ⭐ v1.2.7                │  │ support-bundles/ ⭐   │  │ 人类（报障附件）                      │
│   --support-bundle → generateSupportBundle│→ │   <timestamp>.zip    │→ │   （脱敏后的诊断快照）               │
├─────────────────────────────────────────┤  ├──────────────────────┤  ├─────────────────────────────────────┤
│ @sofagent/core ⭐ v1.3.0                 │  │ memory/ ⭐ v1.3.0     │  │ @sofagent/daemon（dream-cycle）      │
│   createMemoryStore → per-fact Markdown  │→ │   memory.json 索引   │→ │   extract-facts 写入事实级记忆       │
│   （事实级记忆存储）                      │→ │   __default__/*.md   │→ │ @sofagent/core（search/list/delete）│
├─────────────────────────────────────────┤  ├──────────────────────┤  ├─────────────────────────────────────┤
│ @sofagent/daemon ⭐ v1.3.0               │  │ scheduler/ ⭐ v1.3.0  │  │ CLI（scheduler list/history）        │
│   createScheduler → cron/once 定时任务   │→ │   tasks.json 索引    │→ │   daemon start → getDueTasks()       │
│   （定时任务调度器）                      │→ │   history/<id>/*.json│→ │                                     │
└─────────────────────────────────────────┘  └──────────────────────┘  └─────────────────────────────────────┘
```

**数据流铁律**：
- ✅ 生产者 → data/ → 消费者：合法（单向派生）
- ✅ Ledger → Views：合法（Dream Cycle 从 think.md 派生 knowledge/）
- ❌ Views → Ledger：禁止反向写回（代码级强制）
- ❌ 任何层 → 历史条目覆写：禁止（append-only 不变量）

> 📖 此图的 v1.2.1 原始出处及交付细节见 [changelog v1.2.1 §P0b](../../changelog/v1.2/v1.2.1.md)。

---


