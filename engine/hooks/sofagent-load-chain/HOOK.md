---
name: sofagent-load-chain
description: "sofagent 四层加载链——agent:bootstrap 时注入 fde.md (用户规则) + think.md (反思区) + knowledge/ (知识库)，第 1 层宪法由 skill 系统注入"
metadata:
  openclaw:
    emoji: "⛓️"
    events: ["agent:bootstrap"]
    requires:
      env: []
      bins: []
---

# sofagent 加载链

在每次 Agent bootstrap 时，将 fde.md（第 2 层用户规则）、think.md（第 3 层反思区）注入 bootstrap 文件列表；第 4 层 knowledge/ 由 Harness 运行时加载。

第 1 层（4 底线 + 7 则铁律）由 skill 系统通过 SKILL.md 自动注入，本 hook 不重复注入。

详见 sofagent 项目：https://github.com/KongFangXun/sofagent

---

## 约束注入的三个形态（按强度排序）

约束要生效，第一步是把规则塞进 Agent 上下文。sofagent 有三条注入通道，强度递减：

| 形态 | 触发机制 | 强度 | 适用 |
|---|---|---|---|
| **① DSH 生命周期 hook** | `tools/pre-execute` 等 8 个事件，每次工具调用可拦 | **最强（逐调用强制）** | sofagent 自建执行后端（v1.3.9 起默认） |
| **② 平台 bootstrap hook** | `agent:bootstrap` 事件，会话开始时注入 | **强（会话级强制）** | OpenClaw 宿主平台 |
| **③ Skill 自觉加载** | SKILL.md 随 Agent 调用注入 | **自觉（软约束）** | WorkBuddy / Codex / Claude |
| **④ harness 代码级拼入** | `buildConstrainedSystemPrompt` 构建 system prompt | **强（代码保证）** | npm API 自建 Agent |

> 约束注入的强度随形态递减，但**审计模块（git diff 24 规则）在所有形态一样硬**——约束是建议性的，审计是强制性的。

---

## 主战场：DSH（DeepSeek Harness）生命周期 hook

**DSH 是 sofagent 自建执行后端（v1.3.9 起 FORGE driver 默认切换，见 ROADMAP §六）**——约束注入的主战场在这里，OpenClaw 只是外部宿主平台的一种。

DSH 原生支持 **8 个生命周期 hook，全部为瀑布流（Waterfall）可拦截**——比 OpenClaw 的 `agent:bootstrap`（会话开始注入一次）细得多，是**每次工具调用都能拦**：

| DSH Hook | 时机 | 与 sofagent 的对接 |
|---|---|---|
| `agent/pre-step` | 模型看到输入前 | 约束注入（role-* 按任务类型） |
| `agent/request` | 模型请求发出前 | 请求审查 |
| `agent/request-error` | 请求失败后 | 重试/降级策略 |
| `agent/turn-stopping` | Turn 结束前 | 停止条件判定 |
| `tools/pre-execute` | **工具执行前** | **审计模块接入点（A2 密钥 / A9 注入拦截）** |
| `tools/execute` | 工具执行 | 计时 / 成本计量 |
| `tools/post-execute` | 工具执行后 | 结果质检 |
| `tools/result` | 最终结果确定 | 审计留证（history.jsonl） |

**现状**：DSH 已通过 `ExecutionBackend` 接入编排层（`execution-backends/dsh-backend.ts`），但约束注入尚未挂到 DSH 的 hook 上——这是「注入能力」从「会话级一次注入」升级为「每次工具调用拦截」的天然落点。

**为什么 DSH 是主战场**：
1. **它是 sofagent 自己的执行后端**——OpenClaw hook 依赖第三方平台暴露事件，DSH 是自建、可控、可扩展；
2. **粒度更细**——`tools/pre-execute` 让审计从「提交时审计」升级为「运行时审计」（节点级审计 §2.6 前瞻的落点），这是 OpenClaw bootstrap 做不到的；
3. **与策略同构**——DSH 的 `tools/pre-execute` 瀑布流 = sofagent 24 条审计规则的天然执行点，A2 密钥 / A9 注入可直接挂上。

