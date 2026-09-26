---
name: cordis-plugin-sofagent
slug: cordis-plugin-sofagent
version: 1.5.3
displayName: cordis-plugin-sofagent
description: >
  一次挂载 sofagent 全套能力——6 项能力一次到位（注入 · 审计与验收 · 经验 · 回溯 · 巡检 · FDE 三域）（seam: non-seam:plugin-suite）——只编排不重实现——sofagent 约束层在 DSH（DeepSeek Harness）生态的插件形态。
---

# cordis-plugin-sofagent

一次挂载 sofagent 全套能力——6 项能力一次到位（注入 · 审计与验收 · 经验 · 回溯 · 巡检 · FDE 三域）（seam: non-seam:plugin-suite）——只编排不重实现，能力仍由各原子插件提供

## 用途

一次 `apply` 把 6 个原子插件（inject / audit / evolve / rollback / daemon / fde）逐个挂到同一个 `ctx` 上，挂完把结果（`loaded` / `failed` / `total`）注册成 `sofagent.suite` 服务。适合「整套装上、不想逐个装」的场景。**什么时候用**：一次拿到全套约束层能力、不想逐个挑插件时。

三条硬约束：

1. **只编排，不重实现** —— 每个能力仍由原子插件 `provide`，本层只依次调用它们的 `apply`，不复制任何子插件逻辑；
2. **逐个降级，不整挂失败** —— 缺任一个原子插件只记入 `failed` 数组（含包名与原因），其余 5 个照常加载；
3. **不替代细粒度插件** —— 6 个原子插件全部保留，本插件是**新增的整装选项**，按需二选一。

本插件随 sofagent 主线版本发布，走**宿主挂载通道**：`skillhub install cordis-plugin-sofagent`。⚠️ **本插件不在 npm 通道**——11 款插件（7 DSH + 4 OpenClaw，v1.4.9 P2 合并批 14→11）均为 `private`，npm 装不到；npm 侧另有**库通道** `npm i -g sofagent`（总包 `engine/umbrella`，聚合 `@sofagent/audit` / `mcp` / `orchestrator` / `daemon` 四个能力包，**不含本插件**）。两条通道按所在环境二选一，互不依赖、互不为前置。版本号与 sofagent 主线对齐。

本插件是**宿主挂载入口**；**npm 安装入口见裸名总包**（`engine/umbrella`，包名 `sofagent`）—— 两个入口互不引用为前置，按使用场景各取其一。

## 相关链接

- sofagent 主仓：https://github.com/KongFangXun/sofagent
- 开发日志：docs/changelog/v1.4/v1.4.0.md（DSH 插件家族）
