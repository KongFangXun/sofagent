# sofagent Limitations

> 诚实坦白：已知局限。列出 sofagent 当前做不到什么、为什么做不到、等什么才能做到。
>
> v1.2.4 · 2026-08-02（UTC）· 孔放勋

> 🧭 **阅读引导（P2-33）**：本文档按严重度分节——**安全/合规局限**（一、二节）面向强合规选型，**能力边界**（三节起）是设计取舍而非缺陷。通读一遍即可建立心智模型：**大多数局限有明确版本路线（v1.3.x / v1.4.0），不是"永远做不到"**。首次阅读建议先看目录 + 每节第一段，无需逐条读完。

---

## 目录

- [一、架构设计局限](#一架构设计局限)
- [二、平台与兼容性局限](#二平台与兼容性局限)
- [三、安全与信任模型局限](#三安全与信任模型局限)
- [四、成熟度与测试局限](#四成熟度与测试局限)
- [五、审计与工程局限](#五审计与工程局限)
- [六、文件系统审计局限（v1.0.9 起）](#六文件系统审计局限v109-起)
- [七、定时触发与 Windows 局限（v1.0.5 起）](#七定时触发与-windows-局限v105-起)
- [八、包依赖与编排局限（v1.1.3 起）](#八包依赖与编排局限v113-起)
- [九、v1.1.7-v1.1.9 新功能局限](#九v117-v119-新功能局限)
- [十、行业研报印证的新增局限（2026-07）](#十行业研报印证的新增局限2026-07)
- [十一、架构反模式：五种常见 Agent 工程错误](#十一架构反模式五种常见-agent-工程错误)
- [十二、FDE 交付物激活断裂带（v1.2.5+ 解决中）](#十二fde-交付物激活断裂带v125-解决中)

---

## Key Limitations

> 最关键 7 条局限，快速了解 sofagent 的边界：

| # | 局限 | 详见 |
|:--:|------|------|
| 1 | ~~**audit ↔ daemon 循环依赖**~~ —— **已于 v1.2.3 消除**：snapshot helpers 从 `@sofagent/daemon` 迁移到 `@sofagent/core`，`audit` 不再依赖 `daemon`（含 `optionalDependencies`），依赖图恢复为单向 `daemon → audit → core`。 | [八、包依赖与编排局限 → audit ↔ daemon 循环依赖（v1.2.3 已解决）](#八包依赖与编排局限v113-起) |
| 2 | **单包测试需先 build**——monorepo 未 build 时单包 `npm test` 可能失败（依赖 dist/），需先 `npm run build --workspaces`。 | [四、成熟度与测试局限](#四成熟度与测试局限) |
| 3 | **默认非 fail-closed**——config.yml 可被 Agent 篡改绕过审计规则。仅当 config 解析失败时走 safeDefaults（fail-closed 强制启用）。 | [三、安全与信任模型局限](#三安全与信任模型局限) |
| 4 | **编排能力依赖 orchestrator 包 + 模型质量**——LangGraph createReactAgent 驱动，编排效果依赖模型质量。模型降级 → 编排降级。 | [五、审计与工程局限 → 编排引擎稳定性](#五审计与工程局限) |
| 5 | **数据明文存储无加密**——`~/.sofagent/data/` 下所有数据为明文 Markdown，无传输加密、无静态加密。age 加密已纳入 v1.4.0 roadmap（见 ROADMAP.md 和 SECURITY.md）。 | [三、安全与信任模型局限 → 数据存储安全](#三安全与信任模型局限) |
| 6 | **单平台场景可能过重**——只用单一 Agent 平台且接受云端审计的用户，平台内置治理比 sofagent 更顺滑。sofagent 的价值在多供应商混用 + 本地留证场景。 | [二、平台与兼容性局限 → 单平台场景](#单平台用户建议)
| 7 | **FDE 交付物激活断裂带（v1.2.5 解决中）**——FDE 诊断交付的 ontology + workflow.yml + skills/ 是静态文件，企业 IT 拿到不知道怎么跑起来，交付物与"工作流自动运行"之间有断裂带。激活链（ACTIVATE→ORCHESTRATE→EXECUTE→SUSTAIN）正在解决，v1.2.5 起逐个版本落地。 | [十二、FDE 交付物激活断裂带（v1.2.5+ 解决中）](#十二fde-交付物激活断裂带v125-解决中) |

> ⚠️ **企业高安全场景**：`config.yml` 可被 Agent 篡改以绕过审计规则（如关闭规则、放宽阈值）。config.yml 有两个有效位置——项目级 `${cwd}/.sofagent/config.yml` 和全局级 `~/.sofagent/config.yml`（config-loader.ts 三级 fallback，项目级优先）。建议：① CI 侧独立校验 config 完整性（`sofagent-audit --diff` 兜底，hook 可绕 CI 不可绕）；② 文件权限锁（`chmod 600 ~/.sofagent/config.yml` 和 `chmod 600 .sofagent/config.yml`，仅受信用户可写）。与已有 `--no-verify` CI 兜底建议呼应。
>
> **建议缓解措施**：
> 1. **CI 侧兜底（推荐）**：在 CI pipeline 中加入 `sofagent-audit --diff HEAD~1..HEAD`，
>    确保即使开发者本地用了 `--no-verify`，CI 仍会拦截。
>    ```yaml
>    # GitHub Actions 示例
>    - name: sofagent 审计检查
>      run: |
>        npx @sofagent/audit --diff HEAD~1..HEAD
>    ```
> 2. **定期自动 doctor**：配置 cron job 每周运行 `sofagent-core --doctor`，
>    并将结果发送到监控频道，检测 hooks 是否被意外移除。
> 3. **推荐操作**：安装后立即执行 `chmod 400 ~/.sofagent/config.yml`（全局级）和 `chmod 400 .sofagent/config.yml`（项目级）使文件只读（需 root 或当前用户），
>    阻止 Agent 写入篡改。CI 中可增加 `sofagent-audit --diff` 校验步骤做双重保障。

### 本地开发紧急缓解措施

在 CI 侧兜底尚未就绪之前，本地开发建议：
1. **`chmod 400 ~/.sofagent/config.yml`**——Agent 无法写入篡改，推荐安装后立即执行。
2. **设置 git hooksPath**——在 `~/.gitconfig` 中设置 `[core] hooksPath = ...` 确保 hook 路径不可被 Agent 覆盖。
3. **定期运行 doctor**——`sofagent-audit --doctor` 检查审计规则完整性，检测 hooks 是否被意外移除或 config 被篡改。

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

### 🌱 Skill 自动优化：从经验记录走向结构化知识库

v1.0.1 新增 daemon Ingest（自动知识提取）+ loop-evaluate Lint（自动体检）将自动优化从「纯经验记录」推进一步。但仍处于**记录 + 整理**阶段——尚未到「自动改进」（多轨迹归纳）阶段：

| 阶段 | 机制 | sofagent 现状 |
|------|------|------|
| **经验记录** | 记录单次成功/失败，调整评分 | ✅ v1.0.1 起 |
| **多轨迹归纳**（TRACE2SKILL） | 并行分析大量轨迹 → 提出补丁 → 合并去重 | ❌ 缺：前 5 次冷启动保护仅缓冲，未真正归因 |
| **自验证闭环**（Evil Skill） | 多子 Agent 生成候选 Skill → A/B 对比 → 留更优 | ⏳ v1.0.6 起（方案 B：模型 API 直跑）。v1.0.7 升级为方案 C（DeepAgents 完整 Agent） |
| **可训练参数**（Skill Opt） | 学习率约束/验证门控/负反馈缓冲/动量 | ✅ v1.0.4 起（SkillOpt 管道接通） |

**SkillOpt 集成状态（v1.0.4）**：管道已接通——daemon 检测 eval.md 阈值（20 条）→ 24h 防抖 → 调用 `sofagent-audit skillopt-run` CLI → `runSkillOpt()` 调 skillopt-sleep → `validateCandidate()` 验证（行数 + 内容变化）→ 备份+替换 SKILL.md。`--doctor` 展示管道状态。前置条件：需手动 clone github.com/microsoft/SkillOpt + `pip install -e .`（`pip install skillopt` 不含 skillopt-sleep CLI）。skillopt-sleep 未安装时管道优雅降级——daemon 写提示到 daemon-health.json，不 crash。

**A/B 运行器状态（v1.0.5 → v1.0.6 → v1.0.7）**：v1.0.5 `simulateAgentRun()` 是 mock（直接返回 expected，A/B 永远打平）。v1.0.6 替换为模型 API 直跑（方案 B）——自迭代闭环打通。v1.0.7 升级为 DeepAgents 完整 Agent（方案 C），支持工具调用验证。

**风险**：单次失败 → 降分 → 下次不用该 Skill。但失败可能只是模型波动——长期会把噪声写成规则。**现有防御**：冷启动保护（前 5 次只记录不判断）+ LLM 自评权重 ×0.3。根治需要独立验证环（见 ROADMAP v1.x）。

---

## 二、平台与兼容性局限

### ⏰ 定时触发做不到

目前只有「每次对话启动」这一种触发方式。OpenClaw 不支持 cron 级定时任务。短期替代：Agent 自查 task/logs，上次执行超阈值时主动提醒用户——但不是真正的定时循环。

---

### 🐚 B1 数据初始化依赖 bash

SKILL.md B1 步用 bash heredoc 创建 `~/.sofagent/data/` 数据目录。Windows 或受限沙盒环境可能没有 bash。降级路径已内置：bash 不可用时 Agent 降级为逐条 `mkdir` + Write 工具创建。

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

sofagent 跑在单个 Agent 里——没有 agent-to-agent 通信，没有多实例协调。子 Agent 是 session 隔离，不是独立 Agent 进程。多用户共享 `~/.sofagent/data/` 会交叉污染。多用户场景建议每人独立 `~/.sofagent/`。
- **批量部署**：当前 per-repo 安装，无 org-level 集中配置下发。企业批量部署需自行编写脚本（参见 docs/guides/enterprise-deploy.md）。

### 🧩 单平台用户建议

如果你**只用一家 Agent 平台**（如只用 OpenAI、只用 Anthropic、只用豆包），且**接受审计日志存在云端**——那么该平台的内置治理能力可能比 sofagent 更顺滑（无需额外安装、无需学习曲线）。sofagent 的核心价值在多供应商混用 + 本地留证场景：当你同时用 OpenAI + Anthropic + 国内模型，需要一份统一的、跨平台的、留在本地的审计证据时——平台内置方案做不到这一点。

---

### sudo 权限边界

> **sudo 权限边界**：sofagent 的 `install.sh` 不需要 sudo 权限（所有操作在用户目录 + npm global）。但 `--init` 安装 git hook 时，如 `.git/hooks/` 目录权限为 root（罕见，通常是当前用户），需要 `sudo chown` 修正目录权限后再运行。daemon plist 安装到 `~/Library/LaunchAgents/`，不需要 sudo。如用户以 root 运行 sofagent，审计日志和 knowledge/ 的文件 owner 会变为 root，后续非 root 运行时可能因权限不足报错——不建议以 root 运行。

---

---

## 三、安全与信任模型局限

> **企业 DevOps 集成路径**：当前 `history.jsonl` 为 append-only JSONL 明文，企业 IT 如需接入 SIEM / 企业日志平台，可通过 filebeat / logstash 等采集 agent 定时轮询 `~/.sofagent/data/audit/history.jsonl` 转发（见 SECURITY.md「审计结果推送」）。**本地三态 Webhook 推送 v1.1.6 已接通**（PASS/WARN/FAIL）；**企业平台推送（飞书/钉钉/企微）已在 v1.2.1 落地**（采购阻塞项已解除）。CI 集成方面，各包提供 `npm test` 与 `FORGE/playbook/acceptance-test.sh` 可接入现有流水线做门禁；`sofagent-audit --install-hook` 提供的 commit-msg hook 可作为 pre-commit / pre-push 关卡。以下是一个完整的 GitHub Actions CI 兜底示例（在 CI 中跑 `sofagent-audit --diff`，确保 `--no-verify` 绕过 hook 后仍有防线）：
>
> ```yaml
> # .github/workflows/sofagent-audit.yml
> name: sofagent 审计检查
> on: [pull_request]
> jobs:
>   audit:
>     runs-on: ubuntu-latest
>     steps:
>       - uses: actions/checkout@v4
>         with:
>           fetch-depth: 0  # 需要完整 git 历史用于 --diff
>       - name: 安装 sofagent-audit
>         run: npm install -g @sofagent/audit
>       - name: 审计最近一次提交
>         run: sofagent-audit --diff HEAD~1..HEAD --ci
> ```

> **审计日志防篡改检测边界**：`history.jsonl` 的完整性依赖 hash chain（`audit-history.ts`），Agent 可在篡改后重算整条链——hash chain 仅提供事后可追溯性，非强防篡改。v1.1.8 起已支持 HMAC-SHA256 签名（密钥来自 `~/.sofagent-key`），有密钥时强防篡改，无密钥时降级为 SHA-256 hash chain。`--doctor`（v1.2.0 起）会实际调用 `checkHistoryChainIntegrity()` 校验链完整性。当前版本仍依赖「Agent 自觉 + 定期 --doctor」的信任模型。

### 🔒 数据存储安全

> ⚠️ **审计日志全局共享**：当前版本审计日志写入全局 `~/.sofagent/data/audit/history.jsonl`，不做项目级隔离。多项目场景下审计记录会混合存储。按 git 仓库隔离计划在 v1.3.x 落地。

> ⚠️ **知识库同样全局共享（P1-31 披露）**：`~/.sofagent/data/knowledge/` 单目录遍历、无租户/项目维度隔离——多项目、多 Agent 的知识沉淀（entities/concepts/comparisons/summaries）混合存储，查询时全局命中。财务与人事等不同域 Agent 的数据会串。按项目/Agent 隔离计划在 v1.3.x 落地。

task/logs 和 think.md 以明文 Markdown 存储，可能含代码片段、API 响应、用户对话摘要。LLM 提炼反思时可能无意写入敏感信息。age 加密已纳入 v1.4.0 roadmap（见 [ROADMAP](./ROADMAP.md) 和 [SECURITY](./SECURITY.md)）。
- history.jsonl 存审计判定详情，A2/A9 已脱敏，其他规则 details 可能含代码片段或文件路径，敏感场景请配合外部加密卷

---

### A9 注入检测局限——编码绕过

> ⚠️ **A9 注入检测局限——编码绕过**：A9 正则检测覆盖常见中文"忽略类"指令、英文"ignore 类"指令，以及 leet speak 变体（`1gn0r3` → `ignore`，通过 normalizeLine() 反转 + ×0.8 降权匹配）。但不覆盖：① Unicode 同形字替换（西里尔字母 `а` 替换拉丁 `a`）；② Base64/hex 编码后的注入 payload。这些绕过手法依赖语义分析（非纯正则可覆盖），规划在 v1.3.x 评估 LLM 辅助检测。

---

### A2 密钥检测局限——编码与格式绕过（v1.2.5 披露）

> ⚠️ **A2 仅检测明文常见 API key 格式**（AWS AKIA、OpenAI/Anthropic/DeepSeek sk-*、GitHub token、私钥块等）。v1.2.5 起已补 base64/hex 编码检测（新增行先解码再跑正则）与 `.gitattributes -diff` 绕过检测（WARN）。但仍不在检测范围：
> - 短密钥（<32 位）、非标准格式
> - 其他编码（URL-safe base64、rot13、自定义混淆）与压缩/加密后的密钥
> - 历史提交中的密钥（A2 只扫当前 diff 新增行，不扫全量历史）
>
> **改名 + 编码/短 key 可组合绕过 A1+A2 双拦截**（如 `.env` → `app.config.js` + base64）。建议 CI 侧补 gitleaks / detect-secrets 做全量历史扫描。

---

### Skill 层 Slop：经验漂移

eval.md + think.md 在循环中持续自我修订，会引入**经验漂移**——某次偶然成功被当成经验写进 think.md，三个月后经验库里一半是不可复现的噪声。应对：think.md 的置信度渐进（0.3→0.5→0.7）和 30 天无触发衰减。更根本的解法是定期人工审计。

---

### 平台依赖

核心约束（SKILL.md / fde.md）是纯 Markdown，任何能读文件的平台都能加载。但深度集成（Hook 注入、session 隔离、sub-agent 管理）只有 OpenClaw 能做到——不是我们选择独占，是其他平台不开源到这个程度。

#### OpenClaw 的两种角色

> 完整设计描述见 [ARCHITECTURE § 地基与引擎](docs/ARCHITECTURE.md#地基与引擎)。此处只记录与局限相关的点。

**模式 B 的关键约束**：企业 Agent 不跑在 OpenClaw session 里。OpenClaw 不拦截 Agent 的 API 调用、不提供 Docker。sofagent 对企业 Agent 的审计走的是**文件系统层 + git hook**——Agent 在设备上正常安装、正常运行，代码仓库在设备文件系统上，`git commit` 时 commit-msg hook 自动触发 sofagent-audit。不需要"控制"Agent，不需要 Agent 配合，只需要 hook 它们的 git 仓库。

> 以下表格说的是"哪些能力在哪个层生效"——不是"哪些 Agent 被支持"。审计层对所有 Agent 一视同仁（只看 git diff），编排层全平台可用（LangGraph createReactAgent 驱动）。

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

### A14 知识库越权：事后审计而非运行时阻断

A14 规则在 commit 时检查 Agent 是否访问了超出工作流声明范围的知识库页面。但这是**事后审计**——在 Agent 已经完成读取并提交代码之后才检测。Agent 在 commit 前仍能读取任意可访问的文件。

**这意味着**：
- ✅ A14 能发现：Agent 在 commit 后被检查出访问了 exclude 的页面
- ❌ A14 不能阻止：Agent 在运行时读取敏感数据——这需要 Agent 平台的权限控制（如 OpenClaw session 权限）

**企业建议**：将 sofagent A14 作为审计追溯工具，不要作为唯一的访问控制手段。运行时阻断需配合 Agent 平台的权限体系。

---

### 审计闭环成熟度

sofagent-audit 实现了完整的六步审计闭环流程（设计文档见 [ARCHITECTURE.md](docs/ARCHITECTURE.md)），但各步骤的成熟度不同：

| 步骤 | 成熟度 | 说明 |
|------|:--:|------|
| 1. git diff 扫描 | ✅ 生产可用 | 纯 git 操作，确定性输出 |
| 2. 规则检查 A1-A11、A14-A23 | ✅ 生产可用 | 24 条规则（A1-A11、A14-A23 + E1-E2/E4）全部有测试覆盖 |
| 3. 审计报告生成 | ✅ 生产可用 | JSON/text/table 三种格式 |
| 4. think.md 自动更新 | ⚠️ 实验性 | LLM 生成，质量依赖模型 |
| 5. MCP 推送 | ⚠️ 实验性 | MCP Server 已实现，端到端链路未验证 |
| 6. 闭环反思 | ❌ 技术预览 | 反思评分是 LLM 自评，评估者与执行者不分离 |

审计闭环的核心价值在步骤 1-3（硬证据 + 规则判定），步骤 4-6 是增量增强。企业用户应优先依赖 git diff 审计结果，反思和推送作为辅助参考。

---

### 测试覆盖范围

当前审计核心 568 个、全 workspace 1438 个测试（共 1438 个，全绿；含 v1.2.4 新增 64 个知识进化测试。实测见 `tools/test-count.sh`，与 pre-push-check 一致），但覆盖范围集中在审计规则和核心逻辑（diff-parser、reporter、config-loader、rules/*.ts）。以下模块没有独立测试：

| 模块 | 测试状态 | 风险 |
|------|:--:|------|
| install.sh | 无独立测试 | 跨平台行为变化无法自动捕获 |
| daemon 脚本 | 测试覆盖不足 | launchd/systemd 注册失败无早期预警；计划 v1.x 补充核心功能测试。**行为边界**：daemon 监控 think.md/fde.md 文件 hash 变化 → 写 daemon-health.json，不直接审计 git commit。commit 审计由 commit-msg hook（`sofagent-audit --install-hook` 安装）负责 |
| MCP Server | 仅手动验证 | JSON-RPC 协议边界情况未覆盖。无自动测试。核心逻辑（run_audit/get_think/write_think）调用 audit 包已测方法。 |
| sofagent-core verify | 部分覆盖 | 约 44-48 项（动态，因环境条件变化）的逻辑分支未穷举 |

缓解：install.sh 和 sofagent-core verify 有约 44-48 项动态检查作为 smoke test，审计引擎核心逻辑已有全面测试。上述模块的测试缺口不会影响审计结果的可靠性。

---

### 审计工具信任模型：Agent 自我报告

sofagent-audit 的全部证据来源是 Agent 自己写的 `~/.sofagent/data/task/logs/*.md` 文件。审计工具的可靠性上限 = Agent 日志的真实性。v0.94 起提供 `--silent` 模式：只跑纯 git-diff 规则，不依赖 Agent 日志。

企业用户缓解措施：交叉验证（git log 与日志文件列表做时间戳对比）、人工抽查、`--strict` 模式。

---

---

## 五、审计与工程局限

### 审计 A7 检测可靠性边界 / bash 重复代码债 / 架构概念过载 / 缺少恢复路径

- **审计 A7**：检测基于 Agent 日志的正则匹配，v0.92 已做 5 项加固，根本解法是结构化日志（JSONL）
- **bash 代码债**：~450 行重复代码（颜色常量/日志函数/平台探测），方向是 bash → TypeScript 迁移，不新建 bash 基础设施
- **架构概念过载**：概念密度对新手不友好，缓解措施是 CONTRIBUTING 的「10 分钟速览」
- **缺少恢复路径**：think.md 记录了踩坑，但没有结构化的「失败了怎么恢复」机制，等 JSONL 落地
- **CHANGELOG 历史遗留**：CHANGELOG 历史版（v1.0.6 及之前）含审查元信息（"审查驱动修复"等），已发布不便回改。v1.0.7 起的 changelog 已严格区分产品变更与审查过程。

---

### 编排引擎稳定性

编排引擎依赖 LangGraph createReactAgent（@langchain/langgraph，npm 包）做任务拆解——本质上是 prompt 驱动，没有确定性 fallback。编排效果完全依赖模型质量：模型换了或者降级了，任务拆解和 Loop 检查就可能失效。Agent 变弱，编排跟着变弱；如果 @langchain/langgraph 停更或 API break，编排层直接不可用。方案 C（完整 LangGraph Agent）超时 5min/次，复杂任务可能超时；multi-step Agent loop 消耗更多 token。

缓解：审计层（git diff）不依赖编排层，独立工作。编排层是可选增强——即使编排不可用，核心约束和审计仍然生效。最终解决方案是 v2.x 协同层的确定性编排引擎（计划中，参见 ROADMAP.md）。

---

### FDE 端到端验证状态

FDE 完整四阶段十二步部署流程（[FDE/GUIDE.md](FDE/GUIDE.md)）已在作者自有企业（投资/科技/电商等公司）中实际部署使用。

但以下两点影响外部信任：

1. **缺乏第三方独立验证**：v1.0.0 发版时硬性截止日期 #7 达标了 3 名外部用户验证（见 [v1.0.0 changelog](./docs/changelog/v1.0/v1.0.0.md)），但无持续的、来自独立机构的验证数据。外部审查者只能看到「作者说它工作了」+「3 名用户时点验证过」，看不到「机构级持续验证」或公开的 case study。
2. **缺乏公开案例**：没有可公开引用的 case study 文档——包括部署规模、使用的具体功能、遇到的问题、量化效果。已有 [case study 模板](docs/evidence/case-study-template.md)，等待真实用户填写。

缓解：如果你在真实环境中使用了 sofagent，欢迎提交 case study——这比任何内部测试都更有说服力。模板在 `docs/evidence/case-study-template.md`。

---

### 组件间集成测试

**状态：无集成测试。** 各组件独立验证通过——daemon 手动验证（Case 014）、MCP Server 本地通过、webhook 推送代码完整、编排引擎 LangGraph createReactAgent compose 通过——但 daemon → MCP → webhook → 编排四组件串联行为未验证。未来版本计划补全链路 smoke test。

---

### 端到端验收测试覆盖

v1.0 新增 `FORGE/playbook/acceptance-test.sh`（102 个场景，含子断言），覆盖范围持续扩展：

- **CI 已覆盖**：单元测试审计核心 568 个、全 workspace 1438 个测试（共 1438 个，全绿；含 v1.2.4 新增 64 个知识进化测试。函数级，实测见 `tools/test-count.sh`，与 pre-push-check 一致）、sofagent-core verify 约 44-48 项（动态）
- **发版前手动覆盖**：acceptance-test.sh 115 场景（含子断言，CLI 端到端，步骤 2.3）、OpenClaw 验收 63 场景（Agent 端到端，步骤 2.5）
- **CI 未覆盖**：daemon → MCP → webhook → 编排四组件串联行为（仍依赖手动验证）
- **CI 未覆盖**：多平台兼容性（macOS only verified，Linux/Windows 未验证）

未来版本计划将 acceptance-test.sh 纳入 CI 自动执行（当前为发版前手动），并补全组件串联 smoke test。

---

### acceptance-test 数字口径（v1.2.3 澄清）

> **acceptance-test 数字口径（v1.2.3 更新）**：v1.2.2 版本 acceptance-test.sh 为 151 场景（含子断言）。"4 处 check-test-count 一致"指 4 个关键文件（CHANGELOG / 版本开发日志 / README / acceptance-test.sh）的测试数字声明一致；历史上曾写"5 处"，实际 check-test-count 脚本只校验 4 处。

---

### safe-delete 环境下的测试预期失败（16 个）

- **影响包**：engine/audit（config-loader 2 + audit-history 7 + session-report 1 + usb-detect 3）
- **原因**：WorkBuddy.app 内嵌的 genie-safe-delete.cjs shim 拦截 fs.rmSync 调用，测试清理临时文件被误判为大规模删除
- **缓解**：在无 safe-delete shim 的环境中运行测试可全绿；或使用 `--no-safe-delete` 标志（如适用）
- **计划修复**：v1.3.0 考虑使用 mock fs 隔离测试清理逻辑

### 组织记忆维护风险 / 模型依赖维护风险

- **组织记忆**：选了共享文件路线（透明可审计），但规则文件不会随使用自动进化，需人工维护
- **模型依赖**：代码由 AI 模型生成，如果所用的工程模型或审查模型停止服务，项目失去修复 bug 的能力。当前 bus factor = 1（唯一维护者），且模型依赖构成了比单人维护更深层的结构性风险——维护者本人没有独立写出这些代码的能力，必须依赖模型。未来方向：bus factor ≥ 2 后引入多个模型 fallback

---

> 这份局限文档是开放的。如果你发现了我们没列出来的局限——开 Issue，直接说。

---

## 六、文件系统审计局限（v1.0.9 起）

### A16/A17 文件系统审计是行为级检测

v1.0.9 新增的 A16（非授权文件变更）和 A17（异常批量变更）是**行为级**检测——只看文件路径、扩展名、变更数量，不解析文件内容。Excel 单元格、PDF 文字、数据库内容不在审计范围内。内容级审计（OCR / 内容解析）不在 v1.0.9 范围，是 AgentLoop 或未来版本的事。

A16 的 `evidenceMode: git-diff` 依赖 git diff 获取变更文件列表；daemon 模式下需 daemon 主动填充 `ctx.diffFiles`。A17 的跨审计聚合依赖 `ctx.history` 窗口数据，daemon 模式下若未传入历史数据则只能检测单次批量变更。

---


## 七、定时触发与 Windows 局限（v1.0.5 起）

### Ontology 合并准确性依赖 frontmatter 质量

Ontology 统一层的合并引擎从 `knowledge/entities/` 目录的 Markdown frontmatter 提取实体关联。如果 frontmatter 格式不规范（缺少 `---` 分隔符、YAML 语法错误、relations 字段拼写错误），该实体会被静默跳过——不会报错，但 Ontology 中会缺失这个对象。`--doctor` 目前不检查 Ontology 完整性，用户无法自动发现遗漏。

### Workflow Hub 模板（✅ 已随 v1.1.9 迁出 MIT scope）

> ✅ 已于 v1.1.9 修复：FlowHub 整体迁出 MIT scope，相关 CLI（`sofagent hub deploy`）与模板源已移至 `sofagent-commercial/FLOWHUB/`，不在开源仓库维护。

### Agent Dashboard 是原型而非生产功能

`--doctor --agents` 读取 `task/logs/` 目录推断 Agent 状态——当目录为空时展示默认假数据（2 个虚拟 Agent）。这不是实时监控，只是时间点快照。daemon-health.json 的异常检测是关键词匹配（"error"/"异常"/"失败"），不是结构化状态报告。当前 2 个 Sub Agent 的规模下 Dashboard 价值有限，验证企业需求后再决定是否进 v2.x 前端（计划中，参见 ROADMAP.md）。

---

## 八、包依赖与编排局限（v1.1.3 起）

### audit ↔ daemon 循环依赖（v1.2.3 已解决）

> **状态：已解决（v1.2.3）**。历史上 `@sofagent/audit` 的 `optionalDependencies` 曾包含 `@sofagent/daemon`（snapshot helpers），形成逻辑循环依赖。

**v1.2.3 修复**：snapshot helpers（`restoreSnapshot` / `listAllSnapshots`）从 `@sofagent/daemon` 迁移到 `@sofagent/core`，`audit` 包的 `package.json` 不再含任何 `daemon` 引用（含 `optionalDependencies`），源码中仅保留 `types/daemon.d.ts` 类型 shim（无 runtime import）。依赖图恢复为单向：`daemon → audit → core`，符合四层单向依赖原则。

**验证**：`grep -rn "@sofagent/daemon" engine/audit/package.json` 无命中；`grep -rn "from '@sofagent/daemon'" engine/audit/src/` 无命中（仅 `declare module` 类型声明）。

**历史记录**：此局限在 v1.1.3 引入（audit 需调用 daemon 的 snapshot 能力），v1.2.0 物理重构时已规划迁移，v1.2.3 随编排隔离底座一并完成。

### daemon 通知机制为轻量版

v1.1.3 新增 `daemon/src/notify.ts` 提供 `[sofagent-daemon]` 品牌包装的统一通知接口。**本地三态推送（PASS/WARN/FAIL）v1.1.6 已接通**（`webhook.ts` + `push-target.ts`，agent 自测可用）。但**企业平台完整推送（飞书/钉钉/企微）已在 v1.2.1 落地**——当前 daemon 的 cron 巡检和文件监听结果在企业场景仍依赖 stdout + `daemon-health.json`，企业 IT 需自行轮询 `history.jsonl` 或使用 v1.2.1 Webhook 推送。

## 九、v1.1.7-v1.1.9 新功能局限

### Dream Cycle 知识质量依赖 LLM（v1.1.7）

Dream Cycle 6 阶段管道从 think.md / task logs 抽取知识（fact → atom → concept → cluster）。当前 MockLLM 产出的是占位符文本——格式正确但内容为零。接入 RealLLM 后，知识质量完全依赖模型能力，无法保证产出的 fact/atom/concept 是有意义的知识点而非「正确的废话」。冷启动阶段尤其明显——没有足够 task logs 时，Dream Cycle 提炼出的概念可能高度重复或过于泛化。

### sensitivity 标注质量（v1.1.7）

public / internal / restricted 三级安全分级缺省 internal。安全分级系统的致命弱点不在实现，在标注质量——开发者写 frontmatter 时不会逐条思考分级，99% 页面走缺省值。Dream Cycle 自动生成的 concept.md 如果缺省标 public，restricted 知识可能通过联邦查询泄露到不信任的 peer。联邦层有 peer 端 + 本地端二次校验，但二次校验依赖标签准确性——标签本身错了，校验也防不住。

### USB 完整运行时信任根（v1.1.9）

U 盘本身即信任根——`federation.json` 的 `key` 字段（AES-256 解密密钥）存在 U 盘上。拿到 U 盘 = 拿到 knowledge 解密能力。防的是「丢盘后被读」（加密 + HMAC 签名），不防「拿到盘的人」（拿到盘 = 合法用户）。HMAC key 如与 `federation.json` 同介质存储，可被伪造（SECURITY.md 已声明此限制）。

### knowledge-health 治理悖论（v1.1.7）

巡检器检测 5 类问题（矛盾 / 孤儿 / 死链 / 过期 / 重复）但只生成报告不自动修复。warning 级 = 「知道有问题但不紧急」，在 daemon 语境里意味着永远不会被修——除非人来看报告。只建议不修复的巡检器面临治理悖论：越用越觉得「知道有问题就够了」，但问题不会自己消失。

### A/B 自动调度 promote 风险（v1.1.9）

ab-scheduler 连续 2 轮更好即 promote。如果 eval 场景偏窄（只测了简单 case），promote 的版本在复杂场景下可能更差。已有 `overallImprovement > 0` 守卫，但窄 eval 集的局限性无法靠代码解决——需要人工定期审查 promote 历史，确认 eval 集是否覆盖了真实业务场景的复杂度。

---

## 十、行业研报印证的新增局限（2026-07）

### 不要一上来就 Agent 自动闭环

研报的「分阶段风险收敛」警示：存量系统之上的语义接管不可跳步，高风险 Action 必须 human-in-the-loop。这印证 sofagent 的现状——审计 A14 仍是事后审计（非运行时阻断，见 §五）。五阶段的完整对照（只读对象层 → 统一状态关系 → 挂载 Method → 开放低风险 Action → 高风险 Action）与动态 Agent 组织印证见 [ROADMAP · 行业印证](./ROADMAP.md#行业印证)。

### 模糊提示下确定性骨架不可替代

研报测评发现：当用户提示模糊时，精简上下文方案弱于「有完整 system prompt 兜底」的工具。对应 sofagent 的**依赖良好 Skill 定义**——fde.md / SKILL.md 提供的确定性骨架（岗位模板 + 四问 + 铁律）正是弥补模糊提示的兜底层；Skill 定义质量直接决定 Agent 在模糊输入下的下限。Skill 级经验漂移（见 §三）会侵蚀这层兜底，需持续维护。

> 📖 来源：温故知新 2026-07-21（行业研报《Ontology Runtime 企业级架构落地》《Databricks 真实代码库测评》）

---

## 十一、架构反模式：五种常见 Agent 工程错误

> 来源：DBGoal《Agent Harness、Loop 与 Graph：别再把三层架构混为一谈》(2026-07)。以下五种反模式在 Agent 工程实践中反复出现，与 sofagent 的已知局限形成对照。

| # | 反模式 | 表现 | sofagent 的应对 |
|:--:|--------|------|----------------|
| 1 | **不了解工作就先画巨型 Graph** | 在稳定路径出现之前就设计复杂的 DAG/编排 | 编排引擎先做串行版（v1.1），完整 DAG 并行规划在 v1.3+（见 LIMITATIONS §八） |
| 2 | **让同一个模型既写又评** | 执行者和审查者用同一个 LLM，自评不客观 | FORGE fresh-eyes-loop 要求 A/B 用不同厂商模型（异构） |
| 3 | **把「继续尝试」当作 Loop** | 无限重试无新证据，只是费用泄漏 | Loop 围绕「证据」设计——sustain 的 eval 反馈闭环需要明确 passRate 阈值 |
| 4 | **把 Harness 变成工具垃圾场** | 工具过多增加选择错误，宽泛权限扩大事故范围 | ToolGate 限定了 Agent 工具调用的前置门禁，不是所有工具都能随便调用 |
| 5 | **用 Graph 掩盖 Harness 缺陷** | 流程图无法修复陈旧数据、不可靠工具和缺少权限控制的问题 | 审计引擎的「硬证据」原则（19/24 条纯 git-diff）不依赖 Agent 意愿——这就是 Harness 的底线 |

> **核心教训**：Architecture complexity should come from observed real needs, not from imagining "advanced agents"。sofagent 的三引擎不是同时做的——先有审计（Harness 层），再有 think.md 反思（回溯/进化），最后才到 skillopt 自优化。FORGE 工具链是项目自迭代过程中逐步长出来的内部工具。这个顺序本身就是对反模式 1 和 5 的预防。

---

## 十二、FDE 交付物激活断裂带（v1.2.5+ 解决中）

### 大断裂带

FDE 诊断完成后，交付了一堆**静态文件**（ontology 本体结构 + workflow.yml + skills/ + nodes/），但没人把它们"点燃"——企业 IT 拿到一堆 .md 和 .yml，不知道怎么跑起来。

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
| composer.ts | LangGraph createReactAgent 通用拆解 | 缺"读 FDE 交付物 → 企业专属编排" | v1.2.7 composeEnterpriseWorkflow |
| dag-runner.ts | 按 DAG 依赖跑 SubAgent | 只跑内置 Agent，缺 HITL | v1.2.8-v1.2.9 企业 Agent + HITL |

### 解决方案：激活链四阶段

| Phase | 版本 | 核心交付 |
|-------|------|---------|
| ACTIVATE | v1.2.5 | activate.ts：读交付物 → 注册企业 SubAgent |
| ORCHESTRATE | v1.2.6-v1.2.7 | 映射表扩展 + composeEnterpriseWorkflow + StateGraph |
| EXECUTE | v1.2.8-v1.2.9 | dag-runner 企业 Agent + HITL + 审计集成 |
| SUSTAIN | v1.3.0 | 全闭环验证 + wrapToolCall 联动 |

> 详见 [激活链设计文档](./docs/guides/fde-activation-chain.md)。

### 当前状态

- **v1.2.5 前**：大断裂带存在，FDE 交付物需人工解读
- **v1.2.5 后**：activate 命令可注册企业 Agent，但编排和执行尚未就绪
- **v1.3.0 后**：全链路打通，企业工作流自运转
