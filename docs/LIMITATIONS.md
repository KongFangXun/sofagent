# sofagent Limitations

> 诚实坦白：已知局限。列出 sofagent 当前做不到什么、为什么做不到、等什么才能做到。
>
> v1.4.4 · 2026-09-03（UTC）· 孔放勋

> 🧭 **阅读引导**：本文档按主题分节——**安全/合规局限见第三节**（强合规选型先读），**能力边界**（其余各节）多为设计取舍而非缺陷。通读一遍即可建立心智模型：**大多数局限有明确版本路线（见 ROADMAP），不是"永远做不到"**。首次阅读建议先看目录 + 每节第一段，无需逐条读完。

---

## 目录

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
| 4 | **静态加密接线未启用**——加密能力已实现（crypto-init.ts AES-256-GCM），但激活入口未接入启动路径，审计历史主链与 forge-runs/checkpoint/model-registry 三目录 + task/logs + think.md **当前均为明文（原声称排 v1.3.9 未兑现），全量接线已移排 v1.4.7（G7 数据主权主题）**。 | [三、安全与信任模型局限 → 数据存储安全](#三安全与信任模型局限) |
| 5 | **单平台场景可能过重**——只用单一 Agent 平台且接受云端审计的用户，平台内置治理比 sofagent 更顺滑。sofagent 的价值在多供应商混用 + 本地留证场景。 | [二、平台与兼容性局限 → 单平台场景](#单平台用户建议) |

> ✅ **已解决的历史问题**（v1.3.2 移出 Key Limitations，不再计入当前边界）：
> - ~~audit ↔ daemon 循环依赖~~（v1.2.3 消除：snapshot helpers 迁移至 `@sofagent/core`，依赖图恢复单向 `daemon → audit → core`，详见 §八）
> - ~~FDE 交付物激活断裂带~~（v1.2.5-v1.3.0 消除：激活链 Phase 1-4 全部交付，详见 §十）
> - ~~定时触发做不到~~（v1.2.8 消除：daemon 内置 scheduler，v1.3.5 扩展 cron 表达式，详见 §二）

> ⚠️ **企业高安全场景**：`config.yml` 可被 Agent 篡改以绕过审计规则（如关闭规则、放宽阈值）。config.yml 有两个有效位置——项目级 `${cwd}/.sofagent/config.yml` 和全局级 `~/.sofagent/config.yml`（config-loader.ts 三级 fallback，项目级优先）。建议：① CI 侧独立校验 config 完整性（`sofagent-audit --diff` 兜底，hook 可绕 CI 不可绕）；② 文件权限锁（`chmod 600 ~/.sofagent/config.yml` 和 `chmod 600 .sofagent/config.yml`，仅受信用户可写）。与已有 `--no-verify` CI 兜底建议呼应。**v1.3.9 已落地（原「规划中 v1.3.9 目标」兑现）**：SubAgent 侧 config 篡改由沙箱虚拟 FS 拦截（写入走虚拟层审批）；主 Agent 侧由 meta-harness 统一编排承接（v1.3.9 交付二）。建议仍保留 CI 兜底 + 文件权限双保险（纵深防御）。
>
> **建议缓解措施**（按有效性排序）：
> 1. **CI 侧兜底（最有效）**：在 CI pipeline 中加入 `sofagent-audit --diff HEAD~1..HEAD`，
>    确保即使开发者本地用了 `--no-verify`，CI 仍会拦截。CI 以独立身份运行（非当前用户），Agent 无法篡改——这是唯一能防住「Agent 以当前用户身份写入篡改 config」的手段。
>    ```yaml
>    # GitHub Actions 示例
>    - name: sofagent 审计检查
>      run: |
>        npx -y -p @sofagent/audit sofagent-audit --diff HEAD~1..HEAD --ci
>    ```
> 2. **定期自动 doctor**：配置 cron job 每周运行 `sofagent-core --doctor`，
>    并将结果发送到监控频道，检测 hooks 是否被意外移除。
> 3. **文件权限锁（辅助，有局限）**：`chmod 400 ~/.sofagent/config.yml`（全局级）和 `chmod 400 .sofagent/config.yml`（项目级）使文件只读。
>    ⚠️ **注意：`chmod 400` 仅防其他用户读取，不防 Agent 以当前用户身份写入篡改**——Agent 与你同身份运行，文件权限对同用户进程无效。真正能防住的是 CI 侧独立校验（见第 1 条）。chmod 是纵深防御的辅助层，不能单独依赖。

### 本地开发紧急缓解措施

在 CI 侧兜底尚未就绪之前，本地开发建议：
1. **`chmod 400 ~/.sofagent/config.yml`**——Agent 无法写入篡改，推荐安装后立即执行。
2. **设置 git hooksPath**——在 `~/.gitconfig` 中设置 `[core] hooksPath = ...` 确保 hook 路径不可被 Agent 覆盖。
3. **定期运行 doctor**——`sofagent-audit --doctor` 检查审计规则完整性，检测 hooks 是否被意外移除或 config 被篡改。注意 doctor 默认 warning 不计失败（exit 0），CI 门禁场景需加 `--strict`。

> 📌 data 目录整体权限加固（chmod 700）见 [SECURITY.md](../SECURITY.md) "临时缓解措施"段。

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

**SkillOpt 集成状态（v1.0.4）**：管道已接通——daemon 检测 eval.md 阈值（20 条）→ 24h 防抖 → 调用 `sofagent-audit skillopt-run` CLI → `runSkillOpt()` 调 skillopt-sleep → `validateCandidate()` 验证（行数 + 内容变化）→ 备份+替换 SKILL.md。`--doctor` 展示管道状态。前置条件：`pip install skillopt`（v0.2.0+ PyPI wheel 已含 skillopt-sleep CLI）；如需 Claude Code/Codex/Copilot/Devin 集成 shell 或 OpenClaw 适配，改用源码安装 `git clone + pip install -e ".[all]"`。skillopt-sleep 未安装时管道优雅降级——daemon 写提示到 daemon-health.json，不 crash。

> ⚠️ **skillopt-sleep 是临时外部依赖，非核心能力**：skillopt 自进化链路分两段——**检测/触发/验证/回滚**（纯 TypeScript，零外部依赖，核心能力）+ **生成候选 SKILL.md**（调外部 skillopt-sleep CLI，可选依赖）。skillopt-sleep 未安装时，前段照常运行（失败检测、failure-ledger 聚类、Dream Cycle 回灌），只是后段降级为安全扫描，不生成优化候选。**待后训练模型引擎就绪（v1.4.x 后训模块排期中），"生成候选"这步会由训练好的模型直接完成，届时 skillopt-sleep 外部依赖将被移除**——它是有期限的临时方案，不是长期架构。

**A/B 运行器状态（v1.0.5 → v1.0.6 → v1.0.7）**：v1.0.5 `simulateAgentRun()` 是 mock（直接返回 expected，A/B 永远打平）。v1.0.6 替换为模型 API 直跑（方案 B）——自迭代闭环打通。v1.0.7 升级为 DeepAgents 完整 Agent（方案 C），支持工具调用验证。

**风险**：单次失败 → 降分 → 下次不用该 Skill。但失败可能只是模型波动——长期会把噪声写成规则。**现有防御**：冷启动保护（前 5 次只记录不判断）+ LLM 自评权重 ×0.3。根治需要独立验证环（见 ROADMAP v1.x）。

---

## 二、平台与兼容性局限

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

**核心审计模块（@sofagent/audit npm 包）跨平台**——纯 TypeScript，Node.js ≥18 即可运行，不依赖 bash。

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

> **sudo 权限边界**：sofagent 的 `install.sh` 通常无需 sudo（所有操作在用户目录 + npm global）；仅当 symlink 目标目录（如 `/usr/local/bin`）不可写时，会以非交互 sudo（`sudo -n`）尝试注册 CLI 命令，失败时给出手动命令提示。`--init` 安装 git hook 时，如 `.git/hooks/` 目录权限为 root（罕见，通常是当前用户），需要 `sudo chown` 修正目录权限后再运行。daemon plist 安装到 `~/Library/LaunchAgents/`，不需要 sudo。如用户以 root 运行 sofagent，审计日志和 knowledge/ 的文件 owner 会变为 root，后续非 root 运行时可能因权限不足报错——不建议以 root 运行。

---

---

## 三、安全与信任模型局限

> **企业 DevOps 集成路径**：当前 `history.jsonl` 为 append-only JSONL 明文，企业 IT 如需接入 SIEM / 企业日志平台，可通过 filebeat / logstash 等采集 agent 定时轮询 `~/.sofagent/data/audit/history.jsonl` 转发（见 SECURITY.md「审计结果推送」）。**本地三态 Webhook 推送 v1.1.6 已接通**（PASS/WARN/FAIL）；**企业平台推送（飞书/钉钉/企微）已在 v1.2.1 落地**（采购阻塞项已解除）。CI 集成方面，各包提供 `npm test` 与 `FORGE/playbook/acceptance-test.sh` 可接入现有流水线做门禁；`sofagent-audit --install-hook` 提供的 commit-msg hook 可作为 pre-commit / pre-push 关卡。以下是一个完整的 GitHub Actions CI 兜底示例（在 CI 中跑 `sofagent-audit --diff`，确保 `--no-verify` 绕过 hook 后仍有防线）：
>
> ⚠️ **安全豁免开关披露**：设置环境变量 `SOFAGENT_WEBHOOK_ALLOW_LOCALHOST=1` 可豁免 webhook URL 的 localhost/内网地址校验（用于本地集成测试，实现见 `engine/audit/src/webhook.ts`）。该开关开启期间 SSRF 防护对内网地址失效——**生产环境禁止开启**。本仓库验收脚本（acceptance-test.sh 场景 34）对该开关遵循「export 后立即 unset」的最小暴露窗口纪律，外部使用应照此执行。
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

> **审计日志防篡改检测边界**：`history.jsonl` 的完整性依赖 hash chain（`audit-history.ts`），Agent 可在篡改后重算整条链——hash chain 仅提供事后可追溯性，非强防篡改。v1.1.8 起已支持 HMAC-SHA256 签名（密钥来自 `~/.sofagent-key`），有密钥时强防篡改，无密钥时降级为 SHA-256 hash chain（此时篡改检测是**弱校验**——手改后重算整链即可通过，FAIL 可被抹成 PASS；企业 SOP 应强制配置密钥并周期体检）。`--doctor`（v1.2.0 起）会实际调用 `checkHistoryChainDetailed()` 校验链完整性。当前版本仍依赖「Agent 自觉 + 定期 --doctor」的信任模型。

### 🔒 数据存储安全

> ℹ️ **审计历史全局共享是设计决策**：审计历史（`history.jsonl` / `decision-log.jsonl`）写入全局 `~/.sofagent/data/audit/`，不做项目级隔离——这是**有意为之**：① HMAC 签名链完整性要求全量连续历史（`--verify-chain` 需要完整链）；② 跨仓库查询审计历史是运维刚需。多项目场景下审计记录会混合存储。**运行时审计日志（`runtime-audit.jsonl`）在 FORGE 自托管 SubAgent 路径已按 git 仓库隔离（`data/audit/runtime/<repo-hash>/`）；引擎侧 data-sovereignty 审计日志仍全局（原声称排 v1.3.9 未兑现，已移排 v1.4.7 复用 FORGE 方案补齐 repo-hash 隔离）**；审计历史保持全局。**临时方案**：使用 `SOFAGENT_HOME` 环境变量为不同项目/Agent 隔离数据目录。

> ⚠️ **知识库同样全局共享（当前单机单用户设计）**：`~/.sofagent/data/knowledge/` 单目录遍历、无租户/项目维度隔离——多项目、多 Agent 的知识沉淀（entities/concepts/comparisons/summaries）混合存储，查询时全局命中。财务与人事等不同域 Agent 的数据会串。**当前定位为单机单用户**：多 Agent 共享同一知识库/审计历史——多人/多部门共用需等租户隔离（ROADMAP v1.4.7 G7 多租户抽象层 v0）。**临时方案**：使用 `SOFAGENT_HOME` 环境变量为不同项目/Agent 隔离数据目录（见 [企业部署指南](./guides/enterprise-deploy.md#多项目数据隔离v128)）。

> ⚠️ **`.sofagent/.git-shadow/` 在被审计仓库内创建**：sofagent 审计时会在被审计的 git 仓库根目录创建 `.sofagent/.git-shadow/` 目录存放审计快照——设计意图是按 git 仓库隔离快照（不同仓库的快照不能串，否则回溯到错误仓库）。快照内容**已 sanitize 脱敏**（API key / 密码 / 手机号打码，v1.3.4 起），位于仓库内便于 git worktree 隔离。经 `--init` 或 `--install-hook` 安装时，自动写入 .gitignore（v1.3.6 起两路径行为一致），且 v1.4.2 起三层 hook 防线兜底（pre-commit 在 commit 前将 .sofagent/ 移出暂存区 + commit-msg 二次清理 + post-commit HEAD tree 对账告警），`git add -f` 强制暂存也会被移出（reset 失败则 fail-loud 拒绝 commit）；该目录不进 git 提交，但用户 `ls -a` 可见。可安全删除（重新审计会重建）。改存储位置是 v1.4 架构决策，当前版本只披露。

task/logs 和 think.md 以 Markdown 存储，可能含代码片段、API 响应、用户对话摘要。LLM 提炼反思时可能无意写入敏感信息。静态加密能力已实现（crypto-init.ts AES-256-GCM + SOFAGENT-AGE-V1 格式），但接线未启用（原声称排 v1.3.9 未兑现，现排 v1.4.7）——审计历史主链与 task/logs、think.md、forge-runs/checkpoint/model-registry 当前均为明文（脱敏管道仍生效），见 [ROADMAP](./ROADMAP.md) 和 [SECURITY](../SECURITY.md)。
- history.jsonl 存审计判定详情，A2/A9 已脱敏，其他规则 details 可能含代码片段或文件路径，敏感场景请配合外部加密卷
- **v1.3.1 #44 披露：审计历史并发写入无文件锁**——appendFileSync 在 POSIX 上对小于 PIPE_BUF (4KB) 的写入是原子的，审计历史条目通常 < 1KB，单次写入安全。但多进程同时写入（daemon 文件监控 + Agent commit）可能导致行交错，产生损坏行触发 hash chain 完整性校验失败。概率极低（审计触发频率 < 1次/分钟），但损坏会导致校验失败。**v1.3.8 解决**——WAL 写在网关层，天然单 writer 模式（所有工具调用经网关串行写入，消除并发写入）。
- **写链两处「降级继续」是设计取舍（v1.4.4 D-5 披露）**：① 上一行解密/JSON 解析失败时 prevHash 置 `'unknown'` 继续写入（条目带 `chainStatus:'broken'` 显式标记，连续 ≥2 条断裂升级告警）；② chmod 0o600 失败时读回实际权限验证——真实宽松才告警，写入照常。两处均**不阻断审计写入**：审计写入被阻断 = 审计本身失效，比链断或权限宽更危险（fail-open 取舍，审计可用性 > 链完整性严格性）。攻防注意：能反复损坏 history.jsonl 最后一行的攻击者可让链持续断裂而不被写入侧拦截——发现连续断裂告警时应立即 `--doctor` 全链校验并排查文件篡改来源。

---

### A9 注入检测局限——编码绕过

> ⚠️ **A9 注入检测局限——编码绕过**：A9 正则检测覆盖常见中文"忽略类"指令、英文"ignore 类"指令，以及 leet speak 变体（`1gn0r3` → `ignore`，通过 normalizeLine() 反转 + ×0.8 降权匹配）。但不覆盖：① Unicode 同形字替换（西里尔字母 `а` 替换拉丁 `a`）；② Base64/hex 编码后的注入 payload。这些绕过手法依赖语义分析（非纯正则可覆盖），**v1.3.2 评估覆盖**——L3 自动定位（LLM 推理）可检测正则覆盖不了的语义级注入。

> ⚠️ **A9 commit msg 检测 quick 模式已生效（v1.3.8 修复）**：quick 模式（`npx sofagent-audit`，零配置审计最近一次 commit）**自动读取最近一次 commit 的 message**（`git log -1`），A9 commit msg 注入检测生效；commit msg 取不到时（如空仓库 / git 不可用）A9 由引擎按无输入处理（标跳过）。同理 A3（不改越界）依赖任务描述，quick 模式无此输入 → v1.3.3 起 quick 模式跳过 A3（避免占位 task 'quick-audit' 100% 误报越界）。A3 越界检查需 `--init` 安装 git hook 走完整引擎，或手动 `sofagent-audit --diff <range> --commit-msg <msg>`。
>
> ℹ️ **range 模式 commitMsg 取范围终点（v1.4.4 修复）**：此前 quick 引擎 range 审计（`sofagent-audit HEAD~3..HEAD` 类调用）的 commitMsg 输入面写死字面 HEAD，与被审计 range 脱钩——终点携带注入载荷漏检、HEAD 的 message 污染在审区间误报。现 commitMsg 经 `resolveDiffEndpoint()` 取 range 终点（与 diff 面同源），回归测试见 engine/audit/src/cli-quick-range.test.ts。

> ⚠️ **边界：空 commit 不审计消息**——empty commit（无文件变更）时审计直接跳过，commit message 中的注入载荷不会被 A9 扫描（A9 的证据面是 diff + 显式传入的 `--commit-msg`）。带文件变更的 commit 消息正常扫描。纯消息攻击需 `--commit-msg` 显式送检。

> ⚠️ **commit msg 注入伪造审计标记——A9 检测为 WARN 不阻断**：commit message 中如伪造 `[sofagent-audit PASS]` 等审计通过标记，A9 会检测到该注入并报 **WARN（exit 1），但不阻断 commit**——commit 仍然成功提交。人工 review 时需注意：commit message 中的审计标记可能是伪造的，**真实审计结果以 `~/.sofagent/data/audit/` 下的审计记录为准**，不要信任 commit message 自带的审计声明。

> ⚠️ **quick 模式二进制/超大 diff 盲区（v1.3.5 披露）**：quick 模式**没有**完整引擎对超大 diff 的 5MB 阈值兜底（完整引擎：普通文件 WARN exit 1 / 敏感文件名 FAIL exit 2）。git diff 对二进制文件只输出 `Binary files differ`（无内容行），规则无内容可扫——大体积二进制/超大 diff 在 quick 模式下会全绿通过。这是 git diff 的设计而非 sofagent bug，但对应用户意味着：quick 模式不能替代二进制敏感文件（如密钥库、私有数据集）的防泄漏审查；强合规场景请用完整引擎（`--init` 装 hook）兜底。

> ⚠️ **critical fast-fail：命中后后续层规则跳过（v1.4.3 披露）**：审计模块按规则分层串行执行——**critical 层（A1 敏感文件 / A2 密钥泄漏 / A9 注入等基线底线）任一 FAIL 后，后续层规则（A3 越界 / A7 盲改 / A16 非授权变更等）不再执行、统一标 SKIPPED**（输出形如「1 违规 · 7 通过 · 9 跳过」）。设计意图是 fail-fast（critical 命中已足以拦截 commit，无需继续跑）。**取证注意**：SKIPPED ≠ 通过——跳过的规则本次未检查，事后取证不能把「N 条跳过」读成「N 条无问题」；攻击者理论上可用显眼但无害的 critical 命中（如 A1 诱饵文件名）制造「审计抓到问题了」的表象，同时掩盖后续层规则未跑的事实。需要完整逐规则结果时，修复 critical 违规后重新审计即可获得全量执行。规则分层见 SECURITY.md「24 条审计规则」与 engine/audit/src/rules/runner.ts fast-fail 段。

> ⚠️ **config-loader 环境变量死开关披露（v1.4.3 P2-g）**：`SofaEnvConfig` 中 `sanitizeEnabled` / `sanitizeIpsEnabled` / `cleanupOnRecord` / `cleanupFrequency` / `auditEnabled` 五字段**加载但无生产消费点**——企业 IT 设 `SOFAGENT_SANITIZE=...`、`SOFAGENT_AUDIT_ENABLED=...` 等**不改变任何行为**（已在 config-loader.ts 标 @deprecated）。实际生效面：脱敏管道常开（不受开关控制）、审计由 config.yml `rules:{...}` 控制（不构成第二通道）、清理走 cleanup.sh（其保留策略读 `SOFAGENT_RETENTION_DAYS`/`SOFAGENT_RETENTION_MAX`，v1.4.3 起认 SOFAGENT_ 新名、SOFA_ 旧名兼容）。

---

### A2 密钥检测局限——编码与格式绕过（v1.2.5 披露）

> ⚠️ **A2 仅检测明文常见 API key 格式**（AWS AKIA、OpenAI/Anthropic/DeepSeek sk-*、GitHub token、私钥块等；**v1.3.6 起含 Stripe `sk_live_`/`sk_test_` 下划线前缀格式**；**v1.4.2 起含 Google `AIza`、Slack `xox*-`、JWT `eyJ` 三段式，及 AWS Secret Access Key 裸 40 位 base64 形态（需同行含 aws/secret/key 关键词才报，防 hash/commit SHA 误报）**）。v1.2.5 起已补 base64/hex 编码检测（新增行先解码再跑正则）与 `.gitattributes -diff` 绕过检测（WARN）。但仍不在检测范围：
> - 短密钥（<32 位）、非标准格式、其他厂商下划线前缀（保守设计防误报，等真实泄漏案例驱动，不逐格式打地鼠——v1.3.6 决策，Stripe 因前缀在生产代码无合法用途而纳入）
> - 其他编码（URL-safe base64、rot13、自定义混淆）与压缩/加密后的密钥
> - 历史提交中的密钥（A2 只扫当前 diff 新增行，不扫全量历史）
>
> **改名 + 编码/短 key 可组合绕过 A1+A2 双拦截**（如 `.env` → `app.config.js` + base64）。建议 CI 侧补 gitleaks / detect-secrets 做全量历史扫描。

> **二进制文件盲区（红队实测）**——git 对二进制文件只输出 `Binary files ... differ`，无内容行可扫：约 5KB 随机字节夹带密钥的 blob 可完全绕过 A2 内容扫描（无论密钥是明文还是嵌入二进制段）。缓解：A2 对**新增**二进制扩展名文件（.bin/.exe/.dll/.so/.dylib 等）及 diff 标记 `Binary files differ` 的新增文件（含 NUL 字节）输出 WARN「二进制文件不扫内容，请人工确认」——WARN 不拦截提交，最终防线是人工复核 + CI 侧二进制感知扫描工具。

> **v1.3.1 披露：>5MB diff 残余缝隙**——diff-parser 对单个文件 diff 超过 5MB（maxBuffer）时置 `oversized` 标记，A2 无法扫描其内容。audit/index.ts 已对此注入 WARN（安全敏感文件名升级为 FAIL），但内容本身仍跳过——攻击者可故意构造超大 diff 藏密钥。A2 归一化已补 NFKC Unicode 处理（v1.3.1 #46），sk-* 正则已扩展连字符/下划线支持。**v1.3.9 评估覆盖**——AST 规则引擎走流式解析（不 maxBuffer），超大 diff 不再跳过内容。

---

### Skill 层 Slop：经验漂移

eval.md + think.md 在循环中持续自我修订，会引入**经验漂移**——某次偶然成功被当成经验写进 think.md，三个月后经验库里一半是不可复现的噪声。应对：think.md 的置信度渐进（0.3→0.5→0.7）和 30 天无触发衰减。更根本的解法是定期人工审计。

---

### 平台依赖

核心引擎（审计/约束层）**平台无关**——核心约束（SKILL.md / fde.md）是纯 Markdown，任何能读文件的平台都能加载，审计照常生效。但 **hook 自动注入当前仅 OpenClaw 生效**（深度集成 Hook 注入、session 隔离、sub-agent 管理只有 OpenClaw 能做到——其他平台的 Hook 接入排期见 [ROADMAP](./ROADMAP.md)（Claude Code PreToolUse 适配评估中））；其他平台手动注入约束 + 审计照常。

#### OpenClaw 的两种角色

> 完整设计描述见 [ARCHITECTURE § 地基与引擎](./ARCHITECTURE.md#地基与引擎)。此处只记录与局限相关的点。

**模式 B 的关键约束**：企业 Agent 不跑在 OpenClaw session 里。OpenClaw 不拦截 Agent 的 API 调用、不提供 Docker。sofagent 对企业 Agent 的审计走的是**文件系统层 + git hook**——Agent 在设备上正常安装、正常运行，代码仓库在设备文件系统上，`git commit` 时 commit-msg hook 自动触发 sofagent-audit。不需要"控制"Agent，不需要 Agent 配合，只需要 hook 它们的 git 仓库。

> 以下表格说的是"哪些能力在哪个层生效"——不是"哪些 Agent 被支持"。审计层对所有 Agent 一视同仁（只看 git diff），编排层全平台可用（LangGraph createReactAgent 驱动）。

| 能力 | OpenClaw | WorkBuddy | Codex / Hermes / Claude Code |
|------|:--:|:--:|:--:|
| 核心约束 | ✅ Hook注入 | ✅ SKILL加载 | ⚠️ 种子指令 |
| Skill 自启 | ✅ | ✅ | ❌ |
| 加载链脚本 | ✅ 内部 hook | ❌ Agent Read替代 | ❌ |
| 断路器 | ✅ loopDetection | ❌ | ❌ |

### Dashboard 本地服务面自查结论（CI 供应链加固配套 · 已核验）

> **有网络面，已修**：`serve-dashboard.mjs` 是真实 HTTP 服务面（非纯静态），三项核验——① 默认绑定 `127.0.0.1`（`DASHBOARD_HOST || '127.0.0.1'`，局域网共享须显式 `DASHBOARD_HOST=0.0.0.0` opt-in）；② dashboard.html 零外链 CDN（36 图标 SVG 内嵌，断网可用——与 v2.0.0 离线 USB 节点叙事对齐）；③ 服务无密钥/凭据面（只读 `~/.sofagent/data/` 快照文件，无写操作、无鉴权需求）。GitHub Actions 供应链面：8 个 workflow 20 处 `uses:` 全部 pin 40 位 commit SHA + 注释 tag，`tools/check/check-action-pins.sh` 在线对账 SHA 与 tag 同 commit（离线降级不阻断门禁）。

---

---

## 四、成熟度与测试局限

### 任务闭环清单执行率

SKILL.md 的回复前闸门和闭合清单由 Agent 自觉执行——没有 Hook 级的硬拦截。在连续快速操作中 Agent 注意力可能跳过检查。应对：硬层兜底（fde.md + ⛔ 硬出口）、结构加固（闸门前置）、人工审计（定期翻 task/logs）。

---

### 核心效果实测情况

本项目核心宣称（越用越聪明、约束效果提升）已有 11 个实测 Case，但全部为一次性测试，缺乏持续使用 ≥1 周的样本和 A/B 对照数据。历史版本曾跑 5 组 A/B——约束层增量天花板低（0/16），Harness 层有 promising 信号但存在方法论局限。

---

### 运行时约束 vs 提交时审计

当前架构是**运行时约束**——依赖 Agent 配合读取 MD 文件。早期版本确立新方向：**提交时审计**（sofagent-audit），不依赖 Agent 运行时配合（看的是 git diff），但依赖日志真实性。

| 维度 | 运行时约束 | 提交时审计 |
|------|------|------|
| 依赖 Agent 配合 | ✅ 必须 | ⚠️ 不依赖运行时配合，但依赖日志真实性 |
| 跨平台 | ⚠️ OpenClaw 全功能，其他平台仅核心约束生效 | ✅ 任何 git 仓库 |

### A14 知识库越权：事后审计而非运行时阻断

A14 规则在 commit 时检查 Agent 是否访问了超出业务流声明范围的知识库页面。但这是**事后审计**——在 Agent 已经完成读取并提交代码之后才检测。Agent 在 commit 前仍能读取任意可访问的文件。

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
| 2. 规则检查 A1-A11、A14-A23 | ✅ 生产可用 | 24 条规则（A1-A11、A14-A23 + E1-E2/E4）全部有测试覆盖 |
| 3. 审计报告生成 | ✅ 生产可用 | JSON/text/table 三种格式 |
| 4. think.md 自动更新 | ⚠️ 实验性 | LLM 生成，质量依赖模型 |
| 5. MCP 推送 | ⚠️ 实验性 | MCP Server 已实现，端到端链路未验证 |
| 6. 闭环反思 | ❌ 技术预览 | 反思评分是 LLM 自评，评估者与执行者不分离 |

审计闭环的核心价值在步骤 1-3（硬证据 + 规则判定），步骤 4-6 是增量增强。企业用户应优先依赖 git diff 审计结果，反思和推送作为辅助参考。

---

### 测试覆盖范围

当前审计核心 978 个、全 workspace 3753 个测试（v1.4.1 批次 2937→3178 +241，v1.4.2 批 +171（bugfix 批 +24 全部为 audit 包回归用例 878→902（H-01 三层防线 / H-02 密钥四类 / H-03 空白折叠 / G-01 基线 / G-07 webhook 脱敏）+ dev 批 +147（数据管道 53 / eval 闭环与环境 45 / dry-run 与报告 28 / FDE 六引擎 21，orchestrator 1295→1442）+ A2 data-URI 豁免三用例 902→905 + data-sovereignty data-URI 豁免两用例 905→907 + 四轮深挖 core data-paths 五用例 369→374 + orchestrator 占位豁免三用例 1442→1445 + eval 桥接两用例 1445→1447 + v1.4.3 批 +138：audit +12（stats 聚合）/ orchestrator +126（train-analyze 35 + train-monitor 22 + train-diagnose 26 + train-sandbox 14 + post-training-workflow 11 + env-anticheat 18）至 audit 919 / orchestrator 1648）+ 安全回归批 +34（engineer 路径守卫，orchestrator 1573→1607，总数 3507→3541）+ L4 修复器路径守卫批 +41（orchestrator 1607→1648，总数 3541→3582）+ v1.4.4 审查批 #73 占位重写 +12（daemon cron 1→5 / harness constraints 1→4 / think-generator 1→3 / daemon inspectors 1→4，总数 3582→3594）+ v1.4.3 阶段五 run-02 闭环批一 P0-3 +6（doctor Ontology 完整性检查 6 用例，core 374→380，总数 3594→3600）+ 审查修复批 +11（config-loader cost 透传契约 2 用例 core 380→382 + webhook IPv6 SSRF 防护 6 用例 + audit-log 落盘脱敏 3 用例，audit 919→928，总数 3600→3611）+ 出站防护与原子写契约批 +8（daemon webhook 推送 SSRF 守卫 5 用例 + push-target 2 用例 287→294 + eval 原子写契约 1 用例 32→33，总数 3611→3619）+ 同批形式循环依赖清理删除 loop-audit-history.test.ts −6（orchestrator 1648→1642，净 3619 持平）+ v1.4.4 审查批 stats E 系列规则码回归 +1（audit 928→929，总数 3619→3620）+ v1.4.4 审查修复批 +15（quick A9 range 回归 4 用例 + audit-history 降级增强 3 用例 audit 929→936 + verify 三哨兵三态 6 用例 core 382→388 + daemon 错误日志轮转 2 用例 294→296，总数 3620→3635）+ v1.4.4 开发批 +109（audit 936→976：decision-query 因果链与先例检索 6 用例 + 语料导出三件套 34 用例；core 388→393：doctor daemon 守护感知 5 用例；orchestrator 1642→1697：artifact-register 13 用例 + train-compare 11 用例 + 语料导出配套；daemon 296→302：daemon 退出码落盘与 doctor 感知 6 用例；mcp 154→157：corpus-export 协议面 3 用例，总数 3635→3744））；实测见 `tools/check/test-count.sh`，flaky 复跑机制内置，以脚本判定为准，与 pre-push-check 一致），但覆盖范围集中在审计规则和核心逻辑（diff-parser、reporter、config-loader、rules/*.ts）。以下模块没有独立测试：

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

---

---

## 五、审计与工程局限

### 审计 A7 检测可靠性边界 / bash 重复代码债 / 架构概念过载 / 缺少恢复路径

- **审计 A7**：检测基于 Agent 日志的正则匹配，历史版本已做 5 项加固，根本解法是结构化日志（JSONL）
- **bash 代码债**：~450 行重复代码（颜色常量/日志函数/平台探测），方向是 bash → TypeScript 迁移，不新建 bash 基础设施
- **架构概念过载**：概念密度对新手不友好，缓解措施是 CONTRIBUTING 的「10 分钟速览」
- **缺少恢复路径**：think.md 记录了踩坑，但没有结构化的「失败了怎么恢复」机制，等 JSONL 落地
- **CHANGELOG 历史遗留**：CHANGELOG 历史版（v1.0.6 及之前）含审查元信息（"审查驱动修复"等），已发布不便回改。v1.0.7 起的 changelog 已严格区分产品变更与审查过程。

---

### 网络外传检测（A20）为启发式规则

A20 基于域名白名单 + 动作/敏感数据双条件匹配，**非完备检测**。以下场景可绕过：
- base64/加密编码的 payload（内容层不可见）
- 通过合法 SaaS（如 pastebin、GitHub Gist）的外传
- 非 HTTP 协议通道（DNS tunneling、ICMP）

A20 定位为"审计信号"而非"安全屏障"，企业高安全场景应叠加网络层 DLP。

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

**状态：v1.3.2 起有循环级集成验证，无独立 CI 集成测试。** 各组件独立验证通过——daemon 手动验证（Case 014）、MCP Server 本地通过、webhook 推送代码完整、编排模块 LangGraph createReactAgent compose 通过。**v1.3.2 补全**——Onboard L2-L5 的循环引擎天然跑全链路（编排→审计→定位→修复→再跑），作为验收标准补 smoke test。当前边界：daemon → MCP → webhook → 编排四组件串联行为依赖发版前手动验证（acceptance-test 步骤 2.3），不在日常 CI 集成测试内（见下节「端到端验收测试覆盖」）。

---

### 端到端验收测试覆盖

v1.0 新增 `FORGE/playbook/acceptance-test.sh`（场景数持续扩展，当前 303 个，SSOT 见脚本头部声明）：

- **CI 已覆盖**：单元测试审计核心 978 个、全 workspace 3753 个测试（v1.4.1 批次 2937→3178 +241，v1.4.2 批 +171，v1.4.3 批 +138（audit +12 / orchestrator +126）：bugfix 批 +24（audit 878→902）+ dev 批 +147（orchestrator 1295→1442）+ 安全回归批 +34（engineer 路径守卫，orchestrator 1573→1607，总数 3507→3541）+ L4 修复器路径守卫批 +41（orchestrator 1607→1648，总数 3541→3582）+ v1.4.4 审查批 #73 占位重写 +12（总数 3582→3594）+ v1.4.3 阶段五 run-02 闭环批一 P0-3 +6（core 374→380，总数 3594→3600）+ 审查修复批 +11（core 380→382 + audit 919→928，总数 3600→3611）+ 出站防护与原子写契约批 +8（daemon 287→294 + eval 32→33，总数 3611→3619）+ 同批删除 loop-audit-history.test.ts −6（orchestrator 1648→1642，总数 3619 持平）+ v1.4.4 审查修复批 +15（audit 929→936 / core 382→388 / daemon 294→296，总数 3620→3635）+ v1.4.4 开发批 +109（audit 936→976 / core 388→393 / orchestrator 1642→1697 / daemon 296→302 / mcp 154→157，总数 3635→3744））；全绿，详见上方「测试覆盖范围」节，实测见 `tools/check/test-count.sh`，与 pre-push-check 一致）、sofagent-core verify 约 44-48 项（动态）
- **发版前手动覆盖**：acceptance-test.sh 304 场景（含子断言，CLI 端到端，步骤 2.3；v1.4.2 阶段三 S333-S339 七场景增量 265→272 + 存量清零 S340 272→273 + 章六补测 S341 273→274 + 章五零覆盖补测 S342/S343 274→276 + 阶段十二回写 S344 276→277 + v1.4.3 bugfix F-03 行为锁 S345 277→278 + v1.4.3 阶段三 S346-S348 三场景增量 278→281：审计聚合 CLI 行为实测/反作弊基线三防线锚点/训练监控三 tools 注册面 + 阶段五 coverage 补测 S349-S351 三场景增量 281→284：训练沙箱三约束行为实测/训练需求推导行为实测/后训练 workflow 模板解析 + v1.4.3 阶段五 run-02 闭环 S352-S355 四场景增量 284→288：DSH 执行深化三步锚点/train_diagnose 行为实测/入口导览与 onboarding 断层走查/存量清扫零残留 + run-04 coverage 闭环 S356 288→289：doctor Ontology 完整性检查锚点，补十三章零覆盖 P0-1 + run-05 coverage 闭环 S357-S358 两场景增量 289→291：审计聚合触发率数值实测/train_status 行为实测，S347 同批补四形态映射锁 + 闸门 run-05 P1 批 S359 291→292：过时承诺排期化/悬空引用补锚点/三态退出码防复发 + 闸门 run-06 误报批 S360 292→293：规则数 24 双口径锚点/维度 9 探针 A+E 全口径/PASS 场景级断言输出/S165 标题去 158 残留 + v1.4.3 阶段十二回写 S361 293→294：lock 零本地部署树路径防复发锚点 + v1.4.4 闸门 run-01 判断层 P0-1 闭环 S362/S363/S365-S370 九场景增量 294→303：v1.4.4 十模块验收——补章九收编锚点 S371——语料导出 27 编号位/方法论三锚点+脱敏闭环/权重部署哈希红线/产物注册人审语义/对比训练 ROI 排序/因果链回溯+先例打分+HMAC 篡改判定/CI 供应链四锚点/章七十收口八锚点（原 S364 corpus_export 双入口对账真实归并入 S348——同版归并对销 1 处解锁 acceptance 警戒线同版上调，断言零删减）+ 闸门 run-06 coverage 闭环 S372 303→304：章十一阶段四 B 类行为锁补测批四测试文件在位锚 + 五代表断言锚）、OpenClaw 验收 63 场景（Agent 端到端，步骤 2.5）
- **CI 未覆盖**：daemon → MCP → webhook → 编排四组件串联行为（v1.3.2 起由 Onboard 循环引擎跑全链路 smoke test 承接，作为验收标准；日常 CI 无独立集成测试，发版前手动验证兜底）
- **CI 未覆盖**：多平台兼容性（macOS only verified，Linux/Windows 未验证）

未来版本计划将 acceptance-test.sh 纳入 CI 自动执行（当前为发版前手动）。

---

### acceptance-test 数字口径

> **acceptance-test 数字口径**："4 处 check-test-count 一致"指 4 个关键文件（CHANGELOG / 版本开发日志 / README / acceptance-test.sh）的测试数字声明一致——以 check-test-count 脚本实际校验的 4 处为准。

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

v1.0.9 新增的 A16（非授权文件变更）和 A17（异常批量变更）是**行为级**检测——只看文件路径、扩展名、变更数量，不解析文件内容。Excel 单元格、PDF 文字、数据库内容不在审计范围内。内容级审计（OCR / 内容解析）不在 v1.0.9 范围，是 AgentLoop 或未来版本的事。

A16 的 `evidenceMode: git-diff` 依赖 git diff 获取变更文件列表；daemon 模式下需 daemon 主动填充 `ctx.diffFiles`。A17 的跨审计聚合依赖 `ctx.history` 窗口数据，daemon 模式下若未传入历史数据则只能检测单次批量变更。

---


## 七、历史遗留与迁移说明

> 定时触发已解决（见「✅ 已解决的历史问题」区）；Windows 平台差异见 §二「🪟 Windows 支持是实验性的」。

### Ontology 合并准确性依赖 frontmatter 质量

Ontology 统一层的合并引擎从 `knowledge/entities/` 目录的 Markdown frontmatter 提取实体关联。如果 frontmatter 格式不规范（缺少 `---` 分隔符、YAML 语法错误、relations 字段拼写错误），该实体会被静默跳过——不会报错，但 Ontology 中会缺失这个对象。`--doctor` 目前不检查 Ontology 完整性，用户无法自动发现遗漏。

### Work模板市场 模板（✅ 已随 v1.1.9 迁出 MIT scope）

> ✅ 已于 v1.1.9 修复：Work模板市场 模板整体迁出 MIT scope，相关 CLI（`sofagent hub deploy`）与模板源已移至外部商业仓，不在开源仓库维护。

### Agent Dashboard（✅ v1.4.0 起产品化，旧「原型假数据」局限已消除）

> ✅ **已于 v1.4.0 修复**：Dashboard HTML 产品化——`dashboard.html` + `serve-dashboard.mjs` 随 install.sh 安装到 `$SOFAGENT_HOME/web/`，`sofagent web` 一键起服务，读用户机 `~/.sofagent/data/` **真实数据**（FDE workflow / 已注册 SubAgent / sustain 周报 / 审计报告），开发态/安装态双路径解析。早期版本「目录为空时展示 2 个虚拟 Agent 假数据」的行为已移除（全仓无残留）。
>
> **仍存在的边界**（诚实披露）：① Dashboard 是**时间点快照**而非实时监控（无 WebSocket 推送，刷新即重读）；② daemon-health.json 的异常检测仍是关键词匹配（"error"/"异常"/"失败"），非结构化状态报告；③ 治理 KPI 面板（安全边界触发率/审计覆盖率等）排 v1.5.0。

---

## 八、包依赖与编排局限

### audit ↔ daemon 循环依赖（v1.2.3 已解决）

> **状态：已解决**。历史上 `@sofagent/audit` 的 `optionalDependencies` 曾包含 `@sofagent/daemon`（snapshot helpers），形成逻辑循环依赖。

**v1.2.3 修复**：snapshot helpers（`restoreSnapshot` / `listAllSnapshots`）从 `@sofagent/daemon` 迁移到 `@sofagent/core`，`audit` 包的 `package.json` 不再含任何 `daemon` 引用（含 `optionalDependencies`），源码中仅保留 `types/daemon.d.ts` 类型 shim（无 runtime import）。依赖图恢复为单向：`daemon → audit → core`，符合四层单向依赖原则。

**验证**：`grep -rn "@sofagent/daemon" engine/audit/package.json` 无命中；`grep -rn "from '@sofagent/daemon'" engine/audit/src/` 无命中（仅 `declare module` 类型声明）。

**历史记录**：此局限在 v1.1.3 引入（audit 需调用 daemon 的 snapshot 能力），v1.2.0 物理重构时已规划迁移，v1.2.3 随编排隔离底座一并完成。

### daemon 通知机制为轻量版

v1.1.3 新增 `daemon/src/notify.ts` 提供 `[sofagent-daemon]` 品牌包装的统一通知接口。**本地三态推送（PASS/WARN/FAIL）v1.1.6 已接通**（`webhook.ts` + `push-target.ts`，agent 自测可用）。但**企业平台完整推送（飞书/钉钉/企微）已在 v1.2.1 落地**——当前 daemon 的 cron 巡检和文件监听结果在企业场景仍依赖 stdout + `daemon-health.json`，企业 IT 需自行轮询 `history.jsonl` 或使用 v1.2.1 Webhook 推送。

## 九、v1.1.7-v1.1.9 新功能局限

### Dream Cycle 知识质量依赖 LLM

Dream Cycle 6 阶段管道从 think.md / task logs 抽取知识（fact → atom → concept → cluster）。当前 MockLLM 产出的是占位符文本——格式正确但内容为零。接入 RealLLM 后，知识质量完全依赖模型能力，无法保证产出的 fact/atom/concept 是有意义的知识点而非「正确的废话」。冷启动阶段尤其明显——没有足够 task logs 时，Dream Cycle 提炼出的概念可能高度重复或过于泛化。

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

FDE 诊断完成后，交付了一堆**静态文件**（ontology 本体数据 + workflow.yml + skills/ + nodes/），但没人把它们"点燃"——企业 IT 拿到一堆 .md 和 .yml，不知道怎么跑起来。

这是 FDE 四阶段十二步流程中的**交付到运行之间的断裂带**：

```
FDE §7 交付（静态文件就绪）
  ↓
  🔴 大断裂带：交付物躺在磁盘上
  ↓
理想终态：企业业务流自动运行（v1.2.5+ 激活链解决）
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

> 详见 [激活链设计文档](./guides/fde-activation-chain.md)。

### 当前状态

- **v1.2.5 前**：大断裂带存在，FDE 交付物需人工解读
- **v1.2.5 后**：ACTIVATE 已交付，activate 命令可注册企业 Agent
- **v1.2.8 后**：ORCHESTRATE + EXECUTE 前半已交付，企业 Agent 可编排 + 运行 + 每步审计
- **v1.3.0（已交付）**：全链路打通（SUSTAIN），企业业务流自运转
