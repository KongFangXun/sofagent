# LOOP — 自迭代开发循环（实验性）

> ⚠️ 实验性。这是 sofagent 用自己的工具开发自己的自迭代方案。任何人都可以 fork、修改、替换 loop 里的任何东西——这是一个开放的实验场。
>
> Agent 定义在 [`agents/`](../agents/) 下，遵循 [Agency Agents](https://github.com/jnMetaCode/agency-agents-zh) 格式标准。`LOOP/` 只是编排文档，不放 Agent 定义。

## 一句话（内层循环）

**minimal-change-engineer 写代码 → sofagent-audit 硬证据审计 → code-reviewer 代码审查 → 人类确认 → 下一轮。** 

## 一句话（外层循环）

**forward-deployed-engineer 持续监督这个流程 → compliance-auditor 定期巡检 → 发现问题 → 优化 Agent 定义 → 内层循环自动升级。**

## 核心理念

sofagent 的开发过程本身就是一个复杂的多 Agent 协作场景。我们有标准化的 Agent 定义（`agents/`），有 git diff 硬证据审计引擎（`sofagent-audit`）。LOOP 就是把这些已有的工具串联起来，让开发过程从"人驱动"变成"Agent 驱动 + 人监督"。

## 4 个 Agent 在 LOOP 中的角色

| Agent | 文件 | 在 LOOP 中的角色 |
|-------|------|------|
| **minimal-change-engineer** | `agents/engineering-minimal-change-engineer.md` | 内层执行者：写代码、跑测试、提交 |
| **code-reviewer** | `agents/engineering-code-reviewer.md` | 内层审查者：语义审查、影响分析、质量评估 |
| **forward-deployed-engineer** | `agents/forward-deployed-engineer.md` | 外层监督者：监控 LOOP 健康度、优化 Agent 定义、调整审计规则 |
| **compliance-auditor** | `agents/security-compliance-auditor.md` | 外层巡检者：定期 Workflow 巡检、跨仓库一致性审计、知识库健康度检查 |

### 为什么需要外层循环

内层循环（coding → review → human）跑的是**每一次任务**。但谁来看这个循环本身跑得好不好？

- minimal-change-engineer 在重复犯同一类错误 → 谁发现、谁改它的 Agent 定义文件？
- code-reviewer 的审查质量在下降 → 谁发现、谁调整它的审查维度？
- 审计规则需要新增或调整 → 谁来做？

**forward-deployed-engineer 干这三件事。** 它不是每次任务都介入——它定期看 think.md 的反思记录、看 sofagent-audit 的拦截统计、看 code-reviewer 的审查报告趋势。发现模式后，优化 Agent 定义或调整审计规则，内层循环自动升级。

## 安装

LOOP 是独立 Skill，**不会随 sofagent 主项目自动安装**。三者独立安装，按需选用：

| 组件 | 安装方式 | 必装？ |
|------|------|:--:|
| sofagent 底座 | `sofagent/scripts/install.sh` | ✅ 必装 |
| FDE 工具包 | `FDE/fde-install.sh` | ⚠️ 外层循环需要 |
| LOOP | `LOOP/loop-install.sh` | ⚠️ 需要自迭代时装 |

```bash
bash LOOP/loop-install.sh --platform openclaw
```

## 当前状态

- ✅ 4 个 Agent 定义完成（`agents/` 下）
- ✅ 内层循环设计完成（`LOOP.md`）
- ✅ 外层循环设计完成（本文件）
- ⬜ OpenClaw `session.spawn` 对接验证
- ⬜ [DeepAgentsJS](https://github.com/langchain-ai/deepagentsjs) `createDeepAgent()` 集成
- ⬜ LangGraph StateGraph 编排层
- ⬜ 端到端自迭代跑通

## 验证文档

LOOP 集成了 sofagent 现有的 5 份验证文档，由 Agent 在对应阶段自动调用。每次发版后，外层循环会自动推进这些文件的进化（新增检查项、更新视角、追加测试场景）。

| 文档 | 在 LOOP 中的角色 | 谁执行 | 每次发版后进化 |
|------|------|------|:--:|
| `docs/verification/fresh-eyes-review.md` | 发版前后陌生视角审查 | review-agent（全新 session） | ✅ 新增视角/任务/攻击面 |
| `docs/verification/regression-checklist.md` | 发版前全局回归检查（176 维度） | FDE 触发 compliance-auditor | ✅ 追加新检查项 |
| `docs/verification/openclaw-acceptance-test.md` | 发版前 Agent 端到端验收（5 场景） | review-agent | ✅ 新增测试场景 |
| `tools/acceptance-test.sh` | 发版前 CLI 端到端验收（11 场景） | minimal-change-engineer 自检 | ✅ 新增验收场景 |
| `docs/verification/releasing.md` | LOOP 整体流程参照（8 阶段 SOP） | FDE（流程监督者） | ✅ 沉淀教训 + 更新过期数字 + 纳入新工具 |

## 如何使用

### 一键触发整套 LOOP

sofagent 安装后自带 OpenClaw 底座。你可以在任何 Agent 平台（WorkBuddy / Codex / Claude Code / Hermes / Cursor）中，用一条 prompt 触发整套 LOOP：

```
@openclaw 启动 LOOP 自迭代循环：修复 issue #123 并审查
```

这条 prompt 的背后：

```
你的 Agent（WorkBuddy/Codex/Claude Code/Hermes/Cursor）
  → 发送指令给 OpenClaw（sofagent 底座）
    → OpenClaw 按 LOOP/LOOP.md 定义的流程自动调度：
      → engineering-minimal-change-engineer（写代码 + 跑测试 + 提交）
      → sofagent-audit（commit-msg hook 硬证据审计）
      → engineering-code-reviewer（代码审查）
      → 审查报告返回给你确认
    → 你确认 → git push → 下一轮
```

**你只下任务，OpenClaw 调度所有 sub-agent。你只看到最终的审查报告——确认 or 驳回。**

不装 OpenClaw？同样可以手动分步触发：

### 手动触发（分步）

内层循环——日常开发：

```
openclaw session spawn --agent engineering-minimal-change-engineer --task "修 README 里的 typo"
openclaw session spawn --agent engineering-code-reviewer --task "审查最近一次提交"
```

外层循环——定期监督优化：

```
openclaw session spawn --agent security-compliance-auditor --task "本周 Workflow 巡检"
openclaw session spawn --agent forward-deployed-engineer --task "分析本月 think.md 反思趋势，优化 Agent 定义"
```

## 欢迎修改

这个文件夹里的东西都不成熟。如果你有更好的方案——不同的 Agent 分工、不同的 Workflow 结构、更高效的迭代方式——直接改，然后提 PR。

## 文件

| 文件 | 内容 |
|------|------|
| `README.md` | LOOP 概述：一键触发 + 4 Agent 角色 + 5 验证文档 |
| `LOOP.md` | 完整设计：内外层循环 + 防线 + releasing.md 映射 + DeepAgentsJS 计划 |
| `verification/` | 3 份审查文档（fresh-eyes-review + regression-checklist + openclaw-acceptance-test） |
