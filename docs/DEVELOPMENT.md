# sofagent Development

<p align="center"><img src="assets/sofagent.png" alt="sofagent" width="96" /></p>

> 给开发者的内部机制文档——本文讲 sofagent 内部怎么跑：Skill 结构、编排模块、反思闭环、数据架构。普通用户看 [Handbook](./HANDBOOK.md)，设计决策看 [Architecture](./ARCHITECTURE.md)；sofagent 是一层 FDE Harness（嵌在成熟 Agent 与模型层之间），底层引擎的内部实现在这里展开。
>
> v1.5.2 · 2026-09-24（UTC）· ✅ 已发版 · 孔放勋

> 💡 **行业背景**：sofagent 是一套 FDE 能力——装进成熟 Agent（DSH / OpenClaw / WorkBuddy）后，进场把业务判断写成文件（梳理工作流、构建本体数据、部署 AI 节点），离场后按文件 7×24 执行与审计。底层（Harness 中间件）**约束层 × 生命周期**双层架构：约束层 = 约束层五种能力（注入·审计·回溯·沉淀·进化），生命周期 = 五阶段（诊断→激活→编排→执行→进化；激活链四阶段 = 后四环 ACTIVATE→ORCHESTRATE→EXECUTE→SUSTAIN，v1.2.5+）。不管企业用 OpenClaw / WorkBuddy / 扣子还是其他 Agent 平台，sofagent 是独立的底线守卫层。详见 [FDE/GUIDE.md](../FDE/GUIDE.md)。

> 💬 **开发铁律**：sofagent 不建编辑器类交互界面。只读 Dashboard 面板（如 `tools/dashboard/dashboard.html`）例外——它是状态可视化，不做双向编辑。核心能力通过 MCP 协议暴露。Agent 首次连接时主动推送 `list_capabilities`。开发任何新功能前，先回答三个问题：（1）用户怎么通过对话发现这个能力？（2）结果推到哪？（3）用户怎么知道这个结果是 sofagent 做的，不是模型做的？——任何面向用户的输出必须带 `[sofagent]` 签名标注来源。详见 [设计哲学](./PHILOSOPHY.md)。

---

## 目录

