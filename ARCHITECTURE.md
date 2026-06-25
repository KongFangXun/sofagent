# sofagent Architecture

> 一个不是很懂代码的产品经理，在设计 Agent 纪律层时都想了些什么。这里只写设计决策、权衡取舍、已知局限，以及为什么故意不做某些事。各节按 Handbook 章节顺序排列，方便对照。
>
> > v0.91 · 2026-06-25 · 孔放勋

<img src="images/sofagent.png" alt="sofagent" width="300" />

---

## 一、为什么会有 sofagent

AI 工程方法一直在往前走：Prompt Engineering 解决「怎么对 AI 说话」，Context Engineering 解决「AI 应该知道什么」，Harness Engineering 解决「AI 在什么约束下跑」。

到了这一步，剩下一个没人管的问题：**谁来按回车？**

Agent 跑完任务后，谁来告诉它「下一个任务是什么」？谁来确认「上一个任务做对了吗」？谁来记录「这次踩了什么坑下次别踩」？

Loop Engineering 解决的就是这个问题——设计一个自己会转的循环。sofagent 是这个系统：一个给 Agent 加的纪律层。它不跑你的任务，它管跑你任务的 Agent。

> 🧬 **硬层定义好，软层可进化。裁判碰不到，演化有人审。** 硬层（SKILL.md + rules.md）Agent 绝对不能碰；软层（scoring.md + think.md + orchestrator/）是数据不是代码，在客观验证信号下持续进化。

### 两层架构：地基 vs 引擎

sofagent 分两层——地基轻、引擎重，这是有意为之：

| 层 | 是什么 | 何时激活 | 占用 |
|:--:|------|:--:|:--:|
| 地基 | 三层加载链（宪法+反思+规则）| 每个会话启动，永远在线 | 上下文预算的 2-3% |
| 引擎 | 任务编排（拆解+Loop+闭环）| 🔴 复杂任务才点火 | 额外 ~1% （首次） |

地基是整个会话的前提（宪法、反思、偏好常驻上下文），引擎是任务级别的工具（只在 🔴 复杂任务时激活）。

<a id="why-resident"></a>
如果加载链只在复杂任务时才激活：

| 缺失的文件 | 后果 |
|------|------|
| think.md 反思区不在上下文 | Agent 不知道上次踩了什么坑，重复犯错 |
| rules.md 你的规则不在上下文 | 简单任务时你的偏好全部失效 |
| 只有 SKILL.md 底线 | 底线能用但行为规范丢失 |

治理底座必须永远在线，不管任务简单还是复杂。

### 产品架构展望（四层）

最终形态是四层，每层独立验证，下层为上层的底座：

| 层 | 部署在哪 | 干什么 | 当前状态 |
|:--:|------|------|:--:|
| **纪律层** | Agent 上下文 | 纯 MD 文件（SKILL.md + engine.md + think.md + rules.md），Agent 读即生效 | ✅ 已可用 |
| **执行层** | 用户设备 | daemon 常驻进程——跨 session 经验不丢失、定时清理。不依赖任何 Agent 平台 | ✅ v0.81 |
| **审计层** | git 仓库 | sofagent-audit——提交时审计 git diff，不依赖 Agent 配合 | v0.91 |
| **协同层** | 多设备 + 云端 | TaskBoard 云端管理 + 多设备任务分发 + 企业协同平台推送 | v2.x 规划 |

每层跑通再加下一层——不推翻已验证的东西。

<a id="skill-runtime"></a>
### 为什么是 Skill + 脚本 + Runtime，不是纯 Skill 或纯代码

一条任务下来，三样东西各司其职：

| 什么事 | 谁来做 | 为什么 |
|------|------|------|
| 判断（评分、反思、选模板、拆任务） | Skill（MD prompt 文件） | LLM 的长项——模式识别、定性判断、语义理解 |
| 机械操作（文件读写、API 调用） | 脚本（bash） | 确定性操作——复制、拼接、curl、计数 |
| 硬安全（加载链、断路器、死循环检测） | OpenClaw 原生配置 | Agent 失控时没法自己管自己，必须在外部兜底 |

