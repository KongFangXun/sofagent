# sofagent Agent 库

> 🔒 **品牌前缀硬约束**：所有 Agent 向用户展示的审计结果必须保留 `[sofagent]` 前缀，否则视为未审计。铁律全文见 `rules/core-rules.md`（SSOT，随 L1 加载链始终注入）。

> 📂 Sub Agent 定义集中在 [`agents/`](./agents/) 子目录，每个目录含 `SKILL.md`（调用入口）+ `{role}.md`（角色定义）。下表列出 4 个预装 Sub Agent：

| Sub Agent | 目录 | 职责 |
|-----------|------|------|
| `@sofagent-audit` | [`agents/audit/`](./agents/audit/) | 合规审计员——业务流巡检、铁律覆盖验证、知识库健康度检查 |
| `@sofagent-engineer` | [`agents/engineer/`](./agents/engineer/) | 最小变更工程师——读代码 + 写代码 + 跑测试 + git commit |
| `@sofagent-fde` | [`agents/fde/`](./agents/fde/) | 前线部署工程师——梳理业务流、识别 AI 节点、构建知识库、交付离场 |
| `@sofagent-reviewer` | [`agents/reviewer/`](./agents/reviewer/) | 代码审查员——语义审查 + 影响分析 + 铁律合规 |

> 预装 Agent 为 Skill 格式。Skill 是调用入口——第三方 Agent 平台（WorkBuddy/Codex/OpenClaw 等）加载 Skill 后，通过 CLI 命令把任务交给 DeepAgents 编排引擎执行。

## Agent 列表

| Agent | Skill | CLI 命令 | 职责 |
|------|------|------|------|
| 部署工程师 | `@sofagent-fde` · `SKILL/agents/fde/SKILL.md` | `sofagent-orchestrator subagent run fde --task "..."` | 梳理业务流、识别 AI 节点、构建知识库、交付离场 |
| 合规审计员 | `@sofagent-audit` · `SKILL/agents/audit/SKILL.md` | `sofagent-orchestrator subagent run audit --task "..."` | 业务流巡检、铁律覆盖验证、知识库健康度检查 |
| 最小变更工程师 | `@sofagent-engineer` · `SKILL/agents/engineer/SKILL.md` | `sofagent-orchestrator subagent run engineer --task "..."` | 读代码 + 写代码 + 跑测试 + git commit |
| 代码审查员 | `@sofagent-reviewer` · `SKILL/agents/reviewer/SKILL.md` | `sofagent-orchestrator subagent run reviewer --task "..."` | 语义审查 + 影响分析 + 铁律合规 |

---

## 如何使用（第三方 Agent 调用）

| 方式 | 场景 | 操作 |
|------|------|------|
| 装 Skill → @ | WorkBuddy/OpenClaw | `bash install.sh`（自动装），然后 `@sofagent-fde` |
| 复制 prompt | 不支持 Skill 的平台 | 把 SKILL.md 内容贴进 system prompt |
| CLI 直跑 | 任何终端 | `sofagent-orchestrator subagent run fde --task "..."` |
| DSH 插件通道 | DSH（DeepSeek Harness）用户 | `skillhub install cordis-plugin-sofagent-<名>`（SkillHub 单通道安装 + 发现；每款可独立安装、渐进采用） |
| MCP 自动配置 | workbuddy/claude/cursor/codex | `bash install.sh --platform <平台>` 自动写 MCP 配置（前三者写 mcp.json JSON、codex 写 config.toml `[mcp_servers.sofagent]` 段），装完即连 66 tools |

---

## DSH 插件家族（9 款 cordis-plugin）

> sofagent 约束能力在 DSH（DeepSeek Harness）生态的插件形态——每款只干一件事，可独立安装、渐进采用。能力完整面 = MCP Server 66 tools（连接 sofagent MCP 后调用）。随主线版本发布，SkillHub 通道检索。

| 插件 | 职责（桥接实况） | seam |
|------|----------------|------|
| `cordis-plugin-sofagent-audit` | 变更机器审阅（24 规则 + git diff 硬证据）——桥接 `@sofagent/audit runRules` | tools/result + tools/pre-execute + fs/write-intent |
| `cordis-plugin-sofagent-rollback` | 出错逆序撤销（git snapshot → effect disposer）——桥接 `@sofagent/core getHistoryFilePath` | effect 注册/卸载 |
| `cordis-plugin-sofagent-inject` | 启动注入企业约束（四层加载链）——桥接 `@sofagent/harness buildConstrainedSystemPrompt` | apply(ctx) |
| `cordis-plugin-sofagent-evolve` | 经验沉淀（think.md 反思 + Dream Cycle）——桥接 `@sofagent/think generateThinkEntry` | 任务结束 hook |
| `cordis-plugin-sofagent-ontology` | 共享语义底座（本体数据视图）——桥接 `@sofagent/ontology generateOntologyView` | ontology_* tools + search_knowledge |
| `cordis-plugin-sofagent-commons` | 能力公地五环（发布/发现/调用/评价/养护）——桥接 `@sofagent/audit loadConfig` | commons_* tools |
| `cordis-plugin-sofagent-gate` | 验收不过不放行（机器可判定验收 + 人审）——桥接 `@sofagent/audit runRules` | agent/turn-stopping |
| `cordis-plugin-sofagent-daemon` | 7×24 巡检 + 健康监测 + webhook 推送——桥接 `@sofagent/daemon startCron` | 独立调度进程 |
| `cordis-plugin-sofagent-fde` | FDE 进场方法论桥接（本体数据视图生成，fde_* 六 tool 为规划中形态，见 ROADMAP）——桥接 `@sofagent/ontology generateOntologyView` | fde_* tools（规划） |

