# Case 011 — Claude Code v0.82 八维度测试（2026-06-22）

> **性质**：平台兼容性验证
> **测试人**：KongFangXun（WorkBuddy 代测）
> **版本**：sofagent v0.82
> **平台**：Claude Code CLI

---

## 环境确认

| 检查项 | 结果 | 说明 |
|------|:--:|------|
| verify.sh --platform claude --quick | ✅ | 4/4 通过 |
| install.sh --platform claude --quick | ✅ | exit 0 |
| ~/.claude/skills/sofagent/ 部署 | ✅ | 9 个文件 |
| ~/.claude/skills/sofagent/scripts/ | 🔴 | **未部署** |
| daemon 检测 claude | ❌ | 未命中 |
| Claude Code CLI 认证 | ❌ | 未登录（无法跑真实任务） |
| CLAUDE.md 种子指令 | ❌ | 未写入 |

---

## 8 维度结果

> ⚠️ **方法论诚实声明**：Claude Code CLI 未登录，维度 ②–⑤ 无法执行运行时测试。以下结果中，标注「未测」的维度基于**文件部署状态 + 架构分析**推断，非实测数据。脚本是否缺 Hook 系统、daemon 是否不检测 claude 会话——这些推断本身正确，但「运行时 Agent 行为」未经独立会话验证。

| 维度 | 结果 | 方法 | 说明 |
|------|:----:|:--:|------|
| ① daemon 进程检测 | ❌ 不生效 | ✅ 实测 | daemon-status.sh --detect 未输出 claude |
| ② 步数闸生效 | ❌ 未测 | ⚠️ 推断 | scripts/ 未部署到 ~/.claude/skills/sofagent/，无 Hook 机制强制步数限制。**推断**：不生效。但未经运行时验证（CLI 未登录） |
| ③ 熔断闸生效 | ❌ 未测 | ⚠️ 推断 | daemon 不检测 claude 会话，无 code 级断路器。**推断**：不生效。未经运行时验证 |
| ④ 幂等检查生效 | ❌ 未测 | ⚠️ 推断 | 需 task/logs + task-record.sh 基础设施，均未就位。**推断**：不生效 |
| ⑤ 评判器隔离 | ❌ 未测 | ⚠️ 推断 | Claude Code 不支持 session.spawn 独立评判。**推断**：不生效 |
| ⑥ 加载链 L1（SKILL.md） | ⚠️ 受限 | ✅ 实测 | 文件已部署（4底线+10铁律完整），CLAUDE.md 已写入种子指令（v0.83 修复），但未在 Claude Code 运行时验证加载命中率 |
| ⑦ 加载链 L2（think.md） | ⚠️ 受限 | ✅ 实测 | 文件存在于 workspace，但无自动加载机制，需 Agent 主动搜索 |
| ⑧ 加载链 L3（rules.md） | ⚠️ 受限 | ✅ 实测 | 文件已部署，同 L1——种子指令已写入但未运行时验证 |

---

## 核心发现

三个断裂点（均基于文件部署状态，非运行时实测）：

| # | 断裂点 | 严重度 | 说明 | v0.83 修复状态 |
|:-:|------|:------:|------|:---:|
| 1 | scripts/ 未部署 | 🔴 高 | 编排引擎完全失效。引擎是 sofagent 的核心差异化能力，但在 v0.82 Claude Code 上只剩文档 | ✅ v0.83 已部署 |
| 2 | 种子指令未写入 CLAUDE.md | 🟡 中 | install.sh 提示了"请手动粘贴"，但新用户装完不知道要操作 | ✅ v0.83 已自动写入 |
| 3 | daemon 不检测 claude | 🟡 中 | 即使脚本部署了也没有守门员 | ❌ 仍不检测 |
| 4 | CLI 未登录，无法运行时验证 | 🔴 高 | Claude Code 需要 Anthropic 账号 OAuth 登录，无账号无法跑任何测试任务 | ❌ 仍需要账号 |

**本质原因**：install.sh 将 Claude Code 归类为"手动平台"，部署策略是「放文件 + 给指令 + 靠自觉」——与 Hermes Agent 同属一类。v0.83 修复了 scripts 部署和种子指令写入，但**运行时验证仍因 CLI 未登录而缺失**——真正的 A/B 测试需要 Anthropic 账号。

---

## 与其他平台对比

| 维度 | OpenClaw | WorkBuddy | Codex | Hermes Agent | **Claude Code** |
|------|:---:|:---:|:---:|:---:|:---:|
| daemon 检测 | ✅ | ❌ | ✅ | ❌ | ❌ |
| 步数闸 | ✅ Hook | ⚠️ 靠自觉 | ⚠️ 靠自觉 | ❌ | ❌ |
| 熔断闸 | ✅ 系统级 | ⚠️ 靠自觉 | ⚠️ 靠自觉 | ❌ | ❌ |
| 幂等检查 | ✅ | ⚠️ 靠自觉 | ⚠️ 靠自觉 | ❌ | ❌ |
| 评判器隔离 | ✅ spawn | ❌ 自评 | ❓ | ❌ 自评 | ❌ |
| 加载链 L1 | ✅ 100% | ⚠️ 需触发 | ✅ | ✅ | ⚠️ 缺种子 |
| 加载链 L2 | ✅ 100% | ⚠️ 空白 | ❓ | ❌ | ⚠️ 缺机制 |
| 加载链 L3 | ✅ 100% | ⚠️ 未配置 | ❓ | ✅ | ⚠️ 缺种子 |

> Claude Code 与 Hermes Agent 表现最接近——均为"手动平台"，治理加固全失效。但 Claude Code 额外多了 scripts/ 未部署问题（v0.83 已修复），以及 CLI 未登录导致**所有运行时维度无法实测**的独有问题。

---

> ⚠️ **v0.84 更新**（2026-06-23）：确认 Claude Code CLI 仍无法登录——需要 Anthropic 账号 OAuth 认证，API key 旁路无效。scripts/ 部署和种子指令写入两项已在 v0.83 修复，但运行时 A/B 测试仍不可行。本报告的维度 ②–⑤ 结果应理解为「文件部署级推断」，非运行时实测。

> 测试人：KongFangXun（WorkBuddy 代测）
> 测试日期：2026-06-22
> sofagent 版本：v0.82
