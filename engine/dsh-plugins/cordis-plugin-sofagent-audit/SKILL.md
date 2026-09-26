---
name: cordis-plugin-sofagent-audit
slug: cordis-plugin-sofagent-audit
version: 1.5.3
displayName: cordis-plugin-sofagent-audit
description: >
  变更机器审阅 + 验收硬门禁——25 规则 + git diff 硬证据 + Turn 停止验收判定（验收不过不放行，开关独立可关）（seam: tools/result + tools/pre-execute + fs/write-intent + agent/turn-stopping）——桥接 @sofagent/audit runRules——DSH（DeepSeek Harness）cordis plugin。sofagent 约束层在 DeepSeek Harness 生态的插件形态。
---

# cordis-plugin-sofagent-audit

变更机器审阅 + 验收硬门禁——25 规则 + git diff 硬证据 + Turn 停止验收判定（验收不过不放行，开关独立可关）（seam: tools/result + tools/pre-execute + fs/write-intent + agent/turn-stopping）

## 用途

**装上之后**：工具调用前后各过一道审计——25 条 git diff 硬证据规则 + 危险操作黑名单；Agent 想收尾时先过机器验收判定，不过不放行（验收门禁有独立开关，settings 里可关）。**什么时候用**：需要「改了什么、谁改的、有没有越界」有硬证据可查，且交付标准明确、不想让 Agent 自述「做完了」就算完。

**接入点**（seam: tools/result + tools/pre-execute + fs/write-intent + agent/turn-stopping）：桥接 `@sofagent/audit`，缺依赖时该能力静默跳过；接入形态（声明 / 实现）见 [SEAMS.md](../SEAMS.md)。验收判定源 = define_acceptance / check_acceptance 两 MCP tool（v1.4.9 P2 吸收原 cordis-plugin-sofagent-gate 验收面，不另造判定源）。

本插件随 sofagent 主线版本发布（SkillHub 通道：`skillhub install cordis-plugin-sofagent-audit` 安装与检索；npm 通道未开通）。版本号与 sofagent 主线对齐。

## 相关链接

- sofagent 主仓：https://github.com/KongFangXun/sofagent
- 开发日志：docs/changelog/v1.4/v1.4.0.md（DSH 插件家族）
