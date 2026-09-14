---
name: cordis-plugin-sofagent-rollback
slug: cordis-plugin-sofagent-rollback
version: 1.4.8
displayName: cordis-plugin-sofagent-rollback
description: >
  出错逆序撤销——git snapshot → effect disposer（seam: agent/error）——桥接 @sofagent/core getHistoryFilePath——DSH（DeepSeek Harness）cordis plugin。sofagent 约束层在 DeepSeek Harness 生态的插件形态。
---

# cordis-plugin-sofagent-rollback

出错逆序撤销——git snapshot → effect disposer（seam: agent/error）——桥接 @sofagent/core getHistoryFilePath

## 用途

**装上之后**：Agent 运行出错时按 git 快照**逆序撤销**本会话改动——出事能回到干净状态，不用人工逐个文件还原。介入时机 `agent/error`；桥接 `@sofagent/core`（需仓库已有快照历史，缺依赖时静默跳过）。

本插件随 sofagent 主线版本发布（SkillHub 通道：`skillhub install cordis-plugin-sofagent-rollback` 安装与检索；npm 通道未开通）。版本号与 sofagent 主线对齐。

## 相关链接

- sofagent 主仓：https://github.com/KongFangXun/sofagent
- 开发日志：docs/changelog/v1.4/v1.4.0.md（DSH 插件家族）
