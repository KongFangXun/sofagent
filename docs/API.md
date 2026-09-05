# 接口总览 · API

> sofagent 对外全部能力面的一站式清单——六大接口面 + MCP 83 tools 按域分组。工具清单由 `engine/mcp/src/tool-registry.ts` 生成（scripts/check 门禁对账，文档与代码永不漂移）。
>
> 版本：v1.4.4 · 83 tools / 6 面

---

## 一、六大接口面

| # | 接口面 | 入口 | 认证 | 典型用途 |
|---|--------|------|------|---------|
| 1 | **MCP tools** | stdio MCP server（install.sh 自动配置） | 本地进程（无需凭证） | Agent 调用审计/编排/训练/治理全部能力 |
| 2 | **npm CLI** | `sofagent-audit` 等二进制 | 本地 | git hook / CI / 人工调用审计 |
| 3 | **git hook** | `sofagent-audit --install-hook` | git 本地 | 提交前自动审计（24 条规则 + HMAC 链） |
| 4 | **平台挂载** | GEMINI.md / .cursor/rules/sofagent.mdc / AGENTS.md | 平台加载链 | 平台 AI 助手直接引用约束 |
| 5 | **Skill 分发** | ClawHub（`clawhub skill publish`）/ SkillHub | 平台账号 | SKILL/ 目录规则资产发布更新 |
| 6 | **Webhook 推送** | 飞书/钉钉/企微 webhook URL | 签名 | 审计结果 PASS/WARN/FAIL 三态推送 |

各面详细配置见对应文档：MCP 见 [engine/mcp/README.md](../engine/mcp/README.md) · CLI/hook 见 [SECURITY.md](../SECURITY.md) · 平台挂载见 [AGENTS.md](../AGENTS.md) · Skill 分发见 [SKILL/SKILL.md](../SKILL/SKILL.md) · Webhook 见 [SECURITY.md §审计结果推送](../SECURITY.md)。

---

## 二、MCP 工具清单（83 · 按产品能力域分组）

> 十个能力域按「一个组 = 一个可独立讲述的产品能力」划分，与五能力叙事的对应：本节工具承载其中的**审计**（审计与合规）、**回溯**（快照与回溯）、**沉淀**（知识资产与能力市场）、**进化**（后训练流水线与 FDE 沉淀）能力面；**注入**能力走加载链文件（SKILL.md/fde.md/think.md/knowledge/），不经 MCP 暴露。**roles 列保留运行时真值**——`SOFAGENT_MCP_ROLES=audit,ops` 收窄面以 roles 为准（v1.4.0 工具角色分层），分组是文档编制判断。浏览器四件套（playwright_*）归审计域——主叙事是 UI 层审计取证（v1.5.2 UI 审计的执行底座）。

### FDE 进场 · 六引擎（访谈 → 分类 → 量化 → 推导 → 沉淀 → 部署）（6）

| tool | roles | 说明 |
|---|---|---|
| `fde_interview` | fde | FDE 访谈结构化落盘（引擎一）——五要素逐节点收集，多轮追加按 nodeId 幂等合并，自动重算企业画像（节点数/岗位分布/高频痛点）；prompts_only=true 返回六条追问话术（五要素 + 实际流程）。 |
| `fde_classify` | fde | FDE 三问判定 → 节点方案（引擎二）——classifyAutomation SSOT 判定（🔄自动/⚡强化/👤暂不动）+ 六步分解最小工作单元（GUIDE §3.2）+ executor 映射，落 nodes.json。 |
| `fde_quantify` | fde | FDE 量化四字段 + ROI 排序（引擎三）——年节省=岗位年薪×AI接管工时占比（GUIDE §4.3，与 train_report 同公式同源）；ROI=年节省÷(投入+1) 降序，落 quantification.json（若引擎二已跑自动关联判定标签）。 |
| `fde_derive` | fde | FDE 本体推导（引擎四）——五要素+访谈 → 实体/概念/关系 YAML 草稿；机器初稿人工确认后经 ontology_import 导入；超 10 实体或 5 节点提示 needsFullOntology。 |
| `fde_distill` | fde | FDE 三层交付物生成（引擎五）——跑通过程沉淀：文档层手册（人读：现状/六步/验收/回滚）+ Skill 层模板（Agent 可执行）+ 运行层 yaml 片段（引擎六组装用），归档 deliverables/ 带 README 索引。 |
| `fde_deploy` | fde | FDE workflow 组装部署（引擎六）——三层交付物 → deployments/<name>.yml（与 fde_compose 同格式）；只产出工件不代激活——激活走 workflow_submit + activate_workflow（人审闸门保留）。 |

