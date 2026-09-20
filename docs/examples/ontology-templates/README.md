# ontology-templates · 本体三件套 schema 案例

> **这是什么**：`objects.yml` / `actions.yml` / `constraints.yml` 三份本体文件的 **schema 案例**——每份都含若干真实形态的示例条目，用来回答「这三份文件长什么样、每个字段是什么」。
>
> **这不是什么**：**不是运行时文件**。运行时三份文件由 `@sofagent/ontology` 的 `mergeOntology()` 生成在 `<workspace>/ontology/`，**每次运行重算**——直接改运行时产物会被覆盖。

## 数据源与产物（改源头，不改产物）

| 产物 | 数据源 | 条目结构定义 |
|---|---|---|
| `objects.yml` | `knowledge/entities/` 页面的 frontmatter `relations` | `OntologyObject` |
| `actions.yml` | `workflows/*.yml` 节点的 `actions` 声明 | `OntologyAction` |
| `constraints.yml` | A15 约束验证规则 | `OntologyConstraint` |

条目结构的唯一权威定义在 [`engine/ontology/src/types.ts`](../../../engine/ontology/src/types.ts)，合成逻辑在 [`engine/ontology/src/merge-engine.ts`](../../../engine/ontology/src/merge-engine.ts)（源→产物映射见其文件头注释）。

## 三份文件各回答什么

- **objects.yml** —— 企业**有什么**：对象、类型、彼此的关系（`belongs_to` / `has_many` / `depends_on` / `produces` / `consumes`），带资产生命周期（`trunk` 已合并基线 / `branch` 试验中）与时效信任字段
- **actions.yml** —— 能**做什么动作**：动作名、所属节点、约束
- **constraints.yml** —— **不许做什么**：四类约束 `allowed_action`（谁能动它）/ `domain_access`（看不到什么）/ `rate_limit`（频次上限）/ `custom`（业务专属规则）

> 💡 **「谁能调用」在 constraints 不在 actions**：`actions.yml` 只回答「有哪些动作」，授权判断在 `constraints.yml` 的 `allowed_action`。两者的分工是本体数据能被审阅门信任的前提。

## 序列化风格说明

运行时按 flow style 写（每项一行 JSON），案例文件按 block style 写（便于阅读）——**数据形状一致，序列化风格不同**：

```yaml
# 运行时实际形态
# Ontology Objects —— 自动合并自 entities/ frontmatter relations
# 生成时间: 2026-09-20T06:00:00.000Z
# 来源: v1.0.1 entities/ frontmatter

- {"name":"合同","type":"entity","relations":{...},"source":"...","lifecycle":"branch"}
```

## 现行规范去哪查

本体建模的完整规范（object type 候选筛选 / property 三类属性 / link type / action 四级动作）见 [FDE/GUIDE.md](../../../FDE/GUIDE.md) 第三章「本体数据构建」；术语与文档索引见 [docs/WIKI.md](../../WIKI.md)。

> ⚠️ **本目录不入门禁**：三份案例当前由人工维护，未纳入 `tools/check/` 校验。改动它们时请对照 `types.ts` 自查字段；如需长期防漂移，需补一条校验脚本并接进 `tools/release/pre-push-check.sh`。
>
> 📌 **案例值均为示意**（制造业应付账款场景），不代表任何真实企业数据。
