# 路线图 · Roadmap

> 已经做了什么、未来要去哪、哪些地方需要你的帮助。
> v1.3.1 · 2026-08-09（UTC）· 🧠 Ontology 运行时层 + 并行编排 + Durable Execution + Agent 身份码 + Onboard L1 + Benchmark 评测 + 工具审批模式 + LLM Trace + 错误处理 + MergeQueue + L4 渐进加载 + 国标对齐

产品定位详见 [设计哲学](./PHILOSOPHY.md) 和 [README](../README.md)。

## 现在在哪：v1.3.1（已交付 · 2026-08-09）

> **v1.3.1 交付内容**：
> **🧠 Ontology 运行时层（P0）**——Action 注册表 + 执行前 validator 三态（PASS/WARN/strict-FAIL）+ CORE-OBJ/ACT/LNK/STM 四类内核契约 + entity/concept/relations JSON Schema 定稿（零依赖手写校验器，v1.3.6 注册接口复用）+ wrapToolsWithGate 可选集成（不传 = 零变化）
> **🔀 并行编排 + MergeQueue**——ParallelScheduler 波次并发分发（worktree 隔离）+ 波次审计卡关（全 PASS 合并/任一 FAIL 丢弃）+ MergeQueue 并发合并（到达序 yield + 原始序重排 + 配对保证）；并行是可选路径，默认串行
> **⏸️ Durable Execution L1+L2**——checkpoint 续跑（daemon 重启自动恢复）+ 副作用登记簿幂等查重（JSONL append-only）
> **🚀 Onboard Agent L1（P0）**——activate→run→judge→fix→re-run 循环（crash/error/超时三态，不判语义）+ MCP loop_debug
> **📊 Benchmark 评测体系**——题库设计 + Pilot 校准 + Freeze + 隔离执行（statement/rubric 物理分离 + Test Agent 强制 read-only）+ 0..100 评分 + HMAC 链 evaluation-log + MCP evaluate
> **🆔 Agent 身份码 Ed25519**——签发/验证完整版 + 本地身份注册表 + MCP agent_identity
> **🔒 工具审批四模式**——allow-with-audit / deny-all / read-only / always-ask（保守默认拒绝 + 审批继承 + approval_decision 审计）
> **📜 LLM 调用级 Trace**——全量追踪（HMAC 链 + 白名单脱敏）
> **🔄 错误处理升级**——stop_reason 六值分类 + 指数退避（auth 永不重试）+ 工具失败收敛为消息
> **📚 L4 经验层渐进加载**——热点全文 2 + 索引 9（注入量 ~4000→~1500 token）
> **🏛️ 国标对齐 GB/T 48000.3-2026**——条款映射基线 + 审计维度 opt-in（`--gb48000`，默认不影响行为）
>
> 📖 [v1.3.1 开发日志](./changelog/v1.3/v1.3.1.md) · 完整版本历史见 [CHANGELOG](../CHANGELOG.md) 和 [迭代历程](#迭代历程)

> ✅ **企业采购阻塞项 · Webhook 推送已于 v1.2.1 交付**：v1.1.6 接通 webhook **PASS/WARN/FAIL 三态推送**，v1.2.1 补齐企业协同平台（飞书/钉钉/企微）完整 Webhook 推送能力（见 SECURITY.md「审计结果推送」）。采购阻塞项已解除。

---

## 迭代历程

完整版本历史见 [CHANGELOG](../CHANGELOG.md)。v0.x 为实验/测试版，v1.0.0 起为正式版。

| 版本 | 核心交付 |
|------|------|
| **v1.3.1** | 🧠 Ontology 运行时层（Action 注册表 + validator 三态 + Schema 定稿）+ 🔀 并行编排（ParallelScheduler + 波次审计卡关 + MergeQueue）+ ⏸️ Durable Execution（checkpoint 续跑 + 副作用幂等）+ 🆔 Agent 身份码 Ed25519 + 🚀 Onboard Agent L1 + 📊 Benchmark 评测（隔离执行 + HMAC 链）+ 🔒 工具审批四模式 + 📜 LLM 调用级 Trace + 🔄 错误处理（stop_reason + 退避 + 收敛）+ 📚 L4 渐进加载 + 🏛️ 国标对齐 GB/T 48000.3-2026 |
| **v1.3.0** | 🛡️ 运行时审计最小闭环（wrapToolCall middleware + tool-gate 动态拦截 + 审计日志）+ 🧠 决策审计（emitDecision + HMAC 链 + kind-wise back）+ 🔗 激活链 Phase 4 收尾（SUSTAIN）+ 📋 list_rules MCP tool + 🔧 双规则系统统一（ruleType）+ 📦 外部记忆后端 Path A（MA1-MA7）+ 🔧 进化链路写保护 + 🔓 运行时审计日志按 git 仓库隔离 + 🔧 危险操作 HITL 钩子 |
| **v1.2.9** | 🐛 FORGE Driver 短任务化（12 独立 worker 各跑 1 视角）+ ⏸️ Checkpoint/Resume worker 级断点 + 🏠 PM2 守护进程 + 🔗 激活链 Phase 3 后半（HITL + 审计 + 异常处理）+ 📐 约束层叙事重构 + 🚪 三个入口产品（npx CLI + 规则市场 + GitHub Action） |
| **v1.2.8** | 记忆分层 + 定时任务 + 🔗 激活链 Phase 3 前半（dag-runner 企业 Agent + node-executor + run-enterprise CLI）+ 🚪 release-gate-loop F 修复者（验-改循环）+ 🔍 FORGE 全 loop 接入 audit（dogfooding）+ ⏸️ Checkpoint/Resume 轮级断点 |
| **v1.2.7** | 编排引擎增强（Session Goals `/goal` + `/compact` + Skill 渐进加载 + doctor --repair + FORGE driver-base + enterprise-graph StateGraph 构建 + --support-bundle + One-Line bootstrap.sh + Agent Mailbox）+ 🔗 激活链 Phase 2 后半 |
| **v1.2.6** | 🔗 激活链 Phase 2 前半（映射表 + 注册扩展）+ MCP 交付链路修补（daemon_status/list_agents/list_concepts/hitl_resolve 四 tool 三处注册）+ 文档死链清零（74 处）+ README Deployment Sizing |
| **v1.2.5** | 激活链 Phase 1 ACTIVATE（activate.ts + MCP activate_workflow tool）+ 审计引擎加固（A20-A23 + 结构性地基加固 + 检测盲区补全）+ daemon 可靠性（推送重试 + plist 校验 + 健康自检）+ 多设备前置（Agent 身份码 + 跨设备审计聚合 + 协议中立） |
| **v1.2.4** | 知识进化（分层巡检 L1/L2/L3 + skillopt 自动触发 + 失败清单 + 联邦蒸馏 + 进化引擎接通 eval）+ Dashboard 历史趋势 + Skill × MCP 集成（S1-S5）+ FDE 人机分离（README/GUIDE/SKILL.md 升格 + 子 Skill 分包 01-05）+ FORGE stream 迁移 + LESSONS 方法论 |
| **v1.2.3** | Dashboard 产品化（控制图波次渲染 + 用户可读状态映射 + Fresh-Eyes 审查进度 + Workspace 变更摘要）+ 编排隔离底座（git worktree 三原语 + 审计合并卡关）+ Fresh-Eyes-Loop 移至阶段一 + v1.2.2 BugFix 31 项 + 裁决解析健壮性加固 |
| **v1.2.2** | 数据主权审计（4 维追踪 + HMAC 链 + 日/周/月报告）+ 混合模型路由（ModelRouter + Ollama 接入）+ FDE Dashboard（终端三栏）+ Graph Engine（Planner + 降级链 + decide/execute 分层）+ 异步 HITL + Skill 升级三策略 + v1.2.1 BugFix 38 项 |
| **v1.2.1** | 数据目录重构（.sofagent/ → data/）+ Webhook 推送 + SubAgent 可见性 L2 + custom/ 闭环 |
| **v1.2.0** | 物理结构大重构（/sofagent/→/engine/ + SKILL 收敛 + 发版工具链拆散 + install.sh 提根 + rules 独立包） |
| **v1.1.9** | 产品叙事收敛（FDE Agent）+ USB 完整运行时 + daemon A/B 自动调度器 + 控制图状态抽取 + v1.1.8 BugFix 42 项 |
| **v1.1.8** | 安全层加密配对 + 联邦查询 + Prompt 注入防护补齐 + 编排引擎串行版（DAG 并行规划在 v1.3.1） |
| **v1.1.7** | Dream Cycle 6 阶段 + sensitivity + 知识健康巡检 + 知识可观测性：gbrain 精简 pipeline 替换旧脚本 + knowledge 敏感度分级（缺省 internal）+ knowledge-health 5 项检查（@weekly）+ `knowledge status` 聚合命令 |
| **v1.1.6** | BugFix 21 项 + LLM Wiki 3 层分层 + conflict-check：v1.1.5 遗留全数修复 + Ledger-Views-Policy 显式化（详见 [ARCHITECTURE §文件系统架构](./ARCHITECTURE.md#文件系统架构)）+ daemon 知识健康巡检（矛盾/孤儿/死链） |

## 未来去哪

> 以下是**方向**，不是承诺。没实测过的事标「不知道」。

**终局**：企业不再需要 FDE。AI 节点部署后自主运行，审计引擎持续盯变更，编排引擎自动纠偏，知识库自我积累——人只需要偶尔看一眼 dashboard 确认一切正常。我们做的不是给企业装 AI，是让企业忘了我们的存在。

> DeepMind 创始人 Demis Hassabis 在 2026 年 Guardian 采访中坦言："**现在发生的一切，并不是我当初希望 AI 发展的方式。**"这位一手推动了 AlphaFold 和 AlphaGo 的人，在 AI 走向商业化失控的转折点上，公开表达了不安。sofagent 的终局不是"更多的 AI"，而是"AI 可以被管住"——如果连创造 AI 的人都觉得方向失控了，那 Harness 中间件就不是选配，是刚需。

**为什么是现在——转折点的三信号**：单一信号不够，三信号同时成熟才构成真正的范式转折点：

| 信号 | 维度 | 内容 |
|------|------|------|
| 供给侧 | AI Coding 成本趋零 | FDE 借 AI Coding 1 天出 Demo，瓶颈从技术能力转向**业务抽象能力**（能否把 SOP 拆成 Agent 工作流） |
| 治理侧 | Agent IAM 组织身份 | Agent 有工号/权限/审计/全生命周期管理，从「工具」变「员工」，才能进生产环境 |
| 能力侧 | 协同飞轮持续进化 | 每次人工纠正/确认/追问回流为结构化学习信号，越用越懂企业 |

**现实验证（数字原生工作方式）**：工作流主语从「人」迁移到「Agent」——将 SOP 拆为 Agent 工作流、给 Agent 派工号、把人工纠正回流为学习信号——正是三信号同时成熟的落地案例，让抽象框架变现实（2026-07 行业观察）。

sofagent 的定位正卡在这个转折点上：审计引擎（治理侧）+ Ontology（能力侧）+ 开源 MIT（供给侧）——三信号缺一不可，单独做任何一个都不够。

**供给侧补全——「技术拼图已齐」**（黄仁勋 2025.7）：NVIDIA 判断企业 AI Agent 的所有核心组件——世界级语言模型（NITRO 3 ULTRA）、针对性微调框架、示范方案（Deep In Blueprint）、沙盒安全运行环境、无缝集成工具链——已全部就绪。"所有技术拼图已经拼齐，企业没有理由不立刻拥抱 Harness 工程。" sofagent 的 `install.sh` + FDE 四阶段示范方案正是这一判断的工程实现——不是告诉企业"该做"，而是直接给一套可以跑的具体蓝图。

两条路径：**FDE 驻场部署**（传统中小企业，FDE 进场→四阶段十二步流程→交付→撤离）和 **开发者自部署**（开源社区，git clone→install.sh→审计→CI 集成）。

设备端形态：安装时可配置 Agent 平台（OpenClaw / WorkBuddy 等），审计结果通过 MCP server 推到企业协同平台。**数据主权在设备**——所有记忆、日志、决策记录永不离开本地。

> 以下是方向落地为版本的具体拆解。v3.x 长期架构骨架见下方「探索方向」。

---

## 版本规划

> 以下带状态版本表为权威源；各版本详细子节见下方 `###`。

### 规划版本

> 🔗 **激活链进度框架**：v1.2.5-v1.3.0 按激活链四阶段推进（ACTIVATE→ORCHESTRATE→EXECUTE→SUSTAIN），每个版本对应一个阶段或阶段内子步骤。详见 [激活链设计文档](./guides/fde-activation-chain.md)。
>
> ✅ **已完成阶段**：ACTIVATE（v1.2.5）→ ORCHESTRATE（v1.2.6-v1.2.7）→ EXECUTE 前半（v1.2.8）

> 🔴 **阻塞项占位纪律**：任何 🔴 采购 / 合规阻塞项必须在下表占据一个**明确的版本单元格**（标注具体版本号），不得仅写在散文备注里。

| 版本 | 状态 | 核心交付 | 日志 |
|------|:--:|------|:--:|
| **v1.2.9** | ✅ 已交付 | **🐛 v1.2.8 发版遗留 BugFix + 🔧 FORGE Driver 短任务化 + ⏸️ Checkpoint/Resume 升级 + 🏠 PM2 守护 + 🔗 激活链 Phase 3 后半 + 📐 约束层叙事重构 + 🚪 三个入口产品**：① 短任务化——a-check/b-check 从"1 worker 跑 12 视角"拆成"12 独立 worker 各跑 1 视角"（5-8 次工具调用）② Checkpoint/Resume 从轮级升级为 worker 级断点（`completedWorkers: string[]`）③ PM2 守护进程（脱离 session 生命周期，崩溃自动重启+日志持久化+开机自启）④ 激活链 Phase 3 后半（HITL 中断处理 + 每节点执行后自动审计 + 异常处理）⑤ 工程债务——mcp-server.ts 1899 行拆分 ⑥ v1.2.8 发版遗留 BugFix——driver 修复链 bug（verdict PASS 时 results 状态一致 + f-fix 硬上限由短任务化覆盖；driver-base 继承重构已消化相关缺陷）⑦ 约束层叙事重构——"一底座·三引擎"统一为"约束层（Harness）：一个层四种能力（注入·审计·回溯·进化）"，纯文档改写 ⑧ 三个入口产品——`npx sofagent-audit` 零配置 CLI + 规则市场（`--ruleset` + 插件接口 `type: "plugin"` 支持外部 npm 包注册 AST/语义规则）+ GitHub Action（PR 自动审计） | [日志](./changelog/v1.2/v1.2.9.md) |
| **v1.3.0** | ✅ 已交付 | **运行时审计最小闭环 + 🔗 激活链 Phase 4 收尾（SUSTAIN）**：① wrapToolCall middleware 包 createReactAgent ② engine/rules 3 条 tool-gate 规则升级为运行时拦截 + 审计日志 ③ 危险操作前人工批准钩子 ④ 复用 FORGE 已跑 createReactAgent ⑤ 运行时审计日志按 git 仓库隔离 ⑥ 决策审计 Judgment Unit（emitDecision + kind-wise back）⑦ **🔗 激活链收尾**：全链路验证（activate→compose→run→HITL→audit→sustain）+ wrapToolCall 自动覆盖企业 Agent + FDE SKILL.md 新增 activate 引导 ⑧ **list_rules** MCP tool（tool-gate 规则透明化，覆盖度审计缺口补全）⑨ **🔧 技术债回收：双规则系统统一**——`engine/rules/`（tool-level）与 `engine/audit/src/rules/`（git-diff）统一为单一规则引擎（`ruleType: 'tool' | 'diff'`），消除 secret-leak 检测的行为不一致风险（详见 [ARCHITECTURE 已知技术债](./ARCHITECTURE.md#已知技术债双规则系统重叠已在-v130-交付)）⑩ **📦 外部记忆后端 Path A**——TencentDB-Agent-Memory MCP connector（弱依赖、缺省关闭、零架构改造，MA1-MA7；详见开发日志 §外部记忆后端 Path A 专项） | [日志](./changelog/v1.3/v1.3.0.md) |
| **v1.3.2** | 📋 规划中 | **🚀 Onboard Agent 完整版（L2-L5 · FORGE 产品化第二刀）+ 🎯 企业专属 eval 套件 + ⚡ workflow 批量自动生成 + 🧩 模型接入插槽扩展 + 🎙️ FDE 梳理辅助工具（含 ontology 咨询式生成）+ 🧵 LLM Trace 任务级轨迹**：① L2 语义判定（Ontology 判据）② L3 自动定位（LLM 推理）③ L4 自动修复（审计兜底）④ L5 循环收敛（回归+连续 PASS）⑤ 企业行业 eval 模板（金融/制造/供应链，FDE 交付时实例化 + 基线冻结 + 回归门禁，a16z 法则6 产品化）⑥ workflow.yml → 自动为每个节点生成 sub-agent（agent-creation 规模化，PenguinHarness「用 Agent 构建 Agent」启发）⑦ `client_type: 'ollama' | 'openai-compatible'` 模型接入插槽（商业模型层 后训练模型 vLLM/OpenAI 兼容接入的地基，2026-08-09 从 v1.3.1 移入）⑧ FDE 梳理辅助（五要素引导 → workflow.yml 草稿 → 人工确认，规则驱动不抢 商业模型层 C2/C3）⑨ **Ontology 咨询式生成端**（五要素 → entity/concept/relations 草稿 → 人工确认 → v1.3.6 ② 注册——FDE Agent 靠咨询生成 ontology，不靠模型，2026-08-10 新增）⑩ **LLM Trace 任务级轨迹视图**（taskId 完整调用链含工具结果——调试可观测通用能力，RL 训练消费在 v1.4.1 衔接，2026-08-10 新增） | [日志](./changelog/v1.3/v1.3.2.md) |
| **v1.3.3** | 📋 规划中 | **L2 团队协作协议（五大机制）+ ✨ Refine Agent 完整版 + 🧭 主 agent 编排 + 🚪 入口路由**：① 协作协议——共享态/意图广播/触发反应/冲突消解/反馈放大 + 团队状态管理 ② Refine Agent——复用 Onboard 循环引擎，判据从 Ontology 换成质量规则集（好不好），五层一次交付 ③ 主 agent 四合一角色（分发/监控/审计/通讯）——编排 v1.3.2 批量生成的 sub-agent ④ **入口路由**（`route_workflow` MCP tool + workflow 节点 type 机器化）——用户自有 Agent（WorkBuddy/Codex）协同时判断请求是否命中 workflow 强化人/自动节点 → 进 workflow / 落回用户模型（模型分层 = 入口判断，2026-08-10 新增） | [日志](./changelog/v1.3/v1.3.3.md) |
| **v1.3.4** | 📋 规划中 | **L3 组织能力市场（发布→发现→调用→评价→养护）**：Skill/Agent/流程打包发布 + 目录检索 + 调用挂载 + 评分聚合（评分 × 调用量加权自然选择）+ 全程审计 + **养护环（owner 声明 + 失效退役 + 变更记录，GitHub 模式「持续养护」）** | [日志](./changelog/v1.3/v1.3.4.md) |
| **v1.3.5** | 📋 规划中 | **自进化与运维闭环（MCP 覆盖度审计缺口补全）**：`run_ab_test` / `promote_ab`（晋升强制人审）+ `snapshot_list` / `snapshot_restore`（恢复强制人审） | [日志](./changelog/v1.3/v1.3.5.md) |
| **v1.3.6** | 📋 规划中 | **🔌 引擎接口外化完整版（模型层接入前置 · 原 v2.0 前移）**：① Workflow 标准格式 + 运行容器（JSON Schema + MCP `workflow_submit`）② Ontology 注册接口（MCP `ontology_import` + D1-D5 审计）③ **SubAgent 托管 SDK**（`harness.wrap` 包装 LangGraph 自定义 Agent → 自动获得审计/审批/身份/Trace，createReactAgent + 纯 StateGraph 双形态——商业模型层 C6 落点）④ **模型注册 + 灰度切换**（`model_register` / `model_switch`，评测 → 注册 → 灰度 → 晋升全流程审计 + 强制人审；`source: 'local-path'` 扩展位预留，C13 本地权重部署在 v1.4.1 填充；**通用模型路由不自研——企业挂第三方 model router（LiteLLM/OpenRouter），sofagent 只保留数据主权路由 + 注册/灰度/退役，2026-08-10 补充**）——**训练语料导出三件套已移至 v1.4.1 训练引擎**（2026-08-10 拍板：训练相关内容统一从 v1.4.x 开始） | [日志](./changelog/v1.3/v1.3.6.md) |
| **v1.3.7** | 📋 规划中 | **🔒 SubAgent 完整沙箱 + 场景驱动权限（原 v1.4.0 前移）**：① 沙箱——虚拟文件系统隔离 + 网络出站白名单 + 工具调用中介（前置 allow/deny）+ 虚拟 key 凭证边界注入 + AsyncSubAgent + 真·实时 A/B 双跑 ② 场景驱动权限体系（身份→场景匹配→风险等级→放行）——审计从「事后」扩展到「运行时」（范围限定 SubAgent） | [日志](./changelog/v1.3/v1.3.7.md) |
| **v1.3.8** | 📋 规划中 | **🛡️ 代理网关硬边界 + 数据静态加密 + Durable L3（原 v1.4.0 前移）**：① 代理网关（唯一出入口 + 风险分级 + 超阈值人工批准）② 数据静态加密（age）③ Durable Execution L3（WAL 写在网关层）④ **托管 SDK `sandbox: true` 选项启用**（v1.3.6 SDK 的沙箱接线） | [日志](./changelog/v1.3/v1.3.8.md) |
| **v1.3.9** | 📋 规划中 | **🛠️ 官方 AST 规则引擎 + meta-harness + 📊 AI 工作明细数据层（原 v1.5.0 + v2.0 前移）**：① 官方 `sofagent-ruleset-ast` 语义级规则引擎参考实现（TypeScript compiler / tree-sitter）② meta-harness 多 harness 统一编排（策略强制在基础设施层 + 跨会话协作）③ AI 工作明细数据层（业务视角：按 Agent/按 Workflow/按周 + 人工介入记录，零新数据——复用审计 + decision-log + LLM Trace；**补节点实际耗时采集——商业模型层 C8 绩效量化引擎 `年节省=日耗时×时薪×250` 的直接输入**，2026-08-10 新增；`worklog_query` MCP + 落盘 `worklog.json`；终端 ASCII 视图可选；**Web 工作明细页 v1.4.0**，Startwork 启发） | [日志](./changelog/v1.3/v1.3.9.md) |
| **v1.4.0** | 📋 规划中 | **📊 Web 工作明细页（企业 AI 工作记录视图 · 版本号重新启用）**：`dashboard.html` 加「工作明细」区块（按 Agent/按 Workflow/按周 + 人工介入记录，读 v1.3.9 落盘的 `worklog.json`，降级示例对齐现有模式）——Dashboard Web 前端已就绪（dashboard.html 6 页 + serve-dashboard.mjs），v1.3.9 已承载 AST + meta 两个大交付，Web 页单独一版 | [日志](./changelog/v1.4/v1.4.0.md) |
| **v1.4.1** | 📋 规划中 | **🚀 训练引擎 · 地基（协议 + 编排 + 审计 + 预算）**：① **双栈架构决策 + 训练协议三约定**——Node 控制面 + Python 执行面（spawn + config JSON + stdout JSON 流 + SIGINT 信号，接口即解耦；个人 Mac 阶段 0 用 @mlx-node/trl 纯 Node 验证）② **train-job 编排层**（train_submit / 监控 / 取消 / checkpoint 续跑，状态机 + 幂等）③ **train_job 审计**（训练本身可审计可回滚 + 数据源 hash 溯源）④ **训练预算控制**（train budget：时间/算力预算，超预算暂停 + 人审，成本透明） | [日志](./changelog/v1.4/v1.4.1.md) |
| **v1.4.2** | 📋 规划中 | **🚀 训练引擎 · 数据与评估（管道 + 版本 + eval + 环境 + 报告）**：① **企业数据 → 训练集管道**（CSV/Excel/**DB/API** 多源异构接入 + instruction/偏好对构建 + 质量闸门 + 训练入口脱敏）② **训练集版本管理**（dataset_version，eval 引用版本可复现）③ **训练中 eval 闭环**（复用 v1.3.1 Benchmark，阈值外部化——机制开源/阈值外部化）④ **训练环境管理**（train env init + train doctor + **基座模型下载管理** + 环境版本清单）⑤ **训练报告**（train report：客户可读交付物 + 量化四字段，商业模型层 C8 输入） | [日志](./changelog/v1.4/v1.4.2.md) |
| **v1.4.3** | 📋 规划中 | **🚀 训练引擎 · 运行与需求（监控 + 诊断 + 沙箱 + 推导 + 模板 + workflow）**：① **训练监控与 GPU 队列**（train_status + **train_list 历史任务** MCP tool + 显存预算排队 + webhook 推送）② **训练失败诊断**（train diagnose：OOM/数据/发散/框架/环境五类 + 修复建议）③ **训练沙箱 + 设备打包**（扩展 v1.3.7，数据不出边界 + 离线可训 + E4 前置）④ **训练需求推导 + 模板库**（`train analyze`：workflow 节点 → 训练目标/数据需求/评估标准/QLoRA 配置；场景化模板库）⑤ **后训练 workflow 模板**（`FDE/templates/post-training/post-training.yml`：七节点 FDE 载体，激活链四阶段 + 三 HITL 确认点——训练引擎作为 FDE Agent 核心功能点） | [日志](./changelog/v1.4/v1.4.3.md) |
| **v1.4.4** | 📋 规划中 | **🚀 训练引擎 · 信号与部署闭环（语料 + 权重 + 注册 + 对比）**：① **训练语料导出三件套**（规则 + GUIDE 方法论 + 样本四源 [decision-log/llm-calls/evaluation-log/runtime-audit] + Trace 轨迹 + 通用脱敏管线 + HMAC 签名 + 合规红线——含 human-fde 人工基准，从 v1.3.2/v1.3.6 归集）② **C13 本地权重部署链路**（权重目录规范 + 本地加载 + 版本回滚，从 v1.3.6 归集）③ **训练产物 → 模型注册自动衔接**（train done + eval pass → model_register，闭环最后一步）④ **多基座对比训练**（train compare：同数据多基座并行 + ROI 排序，阶段 2 选型前置） | [日志](./changelog/v1.4/v1.4.4.md) |
| **v1.4.5** | 📋 规划中 | **🚀 训练引擎 · 服务与持续（推理服务 + 持续后训练 + 合规扫描 · 生命周期补全）**：① **训练推理服务**（train serve：从权重目录拉起 vLLM/Ollama + 健康检查 + 与 model_switch 联动——部署后"跑起来"的最后一环）② **持续后训练**（E2：企业数据回流定期增量训练，数据阈值/定时/人工三种触发 + 回退保护——飞轮闭环的"持续"环）③ **训练数据合规扫描**（train compliance：PII/敏感字段扫描 + 合规闸门阻断 + 数据来源标记——商业模型层 §6.7 Q7 红线代码化） | [日志](./changelog/v1.4/v1.4.5.md) |
| **v1.4.6** | 📋 规划中 | **🚀 训练引擎 · 分布式与云端（多卡 + 云 VM 执行面 · 规模化前置）**：① **多卡/分布式训练**（train multi：多卡/多机配置 + verl/DeepSpeed 集群 spawn + GPU 队列多卡拓扑感知 + 分布式失败诊断）② **云端 VM 执行面**（train cloud：Node 控制面本地 + Python 执行面云上——ssh/API 远程 spawn + 数据加密上传/训练后清理 + 云端成本入预算——C13「全托管」交付模式技术底座；⚠️ 敏感数据不上公有云，走客户机房联合训练） | [日志](./changelog/v1.4/v1.4.6.md) |

#### v1.3.x 里程碑拆分

> 运行时审计最小闭环（v1.3.0）是 v1.3.x 第一刀：不替换 harness，只在 createReactAgent 上加 middleware 层。**2026-08-09 版本重排**：原 v1.4.0（沙箱/权限/网关/加密/WAL）、v1.5.0（meta-harness）、v2.0（引擎接口外化）内容全部提前进 v1.3.6-v1.3.9——依赖链在 v1.3.x 内已满足（v1.3.1 Ontology/身份码 + v1.3.3 L2 + v1.3.4 L3），且模型层（商业模型层）接入需要接口尽早就绪。**v1.4.0 已重新启用**（2026-08-09：承载 Web 工作明细页，dashboard.html 已就绪）；v1.5.0 / v2.0 版本号留空，未来按需重新规划。

| 版本 | 主题 | 核心交付 |
|------|------|------|
| **v1.3.0** | **运行时审计最小闭环（LangGraph middleware）** | ① wrapToolCall middleware 包 createReactAgent ② engine/rules 3 条 tool-gate 规则升级为运行时拦截 + 审计日志 ③ 危险操作前人工批准钩子 ④ 复用 FORGE 已跑 createReactAgent ⑤ 运行时审计日志按 git 仓库隔离 ⑥ **list_rules** MCP tool ⑦ **🔧 双规则系统统一**（`ruleType: 'tool' | 'diff'`，消除技术债）⑧ **📦 外部记忆后端 Path A**（TencentDB-Agent-Memory MCP connector，缺省关闭）（详见 开发日志 ./changelog/v1.3/v1.3.0.md）|
| **v1.3.1** | ✅ 已交付 | **Ontology + 并行编排 + 身份码 + Onboard L1 + Benchmark 评测 + 工具审批模式 + Durable Execution + CRUD + LLM Trace + 错误处理 + MergeQueue + L4 渐进加载 + 国标对齐**（详见 [v1.3.1 开发日志](./changelog/v1.3/v1.3.1.md) + [Ontology 详解](#v131--ontology-本体结构操作型本体论落地)） |
| **v1.3.2** | **🚀 Onboard Agent 完整版（L2-L5）+ 🎯 企业专属 eval 套件 + ⚡ workflow 批量自动生成 + 🧩 模型接入插槽扩展 + 🎙️ FDE 梳理辅助 + 🧵 Trace 任务级轨迹** | L2 语义判定（Ontology 判据）+ L3 自动定位（LLM 推理）+ L4 自动修复（审计兜底）+ L5 循环收敛（回归+连续 PASS）+ 企业行业 eval 模板（a16z 法则6 产品化）+ workflow 节点自动生成 sub-agent + `client_type` 模型接入插槽（openai-compatible）+ FDE 梳理辅助（五要素→workflow.yml 草稿）+ **LLM Trace 任务级轨迹视图（调试可观测通用能力，RL 消费在 v1.4.1）**（详见 开发日志 ./changelog/v1.3/v1.3.2.md）|
| **v1.3.3** | **L2 团队协作协议 + ✨ Refine Agent + 🧭 主 agent 编排** | 协作五大机制 + Refine Agent 完整版（质量规则集判据，复用 Onboard 循环引擎）+ 主 agent 四合一（分发/监控/审计/通讯）（详见 开发日志 ./changelog/v1.3/v1.3.3.md）|
| **v1.3.4** | **L3 组织能力市场（五环）** | 发布→发现→调用→评价→养护（owner 声明 + 失效退役）+ 评分聚合自然选择 + 全程审计（详见 开发日志 ./changelog/v1.3/v1.3.4.md）|
| **v1.3.5** | **自进化与运维闭环（MCP 覆盖度审计缺口补全）** | `run_ab_test` / `promote_ab` + `snapshot_list` / `snapshot_restore` 四个 MCP tool（详见 开发日志 ./changelog/v1.3/v1.3.5.md）|
| **v1.3.6** | **🔌 引擎接口外化完整版（模型层接入前置）** | Workflow 标准格式 + 运行容器（`workflow_submit`）+ Ontology 注册接口（`ontology_import`）+ SubAgent 托管 SDK（`harness.wrap`）+ 模型注册/灰度切换（`model_register`/`model_switch`，`source: 'local-path'` 扩展位预留）——**训练语料导出已移至 v1.4.1**（详见 开发日志 ./changelog/v1.3/v1.3.6.md）|
| **v1.3.7** | **🔒 SubAgent 完整沙箱 + 场景驱动权限** | 虚拟 FS + 网络白名单 + 工具中介 + 虚拟 key + AsyncSubAgent + 真·实时 A/B + 场景权限判定链（详见 开发日志 ./changelog/v1.3/v1.3.7.md）|
| **v1.3.8** | **🛡️ 代理网关 + 静态加密 + Durable L3** | 网关唯一出入口 + age 加密落盘 + WAL 写在网关层 + SDK `sandbox: true` 启用（详见 开发日志 ./changelog/v1.3/v1.3.8.md）|
| **v1.3.9** | **🛠️ AST 规则引擎 + meta-harness + 📊 工作明细数据层** | `sofagent-ruleset-ast` 参考实现 + 多 harness 统一编排 + AI 工作明细（`worklog_query` + 落盘 `worklog.json`，**补节点实际耗时采集，商业模型层 C8 输入**，终端 ASCII 可选）（详见 开发日志 ./changelog/v1.3/v1.3.9.md）|
| **v1.4.0** | **📊 Web 工作明细页（版本号重新启用）** | `dashboard.html` 加「工作明细」区块，读 `worklog.json`（v1.3.9 落盘）（详见 开发日志 ./changelog/v1.4/v1.4.0.md）|
| **v1.4.1** | **🚀 训练引擎 · 地基** | 双栈协议三约定 + train-job 编排 + train_job 审计 + 训练预算控制（详见 开发日志 ./changelog/v1.4/v1.4.1.md）|
| **v1.4.2** | **🚀 训练引擎 · 数据与评估** | 数据→训练集管道（文件+**DB/API**）+ 训练集版本 + eval 闭环 + 环境管理（**含基座模型下载**）+ 训练报告（详见 开发日志 ./changelog/v1.4/v1.4.2.md）|
| **v1.4.3** | **🚀 训练引擎 · 运行与需求** | train_status/**train_list**/GPU 队列 + 失败诊断 + 训练沙箱/设备打包 + 需求推导/模板库 + **后训练 workflow 模板**（详见 开发日志 ./changelog/v1.4/v1.4.3.md）|
| **v1.4.4** | **🚀 训练引擎 · 信号与部署闭环** | 语料导出三件套 + C13 权重部署 + 产物→注册衔接 + 多基座对比（详见 开发日志 ./changelog/v1.4/v1.4.4.md）|
| **v1.4.5** | **🚀 训练引擎 · 服务与持续** | train serve 推理服务 + 持续后训练（E2）+ 数据合规扫描（Q7 红线）（详见 开发日志 ./changelog/v1.4/v1.4.5.md）|
| **v1.4.6** | **🚀 训练引擎 · 分布式与云端** | 多卡/分布式训练（verl/DeepSpeed 集群）+ 云 VM 执行面（控制面本地/执行面云上，C13 全托管底座；敏感数据不上公有云）（详见 开发日志 ./changelog/v1.4/v1.4.6.md）|

### v1.3.1 — Ontology 本体结构（操作型本体论落地）

> 💡 来自 Palantir 操作型本体论系列研报（2026-07）的启发。Palantir 4000 亿美元市值的核心护城河不是"本体论"概念包装，而是 **Action Types 作为类型系统一等公民**——操作语义与数据定义同层建模，LLM 所有调用必须经过本体层定义的 Action 执行，无法绕过直接写库。

sofagent v1.3.1 的 Ontology 本体结构方向与之高度同构，但走**分布式路线**——不建中央本体操作系统，让每个 Agent 自建本体（Ledger-Views-Policy），联邦查询跨设备共享，git diff + audit history 做硬证据链：

| Palantir 做法 | sofagent 做法 | 差异化 |
|------|------|------|
| Action Types 内嵌本体，LLM 调用必经 | A15 约束验证（事后）+ fde.md Policy（事前声明） | 事后审计 + 逐步前移 |
| OAG 五层确定性架构 | Harness 约束底座 + MCP + FORGE 双 Agent | 同构轻量，无需五层就位即可工作 |
| 集中式 Ontology OS，重度物化索引 | 分布式 knowledge/，联邦查询按需获取 | MIT 开源、零锁定、数据主权本地 |
| Markings + CBAC 本体级安全 | sensitivity frontmatter + 跨设备联邦过滤 | 渐进式演进 |

> 💡 **核心设计原则**：本体结构 = GitHub 生长树——树干 = 本体结构本身，分支 = 单个 ontology 节点新增，护栏 = 审计引擎，根系 = 每个节点的强制 frontmatter（输入 / 产出 / 通过标准 / 哪些数据禁用），养护 = 本体变更的 review + rollback。完整映射与 v2.x「ontology I/O schema 硬化」的契合见 [ARCHITECTURE.md · 本体结构 = GitHub 生长树](./ARCHITECTURE.md)。

**v1.3.1 完整交付清单**：① 本体结构升级为可运行推理底座（对齐 24 条审计规则 + Ledger-Views-Policy）② 三层落地法（统一元模型 → 企业通用 Ontology 规范 → 与 Agent 平台打通）③ 国标对齐 GB/T 48000.3-2026 ④ **并行编排**——LangGraph 原生 DAG 并行（StateGraph + Send API），每波次经审计节点（★Reality Anchor）卡关，git worktree 隔离（v1.2.3 底座），幂等性保证 ⑤ **Ontology CRUD 补全**——`update_entity`/`delete_entity`/`delete_concept` 三个 MCP tool ⑥ **Agent 独立身份码 + KYA 完整版**（Ed25519 签发/验证）+ 跨设备审计轨迹聚合 + MCP `agent_identity`/`audit_trail` tool ⑦ **🚀 Onboard Agent L1（FORGE 产品化第一刀 · 工程判定层）**：企业 AI 节点 activate 后自动跑一轮 → crash/error 判定 → 报错人工修 → 再跑 ⑧ **📊 Benchmark 评测体系**（PenguinHarness 方法论借鉴）：statement/rubric 物理分离 + Pilot 校准 + Freeze + 隔离执行 + 四种失败码 ⑨ **🔒 工具审批模式**（PenguinHarness CLI 借鉴）：四模式（allow-with-audit/deny-all/read-only/always-ask）+ 保守默认拒绝 + 审批继承，Benchmark 评测强制 read-only ⑩ **Durable Execution L1+L2**：graph checkpoint 续跑（L1）+ 工具幂等性保证（L2，副作用登记簿）⑪ **📜 LLM 调用级 Trace**：每次模型请求写 llm-calls.jsonl（token/耗时/stopReason/error），HMAC 链防篡改 ⑫ **🔄 错误处理升级**：stop_reason 六值分类 + 指数退避重连 + 错误收敛为消息（auth 永不重试）⑬ **🔀 MergeQueue 并发合并**：并行编排的并发一致性底座（到达序 yield + 原始序重排）⑭ **📚 L4 渐进加载增强**：索引注入 + 按需读取（热点 2 篇全文 + 索引 9 条摘要）

> 🔗 **Graph Engineering 定位**：sofagent 已经在做 Graph Engineering——`engine/orchestrator/src/loop/graph.ts` 用 LangGraph StateGraph 实现 `START→engineer→audit→reviewer→human_confirm→END`，`audit` 节点即 ★Reality Anchor（真实 git diff 24 条规则作 guard edge）。v1.3.1 的「控制图多循环 DAG 波次并行」是这一定位的自然延伸。理论框架详见 [VALIDATION](./VALIDATION.md) 和 [ARCHITECTURE §Graph Engineering 视角](./ARCHITECTURE.md#graph-engineering-视角控制图--stategraph)。
>
> 📌 **本文档聚焦技术路线。** 终局愿景与转折点信号概述见上方「未来去哪」；商业化方向与市场定位（产品化四条 / 市场信号 / 价值度量 / SMB 断层）见 [VALIDATION §四](./VALIDATION.md)；Agent 时代组织哲学（Conway/Coase 双重反转）见 [PHILOSOPHY 附章](./PHILOSOPHY.md)。

---

## 行业印证

### 🔮 行业印证

> 完整行业对标（DeerFlow / Omnigent / DataFlow / OpenWorker / OpenFDE / a16z 七法则 / Graph Engineering / 5 阶段风险收敛）统一见 [VALIDATION](./VALIDATION.md)。以下仅保留与版本规划直接相关的结论。

**运行时审计演进路线**（meta-harness 三问作答）：
- **v1.3.x**：最小运行时审计——wrapToolCall middleware 包 createReactAgent（FORGE 已跑 createReactAgent，加 middleware 即可）
- **v1.3.7**：完整运行时审计——策略强制 + 沙箱 + 状态化拦截（范围限定 SubAgent）
- **v1.3.9**：meta-harness——多 harness 编排（承接 v1.3.7 沙箱底座）

**落地纪律**：以上均为「用行业术语框定已有/规划能力」，不新增能力范围。外部框架是设计启发 + 开源借力，非依赖引入。

---

## 探索方向

| 方向 | 一句话 |
|------|------|
| PE/VC 多企业审计仪表盘 | 投后管理场景——所有被投企业的 AI 审计数据汇总到一个面板 |
| FDE 陪跑期机制 | 部署后前 2 周 AI 节点 daily review，人类反馈和 AI 反思双向写入 think.md |
| SMB 场景审计扩展 | 审计从代码开发扩展到数据处理/报表生成 |
| ATTRIBUTION 归因引擎（v2.x） | 追踪审计决策→业务指标的因果链，依赖 v1.3.1 跨设备审计聚合数据积累 |
| Dream Sandbox 沙盒审计（v2.x） | Agent 操作先在平行空间模拟运行，人类审批后点「合并」才生效——约束从事后升级为事前（来源：Palantir AIP） |
| **自带净水设备的水龙头（v3.x+ 远景）** | Subagent 支持挂载外部精调小模型（引擎层提供路由与加载插槽），零投喂、本地推理、离线可用 |
| **Onboard Agent（FORGE 产品化 · v1.3.1 L1 + v1.3.2 L2-L5）** | 把 FORGE 验证的「元循环」能力泛化——企业 AI 节点生成后，自动调试到跑通（activate→run→audit→fix→re-run）。从「给自己用」变「给客户用」|
| **Refine Agent（FORGE 产品化第三刀 · v1.3.3）** | Onboard Agent 让节点「能用」，Refine Agent 让节点「好用」——复用 Onboard 循环引擎，判据从 Ontology 换成质量规则集 |
| **workflow 批量自动生成 + 主 agent 编排（PenguinHarness 启发 · v1.3.2+v1.3.3）** | FDE 交付的 workflow.yml → 自动为每个节点生成 sub-agent（agent-creation 规模化，v1.3.2）→ 主 agent 做分发/监控/审计/通讯（L2 协作协议，v1.3.3）。FDE 离场后企业 AI 节点开箱即用 + 自动运转 |
| 国标 Agent 审计对位 | 关注国家 AI 智能体互联标准草案进展，标准正式发布后评估对齐 |
| 异步长任务自治 | daemon 从文件监控升级为长任务自主运行 |
| 双闸验证 | 工具执行前 gate + 执行后副作用复查 |
| Agent 疲劳度检测 | 监控上下文窗口污染和决策质量衰减信号 |
| **可视化 DAG 画布（DataFlow 启发）** | Dashboard 补「workflow 可视图」——会话 Agent 与 DAG 画布实时同步同一 pipeline 表示（v2.x 远景） |
| **Ontology I/O schema 硬化（DataFlow 启发）** | 本体从目录级升级为带 JSON Schema 校验的约束图——Validation Engine（DAG 无环 + schema 兼容），节点输入/输出形状约束。Schema 定义规划于 v1.3.1、注册接口规划于 v1.3.6，Validation Engine 部分 v1.3.x 后期（与「本体结构 = GitHub 生长树」的根系工程化合并） |
| **MCP 暴露 ontology/audit（DataFlow 启发）** | 对外 MCP server 暴露算子注册表 / pipeline 状态 / audit 数据给 Agent——v1.3.6 规划中（`ontology_import` + `workflow_submit` + D1-D5 审计），剩余 audit 数据对外暴露面 v1.3.x 后期补全 |
| **GEPA / MemEx / RLM 评估（Omnigent 路线图参考）** | Omnigent 路线图四项（GEPA 自动优化 / MemEx 持久记忆 / RLM 强化学习 / Server MCP）方向值得在 v2.x 评估框架时参考——跟踪其落地后再对齐，不抢跑 |
| **SkillScan 安全扫描器（DeerFlow 启发）** | 安装第三方 Skill 前静态扫描注入/越权风险（v1.3.x 后期） |
| **Agentic Browser / Playwright（DeerFlow 启发）** | Agent 驱动浏览器做端到端操作，与「智能 E2E 测试 Agent」探索同源（v1.3.x 后期） |
| **TUI / Dashboard / 对话分支（DeerFlow 启发）** | 终端 UI + 可视化面板 + 对话分支回溯（v2.x 远景） |
| **spec-first 硬禁令（OpenFDE 启发 · 最高优先）** | 单一事实源——transcript 永不直驱代码，spec 才是唯一驱动（设计约束） |
| **decisions.jsonl 判断时刻日志（OpenFDE 启发 · 最高优先）** | 每次判断落 `{kind, moment, why, spec_ref}`，决策审计底座（v1.3.x 意图审计） |
| **分级降级梯队（OpenFDE 启发 · 最高优先）** | console→TUI→spec 逐级降级，workflow never stops（韧性设计） |
| **Durable Execution（Pydantic AI 启发）** | 长任务 checkpoint 续跑——与回溯引擎互补（回溯=向后回滚，Durable=向前续跑），L1+L2 已排 v1.3.1，L3 WAL 排 v1.3.8 |

> 📖 DeerFlow / OpenFDE 方法论印证见 [VALIDATION](./VALIDATION.md)。

| 借鉴项 | 说明 |
| --- | --- |
| **运行时审计接入点（v1.3.x · LangGraph middleware）** | wrapToolCall middleware 包 createReactAgent，把 tool-gate 规则升级为运行时拦截 + 审计日志 |
| **EnkryptAI Secure MCP Gateway（v1.3.7-1.3.8 · 开源借力）** | pre_model_hook / post_model_hook 安全护栏，audit_only 模式 |
| **LiteLLM 控制平面（v1.3.7 · 开源借力）** | 开源 LLM gateway：成本追踪 / 预算 / 路由 / 护栏 |
| **OpenWorker 权限模型（v1.3.x · 设计启发）** | 四级权限 + 命令白名单 + 无人值守收件箱（详见 [VALIDATION](./VALIDATION.md)）|
| **bubblewrap / seatbelt 沙箱（v1.3.7-1.3.9 · 开源借力）** | OS 级沙箱原语（Linux bwrap+seccomp / macOS seatbelt），SubAgent 沙箱底座 |
| **MLflow agent 评估（v2.x · 开源借力）** | 50+ agent 评估指标 + LLM-as-Judge，FORGE 评估框架参考 |

> 以下「分层模型架构」为探索方向的核心技术骨架概述。当前版本（v1.2.x）未涉及，v3.x 才启动。

## 分层模型架构（v3.x 远景概述）

核心驱动力 = **数据主权**（企业数据进 API key 大模型 = 一定被拿去训练）。三层模型 + Harness 路由：云端 32B+ 负责规划推理 → 翻译成标准化指令 → 本地 7B 执行多步 workflow → 本地 0.5B 跑管道层（模板/格式/字段提取）。敏感数据只在本地处理，通用知识才走云端。**引擎层只做模型路由（model-router.ts 已有四档插槽），精调 pipeline 属模型层非开源范围。** 路由层可提前到 v2.x 做（不依赖精调模型），离线 USB 节点是 v3.x-v4.x+ 的工作。完整技术骨架（Mermaid 图 + 选型表 + 实现难度）见 [PHILOSOPHY · 远期演化愿景](./PHILOSOPHY.md#远期演化愿景从内置小模型到自动化企业后训练引擎)。

---

## 不需要的

以下认真考虑过但决定不做。完整设计禁区见 [PHILOSOPHY §八](./PHILOSOPHY.md#八不做什么设计禁区)。

---

## 欢迎参与

| 你能做的事 | 时间 | 说明 |
|------|:--:|------|
| 跨平台测试 | 30 min | 你有 Codex / Hermes / Claude Code？装一下告诉我们 |
| 补充 FAQ | 20 min | 你踩了什么坑？直接改 HANDBOOK §三（排查问题） |
| 文档翻译 | 1-2 h | 英文翻译对社区意义巨大 |
| 第三方证据 | 1 周 | 装完用一周，填 EVIDENCE.md |
| 安全审计 | 不限 | 给 SECURITY.md 较真 |
| 企业场景反馈 | 30 min | 你们团队怎么用 Agent？直接开 Issue |

> [CONTRIBUTING.md](../CONTRIBUTING.md)

---

## 历史架构演进

编排引擎从 ao → DeepAgents → LangGraph 的升级史（v1.2.0 起 FORGE loop 已完全弃用 deepagents，改用 createReactAgent；历史编排引擎的 DeepAgents 调度原型见 v1.1.8 changelog）、Ontology 从实体关联到本体结构的渐进构建、外部框架对标（Palantir/gbrain/WeKnora/Runta）、Loop Engineering 全栈对照等详见 **[ARCHITECTURE.md](./ARCHITECTURE.md)** 的「行业印证」+「编排引擎」+「Ontology 本体结构」章节，以及各版本 **[开发日志](./changelog/)**。

> 📖 多设备同步方案见 [多设备同步指南](./guides/multi-device-sync.md)。

## 中期方向：FDE 节点注册表（Pattern Registry）

loop-engineering 社区将 7 个生产模式编入机器可读 `patterns/registry.yaml`（含 id/cadence/risk/skills/human_gates/token cost），使工具能自动工作。**sofagent 可做**：为 FDE 模板建 `fde-registry.yaml`，audit 引擎可直接读取——从手动排查到机器可读。

> 📖 来源：cobusgreyling/loop-engineering（MIT 开源）— [patterns/registry.yaml](https://github.com/cobusgreyling/loop-engineering/blob/main/patterns/registry.yaml)

## 远期方向：执行层面隔离（Worktree 模式）

loop-engineering 要求每个 code-change 跑在隔离 git worktree 里——一次 fix 一个 worktree，拒绝则丢弃。这是 sofagent **当前明确的差距**。实现路径：**短期（v1.x）** 在 DEVELOPMENT 中记录为推荐实践 → **中期（v2.x）** 编排引擎内置 `sofagent worktree create` → **远期（v3.x+）** L2+ 硬性要求。

> 📖 来源：cobusgreyling/loop-engineering（MIT 开源）— [primitives.md](https://github.com/cobusgreyling/loop-engineering/blob/main/docs/primitives.md) / [anti-patterns.md](https://github.com/cobusgreyling/loop-engineering/blob/main/docs/anti-patterns.md)

## 远期方向：理解债务应对策略（Comprehension Debt）

loop-engineering 的 Comprehension Debt Spiral（理解债务螺旋）被评为 S2 级故障模式：速度上升但无人能解释变更 → 自动化成了黑箱。sofagent 的应对：**审计已覆盖**「发生了什么」→ 需新增「为什么这么做」（auto-PR 描述中要求 Agent 解释决策）→ 需新增「本周摘要」（daemon 周报）。核心认知：理解债务是工具的边界，不是失败——自动化越高，人类判断责任越大。

> 📖 来源：cobusgreyling/loop-engineering（MIT 开源）— [failure-modes.md](https://github.com/cobusgreyling/loop-engineering/blob/main/docs/failure-modes.md)
