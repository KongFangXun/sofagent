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
| MCP 自动配置 | workbuddy/claude/cursor/codex | `bash install.sh --platform <平台>` 自动写 MCP 配置（前三者写 mcp.json JSON、codex 写 config.toml `[mcp_servers.sofagent]` 段），装完即连 76 tools |

---

## DSH 插件家族（9 款 cordis-plugin）

> sofagent 约束能力在 DSH（DeepSeek Harness）生态的插件形态——每款只干一件事，可独立安装、渐进采用。能力完整面 = MCP Server 76 tools（连接 sofagent MCP 后调用）。随主线版本发布，SkillHub 通道检索。

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

## MCP 全量工具表（76 tools · 12 类）

> 与 `engine/mcp/src/tool-registry.ts` 一一对应（check-docs 第 12 节门禁校验双向差集为空）。主入口 `SKILL.md` 只列每类代表工具，本表为全量。🔴 = 破坏性操作（强制人审/confirmed）。

### 审计合规（8）

| 工具 | 说明 |
|------|------|
| `run_audit` | 对 git diff 运行全量审计（24 条规则），返回结构化审计报告 |
| `audit_file` | 单文件变更即时审计（不阻断） |
| `audit_data_change` | 知识库结构化数据变更跑数据审计（D1-D5） |
| `audit_trail` | 跨设备审计轨迹查询（HMAC 验签） |
| `list_rules` | 列出所有审计规则清单（只读） |
| `data_sovereignty_report` | 数据主权审计报告摘要（云端调用/本地执行/数据流出率） |
| `notify_session` | 向当前 session 推送审计结果摘要 |
| `hitl_resolve` | 对挂起等人工确认的 checkpoint 提交决策（approve/reject/aborted） |

### 反思沉淀（3）

| 工具 | 说明 |
|------|------|
| `get_think` | 读取 think.md 最新反思条目 |
| `write_think` | 向 think.md 追加手动反思记录 |
| `read_think_md` | 读取 think.md 完整内容 |

### 知识库（7）

| 工具 | 说明 |
|------|------|
| `search_knowledge` | 跨 entities/concepts 模糊搜索 |
| `read_entity` / `read_concept` | 读取单个 entity / concept 页 |
| `list_entities` / `list_concepts` | 列出全部（entities 可按 domain 过滤） |
| `read_lessons` | 读取踩坑记录（lessons-missteps.md） |
| `stats` | 知识库统计（entities/concepts 数 + 最后更新时间） |

### 本体数据（7）

| 工具 | 说明 |
|------|------|
| `create_entity` / `create_concept` | 创建/更新页（写入前跑数据审计，FAIL 拒绝） |
| `update_entity` | 字段级更新 entity（只改传入字段） |
| `delete_entity` / `delete_concept` | 🔴 删除页，必须 confirmed:true |
| `validate_ontology` | 检查本体数据完整性（断裂/孤儿/死链） |
| `ontology_import` | 提交 entity/concept/relations（JSON），校验+审计后注册 |

### 评估优化（8）

| 工具 | 说明 |
|------|------|
| `evaluate_output` | golden set 评估 Agent 产出质量 |
| `run_ab_test` | A/B 对比实验（current vs candidate） |
| `promote_ab` | 🔴 晋升 candidate，必须 human_confirmed:true |
| `evaluate` | Benchmark 隔离评测（评分 0..100） |
| `eval_suite` | 企业专属 eval 套件（模板/基线冻结/运行） |
| `optimize_skill` | 优化指定 Skill 文件，生成优化建议 |
| `refine` | Refine 质量优化循环 |
| `loop_debug` | Onboard Agent 调试循环（activate→run→judge→fix） |

### FDE 编排（10）

