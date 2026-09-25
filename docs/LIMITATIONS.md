# sofagent Limitations
- **commons_invoke 为 dry-run 预检语义**：返回能力元数据与调用计划，不真实执行（真实执行由 Agent runtime 注入 executor）——MCP 层默认占位是有意设计（防未审计代码执行），非缺陷。

<p align="center"><img src="assets/sofagent.png" alt="sofagent" width="96" /></p>

> 诚实坦白：已知局限。列出 sofagent 当前做不到什么、为什么做不到、等什么才能做到。
>
> v1.5.2 · 2026-09-24（UTC）· ✅ 已发版（[CHANGELOG](../CHANGELOG.md)）· 孔放勋

> 🧭 **阅读引导**：本文档按主题分节——**安全/合规局限见第三节**（强合规选型先读），**能力边界**（其余各节）多为设计取舍而非缺陷。通读一遍即可建立心智模型：**大多数局限有明确版本路线（见 ROADMAP），不是「永远做不到」**。首次阅读建议先看目录 + 每节第一段，无需逐条读完。

---

## 目录

- [Key Limitations](#key-limitations)
- [一、架构设计局限](#一架构设计局限)
- [二、平台与兼容性局限](#二平台与兼容性局限)
- [三、安全与信任模型局限](#三安全与信任模型局限)
- [四、成熟度与测试局限](#四成熟度与测试局限)
- [五、审计与工程局限](#五审计与工程局限)
- [六、文件系统审计局限](#六文件系统审计局限)
- [七、历史遗留与迁移说明](#七历史遗留与迁移说明)
- [八、包依赖与编排局限](#八包依赖与编排局限)
- [九、v1.1.7-v1.1.9 新功能局限](#九v117-v119-新功能局限)
- [十、FDE 交付物激活断裂带（v1.2.5-v1.3.0 已解决）](#十fde-交付物激活断裂带v125-v130-已解决)

---

## Key Limitations

> 最关键 5 条局限，快速了解 sofagent 的边界：

| # | 局限 | 详见 |
|:--:|------|------|
| 1 | **单包测试需先 build**——monorepo 未 build 时单包 `npm test` 可能失败（依赖 dist/），需先 `npm run build --workspaces`。 | [四、成熟度与测试局限](#四成熟度与测试局限) |
| 2 | **默认非 fail-closed**——config.yml 可被 Agent 篡改绕过审计规则。仅当 config 解析失败时走 safeDefaults（fail-closed 强制启用）。 | [三、安全与信任模型局限](#三安全与信任模型局限) |
| 3 | **编排能力依赖 orchestrator 包 + 模型质量**——LangGraph createReactAgent 驱动，编排效果依赖模型质量。模型降级 → 编排降级。 | [五、审计与工程局限 → 编排模块稳定性](#五审计与工程局限) |
| 4 | **静态加密只覆盖 `history.jsonl`**——`decision-log.jsonl` / `intent.jsonl` / `intent-skips.jsonl` 及附链目录（forge-runs / checkpoint / model-registry / task/logs / think.md / knowledge/）仍明文。 | [三、安全与信任模型局限 → 数据存储安全](#三安全与信任模型局限) |（边界：密钥删除/损坏后新记录回明文——doctor 可检出、ENCRYPTION_DEGRADED 事件留痕）
| 5 | **单平台场景可能过重**——只用单一 Agent 平台且接受云端审计的用户，平台内置治理比 sofagent 更顺滑。sofagent 的价值在多供应商混用 + 本地留证场景。 | [二、平台与兼容性局限 → 单平台场景](#-单平台用户建议) |

> ✅ **已解决的历史问题**（v1.3.2 移出 Key Limitations，不再计入当前边界）：
> - ~~audit ↔ daemon 循环依赖~~（v1.2.3 消除：snapshot helpers 迁移至 `@sofagent/core`，依赖图恢复单向 `daemon → audit → core`，详见 §八）
> - ~~FDE 交付物激活断裂带~~（v1.2.5-v1.3.0 消除：激活链 Phase 1-4 全部交付，详见 §十）
> - ~~定时触发做不到~~（v1.2.8 消除：daemon 内置 scheduler，v1.3.5 扩展 cron 表达式，详见 §二）

> ⚠️ **企业高安全场景**：`config.yml` 可被 Agent 篡改以绕过审计规则（如关闭规则、放宽阈值）。config.yml 有两个有效位置——项目级 `${cwd}/.sofagent/config.yml` 和全局级 `~/.sofagent/config.yml`（config-loader.ts 三级 fallback，项目级优先）。建议：① CI 侧独立校验 config 完整性（`sofagent-audit --diff` 兜底，hook 可绕 CI 不可绕）；② 文件权限锁（`chmod 400 ~/.sofagent/config.yml` 和 `chmod 400 .sofagent/config.yml`，文件只读——**对同用户进程无效**，见下方第 3 条）。与已有 `--no-verify` CI 兜底建议呼应。**v1.3.9 已落地**：SubAgent 侧 config 篡改由沙箱虚拟 FS 拦截（写入走虚拟层审批）；主 Agent 侧由 meta-harness 统一编排承接（v1.3.9 交付二）。建议仍保留 CI 兜底 + 文件权限双保险（纵深防御）。
>
> **建议缓解措施**（按有效性排序）：
> 1. **CI 侧兜底（最有效）**：在 CI pipeline 中加入 `sofagent-audit --diff HEAD~1..HEAD`，
>    确保即使开发者本地用了 `--no-verify`，CI 仍会拦截。CI 以独立身份运行（非当前用户），Agent 无法篡改——这是唯一能防住「Agent 以当前用户身份写入篡改 config」的手段。
>    ```yaml
>    # GitHub Actions 示例
>    - name: sofagent 审计检查
>      run: |
>        npx -y -p @sofagent/audit sofagent-audit --diff HEAD~1..HEAD --ci
>        # ⚠️ 若本步骤接管道（tee/grep 等），先 set -o pipefail——否则审计失败码被管道末端退出码遮蔽
>    ```
> 2. **定期自动 doctor**：配置 cron job 每周运行 `sofagent-core --doctor`，
>    并将结果发送到监控频道，检测 hooks 是否被意外移除。
> 3. **文件权限锁（辅助，有局限）**：`chmod 400 ~/.sofagent/config.yml`（全局级）和 `chmod 400 .sofagent/config.yml`（项目级）使文件只读。
>    ⚠️ **注意：`chmod 400` 仅防其他用户读取，不防 Agent 以当前用户身份写入篡改**——Agent 与你同身份运行，文件权限对同用户进程无效。真正能防住的是 CI 侧独立校验（见第 1 条）。chmod 是纵深防御的辅助层，不能单独依赖。

### 本地开发紧急缓解措施

在 CI 侧兜底尚未就绪之前，本地开发建议：
1. **`chmod 400 ~/.sofagent/config.yml`**——降低被误改的风险，推荐安装后执行。⚠️ **它挡不住 Agent**（同用户进程可自行 chmod 回写）——本地措施不构成安全边界，真正的兜底是上方第 1 条的 CI 侧独立校验。
2. **设置 git hooksPath**——在 `~/.gitconfig` 中设置 `[core] hooksPath = ...` 确保 hook 路径不可被 Agent 覆盖。
3. **定期运行 doctor**——`sofagent-audit --doctor` 检查审计规则完整性，检测 hooks 是否被意外移除或 config 被篡改。注意 doctor 默认 warning 不计失败（exit 0），CI 门禁场景需加 `--strict`。

> 📌 data 目录整体权限加固（chmod 700）见 [SECURITY.md](../SECURITY.md) 「纵深防御」节。

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

**行业侧同向信号（2026-06）**：Databricks 发布企业本体层（Genie Ontology）后，第三方分析的集中批评落在同一条线上——**排出「最权威的定义」不等于校验「由它算出的数对不对」**：上下文能解决「该信谁」，不能替代对「算得对不对」的独立判定；一旦定义漂移或被操纵，Agent 会规模化地返回**自信而误导**的答案。同期 Anthropic 的托管 Agent 记忆层把写入权限按范围收紧（组织级只读、个人级才可写），每次变更留不可变版本与可追溯到具体 Agent / session 的审计轨迹。两处指向同一方向：**产出方不应该是自己的判定方**。

**判据要分层，且刻意不合分**：上游判「喂对了没」（检索命中、权限单测——纯函数、可离线、毫秒级）、下游判「说对了没」（产出有没有破领域规则）、真机判「通没通」（端到端链路）。三层**不合并成一个总分**——合了以后分数掉了，分不清是检索退化还是措辞退化，也定位不到该修哪层。实践复盘里出现过完整反例：上游判据全绿（离线单测全绿 + 检索命中 100% + 工具调用零报错 + 配置干跑干净），真实对话仍违反多条领域规则，**整条验收链一条都没红**——根因是没有任何一道判据在看「模型最后说出来的那段话」。对应本仓：`evaluate_output` / `eval_suite` / `run_ab_test` 是下游判据面，**上游门禁全绿不能替代它**。

---

### 🌱 Skill 自动优化：从经验记录走向结构化知识库

daemon Ingest（自动知识提取）+ loop-evaluate Lint（自动体检）把自动优化从「纯经验记录」推进一步。但仍处于**记录 + 整理**阶段——尚未到「自动改进」（多轨迹归纳）阶段：

| 阶段 | 机制 | sofagent 现状 |
|------|------|------|
| **经验记录** | 记录单次成功/失败，调整评分 | ✅ v1.0.1 起 |
| **多轨迹归纳**（TRACE2SKILL） | 并行分析大量轨迹 → 提出补丁 → 合并去重 | ❌ 缺：前 5 次冷启动保护仅缓冲，未真正归因 |
| **自验证闭环**（Evil Skill） | 多子 Agent 生成候选 Skill → A/B 对比 → 留更优 | ⏳ v1.0.6 起（方案 B：模型 API 直跑）——现行 A/B 走 LangGraph 编排；**v1.0.7 曾升级的「方案 C（DeepAgents 完整 Agent）」路径 v1.2.0 起已弃用** |
| **可训练参数**（Skill Opt） | 学习率约束/验证门控/负反馈缓冲/动量 | ✅ v1.0.4 起（SkillOpt 管道接通） |

**进化管道集成状态**：管道已接通——L2 周检 inspector（`engine/daemon/src/inspectors/evolve-trigger.ts`，`@weekly`）读 failure-ledger 的**连续同类失败聚类**，达 `AUTO_TRIGGER_THRESHOLD = 3`（连续 ≥3 次）即调用 `autoTriggerAll()` → `runEvolve()`（v1.4.8 前名 `runSkillOpt()`）→ `validateCandidate()` 验证（行数 + 内容变化）→ 备份 + 替换 SKILL.md；不足 3 次则跳过（巡检结论为「无连续 ≥3 次的失败聚类，跳过」）。`--doctor` 展示管道状态。⚠️ **现行口径（v1.4.8+）**：子命令更名为 `evolve-run`、包更名为 `@sofagent/evolve`、默认走内置 native gate（零 Python 依赖），外部 CLI 仅为 `SOFAGENT_EVOLVE_GATE=cli` 可选兼容层——**无需任何 pip 安装**，旧版正文中的 pip 指引已摘除。外部 CLI 未安装时管道优雅降级——daemon 写提示到 daemon-health.json，不 crash。

> ⚠️ **skillopt-sleep 的「生成候选」段已被真脑替代（v1.4.5 交付）**：skillopt 自进化链路原分两段——**检测/触发/验证/回滚**（纯 TypeScript，零外部依赖，核心能力）+ **生成候选 SKILL.md**（调外部 skillopt-sleep CLI）。v1.4.5 Dream Cycle 真脑（`engine/daemon/src/dream-cycle/real-provider.ts`，走模型注册表/DSH 通道 + callModelAPI 基建）交付后，「生成候选」可由通用模型 + prompt 工程直接完成（WikiSkill 论文实证：胜负手是结构化知识层而非模型特化）——skillopt-sleep 作为「生成候选」的临时外部依赖使命终结。检测/触发/验证/回滚段仍为纯 TypeScript 核心能力，不受影响；已安装 skillopt-sleep 的环境可继续使用（向后兼容），但不再是必需依赖。

**A/B 运行器状态（v1.0.5 → v1.0.6 → v1.0.7）**：v1.0.5 `simulateAgentRun()` 是 mock（直接返回 expected，A/B 永远打平）。v1.0.6 替换为模型 API 直跑（方案 B）——自迭代闭环打通。v1.0.7 升级为 DeepAgents 完整 Agent（方案 C），支持工具调用验证——**该路径 v1.2.0 起已弃用**（编排迁移至 LangGraph `createReactAgent`，见 ROADMAP「架构演化」与 ARCHITECTURE.md「编排收敛」节）。

**风险**：单次失败 → 降分 → 下次不用该 Skill。但失败可能只是模型波动——长期会把噪声写成规则。**现有防御**：冷启动保护（前 5 次只记录不判断）+ LLM 自评权重 ×0.3。根治需要独立验证环（见 ROADMAP v1.x）。

---

## 二、平台与兼容性局限

### 📦 v1.5.1：`npm i -g sofagent` 全新安装失败（v1.5.2 修复）

上游依赖的传递版本解析问题导致 npm 全新安装失败（`install.sh` 安装路径与 `@sofagent/audit` 直装不受影响，可正常使用）。修复已进入主干，v1.5.2 发布后恢复。

### 📦 v1.5.1：OpenClaw rollback 插件被 ClawHub 标记 suspicious（v1.5.2 消除）

平台安全扫描对 1.5.1 版 rollback 插件的启发式标记（源于一项配置读取缺陷，功能不受影响，不影响安装使用）。v1.5.2 重发后消除。

### 🐚 B1 数据初始化依赖 bash

SKILL.md B1 步用 bash heredoc 创建 `~/.sofagent/data/` 数据目录。Windows 或受限沙盒环境可能没有 bash。降级路径已内置：bash 不可用时 Agent 降级为逐条 `mkdir` + Write 工具创建。

---

### 🪟 Windows 支持是实验性的

**macOS / Linux = 全功能。Windows = 实验性。**

PowerShell 脚本（`.ps1`）作为 bash 脚本的平行实现存在，但**功能覆盖不全**：

| 脚本 | .sh 行数 | .ps1 行数 | 覆盖度 |
|------|:---:|:---:|------|
| verify | 955 | 230 | ~25%（按行数比，缺 §4 Hook 检查、§8 断路器配置、§10 企业合规验证、§11 daemon 状态） |
| install | 1638 | 559 | 实现路径完全不同：ps1 含 Windows 注册表逻辑，但覆盖面窄于 sh（sh 走完整安装流程） |
| daemon | 349 | 131 | ~38%（按行数比） |
| audit | 111 | 77 | ~70%（按行数比） |

**核心审计模块（@sofagent/audit npm 包）跨平台**——纯 TypeScript，Node.js ≥18 即可运行，不依赖 bash。

**受影响的 Windows 功能**：
- `verify.ps1` 只跑约 25% 的检查项，大量合规/Hook/daemon 检查缺失
- `install.ps1` 和 `install.sh` 实现路径不同，行为可能不一致
- daemon 注册逻辑在 Windows 上用 schtasks，行为未经充分验证
- **构建产物不等价（如实声明）**：`engine/audit` 的 `postbuild` 在 **Windows 上显式跳过「信任锚同步」**（该步脚本是 bash，Windows 无 bash，`process.platform === 'win32'` 分支直接 `exit(0)`）——此时 `dist/` 产物**不含同步后的信任锚基线**，基线改由 hook 首次运行时自行记录；而在 **macOS / Linux 上这一步会执行，且失败即 `exit(1)`**（同步脚本缺失、或同步失败，都硬失败——宁可不产出，也不产出陈旧基线）。后果：**同一份源码在 Windows 与 Unix 上构建出的 `@sofagent/audit` 产物，信任锚状态可能不同**。跨平台分发 / 复现构建 / 校验发布物时须知悉这一点——此处**不承诺**两平台构建产物字节等价（对齐仓内「不虚标」纪律）。

**建议**：Windows 用户优先用 `npx @sofagent/audit`（npm 包，全功能），bash 脚本用 Git Bash / WSL 运行。PowerShell 脚本作为后备，不作为主路径。

---

### ⏸️ 中间检查点挂起

设计：子 Agent 超标 → 暂停 → 主 Agent 三问评估。「暂停」需要 OpenClaw `before_tool` Hook 拦截工具调用，当前不支持。现阶段靠 `tools.loopDetection` 兜底——能检测死循环并硬停止，做不到「暂停→三问→继续」的精细控制。

---

### Skill 级动态 Hook 做不到

sofagent 无法在运行时动态注册安全护栏。Hook 是 OpenClaw 配置层的静态设置。现阶段安全约束靠静态 fde.md + OpenClaw `tools.loopDetection` 兜底。

---

### 🧩 不是分布式系统 / 不是多用户系统

sofagent 跑在单个 Agent 里——没有 agent-to-agent 通信，没有多实例协调。子 Agent 是 session 隔离，不是独立 Agent 进程。多用户共享 `~/.sofagent/data/` 会交叉污染。多用户场景建议每人独立 `~/.sofagent/`。
- **批量部署**：当前 per-repo 安装，无 org-level 集中配置下发。企业批量部署需自行编写脚本（参见 docs/guides/enterprise-deploy.md）。

### 🧩 单平台用户建议

如果你**只用一家 Agent 平台**（如只用 OpenAI、只用 Anthropic、只用豆包），且**接受审计日志存在云端**——那么该平台的内置治理能力可能比 sofagent 更顺滑（无需额外安装、无需学习曲线）。sofagent 的核心价值在多供应商混用 + 本地留证场景：当你同时用 OpenAI + Anthropic + 国内模型，需要一份统一的、跨平台的、留在本地的审计证据时——平台内置方案做不到这一点。

---

### sudo 权限边界

> **sudo 权限边界**：sofagent 的 `install.sh` 通常无需 sudo（所有操作在用户目录 + npm global）；仅当 symlink 目标目录（如 `/usr/local/bin`）不可写时，会以非交互 sudo（`sudo -n`）尝试注册 CLI 命令，失败时给出手动命令提示。`--init` 安装 git hook 时，如 `.git/hooks/` 目录权限为 root（罕见，通常是当前用户），需要 `sudo chown` 修正目录权限后再运行。daemon plist 安装到 `~/Library/LaunchAgents/`，不需要 sudo。如用户以 root 运行 sofagent，审计日志和 knowledge/ 的文件 owner 会变为 root，后续非 root 运行时可能因权限不足报错——不建议以 root 运行。

---

### 🧩 依赖方向架构测试只覆盖 build 序列包

`tools/check/dependency-direction.yml` 断言的是 **build 序列的包边界**（14 项：13 模块包 + `load-chain`），**不含 `umbrella` 与插件家族**（`engine/dsh-plugins/*`、`engine/openclaw-plugins/*`）。因此「插件依赖了不该依赖的包」不会被本门禁拦下——它的口径是架构边界，不是全仓依赖图。
缓解：插件侧另有生成式清单（`plugins.json` ⇄ 生成物逐字节对账）与 seam 契约门禁覆盖其接口面。

### 🗜️ 自动上下文压缩存在信息丢失风险

**已接线（v1.4.9 自动上下文压缩接线批）、环境变量门控、缺省关闭**——设 `SOFAGENT_CONTEXT_WINDOW_TOKENS`（可选 `SOFAGENT_CONTEXT_BUDGET_RATIO`，缺省 0.03、合法域 (0, 0.2]）才启用；加载链超预算触发段级压缩。压缩是**有损**的：被压缩段落进入模型时只剩摘要，细节不可回读。
缓解：红线铁律区（品牌色/铁律/底线等语义块）**不参与压缩**；压缩事件的审计面分两层：**结论失效标记已接线**（v1.5.2 审计结论失效语义——压缩/摘要事件触发 `incompatible-compaction` 失效标记，见 [v1.5.2 §四](./changelog/v1.5/v1.5.2.md)）；但**压缩内容本身的留痕尚未接线**（`onCompact` 回调出口在位，排期 v1.5.x）——无法从审计记录回溯压缩前全文。需要完整细节时以磁盘上的原始文档为准，不要依赖上下文里的压缩副本。

### 🧭 成本 quota 是事前估算，不是精确账

`cost_query` 与 quota 门禁给出的是**事前估算 + 用量台账**（余量/已用/周期三字段），不是与云厂商账单逐笔对账的结果。token 计价口径变化、缓存命中、并发重试都会让估算与实际账单产生偏差。
缓解：WARN/HARD 双模式——WARN 只提示，HARD 才阻断；关键预算以厂商账单为准。

### 🎛️ 多 Agent 协作阵型库是内置六阵型

阵型库提供六种**内置**阵型（含 schema 校验与模板兜底实例化）。它不提供「自定义阵型的图形编排」——自定义需直接写阵型配置。
缓解：交接留痕与边生命周期由框架托管；阵型结构错误在实例化前被 schema 拦下。

### 🔗 workflow 模型偏好绑定需注册表同步

节点级 `modelPreference` 解析依赖模型注册表。**未注册的模型会显式报错**（不静默降级到默认模型——这是刻意的，避免「以为跑的是 A 模型其实是 B」）。
代价：注册表与工作流配置需同步维护，注册表缺项会让工作流直接失败而非降级运行。

### 🧬 自研进化 gate 只比「历史最优」

`@sofagent/evolve` 的 `native-gate` 判定逻辑是「跑 eval 验证集 → 出分数 → **与历史最优比对** → adopt / revert」。它给出的是**相对改善**信号，不是绝对质量保证：历史最优本身可能是低分的，此时「不比它差」就会被采纳。
缓解：`SOFAGENT_EVOLVE_GATE=cli` 可切回外部 CLI 兼容层；gate 结论（score/bestScore/adopted/reverted）落盘可审计。

### 📦 聚合插件的装配面依赖宿主 profile

聚合插件（`cordis-plugin-sofagent`）经**宿主挂载通道**分发：能力是否可用取决于宿主 profile 的 `bundles` 配置与 `node_modules` 软链是否就位。profile 被重置、软链被删或旧链残留时，能力会缺失或出现悬空链噪音。
缓解：聚合层对逐个原子插件做降级（缺 `dist/` 的只报该一个、其余照常加载），失败项进 `failed` 列表；seam 契约四载体（源码 / `package.json` / patch / `SKILL.md`）机器对账。

### 🧩 FDE 交付模板不入安装态 → 恒走内置默认（诚实披露）

`install.sh` 不安装 `FDE/templates/`（`grep -n "templates" install.sh` 零命中），而 `fde-quantify` 的模板查找三级路径（`REPO_ROOT` / cwd / 上溯四级）在安装态下全部 miss → 返回 `null` → **交付模板恒走内置默认**。

判定：这是 **fail-closed 且有文档说明**的降级，不是缺陷本身——真问题是**用户无从知晓**（当前无日志、无 warn，静默 `return null`）。缓解：安装后如需交付模板，从仓库 `FDE/templates/` 显式提供；运行时留痕（查找全 miss 时打印一次 warn / status）属代码侧整改项。

## 三、安全与信任模型局限

### 🔐 审计面的「授权过程」记录不全

审计规则的检查对象是**变更产物 / 动作形态 / 声明清单比对**三类——`A15`（节点未声明 actions）与 `A16`（非声明范围变更）比对的是**事前静态配置**，不是**运行时授权过程**（谁批的 / 何时批的 / 批的范围）。**声明 ≠ 授权**：workflow 里写了 actions，不代表每个动作都走过该走的审批；审批链事实不在审计输入里。

**缺口的确切形态是「记录不全」而非「无通道」**：门禁判决记录 `TOOL_GATE` 的类型声明写的是「拦截 / 放行 / 告警」三态，实现**只落「告警」一态**——放行与拦截不留痕；人审支路的 `hitl/resolved/*.json`（`approved` / `rejected` + 起止时间）已在落盘、且已被治理报表消费，但**审计规则面尚未消费它**。因此「这个动作有没有走过该走的授权」目前**无法正向对账**：**无记录既可能是「合法放行」，也可能是「绕过门禁」，两者不可区分**。

**闭合路径（已排期，不是无解）**：`TOOL_GATE` 补齐三态并与调用意图流对账——**有动作、无放行、无批准 ⇒ 未授权执行**，这是一条可判定的发现（证据面归审计输入面，判定折进 `A16` 语义层）。与企业级「事前授权（mandate）补环」是**两件事**：后者是「先批后干」流程，本处要的是**记录完整性**。

**降级探测手段（记录补齐前可用）**：门控健康度四联红旗（ASK 率趋零 + 获批率恒 100% + 审批时延 1–2 秒 + 人均审批量异常）能在没有完整授权链时**部分**探测「审批形同虚设」——分开看每项都有良性解释，合起来看没有。这是**代理证据，不等于授权链审计**。

**不要因此新增规则**：事实不可观测时加规则只会得到永远弃权或永远放行的假规则，「看起来覆盖了」比明说缺口更危险（见 [SECURITY · 25 条规则的判定化归属](../SECURITY.md#25-条规则的判定化归属判定层接管后的逐条去向)）。

### 🔌 插件来源白名单的边界

插件来源校验按三类（Git URL / 主机 / 本地路径）判定，**误分类即可能绕过**——例如把不受信来源写成受信主机形态。白名单保护的是「插件从哪来」，不校验「插件内容做什么」。
缓解：`install.sh --policy` 三出口全部 fail-closed；托管 hook 为独裁路径；`--policy` 未声明时的默认行为以拒绝为准。

### 🚦 shell 提权分级可能误判

三态 classifier（safe 直接跑 / risky 走场景白名单或 HITL / dangerous forbid-until-approved）基于命令形态判定，**形态复杂的命令可能被分到比实际更宽的档位**（或反之）。
缓解：dangerous 档 fail-closed（未批准不执行）；risky 档白名单与 HITL 兜底；分级决策与批准记录进审计。

### 🧰 app_tool_policy 矩阵需人工维护

应用级工具策略是 `app × tool` 白名单矩阵，**未声明即拒绝**。这保证了默认安全，但也意味着新增应用或新增 tool 时必须同步声明，否则会出现「功能正常但被策略拦下」的现象。
缓解：矩阵可配置且改动进审计；被拒时的错误信息指明是哪一类未声明。

### 🗑️ A1 敏感文件规则按「变更方向」分级（v1.4.9 审查批修复）

A1（不碰敏感）按 `DiffFile.status` 分方向判定：**新增/修改**敏感文件 → FAIL（exit 2 阻断，强度不变）；**删除**敏感文件、或把敏感文件**改名移出**敏感区 → WARN（exit 1 放行）。降级理由：`git rm .env` 这类**补救动作**本身被硬阻断，会把用户逼向 `--no-verify`（正好落进产品自己定义要防的「诚实 Agent 疏忽」场景）。
缓解：「已移除」档仍显式提示**删除 ≠ 止损完成**——密钥若曾入库则历史仍在，须轮换凭据并考虑 `git filter-repo` 清理历史；同一提交里若同时存在「引入」方向，整体仍判 FAIL（最严者胜）。



> **企业 DevOps 集成路径**：当前 `history.jsonl` 为 append-only JSONL 明文，企业 IT 如需接入 SIEM / 企业日志平台，可通过 filebeat / logstash 等采集 agent 定时轮询 `~/.sofagent/data/audit/history.jsonl` 转发（见 SECURITY.md「审计结果推送」）。**本地三态 Webhook 推送 v1.1.6 已接通**（PASS/WARN/FAIL）；**企业平台推送（飞书/钉钉/企微）已在 v1.2.1 落地**（采购阻塞项已解除）。CI 集成方面，各包提供 `npm test` 与 `playbook/acceptance-test.sh` 可接入现有流水线做门禁；`sofagent-audit --install-hook` 提供的 commit-msg hook 可作为 pre-commit / pre-push 关卡。以下是一个完整的 GitHub Actions CI 兜底示例（在 CI 中跑 `sofagent-audit --diff`，确保 `--no-verify` 绕过 hook 后仍有防线）：
>
> ⚠️ **安全豁免开关披露**：设置环境变量 `SOFAGENT_WEBHOOK_ALLOW_LOCALHOST=1` 可豁免 webhook URL 的 localhost/内网地址校验（用于本地集成测试，实现见 `engine/audit/src/webhook.ts`）。该开关开启期间 SSRF 防护对内网地址失效——**生产环境禁止开启**。如需临时启用做本地集成测试，应遵循「export 后立即 unset」的最小暴露窗口纪律，用毕即关。
>
> ```yaml
> # .github/workflows/sofagent-audit.yml
> name: sofagent 审计检查
> on: [pull_request]
> jobs:
>   audit:
>     runs-on: ubuntu-latest
>     steps:
>       - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5
>         with:
>           fetch-depth: 0  # 需要完整 git 历史用于 --diff
>       - name: 安装 sofagent-audit
>         run: npm install -g @sofagent/audit
>       - name: 审计最近一次提交
>         run: sofagent-audit --diff HEAD~1..HEAD --ci
>         # ⚠️ 若本步骤接管道（tee/grep 等），先 set -o pipefail——否则审计失败码被管道末端退出码遮蔽
> ```

> **审计日志防篡改检测边界**：`history.jsonl` 的完整性依赖 hash chain（`audit-history.ts`），Agent 可在篡改后重算整条链——hash chain 仅提供**事后可追溯性，非强防篡改**。
>
> v1.1.8 起支持 HMAC-SHA256 签名（密钥来自 `~/.sofagent-key`，chmod 600），有密钥时强校验——但仅防**其他 OS 用户**篡改（密钥 600 只挡跨用户），**同用户运行的被审计进程仍可读密钥重算整链**，故对「Agent 本体」这一威胁主体不是强防篡改；无密钥时降级为 SHA-256 hash chain（此时篡改检测是**弱校验**——手改后重算整链即可通过，FAIL 可被抹成 PASS；企业 SOP 应强制配置密钥并周期体检）。
>
> **密钥生命周期边界**：① 弱密钥（<16 字节 / 低熵 / 常见弱模式）**拒绝签名**（fail-closed，不再降级弱签）；② 泄露后有销毁路径 `--revoke-key`（确认交互 → overwrite-then-delete → KEY_REVOKED 事件自证销毁时刻）；③ **轮换后的旧链不可复验**仍待解（链校验侧按「历史不可复验（黄）」处理——轮换涉及全链重签语义，排期见 ROADMAP）。
>
> `--doctor`（v1.2.0 起）会实际调用 `checkHistoryChainDetailed()` 校验链完整性。v1.4.5 起补**链头锚点**（`history-chain-head`，0600 原子写）：写入侧持久化总条数 + 末条哈希，读侧据此检出**尾部截断**（砍尾后剩余链自洽的逃逸路径）与锚位内容重写（判 tampered）；锚点不可读判 unverifiable（黄），无锚点（旧数据）跳过校验。
>
> **诚实边界**：能同时重写 `history.jsonl` 与锚点文件的攻击者仍可伪造——锚点是防篡改**证据强化**而非密码学保证。创世条目 HMAC 校验已与主循环对齐同款环境指纹比对（指纹一致判篡改、漂移判不可复验）。当前版本仍依赖「Agent 自觉 + 定期 `--doctor`」的信任模型。

### 🔒 数据存储安全

> ℹ️ **审计历史全局共享是设计决策**：审计历史（`history.jsonl` / `decision-log.jsonl`）写入全局 `~/.sofagent/data/audit/`，不做项目级隔离——这是**有意为之**：① HMAC 签名链完整性要求全量连续历史（`--verify-chain` 需要完整链）；② 跨仓库查询审计历史是运维刚需。多项目场景下审计记录会混合存储。
>
> **运行时审计日志已按 git 仓库隔离**：`runtime-audit.jsonl`（FORGE 自托管路径）与约束层侧 data-sovereignty 审计日志 / llm-calls Trace 均落 `data/audit/<…>/<repo-hash>/` 段目录（非 git 回退 `nogit-hash`；旧版无段结构的既有历史读侧 fallback 原地可读，不迁移不回填）；commit 级审计历史（`history.jsonl` / `decision-log.jsonl`）保持全局。
>
> **多项目整目录隔离**：使用 `SOFAGENT_HOME` 环境变量为不同项目 / Agent 隔离数据目录（⚠️ 指向用户 home 外的根目录需同时设 `SOFAGENT_HOME_ALLOWED_PREFIXES` 显式放行——越界不再静默回退而是报错；daemon 子命令路径已与 data-paths SSOT 对齐，显式设 `SOFAGENT_HOME` 不再双拼）。

> ⚠️ **知识库同样全局共享（当前单机单用户设计）**：`~/.sofagent/data/knowledge/` 单目录遍历、无租户/项目维度隔离——多项目、多 Agent 的知识沉淀（entities/concepts/comparisons/summaries）混合存储，查询时全局命中。财务与人事等不同域 Agent 的数据会串。**当前定位为单机单用户**：多 Agent 共享同一知识库/审计历史——多人/多部门共用需等租户隔离（ROADMAP v1.4.7 G7 多租户抽象层 v0：v0 为查询侧隔离（orgId 过滤 + `data/<tenant>/` 路径地基），PR/审计数据的**写入侧仍为全局分区**——v1.4.9 复核确认**写入侧隔离尚未落地**）。**临时方案**：使用 `SOFAGENT_HOME` 环境变量为不同项目/Agent 隔离数据目录（见 [企业部署指南](./guides/enterprise-deploy.md#多项目数据隔离v128)）。

> ⚠️ **云 VM 执行面（v1.4.6）数据上云边界**：`train cloud` 远程训练时，经分拣闸（sorting-gate）放行的非敏感/脱敏训练数据会上传云 VM（ssh 隧道加密传输，传输层加密；与静态加密 AES-256-GCM 的落盘加密是两层不同防护，见 SECURITY 例外三）。分拣闸是三档判定（敏感/脱敏/公开）——敏感档（客户名单/具体价格/财务数字）拦截留本地，但分拣是规则驱动、**非零漏判**：脱敏不彻底的数据可能误放行上云，强合规场景须人审分拣结果。云 VM 失联止损（心跳超时 → 强制 stop + 清理）防止 VM 按「时薪 × 时长」空烧，但止损依赖心跳可达——控制面与云 VM 网络断连时止损命令无法送达，VM 可能继续计费（成本口径见 train-cloud 预算注释）。

> ⚠️ **`.sofagent/.git-shadow/` 在被审计仓库内创建**：sofagent 审计时会在被审计的 git 仓库根目录创建 `.sofagent/.git-shadow/` 目录存放审计快照——设计意图是按 git 仓库隔离快照（不同仓库的快照不能串，否则回溯到错误仓库）。快照内容**已 sanitize 脱敏**（API key / 密码 / 手机号打码，v1.3.4 起），位于仓库内便于 git worktree 隔离。经 `--init` 或 `--install-hook` 安装时，自动写入 .gitignore（v1.3.6 起两路径行为一致），且 v1.4.2 起三层 hook 防线兜底（pre-commit 在 commit 前将 .sofagent/ 移出暂存区 + commit-msg 二次清理 + post-commit HEAD tree 对账告警），`git add -f` 强制暂存也会被移出（reset 失败则 fail-loud 拒绝 commit）；该目录不进 git 提交，但用户 `ls -a` 可见。可安全删除（重新审计会重建）。改存储位置是 v1.4 架构决策，当前版本只披露。
>
> task/logs 和 think.md 以 Markdown 存储，可能含代码片段、API 响应、用户对话摘要。LLM 提炼反思时可能无意写入敏感信息。静态加密已接线 daemon 启动路径（crypto-init.ts AES-256-GCM + SOFAGENT-AGE-V1 格式）——**密钥就绪后仅 `history.jsonl` 密文落盘**（唯一有加密写挂点的主链文件——写挂点在 `engine/audit/src/audit-history.ts` 的 `isDataEncryptionActive() → encryptWithAge`）；`decision-log.jsonl` 写侧走 `chain-kernel.appendChained`，该内核**零加密代码路径、恒明文**；v1.5.1 新增的 `intent.jsonl` / `intent-skips.jsonl`（意图面，含工具名 + 脱敏参数摘要）同样恒明文；task/logs、think.md 与 forge-runs/checkpoint/model-registry、knowledge/ 属附链目录仍为明文（脱敏管道仍生效；本节即权威清单，含交互/非交互密钥激活差异），见 [ROADMAP](./ROADMAP.md) 和 [SECURITY](../SECURITY.md)。
> - history.jsonl 存审计判定详情，A2/A9 已脱敏，其他规则 details 可能含代码片段或文件路径，敏感场景请配合外部加密卷
> - **v1.3.1 #44 披露：审计历史并发写入无文件锁**——appendFileSync 在 POSIX 上对小于 PIPE_BUF (4KB) 的写入是原子的，审计历史条目通常 < 1KB，单次写入安全。但多进程同时写入（daemon 文件监控 + Agent commit）可能导致行交错，产生损坏行触发 hash chain 完整性校验失败。概率极低（审计触发频率 < 1次/分钟），但损坏会导致校验失败。**v1.3.8 解决**——WAL 写在网关层，天然单 writer 模式（所有工具调用经网关串行写入，消除并发写入）。
> - **写链两处「降级继续」是设计取舍（v1.4.4 披露）**：① 上一行解密/JSON 解析失败时 prevHash 置 `'unknown'` 继续写入（条目带 `chainStatus:'broken'` 显式标记，连续 ≥2 条断裂升级告警）；② chmod 0o600 失败时读回实际权限验证——真实宽松才告警，写入照常。两处均**不阻断审计写入**：审计写入被阻断 = 审计本身失效，比链断或权限宽更危险（fail-open 取舍，审计可用性 > 链完整性严格性）。攻防注意：能反复损坏 history.jsonl 最后一行的攻击者可让链持续断裂而不被写入侧拦截——发现连续断裂告警时应立即 `--doctor` 全链校验并排查文件篡改来源。

---

### A9 注入检测局限

> ⚠️ **A9 正则层编码绕过局限**：覆盖面、不覆盖的绕过形态与缓解状态，**单一真相源见 [SECURITY §三 编排安全](../SECURITY.md#三编排安全) 的 A9 声明**（含与 Onboard L3 的职责边界），此处不重述以免两处口径分裂。

> ⚠️ **A9 commit msg 检测 quick 模式已生效（v1.3.8 修复）**：quick 模式（`npx sofagent-audit`，零配置审计最近一次 commit）**自动读取最近一次 commit 的 message**（`git log -1`），A9 commit msg 注入检测生效；commit msg 取不到时（如空仓库 / git 不可用）A9 由引擎按无输入处理（标跳过）。同理 A3（不改越界）依赖任务描述，quick 模式无此输入 → v1.3.3 起 quick 模式跳过 A3（避免占位 task 'quick-audit' 100% 误报越界）。A3 越界检查需 `--init` 安装 git hook 走完整引擎，或手动 `sofagent-audit --diff <range> --commit-msg <msg>`。
>
> ℹ️ **range 模式 commitMsg 取范围终点（v1.4.4 修复）**：此前 quick 模式 range 审计（`sofagent-audit HEAD~3..HEAD` 类调用）的 commitMsg 输入面写死字面 HEAD，与被审计 range 脱钩——终点携带注入载荷漏检、HEAD 的 message 污染在审区间误报。现 commitMsg 经 `resolveDiffEndpoint()` 取 range 终点（与 diff 面同源），回归测试见 engine/audit/src/cli-quick-range.test.ts。

> ⚠️ **边界：空 commit 不审计消息**——empty commit（无文件变更）时审计直接跳过，commit message 中的注入载荷不会被 A9 扫描（A9 的证据面是 diff + 显式传入的 `--commit-msg`）。带文件变更的 commit 消息正常扫描。纯消息攻击需 `--commit-msg` 显式送检。

> ⚠️ **边界：首个 commit 无基线不审计（根 commit 盲区）**——git 仓库的第一个（根）commit 之前不存在任何基线，`HEAD~1` 类 range 引用全部失效，commit hook 审计在该 commit 上不可用——**仓库历史起点的变更不经过 25 条规则扫描**。历史性含义：本仓根 commit（`git rev-list --max-parents=0 HEAD` 所指）创建时尚无审计层在位。**实测可用的补审命令**（对根 commit 做一次性追溯审计）：
> ```bash
> # 与 git 空树（4b825dc…）做 diff，等价于「根 commit 相对虚无的全部变更」
> sofagent-audit --diff 4b825dc642cb6eb9a060e54bf8d69288fbee4904..$(git rev-list --max-parents=0 HEAD)
> ```
> 实测记录：该 range 下引擎完整执行 17 项 quick 规则检查（A5 空 msg / A19 msg 质量 / A7 盲改 / A18 垃圾文件等均正常判定），违规照常 exit 2 拦截——根 commit 不是审计盲区，只是缺省不审。新仓库初始化后建议补跑一次该命令，把历史起点纳入审计面。

> ⚠️ **commit msg 注入伪造审计标记——A9 检测为 WARN 不阻断**：commit message 中如伪造 `[sofagent-audit PASS]` 等审计通过标记，A9 会检测到该注入并报 **WARN（exit 1），但不阻断 commit**——commit 仍然成功提交。人工 review 时需注意：commit message 中的审计标记可能是伪造的，**真实审计结果以 `~/.sofagent/data/audit/` 下的审计记录为准**，不要信任 commit message 自带的审计声明。

> ⚠️ **quick 模式二进制/超大 diff 盲区（v1.3.5 披露）**：quick 模式**没有**完整引擎对超大 diff 的 5MB 阈值兜底（完整引擎：普通文件 WARN exit 1 / 敏感文件名 FAIL exit 2）。git diff 对二进制文件只输出 `Binary files differ`（无内容行），规则无内容可扫——大体积二进制/超大 diff 在 quick 模式下会全绿通过。这是 git diff 的设计而非 sofagent bug，但对应用户意味着：quick 模式不能替代二进制敏感文件（如密钥库、私有数据集）的防泄漏审查；强合规场景请用完整引擎（`--init` 装 hook）兜底。

> ⚠️ **critical fast-fail：命中后后续层规则跳过（v1.4.3 披露）**：审计模块按规则分层串行执行——**critical 层（A1 敏感文件 / A2 密钥泄漏 / A9 注入等基线底线）任一 FAIL 后，后续层规则（A3 越界 / A7 盲改 / A16 非授权变更等）不再执行、统一标 SKIPPED**（输出形如「1 违规 · 7 通过 · 9 跳过」）。设计意图是 fail-fast（critical 命中已足以拦截 commit，无需继续跑）。**取证注意**：SKIPPED ≠ 通过——跳过的规则本次未检查，事后取证不能把「N 条跳过」读成「N 条无问题」；攻击者理论上可用显眼但无害的 critical 命中（如 A1 诱饵文件名）制造「审计抓到问题了」的表象，同时掩盖后续层规则未跑的事实。需要完整逐规则结果时，修复 critical 违规后重新审计即可获得全量执行。规则分层见 SECURITY.md「25 条审计规则」与 engine/audit/src/rules/runner.ts fast-fail 段。

> ⚠️ **config-loader 环境变量死开关披露（v1.4.3）**：`SofaEnvConfig` 中 `sanitizeEnabled` / `sanitizeIpsEnabled` / `cleanupFrequency` / `auditEnabled` 四字段**加载但无生产消费点**——企业 IT 设 `SOFAGENT_SANITIZE=...`、`SOFAGENT_AUDIT_ENABLED=...` 等**不改变任何行为**（已在 config-loader.ts 标 @deprecated）。实际生效面：脱敏管道常开（不受开关控制）、审计由 config.yml `rules:{...}` 控制（不构成第二通道）、清理走 cleanup.sh（其保留策略读 `SOFAGENT_RETENTION_DAYS`/`SOFAGENT_RETENTION_MAX`，v1.4.3 起认 SOFAGENT_ 新名、SOFA_ 旧名兼容）。

> ⚠️ **边界：hook 安装位置尊重 git core.hooksPath（v1.4.5 修复披露）**——`--init` / `--install-hook` 安装三层防线时，若仓库配置了 `core.hooksPath`（自定义 hook 目录，如 husky / pre-commit 框架所设），hook 文件安装到该目录而非 `.git/hooks/` 默认位。此为 git 原生语义的正确尊重而非 bug，但两个推论要知道：① 卸载 `core.hooksPath` 指向目录（或切回 `.git/hooks/`）时，此前安装的 sofagent hook 不随之迁移——审计可能静默失效，需重新 `--init`；② `--doctor` 的 hook 完整性检查按 `core.hooksPath` 解析当前生效目录，历史遗留的 `.git/hooks/commit-msg` 旧文件不在检查面内。行为锁见 engine/audit hook-install 测试 T1。

> ⚠️ **边界：审计模块超时降级是「收敛重跑」不是「抢占中断」（v1.4.5 接线披露）**——审计整轮耗时超阈值（`SOFAGENT_AUDIT_TIMEOUT_MS`，缺省 30s）后自动降一级（full→rules-only→minimal）并用更少规则集**重跑一轮**（minimal 级只保留 A1-A11 核心安全规则）。语义要点：① 超时判定作用于「整轮完成后」，第一轮的结果**已完整产出**（降级不丢首轮证据，报告以降级重跑轮为准并注入 DEGRADATION_NOTICE）；② 已在 minimal 级还超时则不再降级重跑，返回首轮结果并标注；③ 扩展/拐杖规则在降级轮**不执行**——SKIPPED ≠ 通过，事后取证不能把「N 条跳过」读成「N 条无问题」。降级记录供 daemon/orchestrator 消费（audit-timeout 触发器）。

---

### A2 密钥检测局限——编码与格式绕过（v1.2.5 披露）

> ⚠️ **A2 仅检测明文常见 API key 格式**（AWS AKIA、OpenAI/Anthropic/DeepSeek sk-*、GitHub token、私钥块等；**v1.3.6 起含 Stripe `sk_live_`/`sk_test_` 下划线前缀格式**；**v1.4.2 起含 Google `AIza`、Slack `xox*-`、JWT `eyJ` 三段式，及 AWS Secret Access Key 裸 40 位 base64 形态（需同行含 aws/secret/key 关键词才报，防 hash/commit SHA 误报）**）。v1.2.5 起已补 base64/hex 编码检测（新增行先解码再跑正则）与 `.gitattributes -diff` 绕过检测（WARN）。但仍不在检测范围：
> - 短密钥（<32 位）、非标准格式、其他厂商下划线前缀（保守设计防误报，等真实泄漏案例驱动，不逐格式打地鼠——v1.3.6 决策，Stripe 因前缀在生产代码无合法用途而纳入）
> - 其他编码（URL-safe base64、rot13、自定义混淆）与压缩/加密后的密钥
> - 历史提交中的密钥（A2 只扫当前 diff 新增行，不扫全量历史）
>
> **改名 + 编码/短 key 可组合绕过 A1+A2 双拦截**（如 `.env` → `app.config.js` + base64）。建议 CI 侧补 gitleaks / detect-secrets 做全量历史扫描。

> **二进制文件盲区（红队实测）**——git 对二进制文件只输出 `Binary files ... differ`，无内容行可扫：约 5KB 随机字节夹带密钥的 blob 可完全绕过 A2 内容扫描（无论密钥是明文还是嵌入二进制段）。缓解：A2 对**新增**二进制扩展名文件（.bin/.exe/.dll/.so/.dylib 等）及 diff 标记 `Binary files differ` 的新增文件（含 NUL 字节）输出 WARN「二进制文件不扫内容，请人工确认」——WARN 不拦截提交，最终防线是人工复核 + CI 侧二进制感知扫描工具。

> **v1.3.1 披露：>5MB diff 残余缝隙**——diff-parser 对单个文件 diff 超过 5MB（maxBuffer）时置 `oversized` 标记，A2 无法扫描其内容。audit/index.ts 已对此注入 WARN（安全敏感文件名升级为 FAIL），但内容本身仍跳过——攻击者可故意构造超大 diff 藏密钥。A2 归一化已补 NFKC Unicode 处理（v1.3.1 #46；NFKC 折叠全角/连字，**v1.4.8 起附加 Cyrillic 同形折叠表防跨字母系统同形绕过**——NFKC 本身不折叠 Cyrillic→拉丁同形字），sk-* 正则已扩展连字符/下划线支持。**v1.3.9 评估覆盖**——AST 规则引擎走流式解析（不 maxBuffer），超大 diff 不再跳过内容。

### spill 文件回收

审计溢出文件（`~/.sofagent/data/spill/diff-*.diff`，可能含密钥类 diff 内容）保留 30 天后可用 `node tools/maintenance/prune-spill.mjs` 回收；保留期经 `SOFAGENT_SPILL_TTL_DAYS` 调整。

---

### Skill 层 Slop：经验漂移

eval.md + think.md 在循环中持续自我修订，会引入**经验漂移**——某次偶然成功被当成经验写进 think.md，三个月后经验库里一半是不可复现的噪声。应对：think.md 的置信度渐进（0.3→0.5→0.7）和 30 天无触发衰减。更根本的解法是定期人工审计。

---

### 平台依赖

核心约束层（审计）**平台无关**——核心约束（SKILL.md / fde.md）是纯 Markdown，任何能读文件的平台都能加载，审计照常生效。但 **hook 自动注入当前仅 OpenClaw 生效**（深度集成 Hook 注入、session 隔离、sub-agent 管理只有 OpenClaw 能做到——其他平台的 Hook 接入排期见 [ROADMAP](./ROADMAP.md)（Claude Code PreToolUse 适配评估中））；其他平台手动注入约束 + 审计照常。

#### OpenClaw 的两种角色

> 完整设计描述见 [ARCHITECTURE § 约束层的两种形态：加载链与运行时](./ARCHITECTURE.md#约束层的两种形态加载链与运行时)。此处只记录与局限相关的点。

**模式 B 的关键约束**：企业 Agent 不跑在 OpenClaw session 里。OpenClaw 不拦截 Agent 的 API 调用、不提供 Docker。sofagent 对企业 Agent 的审计走的是**文件系统层 + git hook**——Agent 在设备上正常安装、正常运行，代码仓库在设备文件系统上，`git commit` 时 commit-msg hook 自动触发 sofagent-audit。不需要「控制」Agent，不需要 Agent 配合，只需要 hook 它们的 git 仓库。

> 以下表格说的是「哪些能力在哪个层生效」——不是「哪些 Agent 被支持」。审计层对所有 Agent 一视同仁（只看 git diff），编排层全平台可用（LangGraph createReactAgent 驱动）。

| 能力 | OpenClaw | WorkBuddy | Codex / Hermes / Claude Code |
|------|:--:|:--:|:--:|
| 核心约束 | ✅ Hook注入 | ✅ SKILL加载 | ⚠️ 种子指令 |
| Skill 自启 | ✅ | ✅ | ❌ |
| 加载链脚本 | ✅ 内部 hook | ❌ Agent Read替代 | ❌ |
| 断路器 | ✅ loopDetection | ❌ | ❌ |

---

### 🔓 快照恢复的人审门禁是约定级，不是机制（v1.5.0 披露）

回滚能力中「恢复快照」这一核心动作的唯一门控是工具入参 `human_confirmed`（`engine/mcp/src/tools/snapshot-restore.ts`）——该参数由**调用方 Agent 在同一次 tool call 里自报**，MCP tool 面**无带外确认通道**，快照文件也**无 HMAC / 指纹可验**（全链路无完整性校验）。即：**Agent 传 `human_confirmed: true` 即完成「人审」，不需要任何额外权限**——该门禁是**约定不是机制**。

与 ROADMAP「管控能力不得静默降级」的既定纪律存在落差。三个整改方向（① 快照自身完整性校验；② 把 `human_confirmed` 改为复用仓内既有 HITL 机制的带外确认通道；③ 判定为设计取舍并保留本披露）**待维护者裁定**；裁定前请勿把该门禁当作安全边界。详见 [SECURITY §四「已知绕过路径」](../SECURITY.md)。

---

### 🔓 静态加密在非交互环境默认跳过（v1.5.0 披露）

`initDataEncryption()`（`engine/daemon/src/crypto-init.ts`）在**非交互环境且未显式提供密钥**时**不生成密钥**，只打一条 `console.warn`（`status: 'warn'` / `action: 'skipped-non-interactive'`）后继续启动——**审计数据以明文落盘**。CI / docker / systemd / ssh 批量恰是企业最常见的部署形态，即该控制的**默认态是「关」**，且 systemd 下这条 warn 会淹没在 journal 里。

这是「默认安全 vs 可用性」的**显式设计取舍**（避免无头部署因缺密钥而拒绝启动），交互首启或走 env 通道（`SOFAGENT_CONFIRM_BACKUP=1`）可正常激活。**「当前是否处于明文态」可否被外部查询（`doctor` / `--stats` 显式标注）尚待裁定**；裁定前请以启动日志 + `head -1 ~/.sofagent/data/audit/history.jsonl` 是否含 `SOFAGENT-AGE-V1` 前缀自行核验。详见 [SECURITY §四「已知绕过路径」](../SECURITY.md)。

---

### 🔓 设备远程下发面：验签无可信根 + 任务通道零验签（v1.5.1 披露）

v1.5.1 新开三条**远程下发事件**——`device.upgrade`（设备 OTA 升级）/ `device.deploy`（平台→设备模板包下发）/ `device.task.dispatch`（任务推送），类型登记在 `engine/orchestrator/src/events/types.ts`，设备侧消费在 `engine/daemon/src/ota/`。两条边界如实披露：

- **设备侧验签无可信根**：`verifyDeliverySignature`（`engine/daemon/src/ota/upgrade-executor.ts`）只证明「摘要是由**信封自带的那把公钥**签出」这一**自洽性**——全链**无平台公钥 pin / 无 principal 白名单 / 无设备注册表绑定**（该目录 `trusted|allowlist|pinned` 零命中）。⇒ 挡得住**篡改与传输损坏**，**挡不住**持有自洽密钥对的外来伪造签名者。
- **`device.task.dispatch` 零验签**：`deliverTaskDispatch`（`engine/daemon/src/ota/subscriptions.ts`）**全路径无 `verifyDeliverySignature` 调用**——该调用只出现在 `device.deploy` 分支（:257）。任务下发通道目前**没有签名校验面**。

**当前性质是「设计期已知缺口」而非「已暴露面」**：三条下发面尚未接真实传输通道（npm registry / 制品库 / 安装脚本均为**注入端口**，缺省只落盘内联内容），外部无法触达；**一旦接上真实传输，上述两项直接构成远程包注入面**——信任锚与任务面验签须随该批落地。详见 [SECURITY §三「G12 设备远程下发面」](../SECURITY.md)。

---

## 四、成熟度与测试局限

### 任务闭环清单执行率

SKILL.md 的回复前闸门和闭合清单由 Agent 自觉执行——没有 Hook 级的硬拦截。在连续快速操作中 Agent 注意力可能跳过检查。应对：硬层兜底（fde.md + ⛔ 硬出口）、结构加固（闸门前置）、人工审计（定期翻 task/logs）。

---

### 核心效果实测情况

本项目核心宣称（越用越聪明、约束效果提升）已有 11 个实测 Case，但全部为一次性测试，缺乏持续使用 ≥1 周的样本和 A/B 对照数据。历史版本曾跑 5 组 A/B——约束层增量天花板低（0/16），Harness 层有 promising 信号但存在方法论局限。**v1.4.5 采样管线就位**（continuous-sampler 每日采 eval passRate/知识库增量/修正回流 + evolution-ab 对照 + `node tools/report/evolution-report.mjs` 报告——证据强度按「自测自报」三级标注如实分级），但 7 天样本尚未采满——「越用越好」表述在样本达标前不挂实测链接（口径见 evolution report 第七节）。

---

### 运行时约束 vs 提交时审计

当前架构是**运行时约束**——依赖 Agent 配合读取 MD 文件。早期版本确立新方向：**提交时审计**（sofagent-audit），不依赖 Agent 运行时配合（看的是 git diff），但依赖日志真实性。

| 维度 | 运行时约束 | 提交时审计 |
|------|------|------|
| 依赖 Agent 配合 | ✅ 必须 | ⚠️ 不依赖运行时配合，但依赖日志真实性 |
| 跨平台 | ⚠️ OpenClaw 全功能，其他平台仅核心约束生效 | ✅ 任何 git 仓库 |

### A14 知识库越权：事后审计而非运行时阻断

A14 规则在 commit 时检查 Agent 是否访问了超出工作流声明范围的知识库页面。但这是**事后审计**——在 Agent 已经完成读取并提交代码之后才检测。Agent 在 commit 前仍能读取任意可访问的文件。

**这意味着**：
- ✅ A14 能发现：Agent 在 commit 后被检查出访问了 exclude 的页面
- ❌ A14 不能阻止：Agent 在运行时读取敏感数据——这需要 Agent 平台的权限控制（如 OpenClaw session 权限）

**企业建议**：将 sofagent A14 作为审计追溯工具，不要作为唯一的访问控制手段。运行时阻断需配合 Agent 平台的权限体系。

---

### 审计闭环成熟度

sofagent-audit 实现了完整的六步审计闭环流程（设计文档见 [ARCHITECTURE.md](./ARCHITECTURE.md)），但各步骤的成熟度不同：

| 步骤 | 成熟度 | 说明 |
|------|:--:|------|
| 1. git diff 扫描 | ✅ 生产可用 | 纯 git 操作，确定性输出 |
| 2. 规则检查（A1-A11、A14-A24 + E1-E2/E4） | ✅ 生产可用 | 25 条规则全部有测试覆盖 |
| 3. 审计报告生成 | ✅ 生产可用 | JSON/text/table 三种格式 |
| 4. think.md 自动更新 | ⚠️ 实验性 | LLM 生成，质量依赖模型 |
| 5. MCP 推送 | ⚠️ 实验性 | MCP Server 已实现，端到端链路未验证 |
| 6. 闭环反思 | ❌ 技术预览 | 反思评分是 LLM 自评，评估者与执行者不分离 |

审计闭环的核心价值在步骤 1-3（硬证据 + 规则判定），步骤 4-6 是增量增强。企业用户应优先依赖 git diff 审计结果，反思和推送作为辅助参考。

---

### 测试覆盖范围

当前审计核心 1432 个、全 workspace 5382 个测试（口径：13 包 workspace；逐批沿革账已迁出，见 [v1.4.9 开发日志 · 附录](./changelog/v1.4/v1.4.9.md#附录测试与场景账沿革)），但覆盖范围集中在审计规则和核心逻辑（diff-parser、reporter、config-loader、rules/*.ts）。以下模块没有独立测试：

| 模块 | 测试状态 | 风险 |
|------|:--:|------|
| install.sh | 无独立测试 | 跨平台行为变化无法自动捕获 |
| daemon 脚本 | 测试覆盖不足 | launchd/systemd 注册失败无早期预警；计划 v1.x 补充核心功能测试。**行为边界**：daemon 监控 think.md/fde.md 文件 hash 变化 → 写 daemon-health.json，不直接审计 git commit。commit 审计由 commit-msg hook（`sofagent-audit --install-hook` 安装）负责 |
| MCP Server | 仅手动验证 | JSON-RPC 协议边界情况未覆盖。无自动测试。核心逻辑（run_audit/get_think/write_think）调用 audit 包已测方法。 |
| sofagent-core verify | 部分覆盖 | 约 44-48 项（动态，因环境条件变化）的逻辑分支未穷举 |

缓解：install.sh 和 sofagent-core verify 有约 44-48 项动态检查作为 smoke test，审计模块核心逻辑已有全面测试。上述模块的测试缺口不会影响审计结果的可靠性。

---

### 审计工具信任模型：Agent 自我报告

sofagent-audit 的全部证据来源是 Agent 自己写的 `~/.sofagent/data/task/logs/*.md` 文件。审计工具的可靠性上限 = Agent 日志的真实性。当前版本提供 `--silent` 模式：只跑纯 git-diff 规则，不依赖 Agent 日志。

企业用户缓解措施：交叉验证（git log 与日志文件列表做时间戳对比）、人工抽查、`--strict` 模式。

> ⚠️ **`--stats` 聚合口径披露（v1.4.3 交付 · v1.5.2 复核）**：`sofagent-audit --stats` 输出审计聚合指标（安全边界触发率等），口径为**触发率 = (WARN 条数 + FAIL 条数) / 变更总数**（exitCode 判定：1=WARN / 2=FAIL；`--json` 机器可读、`--days N` 时间窗口）。两条边界：① 纯聚合零新采集——数据地基是既有 history.jsonl，**只读铁律**（聚合层永不写 history.jsonl，HMAC 链完整性不受聚合影响，聚合前后文件字节级一致可校验）；② 空历史返回 null 降级（不报 0%——避免「无数据」被误读为「零违规」）。quick 模式（`npx` 零配置路径）**不含** stats 面——聚合是完整引擎的 CLI 能力。
>
> ⚠️ **`--quick` 与 `--silent` 的关系（文案对齐）**：`--silent` 跳过依赖 Agent 日志的规则（A3/A7/A8/A14 等）走 diff 启发式；`--quick` 是另一维度——verify 侧的快速模式（仅 4 项核心检查）。quick 审计模式（无参 npx 调用）默认 17 条规则、无 `--task` 输入时 A3 标跳过，与 `--silent` 的「跳过面」不同——两者同时用时取并集的保守语义。

---

---

## 五、审计与工程局限

### 审计 A7 检测可靠性边界 / bash 重复代码债 / 架构概念过载 / 缺少恢复路径

- **审计 A7**：检测基于 Agent 日志的正则匹配，历史版本已做 5 项加固，根本解法是结构化日志（JSONL）
- **bash 代码债**：~450 行重复代码（颜色常量/日志函数/平台探测），方向是 bash → TypeScript 迁移，不新建 bash 基础设施
- **架构概念过载**：概念密度对新手不友好，缓解措施是 CONTRIBUTING 的「10 分钟速览」
- **缺少恢复路径**：think.md 记录了踩坑，但没有结构化的「失败了怎么恢复」机制，等 JSONL 落地
- **CHANGELOG 历史遗留**：CHANGELOG 历史版（v1.0.6 及之前）含审查元信息（「审查驱动修复」等），已发布不便回改。v1.0.7 起的索引行以**产品变更**表述为主——内部工单号与审查轮次代号不再写入索引（此前的残留已随本轮文档修复批清理）；仍保留的过程性内容是**对外有披露价值的登记**（如 v1.4.8 判据偏差登记），不属审查代号。

---

### 网络外传检测（A20）为启发式规则

A20 基于域名白名单 + 动作/敏感数据双条件匹配，**非完备检测**。以下场景可绕过：
- base64/加密编码的 payload（内容层不可见）
- 通过合法 SaaS（如 pastebin、GitHub Gist）的外传
- 非 HTTP 协议通道（DNS tunneling、ICMP）

A20 定位为「审计信号」而非「安全屏障」，企业高安全场景应叠加网络层 DLP。

---

### 编排模块稳定性

编排模块依赖 LangGraph createReactAgent（@langchain/langgraph，npm 包）做任务拆解——本质上是 prompt 驱动，没有确定性 fallback。编排效果完全依赖模型质量：模型换了或者降级了，任务拆解和 Loop 检查就可能失效。Agent 变弱，编排跟着变弱；如果 @langchain/langgraph 停更或 API break，编排层直接不可用。方案 C（完整 LangGraph Agent）超时 5min/次，复杂任务可能超时；multi-step Agent loop 消耗更多 token。

缓解：审计层（git diff）不依赖编排层，独立工作。编排层是可选增强——即使编排不可用，核心约束和审计仍然生效。最终解决方案是 v2.x 协同层的确定性编排模块（计划中，参见 ROADMAP.md）。

> ℹ️ **设计取舍声明**：编排依赖模型质量是 LangGraph createReactAgent 架构选型的代价，非 bug——用「模型可插拔」（v1.3.2 client_type + v1.3.6 model_register）缓解（模型差可换），用「审计层独立」（不依赖编排）兜底。v2.x 确定性编排模块是根本解但排期较远。

---

### FDE 端到端验证状态

FDE 完整四阶段十二步部署流程（[FDE/GUIDE.md](../FDE/GUIDE.md)）已在作者自有企业（投资/科技/电商等公司）中实际部署使用。

但以下两点影响外部信任：

1. **缺乏第三方独立验证**：v1.0.0 发版时硬性截止日期 #7 达标了 3 名外部用户验证（见 [v1.0.0 changelog](./changelog/v1.0/v1.0.0.md)），但无持续的、来自独立机构的验证数据。外部审查者只能看到「作者说它工作了」+「3 名用户时点验证过」，看不到「机构级持续验证」或公开的 case study。
2. **缺乏公开案例**：没有可公开引用的 case study 文档——包括部署规模、使用的具体功能、遇到的问题、量化效果。已有 [case study 模板](./evidence/case-study-template.md)，等待真实用户填写。

缓解：如果你在真实环境中使用了 sofagent，欢迎提交 case study——这比任何内部测试都更有说服力。模板在 `docs/evidence/case-study-template.md`。

---

### 组件间集成测试

**状态：v1.3.2 起有循环级集成验证，无独立 CI 集成测试。** 各组件独立验证通过——daemon 手动验证（Case 014）、MCP Server 本地通过、webhook 推送代码完整、编排模块 LangGraph createReactAgent compose 通过。**v1.3.2 补全**——Onboard L2-L5 的循环机制天然跑全链路（编排→审计→定位→修复→再跑），作为验收标准补 smoke test。当前边界：daemon → MCP → webhook → 编排四组件串联行为依赖发版前手动验证（acceptance-test，阶段五步骤一脚本层直跑），不在日常 CI 集成测试内（见下节「端到端验收测试覆盖」）。

---

### 端到端验收测试覆盖

`playbook/acceptance-test.sh`（场景数持续扩展，当前 373 个，SSOT 口径=真实 scenario 行数（S165 动态计算并跨文档对账））：

- **CI 已覆盖**：单元测试审计核心 1432 个、全 workspace 5382 个测试（口径见本文件「测试覆盖范围」节）、sofagent-core verify 约 44-48 项（动态）
- **发版前手动覆盖**：acceptance-test.sh 373 场景（含子断言，CLI 端到端；阶段五步骤一脚本层直跑）、OpenClaw 验收 63 场景（Agent 端到端）
- **CI 未覆盖**：daemon → MCP → webhook → 编排四组件串联行为（v1.3.2 起由 Onboard 循环机制跑全链路 smoke test 承接，作为验收标准；日常 CI 无独立集成测试，发版前手动验证兜底）
- **CI 未覆盖**：多平台兼容性（macOS only verified，Linux/Windows 未验证）

未来版本计划将 acceptance-test.sh 纳入 CI 自动执行（当前为发版前手动）。

---

### acceptance-test 数字口径

> **acceptance-test 数字口径**：「4 处 check-test-count 一致」指脚本**实际校验**的 4 处——CHANGELOG / 版本开发日志 / README / acceptance-test.sh 的测试数字声明一致。该数字在其它文档（本文件、WIKI、README.en 等）亦有出现，属**引用**，不在脚本校验面内；改动数字时须按「消费方清单」全量扫。

---

### safe-delete 环境下的测试预期失败（16 个）

- **影响包**：engine/audit（audit-history 7 + session-report 1）+ engine/core（config-loader 2）+ engine/daemon（usb-detect 3）——三类测试主体跨三包分布，清理逻辑同源
- **原因**：WorkBuddy.app 内嵌的 genie-safe-delete.cjs shim 拦截 fs.rmSync 调用，测试清理临时文件被误判为大规模删除，导致 ETIMEDOUT。**非源码 bug**——CI / 本地开发机（无 shim）无此问题。
- **v1.3.3 缓解**：所有测试清理 `rmSync(..., { recursive: true })` 已用 `try-catch` 包裹，断言通过后清理失败不再让测试 FAIL。WorkBuddy 沙箱下连续跑 `bash tools/check/test-count.sh` 应稳定全绿（FAILED=0）。
- **残余**：极少数在测试**函数体**内（非清理块）调用 rmSync 的用例仍未包裹——那是测试逻辑的一部分，包裹会掩盖真实失败，维持原样。
- **环境判据**：在 WorkBuddy 下遇到测试 FAIL，先在非 shim 环境（终端裸跑 / CI）复验，确认是否为 shim 环境假失败。

### 组织记忆维护风险 / 模型依赖维护风险

- **组织记忆**：选了共享文件路线（透明可审计），但规则文件不会随使用自动进化，需人工维护
- **模型依赖**：代码由 AI 模型生成，如果所用的工程模型或审查模型停止服务，项目失去修复 bug 的能力。当前 bus factor = 1（唯一维护者），且模型依赖构成了比单人维护更深层的结构性风险——维护者本人没有独立写出这些代码的能力，必须依赖模型。未来方向：bus factor ≥ 2 后引入多个模型 fallback

---

> 这份局限文档是开放的。如果你发现了我们没列出来的局限——开 Issue，直接说。

---

## 六、文件系统审计局限

### A16/A17 文件系统审计是行为级检测

A16（非授权文件变更）与 A17（异常批量变更）是**行为级**检测——只看文件路径、扩展名、变更数量，不解析文件内容。Excel 单元格、PDF 文字、数据库内容不在审计范围内。内容级审计（OCR / 内容解析）不在当前范围，是 AgentLoop 或未来版本的事。

A16 的 `evidenceMode: git-diff` 依赖 git diff 获取变更文件列表；daemon 模式下需 daemon 主动填充 `ctx.diffFiles`。A17 的跨审计聚合依赖 `ctx.history` 窗口数据，daemon 模式下若未传入历史数据则只能检测单次批量变更。

---

## 七、历史遗留与迁移说明

> 定时触发已解决（见「✅ 已解决的历史问题」区）；Windows 平台差异见 §二「🪟 Windows 支持是实验性的」。
>
> ⚠️ **疲劳度检测模块未接线（v1.5.1 如实标注）**：v1.3.6 发版日志声称「疲劳度评分 → 写 daemon-health.json（@hourly 采集）」当前不成立——`engine/daemon/src/fatigue.ts` 的 `FatigueTracker` / `computeFatigueScore` / `writeFatigueReport` 仅被 daemon barrel 再导出 + 测试引用，`inspectors/registry.ts` / `cli.ts` / `cron.ts` 零引用，默认配置下不采集、不落盘，daemon-health.json 的 `fatigue` 字段不会由本模块写入。接线前提是真实信号源（工具调用结果 / 窗口占用 / Agent 输出流）由 orchestrator 侧投递后，再在调度表 + `inspectors/registry.ts` 落名。

### Ontology 合并准确性依赖 frontmatter 质量

Ontology 统一层的合并逻辑从 `knowledge/entities/` 目录的 Markdown frontmatter 提取实体关联。如果 frontmatter 格式不规范（缺少 `---` 分隔符、YAML 语法错误、relations 字段拼写错误），该实体会被静默跳过——不会报错，但 Ontology 中会缺失这个对象。`--doctor` 目前不检查 Ontology 完整性，用户无法自动发现遗漏。

### Work模板市场 模板（✅ 已随 v1.1.9 迁出 MIT scope）

> ✅ 已于 v1.1.9 修复：Work模板市场 模板整体迁出 MIT scope，相关 CLI（`sofagent hub deploy`）与模板源已移至外部商业仓，不在开源仓库维护。

### Agent Dashboard（✅ v1.4.0 起产品化，旧「原型假数据」局限已消除）

> ✅ **已于 v1.4.0 修复**：Dashboard HTML 产品化——`dashboard.html` + `serve-dashboard.mjs` 随 install.sh 安装到 `$SOFAGENT_HOME/web/`，`sofagent web` 一键起服务，读用户机 `~/.sofagent/data/` **真实数据**（FDE workflow / 已注册 SubAgent / sustain 周报 / 审计报告），开发态/安装态双路径解析。早期版本「目录为空时展示 2 个虚拟 Agent 假数据」的行为已移除（全仓无残留）。
>
> **仍存在的边界**（诚实披露）：① Dashboard 是**时间点快照**而非实时监控（无 WebSocket 推送，刷新即重读）；② daemon-health.json 的异常检测仍是关键词匹配（"error"/「异常」/「失败」），非结构化状态报告；③ 治理 KPI 面板（安全边界触发率/审计覆盖率等）随 v1.5.0 交付（✅ 已发版 · 2026-09-19）。

### SOFAGENT_CLEANUP_ON_RECORD 死配置已全链移除（v1.5.0）

> ✅ **v1.5.0 全链清扫完成**：TS 侧 `SofaEnvConfig.cleanupOnRecord`（v1.4.3 披露的 @deprecated 项）已删除；shell 侧 `engine/scripts/lib/config.sh` 的 `data_cleanup_on_record` 解析与 `SOFAGENT_CLEANUP_ON_RECORD` / `SOFA_CLEANUP_ON_RECORD` 导出、`engine/scripts/task-record.sh` 的写后概率触发、`engine/scripts/verify.sh` 的「清理触发已启用」告警，以及 PowerShell 侧 `engine/scripts/windows/lib/config.ps1` 对应段**同批移除，三侧零残留**（合规配置段检查同步为 6 项，`fde-template.md` 亦已摘除该键）。
>
> ⚠️ **迁移指引（行为变更，非静默死配置）**：该开关此前在 shell 侧**真实生效**——升级后 `data_cleanup_on_record: true` 不再产生任何行为。需要写入后自动清理请显式调度 `engine/scripts/cleanup.sh`；保留策略仍由 `SOFAGENT_RETENTION_DAYS` / `SOFAGENT_RETENTION_MAX` 控制（消费点 `engine/scripts/cleanup.sh`）。

---

## 八、包依赖与编排局限

### audit ↔ daemon 循环依赖（v1.2.3 已解决）

> **状态：已解决**。历史上 `@sofagent/audit` 的 `optionalDependencies` 曾包含 `@sofagent/daemon`（snapshot helpers），形成逻辑循环依赖。

**v1.2.3 修复**：snapshot helpers（`restoreSnapshot` / `listAllSnapshots`）从 `@sofagent/daemon` 迁移到 `@sofagent/core`，`audit` 包的 `package.json` 不再含任何 `daemon` 引用（含 `optionalDependencies`），源码中仅保留 `types/daemon.d.ts` 类型 shim（无 runtime import）。依赖图恢复为单向：`daemon → audit → core`，符合四层单向依赖原则。（v1.4.7 后续：该类型 shim 经查为死声明——`declare module` 声明零消费，真实消费点直接 import `@sofagent/core`——已于 v1.4.7 删除，源码中不再有任何 daemon 引用形态。）

**验证**：`grep -rn "@sofagent/daemon" engine/audit/package.json` 无命中；`grep -rn "from '@sofagent/daemon'" engine/audit/src/` 无命中（源码中已无任何 daemon 引用形态——`types/` 目录不存在、无 `declare module` shim；残留的 `@sofagent/daemon` 字样只出现在 init / federation-distill 的「如需 daemon 请安装」用户提示与迁移注释里，属文案非依赖引用）。

**历史记录**：此局限在 v1.1.3 引入（audit 需调用 daemon 的 snapshot 能力），v1.2.0 物理重构时已规划迁移，v1.2.3 随编排隔离底座一并完成。

### daily-health 为同步执行（阻塞巡检调度至脚本完成）

`daily-health` 巡检器以 `execFileSync` 拉起 `engine/scripts/daily-health.sh`——**同步阻塞** daemon 的巡检调度直到脚本完成（空数据目录实测 1.6 秒；数据量大或磁盘慢时更长，硬上限 120 秒 timeout）。选择同步的理由是「产物落盘完成后才返回」的确定性；`@daily` 级别不在热路径，故当前不构成问题——但若客户环境出现巡检整体变慢，此处是第一嫌疑点（改 detached spawn + 下轮对账即可解）。

### daemon 通知机制为轻量版

`daemon/src/notify.ts` 提供 `[sofagent-daemon]` 品牌包装的统一通知接口。**本地三态推送（PASS/WARN/FAIL）已接通**（`webhook.ts` + `push-target.ts`，agent 自测可用）。**企业平台完整推送（飞书/钉钉/企微）亦已落地**——但当前 daemon 的 cron 巡检和文件监听结果在企业场景仍依赖 stdout + `daemon-health.json`，企业 IT 需自行轮询 `history.jsonl` 或使用 Webhook 推送。

### DSH 插件 npm 首发（v1.5.2 章九起）的四条真实局限

> **历史局限已消解**：v1.5.2 章九前，`engine/dsh-plugins/**` 下全部插件都是 `private: true`（不对 npm 发布），宿主聚合插件（`cordis-plugin-sofagent`）声明的 6 条 `optionalDependencies`（inject / audit / evolve / rollback / daemon / fde）**在 npm 通道结构性地无法解析**（private 包没有注册表条目，不在 npm 解析域内），当时该声明的真实作用只是本地文件链接下的版本对齐。v1.5.2 章九起七款插件摘 `private` + 加 `files` 白名单转为 npm 发布物，**这一条不再成立**；换来的是下面三条新的真实局限。

1. **首发依赖顺序被钉死**：六款原子插件以**包名** `@sofagent/dsh-plugin-kit` 依赖适配层基座（v1.5.2 章九二轮起——此前用相对路径 `'../../plugin-kit/dist/index.js'`，从 registry 单装必挂 `MODULE_NOT_FOUND: Cannot find module '../../plugin-kit/dist/index.js'`）。⇒ `@sofagent/dsh-plugin-kit` **必须先于七款插件发布**；顺序反了则插件装完第一步挂载即失败。
2. **（已撤策）npm 通道分道**：v1.5.2 曾试行施工期 alpha 分道，同日经作者拍板撤策（版本号已承载阶段语义，dist-tag 分道复杂度大于收益）——23 包 `latest` 已全量对齐 1.5.2，`alpha` tag 保留为历史发布痕迹不维护。
3. **`audit-baseline-sync.sh` 在 `SOFAGENT_HOME` 未设时把信任锚写进 `./undefined/` 目录**（v1.5.2 发版期实锤——目录被误入库后清除）：维护者环境跑该脚本前须 `export SOFAGENT_HOME=~/.sofagent`；产品修复已于 2026-09-25 落地（脚本防御段：字面 undefined/null/空串视为未设回退真实 HOME + 非法路径 fail-loud，双态实测）。
4. **「npm 可装」≠「单独可用」**：npm 通道的可用性前置 = 干净 DSH 环境逐款实装四段验证（挂载 → seam 订阅 → `helpers.call` 引擎包解析 → 事件触发产出）。**未完成该验证前，任何文档不得声称插件 npm 可装可用**（空壳不发布）。

## 九、v1.1.7-v1.1.9 新功能局限

### Dream Cycle 知识质量依赖 LLM

**v1.4.5 真脑交付后更新**：Dream Cycle 6 阶段管道此前跑在 MockLLM 上（占位符文本——格式正确但内容为零），v1.4.5 起接入真 LLM Provider（`real-provider.ts`——模型注册表/环境变量解析 + callModelAPI 复用 + 显式降级语义）。质量防御已工程化：extract/synthesize 产出过「非占位符」三轴校验（长度/信息量溯源/与 MockLLM 输出差异度——`quality-gate.ts`），占位符级产出被拦截不进知识库；模型不可用时显式降级（status 标 `mock` 进周报与 evolution report），「占位符跑 7 天」永不默默发生。**残余局限**：知识质量的本质上限仍依赖模型能力——三轴门槛能拦「正确的废话」，不能保证产出有洞察的知识；冷启动阶段（task logs 不足）提炼出的概念仍可能高度重复或过于泛化；泛化复述的判定边界（硬信息标记 + 溯源）是启发式而非语义级，存在漏放与误拦两侧的误差面。

### sensitivity 标注质量

public / internal / restricted 三级安全分级缺省 internal。安全分级系统的致命弱点不在实现，在标注质量——开发者写 frontmatter 时不会逐条思考分级，99% 页面走缺省值。Dream Cycle 自动生成的 concept.md 如果缺省标 public，restricted 知识可能通过联邦查询泄露到不信任的 peer。联邦层有 peer 端 + 本地端二次校验，但二次校验依赖标签准确性——标签本身错了，校验也防不住。

### USB 完整运行时信任根

U 盘本身即信任根——`federation.json` 的 `key` 字段（AES-256 解密密钥）存在 U 盘上。拿到 U 盘 = 拿到 knowledge 解密能力。防的是「丢盘后被读」（加密 + HMAC 签名），不防「拿到盘的人」（拿到盘 = 合法用户）。HMAC key 如与 `federation.json` 同介质存储，可被伪造（SECURITY.md 已声明此限制）。

### knowledge-health 治理悖论

巡检器检测 5 类问题（矛盾 / 孤儿 / 死链 / 过期 / 重复）但只生成报告不自动修复。warning 级 = 「知道有问题但不紧急」，在 daemon 语境里意味着永远不会被修——除非人来看报告。只建议不修复的巡检器面临治理悖论：越用越觉得「知道有问题就够了」，但问题不会自己消失。

### A/B 自动调度 promote 风险

ab-scheduler 连续 2 轮更好即 promote。如果 eval 场景偏窄（只测了简单 case），promote 的版本在复杂场景下可能更差。已有 `overallImprovement > 0` 守卫，但窄 eval 集的局限性无法靠代码解决——需要人工定期审查 promote 历史，确认 eval 集是否覆盖了真实业务场景的复杂度。**v1.3.2 缓解**——企业专属 eval 套件（金融/制造/供应链行业模板）扩充 eval 覆盖面，窄 eval 风险降低。

---

## 十、FDE 交付物激活断裂带（v1.2.5-v1.3.0 已解决）

### 大断裂带

FDE 诊断完成后，交付了一堆**静态文件**（ontology 本体数据 + workflow.yml + skills/ + nodes/），但没人把它们「点燃」——企业 IT 拿到一堆 .md 和 .yml，不知道怎么跑起来。

这是 FDE 四阶段十二步流程中的**交付到运行之间的断裂带**：

```
FDE §7 交付（静态文件就绪）
  ↓
  🔴 大断裂带：交付物躺在磁盘上
  ↓
理想终态：企业工作流自动运行（v1.2.5+ 激活链解决）
```

### 现有零件

轨道铺好了（registry.ts 从 v1.0.8 起就支持从 `.sofagent/subagents/` 动态注册），但只有 4 节自有车厢，企业车厢造好了没挂上去——缺的是往 registry 里写企业 Agent 的自动化流程。

| 零件 | 已有能力 | 缺什么 | 解决版本 |
|------|---------|--------|---------|
| registry.ts | 动态注册 `.sofagent/subagents/*.yml` | 没人往里写企业 Agent | v1.2.5 activate.ts |
| workflow-parser.ts | YAML → SubAgent 映射 | 映射表写死 4 个内置 Agent | v1.2.6 扩展 enterprise 类型 |
| composer.ts | LangGraph createReactAgent 通用拆解 | 缺「读 FDE 交付物 → 企业专属编排」 | v1.2.7 composeEnterpriseWorkflow |
| dag-runner.ts | 按 DAG 依赖跑 SubAgent | 只跑内置 Agent，缺 HITL | v1.2.8-v1.2.9 企业 Agent + HITL |

### 解决方案：激活链四阶段

| Phase | 版本 | 核心交付 |
|-------|------|---------|
| ACTIVATE | v1.2.5 | activate.ts：读交付物 → 注册企业 SubAgent |
| ORCHESTRATE | v1.2.6-v1.2.7 | 映射表扩展 + composeEnterpriseWorkflow + StateGraph |
| EXECUTE | v1.2.8-v1.2.9 | dag-runner 企业 Agent + HITL + 审计集成 |
| SUSTAIN | v1.3.0 | 全闭环验证 + wrapToolCall 联动 |

> 详见 [激活链设计文档](./guides/fde-activation-chain.md)。

### 当前状态

- **v1.2.5 前**：大断裂带存在，FDE 交付物需人工解读
- **v1.2.5 后**：ACTIVATE 已交付，activate 命令可注册企业 Agent
- **v1.2.8 后**：ORCHESTRATE + EXECUTE 前半已交付，企业 Agent 可编排 + 运行 + 每步审计
- **v1.3.0（已交付）**：全链路打通（SUSTAIN），企业工作流自运转
