# Ontology 统一层

> v1.0.5 新增 · v1.1.0 对齐 GB/T 48000.3-2026 本体建模要求（元模型补强）

## 是什么

Ontology 统一层自动合并 v1.0.1-1.4 的分散定义，生成 `.sofagent/ontology/` 目录。

## 三个文件

| 文件 | 来源 | 说明 |
|------|------|------|
| `objects.yml` | entities/ frontmatter relations | 实体间关联（has_many / belongs_to / depends_on） |
| `actions.yml` | workflow.yml actions 声明 | 每个节点允许执行的操作（含 Domain/Range/Action Type 三元约束） |
| `constraints.yml` | A15 约束验证 | 知识库访问域、速率限制等约束 |

## 五组件元模型（对齐 GB/T 48000.3-2026）

GB/T 48000.3-2026《标准数字化 第3部分:本体建模要求》（2026-01-28 发布，2026-08-01 实施）规定本体须含五组件：实体类型 / 数据属性 / 对象属性 / 公理 / 规则。sofagent 现有统一层覆盖度：

| 组件 | 国标要求 | sofagent 现状 | 落点 |
|------|---------|--------------|------|
| 实体类型（Classes） | 领域概念声明 | ✅ `objects.yml` | 已覆盖 |
| 对象属性（Object Properties） | 实体间语义关联 | ✅ `relations`（has_many/belongs_to/depends_on） | 已覆盖 |
| 规则（Rules） | 约束业务逻辑 | ✅ `constraints.yml` + A15 审计 | 已覆盖 |
| 数据属性（Data Properties） | 实体特征字段 | ⚠️ 隐式（节点 frontmatter 散落） | **GAP：未统一抽取** |
| 公理（Axioms） | 形式化推理约束 | ⚠️ 由审计规则隐式承担 | **GAP：未显式建模** |

> 多数企业本体只做前三项（GB/T 起草说明亦指出此通病）。sofagent 的短板在数据属性与公理——前者随 v1.0.8 企业画像结构化可补，后者是审计引擎的隐式职责（A 系列规则即公理载体），后续在 Ontology 层显式建模可增强可推理性。

## 客户 workflow 动作模型：Domain / Range / Action Type

> 这套三元约束描述的是**客户业务 workflow 中的动作**（由 FDE 在梳理客户流程时建立，
> 落在客户项目的 workflow.yml / entities frontmatter），不是 sofagent 自身的动作。
> sofagent 审计引擎按此模型校验动作声明是否合规。

`actions.yml` 每个动作声明须含三元约束：

- **Domain（主体）**：谁可以执行这个动作（客户侧岗位 / 角色 / 节点）
- **Range（对象）**：动作作用在什么业务实体上（对象类型）
- **Action Type（风险分级）**：动作属于哪一类——

| Action Type | 含义 | sofagent 审计处置 |
|------|------|------|
| 可直接建议 | 输出建议，不自动执行 | 审计通过，仅记录建议 |
| 需审批 | 能生成方案但需人确认 | 标记需 HITL 确认 |
| 可执行 | 低风险、规则明确 | 审计通过，允许执行 |
| 必须阻断 | 越界/高危（删库/外部写） | 审计 FAIL + 阻断 |

> Action Type 是动作风险分级（静态分类，由 FDE 建立），loop-check/evaluate/exit 是执行策略
> （动态闭环）——二者正交。sofagent 审计引擎先按 Action Type 定级，再走对应 loop 出口。

> 注意：Domain/Range 属于 **Ontology 统一层**（主体-动作-对象三元约束），不放入 `entry-gate.md`——entry-gate 管「理解成本 / 能力注册」，权限判定维度不同。企业侧业务本体的 Domain/Range（如 `purchase(客户→商品)`）由 FDE 在 §5 构建。

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
4. **Action Type 终审** — 审计层按四分类（可直接建议 / 需审批 / 可执行 / 必须阻断）验证 action 类型合规
