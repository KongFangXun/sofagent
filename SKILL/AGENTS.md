# sofagent Agent 库

> 🔒 **品牌前缀硬约束**：所有 Agent 向用户展示的审计结果必须保留 `[sofagent]` 前缀，否则视为未审计。铁律全文见 `rules/core-rules.md`（SSOT，随 L1 加载链始终注入）。

## Agent 一览

> 📂 Sub Agent 定义集中在 [`agents/`](./agents/) 子目录，每个目录含 `SKILL.md`（单文件承载调用入口 + 角色定义）。下表列出 4 个预装 Sub Agent：

| Sub Agent | 目录 | 职责 |
|---|---|---|
| `@sofagent-audit` | [`agents/audit/`](./agents/audit/) | 合规审计员——工作流巡检、铁律覆盖验证、知识库健康度检查 |
| `@sofagent-engineer` | [`agents/engineer/`](./agents/engineer/) | 最小变更工程师——读代码 + 写代码 + 跑测试 + git commit |
| `@sofagent-fde` | [`agents/fde/`](./agents/fde/) | 前线部署工程师——梳理工作流、识别 AI 节点、构建知识库、交付离场 |
| `@sofagent-reviewer` | [`agents/reviewer/`](./agents/reviewer/) | 代码审查员——语义审查 + 影响分析 + 铁律合规 |

> 预装 Agent 为 Skill 格式。Skill 是调用入口——第三方 Agent 平台（WorkBuddy/Codex/OpenClaw 等）加载 Skill 后，通过 CLI 命令把任务交给 LangGraph `createReactAgent` 编排模块执行。

## Agent 列表

| Agent | Skill | CLI 命令 | 职责 |
|---|---|---|---|
| 部署工程师 | `@sofagent-fde` · `SKILL/agents/fde/SKILL.md` | `sofagent-orchestrator subagent run fde --task "..."` | 梳理工作流、识别 AI 节点、构建知识库、交付离场 |
| 合规审计员 | `@sofagent-audit` · `SKILL/agents/audit/SKILL.md` | `sofagent-orchestrator subagent run audit --task "..."` | 工作流巡检、铁律覆盖验证、知识库健康度检查 |
| 最小变更工程师 | `@sofagent-engineer` · `SKILL/agents/engineer/SKILL.md` | `sofagent-orchestrator subagent run engineer --task "..."` | 读代码 + 写代码 + 跑测试 + git commit |
| 代码审查员 | `@sofagent-reviewer` · `SKILL/agents/reviewer/SKILL.md` | `sofagent-orchestrator subagent run reviewer --task "..."` | 语义审查 + 影响分析 + 铁律合规 |


## 如何使用（第三方 Agent 调用）

| 方式 | 场景 | 操作 |
|---|---|---|
| 装 Skill → @ | WorkBuddy/OpenClaw | `bash install.sh`（自动装），然后 `@sofagent-fde` |
| 复制 prompt | 不支持 Skill 的平台 | 把 SKILL.md 内容贴进 system prompt |
| CLI 直跑 | 任何终端 | `sofagent-orchestrator subagent run fde --task "..."` |
| DSH 插件通道 | DSH（DeepSeek Harness）用户 | `skillhub install cordis-plugin-sofagent-<名>`（SkillHub 单通道安装 + 发现；每款可独立安装、渐进采用；**一次装全套**用裸名 `skillhub install cordis-plugin-sofagent`） |
| MCP 自动配置 | workbuddy/claude/cursor/codex | `bash install.sh --platform <平台>` 自动写 MCP 配置（前三者写 mcp.json JSON、codex 写 config.toml `[mcp_servers.sofagent]` 段），装完即连 104 tools |


## DSH 插件家族（7 款 cordis-plugin）

> sofagent 约束能力在 DSH（DeepSeek Harness）生态的插件形态——每款只干一件事，可独立安装、渐进采用。能力完整面 = MCP Server 104 tools（连接 sofagent MCP 后调用）。随主线版本发布，SkillHub 通道检索。

