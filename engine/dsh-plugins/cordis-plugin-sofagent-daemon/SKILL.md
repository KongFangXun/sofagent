---
name: cordis-plugin-sofagent-daemon
slug: cordis-plugin-sofagent-daemon
version: 1.4.8
displayName: cordis-plugin-sofagent-daemon
description: >
  7×24 巡检 + 健康监测 + webhook 推送（seam: non-seam:host-process）——桥接 @sofagent/daemon startCron——DSH（DeepSeek Harness）cordis plugin。sofagent 约束层在 DeepSeek Harness 生态的插件形态。
---

# cordis-plugin-sofagent-daemon

7×24 巡检 + 健康监测 + webhook 推送（seam: non-seam:host-process）——桥接 @sofagent/daemon startCron

## 用途

**装上之后**：在宿主之外起一个独立调度进程做 7×24 巡检 + 健康监测 + webhook 推送——不占宿主事件循环，宿主不跑它照跑。无生命周期时机（独立进程，不寄生宿主事件）；桥接 `@sofagent/daemon`。

本插件随 sofagent 主线版本发布（SkillHub 通道：`skillhub install cordis-plugin-sofagent-daemon` 安装与检索；npm 通道未开通）。版本号与 sofagent 主线对齐。

## 相关链接

- sofagent 主仓：https://github.com/KongFangXun/sofagent
- 开发日志：docs/changelog/v1.4/v1.4.0.md（DSH 插件家族）
