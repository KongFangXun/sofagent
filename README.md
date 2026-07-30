# sofagent

> 🌐 [English →](README.en.md) | 🇨🇳 中文

<p align="center">
  <a href="https://sofagent.ai">
    <img src="docs/assets/sofagent.png" alt="sofagent" width="200" />
  </a>
</p>

<p align="center">
  <strong>进场梳理 · 部署 AI 节点 · 离场后控制层常驻</strong><br/>
  <em>让中小企业拥有把 AI 变成日常工作的能力。</em>
</p>

> **sofagent 是一个 AI Agent 行为审计引擎**——它像 git hook 一样工作，
> 在每次 AI 生成的 commit 进入仓库之前检查 Agent 是否越界、泄漏密钥或盲目修改。
> 附带 FDE 方法论（企业 AI 治理咨询）和 FORGE（自迭代编排工具）两个独立产品。
>
> **FDE Agent** = 进场梳理工作流 → 在 AI 开发节点上部署审计引擎 → 离场后治理规则持续生效。

<p align="center">
  <a href="https://github.com/KongFangXun/sofagent/actions/workflows/verify.yml"><img src="https://github.com/KongFangXun/sofagent/actions/workflows/verify.yml/badge.svg" alt="Verify" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-brightgreen" alt="License: MIT" /></a>
  <a href="./CHANGELOG.md"><img src="https://img.shields.io/badge/Version-v1.2.3-16B8F3" alt="Version" /></a>
  <a href="#装上就能用"><img src="https://img.shields.io/badge/Node.js-%3E%3D18-16B8F3" alt="Node" /></a>
</p>

<p align="center"><strong>当前版本：v1.2.3</strong> · 2026-07-30 · Dashboard 产品化 + 编排隔离底座 + Fresh-Eyes 流程化</p>

<p align="center">
  <a href="#这是什么">这是什么</a> · <a href="#sofagent-能帮你做什么">能帮你做什么</a> · <a href="#三种部署方式覆盖所有场景">部署方式</a> · <a href="#装上就能用">安装</a> · <a href="#延伸阅读">文档</a>
</p>

---

## ⚡ 30 秒快速开始

> **前提**：请在 git 仓库根目录下执行以下命令。如果还没有仓库，先运行 `git init`。

```bash
bash install.sh          # 安装
# 自动检测你的 shell 配置文件
if [ -n "$ZSH_VERSION" ]; then
  source ~/.zshrc
elif [ -n "$BASH_VERSION" ]; then
  source ~/.bashrc
fi
> 💡 如果 `sofagent-audit` 仍然提示 command not found，请**新开一个终端窗口**再试。
# 或者直接重新打开终端
sofagent-audit --init    # 初始化（装 git hook）
# 验证环境是否就绪（可选但推荐）
sofagent-audit --doctor
```

> 💡 **不需要装引擎？** 如果你只需要 FDE 方法论（给 Agent 装治理 Skill），
> 直接看 [FDE/README.md](./FDE/README.md)——零依赖，不需要 Node.js。

> 💡 **下一步**：安装完成后，运行 `sofagent-audit --doctor` 检查环境状态，或查看 [项目导航索引（WIKI）→](./docs/WIKI.md)

---

## 这是什么

企业不缺大模型与 Agent——缺的是把 AI 变成日常工作的能力。

**sofagent 做的就是这件事。** 它是一个 FDE Agent——进场梳理你的工作流，把能自动化的环节变成 AI 节点，部署到设备上，然后离场。离场后，模型能力内化不了的控制层持续在跑——审计链、防篡改、合规留痕——你留下的是一套能持续维护的 AI 化资产。完整类比见 [ARCHITECTURE](./docs/ARCHITECTURE.md)。

### 为什么不是现有工具

| 工具 | 它们管什么 | sofagent 管什么 |
|------|:--------|:----------------|
| pre-commit / husky | 代码质量（lint / format）| **Agent 行为**（密钥泄漏 / 越界编辑 / 注入攻击 / 盲改）|
| detect-secrets / gitleaks | 密钥扫描 ✅ 全量历史扫描 + pre-commit 模式 + 100+ 内置秘钥模式 | 密钥扫描是 gitleaks 的核心场景（✅ 全量历史扫描、✅ pre-commit hook 模式、✅ 100+ 种内置秘钥模式）；sofagent A2 覆盖常见 API key 模式（⚠️ 仅增量扫描，差异化价值在于 **Agent 行为审计**而非密钥扫描覆盖率），同时增加 21 条 Agent 行为规则 |
| Cursor Rules / Claude hooks | 单平台 IDE 约束 | 审计层全平台可用（git diff）；约束层按平台分层（OpenClaw 最深 → WorkBuddy SKILL → 其他种子指令） |
| Agent 平台（OpenClaw 等）| Agent 调度——「会不会做」| Agent 治理——「能不能每次都做对」|

