# Agent 方法论（建 → 评测 → 进化闭环）

> 来源：PenguinHarness (github.com/Prism-Shadow/penguin-harness, Apache-2.0, LlamaFactory 作者 Yaowei Zheng)
> 方案：**D — Skill 层借鉴**（不引入代码依赖，提炼方法论重新写成 sofagent 自己的 Skill）
> 日期：2026-08-09（2026-08-16 从桌面归档进仓库）
> 作者：孔放勋
>
> 📌 **已归档 · 方法论已 100% 落地**：本文四个 Skill 的方法论（agent-creation / benchmark-design / agent-evaluation / agent-optimization）已全部消化进 v1.3.1（Benchmark 评测 + 工具审批 + L4 渐进加载 + 错误收敛）、v1.3.2（agent-creation + fidelity raw 字段 + Session 隔离）、v1.3.3（进化闭环：严格提升 + 污染检测 + 可证伪 + 回滚）。本文保留作「方法论溯源」——为什么这么设计、借鉴了谁、版本怎么分配。

---

## 一、为什么不直接依赖 PenguinHarness 代码

| 维度 | PenguinHarness | sofagent | 冲突 |
|------|---------------|----------|------|
| 安全模型 | Agent 可自改一切（AGENTS.md / Skills / config 全可编辑） | 约束层不可碰（SKILL.md L1 硬约束 = 审计铁律） | **根本冲突** |
| 技术栈 | TypeScript + pnpm monorepo + Electron | TypeScript + npm workspace（无 Electron） | 不兼容 |
| Agent 运行时 | Penguin CLI（自有 ReAct 引擎） | createReactAgent（@langchain/langgraph） | 重复造轮子 |
| 路径约定 | `agents/<id>/agent_state/` | `data/<project>/agents/<id>/` | 结构不同 |
| 配置格式 | `system_config.yaml` + `AGENTS.md` | 约束层四层加载链（L1-L4） | 哲学不同 |

**结论**：PenguinHarness 的精华在 Skill 方法论（怎么建 Agent、怎么设计评测、怎么闭环优化），不在底层代码。我们学方法论，用 sofagent 术语和架构重新写。

---

## 二、四个 Skill 的方法论精华

### 2.1 agent-creation（v7）—— 一句话需求 → 可用 Agent

**核心流程**：
1. 从一句话需求推导角色（Role）+ 域规则（Domain guidance），不追问
2. 解析继承的运行时（provider/model_id 成对继承，thinking_level 独立）
3. 写 AGENTS.md（注入 system prompt 的行为层，简洁——角色句+引用规则+拒绝规则）
4. 安装 Skill（frontmatter 自动注入 system prompt，不需要手动注册）
5. 验证并报告（parse config → 确认非空 → 确认 skill name 匹配目录名 → 确认未动其他 Agent）

**sofagent 可借鉴点**：
- 「需求→角色+域规则」的推导方法论——FDE 离场后给客户搭 subagent 的核心能力
- 「只安装需要的 Skill」的精简原则——避免过度配置
- 验证清单——建完 Agent 后自动检查结构完整性

### 2.2 benchmark-design（v7）—— 评测题库设计 + 校准

**核心机制**：
- **Statement / Rubric 物理分离**——statement 公开给被测 Agent（只描述任务），rubric 私有（评分标准 + Gold 答案），**statement 中绝不放 Gold**
- **0..100 固定分值**——每 Case 100 分，partial credit，分数集中在"能区分强 Agent 和弱 Agent"的决策点
- **Pilot 校准**——初稿是假设，跑一轮看 Agent 怎么解题，再调难度
- **Freeze + Formal Baseline**——校准满意后冻结，记录 Formal Baseline（后续优化的参照系）
- **能力契约（Capability Contract）**——先写"测什么能力、弱 Agent 会走什么捷径、好 Agent 应该怎么做"，再出题
- **信息差/冲突是合法的**——公开信息可以不完整或冲突，rubric 可以编码私有判定标准

