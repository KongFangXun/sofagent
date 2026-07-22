# sofagent Handbook

> **给 SMB 和 OPC 的 FDE Agent ——底层是 sofagent 引擎（Harness 中间件），一底座·四引擎覆盖全生命周期。** 你看到的 FDE Agent 是产品身份；翻到底下，约束底座管行为、审计引擎盯结果、编排引擎自动干活、回溯引擎兜回滚、进化引擎越用越好。装完之后，你不再需要依赖别人来部署 AI——**你自己就具备了 FDE 的能力：掌握完整上下文、打破岗位边界、对结果负责。** 下面从装到用到查问题，全流程走一遍。
>
> v1.1.9 · 2026-07-22（UTC）· 孔放勋

<img src="assets/sofagent.png" alt="sofagent" width="160" />

- [阅读指南](#阅读指南)
- [5 分钟速览](#5-分钟速览)
- [场景一：装完第一件事](#场景一装完第一件事)
- [场景二：日常使用](#场景二日常使用)
- [场景三：排查问题](#场景三排查问题)
- [场景四：自定义](#场景四自定义)
- [场景五：FDE 部署与持续优化](#场景五fde-部署与持续优化)
- [相关技术栈](#相关技术栈)
- [致谢](#致谢)
- [彩蛋](#彩蛋)

---

## 阅读指南

| 你是谁 | 先读哪 |
|------|------|
| 刚装上 | 场景一 → 场景二 |
| 日常干活 | 场景二 → 场景三 |
| 想改规矩 | 场景四 |
| FDE | 场景一 → 场景五（部署与持续优化） |
| 想理解内部机制 | [开发文档](./DEVELOPMENT.md) |
| 想理解设计哲学 | [设计文档](./ARCHITECTURE.md) |
| 想理解为什么这么做 | [设计哲学](./PHILOSOPHY.md)（**强烈推荐，读 5 分钟**） |
| 想配置 MCP 推送 | [MCP 使用指南](./guides/mcp-usage.md) |

> 📁 **项目文件导航**：根目录 8 个 .md 文件各司其职——[README.md](../README.md)（项目概览）、[README.en.md](../README.en.md)（英文概览）、[CHANGELOG.md](../CHANGELOG.md)（版本索引）、[ROADMAP.md](../ROADMAP.md)（路线图）、[LIMITATIONS.md](../LIMITATIONS.md)（已知局限）、[SECURITY.md](../SECURITY.md)（安全策略）、[CONTRIBUTING.md](../CONTRIBUTING.md)（贡献指南）、[CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md)（行为准则）。其余文档在 `docs/` 子目录下。

---

## 5 分钟速览

| 你想知道的 | 一句话 | 详见 |
|------|------|------|
| 这是什么 | 给 SMB 和 OPC 的 FDE Agent——底层 sofagent 引擎（Harness 中间件）管 Agent 行为 | 场景二 |
| 怎么装 | `bash sofagent/scripts/install.sh`（装底层 sofagent 引擎底座；装 FDE 入口见 [FDE/README](../FDE/README.md)） | 场景一 |
| 怎么用 | 装完直接派任务，复杂任务自动拆解 | 场景二 |
| 审计怎么跑 | 开发者：git commit 自动审计。非开发者：v1.0.8+ daemon 监控文件变更自动审计 | 场景一 |
| AI 知识库 | `.sofagent/knowledge/` 目录，跨任务积累最佳实践，加载链被动注入 | [v1.0.1 日志](./changelog/v1.0.1.md) |
| AI 成熟度 | 三级台阶（替换→增强→重构），FDE 帮企业从第二级跨到第三级——不只装 AI，还装上责任机制 | [FDE/FDE.md](../FDE/FDE.md#附录企业-ai-成熟度三级台阶) |
| 已知局限 | 核心效果见 [evidence.md](./evidence/evidence.md)；复盘 LLM 自评；明文存储 | [LIMITATIONS.md](../LIMITATIONS.md) |

---

## 场景一：装完第一件事

> 💬 **sofagent 没有界面。** 装完之后，你不会看到任何窗口或网页。你通过你的 Agent（WorkBuddy / Codex / Claude Code）和 sofagent 对话——说一句话，它做完了告诉你结果在哪。这就是 sofagent 的运行方式：语言就是界面，MCP 就是入口。详见 [设计哲学](./PHILOSOPHY.md)。

> 📊 **部署后你会自动收到这些**：每周审计守护报告（拦截了多少次违规）、每月知识库增长报告（AI 掌握了多少实体）、每季度无 FDE 对照报告（裸模型 vs sofagent 回答对比）、扩容预警。这些是 FDE 持续存在感的证明——由 sofagent 引擎自动生成推送，不需要人工干预。详见 [FDE §13 持续存在感机制](../FDE/FDE.md#13-竣工后持续存在感机制)。

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
| npm | ≥9 | 安装 deepagents（编排引擎） | `npm --version` |

> 只用宪法层约束（不跑编排引擎/审计）可不带 node/npm。

| 平台 | install.sh 行为 |
|------|------|
| `openclaw` | 完整部署——宪法 + Hook + 配套脚本 + 断路器 → `~/.openclaw/` |
| `workbuddy` | 部署 SKILL.md → `~/.workbuddy/skills/sofagent/` |
| `claude` | 部署宪法 + 输出种子指令（手动粘贴到 CLAUDE.md）|
| `codex` | 部署宪法 + 输出种子指令（手动粘贴到 AGENTS.md）|
| `hermes` | 部署宪法 + 输出种子指令（手动粘贴到 SOUL.md）|

#### 安装常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| `sofagent-audit: Node.js 未找到` | Node.js 未安装或版本过低 | 安装 Node.js ≥18：`node --version` 确认 |
| commit 时没有审计输出 | commit-msg hook 未安装 | `sofagent-audit --init` 或 `sofagent-audit --install-hook` |
| 首次 commit 提示「无需审计」 | 全新仓库首次提交没有前一个版本可对比 | 正常——下次 commit 起审计自动生效 |
| Windows 上部分检查缺失 | Windows 为实验性支持 | 核心审计引擎可用，PowerShell 脚本覆盖不全，详见 [LIMITATIONS](../LIMITATIONS.md#windows-支持是实验性的) |
| hook 装了但静默跳过 | Node.js 或 sofagent-audit 缺失时 hook 旧版会静默跳过 | v1.0 hook 含无声失败保护，会 exit 1 + 提示；旧 hook 跑 `--init` 更新 |
| `sofagent-audit --doctor` 报 config 缺失 | 未跑过 `--init` | 跑 `sofagent-audit --init` 生成 config.yml，或用默认配置（11 条规则全启用） |

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

Agent 改完代码 commit 了——`sofagent-audit` 扫描 git diff 对照 A1-A11、A14-A19 审计规则逐条判定：

```bash
cd sofagent/audit && npm ci && npm run build
node dist/index.js --diff HEAD~1..HEAD --task "修复登录页 bug"
```

exit code：0 = 通过 / 1 = 有警告 / 2 = 有违规。零 Agent 依赖——看的是已发生的 git diff。

### daemon 后台进程

安装时可选择安装 daemon（轻量后台进程，macOS launchd / Linux systemd）。daemon 做两件事：① 每 30 秒检查 `think.md`/`fde.md` hash 变化写入 `daemon-notice.md`；② v1.0.8+ 监控文件变更自动跑审计。commit 审计由 commit-msg hook 负责（见上方）。

审计结果按严重级别处理：

| 结果 | 用户看到什么 | 自动动作 |
|------|------------|---------|
| ✅ PASS | 静默 | 自动快照存档 |
| ⚠️ WARN | daemon-notice.md 告警 + 可选 Webhook | 存档 + 标记 |
| ❌ FAIL | Webhook 推送 + 终端标红 | 存档 + 建议回滚 |

```bash
sofagent-audit --history              # 查看审计快照
sofagent-audit --revert <sha>         # 回滚到某次审计前
```

Webhook 在 `.sofagent/config.yml` 配置，不配也能用。详见 [ARCHITECTURE 回溯能力](./ARCHITECTURE.md#🔄-回溯能力)。

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
      - run: bash FDE/fde-install.sh
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
| 2 | `fde.md` | 你的运行规范，优先级最高 | ✅ 随便改 |
| 3 | `think.md` | 反思摘要（≤2K token） | ⚠️ 改了没用。→ [反思工程](./DEVELOPMENT.md#六反思工程) |
| 4 | `knowledge/index.md` | AI 知识库目录，被动注入 top-3 页摘要 | ⚠️ daemon 自动维护 |

> 地基约 3,500 token，不到 128K 窗口的 3%。OpenClaw 平台 Hook 自动注入 2-4 层，其他平台 Agent 主动 Read。详见 [ARCHITECTURE 地基与引擎](./ARCHITECTURE.md#地基与引擎)。

### 引擎怎么跑

> 💡 一底座·四引擎的完整设计哲学见 [PHILOSOPHY](./PHILOSOPHY.md#三怎么跑架构全景)。这里只讲使用。

| 引擎 | 做什么 | 触发方式 |
|------|------|------|
| 🧭 **约束底座** | 四层加载链注入规则 | Agent 启动时自动（OpenClaw Hook / Sub Agent 自加载） |
| 🔍 **审计引擎** | git diff → A1-A11、A14-A19 规则检查 | git commit / daemon 文件变更 |
| 🔄 **回溯引擎** | 审计后自动 git snapshot，违规时建议 revert 回滚（本质：git snapshot + revert 包装） | 审计完成后自动 |
| ⚙️ **编排引擎** | 拆解任务 + Sub Agent 并行 + StateGraph 循环（v1.1.3+） | CLI / MCP compose tool |
| 🧬 **进化引擎**（v1.0.8+） | FDE 周度巡检审计趋势 + 反思，自动优化 | daemon cron @weekly / 手动触发 |

> 📖 **多设备同步**：v1.1.0 起支持轻量多设备——经验共享（knowledge/ + think.md）跨设备同步。4 种方案（iCloud / NAS / Dropbox / git submodule）见 [多设备同步指南](./guides/multi-device-sync.md)。

#### 近期版本新功能速览

以下功能 daemon 自动运行，装完即生效——你不需要做任何配置：

| 功能 | 版本 | 一句话 | 详见 |
|------|:--:|------|------|
| Dream Cycle | v1.1.7 | knowledge/ 自动沉淀——daemon 6 阶段 pipeline 从 task/logs 提取知识，不再靠散点脚本 | [FDE §9.3 知识治理](../FDE/FDE.md) |
| sensitivity 分级 | v1.1.7 | 每条知识带 public/internal/restricted 分级，缺省 internal——restricted 在联邦查询中不外发 | [FDE §9.3](../FDE/FDE.md) |
| knowledge status | v1.1.7 | `sofagent-daemon knowledge status` 一条命令看知识全貌（Dream Cycle 周报 + 健康度 + sensitivity 计数） | [FDE §9.3](../FDE/FDE.md) |
| 安全联邦 | v1.1.8 | 两台配对设备互查 knowledge/，AES-256-GCM 全链路加密 + sensitivity 双重过滤 | [FDE §部署场景·安全联邦](../FDE/FDE.md) |
| Prompt 注入防护 | v1.1.8 | 8 层纵深防御——外部内容包裹 + 脱敏 + 知识可信分级 | [SECURITY.md](../SECURITY.md) |
| USB 一键烧录 | v1.1.8 | workflow 烧进 U 盘 → 发给员工 → 插上即用，拔掉零残留 | [场景五 USB 烧录](#usb-烧录给普通员工发-u-盘v118) |
| A/B 自动调度 | v1.1.9 | daemon 后台跑探索-利用——当前方案攒数据 → 自动切候选方案对比 → 赢家自动 promote | [ARCHITECTURE 编排引擎](./ARCHITECTURE.md) |

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
  Agent 跑 DeepAgents compose → 输出方案：「拆成 N 个子任务、预估 token/成本。可行？」
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

> 更多见 [LIMITATIONS.md](../LIMITATIONS.md)。

### Osmani 三盆冷水

| 冷水 | 意思 | sofagent 的应对 |
|------|------|------|
| 验证责任不可替代 | Agent 说「做完了」是声明不是证明 | 审计 A8 要求可观测证据（测试通过/lint/API 200） |
| 理解债 | Loop 交付你没写过的代码越快，理解鸿沟越大 | task/logs 只追加不修改，永远可回溯；think.md 每步记录决策日志 |
| 认知投降 | 最舒服的状态是不再有自己观点 | fde.md 随时加规则覆盖；编排可回滚；审计独立于 Agent |

> 💡 **反认知投降的三道护栏**：fde.md 规则覆盖（保留人类话语权）、编排可回滚（保留人类否决权）、审计引擎独立于 Agent（保留人类验收权）。这不是技术特性，是制度设计——确保人类永远是最终决策者。详见 [ARCHITECTURE 设计原则](./ARCHITECTURE.md#设计原则) 和 [反认知投降](./ARCHITECTURE.md#反认知投降的制度设计)。

> "Build a Loop, but build it like an engineer who plans to keep being one." — Osmani。Loop 不是造完就不用管的自动化流水线，是工程师持续维护的工程系统。

---

## 场景四：自定义

### 改写 fde.md

`fde.md` 是你的运行规范，优先级最高。写什么就生效什么。设计理想 ≤500 字（当前实际 ~1,600 字——写少了 Agent 记得更牢，v1.x 计划精简）。注：此 ≤500 字是代码注释 / 提交信息等短文本的简洁预算原则，企业红线文档（fde.md）本身可超出该预算。

模板在 `sofagent/skill/data/fde.md`。常用配置：
- 模型偏好（`深度思考优先` / `速度优先`）
- 输出风格（`回复控制在 200 字以内` / `优先用中文`）
- 项目规则（`不要生成 .md 文件` / `改代码前先确认`）

> 💡 **短词锚定技巧**：提炼一个专属短词（如 `vertical slice`）替代整段行为规范（如「不要一次性写完整功能，先做小范围验证，早点拿反馈」），反复在 fde.md 中强化该词。验证标准：观察 Agent 输出中是否主动提及该短词——若出现则说明行为已被成功引导。注意：短词在团队内必须绝对统一，不可随意替换不同表述。（来源：Matt Pocock 的 Agent Skill 构建方法论）

### 审计规则

当前共 21 条审计规则（A1-A11、A14-A19 + E1-E4），源码在 `sofagent/audit/src/rules/`。每条规则独立，新增只需写函数 + 注册一行。详见 [DEVELOPMENT §八](./DEVELOPMENT.md#八提交时审计)。

### 概念速查

上述术语（Harness 中间件、审计/回溯/编排/进化引擎、铁律、审计规则、Skill、think.md、daemon、OpenClaw、FDE 等）已在上方「四层加载链」「引擎怎么跑」节详述，此处仅作速查索引。加载链正典顺序：**SKILL.md（宪法）→ fde.md（规范）→ think.md（反思）→ knowledge/（知识）**。核心 = **一底座·四引擎覆盖全生命周期**。完整概念见 [README](../README.md) 和 [ARCHITECTURE](./ARCHITECTURE.md)。

---

## 场景五：FDE 部署与持续优化

> ⚠️ **成熟度**：审计引擎稳定。FDE 部署四阶段十二步 + 五份模板 + quick-start，核心流程可用。编排引擎 v1.1.3 起 StateGraph 已稳定（DeepAgents Sub Agent + LangGraph，全平台可用）。

FDE = Forward Deployed Engineer。完整流程见 [FDE/FDE.md](../FDE/FDE.md)。建议装 [sofagent-fde Skill](../FDE/SKILL.md) 让 Agent 自动加载 FDE 工作台。

### 部署：装上 sofagent

没有 sofagent，梳理的 workflow 就是一份 PPT。引擎装到设备上，AI 节点才有纪律和审计。完整引擎对照表与部署步骤见 [FDE/FDE.md §装上 sofagent](../FDE/FDE.md#装上-sofagent整个部署的核心)。

**节点类型选择**：自动运行节点（需 OpenClaw 全栈）vs 个人增强节点（WorkBuddy/Codex，无需 OpenClaw）。完整对照表见 [ARCHITECTURE 双节点架构](./ARCHITECTURE.md#双节点架构)。

### USB 烧录：给普通员工发 U 盘（v1.1.8+）

FDE 梳理好 workflow 节点后，可以一键烧录到 U 盘——员工拿到插上就能用：

```bash
sofagent-daemon create-usb-key \
  --role "财务审计节点" \
  --target /Volumes/SOFAGENT \
  --platform macos   # 或 linux / win
```

U 盘包含：Node.js 便携版 + sofagent 引擎 + knowledge/ 加密落盘 + 启动脚本 + HMAC 防篡改签名。员工双击 `start.command`/`.sh`/`.bat` → 验签 → 内存解密 → daemon 启动 → 联邦在线。拔掉零残留。详见 [FDE/FDE.md §部署场景](../FDE/FDE.md)。

> 💡 跟你的 Agent 说"帮我烧一个 XX 节点的 U 盘"也行——Agent 会通过 FDE Skill 触发 `create-usb-key`。

### 离场后：企业留下什么 + 谁来管

| 产物 | 说明 |
|------|------|
| **交付手册** | 企业画像 + 部署方案 + fde.md + quick-start.md |
| **AI 节点** | 文档层（.md）+ Skill 层（企业专属）+ 运行层（在跑的 session） |
| **AI 知识库** | `.sofagent/knowledge/` — daemon 自动 Ingest，加载链被动注入 |
| **私有化评估体系** | eval.md + Skill 迭代历史 + 知识库演变轨迹 |
| **USB key**（v1.1.8+） | 烧录好的 U 盘——插上即用，换电脑身份不变 |

FDE 离场后，两个内置 Agent 接手持续运维：

| | 审计 Agent | FDE Agent |
|------|------|------|
| 方向 | 向下看——防止退化 | 向上看——推动进化 |
| 数据源 | git diff + A1-A11、A14-A19 规则 | audit 报告 + think.md + eval |
| 输出 | "哪里坏了 + 怎么修" | "怎么做得更好 + 趋势分析" |
| 频率 | 每次 commit 自动 | 每周自动巡检 |

```bash
sofagent-audit subagent run fde --mode sustain --task "巡检所有节点"
@sofagent-fde sustain     # WorkBuddy 中直接 @
```

审计 Agent 管"刹车是不是还在"，FDE Agent 管"能不能换更好的轮胎"。两者合在一起，企业的 AI 节点不需要人盯着。

> sofagent 不做 AI 中台——做 AI 中台里**约束 Agent 行为和审计的那一层**。FDE Agent 是这一层的产品封装——对外你看到的是 FDE Agent，对内是 sofagent 引擎在跑。

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

sofagent 站在 6 个开源项目和 7 篇文章/社区的肩膀上。→ [完整致谢](./THANKS.md)

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
> *v1.1.9，2026 年 7 月 15 日*
