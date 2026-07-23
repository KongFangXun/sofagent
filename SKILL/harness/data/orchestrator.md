# orchestrator/ · 编排决策引擎

> 运行时由编排引擎闭环自动维护（v0.99.2 起）。不存原始数据，只存最优决策结论。
> 树形加载：Agent 先读 `_index.md` → 定位分支 → 只加载目标叶子文件。
>
> ⚠️ orchestrator/ 是最后初始化的数据文件——需等待 task/logs 积累 ≥3 次同类任务记录后，才会写入第一个最优配置。
>
> 本文件是格式参考——实际目录在 Skill 首次加载时自动初始化。
>
> 数据来源：task/logs/（A/B 对比，通过 `sofagent-orchestrate-compare` 确定性对比）。读取方：主 Agent 编排时按需查询；反思时读取，汇入 think.md。

---

### 编排方案结构（FDE 部署后）

> ⚠️ 注意：这里的 `workflow.yaml` 是 sofagent-orchestrator compose 内部生成的临时编排 DAG 产物，**不是 FDE 要维护的节点配置文件**。FDE 不写 .yaml——节点定义在 `nodes/[节点名].md` 里（三层实体之文档层）。Agent 读 node .md 后注入给 sofagent-orchestrator compose，sofagent-orchestrator compose 内部生成这些 YAML 做执行计划。

当前编排方案分三层：

```
orchestrator/
├── current/
│   ├── workflow.yaml       ← 当前生产用的编排方案
│   └── logs/               ← 此方案的运行日志
├── candidate/
│   ├── workflow.yaml       ← 新编排的候选方案
│   └── logs/               ← 候选方案的运行日志
├── comparisons/
│   └── YYYY-MM-DD.md       ← A/B 对比报告（由 orchestrate-compare 生成）
└── history/
    └── v1-YYYY-MM-DD.yaml  ← 被替换掉的旧方案
```

A/B 流程：编排引擎定期重出 candidate → 各跑 N 轮 → `sofagent-orchestrate-compare` 生成对比报告 → Candidate 连续两次胜出 → `promote` 替换 current → 旧 current 进 history/

<!-- 
  任务模板结构（大类→子类→具体任务，缩小搜索空间）：

  orchestrator/
  ├── _index.md                      ← 决策树总目录（≤50 行）
  ├── 研发/
  │   ├── _index.md
  │   ├── 代码生成/
  │   │   ├── 前端组件.md
  │   │   └── 后端API.md
  │   └── ...
  └── ...

  每个叶子文件格式（10-15 行），存该任务类型的当前最优配置。
  不需要手动写任何东西。Agent 会自动维护。
-->
