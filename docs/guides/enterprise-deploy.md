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

编排引擎基于 LangGraph createReactAgent（v1.2.0 从 deepagents 迁移，v1.0.7 起 ao 已完全退役）。不可用时手动降级：
- 手动拆任务
- 用 task-record.sh 逐条记录
- 手动闭环

## 数据安全

### 权限

install.sh 自动设置 `~/.sofagent/data/` 目录权限为 700（仅当前用户可访问）。
多用户服务器场景下，其他用户无法读取你的任务记录。

### 明文存储提醒

task/logs 和 think.md 以明文 Markdown 存储，可能含代码片段和对话摘要。
如需更高安全级别，考虑对 ~/.sofagent/data/ 目录做 gpg 加密或放在加密卷上。

## 合规检查清单

| 检查项 | 状态 | 说明 |
|------|:--:|------|
| 数据存储位置 | ✅ 本地 | 不上云，不调外部 API（离线模式） |
| 数据脱敏 | ✅ | A2/A9 命中行脱敏后存储 |
| 数据加密 | ❌ | 本地存储为明文（如需加密，用 OS 级全盘加密） |
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

详见 [ROADMAP.md](../ROADMAP.md)。

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

通过符号链接共享 `~/.sofagent/data/config.yml` 模板，企业统一管控审计策略：

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
  mkdir -p "$repo/.sofagent/data"
  ln -sf /etc/sofagent/template-config.yml "$repo/.sofagent/data/config.yml"
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

- **Git submodule**：`git submodule add git@github.com:your-org/sofagent-shared-config.git ~/.sofagent/data/shared`
- **dotfiles**：将 `~/.sofagent/data/config.yml` 加入 stow/chezmoi，通过 symlink 统一管理

### 当前局限

- 没有 org-level 自动推送机制，每个 repo 需独立 `--init`。企业版集中管控规划在 v2.x

---

## AD/LDAP 集成

> 当前 sofagent 不直接支持 AD/LDAP 认证集成。

- **现状**：sofagent 的用户身份基于本地 OS 用户（`~/.sofagent/data/` 目录权限 700），没有集中用户目录概念
- **替代方案**：通过系统级 git hook 模板部署实现组织范围策略下发——将 `sofagent-audit --install-hook` 嵌入 git 模板目录（`git config --global init.templateDir`），新 clone 的仓库自动带 hook
- **权限映射**：可通过组织级脚本控制哪些用户组有权修改 `~/.sofagent/data/config.yml`（文件 ACL：`chmod 640` + `chown :engineering`）
- **路线图**：企业级 SSO/LDAP 集成规划在 v2.x，当前建议结合 OS 级权限 + git hook 模板实现等效控制

## 审计日志对接

sofagent 的审计记录以 JSONL 格式存储在 `data/audit/history.jsonl`，每行一个审计事件对象。

### 日志格式（核心字段）

```jsonl
{"timestamp":"2026-07-30T10:00:00Z","rule":"A1","status":"PASS","file":"src/main.ts","detail":"no secret found"}
{"timestamp":"2026-07-30T10:00:01Z","rule":"A3","status":"FAIL","file":"src/utils.ts","detail":"modified files outside scope"}
```

### SIEM 对接方案

| 工具 | 接入方式 |
|------|---------|
| **ELK (Elasticsearch + Logstash + Kibana)** | Filebeat 配置 `input.path: /path/to/.sofagent/data/audit/history.jsonl`，Logstash 解析 JSONL 后索引到 Elasticsearch |
| **Splunk** | Universal Forwarder 配置 monitor 监听 `history.jsonl`，自动解析结构化日志 |
| **Grafana Loki** | Promtail 配置 scrape_config 指向 `history.jsonl`，label 按 `rule`/`status` 维度 |
| **自家 SIEM** | `tail -f ~/.sofagent/data/audit/history.jsonl \| your-pipe` 实时消费 |

> `--json` 输出模式可配合 jq 做实时过滤：`sofagent-audit --diff HEAD~1..HEAD --json | jq 'select(.status == "FAIL")'`

## 联邦部署（多设备 Token 管理）

当 sofagent 在多台设备上部署时，需统一管理联邦 token 和跨设备审计追溯。

### Token 管理

> ⚠️ v1.2.3 起通过环境变量传递联邦身份的机制已废弃（环境变量可被 `ps e` 读取明文，属高危已修复）。请改用文件机制：

- **文件机制**：将联邦 token 写入 `~/.sofagent/federation.token`（权限 600），每台设备使用独立 token：
  ```bash
  echo "xxx" > ~/.sofagent/federation.token
  chmod 600 ~/.sofagent/federation.token
  ```
- **安全注意**：文件权限必须收紧为 600（仅当前用户可读写），防止同机其他用户读取
- **轮换策略**：定期更换 token，配合审计日志中 `federation_id` 字段追溯设备身份

### 审计追溯

- 每台设备的审计日志独立存储于本地 `data/audit/history.jsonl`（JSONL，每行一条审计记录）
- **集中查看**：通过 rsync 等工具汇总各设备日志到中央节点后，用 jq 聚合分析（P1-30 修正：原文档所述聚合命令不存在，实际为 JSONL 文件 + jq）：
  ```bash
  cat */data/audit/history.jsonl | jq -s '[.[] | select(.exitCode > 0)] | {total: length, fails: length}'
  cat */data/audit/history.jsonl | jq -r '.[] | [.timestamp, .commitSha, .engine] | @tsv'
  ```
- **跨设备一致性**：history 条目含 `timestamp`/`commitSha`/`engine` 字段；设备身份靠文件路径（`<device>/data/audit/history.jsonl`）区分——条目本身不存 hostname/federation_id（P1-30 修正：原文档所述字段与实际 JSONL 不符）

### 安全建议

| 措施 | 说明 |
|------|------|
| token 最小化 | 每台设备用独立 token，避免单 token 泄露影响全集群 |
| 定期轮换 | 建议 90 天轮换一次，token 变更后更新各设备环境变量 |
| 日志隔离 | 设备间 audit log 不自动同步——需通过中央管道做聚合，避免单设备被控后污染全量日志 |
