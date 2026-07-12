# Ontology 统一层

> v1.0.5 新增

## 是什么

Ontology 统一层自动合并 v1.0.1-1.4 的分散定义，生成 `.sofagent/ontology/` 目录。

## 三个文件

| 文件 | 来源 | 说明 |
|------|------|------|
| `objects.yml` | entities/ frontmatter relations | 实体间关联（has_many / belongs_to / depends_on） |
| `actions.yml` | workflow.yml actions 声明 | 每个节点允许执行的操作 |
| `constraints.yml` | A15 约束验证 | 知识库访问域、速率限制等约束 |

## 如何使用

### 自动合并

daemon 检测到 knowledge/ 或 workflow/ 变化时自动触发 `mergeOntology()`。

### 手动触发

```bash
sofagent-audit --merge-ontology
```

### 查看状态

```bash
sofagent-audit --doctor  # 第 15 项检查
```

## 防幻觉四方案

1. **Schema Guided** — ontology 约束 Action 输出格式
2. **HTRO**（High Trust Read Only）— 只读可信源
3. **RAG+溯源** — 引用必须可追溯到 knowledge/ 页面
4. **Action Type 终审** — 审计层验证 action 类型合规