现有工具查"代码写得对不对"；sofagent 查"Agent 行为对不对"。这些是 LLM Agent 特有的失败模式，通用工具不覆盖。

### 两个入口

| 如果你… | 走这里 |
|---------|--------|
| 是开发者，想给团队装审计引擎 | → 继续往下看，30 秒快速开始 |
| 是企业用户，想用 FDE 方法论管 Agent | → [FDE Agent 入口](./FDE/README.md)（零代码、零依赖） |

<details>
<summary>📦 FDE 离场后，企业留下五样东西</summary>

前四样是资产，第五样是让前四样一直活着的 FDE Agent 本身——sofagent 留在客户那里继续跑：

| 交付物 | 说明 |
|--------|------|
| 交付手册 | 企业 IT 可独立维护的操作手册 |
| AI 节点 | 在跑的 Agent，自动执行日常任务（财务对账、审计巡检、数据分析…）|
| AI 知识库 | 持续积累的实体、概念、对比页（Dream Cycle 自动沉淀）|
| 私有化评估体系 | eval 反馈 + Skill 迭代历史——无法复制的企业 IP |
| **FDE Agent 本身** | 控制层常驻——管审计 / 约束 / 知识的生命周期，人离场了它留下 |

</details>

---

## sofagent 能帮你做什么

**想让 AI 自动跑日常任务？**
进场梳理工作流，把能自动化的环节变成 AI 节点，部署完自己跑。

**Agent 越界了怎么办？**
21 条规则（13 默认 + 8 扩展）自动审计每次变更——越界编辑、密钥泄漏、注入攻击，commit 时自动拦截。
> **21 条规则（13 条默认规则 + 8 条扩展规则）**，覆盖敏感文件、密钥泄漏、注入攻击、越界修改等场景。
> `git commit --no-verify` 可绕过 hook，是已知架构限制。企业场景建议配合 CI 侧 `sofagent-audit --diff` 兜底，详见 [LIMITATIONS](./LIMITATIONS.md)。13 条默认规则装上就生效，8 条扩展规则按需开启，详见下方规则表。

**出了事能回滚吗？**
每次变更自动 git snapshot，一键回到任意安全状态。

**换了 Agent / 模型怎么办？**
审计引擎全平台可用（只看 git diff）；约束层按平台分层（OpenClaw 最深，其他平台核心约束可用）。

**越用越好吗？**
经验自动沉淀，FDE Agent 周度巡检持续优化规则与知识。

> [!TIP]
> **90/10 价值分层**：模型给 90% 的智力，sofagent 补 10% 的可靠执行——越往后这 10% 越值钱。不是造更聪明的模型，是给已有的聪明加一套闸门。

---

## 🆕 v1.2.3 新特性

### 终端 Dashboard：一眼看清 AI 在干什么

```bash
sofagent-dashboard           # 看当前状态
sofagent-dashboard --watch   # 实时刷新（看护审查时用）
```

打开后你会看到三个核心面板：

- **数据去哪了**（数据主权）——你的敏感数据有没有偷偷发给云端？
- **AI 犯规了吗**（规则审计）——AI 有没有越权改文件、存数据？
- **任务跑到哪了**（工作状态）——后台 daemon 和 sub-agent 是活的还是挂了？

需要看更多？加 `--full` 展开完整视图：

```bash
sofagent-dashboard --full    # 追加：编排控制图 + FORGE 审查进度 + 最近文件变更
```

> 前置依赖：需要 `jq`（`brew install jq` / `apt install jq`）

<details>
<summary>找不到 sofagent-dashboard 命令？</summary>

`bash install.sh` 安装时会自动配置 PATH。如果找不到命令：