**sofagent 可借鉴点**：
- statement/rubric 物理分离——防泄露的根本设计
- Pilot 校准方法论——初稿是假设，不是终稿
- 能力契约先行——先定义"测什么"再出题
- Freeze 机制——评测标准稳定后才能做有意义的优化对比

### 2.3 agent-evaluation（v5）—— 隔离执行 + 协议化输出

**核心机制**：
- 一个请求 = 一次隔离执行（独立 workspace，只暴露 statement，看不到 rubric）
- 协议化 YAML 输出（protocol_version / status / score / cost / duration_ms / session_id）
- 静默执行（不输出 narration/summary，只输出协议 YAML）
- 四种失败码：invalid_request / benchmark_invalid / version_changed / evaluation_failed
- 成本从 Trace 读取（不查外部定价服务），缺失写 null（不影响评分有效性）

**sofagent 可借鉴点**：
- 隔离 workspace + 只暴露 statement——评测公正性的技术保障
- 协议化输出——标准化评测结果，便于自动化对比
- 失败码体系——区分"Agent 没跑起来"vs"Agent 跑了但答错了"

### 2.4 agent-optimization（v9）—— 严格提升才接受，否则回滚

**核心循环**：evidence → hypothesis → Candidate → evaluation → accept or rollback

**关键规则**：
- **strictly improves**：Candidate 分数严格 > Reference 分数才接受，否则 git snapshot 回滚
- 版本号只增不减，不重用被拒绝的版本号
- 改前必须创建快照（`snapshots/v<version>.tar.gz`），快照失败不改
- 污染规则：私有评测信息进入优化器上下文 → 立即恢复 Candidate 并停止
- 可证伪假设：优化前预测"哪些行为应该变化"，验证假设是否成立（即使假设不成立但分数提升，仍接受）

**sofagent 适配——最关键的收窄**：

| PenguinHarness 可改范围 | sofagent 允许改的范围 | sofagent **禁止**改的范围 |
|-------------------------|----------------------|--------------------------|
| AGENTS.md | think.md（L2 决策约束） | SKILL.md（L1 硬约束） |
| Skills | knowledge/（L4 经验层） | 审计规则（A1-A23） |
| system_config.yaml | 质量规则集 | 回溯机制（git snapshot 逻辑） |

> ⚠️ **这是方案 D 的灵魂**：PenguinHarness 的优化器可以改 Agent 的一切；sofagent 的优化器只能改经验层（L2+L4），约束层（L1+审计+回溯）永远不可碰。这是「约束 Agent 行为」哲学的底线。

---

## 三、sofagent 术语映射

| PenguinHarness 概念 | sofagent 对应概念 | 映射说明 |
|---------------------|-------------------|----------|
| Agent State | Agent 配置 = SKILL.md(L1) + think.md(L2) + knowledge/(L4) | sofagent 四层加载链 |
| AGENTS.md | think.md（L2 决策约束） | 行为指导层 |
| Skills (`skills/`) | knowledge/（L4 经验层） | 可学习的经验知识 |
| system_config.yaml | permission.json + Agent 元信息 | 运行时配置 |
| Builder Session | FDE Agent（建 Agent 的人） | 建完后离场 |
| Test Agent | 被评测的 AI 节点 | 客户 workflow 里的节点 |
| Benchmark | 能力评测题库 | statement + rubric 物理分离 |
| Formal Baseline | 基线评分 | 优化前的参照系 |
| run_subagent | createReactAgent 隔离实例 | langgraph 复用 |
| Penguin CLI | sofagent MCP tool（evaluate / optimize） | sofagent 原生工具链 |
| scoreboard.yaml | evaluation-log.jsonl | 审计链格式 |
| snapshots/v<n>.tar.gz | git snapshot（已有回溯机制） | sofagent 天然有 git |
| agent-creation Skill | Onboard Agent（建节点） | v1.3.2 |
| benchmark-design Skill | Benchmark 评测体系 | v1.3.1 |
| agent-optimization Skill | Refine Agent + Dream Cycle（优化节点） | v1.3.3 |