LLM 管判断、脚本管执行、Runtime 管刹车——天然的分界。

#### 技术选型演进：bash → Node.js/TypeScript

bash 在纪律层阶段是对的（零依赖、透明、exit code 判断），但到了设备/审计/协同层是错的工具——分层演进：

| 架构层 | 合适的工具 | 为什么 |
|:--:|---------|------|
| **纪律层**（install/verify/task-record） | bash 保持不变 | 一次性执行、文件操作、exit code |
| **执行层**（daemon 常驻进程） | Node.js/TypeScript | 信号处理、子进程管理、定时调度 |
| **审计层**（sofagent-audit） | Node.js/TypeScript | git diff 解析、AST 检查、GitHub Action |
| **协同层**（设备控制器） | Node.js/TypeScript | 任务队列、多设备同步、API 推送 |

**触发条件**：bash 脚本数 > 20 或同一脚本重构次数 > 3 时评估迁移。选 TypeScript 因为提供类型安全，能避免 JSON 状态文件和 git diff 解析时的运行时错误。

<a id="white-box-loop"></a>
### 白盒循环：为什么不在 `/goal` 原版上直接跑

Claude Code 的 `/goal` 是纯黑盒——目标给出去后 Agent 闷头跑，方向歪了交回来的不是想要的。sofagent 把黑盒变成白盒：

| 我加的 | /goal 原版 | 为什么 |
|------|------|------|
| 用户确认 | 循环自主跑到底 | 不懂代码的人不敢让它黑盒跑——先看一眼提案再执行 |
| 硬层/软层分离 | 没明确切分 | SKILL.md 是硬层，Agent 碰不了；scoring.md + think.md 是软层，Agent 自己进化 |

白盒的关键不是加了确认按钮，是**用户和 Agent 一起把目标定清楚，再启动编排**。

### 文档膨胀控制

四份核心文档有硬性行数上限：Handbook ≤500 行 / Developer ≤600 行 / Design ≤600 行 / README ≤250 行。新增章节前必须先删一段旧内容——"加了就得减一点"。文档膨胀会让 Agent 上下文变重，也会让用户读不下去。

### 模型与 Harness 的博弈

模型会吃掉一部分 Harness——任务拆解、上下文选择、工具调用，这些能力模型自己越来越强。但生产级 Harness 不会死，它从「外部脚手架」升级成「生产级 Agent 运行的底座」。模型决定能想到哪步，Harness 决定能不能把事情做完。

Google 的 Anti Gravity 已将这个方向产品化——跨 Search/Gemini/Cloud/AI Studio 的统一 Agent Harness 运行框架。sofagent 选择「厚在治理」正是这个趋势的印证：模型越强，纪律层越重要（Agent 越强，闸门越重要）。

---

## 二、核心设计决策

> 一个不懂代码的人做的设计决策——有疑问直接开 Issue，我大概率说不过你。

<a id="500-char"></a>
### 500 字原则（[Handbook §一](./HANDBOOK.md#一厚在治理薄在复用)）

加载链里的每份文档——SKILL.md、rules.md——都有一个硬上限：500 字以内。超过 500 字 Agent 遵守率明显下降——规则在长文本里会被淹没，Agent 只挑它「看到」的几条遵守。加载链确保每层文件都落在模型的「开头注意力区」内——最后加载的（rules.md）优先级最高。

> 💡 500 字原则和「文件系统而非数据库」是同一枚硬币的两面——都是把信息密度做到极致。

### 三层加载链：为什么是这个顺序（[Handbook §二](./HANDBOOK.md#二三层加载链)）

从契约到执行，三层按「能不能改」分级：

