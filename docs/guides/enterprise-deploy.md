# sofagent · 企业部署指南

# 企业级部署指南

> sofagent 在企业内网部署的配置说明。普通用户不需要看这份文档——默认安装就行。

## 离线部署

### 1. 跳过外部依赖安装

```bash
bash install.sh --platform openclaw \
  --no-config-inject
# --no-config-inject   跳过自动改 OpenClaw config.json
```

### 2. 离线模式（跳过 ClawHub API）

编辑 `~/.openclaw/fde.md`，取消 `offline: true` 的注释。
Agent 检测到后跳过 ClawHub 搜索，Skills 手动放入 `~/.openclaw/skills/` 目录。

### 3. 编排降级

编排引擎基于 DeepAgents（v1.0.7 起 ao 已完全退役，无 ao fallback）。DeepAgents 不可用时手动降级：
- 手动拆任务
- 用 task-record.sh 逐条记录
- 手动闭环

## 数据安全

### 权限

install.sh 自动设置 `.sofagent/` 目录权限为 700（仅当前用户可访问）。
多用户服务器场景下，其他用户无法读取你的任务记录。

### 明文存储提醒

task/logs 和 think.md 以明文 Markdown 存储，可能含代码片段和对话摘要。
如需更高安全级别，考虑对 .sofagent/ 目录做 gpg 加密或放在加密卷上。

## 合规检查清单

| 检查项 | 状态 | 说明 |
|------|:--:|------|
| 数据存储位置 | ✅ 本地 | 不上云，不调外部 API（离线模式） |
| 数据脱敏 | ✅ A2/A9 命中行脱敏后存储 |
| 数据加密 | ❌ 本地存储为明文（如需加密，用 OS 级全盘加密） |
| 权限控制 | ✅ 700 | install.sh 自动设置 |
| 数据保留策略 | ✅ 已完成 | v0.71 落地 cleanup.sh 自动清理，支持 --purge --before |
| 审计日志 | ✅ 已完成 | v0.71 落地 task-record.sh 独立审计日志 + task/logs 追溯双通道 |
| 外部 API 调用 | ✅ 可关闭 | 离线模式跳过 ClawHub |
| 配置文件修改 | ✅ 可控 | --no-config-inject 跳过 |

## 已落地（v0.73+）

以下能力原为 v0.7x 规划，已在 v0.71 版本落地：
- task/logs 脱敏（sanitize() 扫描 API Key/密码/手机号）
- 数据保留策略（cleanup.sh --purge --before 命令）
- 独立审计日志（task-record.sh 双通道）

> think.md gpg 加密自动化仍待规划。

详见 [ROADMAP.md](../../ROADMAP.md)。

## 批量部署

### ① 批量安装脚本

```bash
# 从 repo-list.txt 批量安装
bash install.sh

while IFS= read -r repo; do
  (cd "$repo" && sofagent-audit --init)
done < repo-list.txt
```
> `--init` 是幂等的——已初始化的仓库重复执行不会重复创建文件。

### ② org-level 配置集中下发

通过符号链接共享 `.sofagent/config.yml` 模板，企业统一管控审计策略：

```bash
# 创建标准模板
cat > /etc/sofagent/template-config.yml << 'EOF'
extendedRules: true
carefulModifyThreshold: 0.2
rules:
  a1: true
  a2: true
  a3: true
  # ... 按企业策略配置
EOF

# 符号链接到各 repo
for repo in /path/to/repos/*/; do
  mkdir -p "$repo/.sofagent"
  ln -sf /etc/sofagent/template-config.yml "$repo/.sofagent/config.yml"
done
```

> 修改一次模板，所有 repo 立即生效。`--doctor` 可验证当前配置完整性。

### ③ CI 集成示例

GitHub Actions 中跑 `sofagent-audit --diff --ci`：

```yaml
# .github/workflows/sofagent-audit.yml
name: sofagent-audit
on: [pull_request]
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
      - run: bash install.sh
      - run: sofagent-audit --diff origin/main..HEAD --ci --json
```

> `--ci` 模式：WARN 不阻断（exit 1），FAIL 阻断（exit 2），紧凑输出。

### 其他方案

- **Git submodule**：`git submodule add git@github.com:your-org/sofagent-shared-config.git .sofagent/shared`
- **dotfiles**：将 `.sofagent/config.yml` 加入 stow/chezmoi，通过 symlink 统一管理

### 当前局限

- 没有 org-level 自动推送机制，每个 repo 需独立 `--init`。企业版集中管控规划在 v2.x