### 审计与合规（代码 / 轨迹 / 数据审计 · 浏览器取证 · 语料导出）（9）

| tool | roles | 说明 |
|---|---|---|
| `playwright_navigate` | browser | 浏览器导航——打开 URL 并返回页面标题/状态码。Playwright 不可用时降级。 |
| `playwright_click` | browser | 浏览器点击——按 CSS 选择器点击元素。Playwright 不可用时降级。 |
| `playwright_screenshot` | browser | 浏览器截图——截取当前页面，返回图片路径与字节数。 |
| `playwright_assert` | browser | 浏览器断言——对页面执行断言（文本/元素存在性），返回 passed 与详情。 |
| `run_audit` | audit | 对 git diff 运行全量审计（24 条规则），返回结构化审计报告。 |
| `audit_file` | audit | 单文件变更即时审计——Agent 编辑文件时调用，跑单文件适用规则，返回结构化结果（不阻断）。 |
| `audit_data_change` | audit | 对知识库结构化数据变更跑数据审计（D1-D5）。 |
| `audit_trail` | audit | 跨设备审计轨迹查询——按 agent_id 查完整轨迹（HMAC 验签）。 |
| `corpus_export` | ops | 训练语料导出三件套——规则（27 编号位含跳号占位 + reward_hint 骨架 + verifiers 三桶清单）+ FDE 方法论（锚点解析）+ 带标签审计样本（五源聚合 + 脱敏）。导出带版本号 + HMAC 签名，导出行为记 corpus_export 审计事件。 |

### 业务流编排（workflow DAG · 循环执行与优化）（8）

| tool | roles | 说明 |
|---|---|---|
| `sofagent_compose` | fde | 编排引擎——传入任务描述，返回 Sub Agent 编排方案（YAML）。 |
| `optimize_skill` | eval | 优化指定 Skill 文件，生成优化建议。 |
| `activate_workflow` | agent, fde | 读取 FDE 交付物，注册企业 SubAgent。 |
| `loop_debug` | eval | Onboard Agent 调试循环——传 task 触发 activate→run→judge→fix 循环；不传查记录。 |
| `fde_compose` | fde | FDE 梳理辅助——五要素生成 workflow.yml 草稿（workflow-only；ontology 推导走 fde_derive 六引擎主入口）。 |
| `route_workflow` | agent | 入口路由——传 task + workflow 返回命中节点或 fallback。 |
| `refine` | eval | Refine 质量优化循环——针对 Agent 产出做质量优化。 |
| `workflow_submit` | agent | Workflow 提交——schema 校验 + 解析（validate/run）。 |

### Agent 组织与协作（数字员工 · 团队阵型 · HITL 人工介入）（7）

| tool | roles | 说明 |
|---|---|---|
| `notify_session` | audit | 向当前 session 推送审计结果摘要（确保结果可见）。 |
| `list_agents` | fde, agent | 列出已注册的 Agent（内置 + 企业 SubAgent）。 |
| `hitl_resolve` | agent | 对挂起等人工确认的 checkpoint 提交决策（approve/reject/aborted）。 |
| `agent_identity` | agent, fde | 查询 Agent 身份码（查自己或他人，不含私钥）。 |
| `create_agent` | fde | 一句话需求自动推导 Agent 配置（角色+域规则+think+knowledge）。 |
| `team_create` | agent | 创建团队——传 team.yml 文本，解析写入。 |
| `team_broadcast` | agent | 意图广播——Agent 广播「我要做什么」到团队意图总线。 |

### 快照与回溯（状态留档 · 回滚恢复）（2）

| tool | roles | 说明 |
|---|---|---|
| `snapshot_list` | ops | 列出审计快照时间线。只读。 |
| `snapshot_restore` | ops | 恢复工作区到指定快照。🔴 破坏性，必须 human_confirmed:true。 |

### 后训练流水线（数据回流 → 训练 → 模型注册晋升）（14）

