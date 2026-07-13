# 安全策略

## 已知风险

sofagent 是纯本地 Harness 中间件，**数据不出本机**——但以下数据以**明文 Markdown** 存储，请评估风险：

| 文件 | 位置 | 可能含 |
|------|------|------|
| `task/logs/` | `.sofagent/task/logs/YYYY-MM/YYYY-MM-DD.md` | 任务摘要、代码片段、API 响应摘要、对话摘要 |
| `think.md` | `.sofagent/think.md` | 反思记录，可能含踩坑细节、失败模式、决策推理 |
| `scoring/` | `.sofagent/scoring/` | Skill 使用记录 |
| `orchestrator/` | `.sofagent/orchestrator/` | 编排决策历史 |

**当前状态（v1.0.8）**：
- ✅ 脱敏：sanitize() 管道扫描 API Key / 密码 / 手机号，写入前自动打码
- ✅ 数据保留：cleanup.sh 支持 --purge --before 定时清理 + tar.gz 归档
- ✅ 审计日志：task-record.sh 独立审计日志 + task/logs 追溯双通道
- ⚠️ 明文存储：`.sofagent/` 下文件仍为 Markdown 明文，未做加密
- ⚠️ **当前限制**：数据明文存储 + LLM 自评无外部基准。GDPR / 等保 / SOC2 场景需额外加密措施。age 加密推到 v1.x+ 待评估（v0.85 砍削决策：先验证核心价值再谈企业级）
- `.sofagent/` 目录权限为 700（仅当前用户可访问），但同一服务器其他用户若有 root 权限可读

**企业环境建议**：
- 对 `.sofagent/` 目录做 gpg 加密或放在加密卷上
- 脱敏/保留/审计能力已在 v0.71 落地，详见 [企业部署指南](./docs/guides/enterprise-deploy.md)

## install.sh 行为说明

install.sh 是 sofagent 的一键安装脚本。以下是其完整行为清单，供安全审查：

### 脚本会做的事

| 操作 | 路径 | 说明 |
|------|------|------|
| 创建目录 | `~/.openclaw/skills/sofagent/` 或 `~/.workbuddy/skills/sofagent/` | 按平台部署 Skill 文件 |
| 创建目录 | `${项目目录}/.sofagent/task/logs/` | 数据目录，权限 700 |
| 复制文件 | 宪法(fde.md) + 6 核心 Skill + 数据模板 + 配套脚本 | 从仓库 `sofagent/skill/` 和 `sofagent/scripts/` 复制到目标目录 |
| 写入配置 | `~/.openclaw/openclaw.json`（仅 OpenClaw） | 注册加载链 Hook |
| 写入配置 | `~/.openclaw/config.json`（仅 OpenClaw） | 注入 loopDetection 断路器 |
| npm install | `deepagents`（编排引擎依赖） | Sub Agent 编排引擎 |
| 安装服务 | launchd(macOS) / systemd(Linux) | daemon 后台进程（交互确认后。daemon 当前为 bash 实现，正常运行中） |

### 脚本不会做的事

- ❌ 不会 `sudo`——所有操作在用户权限范围内
- ❌ 不会改系统文件——不碰 `/etc`、`/usr`、`/System`
- ❌ 不会联网下载额外内容
- ❌ 不会执行远程脚本（`--remote` 模式只做 git clone 官方仓库）
- ❌ 不会收集或上传任何用户数据

### 源码审查

install.sh 拆分为以下模块，便于逐模块审查：

| 模块 | 行数 | 职责 |
|------|------|------|
| `install.sh` | 160 | 主入口（组装 + 参数解析） |
| `lib/config.sh` | 143 | 配置加载 + 常量定义 |
| `lib/daemon-lib.sh` | 142 | daemon 公共函数库 |
| `lib/daemon-register.sh` | 115 | Hook + daemon 注册 |
| `lib/file-deploy.sh` | 109 | 文件部署 |
| `lib/platform-detect.sh` | 102 | 平台探测 + 参数解析 |
| `lib/post-install.sh` | 97 | 安装后检查 + 输出 |

## 报告漏洞

如果你发现安全问题（不是普通 Bug），请通过以下方式私密报告：

