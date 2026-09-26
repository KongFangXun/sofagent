---
name: cordis-plugin-sofagent-daemon
slug: cordis-plugin-sofagent-daemon
version: 1.5.3
displayName: cordis-plugin-sofagent-daemon
description: >
  7×24 巡检 + 健康监测 + webhook 推送（seam: non-seam:host-process）——桥接 @sofagent/daemon startCron——DSH（DeepSeek Harness）cordis plugin。sofagent 约束层在 DeepSeek Harness 生态的插件形态。
---

# cordis-plugin-sofagent-daemon

7×24 巡检 + 健康监测 + webhook 推送（seam: non-seam:host-process）——桥接 @sofagent/daemon startCron

## 用途

**装上之后**：在宿主之外起独立进程做 7×24 巡检 + 健康监测 + webhook 推送。**什么时候用**：需要「没人盯着也在跑」的持续巡检与告警。

**接入点**（seam: non-seam:host-process）：桥接 `@sofagent/daemon`，缺依赖时该能力静默跳过；接入形态（声明 / 实现）见 [SEAMS.md](../SEAMS.md)。

本插件随 sofagent 主线版本发布（SkillHub 通道：`skillhub install cordis-plugin-sofagent-daemon` 安装与检索；npm 通道未开通）。版本号与 sofagent 主线对齐。

## 相关链接

- sofagent 主仓：https://github.com/KongFangXun/sofagent
- 开发日志：docs/changelog/v1.4/v1.4.0.md（DSH 插件家族）
