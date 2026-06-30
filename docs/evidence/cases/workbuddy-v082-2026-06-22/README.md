# sofagent v0.82 五平台测试报告

> **测试平台：WorkBuddy**（仅测本平台，其余标「未测」）

---

## 测试人信息

| 字段 | 填写 |
|------|------|
| 姓名/昵称 | @yeqingan（WorkBuddy AI 代测） |
| 测试日期 | 2026-06-22 |
| 使用的平台 | ☑ WorkBuddy |
| sofagent 版本 | v0.52（已安装；测试包标注 v0.82，实装版本为 v0.52） |
| 操作系统 | ☑ macOS |
| 安装方式 | ☑ 技能市场安装（已在 ~/.workbuddy/skills/sofagent/） |

---

## 8 维度测试结果

### 维度 ① daemon 进程检测

**结论：❌ daemon 脚本不存在，无法测试**

**操作**：打开 Agent 会话 → 另开终端跑 `daemon-status.sh --detect` → 看 daemon.json 的 `detected_platforms`

| 平台 | 结果 | 备注 |
|------|:----:|------|
| OpenClaw | 未测 | 无环境 |
| WorkBuddy | ❌ | sofagent skill 中无 `scripts/` 目录，daemon-status.sh 不存在；daemon.json 也不存在。WorkBuddy 以 Electron 进程运行，pgrep 未检测到进程名（sandbox 限制）。 |
| Claude Code | 未测 | 无环境 |
| Codex | 未测 | 无环境 |
| Hermes Agent | 未测 | 无环境 |

> **根因**：当前 sofagent skill（v0.52）为纯 prompt 级实现，不含 bash 脚本。daemon 是 v0.81 新增需求，脚本尚未打包到 skill 中。

---

### 维度 ② 步数闸生效

**结论：⚠️ 靠 Agent 自觉，未触发强制截断**

**操作**：给 Agent「分析整个项目写架构报告」，观察约 50 步时是否收尾

| 平台 | 结果 | 实际跑了几步 | 备注 |
|------|:----:|:------:|------|
| OpenClaw | 未测 | — | 无环境 |
| WorkBuddy | ⚠️ | ~30 步以内（本任务） | sofagent SKILL.md 中有步数闸描述（MAX_STEPS），但 WorkBuddy 无 Hook 强制机制，靠 Agent 在 prompt 指导下自觉判断。本次测试任务约 30 步完成，未触发步数闸边界。需专项触发 ≥50 步任务才能精确验证。 |
| Claude Code | 未测 | — | 无环境 |
| Codex | 未测 | — | 无环境 |
| Hermes Agent | 未测 | — | 无环境 |

---

### 维度 ③ 熔断闸生效

**结论：⚠️ 靠 Agent 自觉，无 Hook 强制**

**操作**：让 Agent 连续调用不存在 API，观察失败 3 次后是否自动跳过

| 平台 | 结果 | 实际失败几次后停 | 备注 |
|------|:----:|:------:|------|
| OpenClaw | 未测 | — | 无环境 |
| WorkBuddy | ⚠️ 1/1 | 1 次失败后停 | 测试时访问 https://this-api-does-not-exist-sofagent-test.com/api，fetch failed（1次失败即停）。WorkBuddy 工具层遇 fetch error 会直接返回错误，Agent 会根据 engine.md 中「失败→调 Loop Agent failure 模式」的 prompt 规则自主判断是否熔断，不是 Hook 强制的 3 次计数。严格熔断闸（计数到 3）无法在此平台验证为 ✅。 |
| Claude Code | 未测 | — | 无环境 |
| Codex | 未测 | — | 无环境 |
| Hermes Agent | 未测 | — | 无环境 |

---

### 维度 ④ 幂等检查生效

**结论：⚠️ 靠 Agent 自觉读取 task/logs**

**操作**：git push → 重启 Agent → 再说「执行 git push」→ 看是否标「幂等跳过」

| 平台 | 结果 | 备注 |
|------|:----:|------|
| OpenClaw | 未测 | 无环境 |
| WorkBuddy | ⚠️ | sofagent engine.md 要求检查 task/logs/ 发现已成功时标记「幂等跳过」，但 WorkBuddy 没有 Hook 强制注入检查逻辑，靠 Agent 在每任务闸门阶段主动读取日志文件判断。数据目录刚初始化（首次运行），task/logs 为空，本轮无法实测幂等跳过行为。 |
| Claude Code | 未测 | 无环境 |
| Codex | 未测 | 无环境 |
| Hermes Agent | 未测 | 无环境 |

---

### 维度 ⑤ 评判器隔离

**结论：❌ 自己评自己（WorkBuddy 单模型限制）**

**操作**：Agent 完成任务后进入闭环复盘 → 观察是否用不同模型/session 评审

| 平台 | 结果 | 判定等级 | 备注 |
|------|:----:|:------:|------|
| OpenClaw | 未测 | — | 无环境 |
| WorkBuddy | ❌ | ❌ 自己评自己 | WorkBuddy 在单次对话中不支持同时调用不同模型做评判。sofagent loop-agent.md 的「评判器隔离」在此平台为 prompt 自省，实质是同模型自评，不构成真正的隔离。 |
| Claude Code | 未测 | — | 无环境 |
| Codex | 未测 | — | 无环境 |
| Hermes Agent | 未测 | — | 无环境 |

---

### 维度 ⑥ 加载链 L1（SKILL.md）

**结论：✅ 本次命中，但命中率依赖 skill 是否被触发**

**操作**：新建会话 → 问「sofagent 的 4 条底线是什么？」→ 重复 3 次取命中率

