---
name: cordis-plugin-sofagent-harness
slug: cordis-plugin-sofagent-harness
version: 1.4.7
displayName: cordis-plugin-sofagent-harness
description: >
  一次挂载 sofagent 全套能力（聚合编排层，只编排不重实现）（seam: non-seam:plugin-suite）——一次性挂载 9 个原子插件（sofagent 品牌插件 · 主色 #16B8F3）——DSH（DeepSeek Harness）cordis plugin。sofagent 约束层在 DeepSeek Harness 生态的插件形态。
---

# cordis-plugin-sofagent-harness

一次挂载 sofagent 全套能力（聚合编排层，只编排不重实现）（seam: non-seam:plugin-suite）——一次性挂载 9 个原子插件（sofagent 品牌插件 · 主色 #16B8F3）

## 用途

一次 `apply` 把 9 个原子插件（inject / audit / gate / ontology / commons / evolve / rollback / daemon / fde）逐个挂到同一个 `ctx` 上，挂完把结果（`loaded` / `failed` / `total`）注册成 `sofagent.harness` 服务。适合「整套装上、不想逐个装」的场景。

三条硬约束：

1. **只编排，不重实现** —— 每个能力仍由原子插件 `provide`，本层只依次调用它们的 `apply`，不复制任何子插件逻辑；
2. **逐个降级，不整挂失败** —— 缺任一个原子插件只记入 `failed` 数组（含包名与原因），其余 8 个照常加载；
3. **不替代细粒度插件** —— 9 个原子插件全部保留，本插件是**新增的整装选项**，按需二选一。

本插件随 sofagent 主线版本发布（SkillHub 通道：`skillhub install cordis-plugin-sofagent-harness` 安装与检索；npm 通道未开通）。版本号与 sofagent 主线对齐。

## 相关链接

- sofagent 主仓：https://github.com/KongFangXun/sofagent
- 开发日志：docs/changelog/v1.4/v1.4.0.md（DSH 插件家族）
