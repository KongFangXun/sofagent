---
name: cordis-plugin-sofagent-commons
slug: cordis-plugin-sofagent-commons
version: 1.4.8
displayName: cordis-plugin-sofagent-commons
description: >
  能力公地五环——复用 commons_* tool（seam: non-seam:tool-set）——桥接 @sofagent/audit loadConfig——DSH（DeepSeek Harness）cordis plugin。sofagent 约束层在 DeepSeek Harness 生态的插件形态。
---

# cordis-plugin-sofagent-commons

能力公地五环——复用 commons_* tool（seam: non-seam:tool-set）——桥接 @sofagent/audit loadConfig

## 用途

**装上之后**：能力发布 / 发现 / 调用 / 评价 / 养护五环按需调用。**什么时候用**：团队沉淀了一批能力，需要被再次找到和复用。

**接入点**（seam: non-seam:tool-set）：桥接 `@sofagent/audit`，缺依赖时该能力静默跳过；接入形态（声明 / 实现）见 [SEAMS.md](../SEAMS.md)。

本插件随 sofagent 主线版本发布（SkillHub 通道：`skillhub install cordis-plugin-sofagent-commons` 安装与检索；npm 通道未开通）。版本号与 sofagent 主线对齐。

## 相关链接

- sofagent 主仓：https://github.com/KongFangXun/sofagent
- 开发日志：docs/changelog/v1.4/v1.4.0.md（DSH 插件家族）
