# sofagent Handbook

> **企业上 AI，先上缰绳再上路——装上审计引擎，每次 Agent 提交代码时自动检查变更。配合约束底座管 Agent 行为，编排引擎拆解任务（FDE 部署用）。**
>
> v1.0.4 · 2026-07-11（UTC）· 孔放勋

<img src="sofagent.png" alt="sofagent" width="300" />

- [阅读指南](#阅读指南)
- [5 分钟速览](#5-分钟速览)
- [场景一：装完第一件事](#场景一装完第一件事)
- [场景二：日常使用](#场景二日常使用)
- [场景三：排查问题](#场景三排查问题)
- [安装与运行常见问题](#安装与运行常见问题)
- [场景四：自定义](#场景四自定义)
- [场景五：FDE 部署](#场景五fde-部署)
- [致谢](#致谢)
- [彩蛋](#彩蛋)

---

## 阅读指南

| 你是谁 | 先读哪 |
|------|------|
| 刚装上 | 场景一 → 场景二 |
| 日常干活 | 场景二 → 场景三 |
| 想改规矩 | 场景四 |
| FDE | 场景一 → 场景五 |
| 想理解内部机制 | [开发文档](./DEVELOPMENT.md) |
| 想理解设计哲学 | [设计文档](./ARCHITECTURE.md) |

---

## 5 分钟速览

| 你想知道的 | 一句话 | 详见 |
|------|------|------|
| 这是什么 | 给 Agent 加行为约束——4 底线 + 7 则铁律 | 场景二 |
| 怎么装 | `bash sofagent/scripts/install.sh` | 场景一 |
| 怎么用 | 装完直接派任务，复杂任务自动拆解 | 场景二 |
| AI 知识库 | `.sofagent/knowledge/` 目录，跨任务积累最佳实践，加载链被动注入 | [v1.0.1 日志](./changelog/v1.0.1.md) · [设计原理](./ARCHITECTURE.md#数据层ai-知识库v101-实现) |
| AI 成熟度 | 三级台阶（替换→增强→重构），FDE 帮企业从第二级跨到第三级——不只装 AI，还装上责任机制 | [FDE/FDE.md](../FDE/FDE.md#附录企业-ai-成熟度三级台阶) |
| 已知局限 | 核心效果见 [evidence.md](./evidence/evidence.md)；复盘 LLM 自评；明文存储 | [LIMITATIONS.md](./LIMITATIONS.md) |

---

## 场景一：装完第一件事

### 安装

```bash
git clone https://github.com/KongFangXun/sofagent.git
cd sofagent && bash sofagent/scripts/install.sh
```

> 只想加 Agent 行为约束？不需要装整个 sofagent——把 4 底线 + 7 铁律复制进你的 Agent 设置就行，详见 [README](../README.md)。

**前置依赖**：

| 依赖 | 版本 | 为什么 | 检查 |
|------|------|------|------|
| bash | ≥4 | install.sh / task-record.sh | `bash --version` |
| git | 任意 | clone + task/logs 追溯 | `git --version` |
| node | ≥18 | 编排引擎 + 审计 CLI | `node --version` |
| npm | ≥9 | 安装 agency-orchestrator | `npm --version` |

> 只用宪法层约束（不跑编排引擎/审计）可不带 node/npm。

| 平台 | install.sh 行为 |
|------|------|
| `openclaw` | 完整部署——宪法 + Hook + 配套脚本 + 断路器 → `~/.openclaw/` |
| `workbuddy` | 部署 SKILL.md → `~/.workbuddy/skills/sofagent/` |
| `claude` | 部署宪法 + 输出种子指令（手动粘贴到 CLAUDE.md）|
| `codex` | 部署宪法 + 输出种子指令（手动粘贴到 AGENTS.md）|
| `hermes` | 部署宪法 + 输出种子指令（手动粘贴到 SOUL.md）|

### 验证装好了

```bash
bash sofagent/scripts/verify.sh    # 跑 verify 检查，通过即装好可用（--json 可进 CI）
# 或 npm 安装后直接用
sofagent-verify                     # 同样跑 verify 检查
```

> ⚠️ 不要靠 Agent 回复验证——SKILL.md 闸门要求初始化过程不输出给用户。只信验证脚本的输出。

### 安装后的目录

```
你的项目根目录（$PWD）               OpenClaw 用户目录
├── .sofagent/          ← 数据目录    ~/.openclaw/
│   ├── think.md                     ├── skills/sofagent/   ← Skill 文件
│   └── task/logs/                   └── scripts/           ← 部署脚本
```

`.sofagent/` 建在**你的项目根目录**，不是 sofagent 仓库目录。

### 跨平台能力差异

OpenClaw 完整能力（Hook 自动注入 + 断路器 + 编排引擎）。其他平台核心约束生效，编排引擎降级。详见 [开发文档 §一](./DEVELOPMENT.md#脚本与文件结构速查)。

### 提交后审计

Agent 改完代码 commit 了——`sofagent-audit` 扫描 git diff 对照 A1-A15 审计规则逐条判定：

```bash
cd sofagent/audit && npm ci && npm run build
node dist/index.js --diff HEAD~1..HEAD --task "修复登录页 bug"
```

exit code：0 = 通过 / 1 = 有警告 / 2 = 有违规。零 Agent 依赖——看的是已发生的 git diff。

### daemon 后台进程

安装时可选择安装 daemon（轻量后台进程，macOS launchd / Linux systemd）。daemon 每 30 秒检查 `think.md` 和 `fde.md` 的文件 hash 变化——如果变了，写入 `daemon-notice.md` 通知。**不直接审计 git commit**（commit 审计由 pre-commit hook 负责，见上方）。

> daemon 是可选组件——即使不装，宪法层约束和 pre-commit hook 审计照样生效。

### CI 集成

在 GitHub Actions 中自动运行审计（静默模式 + CI 严格模式）：

```yaml
# .github/workflows/sofagent-audit.yml
name: sofagent-audit
on: [push, pull_request]
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 2
      - uses: actions/setup-node@v5
        with:
          node-version: '22'
      - run: npm install -g @sofagent/audit
      - run: sofagent-audit --diff HEAD --silent --ci
```

#### 模式对照表

| 模式 | 标志 | 说明 | 退出码 |
|------|------|------|:--:|
| 默认 | *(无)* | 全部规则（含 Agent 日志） | 0/1/2 |
| 静默 | `--silent` | 只跑 git-diff 规则（零 Agent 依赖） | 0/1/2 |
| 严格 | `--strict` | 任何警告都 exit 2 | 0/2 |
| CI | `--ci` | = `--silent` + `--strict` | 0/2 |

模式可叠加——例如 `--diff HEAD --silent --strict` 等价于 `--diff HEAD --ci`。

---

## 场景二：日常使用

### 四层加载链（v1.0.1）

每次对话启动时先加载 4 层常驻地基：

| 层 | 文件 | 干什么 | 能改吗 |
|:--:|------|------|:--:|
| 1 | `SKILL.md`（宪法内联） | 4 底线 + 7 铁律 | ❌ |
| 2 | `think.md` | 反思摘要（≤2K token） | ⚠️ 改了没用。→ [反思工程](./DEVELOPMENT.md#六反思工程) |
| 3 | `fde.md` | 你的运行规范，优先级最高 | ✅ 随便改 |
| 4 | `knowledge/index.md` | AI 知识库目录，被动注入 top-3 页摘要 | ⚠️ daemon 自动维护 |

> 地基约 3,500 token，不到 128K 窗口的 3%。OpenClaw 平台 Hook 自动注入 2-4 层，其他平台 Agent 主动 Read。详见 [ARCHITECTURE.md](./ARCHITECTURE.md#两层架构地基-vs-引擎)。

### 双引擎怎么跑

> 审计引擎（git diff → A1-A15）和编排引擎（Workflow 梳理 + A/B 重测）通过 think.md 交汇。完整架构图和流程详见 [README § 怎么工作](../README.md#fde-怎么工作) 和 [ARCHITECTURE](./ARCHITECTURE.md)。

| 引擎 | 做什么 | 依赖 Agent | 触发方式 |
|------|------|:--:|------|
| **审计引擎** | git diff → A1-A15 规则检查 → 自动生成 think.md | ❌ | 每次 git commit |
| **编排引擎**（实验性）| Workflow 梳理时生成节点定义 + 定期 A/B 重优化 | ✅ | Workflow 梳理时 / 定时触发。→ [编排哲学](./DEVELOPMENT.md#二编排哲学) |

### 4 条底线 + 7 则行为铁律

**底线**：
1. 不泄露隐私
2. 不执行危险操作
3. 不生成有害内容
4. 不冒充人类身份

**铁律**：

| # | 铁律 | 一句话 | 做错时的表现 |
|:--:|------|------|------|
| 0 | 知行合一 | 说和做一致，声称必有证据 | 说读了文件实际没读 |
| 1 | 目标驱动 | 回到原始意图，不跑偏 | 做着做着跑偏了 |
| 2 | 全局视角 | 先找现有代码和工具，不重复造轮子 | 有现成库不用自己写 |
| 3 | 成本意识 | 批量处理，简短回答 | 100 个文件一个一个改 |
| 4 | 存疑即问 | 列出两种以上理解让用户选，不猜 | 猜用户意思全猜错 |
| 5 | 不藏错误 | 报错、在哪、试了什么，不许吞错 | 报错静默跳过 |
| 6 | 有始有终 | 任务完成主动收工，不确定时问用户 | 子任务跑完了没告诉用户 |

> 「验证」不是自说自话——是跑测试、跑 lint、API 返回码、文件 diff。

### 任务目标制定

> 负责的子 Skill：`task-aware.md`。强模型时代，告诉 Agent **要什么**比告诉它**怎么做**更重要。

Agent 先判断任务复杂度：

| 级别 | 特征 | Agent 行为 |
|:--:|------|------|
| 🟢 简单 | 单步指令，说得明确 | 直接干活 |
| 🟡 中等 | 多步但方向清楚 | 先干，说一句「中间需要随时叫我」 |
| 🔴 复杂 | 模糊、多模块 | 问「需要拆解吗？」→ 用户同意才启动 |

只有 🔴 复杂任务进入两轮澄清：

```
第一轮 · 目标确认
  Agent 追问缺失信息（数据范围/产出形式/受众/时间限制）
  → 用户回答

第二轮 · 编排方案
  Agent 跑 ao compose → 输出方案：「拆成 N 个子任务、预估 token/成本。可行？」
  → 用户确认 → 执行
  → 用户不认可 → 指哪改哪，重生成方案
  → 说不清楚 → 回到第一轮
```

**两轮封顶**：两轮后仍不认可，请用户重新描述。开放式提问，不替用户做假设。详见 [DEVELOPMENT §二](./DEVELOPMENT.md#二编排哲学)。

### 能力边界

| ✅ 能做 | ❌ 做不了 |
|------|------|
| 数据：分析、报表、图表、格式转换 | 物理世界：动手操作 |
| 文字：撰写、翻译、校对、摘要 | 图像视频：剪辑、特效 |
| 代码：生成、审查、测试、重构 | 人际：面对面沟通 |
| 检索：搜集、整理、对比研究 | 系统 GUI：鼠标点击 |

超出边界直接说「做不了」，但给替代方向。

---

## 场景三：排查问题

| 问题 | 怎么办 |
|------|------|
| Agent 不遵守铁律 | 检查文件位置；关键规则写 fde.md；非 OpenClaw 手动 `@skill:sofagent` |
| think.md 出现错误记忆 | 直接编辑删掉；对照 task/logs 核实。→ [反思工程 三道防线](./DEVELOPMENT.md#六反思工程) |
| 编排结果不稳定 | 同类任务跑够 3 次用模板；没模板时少拆子任务 |
| Agent 卡住不动 | 断路器保护——任务拆得不够细，拆小点再跑。→ [自进化 检查点](./DEVELOPMENT.md#五自进化机制) |
| 评分越来越不准 | 翻 task/logs 对照 think.md，清理低置信度旧条目 |
| 什么不该让 Agent 做 | 确定性操作（去重/格式校验/文件清理）用脚本 |

> 更多见 [LIMITATIONS.md](./LIMITATIONS.md)。

### 安装与运行常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| `sofagent-audit: Node.js 未找到` | Node.js 未安装或版本过低 | 安装 Node.js ≥18：`node --version` 确认 |
| commit 时没有审计输出 | pre-commit hook 未安装 | `sofagent-audit --init` 或 `sofagent-audit --install-hook` |
| 首次 commit 提示「无需审计」 | 全新仓库首次提交没有前一个版本可对比 | 正常——下次 commit 起审计自动生效 |
| Windows 上部分检查缺失 | Windows 为实验性支持 | 核心审计引擎可用，PowerShell 脚本覆盖不全，详见 [LIMITATIONS](./LIMITATIONS.md#windows-支持是实验性的) |
| hook 装了但静默跳过 | Node.js 或 sofagent-audit 缺失时 hook 旧版会静默跳过 | v1.0 hook 含无声失败保护，会 exit 1 + 提示；旧 hook 跑 `--init` 更新 |
| `sofagent-audit --doctor` 报 config 缺失 | 未跑过 `--init` | 跑 `sofagent-audit --init` 生成 config.yml，或用默认配置（11 条规则全启用） |

### Osmani 三盆冷水

| 冷水 | 意思 | sofagent 的应对 |
|------|------|------|
| 验证责任不可替代 | Agent 说「做完了」是声明不是证明 | 审计 A8 要求可观测证据（测试通过/lint/API 200） |
| 理解债 | Loop 交付你没写过的代码越快，理解鸿沟越大 | task/logs 只追加不修改，永远可回溯；think.md 每步记录决策日志 |
| 认知投降 | 最舒服的状态是不再有自己观点 | fde.md 随时加规则覆盖；编排可回滚；审计独立于 Agent |

> 💡 **反认知投降的三道护栏**：fde.md 规则覆盖（保留人类话语权）、编排可回滚（保留人类否决权）、审计引擎独立于 Agent（保留人类验收权）。这不是技术特性，是制度设计——确保人类永远是最终决策者，不是 AI 产出的被动接收者。详见 [ARCHITECTURE 设计原则](./ARCHITECTURE.md#设计原则的理论支撑)。

> > "Build a Loop, but build it like an engineer who plans to keep being one." — Ozzmani。Loop 不是造完就不用管的自动化流水线，是工程师持续维护的工程系统。

> 💡 **模型越强，纪律层越值钱**。模型能完成 90% 任务，但剩余 10% 不可预测失误 = 只能做助手不能做自主系统。模型越强 → 90% 常规范围越广 → 但 10% 高风险场景价值反升。sofagent 占据的正是那 10%——审计、验证、复盘、兜底、为结果负责。

---

## 场景四：自定义

### 改写 fde.md

`fde.md` 是你的运行规范，优先级最高。写什么就生效什么。设计理想 ≤500 字（当前实际 ~1,600 字——写少了 Agent 记得更牢，v1.x 计划精简）

模板在 `sofagent/skill/data/fde.md`。常用配置：
- 模型偏好（`深度思考优先` / `速度优先`）
- 输出风格（`回复控制在 200 字以内` / `优先用中文`）
- 项目规则（`不要生成 .md 文件` / `改代码前先确认`）

> 💡 **短词锚定技巧**：提炼一个专属短词（如 `vertical slice`）替代整段行为规范（如「不要一次性写完整功能，先做小范围验证，早点拿反馈」），反复在 fde.md 中强化该词。验证标准：观察 Agent 输出中是否主动提及该短词——若出现则说明行为已被成功引导。注意：短词在团队内必须绝对统一，不可随意替换不同表述。（来源：Matt Pocock 的 Agent Skill 构建方法论）

### 审计规则

当前 A1-A15 共 17 条（11 默认 + 6 扩展）审计规则，源码在 `sofagent/audit/src/rules/`。每条规则独立，新增只需写函数 + 注册一行。详见 [DEVELOPMENT §八](./DEVELOPMENT.md#八提交时审计)。

### 概念速查

| 术语 | 一句话解释 |
|------|------|
| **Harness 层** | 管 Agent 行为的「缰绳」——不改模型，改模型外围的执行机制。→ [设计原理](./ARCHITECTURE.md#两层架构地基-vs-引擎) |
| **审计引擎** | 看 git diff 硬证据判定违规，提交时触发，不依赖 Agent 配合。→ [为什么外置](./ARCHITECTURE.md#为什么审计必须外置) |
| **编排引擎**（实验性）| 拆任务→编排→执行，基于 DeepAgents Sub Agent。→ [编排哲学](./DEVELOPMENT.md#二编排哲学) |
| **铁律** | Agent 行为约束规则（4 底线 + 7 铁律），写在 MD 文件里注入上下文 |
| **审计规则** | 代码变更检查规则（A1-A15），审计引擎按此判定 exit code |
| **Skill** | Agent 行为模板——一组 .md 文件，定义 Agent 在什么场景做什么 |
| **think.md** | Agent 任务结束后的反思记录——踩了什么坑、下次怎么办 |
| **daemon** | 轻量后台进程，每 30 秒检查 think.md/fde.md 文件 hash 变化并通知 |
| **OpenClaw** | 开源 Agent 平台，sofagent 的约束底座和加载链 Hook 跑在上面 |
| **四层加载链** | SKILL.md（宪法层）→ think.md（反思层）→ fde.md（执行层）→ knowledge/index.md（知识层）注入顺序 |
| **FDE** | Forward Deployed Engineer，四阶段十二步：梳理工作流→构建本体模型→识别节点与量化→部署→离场 |

核心 = **4 底线 + 7 铁律 + 四层加载链**（所有平台生效）。增强 = 编排引擎 + 断路器 + Hook 注入（OpenClaw 全功能，其他平台核心可用）。完整概念分层见 [README](../README.md)。

---

## 场景五：FDE 部署

> ⚠️ **成熟度**：审计引擎是稳定的（跨平台、零 Agent 依赖）。FDE 部署流程已有完整的四阶段十二步 + 五份模板 + quick-start，核心流程可用。编排引擎仍为实验性（基于 DeepAgents Sub Agent，所有平台可用）。遇到问题开 Issue。
>
> **FDE 工具包本身就是 sofagent 产品的一部分。** sofagent 的核心是底座，FDE 是底座落地进企业的场景。FDE 用这个工具包帮企业梳理工作流、构建本体模型、识别节点与量化、装上底座——**FDE 工作用自己产品，给别人部署完让别人也用自己产品。**

> FDE = Forward Deployed Engineer（前向部署工程师）。完整四阶段十二步流程见 [FDE/FDE.md](../FDE/FDE.md)。建议装 [sofagent-fde Skill](../FDE/SKILL.md)——Agent 自动加载 FDE 工作台。

### 部署的核心是装上 sofagent

没有 sofagent，前面梳理的 workflow 就是一份漂亮的 PPT。三层引擎装到设备上，AI 节点才有了纪律和审计：

| 层 | 做什么 | 怎么跑 |
|----|--------|--------|
| 约束底座 | fde.md 规则注入 Agent 上下文 | install.sh 装完自动加载 |
| 审计引擎 | git diff → A1-A15 规则 → exit code | git pre-commit hook |
| 编排引擎（实验性）| DeepAgents 拆任务生成编排方案，Sub Agent 并行执行 | 全平台可用 |

### 离场后企业留下什么

| 产物 | 说明 |
|------|------|
| **交付手册** | 企业画像 + 部署方案 + `fde.md` + `quick-start.md`（后两章安装包自带） |
| **AI 节点（三层实体）** | 每个节点：文档层（.md，人读+编排引擎读）+ Skill 层（企业专属 Skill）+ 运行层（在跑的 session） |
| **AI 知识库** | `.sofagent/knowledge/` 目录——结构化知识系统（entities/ → relations → concepts/ → comparisons/，轻量级 GraphRAG）。daemon 自动 Ingest，加载链被动注入。think.md / task/logs / scoring.md 由 AI 节点自动生成。见 [设计原理](./ARCHITECTURE.md#数据层ai-知识库v101-实现) |
| **私有化评估体系** | scoring.md + Skill 迭代历史 + 知识库演变轨迹。工具可复制，差异化反馈无法复制——企业的长期竞争壁垒。见 [FDE/FDE.md](../FDE/FDE.md) |

> 企业专属 Skill 会基于 scoring.md 评分自动迭代优化——检查点不合格时触发优化分析，A/B 测试新版本。详见 [ROADMAP](../ROADMAP.md) 企业 Skill 自进化。

> sofagent 不做 AI 中台——做 AI 中台里**约束 Agent 行为和审计的那一层**。

---

---

## 相关技术栈

sofagent 不是孤立的——它构建于以下成熟项目之上，各司其职：

| 技术 | 在 sofagent 中的角色 | 引入版本 |
|------|------|:--:|
| [LangChain](https://github.com/langchain-ai/langchainjs) + [LangGraph](https://github.com/langchain-ai/langgraphjs) | 编排引擎——状态图、条件路由、HITL、持久化 | v1.0.1 |
| [DeepAgentsJS](https://github.com/langchain-ai/deepagentsjs) | Sub Agent 系统——FDE Sub Agent + Audit Sub Agent | v1.0.1 |
| [Agency Agents](https://github.com/msitarzewski/agency-agents) | 230+ 岗位模板——Sub Agent 角色定义 | v1.0.3 |
| [微软 SkillOpt](https://github.com/microsoft/SkillOpt) | Skill 自进化引擎——训练→验证→替换 | v1.0.3 |
| [OpenFDE](https://open-fde.com) | 行业定位验证——10 步工作流 + 8 维能力模型 | v1.0 |
| [Palantir Ontology](https://www.palantir.com/platforms/aip/) | 企业世界模型——实体+关系+动作+约束 | v1.0.1-v1.0.5 |

## 致谢

sofagent 站在 8 个开源项目和 7 篇文章/社区的肩膀上。→ [完整致谢](./THANKS.md)

## 彩蛋

不想装 Skill？把下面这段扔给 Agent：

```
请完整阅读 HANDBOOK.md 和 DEVELOPMENT.md，按 Handbook 约束自己的行为。

【行为底线】遵守 4 底线 + 7 铁律；每步验证再干；不确定就问；完成任务主动收工。

【帮我生成】
1. SKILL.md — 4 底线 + 7 铁律（原样抄）
2. think.md — 反思区空白模板
3. fde.md — 根据你对我的了解写几条规则

【最后告诉我】哪些功能因平台做不了、我现在做到什么程度、还需要手动做什么。
```

---

> 大半年 OpenClaw 实战笔记。如有更好的用法，欢迎开 Issue。
>
> *v1.0.4，2026 年 7 月 11 日*