```bash
# 方式 1：手动加入 PATH
mkdir -p ~/.sofagent/bin
ln -sf /你的sofagent路径/tools/sofagent-dashboard.sh ~/.sofagent/bin/sofagent-dashboard
echo 'export PATH="$HOME/.sofagent/bin:$PATH"' >> ~/.zshrc   # macOS
echo 'export PATH="$HOME/.sofagent/bin:$PATH"' >> ~/.bashrc  # Linux
source ~/.zshrc  # 或 source ~/.bashrc

# 方式 2：直接跑源码（无需任何配置）
bash tools/sofagent-dashboard.sh
```

</details>

### 数据主权审计：你的数据安全不安全，看得见

每次 LLM 调用和工具调用都记录 4 维审计日志：云端调了什么模型、本地执行了什么操作、数据流向哪里、任务是什么。daemon 每天/周/月自动生成 Markdown 审计报告，存在 `{企业名}/审计报告/` 可见目录下。

### 混合模型路由：敏感数据不出内网

按数据敏感度 × 任务复杂度自动路由：restricted 数据走本地 7B 模型，confidential 走本地 0.5B——不出内网。通过 Ollama API 调用本地模型。

> 详细设计见 [ARCHITECTURE](./docs/ARCHITECTURE.md) · 完整开发日志见 [v1.2.3](./docs/changelog/v1.2/v1.2.3.md)

---

## 三种安装方式，适配所有场景

| 方式 | 谁用 | 怎么用 |
|------|------|--------|
| 🚀 **npx 零安装** | 快速体验 / CI 环境 | `npx @sofagent/audit --init`（即装即用，不需下载） |
| 💻 **install.sh 全量安装** | 技术人员 / 开发者 | `bash install.sh`（底座 + FDE Agent） |
| ⚡ **install.sh 最小安装** | 开发者 / 企业 IT | `bash install.sh --base-only`（仅底座引擎） |

---

## 装上就能用

装完后，你在自己的 Agent（WorkBuddy / Codex / Claude Code）里说一句话，sofagent 就开始干活。没有界面——语言就是界面。

```bash
# sofagent 一键部署（主安装器 = 底座 + FDE Agent）
bash install.sh
```

> [!NOTE]
> 需要 Node.js ≥ 18 + bash + git。macOS / Linux 全功能，Windows 实验性。Dashboard 依赖 jq（macOS 请 `brew install jq`，Linux 请 `apt install jq` / `yum install jq`）。

<details>
<summary>🚀 装完三步体验</summary>

> ⚠️ 需在 git 仓库中运行（`git init` 初始化一个）。

```bash
# 0. 初始化——装 git hook，让审计引擎能拦截 commit
sofagent-audit --init

# 1. 看规则——Agent 会带着这些红线干活
sofagent-audit --help | head -5

# 2. 跑审计——第 0 步的 --init 已装好 pre-commit hook，每次 commit 都被拦
# GIT_EDITOR=true 让 git commit 不弹编辑器（CI/自动化场景常用）
echo "API_KEY=sk-123456" > .env && git add -f .env && GIT_EDITOR=true git commit -m "add env config"
# → ⛔ A1 不碰敏感：.env 含密钥格式，提交被拦截（不会真的落库）

# 3. 看快照——每次审计后自动存档
sofagent-audit --timeline

# 演示完清理
git rm --cached -f .env 2>/dev/null; rm -f .env
```
</details>

> 💡 **单包测试需先 build**：monorepo 中各包通过 `dist/` 互相引用，跑单包 `npm test` 前需先 `npm run build --workspaces` 构建依赖包（全量 `npm test` 会自动处理）。

> ⚠️ **关于 commit 拦截**：`git commit --no-verify` 可以绕过本地 hook。sofagent 的设计初衷是"诚实 Agent 的护栏"而非"恶意攻击者的防线"。企业高安全场景建议在 CI/CD pipeline 侧再加一道 `sofagent-audit --diff` 审计（hook 可绕，CI 不可绕）。详见 [LIMITATIONS](./LIMITATIONS.md) §一·已知架构限制。

> **推荐**：新用户使用 `bash install.sh`（一键安装全套）。高级用户/CI 环境使用 `npm install -g @sofagent/audit`（仅安装审计引擎）。

**两种安装模式**：

| 模式 | 命令 | 装什么 |
|------|------|--------|
| 全量安装 | `bash install.sh` | 底座 + FDE Agent（所有人） |
| 仅底座 | `bash install.sh --base-only` | 仅底座引擎（开发者 / 企业 IT） |

**按需安装**：

