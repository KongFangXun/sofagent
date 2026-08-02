# 使用案例

sofagent 在真实环境中的使用记录。按时间倒序排列。

| 日期 | 案例 | 平台 | 摘要 |
|------|------|------|------|
| 2026-07-01 | [审计引擎检出率首次实测](./v0992-audit-detection-2026-07-01/README.md) | WorkBuddy（关联企业） | 5/5 全绿 100%：A2 密钥/A3 越界/A4 删配置/A5 commit/E1 缺测试 |
| 2026-07-01 | [v0.99.2 质量加固 + 六步闭环验证](./v0992-release-test-2026-07-01/README.md) | WorkBuddy + OpenClaw | 18 项问题修复 + 6 TC 全绿（daemon/MCP/审计/AO/macOS） |
| 2026-07-01 | [v0.99 发版前三线并行测试](./v099-release-test-2026-07-01/README.md) | WorkBuddy + OpenClaw | 发版前全量测试（398 tests + ao compose 多智能体审查） |
| 2026-06-24 | [社区 A/B 测试](./community-ab-test-2026-06-24/README.md) | Community | 社区用户 A/B 对比测试 |
| 2026-06-22 | [Claude v0.82 测试](./claude-v082-2026-06-22/README.md) | Claude | Claude Agent 纪律层验证 |
| 2026-06-22 | [Codex v0.82 测试](./codex-v082-2026-06-22/README.md) | Codex | Codex Agent 纪律层验证 |
| 2026-06-22 | [Hermes v0.82 测试](./hermes-v082-2026-06-22/README.md) | Hermes | Hermes Agent 纪律层验证 |
| 2026-06-22 | [WorkBuddy v0.82 测试](./workbuddy-v082-2026-06-22/README.md) | WorkBuddy | WorkBuddy 纪律层验证 |
| 2026-06-21 | [OpenClaw v0.82 测试](./openclaw-v082-2026-06-21/README.md) | OpenClaw | OpenClaw 纪律层验证 |
| 2026-06-20 | [AO Compose 测试](./ao-compose-2026-06-20/README.md) | CLI | 任务编排引擎测试 |
| 2026-06-20 | [Codex 稳定性测试](../../archive/evidence/codex-stability-2026-06-20/README.md) | Codex | Codex 长时间稳定性 |
| 2026-06-20 | [WorkBuddy 约束+AO 测试](./workbuddy-constraint-ao-test-2026-06-20/README.md) | WorkBuddy | 约束层 + 编排联合测试 |
| 2026-06-19 | [OpenClaw 端到端测试](../../archive/evidence/openclaw-e2e-2026-06-19/README.md) | OpenClaw | 首次 E2E 完整链路 |
| 2026-06-18 | [意大利旅行规划](../../archive/evidence/italy-travel-2026-06-18/README.md) | WorkBuddy | 非代码任务（旅行规划） |
| 2026-06-18 | [WorkBuddy 自测](../../archive/evidence/workbuddy-self-test-2026-06-18/README.md) | WorkBuddy | 首次 WorkBuddy 约束测试 |

> 对照实验和 benchmark 数据见 [benchmark 目录](../benchmark/)。
> 失败的案例见 [anti-cases 目录](../anti-cases/)。
