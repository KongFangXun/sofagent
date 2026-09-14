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

**装上之后**：每次工具调用在执行**前**先过一遍审计（危险操作可拦停）、在返回**后**自动留证，写盘意图也在落盘前被过一遍——变更审计从「提交时」前移到「运行时」。介入时机 `tools/pre-execute` + `tools/result` + `fs/write-intent`；桥接 `@sofagent/audit`（缺失时静默跳过）。

本插件随 sofagent 主线版本发布（SkillHub 通道：`skillhub install cordis-plugin-sofagent-audit` 安装与检索；npm 通道未开通）。版本号与 sofagent 主线对齐。

## 相关链接

- sofagent 主仓：https://github.com/KongFangXun/sofagent
- 开发日志：docs/changelog/v1.4/v1.4.0.md（DSH 插件家族）