| 包 | 用途 |
|------|------|
| `@sofagent/audit` | 审计引擎（21 条规则，git diff 硬证据）|
| `@sofagent/core` | 运行时诊断（doctor / verify）|
| `@sofagent/orchestrator` | 编排引擎（多 Agent 协作）|
| `@sofagent/daemon` | 守护进程（文件监控 / 定时巡检）|
| `@sofagent/mcp` | MCP Server（JSON-RPC 2.0）|

<details>
<summary>卸载</summary>

```bash
# install.sh 全局安装的是 @sofagent/audit（其余引擎通过 monorepo 本地引用）
npm uninstall -g @sofagent/audit 2>/dev/null || true
# 清理其他可能手动全局安装的 sofagent 包（通配，不依赖固定列表）
npm ls -g --depth=0 2>/dev/null | grep '@sofagent/' | awk '{print $2}' | xargs npm uninstall -g 2>/dev/null || true
rm -f .git/hooks/commit-msg .git/hooks/post-commit
```
</details>

⚠️ **数据存储说明**：sofagent 当前版本将审计数据以 Markdown 明文存储在 `~/.sofagent/data/`。内置加密（age）计划在 v1.3.0 引入。在生产环境使用前，建议：
- macOS：将 `~/.sofagent/` 放在 APFS 加密卷中
- Linux：使用 LUKS 加密分区挂载 `~/.sofagent/`
- 详见 [SECURITY.md](./SECURITY.md#已知风险明文存储)

---

### 运行测试

```bash
# 全量测试（所有 workspace + Dashboard）
npm test

# 仅核心引擎测试
npm test --workspace=engine/audit

# 预期：1207 tests passed（少量 safe-delete 相关测试可能在特定环境预期失败）
```

---

## 延伸阅读

| 你想了解 | 看哪里 |
|:---------|:--------|
| FDE Agent 进场四阶段、企业落地 | [FDE.md](./FDE/FDE.md) |
| 怎么装、怎么用、常见问题 | [HANDBOOK](./docs/HANDBOOK.md) |
| 引擎架构、21 条规则、内部机制 | [↓ 引擎架构（开发者段）](#engine-architecture) |
| 为什么这么设计 | [ARCHITECTURE](./docs/ARCHITECTURE.md) |
| 设计哲学 | [PHILOSOPHY](./docs/PHILOSOPHY.md) |
| 安全声明 | [SECURITY](./SECURITY.md) |
| 已知局限 | [LIMITATIONS](./LIMITATIONS.md) |
| 数据存储安全 | ⚠️ 当前版本审计数据以明文 Markdown 存储于 `~/.sofagent/data/`。生产环境部署前请务必阅读 [SECURITY.md](./SECURITY.md) 了解数据安全与加密路线图。 |
| 版本路线图 | [ROADMAP](./ROADMAP.md) |
| 项目导航索引（AI 用） | [WIKI](./docs/WIKI.md) |
| 贡献指南 | [CONTRIBUTING](./CONTRIBUTING.md) |

---

## <a id="engine-architecture"></a>引擎架构（开发者段）

> [!NOTE]
> **品牌与描述**：**sofagent** 是产品品牌名；**FDE Agent** 是对它核心形态的描述——sofagent 本质上是一款 FDE Agent（进场梳理工作流、把可自动化环节变成 AI 节点、构建本体、部署专属小模型的常驻硅基员工）。底层技术实现是一套约束 Agent 行为的 Harness 中间件（一底座·四引擎），开源在 `@sofagent/*`。下面这段是给开发者看的。

sofagent 底层引擎是一套约束 Agent 行为的 Harness 中间件，一底座·四引擎覆盖全生命周期。一底座 = 约束底座（开工前注入规则）；四引擎 = 审计引擎（21 条规则拦截）+ 回溯引擎（自动快照回滚）+ 编排引擎（多 Agent 协作）+ 进化引擎（周度自优化）。

<details>
<summary>📖 一底座·四引擎架构（开发者参考）</summary>

```mermaid
flowchart LR
    CB[🧭 约束底座<br/>开工前注入红线] --> OR[⚙️ 编排引擎<br/>多 Agent 协作·任务拆解]
    OR --> AU[🔍 审计引擎<br/>每次变更硬证据审查]
    AU --> RE[🔄 回溯引擎<br/>git snapshot·一键回滚]
    RE --> EV[🧬 进化引擎<br/>周度巡检·越用越好]
    EV -.-> CB
```

> 下表 5 项 = 1 底座 + 4 引擎。

| 组件 | 作用 | 状态 |
|:------|:--------|:--:|
| 🧭 约束底座 | 开工前规则注入 Agent 上下文（SKILL.md + fde.md + think.md + knowledge/）| ✅ 稳定 |
| ⚙️ 编排引擎 | 多 Agent 协作 + 任务拆解 | 🔶 部分 |
| 🔍 审计引擎 | 21 条规则，每次 git commit / 文件变更触发，违规拦截+记录。**审计引擎核心规则零 token**（16 条纯 git-diff 规则不调用 LLM + 1 条文件系统监控，4 条混合规则需 Agent 日志）——不调用 LLM（0 token），不消耗任何 LLM 额度 | ✅ 稳定 |
| 🔄 回溯引擎 | 每次审计后自动 git snapshot，违规一键回滚 | ✅ 稳定 |
| 🧬 进化引擎 | FDE 周度巡检审计趋势 + 反思日志 | ⚠️ 实验性 |

</details>

<details>
<summary>📖 引擎细节 + 21 条规则</summary>

### 🧭 约束底座

四层加载链：SKILL.md（宪法·不可改）→ fde.md（规范·可改）→ think.md（反思·自动生成）→ knowledge/（知识·自动积累）。v1.0.7+ SubAgent 启动时自加载（`buildConstrainedSystemPrompt`），不依赖任何 Agent 平台的 Skill 系统。

### ⚙️ 编排引擎

两层已实现：① **任务拆解**——LangGraph createReactAgent 把任务描述变成编排方案 YAML；② **多 Agent 协作**——支持多 SubAgent 串行编排，每节点有 checkpoint 支持中断恢复。

> 🔶 当前是**串行**状态机（非并行 DAG 调度）。完整 DAG 并行调度 + 沙箱执行规划在 [ROADMAP v1.3.1](./ROADMAP.md)。

### 🔍 审计引擎

21 条规则中 16 条纯 git-diff（不依赖 Agent 配合），4 条混合（A7/A8/A14/A15 需 Agent 日志），1 条文件系统（A17 异常批量变更）。v1.0.8+ 内嵌 isomorphic-git + daemon 文件监控，**不需要 git commit 也能审计**。自 v1.1.8 起加入 Prompt 注入防护（A9 扩展）+ 联邦查询加密，审计能力从本地扩展到跨设备。

**默认规则（13 条，装上就生效）**：

| 类别 | 规则 | 拦截什么 |
|------|------|--------|
| 🔴 密钥安全 | A1 敏感文件 · A2 密钥泄漏 | `.env` / `*.pem` 提交，硬编码 API Key |
| 🟡 行为边界 | A3 越界编辑 · A4 删配置 | 改任务范围外的文件，删配置 |
| 🟠 注入防御 | A9 注入 · A10 恶意来源 | 命令注入模式，非官方来源依赖 |
| 🔵 流程合规 | A5 空消息 · A7 盲改 · A8 跳测试 · A19 消息质量 | 空 commit msg，不读就改，跳测试，低质量 msg |
| ⚪ 工程质量 | A6 破构建 · A11 资源滥用 · A18 垃圾文件 | 构建配置异常，超大文件，临时文件提交 |

**扩展规则（8 条，按需开启）**：A14 知识库跨域 · A15 盲动 · A16 非授权变更 · A17 异常批量（文件系统监控）· E1-E4（测试文件 / 未声明 TODO / 批量删除 / 低注释率）。完整 21 条规则表（含严重度、分级、判定逻辑）见 [engine/audit/README.md · 审计规则](./engine/audit/README.md#审计规则)。

### 🔄 回溯引擎

每次审计后自动 git snapshot（本质是对工作树的轻量快照，不是 git commit——不产生历史污染）。违规时推送通知 + 建议回滚。`sofagent-audit --revert <sha>` 一键回到任意快照。

### 🧬 进化引擎（实验性）

FDE 周度巡检：读审计趋势（history.jsonl）→ 分析 think.md 反复出错 → 生成优化报告 / 标记稳定。

</details>

---

## 贡献与致谢

欢迎提 Issue 和 PR，尤其较真的那种。[CONTRIBUTING.md](./CONTRIBUTING.md) · [致谢](./docs/THANKS.md)

---

<p align="center">
  <br/>
  <em>如果 sofagent 帮到你</em><br/><br/>
  <a href="https://github.com/KongFangXun/sofagent">⭐ Star · 让更多人看到</a>
</p>
