# sofagent

> 🌐 [English →](README.en.md) | 🇨🇳 中文

<p align="center">
  <a href="https://sofagent.ai">
    <img src="docs/assets/sofagent.png" alt="sofagent" width="200" />
  </a>
</p>

<p align="center">
  <strong>进场梳理 · 部署 AI 节点 · 离场后 7×24 自己跑</strong><br/>
  <em>让中小企业拥有把 AI 变成日常工作的能力。</em>
</p>

<p align="center">
  <a href="https://github.com/KongFangXun/sofagent/actions/workflows/verify.yml"><img src="https://github.com/KongFangXun/sofagent/actions/workflows/verify.yml/badge.svg" alt="Verify" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-brightgreen" alt="License: MIT" /></a>
  <a href="./CHANGELOG.md"><img src="https://img.shields.io/badge/Version-v1.2.1-16B8F3" alt="Version" /></a>
  <a href="#装上就能用"><img src="https://img.shields.io/badge/Node.js-%3E%3D18-16B8F3" alt="Node" /></a>
</p>

<p align="center"><strong>当前版本：v1.2.1</strong> · 2026-07-27 · 数据目录重构 + custom/ 闭环 + ToolGate 接入 + SubAgent 可见性 L2</p>

<p align="center">
  <a href="#这是什么">这是什么</a> · <a href="#sofagent-能帮你做什么">能帮你做什么</a> · <a href="#三种部署方式覆盖所有场景">部署方式</a> · <a href="#装上就能用">安装</a> · <a href="#延伸阅读">文档</a>
</p>

---

## 这是什么

企业不缺大模型与 Agent——缺的是把 AI 变成日常工作的能力。

**sofagent 做的就是这件事。** 它是一个 FDE Agent——进场梳理你的工作流，把能自动化的环节变成 AI 节点，部署到设备上，然后离场。离场后这些节点 7×24 自己跑，你留下的是一套能持续维护的 AI 化资产。

大厂造了江（LLM 是水），但企业不敢直接舀。sofagent 做的是堤坝 + 自来水厂 + 管网 + 水龙头——把原水变成直饮水。完整类比见 [ARCHITECTURE](./docs/ARCHITECTURE.md)。

### 为什么不是现有工具

| 工具 | 它们管什么 | sofagent 管什么 |
|------|:--------|:----------------|
| pre-commit / husky | 代码质量（lint / format）| **Agent 行为**（密钥泄漏 / 越界编辑 / 注入攻击 / 盲改）|
| detect-secrets / gitleaks | 密钥扫描 | 密钥只是 21 条规则中的一条 |
| Cursor Rules / Claude hooks | 单平台 IDE 约束 | 审计层全平台可用（git diff）；约束层按平台分层（OpenClaw 最深 → WorkBuddy SKILL → 其他种子指令） |
| Agent 平台（OpenClaw 等）| Agent 调度——「会不会做」| Agent 治理——「能不能每次都做对」|

现有工具查"代码写得对不对"；sofagent 查"Agent 行为对不对"。这些是 LLM Agent 特有的失败模式，通用工具不覆盖。

<details>
<summary>📦 FDE 离场后，企业留下五样东西</summary>

前四样是资产，第五样是让前四样一直活着的 FDE Agent 本身——sofagent 留在客户那里继续跑：

| 交付物 | 说明 |
|--------|------|
| 交付手册 | 企业 IT 可独立维护的操作手册 |
| AI 节点 | 在跑的 Agent，自动执行日常任务（财务对账、审计巡检、数据分析…）|
| AI 知识库 | 持续积累的实体、概念、对比页（Dream Cycle 自动沉淀）|
| 私有化评估体系 | eval 反馈 + Skill 迭代历史——无法复制的企业 IP |
| **FDE Agent 本身** | 7×24 在跑——管上面四样东西的生命周期，人离场了它留下 |

</details>

---

## sofagent 能帮你做什么

| 你想解决什么 | sofagent 怎么做 |
|------|------|
| **想让 AI 自动跑日常任务** | 进场梳理工作流，把能自动化的环节变成 AI 节点，部署完自己跑 |
| **Agent 越界了怎么办** | 21 条规则自动审计每次变更——越界编辑、密钥泄漏、注入攻击，commit 时自动拦截（注：`git commit --no-verify` 可绕过 hook，是已知架构限制。企业场景建议配合 CI 侧 `sofagent-audit --diff` 兜底，详见 [LIMITATIONS](./LIMITATIONS.md)） |
| **出了事能回滚吗** | 每次变更自动 git snapshot，一键回到任意安全状态 |
| **换了 Agent / 模型怎么办** | 审计引擎全平台可用（只看 git diff）；约束层按平台分层（OpenClaw 最深，其他平台核心约束可用） |
| **越用越好吗** | 经验自动沉淀，FDE Agent 周度巡检持续优化规则与知识 |

