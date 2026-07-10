# sofagent Development

> 给开发者的内部机制文档。普通用户看 [Handbook](./HANDBOOK.md)，设计决策看 [Architecture](./ARCHITECTURE.md)。
>
> 这里讲 sofagent 内部怎么跑——Skill 结构、编排引擎、反思闭环、数据架构。
>
> v1.0.1 · 2026-07-04（UTC）· 北京时间 07-05 · 孔放勋

> 💡 **行业背景**：sofagent 是 FDE（Forward Deployed Engineer）的工具包。FDE 工具包本身就是 sofagent 产品的一部分——FDE 工作用自己产品，给别人部署完让别人也用自己产品。详见 [FDE/FDE.md](./FDE/FDE.md) 和 [README § FDE](./README.md#fde从工作流到-ai-节点)。

---

## 目录

- [一、工作原理](#一工作原理)
- [二、编排哲学](#二编排哲学)
- [三、模型最优选择](#三模型最优选择)
- [四、模板与验证](#四模板与验证)
- [五、自进化机制](#五自进化机制)
- [六、反思工程](#六反思工程)
- [七、数据文件架构](#七数据文件架构)
- [八、提交时审计](#八提交时审计)

---

### 开发环境

| 依赖 | 用途 | 版本 |
|------|------|:--:|
| Node.js + TypeScript | 审计引擎、CLI、MCP Server | v1.0 |
| [DeepAgentsJS](https://github.com/langchain-ai/deepagentsjs) | 编排引擎 + Sub Agent 系统 | v1.0.1+ |
| [LangGraph.js](https://github.com/langchain-ai/langgraphjs) | 状态图、条件路由、HITL | v1.0.1+ |
| Python 3 + `pip install skillopt` | Skill 自进化引擎（通过 CLI subprocess 调用，可选） | v1.0.2+ |
| 无其他外部运行时依赖 | — | — |

#### Windows 开发踩坑（PowerShell 移植必读）

> 来源：Windows 11 + PowerShell 5.1 实地勘察（2026-06）。v1.x Windows 完整支持开发参考。

| # | 坑 | 现象 | 解法 |
|---|-----|------|------|
| 1 | `.ps1` 必须 UTF-8 **带 BOM** | PS 5.1 读无 BOM 的 UTF-8 按 GBK 解析 → 中文乱码、字符串截断、解析报错 | 含中文的 `.ps1` 一律存 UTF-8 with BOM（`EF BB BF`） |
| 2 | 加 BOM 时读取**必须 `-Encoding UTF8`** | `Get-Content -Raw`（不带 `-Encoding`）读无 BOM 文件按 GBK 误读 → mojibake，再写回直接读坏 | `Get-Content -Raw -Encoding UTF8 $p` |
| 3 | 控制台输出编码 | 脚本不设 OutputEncoding → 按 OEM/GBK 输出，UTF-8 消费方读到乱码 | 顶部加 `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false` |
| 4 | `.gitattributes` 锁换行 | `core.autocrlf=true` 无 `.gitattributes` → checkout 把 `*.sh` 变 CRLF → Linux 跑不了 | `*.sh text eol=lf` + `*.ps1 text eol=crlf` |
| 5 | `if` 表达式不能直接做函数参数 | `f (if(){}else{})` 运行时崩 | 先 `$x = if...` 再传 |
| 6 | `switch` 无 `break` 执行所有匹配 case | 兜底 `^-` 误伤每个 flag | 用 if/elseif 链替代 |
| 7 | 单元素嵌套数组 `@(@(...))` 被摊平 | `foreach` 遍历到字符、`$x[0]` 取首字符 | 确保多元素或用 `,` 强制数组 |
| 8 | `WSLENV` 判 WSL 误判 | `WSLENV`（如 `WT_SESSION:`）在装了 WSL 的 Windows 上本就有 → 脚本误判为 WSL 拒跑 | 只认 `WSL_DISTRO_NAME` |
| 9 | BSD sed 词边界 `[[:<:]]` 在 GNU 报错 | `task-record.sh` 的 `sanitize()` 在 Linux 上脱敏失效 | 用 `\b` 替代 |

<img src="index/sofagent.png" alt="sofagent" width="300" />

---

### 概念 → 文件速查

| 你想找什么 | 文件/目录 |
|-----------|---------|
| 审计规则代码 | `sofagent/audit/src/rules/` |
| 审计 CLI 入口 | `sofagent/audit/src/index.ts` |
| 审计报告生成 | `sofagent/audit/src/reporter.ts` |
| think.md 自动生成 | `sofagent/audit/src/think-generator.ts` |
| Skill 主入口（宪法内联） | `sofagent/skill/SKILL.md` |
| 编排引擎 | `sofagent/skill/engage.md` |
| FDE 场景引导 | `sofagent/skill/engage-fde.md` |
| 入境/每任务/离境闸门 | `sofagent/skill/entry-gate.md` / `task-aware.md` / `task-closure.md` |
| 循环检查/评估/退出 | `sofagent/skill/loop-check.md` / `loop-evaluate.md` / `loop-exit.md` |
| 数据模板 / 部署脚本 | `sofagent/skill/data/` / `sofagent/scripts/` |
| FDE 交付物模板 | `FDE/templates/` |
| FDE 部署知识文档 | `FDE/FDE.md`（含角色定义 + 步骤详解，唯一知识源） |
| 加载链 Hook | `sofagent/hooks/sofagent-load-chain/` |

---

## 一、工作原理

### Skill 文件结构

**1 主 Skill（`SKILL.md`）+ 9 子 Skill = 10 个 .md（含 fde.md，按需加载）**。用户只安装 `SKILL.md`。A0 预判复杂度——🔴 复杂任务确认后加载 `engage.md` 走完整入口流程，🟢🟡 简单/中等任务跳过 engage.md 直接走 task-aware 闸门。每个子 Skill ≤90 行（v0.99.5 全部达标）。

> 💡 **措辞心理学**：铁律不只是「写对规则」，更是「写到 AI 真的听」。Superpowers（GitHub 23.9 万星 Skill 项目）2.8 万次对话实测——强措辞（必须/绝无例外）让 AI 服从率从 33% 提升到 72%。LLM 对强语气的注意力权重高于弱语气。写 Skill 时，关键铁律用最强可用措辞。详见 [ARCHITECTURE 措辞心理学](./ARCHITECTURE.md#措辞心理学长度之外还有强度)。

| 文件 | 何时加载 | 干什么 |
|------|------|------|
| engage | 🔴 复杂任务确认后 | 入口引擎：平台检测→安装→加载链→种子指令 |
| engage-fde | FDE 部署场景检测到后 | FDE 场景引导，与 FDE/FDE.md 互补 |
| entry-gate | 入口流程结束后 | 硬出口检查：加载链确认 + 能力注册 |
| task-aware | 收到任何用户任务时 | 每任务闸门：边界→语义→健康度→判级→澄清 |
| task-closure | 闭环信号出现时 | 离境闸门：调 Loop Agent → 反思/评分/A/B/汇报 |
| loop-check | 检查点/失败/闭环 | 顾问 Agent：读数据→做判断→给建议 |
| loop-evaluate | loop-check closure 模式触发 | 复盘/评分/沉淀，评审者与执行者分离 |
| loop-exit | 循环终止信号出现时 | 循环终止条件与收尾 |
| fde | FDE 部署时按需加载 | 企业约束层：合规要求/脱敏规则/审计频率 |

> 三层闸门 + 一条回环：入境 → 每任务 → Loop → 离境。四个全走才能保证 `.sofagent/` 数据层被激活。

sofagent 有**两个引擎**，数据流分离但在 think.md 交汇：

```
审计引擎（每次提交）                  编排引擎（Workflow 梳理 + 定期重测）
    │                                       │
    ├─ git diff                             ├─ Workflow 梳理：生成节点文档（nodes/*.md）
    ├─ 规则检查 A1-A14                      │       └─ ao compose 拆任务 → 写入 orchestrator/current/
    ├─ think-generator.ts                   │
    │   └→ 写 think.md ─────┐              ├─ 生产运行：AI 节点按 workflow 执行
    │                       │              │       ├─ 🔄 自动执行
    │                       │              │       └─ ⚡ AI 领航员辅助
    │                       │              │
    │                       │              ├─ 定期 A/B 重测
    │                       │              │       ├─ 编排引擎重出 candidate 方案
    │                       │              │       ├─ orchestrate-compare 确定性对比
    │                       │              │       └─ Candidate 胜出 → promote
    │                       │              │
    └───────────────────────┴──────────────┘
                  think.md 是交汇点
         （审计引擎写 / 编排引擎读 / A/B 结果写入 orchestrator/）
```

**审计引擎**只看 git diff（提交时），不依赖 Agent 配合。**编排引擎**在 Workflow 梳理时生成节点定义（nodes/*.md），之后 Agent 读节点 .md 注入给 ao compose 执行，定期用 `sofagent-orchestrate-compare` 做 A/B 重优化。两者通过 think.md 交汇——审计引擎基于 diff 硬证据自动生成反思，编排引擎读取优化策略。

主 Agent 的日常：接活 → 看 `scoring.md` → 看 think.md 反思区 → 看 `orchestrator/` → 干完记入 `task/logs/`。三分架构的设计推理见 [ARCHITECTURE.md](./ARCHITECTURE.md#skill-runtime)。

### 脚本与文件结构速查

**目录结构**：
- `sofagent/skill/`：纯 MD 规则（平台无关，所有 Agent 平台共用）
  - `SKILL.md`：主入口（宪法内联——4 底线 + 7 则铁律）
  - 子 Skill（8 个 .md）：`entry-gate.md` / `task-aware.md` / `task-closure.md` / `loop-check.md` / `loop-evaluate.md` / `loop-exit.md` / `engage.md` / `engage-fde.md`
  - `fde.md`：宪法文件（企业运行规范，部署时复制到目标项目）
  - `data/`（6 个模板）：`think.md` / `orchestrator.md` / `task.md` / `scoring.md` / `fde.md` / `IDENTITY.md`
- `sofagent/scripts/`（核心 4 个）：`install.sh` / `verify.sh` / `uninstall.sh` / `task-record.sh`
- `sofagent/hooks/sofagent-load-chain/`：`HOOK.md` + `handler.ts`（OpenClaw 内部 hook）

> npm 包 @sofagent/audit 含 8 个 bin 条目：6 个独立 CLI（sofagent-audit / sofagent-verify / sofagent-verify-evidence / sofagent-skill-safety-check / sofagent-orchestrate-compare / sofagent-env-check）+ 2 个别名（verify-evidence → sofagent-verify-evidence、skill-safety-check → sofagent-skill-safety-check）

| 脚本 | 干什么 | 什么时候跑 |
|------|------|------|
| `install.sh` | 多平台一键安装（7 步） | 手动跑 |
| `uninstall.sh` | 删约束文件，保留 `.sofagent/` | 手动跑 |
| `verify.sh` | 装后验证 9 类 24+ 检查项 | 安装完自动跑，也可手动 |
| `orchestrate-compare.ts` | A/B 对比 + promote + compose（合并了原 task-orchestrate） | 编排引擎定期调用 |
| `task-record.sh` | 收集任务数据 → 拼 Markdown → 追加到 task/logs/ | 闭环时自动调用 |

> 前三个是用户侧工具，后两个是运行时脚本。**设计原则**：确定性操作脚本化——去重、格式校验、文件清理这类即刻运算，脚本比 Agent 更快更省更可靠。

---

## 二、编排哲学

编排流程

任务到达 → 两轮澄清 → 目标定稿 → [ao compose](https://github.com/jnMetaCode/agency-orchestrator) 拆任务 → 生成 YAML 提案 → 用户确认 → Loop 执行。YAML 只管编排，Skill 约束由 `orchestrate-compare.ts` 执行前注入。

> **收敛是 Loop 的生命线**。Loop 工程核心是收敛——目标必须满足两个条件才能进入循环：① 可验证（测试覆盖率、AC 验收标准等明确量化标准）；② 模型可自主价值判断（字数限制、关键词检查等 LLM 自带规则）。不具备收敛性的目标（如「优化美观度」）会无限烧 Token——两轮澄清机制就是为了拦截不收敛目标。

### 主 Agent / 子 Agent

| 类型 | 干什么 |
|------|------|
| 主 Agent | 拆任务、派活、收尾 |
| 子 Agent | 干具体活，干完销毁，无状态无包袱 |

子 Agent 脏数据隔离销毁，有价值信息销毁前反思转移。多 Agent 并行用 git worktree 隔离。详见 [ARCHITECTURE.md](./ARCHITECTURE.md#worktree-isolation)。

Session 边界用百分比（缓存≥50%，token≥70%），子 Agent 不参与。详见 [ARCHITECTURE.md](./ARCHITECTURE.md#session-boundary)。

### 任务闭环

子 Agent 销毁后 → ② 反思→think.md ③ 评分→scoring.md ④ A/B→orchestrator/ ⑤ 口头汇报。外部 Skill 从 [ClawHub](https://clawhub.ai) 获取，岗位模板来自 [agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh)。

---

## 三、模型最优选择

### 为什么选 DeepSeek

默认用 DeepSeek（Flash/Pro 两档，API 模式数据不经过第三方）。完整选型分析见 [ARCHITECTURE.md](./ARCHITECTURE.md#deepseek-choice)。

### Flash vs Pro 分配

| 任务类型 | 用什么模型 |
|------|------|
| 简单任务（查天气） | Flash，便宜够用 |
| 中等任务（写文章） | Flash 查资料，Pro 写文章 |
| 复杂任务（数据分析报表） | Pro 为主，4-6 个子任务混合调度 |

简单任务用 Flash、复杂任务用 Pro——决策就一句话。每次分配前先检查 token 余额，预估消耗超了就提醒。

### 实现机制

模型选择靠 OpenClaw 的 `sessions_spawn.model` 参数——API 级别的硬约束：

```
ao compose 拆完任务
  → 先查 fde.md：有没有写模型偏好？
  → 有 → 按你写的来（fde.md 优先级最高）
  → 没有 → 查 orchestrator/：有没有最优模型？
  → 有 → 直接用缓存配置
  → 没有 → 默认策略（简单 Flash / 复杂 Pro）
  → sessions_spawn.model 传入模型名 → OpenClaw 确认生效
```

三层优先级：**fde.md > orchestrator/ > 系统默认**。企业约束永远排第一。

### 用自己的模型

简单方式：在 `fde.md` 里写一行模型偏好。精细方式：改 `orchestrator/` 叶子文件里的「最优模型」字段——按任务类型分模型。两种方式都不需要改代码。

编排开销经济学（一次多花 3%，十次省回来）见 [ARCHITECTURE.md](./ARCHITECTURE.md#token-economics)。

---

## 四、模板与验证

### 任务模板 vs 岗位模板

岗位模板（`IDENTITY.md`）定义「谁能干什么」；任务模板（`orchestrator/`）记录「这件事怎么拆最优」。一个任务是招聘要求，一个是作战计划。

一个任务模板记录：子任务拆分、角色分配、Skill 选择、依赖关系。下次同类任务直接用模板。

### 谁来实现

| 产物 | 谁写的 | 怎么写的 |
|------|------|------|
| `orchestrator/{任务}.md` | loop-check closure 模式 | A/B 对比 → 胜出模板写入 |
| `scoring/{skill}.md` | loop-check closure 模式 | 闭环时评分 → 写入叶子 |
| `task/logs/` | 主 Agent | 每次执行自动生成，只追加不修改 |
| `IDENTITY.md` | 来自 agency-agents-zh | ao compose 按角色自动分配 |

### A/B 测试

`sofagent-orchestrate-compare` 从 task/logs 中提取运行次数、违规率、步数、通过率四项指标做确定性对比。编排引擎定期重出 candidate 方案后与 current 对比——单次对比后标记胜出方，连续两次胜出目前需手动二次运行确认（v1.0.1 计划实现自动计数器）。旧方案归档到 history/。⚠️ 连续胜出判断为 TODO(v1.0.1)——当前只做单次对比，需手动执行两次后人工决策。

规则：不主动创造对照组、同类型才比、单次胜出标记候选（连续 2 次需手动二次确认）、再跑 2 次稳定才沉淀、模板可被替换。局限：样本量小（最少 7 次）、LLM 有随机性。完整推理见 [ARCHITECTURE.md](./ARCHITECTURE.md#a-b-test)。

---

## 五、自进化机制

> 负责的子 Skill：`loop-check` + `task-closure` — 反思 → 评分 → A/B → 写入 orchestrator/

### 四路反馈

闭环后从四个角度反馈：① 编排对不对 → orchestrator/ | ② Skills 选得对不对 → scoring.md | ③ A/B 有没有新结论 → orchestrator/ | ④ 模型选得值不值 → orchestrator/ 成本对比。四路汇总到 orchestrator/，下次直接用最优配置。

### 复盘自评

主 Agent 切换到 Loop Agent 视角，从九维评估（编排准确性、Skill 匹配度、模型经济性、执行流畅度、结果完整性、复用潜力、流程合规、Loop 有效性，外加判断力独立计分）：

> ⚠️ 工程边界：Loop Agent 不是独立进程，是主 Agent 切换 prompt 以顾问身份输出建议。评分是 LLM 自评，无客观基准，仅供横向对比参考。详见 [LIMITATIONS.md](./LIMITATIONS.md#known-limits)。

复盘加权算出总分，分比上次高 → 覆盖 orchestrator/ 为最优配置。分比上次低 → 不动，标「待验证」。每次闭环只需回答三问：**用对了吗？更好了吗？Loop 起作用了吗？**

### 中间检查点

触发条件：步数超过历史平均 ×2、同一工具连续失败 3 次、token 超预算 1.5 倍。暂停后主 Agent 用 Flash 三问——① 进展和目标对齐吗？② 继续有希望吗？③ 需要用户介入吗？三全「是」→ 继续；任一「否」→ 通知用户。

实现分工：OpenClaw `tools.loopDetection` 监控 → 熔断暂停 → Skill 做三问 → task-record.sh 写日志 → loop-check closure 更新阈值。

### orchestrator/ 怎么决策

```
任务来了 → 主 Agent 先查 orchestrator/
  → 有同类最优配置？直接用
  → 没记录？ao compose 生成新方案
  → 任务结束 → 对比本次和最优
    → 本次更好 → 覆盖
    → 本次更差 → 不动
```

orchestrator/ 记「这类任务怎么配最优」，think.md 记「上次做了什么、踩了什么坑」。一个是决策手册，一个是经验日记。

### 冷启动

新 Skill 装上、新任务类型出现——前 5 次只记录不做判断，第 6 次起进入看趋势模式。完整推理见 [ARCHITECTURE.md](./ARCHITECTURE.md#cold-start)。

### 评审者与执行者分离

多维评分按平台分级——OpenClaw 用 `session.spawn` 工程隔离；非 OpenClaw 是 prompt 级约束（无机制保障）。详见 `loop-check.md` closure 模式。

---

## 六、反思工程

### 每次任务结束，自问一句

任务闭环时，主 Agent 自问：「这次有什么值得记住的？」有 → 写一条 ≤200 字的日摘要到 `think.md` 反思区。没有 → 跳过。

> 💡 一个记忆条目的价值 = 它在未来任务中被检索并有效辅助决策的次数。不是「存了多少」，是「用了几次」。

### 反思什么

| 来源 | 提取什么 | 写不写 |
|------|------|:--:|
| task/logs 当天文件 | 做了什么任务、拆了几个子任务、结果如何 | ✅ 必写 |
| think.md 新增反思 | 反思标题 + 标签 + 置信度 | ✅ 有则写 |
| scoring.md | 哪个 Skill 使用次数变化、社区评分更新 | ✅ 有变化则写 |
| orchestrator/ | 最优拆法或配置变化 | 🔶 有变化则写 |

日摘要压缩原则：保留「变化」、省略「正常」、合并「重复」、标记「失效」。每条摘要末尾带来源标记。

### 反思区 / 归档区 + 智能权重

反思写入后只把权重 ≥0.5 的摘要放进反思区（≤2K token），其余丢进归档区。权重由三个信号估算（新鲜度 + 反思关联 + 引用热度）。≤2K token 硬上限是真正的安全阀。算法细节见 [ARCHITECTURE.md](./ARCHITECTURE.md#weight-gate)。

### think.md 自我纠正

三道防线：只存经验不存指令 → 反思区 2K token 硬上限 → 人工可清除。写入前扫指令性关键词 ≥3 处提醒拆到 fde.md。防线详解见 [ARCHITECTURE.md](./ARCHITECTURE.md#self-correct)。

---

## 七、数据文件架构

### 按引擎归属

| 文件 | 归属引擎 | 干什么 | 加载 |
|------|---------|------|:--:|
| `think.md` | **审计引擎写 / 编排引擎读** | 反思摘要。审计引擎基于 git diff 自动生成，编排引擎点火时读取 | 全文 |
| `task/logs/` | **审计引擎读 / 编排引擎写** | 执行日志。审计 A7/A8 读它；编排引擎闭环时写入 | 日期目录树 |
| `fde.md` | **编排引擎读** | 企业运行规范，含项目目标、验收标准、风险边界 | 全文 |
| `task/plans/` | **编排引擎写** | 任务计划，第二轮澄清时生成 | 日期文件名 |
| `orchestrator/` | **编排引擎核心数据** | 最优拆法决策树 | 树形 |
| `scoring.md` | **编排引擎辅助数据** | Skill 评分记录，闭环时更新 | 树形 |
| `IDENTITY.md` | **编排引擎辅助** | 岗位匹配（agency-agents-zh） | 全文 |
| `knowledge/` | **数据层（v1.0.1）** | AI 知识库：entities/（实体页）+ concepts/（概念页）+ comparisons/（对比页）+ log.md（变更日志）+ index.md（索引） | 按需注入 top-N |

### 数据流向总结

每次任务闭环：反思进 think.md → 评分更新 scoring.md → 最优拆法覆写 orchestrator/ → 执行记录追加到 task/logs/（只追加）。task/logs 是所有数据的源头。think.md 由审计引擎基于 git diff 硬证据自动生成。

### 维护规则

> ⚠️ 手册变更 → 同步模板；模板格式变更 → 反向更新手册。每次发版前跑一遍对照检查。

### 发版前数字核实（v1.0 起强制执行）

在 CHANGELOG 写版本条目之前，跑以下 6 步：

1. `./tools/check-version.sh`——把输出的「N 项」数字抄进 CHANGELOG，确认无 FAIL
2. `bash sofagent/scripts/verify.sh --quiet`——确认输出数字与文档中引用一致
3. `cd sofagent/audit && npm test 2>&1 | grep "Tests"`——确认通过数
4. `wc -m sofagent/skill/SKILL.md sofagent/skill/data/fde.md`——确认 Skill 字数旁注准确
5. 全文件类型术语扫描：`grep -rn "纪律层\|纪律底座\|工具箱\|FDE 工程师\|部署底座\|AI 控制节点" --include="*.md" --include="*.sh" --include="*.ps1" . | grep -v docs/changelog/ | grep -v docs/evidence/`（其中"FDE 工程师"是禁用词——FDE 的 E 已经是 Engineer，不叠叫）
6. `./tools/check-version.sh > /dev/null 2>&1; echo $?`——必须为 0

**铁律**：不是跑完看绿色就过。把实际输出数字逐字抄进 CHANGELOG。

### 文档总量预算

> 核心文档（不含 changelog/evidence）总量硬上限 **5,000 行**。超标时必须删旧再加新。

---

## 八、提交时审计

sofagent-audit（v0.99.7）是 TypeScript CLI，扫描 git diff + `.sofagent/task/logs/` 对审计规则（A1-A14）做确定性判定。exit code：0=PASS / 1=WARN / 2=FAIL。不依赖 Agent 运行时配合，但审计 A7/A8 的日志检查依赖 Agent 写入的任务日志。

### 绿灯路径检测

> AI 修改行为 → 顺手改测试 → 全绿通过——这不是恶意，是梯度下降找最低成本通过路径的本能。

审计 A8 不仅要检查 build/test 记录，还应检查测试改动是否为了匹配错误行为。审计 A2（源码改但测试没改 → WARN）是这个问题的反面——完全不碰测试也是信号。

### 状态账本

| 字段 | 内容 |
|------|------|
| 看到 | 读了哪些文件 |
| 改了 | 改了哪些文件，每个改了什么 |
| 验证了 | 跑了什么命令，结果 |
| 还剩 | 接下来要做什么 |

`task/logs` 模板参照这个四字段结构。状态外化到文件——Agent 失忆，文件不失忆。设计文档见 [audit-design.md](./docs/design/audit-design.md)。

---