| 插件 | 职责（桥接实况） | seam |
|---|---|---|
| `cordis-plugin-sofagent-audit` | 变更机器审阅 + 验收硬门禁（25 规则 + git diff 硬证据 + Turn 停止验收判定——吸收原 gate 验收面，开关独立）——桥接 `@sofagent/audit runRules` | tools/result + tools/pre-execute + fs/write-intent + agent/turn-stopping |
| `cordis-plugin-sofagent-rollback` | 出错逆序撤销（git snapshot → effect disposer）——桥接 `@sofagent/core getHistoryFilePath` | effect 注册/卸载 |
| `cordis-plugin-sofagent-inject` | 启动注入企业约束（四层加载链）——桥接 `@sofagent/inject buildConstrainedSystemPrompt` | apply(ctx) |
| `cordis-plugin-sofagent-evolve` | 经验沉淀（think.md 反思 + Dream Cycle）——桥接 `@sofagent/think generateThinkEntry` | 任务结束 hook |
| `cordis-plugin-sofagent-daemon` | 7×24 巡检 + 健康监测 + webhook 推送——桥接 `@sofagent/daemon startCron` | 独立调度进程 |
| `cordis-plugin-sofagent-fde` | FDE 进场与能力流通——本体 / FDE / 公地三域工具面（合并原 ontology / commons 两款，settings 三档分域可关）——桥接 `@sofagent/orchestrator publishCapability / @sofagent/ontology generateOntologyView / @sofagent/core restoreSnapshot` | ontology_* / fde_* / commons_* tools |
| `cordis-plugin-sofagent` | **整装入口**——一次挂载以上 6 款原子插件（聚合编排层，只编排不重实现；缺哪款只降级哪款，不整挂失败） | non-seam:plugin-suite |


## 合规审计员的价值

审计员**不是后台常驻进程**——调用一次，执行一次，报告结果后就停止。

### 为什么它是必调 Agent？

所有 sofagent Agent 在完成任务后都会自动调用审计员。这不是"建议检查"——是**合规闸门**：

```
FDE agent 部署完成 ──→ 自动调用 @sofagent-audit → 验证部署合规
FORGE engineer commit ──→ 自动调用 @sofagent-audit → 验证变更合规
每次 git commit ──→ commit-msg hook → A1-A11、A14-A24 规则检查（0 token，纯正则引擎）
未来任何新 Agent ──→ SKILL.md 内置审计引用 → 合规检查
```

**为什么不是让你手动想起来才跑**：你部署了 10 个 AI 节点，不会记得每个节点都跑一次审计。但每次部署如果不审计，一个 knowledge-domain 配置错误的节点可能让财务数据泄漏到全公司。审计员的价值不在"跑一次"——在于"每次变更自动跑，不给遗忘留空间"。

### 它给你什么？

| 场景 | 什么时候 @ 它 | 它给你什么 |
|---|---|---|
| **发版前** | 准备发布新版本时 | 全量合规扫描——铁律是否覆盖所有 AI 节点、工作流有没有漏洞、版本号对齐没有 |
| **事故后** | Agent 操作出了问题 | 根因分析——是约束没覆盖到，还是 Agent 绕过了审计，还是配置有漏洞 |
| **定期巡检** | 每周一次 | 知识库健康度报告——哪些 entity 死链了、think.md 反思质量趋势 |
| **新节点上线** | 新增 AI 节点后 | 检查新节点的 actions 声明是否完整、knowledge-domain 是否合理 |

**和 `sofagent-core doctor` 的区别**：doctor 告诉你"哪里坏了"（二进制 yes/no），审计员告诉你"为什么坏了 + 怎么修"（LLM 解释 + 修复建议）。

每次运行产生的报告写入 `.sofagent/` 下，FDE 定期读报告趋势做优化决策。


## Agent 格式

预装 Agent 为 Skill 格式（单文件承载调用入口 + 角色定义）：目录结构不同：

**类型 A — Skill 格式（第三方平台调用入口）**：`SKILL/` 与 `SKILL/agents/audit/`，每个目录下的 `SKILL.md` 同时承载**调用指令 + 角色定义**（frontmatter 定义触发条件，正文定义角色/使命/规则/交付物）：