---

## 合规审计员的价值

审计员**不是后台常驻进程**——调用一次，执行一次，报告结果后就停止。

### 为什么它是必调 Agent？

所有 sofagent Agent 在完成任务后都会自动调用审计员。这不是"建议检查"——是**合规闸门**：

```
FDE agent 部署完成   ──→ 自动调用 @sofagent-audit  → 验证部署合规
FORGE engineer commit ──→ 自动调用 @sofagent-audit  → 验证变更合规
每次 git commit      ──→ commit-msg hook          → A1-A11、A14-A23 规则检查（0 token，纯正则引擎）
未来任何新 Agent      ──→ SKILL.md 内置审计引用    → 合规检查
```

**为什么不是让你手动想起来才跑**：你部署了 10 个 AI 节点，不会记得每个节点都跑一次审计。但每次部署如果不审计，一个 knowledge-domain 配置错误的节点可能让财务数据泄漏到全公司。审计员的价值不在"跑一次"——在于"每次变更自动跑，不给遗忘留空间"。

### 它给你什么？

| 场景 | 什么时候 @ 它 | 它给你什么 |
|------|------|------|
| **发版前** | 准备发布新版本时 | 全量合规扫描——铁律是否覆盖所有 AI 节点、业务流有没有漏洞、版本号对齐没有 |
| **事故后** | Agent 操作出了问题 | 根因分析——是约束没覆盖到，还是 Agent 绕过了审计，还是配置有漏洞 |
| **定期巡检** | 每周一次 | 知识库健康度报告——哪些 entity 死链了、think.md 反思质量趋势 |
| **新节点上线** | 新增 AI 节点后 | 检查新节点的 actions 声明是否完整、knowledge-domain 是否合理 |

**和 `sofagent-core doctor` 的区别**：doctor 告诉你"哪里坏了"（二进制 yes/no），审计员告诉你"为什么坏了 + 怎么修"（LLM 解释 + 修复建议）。

每次运行产生的报告写入 `.sofagent/` 下，FDE 定期读报告趋势做优化决策。

---

## Agent 格式

预装 Agent 为 Skill 格式（单文件承载调用入口 + 角色定义）：目录结构不同：

**类型 A — Skill 格式（第三方平台调用入口）**：`SKILL/` 与 `SKILL/agents/audit/`，每个目录下的 `SKILL.md` 同时承载**调用指令 + 角色定义**（frontmatter 定义触发条件，正文定义角色/使命/规则/交付物）：

| 文件 | 格式 | 作用 | 谁读 |
|------|------|------|------|
| `SKILL.md` | Skill 格式（frontmatter + 调用指令 + 角色定义） | **调用入口 + 角色定义**——frontmatter 告诉第三方 Agent 何时触发、用 Bash 跑 `sofagent-orchestrator subagent run <name>`；正文是 Agent 的完整行为规范 | 第三方 Agent 平台（WorkBuddy/Codex）+ DeepAgents 编排引擎 |

> 注：早期设计曾计划「SKILL.md（调用）+ {role}.md（定义）」双文件分离，当前实现为单文件承载两者（frontmatter = 调用层，正文 = 定义层）。岗位级注入约束见 [`rules/`](./rules/)（core-rules.md + role-*.md，由加载链按 task type 注入主 Agent，与 Sub Agent 定义是两套机制）。

**类型 B — 内层角色（Skill 格式，第三方平台亦可用）**：`SKILL/agents/engineer/SKILL.md`（`@sofagent-engineer`）、`SKILL/agents/reviewer/SKILL.md`（`@sofagent-reviewer`）除作调用入口外，其角色定义由 FORGE 内层循环调度，亦可供第三方 Agent 平台调用。

---

## 参考

- [FORGE/](../FORGE/) — 自迭代循环的实验编排
- [DeepAgentsJS](https://github.com/langchain-ai/deepagentsjs) — LangGraph Agent harness