- [开发环境](#开发环境)
- [一、工作原理](#一工作原理)
- [二、编排哲学](#二编排哲学)
- [三、模型最优选择](#三模型最优选择)
- [四、模板与验证](#四模板与验证)
- [五、自进化机制](#五自进化机制)
- [六、反思工程](#六反思工程)
- [七、数据文件架构](#七数据文件架构)
- [八、提交时审计 + 文件系统审计](#八提交时审计--文件系统审计)
- [九、验证方法论](#九验证方法论)
- [十、经验编译为持久知识](#十经验编译为持久知识wikiskill-印证)
- [十一、meta-harness 生态定位](#十一meta-harness-生态与-sofagent-的定位2026-06-meta-harness-summer-印证)
- [十二、STATE.md 持久化外部记忆模式](#十二statemd-持久化外部记忆模式)
- [十三、激活链扩展指南](#十三激活链扩展指南)

---

## 开发环境

> 开发前先确认标准安装通过——[HANDBOOK §安装](./HANDBOOK.md#安装)。

| 依赖 | 用途 | 版本 |
|------|------|:--:|
| Node.js + TypeScript | 审计模块、CLI、MCP Server | ≥18（v1.1.0 起纳入） |
| [@langchain/langgraph](https://github.com/langchain-ai/langgraph) | 编排模块（createReactAgent）+ Sub Agent 系统 | v1.2.0+（编排模块迁移史：ao→v1.0.6 DeepAgents→v1.2.0 LangGraph createReactAgent；deepagents 已弃用） |
| [LangGraph.js](https://github.com/langchain-ai/langgraphjs) | 状态图、条件路由、HITL | v1.0.1+ |
| ~~Python 3 + pip install skillopt~~ | 已移除（v1.4.8 起自研 gate 验证器零 Python 依赖，SOFAGENT_EVOLVE_GATE=cli 可回退外部兼容层） | v1.0.3–v1.4.7 |
| 无其他外部运行时依赖 | — | — |

### Windows 开发踩坑（PowerShell 移植必读）

> 来源：Windows 11 + PowerShell 5.1 实地勘察（2026-06）。核心 8 坑：UTF-8 BOM / 控制台编码 / .gitattributes 换行 / if-表达式 / switch-break / 数组摊平 / WSLENV / BSD sed。详见 [PS5兼容踩坑清单](https://github.com/KongFangXun/sofagent/issues?q=label%3Awindows)。

---

### 概念 → 文件速查

| 你想找什么 | 文件/目录 |
|-----------|---------|
| 审计规则代码 | `engine/audit/src/rules/` |
| 审计 CLI 入口 | `engine/audit/src/index.ts` |
| 审计快速 CLI（npx 零配置入口） | `engine/audit/src/cli-quick.ts` |
| 规则集加载器（JSON ruleset + plugin 接口） | `engine/audit/src/ruleset-loader.ts` |
| 插件规则执行器（type: "plugin" 委托外部 npm 包） | `engine/audit/src/plugin-runner.ts` |
| GitHub Annotations 格式化器 | `engine/audit/src/formatters/github-formatter.ts` |
| GitHub Action 配置 | `action.yml`（repo 根目录） |
| 审计报告生成 | `engine/audit/src/reporter.ts` |
| think.md 自动生成 | `engine/think/src/think-generator.ts` |
| Skill 主入口（宪法内联） | `SKILL/SKILL.md` |
| 编排模块 | `SKILL/harness/engage.md` |
| FDE 场景引导 | `SKILL/harness/engage-fde.md` |
| 入境/每任务/离境闸门 | `SKILL/harness/entry-gate.md` / `task-aware.md` / `task-closure.md` |
| 循环检查/评估/退出 | `SKILL/harness/loop-check.md` / `loop-evaluate.md` / `loop-exit.md` |
| FDE 模板 / 部署脚本 | `SKILL/harness/fde-template.md` / `engine/scripts/` |
| FDE 交付物模板 | `FDE/templates/` |
| FDE 部署知识文档 | `FDE/GUIDE.md`（完整方法论 + 案例，人读学习手册） |
| 加载链 Hook | `engine/hooks/sofagent-load-chain/` |

---

## 一、工作原理

> 一句话：开发者视角的 FDEing——Skill 结构、加载链与闸门就是 FDEing 在工程面的实体；本仓自身的开发流程也是被 FDEing 的对象（每个 PR 过审计链，与交付给企业的治理同构）。

### Skill 文件结构

**1 主 Skill（`SKILL.md`）+ 11 子 Skill = 12 个 .md（均在 `SKILL/harness/`；其中 `fde-template.md` 部署时改名 `fde.md`，按需加载）**。用户只安装 `SKILL.md`。A0 预判复杂度——🔴 复杂任务确认后加载 `engage.md` 走完整入口流程，🟢🟡 简单/中等任务跳过 engage.md 直接走 task-aware 闸门。每个子 Skill ≤100 行（v1.0.8 起，由 v0.99.5 的 ≤90 行上调）。

> 💡 **措辞心理学**：铁律不只是「写对规则」，更是「写到 AI 真的听」。Superpowers（GitHub Skill 项目，星数 23.9 万为早期快照；@2026-09-25 复测 29.1 万——**星数是时序量，引用必须带时点**）2.8 万次对话实测——强措辞（必须/绝无例外）让 AI 服从率从 33% 提升到 72%。LLM 对强语气的注意力权重高于弱语气。写 Skill 时，关键铁律用最强可用措辞。

> 💡 **信息架构设计**：Skill 的 `description` 字段只写触发场景（「何时用这个 Skill」），绝不写执行步骤。实测发现如果步骤写进描述，AI 会照着摘要偷懒跳过正文——改为纯触发条件后，AI 才老老实实读完全文。措辞心理学管「强度」，信息架构管「结构」——两者是对称维度。（来源：Superpowers 2.8 万次对话实测）

| 文件 | 何时加载 | 干什么 |
|------|------|------|
| engage | 🔴 复杂任务确认后 | 入口流程：平台检测→安装→加载链→种子指令 |
| engage-fde | FDE 部署场景检测到后 | FDE 场景引导，与 FDE/GUIDE.md 互补 |
| entry-gate | 入口流程结束后 | 硬出口检查：加载链确认 + 能力注册 |
| task-aware | 收到任何用户任务时 | 每任务闸门：边界→语义→健康度→判级→澄清 |
| task-closure | 闭环信号出现时 | 离境闸门：调 Loop Agent → 反思/评分/A/B/汇报 |
| loop-check | 检查点/失败/闭环 | 顾问 Agent：读数据→做判断→给建议 |
| loop-evaluate | loop-check closure 模式触发 | 复盘/评分/沉淀，评审者与执行者分离 |
| loop-exit | 循环终止信号出现时 | 循环终止条件与收尾 |
| fde | FDE 部署时按需加载 | 企业约束层：合规要求/脱敏规则/审计频率 |

> 三层闸门 + 一条回环：入境 → 每任务 → Loop → 离境。四个全走才能保证 `.sofagent/` 数据层被激活。

sofagent **约束层（五种能力）** 各有分工。**审计**只看 git diff（提交时），不依赖 Agent 配合。**编排模块**在 Workflow 梳理时生成节点定义，之后 Sub Agent 自加载约束执行。两种调用路径：支持 Hook 的平台节点走内部 API，其他节点走 CLI。两者通过 think.md 交汇——审计基于 diff 硬证据自动生成反思，编排模块读取优化策略。

主 Agent 的日常：接活 → 看 `data/eval/` → 看 think.md 反思区 → 看 `orchestrator/` → 干完记入 `task/logs/`。三分架构的设计推理见 [ARCHITECTURE 编排收敛](./ARCHITECTURE.md#编排收敛与-ab-测试)。

### Skill 设计哲学

Skill 的核心不是写执行步骤，而是划定**决策边界**。一个好 Skill 回答三个问题：

| 问题 | 写法 | 反例 |
|------|------|------|
| 什么时候启动 | 纯触发条件（场景/关键词/前置状态） | 把执行步骤写进 description——AI 会偷懒不读正文 |
| 什么时候绝对不能调用 | 硬排除条件——依赖未就绪/数据过期/权限不足 | 「建议不调用」——弱语气 AI 会忽视 |
| 怎样算完成 | 显式 exit 条件——产出物/验证标准/交付动作 | 「任务完成」——太模糊，AI 不知道什么时候停 |

**事实约束三原则**：① 标注哪些内部数据存在过期风险、② 哪些业务动作必须实时核验、③ 查不到确切凭证必须拒答而非脑补。审计模块的 A9 中文注入检测部分覆盖此方向。

**工具集检查清单**：每个 Skill 的工具集应零重叠、无歧义——两个工具的功能描述不能模糊交叉。当工具数上百时，瓶颈不在模型推理而在工具描述歧义。

### Skill 生命力与自进化判据

> 本节为 Skill 治理的判据沉淀，供 `evolve` 自进化模块与 FDE 部署 SOP 调用。

**A1｜Skills 生命力五分类法**（模型越强越要保留的 5 类 Skill）

每一次大模型迭代都会吞噬一批通用垂直 Skills（通用角色扮演、泛化流程、纯提示词教模型成专家类最易被下一代模型原生能力吃掉）。具备长期生命力的 5 类：

| 类别 | 核心定义 | 与 sofagent 对应 |
|------|------|------|
| 工具操作型 | 模型知目标但不懂本地工具调用规则，打通可靠工作流 | MCP / Hook（外部系统对接层） |
| 专有方法论型 | 非通用公开知识的自定义判断体系（如七成产业链评估） | fde.md 业务四问 + Ontology 约束（企业专属判断） |
| 高风险强约束工作流型 | 错误代价极高，严格限定执行规则 | 4 底线 + 9 则铁律 + entry-gate 风险分级（🟢🟡🔴） |
| 确定性生产型 | 输出须机器可验证固定格式，模型+脚本消除随机性 | discipline-check.sh（焊死的门）+ 审计模块（git diff 硬证据） |
| 项目知识与组织协作型 | 团队/项目专属长期约定（命名/目录/交付/归档） | SKILL.md + rules.md + 记忆系统（Ralph 路径外化） |

**保留/淘汰判据（evolve 自进化模块直接套用）**：优先保留上述 5 类；主动淘汰「通用角色扮演 / 泛化流程 / 纯提示词教模型成专家」型 Skill。与 Skill Reducer「少即是多」、A7「先做产物后 Skill」同源，但提供**可操作的分类判据**。

**A2｜Skills 轻量 OS 入口五要素**

优质 Skill 的未来形态 = **轻量操作系统入口**，彻底摒弃「用超长提示词教模型成为专家」的重模式。五要素：

| 要素 | 作用 |
|------|------|
| 短路由 | 入口 MD 只放核心流程，快速命中 |
| 少量边界规则 | 划定决策边界，不做重约束堆砌 |
| 按需参考资料 | 重内容外化到 references/，按需加载 |
| 可执行脚本 | 模型+脚本消除随机性（对应确定性生产型） |
| 明确验证标准 | 闭环到 pass/fail（对应审计模块硬证据） |

**A7｜先做产物后做 Skill（黄金顺序）**

先交付真实跑通的产物/工作流（pipeline），再从中抽象出可复用的 Skill；反序（先写 Skill 框架再找场景）会导致空壳 Skill。

FDE 部署 SOP 应遵循此顺序：

```
现场跑通客户工作流  →  沉淀为 fde.md 规则  →  抽象为 SkillHub 模板
```

而非先造 Skill 再硬套场景。

**A8｜Skill 质量三维度 + 失败清单**

质量三维度（可补入 evolve 评分框架）：

| 维度 | 含义 |
|------|------|
| 专业知识标尺 | 能判断「好/坏」的标准 |
| AI 边界认知 + 代码兜底 | 知道 AI 哪里会出错，用确定性代码兜底 |
| 产品化思维 | 把经验封装成他人能用的产物 |

**失败清单驱动进化**：Skill 的迭代不是堆功能，是持续记录「这次哪里出了错」→ 形成失败清单 → 下次规避。失败清单是 evolve 自进化模块的燃料。

**失败清单 > 正向评分**：当前 sofagent scoring 只做正向评分，缺「失败清单」反向维度（与 Evil Skill 自验证闭环同方向）。自进化优先级应让失败清单的反向规避高于正向功能堆砌。

**评估器反作弊（reward hacking 四形态）**：Agent 评估/训练环境中观察到四种「绕过解题直接拿参考源码」的作弊路径：① Git 历史——定位 gold commit 拿答案；② wget/curl——从 GitHub 上游拉参考实现；③ pip——下载含答案的包源码；④ urllib——网络库直接抓源码。对应两道防线：禁用 Git 命令并隐藏 `.git` 目录（断历史回溯）；网络层白名单 + 默认拦截出网（断外联通道）——评估器/沙箱设计的一手反作弊清单。来源：Agent Lightning v1.0 §4.3.2（arXiv 2608.17528）

### 脚本与文件结构速查

**目录结构**：
- `SKILL/harness/`：纯 MD 规则（平台无关，所有 Agent 平台共用）
  > 注意：`SKILL/harness/` 是产品层 markdown 闸门规则文本，与 npm 模块包 `@sofagent/inject`（TypeScript 实现的 Harness 中间件）不是同一个东西——前者是规则，后者是实现。
  - `SKILL.md`：主入口（宪法内联——4 底线 + 9 则铁律）
  - 子 Skill（11 个 .md）：`entry-gate.md` / `task-aware.md` / `task-closure.md` / `loop-check.md` / `loop-evaluate.md` / `loop-exit.md` / `engage.md` / `engage-fde.md` / `installer.md` / `knowledge-maintain.md` / `fde-template.md`
  - `fde-template.md`：规范文件模板（企业运行规范，部署时由 `engine/scripts/lib/file-deploy.sh` 复制并改名为 `fde.md`）
  - `data/`：运行时目录（部署时创建，含 think.md 等，不随仓库分发）
- `engine/scripts/`（核心 3 个）：`verify.sh` / `uninstall.sh` / `task-record.sh`
- `install.sh`（仓库根目录）：多平台一键安装（v1.2.0 从 engine/scripts/ 提升到根目录）
- `engine/hooks/sofagent-load-chain/`：`HOOK.md` + `handler.ts`（宿主平台 hook，目前唯一部署形态是 OpenClaw 的 `agent:bootstrap`）
- `engine/orchestrator/src/loop/`：**Graph Engine 核心**（StateGraph 四节点 + 条件路由 + checkpoint）。`graph.ts`（图组装+并行调度）、`state.ts`（LoopGraphState 状态契约）、`nodes.ts`（engineer/audit/reviewer/human_confirm 节点实现）

### docs/ 组织约定

本仓文档按 **Architecture / Handover / Delivery / Evidence** 四域归属，当前文件映射：

| 域 | 文档 | 说明 |
|----|------|------|
| **Architecture**（架构） | `ARCHITECTURE.md` | 系统设计、技术选型、能力清单 |
| **Handover**（交接/上手） | `HANDBOOK.md`、`DEVELOPMENT.md`、`COMMUNITY.md`、`THANKS.md`、`guides/` | 开发者上手、贡献指南 |
| **Delivery**（交付/发版） | `changelog/`、`docs/ROADMAP.md`、根 `CHANGELOG.md` | 版本记录、路线图 |
| **Evidence**（证据/归档） | `evidence/`、`archive/` | 实验数据、历史归档 |

新增文档请归入对应域；跨文档引用保持相对路径，CI 的 `check-docs` 会校验。本仓未强制物理迁移历史文档，仅以本说明固化约定。

> npm 包 @sofagent/audit 当前仅暴露 `sofagent-audit` 一个 bin（v1.1.0 拆包后 verify / orchestrate-compare / env-check / skill-safety-check 等已迁至对应独立包，实际 bin 以各包 `package.json` 为准）。

| 脚本 | 干什么 | 什么时候跑 |
|------|------|------|
| `install.sh` | 多平台一键安装（7 步） | 手动跑 |
| `uninstall.sh` | 删约束文件，保留 `.sofagent/` | 手动跑 |
| `verify.sh` | 装后验证 9 类 ~48 项动态检查 | 安装完自动跑，也可手动 |
| `orchestrator-compare.ts` | A/B 对比 + promote + compose（合并了原 task-orchestrate） | 编排模块定期调用 |
| `task-record.sh` | 收集任务数据 → 拼 Markdown → 追加到 task/logs/ | 闭环时自动调用 |

> 前三个是用户侧工具，后两个是运行时脚本。**设计原则**：确定性操作脚本化——去重、格式校验、文件清理这类即刻运算，脚本比 Agent 更快更省更可靠。

#### USB 完整运行时代码架构（v1.1.8+）

USB key 不是简单的文件复制——它是一个完整的便携式运行时。三个模块协作：

| 模块 | 源码 | 职责 |
|------|------|------|
| 写入侧 | `daemon/src/usb-key.ts` | `createUsbKey()` 主入口——复制 Node 便携版 + sofagent dist + 三平台启动脚本 → 写 federation.json（AES key + HMAC key，缺字段自动生成随机密钥）→ knowledge/ 用 `core/crypto/aes-gcm.ts` 加密落盘（只存密文）→ 全量 HMAC 签名 |
| 签名 | `daemon/src/usb-signature.ts` | HMAC-SHA256 全量签名：路径 POSIX 归一化 + 字典序 + SHA-256 内容哈希串联，不含 mtime（确定性可复算） |
| 运行侧 | `daemon/src/usb-runtime.ts` | `startUsbRuntime()` 主入口——启动验签 fail-closed（失败写 `security-events.jsonl` + exit 1）→ 内存解密 knowledge/（明文不落盘）→ `SOFAGENT_DATA`/`OPENCLAW_HOME` 便携化 env → daemon 主循环 → 退出 `Buffer.fill(0)` 清内存密钥 |

CLI 入口：`sofagent-daemon create-usb-key --role --target --platform`（写入侧）+ `sofagent-daemon start --usb-root`（运行侧）。启动脚本：`daemon/usb/start.command`（macOS）/ `start.sh`（Linux）/ `start.bat`（Windows）。

> 💡 USB 功能的用户侧使用见 [HANDBOOK §USB 烧录](./HANDBOOK.md#usb-烧录三种部署场景全覆盖v118--v120-叙事收口) 和 [FDE/GUIDE.md](../FDE/GUIDE.md)。这里只讲代码层架构。

---

## 二、编排哲学

> 📖 FORGE 自迭代的设计哲学见 [PHILOSOPHY §七](./PHILOSOPHY.md#七怎么进化forge-自迭代)。本章只讲技术实现。

### 编排流程

任务到达 → 两轮澄清 → 目标定稿 → LangGraph createReactAgent 拆任务（v1.0.6 从 ao 迁移至 DeepAgents，v1.2.0 迁移至 LangGraph createReactAgent，deepagents 已弃用） → 生成 YAML 提案 → 用户确认 → Loop 执行。YAML 只管编排，Skill 约束由 Sub Agent 启动时自加载（v1.0.7+ `buildConstrainedSystemPrompt`）或平台 Hook 注入。

#### 两条执行路径与降级链

编排模块主执行路径是 LangGraph StateGraph（历史上的 deepagents 路径已随 v1.5.0 迁移退役，`composeWithDeepAgents()` 别名同期移除）：

- **主路径（v1.1.3+）**：入口 `runLoopGraph()` / `sofagent-orchestrator loop --task`——LangGraph 四节点状态机 + checkpoint（`.sofagent/checkpoint/`，断点续跑）+ HITL（human_confirm 节点，`loop --resume` 可恢复）。源码 `engine/orchestrator/src/loop/`（state / nodes / graph）。

StateGraph 的 engineer / reviewer 节点优先走「工具注入路径」（LangGraph `createReactAgent` + 工具集，systemPrompt 拼装四层约束链）；`SOFAGENT_LLM` 未设置或解析失败时，自动降级到 `spawnSubAgent` 零工具路径（composer）。

v1.2.6 起 `resolveLLMModel()` 增加四级回退：`SOFAGENT_LLM`（显式优先）→ `SOFAGENT_LLM_A` → `SOFAGENT_LLM_B` → null，API key 同链回退——FORGE 审查用的 A/B 配置可直接驱动编排主链路。
#### 测试友好：依赖注入

StateGraph 的流转逻辑通过 `LoopGraphDeps` 接口完全可 mock——`runEngineer / runAudit / runReviewer / confirmHuman / recordBlocked / checkpointer / maxRetries / log` 八个槽位。`defaultDeps()` 给生产实现，测试时整体替换。这让节点流转逻辑可以脱离真实 LLM 单测（v1.1.7 测试堆到 770 case 的前提）。

#### DAG Runner 与 Workflow 解析（v1.1.8+）

compose 生成的编排方案 YAML 怎么真正跑起来——`dag-runner.ts`（LangGraph `createReactAgent` 真委派）负责调度，`workflow-parser.ts` 负责把 YAML 映射为 SubAgent 配置。v1.2.0 前用 `createDeepAgent`，已弃用。

| 模块 | 源码 | 职责 |
|------|------|------|
| dag-runner | `orchestrator/src/dag-runner.ts` | 接收 SubAgent[] 配置 → LangGraph `createReactAgent` 真委派 → 主 Agent 自主决定何时调哪个 Sub Agent（串行）。每个 Sub Agent 注入四层约束加载链 |
| workflow-parser | `orchestrator/src/workflow-parser.ts` | YAML→SubAgent 映射（developer→ENGINEER / qa-engineer→REVIEWER / researcher→FDE sustain / technical-writer→内置）。DAG 悬空 / 自依赖 / 环校验 |
| composer 改造 | `orchestrator/src/composer.ts` | `ComposeResult{ yaml, subagents }`——接 `enterpriseWorkflowYaml` + `variant` A/B/C/D 拆解策略 |

> ⚠️ **当前是串行**：`dag-runner` 文件名指向最终目标（DAG 并行调度），当前实现为**串行状态机**——主 Agent 按 `depends_on` 顺序委派 Sub Agent。完整 DAG 并行调度为后续目标（权威说明见 `engine/orchestrator/src/dag-runner.ts` 头部命名注释）。

#### A/B 自动调度器（v1.1.9+）

v1.1.8 手动 A/B 对比的自动化升级——daemon cron 在后台跑探索-利用循环：

| 阶段 | 做什么 |
|------|--------|
| 利用 | 当前方案跑真实任务攒 N 次数据 |
| 探索 | exploreCandidates 队首候选方案跑 N 次 |
| 判定 | `aggregateRecent` 对比 avgPassRate，候选连续 2 轮更好 → promote |
| 循环 | 旧方案回探索队尾，状态原子写 `ab-scheduler-state.json` 可重启恢复 |

`ab-history.ts` 负责累积 jsonl + 最近 N 次聚合（平均通过率 / 平均耗时 / 失败模式聚类）+ K=100 截断。注入依赖（compose / runDAG / extractMetrics）而非硬编码，测试零网络全 mock。

### 收敛约束

Loop 工程核心是收敛——目标必须满足：① 可验证（测试覆盖率/AC 标准）② 模型可自主价值判断。不具备收敛性的目标（如「优化美观度」）会无限烧 Token——两轮澄清机制就是为了拦截不收敛目标。

### Tools 设计四原则

MCP tools（当前数量以 `engine/mcp/src/tool-registry.ts` 的 TOOLS 数组为准）是 Agent 的手脚，工具设计是返工重灾区——Agent 表现差，多数时候不是模型不行，是工具设计有问题。四条纪律：

| 原则 | 要求 | 反例 |
|------|------|------|
| **职责单一** | 一个工具只干一件事 | 一个 tool 又查知识库又建 workflow 又推 webhook |
| **描述精确** | 模型完全靠 description 理解工具——写清「查哪个库的什么数据、支持什么筛选」 | 「查一查相关内容」——模型会在不该调用时调用 |
| **错误信息清晰** | 返回「某某参数不能为空/超限范围」而非「执行失败」——模型看得懂错误才能自己改参数重试 | 只返回 `failed`——模型要么瞎猜要么放弃 |
| **参数简洁** | 能少传就少传、能有默认值就给默认值 | 必填参数一堆，模型填的参数越多出错概率越大 |

### Agent 停止条件四件套

Agent 的执行路径由模型现场决定，`while` 循环跑几遍代码无法预知——没有停止条件的 Agent 会无限烧 Token。四条防线（已实现）：

| 停止条件 | 实现 | 位置 |
|---------|------|------|
| 模型自判完成 | 模型判断任务完成自然收尾 | createReactAgent 原生 |
| 轮次上限 | maxGoalRounds 防刷轮（验收不过不放行 + 失败原因注入） | v1.4.0 DSH 插件 turn-stopping |
| Token/预算上限 | 训练预算控制超预算暂停 + 成本审计 WARN | v1.3.6 train_budget / v1.4.0 cost-audit |
| 错误收敛 | stop_reason 分类（失败原因 + 退避 + 收敛判定） | v1.3.1 错误处理升级 |

> 配套铁律：Agent 行为不确定（概率模型每次生成带随机性）——灵活性和不确定性是连体婴。生产环境必须落详细执行日志（每步思考 + 工具调用 + 结果），出事才能回溯「为什么今天和昨天结果不一样」。我们有 LLM 调用级 Trace（v1.3.1）+ 审计历史，这是日志纪律的实现层。

### 主 Agent / 子 Agent

| 类型 | 干什么 |
|------|------|
| 主 Agent | 拆任务、派活、收尾 |
| 子 Agent | 干具体活，干完销毁，无状态无包袱 |

子 Agent 脏数据隔离销毁，有价值信息销毁前反思转移。多 Agent 并行用 git worktree 隔离。

Session 边界用百分比（缓存≥50%，token≥70%），子 Agent 不参与。

### 任务闭环

子 Agent 销毁后的收尾动作：

- 反思 → `think.md`
- 评分 → `data/eval/`
- A/B → `orchestrator/`
- 口头汇报

外部 Skill 从 [ClawHub](https://clawhub.ai) 获取，岗位模板来自 [agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh)。

> **Loop 五组件对照**：行业共识 Loop = Goals / Automations / Skills / Sub Agents / Worktraces。sofagent 对应：Goals = fde.md，Automations = daemon，Skills = skill/，Sub Agents = agents/，Worktraces = task/logs + think.md。gstack 的七步工作流进一步验证了这个结构。

> **Loop 落地前置条件**：① 任务重复发生 ② 支持自动化核验 ③ Token 预算覆盖 ④ AI 具备适配工具。核心原则——**自己不能当自己裁判**：生成与核验的模型必须独立，与 sofagent「审计与编排分离」同源。

> **比收敛更难的，是控制权分配。** 哪一段让模型自由判断（编排模块 createReactAgent），哪一段必须由代码强制执行（审计模块 25 条规则），哪一步失败可以重试（b-fix），哪一步必须停下来问人（human_confirm）——sofagent 的确定性与概率性分离，就是对这个问题的工程回答。这也是从 Loop Engineering 走向 Graph Engineering 的核心工程挑战：Graph 的真正难点不是画框连线，而是决定**每条边上的控制权归谁**。

> 一句话锚点：**「翻译官不应该有决策权。」** 模型负责理解（翻译模糊需求→结构化意图），系统负责控制（确认、权限、状态流转）。sofagent 的确定性与概率性分离，就是这条原则的工程落地——审计规则不看模型说什么，只看 diff 改了什么。

---

## 三、模型最优选择

### 为什么选 DeepSeek

默认用 DeepSeek（Flash/Pro 两档，API 模式数据不经过第三方）。完整选型分析见 [ARCHITECTURE 模型选择](./ARCHITECTURE.md#模型选择)。

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
LangGraph createReactAgent 拆完任务
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

编排开销经济学见 [ARCHITECTURE 编排收敛](./ARCHITECTURE.md#编排收敛与-ab-测试)。

---

## 四、模板与验证

### 任务模板 vs 岗位模板

岗位模板（`IDENTITY.md`）定义「谁能干什么」；任务模板（`orchestrator/`）记录「这件事怎么拆最优」。一个任务是招聘要求，一个是作战计划。

一个任务模板记录：子任务拆分、角色分配、Skill 选择、依赖关系。下次同类任务直接用模板。

### 谁来实现

| 产物 | 谁写的 | 怎么写的 |
|------|------|------|
| `orchestrator/{任务}.md` | loop-check closure 模式 | A/B 对比 → 胜出模板写入 |
| `eval/{skill}.md` | loop-check closure 模式 | 闭环时评分 → 写入叶子 |
| `task/logs/` | 主 Agent | 每次执行自动生成，只追加不修改 |
| `IDENTITY.md` | 来自 agency-agents-zh | createReactAgent 按角色自动分配 |

### A/B 测试

> A/B 结果异常时的用户侧处理方法见 [HANDBOOK §排查](./HANDBOOK.md#排查问题)。

`sofagent-orchestrator-compare` 从 task/logs 中提取运行次数、违规率、步数、通过率四项指标做确定性对比。编排模块定期重出 candidate 方案后与 current 对比——v1.0.7 实现连续胜出自动计数器（连续 2 次胜出 → auto promote + 原子写入），旧方案归档到 history/。

规则：不主动创造对照组、同类型才比、单次胜出标记候选（连续 2 次需手动二次确认）、再跑 2 次稳定才沉淀、模板可被替换。局限：样本量小（最少 7 次）、LLM 有随机性。完整推理见 [ARCHITECTURE 编排收敛](./ARCHITECTURE.md#编排收敛与-ab-测试)。

---

## 五、自进化机制

> 负责的子 Skill：`loop-check` + `task-closure` — 反思 → 评分 → A/B → 写入 orchestrator/

### 四路反馈

闭环后从四个角度反馈：① 编排对不对 → orchestrator/ | ② Skills 选得对不对 → data/eval/ | ③ A/B 有没有新结论 → orchestrator/ | ④ 模型选得值不值 → orchestrator/ 成本对比。四路汇总到 orchestrator/，下次直接用最优配置。

### 复盘自评

主 Agent 切换到 Loop Agent 视角，从九维评估（编排准确性、Skill 匹配度、模型经济性、执行流畅度、结果完整性、复用潜力、流程合规、Loop 有效性，外加判断质量独立计分）：

> ⚠️ 工程边界：Loop Agent 不是独立进程，是主 Agent 切换 prompt 以顾问身份输出建议。评分是 LLM 自评，无客观基准，仅供横向对比参考。详见 [LIMITATIONS.md](./LIMITATIONS.md#复盘评分是-llm-自评评审者与执行者不分离)。

复盘加权算出总分，分比上次高 → 覆盖 orchestrator/ 为最优配置。分比上次低 → 不动，标「待验证」。每次闭环只需回答三问：**用对了吗？更好了吗？Loop 起作用了吗？**

### 轨迹优化闭环：Trajectory Store + LLM-Judge 蒸馏

进化模块核心机制（行业参考「轨迹优化闭环」）：好轨迹经 LLM-Judge 评分 + Best-of-N 筛选，蒸馏成 Skill 沉淀。

- **Trajectory Store**：每条成功任务的全链路轨迹入库
- **LLM-Judge**：对轨迹打分（质量 / 成本 / 合规）
- **Best-of-N 蒸馏**：高分轨迹抽象为可复用 Skill

> 与 sofagent FORGE 进化模块同源——好轨迹沉淀为 Skill，闭环驱动自迭代。

> **边界：轨迹是分析材料，不是操作授权**——Agent 在轨迹里「说」自己需要什么权限、想放宽哪条规则，不构成任何权限或规则变更的依据；权限变更只能来自人的显式决定（对应「进化不碰宪法」的另一面）。轨迹只喂归因与改进提案，不喂授权。

### 中间检查点

触发条件：步数超过历史平均 ×2、同一工具连续失败 3 次、token 超预算 1.5 倍。暂停后主 Agent 用 Flash 三问——① 进展和目标对齐吗？② 继续有希望吗？③ 需要用户介入吗？三全「是」→ 继续；任一「否」→ 通知用户。

实现分工：OpenClaw `tools.loopDetection` 监控 → 熔断暂停 → Skill 做三问 → task-record.sh 写日志 → loop-check closure 更新阈值。

### orchestrator/ 怎么决策

```
任务来了 → 主 Agent 先查 orchestrator/
  → 有同类最优配置？直接用
  → 没记录？createReactAgent 生成新方案
  → 任务结束 → 对比本次和最优
    → 本次更好 → 覆盖
    → 本次更差 → 不动
```

orchestrator/ 记「这类任务怎么配最优」，think.md 记「上次做了什么、踩了什么坑」。一个是决策手册，一个是经验日记。

### 冷启动

新 Skill 装上、新任务类型出现——前 5 次只记录不做判断，第 6 次起进入看趋势模式。

### 评审者与执行者分离

多维评分按平台分级——OpenClaw 用 `session.spawn` 工程隔离；非 OpenClaw 是 prompt 级约束（无机制保障）。详见 `loop-check.md` closure 模式。

### Agent 基础设施：双 Agent 自进化（v1.0.8+）

v1.0.7 预装了两个内置 Agent，v1.0.8 将它们升级为**基础设施 Agent**——所有 workflow 节点完成任务后强制调用：

```
每个节点完成任务：
  → Audit Agent    "你做得合规吗？"
  → FDE Harness sustain  "你能做得更好吗？"
```

**不是「又一个检查清单」——是两个 Agent 形成自进化闭环**（双 Agent 定义详见 [ARCHITECTURE §双 Agent 定义](./ARCHITECTURE.md#agent-基础设施层v108)）。

**开发 Agent 的方式**：新增 Agent 只需在 `SKILL/agents/{name}/SKILL.md` 创建文件——front matter（身份标签）+ 调用方式（CLI 指令）+ Agent 角色定义（Agency Agents 格式）。`builtin-agents.ts` 的 `parseSkillMd()` 自动加载，`registry.ts` 自动合并。

**SKILL.md 的强制约定**（v1.0.8）：所有 Agent 的 SKILL.md 必须引用 `@sofagent-audit` 和 `@sofagent-fde` 作为基础设施 Agent。缺少引用的 Agent 视为未完成。

---

## 六、反思工程

> 📖 知识观与反思机制的设计哲学见 [PHILOSOPHY §五](./PHILOSOPHY.md#五怎么记知识观)。本章只讲技术规格。

### 每次任务结束，自问一句

任务闭环时，主 Agent 自问：「这次有什么值得记住的？」有 → 写一条 ≤200 字的日摘要到 `think.md` 反思区。没有 → 跳过。

> 💡 一个记忆条目的价值 = 它在未来任务中被检索并有效辅助决策的次数。不是「存了多少」，是「用了几次」。

### 反思什么

| 来源 | 提取什么 | 写不写 |
|------|------|:--:|
| task/logs 当天文件 | 做了什么任务、拆了几个子任务、结果如何 | ✅ 必写 |
| think.md 新增反思 | 反思标题 + 标签 + 置信度 | ✅ 有则写 |
| data/eval/ | 哪个 Skill 使用次数变化、社区评分更新 | ✅ 有变化则写 |
| orchestrator/ | 最优拆法或配置变化 | 🔶 有变化则写 |

日摘要压缩原则：保留「变化」、省略「正常」、合并「重复」、标记「失效」。每条摘要末尾带来源标记。

### 反思区 / 归档区 + 智能权重

反思写入后只把权重 ≥0.5 的摘要放进反思区（≤2K token），其余丢进归档区。权重由三个信号估算（新鲜度 + 反思关联 + 引用热度）。≤2K token 硬上限是真正的安全阀。

### think.md 自我纠正

三道防线：只存经验不存指令 → 反思区 2K token 硬上限 → 人工可清除。写入前扫指令性关键词 ≥3 处提醒拆到 fde.md。

---

### 记忆 ≠ RAG：分层状态管理

行业参考区分：多数 Agent 的「记忆」只是当前对话上下文窗口，关掉归零——这是金鱼不是记忆。真记忆应分层：

| 层 | 内容 | 生命周期 | sofagent 落点 |
|----|------|------|------|
| 工作记忆 | 当前任务上下文 | 单次会话 | 会话上下文 |
| 短期记忆 | 近期工作笔记 | 天到周 | think.md（反思）|
| 长期记忆 | 团队知识 / 历史决策 / 业务规则 | 持久化 | knowledge/ |
| 操作日志 | 做了什么、为什么、结果 | 审计保留期 | task/logs + 审计模块 |

> 关键：「这不是 RAG。RAG 是『从文档里找答案』，记忆是『我自己经历过，我知道该怎么做』。」数字员工每次完成任务自动把关键决策与踩过的坑写入长期记忆——sofagent 的记忆观不依赖 RAG 式检索作为主记忆机制（knowledge/ 的检索式注入是另一回事），此区分加固反 RAG 立场。

## 七、数据文件架构

### 按模块归属

| 文件 | 归属模块 | 干什么 | 加载 |
|------|---------|------|:--:|
| `think.md` | **多写入方 / 只追加（Ledger）** | 反思摘要（Ledger 原始数据）。写入方：①审计模块 git diff 自动反思 ②主 Agent 按模板手动 write_think ③FDE/loop 陪跑期写入；读取方：编排模块、daemon(Dream Cycle/lessons-extract)、harness 加载链、人类。**只追加，绝不整体覆写/截断**。代码契约见 `@sofagent/core` 的 `getThinkPath()` / `appendThinkEntry()` | 全文 |
| `task/logs/` | **审计模块读 / 编排模块写** | 执行日志。审计 A7/A8 读它；编排模块闭环时写入 | 日期目录树 |
| `fde.md` | **编排模块读** | 企业运行规范，含项目目标、验收标准、风险边界 | 全文 |
| `task/plans/` | **编排模块写** | 任务计划，第二轮澄清时生成 | 日期文件名 |
| `orchestrator/` | **编排模块核心数据** | 最优拆法决策树 | 树形 |
| `data/eval/` | **编排模块辅助数据** | Skill 评分记录，闭环时更新 | 树形 |
| `IDENTITY.md` | **编排模块辅助** | 岗位匹配（agency-agents-zh） | 全文 |
| `knowledge/` | **数据层（v1.0.1）** | AI 知识库：entities/（实体页）+ concepts/（概念页）+ comparisons/（对比页）+ log.md（变更日志）+ index.md（索引）| 按需注入 top-N |
| | | **生产者**：daemon Ingest（task/logs → 知识提取）、knowledge-maintain Skill（session 结束时的结构化总结）| |
| | | **消费者**：加载链第 4 层（上下文注入）、Agent 决策前自主检索 | |
| | | **Lint**：loop-evaluate（每周扫描：矛盾/过期/孤立页面）| |
| `dashboard/` | **daemon 产出（v1.2.3）** | 终端 Dashboard 数据：`daemon-health.json`（工作状态）+ 4 维审计日志聚合（数据主权/规则审计）+ 趋势快照（周对比/月趋势）。消费方：`tools/dashboard/sofagent-dashboard.sh`（bash + jq 渲染，无 Node 依赖）| 按需读 |

### 数据流向总结

每次任务闭环：反思进 think.md → 评分更新 data/eval/ → 最优拆法覆写 orchestrator/ → 执行记录追加到 task/logs/（只追加）。task/logs 是所有数据的源头。think.md 由审计模块基于 git diff 硬证据自动生成。

### 维护规则

> ⚠️ 手册变更 → 同步模板；模板格式变更 → 反向更新手册。每次发版前跑一遍对照检查。

### 发版前数字核实（v1.0 起强制执行）

在 CHANGELOG 写版本条目之前，跑以下 6 步：

1. `./tools/check/check-version.sh`——把输出的「N 项」数字抄进 CHANGELOG，确认无 FAIL
2. `bash engine/scripts/verify.sh --quiet`——确认输出数字与文档中引用一致
3. `cd engine/audit && npm test 2>&1 | grep "Tests"`——确认通过数
4. `wc -m SKILL/SKILL.md SKILL/harness/fde-template.md`——确认 Skill 字数旁注准确
5. 全文件类型术语扫描：`grep -rn "纪律层\|纪律底座\|工具箱\|FDE 工程师\|部署底座\|AI 控制节点" --include="*.md" --include="*.sh" --include="*.ps1" . | grep -v docs/changelog/ | grep -v docs/evidence/`（其中「FDE 工程师」是禁用词——FDE 的 E 已经是 Engineer，不叠叫）
6. `./tools/check/check-version.sh > /dev/null 2>&1; echo $?`——必须为 0

**铁律**：不是跑完看绿色就过。把实际输出数字逐字抄进 CHANGELOG。

### 文档总量预算

> 文档行数预算的现行口径与各层上限以 `tools/check/check-docs.sh` 的 LIMIT_A/LIMIT_B/LIMIT_E 为准（A 层用户文档 / B 层参考文档 / E 层 guides，超标须按铁律归并或登记上调）。**不计入硬预算但必须有读数的面**（F 家族软警戒：索引与台账 / 技能源树 / FDE 手册与模板 / 经验沉淀 / 包级 README）同在该脚本 §4 尾部打印——「不进预算」不等于「不进视线」。计账归属本身由 §22 对账（每条排除项命中的文件必须落在某个计量桶内，否则判红）。

---

## 八、提交时审计 + 文件系统审计

> 审计模块的 CLI 使用和 exit code 约定。用户视角见 [HANDBOOK §提交后自动审计](./HANDBOOK.md#提交后自动审计)，CI 集成例子见 [HANDBOOK §CI 集成](./HANDBOOK.md#ci-集成)。

sofagent-audit（v1.0.8）是 TypeScript CLI，支持两种审计触发模式：

| 模式 | 版本 | 触发 | 适用 | 需要 git |
|------|:--:|------|------|:--:|
| git commit 审计 | v0.92+ | `git commit` → commit-msg hook | 开发者 | ✅ |
| 文件系统审计 | v1.0.8+ | daemon 监控文件变更 | 开发者 + 非开发者 | ❌（自研 git-shadow diff） |

两种模式共用同一套审计规则（A1-A11、A14-A24 + E1-E2/E4，共 25 条）和 exit code（0=PASS / 1=WARN / 2=FAIL）。差异在于触发时机和拦截能力：git commit 审计能阻断 commit，文件系统审计只能事后告警 + 快照回溯。

v1.0.8 自研 git-shadow diff 解析（isomorphic-git **风格**，非 npm 包依赖）作为 diff 引擎——非 git 目录也能做行级 diff。daemon 用 `chokidar` 监控文件变更，5 秒防抖后触发审计。每次审计后自动做 git 快照，用户可 `sofagent-audit --revert <sha>` 回滚。

> 📖 **多设备同步**：daemon 的经验产出（knowledge/ + think.md）可跨设备共享——4 种方案见 [多设备同步指南](./guides/multi-device-sync.md)。

> 📐 **最小 Harness 参照**：MicroHoneys 仅 400 行代码实现了完整的 Agent Harness（配置/提示词/工具调度/安全守卫/生命周期/长期记忆），证明 Harness 层不需要庞大的基础设施——核心是边界清晰的分层设计，不是代码量。sofagent 的审计模块同样追求极简：核心规则 < 2000 行，零外部 API 依赖。

### 审计聚合指标口径（单源防漂移）

`sofagent-audit --stats` 输出近 N 天（`--days` 可调，缺省 30）治理 KPI。指标口径以本节为准（CLI 实现 `engine/audit/src/stats.ts` 与此处同源——改口径先改本节）：

| 指标 | 定义 | 分母 |
|------|------|------|
| **变更总数** | 统计窗口内 history.jsonl 的审计记录条数（每次 commit 审计一条） | — |
| **判定分布** | PASS（exitCode=0）/ WARN（exitCode=1）/ FAIL（exitCode=2）三档计数 | — |
| **安全边界触发率** | (WARN 条数 + FAIL 条数) ÷ 变更总数 | 变更总数 |
| **阻断率** | FAIL 条数 ÷ 变更总数（FAIL 判定以 exitCode=2 为准） | 变更总数 |
| **高危规则 Top 5** | ruleResults 中 status=WARN/FAIL 的规则按触发次数降序前五（含 FAIL 分计） | — |

口径细则：
- **空历史降级**：变更总数为 0 时触发率/阻断率输出 `null`（不硬凑 0——「无数据」与「零触发」语义不同）
- **下钻说明**：每条触发记录的 17 条默认规则逐条 ruleResults 可查（`history.jsonl` 原始记录 + `--verify-chain` 完整性校验）——Top 5 规则可下钻到具体 commit 与证据
- **机器可读**：`--stats --json` 输出纯净 JSON（企业 SIEM/监控平台消费）；聚合结果同步落盘 `data/dashboard/audit-stats.json`（Dashboard 面板化消费 v1.5.0）
- **只读铁律**：聚合层永不写 `history.jsonl`（HMAC 链完整性是审计信任根基——聚合前后文件字节级一致）

### 绿灯路径检测

> AI 修改行为 → 顺手改测试 → 全绿通过——这不是恶意，是梯度下降找最低成本通过路径的本能。

审计 A8 不仅要检查 build/test 记录，还应检查测试改动是否为了匹配错误行为。审计 A2（源码改但测试没改 → WARN）是这个问题的反面——完全不碰测试也是信号。

> **架构漂移检测（命名）**：代码与文档长期不一致 → AI 生成逻辑偏向实际代码而非文档 → 长期积累导致架构腐蚀。A4（不删配置）和 A16（非授权文件变更）部分覆盖此方向，未来可作为独立检测维度：对比 `.sofagent/` 中的约束声明与仓库实际结构，检测文档→代码的偏移。

> **落地案例：财务报销沙盒（权责分离）**。员工提交 5800 元报销单备注「经副总裁特批」，大模型抓关键词误判合规直接放款。解法不是加更多 Prompt 规则（关键词匹配易被绕过），而是**物理隔离**：沙盒内预置打款函数 + 硬编码审计红线 → 沙盒独立解析 JSON 提取金额 → 风控雷达扫描超限直接刚性阻断 → 模型连网银接口的「门把手都摸不到」。一句话原则：**只让 AI 干活提建议，绝不让他碰红线**。sofagent 的 A2（不泄密钥）/A15（不盲动）遵循同一原则——模型提建议，审计模块控执行。

### 状态账本

| 字段 | 内容 |
|------|------|
| 看到 | 读了哪些文件 |
| 改了 | 改了哪些文件，每个改了什么 |
| 验证了 | 跑了什么命令，结果 |
| 还剩 | 接下来要做什么 |

`task/logs` 模板参照这个四字段结构。状态外化到文件——Agent 失忆，文件不失忆。设计文档见 [audit-design.md](./archive/design/audit-design.md)。

---

## 九、验证方法论

行业测评揭示的「防刷分验证法」与 sofagent 验证体系同构：

- **真实代码库 + 真实 PR 当考题**：研报用「已合并 PR + 原 PR 测试用例」当评分标准，规避公开 benchmark 泄漏导致的刷分。对应 sofagent `regression-checklist.md`（85 维）+ `acceptance-test.sh`（377 场景）——用真实修复场景与历史 case 当验收，而非玩具 benchmark。
- **上下文精简 = 低成本高通过**：研报发现 Pipe Agent 同模型下比原生工具便宜 1.2–2×、性能差距 <3pt，根因是初始提示 <1500 token（vs Claude Code 20k）。这从量化角度印证 sofagent「Harness 要轻」——约束层零 token 运行（25 条规则 20 条纯 git-diff），把成本压在确定性引擎而非上下文堆料。
- **保存 ≠ 生效 ≠ 变好**：三个状态分记，谁也不许冒充谁——**已保存**（配置/产物写入了）／**已生效**（接线在真实路径上，不是只存在于测试或声明里）／**已验证变好**（行为级验证通过，且对照了改前基线）。交付声明只能落在实际达到的那一档，未做行为验证的显式记「未验证」，不并进「已完成」。

## 十、经验编译为持久知识（WikiSkill 印证）

Google Research 的 WikiSkill（[arXiv:2608.27454](https://arxiv.org/abs/2608.27454)）把 Agent 工作区分为 Raw（不可变轨迹）/ Wiki（永不回滚的知识层）/ Skills（可回滚技能）三层，与 sofagent 的三层结构同构且提供了量化证据：

- **持久知识层是进化胜负手**：消融拿掉 Wiki 访问，平均分 63.7% → 48.7%（-15.0pt）——比任何方法间差距都大。印证 sofagent lessons/think.md 反思区这一柱的分量：经验沉淀不是锦上添花，是技能进化的前提。
- **推理时禁查知识库反而更好**（-2.8pt）：训练 rollout 时让 Agent 直接查 Wiki，产出的轨迹对技能开发失去参考价值。反向印证 sofagent「约束层要轻、零 token 运行」——知识供进化者离线消费，不塞执行时上下文。
- **跨模型技能迁移存在负迁移**：4B 模型进化的技能把 Gemini-3.5-Flash 从 50.5% 拉到 18.1%——弱模型的低层 workaround 束缚强模型。sofagent 走 OpenAI 兼容多供应商路由（任意兼容端点均可接入），技能应按模型分级门控，不能全局通用投放。
- **溯源与提案审计**：`PURPOSE.md`（技能回链到所解决的 pattern）与 `skill-impact.md`（每次提案 diff/分数/接受与否程序化落账）两个小机制，与 sofagent 的 LEDGER/审计轨迹理念同源。**v1.4.5 第七章四已落地**：`solves:` frontmatter 溯源字段（SKILL/ 子树 5 个带 frontmatter 的 SKILL.md 补齐——「为什么存在」回链 pattern，改技能先懂设计意图）+ skill-impact 台账（`engine/orchestrator/src/skill-evolution/`——JSONL append-only 程序化落账，被拒提案带原因不丢教训）+ eval 门控（技能变更过 eval 验证集、分数超历史最优才收编，接通 benchmark/evaluation-log 既有闭环）+ 执行/进化上下文隔离（rollout 期禁查进化知识库的运行时守卫——executor 访问即审计告警，对应消融 -2.8pt 实证的工程化防御）。
- **自进化的开放问题恰是约束层的主场**：技能自进化的公开讨论自认仍缺质量控制、安全审核、版本管理三样——正是 sofagent 审计模块（规则集）+ 安全审查 + 回滚编排已经在做的事。开发者角色从「写技能」转为「设目标 + 把关」，与 sofagent 约束层哲学（人定规则、AI 执行、审计每次变更）同构，是 FDE 交付叙事的现成参照。

## 十一、meta-harness 生态与 sofagent 的定位（2026-06 Meta-Harness Summer 印证）

2026 年 6 月硅谷一周内涌现一批「harness 之上的 harness」（Databricks 开源 Omnigent 时正式造词，类比 K8s 之于容器）——多 agent 统一接入/调度/治理层。行业评估这类产品已收敛出五维检查清单，与 sofagent 已交付能力对照：

| 五维（行业共识） | sofagent 对应 |
|------|------|
| 统一接入（异构 agent 一套接口） | 多 harness 统一编排（多命名实例 + 轮转调度） |
| 安全隔离（沙箱 + 策略管权限） | SubAgent 沙箱 + PolicyLayer 四内置策略（file-lock/concurrency-cap/profile-allowlist/sensitive-tool） |
| 调度编排（多 agent 协作收敛） | 协作阵型库（规划中：commander&crews/cross-review/bake-off 等六阵型） |
| 可观测审计（谁改了什么可回溯） | AuditAggregator + worklog 工作明细 + decision-log 因果边 |
| 状态恢复（会话可持久可恢复） | FDE 进场记忆目录（session 目录 + 跨 session 恢复，✅ v1.4.5 已交付，S375 场景在册） |

**定位警示**：sofagent 不是「又一个 meta-harness」——meta-harness 解决「让一堆 agent 一起干活」，sofagent 解决「管住每一次变更」（约束层/审计层，平台无关）。对外叙事用「FDE Harness」借力 harness 概念普及时，防定位错置稀释差异化。另：斯坦福 IRIS Lab 同名论文走纵向路线（外循环搜索更优 harness 代码），与自迭代工具链思路同构，技能门控与提案审计机制已在 WikiSkill 收编中覆盖同类问题。

## 十二、STATE.md 持久化外部记忆模式

loop-engineering 社区将 STATE.md 定位为 **「对话外的持久化主干」**——Agent 每次任务启动时**必须先读**状态文件、结束时**必须写回**。这与 sofagent 的 `task/logs` 四字段（看到/改了/验证了/还剩）同构，但有两个增量值得吸收：

### 先读后写纪律

| 时机 | 动作 | 内容 |
|---|---|---|
| **任务启动** | 读 STATE.md | 上次做了什么、尝试了什么、什么在等人工 |
| **任务执行中** | 更新进行中标记 | `acting_on: branch-or-task-id`（防冲突锁） |
| **任务结束** | 写 STATE.md | 结果、时间戳、下一步、升级条件 |
| **每次运行** | 清理过期条目 | 已合并/已关闭/已完成的自动移除 |

### 防冲突：acting_on 字段

当多 Agent 节点并行时，每个节点在 STATE.md 中写入 `acting_on: <target>`（分支/PR/任务 ID）。其他节点启动前扫描所有 state 文件的 `acting_on`——若目标已被占用，跳过并记录到运行日志。

这在 sofagent 中的实现路径：
- FDE 节点部署时，在 `fde.md` 中加一条 rule：「启动前读取 `STATE.md` 中的 `acting_on`，若目标冲突则排队等待或升级」
- daemon 巡检可检测「同一 target 被两个节点同时 acting_on」→ 告警
- 此模式不需要额外基础设施——一个约定 + 一个 Markdown 表就够

> 📖 来源：cobusgreyling/loop-engineering（MIT 开源）— [primitives.md](https://github.com/cobusgreyling/loop-engineering/blob/main/docs/primitives.md)（+ Memory / State 条目）/ [multi-loop.md](https://github.com/cobusgreyling/loop-engineering/blob/main/docs/multi-loop.md)（Collision detection 条目）

---

## 十三、激活链扩展指南

> 激活链 Phase 1-4（ACTIVATE→ORCHESTRATE→EXECUTE→SUSTAIN）全部已实现。以下为给贡献者的扩展指南。

### 激活链要解决的工程问题

当前 orchestrator 包（1474 测试，实测见 `tools/check/test-count.sh`）和 registry.ts（v1.0.8 动态注册）已经能跑——但只有开发者手动写 `.sofagent/subagents/*.yml` 才能注册自定义 Agent。激活链做的事：**让 FDE 诊断交付物自动变成 `.sofagent/subagents/*.yml`**，不需要人手写。

### 扩展点

| 扩展什么 | 在哪 | 怎么做 |
|---------|------|--------|
| 新增 activate 步骤 | `engine/orchestrator/src/activate.ts`（新建） | 在 `activateWorkflow()` 的 7 步流程中插入新的处理逻辑 |
| 新增节点类型 | `engine/orchestrator/src/workflow-parser.ts` | 扩展映射表：workflow.yml 的节点 type → StateGraph node |
| 写一个 HITL 节点 | `engine/orchestrator/src/node-executor.ts`（v1.2.8 新建） | 用 LangGraph `interrupt_before` 在高风险节点前暂停（v1.2.9 hitl-handler.ts 承接） |
| 接入审计 hook | `engine/orchestrator/src/dag-runner.ts` | 在 node 执行后调 `@sofagent/audit` 的 `runRules()` |

### 文件清单（按版本）

| 文件 | 版本 | 说明 |
|------|------|------|
| `engine/orchestrator/src/activate.ts` | v1.2.5 | 激活链入口：读交付物 → 注册企业 SubAgent |
| `engine/orchestrator/src/workflow-parser.ts` | v1.2.6 | 扩展：支持企业 workflow.yml 的 HITL/审计字段 |
| `engine/orchestrator/src/enterprise-graph.ts` | v1.2.7 | `composeEnterpriseWorkflow()`：多 Agent → StateGraph |
| `engine/orchestrator/src/node-executor.ts` | v1.2.8 | 企业节点执行器（新建） |
| `engine/orchestrator/src/hitl-handler.ts` | v1.2.9 | HITL 中断处理 + 每节点审计集成 |
| `engine/orchestrator/src/dag-runner.ts` | v1.2.8 | 扩展：支持企业 Agent 执行 + 审计 hook |

> 详见 [激活链设计文档](./guides/fde-activation-chain.md)。

---

## 维护者口径

### 场景数 SSOT 口径

> **SSOT 口径**：`playbook/acceptance-test.sh` 头部「场景数」声明 = 真实 `scenario` 调用行数（非编号最大值、非运行时执行数）。当前值 377（最大场景号 S453；v1.5.3 release-gate 20260926-02 F 链 S316 复位 +1——阶段四批次误删场景恢复（原沿革记「S316→S298 归并」，发版闸门 F 链诊断以 git -S 实证 S298 壳内零承接断言即误删；daemon/watch/resume 三锚复位，锚文件更新为守护机制现态活体 release-gate-driver）；v1.5.3 release-gate 20260926-01 判断层 coverage 闭环批 +4：S450 模块一双规则引擎统一 / S451 模块五 ARCHITECTURE 三域结构锁 / S452 模块六判决成对完整门禁实跑 / S453 模块七 AuditScope 显式输入面（应用侧归并 S449）；v1.5.3 阶段四：S446→S442 / S316→S298 两处共壳归并 −2 + S449 三模块共壳 +1；v1.5.2 release-gate 20260924-01 判断层 P0×2 闭环 +3：S445 章八 BugFix 批五族代表锚点 / S446 章一 MCP audit 数据对外注册面+只读行为锁 / S447 章六 README 双语身份三层结构锁。原：最大场景号 S444，S1-S444 间 78 个历史空洞号；v1.5.2 审查面登记净 +2：新增 S442-S444 三场景 + S440/S441 锚点批归并入 S440 共壳（−1；断言整体移入 acceptance-node-probes.js，零删减）——章二/三 约束导出外部可验 + 运行时 should-run 判定链 / 章四/五 结论失效语义 + 网络出口治理面 / 章七/九 事前授权补环 + DSH 插件 npm 首发面；v1.5.1 验收增量 +1：S441 发布链加固代表锚——门禁清单覆盖对账三态 + 长跑凭据四道防线 + 随动面三锚，对齐 S440/S343 先例；v1.5.0 验收增量 +5：S427-S431 治理 KPI 面板/双时态时点快照/Validation Engine 环检测+fail-closed/trace 对账四态/FDE 陪跑期+插件事件接线——行为实测 dist 直调，多模块共场景对齐 S373/S374 先例）。
>
> 后续版本引用场景数一律以 `acceptance-test.sh` 头部声明为准，禁止从其他文档转述。逐版沿革账见 [v1.5.0 开发日志 · 附录](./changelog/v1.5/v1.5.0.md)。

### 加载链预算目标跟踪

- **≤3% 总占用预算目标**（加载链总占用 ≤ 上下文窗口 3% / 规范类 ≤500 字 / think ≤2K token）：当前未全量落地（全文注入，仅 persona 前 500 字符与 knowledge 单篇前 2000 字符有截断）。该目标拆两件、各自占位：
  - **自动压缩**（超预算触发摘要压缩 + start/end 标记 + 留痕）：目标版本 [v1.4.8](./changelog/v1.4/v1.4.8.md) 第四章——本版只收口「压缩」一件。
  - **窗口超预算拒载/降级机制**：仍未排期、无版本单元格（触发条件=自动压缩落地后实测仍频繁越线；触发后须**显式决策**——拒载越线项或降级至最小骨架，不许静默丢弃导致 limbo，fail-closed）。
  机制设计见 [ARCHITECTURE §四 加载链预算](./ARCHITECTURE.md#四核心设计决策)。
