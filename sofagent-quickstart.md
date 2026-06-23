# sofagent Quickstart

> 面向第一次接触 sofagent 的用户：10 分钟安装、验证并跑通第一个任务。
>
> 本文基于 `KongFangXun/sofagent` 仓库当前内容整理。仓库 README 标注版本为 v0.83（2026-06-22），安装脚本中已包含部分 v0.84 的可选 daemon 参数；本文以当前脚本可见行为为准。

## 1. sofagent 是什么

sofagent 是给 AI Agent 使用的治理层，不是新的模型框架。它通过 Markdown Skill、bash 脚本、平台 Hook 和任务记录，让 Agent 在处理任务时更守规矩：

- 先加载 4 条底线和 10 则铁律，减少乱改、跳过验证、编造结果等问题。
- 遇到复杂任务时先判断复杂度，再决定是否拆解和编排。
- 任务结束后沉淀反思，下一次少踩同样的坑。
- 在 OpenClaw 上能力最完整；在 WorkBuddy、Codex、Claude Code、Hermes Agent 上主要依赖 Agent 自觉读取约束。

一句话：sofagent 不是让 Agent 更聪明，而是让 Agent 更有纪律。

## 2. 适用场景

建议使用 sofagent 的情况：

- 复杂多步任务，例如代码审查、重构、文档整理、数据分析。
- Agent 经常跑偏、过度发挥、跳过测试或忽略用户限制。
- 需要长期积累任务经验和失败教训。
- 想在团队内统一 Agent 的行为规范。

不太需要 sofagent 的情况：

- 简单闲聊。
- 单步查询或一次性命令。
- 纯信息检索。
- 不希望在上下文中常驻额外约束内容。

## 3. 前置依赖

基础依赖：

| 依赖 | 推荐版本 | 用途 | 检查命令 |
|---|---:|---|---|
| bash | 4+ | 运行安装、验证、任务记录脚本 | `bash --version` |
| git | 任意 | 拉取仓库 | `git --version` |
| node | 18+ | OpenClaw 编排引擎依赖 | `node --version` |
| npm | 9+ | 安装 `agency-orchestrator` | `npm --version` |

说明：

- 只使用基础约束层时，`node` 和 `npm` 不是必需项。
- OpenClaw 用户如需自动拆解复杂任务，建议安装 `node` 和 `npm`。
- 编排引擎依赖第三方 npm 包 `agency-orchestrator`。如果安装失败，底线和铁律仍然可用，只是自动编排能力会降级。

## 4. 选择你的平台

| 平台 | 推荐安装方式 | 自动化程度 | 主要能力 |
|---|---|---|---|
| OpenClaw | `install.sh` 自动安装 | 高 | 三层加载链、Hook、脚本、断路器、编排引擎 |
| WorkBuddy | 技能市场或 `install.sh --platform workbuddy` | 中 | Skill 加载，部分脚本受沙箱限制 |
| Codex | `install.sh --platform codex` | 低 | 种子指令 + 基础约束 |
| Claude Code | `install.sh --platform claude` | 低 | 种子指令 + 基础约束 |
| Hermes Agent | `install.sh --platform hermes` | 低 | 种子指令 + 基础约束 |

OpenClaw 是 sofagent 的优先平台，完整能力主要在 OpenClaw 上生效。其他平台可以使用约束层，但 Hook、断路器、编排等能力通常无法硬性保证。

## 5. 安装

### 5.1 推荐方式：git clone 安装

```bash
git clone https://github.com/KongFangXun/sofagent.git
cd sofagent
bash sofagent/scripts/install.sh --platform openclaw
```

把 `openclaw` 换成你的平台：

```bash
bash sofagent/scripts/install.sh --platform workbuddy
bash sofagent/scripts/install.sh --platform codex
bash sofagent/scripts/install.sh --platform claude
bash sofagent/scripts/install.sh --platform hermes
```

如果不传 `--platform`，脚本会按本机目录自动探测：

```bash
bash sofagent/scripts/install.sh
```

### 5.2 指定项目目录

sofagent 会在项目目录下创建 `.sofagent/` 数据目录，用来保存反思、任务日志和编排配置。建议明确指定你的项目路径：

```bash
bash sofagent/scripts/install.sh --platform openclaw --project-dir ~/my-project
```

如果不传 `--project-dir`，`.sofagent/` 会创建在当前目录。

### 5.3 企业或受限环境安装

如果不希望安装 `agency-orchestrator`：

```bash
bash sofagent/scripts/install.sh --platform openclaw --no-ao
```

如果不希望自动修改 OpenClaw 配置：

