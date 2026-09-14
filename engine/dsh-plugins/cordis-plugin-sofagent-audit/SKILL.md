---
name: cordis-plugin-sofagent-audit
slug: cordis-plugin-sofagent-audit
version: 1.4.8
displayName: cordis-plugin-sofagent-audit
description: >
  变更机器审阅——24 规则 + git diff 硬证据 + 节点级审计（seam: tools/result + tools/pre-execute + fs/write-intent）——桥接 @sofagent/audit runRules——DSH（DeepSeek Harness）cordis plugin。sofagent 约束层在 DeepSeek Harness 生态的插件形态。
---

# cordis-plugin-sofagent-audit

变更机器审阅——24 规则 + git diff 硬证据 + 节点级审计（seam: tools/result + tools/pre-execute + fs/write-intent）——桥接 @sofagent/audit runRules

## 用途

**装上之后**：工具调用前后各过一道审计——24 条 git diff 硬证据规则 + 危险操作黑名单。**什么时候用**：需要「改了什么、谁改的、有没有越界」有硬证据可查。

**接入点**（seam: tools/result + tools/pre-execute + fs/write-intent）：桥接 `@sofagent/audit`，缺依赖时该能力静默跳过；接入形态（声明 / 实现）见 [SEAMS.md](../SEAMS.md)。

本插件随 sofagent 主线版本发布（SkillHub 通道：`skillhub install cordis-plugin-sofagent-audit` 安装与检索；npm 通道未开通）。版本号与 sofagent 主线对齐。

## 相关链接

- sofagent 主仓：https://github.com/KongFangXun/sofagent
- 开发日志：docs/changelog/v1.4/v1.4.0.md（DSH 插件家族）
