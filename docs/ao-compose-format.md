# ao compose YAML 格式参考

> ao compose 生成的编排文件格式说明。ao compose npm 包不可用时，按此格式手动编写编排文件。

---

## 输入格式（传给 ao compose）

```yaml
tasks:
  - id: "task-1"
    description: "任务描述"
    depends_on: []           # 依赖的任务 id 列表（空 = 无依赖，可并行）
    agent_role: "developer"  # 分配的 Agent 角色（来自 agency-agents-zh 岗位库）
    expected_output: "预期产出"
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|:--:|------|
| `id` | string | ✅ | 任务唯一标识，用于依赖引用 |
| `description` | string | ✅ | 子任务的自然语言描述 |
| `depends_on` | string[] | ✅ | 依赖的前置任务 id 列表，空数组 = 可立即执行 |
| `agent_role` | string | ✅ | 执行此子任务的 Agent 角色名 |
| `expected_output` | string | ✅ | 子任务完成后的预期产出物描述 |

---

## 输出格式（ao compose 生成）

```yaml
orchestration:
  total_steps: 5
  estimated_tokens: 12000
  fallback_mode: "default"   # default = 默认编排；manual = 手工拆解
  tasks:
    - id: "task-1"
      assigned_agent: "developer"
      cost_estimate: 3000
      skill_match: "high"    # high / medium / low
```

| 字段 | 说明 |
|------|------|
| `total_steps` | 子任务总数 |
| `estimated_tokens` | 预估总 token 消耗 |
| `fallback_mode` | 编排策略——`default` 完整编排，`manual` 手工拆解 |
| `assigned_agent` | 实际分配的 Agent 角色 |
| `cost_estimate` | 该子任务预估 token 数 |
| `skill_match` | 角色与技能库匹配度：`high` / `medium` / `low` |

---

## 常见编排模式

### 线性

任务严格按顺序执行，每个任务依赖前一个。

```yaml
tasks:
  - id: "t1"
    description: "拉取数据"
    depends_on: []
    agent_role: "data-engineer"
    expected_output: "清洗后的数据集"
  - id: "t2"
    description: "分析数据"
    depends_on: ["t1"]
    agent_role: "data-analyst"
    expected_output: "分析报告"
  - id: "t3"
    description: "生成可视化"
    depends_on: ["t2"]
    agent_role: "frontend-developer"
    expected_output: "图表页面"
```

### 并行

多个子任务之间没有依赖，可同时执行。

```yaml
tasks:
  - id: "lint"
    description: "代码风格检查"
    depends_on: []
    agent_role: "code-reviewer"
    expected_output: "lint 报告"
  - id: "test"
    description: "单元测试"
    depends_on: []
    agent_role: "qa-engineer"
    expected_output: "测试报告"
  - id: "docs"
    description: "更新文档"
    depends_on: []
    agent_role: "technical-writer"
    expected_output: "API 文档"
```

### 条件分支

ao compose 原生不直接支持条件分支 YAML 语法。需要条件逻辑时，拆分两个独立编排任务，由主 Agent 根据中间结果选择执行哪个。

---

## 如果 ao compose 不可用——手动编排实操指南

> ⚠️ ao compose 是一个 npm 包（`agency-orchestrator`），可能因网络/企业策略/npm 不可用而无法安装。以下是如何在缺少 ao compose 的情况下完成编排。

### 步骤 1：人工拆任务

拿到复杂任务后，按以下框架手写 3-5 个子任务：

1. **输入**：这个子任务需要什么数据/文件？
2. **处理**：这个子任务具体做什么？
3. **输出**：这个子任务完成后产生什么？

### 步骤 2：分配角色

从以下常用角色中匹配（不要求精确——按语义选最接近的）：

| 任务类型 | 推荐角色 |
|------|------|
| 写代码/修 bug | `developer` |
| 数据分析/报表 | `data-analyst` |
| 写文档/翻译 | `technical-writer` |
| 代码审查 | `code-reviewer` |
| 测试/QA | `qa-engineer` |
| 前端/UI | `frontend-developer` |
| 后端/API | `backend-developer` |
| DevOps/部署 | `devops-engineer` |

### 步骤 3：写 YAML

按输入格式手写 YAML 文件，保存到 `.sofagent/orchestrator/workflows/<任务名>.yaml`。

### 步骤 4：手动执行

```bash
# 逐个子任务，让 Agent 按顺序执行
# 完成后手动跑 task-record.sh 记录：
bash sofagent/scripts/task-record.sh \
  --task "你的任务描述" \
  --result "成功" \
  --skills "手动编排"
```

### 步骤 5：闭环反思

任务全部完成后，手动触发 loop-check closure 模式，完成反思→评分→A/B 对比→汇报。

---

## 与 sofagent 编排引擎的关系

ao compose 生成的 YAML 由 `task-orchestrate.sh` 在执行前注入 sofagent 约束层（Harness 注入），确保子 Agent 继承底线+铁律。YAML 只管「怎么拆」，sofagent 管「按什么规矩跑」。

> 💡 此文档的存在目的：ao compose 不可用时，开发者不依赖 npm 包也能完成结构化编排。
