# @sofagent/ontology

sofagent 领域本体定义——场景类型、约束类型、审计规则注册表。v1.2.0 从 audit 包迁出。

## API

- `mergeOntology()` — 合并多源 Ontology YAML（企业自定义 + 共享层）
- `checkOntologyStatus()` — 检查 Ontology 完整性
- `generateOntologyView()` — 生成 Ontology 可视化视图
- 类型：`OntologyObject` / `OntologyAction` / `OntologyConstraint` / `MergedOntology`
- 依赖关系：`@sofagent/core`