---

## 四、三步落地路线图

### Step 1：Benchmark 评测体系（v1.3.1）

| 能力 | 来源 | 适配 |
|------|------|------|
| 能力评测题库设计 | benchmark-design | statement/rubric 物理分离 + Pilot 校准 + Freeze + Formal Baseline |
| 隔离执行 | agent-evaluation | 独立 workspace + 协议化 YAML 输出 + 四种失败码 |
| 评测结果记录 | scoreboard.yaml | sofagent evaluation-log.jsonl（审计链格式） |

**落地形态**：作为 Onboard Agent L1 的前置能力——节点建完后，先跑 Benchmark 确认"能不能用"，再做 Onboard 的 crash/error 修复。

### Step 2：agent-creation 方法论（v1.3.2）

| 能力 | 来源 | 适配 |
|------|------|------|
| 需求推导 | agent-creation §Write AGENTS.md | FDE 离场后自动推导节点角色 + 域规则 |
| Skill 安装 | agent-creation §Install skills | 从 knowledge/ 库安装对应经验（只装需要的） |
| 验证清单 | agent-creation §Validate and report | 建完后自动检查结构完整性 |

**落地形态**：作为 Onboard Agent 完整版的核心能力——不只是检测 crash，而是从需求到配置全自动推导。

### Step 3：进化闭环升级（v1.3.3）

| 能力 | 来源 | 适配 |
|------|------|------|
| 严格提升才接受 | agent-optimization §Decide | **改为只动经验层（L2 think.md + L4 knowledge/），不动 L1** |
| 快照+版本号回滚 | agent-optimization §Build and roll back | 复用 sofagent 已有 git snapshot 回溯机制 |
| 污染检测 | agent-optimization §Access and changes | 私有评测信息进入优化器 → 立即恢复 + 停止 |
| 可证伪假设 | agent-optimization §Optimization loop | 预测行为变化 → 验证（即使假设不成立但分数提升仍接受） |

**落地形态**：升级 Refine Agent——从"质量规则集驱动"进化为"Benchmark 驱动的 Dream Cycle"，配合 v1.3.3 团队协作的反馈放大机制。

---

## 五、版本分配

| 版本 | 嵌入的 PenguinHarness 能力 | changelog 章节 |
|------|---------------------------|---------------|
| v1.3.1 | Benchmark 评测体系（benchmark-design + agent-evaluation） | §Benchmark 评测体系（Onboard L1 前置） |
| v1.3.2 | agent-creation 方法论 | §agent-creation 方法论（Onboard 完整版核心） |
| v1.3.3 | 进化闭环升级（agent-optimization） | §进化闭环升级（Refine + Dream Cycle） |

> v1.3.0 不塞——已满 10 个交付项，且 Benchmark 评测依赖 Onboard Agent 基础设施。

---

## 六、扩展思考：还有哪些可参考

### 6.1 工具审批机制（可补进 v1.3.0 wrapToolCall）

PenguinHarness 的 `--approve` 参数控制每个 tool_call 的审批：

| 模式 | 行为 |
|------|------|
| `allow-all` | 全部允许 |
| `deny-all` | 全部拒绝 |
| `read-only` | 只允许读取类工具 |
| `always-ask` | 每次都问 |

**核心设计**：保守默认拒绝——`approve` 省略时拒绝一切；审批继承——子 Agent 继承父 Agent 审批回调。

**sofagent 参考**：v1.3.0 规划的 `wrapToolCall` 运行时拦截可以引入 read-only 模式——Benchmark 评测时 Test Agent 只需要读取 statement + 产出 artifact，不需要写文件/执行命令。这样评测更安全、更隔离。

### 6.2 渐进加载（优化 L4 经验层的 token 消耗）

