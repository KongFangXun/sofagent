# 厂商实证全文（原 docs/VALIDATION.md §一 厂商实证 · doc-slim 批 2026-09-28 搬出）

> 原节：DeerFlow / DeepSeek Harness / OpenAI Codex Harness / OpenAI Agents API 公测 / Anthropic 产品真相 / Codex Guardian / Omnigent / DataFlow / OpenFDE（:136-272 区段）。正文处已收敛为台账行，全文在此。

**▍厂商实证——Harness 品类被多方独立验证（DeerFlow / DeepSeek / OpenAI / Omnigent / DataFlow / OpenFDE，逐家印证「约束层」是行业共识）**

### DeerFlow：大厂用「Harness」命名

字节跳动开源的 [DeerFlow 2.0](https://github.com/bytedance/deer-flow) 自称 **"super agent harness"**——与 sofagent 的 **Harness 中间件**品类判断**字面一致**。这是继 OpenAI《Harness Engineering》、Anthropic《Effective Harnesses》之后，**又一家头部厂商用 Harness 命名 Agent 运行时框架**，说明这个品类词已经站住。

但 DeerFlow 是 River 比喻里的**「河」**（运行时框架，让 Agent 跑起来的基础设施），sofagent 是**约束层**（让 Agent 别跑偏 + 审计它跑过什么）——两者定位互补，不冲突：

| 维度 | DeerFlow | sofagent |
|------|---------|---------|
| 本质 | Super Agent 运行时框架 | 约束层（Harness） |
| 语言/栈 | Python (FastAPI + LangGraph + uv) | TypeScript/Node |
| 安全在哪 | 运行时（沙箱 + fail-closed + 中间件链 26 步）| 提交时（git diff 25 条规则）+ 运行时约束（SKILL.md）|
| 部署重量 | Nginx + Gateway + Postgres，起步 8C16G | `bash install.sh`，仅需 Node.js ≥ 18（无外部基础设施依赖） |
| 约束方式 | 需 Agent 跑在它的框架里 | 看 git diff，Agent 在哪跑都行 |

**给我们的背书**：① Harness 品类被字节用真金白银验证；② LangGraph createReactAgent 是编排事实标准（双方都选）；③ 控制平面打法（runtime 内嵌 gateway = 控制平面）是行业共识。**给我们的启发**（进 ROADMAP 与开发日志）：中间件链设计、Skill 质量门禁 + content-hash、Session Goals、ToolOutputBudget、多 worker 租约安全语义——详见 [ROADMAP · 行业印证](../../ROADMAP.md#行业印证)。

> 📖 来源：DeerFlow 2.0 README（github.com/bytedance/deer-flow），2026-02-28 登顶 GitHub Trending #1

### DeepSeek Harness：模型厂商验证「Harness 独立于模型」

DeepSeek 2026-08-13 开源 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`Agent = Model + Harness` 公式的开源运行时，**星数 100.5k 为早期快照，@2026-09-25 复测 23.6 万** · MIT · developer preview）：[Cordis](https://github.com/cordiverse/cordis) 微内核只管插件加载/卸载/依赖解析，模型适配器、工具注册表、会话日志、
Agent 循环本身全是插件——**厂商级验证了「Harness 独立于模型、可整体组合替换」的品类判断**。

与 DeerFlow 同为运行时（河），sofagent 同为约束层（堤），但 DSH 的特殊价值在于它是**模型厂商**做的开源运行时，且其机制与 sofagent 深度同构：

| 维度 | DeepSeek Harness | sofagent |
|------|-----------------|----------|
| 本质 | Agent 运行时（一切皆插件） | 约束层（Harness） |
| 谁做的 | DeepSeek（模型厂商） | 开源社区 |
| 可逆性 | 可撤销效应：每次修改记录逆操作，卸载逆序恢复 | git snapshot 回滚 + 审计日志记录「做了什么+如何撤销」 |
| 事件留痕 | append-only Trajectory（恢复/分叉/回放共享事件流） | 审计日志 + decision-log |
| 权限模型 | 两旋钮正交：沙箱（文件效果边界）× 审批（决策通道，fail-closed） | v1.3.7 场景驱动权限（设计轴对齐） |
| 审计入口 | `tools/result` 观察不可变权威结果 | git diff 25 条规则（提交时） |

**给我们的背书**：① 模型厂商把「模型之外的能力全拆成插件」——Harness 与模型解耦不是创业公司的一厢情愿，是头部模型厂商的路线判断；② Cordis 论文（[时空可组合性](https://github.com/cordiverse/paper)）「自进化的难点是修改后的可恢复与可协调，不是生成能力」与 sofagent「进化必须以可撤销为前置条件」同构；③ DSH 任务面板缺验收标准、修改流程缺回归声明（生态级 Eval 缺口）——sofagent 审计模块正是补这个缺口的插件候选（v1.4.0 `@sofagent/cordis-plugin`）。

> 📖 来源：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 官方仓库 docs/（architecture + cordis-tutorial，2026-08-15 核验），MIT

### OpenAI Codex Harness：头部模型厂商把「Harness 决定 Agent 表现」官方量化

OpenAI 2026-08-19 全面开源 [Codex Harness](https://github.com/openai/codex)（Apache-2.0，107k+ stars）——驱动 Codex App/CLI/IDE 的底层执行框架（对话状态、工具调用、沙箱执行、流式输出、人工审批）。
开源的是**三层集成接口**而非模型：`codex exec`（轻量非交互 CLI）+ Codex SDK（TS 程序化编排，支持任意 OpenAI 兼容端点模型切换）+ `app-server`（持久会话产品层，官方原话 "your application owns product context, business rules, and tools; Codex app-server provides the agent loop"）。

**给我们的背书——官方量化「Harness 决定 Agent 表现」**：OpenAI 在 ARC-AGI-3 基准上仅对 Harness 做两项调整（保留推理 + 上下文压缩），GPT-5.6 Sol 得分从 **13.3% → 38.3%**，输出 token 消耗**降 6 倍**——「模型能力 × Harness 设计 = Agent 最终表现」被头部模型厂商官方数据实证，正是 sofagent「模型给 90% 智力、约束层补 10% 可靠执行」叙事的最强外部锚点。

> ⚠️ **量纲限定**：该数据证明的是 **Harness 设计显著影响表现**——而这里的「表现」是**能力型**的：保留推理 + 上下文压缩提升的是**任务得分与 token 效率**。sofagent 主张的是**治理型**约束层提升**可靠性**（该做的事都做、不该做的不做、做错退得回）。**两者非同一量纲**，故本数据仅作**方向性信号**（「Harness 这个层很重要」），**不得**读作可靠性收益的量化依据；与既有「厂商自测只作量级参照」纪律一致。

**与 sofagent 的工程同构点（仓库源码核验，2026-08-22）**：
| 维度 | Codex Harness | sofagent |
|------|--------------|----------|
| hook 体系 | Claude Code 兼容生命周期 hooks（`pre-tool-use` / `post-tool-use` / `permission-request` / `subagent-start` / `session-start`，JSON in/out 命令行引擎） | 约束注入链 + audit（提交时 git diff）+ HITL 钩子 |
| 身份码 | Ed25519 agent-identity（JWKS 签发） | v1.3.1 Agent 身份码 Ed25519（同构） |
| 审批 | 内建 HITL（关键操作暂停请求人类确认）+ 多 permission_mode | 工具审批四模式 + HITL 钩子 |
| 分发 | 插件市场（marketplace.json，兼容 `.claude-plugin` / `.cursor-plugin` 格式 + 企业 allowlist/restricted 策略） | ClawHub/SkillHub 分发（双生态） |
| 沙箱 | 内建沙箱（Landlock + seccomp / Windows sandbox） | v1.3.7 SubAgent 沙箱 |

**sofagent 挂载机会**：Codex 的 `pre-tool-use` hook 与 DSH 的 `tools/pre-execute` **功能同构**（工具调用前拦截 + permission_mode），且 hook 协议是 Claude Code 兼容的 JSON 命令行格式——sofagent 审计/拦截可作为 Codex 生命周期 hook 挂载（v1.4.0 OpenClaw plugin 家族之外的第三个生态位候选，排期待议）。

> 📖 来源：[openai/codex](https://github.com/openai/codex) 官方仓库（2026-08-22 源码核验）+ [Codex as a platform](https://developers.openai.com/blog/codex-as-a-platform)（openai.com，2026-08-19），Apache-2.0

### OpenAI Agents API 公测：Harness 托管商品化与治理壁垒收窄（2026-09-10）

OpenAI 2026-09-10 把驱动 Codex 的 Harness 通过 [Agents API](https://openai.com/index/introducing-the-agents-api/) 公测开放——"Build and run cloud agents with the Codex harness, fully managed by OpenAI"。
这是继 2026-08-19 开源 Codex Harness 后的第三个独立数据点：**模型厂商不仅开源 Harness，还把 Harness 托管做成零平台费的基础设施**（无额外费用，只收 token/工具/容器钱）。

**关键架构事实**：Harness（循环/会话/压缩/子Agent）永远 OpenAI 托管；Environment（执行沙箱）可选 OpenAI 托管/自托管/9 家伙伴（Cloudflare、Modal、E2B 等，支持 VPC 内部署）——**自托管的只是执行环境，控制平面与执行平面在架构上分离**。
四大能力全是过去开发者自造的轮子：自动上下文压缩（跨多窗口，无需自建 compaction）、tool search（按需加载工具定义降 token 保 cache）、programmatic tool calling（代码并行/链式/过滤，只回传关键结果）、multi-agent 原生（subagent 各自独立上下文）。

**对我们的意义——两条战略判断被官方一手源实证**：

1. **编排层护城河在消失**：loop 管理、上下文压缩、工具编排、多 Agent 编排正在变成免费绑定的 API 能力（得到大脑解读：企业差异化收窄到「业务上下文、可信数据、actions、权限控制、人工审批」——这份清单几乎逐字就是 sofagent 能力面）。壁垒表述随之收窄：**不在 harness 工程，在治理工程**（25 规则 / HMAC 链 / 本体数据 / 审批流）——与 Codex ARC 数据的量纲限定同理（能力型表现 ≠ 治理型可靠性），治理壁垒不会被基础设施商品化覆盖。
2. **压缩不是审计记录**（compaction 后原始内容不可恢复）——印证审计证据链必须独立落盘的设计：sofagent HMAC 链 + runs/ 产物从不依赖模型上下文作证据。推论：若业务 Agent 跑在托管 harness 上，审计接入点必须在 event 流层（router_exporter / trajectory 采集），不能依赖平台会话存储。

客户证言数字（官方博客 8 条之一）：Ciridae 评分 0.71→0.85、subagent 流程 4 倍延迟降低；SafetyKit 每案成本 −60%；Hypha harness/沙箱分离后失败响应 −86%。第三方分析口径：仅美国数据驻留、不支持 ZDR——中国企业客户硬门槛，一体机私有部署（27B 稠密）的官方背书市场缝隙。

> 📖 来源：[Introducing the Agents API](https://openai.com/index/introducing-the-agents-api/)（openai.com，2026-09-10 · 官方博客 · A 级源）+ 得到大脑视频解读（2026-09-15，第三方表述框架）

### Anthropic 产品真相收敛：运行的生产代码是产品最可靠的事实来源

Anthropic 设计负责人 Joel 分享的产品方法论判断：产品文档会过期、设计稿会过期、在线文档会过期——**真正运行的生产代码里存着此刻真实的功能规则、设计系统和产品逻辑**，因此产品、设计、研发的边界会围绕真实运行的系统重新组织。对 sofagent 的印证价值：审计模块「不看 Agent 说什么，看 git diff 留下什么」正是这一判断的治理面工程化——把「产品真相」锚定在运行系统的一手输出而非任何转述层，与 PHILOSOPHY 证据链（一手信息优先、二手声明不进证据链）同源。
附带印证：AI 时代「生产能力不再稀缺、选择能力开始变贵」（供给暴涨而需求注意力不变，价值落差靠判断去填）——与「判断力上移」这一既有命题（执行可外包、判断不可外包）及 90/10 价值分层同构，不另立命题。

> 📖 来源：Anthropic 产品设计负责人 Joel 访谈（得到大脑解读，2026-09-14，第三方表述框架——一手访谈出处未核验，按单源第三方对待）

### Codex Guardian 模块：审查结论的失效语义（2026-09-16 源码核验）

codex-rs 深处有个此前未研究过的 [guardian/](https://github.com/openai/codex/tree/main/codex-rs/core/src/guardian) 模块（约 340KB，测试过半）——「宿主审批决策 + 隔离的同步审查者」。
模块文档一句设计哲学值得引用：*"The extension chooses policy and evidence; core enforces permissions and mandatory review requirements"*（扩展选策略与证据，核心强制权限与强制审查——与 sofagent「插件定义规则、引擎统一执行」同构）。

**对我们最有价值的是一套此前没有的语义——审查结论何时失效**（`GuardianReviewReason` 枚举）：`FreshRequired`（需新鲜结论）/ `StaleScore`（分数过期）/ `AuthorizationChanged`（授权变更即失效）/ **`IncompatibleCompaction`（压缩与审查结论不兼容即作废重审）** / `ElevatedRisk` / `ScoringFailure`。sofagent 现状：审计结论与 HITL 授权一经产生即视为永久有效，无失效条件。
`IncompatibleCompaction` 是「压缩不是审计记录」的**工程化背书**——官方把 compaction 明确列为审查结论的作废条件，比叙事判断更硬。配套语义：审批粒度 `Granular`（五类开关，关闭即**自动拒绝而非静默吞**——fail-closed 不打扰人）与按 host 粒度的网络出口审批（`NetworkApprovalContext{host, protocol}`——管进也要管出）。

> 📖 来源：[openai/codex guardian/](https://github.com/openai/codex/tree/main/codex-rs/core/src/guardian)（2026-09-16 源码核验，mod.rs + approvals.rs + protocol.rs），Apache-2.0

### Omnigent：meta-harness 把策略强制在基础设施层

[Omnigent](https://github.com/omnigent-ai/omnigent)（Databricks 系团队开源，Apache-2.0，alpha，31 天 7091 star）自称 **meta-harness**——坐在 Claude Code / Codex / Pi 等 harness 之上的一层。它把我们的「Harness 中间件」判断又往前推了一步，给了两个可引用的硬证据：

1. **策略在基础设施层强制，不在 prompt**：原文——*stateful, contextual policies ... enforced at the meta-harness layer, not via prompts*。它的权限策略能「在 Agent 刚装了未审查的 npm 包后，拦截下一次 git push 要求人工批准」——因为 prompt 指令无法知道 Agent 刚装了包，而基础设施层可以追踪动态状态、在动作发生**前**拦截。
  这与 sofagent「文字约束每次注入=投喂 → 必然被吞噬 → 生存位=封装进 SubAgent（代码层）+ 防投喂机制」**是同一个结论，只是人家的工程化版本**。
2. **密钥不进 Agent 进程**：OS 级沙箱（Omnibox：Linux bwrap+seccomp / macOS seatbelt）锁文件系统，egress proxy 在 approved 出站请求时才注入 GitHub token / API key，Agent 进程永远看不到明文凭证。这是「架构级强制」，不是「别泄露凭证」的指令。

**与 sofagent 的边界（互补，不冲突）**：Omnigent 管**运行时**（坐在 harness 之上，拦截工具调用）；sofagent 管**提交时**（git diff 25 条规则 + 运行时 SKILL.md 约束）。它的策略越重，越反衬「跨平台、本地留证、零依赖、提交时审计」是咱们的地盘。其路线图（GEPA 自动优化 / MemEx 持久记忆 / RLM 强化学习 / Server MCP 跨会话）尚未实现，方向登记进探索方向表按 W1–W5 准入判据评估（研究叙事，非版本承诺）。

**给我们的演进启示（已登记 ROADMAP）**：① 运行时审计可借 LangGraph middleware 的 wrapToolCall 接入点（咱们已用 createReactAgent）；② 密钥边界可借 bubblewrap/seatbelt + egress proxy 模式；③ 控制平面成本/路由层可借 LiteLLM。详见 [ROADMAP · 行业印证](../../ROADMAP.md#行业印证)。

> 📖 来源：[Databricks blog《Introducing Omnigent》(2026-06)](https://www.databricks.com/blog/introducing-omnigent)（官方一手源）· GitHub omnigent-ai/omnigent

### DataFlow：顶尖高校独立用「Harness」命名

[DataFlow](https://github.com/OpenDCAI/DataFlow)（论文 [arXiv:2607.16617](https://arxiv.org/abs/2607.16617)，HuggingFace Paper of the day）来自**北京大学 DCAI**团队——与 DeerFlow 2.0（字节）、Omnigent（Databricks）**同月**，再次以独立开源项目用「Harness」一词命名其 Agent 约束层。这是**第三个、且来自顶尖高校的第三方独立佐证**：Harness 作为 Agent 工程化品类的共识已非孤证。

它治理的是「数据流水线」（从噪声源生成 / 精炼 / 评估 / 过滤高质量 AI 数据），与 sofagent 治理「企业 AI 数字员工（装进 Agent 的 FDE Harness）工作流」对象不同，但**约束范式同源**：Agent 经 MCP server 作业而非自由写脚本、受控变异走 Request-Validate-Commit、用 DataFlow-Skills 结构化约束而非裸提示词——每一条都独立复现了 sofagent 的 scoped tool-gate / SKILL 约束层 / audit 判断。

其**独特点**是可借鉴方向：① **可视化 DAG 画布 + 双模态共享状态**（会话 Agent 与 DAG 画布实时同步同一 pipeline 表示）——补 sofagent Dashboard 缺的「workflow 可视图」；② **MCP server 集成**（暴露算子注册表 / serving / pipeline 状态给 Agent）——印证「对外 MCP 暴露 ontology/audit」是合理路线；③ **Validation Engine（DAG 无环 + schema 兼容）**——印证 ontology 从目录级升级为带 JSON Schema 校验的约束图。
以上可借鉴项已落入 [ROADMAP · 行业印证](../../ROADMAP.md#行业印证)。

**给我们的背书**：① Harness 品类被顶尖高校用真金白银验证（同月三家，含高校）；② 「约束 Agent 经受控接口、不自由写脚本」是跨团队共识；③ 我们的差异化仍在——DataFlow 只校验 pipeline 结构与 schema，**不审计 Agent 行为问责（无 append-only A1-A24）**，也无 7×24 常驻 FDE Harness 层与「控制平面治理」定位。

> 📖 来源：[DataFlow](https://github.com/OpenDCAI/DataFlow) + 论文 arXiv:2607.16617（2026-07，HuggingFace Paper of the day）

### OpenFDE：FDE 术语同源佐证

[OpenFDEAI/ChatDemo](https://github.com/OpenFDEAI/ChatDemo)（OpenFDEAI 组织，MIT）以 **Forward Deployed Engineer** 命名其「边聊边出 Demo」的售前工作流——FDE 坐在客户对面，边聊边把需求变成可点的 Demo，散会时客户手里已有一个能点的 Demo + 一页可确认的需求清单。
它和 sofagent 的**「前线部署工程师 / Forward Deployed Engineer」同源、同英文写法、来自同一 Palantir 脉络**——印证我们 FDE 术语的正统性：把工程师部署到客户现场、用一套纪律化交付流程、把经验沉淀为可复用资产，本就是行业共识的 FDE 内核。进一步佐证来自 OpenFDE **主仓**：它把 **INDUC 显式成 FDE Loop 的一个阶段、产出可开关的 Judgment Unit**（专家判断资产化、规则可开可关可版本化）——与我们「蓄水池/知识库 → A1-A24 判定层」同源，但它把知识归纳提升为 Loop 的一等公民阶段。

但两者**范围差一个数量级、且互补**：ChatDemo 的 FDE 是售前 POC 共创工具（Claude Code Skill + localhost 控制台，回合制 start/turn/wrap），散会即结束、无常驻员工；sofagent 的 FDE 是售后常驻部署+治理方法论（四阶段十二步→交付离场→sustain）。它做"漏斗前端"（拿 POC），我们做"漏斗后端"（常驻、可审计、受治理的硅基员工）——定位不冲突。

其**独特点**是可借鉴方向（已登记 [ROADMAP · 行业印证](../../ROADMAP.md#行业印证)）：① 回合制协议 + FDE 控节拍（人控 Agent 不抢跑，我们已有同判断、它执行更细）；② **spec-first 硬禁令**（transcript 永不直接驱动代码——补我们"触发直驱工件"的明文铁律，最高优先）；③ **decisions.jsonl 判断时刻日志**（{kind, moment, why, spec_ref} 现场即时记，会后喂 FDE Loop→INDUCE→Judgment Unit——补 A1-A24 缺的"决策理由链"，最高优先）；
④ 分级降级梯队（console→TUI、ASR→手敲、dev 挂→走 spec，workflow never stops——为 7×24 常驻员工补分级降级 SOP，最高优先）；⑤ 开源优先阶梯 + 预验证画廊 + 双引擎无状态 + 数据敏感度分层 + 一键启动器品牌化模板。

**给我们的背书**：① FDE 作为"前线部署工程师"的方法论术语，已被 OpenFDE 以 Forward Deployed Engineer 独立命名并工程化，与我们同源、互为第三方佐证；② "约束 Agent 经受控接口"的同源判断在售前侧也成立（ChatDemo 约束在"何时/权限/来源"）；③ 我们的差异化仍在——ChatDemo **无 A1-A24 运行时行为审计、无 7×24 常驻 FDE Harness 层、无控制平面治理、让 Agent 直接写应用代码**，这些是我们的地盘。

> 📖 来源：[OpenFDEAI/ChatDemo](https://github.com/OpenFDEAI/ChatDemo)（github.com/OpenFDEAI/ChatDemo，2026-07），OpenFDE 主仓 Open-FDE/OpenFDE

