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

| 维度 | 结果 | 说明 |
|------|:----:|------|
| ① daemon 进程检测 | ❌ | detected_platforms 不含 claude |
| ② 步数闸生效 | ❌ | scripts 未部署，无强制机制 |
| ③ 熔断闸生效 | ❌ | scripts 未部署，CLI 未登录无法实测 |
| ④ 幂等检查生效 | ❌ | 需 task/logs 基础设施 |
| ⑤ 评判器隔离 | ❌ | Claude Code 不支持独立评判 session |
| ⑥ 加载链 L1（SKILL.md） | ⚠️ | 文件已部署，缺种子指令触发 |
| ⑦ 加载链 L2（think.md） | ⚠️ | 文件存在（6369 字符），缺加载机制 |
| ⑧ 加载链 L3（rules.md） | ⚠️ | 文件已部署，缺种子指令触发 |

---

## 核心发现

三个断裂点，任何一个都导致 sofagent 实际效果 = 0：

| # | 断裂点 | 严重度 | 说明 |
|:-:|------|:------:|------|
| 1 | scripts/ 未部署 | 🔴 高 | 编排引擎完全失效。引擎是 sofagent 的核心差异化能力，但在 Claude Code 上只剩文档 |
| 2 | 种子指令未写入 CLAUDE.md | 🟡 中 | install.sh 提示了"请手动粘贴"，但新用户装完 sees "安装成功"就不会再操作 |
| 3 | daemon 不检测 claude | 🟡 中 | 即使脚本部署了也没有守门员 |

**本质原因**：install.sh 将 Claude Code 归类为"手动平台"，部署策略是「放文件 + 给指令 + 靠自觉」——与 Hermes Agent 同属一类。

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

> Claude Code 与 Hermes Agent 表现最接近——均为"手动平台"，治理加固全失效。但 Claude Code 额外多了 scripts/ 未部署问题。

---

> 测试人：KongFangXun（WorkBuddy 代测）
> 测试日期：2026-06-22
> sofagent 版本：v0.82
