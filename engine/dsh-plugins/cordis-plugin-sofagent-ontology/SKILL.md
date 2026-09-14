---
name: cordis-plugin-sofagent-ontology
slug: cordis-plugin-sofagent-ontology
version: 1.4.8
displayName: cordis-plugin-sofagent-ontology
description: >
  共享语义底座 + 知识检索（seam: non-seam:tool-set）——桥接 @sofagent/ontology generateOntologyView——DSH（DeepSeek Harness）cordis plugin。sofagent 约束层在 DeepSeek Harness 生态的插件形态。
---

# cordis-plugin-sofagent-ontology

共享语义底座 + 知识检索（seam: non-seam:tool-set）——桥接 @sofagent/ontology generateOntologyView

## 用途

**装上之后**：会话里可查业务实体 / 关联关系 / 知识条目。**什么时候用**：需要 Agent 理解「谁是谁的上下游」，而不是靠你口述业务。

**接入点**（seam: non-seam:tool-set）：桥接 `@sofagent/ontology`，缺依赖时该能力静默跳过；接入形态（声明 / 实现）见 [SEAMS.md](../SEAMS.md)。

本插件随 sofagent 主线版本发布（SkillHub 通道：`skillhub install cordis-plugin-sofagent-ontology` 安装与检索；npm 通道未开通）。版本号与 sofagent 主线对齐。

## 相关链接

- sofagent 主仓：https://github.com/KongFangXun/sofagent
- 开发日志：docs/changelog/v1.4/v1.4.0.md（DSH 插件家族）
