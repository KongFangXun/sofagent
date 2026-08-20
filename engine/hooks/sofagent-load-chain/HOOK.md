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

## Hook 的平台边界（谁生效、谁不生效）

**本 Hook 只服务 OpenClaw 平台**——由 `agent:bootstrap` 事件触发，`install.sh --platform openclaw` 时部署到 `~/.openclaw/hooks/sofagent-load-chain/`。

| 平台 | Hook 注入 | 约束注入方式 | 强度 |
|---|---|---|---|
| **OpenClaw** | ✅（`agent:bootstrap` 事件强制触发） | Hook 注入（core-rules + role-* + think.md + fde.md） | **强制**（平台保证每次会话注入） |
| **WorkBuddy** | ❌ 无 Hook | Skill 自觉加载（SKILL.md 随调用注入） | 自觉（软约束） |
| **Codex** | ❌ 无 Hook | Skill 自觉加载 | 自觉（软约束） |
| **Claude** | ❌ 无 Hook | `~/.claude/fde.md` + Skill 自觉加载 | 自觉（软约束） |
| **自建 Agent（npm API）** | ❌ 无 Hook | `@sofagent/harness` 的 `buildConstrainedSystemPrompt` 代码级拼入 | **强制**（代码保证） |

**为什么只服务 OpenClaw**：Hook 依赖平台的「会话生命周期事件」机制（`agent:bootstrap`），只有 OpenClaw 暴露了这个事件。WorkBuddy / Codex / Claude 没有等价的平台级事件，无法用 Hook 强制注入。

**没有 Hook 的地方怎么办**：约束注入强度随平台递减，但**审计引擎（git diff 24 规则）在所有平台一样硬**——约束是建议性的，审计是强制性的。WorkBuddy / Codex / Claude 靠 Skill 自觉加载约束，提交时仍被 git hook + 审计引擎拦截。

---

## 为什么要有 Hook（只服务 OpenClaw 的意义）

Hook 是约束层「注入」能力在 OpenClaw 上的**唯一强制形态**，不是可有可无：

1. **约束要生效，第一步是把规则塞进 Agent 上下文**——Skill 是「平台给了、Agent 自觉读」，Hook 是「事件触发、平台保证塞进 bootstrap」。没有 Hook，OpenClaw 上没有「强制约束」，只剩自觉。
2. **审计需要对照物**——审计审「Agent 有没有遵守规则」，规则没注入就没有对照。Hook 保证「先有规则、后有执行、再有审计」在 OpenClaw 上完整。
3. **进化需要数据入口**——L2 think.md（反思区）注入是「经验沉淀」回流的起点。每次 bootstrap 注入 think.md，Agent 才有反思锚点。
4. **它是四能力（注入·审计·回溯·进化）里「注入」的旗舰实现**——没有它，OpenClaw 上的 sofagent 不是完整产品。

一句话：**约束注入的强度随平台递减（OpenClaw 强制 → 其他平台自觉），但审计引擎在所有平台一样硬**——Hook 保证「先有规则、后有执行、再有审计」这条链在 OpenClaw 上完整。

---

## 前瞻：DeepSeek Harness（DSH）的 Hook 接入点

DSH（DeepSeek Harness，2026 开源）原生支持**8 个生命周期 hook，全部为瀑布流（Waterfall）可拦截**——比 OpenClaw 的 `agent:bootstrap`（会话开始注入一次）细得多，是**每次工具调用都能拦**：

| DSH Hook | 时机 | 与 sofagent 的对接 |
|---|---|---|
| `agent/pre-step` | 模型看到输入前 | 约束注入（role-* 按任务类型） |
| `agent/request` | 模型请求发出前 | 请求审查 |
| `agent/request-error` | 请求失败后 | 重试/降级策略 |
| `agent/turn-stopping` | Turn 结束前 | 停止条件判定 |
| `tools/pre-execute` | **工具执行前** | **审计引擎接入点（A2 密钥 / A9 注入拦截）** |
| `tools/execute` | 工具执行 | 计时 / 成本计量 |
| `tools/post-execute` | 工具执行后 | 结果质检 |
| `tools/result` | 最终结果确定 | 审计留证（history.jsonl） |

**现状**：DSH 已通过 `ExecutionBackend` 接入编排层（`execution-backends/dsh-backend.ts`），但约束注入尚未挂到 DSH 的 hook 上——这是「注入能力」从 OpenClaw bootstrap 扩展到「每次工具调用」的天然升级路径。

**未来**：当 DSH 成为默认执行后端（v1.3.9 起），`tools/pre-execute` 是审计引擎从「提交时审计」升级为「运行时审计」的落点——节点级审计（§2.6 前瞻）将在这里实现。