```bash
bash sofagent/scripts/install.sh --platform openclaw --no-config-inject
```

如果不希望安装可选 daemon：

```bash
bash sofagent/scripts/install.sh --platform openclaw --no-daemon
```

这些选项不会影响基础约束层，但会减少自动化能力。

## 6. 安装后会生成什么

OpenClaw 典型安装结果：

```text
~/.openclaw/
├── skills/sofagent/
│   ├── SKILL.md
│   ├── engine.md
│   ├── entry-gate.md
│   ├── task-aware.md
│   ├── task-closure.md
│   ├── loop-check.md
│   ├── rules.md
│   └── data/
├── hooks/sofagent-load-chain/
│   ├── HOOK.md
│   └── handler.ts
└── scripts/
    ├── task-record.sh
    ├── task-orchestrate.sh
    ├── cleanup.sh
    ├── audit.sh
    └── compress-memory.sh
```

项目目录下会生成 `.sofagent/` 数据目录。部分文件会在首次使用或任务闭环后出现：

```text
.sofagent/
├── think.md          # 首次任务闭环后可能创建
├── task/logs/
└── orchestrator/
```

其中：

- `SKILL.md` 是入口，内联 4 条底线和 10 则铁律。
- `rules.md` 是你的自定义规则，优先级最高。
- `.sofagent/think.md` 是反思区。
- `.sofagent/task/logs/` 是任务执行记录。
- `.sofagent/orchestrator/` 是复杂任务编排相关数据。

## 7. 验证安装

安装后运行：

```bash
bash sofagent/scripts/verify.sh
```

快速验证：

```bash
bash sofagent/scripts/verify.sh --quick
```

输出 JSON，便于 CI 集成：

```bash
bash sofagent/scripts/verify.sh --json
```

指定平台验证：

```bash
bash sofagent/scripts/verify.sh --platform codex
```

预期结果：

- OpenClaw：大部分检查应通过；如果 `ao`、daemon 或日志不存在，可能出现警告。
- WorkBuddy：主要检查 Skill 和数据目录。
- Codex、Claude Code、Hermes Agent：重点确认种子指令、`rules.md`、`.sofagent/` 是否可用。

警告不一定代表安装失败。比如首次使用前没有 `think.md` 或任务日志，属于正常情况。

## 8. 配置 API Key（仅编排引擎需要）

如果使用 OpenClaw 的自动编排能力，并且已安装 `ao`，需要配置一个模型 API Key。三选一即可：

```bash
export DEEPSEEK_API_KEY=你的DeepSeek密钥
export ANTHROPIC_API_KEY=你的Claude密钥
export OPENAI_API_KEY=你的OpenAI密钥
```

写入 shell 配置后长期生效，例如 zsh：

```bash
echo 'export DEEPSEEK_API_KEY=你的DeepSeek密钥' >> ~/.zshrc
source ~/.zshrc
```

未配置 API Key 时，sofagent 的约束层仍然可用，复杂任务编排会降级。

## 9. 手动平台的种子指令

Codex、Claude Code、Hermes Agent 主要靠种子指令触发加载链。安装脚本会尝试写入对应文件：

| 平台 | 种子文件 |
|---|---|
| Codex | `~/.codex/AGENTS.md` |
| Claude Code | `~/.claude/CLAUDE.md` |
| Hermes Agent | `~/.hermes/SOUL.md` |

如果需要手动补充，可以写入：

```markdown
每次对话开始时，读取以下文件并执行 sofagent 入口流程：
1. rules.md：对应平台目录下的 rules.md（宪法已在 SKILL.md 内联）
2. 如果工作目录含 .sofagent/ 数据文件，加载记忆和反思
如果数据文件（.sofagent/）不存在，先创建空模板。
```

验证方式：开启一轮新对话，输入：

```text
sofagent
```

然后让 Agent 说明它是否已读取 `rules.md` 和 `.sofagent/think.md`。

## 10. 跑第一个任务

建议用一个多步但风险不高的任务测试：

```text
帮我分析这个项目的代码质量，并输出一份改进建议报告。
```

如果你使用 Claude Code，也可以用：

```text
/goal 帮我分析这个项目的代码质量，并输出一份改进建议报告。
```

如果你使用 WorkBuddy，建议显式触发：

```text
@skill:sofagent 帮我分析这个项目的代码质量，并输出一份改进建议报告。
```

正常流程大致是：

1. Agent 读取 sofagent 加载链。
2. 判断任务复杂度。
3. 简单任务直接执行，复杂任务询问是否拆解。
4. 执行过程中做验证。
5. 任务结束后写入日志和反思。

