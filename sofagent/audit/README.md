# @sofagent/audit

> v1.1.4 · 提交时审计 —— 扫描 git diff，检查 Agent 是否遵守工作纪律。
>
> **安装后运行：`sofagent-audit --init`**（一键初始化 config + hook + 冒烟测试）
>
> 最小运行时依赖（仅 js-yaml）。TypeScript 实现。Node.js 18+。

---

## 快速开始

```bash
# 方式一：全局安装
npm install -g @sofagent/audit

# 方式二：项目内安装
npm install --save-dev @sofagent/audit

# 方式三：一次性运行（不安装）
npx @sofagent/audit --diff HEAD~1..HEAD
```

安装后获得以下命令：

| 命令 | 说明 |
|------|------|
| `sofagent-audit` | 审计 CLI 主入口 |
| `sofagent-verify` | 安装后完整性验证（41 项检查） |
| `sofagent-orchestrate-compare` | 编排 A/B 对比 + promote + compose |
| `sofagent-env-check` | FDE 环境验证 |
| `verify-evidence` | 证据验证工具（别名：`sofagent-verify-evidence`） |
| `skill-safety-check` | Skill 文件安全检查（别名：`sofagent-skill-safety-check`） |

> 💡 `sofagent-mcp` 是独立包 `@sofagent/mcp` 的命令。`@sofagent/audit` 内置 MCP Server（通过 `sofagent-audit --mcp` 启动），无需单独安装 mcp 包。

---

## CLI 用法

### 基本审计

```bash
# 审计最近一次提交
sofagent-audit --diff HEAD~1..HEAD

# 带任务描述（用于 A3 越界检测）
sofagent-audit --diff HEAD~1..HEAD --task "修复登录页 bug"

# 审计整个 PR
sofagent-audit --diff origin/main..HEAD

# JSON 输出（适合 CI/CD）
sofagent-audit --diff HEAD~1..HEAD --json

# CI 模式（= strict + silent，适合无 Agent 日志的 CI 环境）
sofagent-audit --diff HEAD~1..HEAD --ci --json
```

### 全部参数

| 参数 | 说明 | 默认值 |
|------|------|------|
| `--diff <range>` | git diff 范围 | `HEAD~1..HEAD` |
| `--task <desc>` | 任务描述（A3 越界检测） | — |
| `--strict` | 严格模式：无日志时 A7 返回 FAIL 而非 WARN | off |
| `--silent` | 沉默模式：跳过日志依赖规则，走 diff 启发式 | off |
| `--ci` | CI 模式（= silent，紧凑输出） | off |
| `--json` | JSON 输出：`{ exitCode, rules }` | off |
| `--webhook <platform>` | 推送平台：`dingtalk` / `feishu` / `wecom` | — |
| `--webhook-url <url>` | Webhook URL（或用 `SOFAGENT_WEBHOOK_URL` 环境变量） | — |
| `--root-cause` | 分析审计历史，输出根因报告 | — |
| `--regression <dir>` | 对指定目录跑回归验证 | — |
| `--install-hook` | 安装 git commit-msg hook | — |
| `--mcp` | 启动 MCP Server 模式 | — |
| `--version` | 版本号 | — |
| `--help` | 帮助 | — |

### 退出码

| 码 | 含义 |
|:--:|------|
| 0 | 全部规则通过 |
| 1 | 有警告（WARN） |
| 2 | 有违规（FAIL）/ 非 git 仓库 |

### 装后验证

```bash
# 完整检查（文件/Hook/权限/daemon/脱敏/断路器/平台兼容性）
sofagent-verify

# 快速模式（4 项核心检查，5 秒出结果）
sofagent-verify --quick

# 只显示失败和警告项
sofagent-verify --quiet

# JSON 输出（CI/CD）
sofagent-verify --json

# 手动指定平台
sofagent-verify --platform workbuddy
```

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--quick` | 仅 4 项核心检查 | — |
| `--quiet` | 只显示失败和警告 | — |
| `--json` | JSON 机器可读输出 | — |
| `--platform <name>` | 手动指定平台 | 自动检测 |

### Git Hook 集成

```bash
# 自动安装 commit-msg hook
sofagent-audit --install-hook