| 层 | 文件 | 权限 |
|:--:|------|:--:|
| 1 | 契约层（`SKILL.md`（宪法内联）） | ❌ 千万别碰 |
| 2 | 反思层（`think.md`） | ⚠️ 自动生成，改了没用 |
| 3 | 执行层（`rules.md`） | ✅ 随便改 |

加载顺序受 Lost in the Middle 约束：SKILL.md 放最前面（开头注意力最高），rules.md 放最后面（末尾注意力最高）。技术实现用 OpenClaw hook 架构——声明式注册 `sofagent-load-chain` 监听 `agent:bootstrap` 事件。

### 铁律为什么是 10 则（[Handbook §三](./HANDBOOK.md#三底线与铁律)）

每一条对应日常使用中反复遇到的 Agent 失控行为——不是理论推演，是痛点积累：

| 问题 | 表现 | 对应的铁律 |
|------|------|:--:|
| 做完了没回复 | 子任务跑完了但没告诉用户 | #2 对用户有回应 |
| 出错继续跑 | 构建失败后 Agent 假装没看见继续下一步 | #3 验证再干 |
| 不看文件就写 | 没读项目代码就开始改，越改越乱 | #1 先读再用 |
| 编造数据 | 不知道就编，被揭穿才承认 | #10 如实汇报 |