| tool | roles | 说明 |
|---|---|---|
| `model_register` | ops | 模型注册——注册训练后模型 endpoint（name+endpoint+model）。 |
| `model_switch` | ops | 模型灰度切换——按档位切换活动模型（percent<100 灰度，100 强制人审）。 |
| `model_unregister` | ops | 模型退役——标记退役（可恢复），强制人审。 |
| `train_budget` | eval, ops | 训练预算控制——查预算状态 / 超预算人审续跑或终止。 |
| `train_submit` | eval, ops | 训练任务提交——数据+基座+算法(sft/dpo/grpo)+超参+预算 → 生成 trainJobId（同 id 重复提交幂等）。 |
| `train_doctor` | eval, ops | 训练环境体检——CUDA/显存/框架版本/基座模型缓存四项 + 反作弊基线三项（git 禁用/.git 可见性/网络白名单）结构化报告（只查不装；装环境走 train env init，基座下载走 model-downloader）。 |
| `train_dryrun` | eval, ops | 训练 dry-run——提交前预检：极小样本管线连通 + 数据质量抽样 + 显存估算（超限提前告警）+ 算力外推（sigmoid 缩放律外推成本，超预算提交前告警）。 |
| `train_report` | eval, ops | 训练报告生成——数据概况+配置+eval对比+产物清单+量化四字段（GUIDE §4.3：年节省=岗位年薪×AI接管工时占比），markdown+JSON 归档 data/dashboard/train-reports/。 |
| `train_status` | eval, ops | 训练进度查询——status/step/loss/reward 曲线/断点/用量快照（长任务轮询入口）。 |
| `train_list` | eval, ops | 训练任务列表——按时间/状态/模型过滤（历史复盘与多任务管理；只列本企业分区任务）。 |
| `train_diagnose` | eval, ops | 训练失败诊断——七类分类（OOM/数据格式/超参发散/框架/环境/重复坍塌/精度异常）+ 上下文四源（日志尾部+环境清单+checkpoint+超参）+ 修复处方，报告落盘 diagnose.json。 |
| `train_deliverable` | eval, ops | FDE 训练交付包——generate 聚合五件（训练配置模板+数据管道配置+eval基线冻结+运维手册+权重清单含回滚点）打 zip + manifest + HMAC 签名；verify 逐项核对完整性 + 环境兼容性（企业收包侧体检）。 |
| `train_serve` | eval, ops | 推理服务生命周期——从权重目录拉起 vLLM/Ollama/OpenAI 兼容端点（/health 就绪探测 + 指数退避重试）+ 启停重启状态四操作；每次启停记 train_serve 审计事件（谁启的/哪个模型/哪个节点）。 |
| `train_compliance` | eval, ops | 训练数据合规扫描——PII（姓名/手机号/身份证）+ 敏感字段（健康/财务）+ 企业专有名词三类风险项（复用 v1.4.4 redactor 红名单检测）；报告（发现项+严重度+处置建议）写训练集版本；严重级发现阻断训练提交；数据来源标记（企业提供/合成/公开语料）。 |

### 评估与验收（基准评测 · 验收标准 · A/B 对比）（7）

| tool | roles | 说明 |
|---|---|---|
| `evaluate_output` | eval | 用 golden set 评估 Agent 产出质量，返回评分 + 失败用例。 |
| `evaluate` | eval | Benchmark 评测——传 benchmark_id 触发隔离评测（评分 0..100）；query 查日志。 |
| `eval_suite` | eval | 企业专属 eval 套件（模板加载/基线冻结/运行/查日志）。 |
| `run_ab_test` | eval | 发起 A/B 对比实验——current vs candidate 在 golden-set 上评测，返回胜出方。 |
| `promote_ab` | eval | 晋升 candidate 为 current。🔴 破坏性，必须 human_confirmed:true。 |
| `define_acceptance` | eval | 验收条件定义——任务附机器可判定验收条件（test/build/grep-absent/schema）。 |
| `check_acceptance` | eval | 验收执行——跑 define_acceptance 登记的条件，返回结构化结果。 |

### 本体数据与知识资产（ontology · 实体概念 · 知识库 · 反思）（16）