# hook 会拦截违规提交（exit code 2 时阻止）
```

> 💡 注意：sofagent-audit 进程自身 exit=2（FAIL 拦截），但经 git commit-msg hook 转发后，shell 看到的是 git 的 exit=1。测试拦截行为时以 sofagent-audit 直接调用的 exit code 为准。

### CI/CD 集成（GitHub Actions 示例）

```yaml
# .github/workflows/audit.yml
name: sofagent-audit
on: [pull_request]
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # 需要完整 git history
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
      - run: npm install -g @sofagent/audit
      - run: sofagent-audit --diff origin/main..HEAD --ci --json
```

### Webhook 推送

```bash
# 环境变量方式（推荐）
export SOFAGENT_WEBHOOK_URL="https://oapi.dingtalk.com/robot/send?access_token=YOUR_TOKEN"
sofagent-audit --diff HEAD~1..HEAD --webhook dingtalk

# 参数方式
sofagent-audit --diff HEAD~1..HEAD --webhook feishu --webhook-url "https://open.feishu.cn/open-apis/bot/v2/hook/YOUR_ID"
```

有 WARN/FAIL 时自动推送（fire-and-forget，推送失败不影响审计结果）。

---

## MCP Server 用法

sofagent-audit 内置 MCP Server（Model Context Protocol），可被 Claude Desktop / Cursor / Continue / 任何 MCP Client 调用。

### 启动 MCP Server

```bash
# 方式一：通过 CLI 参数
sofagent-audit --mcp

# 方式二：直接调用独立入口
sofagent-mcp
```

MCP Server 通过 stdio 通信（JSON-RPC 2.0），最小运行时依赖。

### MCP Client 配置

通用模板（`command: sofagent-audit, args: [--mcp]`），各客户端配置文件路径：

| 客户端 | 配置文件 | 字段 |
|------|------|------|
| Claude Desktop | `claude_desktop_config.json` | `mcpServers.sofagent` |
| Cursor | 设置 > MCP | `mcpServers.sofagent` |
| Continue | `~/.continue/config.json` | `experimental.modelContextProtocolServers[]` |

不装 npm 包直接用 `npx`：

```json
{
  "mcpServers": {
    "sofagent": {
      "command": "npx",
      "args": ["-y", "@sofagent/audit", "--mcp"]
    }
  }
}
```

### 暴露的 Tools（3 个）

| Tool | 说明 | 参数 |
|------|------|------|
| `run_audit` | 对 git diff 跑全量审计规则（A1-A11、A14-A19 + E1-E4，共 21 条），返回结构化报告 | `diff`（git range）、`task`（任务描述）、`strict`（布尔）、`silent`（布尔） |
| `get_think` | 读取 think.md 最近 N 条反思条目 | `count`（默认 1） |
| `write_think` | 向 think.md 追加一条反思记录 | `lesson`（必填）、`task`（可选） |

**`run_audit` 返回示例**：

```json
{
  "exitCode": 1,
  "verdict": "WARN",
  "fileCount": 3,
  "triggeredRules": [
    { "name": "A3 不改越界", "status": "WARN", "ruleClass": "业务底线" }
  ],
  "allRules": [
    { "name": "A1 不碰敏感", "status": "PASS" },
    { "name": "A2 不泄密钥", "status": "PASS" }
  ]
}
```

### 暴露的 Resources（3 个）

| URI | 说明 | 类型 |
|-----|------|------|
| `think://latest` | think.md 最后一条反思条目 | text/markdown |
| `logs://today` | 今日任务日志 | text/plain |
| `audit://last-report` | 最近一次审计历史记录 | application/json |

### 协议细节

- **协议版本**：`2024-11-05`
- **传输层**：stdio（stdin 读 JSON-RPC，stdout 写 JSON-RPC，stderr 写日志）
- **必须先 `initialize`** 才能调用 tools/resources
- **最小运行时依赖**：仅 js-yaml（YAML 配置解析），其余用 Node.js 内置模块

---

## 审计规则

### 默认规则（A1-A11）

| 规则 | 判定 | 严重度 | 说明 |
|------|------|:--:|------|
| A1 不碰敏感 | `.env` / `*.pem` / `id_rsa` / 密钥文件被修改 | FAIL | 业务底线 |
| A2 不泄密钥 | 代码中出现 API Key / Token / Password 模式 | FAIL | 业务底线 |
| A3 不改越界 | 修改文件路径与任务描述不匹配 | WARN | 业务底线 |
| A4 不删配置 | 配置文件被删除 | FAIL | 业务底线 |
| A5 不瞒真相 | commit message 为空或纯占位符（fix/update/wip 等） | WARN | 业务底线 |
| A6 不坏构建 | 构建配置文件异常改动 | WARN | 能力拐杖 |
| A7 不存盲改 | 被修改文件无读取记录（依赖 `.sofagent/task/logs/`） | FAIL/WARN | 能力拐杖 |
| A8 不逃验证 | 构建文件变更后无测试记录 | FAIL/WARN | 能力拐杖 |
| A9 不纳注入 | 代码中存在命令注入风险模式 | FAIL | 业务底线 |
| A10 不引毒源 | 依赖包黑名单检测 | WARN | 业务底线 |
| A11 不滥资源 | 资源滥用检测（超大文件等） | WARN | 业务底线 |

