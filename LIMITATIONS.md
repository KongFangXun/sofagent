# sofagent Limitations

> 诚实坦白：已知局限。列出 sofagent 当前做不到什么、为什么做不到、等什么才能做到。
>
> v1.0.1 · 2026-07-04（UTC）· 北京时间 07-05 · 孔放勋

---

## 目录

- [一、架构设计局限](#一架构设计局限)
- [二、平台与兼容性局限](#二平台与兼容性局限)
- [三、安全与信任模型局限](#三安全与信任模型局限)
- [四、成熟度与测试局限](#四成熟度与测试局限)
- [五、审计与工程局限](#五审计与工程局限)

---

## 一、架构设计局限

---

### 💡 Harness 层自身在上下文里

核心机制是 MD 文件注入 Agent 上下文。约束力 = Agent 的注意力 × 平台的加载可靠性。上下文窗口太小约束可能被截断；选择性忽略长文本（Lost in the Middle），中间铁律可能漏掉；约束机制依赖 Agent 配合——它必须「愿意读」。代价换来了：不依赖外部服务、不需要额外进程管理、一份代码到处能跑、配置都是纯文本可直接审计。

---

### 加载链步进脆弱性（v1.0.1 已改善，仍有平台差异）

**v1.0.1 四层加载链**将宪法内联进 SKILL.md（第 1 层所有平台强制生效），新增 knowledge/index.md 被动注入（第 4 层）。第 2、3 层（think.md + fde.md）仍靠 Agent 自觉读取——OpenClaw 通过 `sofagent-load-chain` Hook 强制注入，非 OpenClaw 平台仅靠 Agent 注意力，无法保证 100% 命中。

---

### 复盘评分是 LLM 自评：评审者与执行者不分离

闭环复盘让执行任务的同一个 Agent 对自己打分——评估者和被评估者是同一个人。上海 AI Lab 的 Self Harness 论文给出方向性证据：**Agent 可以提议修改，但不能自己批准**。一旦自评，Agent 会收敛于「让验证变容易」而非「让结果变好」。

| 平台 | 实现方式 | 隔离级别 |
|------|------|------|
| OpenClaw | `session.spawn` 创建独立子 Agent，只传 task/logs 不传执行上下文 | 工程隔离 |
| 非 OpenClaw | 主 Agent 重新 Read task/logs 作为评审主依据 | prompt 级约束，无机制保障，效果未实测 |

---

### 🌱 Skill 自进化：从经验记录走向结构化知识库

v1.0.1 新增 daemon Ingest（自动知识提取）+ loop-evaluate Lint（自动体检）将自进化从「纯经验记录」推进一步。但仍处于**记录 + 整理**阶段——尚未到「自动改进」（多轨迹归纳）阶段：

| 阶段 | 机制 | sofagent 现状 |
|------|------|------|
| **经验记录** | 记录单次成功/失败，调整评分 | ✅ 当前阶段 |
| **多轨迹归纳**（TRACE2SKILL） | 并行分析大量轨迹 → 提出补丁 → 合并去重 | ❌ 缺：前 5 次冷启动保护仅缓冲，未真正归因 |
| **自验证闭环**（Evil Skill） | 多子 Agent 生成候选 Skill → A/B 对比 → 留更优 | ❌ 缺：loop-check 是单次自评 |
| **可训练参数**（Skill Opt） | 学习率约束/验证门控/负反馈缓冲/动量 | ❌ 缺：scoring 只是简单计数 |

**风险**：单次失败 → 降分 → 下次不用该 Skill。但失败可能只是模型波动——长期会把噪声写成规则。**现有防御**：冷启动保护（前 5 次只记录不判断）+ LLM 自评权重 ×0.3。根治需要独立验证环（见 ROADMAP v1.x）。

---

---

## 二、平台与兼容性局限

### ⏰ 定时触发做不到

目前只有「每次对话启动」这一种触发方式。OpenClaw 不支持 cron 级定时任务。短期替代：Agent 自查 task/logs，上次执行超阈值时主动提醒用户——但不是真正的定时循环。

---

### 🐚 B1 数据初始化依赖 bash

SKILL.md B1 步用 bash heredoc 创建 `.sofagent/` 数据目录。Windows 或受限沙盒环境可能没有 bash。降级路径已内置：bash 不可用时 Agent 降级为逐条 `mkdir` + Write 工具创建。

---

### 🪟 Windows 支持是实验性的

**macOS / Linux = 全功能。Windows = 实验性。**

PowerShell 脚本（`.ps1`）作为 bash 脚本的平行实现存在，但**功能覆盖不全**：

| 脚本 | .sh 行数 | .ps1 行数 | 覆盖度 |
|------|:---:|:---:|------|
| verify | 942 | 230 | ~25%，缺 §4 Hook 检查、§8 断路器配置、§10 企业合规验证、§11 daemon 状态 |
| install | 193 | 555 | ps1 更详细（含 Windows 注册表逻辑），但实现路径完全不同 |
| daemon | 233 | 131 | ~55% |
| audit | 109 | 77 | ~70% |

**核心审计引擎（@sofagent/audit npm 包）跨平台**——纯 TypeScript，Node.js ≥18 即可运行，不依赖 bash。

**受影响的 Windows 功能**：
- `verify.ps1` 只跑约 25% 的检查项，大量合规/Hook/daemon 检查缺失
- `install.ps1` 和 `install.sh` 实现路径不同，行为可能不一致
- daemon 注册逻辑在 Windows 上用 schtasks，行为未经充分验证

**建议**：Windows 用户优先用 `npx @sofagent/audit`（npm 包，全功能），bash 脚本用 Git Bash / WSL 运行。PowerShell 脚本作为后备，不作为主路径。

---

### ⏸️ 中间检查点挂起

设计：子 Agent 超标 → 暂停 → 主 Agent 三问评估。「暂停」需要 OpenClaw `before_tool` Hook 拦截工具调用，当前不支持。现阶段靠 `tools.loopDetection` 兜底——能检测死循环并硬停止，做不到「暂停→三问→继续」的精细控制。

---

### Skill 级动态 Hook 做不到

sofagent 无法在运行时动态注册安全护栏。Hook 是 OpenClaw 配置层的静态设置。现阶段安全约束靠静态 fde.md + OpenClaw `tools.loopDetection` 兜底。

---

### 🧩 不是分布式系统 / 不是多用户系统

sofagent 跑在单个 Agent 里——没有 agent-to-agent 通信，没有多实例协调。子 Agent 是 session 隔离，不是独立 Agent 进程。多用户共享 `.sofagent/` 会交叉污染。多用户场景建议每人独立 `.sofagent/`。

---

---

## 三、安全与信任模型局限

### 🔒 数据存储安全

task/logs 和 think.md 以明文 Markdown 存储，可能含代码片段、API 响应、用户对话摘要。LLM 提炼反思时可能无意写入敏感信息。v0.90 不实现加密，只做诚实声明——age 加密推到 v1.x。

---

### Skill 层 Slop：经验漂移

scoring.md + think.md 在循环中持续自我修订，会引入**经验漂移**——某次偶然成功被当成经验写进 think.md，三个月后经验库里一半是不可复现的噪声。应对：think.md 的置信度渐进（0.3→0.5→0.7）和 30 天无触发衰减。更根本的解法是定期人工审计。

---

### 平台依赖

核心约束（SKILL.md / fde.md）是纯 Markdown，任何能读文件的平台都能加载。但深度集成（Hook 注入、session 隔离、sub-agent 管理）只有 OpenClaw 能做到——不是我们选择独占，是其他平台不开源到这个程度。

#### OpenClaw 的两种角色

OpenClaw 不是用户的 Agent。它在两种场景下出现：

**模式 A：FDE 后台节点（sofagent 做 sub-agent）**

FDE 日常用自己顺手的 Agent（WorkBuddy / Codex / Cursor）。当需要跑 FDE workflow 节点（编排任务、审计分析）时，Agent 后台调用 OpenClaw 节点。OpenClaw 跑完后把结果返回，FDE 的 Agent 继续和人沟通。FDE 全程看不到 OpenClaw 的 UI——它是一个后台 AI 节点。

```
FDE ↔ 自己的 Agent（任意）→ 调用 → OpenClaw 节点（装了 sofagent）
                                              ↓
                                    拆任务、记反思、审计变更
```

**模式 B：企业设备上的 FDE 工具包（企业 Agent 做租户）**

FDE 帮企业部署完后，企业闲置设备上装 OpenClaw + sofagent。这台设备上跑着 sofagent 的 harness 层：
- OpenClaw 跑 FDE 部署的 workflow 节点（🔄 自动执行 + ⚡ 强化岗位）
- 企业自己采购的 Agent 也装在这台设备上
- sofagent-audit 通过 pre-commit hook 审计这台设备上所有 git 仓库的提交

关键：企业 Agent 不跑在 OpenClaw session 里。它们各自独立运行，各自用自己的 git 仓库。sofagent-audit 通过文件系统层的 pre-commit hook 审计它们的产出——Agent 完全不感知 OpenClaw 的存在，就像 App 不感知操作系统的安全模块一样。

```
设备（无头盒子 / 服务器 / 老旧电脑）
  ├─ OpenClaw（编排层 — 跑 workflow 节点，FDE 部署的）
  │     └─ sofagent 编排引擎 + think.md 反思
  ├─ sofagent-audit（审计层 — pre-commit hook，对设备上所有 git 仓库生效）
  └─ 企业 Agent（任意 — WorkBuddy / Codex / Cursor，各自独立运行）
        └─ git commit → hook 触发 → sofagent-audit 审计
```

OpenClaw 是地基，企业 Agent 是住在上面的租户，sofagent 是物业管理。租户爱干嘛干嘛，物业管的是楼的安全。

**模式 B 的技术路径**：企业 Agent 不跑在 OpenClaw session 里。OpenClaw 不拦截 Agent 的 API 调用。不提供 Docker。sofagent 对企业 Agent 的审计走的是**文件系统层 + git hook**——Agent 在设备上正常安装、正常运行，代码仓库在设备文件系统上，`git commit` 时 pre-commit hook 自动触发 sofagent-audit。不需要"控制"Agent，不需要 Agent 配合，只需要 hook 它们的 git 仓库。

> 以下表格说的是"哪些能力在哪个层生效"——不是"哪些 Agent 被支持"。审计层对所有 Agent 一视同仁（只看 git diff），编排层只在 OpenClaw 上生效。

| 能力 | OpenClaw | WorkBuddy | Codex / Hermes / Claude Code |
|------|:--:|:--:|:--:|
| 核心约束 | ✅ Hook注入 | ✅ SKILL加载 | ⚠️ 种子指令 |
| Skill 自启 | ✅ | ✅ | ❌ |
| 加载链脚本 | ✅ 内部 hook | ❌ Agent Read替代 | ❌ |
| 断路器 | ✅ loopDetection | ❌ | ❌ |

---

---

## 四、成熟度与测试局限

### 任务闭环清单执行率

SKILL.md 的回复前闸门和闭合清单由 Agent 自觉执行——没有 Hook 级的硬拦截。在连续快速操作中 Agent 注意力可能跳过检查。应对：硬层兜底（fde.md + ⛔ 硬出口）、结构加固（闸门前置）、人工审计（定期翻 task/logs）。

---

### 核心效果实测情况

本项目核心宣称（越用越聪明、约束效果提升）已有 11 个实测 Case，但全部为一次性测试，缺乏持续使用 ≥1 周的样本和 A/B 对照数据。v0.84 跑了 5 组 A/B——约束层增量天花板低（0/16），Harness 层有 promising 信号但存在方法论局限。

---

### 运行时约束 vs 提交时审计

当前架构是**运行时约束**——依赖 Agent 配合读取 MD 文件。v0.85 确立新方向：**提交时审计**（sofagent-audit），不依赖 Agent 运行时配合（看的是 git diff），但依赖日志真实性。

| 维度 | 运行时约束 | 提交时审计 |
|------|------|------|
| 依赖 Agent 配合 | ✅ 必须 | ⚠️ 不依赖运行时配合，但依赖日志真实性 |
| 跨平台 | ⚠️ OpenClaw 全功能，其他平台仅核心约束生效 | ✅ 任何 git 仓库 |

---

### 审计闭环成熟度

sofagent-audit 实现了完整的六步审计闭环流程（设计文档见 [ARCHITECTURE.md](./ARCHITECTURE.md)），但各步骤的成熟度不同：

| 步骤 | 成熟度 | 说明 |
|------|:--:|------|
| 1. git diff 扫描 | ✅ 生产可用 | 纯 git 操作，确定性输出 |
| 2. 规则检查 A1-A14 | ✅ 生产可用 | 16 条规则（11 默认 + 5 扩展）全部有测试覆盖 |
| 3. 审计报告生成 | ✅ 生产可用 | JSON/text/table 三种格式 |
| 4. think.md 自动更新 | ⚠️ 实验性 | LLM 生成，质量依赖模型 |
| 5. MCP 推送 | ⚠️ 实验性 | MCP Server 已实现，端到端链路未验证 |
| 6. 闭环反思 | ❌ 技术预览 | 反思评分是 LLM 自评，评估者与执行者不分离 |

审计闭环的核心价值在步骤 1-3（硬证据 + 规则判定），步骤 4-6 是增量增强。企业用户应优先依赖 git diff 审计结果，反思和推送作为辅助参考。

---

### 测试覆盖范围

当前 407 个测试全绿，但覆盖范围集中在审计规则和核心逻辑（diff-parser、reporter、config-loader、rules/*.ts）。以下模块没有独立测试：

| 模块 | 测试状态 | 风险 |
|------|:--:|------|
| install.sh | 无独立测试 | 跨平台行为变化无法自动捕获 |
| daemon 脚本 | 测试覆盖不足 | launchd/systemd 注册失败无早期预警；计划 v1.x 补充核心功能测试。**行为边界**：daemon 监控 think.md/fde.md 文件 hash 变化 → 写 daemon-notice.md，不直接审计 git commit。commit 审计由 pre-commit hook（`sofagent-audit --install-hook` 安装）负责 |
| MCP Server | 仅手动验证 | JSON-RPC 协议边界情况未覆盖。无自动测试。核心逻辑（run_audit/get_think/write_think）调用 audit 包已测方法。 |
| verify.sh/verify.ts | 部分覆盖 | ~48 项检查（动态，因环境条件变化）的逻辑分支未穷举 |

缓解：install.sh 和 verify.sh 有 ~48 项动态检查作为 smoke test，审计引擎核心逻辑已有全面测试。上述模块的测试缺口不会影响审计结果的可靠性。

---

### 审计工具信任模型：Agent 自我报告

sofagent-audit 的全部证据来源是 Agent 自己写的 `.sofagent/task/logs/*.md` 文件。审计工具的可靠性上限 = Agent 日志的真实性。v0.94 起提供 `--silent` 模式：只跑纯 git-diff 规则，不依赖 Agent 日志。

企业用户缓解措施：交叉验证（git log 与日志文件列表做时间戳对比）、人工抽查、`--strict` 模式。

---

---

## 五、审计与工程局限

### 审计 A7 检测可靠性边界 / bash 重复代码债 / 架构概念过载 / 缺少恢复路径

- **审计 A7**：检测基于 Agent 日志的正则匹配，v0.92 已做 5 项加固，根本解法是结构化日志（JSONL）
- **bash 代码债**：~450 行重复代码（颜色常量/日志函数/平台探测），方向是 bash → TypeScript 迁移，不新建 bash 基础设施
- **架构概念过载**：概念密度对新手不友好，缓解措施是 CONTRIBUTING 的「10 分钟速览」
- **缺少恢复路径**：think.md 记录了踩坑，但没有结构化的「失败了怎么恢复」机制，等 JSONL 落地

---

### 编排引擎稳定性

编排引擎依赖 `engage.md` + `ao compose`（agency-orchestrator）做任务拆解——本质上是 prompt 驱动，没有确定性 fallback。编排效果完全依赖模型质量：模型换了或者降级了，任务拆解和 Loop 检查就可能失效。Agent 变弱，编排跟着变弱；如果 agency-orchestrator 停止维护或模型 API 不可用，编排层直接不可用。

缓解：审计层（git diff）不依赖编排层，独立工作。编排层是可选增强——即使编排不可用，核心约束和审计仍然生效。最终解决方案是 v2.x 协同层的确定性编排引擎。

---

### FDE 端到端验证状态

FDE 完整四阶段十二步部署流程（[FDE/FDE.md](./FDE/FDE.md)）已在作者自有企业（投资/科技/电商等公司）中实际部署使用。

但以下两点影响外部信任：

1. **缺乏第三方独立验证**：所有部署案例均为作者自有企业，没有外部用户或客户的独立验证数据。外部审查者只能看到「作者说它工作了」，看不到「别人验证过它工作了」。
2. **缺乏公开案例**：没有可公开引用的 case study 文档——包括部署规模、使用的具体功能、遇到的问题、量化效果。已有 [case study 模板](./docs/evidence/case-study-template.md)，等待真实用户填写。

缓解：如果你在真实环境中使用了 sofagent，欢迎提交 case study——这比任何内部测试都更有说服力。模板在 `docs/evidence/case-study-template.md`。

---

### 组件间集成测试

**状态：无集成测试。** 各组件独立验证通过——daemon 手动验证（Case 014）、MCP Server 本地通过、webhook 推送代码完整、编排引擎 ao compose 通过——但 daemon → MCP → webhook → 编排四组件串联行为未验证。v1.0.1 计划补全链路 smoke test。

---

### 端到端验收测试覆盖

v1.0 新增 `tools/acceptance-test.sh`（9 个场景），但覆盖范围有限：

- **CI 已覆盖**：单元测试 408 个（函数级）、verify.sh 48 项（环境级）
- **发版前手动覆盖**：acceptance-test.sh 9 场景（CLI 端到端，步骤 2.3）、OpenClaw 验收 5 场景（Agent 端到端，步骤 2.5）
- **CI 未覆盖**：daemon → MCP → webhook → 编排四组件串联行为（仍依赖手动验证）
- **CI 未覆盖**：多平台兼容性（macOS only verified，Linux/Windows 未验证）

v1.0.1 计划将 acceptance-test.sh 纳入 CI 自动执行（当前为发版前手动），并补全组件串联 smoke test。

---

### 组织记忆维护风险 / 模型依赖维护风险

- **组织记忆**：选了共享文件路线（透明可审计），但规则文件不会随使用自动进化，需人工维护
- **模型依赖**：代码由 AI 模型生成，如果 DeepSeek V4 Pro 或 GLM-5.2 停止服务，项目失去修复 bug 的能力。当前 bus factor = 1（唯一维护者），且模型依赖构成了比单人维护更深层的结构性风险——维护者本人没有独立写出这些代码的能力，必须依赖模型。未来方向：bus factor ≥ 2 后引入多个模型 fallback

---

> 这份局限文档是开放的。如果你发现了我们没列出来的局限——开 Issue，直接说。