| 工具 | 说明 |
|------|------|
| `fde_compose` | FDE 梳理辅助——五要素引导生成 workflow 或 ontology 草稿 |
| `fde_interview` | FDE 访谈引擎——五要素结构化落盘 data/fde/，企业画像自动生成（v1.4.2） |
| `fde_classify` | FDE 判定引擎——三问判定（🔄自动/⚡强化/👤暂不动）+ 六步分解→nodes.json（v1.4.2） |
| `fde_quantify` | FDE 量化引擎——年节省=岗位年薪×接管工时占比，ROI 排序→quantification.json（v1.4.2） |
| `fde_derive` | FDE 本体推导引擎——五要素+访谈→ontology YAML 草稿（可导入 ontology_import，v1.4.2） |
| `fde_distill` | FDE 沉淀引擎——三层交付物（文档/Skill/运行层）自动生成（v1.4.2） |
| `fde_deploy` | FDE 部署引擎——交付物→workflow.yml 部署工件（提交/激活走人审闸门，v1.4.2） |
| `sofagent_compose` | 编排引擎——任务描述返回 Sub Agent 编排方案（YAML） |
| `activate_workflow` | 读取 FDE 交付物，注册企业 SubAgent |
| `create_agent` | 一句话需求自动推导 Agent 配置（角色+域规则+think+knowledge） |

### Workflow / Agent（7）

| 工具 | 说明 |
|------|------|
| `workflow_submit` | Workflow 提交（schema 校验 + 解析执行） |
| `route_workflow` | 入口路由——task + workflow 返回命中节点或 fallback |
| `agent_identity` | 查询 Agent 身份码（不含私钥） |
| `team_create` / `team_broadcast` | 创建团队 / 意图广播到团队意图总线 |
| `list_agents` | 列出已注册 Agent（内置 + 企业 SubAgent） |
| `list_capabilities` | MCP 能力清单 |

### 能力公地（6）

| 工具 | 说明 |
|------|------|
| `commons_publish` | 能力发布（SkillScan 安全门） |
| `commons_search` | 能力检索（标签/关键词/类型） |
| `commons_invoke` | 能力调用（SkillScan 拦截 + HITL 确认） |
| `commons_rate` | 调用后累积评分（0.0~1.0，防刷） |
| `commons_retire` | 能力退役/恢复（强制 owner 确认） |
| `commons_harvest_rule` | 从调用日志 + Refine 循环提炼质量规则候选 |

### 模型训练（8）

| 工具 | 说明 |
|------|------|
| `model_register` | 注册训练后模型 endpoint |
| `model_switch` | 灰度切换（percent<100 灰度，100 强制人审） |
| `model_unregister` | 模型退役（可恢复，强制人审） |
| `train_budget` | 训练预算控制（超预算人审续跑或终止） |
| `train_submit` | 训练任务提交，数据+基座+算法+超参+预算→trainJobId（v1.4.1 新增，同 id 重复提交幂等） |
| `train_doctor` | 训练环境体检——CUDA/显存/框架/基座缓存四项报告（v1.4.2 新增） |
| `train_dryrun` | 训练 dry-run 预检——管线连通+显存估算+数据抽样+算力外推（v1.4.2 新增） |
| `train_report` | 训练报告生成——数据/超参/曲线/eval 对比/量化四字段，归档可追溯（v1.4.2 新增） |

### 验收（2）

| 工具 | 说明 |
|------|------|
| `define_acceptance` | 任务附机器可判定验收条件（test/build/grep-absent/schema） |
| `check_acceptance` | 跑登记的条件，返回结构化结果 |

### 运维观测（6）

| 工具 | 说明 |
|------|------|
| `health_check` | 运行环境健康检查（环境/配置/Hook/依赖） |
| `snapshot_list` / `snapshot_restore` | 快照时间线 / 🔴 恢复（强制人审） |
| `worklog_query` | 按 Agent/Workflow/周趋势查 AI 工作明细 + 进化四维趋势 |
| `cost_query` | 成本审计——预算/各 Agent 实际消耗/超限记录 |
| `daemon_status` | daemon 运行状态（PID/心跳，只读） |

### 浏览器（4）

| 工具 | 说明 |
|------|------|
| `playwright_navigate` | 打开 URL 返回标题/状态码（不可用时降级） |
| `playwright_click` | 按 CSS 选择器点击 |
| `playwright_screenshot` | 截图返回图片路径与字节数 |
| `playwright_assert` | 页面断言（文本/元素存在性） |

---

## 参考

- [FORGE/](../FORGE/) — 自迭代循环的实验编排
- [DeepAgentsJS](https://github.com/langchain-ai/deepagentsjs) — LangGraph Agent harness