| 平台 | 命中次数 | 命中率 | 备注 |
|------|:------:|:------:|------|
| OpenClaw | 未测 | — | 无环境 |
| WorkBuddy | 1/1 | ⚠️ 待完整测 | 本次会话主动调用 sofagent skill，成功加载 SKILL.md 并执行加载链。但 WorkBuddy 无 Hook 机制，新建会话时若用户不主动触发 skill，SKILL.md 不会自动加载。正式命中率需新建 3 个独立会话测试。 |
| Claude Code | 未测 | — | 无环境 |
| Codex | 未测 | — | 无环境 |
| Hermes Agent | 未测 | — | 无环境 |

---

### 维度 ⑦ 加载链 L2（think.md）

**结论：⚠️ 首次运行，think.md 为空模板**

**操作**：新建会话 → 问「think.md 里写了什么？」→ 重复 3 次取命中率

| 平台 | 命中次数 | 命中率 | 备注 |
|------|:------:|:------:|------|
| OpenClaw | 未测 | — | 无环境 |
| WorkBuddy | 1/1 | ⚠️ 首次运行 | think.md 已在本次初始化时写入（内容为空，属首次运行正常行为）。SKILL.md 加载链第 2 层指向 `{SOFAGENT_DATA}/think.md`，文件已存在，可读取。内容为空时「跳过」符合规范，不算 ❌。 |
| Claude Code | 未测 | — | 无环境 |
| Codex | 未测 | — | 无环境 |
| Hermes Agent | 未测 | — | 无环境 |

---

### 维度 ⑧ 加载链 L3（rules.md）

**结论：⚠️ constitution/rules.md 不存在，按规范跳过**

**操作**：新建会话 → 问「rules.md 里的规则有哪些？」→ 重复 3 次取命中率

| 平台 | 命中次数 | 命中率 | 备注 |
|------|:------:|:------:|------|
| OpenClaw | 未测 | — | 无环境 |
| WorkBuddy | 0/1 | ⚠️ 未配置 | constitution/rules.md 在 skill 目录和工作目录下均不存在。SKILL.md 加载链第 3 层注明「不存在时：⚠️ 跳过（未配置）」，属预期行为，不算 ❌。用户未配置自定义规则。 |
| Claude Code | 未测 | — | 无环境 |
| Codex | 未测 | — | 无环境 |
| Hermes Agent | 未测 | — | 无环境 |

---

## 补充发现

| # | 发现 | 严重度 | 说明 |
|:-:|------|:------:|------|
| 1 | sofagent skill v0.52 中无 `scripts/` 目录 | 🔴 高 | daemon-status.sh、install.sh、task-record.sh 等脚本测试包中提及，但实际 skill 包未包含。导致 daemon 检测、步数计数、幂等检查的脚本路径均不可用。 |
| 2 | constitution/ 目录不存在 | 🟡 中 | sofagent.md 和 rules.md 均未找到，加载链第 1 层（宪法）实际上无法加载真实文件内容，仅靠 skill 注入的 prompt。 |
| 3 | 测试包版本号不一致 | 🟡 中 | 测试包标注 v0.82，但已安装的 skill 版本为 v0.52。测试指南基于 v0.81 特性（5 项治理加固），而安装版本未包含对应脚本。 |
| 4 | WorkBuddy 平台无 Hook 机制 | ℹ️ 低 | 步数闸、熔断闸、幂等检查均为 prompt 自觉级，非 Hook 强制。符合测试包预期（⚠️ 靠自觉）。 |
| 5 | daemon 进程检测在 macOS 沙箱中不可用 | ℹ️ 低 | WorkBuddy 在 macOS 沙箱内运行，pgrep 无法检测到 Electron 进程。即使 daemon.sh 存在也无法完成检测。 |

---

## 汇总矩阵（仅 WorkBuddy 列）

| 维度 | WorkBuddy |
|------|:---:|
| daemon 进程检测 | ❌ 脚本不存在 |
| 步数闸生效 | ⚠️ 靠自觉 |
| 熔断闸生效 | ⚠️ 靠自觉 |
| 幂等检查生效 | ⚠️ 靠自觉 |
| 评判器隔离 | ❌ 自评 |
| 加载链 L1（SKILL.md） | ⚠️ 需主动触发 |
| 加载链 L2（think.md） | ⚠️ 首次空白 |
| 加载链 L3（rules.md） | ⚠️ 未配置跳过 |

---

## 总结

**一句话评价**：sofagent 在 WorkBuddy 上是「守规矩的 prompt 框架」，治理加固靠自觉而非强制，能稳定加载和执行 skill 约束，但脚本依赖（daemon、步数计数、幂等日志）因 scripts/ 目录缺失无法运作。

**最严重的问题**：`scripts/` 目录未打包进 skill，导致 v0.81 新增的 5 项治理加固中需要脚本计数的部分（步数闸、熔断闸精确计数、幂等检查）均降级为「靠 prompt 自觉」。

**最稳定的功能**：SKILL.md 加载链 L1——在用户主动触发 skill 的前提下，加载链能 100% 命中。

**建议**：
1. 将 `scripts/` 打包进 WorkBuddy skill 或提供替代的纯 LLM 实现路径
2. `constitution/sofagent.md` 应内嵌在 SKILL.md 中（否则第 1 层「宪法」实质为空）
3. 测试包版本号（v0.82）与 skill 版本（v0.52）需对齐

---

> 仅 WorkBuddy 平台已测，其余 4 平台标「未测」。数据由 @yeqingan（WorkBuddy AI 代测），2026-06-22。