> [!TIP]
> **90/10 价值分层**：模型给 90% 的智力，sofagent 补 10% 的可靠执行——越往后这 10% 越值钱。不是造更聪明的模型，是给已有的聪明加一套闸门。

---

## 三种部署方式，覆盖所有场景

| 方式 | 谁用 | 怎么用 |
|------|------|--------|
| 💻 **装电脑** | 技术人员 / 开发者 | `bash install.sh` 正常安装 |
| 🔌 **U 盘** | 普通员工（SMB 核心场景）| 插上即用，拔掉零残留，不需要安装、不需要专业知识 |
| 🖥️ **无头设备** | 服务器 / 工控机（OPC 场景）| 插 U 盘别拔，Agent 7×24 在联邦里跑 |

> 💡 **USB 一键烧录**：搭好 workflow → 烧一批 U 盘 → 发给团队。企业叙事：「买 U 盘 → 下载 sofagent → 写盘 → 发给员工」。详见 [FDE/FDE.md](./FDE/FDE.md)。

---

## 装上就能用

装完后，你在自己的 Agent（WorkBuddy / Codex / Claude Code）里说一句话，sofagent 就开始干活。没有界面——语言就是界面。

```bash
# sofagent 一键部署（主安装器 = 底座 + FDE Agent）
bash install.sh
```

> [!NOTE]
> 需要 Node.js ≥ 18 + bash + git。macOS / Linux 全功能，Windows 实验性。

<details>
<summary>🚀 装完三步体验</summary>

> ⚠️ 需在 git 仓库中运行（`git init` 初始化一个）。

```bash
# 1. 看规则——Agent 会带着这些红线干活
sofagent-audit --help | head -5

# 2. 跑审计——--init 已装好 pre-commit hook，每次 commit 都被拦
# GIT_EDITOR=true 让 git commit 不弹编辑器（CI/自动化场景常用）
echo "API_KEY=sk-123456" > .env && git add -f .env && GIT_EDITOR=true git commit -m "test"
# → ⛔ A1 不碰敏感：.env 含密钥格式，提交被拦截（不会真的落库）

# 3. 看快照——每次审计后自动存档
sofagent-audit --timeline

# 演示完清理
git rm --cached -f .env 2>/dev/null; rm -f .env
```
</details>

> 💡 **单包测试需先 build**：monorepo 中各包通过 `dist/` 互相引用，跑单包 `npm test` 前需先 `npm run build --workspaces` 构建依赖包（全量 `npm test` 会自动处理）。

> ⚠️ **关于 commit 拦截**：`git commit --no-verify` 可以绕过本地 hook。sofagent 的设计初衷是"诚实 Agent 的护栏"而非"恶意攻击者的防线"。企业高安全场景建议在 CI/CD pipeline 侧再加一道 `sofagent-audit --diff` 审计（hook 可绕，CI 不可绕）。详见 [LIMITATIONS](./LIMITATIONS.md) §一·已知架构限制。

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

---

## 延伸阅读

| 你想了解 | 看哪里 |
|:---------|:--------|
| FDE Agent 进场四阶段、企业落地 | [FDE.md](./FDE/FDE.md) |
| 怎么装、怎么用、常见问题 | [HANDBOOK](./docs/HANDBOOK.md) |
| 引擎架构、21 条规则、内部机制 | [↓ 引擎架构（开发者段）](#引擎架构开发者段) |
| 为什么这么设计 | [ARCHITECTURE](./docs/ARCHITECTURE.md) |
| 设计哲学 | [PHILOSOPHY](./docs/PHILOSOPHY.md) |
| 安全声明 | [SECURITY](./SECURITY.md) |
| 已知局限 | [LIMITATIONS](./LIMITATIONS.md) |
| 版本路线图 | [ROADMAP](./ROADMAP.md) |
| LLM 对标映射 | [llm-wiki-mapping](./docs/llm-wiki-mapping.md) |
| 项目导航索引（AI 用） | [WIKI](./docs/WIKI.md) |
| 贡献指南 | [CONTRIBUTING](./CONTRIBUTING.md) |

---

## 引擎架构（开发者段）

> [!NOTE]
> **品牌与描述**：**sofagent** 是产品品牌名；**FDE Agent** 是对它核心形态的描述——sofagent 本质上是一款 FDE Agent（进场梳理工作流、把可自动化环节变成 AI 节点、构建本体、部署专属小模型的常驻硅基员工）。底层技术实现是一套约束 Agent 行为的 Harness 中间件（一底座·四引擎），开源在 `@sofagent/*`。下面这段是给开发者看的。

sofagent 底层引擎是一套约束 Agent 行为的 Harness 中间件，一底座·四引擎覆盖全生命周期。

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
| 🔍 审计引擎 | 21 条规则，每次 git commit / 文件变更触发，违规拦截+记录。**审计引擎零 token**（纯 git-diff 规则零 token，4 条混合规则需 Agent 日志）——不调用 LLM（0 token），不消耗任何 LLM 额度 | ✅ 稳定 |
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
