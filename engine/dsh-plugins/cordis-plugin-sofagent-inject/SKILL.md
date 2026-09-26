---
name: cordis-plugin-sofagent-inject
slug: cordis-plugin-sofagent-inject
version: 1.5.3
displayName: cordis-plugin-sofagent-inject
description: >
  启动注入企业约束——四层加载链（seam: agent/pre-step）——桥接 @sofagent/inject buildConstrainedSystemPrompt——DSH（DeepSeek Harness）cordis plugin。sofagent 约束层在 DeepSeek Harness 生态的插件形态。
---

# cordis-plugin-sofagent-inject

启动注入企业约束——四层加载链（seam: agent/pre-step）——桥接 @sofagent/inject buildConstrainedSystemPrompt

## 用途

**装上之后**：模型每次请求前带上企业铁律 / 反思 / 用户规则 / 知识库（四层加载链）。**什么时候用**：希望 Agent 一开口就带着公司的规矩，不必每次交代背景。

**接入点**（seam: agent/pre-step）：桥接 `@sofagent/inject`，缺依赖时该能力静默跳过；接入形态（声明 / 实现）见 [SEAMS.md](../SEAMS.md)。

本插件随 sofagent 主线版本发布（SkillHub 通道：`skillhub install cordis-plugin-sofagent-inject` 安装与检索；npm 通道未开通）。版本号与 sofagent 主线对齐。

## 相关链接

- sofagent 主仓：https://github.com/KongFangXun/sofagent
- 开发日志：docs/changelog/v1.4/v1.4.0.md（DSH 插件家族）
