---
name: cordis-plugin-sofagent-evolve
slug: cordis-plugin-sofagent-evolve
version: 1.5.0
displayName: cordis-plugin-sofagent-evolve
description: >
  经验沉淀——think.md 反思 + Dream Cycle + evolve + instinct→skill + refine（seam: session/event）——桥接 @sofagent/think generateThinkEntry——DSH（DeepSeek Harness）cordis plugin。sofagent 约束层在 DeepSeek Harness 生态的插件形态。
---

# cordis-plugin-sofagent-evolve

经验沉淀——think.md 反思 + Dream Cycle + evolve + instinct→skill + refine（seam: session/event）——桥接 @sofagent/think generateThinkEntry

## 用途

**装上之后**：任务收尾自动写一条 think.md 反思条目。**什么时候用**：同一个坑反复踩、想让经验留下来被下次检索。

**接入点**（seam: session/event）：桥接 `@sofagent/think`，缺依赖时该能力静默跳过；接入形态（声明 / 实现）见 [SEAMS.md](../SEAMS.md)。

本插件随 sofagent 主线版本发布（SkillHub 通道：`skillhub install cordis-plugin-sofagent-evolve` 安装与检索；npm 通道未开通）。版本号与 sofagent 主线对齐。

## 相关链接

- sofagent 主仓：https://github.com/KongFangXun/sofagent
- 开发日志：docs/changelog/v1.4/v1.4.0.md（DSH 插件家族）