### 扩展规则（A14-A19 + E1-E4，共 10 条）

A14-A19 + E1-E4 均需 `extendedRules: true` 启用（`DEFAULT_CONFIG=false`，opt-in）。仅当 config 解析失败走 `safeDefaults` 时 fail-closed 强制启用所有扩展规则——这是有意的保护性设计。

| 规则 | 判定 | 严重度 | 说明 |
|------|------|:--:|------|
| A14 知识库越权 | 访问超出工作流声明范围的知识库页面 | WARN | 事后审计，非运行时阻断 |
| A15 不盲动 | workflow.yml 节点未声明 actions 时 FAIL（防绕过） | FAIL | v1.1.3 起未声明 actions = FAIL（原 WARN 升级） |
| A16 非授权文件变更 | 非工作流声明范围内的文件被修改 | FAIL | 行为级检测（文件路径/扩展名） |
| A17 异常批量变更 | 单次提交变更文件数超阈值 | WARN | 行为级检测（变更数量，evidenceMode=filesystem） |
| A18 垃圾文件 | 临时文件名模式的垃圾文件 | WARN | 检测 a.txt/bak.log 等无意义文件 |
| A19 commit message 质量 | message 命中黑名单词或过短 | FAIL | 防"add"/"test"/"fix" 等低质 message |
| E1 不含测试文件 | 测试文件被提交到生产目录 | WARN | |
| E2 TODO 未声明 | 新增 TODO 未在任务中声明 | WARN | |
| E3 大量删除 | 单次提交删除行数 > 阈值 | WARN | |
| E4 低注释率 | 新增 >200 行且注释率 < 5% | WARN | |

> ⚠️ **A15 说明**：v1.1.3 起 A15 升级为 FAIL——workflow.yml 节点未声明 actions 时 FAIL（防 Agent 不声明 actions 绕过所有约束）。原 WARN 设计已废弃。

### 规则分级

每条规则标注 `ruleClass`：

- **业务底线**：违反即破坏交付完整性（安全/边界/追溯）
- **能力拐杖**：帮助 Agent 走完正确流程，违反不一定是事故

> ⚠️ A7/A8 在 `--strict` / `--ci` 模式下为 FAIL，非严格模式下无日志时降级为 WARN。

---

## 配置

### 配置文件（可选）

在项目根目录创建 `.sofagent/config.yml`：

```yaml
# 扩展规则开关
extendedRules: false

# 任务日志目录
taskLogsDir: .sofagent/task/logs

# 审计历史保留天数
historyRetentionDays: 90
```

不创建配置文件也能用——所有参数有默认值。

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|------|
| `SOFAGENT_DATA` | 数据目录（think.md / audit / task/logs） | `.sofagent`（cwd 下） |
| `SOFAGENT_WEBHOOK_URL` | Webhook URL | — |

---

## 设计原则

- **最小运行时依赖**：仅 js-yaml（YAML 配置解析），其余用 Node.js 内置模块（fs / child_process / readline / http）
- **焊死的门**——审计规则独立只读，Agent 不可篡改审计逻辑
- **不依赖 Agent 运行时配合**——看的是 git diff（已发生的历史记录）。A7/A8 日志检查依赖 Agent 写入的 `.sofagent/task/logs/` 文件
- **安全第一**——range 参数正则校验防注入，execFileSync 数组传参不 spawn shell

---

## 开发

> ⚠️ **单包测试前提**：monorepo 未 build 时单包 `npm test` 可能因依赖 `dist/` 而失败。先在根目录 `npm run build --workspaces` 或按 [CONTRIBUTING](../../CONTRIBUTING.md) 流程操作。

```bash
git clone https://github.com/KongFangXun/sofagent.git
cd sofagent/sofagent/audit

npm ci           # 安装依赖
npm run build    # 编译 TypeScript
npm test         # 运行测试（388 tests）
npm run check    # 类型检查（tsc --noEmit）
```

---

## License

MIT