| tool | roles | 说明 |
|---|---|---|
| `get_think` | fde, eval | 读取 think.md 的最新反思条目。 |
| `write_think` | fde, eval | 向 think.md 追加一条手动反思记录。 |
| `search_knowledge` | fde, audit, eval | 跨 entities/concepts 模糊搜索知识库。 |
| `read_entity` | fde | 读取单个 entity 页。 |
| `read_concept` | fde | 读取单个 concept 页。 |
| `list_entities` | fde | 列出所有 entity（可选按 domain 过滤）。 |
| `read_lessons` | fde, eval, audit | 读取踩坑记录（lessons-missteps.md）。 |
| `read_think_md` | fde, eval | 读取 think.md 完整内容。 |
| `create_entity` | fde | 创建/更新 entity 页。写入前跑数据审计，FAIL 拒绝写入。 |
| `create_concept` | fde | 创建/更新 concept 页。 |
| `update_entity` | fde | 字段级更新 entity 页（只改传入字段，保留其余）。写入前跑数据审计。 |
| `delete_entity` | fde | 删除 entity 页。🔴 破坏性操作，必须 confirmed:true 才执行。 |
| `delete_concept` | fde | 删除 concept 页。🔴 破坏性操作，必须 confirmed:true 才执行。 |
| `validate_ontology` | fde | 检查本体数据完整性——实体数/关联断裂/孤儿实体/死链。 |
| `list_concepts` | fde | 列出所有 concept。 |
| `ontology_import` | fde | Ontology 注入——提交 entity/concept/relations（JSON），校验+审计后注册。 |

### 组织能力市场（发布 · 检索 · 调用 · 评分 · 退役）（6）

| tool | roles | 说明 |
|---|---|---|
| `commons_publish` | commons | 能力发布——将 Skill/Agent/流程发布到企业能力公地（SkillScan 安全门）。 |
| `commons_search` | commons | 能力检索——按标签/关键词/类型检索能力公地。 |
| `commons_invoke` | commons | 能力调用——发现能力后挂载调用（SkillScan 拦截 + HITL 确认）。 |
| `commons_rate` | commons | 能力评价——调用后累积评分（0.0~1.0），防刷。 |
| `commons_retire` | commons | 能力退役/恢复——标记退役（不删除，可恢复），强制 owner 确认。 |
| `commons_harvest_rule` | commons | 从公地调用日志 + Refine 循环提炼质量规则候选。 |

### 运维与可见性（成本 · 工作明细 · 健康 · 规则 · 能力发现）（8）

| tool | roles | 说明 |
|---|---|---|
| `worklog_query` | ops | 按 Agent / Workflow / 周趋势查询 AI 工作明细（任务/token/耗时/成本/人工介入），可附带进化四维趋势。 |
| `cost_query` | ops | 查询成本审计——预算配置 / 各 Agent 实际消耗（token/成本）/ 超限记录（WARN 级）。 |
| `stats` | ops | 知识库统计（entities/concepts 数 + 最后更新时间）。 |
| `list_capabilities` | — | 返回完整能力清单（tools + resources）——Agent 首次连上时获取能力地图。 |
| `data_sovereignty_report` | audit | 查询数据主权审计报告摘要（云端调用/本地执行/数据流出/敏感本地处理率）。 |
| `health_check` | ops | 运行环境健康检查（环境/配置/数据目录/Hook/依赖）。 |
| `daemon_status` | ops | 查询 daemon 运行状态（PID/启动时间/心跳）。只读。 |
| `list_rules` | audit | 列出所有审计规则清单（只读，不暴露实现）。 |

---

## 三、防漂移机制

- 本清单由 `engine/mcp/src/tool-registry.ts` 的 `name:` + `description:` 字段生成，配 `tools/check/check-docs.sh` 门禁断言：**文档 tool 数 == registry 实数**，对不上即 CI 红。
- 新增/修改工具：先改 tool-registry.ts（含描述），再跑 `node tools/gen/gen-api-tools.mjs`（生成器，随本文件一并交付）重生成第二节，门禁自动对账。

---

## 四、变更日志

| 日期 | 变更 |
|------|------|
| 2026-09-03 | 建档——80 tools 首次成清单，六大接口面总表 |
| 2026-09-05 | v1.4.5 三件收编（train_serve/train_compliance/train_deliverable）80→83 |