- **GitHub Security Advisory**：[私密报告漏洞](https://github.com/KongFangXun/sofagent/security/advisories/new)（推荐）
- **邮件**：kong.yao@evfrey.com

**请不要在公开 Issue 中披露安全漏洞细节。**

## 响应承诺

- **确认**：7 天内确认收到报告
- **初步评估**：30 天内给出初步评估和影响范围
- **修复**：根据严重程度排期——高危（数据泄露/权限提升）优先修复并发布补丁版本

## 适用范围

本安全策略适用于 sofagent 项目仓库内的所有文件。第三方依赖（如 deepagents、OpenClaw）的安全问题请向对应项目报告。

## 免责声明

sofagent 基于 MIT 许可证发布，按「现状」（AS IS）提供，不附带任何明示或暗示的担保。作者不对因使用本软件而产生的任何直接、间接、附带或后果性损害承担责任。sofagent 是审计工具而非安全防线——它能检测常见的 Agent 违规模式，但不能保证拦截所有攻击向量。

---

## 审计工具安全性（sofagent-audit）

sofagent-audit（v0.92+）是 TypeScript CLI，执行 `execFileSync('git', ...)` 读取 git diff 和文件系统。不使用 eval、不 spawn shell、不执行外部脚本。命令参数使用数组传入（`['diff', '--unified=3', range]`），range 参数经过正则校验 `[a-zA-Z0-9~^.\-]`，无命令注入风险。

**数据访问**：审计工具只读取 git diff 输出和 `.sofagent/task/logs/` 目录下的 Markdown 文件，不发起网络请求，不写入任何文件。

**信任边界**：审计工具本身是确定性的——给定相同的 git diff 和日志，输出相同。但审计 A7/A8 的结果依赖 Agent 日志的真实性（Agent 可以伪造日志）。这不是审计工具的安全漏洞，是架构级别的信任模型选择。详见 [LIMITATIONS.md](./docs/LIMITATIONS.md)（「审计工具信任模型：Agent 自我报告」节）。

> ⚠️ **A14/A15 是 commit 时审计，不是运行时阻断。** Agent 在 commit 前仍可能访问受限数据——审计只能事后发现。这不是运行时沙箱。

### history.jsonl 访问控制

history.jsonl 存储审计拦截记录（含被拦截的 diff 摘要）。以下为当前访问模型：

| 操作 | Agent 能否？ | 说明 |
|------|:--:|------|
| 读取 | ✅ 能（以当前用户身份） | Agent 和审计工具共享同一文件系统权限 |
| 写入 | ✅ 能 | Agent 可以追加/删除/篡改 history.jsonl |
| 检测篡改 | ⚠️ --doctor 第 8 项检查 | 通过 hash chain 验证——但 Agent 可以在篡改后重新计算整条链 |

**缓解**：sanitize() 管道在写入前对密钥/密码/手机号打码。但这不是加密——Agent 可以从原始 git diff 中直接读到敏感内容。根治方案（age 加密 + 独立审计存储）推到 v2.x。

### 已知绕过路径

| 绕过方式 | 检测手段 | 缓解 |
|----------|---------|------|
| `git commit --no-verify` | ❌ 无自动检测 | 定期 `--doctor` 检查未审计的 commit（`git log --grep` 匹配审计签名） |
| 删除 pre-commit hook 文件 | ⚠️ `--doctor` 可检测 | daemon 监控 .git/hooks/ 目录变化（v1.x 计划） |
| 伪造 Agent 日志（task/logs） | ❌ 无自动检测 | 人工抽查 + 交叉验证 git log 时间戳 |
| 绕过 --init 直接手动修改 config.yml | ❌ 无自动检测 | config hash 校验（见 fail-closed 改进） |

> ⚠️ 以上绕过路径均依赖 Agent 的"自觉"——这是 sofagent 架构级别的信任模型选择：审计工具是**协助**人类监督，不是**替代**人类监督。已知绕过路径详见 LIMITATIONS 已有信任模型描述。

---

## 第三方依赖供应链

**deepagents** 是 sofagent 编排引擎的正式依赖（`deepagents@^1.10.7`，npm 包）。v1.0.7 起从 optionalDependency 提升为正式依赖。

> 🔴 **Breaking Change（v1.0.7）**：ao（agency-orchestrator）已完全退役。v1.0.6 用户升级到 v1.0.7 后需手动卸载：`npm uninstall -g agency-orchestrator`。编排引擎已全面迁移到 DeepAgents，ao 代码路径全部移除。

**供应链安全建议**：
- 每次 `npm install` 后运行 `npm audit`
- 内网环境建议预装 deepagents 并验证安装通过后再部署
