---
name: cordis-plugin-sofagent-fde
slug: cordis-plugin-sofagent-fde
version: 1.5.2
displayName: cordis-plugin-sofagent-fde
description: >
  FDE 进场与能力流通——把企业业务梳理成 AI 能力，并让这些能力在企业内被发布、发现、调用、评价、退役（seam: non-seam:tool-set）——桥接 @sofagent/orchestrator publishCapability / @sofagent/ontology generateOntologyView / @sofagent/core restoreSnapshot——DSH（DeepSeek Harness）cordis plugin。sofagent 约束层在 DeepSeek Harness 生态的插件形态。
---

# cordis-plugin-sofagent-fde

FDE 进场与能力流通——把企业业务梳理成 AI 能力，并让这些能力在企业内被发布、发现、调用、评价、退役（seam: non-seam:tool-set）

## 用途

**装上之后**：本体 / FDE / 公地三域工具面可用——查业务实体与知识条目（ontology 档 12 工具）、跑「该不该上 AI、上在哪、值多少」的方法论流程（fde 档 fde_* 七引擎）、能力的发布/发现/调用/评价/退役五环（commons 档 6 工具）。三档在 settings 各自可关（默认全开）。**什么时候用**：企业 AI 落地从进场梳理到能力流通的完整链路。

**接入点**（seam: non-seam:tool-set）：多包桥接 `@sofagent/orchestrator`（能力公地）/ `@sofagent/ontology`（本体视图）/ `@sofagent/core`（能力回溯），缺任一依赖时其余照常（部分可用即部分成功）；接入形态（声明 / 实现）见 [SEAMS.md](../SEAMS.md)。v1.4.9 P2 合并批：本插件并入原 cordis-plugin-sofagent-ontology 与 cordis-plugin-sofagent-commons 两款薄插件的面。

本插件随 sofagent 主线版本发布（SkillHub 通道：`skillhub install cordis-plugin-sofagent-fde` 安装与检索；npm 通道未开通）。版本号与 sofagent 主线对齐。

## 相关链接

- sofagent 主仓：https://github.com/KongFangXun/sofagent
- 开发日志：docs/changelog/v1.4/v1.4.0.md（DSH 插件家族）