PenguinHarness Skill 系统：系统提示只注入 frontmatter（name + description），body 用 `read_file` 按需读取。

**sofagent 参考**：L4 经验层（knowledge/）目前可能是全量注入。如果经验条目多了，可以改成「索引注入 + 按需读取」——系统提示只有标题 + 摘要，Agent 需要时用 `read_file` 拉全文。节省 token。

### 6.3 错误收敛为消息（context_engine 设计哲学）

PenguinHarness 的 ReAct 循环：LLM 和工具永不向引擎抛异常，错误变成消息供模型反应。

**sofagent 参考**：当前 Agent 遇到工具失败可能直接中断。可以改为「错误收敛为消息」——工具失败时返回一条结构化消息（`{status: "tool_error", tool: "...", error: "..."}`），让 Agent 决定是否重试或换方案。这比直接 throw 更鲁棒。

### 6.4 OmniMessage 的 fidelity 字段（无损回放）

PenguinHarness 的 OmniMessage 协议有 `fidelity` 字段——provider 透传原始响应，不做归一化，支持无损回放。

**sofagent 参考**：审计日志（audit-log）目前记录的是归一化后的事件。可以增加一个 `raw` 字段，保存 LLM 原始响应——回溯时可以看到模型到底说了什么，而不是只看提取后的事件。这对调试 Agent 行为很有价值。

### 6.5 快照+版本号回滚（sofagent 已有，可强化）

PenguinHarness 的 `snapshots/v<version>.tar.gz` + 版本号只增规则。

**sofagent 参考**：sofagent 已有 git snapshot 回溯机制，但当前是项目级的。可以引入 Agent 级版本号——每次优化前后都打 snapshot，版本号递增。这样回溯更精细——不只回滚整个项目，还能回滚单个 Agent 的某次优化。

### 6.6 两个独立 Session 的架构分离（Builder vs Optimizer）

PenguinHarness 自我进化循环用两个独立的 top-level Session：
- **Builder Session**：建 Agent + 设计 Benchmark，产出 Formal Baseline
- **Optimizer Session**：基于 Baseline 跑优化循环

两个 Session 之间通过 scoreboard.yaml 传递数据，互不干扰。

**sofagent 参考**：当前 FDE Agent 和 Onboard Agent 是串行的。可以考虑也做 Session 级隔离——FDE 建 Agent 和 Benchmark（离场后不再参与），Onboard/Refine 在独立 Session 里跑循环。这样优化循环不会污染 FDE 的上下文。

---

## 七、设计决策记录

| 决策 | 结论 | 理由 |
|------|------|------|
| 是否 npm install PenguinHarness | ❌ 不装 | 安全模型根本冲突 + 技术栈不兼容 |
| 是否 fork PenguinHarness 代码 | ❌ 不 fork | 精华在 Skill 方法论不在代码 |
| 是否抄 Skill 原文 | ❌ 不抄 | 引用 AGENTS.md/system_config/run_subagent 等 sofagent 不存在的东西 |
| 怎么落地 | ✅ 学方法论重新写 | 用 sofagent 术语和架构（四层加载链 + 审计 + 回溯）重新表达 |
| 放什么版本 | ✅ 分三步：v1.3.1 / v1.3.2 / v1.3.3 | v1.3.0 已满，且有前置依赖 |
| 优化范围 | ✅ 只动经验层（L2+L4） | 约束层（L1+审计+回溯）永远不可碰——这是铁律 |

---



| 文件 | 位置 |
|------|------|
| PenguinHarness GitHub | https://github.com/Prism-Shadow/penguin-harness |
| PenguinHarness Docs | https://penguin.ooo/docs |

> 原始 SKILL 文件（agent-creation / benchmark-design / agent-evaluation / agent-optimization）见 PenguinHarness GitHub 仓库 `skills/` 目录——本仓库不归档原文，方法论已重写进 sofagent 对应实现（见各版本 changelog「设计来源」标注）。