---

## 宿主平台注入：OpenClaw bootstrap hook（本文件实现）

本 HOOK 文件服务 **OpenClaw 平台**——由 `agent:bootstrap` 事件触发，`install.sh --platform openclaw` 时部署到 `~/.openclaw/hooks/sofagent-load-chain/`。

| 平台 | Hook 注入 | 约束注入方式 | 强度 |
|---|---|---|---|
| **OpenClaw** | ✅（`agent:bootstrap` 事件强制触发） | Hook 注入（core-rules + role-* + think.md + fde.md） | **强制**（平台保证每次会话注入） |
| **WorkBuddy** | ❌ 无 Hook | Skill 自觉加载（SKILL.md 随调用注入） | 自觉（软约束） |
| **Codex** | ✅（v1.4.0 起 · 生命周期 hook：`pre-tool-use`/`post-tool-use`/`permission-request`/`subagent-start` 等，Claude Code 兼容 JSON 命令行协议） | 生命周期 hook 注入（约束 + 审计拦截，逐工具调用可拦） | **强制**（v1.4.0 Codex plugin 家族交付后；此前为 AGENTS.md 自觉加载） |
| **Claude** | ✅（Claude Code 原生 hooks——`pre-tool-use` 等，与 Codex 同协议） | 生命周期 hook 注入（Claude Code 生态适配评估中） | 自觉（软约束）→ 可升级（协议同源） |
| **自建 Agent（npm API）** | ❌ 无 Hook | `@sofagent/harness` 的 `buildConstrainedSystemPrompt` 代码级拼入 | **强制**（代码保证） |

> 🔌 **Codex hook 协议参考（2026-08-22 源码核验 · openai/codex）**：Codex 生命周期 hooks 复用 Claude Code 兼容协议——JSON in/out 命令行引擎（`ClaudeHooksEngine` + `CommandHookRuntime`），事件包括 `pre-tool-use`（工具调用前拦截 + permission_mode，与 DSH `tools/pre-execute` 功能同构）/ `post-tool-use` / `permission-request`（审批请求）/ `session-start` / `subagent-start` / `stop`。挂载点：`.codex/hooks/` 下 JSON 命令行 hook（仿本文件 OpenClaw 形态）。详见 [v1.4.0 开发日志 Codex plugin 家族](https://github.com/KongFangXun/sofagent/blob/main/docs/changelog/v1.4/v1.4.0.md)。

**为什么 OpenClaw 是宿主平台之一、而非主战场**：Hook 依赖平台的「会话生命周期事件」机制（`agent:bootstrap`），只有 OpenClaw 暴露了这个事件。它保证「先有规则、后有执行、再有审计」在 OpenClaw 上完整——但当 DSH 成为默认执行后端后，sofagent 自建执行链路里的逐调用约束才是覆盖所有场景的完整形态。

**没有 Hook 的平台怎么办**：靠 Skill 自觉加载约束（软），提交时仍被 git hook + 审计模块拦截（硬）——约束是建议性的，审计是强制性的。

---

## 为什么要有约束注入（不只是 OpenClaw）

1. **约束要生效，第一步是把规则塞进 Agent 上下文**——Skill 是「平台给了、Agent 自觉读」，Hook / DSH 事件是「触发即注入、框架保证」。没有强注入，约束只剩自觉。
2. **审计需要对照物**——审计审「Agent 有没有遵守规则」，规则没注入就没有对照。注入保证「先有规则、后有执行、再有审计」的链条完整。
3. **进化需要数据入口**——L2 think.md（反思区）注入是知识资产回流的起点。每次会话/步骤注入 think.md，Agent 才有反思锚点。
4. **它是五能力（注入·审计·回溯·沉淀·进化）里「注入」的实现**——没有它，sofagent 不是完整产品。
