---
name: cordis-plugin-sofagent-evolve
slug: cordis-plugin-sofagent-evolve
version: 1.6.0
displayName: cordis-plugin-sofagent-evolve
description: >
  进化面 RSI 独立模块（准入门 / 晋级 / 经验池 / 考核 / 写面审计 / 能力基线 / 透明仓）——经验沉淀（think.md 反思）+ 写面权限窄化（模型只写 memory / skill，控制面写入即拒）（seam: session/event + fs/write-intent）——桥接 @sofagent/think generateThinkEntry——DSH（DeepSeek Harness）cordis plugin。sofagent 约束层在 DeepSeek Harness 生态的插件形态。
---

# cordis-plugin-sofagent-evolve

进化面 RSI 独立模块（准入门 / 晋级 / 经验池 / 考核 / 写面审计 / 能力基线 / 透明仓）——经验沉淀（think.md 反思）+ 写面权限窄化（模型只写 memory / skill，控制面写入即拒）（seam: session/event + fs/write-intent）——桥接 @sofagent/think generateThinkEntry

## 用途

**装上之后**：① 任务收尾自动写一条 think.md 反思条目；② 写面权限窄化——被治理的执行模型只能写 memory / skill 两类产物，策略 / 注入 / 路由 / 状态 / 审计历史属控制面，写入即拒。
**什么时候用**：同一个坑反复踩、想让经验留下来被下次检索；或要把「治理面在被治理者可写面之外」落成运行时硬边界。

**接入点**（seam: session/event + fs/write-intent）：桥接 `@sofagent/think`，缺依赖时该能力静默跳过；写面窄化判定在插件内（不依赖引擎包，可独立拔插）；接入形态（声明 / 实现）见 [SEAMS.md](../SEAMS.md)。

**RSI 模块定位**：准入门 / 晋级 / 经验池 / 考核 / 写面审计 / 能力基线 / 透明仓——v1.5.9 起进化面产品形态从 harness 主干功能改挂本插件（DSH 七款之一，插件位已存在，零迁移成本）；沉淀留主干（数据管道），进化独立成 RSI 插件（决策管道）。换掉本插件 ≠ 失去审计与沉淀（主干完整性不受插件存废影响）。

**治理件（可独立拔插）**：写面边界 `write-surface-boundary.ts`（门禁）+ 策展快照 `curator.ts`（台账——curator 运行前打快照、归档移入 `.archive/` 非物理删、动作留痕，与 v1.5.7 退役纪律「归档优先于物理删」同族）。

本插件随 sofagent 主线版本发布（SkillHub 通道：`skillhub install cordis-plugin-sofagent-evolve` 安装与检索；npm 通道未开通）。版本号与 sofagent 主线对齐。

## 相关链接

- sofagent 主仓：https://github.com/KongFangXun/sofagent
- 开发日志：docs/changelog/v1.5/v1.5.9.md（章七 进化面插件化）
