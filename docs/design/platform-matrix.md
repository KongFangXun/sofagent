# sofagent 五平台能力矩阵

> v0.84 五平台实测（2026-06-22）。实测案例：[docs/cases/](../evidence/cases/)

## 8 维度 × 5 平台

| 维度 | OpenClaw | WorkBuddy | Codex | Hermes | Claude Code |
|------|:---:|:---:|:---:|:---:|:---:|
| daemon 检测 | ✅ | ❌ | ✅ 可执行 | ❌ 脚本缺失 | ❌ |
| 步数闸 | ✅ Hook | ⚠️ 自觉 | ⚠️ 自觉 | ❌ 不生效 | ❌ |
| 熔断闸 | ✅ 系统级 | ⚠️ 自觉 | ⚠️ 自觉 | ❌ 5次未熔断 | ❌ |
| 幂等检查 | ✅ Hook | ⚠️ 自觉 | ⚠️ 自觉 | ❌ 不生效 | ❌ |
| 评判器隔离 | ✅ session.spawn | ❌ 自评 | ❓ | ❌ 自评 | ❌ |
| L1 SKILL.md | ✅ 100% | ⚠️ 需触发 | ✅ 超预期 | ✅ 超预期 | ⚠️ |
| L2 think.md | ✅ 100% | ⚠️ 空白 | ❓ | ❌ 不存在 | ⚠️ |
| L3 fde.md | ✅ 100% | ⚠️ 未配置 | ❓ | ✅ 超预期 | ⚠️ |

> ✅ = 生效 / ⚠️ = Agent 自觉 / ❌ = 不生效 / ❓ = 待实测

## 关键发现

**OpenClaw**（8/8）：唯一全通平台。Hook 自动注入 + loopDetection 断路器 + session.spawn 评判器隔离 = 完整纪律闭环。verify.sh 41/0。

**WorkBuddy**：核心约束（SKILL.md）需主动 `@skill:sofagent` 触发。步数闸/熔断闸/幂等检查靠 Agent 自觉，无法强制。评判器不能隔离（自己评自己）。

**Codex**：AGENTS.md 加载 L1 超预期（主动搜索），但缺乏脚本基础设施，L2/L3 不可靠。

**Hermes Agent**：加载链 L1/L3 主动搜索超预期，但所有治理加固（步数闸/熔断闸/幂等）不生效——prompt 级约束在此平台完全无效。

**Claude Code**：缺乏种子指令和脚本部署，大部分能力不可用。

> 完整实测数据见 [docs/evidence/cases/](../evidence/cases/)