执行后查看数据：

```bash
ls .sofagent/task/logs/
cat .sofagent/think.md
```

## 11. 自定义你的规则

编辑 `rules.md` 可以覆盖默认行为。建议保持短小，越具体越好。

OpenClaw 权威路径通常是：

```bash
~/.openclaw/skills/sofagent/rules.md
```

Codex、Claude Code、Hermes Agent 通常是：

```bash
~/.codex/rules.md
~/.claude/rules.md
~/.hermes/rules.md
```

示例：

```markdown
# 我的 sofagent 规则

- 默认用中文回复。
- 修改代码前先搜索现有实现。
- 不要主动引入新依赖，除非说明理由并得到确认。
- 每次代码修改后尽量运行最小可行验证。
- 不确定需求时先问，不要猜。
```

建议：

- 规则控制在 500 字以内。
- 只写真正重要的偏好。
- 不要把临时任务要求写进长期规则。

## 12. 常见问题

### 12.1 `verify.sh` 有警告，是否安装失败

不一定。常见警告包括：

- 首次使用前没有 `.sofagent/think.md`。
- 最近没有任务日志。
- daemon 未运行。
- `ao` 未安装或 API Key 未配置。

只要没有关键失败项，基础约束层通常可以使用。

### 12.2 Agent 没有遵守规则

排查顺序：

1. 确认平台是否支持自动加载。OpenClaw 最可靠，其他平台多靠种子指令。
2. 运行 `verify.sh` 确认 `SKILL.md`、`rules.md`、`.sofagent/` 是否存在。
3. 在任务开头显式写 `@skill:sofagent` 或“请先加载 sofagent”。
4. 把最关键规则写进 `rules.md`，并保持简短。

### 12.3 OpenClaw 的 Hook 没生效

检查：

```bash
ls ~/.openclaw/hooks/sofagent-load-chain/
grep -n "sofagent-load-chain" ~/.openclaw/openclaw.json
```

如果未注册，可重新运行：

```bash
bash sofagent/scripts/install.sh --platform openclaw
```

或按安装脚本输出手动添加 hook 配置。

### 12.4 `ao` 不可用

检查：

```bash
ao --version
ao compose --version
```

如果不存在：

```bash
npm install -g agency-orchestrator@0.7.5
```

如果全局安装无权限，建议使用 nvm、调整 npm prefix，或安装时加 `--no-ao` 只使用约束层。

### 12.5 反思区写错了怎么办

直接编辑：

```bash
vim .sofagent/think.md
```

删掉错误记忆即可。必要时对照：

```bash
ls .sofagent/task/logs/
```

### 12.6 不想启用 daemon

daemon 是可选功能，用于后台监控 `think.md`、`rules.md` 变化。不启用也不影响基础约束。

安装时跳过：

```bash
bash sofagent/scripts/install.sh --no-daemon
```

已安装后可查看状态：

```bash
bash sofagent/scripts/daemon-status.sh
```

## 13. 卸载

在仓库目录执行：

```bash
bash sofagent/scripts/uninstall.sh
```

如果安装过 daemon：

```bash
bash sofagent/scripts/daemon-uninstall.sh
```

卸载前建议先备份项目内的 `.sofagent/`，里面可能有任务记录和反思：

```bash
cp -R .sofagent .sofagent.backup
```

## 14. 一页速查

```bash
# 拉取
git clone https://github.com/KongFangXun/sofagent.git
cd sofagent

# 安装 OpenClaw
bash sofagent/scripts/install.sh --platform openclaw --project-dir ~/my-project

# 安装 Codex
bash sofagent/scripts/install.sh --platform codex --project-dir ~/my-project

# 验证
bash sofagent/scripts/verify.sh --quick
bash sofagent/scripts/verify.sh

# 可选：配置编排 API Key
export DEEPSEEK_API_KEY=你的DeepSeek密钥

# 测试任务
# 打开 Agent 客户端后输入：
# 帮我分析这个项目的代码质量，并输出一份改进建议报告。

# 看结果
ls .sofagent/task/logs/
cat .sofagent/think.md
```

## 15. 下一步

跑通 Quickstart 后，建议继续阅读：

- `HANDBOOK.md`：普通用户怎么安装、使用、调规则。
- `DEVELOPMENT.md`：Skill 协同、任务编排和反思闭环。
- `ARCHITECTURE.md`：为什么这么设计，以及已知局限。
- `LIMITATIONS.md`：平台限制、软约束边界、数据存储风险。

记住一个原则：sofagent 是治理层，不是保证层。它能显著提高 Agent 按规则工作的概率，但不能替代用户验证结果。