前 4 条源于 Andrej Karpathy 的 [4 条编码原则](https://github.com/multica-ai/andrej-karpathy-skills)，后 6 条是实战翻车经历的工程沉淀。`rules.md` 是你可以自己改的，`SKILL.md`（宪法内联）是写死的——铁律兜底，rules 定制。

### 四级编排深度（[Developer §二](./DEVELOPMENT.md#二编排哲学)）

sofagent 的四级深度（完整编排 → 模板复用 → 轻量调度 → 自主执行）每一级都有明确的晋级和回滚条件。四级刚好覆盖了从「第一次跑这种任务」到「跑了 10 次以上闭着眼睛都知道怎么拆」的完整信任建立过程。

关键是回滚——每一级的放手都不是单向的，失败率回升就退回上一级。回滚用滑动窗口失败率（最近 5 次）而非连续失败次数：偶然失败不应触发回滚，趋势恶化才应该。

### Loop Agent：三节点顾问模式（[Developer §二](./DEVELOPMENT.md#二编排哲学)）

Loop 不是只发生在任务结束时——执行过程中（子任务间、预算过半、重大操作前）同样需要停下来检查方向。

**设计**：一个 Agent，三种模式（checkpoint / failure / closure），五个触发点。三节点覆盖了「阶段切换」「进度过半」「高风险」三种场景——不多不少。

**为什么是独立 Agent 而不是代码逻辑**：Loop 需要读 think.md（反思数据）+ task/logs（历史数据）+ orchestrator/（最优配置）做综合判断——这正是 Agent 的长项（语义理解、模式识别），不是脚本的长项。

**跨平台**：主 Agent 主动暂停调用——不依赖 Hook、不依赖代码拦截。全平台通用。

<a id="session-boundary"></a>
### Session 边界：为什么用百分比而不是轮次

主 Agent 持续监控两个指标：缓存占用 ≥50%，或 token 总量 ≥ 模型上限的 70%。任一超限即提醒用户新开会话。

为什么用百分比？因为模型上下文窗口在持续变大——百分比跟着硬件走，轮次限制是刻舟求剑。

**子 Agent 不参与这套机制。** 子 Agent 作用域窄（单子任务），设计上就是一个任务跑到销毁。如果子任务大到导致子 Agent 上下文溢出——那是编排拆得不够细。

<a id="worktree-isolation"></a>
### 子 Agent 并行时的文件隔离：为什么是 git worktree

多个子 Agent 并行操作同一代码仓库时，文件冲突是真问题。解决方式是 Worktrees：ao compose 拆任务时判断是否涉及同一仓库 → 涉及的话为每个子 Agent 创建独立 checkout → 完成后清理。

Worktree 不是全局默认——只在共享仓库场景下触发。选 git worktree 因为 sofagent 已经依赖 git，worktree 是 git 的原生能力，零额外依赖。

### ao compose 编排产物的位置

`ao compose` 生成的 YAML 存到 `.sofagent/orchestrator/workflows/`——定义角色、任务分解、依赖关系。**用户不用手写，看就行。**

### 渐进式披露：索引卡片不是路由机制，是上下文策略

索引卡片——每张卡 5 个字段、控制在 500 字符以内。主文件只告诉模型「这里有什么」，需要时再引导读取完整实现。好处：省上下文（先扫卡片再决定加载）、结构清晰（卡片是目录，实现是正文）、五要素对应渐进式披露三阶段（知道→判断→找到）。

### 不要写显而易见的事：Skill 写作的第一原则

核心原则：**不写模型已知的常识，只写它在这个任务上会犯的错、会漏的步骤、会搞错的数据格式。** Gotcha 章节（记录最常踩的坑）比功能介绍有价值得多——这和 think.md 同源：用反思驱动，不用常识灌水。

### 自然传播→收编：sofagent 信任机制的治理哲学

**不靠中心团队强管质量，靠自然使用筛选质量。** 门槛设高是因为 LLM 评分有波动——连续 3 次才可能是真材实料。

<a id="trust-levels"></a>

| 等级 | 条件 | 能接什么 |
|------|------|------|
| ✅ 已验证 | 你的评分 ≥ 4.0，使用 ≥ 3 次 | 任何子任务 |
| 🔶 试用中 | 社区评分 ≥ 4.0，还没用够 3 次 | 非关键子任务 |
| ⚠️ 未验证 | 社区评分 3.0–4.0，没用过 | 标 ⚠️ 放进提案，用户确认后再分配 |
| ❌ 不推荐 | 社区评分 < 3.0 | 过滤掉，不分配 |

升级/降级：连续 3 次 ≥ 4.0 自动升级；连续 3 次 < 3.0 降回试用。

<a id="deepseek-choice"></a>
### 为什么选 DeepSeek（[Developer §三](./DEVELOPMENT.md#三模型最优选择)）

默认推荐 DeepSeek，两条底线决定：

- **不碰 SaaS**：如果模型提供商能看到你的 task/logs、rules.md、think.md——那 sofagent 就是透明的。DeepSeek API 模式数据不经过第三方
- **成本可控**：Loop 机制每次任务额外消耗 2,000–5,000 token，API 按 token 付费每次不到 1 美分；SaaS 按 seat 付费成本不可控

模型选择是开放的——任何支持 API 的模型都能用。

### Flash 干粗活、Pro 干细活：模型分级的成本逻辑（[Developer §三](./DEVELOPMENT.md#三模型最优选择)）

Flash 和 Pro 差约 4 倍价，但简单任务 Flash 质量并不明显逊色。模型选择不是能力问题，是经济学问题。具体实现上是 OpenClaw 的 `sessions_spawn.model` 参数——API 级硬约束，不是「Agent 自觉」。

<a id="token-economics"></a>
### 编排开销的经济学：一次多花 3%，十次省回来

Loop 机制每次任务比裸跑多消耗约 2,000–5,000 token（约占 128K 窗口的 2–4%）。值得花——这些 token 用于沉淀最优拆法、记住踩过的坑、自动调整 Skill 信任等级。跑一次多花的 token，后面十次省回来了。

token 价格的长期趋势往下，每降一个数量级，编排开销的占比就缩一个数量级。

<a id="a-b-test"></a>
### A/B 测试为什么不是一次性评估

sofagent 的 A/B 测试是 4 步渐进沉淀：同一类任务做 3 次以上 → 某种拆法连续 2 次复盘最高 → 标记为候选模板 → 再跑 2 次依然稳定 → 正式沉淀进 orchestrator/。

保守是因为 LLM 复盘本身有偏差——一次高分可能是运气，连续高分才可能是规律。A/B 是持续进行的进化机制，不是一次性决策。

### 渐进初始化：为什么模板是单文件而非预建目录树

`scoring.md` 和 `orchestrator.md` 的模板描述了完整的树形目录结构，但部署时只有一个单文件——不是遗漏，是设计。

**两段式初始化**：安装脚本只创建根 `_index.md`，之后的枝叶由子 Skill 在运行时按需创建。理由：①懒创建（不预建空目录）；②动态分类（语义聚类决定分类名）；③平台无关（只描述格式协议）。

> 💡 这和「文件系统而非数据库」是同一个原则：不给 Agent 预建它可能用不到的结构。

### 复盘体系（[Developer §五](./DEVELOPMENT.md#五自进化机制)）

从六维评分起步，逐步加入「流程合规」和「Loop 有效性」两个维度。Loop Agent 在 closure 模式下作为独立角色做复盘评估——执行和治理分离。不跑 RL 训练，靠独立角色 + 复盘 + 冷启动保护做决策，零训练成本。

### LLM 复盘的信任边界（[Developer §五](./DEVELOPMENT.md#五自进化机制)）

复盘、权重计算、技能评估——全部由独立角色执行。同一组数据跑两次分数可能差出 0.1 到 1 分，但相比主 Agent 自评，排除了编排者的确认偏误。不追求「精确评分」，追求「趋势正确」——看最近 5 次的走向，而非单次绝对值。

<a id="cold-start"></a>
### 冷启动保护：没跑够不妄下结论

新 Skill 装上、新任务类型出现——没有历史数据对照。前 5 次只记录，不做任何判断。第 6 次起进入正常「看趋势」模式。样本不够时，LLM 的评分波动会被放大成错误决策——冷启动是给随机性加缓冲。

<a id="think-zone"></a>
### 反思区统一（[Developer §六](./DEVELOPMENT.md#六反思工程)）

think.md 是合并后的「错题本」——教训和经历存储在同一个上下文中。同一个坑踩了 5 次，反思区里只有一条记录，置信度从 0.3 涨到 0.7。更新模式是覆盖而非追加——从「记流水账」转为「提炼关键反思」。

<a id="weight-gate"></a>
### 活跃区权重门禁（[Developer §六](./DEVELOPMENT.md#六反思工程)）

只把权重 ≥0.5 的摘要放进反思区（≤2K token），其余丢进归档区。权重由三个信号计算：新鲜度（+0.3）、反思关联（+0.3）、引用热度（+0.1）。门禁 0.5 意味着一条记忆必须有至少两个信号支撑才能进反思区。真正的安全阀不是权重计算，是反思区的 2K token 硬上限。

<a id="self-correct"></a>
### 记忆自我纠正三道防线（[Developer §六](./DEVELOPMENT.md#六反思工程)）

think.md 既是产出（任务闭环后写入），又是加载链输入（下次启动读到）。写入出错会有连锁影响。三道防线：

**第一道：只存经验，不存指令。** 只记「上次做了什么、踩了什么坑」，不记「你应该怎么做」。写入前扫描指令性关键词 ≥3 处时提醒拆分到 rules.md。

**第二道：反思区 2K token 硬上限。** 即使反思评分出错，2K token 封顶，影响范围有限。

**第三道：人工可清除。** 发现 Agent 行为异常时，第一步查 think.md 删掉可疑条目。

sofagent 的失效标记机制（`[已失效] → 新事实 | 原因`）保留版本链不覆盖。**更短的精准上下文 > 更长的冗余上下文**。

### 不要 Connector（[Developer §七](./DEVELOPMENT.md#七数据文件架构)）

sofagent 是 Agent 治理层，不是软件工程自动化流水线。它的「外部世界」就是文件系统——task/logs、scoring/、orchestrator/、think.md。这些 Markdown 文件已经构成完整的可审计闭环。文件就是接口，Markdown 就是传输格式。

### 文件系统而非数据库（[Developer §七](./DEVELOPMENT.md#七数据文件架构)）

Agent 治理层最核心的数据是 task/logs——每次任务跑完后一小段 Markdown 摘要。选文件系统的三个原因：

- **无额外依赖**：`cat task/logs/2026-06-15.md` 就能拿到记录，不需要 SQL/连接串/权限管理
- **天然可审计**：`ls task/logs/` 就是审计入口，怀疑做错了决策打开文件看一眼
- **天然可传输**：`cat` → 推送，完事

额外好处：天然支持 Git——`git diff task/logs/` 看变化，`git log` 追溯决策时间。记忆架构按三层设计：task/logs 是原始账本（只追加不修改），think.md 反思区是提炼视图，权重门禁是控制策略。

<a id="tree-loading"></a>
### 树形加载：为什么是树而不是平铺

orchestrator/、scoring/ 这些目录可能有几百条记录——全读到上下文里不现实。数据文件用**树形目录 + 按需读取**：读 `_index.md` → 定位分支 → 只加载叶子文件，总量不超过 100 行。

语义聚类是动态的——今天叫「研发」明天叫「工程」都不影响。树形天然支持渐进式披露：先看目录再决定读哪页。

---

<a id="known-limits"></a>

## 三、诚实坦白：已知局限

> 17 条已知局限详见 **[LIMITATIONS.md](./LIMITATIONS.md)**。核心局限摘要：

| 局限 | 等什么 |
|------|------|
| 治理层自身在上下文里——约束力 = Agent 注意力 × 平台加载可靠性 | 架构宿命 |
| [加载链步进脆弱性](./LIMITATIONS.md#加载链步进脆弱性v060v062-验证结论)——非 OpenClaw 平台可能跳过 | 各平台支持 Hook |
| [复盘评分是 LLM 自评](./LIMITATIONS.md#复盘评分是-llm-自评评审者与执行者不分离)——评审者与执行者不分离 | v0.9x 外部评估器 |
| Skill 自进化处于经验记录阶段——单次轨迹不可靠 | v0.92 验证门控 |
| 定时触发做不到——只有「每次对话启动」一种 | 平台支持 cron |
| 不是分布式系统——没有 agent-to-agent 通信 | v2.x router |
| [核心效果缺持续数据](./LIMITATIONS.md#核心效果未实测)——11 Case 全是一次性测试 | 社区补持续使用 + A/B |

> 💡 其他文档引用已知局限时，统一指向 `LIMITATIONS.md` 对应锚点，不在各自文档里重复摘抄——改一处，全局生效。

---

## 五、未来方向

> 仅供后续版本设计参考。路线图详见 [ROADMAP.md](./ROADMAP.md)。

### 版本路线速览

- **v0.9x**：安全审查 ✅ → 审计层（sofagent-audit）→ daemon TypeScript 化
- **v1.x**：Skill 自进化验证门控（A/B 对比 + 外部评估器）→ 设备固件
- **v2.x**：多设备协同层 / 信号共享网络 → FDE 完整形态

**两个原则性警告**（贯穿所有版本）：①「不要让智能体自我验证」——根治需 v1.x 外部评估器；②「Agent 越强，闸门越重要」——不可因模型能力提升而拆除控制机制。

**设计原则**：sofagent 是 FDE 场景的纪律底座，不是 FDE 引擎。两者是工具和工具箱的关系——工具箱不替你干活，但保证工具不会伤手。

---

## 六、评审洞察

> 两份独立外部评审带来了 v0.85 的战略校准。完整分析见 [v0.85 开发日志](./docs/changelog/v0.85.md)。

### 洞察 1：三层差异化——约束层 / 纪律层 / 持久化层

| 层 | 当前能力 | 被覆盖程度 | 增量天花板 |
|:--:|------|:--:|:--:|
| **约束层**（base） | 4 底线 + 10 铁律的拒绝/追问行为 | 高——模型安全训练覆盖 | ★☆☆（<12 个月） |
| **纪律层**（value） | 先读再用 / 验证再干 / 谨慎修改 | 低——没有人替你管工程纪律 | ★★★★★（3-5 年） |
| **持久化层** | think.md + task/logs + daemon | 中——平台不会做本地文件治理 | ★★★☆（取决于执行） |

约束层是地基，纪律层是当前被验证的真价值层。

### 洞察 2：运行时治理 vs 提交时审计

| 维度 | 运行时治理（当前） | 提交时审计（新方向） |
|------|------|------|
| 依赖 Agent 配合 | ✅ 必须 | ❌ 不需要 |
| 跨平台 | ⚠️ OpenClaw 全功能，其他 30% | ✅ 任何 git 仓库 |
| Agent 能绕过 | ✅ 能 | ❌ 不能（看的是 diff） |

两者互补：运行时治理减少问题发生，提交时审计兜底检测漏网之鱼。审计工具用法见 [HANDBOOK §提交后审计](./HANDBOOK.md#提交后审计agent-改完代码你凭什么信)，源码见 `sofagent-audit/src/`。

### 洞察 3：从「工具」转向「标准」（远期方向）

把纪律规则从"运行时约束"变成"可引用的开放标准"——类似 .editorconfig 之于编辑器：不是最强大的，但是唯一跨平台的。sofagent 的 SKILL.md 宪法就是 Agent 世界的 .editorconfig。v1.0+ 评估。

---

## 七、参考与致谢

sofagent 站在这些人和作品的基础上：

| 来源 | 启发 | 链接 |
|------|------|------|
| **OpenClaw** | 运行平台——加载链、Hook、Skill 系统、session 隔离 | [github.com/openclaw/openclaw](https://github.com/openclaw/openclaw) |
| **DeepSeek + GLM** | 模型引擎——本项目所有文件由 DeepSeek V4 Pro 和 GLM-5.2 配合生成 | [deepseek.com](https://deepseek.com) · [z.ai](https://z.ai) |
| **Addy Osmani** | Loop Engineering 五大件架构、语义化停止条件、三盆冷水 | [Loop Engineering 原文](https://addyo.substack.com/p/loop-engineering) |
| **Anthropic** | Managed Agents 四层架构——sofagent 核心设计哲学的源头 | [Scaling Managed Agents](https://www.anthropic.com/engineering/managed-agents) |
| **Codex / Claude Code** | 五层上下文压缩策略、决策冻结、增量笔记 | [codex.ai](https://codex.ai) |
| **agency-orchestrator** | `ao compose` 意图识别→任务图生成→模板匹配→分配（Apache-2.0） | [github.com/jnMetaCode/agency-orchestrator](https://github.com/jnMetaCode/agency-orchestrator) |
| **Andrej Karpathy** | 思考先行、简约至上、精准修改、目标驱动——铁律在此基础上扩展 | [4 条编码原则](https://github.com/multica-ai/andrej-karpathy-skills) |
| **Nelson F. Liu et al.** | *Lost in the Middle*（2023）——500 字原则和加载链顺序的科学依据 | [arXiv 2307.03172](https://arxiv.org/abs/2307.03172) |
| **Matt Pocock** | 调试方法论——loop-check 验收闸的排查框架 | [github.com/mattpocock/skills](https://github.com/mattpocock/skills) |
| **AI 代码审查实验**（146 PR × 4 AI Reviewer） | 93.4% 的问题仅被单一工具识别，0% 被所有工具共同识别——验证 loop-check + scoring + 人类审查三层设计的必要性 | AI 时代代码审查范式转移笔记 |

> 更多外部研究引用（MAGMA、SkillOpt、Google Skill 模式、多智能体成本研究等）详见 [DEVELOPMENT.md](./DEVELOPMENT.md) 对应章节。

---

> 这份设计文档和 Handbook 一样，是开放的。如果你觉得哪个设计决策有问题，或者发现了我们没考虑到的局限——开 Issue，直接说。设计文档不应该是作者一个人的独白。