| 文件 | 格式 | 作用 | 谁读 |
|---|---|---|---|
| `SKILL.md` | Skill 格式（frontmatter + 调用指令 + 角色定义） | **调用入口 + 角色定义**——frontmatter 告诉第三方 Agent 何时触发、用 Bash 跑 `sofagent-orchestrator subagent run <name>`；正文是 Agent 的完整行为规范 | 第三方 Agent 平台（WorkBuddy/Codex）+ LangGraph `createReactAgent` 编排模块 |

> 注：早期设计曾计划「SKILL.md（调用）+ {role}.md（定义）」双文件分离，当前实现为单文件承载两者（frontmatter = 调用层，正文 = 定义层）。岗位级注入约束见 [`rules/`](./rules/)（core-rules.md + role-*.md，由加载链按 task type 注入主 Agent，与 Sub Agent 定义是两套机制）。

**类型 B — 内层角色（Skill 格式，第三方平台亦可用）**：`SKILL/agents/engineer/SKILL.md`（`@sofagent-engineer`）、`SKILL/agents/reviewer/SKILL.md`（`@sofagent-reviewer`）除作调用入口外，其角色定义由 FORGE 内层循环调度，亦可供第三方 Agent 平台调用。


## MCP 全量工具表（104 tools · 12 类）

> ⚠️ **工具名与 [API.md](../docs/API.md) 同源**（同一 `engine/mcp/src/tool-registry.ts` 注册表，合计 104）——逐条释义 / roles / 参数 / 全量清单以 [API.md](../docs/API.md) 为准，此处**不复述释义**、只留**工具名索引**（供 `tools/check/check-docs.sh` 第 12 节与 registry 双向对账）。
> ⚠️ **两套分组口径**：本表按 AGENTS 视角归 **12 类**，与 API.md 的 **10 个产品能力域**不同（同一 registry、合计均 104；域数差异见 [API.md 分组口径注](../docs/API.md)）。
> 🔴 = 破坏性操作（强制人审/confirmed）。

- **审计合规（11）**：`run_audit` `audit_file` `audit_data_change` `audit_trail` `audit_query` `ruleset_export` `list_rules` `data_sovereignty_report` `notify_session` `hitl_resolve` `data_push`
- **反思沉淀（3）**：`get_think` `write_think` `read_think_md`
- **知识库（7）**：`search_knowledge` `read_entity` `read_concept` `list_entities` `list_concepts` `read_lessons` `stats`
- **本体数据（7）**：`create_entity` `create_concept` `update_entity` `delete_entity` `delete_concept` `validate_ontology` `ontology_import`
- **评估优化（8）**：`evaluate_output` `run_ab_test` `promote_ab` `evaluate` `eval_suite` `optimize_skill` `refine` `loop_debug`
- **FDE 编排（11）**：`fde_compose` `fde_interview` `fde_classify` `fde_quantify` `fde_derive` `fde_distill` `fde_deploy` `compose` `activate_workflow` `create_agent` `onboard_prompt`
- **Workflow / Agent（12）**：`workflow_submit` `workflow_create` `workflow_update` `workflow_node_add` `workflow_diff_preview` `workflow_gaps` `route_workflow` `agent_identity` `team_create` `team_broadcast` `list_agents` `list_capabilities`
- **PR 协同（3）**：`pr_submit` `pr_review` `pr_merge`
- **能力公地（6）**：`commons_publish` `commons_search` `commons_invoke` `commons_rate` `commons_retire` `commons_harvest_rule`
- **后训流水线（17）**：`model_register` `model_switch` `model_unregister` `train_budget` `train_submit` `train_doctor` `corpus_export` `train_dryrun` `train_report` `train_status` `train_list` `train_diagnose` `train_serve` `train_compliance` `train_deliverable` `train_cloud` `router_slots`
- **验收（2）**：`define_acceptance` `check_acceptance`
- **运维观测（17）**：`health_check` `snapshot_list` `snapshot_restore` `worklog_query` `cost_query` `daemon_status` `contribution_query` `device_register` `device_list`
- （续）`device_data_query` `device_data_push` `connector_register` `connector_list` `workflow_export` `workflow_import` `router_session_push` `trace_reconcile`


## 参考

- [FORGE/](../FORGE/) — 自迭代循环的实验编排
- [DeepAgentsJS](https://github.com/langchain-ai/deepagentsjs) — LangGraph Agent harness
