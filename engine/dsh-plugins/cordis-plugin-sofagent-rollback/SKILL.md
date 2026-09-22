---
name: cordis-plugin-sofagent-rollback
slug: cordis-plugin-sofagent-rollback
version: 1.5.1
displayName: cordis-plugin-sofagent-rollback
description: >
  出错逆序撤销——git snapshot → effect disposer（seam: agent/error）——桥接 @sofagent/core getHistoryFilePath——DSH（DeepSeek Harness）cordis plugin。sofagent 约束层在 DeepSeek Harness 生态的插件形态。
---

# cordis-plugin-sofagent-rollback

出错逆序撤销——git snapshot → effect disposer（seam: agent/error）——桥接 @sofagent/core getHistoryFilePath

## 用途

**装上之后**：Agent 出错时按 git 快照逆序撤销本次会话改动。**什么时候用**：Agent 一次动了大量文件、需要一键回到干净状态。

**接入点**（seam: agent/error）：桥接 `@sofagent/core`，缺依赖时该能力静默跳过；接入形态（声明 / 实现）见 [SEAMS.md](../SEAMS.md)。

本插件随 sofagent 主线版本发布（SkillHub 通道：`skillhub install cordis-plugin-sofagent-rollback` 安装与检索；npm 通道未开通）。版本号与 sofagent 主线对齐。

## 相关链接

- sofagent 主仓：https://github.com/KongFangXun/sofagent
- 开发日志：docs/changelog/v1.4/v1.4.0.md（DSH 插件家族）
