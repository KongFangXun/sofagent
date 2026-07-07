# sofagent Handbook

> **企业上 AI，先上缰绳再上路——装上审计引擎，每次 Agent 提交代码时自动检查变更。配合约束底座管 Agent 行为，编排引擎拆解任务（FDE 部署用）。**
>
> v0.99.9 · 2026-07-04（UTC）· 北京时间 07-05 · 孔放勋

<img src="index/sofagent.png" alt="sofagent" width="300" />

- [阅读指南](#阅读指南)
- [5 分钟速览](#5-分钟速览)
- [场景一：装完第一件事](#场景一装完第一件事)
- [场景二：日常使用](#场景二日常使用)
- [场景三：排查问题](#场景三排查问题)
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
| 这是什么 | 给 Agent 加行为约束——4 底线 + 6 则铁律 | 场景二 |
| 怎么装 | `bash sofagent/scripts/install.sh` | 场景一 |
| 怎么用 | 装完直接派任务，复杂任务自动拆解 | 场景二 |
| AI 知识库 | `.sofagent/knowledge/` 目录，跨任务积累最佳实践，加载链被动注入 | [v1.1 日志](./docs/changelog/v1.1.md) |
| 已知局限 | 核心效果见 [evidence.md](./docs/evidence/evidence.md)；复盘 LLM 自评；明文存储 | [LIMITATIONS.md](./LIMITATIONS.md) |

---

## 场景一：装完第一件事

### 安装

```bash
git clone https://github.com/KongFangXun/sofagent.git
cd sofagent && bash sofagent/scripts/install.sh
```

> 只想加 Agent 行为约束？不需要装整个 sofagent——把 4 底线 + 6 铁律复制进你的 Agent 设置就行，详见 [README §快速体验](./README.md#快速体验)。

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

Agent 改完代码 commit 了——`sofagent-audit` 扫描 git diff 对照 A1-A11 审计规则逐条判定：

```bash
cd sofagent/audit && npm ci && npm run build
node dist/index.js --diff HEAD~1..HEAD --task "修复登录页 bug"
```

exit code：0 = 通过 / 1 = 有警告 / 2 = 有违规。零 Agent 依赖——看的是已发生的 git diff。

---

## 场景二：日常使用

### 三层加载链（地基）

每次对话启动时先加载 3 层常驻地基：

| 层 | 文件 | 干什么 | 能改吗 |
|:--:|------|------|:--:|
| 1 | `SKILL.md`（宪法内联） | 4 底线 + 6 铁律 | ❌ |
| 2 | `think.md` | 反思摘要（≤2K token） | ⚠️ 改了没用 |
| 3 | `fde.md` | 你的运行规范，优先级最高 | ✅ 随便改 |

> 地基约 3,000 token，不到 128K 窗口的 2.5%。OpenClaw 平台 Hook 自动注入 2-3 层，其他平台 Agent 主动 Read。详细推理见 [ARCHITECTURE.md](./ARCHITECTURE.md#why-resident)。

### 4 条底线 + 6 则行为铁律

**底线**：
1. 不泄露隐私
2. 不执行危险操作
3. 不生成有害内容
4. 不冒充人类身份

**铁律**：

| # | 铁律 | 一句话 | 做错时的表现 |
|:--:|------|------|------|
| 1 | 对用户有回应 | 任务完成主动收工，不确定时问「这样行不行」 | 子任务跑完了没告诉用户 |
| 2 | 错误显性化 | 报什么错、在哪一步、试了什么，不许吞错 | 报错静默跳过 |
| 3 | 不确定就问 | 列出两种以上理解让用户选，不猜 | 猜用户意思全猜错 |
| 4 | 目标驱动 | 回到原始意图，不跑偏 | 做着做着跑偏了 |
| 5 | 全局视角 | 先找现有代码和工具，不重复造轮子 | 有现成库不用自己写 |
| 6 | 成本意识 | 批量处理，简短回答 | 100 个文件一个一个改 |

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
| think.md 出现错误记忆 | 直接编辑删掉；对照 task/logs 核实 |
| 编排结果不稳定 | 同类任务跑够 3 次用模板；没模板时少拆子任务 |
| Agent 卡住不动 | 断路器保护——任务拆得不够细，拆小点再跑 |
| 评分越来越不准 | 翻 task/logs 对照 think.md，清理低置信度旧条目 |
| 什么不该让 Agent 做 | 确定性操作（去重/格式校验/文件清理）用脚本 |

> 更多见 [LIMITATIONS.md](./LIMITATIONS.md#known-limits)。

### Osmani 三盆冷水

| 冷水 | 意思 | sofagent 的应对 |
|------|------|------|
| 验证责任不可替代 | Agent 说「做完了」是声明不是证明 | 审计 A8 要求可观测证据（测试通过/lint/API 200） |
| 理解债 | Loop 交付你没写过的代码越快，理解鸿沟越大 | task/logs 只追加不修改，永远可回溯；think.md 每步记录决策日志 |
| 认知投降 | 最舒服的状态是不再有自己观点 | fde.md 随时加规则覆盖；编排可回滚；审计独立于 Agent |

> 💡 **反认知投降的三道护栏**：fde.md 规则覆盖（保留人类话语权）、编排可回滚（保留人类否决权）、审计引擎独立于 Agent（保留人类验收权）。这不是技术特性，是制度设计——确保人类永远是最终决策者，不是 AI 产出的被动接收者。详见 [ARCHITECTURE 设计原则](./ARCHITECTURE.md#设计原则的理论支撑)。

> 💡 **模型越强，纪律层越值钱**。模型能完成 90% 任务，但剩余 10% 不可预测失误 = 只能做助手不能做自主系统。模型越强 → 90% 常规范围越广 → 但 10% 高风险场景价值反升。sofagent 占据的正是那 10%——审计、验证、复盘、兜底、为结果负责。

---

## 场景四：自定义

### 改写 fde.md

`fde.md` 是你的运行规范，优先级最高。写什么就生效什么。设计理想 ≤500 字（当前实际 ~1,600 字——写少了 Agent 记得更牢，v1.x 计划精简）

模板在 `sofagent/skill/data/fde.md`。常用配置：
- 模型偏好（`深度思考优先` / `速度优先`）
- 输出风格（`回复控制在 200 字以内` / `优先用中文`）
- 项目规则（`不要生成 .md 文件` / `改代码前先确认`）

### 审计规则

当前 A1-A11 共 11 条审计规则，源码在 `sofagent/audit/src/rules/`。每条规则独立，新增只需写函数 + 注册一行。详见 [DEVELOPMENT §八](./DEVELOPMENT.md#八提交时审计)。

### 概念速查

核心 = **4 底线 + 6 铁律 + 三层加载链**（所有平台生效）。增强 = 编排引擎 + 断路器 + Hook 注入（仅 OpenClaw）。完整概念分层见 [README](./README.md)。

---

## 场景五：FDE 部署

> ⚠️ **成熟度**：审计引擎是稳定的（跨平台、零 Agent 依赖）。FDE 部署流程已有完整的四阶段十二步 + 五份模板 + quick-start，核心流程可用。编排引擎仍为实验性（依赖 OpenClaw，非 OpenClaw 平台仅约束+审计可用）。遇到问题开 Issue。
>
> **FDE 工具包本身就是 sofagent 产品的一部分。** sofagent 的核心是底座，FDE 是底座落地进企业的场景。FDE 用这个工具包帮企业梳理 workflow、识别 AI 节点、装上底座——**FDE 办事用自己产品，给别人部署完让别人也用自己产品。**

> FDE = Forward Deployed Engineer（前向部署工程师）。完整四阶段十二步流程见 [FDE/FDE.md](./FDE/FDE.md)。建议装 [sofagent-fde Skill](./FDE/SKILL.md)——Agent 自动加载 FDE 工作台。

### 部署的核心是装上 sofagent

没有 sofagent，前面梳理的 workflow 就是一份漂亮的 PPT。三层引擎装到设备上，AI 节点才有了纪律和审计：

| 层 | 做什么 | 怎么跑 |
|----|--------|--------|
| 约束底座 | fde.md 规则注入 Agent 上下文 | install.sh 装完自动加载 |
| 审计引擎 | git diff → 11 条规则 → exit code | git pre-commit hook |
| 编排引擎（实验性）| ao compose 拆任务生成编排方案 | 跑在 OpenClaw 上 |

### 离场后企业留下什么

| 产物 | 说明 |
|------|------|
| **交付手册** | 企业画像 + 部署方案 + `fde.md` + `quick-start.md`（后两章安装包自带） |
| **AI 节点（三层实体）** | 每个节点：文档层（.md，人读+编排引擎读）+ Skill 层（企业专属 Skill）+ 运行层（在跑的 session） |
| **AI 知识库** | `.sofagent/knowledge/` 目录——跨任务积累的结构化知识（entities/ + concepts/ + comparisons/）。daemon 自动 Ingest，加载链被动注入。v1.1 实现，当前为散文件（think.md / task/logs / scoring.md） |

> 企业专属 Skill 会基于 scoring.md 评分自动迭代优化——检查点不合格时触发优化分析，A/B 测试新版本。详见 [ROADMAP](./ROADMAP.md) 企业 Skill 自进化。

> sofagent 不做 AI 中台——做 AI 中台里**约束 Agent 行为和审计的那一层**。

---

## 致谢

sofagent 站在 8 个开源项目和 7 篇文章/社区的肩膀上。→ [完整致谢](./THANKS.md)

## 彩蛋

不想装 Skill？把下面这段扔给 Agent：

```
请完整阅读 HANDBOOK.md 和 DEVELOPMENT.md，按 Handbook 约束自己的行为。

【行为底线】遵守 4 底线 + 6 铁律；每步验证再干；不确定就问；完成任务主动收工。

【帮我生成】
1. SKILL.md — 4 底线 + 6 铁律（原样抄）
2. think.md — 反思区空白模板
3. fde.md — 根据你对我的了解写几条规则

【最后告诉我】哪些功能因平台做不了、我现在做到什么程度、还需要手动做什么。
```

---

> 大半年 OpenClaw 实战笔记。如有更好的用法，欢迎开 Issue。
>
> *v0.99.9，2026 年 7 月 4 日*
