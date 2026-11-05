---
name: cordis-plugin-sofagent-rsi-corpus
slug: cordis-plugin-sofagent-rsi-corpus
version: 1.8.0
displayName: cordis-plugin-sofagent-rsi-corpus
description: >
  语料管道 tool 集——脱敏 L0/L1 + 三分拣（SENSITIVE/JUDGEMENT/ABSTAIN），与出厂基准逐字节等价（golden 锁定）（seam: non-seam:tool-set）——桥接 @sofagent/rsi-corpus runPipeline——DSH（DeepSeek Harness）cordis plugin。sofagent 约束层在 DeepSeek Harness 生态的插件形态。
---

# cordis-plugin-sofagent-rsi-corpus

语料管道 tool 集——脱敏 L0/L1 + 三分拣（SENSITIVE/JUDGEMENT/ABSTAIN），与出厂基准逐字节等价（golden 锁定）（seam: non-seam:tool-set）

## 用途

**装上之后**：把一段原始语料交给管道，先过 L0/L1 两层脱敏（去掉密钥、路径、账号一类不该进训练集的东西），再按三分拣规则分成 sensitive / judgement / abstain 三类落盘——**判定用的留下来，敏感的剔出去，拿不准的单独标记**。什么时候用：要把真实工作语料变成可用于 RSI 训练与评测的数据集，且必须先证明「脱敏与分拣结果与出厂基准逐字节一致」才能采信。

**接入点**（seam: non-seam:tool-set）：非宿主事件接入——以 tool 集形态按需调用，不订阅宿主事件。桥接 `@sofagent/rsi-corpus` 的 `runPipeline`，缺依赖时该能力静默跳过；接入形态（声明 / 实现）见 [SEAMS.md](../SEAMS.md)。

**等价性保证**：行为基准 = 出厂 `rsi/corpus/pipeline.mjs` v0.1.0，逐字节等价的黄金样本固定在包内 [`GOLDEN.json`](./GOLDEN.json)；改动实现须重跑黄金对账，不等价即视为回归。

本插件随 sofagent 主线版本发布（SkillHub 通道：`skillhub install cordis-plugin-sofagent-rsi-corpus` 安装与检索；npm 通道侧 `@sofagent/rsi-corpus` 走独立版本线 0.1.x）。

## 相关链接

- sofagent 主仓：https://github.com/KongFangXun/sofagent
- 开发日志：docs/changelog/v1.8/v1.8.0.md（Q21 收口批：rsi-corpus 插件接入根构建与 npm 发布面）
